# Passation complète — Hexgate Swap / V2.1

**Date :** 12 septembre 2026  
**Destinataire :** Claude (reprise temporaire du projet)  
**Projet :** `C:\Users\yaniss\hexgate-swap-v2`  
**Nom produit :** Hexgate Swap. Les mentions historiques « Hextech Swap » désignent le même produit.  
**Important :** ne jamais inclure, afficher ou versionner de clé Riot, clé HenrikDev, cookies, sessions Riot, mots de passe ou contenu de fichier `*.bin`.

---

## 1. Résumé exécutif

Hexgate Swap est une application Windows Tauri + React qui permet de conserver plusieurs sessions Riot locales, de basculer entre elles et de démarrer League of Legends ou VALORANT. League est la partie historique, riche en fonctionnalités. VALORANT a été ajouté comme une deuxième expérience, avec les mêmes comptes Riot mais son propre affichage, ses préférences d’épinglage et ses statistiques.

L’état actuel est fonctionnel et a été testé sur des comptes réels locaux :

- sauvegarde/restauration/swap de session Riot modernisé ;
- bascule permanente League / VALORANT dans le header ;
- lancement de VALORANT après swap ;
- écran de transition adapté au produit lancé, avec wordmark officiel local ;
- cartes VALORANT, dashboard et historique de matchs / agents ;
- statistiques VALORANT via HenrikDev, cache local et synchronisation automatique au démarrage ;
- portraits locaux de 29 agents ;
- protection renforcée contre les doubles instances et la corruption des données ;
- build release Tauri v0.2.2 généré et validé le 11/09/2026.

Le point le plus important pour la reprise : **ne pas casser le stockage des comptes**. Il n’y a pas de dépôt Git et les sessions sont des données utilisateur sensibles. Les écritures du coffre sont maintenant atomiques et des sauvegardes ZIP locales tournantes sont créées au démarrage.

---

## 2. Règles de travail non négociables

1. **Dossier actif :** `C:\Users\yaniss\hexgate-swap-v2`.
   - Les anciens dossiers `lol-account-switcher` et `lol-switcher-app` sont obsolètes.
   - Il n’y a pas de dépôt Git. Ne pas lancer `git init` sans accord explicite.
2. **Ne jamais manipuler un processus Riot/League/VALORANT par réflexe.**
   - Si Yaniss est en lobby, matchmaking ou partie, ne pas relancer ni tuer Riot Client / League / VALORANT.
   - Les tests de swap ou de relance doivent être explicitement autorisés.
3. **Ne jamais faire de logout Riot pour changer de compte.** Le logout invalide la session serveur. Utiliser `core.py` / `vault.py`.
4. **Backend stdlib uniquement.** `backend/switcher/` est destiné à un futur packaging PyInstaller ; ne pas ajouter une dépendance Python légère par confort.
5. **Toute chaîne UI est traduite dans 6 langues** : FR, EN, ES, DE, IT, PT. `app/src/lib/i18n.tsx` doit rester symétrique.
6. **Mode streamer :** tout pseudo ou Riot ID affiché doit respecter le flou conditionnel déjà établi.
7. **Overlay League : in-game only strict.** Aucun « mode démo », aucune apparition hors vraie partie. Voir `CLAUDE.md` et `CODEX_ONBOARDING.md`.
8. **VALORANT V2.1 : pas d’overlay et pas d’automatisation de gameplay.** Le périmètre est comptes, lancement, dashboard et statistiques.
9. Après tout travail matériel, mettre à jour `CLAUDE_TRANS.md` et `C:\Users\yaniss\Desktop\Passation NextRank\DOSSIER-CODEX-COMPLET-2026-09-09.md`, sans secret.

---

## 3. Architecture

### Frontend

`app/` : Tauri 2, React 19, TypeScript, Tailwind v4, shadcn/ui, Framer Motion, Lucide et Sonner.

Fichiers importants :

| Fichier | Responsabilité |
|---|---|
| `app/src/App.tsx` | routage des onglets, abonnement SSE, bascule League / VALORANT |
| `app/src/lib/api.ts` | contrat TypeScript et client HTTP vers le backend local |
| `app/src/lib/i18n.tsx` | 6 traductions ; toutes les nouvelles clés doivent exister partout |
| `app/src/components/Header.tsx` | header, sélecteur permanent LoL / VALORANT |
| `app/src/components/AccountCard.tsx` | carte League historique |
| `app/src/components/ValorantAccountCard.tsx` | carte VALORANT |
| `app/src/components/DashboardView.tsx` | dashboard League |
| `app/src/components/ValorantDashboardView.tsx` | dashboard VALORANT actuel |
| `app/src/components/MatchesView.tsx` | matchs League |
| `app/src/components/ValorantMatchesView.tsx` | matchs / agents VALORANT |
| `app/src/components/SwapOverlay.tsx` | transition de swap ; utilise le produit demandé |
| `app/src/components/settings/DataTab.tsx` | configuration locale HenrikDev |

Assets VALORANT locaux :

- logo : `app/public/assets/riot/valorant/valorant.png` ;
- wordmark de transition : `app/public/assets/nextrank/logos/valorant-wordmark.webp` ;
- 29 portraits : `app/public/assets/riot/valorant/agents/`.

Les portraits sont explicitement locaux : ne pas réintroduire de chargement CommunityDragon dans le rendu des cartes. Le repli attendu reste le logo VALORANT local si un agent est inconnu.

### Backend

