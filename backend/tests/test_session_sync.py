"""Rotation de session : tests isolés, sans client ni coffre utilisateur."""
import json
import shutil
import unittest
from unittest.mock import patch

from . import test_session_owner as fixtures
from backend.switcher import dpapi, paths, vault, session_sync


def modern(owner, token='new-token'):
    return (f'psl:\n  authorization:\n    riot-client:\n      id_token: {fixtures._jwt(owner)}\n'
            f'      refresh_token: {token}\n'
            'rso-authenticator:\n  cookies:\n    - name: session\n'
            '      value: cookie\n      persistent: true\n').encode()


class SessionSyncTests(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.STORAGE_DIR, ignore_errors=True)
        paths.ACCOUNTS_DIR.mkdir(parents=True)
        fixtures._account('A', fixtures.PUUID_A)
        fixtures._account('B', fixtures.PUUID_B)
        vault.set_active('B')  # pointeur obsolète volontaire
        fixtures._live(fixtures.PUUID_A)
        paths.SESSION_FILES['riot_client'].write_bytes(modern(fixtures.PUUID_A))
        self.monitor = session_sync.SessionSync()
        self.identity = patch.object(session_sync.client_api, 'current_identity', return_value={'puuid': fixtures.PUUID_A})
        self.identity.start()
        self.addCleanup(self.identity.stop)

    def stored(self, name='A'):
        return dpapi.unprotect((paths.ACCOUNTS_DIR / name / 'riot_client.bin').read_bytes())

    def test_rotation_preserves_owner_and_never_writes_live_files(self):
        before_b = self.stored('B')
        live = paths.SESSION_FILES['riot_client'].read_bytes()
        league_saved = (paths.ACCOUNTS_DIR / 'A' / 'league_client.bin').read_bytes()
        league_live = paths.SESSION_FILES['league_client'].read_bytes()
        self.assertIsNone(self.monitor.tick())
        self.assertEqual(self.monitor.tick(), 'A')
        self.assertEqual(self.stored(), live)
        self.assertEqual(self.stored('B'), before_b)
        self.assertEqual((paths.ACCOUNTS_DIR / 'A' / 'league_client.bin').read_bytes(), league_saved)
        self.assertEqual(paths.SESSION_FILES['league_client'].read_bytes(), league_live)
        self.assertEqual(paths.SESSION_FILES['riot_client'].read_bytes(), live)
        self.assertEqual(vault.get_active(), 'A')

    def test_each_rotation_is_saved_once(self):
        with patch.object(vault, 'capture', wraps=vault.capture) as capture:
            self.monitor.tick(); self.monitor.tick(); self.monitor.tick()
            self.assertEqual(capture.call_count, 1)
            paths.SESSION_FILES['riot_client'].write_bytes(modern(fixtures.PUUID_A, 'next-token'))
            self.monitor.tick(); self.monitor.tick(); self.monitor.tick()
            self.assertEqual(capture.call_count, 2)

    def test_partial_or_nonpersistent_write_does_not_overwrite_good_copy(self):
        before = self.stored()
        paths.SESSION_FILES['riot_client'].write_bytes(modern(fixtures.PUUID_A).replace(b'persistent: true', b'persistent: false'))
        self.monitor.tick(); self.assertIsNone(self.monitor.tick())
        self.assertEqual(self.stored(), before)

    def test_identity_mismatch_or_unavailable_does_not_save(self):
        before = self.stored()
        self.monitor.tick()
        for identity in (None, {'puuid': fixtures.PUUID_B}):
            with patch.object(session_sync.client_api, 'current_identity', return_value=identity):
                self.assertIsNone(self.monitor.tick())
        self.assertEqual(self.stored(), before)

    def test_live_rotation_during_validation_is_retried(self):
        before = self.stored()
        self.monitor.tick()
        def rotate():
            paths.SESSION_FILES['riot_client'].write_bytes(modern(fixtures.PUUID_A, 'newer-token'))
            return {'puuid': fixtures.PUUID_A}
        with patch.object(session_sync.client_api, 'current_identity', side_effect=rotate):
            self.assertIsNone(self.monitor.tick())
        self.assertEqual(self.stored(), before)
        self.monitor.tick()
        self.assertEqual(self.monitor.tick(), 'A')
        self.assertIn(b'newer-token', self.stored())

    def test_reauthenticated_expired_account_becomes_usable(self):
        vault.mark_expired('A')
        self.monitor.tick(); self.assertEqual(self.monitor.tick(), 'A')
        self.assertFalse(next(a for a in vault.list_accounts() if a.name == 'A').expired)

    def test_deleted_account_is_not_recreated(self):
        self.monitor.tick()
        shutil.rmtree(paths.ACCOUNTS_DIR / 'A')
        self.assertIsNone(self.monitor.tick())
        self.assertFalse((paths.ACCOUNTS_DIR / 'A').exists())

    def test_ambiguous_owner_is_not_guessed(self):
        fixtures._account('Duplicate', fixtures.PUUID_A)
        before = self.stored()
        self.monitor.tick(); self.assertIsNone(self.monitor.tick())
        self.assertEqual(self.stored(), before)

    def test_already_current_file_is_not_written_again(self):
        vault.sync_authenticated_session({'puuid': fixtures.PUUID_A}, paths.SESSION_FILES['riot_client'].read_bytes())
        with patch.object(vault, 'capture', wraps=vault.capture) as capture:
            self.monitor.tick(); self.monitor.tick(); self.monitor.tick()
            capture.assert_not_called()


if __name__ == '__main__':
    unittest.main()
