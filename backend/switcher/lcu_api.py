"""API locale du client League of Legends (LCU) : profil, rank, ready-check."""
import base64
import json
import os
import random
import socket
import ssl
import struct
import time
import unicodedata
import urllib.error
import urllib.request

from . import paths

_CTX = ssl._create_unverified_context()


_creds_cache: tuple[int, str] | None = None


def _lockfile_creds() -> tuple[int, str]:
    """(port, password) du lockfile LCU du client League. Lève LeagueNotRunning.

    Mis en cache : avant, CHAQUE appel LCU relisait RiotClientInstalls.json puis
    le lockfile (2 lectures disque + parse JSON) — des milliers de fois par heure
    avec les watchers. Le cache est invalidé par `_invalidate_creds()` dès qu'une
    connexion échoue (client relancé = nouveau port) : une seule erreur transitoire
    puis relecture, comportement identique à un client fermé."""
    global _creds_cache
    if _creds_cache is not None:
        return _creds_cache
    install = paths.league_install_dir()
    if install is None:
        raise LeagueNotRunning("installation LoL introuvable")
    try:
        parts = (install / "lockfile").read_text(encoding="utf-8").split(":")
        _creds_cache = (int(parts[2]), parts[3])
        return _creds_cache
    except (OSError, IndexError, ValueError) as e:
        raise LeagueNotRunning("lockfile LCU absent") from e


def _invalidate_creds() -> None:
    global _creds_cache
    _creds_cache = None


class EventSocket:
    """Client WebSocket minimal (stdlib) pour le flux d'événements PUSH du LCU.

    Le client League expose un WebSocket WAMP sur le même port/creds que l'API
    REST : on s'y abonne (`[5, "OnJsonApiEvent_..."]`) et le client POUSSE chaque
    changement instantanément — zéro latence de polling. Utilisé pour détecter le
    passage lobby / file / sélection / partie en temps réel.

    Points délicats gérés : les octets d'un premier frame peuvent arriver collés à
    la réponse de handshake (ne pas les jeter), frames serveur non masqués, frames
    client obligatoirement masqués, ping -> pong.
    """

    def __init__(self, timeout: float = 5):
        port, password = _lockfile_creds()
        try:
            raw = socket.create_connection(("127.0.0.1", port), timeout=timeout)
        except OSError as e:
            _invalidate_creds()  # client fermé ou relancé sur un autre port
            raise LeagueNotRunning(str(e)) from e
        self.sock = _CTX.wrap_socket(raw, server_hostname="127.0.0.1")
        key = base64.b64encode(os.urandom(16)).decode()
        auth = base64.b64encode(f"riot:{password}".encode()).decode()
        self.sock.sendall(
            (
                "GET / HTTP/1.1\r\n"
                f"Host: 127.0.0.1:{port}\r\n"
                f"Authorization: Basic {auth}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise LeagueNotRunning("handshake WS échoué")
            resp += chunk
        head, _, leftover = resp.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise LeagueNotRunning("handshake WS refusé")
        # Des octets du premier frame peuvent déjà être présents après les en-têtes.
        self._buf = bytearray(leftover)
        # IMPORTANT : le timeout de connexion ne doit PAS s'appliquer à l'écoute —
        # sinon recv() expire à chaque période de silence (aucun event pendant 5 s)
        # et la boucle se reconnecte en permanence au lieu d'écouter en continu.
        self.sock.settimeout(None)

    def _fill(self, n: int):
        while len(self._buf) < n:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WS fermé")
            self._buf.extend(chunk)

    def _send(self, opcode: int, payload: bytes = b""):
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        mask = os.urandom(4)
        header += mask
        header += bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header))

    def subscribe(self, event_name: str):
        self._send(0x1, json.dumps([5, event_name]).encode("utf-8"))

    def _recv_frame(self) -> tuple[int, bytes]:
        self._fill(2)
        b1 = self._buf[1]
        opcode = self._buf[0] & 0x0F
        masked = b1 & 0x80
        length = b1 & 0x7F
        idx = 2
        if length == 126:
            self._fill(4)
            length = struct.unpack(">H", bytes(self._buf[2:4]))[0]
            idx = 4
        elif length == 127:
            self._fill(10)
            length = struct.unpack(">Q", bytes(self._buf[2:10]))[0]
            idx = 10
        mask = b""
        if masked:
            self._fill(idx + 4)
            mask = bytes(self._buf[idx:idx + 4])
            idx += 4
        self._fill(idx + length)
        data = bytes(self._buf[idx:idx + length])
        del self._buf[:idx + length]
        if masked:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        return opcode, data

    def events(self):
        """Génère (uri, eventType, data) pour chaque événement JSON API poussé."""
        while True:
            opcode, data = self._recv_frame()
            if opcode == 0x8:  # close
                return
            if opcode == 0x9:  # ping -> pong
                self._send(0xA, data)
                continue
            if opcode in (0x1, 0x2) and data:
                try:
                    msg = json.loads(data)
                except ValueError:
                    continue
                if isinstance(msg, list) and len(msg) >= 3 and msg[0] == 8:
                    payload = msg[2] or {}
                    yield payload.get("uri"), payload.get("eventType"), payload.get("data")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class LeagueNotRunning(Exception):
    """Le client LoL ne répond pas."""


