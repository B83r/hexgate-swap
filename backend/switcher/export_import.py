"""Export/import chiffré par mot de passe des comptes, pour migrer vers un autre PC.

Les sessions sont stockées via DPAPI (lié à la machine/utilisateur Windows), donc
inutilisables telles quelles ailleurs. Pour l'export, on les déchiffre avec DPAPI puis
on les re-chiffre avec une clé dérivée du mot de passe fourni ; l'import fait l'inverse.

Construction volontairement stdlib-only (hashlib/hmac), pour rester facile à
compiler avec PyInstaller sans dépendance supplémentaire :
- clé dérivée par PBKDF2-HMAC-SHA256 (200k itérations) à partir du mot de passe + sel
- flux de chiffrement construit à partir de blocs HMAC-SHA256(clé, nonce || compteur),
  combinés au texte clair par XOR (construction type "HMAC-CTR")
- authentification par HMAC-SHA256(clé, ciphertext) (encrypt-then-MAC), qui sert
  aussi à détecter un mot de passe incorrect au moment de l'import
"""
import hashlib
import hmac
import json
import os
import time
from base64 import b64decode, b64encode

from . import atomic_io, dpapi, paths, vault

_FORMAT = "hexgate-export-v1"
_ITERATIONS = 200_000


def _derive_key(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS, dklen=32)


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:length])


def _xor(data: bytes, key: bytes, nonce: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(data, _keystream(key, nonce, len(data))))


class WrongPassword(Exception):
    """Mot de passe incorrect ou fichier corrompu (échec de vérification HMAC)."""


def export_accounts(names: list[str], password: str) -> bytes:
    """Retourne le contenu (bytes UTF-8, format JSON) du fichier .hexgate exporté."""
    accounts_payload = {}
    for account in vault.list_accounts():
        if account.name not in names:
            continue
        account_dir = paths.ACCOUNTS_DIR / account.name
        files = {}
        for key in paths.SESSION_FILES:
            blob = account_dir / f"{key}.bin"
            if blob.is_file():
                files[key] = b64encode(dpapi.unprotect(blob.read_bytes())).decode("ascii")
        meta = atomic_io.read_json(account_dir / "meta.json")
        accounts_payload[account.name] = {"meta": meta, "files": files}

    plaintext = json.dumps({"accounts": accounts_payload}).encode("utf-8")
    salt = os.urandom(16)
    nonce = os.urandom(16)
    key = _derive_key(password, salt)
    ciphertext = _xor(plaintext, key, nonce)
    mac = hmac.new(key, ciphertext, hashlib.sha256).digest()

    bundle = {
        "format": _FORMAT,
        "salt": b64encode(salt).decode("ascii"),
        "nonce": b64encode(nonce).decode("ascii"),
        "mac": b64encode(mac).decode("ascii"),
        "ciphertext": b64encode(ciphertext).decode("ascii"),
    }
    return json.dumps(bundle).encode("utf-8")


def import_accounts(data: bytes, password: str) -> list[str]:
    """Déchiffre et importe les comptes ; retourne la liste des noms importés
    (renommés avec un suffixe si un compte du même nom existe déjà)."""
    try:
        bundle = json.loads(data.decode("utf-8"))
        if bundle.get("format") != _FORMAT:
            raise ValueError
        salt = b64decode(bundle["salt"])
        nonce = b64decode(bundle["nonce"])
        mac = b64decode(bundle["mac"])
        ciphertext = b64decode(bundle["ciphertext"])
    except (ValueError, KeyError, TypeError) as e:
        raise ValueError("Fichier .hexgate invalide ou corrompu.") from e

    key = _derive_key(password, salt)
    if not hmac.compare_digest(mac, hmac.new(key, ciphertext, hashlib.sha256).digest()):
        raise WrongPassword("Mot de passe incorrect.")

    plaintext = _xor(ciphertext, key, nonce)
    payload = json.loads(plaintext.decode("utf-8"))

    existing = {a.name for a in vault.list_accounts()}
    imported = []
    for name, entry in payload.get("accounts", {}).items():
        target_name = name
        suffix = 2
        while target_name in existing:
            target_name = f"{name} (importé{'' if suffix == 2 else ' ' + str(suffix)})"
            suffix += 1
        account_dir = paths.ACCOUNTS_DIR / target_name
        account_dir.mkdir(parents=True, exist_ok=True)
        for key_name, b64_bytes in entry.get("files", {}).items():
            raw = b64decode(b64_bytes)
            atomic_io.write_bytes(account_dir / f"{key_name}.bin", dpapi.protect(raw))
        meta = dict(entry.get("meta", {}))
        meta["name"] = target_name
        meta["expired"] = False
        meta["saved_at"] = time.time()
        atomic_io.write_json(account_dir / "meta.json", meta, indent=2)
        existing.add(target_name)
        imported.append(target_name)
    return imported
