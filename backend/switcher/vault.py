"""Stockage des comptes : sessions chiffrées (DPAPI) + métadonnées."""
import json
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from . import applog, atomic_io, dpapi, paths


@dataclass(slots=True)
class Account:
    name: str
    region: str
    saved_at: float
    last_used: float | None
    expired: bool = False
    riot_id: str | None = None
    level: int | None = None
    rank: dict | None = None  # {'solo': {tier, division, lp, wins, losses}, 'flex': …}
    icon_id: int | None = None  # profileIconId LoL (avatar)
    lp_delta: int | None = None  # variation de LP SoloQ depuis le dernier refresh
    note: str | None = None  # note libre de l'utilisateur (ex: "smurf ADC")
    pinned: bool = False  # épinglé en haut de la liste
    goal: dict | None = None  # objectif de rang {'tier', 'division', 'start_lp'}
    post_swap: dict | None = None  # routine post-swap {'queue_id', 'auto_join'}
    champ_select: dict | None = None  # auto-intent/pick/ban + chat, voir DEFAULT_CHAMP_SELECT
    position_prefs: dict | None = None  # rôles auto avant file {'first', 'second'}
    wallet: dict | None = None  # {'blue_essence': int, 'rp': int}
    # Etat spécifique VALORANT. Les sessions restent communes au compte Riot ;
    # ce bloc ne contient que les préférences et jalons propres au jeu.
    # {initialized: bool, tutorial_confirmed: bool, pinned: bool}
    valorant: dict | None = None

    @property
    def dir(self) -> Path:
        return paths.ACCOUNTS_DIR / self.name


def _meta_path(account_dir: Path) -> Path:
    return account_dir / "meta.json"


def _safe_name(name: str) -> str:
    name = name.strip()
    if not name or not re.fullmatch(r"[\w\- .#]{1,40}", name):
        raise ValueError(
            "Nom de compte invalide : lettres, chiffres, espaces, tirets, points et "
            "# uniquement (max 40)."
        )
    return name


def _extract_region(yaml_text: str) -> str:
    m = re.search(r'region:\s*"?([A-Za-z0-9]+)"?', yaml_text)
    return m.group(1).upper() if m else "?"


def has_persistent_session(yaml_text: str) -> bool:
    """Vrai si le fichier contient une session Riot persistante.

    Les anciennes versions du client Riot écrivaient directement un cookie
    ``ssid``. Les versions récentes séparent ``riot-login`` de
    l'authentificateur RSO ``rso-authenticator``. Le champ ``persist`` de
    ``riot-login`` est désormais nul même pour une session durable. Le signal
    fiable est l'entrée RSO complète : elle porte une ``value`` non vide avec
    l'attribut de cookie ``persistent: true`` **et** un ``refresh_token``.
    Le cookie persistant seul ne représente qu'un appareil connu ; il ne suffit
    pas à reconnecter un compte après relance. Ne reconnaître que ``ssid``
    rend alors impossible la sauvegarde d'une session pourtant valide.

    Le fichier est du YAML très simple, mais le backend reste volontairement
    sans dépendance externe pour pouvoir être packagé par PyInstaller. On ne
    lit jamais la valeur sensible : seulement la structure et la présence d'une
    valeur non vide dans l'authentificateur.
    """
    # Compatibilité avec les profils capturés par les anciens clients Riot.
    if '"ssid"' in yaml_text or "'ssid'" in yaml_text:
        return True

    lines = yaml_text.splitlines()
    if _yaml_block_after_key(lines, "riot-login") is None:
        return False
    # Dans le format Riot actuel, ces deux blocs sont frères et non imbriqués.
    rso_authenticator = _yaml_block_after_key(lines, "rso-authenticator")
    return (
        rso_authenticator is not None
        and _yaml_has_true_value(rso_authenticator, "persistent")
        and _yaml_has_nonempty_value(rso_authenticator, "value")
        and _yaml_has_nonempty_value(lines, "refresh_token")
    )


