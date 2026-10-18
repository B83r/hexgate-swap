"""Optimisation du lancement sans contourner l'identité ou la sauvegarde."""
import ctypes
import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

from . import test_session_owner as fixtures
from backend.switcher import core, process


class ProcessSnapshotTests(unittest.TestCase):
    def kernel(self):
        kernel=Mock()
        kernel.CreateToolhelp32Snapshot.return_value=123
        def first(handle, pointer):
            ctypes.cast(pointer,ctypes.POINTER(process._PROCESSENTRY32W)).contents.szExeFile='LeagueClient.exe'
            return True
        kernel.Process32FirstW.side_effect=first
        kernel.Process32NextW.return_value=False
        return kernel

    def test_native_enumeration_closes_handle(self):
        kernel=self.kernel()
        with patch.object(process.ctypes,'WinDLL',return_value=kernel), patch.object(process.ctypes,'get_last_error',return_value=18):
            self.assertEqual(process._native_process_names(),['LeagueClient.exe'])
        kernel.CloseHandle.assert_called_once_with(123)

    def test_iteration_error_closes_handle_and_fails(self):
        kernel=self.kernel()
        with patch.object(process.ctypes,'WinDLL',return_value=kernel), patch.object(process.ctypes,'get_last_error',return_value=5):
            with self.assertRaises(OSError): process._native_process_names()
        kernel.CloseHandle.assert_called_once_with(123)

    def test_empty_snapshot_is_valid(self):
        kernel=self.kernel()
        kernel.Process32FirstW.side_effect=None
        kernel.Process32FirstW.return_value=False
        with patch.object(process.ctypes,'WinDLL',return_value=kernel), patch.object(process.ctypes,'get_last_error',return_value=18):
            self.assertEqual(process._native_process_names(),[])
        kernel.CloseHandle.assert_called_once_with(123)

    def test_failed_creation_does_not_close_invalid_handle(self):
        kernel=self.kernel()
        kernel.CreateToolhelp32Snapshot.return_value=ctypes.c_void_p(-1).value
        with patch.object(process.ctypes,'WinDLL',return_value=kernel), patch.object(process.ctypes,'get_last_error',return_value=5):
            with self.assertRaises(OSError): process._native_process_names()
        kernel.CloseHandle.assert_not_called()

    def test_native_success_never_spawns_tasklist(self):
        with patch.object(process,'_native_process_names',return_value=['LeagueClient.exe']), patch.object(process.subprocess,'run') as run:
            self.assertEqual(process.product_activity('league_of_legends'),'client')
            run.assert_not_called()

    def test_native_failure_uses_old_fresh_detection(self):
        with patch.object(process,'_native_process_names',side_effect=OSError), patch.object(process.subprocess,'run',return_value=Mock(stdout=b'"LeagueClient.exe","1"')) as run:
            self.assertEqual(process.product_activity('league_of_legends'),'client')
            run.assert_called_once()


