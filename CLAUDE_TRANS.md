# Transmission Codex — 11/09/2026 : icône Arena réparée

## Cause

Le sélecteur de file utilisait l'asset Arena via le canal CommunityDragon
`latest`. Le dossier saisonnier `gamemodeassets/cherry` n'est plus publié dans
la version courante : l'URL répondait 404 et le WebView affichait une image
cassée.

## Correctif

- `app/src/components/AccountCard.tsx` : l'icône Arena officielle est épinglée
  sur l'URL CommunityDragon immuable de la version `15.9`, encore disponible.
- `QueueIcon` possède désormais un repli visuel `Swords` si n'importe quel
  asset distant de file échoue à charger ; une future suppression ne produira
  donc plus le pictogramme natif d'image cassée.
- L'image décorative utilise maintenant `alt=""` et `aria-hidden="true"`.

## Vérifications

- URL Arena versionnée : HTTP 200, PNG de 44 371 octets.
- `npx tsc --noEmit` : OK.
- Rendu local réel : image chargée (`complete=true`, largeur native 210 px) et
  icône Arena visible dans le sélecteur circulaire.
- HMR Vite appliqué dans l'application Tauri ouverte.

## Fichiers modifiés

- `app/src/components/AccountCard.tsx` — URL Arena stable et fallback.
- `CLAUDE_TRANS.md` — rapport de cette intervention.

---

# Transmission Codex — 11/09/2026 : sauvegarde de compte compatible RSO Riot

## Contexte

La sauvegarde de compte échouait systématiquement après les mises à jour Riot,
avec le message demandant de cocher « Rester connecté », alors que le client
Riot local était effectivement authentifié. Aucune session, cookie ou valeur
secrète n'a été affiché, exporté ou ajouté au dépôt.

## Cause confirmée

`vault.has_persistent_session()` ne reconnaissait que le cookie historique
`ssid`. Le fichier actuel `RiotGamesPrivateSettings.yaml` utilise une structure
RSO différente : `riot-login` est présent, et l'authentificateur
`rso-authenticator` porte une `value` non vide avec l'attribut
`persistent: true`. Cette structure seule ne suffit toutefois pas : elle peut
ne contenir qu'un identifiant d'appareil connu. Une sauvegarde effectivement
restaurable contient aussi un `refresh_token` non vide. Le champ
`riot-login.persist` est désormais `null`, y compris pour ce format persistant
; il ne peut donc plus servir de garde-fou.

L'échec intervenait avant toute écriture de compte ou opération DPAPI.

## Correctif

- `backend/switcher/vault.py` : `has_persistent_session()` accepte maintenant
  le format historique `ssid` **ou** le format RSO actuel. Le format RSO exige
  simultanément le bloc `riot-login`, le bloc `rso-authenticator`, une valeur
  non vide, `persistent: true` et un `refresh_token` non vide.
- Le contrôle de sécurité reste intact : une valeur vide, un cookie non
  persistant, une structure RSO incomplète ou un fichier sans contexte
  `riot-login` sont refusés.
- Le parseur lit uniquement la structure YAML minimale, sans dépendance pip et
  sans jamais traiter la valeur sensible comme une donnée métier.

## Vérifications exécutées

- Tests unitaires en mémoire : ancien format `ssid`, format RSO persistant,
  cookie non persistant, valeur vide, structure incomplète et contenu sans
  rapport — tous conformes.
- Le format RSO complet actuellement présent sur cette machine est reconnu ;
  une autre sauvegarde limitée à l'identifiant d'appareil est désormais
  refusée, sans afficher de contenu sensible.
- Capture complète isolée dans un dossier temporaire : les deux copies de
  session ont été chiffrées via DPAPI et le `meta.json` créé ; aucun compte
  Hexgate ni fichier Riot actif n'a été modifié.
- `python -m py_compile backend/switcher/vault.py` : OK.
- `npx tsc --noEmit` dans `app/` : OK.
- Application Tauri relancée : sidecar backend démarré et annonce
  `LOL_SWITCHER_READY port=8722`.
- **E2E réel validé** : la sauvegarde RSO complète a été restaurée, le client
  Riot a accepté la session et League a été lancé automatiquement.

## Checklist

- [x] Diagnostic de la rupture `ssid`.
- [x] Compatibilité avec la structure RSO complète actuelle.
- [x] Compatibilité historique conservée.
- [x] Tests unitaires et capture DPAPI isolée.
- [x] E2E réel : restauration de la sauvegarde RSO complète, session Riot
  acceptée et lancement League.
- [/] Une sauvegarde limitée à l'identifiant d'appareil doit être recréée : se
  reconnecter sur ce compte avec « Rester connecté », puis le sauvegarder à
  nouveau. Elle ne peut pas être réparée sans une reconnexion manuelle.

## Fichiers modifiés

- `backend/switcher/vault.py` — détection de session persistante.
- `CLAUDE_TRANS.md` — rapport de cette intervention.

## Point d'attention

Pour recréer la sauvegarde non restaurable : se reconnecter sur ce compte avec
« Rester connecté » coché, puis utiliser « Sauvegarder la session » sous le
même nom. Ne jamais employer « Se déconnecter » dans le client Riot : cela
invalide le jeton côté serveur.

---

# Transmission Claude Code — 26/07/2026 : 7 demandes utilisateur (traduction, ping multi-serveurs, fenêtre étroite, objectif, message de fin de partie, champ select, enregistrement d'image)

Rapport de session. Reprise possible sans autre contexte. Les sessions précédentes sont conservées plus bas.

## Contexte

L'utilisateur a envoyé deux captures annotées de l'app et listé 7 problèmes, puis a demandé de tout régler en autonomie. Tout a été codé ; **5 points sur 7 sont vérifiés en exécution réelle**, 2 attendent une situation de jeu précise (détaillé au §9).

Environnement de test utilisé : backend `python -m backend.switcher.server` (⚠️ **pas** `python backend/switcher/server.py`, qui casse sur les imports relatifs) + Vite sur 1420, app inspectée dans un navigateur de prévisualisation. Client League ouvert, compte `rank1player#KRKR` connecté.

## 1. Traduction incomplète des boutons — CORRIGÉ ET VÉRIFIÉ

Les onglets de navigation étaient en dur en français (`Comptes`, `Dashboard`, `Stats & Matchs`, `Overlay`), de même que la pilule auto-accept, l'ETA de file et plusieurs libellés du dashboard.

- `App.tsx` : la barre d'onglets est devenue une boucle sur un tableau `{ id, labelKey, Icon }`.
- 22 clés ajoutées × 6 langues dans `app/src/lib/i18n.tsx` (**394 clés symétriques**, audit à zéro écart).
- ⚠️ **Piège à connaître** : le script d'audit ne détecte que les appels `t("clé")` littéraux. Les clés passées par variable (`t(labelKey)`, `t(o.label)`, `t(doneKey)`) lui échappent — quatre d'entre elles manquaient tout en passant `tsc` **et** l'audit. Un contrôle statique complémentaire a été fait sur tous les littéraux en forme de clé dans `src/` : 0 manquante.
- Vérifié : bascule en anglais → `Accounts / Dashboard / Stats & Matches / Overlay`, puis retour en français.

## 2. Ping : survol inerte + sélecteur de serveur — CORRIGÉ ET VÉRIFIÉ

Découverte préalable : **`ping.riotgames.com` ne résout plus du tout** et les IP Riot Direct `104.160.x` ne répondent ni en ICMP ni en TCP 443. La valeur « 70 MS » affichée jusqu'ici était donc le repli `1.1.1.1` — un nombre sans rapport avec le jeu.

- `server.py` : table `LOL_SERVERS` (17 régions, noms de villes internationaux), sonde à deux étages — IP Riot Direct d'abord (`estimated: false`), sinon point de mesure régional de la même ville (`estimated: true`, affiché `≈` avec une infobulle explicite). Pas de mesure de substitution déguisée en vraie latence.
- Endpoints `GET /ping/servers` et `POST /ping/region` (persistance dans `ping_region`, mesure immédiate sur un thread).
- `Header.tsx` : la bulle de latence est un `<div>` inerte ; c'est le libellé « PING &lt;serveur&gt; ▾ » qui ouvre la liste (fermeture différée de 220 ms pour laisser traverser l'espace).
- Vérifié : les 17 serveurs s'affichent, survol de la bulle → rien ne s'ouvre, bascule EUNE ≈26 ms → NA ≈121 ms, choix persisté côté backend.

## 3. Fenêtre étroite — CORRIGÉ ET VÉRIFIÉ

`shrink-0` sur le groupe de droite (le bouton réglages ne peut plus être expulsé), les onglets absorbent la pression : libellés masqués sous 768 px puis défilement horizontal.

Vérifié à 620 px (`minWidth` Tauri) **et** à 440 px : `scrollWidth == innerWidth` (aucun débordement), bouton réglages entièrement visible, bouton « Hors ligne » non rogné.

## 4. Estimation de l'objectif faussée — CORRIGÉ ET VÉRIFIÉ

Cause : `rank_history` est échantillonné périodiquement, donc la plupart des couples de snapshots consécutifs contiennent **zéro partie jouée**. L'ancien calcul moyennait ces deltas nuls, écrasait le LP/partie vers 0 et gonflait le nombre de parties.

Nouveau calcul, conforme à la méthode demandée : les vraies parties sont identifiées par `wins + losses`, on ne garde que les couples avec au moins une partie, on répartit le delta si un snapshot en couvre plusieurs, garde-fou à 200 LP/partie (reset de saison, resynchro Riot), moyenne sur les **5 dernières parties**. Une moyenne nulle ou négative ne permet aucune projection : on retombe alors explicitement sur le libellé « victoires estimées ».

Vérifié sur les données réelles : « Objectif : PLATINE IV — 21 LP restants — ~2 parties au rythme actuel · objectif dans ~1 jour », infobulle « Base : 13 LP nets par partie sur les 5 dernières parties ».

## 5. Message de fin de partie — CODÉ, DÉTECTION VÉRIFIÉE

- Réglages `end_of_game_message` + `end_of_game_message_team_only`, UI dans `GameTab.tsx`, traduits.
- Watcher `start_end_of_game_message_watcher` : écoute l'événement **`GameEnd`** de la Live Client Data API (`https://127.0.0.1:2999`), c'est-à-dire l'instant exact où le Nexus explose. Le chat reste utilisable pendant l'animation Victoire/Défaite (~8 s), c'est la fenêtre d'envoi. Préfixe `/all` sauf si l'option « équipe uniquement » est cochée. 6 tentatives espacées de 1,2 s, car `execute_in_game_command` échoue si League n'est pas au premier plan.
- Vérifié : aller-retour du réglage jusqu'au backend, et **flux d'événements lu en partie réelle** (11 événements : `GameStart`, `FirstBlood`, `ChampionKill`, `Multikill`, `MinionsSpawning`) — le canal de détection fonctionne.
- ⛔ Non vérifié : l'envoi effectif au moment du `GameEnd`. Le réglage a été **remis à vide** après le test pour ne surtout pas envoyer un message de test dans une vraie partie.

## 6. Champ select : intention et ban — CAUSE RÉELLE TROUVÉE, CORRIGÉE

L'hypothèse de départ (résolution du nom de champion trop stricte) **était fausse** : `ban_priority: ["locke"]` se résout correctement (champion 805, entrée exacte du catalogue LCU). La vraie cause a été trouvée en lisant les préférences réellement stockées :

```
auto_declare_intent = False | toutes les listes de priorité vides
auto_ban            = True  | ban_priority = ['locke']
chat_message_enabled= True  | chat_message = ''   ← signature du bug
```

« Activé avec un contenu vide » est la trace d'une **écriture perdue**. Dans `ChampSelectPrefsSection`, chaque `save()` repartait de `prefs` figé au rendu : cocher une case juste après avoir saisi du texte réécrivait l'ancien texte par-dessus. Les listes de priorité vides ont la même origine.

- Correctif : `prefsRef` (miroir synchrone) + `save(patch: Partial<…>)` qui fusionne toujours dans le dernier état.
- Correctif complémentaire : un bandeau d'avertissement liste les automatisations cochées **sans contenu** — sans lui, une automatisation qui ne peut rien faire passe pour cassée.
- Côté backend, deux durcissements conservés : la déclaration d'intention se fait dès la phase de ban (l'action de pick n'est alors pas `isInProgress`, elle était donc invisible), et le ban n'est marqué « fait » que si le PATCH a réellement abouti. Les exceptions du watcher sont désormais tracées au lieu d'être avalées.
- Vérifié : la course a été reproduite dans l'app (saisie + clic sur une case dans le même cycle) → les deux écritures survivent maintenant. Les préférences d'origine de l'utilisateur ont été restaurées à l'identique.
- ⛔ Non vérifié : le comportement en champ select réel.

## 7. « Enregistrer l'image » — CAUSE RÉELLE TROUVÉE, CORRIGÉE ET VÉRIFIÉE

Le premier essai a révélé pire que prévu : `POST /save-image` renvoyait `200 {"path": "C:/Users/yaniss/Desktop/…"}` **sans qu'aucune boîte de dialogue n'apparaisse** — le fichier atterrissait silencieusement sur le Bureau.

Cause : **`tkinter` n'est pas utilisable depuis un thread de travail HTTP**. Sonde isolée → `asksaveasfilename` rend la main en 1,9 s, sans fenêtre, avec un résultat fantaisiste. Cela affectait aussi l'export JSON des matchs, qui utilise le même helper.

- `save_file_dialog` repose désormais sur l'API Windows native `comdlg32.GetSaveFileNameW` (ctypes), appelable depuis n'importe quel thread pourvu qu'il soit initialisé en COM apartment. `tkinter` reste en repli hors Windows.
- **Le repli silencieux vers le Bureau a été supprimé** : écrire ailleurs que là où l'utilisateur l'a demandé est pire que de signaler l'échec. En cas d'indisponibilité, on renvoie « annulé » et on trace la cause.
- `POST /save-image` : base64 → dialogue → ré-encodage PNG→JPEG (Pillow) si l'extension choisie est `.jpg`/`.jpeg`, plutôt que de mentir sur le contenu du fichier.
- `RankDetailDialog.tsx` : l'ancre `<a download>` (qui n'ouvre rien dans une webview Tauri) est remplacée par `api.saveImage`.
- Vérifié de bout en bout : clic dans l'app → fenêtre `#32770` intitulée **« Enregistrer sous »** réellement présente et modale → annulation → toast « Enregistrement annulé ». Écriture PNG et conversion JPEG validées séparément (PNG 60×40 RGBA / JPEG 60×40 RGB).

## 8. Fichiers modifiés