def _yaml_block_after_key(lines: list[str], key: str) -> list[str] | None:
    """Retourne le bloc YAML indenté sous ``key`` sans interpréter les valeurs."""
    pattern = re.compile(
        rf'^(?P<indent>[ \t]*)(?:-\s*)?["\']?{re.escape(key)}["\']?\s*:'
        r'(?P<value>[^#]*)(?:#.*)?$'
    )
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match or match.group("value").strip():
            continue  # clé scalaire : elle ne peut pas contenir de sous-bloc
        indent = len(match.group("indent").expandtabs(4))
        end = index + 1
        while end < len(lines):
            candidate = lines[end]
            stripped = candidate.lstrip(" \t")
            if stripped and not stripped.startswith("#"):
                candidate_indent = len(candidate) - len(stripped)
                if candidate_indent <= indent:
                    break
            end += 1
        return lines[index + 1:end]
    return None


def _yaml_has_true_value(lines: list[str], key: str) -> bool:
    pattern = re.compile(
        rf'^[ \t]*["\']?{re.escape(key)}["\']?\s*:\s*'
        r'(?P<value>[^#\r\n]*)(?:#.*)?$'
    )
    for line in lines:
        match = pattern.match(line)
        if match and match.group("value").strip().strip('"\'').lower() in {"true", "yes", "1"}:
            return True
    return False


def _yaml_has_nonempty_value(lines: list[str], key: str) -> bool:
    pattern = re.compile(
        rf'^[ \t]*["\']?{re.escape(key)}["\']?\s*:\s*'
        r'(?P<value>[^#\r\n]*)(?:#.*)?$'
    )
    empty_values = {"", "null", "none", "false", "~", "''", '\"\"'}
    for line in lines:
        match = pattern.match(line)
        if match and match.group("value").strip().lower() not in empty_values:
            return True
    return False


def current_session_files() -> dict[str, Path]:
    """Fichiers de session actuellement présents sur la machine."""
    return {key: p for key, p in paths.SESSION_FILES.items() if p.is_file()}


_STATE_FILE = paths.STORAGE_DIR / "state.json"

# Caches basés sur les mtimes réels des fichiers : invalidation automatique quelle
# que soit l'origine de l'écriture (ce process, un import, une restauration…).
# Un stat() coûte ~10× moins qu'une lecture+parse JSON, et get_active() /
# list_accounts() sont appelés en permanence par les watchers.
_active_cache: tuple[float, str | None] | None = None
_accounts_cache: tuple[tuple, list] | None = None
_write_lock = threading.RLock()


def _serialized_write(function):
    """Sérialise les read-modify-write provenant des workers concurrents.

    Journalise aussi chaque mutation dans le journal rotatif (Optim 4,
    PASSATION_HEXGATE_SWAP_V2_1.md §14) : uniquement le nom de la fonction et
    le nom de compte (premier argument positionnel), jamais les kwargs — ce
    sont eux qui peuvent porter des données de session ou de statistiques.
    """
    def guarded(*args, **kwargs):
        account = args[0] if args and isinstance(args[0], str) else None
        with _write_lock:
            try:
                result = function(*args, **kwargs)
            except Exception as error:
                applog.get_logger().warning(
                    "coffre: échec %s(%s) : %s", function.__name__, account, error
                )
                raise
        applog.get_logger().info("coffre: %s(%s) ok", function.__name__, account)
        return result
    return guarded


def get_active() -> str | None:
    """Nom du compte actuellement connecté dans le client (suivi par le switcher)."""
    global _active_cache
    try:
        mtime = _STATE_FILE.stat().st_mtime_ns
    except OSError:
        _active_cache = None
        return None
    if _active_cache is not None and _active_cache[0] == mtime:
        return _active_cache[1]
    try:
        value = atomic_io.read_json(_STATE_FILE).get("active_account")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    _active_cache = (mtime, value)
    return value


@_serialized_write
def set_active(name: str | None) -> None:
    atomic_io.write_json(_STATE_FILE, {"active_account": name})


