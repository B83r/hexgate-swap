"""Guarded native login filling. No clipboard and no secrets in subprocesses.

UI Automation identifies and focuses the actual username edit. If the Riot
login form is not accessible, stop and let the user connect manually.
"""
import ctypes
from ctypes import wintypes as w
import json
import subprocess
from pathlib import Path

from . import client_api, paths

_FOCUS_FORM = r'''
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$expected = $request.path
$processes = @(Get-Process -Name RiotClientUx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $expected })
foreach ($process in $processes) {
  if ($process.MainWindowHandle -eq 0) { continue }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $users = @($edits | Where-Object { -not $_.Current.IsPassword -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen })
  $passwords = @($edits | Where-Object { $_.Current.IsPassword -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen })
  if ($users.Count -ne 1 -or $passwords.Count -ne 1) { continue }
  $checks = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::CheckBox))
  foreach ($check in $checks) {
    if ($check.Current.Name -match '(?i)stay signed in|remember me|rester connect|se souvenir') {
      $toggle = $check.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) { $toggle.Toggle() }
    }
  }
  if ($request.password) { $passwords[0].SetFocus() } else { $users[0].SetFocus() }
  @{ hwnd = [long]$process.MainWindowHandle; pid = $process.Id } | ConvertTo-Json -Compress
  exit 0
}
exit 1
'''


class _Keyboard(ctypes.Structure):
    _fields_ = [("vk", w.WORD), ("scan", w.WORD), ("flags", w.DWORD),
                ("time", w.DWORD), ("extra", ctypes.c_size_t)]


class _Mouse(ctypes.Structure):
    _fields_ = [("dx", w.LONG), ("dy", w.LONG), ("data", w.DWORD),
                ("flags", w.DWORD), ("time", w.DWORD), ("extra", ctypes.c_size_t)]


class _Union(ctypes.Union):
    _fields_ = [("keyboard", _Keyboard), ("mouse", _Mouse)]


class _Input(ctypes.Structure):
    _fields_ = [("type", w.DWORD), ("data", _Union)]


def _window_path(hwnd: int) -> Path | None:
    user = ctypes.WinDLL("user32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    pid = w.DWORD()
    user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    handle = kernel.OpenProcess(0x1000, False, pid.value)
    if not handle:
        return None
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        size = w.DWORD(len(buffer))
        if kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return Path(buffer.value)
        return None
    finally:
        kernel.CloseHandle(handle)


def _focused_form(expected: Path, password: bool = False) -> int:
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", _FOCUS_FORM],
            input=json.dumps({"path": str(expected), "password": password}), text=True,
            capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Le formulaire Riot ne répond pas. Connecte-toi manuellement.") from None
    if result.returncode:
        raise RuntimeError("Formulaire Riot non détecté. Connecte-toi manuellement dans Riot.")
    return int(json.loads(result.stdout)["hwnd"])


def fill(username: str, password: str) -> None:
    if not client_api.login_ready():
        raise RuntimeError("Riot n'est pas prêt à recevoir les identifiants.")
    exe = paths.riot_client_exe()
    if exe is None:
        raise RuntimeError("Client Riot introuvable.")
    expected = exe.parent / "UX" / "RiotClientUx.exe"
    hwnd = _focused_form(expected)
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.GetForegroundWindow.restype = w.HWND
    user.SendInput.argtypes = [w.UINT, ctypes.POINTER(_Input), ctypes.c_int]
    user.SendInput.restype = w.UINT
    if _window_path(hwnd) != expected or not client_api.login_ready():
        raise RuntimeError("Fenêtre ou état Riot invalide. Connecte-toi manuellement.")

    def send(vk: int = 0, scan: int = 0, flags: int = 0):
        if user.GetForegroundWindow() != hwnd:
            raise RuntimeError("La fenêtre Riot a perdu le focus. Reconnexion automatique interrompue.")
        # Send down/up together so a focus change cannot leave modifiers held.
        events = (_Input * 2)(
            _Input(type=1, data=_Union(keyboard=_Keyboard(vk, scan, flags, 0, 0))),
            _Input(type=1, data=_Union(keyboard=_Keyboard(vk, scan, flags | 2, 0, 0))),
        )
        if user.SendInput(2, events, ctypes.sizeof(_Input)) != 2:
            raise RuntimeError("Windows a refusé le remplissage. Connecte-toi manuellement.")

    def text(value: str):
        encoded = value.encode("utf-16-le")
        for index in range(0, len(encoded), 2):
            send(scan=int.from_bytes(encoded[index:index + 2], "little"), flags=4)

    # Select existing text with an atomic Ctrl+A batch; no clipboard involved.
    def select_all():
        if user.GetForegroundWindow() != hwnd:
            raise RuntimeError("La fenêtre Riot a perdu le focus.")
        keys = [(0x11, 0), (0x41, 0), (0x41, 2), (0x11, 2)]
        events = (_Input * 4)(*[_Input(type=1, data=_Union(keyboard=_Keyboard(key, 0, flags, 0, 0))) for key, flags in keys])
        if user.SendInput(4, events, ctypes.sizeof(_Input)) != 4:
            raise RuntimeError("Remplissage refusé par Windows.")

    select_all()
    text(username)
    if _focused_form(expected, password=True) != hwnd or not client_api.login_ready():
        raise RuntimeError("Le formulaire Riot a changé. Connecte-toi manuellement.")
    select_all()
    text(password)
    send(vk=0x0D)
