"""Stockage local chiffré des secrets d'intégration.

Les réglages ordinaires restent dans ``settings.json``. Les clés tierces, elles,
sont protégées par DPAPI et ne sont jamais renvoyées par le serveur HTTP local.
"""
from __future__ import annotations

import base64
import ctypes
import os
from ctypes import wintypes

from . import settings

_PREFIX = "dpapi:"
_CRYPTPROTECT_UI_FORBIDDEN = 0x1


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes):
    buffer = ctypes.create_string_buffer(data)
    return _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def _protect(data: bytes) -> bytes:
    if os.name != "nt":
        raise RuntimeError("Le stockage sécurisé HenrikDev nécessite Windows.")
    source, _source_buffer = _blob(data)
    target = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if not crypt32.CryptProtectData(ctypes.byref(source), "Hexgate HenrikDev", None, None, None,
                                    _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(target)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(target.pbData)


def _unprotect(data: bytes) -> bytes:
    if os.name != "nt":
        raise RuntimeError("Le stockage sécurisé HenrikDev nécessite Windows.")
    source, _source_buffer = _blob(data)
    target = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if not crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None,
                                      _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(target)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(target.pbData)


def set_secret(key: str, value: str) -> None:
    """Enregistre un secret DPAPI, ou l'efface lorsque la valeur est vide."""
    value = value.strip()
    if not value:
        settings.set(key, None)
        return
    encoded = base64.b64encode(_protect(value.encode("utf-8"))).decode("ascii")
    settings.set(key, _PREFIX + encoded)


def get_secret(key: str) -> str | None:
    raw = settings.get(key)
    if not isinstance(raw, str) or not raw.startswith(_PREFIX):
        return None
    try:
        data = base64.b64decode(raw[len(_PREFIX):], validate=True)
        return _unprotect(data).decode("utf-8")
    except Exception:
        return None


def configured(key: str) -> bool:
    return bool(get_secret(key))