def list_accounts() -> list[Account]:
    global _accounts_cache
    if not paths.ACCOUNTS_DIR.is_dir():
        return []
    entries = []
    for account_dir in sorted(paths.ACCOUNTS_DIR.iterdir()):
        meta_file = _meta_path(account_dir)
        try:
            entries.append((meta_file, meta_file.stat().st_mtime_ns))
        except OSError:
            continue  # pas de meta.json : dossier ignoré
    signature = tuple((str(p), m) for p, m in entries)
    if _accounts_cache is not None and _accounts_cache[0] == signature:
        return list(_accounts_cache[1])  # copie superficielle : liste jamais partagée
    accounts = []
    for meta_file, _mtime in entries:
        try:
            meta = atomic_io.read_json(meta_file)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            # Un seul profil abîmé ne doit jamais masquer toute la liste.
            continue
        accounts.append(Account(
            name=meta["name"],
            region=meta.get("region", "?"),
            saved_at=meta.get("saved_at", 0),
            last_used=meta.get("last_used"),
            expired=meta.get("expired", False),
            riot_id=meta.get("riot_id"),
            level=meta.get("level"),
            rank=meta.get("rank"),
            icon_id=meta.get("icon_id"),
            lp_delta=meta.get("lp_delta"),
            note=meta.get("note"),
            pinned=meta.get("pinned", False),
            goal=meta.get("goal"),
            post_swap=meta.get("post_swap"),
            champ_select=meta.get("champ_select"),
            position_prefs=meta.get("position_prefs"),
            wallet=meta.get("wallet"),
            valorant=meta.get("valorant"),
        ))
    _accounts_cache = (signature, accounts)
    return list(accounts)


@_serialized_write
def set_pinned(name: str, pinned: bool, product: str = "league_of_legends") -> None:
    """Épingle un compte pour le produit indiqué, sans modifier l'autre jeu."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    if product == "valorant":
        valorant = dict(meta.get("valorant") or {})
        valorant["pinned"] = bool(pinned)
        meta["valorant"] = valorant
    else:
        meta["pinned"] = bool(pinned)
    atomic_io.write_json(meta_file, meta, indent=2)


@_serialized_write
def update_valorant(name: str, *, initialized: bool | None = None,
                    tutorial_confirmed: bool | None = None,
                    stats: dict | None = None, reset: bool = False) -> dict:
    """Met à jour l'état local VALORANT d'un profil Riot.

    Aucun secret ni donnée de partie n'est stocké ici. `reset` retire seulement
    l'état VALORANT, jamais la session Riot ou les données League.
    """
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    if reset:
        meta.pop("valorant", None)
    else:
        valorant = dict(meta.get("valorant") or {})
        if initialized is not None:
            valorant["initialized"] = bool(initialized)
        if tutorial_confirmed is not None:
            valorant["tutorial_confirmed"] = bool(tutorial_confirmed)
        if stats is not None:
            # Résumé UI déjà normalisé, sans réponse brute HenrikDev ni secret.
            valorant["stats"] = stats
        meta["valorant"] = valorant
    atomic_io.write_json(meta_file, meta, indent=2)
    return dict(meta.get("valorant") or {})


@_serialized_write
def set_note(name: str, note: str | None) -> None:
    """Enregistre (ou efface, si note est vide) la note libre d'un compte."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    note = (note or "").strip()
    meta["note"] = note or None
    atomic_io.write_json(meta_file, meta, indent=2)


# ordre des tiers pour un LP « échelle » comparable entre divisions
_TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD",
          "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
_DIVS = {"IV": 0, "III": 1, "II": 2, "I": 3}


def _ladder_lp_solo(solo: dict | None) -> int | None:
    """LP absolu sur l'échelle (tier*400 + div*100 + lp) pour comparer 2 points SoloQ."""
    if not solo or solo.get("tier") not in _TIERS:
        return None
    tier_i = _TIERS.index(solo["tier"])
    div_i = _DIVS.get(solo.get("division") or "I", 3)
    # Master+ : pas de division, seul le LP compte au-dessus du palier
    if solo["tier"] in ("MASTER", "GRANDMASTER", "CHALLENGER"):
        div_i = 0
    return tier_i * 400 + div_i * 100 + solo.get("lp", 0)


def _ladder_lp(rank: dict | None) -> int | None:
    """LP absolu sur l'échelle (tier*400 + div*100 + lp) pour comparer 2 refreshs."""
    return _ladder_lp_solo((rank or {}).get("solo"))


def ladder_lp(solo: dict | None) -> int | None:
    """Version publique de _ladder_lp_solo, pour comparer des points d'historique."""
    return _ladder_lp_solo(solo)


