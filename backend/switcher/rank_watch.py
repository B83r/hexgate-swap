"""Surveillance périodique du rang du compte actif.

Détecte qu'une partie classée SoloQ vient de se terminer (le total V+D du
compte actif augmente) en comparant au dernier rank connu, et notifie
l'appelant avec un toast (résultat + variation de LP) — même si l'utilisateur
n'a pas relancé de swap entre-temps.
"""
import threading
import time
from collections.abc import Callable

from . import lcu_api, vault

_TIER_FR = {
    "IRON": "Fer", "BRONZE": "Bronze", "SILVER": "Argent", "GOLD": "Or",
    "PLATINUM": "Platine", "EMERALD": "Émeraude", "DIAMOND": "Diamant",
    "MASTER": "Maître", "GRANDMASTER": "Grand Maître", "CHALLENGER": "Challenger",
}
_NO_DIVISION = {"MASTER", "GRANDMASTER", "CHALLENGER"}


def _format_rank(solo: dict) -> str:
    tier = solo.get("tier")
    label = _TIER_FR.get(tier, tier)
    if tier in _NO_DIVISION or not solo.get("division"):
        return label
    return f"{label} {solo['division']}"


class RankWatcher(threading.Thread):
    """Thread de fond : sonde le rang SoloQ du compte actif.

    Event-driven : le rang ne change qu'après une partie — le sondage est donc
    déclenché par la fin de partie (`poke()`, appelé sur l'event gameflow
    EndOfGame) avec un simple filet périodique lent en secours. Avant : un tick
    complet (2 appels LCU + relecture de tous les meta.json) toutes les 25 s."""

    def __init__(
        self,
        on_game_result: Callable[[str], None] = lambda _text: None,
        on_profile_updated: Callable[[], None] = lambda: None,
        interval: float = 120.0,
    ):
        super().__init__(daemon=True)
        self._on_game_result = on_game_result
        self._on_profile_updated = on_profile_updated
        self._interval = interval
        self._poke = threading.Event()

    def poke(self):
        """Demande un sondage immédiat (fin de partie détectée)."""
        self._poke.set()

    def run(self):
        while True:
            self._poke.wait(timeout=self._interval)
            self._poke.clear()
            try:
                self._tick()
            except Exception:
                pass  # sondage best-effort : jamais fatal pour le serveur

    def _tick(self):
        name = vault.get_active()
        if not name:
            return
        accounts = {a.name: a for a in vault.list_accounts()}
        account = accounts.get(name)
        if account is None:
            return

        try:
            summoner = lcu_api.current_summoner()
        except lcu_api.LeagueNotRunning:
            return
        if not summoner:
            return
        try:
            rank = lcu_api.ranked_stats()
        except lcu_api.LeagueNotRunning:
            return

        # Le compte réellement connecté peut différer du compte « actif » de
        # state.json (connexion manuelle hors Hexgate, swap interrompu). Sans ce
        # contrôle, on écrasait la fiche du compte actif avec les données d'un
        # autre — et on annonçait ses victoires sous le mauvais nom.
        if account.riot_id and summoner["riot_id"] != account.riot_id:
            return

        old_solo = (account.rank or {}).get("solo")
        new_solo = rank.get("solo")

        lp_delta = vault.update_profile(
            name, riot_id=summoner["riot_id"], level=summoner.get("level"),
            rank=rank, icon_id=summoner.get("icon_id"), puuid=summoner.get("puuid"),
        )
        self._on_profile_updated()

        if not old_solo or not new_solo or lp_delta is None:
            return
        old_games = old_solo.get("wins", 0) + old_solo.get("losses", 0)
        new_games = new_solo.get("wins", 0) + new_solo.get("losses", 0)
        if new_games <= old_games:
            return  # pas de nouvelle partie classée détectée depuis le dernier sondage

        won = new_solo.get("wins", 0) > old_solo.get("wins", 0)
        icon = "🏆" if won else "💀"
        result = "Victoire" if won else "Défaite"
        self._on_game_result(
            f"{icon} {result} sur « {name} » · {_format_rank(new_solo)} ({lp_delta:+d} LP)"
        )


_GAMEFLOW_EVENT = "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"
_GAMEFLOW_URI = "/lol-gameflow/v1/gameflow-phase"


