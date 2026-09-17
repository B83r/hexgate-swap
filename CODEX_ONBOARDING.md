# Passation Hexgate Swap → Codex

> Document de reprise autonome. Rédigé le 10/09/2026. Tout ce qui suit a coûté au moins
> une session de diagnostic — le lire en entier avant d'écrire une ligne de code.
> Le produit s'appelle **Hexgate Swap** (le dépôt et certains docs disent « Hextech Swap » :
> même chose). Collision de nom connue et non tranchée avec `hexgate.app` (concurrent existant).

---

## 1. Ce qu'est le produit

Application Windows de bureau permettant de **basculer entre plusieurs comptes League of Legends**
sans retaper d'identifiants, enrichie d'un tableau de bord (rangs, LP, historique, stats champion),
d'overlays in-game et d'un mode « apparaître hors ligne ». Destinée à être commercialisée
(décision actée le 19/07/2026), en **standalone** — Overwolf a été écarté définitivement.

Public : joueurs multi-comptes. Vocabulaire produit : jamais « boost », jamais de discours sur
le ban/ToS Riot.

---

## 2. Emplacement et arborescence

**Dépôt : `C:\Users\yaniss\hexgate-swap-v2`.**
⚠️ Les dossiers `C:\Users\yaniss\lol-account-switcher` et `lol-switcher-app` sont **OBSOLÈTES**,
ne pas les toucher.

