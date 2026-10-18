"""Credential/login guards: isolated metadata, mocked Windows store and input."""
import ctypes
import json
import subprocess
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

from . import test_session_owner as fixtures
from backend.switcher import client_api, core, login_credentials as creds, login_fallback as filling


class CredentialTests(unittest.TestCase):
    def test_native_windows_roundtrip_and_delete_for_temporary_test_scope(self):
        # The fixtures' temporary storage path isolates this synthetic entry.
        with patch.object(creds.vault, "account_puuid", return_value="hexgate-login-unit-test"):
            try:
                creds.save("A", "synthetic-login", "synthetic-password")
                self.assertEqual(creds.read("A"), ("synthetic-login", "synthetic-password"))
                self.assertTrue(creds.configured("A"))
            finally:
                creds.delete("A")
            self.assertIsNone(creds.read("A"))

    def test_password_only_reaches_windows_not_metadata(self):
        api = Mock()
        captured = []
        def write(pointer, flags):
            credential = ctypes.cast(pointer, ctypes.POINTER(creds._Credential)).contents
            captured.append((credential.TargetName, ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)))
            return True
        api.CredWriteW.side_effect = write
        with patch.object(creds, "_api", return_value=api), patch.object(creds.vault, "account_puuid", return_value="test-owner"):
            creds.save("A", "login-name", "fake-password")
        self.assertTrue(captured[0][0].startswith("HexgateSwap/RiotLogin/"))
        self.assertEqual(json.loads(captured[0][1]), {"username": "login-name", "password": "fake-password"})

    def test_unknown_identity_never_writes(self):
        with patch.object(creds, "_api") as api, patch.object(creds.vault, "account_puuid", return_value=None):
            with self.assertRaises(ValueError): creds.save("A", "login", "password")
            api.assert_not_called()

    def test_control_characters_never_write(self):
        with patch.object(creds, "_api") as api:
            for password in ("", "a\nb", "a\tb", "a\x00b"):
                with self.assertRaises(ValueError): creds.save("A", "login", password)
            api.assert_not_called()

    def test_missing_is_disabled_but_access_denied_is_error(self):
        api = Mock(); api.CredReadW.return_value = False
        with patch.object(creds, "_api", return_value=api), patch.object(creds, "_target", return_value="test"), patch.object(ctypes, "get_last_error", return_value=1168):
            self.assertFalse(creds.configured("A"))
        with patch.object(creds, "_api", return_value=api), patch.object(creds, "_target", return_value="test"), patch.object(ctypes, "get_last_error", return_value=5):
            with self.assertRaises(RuntimeError): creds.read("A")


class ReadyTests(unittest.TestCase):
    def test_explicit_ready_signed_out_auth_form_required(self):
        with patch.object(client_api, "_call", side_effect=[(200, '{"ready":true}'), (404, '{}'), (200, '{"type":"auth"}')]), patch.object(client_api, "phase", return_value="Login"):
            self.assertTrue(client_api.login_ready())

    def test_startup_unknown_logged_in_and_challenge_are_blocked(self):
        cases = [ [(200, '{"ready":false}')],
                  [(200, '{"ready":true}'), (200, '{}'), (200, '{"type":"authenticated"}')],
                  [(200, '{"ready":true}'), (404, '{}'), (200, '{"type":"challenge"}')],
                  [(200, '{"ready":true}'), (503, '{}'), (200, '{"type":"auth"}')]]
        for responses in cases:
            with self.subTest(responses=responses), patch.object(client_api, "_call", side_effect=responses), patch.object(client_api, "phase", return_value="Login"):
                self.assertFalse(client_api.login_ready())