class GameflowWatcher:
    """Détection de la phase de jeu (lobby / file / sélection / partie) en TEMPS
    RÉEL — et bus d'événements LCU partagé.

    Source principale : le WebSocket d'événements du LCU (`EventSocket`), qui
    POUSSE chaque changement instantanément — aucune latence de polling. Un poll
    LENT (30 s) tourne en secours au cas où le WebSocket ne peut pas se connecter
    sur une machine donnée. Les deux passent par `_update`, qui déduplique.

    Bus : d'autres watchers peuvent s'abonner à des événements LCU supplémentaires
    via `extra_events` (un seul WebSocket pour tout le backend) et attendre les
    changements de phase SANS poll grâce à `phase_changed` (Condition notifiée à
    chaque transition) + la lecture en mémoire de `phase` (zéro I/O).
    """

    def __init__(
        self,
        on_gameflow_change: Callable[[str, float], None] = lambda _phase, _since: None,
        poll_interval: float = 30.0,
        extra_events: list[tuple[str, str, Callable[[str, object], None]]] | None = None,
    ):
        self._on_gameflow_change = on_gameflow_change
        self._poll_interval = poll_interval
        # [(nom d'abonnement WAMP, préfixe d'URI, callback(eventType, data))]
        self._extra_events = list(extra_events or [])
        self._current_phase = "None"
        self._since = time.time()
        self._lock = threading.Lock()
        self.phase_changed = threading.Condition()

    @property
    def phase(self) -> str:
        """Phase courante, lue en mémoire (aucun appel LCU)."""
        return self._current_phase

    def wait_phase_change(self, timeout: float) -> None:
        """Bloque jusqu'au prochain changement de phase (ou timeout) — permet aux
        watchers d'être réveillés instantanément sans poller."""
        with self.phase_changed:
            self.phase_changed.wait(timeout=timeout)

    def start(self):
        threading.Thread(target=self._ws_loop, daemon=True).start()
        threading.Thread(target=self._poll_loop, daemon=True).start()

    def _update(self, phase: str | None):
        phase = phase or "None"
        with self._lock:
            if phase == self._current_phase:
                return
            self._current_phase = phase
            since = time.time()
            if phase == "InProgress":
                try:
                    gst = lcu_api.game_start_time()
                except Exception:
                    gst = None
                if gst:
                    since = gst
            self._since = since
            cb = self._on_gameflow_change
        cb(phase, since)  # hors du verrou : diffusion SSE
        with self.phase_changed:
            self.phase_changed.notify_all()

    def _ws_loop(self):
        while True:
            es = None
            try:
                es = lcu_api.EventSocket()
                es.subscribe(_GAMEFLOW_EVENT)
                for event_name, _prefix, _cb in self._extra_events:
                    es.subscribe(event_name)
                print("[HEXGATE][gameflow] WebSocket LCU connecté (détection push)", flush=True)
                # L'abonnement ne pousse que sur CHANGEMENT : on lit la phase
                # courante une fois à la connexion pour ne pas rater l'état initial.
                try:
                    self._update(lcu_api.gameflow_phase())
                except lcu_api.LeagueNotRunning:
                    pass
                for uri, etype, data in es.events():
                    if uri == _GAMEFLOW_URI:
                        self._update(data if isinstance(data, str) else "None")
                        continue
                    if not uri:
                        continue
                    for _name, prefix, cb in self._extra_events:
                        if uri.startswith(prefix):
                            try:
                                cb(etype or "", data)
                            except Exception:
                                pass  # un abonné défaillant ne tue jamais le bus
            except lcu_api.LeagueNotRunning:
                self._update("None")
                time.sleep(2)
            except Exception as e:
                print(f"[HEXGATE][gameflow] WebSocket interrompu ({e}), reconnexion...", flush=True)
                time.sleep(2)
            finally:
                if es is not None:
                    es.close()

    def _poll_loop(self):
        # Filet de sécurité UNIQUEMENT (WebSocket indisponible / désynchronisé) :
        # le push fait le vrai travail, inutile de vérifier plus d'une fois par 30 s.
        while True:
            try:
                self._update(lcu_api.gameflow_phase())
            except lcu_api.LeagueNotRunning:
                self._update("None")
            except Exception:
                pass
            time.sleep(self._poll_interval)
