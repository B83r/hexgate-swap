"""Point d'entrée du sidecar packagé (Optim 1, PASSATION_HEXGATE_SWAP_V2_1.md §14).

En développement, le backend démarre via `python -m backend.switcher.server`
ou `python -m switcher.server` (voir CLAUDE.md). Ce script est le point
d'entrée utilisé uniquement pour le build PyInstaller du sidecar release —
il ne remplace pas le chemin de développement.
"""
import sys

from switcher.server import run

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8722
    run(port)
