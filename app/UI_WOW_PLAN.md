# Plan « époustouflant » — UI v3 (Tauri + React)

> **À exécuter phase par phase.** État : rien n'est commencé.
> Contexte : l'UI actuelle (src/App.tsx, src/components/AccountCard.tsx) est un
> portage fidèle de l'ancienne UI tkinter. Fonctionnelle mais statique — aucun
> avantage du web n'est encore exploité. Ce plan transforme l'app en vitrine.
> Stack déjà installée : Tailwind v4 (@theme dans src/index.css), Framer Motion,
> shadcn/ui (button, card, switch, progress, tooltip, scroll-area, dialog,
> sonner), Lucide. Moteur : API locale port 8722 (src/lib/api.ts) — ne pas toucher.
> Les patterns Magic UI / Aceternity / React Bits sont à ADAPTER en copiant le
> code dans src/components/fx/ (pas de dépendance à installer, sauf mention).

## Phase 1 — Fenêtre sans chrome + fond vivant (le plus gros impact)

**1.1 Barre de titre custom.** `tauri.conf.json` : `"decorations": false`,
`"transparent": true`. Créer `src/components/TitleBar.tsx` : bandeau 40px avec
`data-tauri-drag-region`, logo 20px, titre, boutons custom réduire/agrandir/
fermer (Lucide `Minus/Square/X`) appelant `getCurrentWindow().minimize()/
toggleMaximize()/close()` de `@tauri-apps/api/window`. Hover rouge sur la croix.
Coins arrondis de la fenêtre : `border-radius` sur le conteneur racine +
fenêtre transparente.

**1.2 Fond animé multicouche** dans `src/components/fx/Background.tsx`, monté
derrière tout (`fixed inset-0 -z-10`) :
- couche 1 : dégradé radial profond `#010a13 → #0a1428` + vignette ;
- couche 2 : 2-3 « aurora blobs » (divs `blur-3xl opacity-20`, or `#c8aa6e` et
  bleu `#0ac8b9`) animés lentement en dérive avec Framer Motion (`animate` en
  boucle, 20-30 s, `ease: "easeInOut"`) ;
- couche 3 : **particules de poussière dorée** — canvas custom léger (~80
  particules, dérive verticale lente, scintillement alpha ; ~60 lignes de code,
  zéro dépendance), `pointer-events-none` ;
- couche 4 : motif hexagonal en filigrane (SVG répété, opacité 4 %), léger
  parallax à la souris (`useMotionValue` + translate 5-10px max).
- Respecter `prefers-reduced-motion` : couper particules et dérives.

**1.3 Splash d'ouverture (2 s).** `src/components/fx/Splash.tsx` : le logo
hexagonal en SVG inline dont le contour SE DESSINE (`pathLength` 0→1 Framer
Motion), flash doré, puis `AnimatePresence` révèle l'app avec stagger des
cartes (chacune `y:20→0, opacity`, délai 80 ms). Le logo SVG : recréer
l'hexagone + flèches de cycle en vectoriel propre (mêmes couleurs que
switcher/ui_assets.py) — il servira aussi au header et remplacera le PNG servi
par l'API.

## Phase 2 — Les cartes de compte deviennent des objets premium

Refondre `AccountCard.tsx` :

**2.1 Spotlight hover** (pattern Aceternity « card spotlight ») : gradient
radial doré subtil qui suit la souris sur la carte (`onMouseMove` →
`useMotionValue` x/y → `radial-gradient` en style inline). 

**2.2 Bordure animée du compte actif** (pattern Magic UI « border beam ») :
au lieu d'une bordure verte statique, un segment lumineux doré/vert qui
parcourt le périmètre en boucle (conic-gradient tournant masqué sur 1.5px).

**2.3 Tilt 3D léger** : `rotateX/rotateY` ±3° selon la position de la souris
(perspective 1000px), retour élastique au `mouseLeave`.

**2.4 Splash art en fond de carte.** L'API LCU expose le champion le plus
joué — ajouter côté Python (`switcher/lcu_api.py`) la récupération des
masteries (`/lol-champion-mastery/v1/local-player/champion-mastery` → top 1
championId), stocker dans meta, endpoint image proxy
`/assets/champion-splash/{championId}` (Community Dragon :
`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-splashes/{id}/{id}000.jpg`).
Sur la carte : splash en `background`, masque dégradé vers la droite
(`mask-image: linear-gradient`), opacité 25 %, léger zoom au hover (scale
1.05, 0.6 s). C'est LE détail qui rend chaque carte unique et vivante.

