"""Serveur local exposant le moteur switcher en HTTP+SSE pour le frontend Tauri.

Aucune dépendance ajoutée : stdlib uniquement (http.server), pour rester
facile à compiler en .exe sidecar avec PyInstaller.
"""
import base64
import hashlib
import io
import json
import math
import os
import queue
import re
import socket
import sys
import ssl
import urllib.request
import threading
import time
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import applog, autoaccept, client_api, core, export_import, lcu_api, opponent_insight, process, queue_joiner, rank_watch, riot_api, secure_settings, settings, ui_assets, valorant_api, vault, paths

_swap_lock = threading.Lock()
_swap_busy = False
# Sérialise tous les appels Riot API (auto-sync + rafraîchissement manuel), même
# sur plusieurs comptes en parallèle, pour rester loin des rate limits (20 req/s,
# 100 req/2 min) sans avoir à les répliquer ici — un seul sync à la fois suffit.
_riot_lock = threading.Lock()
_RIOT_SYNC_COOLDOWN = 5 * 60
_VALORANT_SYNC_COOLDOWN = 90
# Optim 2 (PASSATION_HEXGATE_SWAP_V2_1.md §14) : fenêtre de fraîcheur pour la
# synchro automatique de démarrage, distincte du cooldown manuel ci-dessus. Un
# compte déjà synchronisé récemment n'est pas rappelé à chaque relance —
# le rafraîchissement manuel par carte reste toujours possible.
_VALORANT_STARTUP_FRESHNESS = 15 * 60
def handle_auto_accept():
    _broadcast_toast("File acceptée automatiquement", "ok")
    active = vault.get_active()
    if active:
        _broadcast_event("auto_accept", {"name": active})

_accepter = autoaccept.AutoAccepter(on_accept=handle_auto_accept)

_joiner = queue_joiner.QueueJoiner(on_success=lambda msg: _broadcast_toast(msg, "ok"))

_rank_watcher = rank_watch.RankWatcher(
    on_game_result=lambda text: _broadcast_toast(text, "ok"),
    on_profile_updated=lambda: _broadcast_event("accounts_changed", None),
)

# Réveil immédiat des watchers event-driven (voir GameflowWatcher = bus LCU) :
_friends_poke = threading.Event()


def _on_gameflow_change(phase: str, since: float):
    _broadcast_event("gameflow", {"phase": phase, "since": since})
    if phase in ("EndOfGame", "PreEndOfGame", "WaitingForStats"):
        # Le rang LCU met quelques secondes à refléter la partie : sondage différé.
        threading.Timer(8.0, _rank_watcher.poke).start()


def _on_ready_check_event(_etype: str, data):
    # Push du pop de file → acceptation quasi instantanée (le délai utilisateur
    # configuré reste appliqué par l'AutoAccepter lui-même).
    if isinstance(data, dict) and data.get("state") == "InProgress":
        _accepter.poke()


def _on_friends_event(_etype: str, _data):
    _friends_poke.set()


_gameflow_watcher = rank_watch.GameflowWatcher(
    on_gameflow_change=_on_gameflow_change,
    extra_events=[
        ("OnJsonApiEvent_lol-matchmaking_v1_ready-check", "/lol-matchmaking/v1/ready-check", _on_ready_check_event),
        ("OnJsonApiEvent_lol-chat_v1_friends", "/lol-chat/v1/friends", _on_friends_event),
    ],
)

_toast_subscribers: list[queue.Queue] = []


class _ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    """Serveur qui refuse explicitement un deuxième propriétaire sous Windows."""
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        return super().server_bind()


def _broadcast_toast(text: str, kind: str = "zap"):
    for q in list(_toast_subscribers):
        q.put({"type": "toast", "text": text, "kind": kind})


def _broadcast_event(event_type: str, data):
    for q in list(_toast_subscribers):
        q.put({"type": event_type, "data": data})


_league_launch_lock = threading.Lock()


def _retry(action, label: str, attempts: int = 12, delay: float = 1.0) -> bool:
    """Réessaie un appel LCU qui peut légitimement échouer le temps que le
    client termine son initialisation. Vrai dès le premier succès."""
    for i in range(1, attempts + 1):
        try:
            if action():
                if i > 1:
                    print(f"[queue] {label} accepté à la tentative {i}", flush=True)
                return True
            print(f"[queue] {label} refusé ({i}/{attempts})", flush=True)
        except lcu_api.LeagueNotRunning as e:
            print(f"[queue] {label} : client indisponible ({i}/{attempts}) — {e}", flush=True)
        if i < attempts:
            time.sleep(delay)
    return False


def _ensure_league_client_ready(timeout: float = 180.0) -> bool:
    """S'assure que le client League répond avant une automatisation LCU.

    Rien d'ouvert n'est une erreur : on ouvre le client (Riot Client puis
    League, comme le fait un swap) et on attend qu'il soit réellement
    utilisable, plutôt que d'abandonner avec « Client introuvable ».

    « Utilisable » = le LCU répond ET le profil est chargé : juste après le
    démarrage, le LCU accepte les connexions plusieurs secondes avant que
    l'invocateur soit disponible, et un create_lobby lancé dans cette fenêtre
    échoue. Le délai est large (3 min) car un démarrage à froid enchaîne Riot
    Client, login sur session restaurée, puis client League.
    """
    if lcu_api.is_ready():
        print("[queue] client déjà prêt", flush=True)
        return True

    # Verrou tenu pendant toute l'attente : deux automatisations lancées coup
    # sur coup ne doivent pas démarrer deux fois le client. La seconde repart
    # de la sonde ci-dessous, client déjà prêt.
    with _league_launch_lock:
        if lcu_api.is_ready():
            return True

        print("[queue] client absent, lancement…", flush=True)
        _broadcast_toast("Ouverture du client en cours…", "info")
        try:
            process.launch_league()
        except Exception as e:
            _broadcast_toast(f"Ouverture du client impossible : {e}", "warn")
            return False

        deadline = time.monotonic() + timeout
        game_asked = announced = False
        login_since = None
        while time.monotonic() < deadline:
            if lcu_api.is_ready():
                try:
                    who = (lcu_api.current_summoner() or {}).get("riot_id")
                    if who:
                        # Le profil est chargé mais l'accueil finit de s'initialiser :
                        # sans ce délai, le premier create_lobby part trop tôt.
                        print(f"[queue] profil chargé ({who}), stabilisation 5 s", flush=True)
                        time.sleep(5)
                        return True
                except lcu_api.LeagueNotRunning:
                    pass  # client reparti en cours de démarrage : on continue
                time.sleep(0.5)
                continue

            # Le Riot Client est ouvert mais League ne démarre pas forcément :
            # l'argument --launch-product ne suffit pas sur un démarrage à
            # froid (le product-launcher ne l'accepte qu'une fois le login RSO
            # validé). On redemande donc le jeu explicitement, comme un swap.
            if not game_asked:
                try:
                    if client_api.is_logged_in():
                        login_since = None
                        if not announced:
                            _broadcast_toast("Ouverture de League of Legends…", "info")
                            announced = True
                        # Refusé tant que le product-launcher n'est pas prêt :
                        # on retente à chaque tour jusqu'à acceptation.
                        game_asked = client_api.launch_league()
                    else:
                        # Pas de session valide : le client restera sur l'écran
                        # de login, inutile d'attendre les 3 minutes.
                        login_since = login_since or time.monotonic()
                        if time.monotonic() - login_since > 25:
                            _broadcast_toast(
                                "Connecte-toi dans le client Riot pour lancer le jeu.", "warn")
                            return False
                except client_api.ClientNotRunning:
                    pass  # le Riot Client démarre encore
            time.sleep(0.5)

    _broadcast_toast("Le client met trop de temps à démarrer.", "warn")
    return False


# État de l'insight adversaire (overlay cooldowns), partagé entre le watcher
# in-game (start_live_game_overlay_watcher, ci-dessous) et l'endpoint HTTP
# /live-game/insight-target : "target_riot_id" est l'adversaire actuellement
# épinglé côté frontend (cliqué dans la rangée de portraits), vide = suivi
# auto de l'adversaire de lane. "target_champion" (rawChampionName) désigne le
# MÊME adversaire et reste renseigné quand le Mode Streamer du client LoL vide
# le riot_id : il distingue « épinglé mais anonymisé » (aucun insight possible)
# de « rien d'épinglé » (repli sur la lane). "my_champion" est mis à jour à
# chaque tick du watcher pour permettre un fetch immédiat depuis l'endpoint
# HTTP sans attendre le prochain tick.
_insight_state: dict = {"target_riot_id": "", "target_champion": "",
                        "my_champion": "", "key": None, "payload": None}
_insight_lock = threading.Lock()


def _fetch_opponent_insight(enemy_riot_id: str, my_champion: str):
    """Tâche de fond : winrate saison + winrate du matchup + pic observé de
    l'adversaire ciblé (adversaire de lane, ou celui épingle manuellement dans
    l'overlay), via la Riot API officielle (même famille de donnée que l'écran
    de chargement de Porofessor/Blitz — juste recalculée pour CE matchup précis)."""
    try:
        active_name = vault.get_active()
        account = next((a for a in vault.list_accounts() if a.name == active_name), None)
        region = account.region if account else "EUW"
        with _riot_lock:
            insight = opponent_insight.get_insight(enemy_riot_id, region, my_champion)
        payload = {
            "riot_id": enemy_riot_id, "champion": my_champion, "error": None, "active": True, **insight,
        }
        with _insight_lock:
            if _insight_state.get("key") != (enemy_riot_id, my_champion):
                return  # cible changée pendant le fetch (stale) : n'écrase pas la cible actuelle
            _insight_state["payload"] = payload
        _broadcast_event("live_game_opponent_insight", payload)
        print(f"[HEXGATE][insight] succes pour {enemy_riot_id} vs {my_champion} : "
              f"solo={insight.get('solo')} matchup={insight.get('matchup')}", flush=True)
    except riot_api.RiotApiError as e:
        payload = {
            "riot_id": enemy_riot_id, "champion": my_champion, "error": str(e), "active": True,
        }
        with _insight_lock:
            if _insight_state.get("key") != (enemy_riot_id, my_champion):
                return
            _insight_state["payload"] = payload
        _broadcast_event("live_game_opponent_insight", payload)
        print(f"[HEXGATE][insight] RiotApiError pour {enemy_riot_id} vs {my_champion} : {e}", flush=True)
    except Exception as e:
        payload = {
            "riot_id": enemy_riot_id, "champion": my_champion, "error": f"Erreur inattendue : {e}", "active": True,
        }
        with _insight_lock:
            if _insight_state.get("key") != (enemy_riot_id, my_champion):
                return
            _insight_state["payload"] = payload
        _broadcast_event("live_game_opponent_insight", payload)
        print(f"[HEXGATE][insight] Erreur inattendue pour {enemy_riot_id} vs {my_champion} : {e}", flush=True)


def _get_today_stats(name: str) -> tuple[dict, dict | None]:
    matches = vault.get_matches(name)
    if not matches:
        return {}, None
    
    now = time.time()
    local_time = time.localtime(now)
    midnight = time.mktime((local_time.tm_year, local_time.tm_mon, local_time.tm_mday, 0, 0, 0, 0, 0, 0))
    
    today_matches = [m for m in matches if m.get("ts", 0) >= midnight]
    if not today_matches:
        return {}, None
        
    roles = {}
    champs = {}
    for m in today_matches:
        r = m.get("role", "UNKNOWN")
        if r not in roles:
            roles[r] = {"wins": 0, "games": 0}
        roles[r]["games"] += 1
        if m.get("win"):
            roles[r]["wins"] += 1
            
        champ = m.get("champion")
        if champ:
            if champ not in champs:
                champs[champ] = {"wins": 0, "games": 0, "kills": 0, "deaths": 0, "assists": 0}
            champs[champ]["games"] += 1
            champs[champ]["kills"] += m.get("kills", 0)
            champs[champ]["deaths"] += m.get("deaths", 0)
            champs[champ]["assists"] += m.get("assists", 0)
            if m.get("win"):
                champs[champ]["wins"] += 1

    mvp = None
    best_score = -1
    for champ_name, c in champs.items():
        wr = c["wins"] / c["games"]
        score = c["games"] * 100 + wr * 50
        if score > best_score:
            best_score = score
            kda = (c["kills"] + c["assists"]) / c["deaths"] if c["deaths"] > 0 else (c["kills"] + c["assists"])
            mvp = {
                "champion": champ_name,
                "wins": c["wins"],
                "games": c["games"],
                "losses": c["games"] - c["wins"],
                "kda": round(kda, 2)
            }
            
    return roles, mvp


def _valorant_state(a: vault.Account) -> dict:
    """État local VALORANT : le résumé est local, aucun secret n'est exposé."""
    raw = a.valorant or {}
    # Le tutoriel reste dans le jeu Riot : Hexgate considère le profil prêt.
    tutorial_confirmed = True
    initialized = True
    if a.expired:
        status = "expired"
    else:
        status = "ready"
    return {
        "initialized": initialized,
        "tutorial_confirmed": tutorial_confirmed,
        "pinned": bool(raw.get("pinned", False)),
        "status": status,
        "stats": raw.get("stats") if isinstance(raw.get("stats"), dict) else None,
    }


def _account_to_dict(a: vault.Account, active: str | None = None,
                     product: str = "league_of_legends") -> dict:
    # `active` transmis par l'appelant quand il liste plusieurs comptes (une seule
    # lecture de state.json au lieu d'une par compte).
    if active is None:
        active = vault.get_active()
    roles_today, mvp_today = _get_today_stats(a.name)
    return {
        "name": a.name, "region": a.region, "expired": a.expired,
        "riot_id": a.riot_id, "level": a.level, "rank": a.rank,
        "icon_id": a.icon_id, "active": a.name == active,
        "lp_delta": a.lp_delta, "note": a.note,
        "pinned": _valorant_state(a)["pinned"] if product == "valorant" else a.pinned,
        "recap": vault.daily_recap(a.name),
        "goal": a.goal,
        "post_swap": a.post_swap or {"queue_id": None, "auto_join": True},
        "champ_select": {**vault.DEFAULT_CHAMP_SELECT, **(a.champ_select or {})},
        "position_prefs": a.position_prefs,
        "most_played_champ": vault.most_played_champ(a.name),
        "roles_today": roles_today,
        "mvp_today": mvp_today,
        "wallet": a.wallet,
        "valorant": _valorant_state(a),
    }