`backend/switcher/` : Python 3.12, HTTP + SSE maison sur `127.0.0.1:8722`.

| Fichier | Responsabilité |
|---|---|
| `server.py` | endpoints, SSE, watchers, lancement de workers, synchronisation VALORANT |
| `core.py` | orchestration de swap Riot |
| `vault.py` | coffre comptes, sessions DPAPI, métadonnées League et VALORANT |
| `atomic_io.py` | écritures JSON/binaires atomiques et récupération `.bak` |
| `local_backup.py` | archives ZIP tournantes du coffre au démarrage |
| `process.py` | détection produit Riot et lancement League / VALORANT |
| `valorant_api.py` | adaptateur HenrikDev, normalisation des profils et matchs |
| `secure_settings.py` | stockage DPAPI de la clé HenrikDev |
| `settings.py` | réglages JSON globaux, écrits de façon atomique |
| `export_import.py` | export/import chiffré de comptes |
| `riot_api.py` | Riot API League web |
| `lcu_api.py` | League Client Update API via lockfile |

### Tauri natif

`app/src-tauri/` : l’application Tauri démarre le backend Python comme sidecar de développement.

- `src/lib.rs` contient la gestion tray, le sidecar et l’instance unique ;
- `Cargo.toml` inclut désormais `tauri-plugin-single-instance = "2"` ;
- `SWITCHER_DIR` pointe aujourd’hui vers un chemin de développement absolu : `C:\Users\yaniss\hexgate-swap-v2\backend`.

**Dette de distribution importante :** le binaire release actuel s’appuie encore sur `python` et ce chemin absolu. Il n’est donc pas portable tel quel sur une autre machine. Pour une distribution réelle, remplacer par un sidecar packagé (PyInstaller) et des chemins résolus depuis les ressources Tauri.

---

## 4. Stockage local et sécurité des comptes

Emplacement : `%LOCALAPPDATA%\LoLSwitcher\`.

Structure utile :

```text
LoLSwitcher/
  accounts/<nom>/
    meta.json                 # métadonnées non secrètes
    meta.json.bak             # dernière version JSON lisible
    riot_client.bin           # session chiffrée DPAPI
    league_client.bin         # session chiffrée DPAPI, selon disponibilité
    matches.json              # cache League
    game_settings.json        # sauvegarde locale de réglages jeu
  state.json                  # compte actif
  settings.json               # réglages Hexgate
  backups/
    hexgate_accounts_<timestamp>.zip
