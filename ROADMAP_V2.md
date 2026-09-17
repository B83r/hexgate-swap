# 🗺️ ROADMAP V2 — Hexgate Swap · Vague de fonctionnalités "Stats & Confort"

> **Document rédigé par Claude Code (Fable 5) — à exécuter par Antigravity (Gemini).**
> Rôles : Claude Code = architecte/review qualité. Antigravity = implémentation.
> L'utilisateur valide chaque phase avant de passer à la suivante.
> **Lis ce document EN ENTIER avant d'écrire la moindre ligne de code.**

---

## 0. Contexte technique (rappel obligatoire)

- **UI** : Tauri 2 + React + TypeScript + Tailwind v4 + shadcn/ui + Framer Motion + Lucide, dans `app/`.
- **Moteur** : Python 3.12 stdlib-only, serveur HTTP+SSE maison sur le port **8722**, dans `backend/switcher/` (`server.py` = endpoints, `core.py` = orchestration, `vault.py` = comptes/meta.json, `settings.py` = settings.json, `lcu_api.py` = client LCU via lockfile, `riot_api.py` = Riot API web, `rank_watch.py` = thread de surveillance de rang, `queue_joiner.py` = auto-join de file post-swap).
- **Données par compte** : `%LOCALAPPDATA%\LoLSwitcher\accounts\{name}\meta.json` (rank, note, pinned, rank_history…). Réglages globaux : `%LOCALAPPDATA%\LoLSwitcher\settings.json`.
- **SSE** : le backend broadcast des événements JSON (`accounts`, `toast`, `backfill_done`…) sur `/events` ; `App.tsx` y est abonné et route vers les composants.
- **i18n** : `app/src/lib/i18n.tsx`, **6 langues (fr, en, es, de, it, pt)** — TOUTE nouvelle chaîne UI doit avoir ses 6 traductions, sans exception.

## 0bis. ⚠️ Gotchas connus (ne PAS les redécouvrir à tes dépens)

