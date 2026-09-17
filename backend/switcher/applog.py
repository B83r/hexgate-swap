"""Journalisation backend rotative, sans secret.

Optim 4 (voir PASSATION_HEXGATE_SWAP_V2_1.md §14) : les incidents de
concurrence déjà rencontrés (écran « aucun compte enregistré », doubles
instances/sidecars) ont jusqu'ici été diagnostiqués à la main. Ce module
ajoute un journal persistant et rotatif pour garder une trace exploitable
sans jamais exposer de secret.

Règle absolue, sans exception : ne JAMAIS logger de clé HenrikDev, de
session Riot, de cookie, de mot de passe ni de contenu de blob DPAPI. Les
appelants ne doivent passer que des identifiants non sensibles (nom de
compte, code d'erreur, nombre d'éléments) — jamais un objet de session ou
de réglages complet.

Emplacement : %LOCALAPPDATA%\\LoLSwitcher\\logs\\hexgate.log (à côté du
coffre, donc exclu des sauvegardes publiables comme le reste de ce
dossier). Rotation : 5 fichiers de 1 Mo maximum.
"""
import logging
import logging.handlers

from . import paths

LOG_DIR = paths.STORAGE_DIR / "logs"
LOG_FILE = LOG_DIR / "hexgate.log"

_logger: logging.Logger | None = None


def get_logger() -> logging.Logger:
    """Logger rotatif partagé du backend. Sûr à appeler depuis n'importe quel thread."""
    global _logger
    if _logger is not None:
        return _logger
    logger = logging.getLogger("hexgate")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            handler: logging.Handler = logging.handlers.RotatingFileHandler(
                LOG_FILE, maxBytes=1_000_000, backupCount=5, encoding="utf-8"
            )
        except OSError:
            # Un dossier de log inaccessible ne doit jamais empêcher le
            # backend de démarrer : on dégrade vers un handler muet.
            handler = logging.NullHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(handler)
        logger.propagate = False
    _logger = logger
    return _logger