- [backend/switcher/server.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/server.py) — table `LOL_SERVERS` + sonde à deux étages, `/ping/servers`, `/ping/region`, `/save-image`, `save_file_dialog` réécrit en Win32, `_png_to_jpeg`, réglages et watcher de fin de partie, watcher champ select durci
- [backend/switcher/lcu_api.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/lcu_api.py) — résolution tolérante des noms de champions (sans accents/ponctuation, préfixe puis sous-chaîne, refus si ambigu)
- [app/src/lib/i18n.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/lib/i18n.tsx) — 394 clés × 6 langues, symétrie vérifiée
- [app/src/lib/api.ts](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/lib/api.ts) — `PingServer`, `PingUpdate`, `saveImage`, `getPingServers`, `setPingRegion`, nouveaux réglages
- [app/src/App.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/App.tsx) — barre d'onglets traduite et responsive
- [app/src/components/Header.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/Header.tsx) — sélecteur de serveur de ping
- [app/src/components/DashboardView.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/DashboardView.tsx) — calcul d'objectif par partie réelle
- [app/src/components/RankDetailDialog.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/RankDetailDialog.tsx) — écriture perdue corrigée, bandeau d'avertissement, enregistrement d'image
- [app/src/components/settings/GameTab.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/settings/GameTab.tsx) — message de fin de partie
- [app/src/components/AutoAcceptPill.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/AutoAcceptPill.tsx), [SettingsButton.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/SettingsButton.tsx) — traduction, `shrink-0`

`npx tsc --noEmit` sans erreur, `py_compile` sans erreur.

## 9. Checklist

- [x] 1 — Traduction des boutons
- [x] 2 — Survol du ping inerte + sélecteur de serveur
- [x] 3 — Fenêtre étroite
- [x] 4 — Calcul de l'objectif
- [/] 5 — Message de fin de partie (détection vérifiée en partie réelle ; **envoi au `GameEnd` non vérifié**)
- [/] 6 — Champ select (bug de sauvegarde corrigé et vérifié ; **comportement en champ select réel non vérifié**)
- [x] 7 — Boîte de dialogue Windows pour l'image

## 10. Reprise du 26/07 (même journée) : validation hors ligne + app Tauri relancée

### 10.1 Message de fin de partie — chaîne de décision validée hors ligne (8/8)

Le vrai `start_end_of_game_message_watcher()` a été exercé sans jeu ni frappe clavier : `server.settings` remplacé **en mémoire** (aucune écriture disque, réglages utilisateur intacts) et `process.execute_in_game_command` intercepté. Harnais : `scratchpad/test_eog.py`.

Scénarios conformes : préfixe `/all` en chat tous · message brut en chat équipe · **un seul envoi** même si `GameEnd` reste dans le flux · aucun envoi hors partie / sans `GameEnd` / message vide / API live indisponible (`None`) · réessai correct quand le jeu n'est pas au premier plan (3 tentatives → 1 envoi).

⚠️ **Piège du harnais, à ne pas reproduire** : la première version donnait un faux échec. Le watcher est une boucle infinie non interruptible ; les threads des cas précédents restaient vivants et lisaient les **mêmes globals** réassignés à chaque cas — quand un cas passait la phase hors partie, ils réarmaient `sent_this_game` et réémettaient dans le cas suivant. Correction : **un scénario par sous-processus**. Toute vérification future d'un watcher de ce fichier doit faire pareil.

Reste non couvert : la frappe clavier réelle (`press_enter` → `type_text_unicode` → `press_enter`, conditionnée à `is_league_foreground()`).

### 10.2 Champ select — piste du vocabulaire de rôles écartée

Vérifié que `assignedPosition.upper()` du LCU, `ROLES` dans `RankDetailDialog.tsx` et `DEFAULT_CHAMP_SELECT` dans `vault.py` emploient tous `TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY`, avec repli sur `ANY` quand aucun rôle n'est assigné (le `or` profite du fait qu'une liste vide est falsy). **Pas de bug de correspondance** : l'inertie venait bien de la liste de champions vide + l'écriture perdue déjà corrigée.

### 10.3 ⚠️ Smart App Control a bloqué le lancement de l'app

`npm run tauri dev` → `could not execute process target\debug\tauri-app.exe (os error 4551)` : « Une stratégie de contrôle d'application a bloqué ce fichier ». **Aucun rapport avec le code** — Windows 11 avait basculé SAC d'« Évaluation » à « Activé » tout seul ; les binaires debug **et** release (non signés) étaient refusés.

**SAC n'a aucune liste d'exclusion** — pas d'exception par fichier ni par dossier, contrairement à Defender. État lisible : `HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy` → `VerifiedAndReputablePolicyState` (0=Off, 1=Activé, 2=Éval).

L'utilisateur l'a **désactivé le 26/07**, ce qui est **irréversible** (réactivation = réinstallation de Windows). **Conséquence pour la distribution standalone tranchée le 24/07 : tout utilisateur avec SAC actif subira le même blocage.** Un certificat de signature de code commercial (EV de préférence — l'auto-signé ne suffit pas, SAC exige une réputation) devient un **prérequis de distribution**, pas une option.

### 10.4 App Tauri relancée et vérifiée

`npm run tauri dev` → fenêtre native « Hexgate Swap » (handle valide), sidecar Python démarré par l'app elle-même (`LOL_SWITCHER_READY port=8722`, `/accounts` → 200), `npx tsc --noEmit` à 0. Rust non recompilé (lien seul) : ni le Rust ni les capacités n'ont été touchés cette session.

⚠️ Le backend lancé à la main (`python -m backend.switcher.server`) occupe le port 8722 et **empêche le sidecar de l'app de démarrer** : l'arrêter avant de lancer l'app, sinon elle se branche sur un processus qu'elle ne contrôle pas et qui lui survit.

## 11. Prochaines étapes

1. **Lancer une partie classée pour clore les points 5 et 6** : renseigner un message de fin de partie, cocher « Déclarer l'intention » **et remplir au moins une liste de champions par rôle** (sans quoi le bandeau d'avertissement s'affichera, c'est normal), puis observer le champ select et la fin de partie. Le backend trace `[HEXGATE][champselect] …` et `[HEXGATE][eog] …` à chaque tentative.
2. **Signature de code** — voir §10.3, devenu bloquant pour la distribution.
3. Le chantier « conso perf » (B/D) reste à builder et à mesurer, inchangé depuis le 23/07.

---

# Transmission Claude Code — 25/07/2026 (2e session) : lancement à froid réparé + bug #9 insight clos

Rapport de session. Reprise possible sans autre contexte. La session précédente (mode « apparaître hors ligne ») est conservée plus bas.

## 1. Chaîne « LANCER » à froid — RÉPARÉE ET VALIDÉE EN LIVE

Symptôme rapporté : « ça ouvre le client et le jeu, mais derrière l'automatisation ne s'effectue pas ». Trois bugs empilés, tous **préexistants**, découverts et corrigés en cascade.

**a) Sonde de présence morte** — `_ensure_league_client_ready` testait `lcu_api.gameflow_phase()`, qui absorbe `LeagueNotRunning` et renvoie la **chaîne** `'None'`. Aucune exception n'était donc jamais levée : la fonction renvoyait `True` immédiatement et tout le code d'auto-lancement en dessous était **inatteignable** (d'où le toast « Client League introuvable »). → nouvelle sonde `lcu_api.is_ready()` qui distingue réellement « client absent » de « client au repos ».

**b) Le Riot Client s'ouvrait, mais pas le jeu** — `--launch-product=league_of_legends` ne suffit pas à froid : le product-launcher n'accepte la demande qu'une fois le **login RSO validé**. → `client_api.launch_league()` est retenté à chaque tour jusqu'à acceptation (même schéma que `core._wait_and_launch_game`), avec abandon rapide à 25 s si aucune session valide (client bloqué sur l'écran de login) au lieu d'attendre les 3 minutes.

**c) ⭐ La vraie cause du « rien ne se passe »** — `_start_queue` enchaînait `create_lobby` dès que le LCU répondait. Or après un démarrage à froid **le client répond mais refuse encore les appels `/lol-lobby/v2/*` pendant quelques secondes**, et un seul refus faisait abandonner toute l'automatisation. Le `QueueJoiner` (chemin swap, qui lui fonctionnait) attendait 5 s — les deux chemins étaient désalignés. → **stabilisation de 5 s** après chargement du profil, + helper `_retry()` (12 tentatives à 1 s) sur `create_lobby` et `start_matchmaking`.

**d) Instrumentation** — ce chemin n'avait **aucune trace**, ce qui rendait le diagnostic impossible (log muet). Ajout de `[queue] …` à chaque étape. Log de la validation utilisateur :

```
[queue] demande file 420
[queue] client absent, lancement…
[queue] profil chargé (rank1player#KRKR), stabilisation 5 s
[queue] matchmaking lancé
```

**Zéro ligne `refusé`** → c'est bien la stabilisation qui débloquait, pas les retries (conservés en filet de sécurité pour les démarrages lents : patch en cours, disque chargé). **Testé et confirmé fonctionnel par l'utilisateur.**

## 2. Bug #9 insight — CLOS (9/9)

Dernier des 9 bugs de concurrence de l'insight adversaire. Le champ `riot_id` de `/live-game/insight-target` était **surchargé** : `""` signifiait à la fois « rien d'épinglé → suis l'adversaire de lane » **et** « épinglé mais anonymisé par le Mode Streamer du CLIENT LoL » (qui vide `riotId` dans la Live Client Data API).

Conséquence : épingler un adversaire masqué faisait **retomber le backend sur l'adversaire de lane** et déclencher un vrai fetch Riot API pour lui, pendant que l'overlay affichait l'épinglé. La garde `insight.riot_id === selected.riot_id` jetait ensuite la réponse — rien de faux à l'écran, mais du **quota Riot API gaspillé** en silence. D'où son classement « mineur ».

Correctif : le frontend joint `champion` (le `rawChampionName`, **toujours renseigné même masqué**) ; le backend résout la cible par `riot_id` puis **par champion en repli**. La cible masquée est alors correctement identifiée, **sans repli sur la lane**, et le garde-fou `target["riot_id"]` déjà présent coupe le fetch. Zéro appel API au lieu d'un appel inutile. `target_champion` ajouté à `_insight_state` et à son reset de fin de partie.

**Vérifié** : `ast.parse` OK, `npx tsc --noEmit` sort en 0, endpoint répond `{"ok": true}` **avec et sans** `champion` (rétrocompatible, aucun appelant cassé).
**NON vérifié** : la branche de résolution elle-même, qui exige une vraie partie avec le Mode Streamer du client LoL actif — non simulable sans violer la règle « jamais de données factices hors partie » (CLAUDE.md). Protocole de validation : Mode Streamer ON côté client LoL, en partie, cliquer un portrait adverse → cooldowns/sorts du bon champion, aucun panneau insight, et aucune ligne `[HEXGATE][insight]` avec un `target_riot_id` non vide.

## 3. Pilule du header

Le texte débordait du cadre arrondi (hauteur fixe + retour à la ligne). → `whitespace-nowrap` + `shrink-0` sur `OfflineModePill` et `AutoAcceptPill` ; « Hors ligne · Hors ligne » (redondant) rendu « Hors ligne · ON ». Mesuré après correctif : bouton 28 px dans un cadre de 30 px, `getClientRects().length === 1`, pilules alignées.

## Fichiers modifiés (2e session)
- `backend/switcher/server.py` — `_retry()`, `_ensure_league_client_ready()`, `_start_queue()`, endpoint `/live-game/insight-target`, `_insight_state`, résolution de cible du watcher, reset de fin de partie.
- `backend/switcher/lcu_api.py` — `is_ready()`.
- `app/src/overlay-cd.tsx` — envoi du champion avec la cible.
- `app/src/lib/api.ts` — `setInsightTarget(riot_id, champion)`.
- `app/src/components/OfflineModePill.tsx`, `app/src/components/AutoAcceptPill.tsx` — débordement.

## Pièges à ne pas redécouvrir
- **Le LCU répond AVANT d'être utilisable.** Toute automatisation lobby doit attendre ~5 s après le chargement du profil **et** réessayer.
- **`gameflow_phase()` n'est pas une sonde de présence** : elle renvoie la chaîne `'None'` pour un client absent comme pour un client au repos. Utiliser `is_ready()`.
- **Instrumenter les chemins asynchrones** : `_start_queue` / `_ensure_league_client_ready` tournent en thread et ne remontent que des toasts ; sans `print(..., flush=True)`, un échec est totalement muet.

## Prochaines étapes
1. **E2E « apparaître hors ligne »** — en attente d'un ami connecté (seul point nécessitant un tiers ; le code est fini).
2. Phase de test du chantier perf : contrôle fonctionnel/visuel, `latency_test.py` < 100 ms, `npm run tauri build` + `tools\bench.ps1`, D2 → GO/NO-GO Phase F.
3. Re-build du `.exe` — l'actuel (0.2.2) n'a ni les fixes wallet ni ceux du 25/07.
4. Chantier commercialisation : clé Riot prod, mention légale de non-affiliation, collision de nom avec hexgate.app.

---

# Transmission Claude Code — 25/07/2026 (1re session) : Mode « apparaître hors ligne » (code FINI, reste = e2e avec le vrai client)

Rapport de session. Reprise possible sans autre contexte (voir aussi la mémoire `lol-account-switcher.md`).

## Contexte
Objectif : se connecter à League en **apparaissant hors ligne** aux amis, façon Deceive (`github.com/molenzwiebel/deceive`), intégré backend + UI (option **avant** connexion). Deceive est **GPL v3** → interdiction de reprendre leur code dans un produit commercial : **réimplémentation propre (clean-room) en Python**, à partir des faits de protocole uniquement. Riot a publiquement confirmé que la technique n'entraîne pas de ban.