@_serialized_write
def capture(name: str, refresh: bool = False) -> Account:
    """Sauvegarde la session actuellement connectée sous ce nom.

    refresh=True : re-sauvegarde silencieuse d'un compte existant (les jetons Riot
    tournent à chaque reconnexion, il faut garder la copie à jour) — conserve
    la date de dernière connexion.
    """
    name = _safe_name(name)
    files = current_session_files()
    if "riot_client" not in files:
        raise FileNotFoundError(
            "Aucune session trouvée : connecte-toi d'abord dans le client Riot "
            "avec « Rester connecté » coché."
        )
    riot_yaml = files["riot_client"].read_text(encoding="utf-8")
    if not has_persistent_session(riot_yaml):
        raise ValueError(
            "La session actuelle n'est pas persistante : reconnecte-toi en cochant "
            "« Rester connecté », sinon le swap ne fonctionnera pas."
        )

    account_dir = paths.ACCOUNTS_DIR / name
    account_dir.mkdir(parents=True, exist_ok=True)
    for key, src in files.items():
        encrypted = dpapi.protect(src.read_bytes())
        atomic_io.write_bytes(account_dir / f"{key}.bin", encrypted)

    # préserve les infos de profil (rank, riot id…) déjà connues pour ce compte
    old = {}
    if _meta_path(account_dir).is_file():
        old = atomic_io.read_json(_meta_path(account_dir))

    account = Account(name=name, region=_extract_region(riot_yaml),
                      saved_at=time.time(),
                      last_used=old.get("last_used") if refresh else None,
                      riot_id=old.get("riot_id"),
                      level=old.get("level"),
                      rank=old.get("rank"),
                      icon_id=old.get("icon_id"),
                      lp_delta=old.get("lp_delta"),
                      note=old.get("note"),
                      pinned=old.get("pinned", False),
                      goal=old.get("goal"),
                      post_swap=old.get("post_swap"),
                      champ_select=old.get("champ_select"),
                      position_prefs=old.get("position_prefs"),
                      wallet=old.get("wallet"),
                      valorant=old.get("valorant"))
    _write_meta(account)
    set_active(name)
    return account


@_serialized_write
def restore(name: str) -> None:
    """Remplace les fichiers de session actifs par ceux du compte donné.

    À appeler uniquement quand les processus Riot sont arrêtés.
    """
    account_dir = paths.ACCOUNTS_DIR / _safe_name(name)
    if not _meta_path(account_dir).is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")

    for key, dest in paths.SESSION_FILES.items():
        blob = account_dir / f"{key}.bin"
        if not blob.is_file():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        atomic_io.write_bytes(dest, dpapi.unprotect(blob.read_bytes()))

    meta = atomic_io.read_json(_meta_path(account_dir))
    meta["last_used"] = time.time()
    atomic_io.write_json(_meta_path(account_dir), meta, indent=2)


@_serialized_write
def delete(name: str) -> None:
    account_dir = paths.ACCOUNTS_DIR / _safe_name(name)
    if not account_dir.is_dir():
        return
    for f in account_dir.iterdir():
        f.unlink()
    account_dir.rmdir()
    if get_active() == name:
        set_active(None)


