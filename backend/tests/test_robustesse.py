"""Lot 2 de l'audit (robustesse) : garde-fou HTTP, client fermé, lockfile périmé, région.

Bac à sable identique aux autres modules (LOCALAPPDATA redirigé avant l'import).
    python -m unittest backend.tests.test_robustesse -v
"""
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

_SANDBOX = tempfile.mkdtemp(prefix="hexgate-robuste-")
os.environ["LOCALAPPDATA"] = _SANDBOX
os.environ["PROGRAMDATA"] = os.path.join(_SANDBOX, "ProgramData")

from backend.switcher import client_api, core, lcu_api, paths, process, riot_api, server  # noqa: E402

assert paths.STORAGE_DIR.is_relative_to(_SANDBOX), "bac à sable non appliqué : arrêt"

DEAD_PID = 4294967  # jamais attribué sous Windows


class PidTests(unittest.TestCase):
    def test_pid_alive(self):
        self.assertTrue(process.pid_alive(os.getpid()))
        self.assertFalse(process.pid_alive(DEAD_PID))


class LockfilePerimeTests(unittest.TestCase):
    """Lockfile d'un client mort : « fermé » immédiat, sans tenter de connexion."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="lockfile-"))
        lcu_api._invalidate_creds()

    def tearDown(self):
        lcu_api._invalidate_creds()

    def _write(self, name: str, pid: int) -> Path:
        path = self.tmp / name
        path.write_text(f"LeagueClient:{pid}:2999:motdepasse:https", encoding="utf-8")
        return path

    def test_lcu_lockfile_perime(self):
        self._write("lockfile", DEAD_PID)
        with mock.patch.object(paths, "league_install_dir", return_value=self.tmp), \
                mock.patch("socket.create_connection", side_effect=AssertionError("connexion tentée")):
            started = time.monotonic()
            with self.assertRaises(lcu_api.LeagueNotRunning):
                lcu_api._call("GET", "/lol-gameflow/v1/gameflow-phase")
            self.assertLess(time.monotonic() - started, 0.5)

    def test_lcu_creds_en_cache_invalides_quand_le_client_meurt(self):
        self._write("lockfile", os.getpid())  # « vivant »
        with mock.patch.object(paths, "league_install_dir", return_value=self.tmp):
            self.assertEqual(lcu_api._lockfile_creds(), (2999, "motdepasse"))
            with mock.patch.object(process, "pid_alive", return_value=False):
                with self.assertRaises(lcu_api.LeagueNotRunning):
                    lcu_api._lockfile_creds()
            self.assertIsNone(lcu_api._creds_cache)

    def test_client_riot_lockfile_perime(self):
        lock = self._write("lockfile_riot", DEAD_PID)
        with mock.patch.object(client_api, "LOCKFILE", lock), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("connexion tentée")):
            with self.assertRaises(client_api.ClientNotRunning):
                client_api.phase()


class RegionTests(unittest.TestCase):
    def test_region_inconnue_leve_une_erreur(self):
        api = riot_api.RiotClient.__new__(riot_api.RiotClient)
        for region in ("?", "", None, "MARS"):
            with self.assertRaises(riot_api.RiotApiError):
                api._hosts(region)

    def test_regions_connues_inchangees(self):
        api = riot_api.RiotClient.__new__(riot_api.RiotClient)
        self.assertEqual(api._hosts("na"), ("na1", "americas"))
        self.assertEqual(api._hosts("EUW"), ("euw1", "europe"))


class GardeFouHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        paths.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        paths.ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
        cls.token = server.init_api_token()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def request(self, method, path, body=None):
        data = body if isinstance(body, bytes) else (None if body is None else json.dumps(body).encode())
        req = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={"Content-Type": "application/json", "X-Hexgate-Token": self.token})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_json_malforme_repond_400(self):
        status, body = self.request("POST", "/note", b"{pas du json")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_json_non_objet_repond_400(self):
        status, _ = self.request("POST", "/note", b"[1, 2]")
        self.assertEqual(status, 400)

    def test_corps_trop_gros_repond_400(self):
        with mock.patch.object(server, "_MAX_BODY", 10):
            status, _ = self.request("POST", "/note", b'{"a": "' + b"x" * 50 + b'"}')
        self.assertEqual(status, 400)

    def test_parametre_manquant_repond_400(self):
        self.assertEqual(self.request("GET", "/matches")[0], 400)
        self.assertEqual(self.request("GET", "/champion-stats")[0], 400)

    def test_nom_de_compte_illegal_repond_400(self):
        status, _ = self.request("GET", "/matches?name=..")
        self.assertEqual(status, 400)

    def test_client_ferme_repond_409_avec_code(self):
        with mock.patch.object(lcu_api, "get_friends", side_effect=lcu_api.LeagueNotRunning("x")):
            status, body = self.request("GET", "/chat/friends")
        self.assertEqual(status, 409)
        self.assertEqual(body.get("code"), "client_closed")

    def test_client_ferme_non_attrape_par_la_route_repond_409(self):
        with mock.patch.object(core, "suggest_account_name", side_effect=client_api.ClientNotRunning("x")):
            status, body = self.request("GET", "/suggest-name")
        self.assertEqual(status, 409)
        self.assertEqual(body.get("code"), "client_closed")

    def test_exception_inattendue_repond_500_json_sans_fuite(self):
        with mock.patch.object(core, "suggest_account_name", side_effect=RuntimeError("secret interne")):
            status, body = self.request("GET", "/suggest-name")
        self.assertEqual(status, 500)
        self.assertNotIn("secret interne", json.dumps(body))

    def test_le_serveur_reste_utilisable_apres_une_erreur(self):
        with mock.patch.object(core, "suggest_account_name", side_effect=RuntimeError("boum")):
            self.assertEqual(self.request("GET", "/suggest-name")[0], 500)
        self.assertEqual(self.request("GET", "/autoaccept")[0], 200)


if __name__ == "__main__":
    unittest.main()