class InputTests(unittest.TestCase):
    def test_powershell_form_helper_parses_without_running_it(self):
        parser = "$errors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }; exit 0"
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", parser], input=filling._FOCUS_FORM, text=True, capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_not_ready_never_focuses_or_types(self):
        with patch.object(filling.client_api, "login_ready", return_value=False), patch.object(filling, "_focused_form") as focus:
            with self.assertRaises(RuntimeError): filling.fill("test-login", "fake-password")
            focus.assert_not_called()

    def test_other_executable_never_receives_input(self):
        user = Mock()
        with patch.object(filling.client_api, "login_ready", return_value=True), patch.object(filling.paths, "riot_client_exe", return_value=Path("C:/Riot/RiotClientServices.exe")), patch.object(filling, "_focused_form", return_value=101), patch.object(filling, "_window_path", return_value=Path("C:/Other.exe")), patch.object(ctypes, "WinDLL", return_value=user):
            with self.assertRaises(RuntimeError): filling.fill("test-login", "fake-password")
            user.SendInput.assert_not_called()

    def test_password_field_is_focused_directly_no_tab_or_clipboard(self):
        user = Mock(); user.GetForegroundWindow.return_value = 101
        events = []
        def send(count, inputs, size):
            events.extend((inputs[i].data.keyboard.vk, inputs[i].data.keyboard.scan, inputs[i].data.keyboard.flags) for i in range(count))
            return count
        user.SendInput.side_effect = send
        with patch.object(filling.client_api, "login_ready", return_value=True), patch.object(filling.paths, "riot_client_exe", return_value=Path("C:/Riot/RiotClientServices.exe")), patch.object(filling, "_focused_form", return_value=101) as focus, patch.object(filling, "_window_path", return_value=Path("C:/Riot/UX/RiotClientUx.exe")), patch.object(ctypes, "WinDLL", return_value=user):
            filling.fill("test-login", "fake-password")
        self.assertEqual(focus.call_count, 2)
        self.assertTrue(focus.call_args.kwargs["password"])
        self.assertFalse(any(vk == 9 for vk, _, _ in events))
        self.assertEqual("".join(chr(scan) for _, scan, flags in events if flags == 4), "test-loginfake-password")

    def test_focus_loss_stops_before_any_text(self):
        user = Mock(); user.GetForegroundWindow.return_value = 202
        with patch.object(filling.client_api, "login_ready", return_value=True), patch.object(filling.paths, "riot_client_exe", return_value=Path("C:/Riot/RiotClientServices.exe")), patch.object(filling, "_focused_form", return_value=101), patch.object(filling, "_window_path", return_value=Path("C:/Riot/UX/RiotClientUx.exe")), patch.object(ctypes, "WinDLL", return_value=user):
            with self.assertRaises(RuntimeError): filling.fill("test-login", "fake-password")
            user.SendInput.assert_not_called()


