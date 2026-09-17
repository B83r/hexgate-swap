"""Ecritures durables et atomiques pour le stockage local Hexgate."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_bytes(path: Path, data: bytes) -> None:
    """Remplace *path* atomiquement après avoir vidé le tampon sur disque."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def write_text(path: Path, data: str, *, encoding: str = "utf-8") -> None:
    write_bytes(path, data.encode(encoding))


def write_json(path: Path, data: Any, *, indent: int | None = None) -> None:
    # Conserver aussi la dernière version JSON lisible. Cela permet une
    # récupération automatique si un ancien crash avait déjà endommagé le
    # fichier principal avant l'arrivée des écritures atomiques.
    try:
        previous = path.read_bytes()
        json.loads(previous.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    else:
        write_bytes(path.with_suffix(path.suffix + ".bak"), previous)
    write_text(path, json.dumps(data, indent=indent))


def read_json(path: Path) -> Any:
    """Lit le JSON principal, puis restaure sa copie .bak si nécessaire."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as primary_error:
        backup = path.with_suffix(path.suffix + ".bak")
        try:
            raw = backup.read_bytes()
            data = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            raise primary_error
        write_bytes(path, raw)
        return data