## Mécanisme implémenté
1. `RiotClientServices.exe` est lancé avec `--client-config-url=http://127.0.0.1:<port>`.
2. Un proxy HTTP local relaie `clientconfig.rpg.riotgames.com` (headers `User-Agent`/`Authorization`/`X-Riot-Entitlements-JWT` transmis) et réécrit dans le JSON `chat.host`, `chat.port` et toutes les valeurs de `chat.affinities` vers notre proxy. Le VRAI host est retenu (via l'affinité du JWT PAS si `chat.affinity.enabled`). Réponse non-JSON ou en erreur = relais tel quel.
3. Proxy chat = MITM TLS local : TLS serveur côté client Riot, TLS client (validation standard) vers le vrai serveur XMPP, relais d'octets dans les 2 sens.
4. Sens client→serveur uniquement : les stanzas `<presence>` sont réécrites (`<show>` = statut, `<status>` retiré, bloc `league_of_legends` retiré — ou `<st>` réglé et `p`/`m` retirés en mode mobile —, autres jeux retirés). **Tout fragment non parsable est relayé octet pour octet** (le flux XMPP n'est pas découpé sur les stanzas).
5. Certificat : PFX public téléchargé une fois puis mis en cache dans `%LOCALAPPDATA%\LoLSwitcher\offline_cert.pfx`, domaine `deceive-localhost.molenzwiebel.xyz` dont le DNS A pointe vers 127.0.0.1.

## Vérifications faites (cette session)
- `py_compile` OK sur les 3 modules backend ; `npx tsc --noEmit` OK.
- **Réécriture de présence testée unitairement** : `offline` retire `league_of_legends`, `valorant` et `<status>` ; `mobile` garde `<st>mobile</st>` sans `p`/`m` ; fragment tronqué relayé inchangé.
- **DNS + certificat + TLS testés en vrai** : `deceive-localhost.molenzwiebel.xyz` → 127.0.0.1, PFX téléchargé/chargé, poignée de main TLS locale validée par le magasin d'AC système (SAN correct), démarrage en 0,6 s.
- **Réécriture de configuration testée** : host/affinités/port bien remplacés, vrai host mémorisé. Relais HTTP live : renvoie le 403 de Riot tel quel sur requête non authentifiée (attendu — passthrough correct).
- **Endpoint testé en live** (serveur réel) : activer/changer de statut/désactiver, `/settings/all` cohérent, statut `chat` refusé et ramené à `offline`.
- **UI testée dans le navigateur** (vite + backend réels) : pilule « Hors ligne · OFF » rendue à côté d'Auto-accept, menu déroulant (Hors ligne / Mobile / Absent + mention « S'applique à la prochaine connexion »), clic sur « Mobile » → pilule « Hors ligne · Mobile » ET backend `appear_offline=True, offline_status=mobile`. Zéro erreur console. Réglage remis à OFF en fin de session.

## ⚠️ 2e bug PRÉEXISTANT corrigé : l'ouverture auto du client était du code mort
Symptôme signalé par l'utilisateur : lancer une automatisation client fermé donnait le toast « Client League introuvable » au lieu d'ouvrir le client. Cause : `_ensure_league_client_ready()` sondait avec `lcu_api.gameflow_phase()`, **qui absorbe `LeagueNotRunning` et renvoie `'None'`** — la sonde ne levait donc jamais, la fonction renvoyait `True` immédiatement et **tout le bloc de lancement automatique était inatteignable** (vérifié : client fermé → `gameflow_phase()` == `'None'`). Corrigé par une vraie sonde `lcu_api.is_ready()` (propage l'absence de client). Comportement voulu par l'utilisateur maintenant effectif : toast **« Ouverture du client en cours… »**, `process.launch_league()` (ouvre Riot Client + League comme un swap, même si rien n'est ouvert — l'ancien garde-fou « Client Riot introuvable » qui refusait d'agir a sauté), puis attente jusqu'à ce que le LCU réponde **ET** que le profil invocateur soit chargé (sinon `create_lobby` part trop tôt), délai 180 s pour un démarrage à froid, verrou tenu pendant l'attente pour ne pas lancer deux clients. Les 3 branches (succès / timeout / lancement impossible) ont été testées en injectant un faux `launch_league`.

## ⚠️ Bug PRÉEXISTANT corrigé au passage (touchait TOUS les réglages)
`settings.set()` n'actualisait pas le cache par mtime introduit en Phase C (23/07). Sur ce disque, **deux écritures rapprochées partagent le même mtime** → la lecture renvoyait indéfiniment la valeur d'origine. Reproduit sèchement (3 `set()` d'affilée, `get()` bloqué sur la 1re valeur), corrigé en réactualisant `_cache` après écriture, re-testé OK.

## Checklist
- [x] #6 module clean-room `offline_chat.py`
- [x] #7 intégration au lancement (`process.py`)
- [x] #8 réglages + endpoint + SSE
- [x] #9 UI (pilule header + sélecteur de statut + i18n 6 langues)
- [/] #10 test e2e — tout testé SAUF le seul point non automatisable : **lancer réellement League avec le mode ON et faire confirmer par un ami qu'on apparaît hors ligne**. À faire par l'utilisateur.

## Fichiers de cette session
- [offline_chat.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/offline_chat.py) — **nouveau**, proxy config + proxy chat TLS + réécriture de présence
- [process.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/process.py) — `launch_league()` démarre les proxies et ajoute `--client-config-url` si le mode est ON (échec = lancement normal, jamais bloquant)
- [settings.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/settings.py) — **fix cache mtime**
- [server.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/server.py) — import, `appear_offline`/`offline_status` dans `/settings/all`, POST `/settings/appear-offline` + broadcast SSE
- [OfflineModePill.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/OfflineModePill.tsx) — **nouveau**, pilule header
- [App.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/App.tsx) — pilule montée à côté d'`AutoAcceptPill`
- [api.ts](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/lib/api.ts) — type `OfflineStatus`, champs settings, `setAppearOffline`, event SSE
- [i18n.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/lib/i18n.tsx) — 6 clés `offline.*` × 6 langues

## Points d'attention / prochaines étapes
1. **e2e à faire** : activer la pilule, swap/connexion, vérifier avec un ami. Si le client n'arrive pas à se connecter au chat, regarder la sortie backend (`[offline] proxy indisponible…`) et vérifier que le DNS du domaine n'est pas bloqué par le FAI (repli : entrée `hosts` vers 127.0.0.1).
2. **Commercialisation** : la v1 dépend d'un domaine et d'un endpoint de certificat tiers (`mln.cx`). Pour la prod → héberger NOTRE domaine A→127.0.0.1 + NOTRE certificat approuvé (tâche infra, pas code). Un `TODO` est posé dans `offline_chat.py`.
3. **PyInstaller** : `cryptography` devra être bundlé pour la distribution.
4. Chantier conso perf (phases A→E) : code toujours fini, **phase de test toujours en attente** (voir le rapport du 23/07 ci-dessous).

---

# Transmission Claude Code — 23/07/2026 : Chantier « Consommation minimale » — Phases B + D1 (code fini, reste = test)

Rapport de session. Reprise possible sans autre contexte (voir aussi le plan `~/.claude/plans/prancy-wondering-meteor.md` et la mémoire `lol-account-switcher.md`).

## Contexte
Chantier de réduction CPU/GPU/RAM (baseline release 20/07 : ~900 Mo RAM dont process GPU WebView2 434 Mo, ~13 % CPU/12 cœurs). Contrainte dure : **AUCUNE réduction de qualité visuelle en mode normal** ; seul le mode opt-in « Basse consommation » change les pixels. Phases 0/A/C/E déjà faites en session précédente. Cette session = **Phase B (B1→B4) + Phase D1**, toutes terminées.

## Ce qui a été fait (tsc --noEmit OK)
- **B1 `React.memo`** ([App.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/App.tsx) + [AccountCard.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/AccountCard.tsx)) : handlers cartes en `useCallback` stables (lisent des refs), signatures **name-based**, `AccountCard` et `SortableAccountCard` wrappés `memo`. Un re-render d'App sans changement de la liste (busy, swap, recherche, phase d'un autre compte) ne re-render plus les cartes.
- **B2 Particles sprites** ([fx/Particles.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/fx/Particles.tsx)) : suppression du `shadowBlur=6` par particule/frame (poste canvas le plus cher). 8 buckets de rayon × 2 couleurs de sprites glow pré-rendus offscreen ; par frame = `drawImage` + `globalAlpha`. Rendu strictement identique (cœur alpha 1 + halo alpha 0.8 figés, ratio préservé par le globalAlpha du scintillement).
- **B3 framer→CSS keyframes** ([fx/Background.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/fx/Background.tsx), [AccountCard.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/AccountCard.tsx), [index.css](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/index.css)) : aurora blobs + halo tier passés de `motion.div` animés à des classes CSS (`.aurora-1/2/3`, `.tier-halo`), mêmes trajectoires/durées (compositor-only, zéro JS/frame). Parallax hexagonal reste framer (spring live souris).
- **B4 pointeur partagé** (nouveau [lib/pointer.ts](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/lib/pointer.ts)) : 1 seul listener window `mousemove` multiplexé (refcount) au lieu de 2 (Background parallax + Particles repel).
- **D1 splash lazy** ([AccountCard.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/AccountCard.tsx)) : IntersectionObserver (rootMargin 150px, disconnect au 1er hit) → le fond splash n'est monté qu'à l'entrée dans le viewport ; `decoding="async"` + `loading="lazy"` sur avatar / border regalia / emblème de rang. Aucune baisse de résolution (fetch/décodage seulement différés).

## Checklist chantier
- [x] Phase 0 (bench.ps1), [x] A, [x] C, [x] E (sessions précédentes)
- [x] B1, [x] B2, [x] B3, [x] B4, [x] D1 (cette session)
- [ ] Test fonctionnel + visuel (relance app, captures avant/après B2/B3)
- [ ] `latency_test.py` < 100 ms
- [ ] `npm run tauri build` + `tools\bench.ps1` (3 scénarios vs baseline)
- [ ] **D2** : bench RAM GPU avec/sans splash → **décision GO/NO-GO Phase F** (destroy/recreate webviews overlay, seulement si ≥100 Mo récupérables)

## Fichiers modifiés cette session
- [App.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/App.tsx) — B1 (useCallback/refs/memo, signatures name-based, map)
- [AccountCard.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/AccountCard.tsx) — B1 (props+call sites+memo), B3 (halo tier), D1 (splash lazy + decoding/loading)
- [Particles.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/fx/Particles.tsx) — B2 (sprites glow) + B4 (pointer)
- [Background.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/fx/Background.tsx) — B3 (aurora CSS) + B4 (pointer)
- [index.css](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/index.css) — keyframes aurora-1/2/3 + tier-halo
- [pointer.ts](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/lib/pointer.ts) — **nouveau**, module pointeur partagé

## Prochaines étapes / attention
- Aucune modif backend cette session → pas besoin de relancer `python -m switcher.server`, mais le rituel kill zombies `tauri-app` reste valable avant relance `npm run tauri dev`.
- Vérif visuelle critique : B2 (glow particules) et B3 (aurores/halo) doivent être **pixel-identiques** au mode normal. Comparer captures avant/après.
- D2 reste à mesurer sur le build release pour trancher la Phase F (risquée).

---

# Transmission Claude Code — 17/07/2026 (fin de session) : Insight adversaire de lane (WR / matchup / pic)

Rapport de fin de session. Le lecteur (Antigravity ou Claude Code suivant) peut reprendre sans aucun autre contexte.

---

## 1. Contexte

Suite directe de la session « Ticker Broadcast + Overlay Cooldowns + suivi summoners » (voir mémoire `lol-account-switcher.md` pour tout l'historique du jour). L'utilisateur a validé tout ce qui précède en jeu, puis demandé un brainstorm de 10 idées d'overlay innovantes (recherche marché faite : Porofessor/Blitz/Mobalytics/iTero, voir résumé dans la conversation), puis directement : **un overlay qui, pour l'adversaire de lane, donne son WR SoloQ global, son WR dans le matchup précis contre mon champion, et son peak elo.**

**Point technique clé découvert et confirmé par l'utilisateur** : le riotId des ennemis apparaissait masqué (`'#'`) dans un test plus tôt dans la session — ce n'est PAS une limitation de la Live Client Data API, c'est le **Mode Streamer du CLIENT LoL lui-même** (pas un réglage Hexgate) qui anonymise les autres joueurs dans les données locales quand il est actif. L'utilisateur l'a désactivé côté client LoL.

## 2. Ce qui a été fait

### A. Backend — nouveau module `opponent_insight.py`
- `RiotClient.matchup_results(puuid, region, my_champion, count=25)` (nouveau, dans [riot_api.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/riot_api.py)) : sur les 25 dernières games ranked (Solo+Flex) de l'adversaire, cherche celles où SON adversaire de lane (même `teamPosition`, équipe opposée) jouait mon champion, retourne `{wins, losses, sample}`. Réutilise le cache de matchs déjà existant (`_match_cache`).
- [opponent_insight.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/opponent_insight.py) (nouveau) : `get_insight(riot_id, region, my_champion)` = `puuid` (Account-V1) → `current_solo` (League-V4, WR saison) → `matchup_results` → `_update_peak` (cache local).
- **"Pic elo" — honnêteté assumée** : Riot n'expose AUCUN historique de rang par l'API (seulement le rang courant). Le "Pic" affiché est un **pic observé LOCALEMENT par Hexgate**, stocké dans `%LOCALAPPDATA%\LoLSwitcher\opponent_peaks.json` (nouveau, `paths.OPPONENT_PEAKS_FILE`), qui grandit au fil de vos rencontres avec ce joueur — PAS un vrai career-high. Compteur `seen_count` inclus. Écrit atomiquement (tmp + replace).

### B. Backend — intégration dans le watcher ([server.py](file:///C:/Users/yaniss/hexgate-swap-v2/backend/switcher/server.py), `start_live_game_overlay_watcher`)
- Chaque ennemi du payload SSE `live_game_enemies` a désormais un champ `riot_id` (vide si masqué par le Mode Streamer LoL de l'observateur).
- Nouveau réglage **opt-in** `opponent_insight_enabled` (settings.json, désactivé par défaut) — ce module fait des appels Riot API automatiques, donc volontairement pas activé par défaut (quota clé dev : 20 req/s, 100 req/2min). Exposé via `/settings/all` et `/settings/update` (mêmes endpoints génériques que `streamer_mode` etc., pas de nouvel endpoint dédié).
- Détection auto de l'adversaire de lane (même `position` que moi) ; dès que le couple `(riot_id adversaire, mon champion)` change (nouvelle partie, ou repick avant lock-in), une requête Riot API est lancée en tâche de fond (`_fetch_opponent_insight`, thread daemon, sérialisée par le `_riot_lock` déjà utilisé pour les autres syncs Riot de l'app) → broadcast SSE `live_game_opponent_insight`. Reset propre en fin de partie.

### C. Frontend
- [api.ts](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/lib/api.ts) : type d'event `live_game_opponent_insight` + interface `LiveGameOpponentInsight`, champ `riot_id` sur `LiveGameEnemy`, `opponent_insight_enabled` dans les types settings.
- [overlay-cd.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/overlay-cd.tsx) : nouvelle ligne compacte sous le bloc Q/W/E/R — `WR 53% (222) · vs Veigar 3V-1D · Pic Diamant IV`. **Toujours calculée pour l'adversaire de LANE réel** (même si un autre ennemi est épinglé pour voir SES cooldowns — deux concepts indépendants dans le même widget). Fenêtre agrandie 280×124 → **320×150** ([tauri.conf.json](file:///C:/Users/yaniss/hexgate-swap-v2/app/src-tauri/tauri.conf.json)) pour la nouvelle ligne.
- [OverlayView.tsx](file:///C:/Users/yaniss/hexgate-swap-v2/app/src/components/OverlayView.tsx) : nouveau toggle **« Insight adversaire de lane (Bêta) »** dans la carte Cooldowns, sous "Verrouiller la position" — appelle `api.updateSettings({opponent_insight_enabled})`, charge l'état initial via `api.getSettingsAll()`.

### D. Vérifications faites
- `tsc --noEmit` et `py_compile` : 0 erreur sur tous les fichiers touchés/créés.
- **Rendu vérifié en navigateur** (mode démo, `overlay-cd.html`) : la ligne insight s'affiche correctement dans la fenêtre élargie, aucun débordement — `WR 53% (222) | VS VEIGAR 3V-1D | PIC DIAMANT IV` (données factices `DEMO_INSIGHT` cohérentes : 118V/104D = 53%).
- App relancée proprement après les changements de `tauri.conf.json` (les tailles de fenêtre ne sont PAS hot-reload en `tauri dev`, contrairement au JSON de capacités qui lui déclenche un rebuild — un simple changement de `tauri.conf.json` seul ne redémarre RIEN automatiquement, il faut tuer et relancer à la main). Backend + app confirmés up (PID 12088, `/accounts` → 200, 2 comptes intacts).
- **PAS ENCORE testé en vraie partie** (le toggle est opt-in et désactivé par défaut — l'utilisateur doit l'activer dans Overlay → Cooldowns → « Insight adversaire de lane »).

## 3. Limites honnêtes à connaître (déjà expliquées à l'utilisateur dans l'UI)
- **WR** = WR SoloQ de la **saison en cours** (League-V4), pas un WR lifetime (Riot n'expose pas le lifetime).
- **Matchup** = échantillon des 25 dernières games ranked de l'adversaire seulement, pas tout son historique.
- **Pic** = observé localement par Hexgate au fil de vos rencontres, PAS le vrai career-high (non exposé par Riot).
- Même famille de donnée que l'écran de chargement de Porofessor/Blitz (recherche marché faite en session) — juste recalculée pour le matchup précis et affichée en jeu plutôt qu'au chargement.

## 4. Prochaines étapes
- [ ] Test en vraie partie par l'utilisateur (activer le toggle, vérifier lisibilité/positionnement de la nouvelle ligne, valeurs cohérentes).
- [ ] Si la clé Riot dev expire (401/403) pendant le test, régénérer sur developer.riotgames.com (comportement déjà connu de l'app, pas un bug).
- [ ] Idées non commencées du brainstorm des 10 pistes overlay (radar sonore, jauge de vibe d'équipe, checklist post-recall, objectif inter-comptes, etc.) — en attente de choix utilisateur.
- ⚠️ Toujours pas de `npm run tauri build`.

## 5. Rappel — fichiers de rapport
- `CLAUDE_TRANS.md` (ce fichier) : rapport de LA session courante, réécrit entièrement à chaque fois.
- Mémoire longue durée Claude Code : `~/.claude/projects/C--Users-yaniss/memory/lol-account-switcher.md`.

---

# Transmission Codex — 11/09/2026 : assets CommunityDragon embarqués

## Résultat

- Le frontend ne contient plus aucun appel à `raw.communitydragon.org` ou
  `cdn.communitydragon.org` à l'exécution.
- 231 assets utiles sont copiés dans
  `app/public/assets/riot/communitydragon` : 173 voix de sélection de champion,
  22 icônes de runes, 21 bordures de niveau, 11 mini-crests classés et 4 icônes
  de modes de jeu. Taille totale avec manifeste/notice : environ 10,8 Mio.
- Le fallback CommunityDragon des icônes de profil a été supprimé : il était
  cassé (`.png` alors que la source actuelle publie des `.jpg`) et n'était
  appelé qu'après Data Dragon. L'avatar local généré reste le fallback final.

## Correctifs connexes

- Les chemins Riot déplacés ont été actualisés avant téléchargement :
  `champion-choose-vo`, `themed-borders`, Phase Rush, Aftershock et l'icône de
  la branche Inspiration (`7203_whimsy.png`).
- Le mapping des voix a été aligné sur le résumé champion CommunityDragon :
  cinq IDs erronés corrigés et les champions récents ajoutés. Les 173 IDs
  uniques du mapping ont tous un fichier audio local.
- Arena reste issue de la version immuable CommunityDragon 15.9, mais est
  désormais servie depuis le bundle local.
- `tools/sync-communitydragon-assets.ps1` permet de régénérer la copie ; depuis
  `app`, la commande est `npm run assets:riot`.

## Fichiers concernés

- `app/src/App.tsx`
- `app/src/components/AccountCard.tsx`
- `app/src/components/DashboardView.tsx`
- `app/src/components/MatchesView.tsx`
- `app/package.json`
- `app/public/assets/riot/communitydragon/**`
- `tools/sync-communitydragon-assets.ps1`

## Vérifications

- `npx tsc --noEmit` : OK.
- `npm run build` : OK, 2 358 modules transformés.
- Contrôle exhaustif : 173 clés champion, 0 voix manquante ; 0 référence URL
  CommunityDragon distante dans `app/src` ; 0 fichier vide.
- Preview Vite de production : HTTP 200 et bons MIME types pour la page, Arena,
  une bordure, une voix OGG et une rune déplacée.
- Inspection visuelle directe du PNG Arena et d'une bordure de niveau : OK.

## Limites

- Les ressources Data Dragon (portraits, objets, etc.) restent dynamiques et
  distantes ; cette intervention concerne uniquement CommunityDragon.
- Pour intégrer de futurs champions ou changements Riot, relancer la commande
  de synchronisation puis mettre à jour le mapping si un nouvel alias apparaît.
- Aucun dépôt Git n'est présent à cette racine ; aucun commit n'a été créé.

---

# Note Codex — 11/09/2026 : plan VALORANT, sans implémentation

- Analyse seulement : aucun client Riot/VALORANT lancé, aucune session lue ou
  modifiée, aucun code produit changé.
- Le futur MVP doit limiter VALORANT au basculement de profil Riot et lancement
  du produit, en généralisant les points aujourd'hui spécifiques à League
  (`process`, `core`, `client_api`, métadonnées et contrat HTTP), sans dupliquer
  la session commune par jeu.
- Les stats VALORANT forment une phase distincte : la policy Riot actuelle exige
  enregistrement produit, clé de production et RSO/opt-in. Les overlays qui
  apportent des données temps réel influençant le jeu sont exclus du périmètre.
- Plan détaillé communiqué à l'utilisateur pour validation préalable.

---

# Note Codex — 11/09/2026 : icônes locales non chargées dans une fenêtre obsolète

- Diagnostic : les épées colorées visibles dans le sélecteur de file étaient le
  fallback `Swords`, pas de nouveaux assets. La fenêtre ouverte exécutait un
  `tauri-app.exe` compilé le 18/07/2026, sans serveur Vite sur le port 1420 ;
  elle contenait donc encore les URLs CommunityDragon historiques.
- Les PNG locaux vérifiés sont bien les visuels demandés (notamment le bouclier
  doré Normal), et non des remplacements graphiques.
- Action : fermeture de cette seule instance Hexgate et de son sidecar enfant,
  puis relance avec `npm run tauri dev`. VALORANT n'a pas été fermé, lancé ni
  modifié. La nouvelle instance sert les quatre icônes locales en HTTP 200
  (`image/png`) depuis Vite.
- Aucun fichier source n'a été modifié pour ce diagnostic ; le processus de
  développement reste actif dans la session terminale Codex.

---

# Note Codex — 11/09/2026 : spécification validée du switcher LoL / VALORANT

- Décision : un contrôle permanent à deux boutons `LoL` / `VALORANT` est placé
  dans le header sous le nom Hexgate. Logos officiels colorés ; actif LoL or
  Hexgate, actif VALORANT rouge/or ; animation de fondu brève des cartes.
- Les profils Riot et leur ordre manuel restent communs aux deux jeux ; notes
  communes ; épingles indépendantes. En VALORANT, toutes les cartes restent
  accessibles, les nouveaux profils affichent `NOUVEAU SUR VALORANT`.
- V1 VALORANT ne contient que l'onglet Comptes : médaillon logo VALORANT,
  Riot ID tronqué comme LoL, statut `NOUVEAU`/`PRÊT`/`EXPIRÉ` et bouton
  `INITIALISER VALORANT`, `JOUER À VALORANT`, `RÉPARER LA SESSION` ou
  `OUVRIR VALORANT`. Dashboard, Matchs, Overlay et fonctions League sont
  absents jusqu'à leur version VALORANT dédiée.
- Une première initialisation avertit une seule fois du tutoriel Riot éventuel.
  Le tutoriel est confirmé manuellement ; jusqu'alors le compte reste Nouveau.
  Les changements de jeu ferment sans confirmation un client au repos, mais
  exigent confirmation standard en client actif et confirmation forte (case à
  cocher) durant matchmaking/partie.
- État header : logo du jeu réellement ouvert avec point vert (LoL ou VALORANT),
  aucun indicateur pour Riot Client seul. Réglage Client Riot « Mémoriser le
  dernier jeu sélectionné », désactivé par défaut (retour LoL au démarrage).
- Aucune implémentation commencée : spécification et plan seulement, en attente
  de la validation explicite de l'utilisateur.

---

# Note Codex — 11/09/2026 : V1 VALORANT implémentée (validation réelle à faire)

- Archive pré-VALORANT : `C:\Users\yaniss\Desktop\Archives Hexgate\hexgate-swap-v2_pre-valorant-v1_2026-09-11_11-22-46.zip` (source + assets locaux, sans `node_modules`, build Rust ni secrets).
- Backend : métadonnée locale `valorant` (initialisation, tutoriel, favori), préservée par capture/restauration et export; swap League/VALORANT et détection `none`/`client`/`in_game`.
- UI : switcher permanent, cartes VALORANT rouge/or, tutoriel confirmable, favoris par jeu, mémorisation du jeu et suppression complète ou réinitialisation VALORANT.
- Fichiers : `backend/switcher/{vault,process,client_api,core,server}.py`, `app/src/{App.tsx,lib/api.ts,lib/i18n.tsx,components/Header.tsx,components/ConfirmDialog.tsx,components/settings/ClientTab.tsx,components/ValorantAccountCard.tsx}`.
- Tests : `python -m py_compile` backend, `npx tsc --noEmit` et `npm run build` depuis `app` réussis. Aucun swap réel/redémarrage sidecar pour ne pas interrompre de session Riot utilisateur.
- Asset final : `app/public/assets/riot/valorant/valorant.png` est extrait localement de `C:\Riot Games\VALORANT\live\VALORANT.exe` et employé dans le header et les cartes. Le marqueur temporaire est retiré.
- Limites : avertissement fort fondé sur le processus de jeu (pas de signal matchmaking officiel exploitable). Le test réel de swap reste volontairement manuel afin de ne pas fermer une session Riot utilisateur.

---

# Note Codex — 11/09/2026 : préparation du test V1 VALORANT

- Avec accord utilisateur après fin de partie, l'ancien sidecar Hexgate (port 8722) et son unique Riot Client enfant ont été arrêtés, puis `npm run tauri dev` relancé depuis `app`.
- Le nouveau backend annonce `LOL_SWITCHER_READY port=8722`. Vérification HTTP non destructive : `/accounts?product=valorant` répond trois profils, tous `new`; `/products/status` répond League `client`, VALORANT `none`.
- Le lancement VALORANT n'a pas été déclenché automatiquement : il basculerait la session Riot du compte choisi. L'application de test est prête pour le clic utilisateur final.

---

# Note Codex — 11/09/2026 : libellé d'overlay VALORANT

- Retour test utilisateur : le lancement VALORANT fonctionne. L'overlay affichait toutefois « Lancement de League of Legends » à l'étape finale.
- Correction : `SwapOverlay` reçoit désormais le produit stocké dans l'état de swap; la quatrième étape est traduite `swap.step4Val` dans les six langues. Les swaps League restent inchangés.
- Fichiers : `app/src/App.tsx`, `components/SwapOverlay.tsx`, `lib/i18n.tsx`.
- Tests : `npx tsc --noEmit` et `npm run build` depuis `app`, réussis. Vite recharge la modification en développement; aucun processus Riot n'a été relancé.

---

# Note Codex — 11/09/2026 : contraste des logos du switcher

- Retour UI : le `L` or se perdait dans l'état LoL actif et le rouge VALORANT était trop vif pour son logo.
- Correction : ajout de l'icône locale extraite de `LeagueClient.exe` (`app/public/assets/riot/league/league.png`) et remplacement du rouge actif par le bordeaux `#7f2330`.
- Test : `npx tsc --noEmit` réussi. Vite applique le changement à chaud; aucun client Riot n'est relancé.

---

# Note Codex — 11/09/2026 : correction définitive du produit de l'overlay

- Retour utilisateur : le texte League persistait durant un swap VALORANT malgré le libellé ajouté.
- Cause vérifiée : `startSwap` créait encore l'état `SwapState` avec `product: "league_of_legends"` en dur.
- Correction : le produit cible est un paramètre explicite de `startSwap`; l'action des cartes VALORANT passe explicitement `valorant` à l'état UI et à l'API. Les cartes League gardent le produit courant par défaut.
- Tests : `npx tsc --noEmit` et `npm run build` réussis. Aucun processus Riot relancé.

---

# Note Codex — 11/09/2026 : suppression du flux tutoriel VALORANT

- Décision utilisateur : ne plus modéliser ni confirmer le tutoriel; chaque profil Riot est considéré prêt VALORANT dès son ajout. Une éventuelle obligation Riot reste traitée par le jeu, et sera détectable plus tard par la collecte V2.
- Correction : backend `ready` par défaut hors session expirée; carte UI force également `ready` pour que la règle s'applique immédiatement sans redémarrer le sidecar. Les contrôles de confirmation du tutoriel sont retirés des cartes.
- Fichiers : `backend/switcher/server.py`, `app/src/App.tsx`, `components/ValorantAccountCard.tsx`.
- Tests : `python -m py_compile backend/switcher/server.py`, `npx tsc --noEmit`, `npm run build` réussis. Aucun processus Riot relancé.

---

# Note Codex — 11/09/2026 : wordmarks NextRank dans l'overlay de swap

- Demande utilisateur : remplacer le texte « League of Legends » / « VALORANT » de l'étape de lancement par les wordmarks blancs employés sur NextRank.
- Assets sources réutilisés depuis `C:\Users\yaniss\nextrank\public\logos` : `lol-wordmark.svg`, `valorant-wordmark.webp`, copiés vers `app/public/assets/nextrank/logos/` pour rester disponibles hors ligne.
- Correction : `SwapOverlay` remplace uniquement le libellé de l'étape 4 par le wordmark associé au produit; les trois étapes d'explication restent textuelles et traduites.
- Fichier code : `app/src/components/SwapOverlay.tsx`. Tests : TypeScript/build Vite réussis; deux assets vérifiés HTTP 200 sur Vite. Aucun processus Riot relancé.

---

# Note Codex — 11/09/2026 : préfixe de lancement avant les wordmarks

- Précision utilisateur : conserver le texte d'action avant le logo, et non afficher le wordmark seul.
- Correction : l'étape finale rend `swap.launching` suivi du wordmark, soit « Lancement de [logo] » en français, avec équivalent dans les six langues.
- Fichiers : `app/src/components/SwapOverlay.tsx`, `app/src/lib/i18n.tsx`. Tests : `npx tsc --noEmit`, `npm run build` réussis.

---

# Note Codex — 11/09/2026 : indication du compte VALORANT connecté

- Retour utilisateur : la carte du profil Riot actif restait visuellement identique et proposait « Jouer à VALORANT ».
- Cause : le backend expose déjà `active`, mais `ValorantAccountCard` ne l'utilisait pas.
- Correction : profil actif non expiré = statut et pastille d'action `CONNECTÉ` verts, sans faux bouton de lancement; même convention que la carte League.
- Fichier : `app/src/components/ValorantAccountCard.tsx`. Tests : `npx tsc --noEmit`, `npm run build` réussis.

---

# Note Codex — 11/09/2026 : faisabilité V2 de lecture locale VALORANT

- Avec l'accord utilisateur et VALORANT ouvert, sonde locale non destructive effectuée sans afficher ni conserver de secret.
- Faits vérifiés : la version actuelle ne fournit pas le port historique en ligne de commande; le Riot Client expose toutefois une session VALORANT via `/product-session/v1/external-sessions`. La configuration remoting fournit un endpoint local dont `/entitlements/v1/token` répond 200 et contient des jetons éphémères et l'identifiant de sujet.
- Limite/décision technique : rang, RR, historique et agents ne sont pas exposés comme données locales. Les récupérer nécessiterait de réutiliser ces jetons contre des endpoints distants non documentés. Ce mécanisme n'est pas retenu : Riot impose RSO/opt-in et accès production pour afficher des statistiques personnelles VALORANT. La V2 doit donc attendre l'intégration RSO officielle, ou être limitée à l'état local de session.
- Aucun secret, token, identifiant de compte ni réponse de données n'a été écrit dans les fichiers ou journaux; aucun appel distant aux services de jeu n'a été envoyé.

---

# Note Codex — 11/09/2026 : voie personnelle sans clé Riot pour les stats VALORANT

- À la demande utilisateur, test d'une requête de rang avec la session temporaire locale : le point de session et les entitlements sont accessibles, mais l'appel vers la plateforme de jeu reçoit le filtre anti-automatisation `1010`. Aucun contournement n'est implémenté.
- Alternative identifiée dans le projet utilisateur NextRank : son fournisseur HenrikDev (source tierce avec clé propre, non Riot) retourne déjà rang/RR par Riot ID et est extensible aux matchs. Hexgate pourra calculer l'agent le plus joué depuis ces matchs localement.
- Décision en attente : l'utilisateur doit autoriser la réutilisation locale de sa clé HenrikDev existante, ou demander un champ de configuration Hexgate pour une clé distincte. La clé n'a pas été lue, copiée ni journalisée.

---

# Note Codex — 11/09/2026 : V2 VALORANT HenrikDev

- Clé HenrikDev distincte pour Hexgate, sans lecture/copie de NextRank. DPAPI Windows la protège; elle est absente de `/settings/all` et des journaux.
- Backend : MMR V2, dix matchs compétitifs V4, cache UI local, rafraîchissement avec cooldown 90 s et SSE.
- Frontend : clé dans Réglages > Données & comptes, Dashboard (rang/RR, agent, V/D), Matchs & Agents et rang/RR dans les cartes après synchro; six langues ajoutées.
- Tests : `py_compile`, DPAPI mémoire, fixtures rang/match, contrat état, `npx tsc --noEmit`, `npm run build` réussis.
- Limite : sidecar non redémarré pendant VALORANT actif; test live clé/endpoint attendra l'accord utilisateur.

---

# Note Codex — 11/09/2026 : relance contrôlée pour test V2

- Avec l'accord utilisateur pour poursuivre le test, ancienne fenêtre Hexgate et son sidecar local arrêtés puis `npm run tauri dev` relancé depuis `app`.
- Vérifié : le nouveau sidecar répond sur le port local 8722 et expose `henrikdev_configured`; la valeur est `false` tant que la clé n'est pas saisie dans Réglages > Données & comptes.
- Vérifié après relance : `RiotClientServices`, `VALORANT` et `VALORANT-Win64-Shipping` restent ouverts; aucun processus de jeu n'a été arrêté. Aucun secret n'a été lu ni écrit dans ce journal.

---

# Note Codex — 11/09/2026 : relance Hexgate demandée par l'utilisateur

- Après fermeture accidentelle de la fenêtre Hexgate, `npm run tauri dev` a été relancé depuis `app` à la demande de l'utilisateur.
- Vérifié : sidecar local prêt sur 8722; `henrikdev_configured=true` persiste sans exposer la clé. État produit : League client, Valorant absent.

---

# Note Codex — 11/09/2026 : cas compte VALORANT sans données compétitives

- Test live HenrikDev autorisé sur le compte actif : résolution forcée du profil réussie (compte PC EU), mais MMR et historique compétitif vides/introuvables. Ce n'est ni une erreur de clé ni un Riot ID invalide.
- Correction : `fetch_summary` résout désormais le profil avec `force=true`, récupère sa région réelle et transforme l'absence normale de MMR/match en résumé local vide (rang nul, 0 match), au lieu de remonter une erreur.
- Tests : appel live du résumé non classé, assertions cache vide, `py_compile` et `npx tsc --noEmit` réussis. Le sidecar courant n'est pas relancé pendant VALORANT en jeu; la correction sera chargée à la prochaine relance Hexgate.

---

# Note Codex — 11/09/2026 : informations VALORANT hors ranked

- Demande utilisateur validée : le profil HenrikDev renvoie le niveau de compte et dix matchs tous modes; l'agent le plus joué est donc calculable même sans ranked.
- V2 étendue : `account_level`, historique tous modes, libellé de mode par match et agent principal. Dashboard enrichi du niveau; historique affiche le mode. Traductions six langues ajoutées.
- Test live : résumé construit et cache local mis à jour pour le compte actif, avec niveau 5, dix matchs et agent principal présent, sans rang compétitif. Vérifié via l'API locale que le cache est exposé. `py_compile`, `npx tsc --noEmit`, `npm run build` réussis.
- Aucun redémarrage ni aucune interaction avec le processus VALORANT en jeu.

---

# Note Codex — 11/09/2026 : correction normalisation des matchs VALORANT

- Retour visuel utilisateur : l'agent affichait l'objet HenrikDev brut `{id, name}` et les scores restaient vides.
- Cause : format V4 différent de l'ancien contrat anticipé : agent objet sous `player.agent`, équipes sous tableau avec `rounds` et `won`.
- Correction : normaliseur de libellé pour objets/textes, agent propre et extraction V4 des rounds/victoire. Cache actif réécrit avec données corrigées.
- Vérifié sur les dix matchs du compte actif : aucun agent brut, agent principal propre et dix scores présents. `py_compile` et `npx tsc --noEmit` réussis. Aucun processus Riot arrêté.

---

# Note Codex — 11/09/2026 : scores et portraits d'agents VALORANT locaux

- Retour utilisateur : score rendu comme objets `{won, lost}` après premier correctif et demande de portraits d'agents locaux sur les cartes de match.
- Correction V4 : conversion de `rounds.{won,lost}` en score numérique; les dix scores actifs vérifiés au format `N:N`.
- Assets : 29 portraits d'agents jouables téléchargés une seule fois vers `app/public/assets/riot/valorant/agents/` (12,465,112 octets), rendus à gauche des cartes; repli sur l'icône Valorant locale si un portrait manque.
- Tests : cache du compte actif réécrit, `py_compile`, `npx tsc --noEmit`, `npm run build` réussis. Aucun processus Riot arrêté.

---

# Note Codex — 11/09/2026 : portraits agents non affichés en développement

- Incident : les portraits locaux affichaient le repli Valorant malgré les fichiers présents.
- Cause vérifiée dans la sortie du serveur dev : watcher Vite terminé (`EBUSY` sur un PNG) pendant le téléchargement, donc les URLs de portraits ne pouvaient plus être servies.
- Remédiation : relance Hexgate/Vite après téléchargement terminé. Vérification HTTP locale : `kayo.png`, `phoenix.png` et `brimstone.png` retournent tous `200 image/png` depuis le port 1420.
- Aucun processus Riot n'a été visé; le problème est limité au serveur de développement Hexgate.

---

# Note Codex — 11/09/2026 : synchronisation VALORANT au lancement

- Demande utilisateur appliquée : nouveau worker de démarrage qui synchronise séquentiellement tous les comptes Valorant dotés d'un Riot ID lorsque la clé HenrikDev est configurée. Les appels sont espacés, n'affectent jamais les sessions Riot et déclenchent un seul rafraîchissement UI final.
- UX : l'onglet Matchs & Agents lance aussi une synchronisation unique pour un compte sans cache; il affiche l'état de synchronisation au lieu d'un faux état final.
- Test live : HideIntheShnek contient désormais dix matchs Swiftplay dans le cache local. OnlyNocturne ne se résout pas côté HenrikDev, ce qui est géré sans bloquer les autres comptes.
- Tests : `py_compile` backend, TypeScript et build frontend réussis. Aucun processus Riot arrêté.

---

# Note Codex — 11/09/2026 : faux écran « aucun compte enregistré »

- Incident utilisateur : écran League vide après plusieurs relances de développement.
- Faits vérifiés avant action : stockage intact (`LocalAppData/LoLSwitcher/accounts`, 9 dossiers) et API locale retournant les trois comptes Hexgate attendus. Aucun fichier compte n'avait disparu.
- Cause opérationnelle : deux fenêtres Tauri et deux sidecars Python concurrents, hérités des relances précédentes; une seule paire possédait les ports actifs.
- Remédiation : arrêt ciblé des seuls processus Hexgate/Vite identifiés, puis relance propre de `npm run tauri dev`. Contrôle final : une fenêtre Tauri, un sidecar, API = 3 comptes (`HideIntheShnek`, `FREEPALESTINE`, `OnlyNocturne`).
- La synchronisation VALORANT au démarrage a réussi pour FREEPALESTINE et HideIntheShnek; OnlyNocturne reste `not_found` chez HenrikDev sans bloquer l'application. Aucun fichier de compte supprimé ou restauré.

---

# Note Codex — 11/09/2026 : durcissement du coffre et instance unique

- Objectif : empêcher le retour de l’écran de comptes vide et protéger les sessions enregistrées contre les écritures concurrentes ou interrompues.
- Causes vérifiées : le sidecar Python était lancé pendant la construction de chaque instance Tauri; le backend lançait plusieurs workers avant de réserver son port; les métadonnées JSON étaient réécrites directement et plusieurs workers pouvaient effectuer des read-modify-write simultanés.
- Corrections : plugin Tauri `single-instance` enregistré en premier; démarrage du sidecar déplacé après validation de l’instance; seconde invocation = affichage/focus de la fenêtre existante. Le backend réserve désormais le port 8722 avec `SO_EXCLUSIVEADDRUSE` avant tout worker ou sauvegarde.
- Persistance : écritures atomiques avec flush/fsync et remplacement sur le même volume; sérialisation interne des mutations du coffre et des réglages; copie JSON `.bak` et récupération automatique; un profil JSON irrécupérable ne masque plus toute la liste.
- Sauvegardes : ZIP vérifié à chaque démarrage dans `%LOCALAPPDATA%/LoLSwitcher/backups`, rétention tournante de 10 archives, création uniquement si au moins un compte existe. Trois archives présentes après les tests.
- Fichiers : `app/src-tauri/Cargo.toml`, `app/src-tauri/Cargo.lock`, `app/src-tauri/src/lib.rs`, `backend/switcher/atomic_io.py`, `backend/switcher/local_backup.py`, `backend/switcher/server.py`, `backend/switcher/vault.py`, `backend/switcher/settings.py`, `backend/switcher/export_import.py`.
- Tests : seconde UI (`BEFORE=1`, `AFTER=1`, processus secondaire terminé); second backend refusé avec WinError 10048 avant nouveau backup; tests temporaires de récupération `.bak`, concurrence, rotation et absence de `.tmp`; `py_compile`; `npm run build`; coffre réel validé avec 3 comptes, 6 sessions DPAPI déchiffrables et ZIP lisibles. Build Tauri dev et `cargo check` réussis.
- État runtime : Hexgate laissé ouvert avec exactement une fenêtre et un sidecar. À la demande de l’utilisateur, aucun processus Riot/League n’est arrêté ou manipulé; son lobby League reste hors périmètre.
- Git : dossier non initialisé comme dépôt Git, aucun commit possible.

---

# Note Codex — 11/09/2026 : build production relancé

- Demande utilisateur : relance du build complet sans manipulation du client League, le lobby étant en cours.
- Résultat : `npm run tauri build` réussi (TypeScript/Vite, Rust release, MSI WiX et setup NSIS).
- Artifacts : `app/src-tauri/target/release/tauri-app.exe`, bundle MSI et installateur NSIS v0.2.2 x64.
- Aucun processus Riot/League arrêté, lancé ou modifié.

---

# Note Codex — 12/09/2026 : passation exhaustive V2.1 pour reprise Claude

- Demande utilisateur : préparer une passation spéciale Hexgate Swap, incluant l’intégralité des changements depuis le début de cette reprise et le plan V2.1 détaillé.
- Livrable créé : `PASSATION_HEXGATE_SWAP_V2_1.md` (architecture, règles, stockage, mécanisme de sessions Riot, fonctionnalités VALORANT, correctifs d’instance/sauvegarde, builds, dettes, checklist et backlog V2.1 priorisé).
- Le document ne contient aucune clé, session, cookie, mot de passe ni contenu de blob DPAPI.
- Aucun code produit, compte, archive ou processus Riot/League/VALORANT n’a été modifié pendant cette passation.

---

# Note Claude — 12/09/2026 : implémentation des 4 optimisations V2.1 (§14)

- Demande utilisateur : coder directement les 4 optimisations validées par question dans `PASSATION_HEXGATE_SWAP_V2_1.md` §14, plutôt que de les laisser en plan.
- **Optim 1 (distribution portable)** : nouveau `backend/entry.py` + `tools/build-sidecar.ps1` (PyInstaller onefile, outil de build uniquement — le runtime `switcher/` reste stdlib). `tauri.conf.json` déclare `bundle.externalBin` et chaîne `sidecar:build` dans `beforeBuildCommand`. `lib.rs` : `spawn_sidecar()` bascule entre le chemin dev inchangé (`python` + chemin absolu, `cfg(debug_assertions)`) et un sidecar Tauri résolu via `tauri-plugin-shell` en release. `Cargo.toml` +`tauri-plugin-shell`.
- **Optim 2 (résilience HenrikDev)** : backoff (2 puis 5 s) sur 429 dans `valorant_api._request()` ; fenêtre de fraîcheur de 15 min pour la synchro de démarrage (`_VALORANT_STARTUP_FRESHNESS` dans `server.py`), distincte du cooldown manuel de 90 s déjà en place. Aucune nouvelle persistance nécessaire (`stats.last_synced` existait déjà).
- **Optim 3 (poids portraits)** : 29 portraits reconvertis PNG → WebP (Pillow, qualité 82) : 12 465 112 → 1 879 950 octets (-85 %). `ValorantMatchesView.tsx` pointe vers `.webp`, ajout `loading="lazy"`/`decoding="async"`. **Les PNG d'origine n'ont pas été supprimés** (suppression en masse bloquée par le classificateur de permissions) — en attente d'action ou d'accord explicite de Yaniss.
- **Optim 4 (logs backend)** : nouveau module `backend/switcher/applog.py` (RotatingFileHandler, 5×1 Mo, `%LOCALAPPDATA%\LoLSwitcher\logs\hexgate.log`, dégrade en `NullHandler` si inaccessible). Câblé dans `vault._serialized_write` (nom fonction + nom compte uniquement, jamais les kwargs) et dans `server.py` (port, backup, workers, résumé synchro VALORANT). Aucun `print()` existant retiré.
- Tests : `py_compile` sur tous les fichiers backend touchés (OK) ; `cargo check` et `cargo check --release` sans warning (OK) ; `npx tsc --noEmit` (OK) ; `npm run tauri build` complet réussi de bout en bout (sidecar régénéré automatiquement, frontend, Rust release, MSI + NSIS produits, `hexgate-backend.exe` copié à côté de `tauri-app.exe` confirmant la résolution `externalBin`).
- Test isolé du sidecar packagé : lancé seul pendant qu'un backend dev tournait déjà sur le port 8722 → import correct, tentative de bind, échec propre `WinError 10048`, aucune écriture coffre, aucun processus Riot touché (comportement « second backend » déjà documenté).
- **Non fait volontairement** : lancement complet de l'exe release (fenêtre + tous les workers) en parallèle du dev actif de Yaniss, pour ne pas risquer une double activité auto-accept/queue-joiner pendant une session réelle. À faire avec son accord.
- Fichiers créés : `backend/entry.py`, `backend/switcher/applog.py`, `tools/build-sidecar.ps1`, `app/src-tauri/binaries/hexgate-backend-x86_64-pc-windows-msvc.exe` (régénérable).
- Fichiers modifiés : `backend/switcher/vault.py`, `backend/switcher/server.py`, `backend/switcher/valorant_api.py`, `app/src/components/ValorantMatchesView.tsx`, `app/src-tauri/src/lib.rs`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/package.json`, `.claudeignore`, `app/public/assets/riot/valorant/agents/*.webp` (ajout, PNG conservés en double pour l'instant).
- Aucun processus Riot/League/VALORANT lancé, arrêté ou manipulé.

---

# Note Claude — 12/09/2026 : retrait des jetons de défis depuis Hexgate (LoL)

- Demande utilisateur : trouver un moyen, depuis Hexgate, de retirer les jetons de défis (challenge tokens) affichés autour de l'icône de profil League. Le client n'offre aucun retrait — « Personnaliser l'identité » impose de REMPLACER un jeton, jamais d'en enlever un.
- Recherche : la solution communautaire de référence est l'outil open-source `MaciejGorczyca/ChallengesAreEvil`. Lecture de son `removeTokens.ps1` : `POST https://127.0.0.1:<port>/lol-challenges/v1/update-player-preferences/` avec le corps `{"challengeIds":[]}`, auth Basic `riot:<token>`, certificat auto-signé ignoré. Exactement le schéma d'appel que `lcu_api._call()` fait déjà.
- Sonde LECTURE SEULE sur le client en cours (port 53869) : `GET /lol-challenges/v1/summary-player-data/local-player` -> 200, `selectedChallengesString: "203102,210003,202302"` (3 jetons équipés). Confirme le champ à vider ET fournit une vérification mesurable après écriture.
- Point important : `bannerId`, `crestId`, `prestigeCrestBorderLevel` et `title` sont des champs SÉPARÉS de la même préférence. N'envoyer que `challengeIds` laisse bannière, bordure d'icône et titre intacts.
- Implémenté : `lcu_api.challenge_tokens()` (lecture, None = indisponible, [] = aucun jeton) et `lcu_api.clear_challenge_tokens()` (écriture + RELECTURE de contrôle, jusqu'à 4 tentatives espacées de 0,4 s ; `ok` n'est vrai que si les jetons ont réellement disparu côté Riot, pas seulement si la requête a été acceptée).
- Route serveur `POST /challenges/clear-tokens` -> `{ok, count}` (count = nombre de jetons retirés). Client `api.clearChallengeTokens()`. Bouton dans l'onglet Outils des réglages (`ToolsTab.tsx`), avec icône `Eraser` ; le helper `run()` accepte désormais une clé d'échec dédiée (`failKey`, défaut inchangé).
- i18n : 6 nouvelles clés (`set.tokens`, `set.tokensDesc`, `set.tokensBtn`, `set.tokensDone`, `set.tokensNone`, `set.tokensFail`) x 6 langues = 36 entrées, symétrie vérifiée par comptage.
- Tests : `py_compile` sur `lcu_api.py` et `server.py` (OK) ; `npx tsc --noEmit` (OK).
- **NON VÉRIFIÉ DE BOUT EN BOUT** : l'écriture réelle n'a PAS été exécutée. `League of Legends.exe` (PID 24888) tournait pendant toute la session — Yaniss était en partie, et la règle projet interdit d'agir sur le client dans cet état. Le POST reste donc à déclencher hors partie, par le bouton. La relecture de contrôle intégrée dira immédiatement si ça a marché.
- Réserve : aucune source n'a permis de confirmer que le comportement « liste vide acceptée » tient toujours sur le patch actuel. À considérer comme une hypothèse tant que le bouton n'a pas été pressé une fois.
- Fichiers modifiés : `backend/switcher/lcu_api.py`, `backend/switcher/server.py`, `app/src/lib/api.ts`, `app/src/components/settings/ToolsTab.tsx`, `app/src/lib/i18n.tsx`.
- Aucun processus Riot/League/VALORANT lancé, arrêté ou manipulé.

---

# Note Claude — 12/09/2026 (suite) : correction — le retrait des jetons effaçait toute l'identité

- **Erreur commise et corrigée.** La première version n'envoyait que `{"challengeIds": []}`, en supposant que la bannière, la bordure et le titre étaient des champs indépendants préservés par une mise à jour partielle. **Faux.** Test réel sur le client de Yaniss : `bannerId` 23 -> "", `crestId` 1 -> "", `prestigeCrestBorderLevel` 1 -> 0, `title.itemId` -> -1. L'identité complète a été effacée.
- **Cause, établie par le schéma que le client publie lui-même** (`GET /help?format=Full`, type `LolChallengesChallengesPlayerPreferences`) : les six champs (`bannerAccent`, `title`, `challengeIds`, `crestBorder`, `prestigeCrestBorderLevel`, `signedJWTPayload`) sont tous `optional: false`. L'endpoint REMPLACE l'objet entier — un champ omis est réécrit à vide, il n'est pas « laissé tel quel ».
- **Piège de nommage** : les noms diffèrent entre lecture et écriture. `bannerId` (lu) s'écrit `bannerAccent` ; `crestId` (lu) s'écrit `crestBorder` ; `title` se lit comme un objet mais s'écrit comme la chaîne de son `itemId`. Une correspondance naïve nom-à-nom ne marche pas.
- **Correctif** : `lcu_api.set_challenge_tokens(ids)` lit l'identité complète, la réémet intégralement en ne changeant que `challengeIds`, puis RELIT pour contrôler. Renvoie `preserved` (bannière/bordure/prestige/titre inchangés) en plus de `ok`. `clear_challenge_tokens()` n'est plus qu'un `set_challenge_tokens([])`. Ajout de `challenge_identity()` et `_identity_payload()`.
- **Test de bout en bout réussi** (client en phase `Lobby`, jeu fermé) : restauration de l'identité d'origine + les 3 jetons, puis retrait avec le code corrigé -> `{'ok': True, 'before': [203102, 210003, 202302], 'after': [], 'preserved': True}`. Relecture indépendante : jetons vides, `bannerId` 23 conservé, `crestId` 1 conservé, prestige 1 conservé.
- **Dommage résiduel non réparable** : le titre équipé (`title.itemId`) a été perdu lors du premier essai. Sa valeur n'avait pas été capturée avant l'écriture (la sonde initiale n'affichait que les clés, pas les valeurs) et aucune source ne la conserve — `/lol-chat/v1/me` confirme `playerTitleSelected: ""`. Yaniss doit le re-sélectionner parmi ses 36 titres. Bannière et bordure, elles, ont été restaurées.
- **Leçon** : avant toute écriture sur une préférence Riot, capturer l'état complet AVEC les valeurs, et vérifier si l'endpoint fait un remplacement ou une fusion. Le `/help` du client donne la réponse (`optional` par champ) sans avoir à tester en réel.
- Fichiers modifiés : `backend/switcher/lcu_api.py`.

---

# Note Claude — 12/09/2026 (suite) : nouvel onglet principal « Outils » (League)

- Demande utilisateur : rassembler toutes les actions client dans un nouvel onglet et y rapatrier celles qui étaient dans Réglages → Outils, puis ajouter 8 fonctionnalités choisies par questionnaire.
- **Méthode adoptée, à réutiliser** : `GET /help?format=Full` sur le LCU (3 Mo, 1471 fonctions, 3605 types, 116 plugins) donne le schéma exact de chaque appel, champ par champ, AVEC le drapeau `optional`. Cache et outils d'exploration laissés dans le scratchpad de session (`lcu_help.json`, `resolve.py`, `dumptype.py`, `mine_help.py`). C'est ce qui aurait évité l'effacement du titre.
- **Piège confirmé** : les chemins d'URL ne se déduisent PAS des noms de fonction du /help (impossible de distinguer un tiret d'un slash : `PostLolChallengesV1UpdatePlayerPreferences` -> `/lol-challenges/v1/update-player-preferences`). Chaque route doit être vérifiée en réel. Exemple rencontré : `.../current-summoner/reroll-points` renvoie 404, le vrai segment est `rerollPoints` en camelCase — et `current-summoner` porte de toute façon l'objet complet, retenu à la place.
- **Autre piège** : un 404 LCU est ambigu — il peut signifier « chemin faux » OU « ressource inactive ». `/lol-champ-select/v1/session` renvoie 404 hors sélection des champions alors que le chemin est correct et déjà utilisé en production.
- Nouveau composant `app/src/components/ToolsView.tsx`, branché comme vue principale `tools` dans `App.tsx` (onglet League uniquement : tout passe par l'API locale du client LoL, que VALORANT n'expose pas). Quatre sections : Profil, En partie, Butin, Client.
- `app/src/components/settings/ToolsTab.tsx` SUPPRIMÉ et retiré de `SettingsDialog.tsx` (onglet `tools`, entrée `TABS`, import `Wrench`). Les clés i18n `set.tab.tools` deviennent mortes mais sont conservées (6 langues) — à nettoyer si un passage de ménage est fait.
- Backend `lcu_api.py`, nouvelles fonctions : `apply_identity`, `saved_identity`, `set_profile_icon`, `set_profile_background`, `honor_ballot`, `honor_random_ally`, `pending_swaps`, `respond_to_swap`, `reroll_champion`, `reroll_points`, `clear_client_notifications`. Schémas résolus depuis le /help avant écriture, jamais devinés.
- Backend `vault.py` : `save_identity` / `get_identity` (clé `identity` du meta de compte, forme ÉCRITURE rejouable). Cosmétique uniquement, aucun secret.
- Backend `server.py` : `GET /tools/state` (état agrégé, tout nullable — client fermé, hors champ select et hors fin de partie sont des cas NORMAUX) et `POST /tools/{profile-icon, profile-background, identity/save, identity/restore, honor, reroll, swaps/respond, notifications/clear}`.
- i18n : 51 nouvelles clés x 6 langues = 306 entrées, symétrie vérifiée par comptage (300 `tools.*` + 6 `nav.tools`).
- Tests : `py_compile` sur `lcu_api.py`, `server.py`, `vault.py` (OK) ; `npx tsc --noEmit` (OK). Routes en LECTURE validées en réel contre le client : `/lol-honor-v2/v1/ballot` 200, `/lol-summoner/v1/current-summoner/summoner-profile` 200, `/lol-summoner/v1/current-summoner/icon` 405 (chemin bon, verbe GET non autorisé), `/lol-perks/v1/pages` 200, `/lol-settings/v2/local/LCUPreferences` 200, `/lol-patch/v1/products/league_of_legends/state` 200, `/lol-rewards/v1/grants` 200.
- **NON VÉRIFIÉ** : aucune des nouvelles ÉCRITURES n'a été exécutée (icône, fond, honneur, reroll, échanges, purge de notifications, sauvegarde/restauration d'identité). Yaniss a enchaîné les parties pendant toute la session ; la règle projet interdit d'agir sur le client en lobby/file/partie. Le garde-fou de phase a d'ailleurs bloqué un test automatiquement (`phase = 'Matchmaking'`) — comportement correct, constaté en réel.
- **Réserves explicites** : `honorType` n'a pas d'enum côté client, la valeur `HEART` vient de la communauté et reste à confirmer. Les icônes non possédées sont une zone grise : Riot peut réinitialiser côté serveur, et rien ne garantit la visibilité par les autres joueurs. Les 4 routes de purge de notifications sont écrites d'après le /help mais non validées en réel — `clear_client_notifications` compte les succès pour que l'échec d'une route n'empêche pas les autres.
- **Build release NON lancé** volontairement : `cargo build --release` sature le CPU et aurait fait lag une partie en cours. À lancer hors partie (`npm run tauri build` depuis `app/`).
- Fichiers créés : `app/src/components/ToolsView.tsx`. Supprimés : `app/src/components/settings/ToolsTab.tsx`.
- Fichiers modifiés : `backend/switcher/lcu_api.py`, `backend/switcher/server.py`, `backend/switcher/vault.py`, `app/src/App.tsx`, `app/src/components/SettingsDialog.tsx`, `app/src/lib/api.ts`, `app/src/lib/i18n.tsx`.
- Aucun processus Riot/League/VALORANT lancé, arrêté ou manipulé.

---

# Note Claude — 12/09/2026 (suite) : validation en réel des écritures + build

- Client rouvert par Yaniss pour les tests, phase `None` (accueil). Capture préalable de l'état **avec les valeurs** (la leçon de l'incident du titre) dans `etat_avant.json` : icône 6894, fond 166020, identité `{bannerAccent:"2", title:"", challengeIds:[402107,401304,202203], crestBorder:"2", prestigeCrestBorderLevel:200}`.
- **21/21 contrôles OK**, toutes les écritures testées puis restaurées à l'identique :
  - `saved_identity` / `apply_identity` : aller-retour sans dérive.
  - `clear_identity(["tokens"])` : jetons vidés, **bannière "2", bordure "2" et prestige 200 préservés** — le correctif du remplacement total est validé sur des valeurs réelles non triviales.
  - Purge des notifications : les 3 routes `DELETE` répondent 204.
  - `reroll_points` lit `{current:0, cost:250, used:0, max:2}` ; `reroll_champion()` échoue proprement hors ARAM (False, pas d'exception).
  - `honor_random_ally()` rend None hors fin de partie ; `pending_swaps()` rend une liste vide. Aucun plantage hors contexte.
  - **Icône non possédée confirmée** : l'icône bêta `7` s'applique et se relit. La zone grise fonctionne bien côté client (persistance serveur toujours non garantie).
  - **Fond non possédé confirmé** : skin `103008` (Ahri) accepté et relu.
  - Restauration finale vérifiée : icône 6894, fond 166020, identité d'origine.
- `vault.save_identity` / `get_identity` : aller-retour coffre OK sur `FREEPALESTINE#M280`.
- **Correctif issu des tests** : `POST /lol-store/v1/notifications/acknowledge` RETIRÉE de `_NOTIFICATION_ROUTES`. Elle exige l'identifiant d'UNE notification (`ARG id` dans le /help) et renvoyait donc 400 systématiquement en purge globale. Les descriptions i18n des 6 langues ont été corrigées en conséquence (plus de mention « boutique »).
- **Build release complet réussi** : sidecar PyInstaller régénéré, `tsc && vite build` OK, Rust release en 3 min 51 s, MSI et NSIS produits dans `app/src-tauri/target/release/bundle/`. Seul avertissement : un message de l'éditeur de liens (`linker_messages`, sortie localisée), sans rapport avec le code.
- **Reste à faire** : Yaniss doit quitter l'app installée (tray → Quitter) puis lancer le setup NSIS pour voir le nouvel onglet. Lancer directement l'exe compilé ne suffit pas — `tauri-plugin-single-instance` réveillerait la fenêtre de l'ancienne installation au lieu d'ouvrir la nouvelle.
- **Non testé faute de contexte de jeu** : honneur avec un vrai bulletin de fin de partie, reroll en sélection ARAM avec des points, réponse à un échange réellement reçu. Les trois chemins sont validés en « hors contexte » (échec propre), pas en « contexte nominal ».
- `honorType: "HEART"` reste une valeur communautaire, toujours non confirmée.

---

# Note Claude — 12/09/2026 (suite) : studio de raccourcis, échange d'onglets, mise en service

- **Studio de réglages et raccourcis** (`app/src/components/SettingsStudio.tsx`), calqué sur le menu « En jeu / Raccourcis » du client. Correspondances relevées sur le client réel, pas devinées : compétences `evtCastSpell1..4` (QWER), sorts d'invocateur `evtCastAvatarSpell1/2` (DF), objets `evtUseItem1..6` (touches 1 2 3 5 6 7 — exactement l'ordre du menu in-game), babiole `evtUseVisionItem` (touche 4). L'éclair sous chaque case est le booléen `Quickbinds.<clé>smart`.
- Pièges de format traités : une valeur non assignée s'écrit `null` (vrai null, cas de `evtPushToTalk`), la CHAÎNE `"null"`, ou `"[<Unbound>]"` — les trois sont gérées par `isUnbound`. Une entrée peut porter plusieurs liaisons séparées par une virgule.
- Capture clavier : clic sur une case puis frappe, Échap retire la touche. Un seul écouteur global, actif uniquement pendant une capture.
- Les deux cases « Quick Cast with Indicator » du menu in-game correspondent à `HUD.SmartCastOnKeyRelease` et `HUD.SmartCastWithIndicator_CastWhenNewSpellSelected`. **Pas de « Restore Defaults »** : le LCU n'expose aucune source de valeurs d'usine, le bouton aurait été un mensonge — les presets couvrent le besoin.
- **Presets nommés** : `vault.save_settings_preset` / `list_settings_presets` / `get_settings_preset` / `delete_settings_preset`, stockés dans `%LOCALAPPDATA%\LoLSwitcher\settings_presets\`. Application à N comptes en écrivant leur `game_settings.json`, ce qui réutilise la synchro de swap existante. `sync_enabled` est renvoyé pour que l'interface prévienne quand la synchro est coupée, au lieu de laisser croire à un échec.
- **Échange d'onglets** : l'onglet principal « Overlay » est remplacé par « Outils » ; `OverlayView` est désormais une catégorie du dialogue Réglages (réutilise la clé i18n `nav.overlay`, qui existait déjà en 6 langues).
- i18n : 39 clés `studio.*` + `tools.section.settings`, x 6 langues, symétrie vérifiée (234 + 6).
- Tests : `py_compile` OK, `npx tsc --noEmit` OK. Routes vérifiées en réel sur un port séparé (8799) avant le build : `/tools/presets`, `/tools/settings/current`, `/tools/state` répondent 200.
- **Mise en service** : build release OK (Rust 2 min 47). L'installateur NSIS `/S` a renvoyé 0 mais n'a PAS remplacé `tauri-app.exe` (version identique) — l'app se relançait sur l'interface de la veille. Corrigé par copie directe de l'exe après arrêt complet. Gotcha ajouté en mémoire.
- **Première validation réelle de l'Optim 1** : l'app installée tourne désormais avec `hexgate-backend.exe` (sidecar PyInstaller) sur le port 8722, et non plus `python -m switcher.server`. La distribution portable fonctionne de bout en bout.
- Fichiers créés : `app/src/components/SettingsStudio.tsx`. Modifiés : `backend/switcher/vault.py`, `backend/switcher/server.py`, `app/src/App.tsx`, `app/src/components/SettingsDialog.tsx`, `app/src/components/ToolsView.tsx`, `app/src/lib/api.ts`, `app/src/lib/i18n.tsx`.
- Aucun processus Riot/League/VALORANT manipulé.

---

# Note Claude — 13/09/2026 : correction du remontage React + couverture complète des raccourcis

- **Bug signalé** : « l'interface des raccourcis est complètement buguée, elle s'ouvre se referme ». Cause trouvée et assumée : quatre composants (`Section` dans `ToolsView`, `KeyCap` / `Group` / `Toggle` dans `SettingsStudio`) étaient déclarés **dans le corps du rendu**. React y voit un type de composant NEUF à chaque rendu et démonte/remonte tout le sous-arbre. Chaîne observée : une action appelle `reload()` dans `ToolsView` -> nouveau type `Section` -> `SettingsStudio` entièrement remonté -> état perdu et rechargement -> clignotement. Et chaque frappe dans la recherche remontait la grille, d'où la perte de focus.
- **Correctif** : les quatre sont hissés au niveau module avec des props explicites (`KeyCap`, `SlotGroup`, `HotkeyRow`, `GameToggle`, `Section`). Commentaires en place pour que ça ne soit pas réintroduit. Vérification : `grep` confirme qu'aucun composant n'est plus déclaré dans un rendu.
- Au passage, `capturingRef` supprimé : l'effet de capture se rejoue déjà quand `capturing` change, la ref était inutile et impure (écriture pendant le rendu).
- **Second manque signalé** : « il manque plein de raccourcis, tu m'as donné qu'un aperçu ». Exact — la grille principale ne couvrait que **13 clés sur 166**. Ajout d'une section « Tous les autres raccourcis » couvrant les **153 restantes** plus `HUDEvents` (5) et `ShopEvents` (2), rangées en 13 catégories dérivées des noms réels du client : pings (11), caméra (7), déplacement et ciblage (13), communication et emotes (18), interface (7), boutique, amélioration de sorts (4), et les cinq familles de variantes de lancement (normal, auto, rapide, rapide+indicateur, rapide+auto). Le dernier motif de `CATEGORIES` attrape tout : une clé ajoutée par Riot apparaîtra dans « divers » au lieu de disparaître.
- La capture clavier fonctionne désormais sur **toutes** les sections de raccourcis, pas seulement `GameEvents` (`capturing` porte `section/clé`).
- Les 153 noms d'événements ne sont **pas traduits** : les rendre en six langues serait 918 chaînes inventées. `prettifyKey` se contente de les rendre lisibles (`evtPlayerAttackMove` -> `Player Attack Move`) ; le nom brut reste dans l'infobulle et dans la recherche.
- i18n : 14 nouvelles clés (`studio.additional` + 13 `studio.cat.*`) x 6 langues = 84 entrées, symétrie vérifiée.
- Tests : `npx tsc --noEmit` OK. Build release OK (Rust 2 min 37). **Le code de sortie PowerShell 107 d'un build précédent était un faux échec** : `NativeCommandError` de PS 5.1 sur la sortie stderr native, alors que le build avait réussi — se fier au contenu du journal, pas au code de sortie.
- Mise en service par copie directe de `tauri-app.exe` ET `hexgate-backend.exe` (l'installateur NSIS `/S` ne remplace pas l'exe à version identique, gotcha déjà en mémoire). Hashes vérifiés identiques au build.
- **Non vérifié à l'écran** : le client League était fermé au moment du lancement, donc le studio affiche « Client League requis » — comportement correct mais qui ne prouve pas le rendu de la grille. À confirmer par Yaniss client ouvert.
- Fichiers modifiés : `app/src/components/SettingsStudio.tsx` (réécrit), `app/src/components/ToolsView.tsx`, `app/src/lib/i18n.tsx`.

---

# Note Claude — 13/09/2026 (suite) : ergonomie des catégories + vérification à l'écran

- **Défaut d'ergonomie corrigé** : la liste des 160 raccourcis vivait dans un conteneur à ascenseur PROPRE (`max-h-[340px] overflow-y-auto`), imbriqué dans celui de la page. Dans une fenêtre de 600 px, la molette scrollait la liste interne et on ne pouvait plus remonter à la grille — constaté à l'écran, pas supposé. Même problème sur l'éditeur de réglages de jeu (`max-h-[300px]`).
- **Remplacé par des catégories repliables**, fermées par défaut : les 13 catégories tiennent désormais sur un seul écran, et la page n'a plus qu'un seul ascenseur. Une recherche en cours ouvre automatiquement toutes les catégories (`searching` dans `SettingsStudio`) — cacher un résultat de recherche derrière un repli n'aurait aucun sens.
- **Vérifié à l'écran** (contrôle du poste, client League ouvert) :
  - onglet « Outils » présent dans la barre, « Overlay » absent (déplacé dans Réglages) ;
  - grille principale correcte : Q W E R, D F, objets 1 2 3 5 6 7, babiole 4, éclairs dorés (cast rapide actif sur les 14 Quickbinds) ;
  - « TOUS LES AUTRES RACCOURCIS (160) » — total exact attendu (166 GameEvents − 13 de la grille + 5 HUDEvents + 2 ShopEvents) ;
  - les 13 catégories et leurs comptes : pings 11, caméra 7, déplacement 13, communication 18, interface 14, boutique 3, amélioration de sorts 4, cast rapide + auto 28, cast rapide avec indicateur 14, cast rapide 14, auto-cast 14, cast normal 14, divers 6 — somme 160 ;
  - dépliage/repliage fonctionnel (chevron pivoté) ;
  - **capture clavier validée de bout en bout** : clic sur une case puis frappe → la touche s'affiche en or comme modification en attente, le bandeau passe à « Appliquer (1) » ;
  - formatage des liaisons correct sur des valeurs réelles : `G`, `CTRL+BUTTON 1`, `—` pour non assigné ;
  - annulation validée : le bandeau disparaît, **aucune écriture envoyée au client** (confirmé par Yaniss : sa configuration est intacte).
- Plus aucun clignotement ni perte de focus depuis le hissage des composants au niveau module.
- Tests : `npx tsc --noEmit` OK, build release OK (Rust 3 min 34), mise en service par copie directe de l'exe (hash vérifié).
- Fichiers modifiés : `app/src/components/SettingsStudio.tsx`.

---

# Note Claude — 13/09/2026 (suite) : traduction complète des 160 raccourcis

- Demande : « traduis tout, c'est pas utilisable comme ça ». Les noms bruts (`Player Ping Come Here`) étaient effectivement inexploitables dans une interface française.
- **Piste écartée d'abord** : récupérer les libellés officiels de Riot. Le menu montré en référence est celui du JEU, pas du client ; ses chaînes sont empaquetées dans des archives `.wad` (`C:\Riot Games\League of Legends`, aucun `fontconfig*.txt` en clair). Lire un WAD demanderait un extracteur dédié et fragile — abandonné.
- **Approche retenue : composition plutôt qu'énumération.** Sur les 153 raccourcis hors grille, 88 sont des variantes systématiques (`evtSmartCastItem3` = famille « cast rapide » + cible « objet 3 »). Les traduire une par une aurait fait 528 chaînes redondantes. On traduit 7 familles + 5 cibles et on compose : **84 briques au lieu de 153**, terminologie forcément cohérente, et une clé ajoutée par Riot dans une famille connue est traduite sans rien toucher.
- Nouveau module `app/src/lib/hotkeyLabels.ts` — volontairement HORS de `i18n.tsx`, qui n'a pas à porter un dictionnaire aussi gros et aussi spécifique. Expose `hotkeyLabel(key, lang)` renvoyant `null` si inconnu ; l'appelant retombe sur `prettifyKey`, donc un raccourci non traduit reste identifiable au lieu d'afficher du vide.
- Deux pièges d'ordre traités explicitement : les préfixes de familles sont testés du plus long au plus court (sinon `evtSmartCast` avalerait `evtSmartCastWithIndicator`), et les cibles aussi (`AvatarSpell1` ne doit pas être coupé par `Spell`).
- Les 9 emplacements de la roue d'emotes sont numérotés à partir de 0 côté client mais affichés à partir de 1 — c'est ce que voit le joueur.
- La recherche porte désormais sur le libellé TRADUIT autant que sur le nom brut : « ping » en français trouve, `evtPlayerPingOMW` aussi.
- **Couverture vérifiée par script** (`check_labels.mjs`, transpilation grossière du module puis exécution sur les clés réelles du client) : **160/160 raccourcis traduits dans les 6 langues, zéro repli**. Exemples : `evtSmartCastItem3` -> « Cast rapide · Objet 3 » (fr) / « Schnellwirken · Gegenstand 3 » (de) ; `evtRadialEmotePlaySlot0` -> « Roue d'emotes : emplacement 1 ».
- **Réserve** : ces traductions suivent la terminologie usuelle de League, elles ne sont pas extraites des fichiers officiels. Un libellé qui jurerait avec celui du client est à corriger dans `hotkeyLabels.ts`.
- Tests : `npx tsc --noEmit` OK, build release OK (Rust 2 min 40), mise en service par copie directe (hash vérifié), app relancée avec sidecar `hexgate-backend`.
- **Non vérifié à l'écran** : `shellhost.exe` (outil de capture Windows) occupait le premier plan et bloquait le pilotage de l'interface. La couverture est prouvée programmatiquement, mais le rendu des libellés dans la liste reste à confirmer de visu par Yaniss.
- Fichiers créés : `app/src/lib/hotkeyLabels.ts`. Modifiés : `app/src/components/SettingsStudio.tsx`.

---

# Note Claude — 13/09/2026 (suite) : compte VALORANT connecté injouable depuis Hexgate

- **Bug signalé** : sur la carte VALORANT d'un compte déjà connecté, le badge « CONNECTÉ » remplaçait entièrement le bouton d'action — plus aucun moyen de relancer le jeu depuis Hexgate, alors que la carte League, elle, garde toujours un bouton de lancement dans ce cas.
- **Cause** : `ValorantAccountCard.tsx` rendait un `<span>` inerte quand `connected` est vrai (ligne ~64), sans branche de repli.
- **Correctif, en deux temps** :
  1. Nouvelle route backend `POST /product/launch` (`server.py`), qui appelle `process.launch_product(product)` — la fonction existante qui démarre `RiotClientServices.exe --launch-product=... --launch-patchline=live` **sans toucher aux sessions**. Volontairement distincte du swap : le swap tue le client Riot en cours pour restaurer une session, ce qui serait absurde et destructeur pour un compte déjà connecté avec la bonne session active.
  2. `ValorantAccountCard` garde désormais le badge « CONNECTÉ » ET affiche un bouton « JOUER À VALORANT » en dessous, qui appelle un nouveau handler `onLaunch` (distinct de `onPlay`, qui reste le chemin swap pour les comptes non actifs).
- `App.tsx` : nouveau `launchValorant()`, qui appelle `api.launchProduct("valorant")` directement si aucun jeu Riot n'est en cours, ou demande confirmation (`val.strongTitle`/`val.strongDesc`, déjà existants) si un jeu Riot tourne — même garde-fou que le chemin swap.
- i18n : une seule nouvelle clé, `val.launching` (toast de confirmation), x 6 langues.
- Tests : `py_compile` OK, `npx tsc --noEmit` OK. Route testée en isolation sur un port de secours (8799) : `POST /product/launch {"product":"nimportequoi"}` → 400 (validation confirmée). Build release OK (Rust 3 min 27), mise en service par copie directe (hash vérifié), app relancée avec sidecar `hexgate-backend`.
- **Non testé en conditions réelles** : le lancement effectif de VALORANT depuis le bouton, faute de compte connecté disponible pendant la session de correction. Le chemin `launch_product("valorant")` est le même code déjà utilisé ailleurs dans le projet (reconnexion), donc à faible risque, mais reste à confirmer par Yaniss au prochain lancement.
- Fichiers modifiés : `backend/switcher/server.py`, `app/src/lib/api.ts`, `app/src/lib/i18n.tsx`, `app/src/components/ValorantAccountCard.tsx`, `app/src/App.tsx`.
- Aucun processus Riot/League/VALORANT lancé, arrêté ou manipulé pendant la correction (client fermé pendant tout le développement).

## 14/09/2026 — Écrasement silencieux d'un compte par un autre (perte de données) + cache ETag

### 1. Incident : « FREEPALESTINE#M280 » écrasé par les données de « OnlyNocturne#GOAT »

**Symptôme rapporté** : un compte semblait dupliqué dans la liste et avoir écrasé `FREEPALESTINE#M280`.
Il ne s'agissait pas d'une duplication : la fiche de FreePALESTINE affichait les données d'OnlyNocturne
(même riot_id, même niveau 71, même icône 7185, même rang SILVER), d'où l'impression de doublon.

**Cause racine** — `rank_watch.RankWatcher._tick()` :
```python
name = vault.get_active()              # le compte "actif" selon state.json
summoner = lcu_api.current_summoner()  # le compte RÉELLEMENT connecté au client
vault.update_profile(name, riot_id=summoner["riot_id"], level=..., rank=..., icon_id=...)
```
Les deux n'étaient **jamais confrontés**. `state.json` n'est qu'un pointeur, mis à jour par le swap ;
dès qu'il dérive (connexion manuelle hors Hexgate, swap interrompu), le watcher écrit les données du
compte connecté dans la fiche du compte actif — **toutes les 120 s**, en écrasant `riot_id` lui-même,
donc de façon auto-entretenue et silencieuse. `core.update_active_profile()` a le même motif.

Champs détruits (ceux que touche `update_profile`) : `riot_id`, `level`, `icon_id`, `rank`, `lp_delta`,
+ un point aberrant ajouté à `rank_history`. Épargnés : `wallet`, `valorant`, `identity`, `champ_select`.
Les fichiers de session (`league_client.bin`, `riot_client.bin`) n'ont **pas** été touchés.

**Aggravant** : `meta.json.bak` était identique au fichier corrompu — la rotation `.bak` n'a offert
aucune protection. Seul le ZIP de démarrage (`local_backup`, `%LOCALAPPDATA%\LoLSwitcher\backups\`)
a permis la récupération.

**Restauration effectuée** (diff champ par champ préalable : aucune donnée légitime perdue) :
1. `state.json` → `active_account = "OnlyNocturne#GOAT"` (le compte réellement connecté) pour stopper
   la réécriture immédiatement, sans fermer l'app ;
2. `meta.json` + `.bak` restaurés depuis `hexgate_accounts_20260914_083235_665890.zip` ;
3. état corrompu archivé avant écrasement (scratchpad) ;
4. vérifié stable ~7 min avec l'app en marche (3 tics de watcher, aucune réécriture).

**Correctif** — garde-fou d'identité dans le point de passage unique des écritures :
- `lcu_api.current_summoner()` remonte désormais le `puuid` (identifiant stable, insensible au
  renommage Riot) ;
- `vault.update_profile(..., puuid=...)` refuse l'écriture si l'identité ne correspond pas :
  `puuid` fait foi des deux côtés ; à défaut (fiches créées avant), repli sur le `riot_id`. Le `puuid`
  est enregistré à la première synchronisation réussie. Refus tracé en `warning` dans applog ;
- `rank_watch._tick()` sort proprement si le compte connecté ≠ compte actif (évite en prime d'annoncer
  « Victoire sur X » sous le mauvais nom) ;
- `core.update_active_profile()` transmet le `puuid`.

Arbitrage assumé : en l'absence de `puuid` connu, un renommage Riot est refusé (rattrapé au swap
suivant) plutôt que de risquer un écrasement — le coût des deux erreurs n'est pas comparable.

Tests (coffre jetable, le vrai `%LOCALAPPDATA%` n'est jamais touché) : écriture croisée du bug bloquée,
1re synchro d'un compte neuf OK, synchro normale OK, renommage Riot à `puuid` identique accepté,
`puuid` différent bloqué. 5/5.

**⚠️ Non déployé** : correctif en source uniquement. L'instance installée tourne toujours l'ancien
sidecar — la protection ne sera active qu'après rebuild + remplacement des binaires (app à fermer).
En attendant, la correction de `state.json` suffit à empêcher la récidive tant que le pointeur ne
dérive pas à nouveau.

**Piste non traitée** : rien ne resynchronise `state.json` quand l'utilisateur se connecte
manuellement hors Hexgate. Le garde-fou rend cette dérive inoffensive (refus d'écriture) mais l'UI
affichera alors un compte actif erroné. Auto-repointage possible, à décider — impact plus large.

### 2. Cache des images : ETag au lieu de `max-age=86400`

`Handler._image()` renvoyait `Cache-Control: public, max-age=86400`, ce qui a masqué 24 h le badge de
repli des emblèmes de rank côté WebView2 même après correction du bundling (cf. incident du 14/09).
Remplacé par un **ETag** (SHA-1 du contenu réel) + `Cache-Control: no-cache` : revalidation à chaque
chargement, `304 Not Modified` si inchangé — donc zéro octet retransmis, et tout changement d'asset
visible au lancement suivant sans bump manuel de `?v=` ni vidage de cache.

Testé en isolation sur le port 8799 : `200` + ETag + vrai PNG (174 264 o), puis `If-None-Match` → `304`
sans corps. Le `?v=3` de `rankEmblemUrl()` devient redondant mais reste inoffensif (laissé en place).

- Fichiers modifiés : `backend/switcher/vault.py`, `backend/switcher/rank_watch.py`,
  `backend/switcher/lcu_api.py`, `backend/switcher/core.py`, `backend/switcher/server.py`.
- Aucun processus de l'utilisateur arrêté : tests sur port 8799 et coffre jetable uniquement.

### 3. Récidive le 14/09/2026 — la cause réelle était en amont : `swap()` ne vérifie pas QUI s'est connecté

Le correctif du §1 (garde-fou dans `update_profile`) protégeait les **données** mais ne traitait pas
l'origine de la dérive : `state.json` est revenu seul sur `FREEPALESTINE#M280` et la corruption a
recommencé. Analyse de `core.swap()` :

```python
process.kill_riot()
refreshed = vault.refresh_active()   # recopie la session LIVE dans le compte ACTIF
vault.restore(name)
vault.set_active(name)               # marque name actif SANS vérification
_wait_and_launch_product(name, ...)  # ne teste que is_logged_in(), jamais QUI
```

`is_logged_in()` répond « une session RSO existe », **jamais laquelle**. Si le client revient sur un
autre compte (session persistante du client Riot, restauration sans effet), le pointeur ment — et
deux mécanismes détruisent alors des données :
1. le watcher de rang écrase la fiche du compte actif toutes les 120 s (§1) ;
2. au swap **suivant**, `refresh_active()` recopie la session live — donc les **IDENTIFIANTS** d'un
   autre compte — dans le dossier du compte actif. C'est le sens littéral de « un compte s'est
   dupliqué et a écrasé l'autre », et le dégât le plus grave (perte d'accès au compte).

Les `.bin` de FreePALESTINE ont été vérifiés intacts aux deux occurrences (inchangés depuis 08:26) :
le point 2 n'a pas eu le temps de se déclencher, la correction manuelle de `state.json` l'a devancé.

**Correctifs ajoutés :**
- `client_api.current_identity()` → `{'puuid', 'riot_id'}` via `/rso-auth/v1/authorization`
  (`subject` = puuid) + `/player-account/aliases/v1/active`. Fonctionne pour **les deux produits** dès
  l'acceptation RSO, sans dépendre du LCU (spécifique à League et indisponible avant son chargement).
- `core._assert_expected_account(name)`, appelé dans la boucle de `_wait_and_launch_product` dès que
  la session est acceptée : si l'identité connectée contredit le compte demandé → `set_active(None)`
  (un pointeur vide est inoffensif, un pointeur faux détruit) + `WrongAccountLoggedIn` avec un message
  d'explication. Remonte à l'UI via `swap_error` (le `except Exception` de la route swap).
- `vault.refresh_active(expected_identity=...)` : l'identité est relevée **avant** `kill_riot()` (après,
  plus aucune API locale ne peut dire à qui appartient la session live) et confrontée au compte actif ;
  refus + `warning` en cas d'écart. Appliqué à `swap()` et `prepare_new_login()`.
- `vault.account_puuid(name)` : helper de lecture du puuid enregistré.

Règle commune aux trois garde-fous : le `puuid` fait foi ; à défaut le `riot_id` ; si aucune référence
n'est connue (fiche neuve), on laisse passer — sinon un compte neuf ne pourrait jamais se synchroniser.

**Mise en service** : seul du Python ayant changé, pas de rebuild Rust — sidecar reconstruit
(`tools/build-sidecar.ps1`) et `hexgate-backend.exe` remplacé dans `%LOCALAPPDATA%\Hexgate Swap\`,
**remplacement confirmé par hash** (E3B4D768… → 3326EAAC…). App relancée ; présence des en-têtes
`ETag`/`no-cache` sur `/assets/ranks/*` = preuve que le nouveau binaire tourne bien.

**Vérification de bout en bout** (ce qui manquait au premier correctif) : condition du bug recréée
volontairement — `state.json` forcé sur `FREEPALESTINE#M280` alors que le client est connecté en
`OnlyNocturne#GOAT` — puis observation sur un cycle complet du watcher (140 s).

**Reste à faire** : `state.json` n'est toujours resynchronisé par rien quand la connexion change hors
Hexgate. La dérive est désormais inoffensive (toutes les écritures sont refusées) mais l'UI affichera
un compte actif erroné jusqu'au swap suivant. Auto-repointage sur le compte réellement connecté :
faisable via `client_api.current_identity()`, à décider avec Yaniss (impact UI plus large).

### 4. Suite de l'incident : suppression des comptes par l'utilisateur, puis restauration

Vérification du correctif §3, faite sur la condition réelle du bug (`state.json` forcé sur
`FREEPALESTINE#M280`, client connecté en `OnlyNocturne#GOAT`) : **concluante**. Preuve par les logs,
pas par l'absence d'effet — à condition identique, l'ancien binaire écrivait
(`update_profile(FREEPALESTINE#M280) ok` à 09:59:49 et 10:01:29), le nouveau n'écrit plus rien, et la
seconde protection s'est tracée : `re-sauvegarde REFUSÉE sur FREEPALESTINE#M280 — session live de
OnlyNocturne#GOAT`.

Les logs ont aussi révélé une suite non rapportée : à 10:09:36 et 10:09:39, `delete()` a été lancé sur
`FREEPALESTINE#M280` **et** `OnlyNocturne#GOAT` (vraisemblablement pour se débarrasser du faux
doublon), puis à 10:09:53 la session live a été re-sauvegardée sous un nouveau nom, `FREEPALESTINE`
(sans tag). Les deux suppressions ont effacé meta, historiques, réglages **et identifiants**, puis ont
échoué sur `selection_chats` (WinError 5, fichier verrouillé) en laissant un dossier fantôme.

- `FREEPALESTINE#M280` intégralement restauré depuis `hexgate_accounts_20260914_100630_586143.zip`
  (10 fichiers ; `league_client.bin` / `riot_client.bin` vérifiés octet pour octet identiques à la
  référence saine mise de côté en début d'incident).
- Arbitrages tranchés par Yaniss (formulaire) : `OnlyNocturne#GOAT` laissé supprimé ; le nouveau
  `FREEPALESTINE` sans historique supprimé au profit de `#M280` ; pointeur actif remis sur `#M280`.
  Copie de sécurité du dossier `FREEPALESTINE` conservée dans le scratchpad avant suppression.
- État final vérifié par l'API en direct : 2 comptes (`HideIntheShnek#66666`, `FREEPALESTINE#M280`
  GOLD I 36 LP actif), plus aucun doublon.

**Bug mineur confirmé au passage, non corrigé** : `vault.delete()` n'est pas atomique — si un fichier
est verrouillé (typiquement `selection_chats`), les fichiers déjà effacés le restent et un dossier
vide subsiste. Le coffre en contient 7, hérités de suppressions antérieures ; ils sont invisibles dans
l'UI (`list_accounts` ignore les dossiers sans `meta.json`) mais rendent les suppressions
partiellement destructives en cas d'échec. À traiter (suppression dans un dossier temporaire renommé,
ou reprise au prochain démarrage).
