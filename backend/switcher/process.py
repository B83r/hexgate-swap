"""Arrêt et relance des processus Riot / League."""
import subprocess
import threading
import time
import ctypes

from . import paths

# Ordre d'arrêt : jeux/UX d'abord, services en dernier.
RIOT_PROCESSES = [
    "LeagueClientUxRender.exe",
    "LeagueClientUx.exe",
    "LeagueClient.exe",
    "League of Legends.exe",
    "VALORANT.exe",
    "VALORANT-Win64-Shipping.exe",
    "Riot Client.exe",
    "RiotClientUx.exe",
    "RiotClientUxRender.exe",
    "RiotClientCrashHandler.exe",
    "RiotClientServices.exe",
]

_NO_WINDOW = subprocess.CREATE_NO_WINDOW


RIOT_CLIENT_PROCESSES = ["RiotClientServices.exe", "RiotClientUx.exe", "RiotClientUxRender.exe"]
LEAGUE_CLIENT_PROCESSES = ["LeagueClientUx.exe", "LeagueClient.exe"]
VALORANT_CLIENT_PROCESSES = ["VALORANT.exe"]
VALORANT_GAME_PROCESSES = ["VALORANT-Win64-Shipping.exe"]

PRODUCTS = {"league_of_legends", "valorant"}


def _tasklist_lower() -> str:
    raw = subprocess.run(
        ["tasklist", "/FO", "CSV", "/NH"],
        capture_output=True, creationflags=_NO_WINDOW,
    ).stdout or b""
    # décodage tolérant : la console Windows peut émettre des octets non-UTF8,
    # et seuls les noms ASCII des processus nous intéressent
    return raw.decode("ascii", errors="ignore").lower()


# `tasklist` coûte ~450 ms par appel (spawn + énumération complète des
# process Windows) — trop lent pour rester dans le chemin d'une requête HTTP
# appelée à chaque lancement de l'app et sur presque tout event SSE (constat
# Yaniss du 17/09/2026, « les comptes mettent plusieurs secondes avant
# d'apparaître »). Un thread dédié le rafraîchit en tâche de fond ; les
# routes lisent juste `cached_tasklist_lower()`, jamais bloquant — même
# principe que `_gameflow_watcher.phase` (phase lue en mémoire, zéro appel
# LCU dans le chemin de requête).
_tasklist_cache_lock = threading.Lock()
_tasklist_cache = ""


def cached_tasklist_lower() -> str:
    with _tasklist_cache_lock:
        return _tasklist_cache


def start_tasklist_watcher() -> None:
    def _loop():
        global _tasklist_cache
        while True:
            try:
                out = _tasklist_lower()
                with _tasklist_cache_lock:
                    _tasklist_cache = out
            except Exception:
                pass
            time.sleep(1.0)

    threading.Thread(target=_loop, daemon=True).start()


def is_riot_running() -> bool:
    out = _tasklist_lower()
    return any(name.lower() in out for name in RIOT_PROCESSES)


def is_riot_client_running() -> bool:
    """Riot Client (le launcher) présent, indépendamment du client League."""
    out = _tasklist_lower()
    return any(name.lower() in out for name in RIOT_CLIENT_PROCESSES)


def is_league_client_running() -> bool:
    """Client League of Legends (LeagueClientUx) présent."""
    out = _tasklist_lower()
    return any(name.lower() in out for name in LEAGUE_CLIENT_PROCESSES)


def is_valorant_running() -> bool:
    """Vrai si le client ou le jeu VALORANT est présent."""
    out = _tasklist_lower()
    return any(name.lower() in out for name in VALORANT_CLIENT_PROCESSES + VALORANT_GAME_PROCESSES)


def product_activity(product: str, _tasklist: str | None = None) -> str:
    """Etat local non intrusif : none, client ou in_game.

    VALORANT ne publie pas de signal de matchmaking documenté exploitable ici.
    Le processus de jeu déclenche donc l'avertissement fort ; un client au menu
    reste une confirmation simple.

    `_tasklist` : sortie déjà récupérée à réutiliser (évite de relancer
    `tasklist`, un sous-processus coûteux — ~450 ms mesurés — pour chaque
    produit alors qu'un seul appel couvre les deux ; voir son usage dans la
    route `/accounts`, qui vérifie systématiquement les deux jeux).
    """
    out = _tasklist if _tasklist is not None else _tasklist_lower()
    if product == "league_of_legends":
        return "client" if any(name.lower() in out for name in LEAGUE_CLIENT_PROCESSES) else "none"
    if product == "valorant":
        if any(name.lower() in out for name in VALORANT_GAME_PROCESSES):
            return "in_game"
        return "client" if any(name.lower() in out for name in VALORANT_CLIENT_PROCESSES) else "none"
    raise ValueError("produit Riot inconnu")


def kill_riot(timeout: float = 10.0) -> None:
    """Ferme tous les processus Riot et attend leur disparition."""
    args = ["taskkill", "/F"]
    for name in RIOT_PROCESSES:
        args += ["/IM", name]
    subprocess.run(args, capture_output=True, creationflags=_NO_WINDOW)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not is_riot_running():
            return
        time.sleep(0.2)
    raise TimeoutError("Des processus Riot sont encore actifs après l'arrêt forcé.")