def _ordered_accounts(product: str = "league_of_legends") -> list[vault.Account]:
    """Comptes épinglés d'abord, puis dans l'ordre personnalisé sauvegardé
    (les comptes absents de cet ordre — nouveaux — passent en fin de liste)."""
    accounts = vault.list_accounts()
    order = settings.get("account_order", [])
    rank = {name: i for i, name in enumerate(order)}
    def is_pinned(account: vault.Account) -> bool:
        if product == "valorant":
            return bool((account.valorant or {}).get("pinned", False))
        return account.pinned
    accounts.sort(key=lambda a: (not is_pinned(a), rank.get(a.name, len(order))))
    return accounts


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # silence : évite de polluer stdout (lu par le sidecar Tauri)

    def _json(self, status: int, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/accounts":
            product = (parse_qs(urlparse(self.path).query).get("product") or ["league_of_legends"])[0]
            if product not in process.PRODUCTS:
                self._json(400, {"error": "produit Riot inconnu"})
                return
            active_name = vault.get_active()
            accounts_list = [_account_to_dict(a, active_name, product) for a in _ordered_accounts(product)]
            total_wins = 0
            total_losses = 0
            total_lp = 0
            has_any_recap = False
            for acc in accounts_list:
                r = acc.get("recap")
                if r:
                    total_wins += r["wins"]
                    total_losses += r["losses"]
                    total_lp += r["lp_delta"]
                    has_any_recap = True
            
            recap_total = {
                "wins": total_wins,
                "losses": total_losses,
                "lp_delta": total_lp
            } if has_any_recap else None
            
            # Un seul tasklist (sous-processus coûteux, ~450 ms) pour les deux
            # jeux plutôt qu'un par produit — cette route est celle que le
            # frontend appelle à chaque lancement et sur presque tout event SSE.
            _tasklist = process.cached_tasklist_lower()
            self._json(200, {
                "accounts": accounts_list,
                "active": vault.get_active(),
                "recap_total": recap_total,
                "product": product,
                "product_status": {
                    "league_of_legends": process.product_activity("league_of_legends", _tasklist),
                    "valorant": process.product_activity("valorant", _tasklist),
                },
            })
        elif path == "/products/status":
            _tasklist = process.cached_tasklist_lower()
            self._json(200, {
                "league_of_legends": process.product_activity("league_of_legends", _tasklist),
                "valorant": process.product_activity("valorant", _tasklist),
            })
        elif path == "/suggest-name":
            self._json(200, {"name": core.suggest_account_name()})
        elif path == "/autoaccept":
            self._json(200, {"enabled": _accepter.enabled.is_set()})
        elif path == "/settings/autoaccept-delay":
            self._json(200, {"delay": int(settings.get("auto_accept_delay", 0))})
        elif path == "/settings/cloud-backup":
            self._json(200, {
                "path": settings.get("cloud_backup_path"),
                "password": settings.get("cloud_backup_password", "hexgate-default-cloud-sync")
            })
        elif path == "/ping/servers":
            self._json(200, {
                "selected": get_ping_region()["id"],
                "servers": [
                    {"id": s["id"], "label": s["label"], "city": s["city"]}
                    for s in LOL_SERVERS
                ],
            })
        elif path == "/streamer-mode":
            self._json(200, {"enabled": bool(settings.get("streamer_mode", False))})
        elif path == "/queue-penalty":
            try:
                penalty = lcu_api.queue_penalty()
            except lcu_api.LeagueNotRunning:
                penalty = None
            self._json(200, {"penalty": penalty})
        elif path == "/wallet":
            try:
                w = lcu_api.wallet()
            except lcu_api.LeagueNotRunning:
                w = None
            self._json(200, {"wallet": w})
        elif path == "/tools/settings/current":
            # Réglages vivants du client, pour l'éditeur intégré. Tout est
            # nullable : client fermé n'est pas une erreur.
            payload: dict = {"game": None, "input": None}
            try:
                payload["game"] = lcu_api.get_game_settings()
                payload["input"] = lcu_api.get_input_settings()
            except lcu_api.LeagueNotRunning:
                pass
            except Exception:
                pass
            self._json(200, payload)
        elif path == "/tools/presets":
            self._json(200, {
                "presets": vault.list_settings_presets(),
                "accounts": [a.name for a in vault.list_accounts()],
                "sync_enabled": bool(settings.get("game_settings_sync_enabled", False)),
            })
        elif path == "/tools/state":
            # État agrégé de l'onglet Outils : ce qui est disponible là, tout de
            # suite. Tout est facultatif — un client fermé renvoie des None
            # plutôt qu'une erreur, l'onglet reste affichable.
            state: dict = {"reroll": None, "swaps": [], "identity": None, "honor_votes": None}
            try:
                state["reroll"] = lcu_api.reroll_points()
                state["swaps"] = lcu_api.pending_swaps()
                state["identity"] = lcu_api.saved_identity()
                ballot = lcu_api.honor_ballot() or {}
                votes = (ballot.get("votePool") or {}).get("votes")
                state["honor_votes"] = votes if isinstance(votes, int) else None
            except lcu_api.LeagueNotRunning:
                pass
            except Exception:
                pass
            self._json(200, state)
        elif path == "/rank-history":
            query = parse_qs(urlparse(self.path).query)
            self._rank_history((query.get("name") or [""])[0])
        elif path == "/gameflow":
            self._json(200, {
                "phase": _gameflow_watcher._current_phase,
                "since": _gameflow_watcher._since
            })
        elif path == "/matches":
            query = parse_qs(urlparse(self.path).query)
            name = (query.get("name") or [""])[0]
            self._json(200, vault.get_matches(name))
        elif path == "/champion-stats":
            query = parse_qs(urlparse(self.path).query)
            name = (query.get("name") or [""])[0]
            self._json(200, vault.champion_stats(name))
        elif path == "/live-game":
            data = get_live_game_data()
            self._json(200, data if data else {})
        elif path == "/chat/friends":
            try:
                self._json(200, lcu_api.get_friends())
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/chat/friend-requests":
            try:
                self._json(200, lcu_api.get_friend_requests())
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/replays/state":
            query = parse_qs(urlparse(self.path).query)
            match_id = (query.get("matchId") or [""])[0]
            try:
                self._json(200, {"state": lcu_api.get_replay_state(match_id)})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/server-status":
            query = parse_qs(urlparse(self.path).query)
            region = (query.get("region") or ["EUW"])[0]
            try:
                client = riot_api.RiotClient()
                status = client.server_status(region)
                self._json(200, status or {"error": "status unavailable"})
            except Exception as e:
                self._json(200, {"error": str(e)})
        elif path == "/matchmaking-search":
            try:
                status, body = lcu_api._call("GET", "/lol-matchmaking/v1/search")
                if status == 200:
                    self._json(200, json.loads(body))
                else:
                    self._json(status, {"error": body})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/settings/all":
            import ctypes
            is_admin = False
            try:
                is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0
            except Exception:
                pass
            self._json(200, {
                "auto_accept_delay": int(settings.get("auto_accept_delay", 0)),
                "cloud_backup_path": settings.get("cloud_backup_path"),
                "cloud_backup_password": settings.get("cloud_backup_password", "hexgate-default-cloud-sync"),
                "auto_accept_invitations": bool(settings.get("auto_accept_invitations", False)),
                "aram_sniper_champions": settings.get("aram_sniper_champions", ""),
                "lobby_welcome_message": settings.get("lobby_welcome_message", ""),
                "streamer_mode": bool(settings.get("streamer_mode", False)),
                "riot_client_auto_close": bool(settings.get("riot_client_auto_close", False)),
                "riot_client_autostart_mode": settings.get("riot_client_autostart_mode", "normal"),
                "auto_mute_all_on_start": bool(settings.get("auto_mute_all_on_start", False)),
                "macro_f5_text": settings.get("macro_f5_text", ""),
                "macro_f6_text": settings.get("macro_f6_text", ""),
                "skip_end_of_game": bool(settings.get("skip_end_of_game", False)),
                "end_of_game_message": settings.get("end_of_game_message", ""),
                "end_of_game_message_team_only": bool(settings.get("end_of_game_message_team_only", False)),
                "relay_client_notifications": bool(settings.get("relay_client_notifications", True)),
                "game_settings_sync_enabled": bool(settings.get("game_settings_sync_enabled", False)),
                "opponent_insight_enabled": bool(settings.get("opponent_insight_enabled", False)),
                "low_power_mode": bool(settings.get("low_power_mode", False)),
                "remember_last_product": bool(settings.get("remember_last_product", False)),
                "henrikdev_configured": secure_settings.configured(valorant_api.SECRET_KEY),
                "is_admin": is_admin
            })
        elif path == "/events":
            self._stream_events()
        elif path == "/assets/logo.png":
            self._image(ui_assets.logo(256))
        elif path.startswith("/assets/ranks/"):
            tier = path.rsplit("/", 1)[-1].removesuffix(".png")
            self._image(ui_assets.rank_emblem(None if tier == "unranked" else tier.upper()))
        elif path.startswith("/assets/avatar/"):
            self._avatar(path.rsplit("/", 1)[-1])
        else:
            self._json(404, {"error": "not found"})

    def _image(self, img):
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        # ETag basé sur le contenu réel, plutôt qu'un max-age fixe : le
        # 14/09/2026 un `public, max-age=86400` a caché pendant 24h le badge
        # de repli (hexagone+lettre) sur le disque WebView2 même après
        # correction du bundling PyInstaller côté build-sidecar.ps1 — seul un
        # vidage manuel du cache l'a révélé. `no-cache` force une
        # revalidation à chaque chargement (requête conditionnelle
        # If-None-Match -> 304 si inchangé), donc un changement d'asset est
        # visible dès le prochain lancement sans jamais nécessiter un bump
        # manuel de version d'URL ni un vidage de cache.
        etag = '"' + hashlib.sha1(data).hexdigest() + '"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _avatar(self, spec: str):
        # spec = "<icon_id|none>-<initial>-<ring_hex_no_hash>"
        icon_part, initial, ring = (spec.split("-", 2) + ["?", "785a28"])[:3]
        icon_id = int(icon_part) if icon_part.isdigit() else None
        self._image(ui_assets.avatar(icon_id, initial, f"#{ring}"))

    def _rank_history(self, name: str):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        points = vault.rank_history(name)
        peak = None
        peak_score = None
        for p in points:
            score = vault.ladder_lp(p)
            if score is not None and (peak_score is None or score > peak_score):
                peak_score, peak = score, p

        trend_7d = None
        if len(points) >= 2:
            now = time.time()
            week_ago = now - 7 * 86400
            reference = min(points, key=lambda p: abs(p["ts"] - week_ago) if p["ts"] <= now else float("inf"))
            ref_score = vault.ladder_lp(reference)
            latest_score = vault.ladder_lp(points[-1])
            if ref_score is not None and latest_score is not None and reference is not points[-1]:
                trend_7d = latest_score - ref_score

        last_sync = vault.riot_last_sync(name)
        cooldown_remaining = max(0.0, _RIOT_SYNC_COOLDOWN - (time.time() - last_sync)) if last_sync else 0.0
        self._json(200, {"points": points, "peak": peak, "trend_7d": trend_7d,
                         "riot_last_sync": last_sync, "riot_cooldown_remaining": cooldown_remaining})

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._body()
        if path == "/swap":
            self._start_swap(body.get("name"), body.get("product") or "league_of_legends", body.get("queue_id"))
        elif path == "/capture":
            self._capture(body.get("name"))
        elif path == "/add-account":
            self._add_account(body.get("product") or "league_of_legends")
        elif path == "/delete":
            name = body.get("name", "")
            mode = body.get("mode") or "all"
            if mode == "valorant":
                vault.update_valorant(name, reset=True)
            else:
                vault.delete(name)
            self._json(200, {"ok": True})
            self._broadcast("accounts_changed", None)
        elif path == "/chat/message":
            friend_jid = body.get("friendJid")
            text = body.get("text")
            if not friend_jid or not text:
                self._json(400, {"error": "friendJid and text requis"})
                return
            try:
                success = lcu_api.send_friend_message(friend_jid, text)
                self._json(200, {"ok": success})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/replays/download":
            match_id = body.get("matchId")
            if not match_id:
                self._json(400, {"error": "matchId requis"})
                return
            try:
                success = lcu_api.download_replay(match_id)
                self._json(200, {"ok": success})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/autoaccept":
            (_accepter.enabled.set if body.get("enabled") else _accepter.enabled.clear)()
            self._json(200, {"enabled": _accepter.enabled.is_set()})
        elif path == "/settings/autoaccept-delay":
            settings.set("auto_accept_delay", int(body.get("delay", 0)))
            self._json(200, {"delay": int(settings.get("auto_accept_delay", 0))})
        elif path == "/settings/cloud-backup":
            settings.set("cloud_backup_path", body.get("path"))
            settings.set("cloud_backup_password", body.get("password") or "hexgate-default-cloud-sync")
            _auto_sync_cloud()
            self._json(200, {"path": settings.get("cloud_backup_path")})
        elif path == "/streamer-mode":
            settings.set("streamer_mode", bool(body.get("enabled")))
            self._json(200, {"enabled": bool(body.get("enabled"))})
        elif path == "/settings/low-power":
            enabled = bool(body.get("enabled"))
            settings.set("low_power_mode", enabled)
            self._json(200, {"enabled": enabled})
            # Les 3 fenêtres (main + overlays) appliquent le mode via cet event.
            self._broadcast("low_power", {"enabled": enabled})
        elif path == "/chat/me":
            success = lcu_api.set_presence(body.get("statusMessage") or "", body.get("availability") or "online")
            self._json(200, {"ok": success})
        elif path == "/lobby/practice":
            try:
                success = lcu_api.create_practice_lobby()
                self._json(200, {"ok": success})
            except Exception:
                self._json(200, {"ok": False})
        elif path == "/lcu/close":
            lcu_api.close_league_client()
            self._json(200, {"ok": True})
        elif path == "/lcu/repair":
            import subprocess
            from pathlib import Path
            p = Path("C:/Riot Games/Riot Client/RiotClientServices.exe")
            success = False
            if p.is_file():
                try:
                    subprocess.Popen([str(p), "--launch-product=league_of_legends", "--launch-patchline=live", "--repair"])
                    success = True
                except Exception:
                    pass
            self._json(200, {"ok": success})
        elif path == "/open-url":
            import webbrowser
            url = body.get("url")
            if url:
                webbrowser.open(url)
            self._json(200, {"ok": True})
        elif path == "/matches/export":
            filename = body.get("filename") or "matches.json"
            matches_data = body.get("matches") or []
            target_path = save_file_dialog(filename)
            if target_path:
                try:
                    with open(target_path, "w", encoding="utf-8") as f:
                        json.dump(matches_data, f, indent=2)
                    self._json(200, {"ok": True, "path": target_path})
                except Exception as e:
                    self._json(500, {"error": str(e)})
            else:
                self._json(200, {"ok": False, "cancelled": True})
        elif path == "/ping/region":
            wanted = str(body.get("region") or "")
            server = next((s for s in LOL_SERVERS if s["id"] == wanted), None)
            if not server:
                self._json(400, {"error": "serveur inconnu"})
                return
            settings.set("ping_region", server["id"])
            self._json(200, {"ok": True, "region": server["id"]})
            # Mesure immédiate hors du thread HTTP : l'utilisateur voit la
            # nouvelle valeur en ~1 s au lieu d'attendre le tour du watcher.
            _ping_region_changed.set()

            def measure_now(s=server):
                latency, estimated = measure_region_ping(s)
                _broadcast_ping(s, latency, estimated)
            threading.Thread(target=measure_now, daemon=True).start()
        elif path == "/save-image":
            filename = body.get("filename") or "hexgate.png"
            data_b64 = body.get("data") or ""
            if not data_b64:
                self._json(400, {"error": "image manquante"})
                return
            target_path = save_file_dialog(filename, kind="image")
            if not target_path:
                self._json(200, {"ok": False, "cancelled": True})
                return
            try:
                raw = base64.b64decode(data_b64)
                # Le sélecteur Windows peut renvoyer une extension .jpg alors que
                # le canvas produit du PNG : on ré-encode plutôt que de mentir
                # sur le contenu du fichier.
                if target_path.lower().endswith((".jpg", ".jpeg")):
                    raw = _png_to_jpeg(raw) or raw
                with open(target_path, "wb") as f:
                    f.write(raw)
                self._json(200, {"ok": True, "path": target_path})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/export":
            self._export(body.get("names") or [], body.get("password") or "")
        elif path == "/import":
            self._import(body.get("data") or "", body.get("password") or "")
        elif path == "/note":
            self._set_note(body.get("name") or "", body.get("note") or "")
        elif path == "/reconnect":
            self._reconnect(body.get("name"), body.get("queue_id"))
        elif path == "/pin":
            self._set_pinned(body.get("name") or "", bool(body.get("pinned")), body.get("product") or "league_of_legends")
        elif path == "/valorant/tutorial":
            self._set_valorant_tutorial(body.get("name") or "", bool(body.get("confirmed")))
        elif path == "/live-game/insight-target":
            raw_riot_id = body.get("riot_id")
            riot_id = raw_riot_id.strip() if isinstance(raw_riot_id, str) else ""
            raw_champion = body.get("champion")
            champion = raw_champion.strip() if isinstance(raw_champion, str) else ""
            # Écrit uniquement la cible : le watcher (tick <=1s) est le SEUL
            # déclencheur de fetch, il revalide déjà contre les ennemis réels
            # de la partie en cours. Évite la race/duplication d'un fetch
            # déclenché ici en parallèle du tick.
            with _insight_lock:
                _insight_state["target_riot_id"] = riot_id
                _insight_state["target_champion"] = champion
            self._json(200, {"ok": True})
        elif path == "/reorder":
            settings.set("account_order", [str(n) for n in (body.get("order") or [])])
            self._json(200, {"ok": True})
            self._broadcast("accounts_changed", None)
        elif path == "/refresh-riot":
            self._refresh_riot(body.get("name"))
        elif path == "/goal":
            self._set_goal(body.get("name") or "", body.get("tier"), body.get("division"))
        elif path == "/post-swap":
            self._set_post_swap(body.get("name") or "", body.get("queue_id"), bool(body.get("auto_join")))
        elif path == "/matches-refresh":
            self._refresh_matches(body.get("name") or "")
        elif path == "/valorant/refresh":
            self._refresh_valorant(body.get("name") or "")
        elif path == "/settings/update":
            for key in ["auto_accept_delay", "cloud_backup_path", "cloud_backup_password",
                        "auto_accept_invitations", "aram_sniper_champions", "lobby_welcome_message",
                        "streamer_mode", "riot_client_auto_close", "riot_client_autostart_mode",
                        "auto_mute_all_on_start", "macro_f5_text", "macro_f6_text",
                        "skip_end_of_game", "relay_client_notifications", "game_settings_sync_enabled",
                        "opponent_insight_enabled", "end_of_game_message",
                        "end_of_game_message_team_only", "remember_last_product"]:
                if key in body:
                    if key == "auto_accept_delay":
                        settings.set(key, int(body[key]))
                    elif key in ["auto_accept_invitations", "streamer_mode", "riot_client_auto_close",
                                 "auto_mute_all_on_start", "skip_end_of_game", "relay_client_notifications",
                                 "game_settings_sync_enabled", "opponent_insight_enabled",
                                 "end_of_game_message_team_only", "remember_last_product"]:
                        settings.set(key, bool(body[key]))
                    else:
                        settings.set(key, str(body[key]))
            if "henrikdev_api_key" in body:
                raw_key = body.get("henrikdev_api_key")
                if not isinstance(raw_key, str):
                    self._json(400, {"error": "clé HenrikDev invalide"})
                    return
                try:
                    secure_settings.set_secret(valorant_api.SECRET_KEY, raw_key)
                except Exception:
                    self._json(500, {"error": "Impossible de protéger la clé HenrikDev localement."})
                    return
            self._json(200, {"ok": True})
        elif path == "/friends/spectate":
            puuid = body.get("puuid")
            if not puuid:
                self._json(400, {"error": "puuid requis"})
                return
            try:
                success = lcu_api.spectate_friend(puuid)
                self._json(200, {"ok": success})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/loot/open-chests":
            try:
                count = lcu_api.open_hextech_chests()
                self._json(200, {"ok": True, "count": count})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/loot/disenchant-wards-icons":
            try:
                count = lcu_api.disenchant_wards_and_icons()
                self._json(200, {"ok": True, "count": count})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/loot/disenchant-champions":
            try:
                count = lcu_api.disenchant_champion_shards(bool(body.get("keep_unowned", True)))
                self._json(200, {"ok": True, "count": count})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/challenges/clear-identity":
            # Retire sélectivement jetons / bannière / bordure / prestige / titre
            # de l'icône de profil. Le client League ne sait que les remplacer,
            # jamais les enlever (cf. lcu_api.clear_identity).
            fields = body.get("fields")
            if not isinstance(fields, list) or not fields:
                self._json(400, {"error": "fields requis"})
                return
            try:
                result = lcu_api.clear_identity([str(f) for f in fields])
                self._json(200, {"ok": result["ok"], "count": result["changed"]})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/product/launch":
            # Lance un produit Riot SANS toucher aux sessions.
            #
            # Destiné au compte DÉJÀ connecté : lui faire refaire un swap
            # complet serait absurde et destructeur — le swap tue le client
            # Riot en cours pour restaurer une session qui est déjà la bonne.
            # Ici on se contente de démarrer le jeu, comme le ferait le
            # lanceur Riot.
            product = body.get("product") or ""
            if product not in ("league_of_legends", "valorant"):
                self._json(400, {"error": "produit Riot inconnu"})
                return
            try:
                process.launch_product(product)
                self._json(200, {"ok": True})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/profile-icon":
            try:
                ok = lcu_api.set_profile_icon(int(body.get("icon_id") or 0))
                self._json(200, {"ok": ok})
            except (TypeError, ValueError):
                self._json(400, {"error": "icon_id invalide"})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/profile-background":
            try:
                ok = lcu_api.set_profile_background(int(body.get("skin_id") or 0))
                self._json(200, {"ok": ok})
            except (TypeError, ValueError):
                self._json(400, {"error": "skin_id invalide"})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/identity/save":
            # Photographie l'identité du compte CONNECTÉ et la range sous le
            # compte nommé : c'est à l'appelant de s'assurer que le bon compte
            # est en session (l'API locale ne parle que du joueur connecté).
            name = body.get("name") or ""
            if not name:
                self._json(400, {"error": "name requis"})
                return
            try:
                identity = lcu_api.saved_identity()
                if identity is None:
                    self._json(409, {"error": "Identité de profil illisible : client League requis."})
                    return
                vault.save_identity(name, identity)
                self._json(200, {"ok": True})
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/identity/restore":
            name = body.get("name") or ""
            if not name:
                self._json(400, {"error": "name requis"})
                return
            try:
                saved = vault.get_identity(name)
                if saved is None:
                    self._json(404, {"error": "Aucune identité sauvegardée pour ce compte."})
                    return
                self._json(200, {"ok": lcu_api.apply_identity(saved)})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path in ("/tools/settings/save", "/tools/settings/restore"):
            # Pendant MANUEL de la synchro automatique au swap
            # (`_backup_active_game_settings`). Celle-ci est opt-in et
            # volontairement muette : un échec ne doit jamais interrompre un
            # swap. Ici c'est l'inverse — l'utilisateur a cliqué, il doit savoir
            # si ça a marché.
            name = body.get("name") or ""
            if not name:
                self._json(400, {"error": "name requis"})
                return
            if name not in {a.name for a in vault.list_accounts()}:
                self._json(404, {"error": f"Compte « {name} » introuvable."})
                return
            try:
                if path.endswith("/save"):
                    game = lcu_api.get_game_settings()
                    inputs = lcu_api.get_input_settings()
                    if not game and not inputs:
                        self._json(409, {"error": "Réglages illisibles : client League requis."})
                        return
                    vault.save_game_settings_backup(name, {"game": game, "input": inputs})
                    self._json(200, {"ok": True})
                else:
                    backup = vault.get_game_settings_backup(name)
                    if not backup:
                        self._json(404, {"error": "Aucun réglage sauvegardé pour ce compte."})
                        return
                    ok = True
                    if backup.get("game"):
                        ok = lcu_api.set_game_settings(backup["game"]) and ok
                    if backup.get("input"):
                        ok = lcu_api.set_input_settings(backup["input"]) and ok
                    self._json(200, {"ok": ok})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/presets/save":
            # Photographie les réglages du client connecté sous un nom réutilisable.
            name = (body.get("name") or "").strip()
            if not name:
                self._json(400, {"error": "nom de preset requis"})
                return
            try:
                game = lcu_api.get_game_settings()
                inputs = lcu_api.get_input_settings()
                if not game and not inputs:
                    self._json(409, {"error": "Réglages illisibles : client League requis."})
                    return
                vault.save_settings_preset(name, game, inputs)
                self._json(200, {"ok": True})
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/presets/delete":
            try:
                self._json(200, {"ok": vault.delete_settings_preset(body.get("name") or "")})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/presets/apply":
            # Applique un preset au client connecté et/ou l'installe comme
            # sauvegarde des comptes visés. Pour ces derniers, l'effet est
            # DIFFÉRÉ au prochain swap, et seulement si la synchro automatique
            # est active — d'où `sync_enabled` renvoyé pour que l'interface
            # puisse le dire au lieu de laisser croire à un échec.
            name = body.get("name") or ""
            preset = vault.get_settings_preset(name)
            if preset is None:
                self._json(404, {"error": "Preset introuvable."})
                return
            cibles = body.get("accounts")
            connus = [a.name for a in vault.list_accounts()]
            if not isinstance(cibles, list) or not cibles:
                cibles = connus
            else:
                cibles = [c for c in cibles if c in connus]
            game, inputs = preset.get("game") or {}, preset.get("input") or {}
            applique_live = False
            erreurs = []
            try:
                if body.get("live", True):
                    ok = True
                    if game:
                        ok = lcu_api.set_game_settings(game) and ok
                    if inputs:
                        ok = lcu_api.set_input_settings(inputs) and ok
                    applique_live = ok
                    if not ok:
                        erreurs.append("client")
            except lcu_api.LeagueNotRunning:
                erreurs.append("client")
            for compte in cibles:
                try:
                    vault.save_game_settings_backup(compte, {"game": game, "input": inputs})
                except Exception:
                    erreurs.append(compte)
            self._json(200, {
                "ok": not erreurs,
                "accounts": len(cibles),
                "live": applique_live,
                "sync_enabled": bool(settings.get("game_settings_sync_enabled", False)),
                "errors": erreurs,
            })
        elif path == "/tools/settings/edit":
            # Écriture directe de réglages modifiés dans l'app. `set_*` fait un
            # PATCH : n'envoyer que les sections touchées suffit et limite la
            # casse en cas d'erreur de saisie.
            game = body.get("game") if isinstance(body.get("game"), dict) else None
            inputs = body.get("input") if isinstance(body.get("input"), dict) else None
            if not game and not inputs:
                self._json(400, {"error": "aucune modification fournie"})
                return
            try:
                ok = True
                if game:
                    ok = lcu_api.set_game_settings(game) and ok
                if inputs:
                    ok = lcu_api.set_input_settings(inputs) and ok
                self._json(200, {"ok": ok})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/honor":
            try:
                honored = lcu_api.honor_random_ally()
                self._json(200, {"ok": honored is not None, "player": honored})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/reroll":
            try:
                self._json(200, {"ok": lcu_api.reroll_champion()})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/swaps/respond":
            try:
                ok = lcu_api.respond_to_swap(
                    str(body.get("kind") or ""), int(body.get("id") or 0),
                    str(body.get("action") or ""),
                )
                self._json(200, {"ok": ok})
            except (TypeError, ValueError):
                self._json(400, {"error": "paramètres d'échange invalides"})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/tools/notifications/clear":
            try:
                count = lcu_api.clear_client_notifications()
                self._json(200, {"ok": True, "count": count})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/champ-select-prefs":
            name = body.get("name") or ""
            if not name:
                self._json(400, {"error": "name requis"})
                return
            prefs = {k: v for k, v in body.items() if k != "name"}
            try:
                vault.set_champ_select(name, prefs)
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
                return
            self._json(200, {"ok": True})
            self._broadcast("accounts_changed", None)
        elif path == "/chat/friend-requests/accept":
            req_id = body.get("id")
            if not req_id:
                self._json(400, {"error": "id requis"})
                return
            try:
                success = lcu_api.accept_friend_request(str(req_id))
                self._json(200, {"ok": success})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/chat/friend-requests/decline":
            req_id = body.get("id")
            if not req_id:
                self._json(400, {"error": "id requis"})
                return
            try:
                success = lcu_api.decline_friend_request(str(req_id))
                self._json(200, {"ok": success})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/position-prefs":
            name = body.get("name") or ""
            if not name:
                self._json(400, {"error": "name requis"})
                return
            try:
                vault.set_position_prefs(name, body.get("first"), body.get("second"))
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
                return
            self._json(200, {"ok": True})
            self._broadcast("accounts_changed", None)
        elif path == "/lobby/dodge":
            try:
                success = lcu_api.dodge_lobby()
                self._json(200, {"ok": success})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif path == "/queue/start":
            self._start_queue(body.get("queue_id"))
        elif path == "/ui-focus":
            global _ui_active
            _ui_active = bool(body.get("active"))
            _ui_focus_changed.set()
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not found"})

    def _sync_riot(self, name: str, count: int = 20) -> tuple[int, int]:
        """Récupère l'historique SoloQ via la Riot API et le fusionne dans le
        cache local, puis marque l'heure de sync. Sérialisé (verrou global) pour
        ne jamais dépasser les rate limits même si plusieurs comptes se
        synchronisent l'un après l'autre. Lève RiotApiError en cas d'échec."""
        account = next((a for a in vault.list_accounts() if a.name == name), None)
        if account is None or not account.riot_id:
            raise riot_api.RiotApiError("Riot ID inconnu pour ce compte.")
        with _riot_lock:
            points, solo = riot_api.backfill_history(account.riot_id, account.region, count)
        total = vault.merge_rank_history(name, points)
        # Le rang affiché (en-tête du RankDetailDialog, carte de compte) vient de
        # meta["rank"], alimenté par le LCU — donc figé tant que ce compte n'est
        # pas celui connecté. On le recale ici sur la donnée EXACTE League-V4,
        # sinon le graphe se met à jour mais pas les LP au-dessus. Le flex est
        # préservé (la Riot API n'est interrogée que pour la SoloQ), et lp_delta
        # n'est pas touché : un rattrapage couvre souvent plusieurs parties.
        vault.update_profile(name, rank={**(account.rank or {}), "solo": solo},
                             track_lp_delta=False)
        vault.set_riot_last_sync(name, time.time())
        return len(points), total

    def _auto_riot_sync(self, name: str):
        """Sync silencieux déclenché une seule fois, la première fois que le Riot
        ID d'un compte fraîchement ajouté devient connu (pas de throttle : c'est
        la toute première fois, il n'y a rien à protéger)."""
        try:
            added, total = self._sync_riot(name, count=20)
            self._broadcast("riot_sync_done", {"name": name, "added": added, "total": total, "auto": True})
            self._broadcast("accounts_changed", None)
        except riot_api.RiotApiError:
            pass  # sync auto silencieux : ne pas alarmer l'utilisateur sur un premier ajout
        except Exception:
            pass

    def _refresh_riot(self, name: str | None):
        """Rafraîchissement manuel (bouton dans le RankDetailDialog), throttlé à
        une fois par 24h et par compte pour respecter le budget de requêtes."""
        if not name:
            self._json(400, {"error": "name requis"})
            return
        account = next((a for a in vault.list_accounts() if a.name == name), None)
        if account is None:
            self._json(404, {"error": f"Compte « {name} » introuvable."})
            return
        if not account.riot_id:
            self._json(400, {"error": "Riot ID inconnu pour ce compte "
                             "(fais un swap ou une sauvegarde d'abord)."})
            return
        last_sync = vault.riot_last_sync(name)
        if last_sync is not None:
            elapsed = time.time() - last_sync
            if elapsed < _RIOT_SYNC_COOLDOWN:
                remaining_m = math.ceil((_RIOT_SYNC_COOLDOWN - elapsed) / 60)
                self._json(429, {"error": f"Prochain rafraîchissement possible dans {remaining_m} min.",
                                 "retry_after_mins": remaining_m})
                return
        self._json(202, {"started": True})

        def run():
            try:
                added, total = self._sync_riot(name, count=20)
                self._broadcast("riot_sync_done", {"name": name, "added": added, "total": total, "auto": False})
                self._broadcast("accounts_changed", None)
            except riot_api.RiotApiError as e:
                self._broadcast("riot_sync_error", {"name": name, "error": str(e)})
            except Exception as e:  # défensif : ne jamais planter le serveur
                self._broadcast("riot_sync_error", {"name": name, "error": f"Erreur inattendue : {e}"})
            finally:
                import gc
                gc.collect()

        threading.Thread(target=run, daemon=True).start()

    def _set_pinned(self, name: str, pinned: bool, product: str = "league_of_legends"):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        if product not in process.PRODUCTS:
            self._json(400, {"error": "produit Riot inconnu"})
            return
        try:
            vault.set_pinned(name, pinned, product)
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
            return
        self._json(200, {"ok": True})
        self._broadcast("accounts_changed", None)

    def _set_valorant_tutorial(self, name: str, confirmed: bool):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        try:
            vault.update_valorant(name, initialized=True, tutorial_confirmed=confirmed)
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
            return
        self._json(200, {"ok": True})
        self._broadcast("accounts_changed", None)

    def _refresh_valorant(self, name: str):
        """Actualise les statistiques VALORANT via HenrikDev hors thread HTTP."""
        if not name:
            self._json(400, {"error": "name requis"})
            return
        account = next((a for a in vault.list_accounts() if a.name == name), None)
        if account is None:
            self._json(404, {"error": f"Compte « {name} » introuvable."})
            return
        if not account.riot_id:
            self._json(400, {"error": "Riot ID inconnu pour ce compte (fais un swap d'abord)."})
            return
        existing = (account.valorant or {}).get("stats")
        if isinstance(existing, dict) and isinstance(existing.get("last_synced"), (int, float)):
            remaining = _VALORANT_SYNC_COOLDOWN - (time.time() - existing["last_synced"])
            if remaining > 0:
                self._json(429, {"error": f"Prochain rafraîchissement dans {math.ceil(remaining)} s.", "retry_after": math.ceil(remaining)})
                return
        self._json(202, {"started": True})

        def run():
            try:
                summary = valorant_api.fetch_summary(account.riot_id, account.region)
                vault.update_valorant(name, stats=summary)
                self._broadcast("valorant_sync_done", {"name": name})
                self._broadcast("accounts_changed", None)
            except valorant_api.ValorantApiError as e:
                self._broadcast("valorant_sync_error", {"name": name, "error": str(e), "code": e.code})
            except Exception:
                self._broadcast("valorant_sync_error", {"name": name, "error": "Erreur inattendue lors de l'actualisation Valorant.", "code": "unexpected"})
            finally:
                import gc
                gc.collect()

        threading.Thread(target=run, daemon=True).start()

    def _set_note(self, name: str, note: str):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        try:
            vault.set_note(name, note)
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
            return
        self._json(200, {"ok": True})
        self._broadcast("accounts_changed", None)

    def _reconnect(self, name: str | None, queue_id: int | None = None):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        with _swap_lock:
            global _swap_busy
            if _swap_busy:
                self._json(409, {"error": "une opération est déjà en cours"})
                return
            _swap_busy = True
        self._json(202, {"started": True})

        def run():
            global _swap_busy
            try:
                resolved_queue = queue_id
                auto_join = True
                account = next((a for a in vault.list_accounts() if a.name == name), None)
                if account and account.post_swap:
                    if resolved_queue is None:
                        resolved_queue = account.post_swap.get("queue_id")
                    auto_join = account.post_swap.get("auto_join", True)

                core.reconnect_expired(name, on_status=lambda m: _broadcast_toast(m, "info"))
                if resolved_queue is not None and auto_join:
                    _joiner.set_pending(resolved_queue, account.position_prefs if account else None)
                self._broadcast("reconnect_done", name)
                _broadcast_toast(f"« {name} » reconnecté avec succès", "ok")
                threading.Thread(target=self._refresh_profile, daemon=True).start()
            except Exception as e:
                self._broadcast("reconnect_error", str(e))
                _broadcast_toast(str(e).split("\n")[0], "warn")
            finally:
                _swap_busy = False

        threading.Thread(target=run, daemon=True).start()

    def _export(self, names: list[str], password: str):
        if not names or not password:
            self._json(400, {"error": "sélection de comptes et mot de passe requis"})
            return
        data = export_import.export_accounts(names, password)
        filename = f"hexgate-export-{time.strftime('%Y%m%d-%H%M%S')}.hexgate"
        self._json(200, {"filename": filename, "data": base64.b64encode(data).decode("ascii")})

    def _import(self, data_b64: str, password: str):
        if not data_b64 or not password:
            self._json(400, {"error": "fichier et mot de passe requis"})
            return
        try:
            imported = export_import.import_accounts(base64.b64decode(data_b64), password)
        except export_import.WrongPassword as e:
            self._json(400, {"error": str(e)})
            return
        except ValueError as e:
            self._json(400, {"error": str(e)})
            return
        self._json(200, {"imported": imported})
        if imported:
            self._broadcast("accounts_changed", None)

    # ---- actions asynchrones : diffusées via /events (SSE)

    def _start_swap(self, name: str | None, product: str = "league_of_legends",
                    queue_id: int | None = None):
        global _swap_busy
        if not name:
            self._json(400, {"error": "name requis"})
            return
        if product not in process.PRODUCTS:
            self._json(400, {"error": "produit Riot inconnu"})
            return
        with _swap_lock:
            if _swap_busy:
                self._json(409, {"error": "un swap est déjà en cours"})
                return
            _swap_busy = True
        self._json(202, {"started": True})
        threading.Thread(target=self._run_swap, args=(name, product, queue_id), daemon=True).start()

    def _backup_active_game_settings(self):
        """Sauvegarde les réglages de jeu du compte actuellement connecté, avant
        qu'un swap ne ferme son client (opt-in, ne doit jamais bloquer le swap)."""
        if not settings.get("game_settings_sync_enabled", False):
            return
        old_active = vault.get_active()
        if not old_active:
            return
        try:
            game = lcu_api.get_game_settings()
            inputs = lcu_api.get_input_settings()
            if game or inputs:
                vault.save_game_settings_backup(old_active, {"game": game, "input": inputs})
        except Exception:
            pass

    def _restore_game_settings_for_active(self):
        """Restaure les réglages de jeu sauvegardés pour le compte désormais actif
        (opt-in, best-effort — un échec ne doit jamais être visible de l'utilisateur)."""
        if not settings.get("game_settings_sync_enabled", False):
            return
        name = vault.get_active()
        if not name:
            return
        backup = vault.get_game_settings_backup(name)
        if not backup:
            return
        try:
            if backup.get("game"):
                lcu_api.set_game_settings(backup["game"])
            if backup.get("input"):
                lcu_api.set_input_settings(backup["input"])
        except Exception:
            pass

    def _run_swap(self, name: str, product: str = "league_of_legends",
                  queue_id: int | None = None):
        global _swap_busy
        try:
            resolved_queue = queue_id
            auto_join = True
            account = next((a for a in vault.list_accounts() if a.name == name), None)
            if product == "league_of_legends" and account and account.post_swap:
                if resolved_queue is None:
                    resolved_queue = account.post_swap.get("queue_id")
                auto_join = account.post_swap.get("auto_join", True)

            if product == "league_of_legends":
                self._backup_active_game_settings()
            core.swap(name, product, on_status=lambda m: self._broadcast("swap_status", m))
            if product == "valorant":
                # Le premier lancement valide le produit, mais le tutoriel reste
                # volontairement à confirmer par l'utilisateur.
                vault.update_valorant(name, initialized=True)
            if product == "league_of_legends" and resolved_queue is not None and auto_join:
                _joiner.set_pending(resolved_queue, account.position_prefs if account else None)
            self._broadcast("swap_done", name)
            if product == "league_of_legends":
                threading.Thread(target=self._refresh_profile, daemon=True).start()
            else:
                self._broadcast("accounts_changed", None)
        except Exception as e:
            self._broadcast("swap_error", str(e))
        finally:
            _swap_busy = False

    def _start_queue(self, queue_id):
        """Lance la file pour le compte DÉJÀ connecté (bouton « Lancer (file) » de
        la carte active), sans passer par un swap : le client est déjà ouvert et le
        profil chargé, on pilote donc directement le LCU (création du lobby, rôles
        préférés puis matchmaking). Répond 202 IMMÉDIATEMENT et travaille en tâche
        de fond : l'UI n'attend rien, elle bascule d'elle-même sur le badge lobby /
        file via la détection push. Erreurs remontées en toast (SSE)."""
        if not isinstance(queue_id, int):
            self._json(400, {"error": "queue_id requis"})
            return
        active = vault.get_active()
        account = next((a for a in vault.list_accounts() if a.name == active), None) if active else None
        prefs = account.position_prefs if account else None
        self._json(202, {"started": True})

        def run():
            print(f"[queue] demande file {queue_id}", flush=True)
            if not _ensure_league_client_ready():
                print("[queue] client non prêt, abandon", flush=True)
                return  # message déjà diffusé en toast
            try:
                # Le LCU répond et le profil est chargé, mais le client finit
                # encore de s'initialiser sur un démarrage à froid : les appels
                # lobby renvoient 500 pendant quelques secondes. Un seul refus ne
                # doit pas faire abandonner l'automatisation — on réessaie,
                # comme le fait le QueueJoiner du chemin swap.
                if not _retry(lambda: lcu_api.create_lobby(queue_id), "create_lobby"):
                    _broadcast_toast("Création du lobby échouée", "warn")
                    return
                time.sleep(1.5)
                if prefs and queue_id in (420, 440, 400):
                    try:
                        lcu_api.set_position_preferences(prefs.get("first"), prefs.get("second"))
                    except Exception as e:
                        print(f"[queue] préférences de rôle ignorées : {e}", flush=True)
                if not _retry(lcu_api.start_matchmaking, "start_matchmaking"):
                    _broadcast_toast("Lancement du matchmaking échoué", "warn")
                else:
                    print("[queue] matchmaking lancé", flush=True)
            except lcu_api.LeagueNotRunning:
                _broadcast_toast("Client League introuvable", "warn")
            except Exception as e:
                print(f"[queue] erreur : {e}", flush=True)
                _broadcast_toast(str(e).split("\n")[0], "warn")

        threading.Thread(target=run, daemon=True).start()

    def _capture(self, name: str | None):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        try:
            account = core.capture_current(name)
        except (ValueError, FileNotFoundError, OSError) as e:
            self._json(400, {"error": str(e)})
            return
        self._json(200, {"account": _account_to_dict(account)})
        _broadcast_toast(f"Session de « {account.name} » sauvegardée", "ok")
        threading.Thread(target=self._refresh_profile, daemon=True).start()

    def _add_account(self, product: str = "league_of_legends"):
        if product not in process.PRODUCTS:
            self._json(400, {"error": "produit Riot inconnu"})
            return
        self._json(202, {"started": True})
        def run():
            try:
                core.prepare_new_login(product, on_status=lambda _m: None)
                self._broadcast("accounts_changed", None)
            except Exception as e:
                self._broadcast("swap_error", str(e))
        threading.Thread(target=run, daemon=True).start()

    def _refresh_profile(self):
        if core.update_active_profile(timeout=150):
            self._restore_game_settings_for_active()
            self._broadcast("accounts_changed", None)
            name = vault.get_active()
            # Compte fraîchement connecté (Riot ID vient d'être découvert) et
            # jamais encore synchronisé avec la Riot API → un seul sync auto,
            # silencieux, pour peupler le cache dès l'ajout du compte.
            if name and vault.riot_last_sync(name) is None:
                threading.Thread(target=self._auto_riot_sync, args=(name,), daemon=True).start()

    def _set_goal(self, name: str, tier: str | None, division: str | None):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        try:
            vault.set_goal(name, tier, division)
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
            return
        self._json(200, {"ok": True})
        self._broadcast("accounts_changed", None)

    def _set_post_swap(self, name: str, queue_id: int | None, auto_join: bool):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        try:
            vault.set_post_swap(name, queue_id, auto_join)
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
            return
        self._json(200, {"ok": True})
        self._broadcast("accounts_changed", None)

    def _sync_matches(self, name: str, count: int = 20) -> int:
        account = next((a for a in vault.list_accounts() if a.name == name), None)
        if account is None or not account.riot_id:
            raise riot_api.RiotApiError("Riot ID inconnu pour ce compte.")
        with _riot_lock:
            matches = riot_api.fetch_match_history(account.riot_id, account.region, count)
        total = vault.merge_matches(name, matches)
        return total

    def _refresh_matches(self, name: str):
        if not name:
            self._json(400, {"error": "name requis"})
            return
        account = next((a for a in vault.list_accounts() if a.name == name), None)
        if account is None:
            self._json(404, {"error": f"Compte « {name} » introuvable."})
            return
        if not account.riot_id:
            self._json(400, {"error": "Riot ID inconnu pour ce compte (fais un swap d'abord)."})
            return
        
        self._json(202, {"started": True})

        def run():
            try:
                total = self._sync_matches(name, count=20)
                self._broadcast("matches_done", {"name": name, "count": total})
                self._broadcast("accounts_changed", None)
            except riot_api.RiotApiError as e:
                self._broadcast("matches_error", {"name": name, "error": str(e), "code": "key_expired" if "401" in str(e) or "403" in str(e) else "api_error"})
            except Exception as e:
                self._broadcast("matches_error", {"name": name, "error": f"Erreur inattendue : {e}"})
            finally:
                import gc
                gc.collect()

        threading.Thread(target=run, daemon=True).start()

    def _broadcast(self, event_type: str, data):
        _broadcast_event(event_type, data)
        if event_type == "accounts_changed":
            threading.Thread(target=_auto_sync_cloud, daemon=True).start()

    def _stream_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        q: queue.Queue = queue.Queue()
        _toast_subscribers.append(q)
        try:
            while True:
                event = q.get()
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionAbortedError, OSError):
            pass
        finally:
            _toast_subscribers.remove(q)