def _call(method: str, path: str, body: dict | None = None, timeout: float = 5) -> tuple[int, str]:
    port, password = _lockfile_creds()
    auth = base64.b64encode(f"riot:{password}".encode()).decode()
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"https://127.0.0.1:{port}{path}", data=data, method=method,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, context=_CTX, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except OSError as e:
        # Connexion refusée/reset : client fermé OU relancé sur un autre port —
        # dans les deux cas les créds cachées ne valent plus rien.
        _invalidate_creds()
        raise LeagueNotRunning(str(e)) from e


def is_ready() -> bool:
    """True si le LCU répond réellement.

    Sonde de disponibilité : contrairement à gameflow_phase(), qui absorbe
    LeagueNotRunning et renvoie 'None' (indiscernable d'un client fermé au
    repos), celle-ci distingue « client absent » de « client à l'accueil ».
    """
    try:
        _call("GET", "/lol-gameflow/v1/gameflow-phase")
        return True
    except LeagueNotRunning:
        return False


def current_summoner() -> dict | None:
    """{'riot_id': 'Nom#TAG', 'level': 231} ou None si pas encore chargé."""
    status, body = _call("GET", "/lol-summoner/v1/current-summoner")
    if status != 200:
        return None
    d = json.loads(body)
    game_name, tag = d.get("gameName"), d.get("tagLine")
    if not game_name:
        return None
    return {"riot_id": f"{game_name}#{tag}" if tag else game_name,
            "level": d.get("summonerLevel"),
            "icon_id": d.get("profileIconId"),
            # Identifiant stable du compte, insensible au renommage Riot :
            # sert de garde-fou à vault.update_profile() pour ne jamais écrire
            # les données d'un compte dans la fiche d'un autre.
            "puuid": d.get("puuid")}


def ranked_stats() -> dict:
    """{'solo': {tier, division, lp, wins, losses}, 'flex': {...}} (clés absentes si unranked)."""
    status, body = _call("GET", "/lol-ranked/v1/current-ranked-stats")
    if status != 200:
        return {}
    queues = (json.loads(body).get("queueMap") or {})
    out = {}
    for key, label in (("RANKED_SOLO_5x5", "solo"), ("RANKED_FLEX_SR", "flex")):
        q = queues.get(key) or {}
        tier = q.get("tier")
        if tier and tier not in ("", "NONE", "UNRANKED"):
            out[label] = {
                "tier": tier,
                "division": q.get("division"),
                "lp": q.get("leaguePoints", 0),
                "wins": q.get("wins", 0),
                "losses": q.get("losses", 0),
            }
    return out


def ready_check_state() -> str | None:
    """'InProgress' quand la file a pop, None sinon."""
    status, body = _call("GET", "/lol-matchmaking/v1/ready-check")
    if status != 200:
        return None
    return json.loads(body).get("state")


def accept_ready_check() -> None:
    _call("POST", "/lol-matchmaking/v1/ready-check/accept")


def queue_penalty() -> dict | None:
    """Pénalité de file restreinte en cours (dodge) sur le compte connecté.

    {'seconds_remaining': float, 'reason': str|None} si une pénalité est active,
    None sinon (aucune pénalité, ou champ absent/inattendu de l'API LCU).
    """
    status, body = _call("GET", "/lol-matchmaking/v1/search")
    if status != 200:
        return None
    try:
        low_prio = json.loads(body).get("lowPriorityData") or {}
        remaining = float(low_prio.get("penaltyTimeRemaining") or 0)
    except (ValueError, TypeError, AttributeError):
        return None
    if remaining <= 0:
        return None
    return {"seconds_remaining": remaining, "reason": low_prio.get("reason")}


def create_lobby(queue_id: int) -> bool:
    """Crée un lobby LCU pour la file d'attente spécifiée."""
    _call("DELETE", "/lol-lobby/v2/lobby")  # Supprime un éventuel lobby existant pour éviter les conflits
    status, _ = _call("POST", "/lol-lobby/v2/lobby", body={"queueId": queue_id})
    return status in (200, 201)


def start_matchmaking() -> bool:
    """Démarre la recherche de matchmaking pour le lobby actuel."""
    status, _ = _call("POST", "/lol-lobby/v2/lobby/matchmaking/search")
    return status in (200, 204)


def gameflow_phase() -> str:
    """Retourne la phase de jeu actuelle ('None', 'ChampSelect', 'InProgress', etc.)."""
    try:
        status, body = _call("GET", "/lol-gameflow/v1/gameflow-phase")
        if status == 200:
            return json.loads(body)
    except LeagueNotRunning:
        pass
    return "None"


def game_start_time() -> float | None:
    """Récupère l'heure de début exacte de la partie en cours (epoch timestamp)."""
    try:
        status, body = _call("GET", "/lol-gameflow/v1/session")
        if status == 200:
            session_data = json.loads(body)
            gst = session_data.get("gameData", {}).get("gameStartTime")
            if gst:
                return float(gst) / 1000.0
    except Exception:
        pass
    return None


