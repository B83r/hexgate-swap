"""Non-régression : une session Riot ne doit jamais être rangée sous un autre compte.

Incident du 25/09/2026 : la session d'Unreal a été recopiée dans le dossier de
HideIntheShnek (client fermé → aucune identité live pour confronter le pointeur
« compte actif »). Le swap vers HideIntheShnek ouvrait alors Unreal.

Bac à sable identique à test_audit : aucun vrai compte n'est touché.
    python -m unittest backend.tests.test_session_owner -v
"""
import base64
import json
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

_SANDBOX = tempfile.mkdtemp(prefix="hexgate-owner-")
os.environ["LOCALAPPDATA"] = _SANDBOX
os.environ["PROGRAMDATA"] = os.path.join(_SANDBOX, "ProgramData")

from backend.switcher import core, dpapi, paths, vault  # noqa: E402

assert paths.STORAGE_DIR.is_relative_to(_SANDBOX), "bac à sable non appliqué : arrêt"

PUUID_A = "bbc69b39-55c5-5afc-96d5-5152ac1bcd51"
PUUID_B = "03374404-9f51-5776-9277-ab97fc9c669b"


def _jwt(sub: str) -> str:
    def b64(obj) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return f"{b64({'alg': 'RS256'})}.{b64({'sub': sub, 'iss': 'auth.riotgames.com'})}.c2lnbmF0dXJlLWJpZGlkb3VpbGxl"


def _session(sub: str) -> bytes:
    """Contenu type d'un RiotGamesPrivateSettings.yaml : cookies + jetons JWT."""
    return (f"riot-login:\n  persist:\n    session:\n      cookies:\n"
            f"      - name: \"ssid\"\n        value: {_jwt(sub)}\n"
            f"      - name: id_token\n        value: {_jwt(sub)}\n").encode()


def _account(name: str, puuid: str, sub: str | None = None) -> None:
    d = paths.ACCOUNTS_DIR / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "riot_client.bin").write_bytes(dpapi.protect(_session(sub or puuid)))
    (d / "league_client.bin").write_bytes(dpapi.protect(b"x" * 32))
    (d / "meta.json").write_text(json.dumps(
        {"name": name, "region": "EUW", "saved_at": 0, "riot_id": name, "puuid": puuid}),
        encoding="utf-8")


def _live(sub: str) -> None:
    for key, path in paths.SESSION_FILES.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_session(sub) if key == "riot_client" else b"x" * 32)


