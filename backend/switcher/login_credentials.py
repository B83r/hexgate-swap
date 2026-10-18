"""Optional credentials, stored only in Windows Credential Manager.

Targets use the account PUUID; sessions, JSON metadata and exports never contain
these credentials. No secret is returned to the frontend.
"""
import ctypes
from ctypes import wintypes as w
import json
import hashlib

from . import vault, paths


class _Credential(ctypes.Structure):
    _fields_ = [("Flags", w.DWORD), ("Type", w.DWORD), ("TargetName", w.LPWSTR),
                ("Comment", w.LPWSTR), ("LastWritten", w.FILETIME),
                ("CredentialBlobSize", w.DWORD), ("CredentialBlob", ctypes.POINTER(w.BYTE)),
                ("Persist", w.DWORD), ("AttributeCount", w.DWORD),
                ("Attributes", ctypes.c_void_p), ("TargetAlias", w.LPWSTR),
                ("UserName", w.LPWSTR)]


def _api():
    api = ctypes.WinDLL("advapi32", use_last_error=True)
    api.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(_Credential))]
    api.CredReadW.restype = w.BOOL
    api.CredWriteW.argtypes = [ctypes.POINTER(_Credential), w.DWORD]
    api.CredWriteW.restype = w.BOOL
    api.CredDeleteW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD]
    api.CredDeleteW.restype = w.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    return api


def _target(name: str) -> str:
    owner = vault.account_puuid(name)
    if not owner:
        raise ValueError("Sauvegarde d'abord une session de ce compte pour vérifier son identité.")
    scope = hashlib.sha256(str(paths.STORAGE_DIR.resolve()).casefold().encode()).hexdigest()[:16]
    return "HexgateSwap/RiotLogin/" + scope + "/" + owner


def read(name: str) -> tuple[str, str] | None:
    api = _api()
    pointer = ctypes.POINTER(_Credential)()
    if not api.CredReadW(_target(name), 1, 0, ctypes.byref(pointer)):
        if ctypes.get_last_error() == 1168:  # ERROR_NOT_FOUND
            return None
        raise RuntimeError("Lecture du Gestionnaire d'identifiants Windows impossible.")
    try:
        credential = pointer.contents
        data = json.loads(ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize).decode("utf-8"))
        return data["username"], data["password"]
    finally:
        api.CredFree(pointer)


def configured(name: str) -> bool:
    return read(name) is not None


def save(name: str, username: str, password: str) -> None:
    if not isinstance(username, str) or not isinstance(password, str):
        raise ValueError("Identifiants invalides.")
    username = username.strip()
    if not username or not password or any(ord(c) < 32 or ord(c) == 127 for c in username + password):
        raise ValueError("Nom d'utilisateur et mot de passe requis, sans caractères de contrôle.")
    blob = json.dumps({"username": username, "password": password}, ensure_ascii=False).encode("utf-8")
    if len(blob) > 2560:
        raise ValueError("Identifiants trop longs.")
    buffer = (w.BYTE * len(blob)).from_buffer_copy(blob)
    credential = _Credential(Type=1, TargetName=_target(name), UserName=username,
                             CredentialBlobSize=len(blob), CredentialBlob=buffer, Persist=2)
    try:
        if not _api().CredWriteW(ctypes.byref(credential), 0):
            raise RuntimeError("Enregistrement dans le Gestionnaire d'identifiants Windows impossible.")
    finally:
        ctypes.memset(buffer, 0, len(blob))


def delete(name: str) -> None:
    if not _api().CredDeleteW(_target(name), 1, 0) and ctypes.get_last_error() != 1168:
        raise RuntimeError("Suppression des identifiants Windows impossible.")
