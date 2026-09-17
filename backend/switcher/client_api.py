"""API REST locale du client Riot (authentification via le lockfile)."""
import base64
import json
import ssl
import urllib.error
import urllib.request

from . import paths

LOCKFILE = paths.RIOT_DATA_DIR / "Riot Client" / "Config" / "lockfile"
_CTX = ssl._create_unverified_context()  # certificat auto-signé local


class ClientNotRunning(Exception):
    """Le client Riot ne répond pas (pas démarré, ou lockfile périmé)."""


def _call(method: str, path: str, timeout: float = 5) -> tuple[int, str]:
    try:
        parts = LOCKFILE.read_text(encoding="utf-8").split(":")
        port, password = parts[2], parts[3]
    except (OSError, IndexError) as e:
        raise ClientNotRunning("lockfile absent ou invalide") from e
    auth = base64.b64encode(f"riot:{password}".encode()).decode()
    req = urllib.request.Request(
        f"https://127.0.0.1:{port}{path}", method=method,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, context=_CTX, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except OSError as e:
        raise ClientNotRunning(str(e)) from e


def phase() -> str | None:
    """Phase du client : 'Login', 'Patching', 'WaitForSessionExit', etc."""
    status, body = _call("GET", "/rnet-lifecycle/v1/product-context-phase")
    if status != 200:
        return None
    return json.loads(body)


def is_logged_in() -> bool:
    """Vrai si une session Riot est active (autorisation RSO acceptée)."""
    status, _ = _call("GET", "/rso-auth/v1/authorization")
    return status == 200


def current_identity() -> dict | None:
    """Identité réellement connectée : {'puuid': ..., 'riot_id': 'Nom#TAG'}.

    Disponible pour les DEUX produits dès que la session RSO est acceptée, sans
    dépendre du LCU (spécifique à League, et indisponible avant que son client
    soit chargé). `subject` est le puuid, stable même après un renommage Riot.
    Retourne None si la session n'est pas encore établie.
    """
    status, body = _call("GET", "/rso-auth/v1/authorization")
    if status != 200:
        return None
    puuid = json.loads(body).get("subject")
    if not puuid:
        return None
    riot_id = None
    status, body = _call("GET", "/player-account/aliases/v1/active")
    if status == 200:
        alias = json.loads(body)
        game_name, tag = alias.get("game_name"), alias.get("tag_line")
        if game_name:
            riot_id = f"{game_name}#{tag}" if tag else game_name
    return {"puuid": puuid, "riot_id": riot_id}


def launch_product(product: str) -> bool:
    """Demande le lancement d'un produit Riot live via le launcher local."""
    if product not in {"league_of_legends", "valorant"}:
        raise ValueError("produit Riot inconnu")
    status, _ = _call(
        "POST", f"/product-launcher/v1/products/{product}/patchlines/live",
        timeout=15,
    )
    return status in (200, 201, 202, 204, 423)  # 423 = already_launched


def launch_league() -> bool:
    """Compatibilité League des appelants existants."""
    return launch_product("league_of_legends")