# Contexte SSL du Live Client Data (port 2999) : créé UNE fois, pas à chaque tick.
_LIVE_CTX = ssl.create_default_context()
_LIVE_CTX.check_hostname = False
_LIVE_CTX.verify_mode = ssl.CERT_NONE


def get_live_game_data() -> dict | None:
    try:
        req = urllib.request.Request("https://127.0.0.1:2999/liveclientdata/allgamedata", headers={"User-Agent": "lol-switcher"})
        with urllib.request.urlopen(req, context=_LIVE_CTX, timeout=2) as r:
            return json.loads(r.read())
    except Exception:
        return None


def get_live_game_events() -> list | None:
    """Flux d'événements de la partie en cours (Live Client Data API, port 2999).

    None = API indisponible (hors partie / pas encore chargée), à distinguer d'une
    liste vide (partie chargée, aucun événement encore émis)."""
    try:
        req = urllib.request.Request("https://127.0.0.1:2999/liveclientdata/eventdata",
                                     headers={"User-Agent": "lol-switcher"})
        with urllib.request.urlopen(req, context=_LIVE_CTX, timeout=2) as r:
            return (json.loads(r.read()) or {}).get("Events") or []
    except Exception:
        return None


def is_obs_running() -> bool:
    try:
        cmd = 'tasklist /FI "IMAGENAME eq obs64.exe" /FI "IMAGENAME eq obs.exe" /FI "IMAGENAME eq streamlabs desktop.exe" /NH'
        output = subprocess.check_output(cmd, shell=True).decode('utf-8', errors='ignore')
        return "obs64.exe" in output.lower() or "obs.exe" in output.lower() or "streamlabs" in output.lower()
    except Exception:
        return False