**2.5 Rank vivant :**
- halo pulsant derrière l'emblème, couleur du tier (`box-shadow` animé) ;
- **arc de LP** circulaire autour de l'emblème (SVG, 0-100 LP) ;
- LP en **number ticker** (les chiffres roulent à l'apparition — pattern
  Magic UI) ;
- delta LP depuis la dernière session : badge `+12 LP` vert / `-8 LP` rouge
  (stocker le LP précédent dans meta côté serveur au refresh de profil).

**2.6 Skeleton shimmer** pendant le chargement du profil (au lieu d'un
« Unranked » temporaire) : blocs gris animés `animate-pulse` + balayage
lumineux.

## Phase 3 — Overlay de swap cinématique

Refondre l'overlay (`src/components/SwapOverlay.tsx`) en séquence
« invocation » plein écran :
- fond qui se floute/assombrit (`backdrop-blur` progressif) ;
- **anneau de progression hexagonal** central (SVG, stroke doré animé par
  étape, spinner bleu hextech en rotation continue derrière) ;
- avatar du compte cible au centre de l'anneau ;
- étapes en colonne avec check animé (le ✓ se dessine, `pathLength`) ;
- particules convergentes vers le centre pendant l'attente, **burst de
  particules dorées** à la réussite (canvas, réutiliser le système Phase 1) ;
- à l'échec : l'anneau vire au rouge + shake 300 ms, message clair.
- transition de sortie : l'overlay se dissout et la carte du nouveau compte
  actif pulse une fois en doré (`layoutId` partagé possible).

## Phase 4 — Header, typo, finitions premium

**4.1 Titre en or animé** : `background-clip: text` avec dégradé
`#785a28→#f0e6d2→#c8aa6e` + balayage shimmer toutes les 6 s (pattern Magic UI
« animated shiny text »).

**4.2 Police display.** Télécharger une police libre proche du style LoL
(Beaufort → alternative libre : « Cinzel » ou « Marcellus », Google Fonts,
fichiers .woff2 copiés dans `src/assets/fonts/`, `@font-face` local — pas de
CDN, app offline). Titres/boutons en display, corps en Segoe UI.

**4.3 Boutons** : JOUER avec effet « shimmer button » (reflet qui traverse
en boucle lente) + scale 0.97 au clic ; ripple doré au clic sur les cartes.

**4.4 Toasts sonner stylés** thème Hextech (bordure dorée, icônes Lucide,
`richColors` off, fond `#0a1428`) + confetti discret sur « session
sauvegardée ».

**4.5 Tooltips riches** (shadcn tooltip déjà installé) : au survol du bloc
rank → carte détaillée SoloQ + Flex + winrate bar + nb de parties.

**4.6 Scrollbar** overlay fine dorée (déjà amorcée dans index.css, affiner).

**4.7 Sons UI optionnels** (toggle dans un menu réglages) : hover/clic/succès
de swap, fichiers .ogg courts dans `src/assets/sfx/`, volume faible, off par
défaut.

## Phase 5 — Thèmes de faction (bonus signature)

Sélecteur de thème dans la TitleBar (icône palette) : 4 thèmes = 4 jeux de
variables CSS dans `@theme` (data-theme sur `<html>`) :
- **Hextech** (défaut) : or/bleu nuit actuel ;
- **Ionia** : rose/violet spirituel, blobs roses ;
- **Îles Obscures** : vert spectral/noir ;
- **Néant (Void)** : violet/magenta profond.
Transition de thème animée (fondu 400 ms), choix persisté (localStorage +
endpoint settings existant). Les particules et blobs suivent la couleur
d'accent du thème.

## Garde-fous

- 60 fps : animations transform/opacity uniquement, `will-change` parcimonieux,
  particules sur canvas (pas des divs), pause des animations quand la fenêtre
  est cachée (`document.visibilityState`).
- `prefers-reduced-motion` respecté partout.
- Aucune requête réseau externe au runtime SAUF images Community Dragon déjà
  proxées par le serveur Python (cache disque existant) — l'app doit rester
  utilisable offline (fallbacks locaux).
- Ne rien changer à `src/lib/api.ts` (contrat serveur) sauf ajouts Phase 2.4
  (masteries + splash endpoint, côté Python : `lcu_api.py`, `server.py`,
  `core.update_active_profile`).
- Tester après chaque phase : `npm run tauri dev` (PATH : préfixer
  `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64`
  avant Git pour le linker).

## Ordre d'exécution recommandé

1. Phase 1 (fond vivant + fenêtre custom + splash) — transforme la première impression
2. Phase 2 (cartes premium, splash arts, rank vivant) — le cœur visuel
3. Phase 3 (overlay cinématique) — le moment « wow » du produit
4. Phase 4 (header/typo/finitions) — cohérence premium
5. Phase 5 (thèmes) — signature personnelle