class LaunchOrderingTests(unittest.TestCase):
    def test_launch_runs_while_save_finishes_after_identity_check(self):
        order=[]
        with patch.object(core.client_api,'is_logged_in',return_value=True), \
             patch.object(core,'_assert_expected_account',side_effect=lambda name: order.append('identity')), \
             patch.object(core.client_api,'launch_product',side_effect=lambda product: order.append('launch') or True), \
             patch.object(core,'_save_authenticated_session',side_effect=lambda *args: order.append('save') or True), \
             patch.object(core,'_ensure_product_started',side_effect=lambda *args: order.append('observe')):
            core._wait_and_launch_product('A','league_of_legends',lambda _: None)
        self.assertEqual(order,['identity','launch','save','observe'])

    def test_wrong_identity_prevents_any_launch(self):
        with patch.object(core.client_api,'is_logged_in',return_value=True), \
             patch.object(core,'_assert_expected_account',side_effect=core.WrongAccountLoggedIn('wrong owner')), \
             patch.object(core.client_api,'launch_product') as launch, \
             patch.object(core,'_save_authenticated_session') as save:
            with self.assertRaises(core.WrongAccountLoggedIn):
                core._wait_and_launch_product('A','league_of_legends',lambda _: None)
            launch.assert_not_called(); save.assert_not_called()

    def test_launcher_not_ready_still_preserves_session_before_retry(self):
        order=[]
        def launch_product(product):
            order.append('launch')
            return order.count('launch') > 1
        with patch.object(core.client_api,'is_logged_in',return_value=True), \
             patch.object(core,'_assert_expected_account'), \
             patch.object(core.client_api,'launch_product',side_effect=launch_product) as launch, \
             patch.object(core,'_save_authenticated_session',side_effect=lambda *args: order.append('save') or True) as save, \
             patch.object(core,'_ensure_product_started'), patch.object(core.time,'sleep'):
            core._wait_and_launch_product('A','league_of_legends',lambda _: None)
            self.assertEqual(launch.call_count,2)
            save.assert_called_once()
        self.assertEqual(order,['launch','save','launch'])


class SameAccountReopenTests(unittest.TestCase):
    def exercise(self, live, known='owner-a', proxy=False, connected=False, activity='none'):
        with ExitStack() as stack:
            mocks={}
            values={
                'vault.check_stored_session':None, 'vault.list_accounts':[],
                'vault.account_puuid':known, 'client_api.current_identity':live,
                'deceive.enabled':proxy, 'deceive.state':{'connected':connected},
                'process.product_activity':activity,
            }
            from backend.switcher import deceive
            modules={'vault':core.vault,'client_api':core.client_api,'deceive':deceive,'process':process}
            for key,value in values.items():
                module,attr=key.split('.')
                mocks[key]=stack.enter_context(patch.object(modules[module],attr,return_value=value))
            for key in ['deceive.ensure_ready','vault.set_active','vault.restore','vault.refresh_active',
                        'process.kill_riot','process.launch_product']:
                module,attr=key.split('.')
                mocks[key]=stack.enter_context(patch.object(modules[module],attr))
            for key in ['_assert_expected_account','_preserve_connected_session','_wait_and_launch_product']:
                mocks[key]=stack.enter_context(patch.object(core,key))
            core.swap('A')
        return mocks

    def test_same_verified_account_keeps_riot_and_uses_launcher(self):
        mocks=self.exercise({'puuid':'owner-a'})
        mocks['process.kill_riot'].assert_not_called()
        mocks['vault.restore'].assert_not_called()
        mocks['process.launch_product'].assert_not_called()
        mocks['_assert_expected_account'].assert_called_once_with('A')
        mocks['_wait_and_launch_product'].assert_called_once()

    def test_already_open_product_is_not_restarted(self):
        mocks=self.exercise({'puuid':'owner-a'},activity='client')
        mocks['process.kill_riot'].assert_not_called()
        mocks['_wait_and_launch_product'].assert_not_called()
        mocks['_preserve_connected_session'].assert_called_once()

    def test_different_account_still_restarts_and_restores(self):
        mocks=self.exercise({'puuid':'owner-b'})
        mocks['process.kill_riot'].assert_called_once()
        mocks['vault.restore'].assert_called_once_with('A')

    def test_unknown_identity_never_reuses_pointer(self):
        for live,known in [(None,'owner-a'),({'puuid':'owner-a'},None)]:
            mocks=self.exercise(live,known)
            mocks['process.kill_riot'].assert_called_once()

    def test_presence_mode_requires_connected_proxy(self):
        mocks=self.exercise({'puuid':'owner-a'},proxy=True,connected=False)
        mocks['process.kill_riot'].assert_called_once()
        mocks=self.exercise({'puuid':'owner-a'},proxy=True,connected=True)
        mocks['process.kill_riot'].assert_not_called()


if __name__=='__main__': unittest.main()
