"""The packaged backend must release its DLLs when the Tauri parent dies."""

import ctypes
import os
import subprocess
import sys
import unittest


@unittest.skipUnless(os.name == "nt", "Windows process handles required")
class ParentWatchTests(unittest.TestCase):
    def test_child_exits_when_parent_disappears(self):
        child_code = (
            "from backend.switcher import parent_watch; "
            "parent_watch.arm(); print('ready', flush=True); "
            "import time; time.sleep(60)"
        )
        parent_code = (
            "import os, subprocess, sys\n"
            "env = os.environ.copy()\n"
            "env['HEXGATE_PARENT_PID'] = str(os.getpid())\n"
            f"child = subprocess.Popen([sys.executable, '-c', {child_code!r}], "
            "env=env, stdout=subprocess.PIPE, text=True)\n"
            "assert child.stdout.readline().strip() == 'ready'\n"
            "print(child.pid, flush=True)\n"
        )
        parent = subprocess.run(
            [sys.executable, "-c", parent_code],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(parent.returncode, 0, parent.stderr)
        child_pid = int(parent.stdout.strip())

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        handle = kernel32.OpenProcess(0x00100000, False, child_pid)
        if not handle:
            return  # Already exited before the handle was opened.
        try:
            self.assertEqual(kernel32.WaitForSingleObject(handle, 5000), 0)
        finally:
            kernel32.CloseHandle(handle)
