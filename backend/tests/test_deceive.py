"""Presence bridge checks without opening Riot or Deceive."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

_sandbox = tempfile.TemporaryDirectory(prefix="hexgate-deceive-test-")
os.environ["LOCALAPPDATA"] = _sandbox.name
os.environ["APPDATA"] = _sandbox.name

from backend.switcher import deceive, process  # noqa: E402


class DeceiveBridgeTests(unittest.TestCase):
    def test_state_only_claims_active_when_proxy_confirms_connection(self):
        with patch.object(deceive, "_control_request", return_value={
            "status": "offline", "enabled": True, "connected": False, "lobbyChat": True,
        }), patch.object(deceive, "is_process_running", return_value=True), \
                patch.object(deceive, "executable", return_value=Path(__file__)):
            state = deceive.state()
        self.assertTrue(state["running"])
        self.assertFalse(state["connected"])
        self.assertTrue(state["proxy_enabled"])

    def test_configure_rejects_missing_engine_without_changing_setting(self):
        with patch.object(deceive, "executable", return_value=Path(_sandbox.name) / "missing.exe"), \
                patch.object(deceive.settings, "set") as save:
            with self.assertRaises(FileNotFoundError):
                deceive.configure(True, "offline")
            save.assert_not_called()

    def test_configure_does_not_save_if_live_proxy_rejects_change(self):
        with patch.object(deceive, "executable", return_value=Path(__file__)), \
                patch.object(deceive, "_control_request", side_effect=[{"status": "chat", "lobbyChat": True}, None]), \
                patch.object(deceive.settings, "set") as save:
            with self.assertRaises(RuntimeError):
                deceive.configure(True, "offline")
            save.assert_not_called()

    def test_launch_uses_bundled_engine_and_hexgate_control(self):
        fake_process = Mock()
        fake_process.poll.return_value = None
        with patch.object(deceive, "executable", return_value=Path(__file__)), \
                patch.object(deceive, "ensure_ready"), \
                patch.object(deceive, "enabled", return_value=True), \
                patch.object(deceive, "is_process_running", return_value=False), \
                patch.object(deceive, "_control_request", return_value={"status": "offline"}), \
                patch.object(deceive, "_managed_process", None), \
                patch.object(deceive.subprocess, "Popen", return_value=fake_process) as spawn, \
                patch.object(deceive.settings, "get", return_value="offline"):
            deceive.launch("valorant")
        args, kwargs = spawn.call_args
        self.assertEqual(args[0][1], "valorant")
        self.assertEqual(len(kwargs["env"]["HEXGATE_CONTROL_TOKEN"]), 64)
        self.assertEqual(kwargs["env"]["HEXGATE_CONTROL_FILE"], str(deceive.CONTROL_FILE))

    def test_swap_launcher_selects_deceive_when_enabled(self):
        with patch.object(deceive, "enabled", return_value=True), \
                patch.object(deceive, "launch") as launch:
            process.launch_product("league_of_legends")
            launch.assert_called_once_with("league_of_legends")


if __name__ == "__main__":
    unittest.main()