_SAVE_DIALOG_KINDS = {
    "json": (".json", [("Fichiers JSON", "*.json"), ("Tous les fichiers", "*.*")]),
    "image": (".png", [("Image PNG", "*.png"), ("Image JPEG", "*.jpg;*.jpeg"),
                       ("Tous les fichiers", "*.*")]),
}


def _win_save_dialog(default_filename: str, ext: str, filetypes: list) -> str:
    """« Enregistrer sous » natif Windows (comdlg32.GetSaveFileNameW).

    tkinter n'est PAS utilisable ici : les requêtes HTTP sont servies par des
    threads de travail, et un `Tk()` créé hors du thread principal rend la main
    aussitôt sans jamais afficher de fenêtre — le fichier atterrissait alors
    silencieusement sur le Bureau. L'API Win32, elle, est appelable depuis
    n'importe quel thread pourvu qu'il soit initialisé en COM apartment.
    """
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD), ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE), ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR), ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD), ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD), ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD), ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR), ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD), ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR), ("lCustData", wintypes.LPARAM),
            ("lpfnHook", wintypes.LPVOID), ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", wintypes.LPVOID), ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    ole32 = ctypes.windll.ole32
    # COINIT_APARTMENTTHREADED : requis par les extensions shell du sélecteur.
    # S_FALSE / RPC_E_CHANGED_MODE = déjà initialisé, ce n'est pas une erreur.
    hr = ole32.CoInitializeEx(None, 0x2)
    try:
        # Filtres : paires « libellé\0motif\0 », terminées par un \0 supplémentaire.
        spec = "".join(f"{label}\0{pattern}\0" for label, pattern in filetypes) + "\0"
        buf = ctypes.create_unicode_buffer(default_filename, 32768)
        ofn = OPENFILENAMEW()
        ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
        ofn.lpstrFilter = spec
        ofn.nFilterIndex = 1
        ofn.lpstrFile = ctypes.cast(buf, wintypes.LPWSTR)
        ofn.nMaxFile = 32768
        ofn.lpstrDefExt = ext.lstrip(".")
        # OVERWRITEPROMPT | NOCHANGEDIR | PATHMUSTEXIST | EXPLORER
        ofn.Flags = 0x2 | 0x8 | 0x800 | 0x80000
        if ctypes.windll.comdlg32.GetSaveFileNameW(ctypes.byref(ofn)):
            return buf.value
        err = ctypes.windll.comdlg32.CommDlgExtendedError()
        if err:
            raise OSError(f"GetSaveFileNameW a échoué (code {err})")
        return ""  # annulation utilisateur
    finally:
        if hr in (0, 1):  # S_OK / S_FALSE : c'est nous qui avons initialisé
            ole32.CoUninitialize()


