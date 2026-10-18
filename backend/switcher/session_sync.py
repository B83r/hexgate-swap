"""Observe la session écrite par Riot sans renouveler ni modifier son autorisation."""
import hashlib

from . import client_api, vault


class SessionSync:
    def __init__(self):
        self._candidate = None
        self._saved = None

    def reset(self):
        self._candidate = self._saved = None

    def tick(self) -> str | None:
        path = vault.current_session_files().get("riot_client")
        if path is None:
            self.reset()
            return None
        snapshot = path.read_bytes()
        fingerprint = hashlib.sha256(snapshot).digest()
        if fingerprint != self._candidate:
            self._candidate = fingerprint
            return None  # attendre un deuxième relevé stable (5 s)
        if fingerprint == self._saved:
            return None
        owner = vault.session_owner(snapshot)
        if not owner or not vault.has_persistent_session(snapshot.decode("utf-8")):
            return None
        identity = client_api.current_identity()
        if not identity or identity.get("puuid") != owner:
            return None
        result = vault.sync_authenticated_session(identity, snapshot)
        # Ne mémoriser le succès que si le fichier n'a pas changé entre-temps.
        if result:
            self._saved = fingerprint
        return result
