"""Stop the packaged backend if its Tauri parent exits unexpectedly on Windows."""

import ctypes
import os
import threading


def arm() -> None:
    """Watch the parent handle supplied by Tauri; standalone runs are unaffected."""
    parent_text = os.environ.get("HEXGATE_PARENT_PID")
    if os.name != "nt" or not parent_text:
        return
    try:
        parent_pid = int(parent_text)
    except ValueError:
        return
    if parent_pid <= 0:
        return

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
    kernel32.WaitForSingleObject.restype = ctypes.c_uint32
    kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
    kernel32.CloseHandle.restype = ctypes.c_int
    parent = kernel32.OpenProcess(0x00100000, False, parent_pid)  # SYNCHRONIZE
    if not parent:
        os._exit(0)

    def watch() -> None:
        try:
            kernel32.WaitForSingleObject(parent, 0xFFFFFFFF)
        finally:
            kernel32.CloseHandle(parent)
        os._exit(0)

    threading.Thread(target=watch, name="hexgate-parent-watch", daemon=True).start()
