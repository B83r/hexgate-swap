"""Snapshots locaux tournants du coffre de comptes Hexgate."""
from __future__ import annotations

import os
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from . import paths

BACKUP_DIR_NAME = "backups"
DEFAULT_RETENTION = 10


def create_startup_backup(
    storage_dir: Path | None = None, *, retention: int = DEFAULT_RETENTION
) -> Path | None:
    """Crée un ZIP vérifié avant que les workers puissent modifier le coffre.

    Aucun fichier n'est créé lorsqu'aucun compte valide n'est présent. Les
    archives les plus anciennes sont supprimées seulement après la validation
    réussie de la nouvelle sauvegarde.
    """
    root = storage_dir or paths.STORAGE_DIR
    accounts_dir = root / "accounts"
    if not accounts_dir.is_dir() or not any(accounts_dir.glob("*/meta.json")):
        return None

    backup_dir = root / BACKUP_DIR_NAME
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    destination = backup_dir / f"hexgate_accounts_{stamp}.zip"
    fd, temporary_name = tempfile.mkstemp(
        prefix=".hexgate_backup_", suffix=".tmp", dir=str(backup_dir)
    )
    os.close(fd)
    temporary = Path(temporary_name)

    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for source in sorted(accounts_dir.rglob("*")):
                if source.is_file():
                    archive.write(source, source.relative_to(root))
            for filename in ("state.json", "settings.json"):
                source = root / filename
                if source.is_file():
                    archive.write(source, source.relative_to(root))

        with zipfile.ZipFile(temporary, "r") as archive:
            if archive.testzip() is not None:
                raise OSError("archive de sauvegarde invalide")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

    archives = sorted(backup_dir.glob("hexgate_accounts_*.zip"), reverse=True)
    for obsolete in archives[max(1, retention):]:
        try:
            obsolete.unlink()
        except OSError:
            pass
    return destination
