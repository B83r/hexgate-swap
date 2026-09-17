"""Réglages persistants du switcher (settings.json)."""
import json
import threading

from . import atomic_io, paths

_FILE = paths.STORAGE_DIR / "settings.json"

# Cache par mtime : les watchers lisent des réglages en boucle — un stat() suffit
# pour savoir si le fichier a changé (écriture par ce process ou un autre).
_cache: tuple[int, dict] | None = None
_write_lock = threading.Lock()


def _serialized_write(function):
    def guarded(*args, **kwargs):
        with _write_lock:
            return function(*args, **kwargs)
    return guarded


def _load() -> dict:
    global _cache
    try:
        mtime = _FILE.stat().st_mtime_ns
    except OSError:
        _cache = None
        return {}
    if _cache is not None and _cache[0] == mtime:
        return _cache[1]
    try:
        data = atomic_io.read_json(_FILE)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    _cache = (mtime, data)
    return data


def get(key: str, default=None):
    return _load().get(key, default)


@_serialized_write
def set(key: str, value) -> None:
    global _cache
    data = dict(_load())  # copie : ne jamais muter le dict du cache
    data[key] = value
    atomic_io.write_json(_FILE, data, indent=2)
    # Deux écritures rapprochées peuvent partager le même mtime (résolution
    # d'horodatage Windows) : sans ça, le cache renverrait la valeur d'avant.
    try:
        _cache = (_FILE.stat().st_mtime_ns, data)
    except OSError:
        _cache = None
