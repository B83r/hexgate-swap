"""Chemins Riot (client, fichiers de session) et emplacement de stockage du switcher."""
import json
import os
from pathlib import Path

LOCALAPPDATA = Path(os.environ["LOCALAPPDATA"])
RIOT_DATA_DIR = LOCALAPPDATA / "Riot Games"

# Les deux copies du fichier de session à sauvegarder/restaurer.
SESSION_FILES = {
    "riot_client": RIOT_DATA_DIR / "Riot Client" / "Data" / "RiotGamesPrivateSettings.yaml",
    "league_client": RIOT_DATA_DIR / "League of Legends" / "Data" / "RiotGamesPrivateSettings.yaml",
}

RIOT_INSTALLS_JSON = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Riot Games" / "RiotClientInstalls.json"

# Dossier où le switcher stocke ses comptes (sessions chiffrées + index).
STORAGE_DIR = LOCALAPPDATA / "LoLSwitcher"
ACCOUNTS_DIR = STORAGE_DIR / "accounts"

# Cache local du "pic observé" des adversaires croisés en jeu (overlay insight).
# Ce n'est PAS un vrai career-high (Riot ne l'expose pas) : juste le rang le
# plus haut que Hexgate a personnellement vu chez ce joueur au fil des games.
OPPONENT_PEAKS_FILE = STORAGE_DIR / "opponent_peaks.json"


def league_install_dir() -> Path | None:
    """Dossier d'installation de League of Legends (pour le lockfile LCU)."""
    try:
        data = json.loads(RIOT_INSTALLS_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    for key in (data.get("associated_client") or {}):
        if "league of legends" in key.lower():
            return Path(key)
    return None


def riot_client_exe() -> Path | None:
    """Trouve RiotClientServices.exe via RiotClientInstalls.json."""
    try:
        data = json.loads(RIOT_INSTALLS_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    for key in ("rc_default", "rc_live"):
        path = data.get(key)
        if path and Path(path).is_file():
            return Path(path)
    return None
