"""Hexgate control bridge for the bundled Deceive chat proxy.

The proxy is the upstream Deceive engine in ``third_party/deceive``. This
module launches it with an authenticated loopback control channel; it never
pretends that the League LCU availability flag masks Riot-wide presence.
"""

import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import paths, settings

GAMES = {"league_of_legends": "lol", "valorant": "valorant", "bacon": "lor"}
STATUSES = {"chat", "offline", "mobile"}
CONTROL_FILE = paths.STORAGE_DIR / "deceive_control.json"
_managed_process: subprocess.Popen | None = None


def executable() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent.parent / "deceive" / "Deceive.exe"
    return Path(__file__).resolve().parents[2] / "third_party" / "deceive" / "Deceive" / "bin" / "Release" / "net472" / "Deceive.exe"


def enabled() -> bool:
    return bool(settings.get("deceive_enabled", False))


def startup_status() -> str:
    value = settings.get("deceive_startup_status", "offline")
    return value if value in STATUSES else "offline"


def _control_request(method: str, path: str, payload: dict | None = None) -> dict | None:
    try:
        info = json.loads(CONTROL_FILE.read_text(encoding="utf-8"))
        port, token = int(info["port"]), str(info["token"])
        if not (1 <= port <= 65535 and len(token) == 64):
            return None
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/hexgate/{path}", data=body, method=method,
            headers={"X-Hexgate-Control": token, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=1.5) as response:
            return json.load(response)
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        return None


def is_process_running() -> bool:
    global _managed_process
    if _managed_process is not None and _managed_process.poll() is None:
        return True
    if os.name != "nt":
        return False
    from . import process
    return any(line.startswith('"deceive.exe",')
               for line in process._tasklist_lower().splitlines())


def state() -> dict:
    live = _control_request("GET", "state")
    return {
        "configured": enabled(),
        "available": executable().is_file(),
        "running": is_process_running(),
        "connected": bool(live and live.get("connected")),
        "proxy_enabled": bool(live and live.get("enabled")),
        "status": live.get("status") if live else startup_status(),
        "lobby_chat": bool(live.get("lobbyChat", True)) if live else True,
    }


def ensure_ready() -> None:
    if not enabled():
        return
    if not executable().is_file():
        raise FileNotFoundError("Moteur de présence Hexgate absent. Recompile l'application avec Deceive.")
    if is_process_running() and _control_request("GET", "state") is None:
        raise RuntimeError("Une autre instance de Deceive est ouverte. Ferme-la depuis sa zone de notification avant le swap.")


def configure(active: bool, status: str) -> dict:
    if status not in STATUSES:
        raise ValueError("Statut inconnu")
    if active and not executable().is_file():
        raise FileNotFoundError("Moteur de présence Hexgate absent. Recompile l'application avec Deceive.")
    live = _control_request("GET", "state")
    if live:
        updated = _control_request("POST", "state", {
            "status": status, "enabled": active, "lobbyChat": bool(live.get("lobbyChat", True)),
        })
        if not updated:
            raise RuntimeError("La présence n'a pas pu être modifiée dans le proxy actif.")
    settings.set("deceive_enabled", active)
    settings.set("deceive_startup_status", status)
    return state()


def update(status: str, active: bool, lobby_chat: bool) -> dict:
    if status not in STATUSES:
        raise ValueError("Statut inconnu")
    if not isinstance(active, bool) or not isinstance(lobby_chat, bool):
        raise ValueError("Paramètres de présence invalides")
    live = _control_request("POST", "state", {
        "status": status, "enabled": active, "lobbyChat": lobby_chat,
    })
    if not live:
        raise RuntimeError("Proxy Hexgate inactif. Relance Riot via Hexgate pour appliquer ce statut.")
    settings.set("deceive_startup_status", status)
    settings.set("deceive_enabled", active)
    return state()


def stop_for_swap() -> None:
    global _managed_process
    if not is_process_running():
        return
    if _control_request("GET", "state") is None:
        if enabled():
            raise RuntimeError("Deceive est ouvert hors de Hexgate. Ferme-le avant de changer de compte.")
        return
    _control_request("POST", "stop")
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if not is_process_running():
            _managed_process = None
            return
        time.sleep(0.2)
    raise TimeoutError("Le proxy de présence ne s'est pas arrêté ; réessaie le changement de compte.")


def launch(product: str) -> None:
    global _managed_process
    if product not in GAMES:
        raise ValueError("Jeu Riot inconnu")
    ensure_ready()
    if not enabled():
        raise RuntimeError("Le mode de présence Hexgate est désactivé.")
    if is_process_running():
        raise RuntimeError("Le proxy de présence est déjà ouvert.")
    if os.name != "nt":
        raise OSError("Deceive fonctionne uniquement sous Windows.")
    paths.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    # The bundled engine reads its own persisted startup setting.
    appdata = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
    deceive_data = appdata / "Deceive"
    deceive_data.mkdir(parents=True, exist_ok=True)
    (deceive_data / "startupStatus").write_text(startup_status(), encoding="utf-8")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = os.environ.copy()
    env["HEXGATE_CONTROL_PORT"] = str(port)
    env["HEXGATE_CONTROL_TOKEN"] = secrets.token_hex(32)
    env["HEXGATE_CONTROL_FILE"] = str(CONTROL_FILE)
    _managed_process = subprocess.Popen(
        [str(executable()), GAMES[product]], cwd=str(executable().parent), env=env,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        if _control_request("GET", "state") is not None:
            return
        if _managed_process.poll() is not None:
            raise RuntimeError("Le moteur de présence s'est arrêté avant de se connecter. Vérifie sa fenêtre d'erreur.")
        time.sleep(0.3)
    raise TimeoutError("Le moteur de présence ne répond pas. Vérifie sa fenêtre d'erreur et la connexion réseau.")