def save_file_dialog(default_filename: str, kind: str = "json") -> str:
    """Chemin choisi par l'utilisateur, ou "" s'il a annulé."""
    ext, filetypes = _SAVE_DIALOG_KINDS.get(kind, _SAVE_DIALOG_KINDS["json"])
    if sys.platform == "win32":
        try:
            return _win_save_dialog(default_filename, ext, filetypes)
        except Exception as e:
            print(f"[HEXGATE][dialog] sélecteur natif indisponible : {e!r}", flush=True)
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.asksaveasfilename(
            defaultextension=ext,
            filetypes=filetypes,
            initialfile=default_filename,
        )
        root.destroy()
        return path
    except Exception as e:
        # Plus de repli silencieux vers le Bureau : écrire ailleurs que là où
        # l'utilisateur l'a demandé est pire que de signaler l'échec.
        print(f"[HEXGATE][dialog] aucun sélecteur disponible : {e!r}", flush=True)
        return ""


def _png_to_jpeg(png_bytes: bytes) -> bytes | None:
    """Convertit un PNG en JPEG (fond noir : le JPEG n'a pas de canal alpha)."""
    try:
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(png_bytes))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            flat = Image.new("RGB", img.size, (1, 10, 19))
            flat.paste(img, mask=img.split()[-1])
            img = flat
        else:
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=95)
        return out.getvalue()
    except Exception:
        return None


# --- Ping par serveur League -------------------------------------------------
#
# Chaque région a deux sondes, essayées dans cet ordre :
#   1. `riot` : l'IP publiée du bloc « Riot Direct » (104.160.128.0/19), c'est-à-dire
#      la vraie passerelle de jeu de la région. C'est la mesure qui compte, mais
#      Riot filtre ICMP/TCP depuis certains réseaux : elle échoue alors en silence.
#   2. `geo` : un point de terminaison régional joignable, situé dans la même ville
#      (ou la plus proche) que le datacenter League. Ce n'est PAS le serveur de jeu :
#      la valeur est une approximation de la latence réseau vers cette zone
#      géographique, remontée avec estimated=True pour que l'UI l'affiche comme telle.
LOL_SERVERS: list[dict] = [
    # id,   libellé,                       ville,          IP Riot Direct,   sonde géographique
    {"id": "EUW1", "label": "EUW",  "city": "Amsterdam",    "riot": "104.160.141.3", "geo": "dynamodb.eu-west-2.amazonaws.com"},
    {"id": "EUN1", "label": "EUNE", "city": "Frankfurt",    "riot": "104.160.142.3", "geo": "dynamodb.eu-central-1.amazonaws.com"},
    {"id": "NA1",  "label": "NA",   "city": "Chicago",      "riot": "104.160.131.3", "geo": "dynamodb.us-east-2.amazonaws.com"},
    {"id": "BR1",  "label": "BR",   "city": "São Paulo",    "riot": "104.160.152.3", "geo": "dynamodb.sa-east-1.amazonaws.com"},
    {"id": "LA1",  "label": "LAN",  "city": "Miami",        "riot": "104.160.136.3", "geo": "dynamodb.us-east-1.amazonaws.com"},
    {"id": "LA2",  "label": "LAS",  "city": "Santiago",     "riot": None,            "geo": "dynamodb.sa-east-1.amazonaws.com"},
    {"id": "OC1",  "label": "OCE",  "city": "Sydney",       "riot": "104.160.156.1", "geo": "dynamodb.ap-southeast-2.amazonaws.com"},
    {"id": "JP1",  "label": "JP",   "city": "Tokyo",        "riot": None,            "geo": "dynamodb.ap-northeast-1.amazonaws.com"},
    {"id": "KR",   "label": "KR",   "city": "Seoul",        "riot": None,            "geo": "dynamodb.ap-northeast-2.amazonaws.com"},
    {"id": "TR1",  "label": "TR",   "city": "Istanbul",     "riot": None,            "geo": "dynamodb.eu-south-1.amazonaws.com"},
    {"id": "RU",   "label": "RU",   "city": "Moscow",       "riot": None,            "geo": "dynamodb.eu-north-1.amazonaws.com"},
    {"id": "ME1",  "label": "ME",   "city": "Riyadh",       "riot": None,            "geo": "dynamodb.me-south-1.amazonaws.com"},
    {"id": "SG2",  "label": "SG",   "city": "Singapore",    "riot": None,            "geo": "dynamodb.ap-southeast-1.amazonaws.com"},
    {"id": "PH2",  "label": "PH",   "city": "Singapore",    "riot": None,            "geo": "dynamodb.ap-southeast-1.amazonaws.com"},
    {"id": "TH2",  "label": "TH",   "city": "Singapore",    "riot": None,            "geo": "dynamodb.ap-southeast-1.amazonaws.com"},
    {"id": "VN2",  "label": "VN",   "city": "Singapore",    "riot": None,            "geo": "dynamodb.ap-southeast-1.amazonaws.com"},
    {"id": "TW2",  "label": "TW",   "city": "Hong Kong",    "riot": None,            "geo": "dynamodb.ap-east-1.amazonaws.com"},
]
DEFAULT_PING_REGION = "EUW1"


def get_ping_region() -> dict:
    """Serveur sélectionné pour la jauge de ping (repli EUW si valeur inconnue)."""
    wanted = settings.get("ping_region", DEFAULT_PING_REGION)
    return next(
        (s for s in LOL_SERVERS if s["id"] == wanted),
        next(s for s in LOL_SERVERS if s["id"] == DEFAULT_PING_REGION),
    )


def _tcp_rtt(host: str, port: int, timeout: float) -> int | None:
    import socket
    t0 = time.perf_counter()
    try:
        s = socket.create_connection((host, port), timeout=timeout)
        s.close()
        return int((time.perf_counter() - t0) * 1000)
    except Exception:
        return None


# `temps=25 ms` (FR), `time=25ms` (EN), `temps<1 ms` : on ne dépend d'aucune
# locale, seulement du motif « (= ou <) nombre ms » de la ligne de réponse.
_ICMP_MS = re.compile(rb"[=<]\s*(\d+)\s*ms")