class SessionOwnerTests(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.STORAGE_DIR, ignore_errors=True)
        paths.ACCOUNTS_DIR.mkdir(parents=True)
        core._live_cache = None

    def test_lit_le_proprietaire_dun_fichier_de_session(self):
        self.assertEqual(vault.session_owner(_session(PUUID_A)), PUUID_A)

    def test_session_illisible_ou_contradictoire_donne_none(self):
        self.assertIsNone(vault.session_owner(b"pas un jeton"))
        mixte = _session(PUUID_A) + _session(PUUID_B)
        self.assertIsNone(vault.session_owner(mixte))

    def test_refresh_refuse_de_copier_la_session_dun_autre_compte(self):
        """Scénario exact du 25/09 : pointeur sur A, session live de B, client fermé."""
        _account("Hide", PUUID_A)
        _account("Unreal", PUUID_B)
        vault.set_active("Hide")
        _live(PUUID_B)
        avant = (paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes()
        self.assertIsNone(vault.refresh_active(expected_identity=None))
        self.assertEqual((paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes(), avant)
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)

    def test_refresh_reste_possible_pour_le_bon_compte(self):
        _account("Hide", PUUID_A)
        vault.set_active("Hide")
        _live(PUUID_A)
        self.assertEqual(vault.refresh_active(expected_identity=None), "Hide")

    def test_sauvegarde_manuelle_sous_le_mauvais_nom_refusee(self):
        _account("Hide", PUUID_A)
        _account("Unreal", PUUID_B)
        _live(PUUID_B)
        with self.assertRaises(ValueError):
            vault.capture("Hide")
        # sauvegarder Unreal sous un NOUVEAU nom (doublon) est refusé aussi
        with self.assertRaises(ValueError):
            vault.capture("Unreal bis")

    def test_nouveau_compte_inconnu_passe(self):
        _account("Hide", PUUID_A)
        _live(PUUID_B)
        vault.capture("Nouveau")
        self.assertEqual(vault.stored_session_owner("Nouveau"), PUUID_B)

    def test_swap_refuse_avant_de_fermer_le_client_si_session_abimee(self):
        """Session enregistrée de Hide appartenant à Unreal : swap stoppé net."""
        _account("Hide", PUUID_A, sub=PUUID_B)
        _account("Unreal", PUUID_B)
        with self.assertRaises(core.SessionExpired) as ctx:
            core.swap("Hide")
        self.assertIn("Unreal", str(ctx.exception))
        self.assertTrue(next(a for a in vault.list_accounts() if a.name == "Hide").expired)

    def test_audit_signale_uniquement_les_sessions_incoherentes(self):
        _account("Hide", PUUID_A, sub=PUUID_B)
        _account("Unreal", PUUID_B)
        self.assertEqual(vault.audit_sessions(), ["Hide"])
        self.assertEqual(vault.audit_sessions(), [])  # déjà marquée : pas de doublon


class SessionRecoveryTests(unittest.TestCase):
    """Filets de sécurité : historique, récupération, corbeille, rétention."""

    def setUp(self):
        shutil.rmtree(paths.STORAGE_DIR, ignore_errors=True)
        paths.ACCOUNTS_DIR.mkdir(parents=True)
        core._live_cache = None

    def test_capture_archive_la_version_saine_avant_de_la_remplacer(self):
        _account("Hide", PUUID_A)
        vault.set_active("Hide")
        _live(PUUID_A)
        vault.capture("Hide", refresh=True)
        self.assertEqual(len(vault._history_entries(paths.ACCOUNTS_DIR / "Hide")), 1)

    def test_pas_de_doublon_dhistorique_si_la_session_na_pas_change(self):
        _account("Hide", PUUID_A)
        _live(PUUID_A)
        for _ in range(3):
            vault.capture("Hide", refresh=True)
        self.assertLessEqual(len(vault._history_entries(paths.ACCOUNTS_DIR / "Hide")), 2)

    def test_une_session_abimee_nest_jamais_archivee(self):
        _account("Hide", PUUID_A, sub=PUUID_B)  # déjà écrasée
        _live(PUUID_A)
        vault.capture("Hide", refresh=True)
        self.assertEqual(vault._history_entries(paths.ACCOUNTS_DIR / "Hide"), [])

    def test_recuperation_depuis_lhistorique(self):
        _account("Hide", PUUID_A)
        _live(PUUID_A)
        vault.capture("Hide", refresh=True)  # crée une entrée d'historique saine
        _account("Hide", PUUID_A, sub=PUUID_B)  # puis écrasement accidentel
        self.assertIsNone(vault.check_stored_session("Hide"))  # soignée automatiquement
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)

    def test_recuperation_depuis_une_sauvegarde_de_demarrage(self):
        from backend.switcher import local_backup
        _account("Hide", PUUID_A)
        _account("Unreal", PUUID_B)
        archive = local_backup.create_startup_backup()
        self.assertIsNotNone(archive)
        _account("Hide", PUUID_A, sub=PUUID_B)  # écrasement après la sauvegarde
        self.assertIsNone(vault.check_stored_session("Hide"))
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)
        self.assertFalse(next(a for a in vault.list_accounts() if a.name == "Hide").expired)

    def test_audit_remet_en_service_un_compte_expire_sil_existe_une_copie_saine(self):
        from backend.switcher import local_backup
        _account("Hide", PUUID_A)
        local_backup.create_startup_backup()
        _account("Hide", PUUID_A, sub=PUUID_B)
        vault.mark_expired("Hide")
        vault.audit_sessions()
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)
        self.assertFalse(next(a for a in vault.list_accounts() if a.name == "Hide").expired)

    def test_suppression_passe_par_la_corbeille(self):
        _account("Hide", PUUID_A)
        vault.delete("Hide")
        self.assertFalse((paths.ACCOUNTS_DIR / "Hide").exists())
        corbeille = list((paths.STORAGE_DIR / "trash").glob("Hide_*"))
        self.assertEqual(len(corbeille), 1)
        self.assertTrue((corbeille[0] / "riot_client.bin").is_file())

    def test_retention_garde_une_sauvegarde_par_jour(self):
        from backend.switcher import local_backup
        _account("Hide", PUUID_A)
        dossier = paths.STORAGE_DIR / "backups"
        dossier.mkdir(parents=True, exist_ok=True)
        for jour in ("20260101", "20260102", "20260103"):
            for heure in range(15):  # 15 archives le même jour
                (dossier / f"hexgate_accounts_{jour}_{heure:02d}0000_000001.zip").write_bytes(b"x")
        local_backup.create_startup_backup(retention=3)
        restants = {p.name[17:25] for p in dossier.glob("hexgate_accounts_*.zip")}
        self.assertTrue({"20260101", "20260102", "20260103"} <= restants)