@_serialized_write
def update_profile(name: str, riot_id: str | None = None,
                   level: int | None = None, rank: dict | None = None,
                   icon_id: int | None = None, wallet: dict | None = None,
                   track_lp_delta: bool = True, puuid: str | None = None) -> int | None:
    """Met à jour les infos de profil (riot id, niveau, rank, avatar, wallet).

    Retourne la variation de LP SoloQ (échelle absolue) depuis le dernier rank
    connu, ou None si non calculable (pas de rank avant/après, ou inchangé).

    `track_lp_delta=False` : met le rang à jour SANS toucher au badge `lp_delta`
    (qui représente la dernière partie). À utiliser pour un rattrapage Riot API,
    où l'écart peut couvrir plusieurs parties et afficherait un delta mensonger.

    GARDE-FOU D'IDENTITÉ (14/09/2026) : l'écriture est refusée si les données
    entrantes appartiennent visiblement à un AUTRE compte que `name`. Les
    appelants (rank_watch, core.update_active_profile) déduisaient le compte à
    écrire de `vault.get_active()` — un simple pointeur dans state.json — sans
    jamais le confronter au compte réellement connecté au client. Quand le
    pointeur avait dérivé (connexion manuelle hors Hexgate, swap interrompu),
    le watcher écrasait silencieusement rang / niveau / icône / riot_id d'un
    compte avec ceux d'un autre, toutes les 120 s : « FREEPALESTINE#M280 » a
    ainsi perdu son historique GOLD au profit des données de « OnlyNocturne#GOAT »
    et paraissait dupliqué dans la liste. Le `puuid` fait foi (stable même après
    un changement de Riot ID) ; à défaut, on retombe sur le riot_id.
    """
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return None
    meta = atomic_io.read_json(meta_file)

    known_puuid = meta.get("puuid")
    if puuid and known_puuid:
        # puuid des deux côtés : verdict sans ambiguïté, un riot_id différent
        # n'est alors qu'un renommage Riot légitime.
        if puuid != known_puuid:
            applog.get_logger().warning(
                "coffre: écriture de profil REFUSÉE sur %s — puuid %s ≠ %s (données d'un autre compte)",
                name, puuid, known_puuid,
            )
            return None
    else:
        # Comptes créés avant l'enregistrement du puuid : le riot_id est le seul
        # discriminant. On refuse en cas d'écart — un renommage Riot non pris en
        # compte (corrigé au prochain swap) coûte infiniment moins cher qu'un
        # écrasement de compte.
        known_riot_id = meta.get("riot_id")
        if riot_id and known_riot_id and riot_id != known_riot_id:
            applog.get_logger().warning(
                "coffre: écriture de profil REFUSÉE sur %s — riot_id %s ≠ %s (données d'un autre compte)",
                name, riot_id, known_riot_id,
            )
            return None

    if puuid and not known_puuid:
        meta["puuid"] = puuid

    # variation de LP SoloQ depuis le dernier rank connu
    computed_delta = None
    if rank is not None and track_lp_delta:
        old_ladder = _ladder_lp(meta.get("rank"))
        new_ladder = _ladder_lp(rank)
        if old_ladder is not None and new_ladder is not None and old_ladder != new_ladder:
            computed_delta = new_ladder - old_ladder
            meta["lp_delta"] = computed_delta

    for key, value in (("riot_id", riot_id), ("level", level), ("rank", rank),
                       ("icon_id", icon_id), ("wallet", wallet)):
        if value is not None:
            meta[key] = value

    if rank is not None and rank.get("solo"):
        _append_history_point(meta, rank["solo"])

    atomic_io.write_json(meta_file, meta, indent=2)
    return computed_delta


_MAX_HISTORY_POINTS = 300


def _append_history_point(meta: dict, solo: dict) -> None:
    """Ajoute un point d'historique SoloQ (ts, tier/division/lp, W/D), dédupliqué
    avec le dernier point si rien n'a changé. Historique propre à l'app — accumule
    depuis l'installation, ce n'est pas l'historique de saison complet de Riot."""
    history = meta.setdefault("rank_history", [])
    point = {
        "ts": time.time(),
        "tier": solo.get("tier"),
        "division": solo.get("division"),
        "lp": solo.get("lp", 0),
        "wins": solo.get("wins", 0),
        "losses": solo.get("losses", 0),
    }
    if history:
        last = history[-1]
        if (last.get("tier"), last.get("division"), last.get("lp"),
                last.get("wins"), last.get("losses")) == (
                point["tier"], point["division"], point["lp"], point["wins"], point["losses"]):
            return  # rien de changé depuis le dernier point : pas de doublon
    history.append(point)
    del history[:-_MAX_HISTORY_POINTS]


@_serialized_write
def merge_rank_history(name: str, points: list[dict]) -> int:
    """Fusionne des points d'historique (ex. backfillés depuis la Riot API) avec
    l'historique local existant : combine, trie par ts, déduplique les points
    consécutifs identiques, cap à _MAX_HISTORY_POINTS. Retourne le nombre total
    de points après fusion, ou -1 si le compte est introuvable."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return -1
    meta = atomic_io.read_json(meta_file)
    combined = (meta.get("rank_history") or []) + list(points)
    combined.sort(key=lambda p: p.get("ts", 0))
    deduped: list[dict] = []
    for p in combined:
        if deduped:
            last = deduped[-1]
            same = (last.get("tier"), last.get("division"), last.get("lp"),
                    last.get("wins"), last.get("losses")) == (
                    p.get("tier"), p.get("division"), p.get("lp"),
                    p.get("wins"), p.get("losses"))
            if same:
                continue
        deduped.append(p)
    deduped = deduped[-_MAX_HISTORY_POINTS:]
    meta["rank_history"] = deduped
    atomic_io.write_json(meta_file, meta, indent=2)
    return len(deduped)


def rank_history(name: str) -> list[dict]:
    """Historique SoloQ (ts, tier, division, lp, wins, losses) accumulé par l'app."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return []
    meta = atomic_io.read_json(meta_file)
    return meta.get("rank_history", [])


