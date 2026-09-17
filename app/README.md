# Hexgate Swap — UI Tauri + React

Interface moderne (Tauri 2 · React · Tailwind v4 · shadcn/ui · Framer Motion ·
Lucide) par-dessus le moteur Python d'origine (`../lol-account-switcher/switcher/`).

## Architecture

- **Moteur** : `../lol-account-switcher/switcher/` (swap de session Riot, DPAPI,
  API Riot/LCU). Inchangé, éprouvé en live.
- **Pont** : `switcher/server.py` expose le moteur en HTTP+SSE local (port 8722,
  stdlib uniquement). Endpoints : `/accounts`, `/swap`, `/capture`,
  `/add-account`, `/delete`, `/autoaccept`, `/events` (SSE), et les images
  `/assets/logo.png`, `/assets/ranks/{tier}.png`, `/assets/avatar/...`.
- **Launcher Rust** (`src-tauri/src/lib.rs`) : démarre le serveur Python en
  sidecar au lancement, gère l'icône tray (swap rapide) et la fermeture qui
  minimise vers le tray. `kill` du sidecar à la sortie.
- **Frontend** (`src/`) : `lib/api.ts` (client), `components/AccountCard.tsx`,
  overlay de swap, toasts (sonner), pilule auto-accept.

## Développement

```
npm install
npm run tauri dev
```

Prérequis Windows : Node, Python 3, Rust (rustup + toolchain MSVC), VS Build
Tools 2022 avec workload C++ **et Windows 11 SDK**. Si le linker échoue avec
« link: extra operand », c'est le `link.exe` de Git qui masque celui de MSVC :
préfixer le PATH avec `…\VC\Tools\MSVC\<ver>\bin\Hostx64\x64`.

## Build

```
npm run tauri build
```

Produit dans `src-tauri/target/release/` :
- `tauri-app.exe` (binaire seul, 8,9 Mo)
- `bundle/msi/…msi` et `bundle/nsis/…-setup.exe` (installeurs)

## ⚠ Portabilité

Le sidecar lance `python -m switcher.server` depuis un **chemin codé en dur**
(`SWITCHER_DIR` dans `src-tauri/src/lib.rs`). L'exécutable fonctionne donc sur
cette machine (Python installé + dossier présent) mais **pas encore sur une
autre machine**. Pour une distribution portable : compiler le moteur en exe
autonome avec PyInstaller et l'embarquer comme sidecar Tauri
(`bundle > externalBin`), puis pointer `SWITCHER_DIR` dessus.