def launch_product(product: str) -> None:
    """Lance un produit Riot live après restauration d'une session."""
    if product not in PRODUCTS:
        raise ValueError("produit Riot inconnu")
    exe = paths.riot_client_exe()
    if exe is None:
        raise FileNotFoundError(
            "RiotClientServices.exe introuvable (RiotClientInstalls.json absent ou invalide)."
        )
    from . import settings
    mode = settings.get("riot_client_autostart_mode", "normal")
    args = [str(exe), f"--launch-product={product}", "--launch-patchline=live"]
    if mode == "minimized":
        args.append("--minimized")
    elif mode == "hidden":
        args.append("--invisible")

    subprocess.Popen(
        args,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )


def launch_league() -> None:
    """Compatibilité des appelants League existants."""
    launch_product("league_of_legends")


from ctypes import wintypes

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong),
    ]

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong),
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]

class INPUT_UNION(ctypes.Union):
    _fields_ = [
        ("mi", MOUSEINPUT),
        ("ki", KEYBDINPUT),
        ("hi", HARDWAREINPUT),
    ]

class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", wintypes.DWORD),
        ("u", INPUT_UNION),
    ]

_GAME_EXE = "league of legends.exe"


def is_league_foreground() -> bool:
    """True si la fenêtre au premier plan appartient au jeu League of Legends.

    Garde-fou indispensable avant toute simulation clavier : SendInput tape dans
    la fenêtre qui a le focus, quelle qu'elle soit (Discord, navigateur…).
    """
    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return False
        pid = wintypes.DWORD(0)
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return False
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not handle:
            return False
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(len(buf))
            if not kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return False
            exe = buf.value.rsplit("\\", 1)[-1].lower()
            return exe == _GAME_EXE
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return False


def press_enter():
    # Press Enter using Scan Code 0x1C
    inp_press = INPUT()
    inp_press.type = 1  # INPUT_KEYBOARD
    inp_press.u.ki.wVk = 0
    inp_press.u.ki.wScan = 0x1C
    inp_press.u.ki.dwFlags = 0x0008  # KEYEVENTF_SCANCODE
    inp_press.u.ki.time = 0
    inp_press.u.ki.dwExtraInfo = 0
    
    inp_release = INPUT()
    inp_release.type = 1
    inp_release.u.ki.wVk = 0
    inp_release.u.ki.wScan = 0x1C
    inp_release.u.ki.dwFlags = 0x0008 | 0x0002  # KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP
    inp_release.u.ki.time = 0
    inp_release.u.ki.dwExtraInfo = 0
    
    try:
        ctypes.windll.user32.SendInput(1, ctypes.byref(inp_press), ctypes.sizeof(INPUT))
        time.sleep(0.015)
        ctypes.windll.user32.SendInput(1, ctypes.byref(inp_release), ctypes.sizeof(INPUT))
        time.sleep(0.015)
    except Exception:
        pass

def _utf16_units(text: str) -> list[int]:
    # KEYEVENTF_UNICODE travaille en unités UTF-16 (WORD) : les caractères hors
    # BMP (émojis…) doivent être envoyés comme paires de substitution.
    raw = text.encode("utf-16-le")
    return [int.from_bytes(raw[i:i + 2], "little") for i in range(0, len(raw), 2)]


def type_text_unicode(text: str):
    for unit in _utf16_units(text):
        inp_press = INPUT()
        inp_press.type = 1
        inp_press.u.ki.wVk = 0
        inp_press.u.ki.wScan = unit
        inp_press.u.ki.dwFlags = 0x0004  # KEYEVENTF_UNICODE
        inp_press.u.ki.time = 0
        inp_press.u.ki.dwExtraInfo = 0
        
        inp_release = INPUT()
        inp_release.type = 1
        inp_release.u.ki.wVk = 0
        inp_release.u.ki.wScan = unit
        inp_release.u.ki.dwFlags = 0x0004 | 0x0002  # KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
        inp_release.u.ki.time = 0
        inp_release.u.ki.dwExtraInfo = 0
        
        try:
            ctypes.windll.user32.SendInput(1, ctypes.byref(inp_press), ctypes.sizeof(INPUT))
            time.sleep(0.005)
            ctypes.windll.user32.SendInput(1, ctypes.byref(inp_release), ctypes.sizeof(INPUT))
            time.sleep(0.005)
        except Exception:
            pass

def execute_in_game_command(command: str) -> bool:
    """Simule la frappe clavier basse altitude pour exécuter une commande de chat dans LoL (DirectInput safe).

    Ne tape QUE si la fenêtre du jeu est au premier plan (sinon le texte partirait
    dans l'application qui a le focus). Retourne False si la frappe a été refusée.
    """
    if not is_league_foreground():
        return False
    press_enter()
    time.sleep(0.15)
    type_text_unicode(command)
    time.sleep(0.15)
    press_enter()
    return True
