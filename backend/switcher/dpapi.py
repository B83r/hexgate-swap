"""Chiffrement DPAPI Windows (lié à la session utilisateur, aucune clé à gérer)."""
import ctypes
import ctypes.wintypes


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


_crypt32 = ctypes.windll.crypt32
_kernel32 = ctypes.windll.kernel32


def _blob_to_bytes(blob: _DataBlob) -> bytes:
    data = ctypes.string_at(blob.pbData, blob.cbData)
    _kernel32.LocalFree(blob.pbData)
    return data


def _call(func, data: bytes) -> bytes:
    blob_in = _DataBlob(len(data), ctypes.cast(ctypes.create_string_buffer(data, len(data)), ctypes.POINTER(ctypes.c_char)))
    blob_out = _DataBlob()
    if not func(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
        raise OSError(f"DPAPI a échoué (GetLastError={ctypes.GetLastError()})")
    return _blob_to_bytes(blob_out)


def protect(data: bytes) -> bytes:
    return _call(_crypt32.CryptProtectData, data)


def unprotect(data: bytes) -> bytes:
    return _call(_crypt32.CryptUnprotectData, data)
