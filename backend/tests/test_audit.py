"""Batterie de tests de l'audit pré-publication (23/09/2026).

Tout tourne dans un BAC À SABLE : `LOCALAPPDATA` et `PROGRAMDATA` sont
redirigés vers un dossier temporaire AVANT d'importer le backend. Le coffre,
les réglages, les fichiers de session Riot et le lockfile League sont donc
fictifs — aucun test ne peut toucher aux vrais comptes ni joindre le vrai
client Riot.

Lancer depuis la racine du dépôt :
    python -m unittest backend.tests.test_audit -v

Les tests marqués « [FAILLE] » décrivent le comportement ATTENDU d'une appli
sûre : ils échouent tant que la faille correspondante n'est pas corrigée, puis
servent de tests de non-régression.
"""
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

_SANDBOX = tempfile.mkdtemp(prefix="hexgate-audit-")
os.environ["LOCALAPPDATA"] = _SANDBOX
os.environ["PROGRAMDATA"] = os.path.join(_SANDBOX, "ProgramData")

from backend.switcher import (  # noqa: E402  (import après le bac à sable, volontaire)
    client_api, core, dpapi, export_import, paths, queue_repair, riot_api,
    secure_settings, server, settings, vault,
)

assert paths.STORAGE_DIR.is_relative_to(_SANDBOX), "bac à sable non appliqué : arrêt"


