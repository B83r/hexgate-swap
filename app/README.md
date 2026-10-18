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

## Connexion de secours Riot

Sélectionner un compte, puis **Connexion de secours** en bas de la liste.
Le nom d'utilisateur Riot (celui de connexion, pas le Riot ID) et le mot de
passe sont facultatifs, conservés dans le Gestionnaire d'identifiants Windows
et exclus des exports et sauvegardes de sessions. Le même bouton permet de
les remplacer ou les supprimer; supprimer le compte supprime ses identifiants.

Hexgate continue de restaurer les sessions en priorité. Si Riot rejette une
session, ou lors de **Reconnecter**, une seule tentative remplit les champs
du formulaire Riot reconnu par Windows. Aucun presse-papiers n'est utilisé.
Le client doit être prêt et déconnecté; un simple délai de démarrage ne suffit
pas à déclencher le secours. Le 2FA/captcha reste manuel. Si Windows ne peut
pas identifier le formulaire, la reconnexion reste manuelle. La nouvelle
session n'est sauvegardée qu'après vérification du compte connecté.

## Présence Riot (moteur Deceive intégré)

Clique sur **Présence Riot** dans la barre supérieure, juste avant **Auto-accept**.
Son menu permet d'activer le mode Hexgate et de choisir **En ligne**,
**Hors ligne** ou **Mobile**. Le mode prend effet quand Riot est
lancé par Hexgate (un changement de compte relance aussi Riot avec le proxy).
Si Riot est fermé, les boutons LoL, VALORANT et LoR du menu peuvent le démarrer.
Une fois connecté, le statut change sans relancer le jeu.
Quand le mode est désactivé, lancer Hexgate ou un jeu ne démarre pas le moteur.
Quand il est activé, le moteur tourne en arrière-plan sous `Deceive.exe`,
sans icône ni notification Deceive à gérer séparément.

Dans la liste d'amis League, l'ami fictif s'appelle **Hexgate**. Il accepte
les messages `online`, `offline`, `mobile`, `enable`, `disable` et `status`, comme
le moteur Deceive d'origine. Le chat privé et celui des salons restent actifs
par défaut. En mode hors ligne, les amis ne peuvent pas t'inviter ; repasse
temporairement en ligne pour recevoir une invitation.

Le moteur est compilé depuis `../third_party/deceive/` pendant le build Tauri
et livré avec son code source et sa licence GPL-3.0. Aucune installation
séparée de Deceive n'est nécessaire. Voir `../third_party/deceive/HEXGATE-CHANGES.md`
pour les adaptations et les points à examiner avant distribution.

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
