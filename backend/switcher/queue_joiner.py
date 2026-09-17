import threading
import time
from . import lcu_api

_ROLE_QUEUES = {420, 440, 400}  # files supportant les préférences de rôle (pas ARAM/Arena/Mayhem)

class QueueJoiner(threading.Thread):
    def __init__(self, on_success=lambda msg: None):
        super().__init__(daemon=True)
        self.pending_queue_id = None
        self.pending_position_prefs = None
        self.lock = threading.Lock()
        self.on_success = on_success

    def set_pending(self, queue_id: int, position_prefs: dict | None = None):
        with self.lock:
            self.pending_queue_id = queue_id
            self.pending_position_prefs = position_prefs
            print(f"[QueueJoiner] File d'attente cible definie sur {queue_id}", flush=True)

    def run(self):
        while True:
            queue_id = None
            position_prefs = None
            with self.lock:
                queue_id = self.pending_queue_id
                position_prefs = self.pending_position_prefs

            if queue_id is not None:
                try:
                    print("[QueueJoiner] Tentative de detection du client LoL...", flush=True)
                    summoner = lcu_api.current_summoner()
                    if summoner is not None:
                        name = summoner.get("riot_id")
                        print(f"[QueueJoiner] Client detecte, invocateur connecte: {name}. Attente 5 secondes...", flush=True)
                        time.sleep(5)
                        
                        print(f"[QueueJoiner] Creation du lobby pour la file {queue_id}...")
                        if lcu_api.create_lobby(queue_id):
                            print("[QueueJoiner] Lobby cree avec succes. Attente 2 secondes...", flush=True)
                            time.sleep(2)

                            if position_prefs and queue_id in _ROLE_QUEUES:
                                try:
                                    if lcu_api.set_position_preferences(position_prefs.get("first"), position_prefs.get("second")):
                                        print("[QueueJoiner] Preferences de role appliquees.", flush=True)
                                except Exception as e:
                                    print(f"[QueueJoiner] Echec preferences de role (ignore) : {e}", flush=True)

                            print("[QueueJoiner] Lancement de la recherche de matchmaking...", flush=True)
                            if lcu_api.start_matchmaking():
                                print("[QueueJoiner] Matchmaking lance avec succes !", flush=True)
                                queue_names = {
                                    420: 'Ranked Solo/Duo',
                                    440: 'Ranked Flex',
                                    400: 'Normal Draft',
                                    430: 'Normal Blind',
                                    450: 'ARAM',
                                    2400: 'ARAM Mayhem',
                                    1700: 'Arena'
                                }
                                name = queue_names.get(queue_id, f'File {queue_id}')
                                self.on_success(f"Lobby cree et matchmaking lance : {name} !")
                            else:
                                print("[QueueJoiner] Echec du lancement de la recherche (start_matchmaking).", flush=True)
                        else:
                            print("[QueueJoiner] Echec de la creation du lobby (create_lobby).", flush=True)
                            
                        with self.lock:
                            self.pending_queue_id = None
                            self.pending_position_prefs = None
                    else:
                        print("[QueueJoiner] Client connecte mais profil invocateur pas encore charge.", flush=True)
                except lcu_api.LeagueNotRunning:
                    print("[QueueJoiner] Client LoL non en cours d'execution ou lockfile absent.", flush=True)
                except Exception as e:
                    print(f"[QueueJoiner] Erreur inattendue : {e}", flush=True)
            time.sleep(2)