def get_friends() -> list:
    """Récupère la liste d'amis connectés sur le LCU."""
    status, body = _call("GET", "/lol-chat/v1/friends")
    if status != 200:
        return []
    return json.loads(body)


def send_friend_message(friend_jid: str, text: str) -> bool:
    """Envoie un message de discussion privée à un ami LCU."""
    status, _ = _call("POST", f"/lol-chat/v1/conversations/{friend_jid}/messages", body={"body": text})
    return status in (200, 201)


def _clean_match_id(match_id: str) -> str:
    if "_" in match_id:
        return match_id.split("_", 1)[1]
    return match_id


def download_replay(match_id: str) -> bool:
    """Lance le téléchargement du replay LCU pour le match ID donné."""
    mid = _clean_match_id(match_id)
    status, _ = _call("POST", f"/lol-replays/v1/rofls/{mid}/download")
    return status in (200, 204)


def get_replay_state(match_id: str) -> str:
    """Retourne l'état du replay LCU ('checking', 'downloading', 'downloaded', 'failed')."""
    mid = _clean_match_id(match_id)
    status, body = _call("GET", f"/lol-replays/v1/rofls/{mid}/state")
    if status != 200:
        return "failed"
    try:
        return json.loads(body)
    except Exception:
        return "failed"


def set_presence(status_message: str, availability: str) -> bool:
    """Met à jour le message de profil et la disponibilité LCU."""
    payload = {"statusMessage": status_message, "availability": availability}
    status, _ = _call("PUT", "/lol-chat/v1/me", payload)
    return status in (200, 201, 204)


def create_practice_lobby() -> bool:
    """Crée un lobby d'entraînement dans le client LoL (quitte le salon précédent si existant)."""
    try:
        _call("DELETE", "/lol-lobby/v2/lobby")
    except Exception:
        pass
    payload = {
        "queueId": 3140,
        "isCustom": True,
        "customGameLobby": {}
    }
    status, _ = _call("POST", "/lol-lobby/v2/lobby", payload)
    return status in (200, 201, 204)