def _icmp_rtt(host: str, timeout: float) -> int | None:
    """RTT ICMP réel via ping.exe. None = aucune réponse.

    C'est la seule mesure comparable à la latence affichée en jeu. Une poignée
    de main TCP, elle, ajoute le temps de traitement du serveur et l'attente
    dans son répartiteur de charge : mesurée le 26/07 sur le même hôte, elle
    donnait 27 à 82 ms là où ICMP donnait 24-25 ms de façon stable, alors que
    l'utilisateur tournait à 25 ms en partie. C'est ce qui rendait la jauge
    fausse et sautante, pas le choix de la cible.
    """
    try:
        out = subprocess.run(
            ["ping", "-n", "1", "-w", str(int(timeout * 1000)), host],
            capture_output=True, timeout=timeout + 2.0,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout
    except Exception:
        return None
    # Recherche sur les octets bruts : ping.exe écrit dans la page de code OEM,
    # qu'il faudrait deviner pour décoder — or le motif cherché est en ASCII.
    m = _ICMP_MS.search(out)
    return int(m.group(1)) if m else None


# Une sonde muette coûte un timeout plein à *chaque* mesure. Riot filtre ICMP
# comme TCP depuis beaucoup de réseaux — c'est le cas ici, 100 % de perte vers
# 104.160.141.3 — donc on la met en quarantaine après trois échecs d'affilée
# plutôt que de payer 2,4 s toutes les deux secondes. Le seuil évite qu'un
# simple hoquet réseau fasse disparaître la jauge, et la quarantaine expire :
# un changement de réseau ou de politique doit pouvoir ranimer la sonde.
_PROBE_FAILS_BEFORE_QUARANTINE = 3
_PROBE_QUARANTINE_S = 300.0
_probe_fails: dict[str, int] = {}
_probe_retry_at: dict[str, float] = {}


def _probe(host: str, timeout: float) -> int | None:
    """Meilleure mesure disponible vers un hôte : ICMP d'abord, TCP en repli."""
    if time.monotonic() < _probe_retry_at.get(host, 0.0):
        return None
    rtt = _icmp_rtt(host, timeout)
    if rtt is None:
        # Certains réseaux filtrent ICMP sans filtrer le 443 : la valeur est
        # moins juste, mais elle vaut mieux que « injoignable ».
        rtt = _tcp_rtt(host, 443, timeout)
    if rtt is not None:
        _probe_fails.pop(host, None)
        return rtt
    fails = _probe_fails.get(host, 0) + 1
    if fails >= _PROBE_FAILS_BEFORE_QUARANTINE:
        _probe_retry_at[host] = time.monotonic() + _PROBE_QUARANTINE_S
        fails = 0
    _probe_fails[host] = fails
    return None


def measure_region_ping(server: dict, timeout: float = 2.0) -> tuple[int, bool]:
    """(latence_ms, estimée) vers un serveur League. latence -1 = injoignable."""
    if server.get("riot"):
        rtt = _probe(server["riot"], min(timeout, 1.2))
        if rtt is not None:
            return rtt, False
    if server.get("geo"):
        rtt = _probe(server["geo"], timeout)
        if rtt is not None:
            return rtt, True
    return -1, False


def measure_ping() -> int:
    """Latence vers le serveur League sélectionné (compat : valeur seule)."""
    return measure_region_ping(get_ping_region())[0]


def save_champ_select_log(active_account: str, messages: list, session_id: int):
    try:
        from . import paths
        from pathlib import Path
        acc_dir = paths.ACCOUNTS_DIR / active_account
        if not acc_dir.is_dir():
            return
        log_dir = acc_dir / "selection_chats"
        log_dir.mkdir(parents=True, exist_ok=True)
        file_path = log_dir / f"chat_{session_id}.txt"
        
        lines = []
        for m in messages:
            sender = m.get("fromName") or m.get("fromObfuscatedName") or "Invocateur"
            body = m.get("body") or ""
            ts = m.get("timestamp") or ""
            if "T" in ts:
                time_str = ts.split("T")[1].split("Z")[0].split(".")[0]
            else:
                time_str = time.strftime("%H:%M:%S", time.localtime())
            lines.append(f"[{time_str}] {sender}: {body}")
            
        with open(file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"[HEXGATE] Journal de sélection sauvegardé pour {active_account} : {file_path}")
    except Exception as e:
        print("[HEXGATE] Erreur lors de la sauvegarde du chat de sélection:", e)


_current_champ_select_messages = []
_current_champ_select_id = None
_seen_ids = set()
_seen_keys = set()


# Focus de la fenêtre principale, signalé par le frontend (POST /ui-focus).
# Quand personne ne regarde l'app, mesurer le ping toutes les 10 s ne sert à
# rien : cadence réduite à ~60 s, retour immédiat à la cadence rapide au focus.
_ui_active = True
_ui_focus_changed = threading.Event()

# Levé quand l'utilisateur change de serveur dans l'en-tête : coupe la série de
# mesures en cours pour rebasculer immédiatement sur le nouveau serveur.
_ping_region_changed = threading.Event()


def _broadcast_ping(server: dict, latency: int, estimated: bool):
    _broadcast_event("ping_update", {
        "latency": latency,
        "region": server["id"],
        "label": server["label"],
        "city": server["city"],
        "estimated": estimated,
    })


def start_ping_watcher():
    while True:
        try:
            # Relu à chaque tour : changer de serveur dans l'UI prend effet au
            # tour suivant sans redémarrer le thread.
            server = get_ping_region()
            if _ui_active and not settings.get("low_power_mode", False):
                samples = []
                estimated = False
                for _ in range(5):
                    latency, est = measure_region_ping(server)
                    if latency != -1:
                        samples.append(latency)
                        estimated = est
                    # Interruptible : un changement de serveur coupe la série en cours.
                    if _ping_region_changed.wait(timeout=2):
                        break
                if _ping_region_changed.is_set():
                    _ping_region_changed.clear()
                    continue
                # Médiane et non moyenne : un seul échantillon aberrant (une
                # retransmission, un coup de charge Wi-Fi) tirait la valeur
                # affichée vers le haut alors que la latence réelle n'avait pas
                # bougé. La médiane l'ignore par construction.
                median_latency = sorted(samples)[len(samples) // 2] if samples else -1
                _broadcast_ping(server, median_latency, estimated)
            else:
                # Arrière-plan : un seul échantillon, puis attente longue,
                # interrompue immédiatement si la fenêtre reprend le focus.
                latency, estimated = measure_region_ping(server)
                _broadcast_ping(server, latency, estimated)
                _ui_focus_changed.wait(timeout=60)
                _ui_focus_changed.clear()
        except Exception:
            time.sleep(2)


def start_background_watcher():
    global _current_champ_select_messages, _current_champ_select_id, _seen_ids, _seen_keys
    last_obs_state = None
    last_obs_check = 0.0
    while True:
        # Phase lue en mémoire (bus push) : zéro appel LCU ici. Cadence : 8 s en
        # ChampSelect (chat logger), 30 s sinon (OBS + idle n'ont pas besoin de plus).
        sleep_s = 8 if _gameflow_watcher.phase == "ChampSelect" else 30
        try:
            # 1. OBS (subprocess tasklist : au plus toutes les 30 s)
            if time.monotonic() - last_obs_check >= 30:
                last_obs_check = time.monotonic()
                obs_state = is_obs_running()
                if obs_state != last_obs_state:
                    last_obs_state = obs_state
                    _broadcast_event("obs_status", {"running": obs_state})

            # 2. Idle Alert & Chat Logger
            try:
                phase = _gameflow_watcher.phase

                # Chat Logger Check
                if phase == "ChampSelect":
                    if _current_champ_select_id is None:
                        _current_champ_select_id = int(time.time())
                        _current_champ_select_messages = []
                        _seen_ids = set()
                        _seen_keys = set()
                    
                    new_msgs = lcu_api.get_lobby_chat_messages()
                    for m in new_msgs:
                        msg_id = m.get("id")
                        if msg_id:
                            if msg_id not in _seen_ids:
                                _seen_ids.add(msg_id)
                                _current_champ_select_messages.append(m)
                        else:
                            key = (m.get("body"), m.get("fromName"), m.get("timestamp"))
                            if key not in _seen_keys:
                                _seen_keys.add(key)
                                _current_champ_select_messages.append(m)
                else:
                    if _current_champ_select_id is not None:
                        active = vault.get_active()
                        if active:
                            save_champ_select_log(active, _current_champ_select_messages, _current_champ_select_id)
                        _current_champ_select_id = None
                        _current_champ_select_messages = []
                        _seen_ids = set()
                        _seen_keys = set()

            except lcu_api.LeagueNotRunning:
                if _current_champ_select_id is not None:
                    active = vault.get_active()
                    if active:
                        save_champ_select_log(active, _current_champ_select_messages, _current_champ_select_id)
                    _current_champ_select_id = None
                    _current_champ_select_messages = []
                    _seen_ids = set()
                    _seen_keys = set()
        except Exception:
            pass
        # Réveillé immédiatement par tout changement de phase (entrée en champ
        # select → le chat logger démarre sans attendre la fin du sleep long).
        _gameflow_watcher.wait_phase_change(timeout=sleep_s)


_last_in_lobby = False
_muted_this_game = False
_riot_closed_this_game = False
_dismissed_end_of_game = False


class _SkipTick(Exception):
    """Sentinelle interne : abandonne le tour de boucle courant (rien à faire)."""

def start_lcu_automation_watcher():
    global _last_in_lobby, _muted_this_game, _riot_closed_this_game, _dismissed_end_of_game
    while True:
        # Cadence pilotée par la phase (bus push, zéro appel gameflow) : le poll
        # rapide n'existe QUE si une automatisation concernée par la phase
        # courante est réellement activée ; sinon on dort jusqu'au prochain
        # changement de phase (réveil instantané via la Condition du bus).
        fast_tick = False
        try:
            phase = _gameflow_watcher.phase

            if phase in ("None", "Lobby"):
                _muted_this_game = False
                _riot_closed_this_game = False
                _dismissed_end_of_game = False
                lobby_features_on = bool(
                    settings.get("auto_accept_invitations", False)
                    or settings.get("lobby_welcome_message", "")
                )
                fast_tick = lobby_features_on
                if not lobby_features_on:
                    _last_in_lobby = False
                    raise _SkipTick
                if settings.get("auto_accept_invitations", False):
                    invs = lcu_api.get_received_invitations()
                    for inv in invs:
                        inv_id = inv.get("invitationId")
                        state = inv.get("state")
                        if inv_id and state == "Pending":
                            lcu_api.accept_lobby_invitation(inv_id)

                has_lobby = False
                try:
                    status, _ = lcu_api._call("GET", "/lol-lobby/v2/lobby")
                    has_lobby = (status == 200)
                except Exception:
                    pass

                if has_lobby and not _last_in_lobby:
                    welcome_msg = settings.get("lobby_welcome_message", "")
                    if welcome_msg:
                        def delayed_welcome(msg=welcome_msg):
                            time.sleep(1.5)
                            try:
                                lcu_api.send_lobby_welcome_message(msg)
                            except Exception:
                                pass
                        threading.Thread(target=delayed_welcome, daemon=True).start()
                    _last_in_lobby = True
                elif not has_lobby:
                    _last_in_lobby = False

            elif phase == "ChampSelect":
                _muted_this_game = False
                _riot_closed_this_game = False
                sniper_champs = settings.get("aram_sniper_champions", "")
                fast_tick = bool(sniper_champs)
                if sniper_champs:
                    fav_list = [c.strip().lower() for c in sniper_champs.split(",") if c.strip()]
                    if fav_list:
                        try:
                            status, body = lcu_api._call("GET", "/lol-champ-select/v1/session")
                            if status == 200:
                                session = json.loads(body)
                                bench = session.get("benchChampions", [])
                                for bench_champ in bench:
                                    cid = bench_champ.get("championId")
                                    if cid:
                                        cname = lcu_api.get_champion_name_by_id(cid).lower()
                                        if cname in fav_list:
                                            lcu_api.swap_bench_champion(cid)
                        except Exception:
                            pass
            elif phase == "InProgress":
                if not _riot_closed_this_game:
                    _riot_closed_this_game = True
                    if settings.get("riot_client_auto_close", False):
                        import subprocess
                        subprocess.run(
                            ["taskkill", "/F",
                             "/IM", "RiotClientServices.exe", "/IM", "Riot Client.exe",
                             "/IM", "RiotClientUx.exe", "/IM", "RiotClientUxRender.exe"],
                            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
                        )
                if not _muted_this_game:
                    _muted_this_game = True
                    if settings.get("auto_mute_all_on_start", False):
                        def delayed_mute():
                            time.sleep(25)
                            # La frappe est refusée si le jeu n'est pas au premier
                            # plan (alt-tab pendant le chargement) : on retente
                            # quelques fois avant d'abandonner.
                            for _ in range(6):
                                try:
                                    if _gameflow_watcher.phase != "InProgress":
                                        return
                                    if process.execute_in_game_command("/mute all"):
                                        return
                                except Exception:
                                    return
                                time.sleep(5)
                        threading.Thread(target=delayed_mute, daemon=True).start()
            elif phase == "EndOfGame":
                if not _dismissed_end_of_game and settings.get("skip_end_of_game", False):
                    _dismissed_end_of_game = True
                    try:
                        lcu_api.dismiss_end_of_game_stats()
                    except Exception:
                        pass
            else:
                _muted_this_game = False
                _riot_closed_this_game = False
        except _SkipTick:
            pass
        except Exception:
            pass
        if fast_tick:
            time.sleep(1.5)
        else:
            _gameflow_watcher.wait_phase_change(timeout=15)


def start_champ_select_watcher():
    """Auto-déclaration d'intention, auto-pick, auto-ban et message de chat
    prédéfini en champ select, selon les préférences du compte connecté."""
    chat_sent = False
    declared_actions: set[int] = set()
    acted_actions: set[int] = set()
    hovering_actions: set[int] = set()  # pick déjà survolé (intention déclarée), verrou en attente du délai
    while True:
        try:
            # Phase lue en mémoire (bus push) : hors sélection, AUCUN appel LCU —
            # le thread dort jusqu'au prochain changement de phase (réveil
            # instantané à l'entrée en champ select, filet 30 s).
            phase = _gameflow_watcher.phase
            if phase != "ChampSelect":
                chat_sent = False
                declared_actions.clear()
                acted_actions.clear()
                hovering_actions.clear()
                _gameflow_watcher.wait_phase_change(timeout=30)
                continue

            active_name = vault.get_active()
            account = next((a for a in vault.list_accounts() if a.name == active_name), None) if active_name else None
            prefs = {**vault.DEFAULT_CHAMP_SELECT, **((account.champ_select if account else None) or {})}

            session = lcu_api.champ_select_session()
            if not session:
                time.sleep(2)
                continue
            local_cell = session.get("localPlayerCellId")

            if prefs.get("chat_message_enabled") and (prefs.get("chat_message") or "").strip() and not chat_sent:
                chat_sent = True
                msg = prefs["chat_message"].strip()

                def send_msg(m=msg):
                    time.sleep(3)
                    try:
                        lcu_api.send_champ_select_message(m)
                    except Exception:
                        pass
                threading.Thread(target=send_msg, daemon=True).start()

            if not (prefs.get("auto_declare_intent") or prefs.get("auto_pick") or prefs.get("auto_ban")):
                time.sleep(2)
                continue

            role = ""
            for member in session.get("myTeam") or []:
                if member.get("cellId") == local_cell:
                    role = (member.get("assignedPosition") or "").upper()
                    break

            unavailable: set[int] = set()
            bans = session.get("bans") or {}
            unavailable.update(bans.get("myTeamBans") or [])
            unavailable.update(bans.get("theirTeamBans") or [])
            for member in (session.get("myTeam") or []) + (session.get("theirTeam") or []):
                cid = member.get("championId")
                if cid:
                    unavailable.add(cid)

            actions = [a for row in (session.get("actions") or []) for a in row]

            def resolve_pick() -> int | None:
                """Premier champion encore disponible dans la priorité du rôle joué."""
                priority = (prefs.get("priority_by_role") or {}).get(role) \
                    or (prefs.get("priority_by_role") or {}).get("ANY") or []
                for champ_name in priority:
                    cid = lcu_api.get_champion_id_by_name(champ_name)
                    if cid and cid not in unavailable:
                        return cid
                return None

            # Déclaration d'intention : elle doit se faire DÈS la phase de ban, pas
            # à son tour de pick — c'est tout l'intérêt (l'équipe voit le champion
            # survolé avant de bannir). L'action de pick n'est alors pas
            # `isInProgress`, donc elle est cherchée séparément de l'action courante.
            if prefs.get("auto_declare_intent"):
                my_pick_action = next(
                    (a for a in actions if a.get("actorCellId") == local_cell
                     and a.get("type") == "pick" and not a.get("completed")),
                    None,
                )
                if my_pick_action:
                    pick_action_id = my_pick_action.get("id")
                    if pick_action_id not in declared_actions and pick_action_id not in acted_actions:
                        intent_id = resolve_pick()
                        if intent_id:
                            declared_actions.add(pick_action_id)
                            ok = lcu_api.patch_champ_select_action(pick_action_id, intent_id, False)
                            print(f"[HEXGATE][champselect] intention actionId={pick_action_id} "
                                  f"champion={intent_id} role={role or '?'} ok={ok}", flush=True)
                            if not ok:
                                # Refus fréquent tant que la sélection n'est pas prête :
                                # on autorise une nouvelle tentative au tour suivant.
                                declared_actions.discard(pick_action_id)

            my_action = next(
                (a for a in actions if a.get("actorCellId") == local_cell
                 and a.get("isInProgress") and not a.get("completed")),
                None,
            )
            if not my_action:
                time.sleep(1.5)
                continue
            action_id = my_action.get("id")

            if my_action.get("type") == "ban" and prefs.get("auto_ban") and action_id not in acted_actions:
                ban_list = prefs.get("ban_priority") or []
                # Le client seul sait qui est réellement bannissable ; à défaut
                # (endpoint absent hors sélection) on ne filtre que sur `unavailable`
                # plutôt que de tout rejeter.
                bannable = lcu_api.bannable_champion_ids()
                resolved = [(n, lcu_api.get_champion_id_by_name(n)) for n in ban_list]

                def ban_possible(c: int | None) -> bool:
                    return bool(c) and c not in unavailable and (bannable is None or c in bannable)

                cid = next((c for _, c in resolved if ban_possible(c)), None)
                ecartes = [f"{n}={c}" for n, c in resolved if not ban_possible(c)]
                print(f"[HEXGATE][champselect] ban actionId={action_id} priority={ban_list} "
                      f"résolu={cid} écartés={ecartes or '-'} "
                      f"bannissables={'?' if bannable is None else len(bannable)} "
                      f"unavailable={sorted(unavailable)}", flush=True)
                if cid:
                    # En deux temps, comme le pick. Un PATCH unique `completed=True`
                    # est accepté par le client (204) puis silencieusement ignoré :
                    # c'est ce qui laissait le ban sans effet le 26/07 alors que
                    # l'appel était « réussi » et que l'intention, elle, passait.
                    survol = lcu_api.patch_champ_select_action(action_id, cid, False)
                    time.sleep(0.4)
                    verrou = lcu_api.patch_champ_select_action(action_id, cid, True)
                    print(f"[HEXGATE][champselect] ban champion={cid} survol={survol} "
                          f"verrou={verrou}", flush=True)
                    # Marqué « fait » seulement si le verrou a abouti : sinon un refus
                    # transitoire du client annulait le ban pour de bon.
                    if verrou:
                        acted_actions.add(action_id)
            elif my_action.get("type") == "pick":
                pick_id = resolve_pick()
                if pick_id and prefs.get("auto_pick") and action_id not in acted_actions and action_id not in hovering_actions:
                    # Déclare d'abord l'intention (survol, visible par l'équipe) puis
                    # ne verrouille qu'après un délai — comportement plus humain, et
                    # ça exerce systématiquement l'étape d'intention avant le lock.
                    hovering_actions.add(action_id)
                    lcu_api.patch_champ_select_action(action_id, pick_id, False)

                    def lock_after_delay(aid=action_id, cid=pick_id):
                        time.sleep(2)
                        try:
                            lcu_api.patch_champ_select_action(aid, cid, True)
                        finally:
                            acted_actions.add(aid)
                    threading.Thread(target=lock_after_delay, daemon=True).start()
                # Pas de branche « intention » ici : elle est déjà traitée plus haut,
                # dès la phase de ban, ce qui la rend utile au lieu d'arriver au
                # moment où il faut de toute façon verrouiller.
        except Exception as e:
            # Une exception muette rendait toute panne de l'automatisation
            # indiagnosticable côté utilisateur.
            print(f"[HEXGATE][champselect] erreur : {e!r}", flush=True)
        time.sleep(2)


# Nexus détruit : le seul événement de la Live Client Data API qui marque
# l'explosion. `GameEnd` arrive à l'instant même où le nexus saute, et le chat en
# jeu reste utilisable pendant l'animation Victoire/Défaite qui suit (~8 s) —
# c'est la fenêtre de tir du message.
_END_OF_GAME_EVENTS = {"GameEnd"}


def start_end_of_game_message_watcher():
    """Envoie un message pré-enregistré dans le chat en jeu quand le nexus explose.

    Dort tant qu'aucune partie n'est en cours ou que le réglage est vide : le
    sondage 1 s de la Live Client Data API n'existe que pendant une vraie partie
    avec la fonctionnalité activée."""
    sent_this_game = False
    while True:
        try:
            phase = _gameflow_watcher.phase
            message = (settings.get("end_of_game_message", "") or "").strip()

            if phase != "InProgress":
                sent_this_game = False
                _gameflow_watcher.wait_phase_change(timeout=30)
                continue
            if not message or sent_this_game:
                _gameflow_watcher.wait_phase_change(timeout=15)
                continue

            events = get_live_game_events()
            if events is None:
                # Partie pas encore chargée : on repasse dans 2 s.
                time.sleep(2)
                continue
            noms = {e.get("EventName") for e in events}
            if not (noms & _END_OF_GAME_EVENTS):
                # Le nexus ne tombe jamais sans qu'un inhibiteur soit tombé avant.
                # Tant qu'aucun ne l'est, un sondage lent suffit ; ensuite on serre
                # la maille pour que le message parte à l'explosion et non ~1 s
                # après, sans pour autant interroger l'API 5×/s pendant 30 minutes.
                time.sleep(0.2 if "InhibKilled" in noms else 1.0)
                continue

            sent_this_game = True
            # `/all` est nécessaire pour parler à tout le monde : la touche Entrée
            # ouvre le chat d'équipe par défaut dans League.
            text = message if settings.get("end_of_game_message_team_only", False) else f"/all {message}"
            for _ in range(6):
                if process.execute_in_game_command(text):
                    print("[HEXGATE][eog] message de fin de partie envoyé", flush=True)
                    break
                # Frappe refusée (jeu pas au premier plan) : on retente le temps
                # de l'animation de fin.
                time.sleep(1.2)
            else:
                print("[HEXGATE][eog] message non envoyé : jeu jamais au premier plan", flush=True)
        except Exception:
            time.sleep(2)


def start_friends_notification_watcher():
    """Relaie les passages en ligne des amis LCU en toasts Hexgate (opt-out).

    Event-driven : le bus WebSocket pousse chaque changement de présence
    (`_friends_poke`) → vérification immédiate. Filet périodique lent (60 s,
    contre 15 s de poll avant) au cas où le WebSocket serait indisponible."""
    known: dict[str, str] = {}
    first_pass = True
    online_states = {"chat", "online", "dnd", "mobile"}
    while True:
        try:
            if settings.get("relay_client_notifications", True):
                friends = lcu_api.get_friends()
                seen = set()
                for f in friends:
                    fid = f.get("id") or f.get("puuid")
                    if not fid:
                        continue
                    seen.add(fid)
                    availability = (f.get("availability") or "offline").lower()
                    was = known.get(fid)
                    if not first_pass and was is not None and was not in online_states and availability in online_states:
                        name = f.get("name") or f.get("gameName") or "Un ami"
                        _broadcast_toast(f"🟢 {name} est en ligne", "info")
                    known[fid] = availability
                for fid in list(known):
                    if fid not in seen:
                        del known[fid]
                first_pass = False
            else:
                known.clear()
                first_pass = True
        except Exception:
            pass
        _friends_poke.wait(timeout=60)
        _friends_poke.clear()


def start_hotkey_listener():
    import ctypes
    import time
    user32 = ctypes.windll.user32
    # vk → (clé de réglage, touche enfoncée au tick précédent)
    macros = {0x74: ["macro_f5_text", False], 0x75: ["macro_f6_text", False]}

    while True:
        try:
            for vk, state in macros.items():
                down = bool(user32.GetAsyncKeyState(vk) & 0x8000)
                if down and not state[1]:
                    # Défaut vide : les macros sont opt-in, et la frappe n'est de
                    # toute façon exécutée que si LoL est au premier plan
                    # (garde-fou dans process.execute_in_game_command).
                    text = settings.get(state[0], "")
                    if text:
                        from . import process
                        process.execute_in_game_command(text)
                state[1] = down
        except Exception:
            pass
        time.sleep(0.04)


def _auto_sync_cloud():
    sync_dir = settings.get("cloud_backup_path")
    if not sync_dir:
        return
    try:
        from pathlib import Path
        path = Path(sync_dir)
        if not path.exists() or not path.is_dir():
            return
        names = [a.name for a in vault.list_accounts()]
        if not names:
            return
        password = settings.get("cloud_backup_password", "hexgate-default-cloud-sync")
        bundle_bytes = export_import.export_accounts(names, password)
        target = path / "hexgate_cloud_backup.hexgate"
        from . import atomic_io
        atomic_io.write_bytes(target, bundle_bytes)
        print(f"[HEXGATE] Sauvegarde Cloud reussie dans {target}", flush=True)
    except Exception as e:
        print(f"[HEXGATE] Echec sauvegarde Cloud automatique : {e}", flush=True)


def run(port: int = 8722):
    log = applog.get_logger()
    log.info("démarrage: tentative d'acquisition exclusive du port %s", port)
    # Réserver le port AVANT sauvegardes et workers. Ainsi, même un lancement
    # manuel accidentel d'un second backend échoue sans toucher au coffre.
    try:
        server = _ExclusiveThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as error:
        log.warning("démarrage: port %s indisponible (%s) — second backend refusé", port, error)
        raise
    log.info("démarrage: port %s acquis", port)

    def _startup_backup():
        # En thread séparé : zippe + vérifie (testzip) tous les comptes, ce qui
        # peut prendre jusqu'à quelques secondes selon leur nombre/taille. Fait
        # en synchrone ici, ça retardait d'autant le premier accept() du serveur
        # HTTP — la fenêtre s'affichait, mais la liste de comptes restait vide
        # jusqu'à la fin du zip (constat Yaniss du 17/09/2026 : « les comptes
        # mettent plusieurs secondes avant d'apparaître »). La sauvegarde est un
        # filet de sécurité, pas un prérequis pour répondre aux requêtes.
        try:
            from . import local_backup
            backup = local_backup.create_startup_backup()
            if backup:
                print(f"[HEXGATE] Sauvegarde locale créée : {backup.name}", flush=True)
                log.info("sauvegarde: archive créée %s", backup.name)
        except Exception as error:
            # Une panne de sauvegarde ne doit pas masquer les comptes existants ni
            # empêcher l'application de démarrer.
            print(f"[HEXGATE] Sauvegarde locale impossible : {error}", flush=True)
            log.warning("sauvegarde: échec de la sauvegarde de démarrage : %s", error)

    threading.Thread(target=_startup_backup, daemon=True).start()

    # Ces quatre composants créaient auparavant des threads dès l'import du
    # module. Ils ne démarrent désormais qu'après l'acquisition exclusive du port.
    _accepter.start()
    _joiner.start()
    _rank_watcher.start()
    _gameflow_watcher.start()
    process.start_tasklist_watcher()
    log.info("workers: auto-accept, queue-joiner, rank-watcher, gameflow-watcher et tasklist-watcher démarrés")

    # Pre-fetch all accounts' matches on startup in a separate thread!
    def start_pre_fetch():
        print("[HEXGATE] Démarrage du pré-fetching des historiques au lancement...", flush=True)
        time.sleep(2.5)  # Wait for SSE subscription to setup
        for acc in vault.list_accounts():
            if acc.riot_id:
                try:
                    print(f"[HEXGATE] Pré-fetching pour {acc.name} ({acc.riot_id})...", flush=True)
                    # Sync and merge matches
                    with _riot_lock:
                        matches = riot_api.fetch_match_history(acc.riot_id, acc.region, 20)
                    vault.merge_matches(acc.name, matches)
                    print(f"[HEXGATE] Pré-fetching réussi pour {acc.name}", flush=True)
                except Exception as e:
                    print(f"[HEXGATE] Erreur pré-fetching pour {acc.name} : {e}", flush=True)
        print("[HEXGATE] Pré-fetching terminé.", flush=True)
        _broadcast_event("accounts_changed", None)

    def start_valorant_pre_fetch():
        """Actualise tous les profils VALORANT au démarrage, sans bloquer l'UI.

        Les sessions Riot restent inchangées : il s'agit seulement du cache
        HenrikDev local (niveau, MMR éventuel et historique). Les appels sont
        séquentiels et légèrement espacés pour rester confortablement sous la
        limite du fournisseur.
        """
        time.sleep(4.0)  # laisse le serveur HTTP et le flux SSE devenir prêts
        if not secure_settings.configured(valorant_api.SECRET_KEY):
            return
        log = applog.get_logger()
        print("[HEXGATE] Synchronisation VALORANT au lancement...", flush=True)
        log.info("valorant: synchronisation au lancement démarrée")
        changed = False
        synced, failed, skipped = 0, 0, 0
        for acc in vault.list_accounts():
            if not acc.riot_id:
                continue
            existing = (acc.valorant or {}).get("stats")
            if isinstance(existing, dict) and isinstance(existing.get("last_synced"), (int, float)):
                age = time.time() - existing["last_synced"]
                if age < _VALORANT_STARTUP_FRESHNESS:
                    skipped += 1
                    continue
            try:
                summary = valorant_api.fetch_summary(acc.riot_id, acc.region)
                vault.update_valorant(acc.name, stats=summary)
                changed = True
                synced += 1
                print(f"[HEXGATE] VALORANT synchronisé : {acc.name}", flush=True)
            except valorant_api.ValorantApiError as error:
                # Une erreur pour un compte ne doit jamais empêcher les autres
                # profils de se mettre à jour au lancement.
                failed += 1
                print(f"[HEXGATE] VALORANT non synchronisé ({acc.name}) : {error.code}", flush=True)
                log.info("valorant: échec sync %s (%s)", acc.name, error.code)
            except Exception as error:
                failed += 1
                print(f"[HEXGATE] VALORANT non synchronisé ({acc.name}) : erreur inattendue", flush=True)
                log.warning("valorant: erreur inattendue sync %s : %s", acc.name, error)
            time.sleep(0.4)
        if changed:
            _broadcast_event("accounts_changed", None)
        print("[HEXGATE] Synchronisation VALORANT terminée.", flush=True)
        log.info(
            "valorant: synchronisation terminée (%s réussies, %s en échec, %s déjà à jour)",
            synced, failed, skipped,
        )

    def start_wallet_refresh():
        # Le wallet (BE/RP) n'est exposé que par la Live Client/LCU API, donc
        # uniquement pour le compte actuellement connecté dans le client LoL
        # (contrairement aux matchs, pas moyen de le récupérer pour tous les
        # comptes sauvegardés via la Riot API). Rafraîchit au lancement pour
        # ne pas rester sur une valeur figée depuis le dernier swap.
        time.sleep(2.5)
        try:
            summoner = lcu_api.current_summoner()
        except lcu_api.LeagueNotRunning:
            return
        if not summoner:
            return
        try:
            w = lcu_api.wallet()
        except lcu_api.LeagueNotRunning:
            w = None
        if not w:
            return
        updated = False
        for acc in vault.list_accounts():
            if acc.riot_id == summoner.get("riot_id"):
                vault.update_profile(acc.name, wallet=w)
                updated = True
        if updated:
            print(f"[HEXGATE] Wallet rafraîchi au lancement pour {summoner.get('riot_id')} : "
                  f"BE={w.get('blue_essence')} RP={w.get('rp')}", flush=True)
            _broadcast_event("accounts_changed", None)

    def start_live_game_overlay_watcher():
        print("[HEXGATE] Démarrage du watcher overlay in-game...", flush=True)
        was_active = False
        last_cs = -1      # dernier palier de CS vu (l'API ne met à jour que par pas de 10)
        last_cs_time = 0.0  # gameTime au moment de ce palier
        enemies_sig = None  # signature du dernier broadcast ennemis (n'émettre que si ça change)
        enemies_ticks = 0   # ré-émission périodique pour les clients SSE connectés en cours de partie
        insight_debug_sig = None  # évite le spam de logs : n'imprime qu'au changement

        while True:
            # Hors partie (phase != InProgress, connue en mémoire via le bus push)
            # ET overlay déjà inactif : inutile de marteler le port 2999 chaque
            # seconde — il n'écoute qu'en partie. Réveil instantané au passage en
            # InProgress, filet 15 s (cas rare : jeu vivant mais client LCU mort).
            if not was_active and _gameflow_watcher.phase != "InProgress":
                _gameflow_watcher.wait_phase_change(timeout=15)

            try:
                data = get_live_game_data()
                if data:
                    active_player = data.get("activePlayer", {})
                    # Match par riotId d'abord (unique), summonerName en repli.
                    # NB : championStats ne contient PAS de creepScore — ancien repli retiré.
                    riot_id = active_player.get("riotId")
                    summoner_name = active_player.get("summonerName")
                    players = data.get("allPlayers", [])
                    me = None
                    if riot_id and riot_id != "#":
                        me = next((p for p in players if p.get("riotId") == riot_id), None)
                    if me is None and summoner_name:
                        me = next((p for p in players if p.get("summonerName") == summoner_name), None)
                    cs = (me or {}).get("scores", {}).get("creepScore", 0)

                    game_time = data.get("gameData", {}).get("gameTime", 0.0)
                    # Nouvelle partie (le temps recule ou le CS diminue) → reset du palier.
                    if game_time < last_cs_time or cs < last_cs:
                        last_cs = -1
                    # Le CS/min est figé au moment du dernier palier : quand l'API passe
                    # à N, le N-ième CS vient d'être pris, donc N/temps_du_palier est
                    # exact à cet instant — au lieu de diviser un CS périmé par un
                    # temps qui continue de courir (sous-estimation entre paliers).
                    if cs != last_cs:
                        last_cs = cs
                        last_cs_time = game_time
                    cs_per_min = last_cs / (last_cs_time / 60.0) if last_cs_time > 1.0 else 0.0

                    _broadcast_event("live_game_stats", {
                        "cs": cs,
                        "time": game_time,
                        "cs_per_min": cs_per_min,
                        "active": True
                    })

                    # Équipe ennemie pour l'overlay cooldowns : broadcast seulement quand
                    # quelque chose change (niveau, objets, mort…) pour ne pas spammer le SSE.
                    my_team = (me or {}).get("team")
                    enemies = []
                    if my_team:
                        for p in players:
                            if p.get("team") == my_team:
                                continue
                            spells = p.get("summonerSpells", {}) or {}
                            runes = p.get("runes", {}) or {}
                            p_riot_id = p.get("riotId") or ""
                            enemies.append({
                                # championName = nom affiché localisé ; raw contient l'id
                                # interne ("game_character_displayname_MissFortune") dont le
                                # dernier segment correspond à l'id Data Dragon.
                                "champion": p.get("championName", ""),
                                "raw": p.get("rawChampionName", ""),
                                # "#" ou vide si le Mode Streamer du CLIENT LoL (pas de
                                # Hexgate) est actif chez l'observateur — anonymise alors
                                # aussi les adversaires dans cette API locale.
                                "riot_id": p_riot_id if p_riot_id and p_riot_id != "#" else "",
                                "level": p.get("level", 1),
                                "position": p.get("position", ""),
                                "items": [i.get("itemID", 0) for i in (p.get("items") or [])],
                                "spells": [
                                    (spells.get("summonerSpellOne") or {}).get("rawDisplayName", ""),
                                    (spells.get("summonerSpellTwo") or {}).get("rawDisplayName", ""),
                                ],
                                # Ids des 2 arbres de runes (8300 = Inspiration → Cosmic Insight
                                # supposée pour le haste des sorts d'invocateur). Les runes
                                # mineures exactes ne sont pas exposées par l'API.
                                "rune_trees": [
                                    (runes.get("primaryRuneTree") or {}).get("id", 0),
                                    (runes.get("secondaryRuneTree") or {}).get("id", 0),
                                ],
                                "dead": p.get("isDead", False),
                            })
                    enemies_payload = {
                        "my_position": (me or {}).get("position", ""),
                        "enemies": enemies,
                        "active": True,
                    }
                    sig = json.dumps(enemies_payload, sort_keys=True)
                    enemies_ticks += 1
                    # Émettre au changement, et de toute façon toutes les ~10s : un overlay
                    # (ré)ouvert en cours de partie ne doit pas attendre le prochain level-up.
                    periodic_rebroadcast = sig != enemies_sig or enemies_ticks >= 10
                    if periodic_rebroadcast:
                        enemies_sig = sig
                        enemies_ticks = 0
                        _broadcast_event("live_game_enemies", enemies_payload)

                    # Overlay "adversaire ciblé" (opt-in, settings.opponent_insight_enabled) :
                    # une seule requête Riot API par (adversaire, mon champion), pas à
                    # chaque tick — déclenchée en tâche de fond dès qu'un nouveau couple
                    # apparaît (nouvelle partie, repick avant le lock-in, ou clic sur un
                    # autre portrait dans l'overlay — voir /live-game/insight-target).
                    # La cible = l'adversaire épinglé côté frontend (_insight_state
                    # ["target_riot_id"], mis à jour par cet endpoint) s'il fait toujours
                    # partie de la partie en cours, sinon repli sur l'adversaire de lane.
                    my_champion = (me or {}).get("championName", "")
                    with _insight_lock:
                        _insight_state["my_champion"] = my_champion
                        pinned_riot_id = _insight_state.get("target_riot_id") or ""
                        pinned_champion = _insight_state.get("target_champion") or ""
                    lane_opponent = next(
                        (e for e in enemies if e["position"] and e["position"] == enemies_payload["my_position"]),
                        None,
                    )
                    pinned_enemy = next((e for e in enemies if e["riot_id"] == pinned_riot_id), None) if pinned_riot_id else None
                    if pinned_enemy is None and pinned_champion:
                        # Cible anonymisée par le Mode Streamer du client LoL : on la
                        # retrouve par son champion. Elle devient la cible SANS repli
                        # sur la lane — le garde-fou `target["riot_id"]` plus bas coupe
                        # alors le fetch, au lieu d'interroger la Riot API pour un
                        # adversaire que l'overlay n'affiche pas et dont il jettera la
                        # réponse.
                        pinned_enemy = next((e for e in enemies if e["raw"] == pinned_champion), None)
                    target = pinned_enemy or lane_opponent
                    insight_enabled = settings.get("opponent_insight_enabled", False)
                    debug_sig = (
                        insight_enabled,
                        bool(target),
                        target["riot_id"] if target else "",
                        my_champion,
                    )
                    if debug_sig != insight_debug_sig:
                        insight_debug_sig = debug_sig
                        print(
                            f"[HEXGATE][insight] enabled={insight_enabled} "
                            f"my_position={enemies_payload['my_position']!r} "
                            f"target={'oui' if target else 'non'} "
                            f"target_riot_id={(target or {}).get('riot_id', '')!r} "
                            f"my_champion={my_champion!r}",
                            flush=True,
                        )
                    if (
                        insight_enabled
                        and target
                        and target["riot_id"]
                        and my_champion
                    ):
                        key = (target["riot_id"], my_champion)
                        with _insight_lock:
                            is_new_key = key != _insight_state.get("key")
                            if is_new_key:
                                _insight_state["key"] = key
                                _insight_state["payload"] = None
                            cached_payload = _insight_state.get("payload")
                        if is_new_key:
                            threading.Thread(
                                target=_fetch_opponent_insight,
                                args=(target["riot_id"], my_champion),
                                daemon=True,
                            ).start()
                        elif periodic_rebroadcast and cached_payload is not None:
                            # Rediffusion périodique : un overlay (re)connecté en cours de
                            # partie (ex. après un redémarrage de l'app) ne doit pas rester
                            # bloqué sans données juste parce qu'il a raté l'unique broadcast
                            # initial — même logique que les ennemis ci-dessus.
                            _broadcast_event("live_game_opponent_insight", cached_payload)
                    was_active = True
                else:
                    last_cs = -1
                    last_cs_time = 0.0
                    if was_active:
                        _broadcast_event("live_game_stats", {
                            "cs": 0,
                            "time": 0.0,
                            "cs_per_min": 0.0,
                            "active": False
                        })
                        _broadcast_event("live_game_enemies", {
                            "my_position": "",
                            "enemies": [],
                            "active": False
                        })
                        enemies_sig = None
                        with _insight_lock:
                            _insight_state["key"] = None
                            _insight_state["payload"] = None
                            _insight_state["target_riot_id"] = ""
                            _insight_state["target_champion"] = ""
                            _insight_state["my_champion"] = ""
                        _broadcast_event("live_game_opponent_insight", {
                            "riot_id": "", "champion": "", "error": None, "active": False,
                        })
                        was_active = False
            except Exception as e:
                print(f"[HEXGATE] Erreur watcher overlay : {e}", flush=True)
            time.sleep(1.0)

    threading.Thread(target=start_pre_fetch, daemon=True).start()
    threading.Thread(target=start_valorant_pre_fetch, daemon=True).start()
    threading.Thread(target=start_wallet_refresh, daemon=True).start()
    threading.Thread(target=start_background_watcher, daemon=True).start()
    threading.Thread(target=start_ping_watcher, daemon=True).start()
    threading.Thread(target=start_lcu_automation_watcher, daemon=True).start()
    threading.Thread(target=start_hotkey_listener, daemon=True).start()
    threading.Thread(target=start_friends_notification_watcher, daemon=True).start()
    threading.Thread(target=start_champ_select_watcher, daemon=True).start()
    threading.Thread(target=start_end_of_game_message_watcher, daemon=True).start()
    threading.Thread(target=start_live_game_overlay_watcher, daemon=True).start()

    print(f"LOL_SWITCHER_READY port={port}", flush=True)  # signal lu par le sidecar Tauri
    server.serve_forever()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8722
    run(port)
