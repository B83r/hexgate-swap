"""Réparation du bug « partie bloquée au lobby » (affinité RMS perdue) — BÊTA.

Symptôme côté joueur : la file part (ou « Trouver un match » reste grisé), le
serveur met bien le joueur en recherche et trouve même une partie, mais le
client n'affiche jamais le pop « Accepter » → esquive imputée au joueur.

Cause identifiée le 19/09/2026 (corrélation de trois jours de journaux + une
réparation en direct) : après un changement de compte dans un client Riot
resté ouvert — ou une expiration de jeton en pleine session — le service de
messagerie du client Riot (RMS) efface son affinité régionale et, parfois, ne
la récupère jamais. Il reste alors connecté à l'edge de l'ANCIENNE région
(compte NA servi par `eu.edge`). League reçoit toujours ses messages sur sa
propre connexion, mais son relais interne vers ses modules passe par le client
Riot : ce relais est mort, donc l'interface ignore tout de la file.

Le contournement connu des joueurs est de fermer complètement Riot et de se
reconnecter. Ici on refait la même chose de l'intérieur, sans rien redémarrer :
on redemande une affinité, on coupe la connexion RMS, on la rouvre avec un
jeton frais, puis on recrée le lobby pour que League resynchronise son état.

⚠️ BÊTA : validé une seule fois de bout en bout (19/09/2026, file → pop →
sélection → partie complète). Tant que ce n'est pas confirmé sur plusieurs
parties, l'interface doit l'annoncer comme expérimental et ne JAMAIS être
déclenchée automatiquement.

Un swap Hexgate ne peut pas provoquer ce bug : `core.swap()` tue puis relance
le client Riot, et un démarrage à neuf obtient toujours la bonne affinité.
"""
import json

from . import applog, client_api, core, lcu_api, vault

# Région courte du compte → préfixe de l'edge RMS attendu.
# Seules les correspondances OBSERVÉES sont listées : une région absente donne
# « attendu inconnu », ce qui masque l'avertissement au lieu d'en inventer un.
_RMS_EDGE = {
    "EUW": "eu", "EUW1": "eu", "EUNE": "eu", "EUN1": "eu",
    "TR": "eu", "TR1": "eu", "RU": "eu",
    "NA": "us", "NA1": "us", "BR": "us", "BR1": "us",
    "LAN": "us", "LA1": "us", "LAS": "us", "LA2": "us",
}


def _text(status: int, body: str) -> str | None:
    """Réponse JSON réduite à une chaîne lisible (l'API renvoie parfois une
    chaîne nue, parfois un objet)."""
    if status != 200 or not body:
        return None
    try:
        value = json.loads(body)
    except ValueError:
        return body.strip().strip('"') or None
    if isinstance(value, str):
        return value or None
    if isinstance(value, dict):
        for key in ("affinity", "value", "id", "state"):
            if isinstance(value.get(key), str):
                return value[key]
    return None


def cached_affinity() -> str | None:
    """Edge RMS sur lequel le client Riot est actuellement accroché."""
    return _text(*client_api._call("GET", "/player-affinity/service/v2/cached-affinity/rms"))


def rms_state() -> str | None:
    """État de la connexion de messagerie : 'Connected', 'Disconnected'…"""
    return _text(*client_api._call("GET", "/riot-messaging-service/v1/state"))


def expected_edge() -> str | None:
    """Edge attendu d'après la région du compte connecté, ou None si inconnue.

    On part du compte RÉELLEMENT connecté : le pointeur du dernier swap peut
    désigner un compte d'une autre région, ce qui ferait crier au bug alors
    que l'affinité est correcte (ou l'inverse).
    """
    name = core.live_account_name()
    if not name:
        return None
    account = next((a for a in vault.list_accounts() if a.name == name), None)
    if account is None:
        return None
    return _RMS_EDGE.get((account.region or "").upper())


def _lobby() -> dict | None:
    status, body = lcu_api._call("GET", "/lol-lobby/v2/lobby")
    if status != 200:
        return None
    try:
        return json.loads(body)
    except ValueError:
        return None


def diagnose() -> dict:
    """État de la messagerie du client Riot, sans rien modifier.

    `mismatch` n'est vrai que si l'edge attendu est connu ET différent : un
    diagnostic incertain ne doit pas afficher d'alerte.
    """
    result = {
        "client": True, "affinity": None, "expected": None,
        "state": None, "mismatch": False,
    }
    try:
        result["affinity"] = cached_affinity()
        result["state"] = rms_state()
    except client_api.ClientNotRunning:
        result["client"] = False
        return result
    result["expected"] = expected_edge()
    affinity, expected = result["affinity"], result["expected"]
    if affinity and expected:
        result["mismatch"] = not affinity.lower().startswith(expected.lower())
    return result


def repair() -> dict:
    """Rétablit la messagerie du client Riot puis resynchronise le lobby.

    Les quatre étapes viennent de la réparation réussie du 19/09/2026 :
    `/reconnect` et `/switch-servers` n'existent qu'en build de debug (404 en
    production), il faut donc couper et rouvrir la connexion à la main.

    Le lobby n'est recréé que si le joueur est SEUL : recréer un lobby de
    groupe en éjecterait les autres membres.
    """
    steps: list[str] = []
    before = diagnose()
    if not before["client"]:
        raise client_api.ClientNotRunning("client Riot fermé")

    # 1. Redemander une affinité : c'est le serveur qui dit quel edge est le bon.
    status, _ = client_api._call(
        "POST", "/player-affinity/service/v2/token",
        {"service": "rms", "hint": ""}, timeout=10,
    )
    steps.append(f"affinity:{status}")

    # 2. Couper la connexion de messagerie (le client repasse Disconnected).
    status, _ = client_api._call("DELETE", "/riot-messaging-service/v1/connect", timeout=10)
    steps.append(f"disconnect:{status}")

    # 3. Rouvrir avec un jeton frais. Le corps attendu est la chaîne JSON du
    #    jeton, pas un objet — et ce jeton ne doit jamais être journalisé.
    status, body = client_api._call("GET", "/rso-auth/v1/authorization/id-token")
    token = _text(status, body)
    if not token:
        steps.append("id-token:absent")
        raise RuntimeError("Jeton d'identité indisponible : reconnecte-toi dans le client Riot.")
    status, _ = client_api._call(
        "POST", "/riot-messaging-service/v1/connect", token, timeout=10,
    )
    steps.append(f"connect:{status}")
    reconnected = status in (200, 201, 202, 204)

    # 4. Recréer le lobby pour que League reparte d'un état propre.
    lobby_recreated = False
    try:
        lobby = _lobby()
        if lobby:
            members = lobby.get("members") or []
            queue_id = (lobby.get("gameConfig") or {}).get("queueId")
            if queue_id and len(members) <= 1:
                lobby_recreated = lcu_api.create_lobby(int(queue_id))
                steps.append(f"lobby:{queue_id}")
            elif queue_id:
                steps.append("lobby:groupe-préservé")
    except lcu_api.LeagueNotRunning:
        steps.append("lobby:client-fermé")

    after = diagnose()
    applog.get_logger().info(
        "queue_repair: %s → affinité %s→%s, état %s→%s",
        " ".join(steps), before["affinity"], after["affinity"],
        before["state"], after["state"],
    )
    return {
        "ok": reconnected,
        "before": before,
        "after": after,
        "lobby_recreated": lobby_recreated,
    }