def close_league_client():
    """Demande la fermeture propre du client League of Legends."""
    try:
        _call("POST", "/process-control/v1/process/quit")
    except Exception:
        import subprocess
        subprocess.run("taskkill /F /IM LeagueClient.exe /IM LeagueClientUx.exe /IM LeagueClientUxRender.exe", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def get_lobby_chat_messages() -> list:
    """Récupère l'historique des discussions du salon de sélection LCU."""
    status, body = _call("GET", "/lol-chat/v1/conversations")
    if status != 200:
        return []
    try:
        conversations = json.loads(body)
        chat = next((c for c in conversations if c.get("type") == "championSelect"), None)
        if not chat:
            return []
        cid = chat["id"]
        status_msg, body_msg = _call("GET", f"/lol-chat/v1/conversations/{cid}/messages")
        if status_msg != 200:
            return []
        return json.loads(body_msg)
    except Exception:
        return []


def spectate_friend(puuid: str) -> bool:
    """Lance le mode spectateur LCU sur un ami en jeu."""
    status, _ = _call("POST", "/lol-spectator/v1/spectate/launch", {"puuid": puuid})
    return status in (200, 201, 204)


def get_received_invitations() -> list:
    """Récupère les invitations de lobby reçues."""
    status, body = _call("GET", "/lol-lobby/v2/received-invitations")
    if status == 200:
        return json.loads(body)
    return []


def accept_lobby_invitation(invitation_id: str) -> bool:
    """Accepte une invitation de lobby spécifique."""
    status, _ = _call("POST", f"/lol-lobby/v2/received-invitations/{invitation_id}/accept")
    return status in (200, 201, 204)


def swap_bench_champion(champion_id: int) -> bool:
    """Échange le champion actif contre un champion sur le banc ARAM."""
    status, _ = _call("POST", f"/lol-champ-select/v1/session/bench/swap/{champion_id}")
    return status in (200, 201, 204)


def open_hextech_chests() -> int:
    """Ouvre tous les coffres Hextech disponibles si on a assez de clés."""
    status, body = _call("GET", "/lol-loot/v1/player-loot")
    if status != 200:
        return 0
    try:
        loot = json.loads(body)
    except Exception:
        return 0
    
    chests = 0
    keys = 0
    for item in loot:
        l_id = item.get("lootId", "")
        count = item.get("count", 0)
        if l_id == "CHEST_generic":
            chests = count
        elif l_id == "MATERIAL_key":
            keys = count
    
    to_open = min(chests, keys)
    if to_open <= 0:
        return 0
    
    recipe = "CHEST_generic_OPEN"
    craft_payload = ["CHEST_generic", "MATERIAL_key"]
    craft_status, _ = _call("POST", f"/lol-loot/v1/recipes/{recipe}/craft?repeat={to_open}", craft_payload)
    if craft_status in (200, 201, 204):
        return to_open
    return 0


def wallet() -> dict | None:
    """Solde de la monnaie du compte connecté : {'blue_essence': int, 'rp': int}.

    L'endpoint générique /lol-inventory/v1/wallet exige un paramètre
    currencyTypes que le client LCU ne fournit qu'en interne (400 RPC_ERROR
    sans lui) ; la route par devise /lol-inventory/v1/wallet/{currency} est
    celle réellement utilisable depuis l'extérieur.
    """
    be_status, be_body = _call("GET", "/lol-inventory/v1/wallet/lol_blue_essence")
    rp_status, rp_body = _call("GET", "/lol-inventory/v1/wallet/RP")
    if be_status != 200 or rp_status != 200:
        return None
    try:
        be = json.loads(be_body)
        rp = json.loads(rp_body)
    except Exception:
        return None
    return {
        "blue_essence": int(be.get("lol_blue_essence") or 0),
        "rp": int(rp.get("RP") or 0),
    }


def owned_champion_ids() -> set[int]:
    """IDs des champions déjà possédés par le compte connecté."""
    status, body = _call("GET", "/lol-champions/v1/owned-champions-minimal")
    if status != 200:
        return set()
    try:
        champs = json.loads(body)
        return {c["id"] for c in champs if c.get("id") is not None}
    except Exception:
        return set()


def disenchant_champion_shards(keep_unowned: bool = True) -> int:
    """Désenchante les fragments de champions en essences bleues.

    Si keep_unowned=True (défaut), seuls les fragments de champions DÉJÀ
    possédés (doublons) sont désenchantés — les fragments donnant accès à un
    champion non possédé sont préservés. Si False, tous les fragments passent
    au désenchantement, y compris ceux qui auraient débloqué un nouveau champion.
    """
    status, body = _call("GET", "/lol-loot/v1/player-loot")
    if status != 200:
        return 0
    try:
        loot = json.loads(body)
    except Exception:
        return 0

    owned = owned_champion_ids() if keep_unowned else set()

    disenchanted_count = 0
    for item in loot:
        l_id = item.get("lootId", "")
        count = item.get("count", 0)
        item_type = item.get("type", "")
        if item_type != "CHAMPION_RENTAL" or count <= 0:
            continue
        try:
            champion_id = int(l_id.rsplit("_", 1)[-1])
        except ValueError:
            champion_id = None
        if keep_unowned and champion_id is not None and champion_id not in owned:
            continue
        c_status, _ = _call("POST", f"/lol-loot/v1/recipes/CHAMPION_disenchant/craft?repeat={count}", [l_id])
        if c_status in (200, 201, 204):
            disenchanted_count += count
    return disenchanted_count


def dismiss_end_of_game_stats() -> bool:
    """Passe l'écran de fin de partie (statistiques post-game)."""
    status, _ = _call("POST", "/lol-end-of-game/v1/state/dismiss-stats")
    return status in (200, 201, 204)


def challenge_identity() -> dict | None:
    """État brut de l'identité de profil : jetons, bannière, bordure, titre.

    None = information indisponible (client fermé, endpoint absent).
    """
    status, body = _call("GET", "/lol-challenges/v1/summary-player-data/local-player")
    if status != 200:
        return None
    try:
        data = json.loads(body)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _tokens_of(identity: dict) -> list[int]:
    raw = identity.get("selectedChallengesString")
    if not isinstance(raw, str):
        return []
    return [int(part) for part in raw.split(",") if part.strip().isdigit()]


def challenge_tokens() -> list[int] | None:
    """IDs des jetons de défis épinglés autour de l'icône de profil.

    Liste vide = aucun jeton affiché. None = information indisponible — à ne PAS
    confondre avec « aucun jeton ».
    """
    identity = challenge_identity()
    return None if identity is None else _tokens_of(identity)


def _identity_payload(identity: dict, challenge_ids: list[int]) -> dict:
    """Traduit l'identité LUE en corps de requête à ÉCRIRE.

    Deux pièges, tous deux vérifiés sur le schéma que le client publie lui-même
    (`GET /help`, type `LolChallengesChallengesPlayerPreferences`) :

    1. Les noms diffèrent entre lecture et écriture — `bannerId` s'écrit
       `bannerAccent`, `crestId` s'écrit `crestBorder`, et le titre se lit comme
       un objet mais s'écrit comme la chaîne de son `itemId`.
    2. **Aucun champ n'est optionnel.** Un champ omis n'est pas « laissé tel
       quel » : il est réécrit à vide. Envoyer seulement `challengeIds` efface
       donc bannière, bordure, niveau de prestige ET titre — constaté en réel le
       12/09/2026. D'où la réémission systématique de l'identité complète.
    """
    title = identity.get("title")
    item_id = title.get("itemId") if isinstance(title, dict) else None
    return {
        "bannerAccent": str(identity.get("bannerId") or ""),
        "title": str(item_id) if isinstance(item_id, int) and item_id > 0 else "",
        "challengeIds": challenge_ids,
        "crestBorder": str(identity.get("crestId") or ""),
        "prestigeCrestBorderLevel": int(identity.get("prestigeCrestBorderLevel") or 0),
    }


def _blank_identity_field(payload: dict, field: str) -> None:
    """Vide UN élément dans un corps de requête déjà construit."""
    if field == "tokens":
        payload["challengeIds"] = []
    elif field == "banner":
        payload["bannerAccent"] = ""
    elif field == "crest":
        payload["crestBorder"] = ""
    elif field == "prestige":
        payload["prestigeCrestBorderLevel"] = 0
    elif field == "title":
        payload["title"] = ""


#: Éléments d'identité de profil retirables, un par option de l'interface.
IDENTITY_FIELDS = ("tokens", "banner", "crest", "prestige", "title")


def _is_set(payload: dict, field: str) -> bool:
    """L'élément porte-t-il actuellement une valeur ? (sert à ne pas annoncer
    un retrait quand il n'y avait déjà rien à retirer)."""
    if field == "tokens":
        return bool(payload.get("challengeIds"))
    if field == "prestige":
        return int(payload.get("prestigeCrestBorderLevel") or 0) != 0
    key = {"banner": "bannerAccent", "crest": "crestBorder", "title": "title"}[field]
    return bool(payload.get(key))


def clear_identity(fields: list[str]) -> dict:
    """Retire sélectivement des éléments de l'identité de profil League.

    `fields` parmi `IDENTITY_FIELDS`. Tout ce qui n'est PAS demandé est réémis
    à l'identique : l'endpoint remplaçant l'objet entier (voir
    `_identity_payload`), réécrire l'ensemble est la seule façon de ne toucher
    qu'une pièce à la fois.

    Renvoie {'ok', 'changed', 'cleared'}. L'état est RELU après écriture et
    comparé champ par champ à ce qui était voulu : `ok` signifie que le client
    reflète réellement la demande, pas seulement qu'il a accepté la requête.
    """
    wanted = [f for f in fields if f in IDENTITY_FIELDS]
    if not wanted:
        return {"ok": False, "changed": 0, "cleared": [], "detail": "aucun élément valide demandé"}
    identity = challenge_identity()
    if identity is None:
        return {"ok": False, "changed": 0, "cleared": [], "detail": "identité de profil illisible"}

    before = _identity_payload(identity, _tokens_of(identity))
    expected = dict(before)
    for field in wanted:
        _blank_identity_field(expected, field)
    # Ce qui portait vraiment une valeur : seul ce compte est annonçable.
    cleared = [f for f in wanted if _is_set(before, f)]

    status, body = _call(
        "POST", "/lol-challenges/v1/update-player-preferences/", body=expected
    )
    if status not in (200, 201, 204):
        return {"ok": False, "changed": 0, "cleared": [], "detail": body[:200]}

    # Le client met un instant à répercuter : relire plutôt que supposer.
    actual = before
    for attempt in range(4):
        if attempt:
            time.sleep(0.4)
        fresh = challenge_identity() or identity
        actual = _identity_payload(fresh, _tokens_of(fresh))
        if actual == expected:
            return {"ok": True, "changed": len(cleared), "cleared": cleared}
    return {"ok": False, "changed": 0, "cleared": [], "detail": "le client n'a pas répercuté le changement"}


def clear_challenge_tokens() -> dict:
    """Retire les jetons de défis affichés autour de l'icône de profil.

    Le client ne propose aucun retrait : « Personnaliser l'identité » impose de
    REMPLACER un jeton par un autre, jamais d'en enlever un. L'API locale, elle,
    accepte une liste vide.
    """
    return clear_identity(["tokens"])


def apply_identity(saved: dict) -> bool:
    """Réapplique une identité de profil sauvegardée.

    `saved` est le corps déjà normalisé produit par `_identity_payload` —
    c'est-à-dire la forme ÉCRITURE (bannerAccent/crestBorder/…), pas la forme
    lecture. Voir `clear_identity` pour le piège des noms.
    """
    attendu = {
        "bannerAccent": str(saved.get("bannerAccent") or ""),
        "title": str(saved.get("title") or ""),
        "challengeIds": [int(c) for c in (saved.get("challengeIds") or [])],
        "crestBorder": str(saved.get("crestBorder") or ""),
        "prestigeCrestBorderLevel": int(saved.get("prestigeCrestBorderLevel") or 0),
    }
    status, _ = _call("POST", "/lol-challenges/v1/update-player-preferences/", body=attendu)
    return status in (200, 201, 204)


def saved_identity() -> dict | None:
    """Identité courante sous forme ÉCRITURE, prête à être stockée puis rejouée."""
    identity = challenge_identity()
    if identity is None:
        return None
    return _identity_payload(identity, _tokens_of(identity))


# --------------------------------------------------------------- apparence

def set_profile_icon(icon_id: int) -> bool:
    """Applique une icône de profil par son identifiant.

    Le client ne propose que les icônes possédées ; l'API locale en accepte
    n'importe laquelle, y compris celles jamais distribuées. C'est une
    préférence poussée, PAS un déblocage : Riot peut la réinitialiser côté
    serveur, et rien ne garantit qu'elle reste visible par les autres joueurs.
    """
    status, _ = _call(
        "PUT", "/lol-summoner/v1/current-summoner/icon",
        body={"profileIconId": int(icon_id)},
    )
    return status in (200, 201, 204)


def set_profile_background(skin_id: int) -> bool:
    """Met un skin en fond de profil, possédé ou non.

    Contrairement aux préférences de défis, cet endpoint prend un couple
    clé/valeur (`LolSummonerSummonerProfileUpdate`) : il ne touche QUE la clé
    envoyée. Aucune réémission du reste n'est nécessaire ici.
    """
    status, _ = _call(
        "POST", "/lol-summoner/v1/current-summoner/summoner-profile",
        body={"key": "backgroundSkinId", "value": int(skin_id)},
    )
    return status in (200, 201, 204)


# ------------------------------------------------------------ fin de partie

def honor_ballot() -> dict | None:
    """Bulletin d'honneur de fin de partie, ou None hors de cette fenêtre."""
    status, body = _call("GET", "/lol-honor-v2/v1/ballot")
    if status != 200:
        return None
    try:
        data = json.loads(body)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def honor_random_ally(honor_type: str = "HEART") -> dict | None:
    """Honore un coéquipier tiré au sort. Renvoie qui a été honoré, ou None.

    Les bots sont exclus : un vote dépensé sur un bot ne rapporte rien.
    `honor_type` n'est pas contraint par un enum côté client ; les valeurs
    connues de la communauté sont HEART, COOL et SHOTCALLER — à confirmer en
    conditions réelles avant de les exposer dans l'interface.
    """
    ballot = honor_ballot()
    if not ballot:
        return None
    allies = [p for p in (ballot.get("eligibleAllies") or []) if not p.get("botPlayer")]
    if not allies:
        return None
    pick = random.choice(allies)
    status, _ = _call("POST", "/lol-honor-v2/v1/honor-player", body={
        "summonerId": pick.get("summonerId"),
        "puuid": pick.get("puuid"),
        "honorType": honor_type,
        "gameId": ballot.get("gameId"),
    })
    if status not in (200, 201, 204):
        return None
    return {"name": pick.get("summonerName"), "champion": pick.get("championName")}


# ----------------------------------------------------- échanges champ select

#: Segment d'URL par famille d'échange. Les trois familles partagent la même
#: mécanique (`request`/`accept`/`decline`/`cancel` sur un identifiant de
#: contrat) mais pas la même route.
_SWAP_ROUTES = {
    "position": "position-swaps",
    "pick_order": "pick-order-swaps",
    "champion": "champion-swaps",
}
_SWAP_ACTIONS = ("request", "accept", "decline", "cancel")


def pending_swaps() -> list[dict]:
    """Échanges proposés par un coéquipier et en attente de réponse.

    Seul l'état `RECEIVED` est retenu : `SENT` est une demande qu'on a
    soi-même émise, `AVAILABLE` un échange simplement possible mais que
    personne n'a demandé.
    """
    session = champ_select_session()
    if not session:
        return []
    recus = []
    for kind, key in (("position", "positionSwaps"),
                      ("pick_order", "pickOrderSwaps"),
                      ("champion", "championSwaps")):
        for swap in session.get(key) or []:
            if swap.get("state") == "RECEIVED" and swap.get("id") is not None:
                recus.append({"kind": kind, "id": swap["id"], "cell_id": swap.get("cellId")})
    return recus


def respond_to_swap(kind: str, swap_id: int, action: str) -> bool:
    """Répond à un échange de position, d'ordre de pick ou de champion."""
    route = _SWAP_ROUTES.get(kind)
    if not route or action not in _SWAP_ACTIONS:
        return False
    status, _ = _call(
        "POST", f"/lol-champ-select/v1/session/{route}/{int(swap_id)}/{action}"
    )
    return status in (200, 201, 204)


def reroll_champion() -> bool:
    """Relance le champion attribué (ARAM). Échoue sans point de reroll."""
    status, _ = _call("POST", "/lol-champ-select/v1/session/my-selection/reroll")
    return status in (200, 201, 204)


def reroll_points() -> dict | None:
    """Points de reroll ARAM du compte connecté.

    Lu depuis `current-summoner`, qui porte l'objet complet (points courants,
    coût, rerolls déjà utilisés) — la route dédiée `.../rerollPoints` existe
    mais ne renvoie que le coût unitaire.
    """
    status, body = _call("GET", "/lol-summoner/v1/current-summoner")
    if status != 200:
        return None
    try:
        points = json.loads(body).get("rerollPoints")
    except Exception:
        return None
    if not isinstance(points, dict):
        return None
    return {
        "current": int(points.get("currentPoints") or 0),
        "cost": int(points.get("pointsCostToRoll") or 0),
        "used": int(points.get("numberOfRolls") or 0),
        "max": int(points.get("maxRolls") or 0),
    }


# ------------------------------------------------------------- entretien

#: Routes de purge des notifications persistantes du client. Chacune est
#: indépendante : une route absente sur un patch donné (404) ne doit pas
#: empêcher les autres de s'exécuter.
#:
#: Les trois retenues répondent 204 et purgent en masse (vérifié le 12/09/2026).
#: `POST /lol-store/v1/notifications/acknowledge` a été ÉCARTÉE : elle exige
#: l'identifiant d'UNE notification (`ARG id`, cf. /help) et renvoie donc 400
#: en purge globale — la garder ne faisait qu'ajouter un échec systématique.
_NOTIFICATION_ROUTES = (
    ("DELETE", "/lol-gameflow/v1/early-exit-notifications/eog"),
    ("DELETE", "/lol-gameflow/v1/early-exit-notifications/missions"),
    ("DELETE", "/lol-statstones/v1/vignette-notifications"),
)


def clear_client_notifications() -> int:
    """Purge les notifications accrochées du client. Renvoie le nombre de
    routes ayant réellement répondu favorablement."""
    purgees = 0
    for method, route in _NOTIFICATION_ROUTES:
        try:
            status, _ = _call(method, route)
        except LeagueNotRunning:
            raise
        except Exception:
            continue
        if status in (200, 201, 204):
            purgees += 1
    return purgees


def disenchant_wards_and_icons() -> int:
    """Désenchante tous les fragments de balises et d'icônes en essences orange."""
    status, body = _call("GET", "/lol-loot/v1/player-loot")
    if status != 200:
        return 0
    try:
        loot = json.loads(body)
    except Exception:
        return 0
    
    disenchanted_count = 0
    for item in loot:
        l_id = item.get("lootId", "")
        count = item.get("count", 0)
        item_type = item.get("type", "")
        
        recipe = None
        if item_type == "WARD_SKIN_RENTAL" and count > 0:
            recipe = "WARD_SKIN_disenchant"
        elif item_type == "SUMMONER_ICON_RENTAL" and count > 0:
            recipe = "SUMMONER_ICON_disenchant"
            
        if recipe:
            c_status, _ = _call("POST", f"/lol-loot/v1/recipes/{recipe}/craft?repeat={count}", [l_id])
            if c_status in (200, 201, 204):
                disenchanted_count += count
    return disenchanted_count


def send_lobby_welcome_message(message: str) -> bool:
    """Envoie un message de bienvenue dans le chat du lobby."""
    status, body = _call("GET", "/lol-chat/v1/conversations")
    if status != 200:
        return False
    try:
        convs = json.loads(body)
        lobby_conv = next((c for c in convs if c.get("type") == "multiUserChat" and "lobby" in c.get("id", "")), None)
        if not lobby_conv:
            lobby_conv = next((c for c in convs if c.get("type") == "multiUserChat"), None)
            
        if lobby_conv:
            conv_id = lobby_conv.get("id")
            payload = {"body": message, "type": "chat"}
            send_status, _ = _call("POST", f"/lol-chat/v1/conversations/{conv_id}/messages", payload)
            return send_status in (200, 201, 204)
    except Exception:
        pass
    return False


_champ_cache = {}

def get_champion_name_by_id(champion_id: int) -> str:
    """Traduit l'ID d'un champion LoL en son nom anglais (via LCU)."""
    if champion_id in _champ_cache:
        return _champ_cache[champion_id]
    try:
        status, body = _call("GET", f"/lol-champions/v1/champions/{champion_id}")
        if status == 200:
            name = json.loads(body).get("name", "")
            _champ_cache[champion_id] = name
            return name
    except Exception:
        pass
    return ""


_champ_catalog_by_name: dict[str, int] = {}


def _normalize_champ_name(name: str) -> str:
    """Clé de comparaison tolérante : sans accents, ni casse, ni ponctuation.

    « Kai'Sa » → kaisa, « Dr. Mundo » → drmundo, « Nunu & Willump » → nunuwillump.
    Sans ça, un nom saisi à la main dans les réglages ne correspond quasi jamais
    au libellé exact du catalogue Riot."""
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(c for c in decomposed.lower() if c.isalnum())


def get_champion_id_by_name(name: str) -> int | None:
    """Traduit un nom de champion en son ID LoL, via le catalogue statique du
    client (mis en cache après le premier appel).

    Correspondance en trois passes, de la plus stricte à la plus souple : nom
    exact normalisé, puis préfixe (« kai » → Kai'Sa), puis sous-chaîne. Les
    passes floues n'acceptent la réponse que si UN seul champion correspond —
    une saisie ambiguë ne doit jamais bannir un champion au hasard."""
    key = _normalize_champ_name(name)
    if not key:
        return None
    if not _champ_catalog_by_name:
        try:
            status, body = _call("GET", "/lol-game-data/assets/v1/champion-summary.json")
            if status == 200:
                for c in json.loads(body):
                    cname = c.get("name")
                    cid = c.get("id")
                    if cname and cid and cid > 0:
                        _champ_catalog_by_name[_normalize_champ_name(cname)] = cid
        except Exception:
            return None
    exact = _champ_catalog_by_name.get(key)
    if exact:
        return exact
    if len(key) < 3:
        return None
    for predicate in (lambda k: k.startswith(key), lambda k: key in k):
        matches = {cid for k, cid in _champ_catalog_by_name.items() if predicate(k)}
        if len(matches) == 1:
            return matches.pop()
    return None


def get_friend_requests() -> list:
    """Demandes d'amis reçues, en attente de réponse."""
    status, body = _call("GET", "/lol-chat/v1/friend-requests")
    if status != 200:
        return []
    try:
        return json.loads(body)
    except Exception:
        return []


def accept_friend_request(request_id: str) -> bool:
    status, _ = _call("PUT", f"/lol-chat/v1/friend-requests/{request_id}")
    return status in (200, 201, 204)


def decline_friend_request(request_id: str) -> bool:
    status, _ = _call("DELETE", f"/lol-chat/v1/friend-requests/{request_id}")
    return status in (200, 204)


def champ_select_session() -> dict | None:
    """Session de sélection des champions en cours, ou None si pas en champ select."""
    status, body = _call("GET", "/lol-champ-select/v1/session")
    if status != 200:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def patch_champ_select_action(action_id: int, champion_id: int, completed: bool) -> bool:
    """Modifie une action de champ select (ban/pick). completed=False = déclare
    seulement l'intention (survol visible par l'équipe, sans verrouiller)."""
    status, body = _call("PATCH", f"/lol-champ-select/v1/session/actions/{action_id}",
                          body={"championId": champion_id, "completed": completed})
    ok = status in (200, 201, 204)
    if not ok:
        print(f"[HEXGATE][champselect] PATCH action={action_id} championId={champion_id} "
              f"completed={completed} -> {status} {body[:200]}", flush=True)
    return ok


def bannable_champion_ids() -> set[int] | None:
    """Champions réellement bannissables dans la partie en cours.

    Source de vérité du client, à préférer à une disponibilité déduite des bans
    et des picks : elle exclut aussi les champions qu'aucune déduction locale ne
    peut connaître — au premier chef **les sorties récentes, interdites en
    classée pendant environ deux semaines**. Un PATCH de ban sur un champion
    absent de cette liste est accepté (204) et silencieusement ignoré, ce qui
    rend la panne indiagnosticable sans ce contrôle.

    None = liste indisponible (hors champ select, endpoint absent) ; l'appelant
    ne doit alors filtrer sur rien plutôt que de tout rejeter."""
    status, body = _call("GET", "/lol-champ-select/v1/bannable-champion-ids")
    if status != 200:
        return None
    try:
        ids = json.loads(body)
        return {int(c) for c in ids} if isinstance(ids, list) else None
    except Exception:
        return None


def send_champ_select_message(text: str) -> bool:
    """Envoie un message dans le chat de sélection des champions."""
    status, body = _call("GET", "/lol-chat/v1/conversations")
    if status != 200:
        return False
    try:
        convs = json.loads(body)
        conv = next((c for c in convs if c.get("type") == "championSelect"), None)
        if not conv:
            return False
        conv_id = conv.get("id")
        send_status, _ = _call("POST", f"/lol-chat/v1/conversations/{conv_id}/messages",
                                {"body": text, "type": "chat"})
        return send_status in (200, 201, 204)
    except Exception:
        return False


def get_game_settings() -> dict | None:
    """Réglages de jeu (vidéo, gameplay…) du compte connecté."""
    status, body = _call("GET", "/lol-game-settings/v1/game-settings")
    if status != 200:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def set_game_settings(data: dict) -> bool:
    status, _ = _call("PATCH", "/lol-game-settings/v1/game-settings", body=data)
    return status in (200, 201, 204)


def get_input_settings() -> dict | None:
    """Raccourcis clavier/souris du compte connecté."""
    status, body = _call("GET", "/lol-game-settings/v1/input-settings")
    if status != 200:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def set_input_settings(data: dict) -> bool:
    status, _ = _call("PATCH", "/lol-game-settings/v1/input-settings", body=data)
    return status in (200, 201, 204)


def set_position_preferences(first: str | None, second: str | None) -> bool:
    """Définit les rôles préférés (première/deuxième position) avant de rejoindre
    la file. Ignoré silencieusement si le lobby ne supporte pas les rôles
    (ARAM, Arena…) — Riot renvoie alors une erreur qu'on n'a pas besoin de propager."""
    if not first and not second:
        return False
    status, _ = _call("PUT", "/lol-lobby/v2/lobby/members/localMember/position-preferences",
                       body={"firstPreference": first or "UNSELECTED", "secondPreference": second or "UNSELECTED"})
    return status in (200, 201, 204)


def dodge_lobby() -> bool:
    """Quitte le lobby / dodge le champ select en cours.

    En pleine sélection des champions (partie déjà acceptée), le SEUL moyen fiable
    de dodge sur le client actuel est de FERMER le client League (les RPC internes
    type `quitV2` ne fonctionnent plus). Un dodge répété peut être sanctionné par
    Riot (pénalité de file croissante) — l'avertissement/confirmation est géré côté
    UI. Hors champ select (simple lobby / file d'attente), la sortie est inoffensive
    et se fait par suppression du lobby, sans fermer le client."""
    phase = gameflow_phase()
    print(f"[HEXGATE][dodge] phase={phase}", flush=True)
    if phase == "ChampSelect":
        close_league_client()
        print("[HEXGATE][dodge] client League fermé (dodge champ select)", flush=True)
        return True
    status, _ = _call("DELETE", "/lol-lobby/v2/lobby")
    print(f"[HEXGATE][dodge] DELETE lobby -> {status}", flush=True)
    return status in (200, 204)