```

### Renforcement appliqué le 11/09

Le faux écran « Aucun compte enregistré » n’était pas une suppression des comptes : le stockage réel contenait bien les comptes, mais deux instances Tauri et deux backends Python simultanés rendaient l’UI incohérente et pouvaient écrire concurremment.

Correctifs maintenant présents :

1. **Instance Tauri unique**
   - Plugin officiel `tauri-plugin-single-instance` enregistré en premier dans `app/src-tauri/src/lib.rs`.
   - Une seconde ouverture ne démarre ni fenêtre durable ni sidecar : elle restaure/focus la fenêtre existante.
   - Test réalisé : avant = 1 fenêtre, après ouverture d’une seconde = 1 fenêtre ; processus secondaire terminé.

2. **Sidecar seulement pour l’instance primaire**
   - Avant : `spawn_sidecar()` était évalué durant la construction Tauri, donc même un second lancement pouvait démarrer Python.
   - Maintenant : `SidecarState` est initialement vide ; le sidecar est créé dans `setup`, après que le plugin d’instance unique a validé l’application.

3. **Port backend exclusif avant workers**
   - `server.py` utilise `_ExclusiveThreadingHTTPServer` et `SO_EXCLUSIVEADDRUSE` sous Windows.
   - Le port 8722 est acquis avant la sauvegarde de démarrage et avant les threads de synchronisation / watchers.
   - Les watchers `AutoAccepter`, `QueueJoiner`, `RankWatcher` et `GameflowWatcher` ne démarrent plus à l’import Python, mais après l’acquisition du port.
   - Test : un second `python -m switcher.server 8722` échoue avec WinError 10048 avant créer une sauvegarde ou lancer des workers.

4. **Écritures atomiques**
   - `atomic_io.write_bytes()` écrit un fichier temporaire dans le même dossier, flush, `fsync`, puis `os.replace`.
   - `atomic_io.write_json()` crée une copie valide `.bak` avant remplacement.
   - `atomic_io.read_json()` lit le principal ; s’il est illisible, lit `.bak` et répare le principal.
   - `vault.py`, `settings.py` et l’import/export des comptes utilisent ce mécanisme.

5. **Sérialisation des mutations**
   - `vault.py` protège toutes les mutations read-modify-write avec un `threading.RLock` : profil, rang, note, objectifs, état VALORANT, match cache, paramètres de jeu, etc.
   - `settings.py` protège les écritures globales par verrou.
   - Cela évite de perdre un champ League lorsqu’un worker VALORANT, League ou wallet écrit le même `meta.json`.

6. **Sauvegardes ZIP tournantes**
   - `local_backup.create_startup_backup()` est appelé au démarrage réussi du backend, avant les workers.
   - L’archive contient `accounts/**`, `state.json` et `settings.json`.
   - Le ZIP est vérifié avec `testzip()` avant d’être publié.
   - Rétention : 10 archives maximum ; suppression uniquement après création valide d’une nouvelle archive.
   - Les archives ne doivent pas être publiées : elles contiennent les blobs DPAPI, même s’ils ne sont réutilisables que par le profil Windows concerné.

### Tests réalisés sur le coffre

- 3 comptes visibles via l’API locale après l’incident ;
- 6 blobs de session DPAPI réels déchiffrables dans le contexte Windows local ;
- ZIP de backup lisibles ;
- test temporaire de JSON interrompu → restauration via `.bak` ;
- test temporaire de deux mutations concurrentes → note et état VALORANT conservés ;
- test temporaire de rotation → trois archives conservées avec rétention configurée à trois ;
- aucun fichier `.tmp` résiduel ;
- `py_compile`, `npm run build`, `cargo check` et build Tauri validés.

### Conseils de reprise sur le coffre

- Ne jamais remplacer un `meta.json` par `write_text()` direct.
- Ne jamais faire un refactor massif de `vault.py` sans tester un compte réel et une archive ZIP.
- Un ZIP est une récupération manuelle volontaire ; ne pas restaurer automatiquement une archive globale, car cela pourrait ressusciter un compte que l’utilisateur a volontairement supprimé.
- Si l’UI paraît vide, vérifier d’abord `GET http://127.0.0.1:8722/accounts?product=league_of_legends` et le dossier local avant toute modification.

---

## 5. Sauvegarde et swap Riot : évolution réalisée

### Pourquoi le swap s’était cassé

Les mises à jour Riot ont modifié la structure de persistance de session. Les anciennes versions dépendaient surtout de `ssid`. Les versions récentes séparent la connexion Riot et l’authentificateur RSO : `riot-login` peut avoir un champ persistant nul alors que la session est réellement récupérable via `rso-authenticator`.

### Logique désormais appliquée

`vault.has_persistent_session()` accepte :

- les anciens profils avec `ssid` ;
- les profils modernes lorsqu’un bloc `rso-authenticator` contient une valeur non vide, un `refresh_token` et un attribut `persistent: true`.

La capture exige donc une vraie session durable. Cela a corrigé le cas où un compte sauvegardé renvoyait ensuite l’utilisateur vers l’écran Riot de connexion au lieu de restaurer la session.

### Comportement de swap

1. Vérifier / sauvegarder la session active si pertinent.
2. Fermer le client Riot de manière contrôlée par la logique existante.
3. Restaurer les fichiers de session depuis les blobs DPAPI du compte cible.
4. Lancer le produit demandé : `league_of_legends` ou `valorant`.
5. Afficher `SwapOverlay` avec la quatrième étape correcte selon le produit.

Le mot « Lancement de League of Legends » a été rendu conditionnel et remplacé par « Lancement de VALORANT » pour un swap VALORANT. Les wordmarks de transition sont locaux : League et VALORANT, pas de texte générique ni d’URL distante.

---

## 6. VALORANT : décisions produit validées avec Yaniss

Ces décisions sont déjà tranchées et doivent être respectées :

- Le switcher **LoL / VALORANT est permanent dans le header**, près du logo Hexgate.
- Deux boutons avec **logos officiels colorés**, même dimension ; League visible sur fond sombre et rouge Valorant assombri, pas rouge vif.
- Produit par défaut : **League**.
- Les mêmes comptes Riot restent présents dans les deux vues.
- En vue VALORANT, un compte jamais exploité côté VALORANT est affiché comme **nouveau sur VALORANT**, pas supprimé.
- Le compte peut être commun aux deux jeux ; sessions Riot communes, informations et dashboards distincts.
- Le switch de produit dans le header change les cartes avec un fondu.
- En mode VALORANT, les fonctionnalités League non pertinentes n’apparaissent pas.
- Les dashboards sont séparés, les filtres et épingles sont indépendants par jeu, l’ordre de base reste le même.
- Une seule note utilisateur partagée entre les deux jeux.
- Le bouton de lancement conserve le style or ; libellé « Jouer à League » / « Jouer à VALORANT » selon le produit.
- Confirmation de swap uniquement si un matchmaking ou une partie est détecté ; avertissement puis confirmation.
- Pas d’overlay VALORANT pour l’instant.
- Pas de navigation clavier spécifique ; souris classique.
- Le système de tutoriel obligatoire a été abandonné : à l’ajout, le compte est présumé utilisable VALORANT. Si aucune donnée est disponible, l’UI l’explique au lieu de bloquer.
- Le logo officiel de VALORANT doit rester local et visible ; ne pas revenir à un rouge trop lumineux ou à des icônes ambiguës.

---

## 7. VALORANT : implémentation actuelle

### Lancement et statut actif

- `process.py` connaît `league_of_legends` et `valorant`.
- Le lancement utilise les arguments Riot `--launch-product=<product> --launch-patchline=live`.
- `server.py` expose l’activité produit et le frontend marque la carte du compte actif par `CONNECTÉ` au lieu de laisser un faux bouton de jeu.
- Le premier comportement manquant était un oubli, corrigé après test visuel : un compte connecté à VALORANT ne doit pas afficher seulement « JOUER À VALORANT ».

### API HenrikDev et sécurité

- `secure_settings.py` stocke la clé HenrikDev localement via DPAPI Windows. La clé n’est ni dans le dépôt, ni dans `settings.json`, ni dans les exports.
- L’UI de la clé est dans Réglages → Données & comptes (`DataTab.tsx`).
- Endpoint backend de mise à jour et état `henrikdev_configured` dans les réglages.
- Les erreurs normalisées comprennent : clé absente, clé invalide / expirée, profil introuvable, limite atteinte, réseau, réponse invalide.
- Toutes les erreurs d’un compte restent isolées : elles ne doivent jamais empêcher les autres comptes de se synchroniser ou de s’afficher.

### Normalisation des données

`valorant_api.py` :

- résout le compte avec `/valorant/v2/account/<name>/<tag>?force=true` ;
- récupère MMR avec `/valorant/v2/mmr/<region>/<name>/<tag>` quand disponible ;
- récupère l’historique tous modes avec `/valorant/v4/matches/<region>/pc/<name>/<tag>?size=10` ;
- normalise le niveau, rang, RR, titre, matchs, agent, KDA, map, mode, score, résultat et agent principal.

Correction importante : HenrikDev V4 renvoie parfois `player.agent` sous forme d’objet `{id, name}` et les scores par équipes sous forme d’objets `rounds.{won,lost}`. Avant correction, l’UI rendait des objets JSON bruts et des scores manquants. Le normaliseur convertit maintenant :

- agent objet → nom propre (`Phoenix`, `KAY/O`, `Brimstone`, etc.) ;
- rounds équipe → score `N:N` ;
- résultats → victoire / défaite ;
- modes tous modes, dont Swiftplay et Spike Rush.

### Cache et synchronisation

- Les stats normalisées sont stockées dans `meta.json` sous `valorant.stats`, sans réponse brute fournisseur ni clé.
- `server.py` expose `/valorant/refresh` et diffuse les événements SSE `valorant_sync_done` / `valorant_sync_error`.
- Au démarrage, un worker synchronise les comptes ayant un Riot ID si une clé HenrikDev est configurée.
- Les appels sont séquentiels, espacés d’environ 0,4 s, et un seul rafraîchissement UI est émis à la fin.
- L’onglet Matchs & Agents lance également une synchronisation unique si le compte sélectionné n’a pas de cache.
- Le compte `OnlyNocturne#GOAT` a déjà pu remonter `not_found` chez HenrikDev : ce cas est attendu, il ne faut ni masquer le compte ni le considérer comme corrompu.

### UI VALORANT existante

1. **Cartes de compte (`ValorantAccountCard.tsx`)**
   - Riot ID, badge VAL, état, bouton de jeu, épingle, niveau et informations disponibles.
   - Carte connectée mise en évidence.
   - Repli propre quand aucun historique/rang n’est encore synchronisé.

2. **Dashboard (`ValorantDashboardView.tsx`)**
   - compte actif / sélectionné ;
   - niveau ;
   - rang quand HenrikDev le fournit ;
   - agent principal ;
   - bilan victoire/défaite sur les matchs cache ;
   - synchronisation manuelle et message de données indisponibles.

3. **Matchs & Agents (`ValorantMatchesView.tsx`)**
   - onglets par compte ;
   - liste de matchs, agent, KDA, carte, mode, date, résultat, score ;
   - portraits d’agents locaux à gauche ;
   - résumé agents / top agent existant.

4. **Transition de swap (`SwapOverlay.tsx`)**
   - dernière étape et wordmark adaptés au produit lancé ;
   - le texte League affiché durant un lancement VALORANT a été corrigé deux fois : vérifier que toute future refonte conserve la condition `product === "valorant"`.

---

## 8. Changements UI / assets réalisés pendant cette reprise

- Inspection de l’UI initiale et propositions fonctionnelles pour l’évolution du produit.
- Correction d’une image « Arena » cassée, puis migration vers des assets locaux.
- Retour utilisateur : les premières icônes locales n’étaient plus les icônes historiques attendues. Ne pas remplacer arbitrairement la direction visuelle sous prétexte de local caching ; conserver les assets choisis par le produit.
- Ajout du sélecteur League / VALORANT permanent dans le header, avec logos officiels et fond rouge Valorant assombri pour que le logo reste lisible.
- Ajout des wordmarks locaux League / VALORANT pour la transition de swap, à la place du simple texte produit.
- Correction du texte dynamique de lancement selon le produit.
- Correction de l’état connecté VALORANT sur les cartes.
- Téléchargement local de 29 portraits d’agents ; Vite a brièvement eu un `EBUSY` pendant ce téléchargement et les portraits ne s’affichaient pas tant que le serveur dev n’était pas relancé. Les URLs locales ont ensuite été vérifiées en HTTP (`200 image/png`).
- Correction des données brutes d’agents et de scores HenrikDev V4 décrite ci-dessus.

---

## 9. Build, commandes et artefacts

### Commandes

```powershell
# App complète de développement — depuis app/
npm run tauri dev

# Frontend seulement
npm run build
npx tsc --noEmit

# Vérifier le Rust Tauri
cd src-tauri
cargo check --quiet

# Build release complet (frontend + exe + MSI + NSIS)
cd app
npm run tauri build
```

Le backend manuel est possible uniquement si aucun sidecar Tauri ne tourne :

```powershell
# depuis C:\Users\yaniss\hexgate-swap-v2
python -m backend.switcher.server
```

Depuis le renforcement, s’il existe déjà un backend, un second lancement échoue immédiatement sur le port 8722. C’est voulu et sain.

### Build validé

Le 11/09/2026, `npm run tauri build` a terminé avec code 0 :

- TypeScript + Vite réussis ;
- Rust release réussi ;
- bundle MSI WiX généré ;
- setup NSIS généré.

Artefacts :

- `app/src-tauri/target/release/tauri-app.exe`
- `app/src-tauri/target/release/bundle/msi/Hexgate Swap_0.2.2_x64_en-US.msi`
- `app/src-tauri/target/release/bundle/nsis/Hexgate Swap_0.2.2_x64-setup.exe`

**Attention :** ce build est techniquement réussi mais pas encore réellement distribuable à une autre machine à cause du chemin absolu backend / Python décrit plus haut. Le setup ne doit pas être considéré comme un installateur portable final.

---

## 10. État League historique et dettes à ne pas oublier

League dispose déjà de beaucoup de fonctions : comptes, rang/LP, wallet, historique, stats champion, objectifs, routine post-swap, auto-accept, recherche rapide, ping, overlay, insight adversaire, réglages, export/import et chat hors ligne.

Fonctions codées mais qui nécessitent encore des tests e2e réels :

- mode « apparaître hors ligne » vu par un ami ;
- message de fin de partie ;
- champ select réel (intention, pick/ban) ;
- insight adversaire réel en partie ;
- rendu complet des réglages en onglets ;
- correctif affichage LP périmé dans `RankDetailDialog` ;
- performance release / benchmark `tools/bench.ps1`.

Contraintes League déjà connues :

- le LCU peut répondre avant d’être réellement prêt ; les actions lobby doivent attendre et réessayer ;
- la clé Riot dev expire souvent en 24 h ; dégrader vers le cache, jamais vers un écran vide ;
- le Mode Streamer LoL peut anonymiser les Riot IDs ;
- ne pas remettre l’ultime cooldown dans l’overlay ;
- ne pas reproposer Overwolf, retiré définitivement ;
- ne pas réintroduire le mode démonstration overlay.

---

## 11. Plan V2.1 proposé — parité VALORANT / League

But : rapprocher l’expérience VALORANT du confort League, sans inventer de données indisponibles, sans overlay et sans automatisation de gameplay.

### Phase A — comptes et synchronisation (priorité haute)

1. Enrichir les cartes VALORANT : niveau, rang/RR, winrate, agent principal, dernière activité.
2. États explicites et fiables : `Connecté`, `Prêt`, `Nouveau sur VALORANT`, `Session expirée`, `Données indisponibles`.
3. Remplacer le bouton de jeu par `CONNECTÉ` pour le compte actif sur toutes les vues.
4. Synchronisation manuelle par carte avec date de dernière synchronisation.
5. Progression / spinner clair pendant récupération, sans désactiver l’UI entière.
6. Épingle VALORANT indépendante de League, ordre de base partagé.
7. Recherche commune et état vide pédagogique.
8. Confirmation de swap uniquement en matchmaking/en partie, avec avertissement explicite.
9. Réparation de session sans toucher aux données League si une session est rejetée.

### Phase B — dashboard VALORANT riche (priorité haute)

Pour chaque compte :

- niveau de compte ;
- rang actuel, RR et meilleur rang observé localement ;
- victoires, défaites, winrate et série récente ;
- agent le plus joué ;
- meilleur agent par winrate ;
- meilleur agent par KDA ;
- mode le plus joué ;
- carte la plus jouée et meilleure carte ;
- dernier match ;
- date / état de la dernière synchronisation.

Ajouts visuels : portrait local de l’agent principal, activité 7/30 jours, répartition W/L, palette rouge profond/or Hexgate sans rouge agressif.

### Phase C — Matchs & Agents (priorité haute)

- filtres : mode, agent, victoire/défaite, période ;
- recherche par carte ou agent ;
- tri par date, KDA, score, résultat ;
- pagination / chargement progressif si l’historique grossit ;
- détail extensible de match : équipes, manches, durée, agent, KDA ;
- résumé global : matchs, winrate, KDA, agent principal ;
- tableau agents : parties, W/L, winrate, KDA, dernière utilisation, top 3 ;
- continuer d’utiliser les portraits locaux exclusivement.

### Phase D — progression locale et objectifs (priorité moyenne)

- historique local rang/RR à chaque sync ;
- courbe de RR ;
- évolution winrate 7/30 jours ;
- activité par jour ;
- comparaison compétitif / non classé / Swiftplay / Spike Rush ;
- badge de nouveau pic ;
- journal local de swaps, syncs et erreurs ;
- export JSON de l’historique VALORANT ;
- objectifs séparés de League : rang, RR, nombre de matchs, régularité, agent.

### Phase E — réglages et résilience (priorité moyenne)

- option activer/désactiver sync automatique au lancement ;
- nombre de matchs récupérés : 10 / 20 / 50, dans la limite fournisseur ;
- modes inclus dans les statistiques globales ;
- cache local activable ;
- effacement des seules statistiques VALORANT d’un compte, jamais de session Riot / League ;
- réinitialisation état VALORANT ;
- état de santé HenrikDev : clé, rate limit, compte introuvable, dernière réussite ;
- conservation des sauvegardes ZIP actuelles avec les métadonnées VALORANT.

### Explicitement hors V2.1

- overlay VALORANT ;
- lecture d’API privée locale VALORANT ;
- auto-queue, auto-agent, automatisation de partie ;
- actions en jeu ;
- données non fiables sans API officielle.

### Ordre conseillé

1. Phase A : fiabilité perçue et cartes actives.
2. Phase B : dashboard utile.
3. Phase C : filtres, détails, agents.
4. Phase D : progression et objectifs.
5. Phase E : réglages avancés / export.

---

## 12. Checklist avant de modifier V2.1

- [ ] Lire `CODEX_ONBOARDING.md`, `CLAUDE.md`, cette passation et les dernières notes de `CLAUDE_TRANS.md`.
- [ ] Vérifier si Yaniss est en lobby / partie avant toute relance de l’app ou test de swap.
- [ ] Vérifier qu’il n’y a qu’une instance Tauri et un seul backend sur le port 8722.
- [ ] Ne pas imprimer de secrets dans le terminal, les logs ou les documents.
- [ ] Pour toute nouvelle chaîne UI : compléter les 6 langues.
- [ ] Pour toute donnée VALORANT : mettre à jour types backend, `api.ts`, UI et état SSE ensemble.
- [ ] Ne pas régresser le produit League en cachant une fonctionnalité dans le mauvais mode.
- [ ] Tester au minimum `py_compile`, `npx tsc --noEmit`, `npm run build` ; exécuter un test live seulement avec accord utilisateur.
- [ ] Mettre à jour les deux journaux de passation après le travail.

---

## 13. État final observé au moment de cette passation

- Une seule fenêtre Hexgate et un seul sidecar backend étaient actifs après le correctif d’instance unique.
- L’API locale renvoyait les trois comptes League attendus après l’incident d’UI vide.
- Les archives locales existaient et étaient valides.
- Les données VALORANT de plusieurs comptes avaient été récupérées ; un compte pouvait rester `not_found` chez HenrikDev sans bloquer les autres.
- Le dernier build complet release a réussi le 11/09/2026.
- Le 12/09/2026, Yaniss a demandé une passation détaillée pour qu’un autre agent reprenne temporairement le projet.
- Le 12/09/2026 (suite), Yaniss a demandé de coder directement les 4 optimisations retenues en §14 plutôt que de les laisser en plan. Les quatre sont codées et vérifiées (`py_compile`, `cargo check` ×2, `npx tsc --noEmit`, build release complet `npm run tauri build` réussi avec sidecar packagé). Deux points restent en attente d'accord utilisateur avant d'être considérés clos : la suppression des 29 PNG d'origine (Optim 3, bloquée par le classificateur de permissions) et un test de lancement live du binaire release packagé sur une machine sans backend actif (Optim 1, non tenté pour ne pas interférer avec la session dev de Yaniss en cours).

Cette passation doit être mise à jour à la fin de chaque lot V2.1 significatif.

---

## 14. Optimisations — validées et codées le 12/09/2026

Ces optimisations transversales complètent le plan V2.1 (§11). Chacune a été validée individuellement avec Yaniss, puis **implémentée le jour même** (pas seulement planifiée). Statut détaillé par optimisation ci-dessous ; état global :

| # | Optimisation | Statut |
|---|---|---|
| 1 | Distribution portable (sidecar PyInstaller) | ✅ Codée, build release validé |
| 2 | Résilience synchro HenrikDev | ✅ Codée, `py_compile` validé |
| 3 | Poids des portraits (WebP + lazy) | ✅ Codée ; **PNG d'origine non supprimés, en attente d'accord utilisateur** |
| 4 | Journal backend rotatif sans secret | ✅ Codée, `py_compile` validé |
| 5 | Verrou par-compte (coffre) | ❌ Écartée, ne pas reproposer |

### Optim 1 — Distribution portable (priorité haute) — ✅ codée

**Problème :** le build release s’appuie encore sur `python` et sur le chemin absolu `SWITCHER_DIR = C:\Users\yaniss\hexgate-swap-v2\backend` (§3, §9). Le MSI/NSIS v0.2.2 n’est donc **pas installable tel quel sur une autre machine**. C’est le seul vrai blocage à une distribution réelle.

**Actions :**

- Empaqueter `backend/switcher/` en sidecar autonome (PyInstaller), sans dépendre d’un `python` système. Respecter la contrainte stdlib uniquement (§2.4) — le sidecar reste sans dépendance tierce.
- Résoudre le chemin du backend depuis les **ressources Tauri** (répertoire de l’exe / ressources embarquées), plus aucun chemin absolu machine-spécifique.
- Enregistrer le sidecar packagé dans la config Tauri et vérifier le démarrage sur une machine vierge (ou un profil Windows différent).
- Conserver le mode dev actuel (`python -m backend.switcher.server`) comme chemin de développement, distinct du chemin release.

**Fait quand :** le setup installé sur une machine sans Python démarre le backend sur `127.0.0.1:8722`, expose `/accounts` et `henrikdev_configured`, et ne référence aucun chemin absolu de dev.

**Implémenté le 12/09/2026 :**

- Nouveau point d'entrée [backend/entry.py](backend/entry.py) (`from switcher.server import run`) dédié au packaging — le chemin dev (`python -m backend.switcher.server`) n'est pas touché.
- Nouveau script [tools/build-sidecar.ps1](tools/build-sidecar.ps1) : empaquette `backend/` en un exécutable autonome via PyInstaller (`--onefile`), nommé et placé selon la convention `externalBin` de Tauri (`app/src-tauri/binaries/hexgate-backend-x86_64-pc-windows-msvc.exe`).
- `app/src-tauri/tauri.conf.json` : ajout de `bundle.externalBin: ["binaries/hexgate-backend"]` et `beforeBuildCommand` étendu à `npm run sidecar:build && npm run build` — `npm run tauri build` régénère désormais le sidecar automatiquement, plus d'étape manuelle oubliable.
- `app/package.json` : nouveau script `sidecar:build`.
- `app/src-tauri/Cargo.toml` : ajout de la dépendance `tauri-plugin-shell = "2"` (nécessaire pour résoudre/lancer un sidecar déclaré).
- `app/src-tauri/src/lib.rs` : `spawn_sidecar()` a désormais deux implémentations conditionnelles au `cfg(debug_assertions)` — en dev, comportement inchangé (`python -m switcher.server` + `SWITCHER_DIR` absolu) ; en release, `app.shell().sidecar("hexgate-backend")` résout et lance le binaire packagé via les ressources Tauri, sans aucun chemin machine codé en dur. `SidecarChild` (enum) et `kill_sidecar()` gèrent les deux types de handle (process natif vs sidecar plugin) de façon uniforme.
- PyInstaller a été installé (`pip install pyinstaller`) comme **outil de build uniquement** — le backend runtime reste stdlib (§2.4), aucune dépendance tierce n'est ajoutée à `switcher/`.

**Vérifications faites :**

- `cargo check` et `cargo check --release` : zéro warning, zéro erreur, sur les deux configurations.
- Sidecar packagé exécuté seul (`hexgate-backend-x86_64-pc-windows-msvc.exe 8722`) pendant qu'un backend dev tournait déjà sur ce port : import correct du package `switcher`, tentative de bind, échec propre et attendu (`WinError 10048`), aucune écriture au coffre, aucun processus Riot touché — comportement identique au cas « second backend » déjà documenté en §4.
- `npm run tauri build` exécuté de bout en bout avec succès : régénération du sidecar, build frontend, compilation Rust release, MSI et NSIS produits. `hexgate-backend.exe` a bien été copié par Tauri à côté de `tauri-app.exe` dans `target/release/`, confirmant que la résolution `externalBin` fonctionne.
- **Non fait, volontairement** : lancer l'exécutable release complet (fenêtre + tous les workers) en parallèle du backend dev déjà actif de Yaniss n'a pas été tenté, pour ne pas risquer une double activité de workers (auto-accept, queue-joiner) pendant une session réelle. Un test de lancement live sur une machine sans backend actif reste à faire avec l'accord de Yaniss avant de considérer la distribution comme définitivement validée en conditions réelles.

### Optim 2 — Résilience de la synchronisation HenrikDev (priorité haute) — ✅ codée

**Problème :** la synchro de démarrage est strictement séquentielle (~0,4 s d’espacement) et l’erreur « limite atteinte » est normalisée mais sans stratégie de reprise (§7). Rien ne mémorise la fraîcheur par compte, donc chaque démarrage resynchronise tout.

**Actions :**

- **Backoff** sur rate-limit (429) : attente croissante + reprise, sans jamais bloquer les autres comptes (l’isolation d’erreur par compte reste la règle).
- **Horodatage de dernière synchro réussie** persistant par compte (dans `meta.json` sous `valorant`, sans réponse brute ni clé).
- **Synchro incrémentale** : ne pas resynchroniser au démarrage un compte déjà à jour dans une fenêtre de fraîcheur configurable ; rafraîchissement manuel par carte toujours possible (rejoint Phase A/E).
- Alimenter l’**état de santé HenrikDev** prévu en Phase E (clé, rate-limit, dernier succès, compte introuvable) avec ces horodatages.

**Fait quand :** un démarrage n’émet plus d’appels HenrikDev pour les comptes récemment synchronisés, un 429 déclenche un backoff visible dans l’état de santé, et le cas `not_found` (ex. `OnlyNocturne#GOAT`) reste géré sans blocage.

**Implémenté le 12/09/2026 :**

- [backend/switcher/valorant_api.py](backend/switcher/valorant_api.py) : `_request()` retente désormais un 429 jusqu'à 2 fois avec un backoff (2 s puis 5 s) avant de lever `rate_limited` — une limite touche tout appelant, ce n'est pas propre à un compte, donc inutile de l'escalader dès le premier coup.
- [backend/switcher/server.py](backend/switcher/server.py) : `start_valorant_pre_fetch()` (synchro de démarrage) saute désormais un compte dont `stats.last_synced` date de moins de 15 minutes (`_VALORANT_STARTUP_FRESHNESS`), distinct du cooldown de 90 s déjà en place pour le rafraîchissement manuel par carte (`_VALORANT_SYNC_COOLDOWN`, endpoint `/valorant/refresh` inchangé — toujours disponible sans attendre 15 min). L'horodatage `last_synced` existait déjà dans le cache par compte (`valorant.stats.last_synced`) ; aucune nouvelle persistance nécessaire.
- Le résumé de fin de synchro logge désormais aussi le nombre de comptes ignorés car déjà à jour (`skipped`), en plus des réussites/échecs.

**Vérifications faites :** `python -m py_compile` sur les deux fichiers modifiés (OK) ; relecture du chemin manuel `/valorant/refresh` pour confirmer qu'il n'est pas affecté par la fenêtre de fraîcheur de démarrage. Pas de test live HenrikDev effectué (nécessiterait de forcer un vrai 429, non reproductible sans dépasser la limite réelle du compte).

### Optim 3 — Poids des portraits d’agents (priorité haute) — ✅ codée

**Problème :** les 29 portraits locaux pèsent ~12,4 Mo (§8), embarqués dans le bundle.

**Actions :**

- Compresser les portraits en **WebP** (ou PNG optimisés) sans dégradation visible, en conservant les **assets locaux** et la direction visuelle choisie par le produit (§8, §2.6) — pas de retour à CommunityDragon ni changement d’icônes.
- **Chargement paresseux** des portraits dans les listes de matchs / tableaux d’agents pour réduire l’empreinte mémoire et le temps de premier rendu.
- Garder le **repli** actuel sur le logo VALORANT local si un portrait manque.

**Fait quand :** le poids des assets d’agents est nettement réduit, les portraits restent servis en `200 image/*` localement, et le repli logo fonctionne toujours pour un agent inconnu.

**Implémenté le 12/09/2026 :**

- Les 29 portraits ont été reconvertis en WebP (Pillow, qualité 82, RGBA préservé) dans `app/public/assets/riot/valorant/agents/` : poids total **12 465 112 → 1 879 950 octets (-85 %)**, sans changement visuel perceptible ni changement de direction visuelle.
- [ValorantMatchesView.tsx](app/src/components/ValorantMatchesView.tsx) : `agentIcon()` pointe désormais vers `.webp` ; l'`<img>` de chaque portrait de match a `loading="lazy"` et `decoding="async"` ; le repli sur `/assets/riot/valorant/valorant.png` en cas d'erreur de chargement est inchangé.

**⚠️ Action en attente d'accord utilisateur :** les 29 PNG d'origine (12,4 Mo, désormais redondants) **n'ont pas été supprimés** — la suppression en masse a été bloquée par le classificateur de permissions de la session (action destructive groupée). Yaniss doit confirmer explicitement avant suppression, ou la faire lui-même :

```powershell
Remove-Item "app/public/assets/riot/valorant/agents/*.png" -Force
```

**Vérifications faites :** `npx tsc --noEmit` (OK) après le changement de composant. Pas de vérification visuelle live du rendu (nécessiterait de démarrer le serveur dev, non fait pour ne pas interférer avec l'instance déjà active de Yaniss).

### Optim 4 — Journalisation backend rotative sans secret (priorité haute) — ✅ codée

**Problème :** les incidents de concurrence déjà rencontrés (écran « aucun compte enregistré », doubles instances/sidecars) ont été diagnostiqués à la main. Aucune trace persistante n’aide à comprendre un incident après coup.

**Actions :**

- Journal **rotatif** côté backend (démarrage, acquisition exclusive du port 8722, démarrage des workers/watchers, mutations coffre, erreurs de synchro), avec rétention bornée.
- **Aucun secret** dans les logs : jamais de clé HenrikDev, session Riot, cookie, mot de passe ni contenu de blob DPAPI (§2, checklist §12).
- Emplacement local cohérent avec le stockage (`%LOCALAPPDATA%\LoLSwitcher\`), exclu des sauvegardes publiables.

**Fait quand :** un incident de démarrage ou de synchro laisse une trace exploitable, et une inspection du journal confirme l’absence totale de secret.

**Implémenté le 12/09/2026 :**

- Nouveau module [backend/switcher/applog.py](backend/switcher/applog.py) : logger rotatif (`RotatingFileHandler`, 5 fichiers de 1 Mo max) écrivant dans `%LOCALAPPDATA%\LoLSwitcher\logs\hexgate.log`. Dégrade vers un `NullHandler` silencieux si le dossier est inaccessible plutôt que de bloquer le démarrage. Docstring rappelant explicitement l'interdiction absolue de logger clé/session/cookie/mot de passe/blob DPAPI.
- [backend/switcher/vault.py](backend/switcher/vault.py) : le décorateur `_serialized_write` (déjà présent, protège toutes les mutations du coffre) logge désormais chaque mutation — **uniquement le nom de la fonction et le nom de compte** (premier argument positionnel), jamais les `kwargs` qui peuvent porter des statistiques ou données de session. Succès en `info`, échec en `warning` avec le message d'exception.
- [backend/switcher/server.py](backend/switcher/server.py) : traces ajoutées à l'acquisition du port 8722 (tentative/succès/échec), à la création de la sauvegarde de démarrage, au démarrage des quatre workers (auto-accept, queue-joiner, rank-watcher, gameflow-watcher), et au résumé de la synchro VALORANT de démarrage (réussies/échecs/déjà à jour). Les `print(..., flush=True)` existants ne sont pas retirés — le journal fichier vient en complément, pas en remplacement.

**Vérifications faites :** `python -m py_compile` sur les trois fichiers (OK) ; relecture manuelle de chaque appel de log pour confirmer qu'aucun ne reçoit un objet de session, une clé ou des kwargs bruts — seulement des chaînes/nombres non sensibles (nom de compte, nom de fonction, code d'erreur, compteurs).

### Écartée explicitement — ne pas reproposer

- **Verrou par-compte à la place du RLock global du coffre** (§4.5) : décision du 12/09/2026 de **ne pas l’intégrer**. Le gain de concurrence est marginal pour un usage local mono-utilisateur avec peu de comptes, et le risque ajouté sur du code de coffre sensible n’est pas justifié. Le `threading.RLock` global reste la référence. Ne pas reproposer sans nouvelle demande explicite.

### Ordre conseillé des optimisations

1. **Optim 1** (distribution) — débloque toute diffusion réelle.
2. **Optim 2** (résilience HenrikDev) — fiabilité perçue au quotidien.
3. **Optim 4** (logs) — sécurise les diagnostics des prochains lots.
4. **Optim 3** (poids assets) — gain de confort, non bloquant.