class SessionPersistenceTests(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.STORAGE_DIR, ignore_errors=True)
        paths.ACCOUNTS_DIR.mkdir(parents=True)
        _account("Hide", PUUID_A)
        _account("Unreal", PUUID_B)
        self.identity = {"puuid": PUUID_A, "riot_id": "Hide"}

    def test_reconnexion_sauvegarde_sans_client_league(self):
        _live(PUUID_A)
        vault.mark_expired("Hide")
        with patch.object(core, "prepare_new_login"), \
                patch.object(core.time, "sleep"), \
                patch.object(core.client_api, "current_identity", return_value=self.identity), \
                patch.object(core.lcu_api, "current_summoner", side_effect=AssertionError("LCU interdit")):
            core.reconnect_expired("Hide")
        self.assertFalse(next(a for a in vault.list_accounts() if a.name == "Hide").expired)
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)

    def test_attend_le_fichier_durable_apres_login(self):
        path = paths.SESSION_FILES["riot_client"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"riot-login:\n  persist: null\n")
        with patch.object(core.client_api, "current_identity", return_value=self.identity), \
                patch.object(core.time, "sleep", side_effect=lambda _: _live(PUUID_A)) as sleep:
            self.assertTrue(core._save_authenticated_session("Hide", lambda _: None))
        sleep.assert_called_once()
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)

    def test_format_riot_actuel_exige_un_jeton_de_renouvellement(self):
        modern = (
            "psl:\n  authorization:\n    session:\n      refresh_token: null\n"
            "rso-authenticator:\n  cookies:\n"
            "    - name: device\n      persistent: true\n      value: dummy\n"
            f"  id_token: {_jwt(PUUID_A)}\n"
        )
        self.assertFalse(vault.has_persistent_session(modern))
        _live(PUUID_A)
        paths.SESSION_FILES["riot_client"].write_text(
            modern + "  refresh_token: dummy-refresh\n", encoding="utf-8")
        with patch.object(core.client_api, "current_identity", return_value=self.identity):
            self.assertTrue(core._save_authenticated_session("Hide", lambda _: None))
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)

    def test_absence_de_jeton_ne_reutilise_pas_ancienne_copie(self):
        _live(PUUID_A)
        before = (paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes()
        paths.SESSION_FILES["riot_client"].write_bytes(b"riot-login:\n  persist: null\n")
        messages = []
        with patch.object(core.client_api, "current_identity", return_value=self.identity), \
                patch.object(core.time, "monotonic", side_effect=[0, 0, 2]), \
                patch.object(core.time, "sleep"):
            self.assertFalse(core._save_authenticated_session("Hide", messages.append, timeout=1))
        self.assertTrue(next(a for a in vault.list_accounts() if a.name == "Hide").expired)
        self.assertEqual((paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes(), before)
        self.assertIn("non sauvegardée", messages[-1])
        with patch.object(core.process, "kill_riot") as kill:
            with self.assertRaises(core.SessionExpired):
                core.swap("Hide")
            kill.assert_not_called()

    def test_fichier_encore_sur_autre_compte_nest_pas_capture(self):
        _live(PUUID_B)
        before = (paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes()
        with patch.object(core.client_api, "current_identity", return_value=self.identity), \
                patch.object(core.time, "monotonic", side_effect=[0, 0, 2]), \
                patch.object(core.time, "sleep"):
            self.assertFalse(core._save_authenticated_session("Hide", lambda _: None, timeout=1))
        self.assertEqual((paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes(), before)

    def test_reconnexion_sur_mauvais_compte_est_refusee(self):
        _live(PUUID_B)
        with patch.object(core, "prepare_new_login"), \
                patch.object(core.time, "sleep"), \
                patch.object(core.client_api, "current_identity", return_value={"puuid": PUUID_B, "riot_id": "Unreal"}):
            with self.assertRaises(core.WrongAccountLoggedIn):
                core.reconnect_expired("Hide")
        self.assertEqual(vault.stored_session_owner("Hide"), PUUID_A)

    def test_sauvegarde_avant_arret_utilise_identite_reelle(self):
        _live(PUUID_A)
        vault.set_active("Unreal")
        with patch.object(core.client_api, "current_identity", return_value=self.identity):
            core._preserve_connected_session(self.identity, lambda _: None)
        self.assertEqual(vault.get_active(), "Hide")
        self.assertEqual(vault.stored_session_owner("Unreal"), PUUID_B)

    def test_capture_automatique_exige_identite_du_fichier(self):
        _live(PUUID_A)
        before = (paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes()
        paths.SESSION_FILES["riot_client"].write_bytes(b'riot-login:\n  cookie: "ssid"\n')
        with self.assertRaises(ValueError):
            vault.capture("Hide", refresh=True, expected_owner=PUUID_A)
        vault.set_active("Hide")
        self.assertIsNone(vault.refresh_active(expected_identity=self.identity))
        self.assertEqual((paths.ACCOUNTS_DIR / "Hide" / "riot_client.bin").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