class OrchestrationTests(unittest.TestCase):
    def setup_reconnect(self, stack, identities):
        account = Mock(riot_id="test#EUW")
        account.name = "A"
        stack.enter_context(patch.object(core.vault, "list_accounts", return_value=[account]))
        stack.enter_context(patch.object(core.vault, "account_puuid", return_value="test-owner"))
        stack.enter_context(patch.object(core, "prepare_new_login"))
        stack.enter_context(patch.object(core.time, "sleep"))
        stack.enter_context(patch.object(core.client_api, "current_identity", side_effect=identities))
        stack.enter_context(patch.object(core.client_api, "login_ready", return_value=True))
        stack.enter_context(patch.object(core.login_credentials, "read", return_value=("test-login", "fake-password")))
        stack.enter_context(patch.object(core, "_save_authenticated_session", return_value=True))

    def test_one_attempt_then_wait_for_2fa_and_verify_identity(self):
        with ExitStack() as stack:
            self.setup_reconnect(stack, [None, None, {"puuid": "test-owner"}])
            fill = stack.enter_context(patch.object(core.login_fallback, "fill"))
            verify = stack.enter_context(patch.object(core, "_assert_expected_account"))
            core.reconnect_expired("A", product="valorant")
            fill.assert_called_once(); verify.assert_called_once_with("A")
            core.prepare_new_login.assert_called_once_with(product="valorant", on_status=unittest.mock.ANY)

    def test_wrong_account_never_saves(self):
        with ExitStack() as stack:
            self.setup_reconnect(stack, [{"puuid": "wrong"}])
            stack.enter_context(patch.object(core, "_assert_expected_account", side_effect=core.WrongAccountLoggedIn("wrong")))
            with self.assertRaises(core.WrongAccountLoggedIn): core.reconnect_expired("A")
            core._save_authenticated_session.assert_not_called()

    def test_fill_failure_falls_back_to_manual_without_retry(self):
        with ExitStack() as stack:
            self.setup_reconnect(stack, [None, None, {"puuid": "test-owner"}])
            fill = stack.enter_context(patch.object(core.login_fallback, "fill", side_effect=RuntimeError("focus")))
            stack.enter_context(patch.object(core, "_assert_expected_account"))
            status = Mock()
            core.reconnect_expired("A", on_status=status)
            fill.assert_called_once()
            self.assertTrue(any("manuellement" in call.args[0] for call in status.call_args_list))

    def test_unknown_startup_timeout_never_reconnects(self):
        with patch.object(core.client_api, "is_logged_in", return_value=False), patch.object(core.client_api, "phase", return_value="Patching"), patch.object(core.time, "monotonic", side_effect=[0, 0, 121]), patch.object(core.time, "sleep"), patch.object(core, "reconnect_expired") as reconnect:
            with self.assertRaises(TimeoutError): core._wait_and_launch_product("A", "league_of_legends", lambda _: None)
            reconnect.assert_not_called()

    def setup_swap(self, stack):
        from backend.switcher import deceive
        stack.enter_context(patch.object(deceive, "ensure_ready"))
        stack.enter_context(patch.object(core.vault, "check_stored_session", return_value=None))
        account = Mock(expired=False); account.name = "A"
        stack.enter_context(patch.object(core.vault, "list_accounts", return_value=[account]))
        stack.enter_context(patch.object(core.client_api, "current_identity", return_value=None))
        stack.enter_context(patch.object(core.vault, "account_puuid", return_value="test-owner"))
        for module, name in [(core, "_preserve_connected_session"), (core.process, "kill_riot"), (core.vault, "refresh_active"), (core.vault, "restore"), (core.vault, "set_active"), (core.process, "launch_product")]:
            stack.enter_context(patch.object(module, name))

    def test_rejected_session_renews_once_and_launches_same_product(self):
        with ExitStack() as stack:
            self.setup_swap(stack)
            wait = stack.enter_context(patch.object(core, "_wait_and_launch_product", side_effect=[core.SessionExpired("rejected"), None]))
            reconnect = stack.enter_context(patch.object(core, "reconnect_expired"))
            stack.enter_context(patch.object(creds, "configured", return_value=True))
            core.swap("A", product="valorant")
            reconnect.assert_called_once_with("A", on_status=unittest.mock.ANY, product="valorant")
            self.assertEqual(wait.call_count, 2)

    def test_mismatched_session_never_uses_credentials_or_closes_client(self):
        with ExitStack() as stack:
            self.setup_swap(stack)
            stack.enter_context(patch.object(core.vault, "check_stored_session", return_value="wrong owner"))
            reconnect = stack.enter_context(patch.object(core, "reconnect_expired"))
            with self.assertRaises(core.SessionExpired): core.swap("A")
            reconnect.assert_not_called(); core.process.kill_riot.assert_not_called()

    def test_rejected_session_without_credentials_preserves_manual_flow(self):
        with ExitStack() as stack:
            self.setup_swap(stack)
            stack.enter_context(patch.object(core, "_wait_and_launch_product", side_effect=core.SessionExpired("rejected")))
            reconnect = stack.enter_context(patch.object(core, "reconnect_expired"))
            stack.enter_context(patch.object(creds, "configured", return_value=False))
            with self.assertRaises(core.SessionExpired): core.swap("A")
            reconnect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
