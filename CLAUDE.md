# Hextech Swap - Claude Code Guidelines

Ce fichier contient les instructions de build, de test et les règles de passation locale avec Antigravity.

## 🛠️ Build & Dev Commands
- Démarrer le client frontend : `npm run dev` (dans le dossier `app/`)
- Démarrer le serveur backend : `python backend/switcher/server.py`
- Vérifier la compilation TypeScript : `npx tsc` (dans le dossier `app/`)
- Packager l'application : `npm run package` (dans le dossier `app/`)

## 🔄 Règle de Passation Locale (Handover)
- **Consignes de l'Architecte** : Lors du démarrage d'une session de développement, lisez impérativement le fichier `CLAUDE_TASK.md` pour vous aligner sur l'objectif global et la liste des tâches à effectuer.
- **Rapport de Fin de Session** : Lorsque vous avez terminé vos modifications, corrigé les lints ou passé les tests, rédigez systématiquement un rapport détaillé dans `CLAUDE_TRANS.md` contenant :
  1. Un résumé des modifications apportées.
  2. L'état mis à jour de la checklist des tâches (au format `- [ ]`, `- [/]`, ou `- [x]`).
  3. La liste des fichiers modifiés récemment (au format `- [chemin](file:///...) - description`).
  4. Les points bloquants ou attention particuliers, et les prochaines étapes recommandées.
  
*Cette règle permet d'assurer un transfert de contexte local et asynchrone parfait avec Antigravity.*

## 🪟 Règle obligatoire : tout overlay (fenêtre superposée au jeu) doit être IN-GAME ONLY, STRICT

Constat (bugs réels corrigés le 18/07/2026, voir mémoire `lol-account-switcher.md`) : une fenêtre Tauri overlay reste affichée à l'écran tant qu'elle n'a pas été explicitement `.hide()`-ée — un simple `return null` côté React, ou le toggle "Activer" dans les réglages, NE SUFFIT PAS à la faire disparaître. Un premier fix avait laissé un "mode démo" (données factices affichées quand l'overlay est déverrouillé, pour faciliter le repositionnement hors partie) — **ce mode démo a été explicitement supprimé le 18/07/2026 sur demande utilisateur** : un overlay ne doit JAMAIS s'afficher hors d'une vraie partie en cours, sans aucune exception, même pour repositionner. Le repositionnement (glisser-déposer en mode "Déverrouiller") ne peut donc se faire qu'en étant réellement en partie.

**Pour CHAQUE nouvel overlay créé (Claude Code ou Antigravity), suivre ce pattern sans exception :**

1. **Déclarer la fenêtre** dans `app/src-tauri/tauri.conf.json` (`label` unique, `transparent:true`, `decorations:false`, `alwaysOnTop:true`, `visible:false` au départ, `x`/`y` dans les bornes de l'écran réel de l'utilisateur — **1536×864**, vérifié via `[System.Windows.Forms.Screen]::AllScreens`, ne pas réutiliser des coordonnées d'un ancien écran plus large sans revérifier).
2. **Ajouter le `label`** au tableau `"windows"` de `app/src-tauri/capabilities/overlay.json` (capacité partagée entre tous les overlays — pas besoin d'un nouveau fichier de capacité, elle inclut déjà `core:window:allow-show`/`allow-hide`/`allow-set-ignore-cursor-events`/`allow-start-dragging`).
3. **Dans le composant React racine du nouvel overlay**, calculer un booléen `shouldShow` qui combine STRICTEMENT : le toggle "Activer" (localStorage + écoute de l'event `storage` pour la synchro cross-fenêtre) **ET** l'état réel de partie en cours (`active` reçu via SSE, jamais supposé, jamais de repli sur des données factices/démo). **Jamais `shouldShow = enabled` seul, et jamais de branche "mode démo hors partie" — même déverrouillé.**
4. **Appeler `useGameOnlyWindow(shouldShow, "<label>")`** (`app/src/lib/useGameOnlyWindow.ts`) — c'est ce hook qui fait le vrai `show()`/`hide()` Tauri, avec try/catch pour ne jamais planter silencieusement hors contexte Tauri (preview navigateur, ACL refusée). Ne pas réimplémenter cette logique en local dans le fichier de l'overlay.
5. **Garder `if (!shouldShow) return null;`** dans le rendu React en plus du hook (évite un flash de contenu périmé pendant que le `hide()` async se résout).
6. Après tout changement de capacités/fenêtres, **relancer l'app complètement** (les capacités sont codegen au build Rust, un HMR Vite seul ne suffit pas) avant de tester.