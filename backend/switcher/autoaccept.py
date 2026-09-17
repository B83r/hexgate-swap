"""Acceptation automatique de la file (ready-check) via l'API LCU."""
import threading
import time

from . import lcu_api
from . import settings


class AutoAccepter(threading.Thread):
    """Thread de fond : accepte le match dès que la file pop, si activé.

    Le pop est aussi POUSSÉ par le bus WebSocket LCU (`poke()`, event
    ready-check) : l'attente entre deux sondages est interrompue immédiatement
    → acceptation quasi instantanée, le poll 1 s ne sert plus que de filet."""

    def __init__(self, on_accept=lambda: None):
        super().__init__(daemon=True)
        self.enabled = threading.Event()
        self._pop = threading.Event()
        self._on_accept = on_accept

    def poke(self):
        """Réveille le thread immédiatement (event ready-check reçu en push)."""
        self._pop.set()

    def run(self):
        while True:
            if not self.enabled.wait(timeout=2):
                continue
            try:
                if lcu_api.ready_check_state() == "InProgress":
                    delay = int(settings.get("auto_accept_delay", 0))
                    if delay > 0:
                        time.sleep(delay)
                    if lcu_api.ready_check_state() == "InProgress":
                        lcu_api.accept_ready_check()
                        self._on_accept()
                        time.sleep(5)  # laisse le pop se résoudre avant de re-sonder
            except lcu_api.LeagueNotRunning:
                time.sleep(3)
            self._pop.wait(timeout=1)
            self._pop.clear()