def riot_last_sync(name: str) -> float | None:
    """Timestamp du dernier sync réussi avec la Riot API pour ce compte (cache),
    ou None si jamais synchronisé — sert au throttle du rafraîchissement manuel
    et à déclencher le sync automatique une seule fois, à l'ajout du compte."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return None
    meta = atomic_io.read_json(meta_file)
    return meta.get("riot_last_sync")


@_serialized_write
def set_riot_last_sync(name: str, ts: float) -> None:
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return
    meta = atomic_io.read_json(meta_file)
    meta["riot_last_sync"] = ts
    atomic_io.write_json(meta_file, meta, indent=2)


@_serialized_write
def mark_expired(name: str) -> None:
    """Marque la sauvegarde comme rejetée par Riot (visible dans la liste)."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return
    meta = atomic_io.read_json(meta_file)
    meta["expired"] = True
    atomic_io.write_json(meta_file, meta, indent=2)


@_serialized_write
def clear_live_session() -> None:
    """Efface les fichiers de session actifs (le client affichera la page de login)."""
    for p in paths.SESSION_FILES.values():
        p.unlink(missing_ok=True)


@_serialized_write
def account_puuid(name: str) -> str | None:
    """puuid enregistré pour un compte, ou None s'il n'a pas encore été observé."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return None
    try:
        return atomic_io.read_json(meta_file).get("puuid")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def refresh_active(expected_identity: dict | None = None) -> str | None:
    """Re-sauvegarde la session live dans le compte actif, si elle est encore valide.

    À appeler processus Riot arrêtés, avant d'écraser les fichiers live.
    Retourne le nom re-sauvegardé, ou None si rien à faire.

    `expected_identity` ({'puuid', 'riot_id'}, relevé AVANT l'arrêt du client)
    est confronté au compte actif : sans ce contrôle, un pointeur qui a dérivé
    faisait recopier la session live — donc les IDENTIFIANTS d'un autre compte —
    par-dessus ceux du compte actif, de façon irréversible. C'est le sens exact
    de « un compte s'est dupliqué et a écrasé l'autre » (incident du 14/09/2026).
    """
    active = get_active()
    if not active or not (paths.ACCOUNTS_DIR / active / "meta.json").is_file():
        return None

    if expected_identity:
        known_puuid = account_puuid(active)
        meta = atomic_io.read_json(_meta_path(paths.ACCOUNTS_DIR / _safe_name(active)))
        known_riot_id = meta.get("riot_id")
        if known_puuid:
            matches = expected_identity.get("puuid") == known_puuid
        elif known_riot_id and expected_identity.get("riot_id"):
            matches = expected_identity["riot_id"] == known_riot_id
        else:
            matches = True  # aucune référence fiable : on ne bloque pas
        if not matches:
            applog.get_logger().warning(
                "coffre: re-sauvegarde REFUSÉE sur %s — session live de %s (identifiants d'un autre compte)",
                active, expected_identity.get("riot_id") or expected_identity.get("puuid"),
            )
            return None

    try:
        capture(active, refresh=True)
    except (ValueError, FileNotFoundError):
        return None  # session live absente ou non persistante : on garde l'ancienne copie
    return active


def _write_meta(account: Account) -> None:
    """Écrit les champs du dataclass Account dans meta.json, en fusionnant avec le
    contenu existant plutôt qu'en l'écrasant : préserve les clés gérées hors du
    dataclass (rank_history, riot_last_sync, …) écrites par d'autres fonctions."""
    meta_file = _meta_path(account.dir)
    meta = {}
    if meta_file.is_file():
        try:
            meta = atomic_io.read_json(meta_file)
        except json.JSONDecodeError:
            meta = {}
    meta.update({
        "name": account.name,
        "region": account.region,
        "saved_at": account.saved_at,
        "last_used": account.last_used,
        "expired": account.expired,
        "riot_id": account.riot_id,
        "level": account.level,
        "rank": account.rank,
        "icon_id": account.icon_id,
        "lp_delta": account.lp_delta,
        "note": account.note,
        "pinned": account.pinned,
        "goal": account.goal,
        "post_swap": account.post_swap,
        "champ_select": account.champ_select,
        "position_prefs": account.position_prefs,
        "wallet": account.wallet,
        "valorant": account.valorant,
    })
    atomic_io.write_json(meta_file, meta, indent=2)


def daily_recap(name: str) -> dict | None:
    points = rank_history(name)
    if not points:
        return None
    
    # local midnight
    lt = time.localtime()
    midnight_ts = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    
    today_points = [p for p in points if p.get("ts", 0) >= midnight_ts]
    if not today_points:
        return None
    
    before_points = [p for p in points if p.get("ts", 0) < midnight_ts]
    ref_point = before_points[-1] if before_points else today_points[0]
    latest_point = today_points[-1]
    
    wins = max(0, latest_point.get("wins", 0) - ref_point.get("wins", 0))
    losses = max(0, latest_point.get("losses", 0) - ref_point.get("losses", 0))
    
    ref_lp = _ladder_lp_solo(ref_point)
    latest_lp = _ladder_lp_solo(latest_point)
    lp_delta = (latest_lp - ref_lp) if (ref_lp is not None and latest_lp is not None) else 0
    
    return {
        "wins": wins,
        "losses": losses,
        "lp_delta": lp_delta
    }


@_serialized_write
def set_goal(name: str, tier: str | None, division: str | None) -> None:
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    if tier is None:
        meta["goal"] = None
    else:
        current_rank = meta.get("rank")
        start_lp = _ladder_lp(current_rank) or 0
        meta["goal"] = {
            "tier": tier,
            "division": division,
            "start_lp": start_lp
        }
    atomic_io.write_json(meta_file, meta, indent=2)


@_serialized_write
def set_post_swap(name: str, queue_id: int | None, auto_join: bool) -> None:
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    meta["post_swap"] = {
        "queue_id": queue_id,
        "auto_join": auto_join
    }
    atomic_io.write_json(meta_file, meta, indent=2)


DEFAULT_CHAMP_SELECT = {
    "auto_declare_intent": False,
    "auto_pick": False,
    "auto_ban": False,
    "priority_by_role": {"TOP": [], "JUNGLE": [], "MIDDLE": [], "BOTTOM": [], "UTILITY": [], "ANY": []},
    "ban_priority": [],
    "chat_message_enabled": False,
    "chat_message": "",
}


@_serialized_write
def set_champ_select(name: str, prefs: dict) -> None:
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    merged = {**DEFAULT_CHAMP_SELECT, **(meta.get("champ_select") or {}), **prefs}
    meta["champ_select"] = merged
    atomic_io.write_json(meta_file, meta, indent=2)


@_serialized_write
def save_identity(name: str, identity: dict) -> None:
    """Sauvegarde l'identité de profil League d'un compte.

    `identity` est stockée sous sa forme ÉCRITURE (bannerAccent, crestBorder,
    challengeIds, prestigeCrestBorderLevel, title) pour être rejouable telle
    quelle par `lcu_api.apply_identity` — voir le piège des noms décrit dans
    `lcu_api._identity_payload`. Aucun secret n'est concerné : ce sont des
    identifiants cosmétiques publics.
    """
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    meta["identity"] = identity
    atomic_io.write_json(meta_file, meta, indent=2)


def get_identity(name: str) -> dict | None:
    """Identité de profil League sauvegardée pour ce compte, ou None."""
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        return None
    saved = atomic_io.read_json(meta_file).get("identity")
    return saved if isinstance(saved, dict) else None


def settings_presets_dir() -> Path:
    """Dossier des presets de réglages/raccourcis, partagés par tous les comptes.

    Distinct des sauvegardes par compte (`game_settings.json`) : un preset est
    une configuration NOMMÉE et réutilisable, qu'on applique à qui on veut.
    """
    return paths.STORAGE_DIR / "settings_presets"


def _preset_path(name: str) -> Path:
    return settings_presets_dir() / f"{_safe_name(name)}.json"


def list_settings_presets() -> list[dict]:
    """Presets disponibles : [{name, game_sections, input_sections, saved_at}]."""
    dossier = settings_presets_dir()
    if not dossier.is_dir():
        return []
    presets = []
    for fichier in sorted(dossier.glob("*.json")):
        try:
            data = atomic_io.read_json(fichier)
        except Exception:
            continue  # preset illisible : ignoré, jamais bloquant
        if not isinstance(data, dict):
            continue
        presets.append({
            "name": data.get("name") or fichier.stem,
            "game_sections": len(data.get("game") or {}),
            "input_sections": len(data.get("input") or {}),
            "saved_at": data.get("saved_at"),
        })
    return presets


@_serialized_write
def save_settings_preset(name: str, game: dict | None, inputs: dict | None) -> None:
    """Enregistre un preset nommé. Écrase un preset du même nom."""
    if not name.strip():
        raise ValueError("nom de preset vide")
    dossier = settings_presets_dir()
    dossier.mkdir(parents=True, exist_ok=True)
    atomic_io.write_json(_preset_path(name), {
        "name": name,
        "game": game or {},
        "input": inputs or {},
        "saved_at": time.time(),
    }, indent=2)


def get_settings_preset(name: str) -> dict | None:
    """{'name', 'game', 'input', 'saved_at'} ou None si le preset n'existe pas."""
    fichier = _preset_path(name)
    if not fichier.is_file():
        return None
    try:
        data = atomic_io.read_json(fichier)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


@_serialized_write
def delete_settings_preset(name: str) -> bool:
    fichier = _preset_path(name)
    if not fichier.is_file():
        return False
    fichier.unlink()
    return True


def game_settings_backup_path(name: str) -> Path:
    return paths.ACCOUNTS_DIR / _safe_name(name) / "game_settings.json"


@_serialized_write
def save_game_settings_backup(name: str, data: dict) -> None:
    p = game_settings_backup_path(name)
    if not p.parent.is_dir():
        return
    atomic_io.write_json(p, data, indent=2)


def get_game_settings_backup(name: str) -> dict | None:
    p = game_settings_backup_path(name)
    if not p.is_file():
        return None
    try:
        return atomic_io.read_json(p)
    except Exception:
        return None


@_serialized_write
def set_position_prefs(name: str, first: str | None, second: str | None) -> None:
    meta_file = _meta_path(paths.ACCOUNTS_DIR / _safe_name(name))
    if not meta_file.is_file():
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    meta = atomic_io.read_json(meta_file)
    meta["position_prefs"] = {"first": first, "second": second} if (first or second) else None
    atomic_io.write_json(meta_file, meta, indent=2)


def get_matches_path(name: str) -> Path:
    return paths.ACCOUNTS_DIR / _safe_name(name) / "matches.json"


def get_matches(name: str) -> list[dict]:
    p = get_matches_path(name)
    if not p.is_file():
        return []
    try:
        return atomic_io.read_json(p)
    except Exception:
        return []


@_serialized_write
def merge_matches(name: str, new_items: list[dict]) -> int:
    p = get_matches_path(name)
    existing = get_matches(name)
    combined = {m["match_id"]: m for m in existing}
    for m in new_items:
        combined[m["match_id"]] = m
    sorted_matches = sorted(combined.values(), key=lambda m: m.get("ts", 0), reverse=True)
    sorted_matches = sorted_matches[:100]
    atomic_io.write_json(p, sorted_matches, indent=2)
    return len(sorted_matches)


def champion_stats(name: str) -> list[dict]:
    matches = get_matches(name)
    if not matches:
        return []
    stats = {}
    for m in matches:
        champ = m.get("champion")
        if not champ:
            continue
        if champ not in stats:
            stats[champ] = {"champion": champ, "games": 0, "wins": 0, "kills": 0, "deaths": 0, "assists": 0}
        s = stats[champ]
        s["games"] += 1
        if m.get("win"):
            s["wins"] += 1
        s["kills"] += m.get("kills", 0)
        s["deaths"] += m.get("deaths", 0)
        s["assists"] += m.get("assists", 0)
    
    out = []
    for champ, s in stats.items():
        games = s["games"]
        wins = s["wins"]
        winrate = round((wins / games) * 100)
        deaths = s["deaths"]
        kda = round((s["kills"] + s["assists"]) / (deaths if deaths > 0 else 1), 2)
        out.append({
            "champion": champ,
            "games": games,
            "wins": wins,
            "winrate": winrate,
            "kda_avg": kda
        })
    out.sort(key=lambda x: (x["games"], x["winrate"]), reverse=True)
    return out[:8]


def most_played_champ(name: str) -> str | None:
    stats = champion_stats(name)
    if stats:
        return stats[0]["champion"]
    return None