def _fake_account(name: str, *, puuid: str | None = None, riot_id: str | None = None,
                  region: str = "EUW") -> None:
    """Compte fictif complet : sessions chiffrées DPAPI + meta.json."""
    account_dir = paths.ACCOUNTS_DIR / name
    account_dir.mkdir(parents=True, exist_ok=True)
    for key in paths.SESSION_FILES:
        (account_dir / f"{key}.bin").write_bytes(dpapi.protect(f"SESSION-{name}-{key}".encode()))
    meta = {"name": name, "region": region, "saved_at": 0, "riot_id": riot_id or name}
    if puuid:
        meta["puuid"] = puuid
    (account_dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")


def _reset_storage() -> None:
    shutil.rmtree(paths.STORAGE_DIR, ignore_errors=True)
    paths.ACCOUNTS_DIR.mkdir(parents=True)
    core._live_cache = None


class _HttpCase(unittest.TestCase):
    """Démarre le vrai `server.Handler` sur un port libre du bac à sable."""

    @classmethod
    def setUpClass(cls):
        paths.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        cls.token = server.init_api_token()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        _reset_storage()

    def request(self, method: str, path: str, body=None, headers=None, auth=True):
        data = body if isinstance(body, bytes) else (
            None if body is None else json.dumps(body).encode())
        base_headers = {"Content-Type": "application/json"}
        if auth:
            base_headers["X-Hexgate-Token"] = self.token
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={**base_headers, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except ConnectionError:
            # Le serveur a planté sur la requête et coupé la connexion : on le
            # signale par un statut None pour que le test puisse continuer ses
            # vérifications (ex. un fichier a-t-il été supprimé malgré tout ?).
            return None, {}, b""


# ─── 1. Sécurité du serveur local ────────────────────────────────────────────

class SecuriteServeurLocal(_HttpCase):

    def test_faille_cors_ouvert_a_tout_site(self):
        """[FAILLE] Une page web quelconque ne doit pas être autorisée à lire les réponses."""
        _, headers, _ = self.request("GET", "/ping/servers", headers={"Origin": "https://site-malveillant.example"})
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_cors_origine_de_l_appli_acceptee(self):
        _, headers, _ = self.request("GET", "/ping/servers", headers={"Origin": "http://tauri.localhost"})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://tauri.localhost")

    def test_preflight_autorise_l_entete_du_jeton(self):
        _, headers, _ = self.request("OPTIONS", "/export", auth=False,
                                     headers={"Origin": "http://tauri.localhost"})
        self.assertIn("X-Hexgate-Token", headers.get("Access-Control-Allow-Headers", ""))

    def test_jeton_faux_refuse(self):
        for method, route in (("GET", "/accounts"), ("GET", "/settings/all"), ("POST", "/delete")):
            with self.subTest(route=route):
                status, _, _ = self.request(method, route, {} if method == "POST" else None,
                                            auth=False, headers={"X-Hexgate-Token": "devine"})
                self.assertEqual(status, 401)

    def test_flux_evenements_sans_jeton_refuse(self):
        status, _, _ = self.request("GET", "/events", auth=False)
        self.assertEqual(status, 401)

    def test_images_publiques_sans_jeton(self):
        status, _, body = self.request("GET", "/assets/logo.png", auth=False)
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(b"\x89PNG"))

    def test_open_url_lien_web_accepte(self):
        import webbrowser
        appels = []
        original = webbrowser.open
        webbrowser.open = lambda url, *a, **k: appels.append(url) or True
        try:
            status, _, _ = self.request("POST", "/open-url", {"url": "https://www.op.gg/summoners/euw/A-EUW"})
        finally:
            webbrowser.open = original
        self.assertEqual(status, 200)
        self.assertEqual(appels, ["https://www.op.gg/summoners/euw/A-EUW"])

    def test_faille_export_sans_authentification(self):
        """[FAILLE] Exporter les sessions Riot doit exiger un jeton connu de la seule appli."""
        _fake_account("Victime#EUW")
        status, _, body = self.request("POST", "/export", {"names": ["Victime#EUW"], "password": "choisi-par-l-attaquant"},
                                       auth=False)
        if status == 200:
            blob = __import__("base64").b64decode(json.loads(body)["data"])
            self.fail("export accepté sans authentification : "
                      f"{len(blob)} octets de sessions Riot déchiffrables avec un mot de passe choisi par l'appelant")
        self.assertEqual(status, 401)

    def test_faille_open_url_lance_des_programmes(self):
        """[FAILLE] /open-url ne doit ouvrir que des liens http(s), jamais un exécutable."""
        import webbrowser
        appels = []
        original = webbrowser.open
        webbrowser.open = lambda url, *a, **k: appels.append(url) or True  # aucun lancement réel
        try:
            self.request("POST", "/open-url", {"url": r"C:\Windows\System32\notepad.exe"})
        finally:
            webbrowser.open = original
        self.assertEqual(appels, [], "un chemin d'exécutable a été transmis à os.startfile")

    def test_faille_nom_de_compte_dotdot_vise_le_dossier_parent(self):
        """[FAILLE] « .. » doit être refusé : sinon /delete efface les fichiers du dossier de l'appli."""
        témoin = paths.STORAGE_DIR / "settings.json"
        témoin.write_text("{}", encoding="utf-8")
        self.request("POST", "/delete", {"name": ".."})
        self.assertTrue(témoin.exists(), "settings.json a été supprimé via le nom de compte « .. »")

    def test_nom_dotdot_rejete_par_la_validation(self):
        """[FAILLE] La validation des noms de compte doit rejeter « . » et « .. »."""
        for nom in (".", ".."):
            with self.subTest(nom=nom), self.assertRaises(ValueError):
                vault._safe_name(nom)


class SauvegardeCloud(_HttpCase):

    def test_activation_sans_mot_de_passe_refusee(self):
        status, _, _ = self.request("POST", "/settings/cloud-backup", {"path": _SANDBOX})
        self.assertEqual(status, 400)
        self.assertIsNone(settings.get("cloud_backup_path"))

    def test_mot_de_passe_trop_court_refuse(self):
        status, _, _ = self.request("POST", "/settings/cloud-backup", {"path": _SANDBOX, "password": "court"})
        self.assertEqual(status, 400)

    def test_mot_de_passe_chiffre_et_jamais_renvoye(self):
        status, _, _ = self.request("POST", "/settings/cloud-backup",
                                    {"path": None, "password": "un-vrai-secret-42"})
        self.assertEqual(status, 200)
        brut = (paths.STORAGE_DIR / "settings.json").read_text(encoding="utf-8")
        self.assertNotIn("un-vrai-secret-42", brut, "mot de passe stocké en clair")
        self.assertEqual(secure_settings.get_secret(server.CLOUD_PASSWORD_KEY), "un-vrai-secret-42")
        for route in ("/settings/cloud-backup", "/settings/all"):
            with self.subTest(route=route):
                _, _, body = self.request("GET", route)
                self.assertNotIn("un-vrai-secret-42", body.decode())
                self.assertNotIn("hexgate-default-cloud-sync", body.decode())

    def test_migration_ancien_mot_de_passe_par_defaut_abandonne(self):
        settings.set(server.CLOUD_PASSWORD_KEY, "hexgate-default-cloud-sync")
        server.migrate_cloud_password()
        self.assertIsNone(settings.get(server.CLOUD_PASSWORD_KEY))

    def test_migration_ancien_mot_de_passe_personnel_chiffre(self):
        settings.set(server.CLOUD_PASSWORD_KEY, "mon-ancien-secret")
        server.migrate_cloud_password()
        self.assertTrue(str(settings.get(server.CLOUD_PASSWORD_KEY)).startswith("dpapi:"))
        self.assertEqual(secure_settings.get_secret(server.CLOUD_PASSWORD_KEY), "mon-ancien-secret")

    def test_synchro_sans_mot_de_passe_n_ecrit_rien(self):
        _fake_account("A#EUW")
        dossier = Path(_SANDBOX) / "cloud"
        dossier.mkdir(exist_ok=True)
        settings.set("cloud_backup_path", str(dossier))
        server._auto_sync_cloud()
        self.assertFalse((dossier / "hexgate_cloud_backup.hexgate").exists())


# ─── 2. Robustesse HTTP ──────────────────────────────────────────────────────

class RobustesseHttp(_HttpCase):

    def test_parametre_manquant_repond_au_lieu_de_couper(self):
        """[BUG] /matches sans nom doit répondre (400), pas couper la connexion."""
        status, _, _ = self.request("GET", "/matches")
        self.assertIsNotNone(status, "connexion coupée sans réponse")
        self.assertIn(status, (400, 404))

    def test_json_malforme_repond_400(self):
        """[BUG] Un corps JSON invalide doit donner 400, pas une connexion coupée."""
        status, _, _ = self.request("POST", "/note", b"{pas du json")
        self.assertIsNotNone(status, "connexion coupée sans réponse")
        self.assertEqual(status, 400)

    def test_route_inconnue_404(self):
        status, _, _ = self.request("GET", "/n-existe-pas")
        self.assertEqual(status, 404)

    def test_liste_des_comptes(self):
        _fake_account("A#EUW")
        _fake_account("B#NA", region="NA")
        status, _, body = self.request("GET", "/accounts")
        self.assertEqual(status, 200)
        noms = sorted(a["name"] for a in json.loads(body)["accounts"])
        self.assertEqual(noms, ["A#EUW", "B#NA"])

    def test_suppression_compte_normal(self):
        _fake_account("A#EUW")
        status, _, _ = self.request("POST", "/delete", {"name": "A#EUW"})
        self.assertEqual(status, 200)
        self.assertFalse((paths.ACCOUNTS_DIR / "A#EUW").exists())

    def test_region_de_ping_inconnue_refusee(self):
        status, _, _ = self.request("POST", "/ping/region", {"region": "MARS1"})
        self.assertEqual(status, 400)


# ─── 3. Coffre : identité, région, export ────────────────────────────────────

class Coffre(unittest.TestCase):

    def setUp(self):
        _reset_storage()

    def test_export_import_aller_retour(self):
        _fake_account("A#EUW", puuid="p-a")
        blob = export_import.export_accounts(["A#EUW"], "mdp-solide")
        shutil.rmtree(paths.ACCOUNTS_DIR / "A#EUW")
        self.assertEqual(export_import.import_accounts(blob, "mdp-solide"), ["A#EUW"])
        restauré = dpapi.unprotect((paths.ACCOUNTS_DIR / "A#EUW" / "riot_client.bin").read_bytes())
        self.assertEqual(restauré, b"SESSION-A#EUW-riot_client")

    def test_export_mauvais_mot_de_passe(self):
        _fake_account("A#EUW")
        blob = export_import.export_accounts(["A#EUW"], "bon")
        with self.assertRaises(export_import.WrongPassword):
            export_import.import_accounts(blob, "mauvais")

    def test_export_fichier_altere(self):
        _fake_account("A#EUW")
        doc = json.loads(export_import.export_accounts(["A#EUW"], "bon"))
        champ = next(k for k, v in doc.items() if isinstance(v, str) and len(v) > 40)
        doc[champ] = ("A" if doc[champ][0] != "A" else "B") + doc[champ][1:]
        with self.assertRaises((export_import.WrongPassword, ValueError)):
            export_import.import_accounts(json.dumps(doc).encode(), "bon")

    def test_garde_fou_identite_puuid(self):
        """Un profil d'un AUTRE compte (puuid différent) ne doit jamais être écrit."""
        _fake_account("A#EUW", puuid="puuid-A")
        vault.update_profile("A#EUW", level=999, puuid="puuid-B")
        meta = json.loads((paths.ACCOUNTS_DIR / "A#EUW" / "meta.json").read_text(encoding="utf-8"))
        self.assertNotEqual(meta.get("level"), 999)

    def test_region_ecrite_par_update_profile(self):
        _fake_account("A#EUW", puuid="p", region="?")
        vault.update_profile("A#EUW", puuid="p", region="EUW")
        self.assertEqual(next(a for a in vault.list_accounts() if a.name == "A#EUW").region, "EUW")

    def test_capture_ne_degrade_pas_une_region_connue(self):
        """Régression du 20/09 : une session binaire (région illisible) écrasait « NA » par « ? »."""
        _fake_account("A#NA", region="NA")
        for fichier in paths.SESSION_FILES.values():
            fichier.parent.mkdir(parents=True, exist_ok=True)
            fichier.write_text('cookies: ["ssid"]\n', encoding="utf-8")  # aucune ligne region:
        vault.capture("A#NA", refresh=True)
        self.assertEqual(next(a for a in vault.list_accounts() if a.name == "A#NA").region, "NA")

    def test_reglages_aller_retour(self):
        settings.set("audit_cle", {"x": 1})
        self.assertEqual(settings.get("audit_cle"), {"x": 1})


# ─── 4. Détection du compte réellement connecté ──────────────────────────────

class CompteConnecte(unittest.TestCase):

    def setUp(self):
        _reset_storage()
        self._orig = client_api.current_identity

    def tearDown(self):
        client_api.current_identity = self._orig
        core._live_cache = None

    def test_correspondance_par_puuid_meme_apres_renommage(self):
        _fake_account("Ancien#EUW", puuid="p-1", riot_id="Ancien#EUW")
        client_api.current_identity = lambda: {"puuid": "p-1", "riot_id": "NouveauNom#EUW"}
        self.assertEqual(core.live_account_name(max_age=0), "Ancien#EUW")

    def test_repli_sur_riot_id_sans_puuid(self):
        _fake_account("A#EUW", riot_id="A#EUW")
        client_api.current_identity = lambda: {"puuid": "inconnu", "riot_id": "A#EUW"}
        self.assertEqual(core.live_account_name(max_age=0), "A#EUW")

    def test_client_ferme(self):
        def ferme():
            raise client_api.ClientNotRunning("fermé")
        client_api.current_identity = ferme
        self.assertIsNone(core.live_account_name(max_age=0))

    def test_compte_non_enregistre(self):
        _fake_account("A#EUW", puuid="p-a")
        client_api.current_identity = lambda: {"puuid": "p-z", "riot_id": "Z#EUW"}
        self.assertIsNone(core.live_account_name(max_age=0))


# ─── 5. Réparation de file (bêta) ────────────────────────────────────────────

class ReparationFile(unittest.TestCase):

    def test_lecture_des_reponses_rc(self):
        self.assertEqual(queue_repair._text(200, '{"affinity":"us","service":"rms"}'), "us")
        self.assertEqual(queue_repair._text(200, '"Connected"'), "Connected")
        self.assertIsNone(queue_repair._text(404, '"x"'))
        self.assertIsNone(queue_repair._text(200, ""))

    def test_diagnostic_mauvaise_region(self):
        orig = (queue_repair.cached_affinity, queue_repair.rms_state, queue_repair.expected_edge)
        queue_repair.cached_affinity = lambda: "us"
        queue_repair.rms_state = lambda: "Connected"
        queue_repair.expected_edge = lambda: "eu"
        try:
            self.assertTrue(queue_repair.diagnose()["mismatch"])
            queue_repair.expected_edge = lambda: None  # région inconnue → jamais d'alerte
            self.assertFalse(queue_repair.diagnose()["mismatch"])
        finally:
            queue_repair.cached_affinity, queue_repair.rms_state, queue_repair.expected_edge = orig

    def test_client_riot_ferme(self):
        self.assertFalse(queue_repair.diagnose()["client"])  # pas de lockfile dans le bac à sable


# ─── 6. Routage Riot API ─────────────────────────────────────────────────────

class RoutageRiotApi(unittest.TestCase):

    def test_regions_connues(self):
        api = riot_api.RiotClient.__new__(riot_api.RiotClient)
        self.assertEqual(api._hosts("NA"), ("na1", "americas"))
        self.assertEqual(api._hosts("EUW"), ("euw1", "europe"))
        self.assertEqual(api._hosts("KR"), ("kr", "asia"))

    def test_region_inconnue_signalee(self):
        """[DETTE] Une région inconnue retombe EN SILENCE sur EUW : historique vide sans erreur."""
        api = riot_api.RiotClient.__new__(riot_api.RiotClient)
        with self.assertRaises(Exception):
            api._hosts("?")


def tearDownModule():
    shutil.rmtree(_SANDBOX, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