⚠️ **Il n'y a AUCUN dépôt git** (`git status` → *not a git repository*). Aucun historique, aucun
moyen d'annuler. Toute modification est destructive par défaut : sauvegarder avant de refactorer.
Un `git init` initial serait la première amélioration utile, mais **demander avant** (le dossier
contient `backend/.env` avec la clé Riot et `node_modules/`, il faudrait un `.gitignore` d'abord).

```
hexgate-swap-v2/
├── CLAUDE.md              # règles de build + règle overlay obligatoire (§6)
├── CLAUDE_TRANS.md        # rapports de session empilés, le plus récent en haut (26/07/2026)
├── ANTIGRAVITY_TRANS.md   # rapport de la session Antigravity du 16/07/2026
├── ROADMAP_V2.md          # les 8 phases « Stats & Confort » — toutes implémentées (§5)
├── Hexgate_Swap_v0.2.2_Setup.exe   # build PÉRIMÉ (ni les correctifs wallet ni ceux du 25/07)
├── backend/
│   ├── .env               # RIOT_API_KEY — clé DEV, expire toutes les 24 h
│   └── switcher/          # moteur Python 3.12, stdlib-only (§3)
├── app/                   # Tauri 2 + React 19 + TS + Tailwind v4 + shadcn/ui (§4)
└── tools/bench.ps1
```

---

## 3. Backend Python

`backend/switcher/`, **Python 3.12, stdlib uniquement** (exigence : compilation PyInstaller
future). Serveur HTTP + SSE maison sur le port **8722**.

| Fichier | Rôle |
|---|---|
| `server.py` (117 ko) | tous les endpoints HTTP + SSE + watchers. Le gros morceau. |
| `core.py` | orchestration du swap |
| `vault.py` | comptes et `meta.json` (rank, note, pinned, rank_history, wallet, goal, post_swap) |
| `settings.py` | `settings.json` global |
| `lcu_api.py` (29 ko) | client LCU via lockfile |
| `riot_api.py` | Riot API web (Account-V1, League-V4, Match-V5) |
| `rank_watch.py` | thread de surveillance de rang |
| `queue_joiner.py` | auto-join de file post-swap |
| `offline_chat.py` | mode « apparaître hors ligne » (proxy config + MITM TLS XMPP) — §8 |
| `opponent_insight.py` | WR / matchup / pic elo de l'adversaire de lane |
| `autoaccept.py`, `process.py`, `dpapi.py`, `export_import.py`, `paths.py`, `ui_assets.py`, `client_api.py` | annexes |

**Données runtime** (hors dépôt) : `%LOCALAPPDATA%\LoLSwitcher\`
→ `accounts/{nom}/meta.json`, `accounts/{nom}/matches.json`, `settings.json`,
`opponent_peaks.json`, `offline_cert.pfx`.

### Endpoints existants (extraits de `server.py`)

`/accounts` `/add-account` `/capture` `/delete` `/swap` `/reorder` `/pin` `/note` `/goal`
`/post-swap` `/rank-history` `/refresh-riot` `/matches` `/matches-refresh` `/matches/export`
`/champion-stats` `/wallet` `/gameflow` `/live-game` `/live-game/insight-target`
`/champ-select-prefs` `/position-prefs` `/queue/start` `/queue-penalty` `/matchmaking-search`
`/lobby/dodge` `/lobby/practice` `/autoaccept` `/reconnect` `/lcu/close` `/lcu/repair`
`/chat/*` `/friends/spectate` `/loot/*` `/replays/*` `/ping/servers` `/ping/region`
`/server-status` `/settings/all` `/settings/update` `/settings/appear-offline`
`/settings/autoaccept-delay` `/settings/cloud-backup` `/settings/low-power` `/streamer-mode`
`/export` `/import` `/save-image` `/open-url` `/suggest-name` `/ui-focus` `/events` (SSE)

Le SSE `/events` diffuse des JSON typés (`accounts`, `toast`, `backfill_done`, `gameflow`,
`live_game_enemies`, `live_game_opponent_insight`, `matches_done`, `matches_error`…) ;
`app/src/App.tsx` s'y abonne et route vers les composants.

---

## 4. Frontend

`app/` — Tauri 2, React 19, TypeScript, Tailwind v4, shadcn/ui, Framer Motion, Lucide, sonner.
Version **0.2.2**, identifiant `com.yaniss.lolswitcher`, productName « Hexgate Swap ».

- Entrées : `src/main.tsx` (fenêtre `main`), `src/overlay.tsx` (fenêtre `overlay`),
  `src/overlay-cd.tsx` (fenêtre `overlay_cd`, cooldowns + insight adversaire).
- `src/components/` : `AccountCard`, `Header`, `DashboardView`, `MatchesView`, `OverlayView`,
  `RankDetailDialog`, `SettingsDialog` (+ `settings/` en onglets : General, Client, Game, Data,
  Tools, About), `ChatPanel`, `OfflineModePill`, `AutoAcceptPill`, `SwapOverlay`, `fx/` (effets),
  `ui/` (shadcn).
- `src/lib/` : `api.ts` (types + client HTTP/SSE), `i18n.tsx`, `rank.ts`, `ddragon.ts`,
  `cooldowns.ts`, `theme.ts`, `useGameOnlyWindow.ts`, `useLowPower.ts`, `pointer.ts`.
- **i18n : 6 langues obligatoires (fr, en, es, de, it, pt)**, ~394 clés symétriques. Toute
  nouvelle chaîne visible = 6 traductions, sans exception.
- **Mode streamer** : tout affichage de pseudo/Riot ID doit appliquer le flou conditionnel
  (`blurred`).

---

## 5. Où en est le projet

### Terminé et validé

Les **8 phases de `ROADMAP_V2.md`** (récap de session, objectif de rang, statut « en partie »,
notifications natives + autostart, routine post-swap, recherche rapide, historique de matchs,
stats par champion) sont implémentées — les endpoints correspondants existent tous.
Wallet EB/RP persistant hors ligne, insight adversaire de lane, ping multi-serveurs (17 régions),
traduction complète des onglets, fenêtre étroite jusqu'à 440 px, calcul d'objectif corrigé.

### Codé mais NON vérifié en exécution

C'est **la principale source de confusion sur ce projet** : distinguer systématiquement
« codé » de « vérifié en exécution ».

- [ ] **Mode « apparaître hors ligne »** — tout est vérifié sauf l'e2e : lancer League avec le
      mode ON et faire confirmer par un ami connecté.
- [ ] **Message de fin de partie** (`GameEnd` de la Live Client Data API) — la détection est
      vérifiée, l'envoi effectif non. Le réglage a été remis à vide exprès après le test.
- [ ] **Champ select réel** (déclaration d'intention / ban auto) — corrigé, à revalider en partie.
- [ ] **Chantier performance** — reste le build release + le bench (`tools/bench.ps1`).
- [ ] **Correctif LP périmés dans `RankDetailDialog`** — test interrompu.
- [ ] **Refonte des réglages en onglets** — rendu jamais affiché à l'écran.
- [ ] **Insight adversaire de lane** — jamais testé en vraie partie (toggle opt-in, désactivé
      par défaut : Overlay → Cooldowns).

### Bug ouvert, non diagnostiqué

**Mode hors ligne → déconnexion du client League en fin de partie.** Ce chemin de code n'a
**aucune trace** — première action : l'instrumenter (voir §9).

### Dette / à faire avant distribution

- **Signature de code EV obligatoire** (§7).
- Le build `Hexgate_Swap_v0.2.2_Setup.exe` à la racine est **périmé**.
- Le mode hors ligne dépend d'un **domaine et d'un certificat tiers** (ceux de Deceive) — il faut
  héberger notre propre domaine A→127.0.0.1 avec notre certificat de confiance.
- `cryptography` est à bundler pour PyInstaller.
- Clé Riot de **production** à obtenir (celle en `.env` est une clé dev qui expire en 24 h).
- Mention légale de non-affiliation à Riot Games.

---

## 6. Commandes — celles qui ne s'improvisent pas

```powershell
# Backend seul, DEPUIS LA RACINE du dépôt (pas par chemin de fichier : imports relatifs)
python -m backend.switcher.server
```

```powershell
# App complète (démarre son PROPRE sidecar backend sur 8722 → tuer le backend manuel d'abord)
cd app; npm run tauri dev
```

```powershell
# Vérifications obligatoires
cd app; npx tsc --noEmit
```

```powershell
# Build
cd app; npm run tauri build
```

**Rituel de relance après une modif backend** (sinon on regarde une vieille fenêtre en croyant
que le code est cassé) : tuer `tauri-app`, le serveur Python, les `msedgewebview2` liés et le
port 1420.

```powershell
Get-Process tauri-app -ErrorAction SilentlyContinue | Stop-Process -Force
```

Diagnostic utile : ouvrir `localhost:1420` dans Chrome pour tester code et backend indépendamment
du webview Tauri.

### Règle overlay — OBLIGATOIRE, sans exception

Détaillée dans `CLAUDE.md` à la racine. Résumé : **tout overlay est IN-GAME ONLY, STRICT**.
Jamais d'affichage hors d'une vraie partie, aucune exception, même pour se repositionner
(le « mode démo » a été supprimé définitivement le 18/07/2026 sur demande de l'utilisateur).
Pattern imposé : déclarer la fenêtre dans `tauri.conf.json` (`visible:false`), ajouter le label
dans `capabilities/overlay.json`, calculer un `shouldShow` combinant STRICTEMENT le toggle
utilisateur ET l'état réel de partie reçu en SSE, appeler `useGameOnlyWindow(shouldShow, label)`,
garder `if (!shouldShow) return null`, et **relancer l'app complètement** (les capacités sont
codegen au build Rust, un HMR Vite ne suffit pas).

---

## 7. Décisions tranchées — ne pas les rouvrir

- **Overwolf écarté** (24/07/2026) : sa compliance Riot interdit cooldowns ennemis, tracker de
  sorts d'invocateur et noms adverses en champ select ; le switcher lui-même est hors de son
  modèle sandboxé ; monétisation contraignante (20-30 % de commission, NET 60, minimum 200 $).
  **Ne pas reproposer.** Zone grise assumée en standalone.
- **Signature EV = prérequis, pas option.** Le 26/07/2026, Windows 11 a activé **Smart App
  Control** tout seul et a refusé `tauri-app.exe` (`os error 4551`) sans aucun changement de code.
  SAC n'a aucune liste d'exclusion : désactiver ou signer. L'utilisateur l'a **désactivé — c'est
  irréversible**, le réactiver exigerait une réinstallation de Windows. Tout utilisateur avec SAC
  actif subira le même blocage → certificat **EV** commercial requis (l'auto-signé ne suffit pas,
  SAC exige une réputation). État lisible :
  `HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy` → `VerifiedAndReputablePolicyState`
  (0 = off, 1 = activé, 2 = évaluation).
- **Cooldown de l'ultime retiré** (19/07/2026) — policy Riot, interdit depuis mars 2025.
  Retrait superficiel : `cooldowns.ts` calcule encore R, seul le rendu filtre.
- **Tracker de sorts d'invocateur ennemis** (manuel) : zone grise tolérée, à surveiller si la
  distribution devient publique.
- **Fonctionnalités refusées, ne pas reproposer** : thèmes de faction, runes auto, skin aléatoire,
  sorts auto, trades auto, bots personnalisés, kick/promote, relance auto après dodge,
  collection/maîtrises/missions, icône et fond de profil, message auto d'après-partie, auto-honor,
  récompenses de split, forge d'essences, reroll de skins, état du patch, inventaire, synergie duo
  (marché déjà pris), cooldown R. Également : sous-titre du header supprimé ; croix du ticker CS
  visible uniquement en mode déverrouillé, le click-through prime.

---

## 8. Mode « apparaître hors ligne » — mécanisme

Réimplémentation **clean-room en Python** de la technique de Deceive
(`molenzwiebel/deceive`) : ce dernier est en **GPL v3**, copier son code C# contaminerait un
produit commercial. On s'appuie sur les *faits de protocole* (non protégeables), jamais sur leur
*expression*. Riot a confirmé publiquement que la technique ne fait pas bannir.

1. **Lancement** — `RiotClientServices.exe` avec
   `--client-config-url="http://127.0.0.1:<configPort>"` en plus des arguments existants.
2. **ConfigProxy** — proxifie `https://clientconfig.rpg.riotgames.com` (transmet `User-Agent`,
   `Authorization`, `X-Riot-Entitlements-JWT`) et réécrit dans le JSON `chat.host`, `chat.port`
   et **toutes** les valeurs de `chat.affinities` vers notre localhost, en capturant le vrai
   host/port. Si `chat.affinity.enabled` : GET
   `https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat` → JWT → décoder la partie du
   milieu (base64, **padder à un multiple de 4**) → champ `affinity` → vrai host.
   Réponse non-JSON ou en erreur : passthrough tel quel.
3. **Chat proxy = MITM TLS** sur `127.0.0.1:<chatPort>`. Le chat Riot est du XMPP en **TLS
   implicite** (port ~5223) : accepter en TLS serveur, ouvrir une sortante TLS client vers le vrai
   host (vérification standard, `server_hostname` = vrai host), relayer dans les deux sens.
4. **Le certificat, point délicat** — le client valide le certificat du serveur de chat. Astuce :
   un domaine public dont le DNS A pointe vers 127.0.0.1, avec un certificat publiquement de
   confiance, servi en PFX public sans mot de passe. Valeurs de la v1 (celles de Deceive, d'où la
   dette) : domaine `deceive-localhost.molenzwiebel.xyz`, PFX sur
   `https://mln.cx/deceive/localhost.pfx`. En Python :
   `pkcs12.load_key_and_certificates(bytes, None)` → PEM temporaire →
   `SSLContext(PROTOCOL_TLS_SERVER).load_cert_chain(pem)`. Cache dans
   `%LOCALAPPDATA%\LoLSwitcher\offline_cert.pfx`. ⚠️ Certains FAI bloquent la résolution d'un
   domaine public vers 127.0.0.1 → repli sur le fichier `hosts`.
5. **Réécriture des présences**, uniquement client → serveur. Si un chunk contient `<presence>`
   et que le mode est actif : parser en enveloppant dans `<xml>…</xml>` ; **en cas d'échec de
   parsing, transmettre les octets d'origine inchangés**. Pour chaque `<presence>` : `<show>` =
   statut cible ; `<games><league_of_legends><st>` = statut ; si le statut n'est pas `chat`,
   supprimer `<status>` ; si `mobile`, retirer `<p>` et `<m>`, sinon retirer tout le bloc ;
   retirer les autres jeux (`valorant`, `bacon`, `keystone`, `riot_client`, `lion`).
6. **Statuts** : `chat` (= en ligne, donc mode off), `offline`, `mobile`, `away`.

`OfflineChatService` est un **singleton persistant** (`offline_chat.service`) : chaque swap tue et
relance le client, mais les proxies doivent survivre. `process.py::launch_league()` n'est **jamais
bloquant** — un échec logge `[offline] proxy indisponible…` et lance normalement.

---

## 9. Pièges — chacun a coûté une session de diagnostic

### Client League (LCU)

- **Le LCU répond avant d'être utilisable.** Après un démarrage à froid,
  `/lol-gameflow/v1/gameflow-phase` et `current-summoner` répondent déjà alors que les appels
  `/lol-lobby/v2/*` sont **encore refusés quelques secondes**. Toute automatisation de lobby doit
  attendre ~5 s après le chargement du profil **et** réessayer. Ne jamais abandonner au premier
  refus — cause du bug « l'automatisation ne part pas » du 25/07.
- **`gameflow_phase()` n'est pas une sonde de présence** : elle absorbe `LeagueNotRunning` et
  renvoie la chaîne `'None'`, indiscernable d'un client au repos. Utiliser `lcu_api.is_ready()`.
- **Wallet** : `GET /lol-inventory/v1/wallet` renvoie 400 RPC_ERROR. La vraie route est
  `GET /lol-inventory/v1/wallet/{currency}` (`lol_blue_essence`, `RP`), deux appels.
- **Live Client Data API publie le CS par paliers de 10**, sur tous les endpoints. Pas de parade.
- **Jamais de logout du client Riot** (invalide le ssid serveur) — passer par `core.py`/`vault.py`.
- **`ping.riotgames.com` ne résout plus** et les IP Riot Direct `104.160.x` sont muettes. La
  latence affichée était depuis toujours celle du repli `1.1.1.1`. Remplacé par une sonde à deux
  étages qui affiche `≈` quand la valeur est estimée. Mesurer une latence en **ICMP**, jamais par
  poignée de main TCP.
- Le **Mode Streamer du client LoL lui-même** (pas celui de Hexgate) anonymise les riotId des
  autres joueurs dans les données locales — un `'#'` à la place d'un pseudo vient de là.

### API Riot

- **Cloudflare bloque `Python-urllib`** → 403 « error code: 1010 ». Un User-Agent de navigateur
  est obligatoire (déjà fait dans `riot_api._HEADERS`). Un 403/1010 vient de là, **pas de la clé**.
- **La clé dev expire toutes les 24 h** → toute feature qui en dépend doit dégrader proprement
  (message clair + cache toujours affiché, jamais d'écran vide).
- **Data Dragon** : lire la version via `/api/versions.json`, ne jamais la figer.
- **CDragon `ranked-mini-crests`** : `emerald` n'existe qu'en `.svg` — utiliser `.svg` pour tous
  les tiers.

### Windows et outillage

- **`tkinter` est inutilisable depuis un thread de travail HTTP** : `asksaveasfilename` rendait la
  main en 1,9 s sans afficher de fenêtre et le repli silencieux écrivait sur le Bureau. Remplacé
  par `comdlg32.GetSaveFileNameW` en ctypes, repli silencieux supprimé.
- **`Set-Content -Encoding utf8` écrit un BOM** que `json.loads()` refuse. Pour un JSON lu par le
  backend : `[System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding($false)))`.
- **Instances zombies de `tauri-app.exe`** : tuer par port ne suffit pas (§6).
- **Vite écoute `localhost` en IPv6** — `Test-NetConnection 127.0.0.1 -Port 1420` peut mentir.
- **Les capacités Tauri sont codegen au build Rust** : après une modif de `capabilities/*.json`
  ou de `tauri.conf.json`, relancer l'app complètement (un changement de `tauri.conf.json` seul ne
  redémarre rien automatiquement).
- **`tasklist`** peut émettre des octets non-UTF8 → décoder en `ascii/errors=ignore` (déjà géré
  dans `process.py`).
- **Écran réel de l'utilisateur : 1536×864.** Ne pas réutiliser des coordonnées d'overlay venant
  d'un écran plus large sans revérifier.

### Frontend

- **Écriture perdue sur un état figé au rendu** : dans `ChampSelectPrefsSection`, chaque `save()`
  repartait de `prefs` capturé au rendu, donc cocher une case juste après une saisie réécrivait
  l'ancien texte. Corrigé par `prefsRef` + `save(patch)` fusionnant dans le dernier état.
  Motif générique — se méfier partout où un handler capture un état.
- **`scratchpad/i18n_audit.py` ne voit que les `t("clé")` littéraux.** Les clés passées par
  variable (`t(labelKey)`, `t(o.label)`) lui échappent **et passent aussi `tsc`**.
- **SVG `linearGradient`** en `objectBoundingBox` (le défaut) est invisible sur un path à bounding
  box dégénérée (icône en traits purs) → `gradientUnits="userSpaceOnUse"`.
- **Animations** : uniquement `transform`/`opacity` (GPU). Pas de `filter`/`blur` animés, pas de
  layout thrashing. Respecter `prefersReducedMotion()` (`lib/theme.ts`).

### Méthode

**Instrumenter tous les chemins asynchrones.** `_start_queue`, `_ensure_league_client_ready` et
les watchers tournent en thread et ne remontent que des toasts : sans `print(..., flush=True)`,
un échec est totalement muet et indiagnosticable. Plusieurs bugs n'ont été trouvés qu'après ajout
de traces — c'est aussi la première chose à faire sur le bug ouvert du mode hors ligne.

---

## 10. Standards de qualité — non négociables

- `npx tsc --noEmit` : **zéro erreur** après chaque tâche.
- `python -m py_compile` sur chaque fichier Python touché.
- Chaque endpoint nouveau ou modifié **testé en HTTP réel** contre le serveur lancé avant d'être
  déclaré fini.
- **Zéro nouvelle dépendance** npm/pip sans justification écrite (le backend reste stdlib-only,
  exigence PyInstaller).
- Toute chaîne visible : `t("…")` + **6 langues**. Les libellés de données LoL passent par
  `rank.ts`.
- **Honnêteté des données** : ne jamais inventer une stat. Une valeur estimée doit le dire dans
  l'UI (pattern existant du « ? » et du « ≈ »).
- Respect du **mode streamer** sur tout nouvel affichage de pseudo/Riot ID.
- Suivre les patterns existants du fichier touché. Pas de refactor opportuniste hors périmètre.
- Une phase = une unité de travail, **validée par l'utilisateur avant la suivante**.
- En cas de doute d'interprétation : choisir l'option la plus simple, la noter, continuer.
- Si un endpoint LCU ne répond pas comme documenté : dégrader proprement (feature masquée plutôt
  que cassée), le noter, continuer.
- **Langue : français** partout — code, commentaires, commits, rapports.
- Rapport de fin de session dans `CLAUDE_TRANS.md` : résumé des modifications, checklist mise à
  jour, fichiers touchés, points bloquants et prochaines étapes.

---

## 11. Par où commencer, concrètement

1. Lire ce fichier, puis `CLAUDE.md` (règle overlay) et le haut de `CLAUDE_TRANS.md`
   (rapport du 26/07/2026, le plus récent).
2. Demander à l'utilisateur une **clé Riot dev fraîche** (`backend/.env`, elle a forcément expiré).
3. Lancer `python -m backend.switcher.server` depuis la racine, vérifier `GET /accounts` → 200.
4. Le tuer, puis `cd app; npm run tauri dev` et vérifier que l'app s'ouvre avec les 2 comptes.
5. Ensuite, par ordre de valeur : instrumenter le bug « déconnexion en fin de partie en mode hors
   ligne », puis solder la liste « codé mais non vérifié » du §5, puis produire un build à jour
   (le 0.2.2 de la racine est périmé).