1. **Cloudflare bloque le User-Agent Python** sur la Riot API → toujours envoyer un UA navigateur (déjà fait dans `riot_api._HEADERS`). Un 403 avec body "error code: 1010" = ça, pas la clé.
2. **La clé Riot dev (`backend/.env`, RIOT_API_KEY) expire toutes les 24 h** → toute feature qui en dépend doit dégrader proprement (message clair + données en cache toujours affichées, jamais d'écran vide).
3. **CDragon `ranked-mini-crests`** : `emerald` n'existe qu'en `.svg` — utiliser les `.svg` pour tous les tiers.
4. **`tasklist`** peut émettre des octets non-UTF8 → décoder en ascii/errors=ignore (déjà géré dans `process.py`).
5. **Jamais de logout du client Riot** (invalide le ssid serveur). Toute interaction de session passe par les mécanismes existants de `core.py`/`vault.py`.
6. **Animations** : uniquement transform/opacity (GPU). Pas de `filter`/`blur` animés, pas de layout thrashing. Respecter `prefersReducedMotion()` (`lib/theme.ts`).

## 0ter. 📏 Standards de qualité — NON NÉGOCIABLES

- ✅ `npx tsc --noEmit` **zéro erreur** après chaque tâche.
- ✅ `python -m py_compile` sur chaque fichier Python touché.
- ✅ Chaque endpoint nouveau/modifié **testé en HTTP réel** (curl/PowerShell contre le serveur lancé) avant d'être déclaré fini.
- ✅ Zéro nouvelle dépendance npm/pip sans justification écrite dans le rapport de phase (le backend reste stdlib-only, c'est une exigence de compilation PyInstaller future).
- ✅ Toute chaîne visible : via `t("...")` + 6 langues. Les libellés de données LoL (tiers, V/D) passent par `rank.ts`.
- ✅ Honnêteté des données : ne JAMAIS inventer une stat. Si une valeur est estimée (LP passé, MMR…), l'UI doit le dire (pattern existant du "?" dans RankDetailDialog).
- ✅ Respect du **mode streamer** : tout nouvel affichage de pseudo/Riot ID doit appliquer le blur conditionnel (`blurred`).
- ✅ Style : suivre les patterns existants du fichier touché (imports, nommage, structure de composant). Pas de refactor opportuniste hors périmètre.
- ✅ À la fin de chaque phase : rapport court (fichiers touchés, tests exécutés, captures des réponses HTTP) + mise à jour de `lol-account-switcher.md` (mémoire partagée).

## 0quater. 🔁 Protocole de livraison

1. Une phase = une unité de travail. **Ne jamais commencer la phase suivante sans validation explicite de l'utilisateur.**
2. En cas de doute d'interprétation : choisir l'option la plus simple, la noter dans le rapport, continuer (ne pas bloquer).
3. Si un endpoint LCU ne répond pas comme documenté ici : le noter, dégrader proprement (feature masquée plutôt que cassée), continuer.

---

## 0quinquies. ✅ Travail DÉJÀ EFFECTUÉ par Claude Code (session du 15/07/2026) — état actuel du code

Ces changements sont **déjà dans `app/src/components/AccountCard.tsx`**, testés et validés visuellement par l'utilisateur dans l'app réelle. **Ne pas les refaire, ne pas les casser.**

### Icônes du sélecteur radial (validées une par une par l'utilisateur)
- Nouvelles constantes en haut de la zone QUEUES : `CDRAGON`, `CREST_BASE` (ranked-mini-crests), `GMA` (gamemodeassets), helper `tierCrestUrl(tier)`.
- Nouveau composant **`QueueIcon({ queue, account })`** qui rend l'icône d'une file — c'est LE point d'entrée si une phase future touche aux icônes :
  - **Aucune** (`id: null`) : glyphe Lucide `<Ban>` (pas d'image).
  - **Solo/Duo (420)** : `iconUrl: "dynamic-solo"` → mini-crest officiel du **tier SoloQ réel du compte** (`account.rank?.solo?.tier`), fallback unranked.
  - **Flex (440)** : `"dynamic-flex"` → idem avec le tier Flex.
  - **Normal (400)** : cristal SR officiel du menu Jouer — `{GMA}/classic_sru/img/game-select-icon-default.png`.
  - **ARAM (450)** : `{GMA}/aram/img/game-select-icon-default.png`.
  - **Mayhem (2400)** : spatule dorée — `rcp-fe-lol-parties/global/default/golden-spatula-club-icon.png`.
  - **Arena (1700)** : fiole officielle — `{GMA}/cherry/img/game-select-icon-default.png`.
  - Rendu en `object-contain` (les emblèmes ne doivent PAS être croppés en rond), `pointer-events-none`.
- ⚠️ Les crests utilisent l'extension **`.svg`** (gotcha n°3 : `emerald.png` n'existe pas sur CDragon).
- `QueueSelector` reçoit désormais la prop `account` (transmise depuis AccountCard).

### Animation d'ouverture du radial (choix utilisateur : « Hextech Bloom », version rapide)
- Les 7 boutons : `initial={scale:0.3, opacity:0, x:0, y:0}` → `animate={scale:1, opacity:1, x, y}` ; transition `duration: 0.2`, `ease: [0.22, 1.3, 0.36, 1]`, `delay: i*0.01`, opacité en 0.1s. **Plus AUCUNE rotation ni blur animé** (l'utilisateur a explicitement rejeté l'ancienne anim spring/rotate — jugée pas fluide — et une variante avec blur — trop lente).
- Bouton central de fermeture : même famille (`scale 0.55→1, opacity`, 0.18s, même ease).
- Fermeture : toujours **instantanée** (`transition: { duration: 0 }` sur les exit) — exigence utilisateur, ne pas la ré-animer.
- Historique des refus utilisateur (pour ne pas re-proposer) : spring raide + rotation -180° (verdict : brouillon), blur animé (verdict : pas fluide), variante « Cadran séquentiel » (essayée puis remplacée par Bloom).

### Contexte de cette session (résumé)
- Exploration exhaustive de CDragon : **Riot n'a AUCUNE icône distincte Solo vs Flex vs Normal** (le client réutilise la map SR) — d'où le choix des crests de tier dynamiques. Chemin des emblèmes du menu Jouer découvert : `plugins/rcp-be-lol-game-data/global/default/content/src/leagueclient/gamemodeassets/{mode}/img/game-select-icon-*.png`.
- `npx tsc --noEmit` passe au moment de la rédaction de ce document. L'app a été testée en `npm run tauri dev` avec le backend V2 sidecar.

---

# PHASE 1 — 📊 Récap de session & du jour (A1)

**Valeur** : l'utilisateur voit d'un coup d'œil ce que chaque compte (et l'ensemble) a gagné/perdu aujourd'hui. 100 % local, zéro dépendance Riot API.

## Backend
- `vault.py` : nouvelle fonction `daily_recap(name) -> dict` qui lit `meta.json["rank_history"]` et calcule sur la fenêtre "aujourd'hui" (minuit local) : `wins`, `losses`, `lp_delta` (différence entre le premier point d'aujourd'hui — ou le dernier d'hier — et le dernier point). Retourne `None` si aucune donnée aujourd'hui.
  - ⚠️ `rank_history` n'a des points qu'aux refreshs de rang : le recap reflète les données suivies, pas forcément toutes les parties. C'est ASSUMÉ (pas de bidouille pour "compléter").
- `server.py` : enrichir la réponse `/accounts` — chaque compte gagne un champ `recap: {wins, losses, lp_delta} | null`. Ajouter aussi un agrégat global `recap_total` au même niveau que la liste.
- `rank_watch.py` broadcast déjà après chaque partie détectée → aucun travail supplémentaire, le front se resynchronise via l'événement `accounts` existant.

## Frontend
- `api.ts` : types `Recap` + champs sur `Account` et sur la réponse accounts.
- `AccountCard.tsx` : sous la ligne LP/winrate du RankBlock, une ligne discrète « Aujourd'hui : +18 LP · 3V 1D » (vert si positif, rouge si négatif, masquée si `recap == null`). Tailles/couleurs : reprendre les tokens existants (`text-green`, `text-red`, `text-muted`, 10px).
- `Header.tsx` (ou zone sous le header, au choix le plus propre) : pilule globale « Session du jour : +34 LP · 7V 3D » visible seulement si au moins un compte a un recap.
- i18n : clés `recap.today`, `recap.session` (+ formats), 6 langues.

## Acceptation
- [ ] `/accounts` renvoie `recap` correct (tester en modifiant un `meta.json` à la main avec des points d'aujourd'hui et d'hier).
- [ ] Carte : ligne recap visible/absente selon les données ; couleurs OK ; blur streamer NON requis (pas un identifiant).
- [ ] Pilule globale agrège correctement plusieurs comptes.

---

# PHASE 2 — 🎯 Objectif de rang par compte (A3)

**Valeur** : motivation. L'utilisateur fixe « Diamant IV » sur un compte, l'app montre la progression.

## Backend
- `meta.json["goal"] = {"tier": "DIAMOND", "division": "IV"} | null`. Endpoints : `POST /goal {name, tier, division|null}` (division null pour Master+) et suppression via `tier: null`. Écriture via `vault` (suivre le pattern de `/note`).
- `/accounts` expose `goal`.

## Frontend
- `RankDetailDialog.tsx` : section « Objectif » — sélecteur de tier (emblèmes CDragon existants) + division. Une fois fixé : barre de progression **honnête** basée sur `ladderLp` (`rank.ts`) : `(lp_actuel - lp_depart) / (lp_objectif - lp_depart)`, où `lp_depart` est mémorisé dans `goal.start_lp` au moment où l'objectif est posé. Si le compte dépasse l'objectif : état « Objectif atteint 🎉 » + proposition d'en fixer un nouveau.
- `AccountCard.tsx` : micro-indicateur sur la carte (ex. fine barre dorée sous la barre de winrate, ou pastille % près du rank) — choisir LA plus discrète, la carte est déjà dense.
- i18n : `goal.title`, `goal.set`, `goal.reached`, `goal.progress`, etc. × 6.

## Acceptation
- [ ] Poser/retirer un objectif persiste dans meta.json et survit au restart.
- [ ] Progression correcte y compris objectif < rang actuel (clamp 0-100 %).
- [ ] Master+ : pas de division demandée.

---

# PHASE 3 — 🎮 Statut « En partie » en direct (B2)

**Valeur** : le compte actif montre s'il est en champ select / en partie, avec chrono.

## Backend
- `lcu_api.py` : nouvelle fonction `gameflow_phase()` → `GET /lol-gameflow/v1/gameflow-phase` (retourne `"None"|"Lobby"|"Matchmaking"|"ChampSelect"|"InProgress"|"EndOfGame"...`).
- Nouveau thread léger dans `rank_watch.py` (ou étendre le poll existant, au plus simple) : toutes les ~10 s, si un compte est actif, lire la phase ; sur changement, broadcast SSE `{"type": "gameflow", "phase": ..., "since": epoch}`. `since` = timestamp du passage à `InProgress` (récupérable précisément via `/lol-gameflow/v1/session` → `gameData.gameStartTime`… si absent, utiliser l'heure de détection, c'est suffisant).
- Ne PAS créer de connexion LCU agressive : réutiliser le client lockfile existant, timeouts courts, silence total si client fermé.

## Frontend
- `App.tsx` : router l'événement `gameflow` vers un state.
- `AccountCard.tsx` : sur le compte actif, remplacer le badge « CONNECTÉ » par « ⚔ EN PARTIE · 12:34 » (chrono qui tourne côté client depuis `since`) quand phase = InProgress, et « CHAMP SELECT » pendant ChampSelect. Retour à « CONNECTÉ » sinon. Animation sobre (pulse du point, pas plus).
- i18n : `card.inGame`, `card.champSelect` × 6.

## Acceptation
- [ ] Sans client LoL ouvert : aucun spam de logs, badge normal.
- [ ] En partie réelle : badge + chrono corrects ; retour à CONNECTÉ en fin de partie.
- [ ] Le chrono ne dérive pas après une heure (calcul depuis `since`, pas incrément).

---

# PHASE 4 — 🔔 Notifications Windows natives (D2) + démarrage auto (D3)

**Valeur** : l'app vit dans le tray ; les événements importants remontent même minimisée.

## Implémentation
- Plugins officiels Tauri 2 : `tauri-plugin-notification` et `tauri-plugin-autostart` (dépendances Rust + npm justifiées — ce sont les plugins officiels). Enregistrer dans `src-tauri/src/lib.rs`, permissions dans `src-tauri/capabilities/`.
- Événements qui déclenchent une notification native (UNIQUEMENT si la fenêtre n'est pas au premier plan — vérifier le focus via Tauri) :
  1. Partie trouvée/acceptée par l'auto-accept.
  2. Fin de partie détectée par RankWatcher : « Victoire ! +21 LP — HideInTheShnek » (respecter le mode streamer : si activé, remplacer le pseudo par « compte actif »).
  3. Session expirée détectée post-swap.
- `SettingsDialog.tsx` : section « Système » — toggle « Notifications Windows » (défaut ON) + toggle « Démarrer avec Windows (minimisé) » (défaut OFF), persistés dans `settings.json` (`native_notifications`, `autostart`). L'autostart appelle le plugin ET démarre l'app minimisée dans le tray quand lancé via autostart (flag `--minimized` géré dans `lib.rs`).
- i18n : `settings.system`, `settings.nativeNotif`, `settings.autostart` × 6.

## Acceptation
- [ ] Notification visible app minimisée ; AUCUNE notification quand la fenêtre a le focus.
- [ ] Toggle autostart : vérifier la clé de registre `HKCU\...\Run` posée/retirée.
- [ ] `npm run tauri build` passe (les plugins sont bien déclarés dans les capabilities).

---

# PHASE 5 — 🔁 Routine post-swap configurable (B3)

**Valeur** : chaque compte peut avoir SA file par défaut et son comportement post-swap.

## Backend
- `meta.json["post_swap"] = {"queue_id": int|null, "auto_join": bool}` (défauts : null/true). Endpoint `POST /post-swap {name, queue_id, auto_join}`. `/accounts` l'expose.
- `core.swap()` / `queue_joiner` : si l'appel `/swap` ne précise pas de queue_id explicite, utiliser celui du compte ; si `auto_join=false`, ne pas lancer le QueueJoiner du tout (juste le client).

## Frontend
- Le sélecteur radial actuel devient la **valeur par défaut mémorisée du compte** : choisir une file dans le radial la persiste via `/post-swap` (plus un état local éphémère). L'icône du bouton reflète donc la préférence durable du compte.
- Ajouter dans le radial un 8ᵉ état ? NON — garder 7. « Aucune » = `auto_join:false`.
- Après un swap, le comportement doit être visible dans les toasts existants (« File Solo/Duo rejointe » etc. — messages backend déjà présents via QueueJoiner).

## Acceptation
- [ ] La file choisie survit au restart de l'app (persistée par compte).
- [ ] « Aucune » → swap sans aucune action de lobby.
- [ ] Double-clic carte + bouton JOUER utilisent bien la préférence du compte.

---

# PHASE 6 — 🔎 Recherche rapide (C3)

**Valeur** : retrouver un compte instantanément quand la liste grandit.

## Frontend (100 % front)
- Champ de recherche discret dans le header de la liste (icône loupe qui s'étend au clic ou au raccourci **Ctrl+F** interceptée dans la fenêtre), filtre en direct sur `name` + `riot_id` (insensible casse/accents), surlignage non requis.
- Échap ou croix = reset. Si le filtre ne matche rien : petit état vide « Aucun compte ne correspond ».
- ⚠️ Compatibilité drag & drop : le réordonnancement (`Reorder.Group`) doit être **désactivé pendant qu'un filtre est actif** (sinon l'ordre persisté se corromprait).
- i18n : `search.placeholder`, `search.empty` × 6.

## Acceptation
- [ ] Filtre instantané, Ctrl+F focus, Échap reset.
- [ ] Drag désactivé sous filtre actif ; ordre intact après reset.
- [ ] Mode streamer : la recherche fonctionne mais les résultats restent floutés.

---

# PHASE 7 — 📜 Historique de matchs (A2)

**Valeur** : les 20 dernières parties classées dans le RankDetailDialog, avec champion/KDA/résultat.

## Décision d'architecture (imposée)
Source = **Riot API Match-V5** (via `riot_api.py` existant) + **cache local persistant**. La clé dev expire toutes les 24 h → le cache est la vraie source d'affichage ; le réseau ne fait que le rafraîchir.

## Backend
- `riot_api.py` : `fetch_matches(riot_id, region, count=20) -> list[dict]` — réutiliser le mapping régions et la gestion 429/403 existants. Par match (queue 420/440 uniquement) : `{match_id, ts, queue_id, champion, win, kills, deaths, assists, duration_s, cs, role}`.
- Nouveau fichier de cache : `accounts/{name}/matches.json` (fusion par `match_id`, tri desc, cap 100). Fonctions dans `vault.py` : `merge_matches(name, items)`, `get_matches(name)`.
- Endpoints : `GET /matches?name=` (sert le cache, toujours) ; `POST /matches-refresh {name}` (async thread comme `/backfill`, broadcast `matches_done`/`matches_error`). Si clé expirée : `matches_error` avec code `key_expired`.
- Icônes champions : PAS de nouveau proxy — le front utilisera Data Dragon direct (`cdn/{ver}/img/champion/{Name}.png`) comme CDragon est déjà utilisé ailleurs.

## Frontend
- `RankDetailDialog.tsx` : nouvel onglet ou section « Dernières parties » — lignes compactes : icône champion (rond, 28px), KDA coloré (vert si win), file (Solo/Flex), durée, date relative (« il y a 2 h » — helper local, PAS de lib). Bouton refresh avec le même pattern spin/poll que le backfill existant. Si `key_expired` : bandeau discret « Clé Riot expirée — données en cache » + lien i18n vers le fait de régénérer la clé.
- i18n : `matches.title`, `matches.refresh`, `matches.keyExpired`, `matches.empty` × 6.

## Acceptation
- [ ] Refresh réel réussi sur un des 2 comptes de la machine (clé valide) : matchs affichés, cache écrit.
- [ ] Clé invalide simulée : l'UI affiche le cache + bandeau, AUCUN crash ni liste vide.
- [ ] Restart app : l'historique s'affiche depuis le cache sans réseau.

---

# PHASE 8 — 🏆 Stats par champion (A4)

**Valeur** : « tes champions du moment » — dérivé à 100 % du cache de la Phase 7 (AUCUN appel réseau supplémentaire).

## Backend
- `GET /champion-stats?name=` : agrège `matches.json` → top champions par nombre de parties : `{champion, games, wins, winrate, kda_avg}`. Minimum 1 partie ; tri games desc puis winrate desc ; cap 8.

## Frontend
- `RankDetailDialog.tsx` : sous l'historique, rangée horizontale de vignettes champion (icône + « 12 parties · 58 % · 3.2 KDA »). Barre de winrate miniature réutilisant le style existant des barres V/D.
- Mention honnête : ces stats portent sur les parties en cache (20-100 dernières), pas sur toute la saison — sous-titre i18n `champStats.scope`.
- i18n : `champStats.title`, `champStats.scope`, `champStats.games` × 6.

## Acceptation
- [ ] Agrégats vérifiés à la main sur un `matches.json` connu (winrate, KDA corrects).
- [ ] 0 partie en cache → section masquée (pas d'état vide criard).

---

## 📦 Ordre d'exécution & jalons

| # | Phase | Taille | Dépend de |
|---|-------|--------|-----------|
| 1 | Récap session (A1) | S | — |
| 2 | Objectif de rang (A3) | S | — |
| 3 | En partie (B2) | M | — |
| 4 | Notifs + autostart (D2/D3) | M | — |
| 5 | Routine post-swap (B3) | M | — |
| 6 | Recherche (C3) | S | — |
| 7 | Historique matchs (A2) | L | — |
| 8 | Stats champions (A4) | S | Phase 7 |

Validation utilisateur obligatoire entre chaque phase. En fin de vague : `npm run tauri build` complet + mise à jour de la mémoire projet (`lol-account-switcher.md`) en décrivant précisément l'état pour la session suivante.
