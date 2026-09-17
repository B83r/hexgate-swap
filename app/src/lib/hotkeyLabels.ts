import type { Lang } from "./i18n";

/** Libellés traduits des raccourcis League.
 *
 * Séparé de `i18n.tsx` volontairement : ce dictionnaire est gros, très
 * spécifique, et n'a rien à faire au milieu des chaînes d'interface.
 *
 * **Pourquoi composer plutôt que tout lister.** Le client expose 166 raccourcis,
 * mais 88 d'entre eux sont des variantes systématiques : `evtSmartCastItem3`
 * = famille « cast rapide » + cible « objet 3 ». Traduire les 88 une par une
 * ferait 528 chaînes à maintenir, toutes redondantes. On traduit donc 7
 * familles et 5 cibles, et on compose. Résultat : 84 briques au lieu de 153,
 * une terminologie forcément cohérente, et une clé ajoutée par Riot dans une
 * famille connue est traduite sans rien toucher.
 *
 * Les traductions viennent de la terminologie usuelle de League dans chaque
 * langue. Elles ne sont PAS extraites des fichiers officiels du jeu : ceux-ci
 * sont empaquetés dans des archives `.wad` qu'on ne sait pas lire ici. À
 * corriger si un libellé jure avec celui du client.
 */

const ORDER: Lang[] = ["fr", "en", "es", "de", "it", "pt"];
type T6 = readonly [string, string, string, string, string, string];

/** Replie sur l'anglais si la langue est inconnue — jamais sur une clé brute. */
function pick(tuple: T6, lang: Lang): string {
  const index = ORDER.indexOf(lang);
  return index >= 0 ? tuple[index] : tuple[1];
}

/** Raccourcis dont le nom ne se décompose pas. */
const STANDALONE: Record<string, T6> = {
  // --- Pings ---------------------------------------------------------------
  evntPlayerPing: ["Ping", "Ping", "Ping", "Ping", "Ping", "Ping"],
  evntPlayerPingCursor: [
    "Ping au curseur", "Ping at cursor", "Ping en el cursor",
    "Ping auf Cursor", "Ping sul cursore", "Ping no cursor",
  ],
  evntPlayerPingDanger: [
    "Ping danger", "Danger ping", "Ping de peligro",
    "Gefahren-Ping", "Ping di pericolo", "Ping de perigo",
  ],
  evntPlayerPingCursorDanger: [
    "Ping danger au curseur", "Danger ping at cursor", "Ping de peligro en el cursor",
    "Gefahren-Ping auf Cursor", "Ping di pericolo sul cursore", "Ping de perigo no cursor",
  ],
  evtPlayerPingAllIn: [
    "Ping : tout donner", "Ping: all in", "Ping: a por todas",
    "Ping: Alles oder nichts", "Ping: all in", "Ping: tudo ou nada",
  ],
  evtPlayerPingComeHere: [
    "Ping : viens ici", "Ping: come here", "Ping: ven aquí",
    "Ping: Komm her", "Ping: vieni qui", "Ping: vem cá",
  ],
  evtPlayerPingMIA: [
    "Ping : ennemi disparu", "Ping: enemy missing", "Ping: enemigo desaparecido",
    "Ping: Gegner vermisst", "Ping: nemico scomparso", "Ping: inimigo desaparecido",
  ],
  evtPlayerPingOMW: [
    "Ping : j'arrive", "Ping: on my way", "Ping: voy en camino",
    "Ping: Bin unterwegs", "Ping: sto arrivando", "Ping: a caminho",
  ],
  evtPlayerPingPush: [
    "Ping : pousser", "Ping: push", "Ping: empujar",
    "Ping: Pushen", "Ping: spingere", "Ping: pressionar",
  ],
  evtPlayerPingRadialDanger: [
    "Roue de pings : danger", "Ping wheel: danger", "Rueda de pings: peligro",
    "Ping-Rad: Gefahr", "Ruota ping: pericolo", "Roda de pings: perigo",
  ],
  evtPlayerPingVisionNeeded: [
    "Ping : vision requise", "Ping: vision needed", "Ping: falta visión",
    "Ping: Sicht benötigt", "Ping: serve visione", "Ping: falta visão",
  ],

  // --- Caméra --------------------------------------------------------------
  evtCameraLockToggle: [
    "Verrouiller la caméra", "Toggle camera lock", "Bloquear la cámara",
    "Kamera fixieren", "Blocca la telecamera", "Bloquear a câmara",
  ],
  evtCameraSnap: [
    "Recentrer la caméra", "Center camera", "Centrar la cámara",
    "Kamera zentrieren", "Centra la telecamera", "Centrar a câmara",
  ],
  evtDragScrollLock: [
    "Défilement par glisser", "Drag scroll lock", "Desplazamiento por arrastre",
    "Ziehen zum Scrollen", "Scorrimento con trascinamento", "Deslocação por arrasto",
  ],
  evtScrollUp: [
    "Défiler vers le haut", "Scroll up", "Desplazar arriba",
    "Nach oben scrollen", "Scorri in alto", "Deslocar para cima",
  ],
  evtScrollDown: [
    "Défiler vers le bas", "Scroll down", "Desplazar abajo",
    "Nach unten scrollen", "Scorri in basso", "Deslocar para baixo",
  ],
  evtScrollLeft: [
    "Défiler vers la gauche", "Scroll left", "Desplazar izquierda",
    "Nach links scrollen", "Scorri a sinistra", "Deslocar para a esquerda",
  ],
  evtScrollRight: [
    "Défiler vers la droite", "Scroll right", "Desplazar derecha",
    "Nach rechts scrollen", "Scorri a destra", "Deslocar para a direita",
  ],
  evtOnUIMouse4Pan: [
    "Déplacer la caméra (bouton 4)", "Pan camera (mouse 4)", "Mover la cámara (botón 4)",
    "Kamera schwenken (Maus 4)", "Sposta la telecamera (tasto 4)", "Mover a câmara (botão 4)",
  ],

  // --- Déplacement et ciblage ---------------------------------------------
  evtPlayerMoveClick: [
    "Se déplacer (clic)", "Move (click)", "Moverse (clic)",
    "Bewegen (Klick)", "Muoversi (clic)", "Mover (clique)",
  ],
  evtPlayerAttackMove: [
    "Attaque-déplacement", "Attack move", "Ataque en movimiento",
    "Angriffsbewegung", "Attacco in movimento", "Ataque em movimento",
  ],
  evtPlayerAttackMoveClick: [
    "Attaque-déplacement (clic)", "Attack move (click)", "Ataque en movimiento (clic)",
    "Angriffsbewegung (Klick)", "Attacco in movimento (clic)", "Ataque em movimento (clique)",
  ],
  evtPlayerAttackOnlyClick: [
    "Attaquer uniquement (clic)", "Attack only (click)", "Solo atacar (clic)",
    "Nur angreifen (Klick)", "Solo attacco (clic)", "Apenas atacar (clique)",
  ],
  evtPlayerHoldPosition: [
    "Tenir la position", "Hold position", "Mantener la posición",
    "Position halten", "Mantieni la posizione", "Manter a posição",
  ],
  evtPlayerStopPosition: [
    "S'arrêter", "Stop", "Detenerse",
    "Anhalten", "Fermarsi", "Parar",
  ],
  evtPetMoveClick: [
    "Déplacer le familier", "Move pet", "Mover la mascota",
    "Begleiter bewegen", "Muovi il famiglio", "Mover o servo",
  ],
  evtChampionOnly: [
    "Cibler les champions uniquement", "Target champions only", "Seleccionar solo campeones",
    "Nur Champions anvisieren", "Bersaglia solo campioni", "Alvejar apenas campeões",
  ],
  evtSelectSelf: [
    "Se sélectionner", "Select self", "Seleccionarse",
    "Sich selbst auswählen", "Seleziona te stesso", "Selecionar-se",
  ],
  evtSelectAlly1: [
    "Sélectionner l'allié 1", "Select ally 1", "Seleccionar aliado 1",
    "Verbündeten 1 auswählen", "Seleziona alleato 1", "Selecionar aliado 1",
  ],
  evtSelectAlly2: [
    "Sélectionner l'allié 2", "Select ally 2", "Seleccionar aliado 2",
    "Verbündeten 2 auswählen", "Seleziona alleato 2", "Selecionar aliado 2",
  ],
  evtSelectAlly3: [
    "Sélectionner l'allié 3", "Select ally 3", "Seleccionar aliado 3",
    "Verbündeten 3 auswählen", "Seleziona alleato 3", "Selecionar aliado 3",
  ],
  evtSelectAlly4: [
    "Sélectionner l'allié 4", "Select ally 4", "Seleccionar aliado 4",
    "Verbündeten 4 auswählen", "Seleziona alleato 4", "Selecionar aliado 4",
  ],

  // --- Communication et emotes --------------------------------------------
  evtChatHistory: [
    "Historique du chat", "Chat history", "Historial del chat",
    "Chatverlauf", "Cronologia chat", "Histórico do chat",
  ],
  evtPushToTalk: [
    "Parler (maintenir)", "Push to talk", "Pulsar para hablar",
    "Sprechtaste", "Premi per parlare", "Premir para falar",
  ],
  evtPushToTalkTeam: [
    "Parler à l'équipe (maintenir)", "Push to talk (team)", "Pulsar para hablar (equipo)",
    "Sprechtaste (Team)", "Premi per parlare (squadra)", "Premir para falar (equipa)",
  ],
  evtEmoteToggle: [
    "Afficher les emotes", "Toggle emotes", "Mostrar emotes",
    "Emotes anzeigen", "Mostra emote", "Mostrar emotes",
  ],
  evtEmoteDance: [
    "Emote : danse", "Emote: dance", "Emote: baile",
    "Emote: Tanz", "Emote: danza", "Emote: dança",
  ],
  evtEmoteJoke: [
    "Emote : blague", "Emote: joke", "Emote: broma",
    "Emote: Witz", "Emote: battuta", "Emote: piada",
  ],
  evtEmoteLaugh: [
    "Emote : rire", "Emote: laugh", "Emote: risa",
    "Emote: Lachen", "Emote: risata", "Emote: riso",
  ],
  evtEmoteTaunt: [
    "Emote : provocation", "Emote: taunt", "Emote: provocación",
    "Emote: Spott", "Emote: provocazione", "Emote: provocação",
  ],
  evtRadialEmoteOpen: [
    "Ouvrir la roue d'emotes", "Open emote wheel", "Abrir la rueda de emotes",
    "Emote-Rad öffnen", "Apri la ruota emote", "Abrir a roda de emotes",
  ],
  evtRadialEmoteInstantOpen: [
    "Roue d'emotes (ouverture directe)", "Emote wheel (instant open)", "Rueda de emotes (apertura directa)",
    "Emote-Rad (sofort öffnen)", "Ruota emote (apertura diretta)", "Roda de emotes (abertura direta)",
  ],
  evtChampMasteryDisplay: [
    "Afficher la maîtrise", "Show mastery", "Mostrar maestría",
    "Meisterschaft anzeigen", "Mostra maestria", "Mostrar maestria",
  ],
  evtReciprocityTrigger: [
    "Réponse rapide : merci", "Quick response: thanks", "Respuesta rápida: gracias",
    "Schnellantwort: Danke", "Risposta rapida: grazie", "Resposta rápida: obrigado",
  ],
  evtReciprocityMyBadTrigger: [
    "Réponse rapide : désolé", "Quick response: my bad", "Respuesta rápida: culpa mía",
    "Schnellantwort: Mein Fehler", "Risposta rapida: colpa mia", "Resposta rápida: culpa minha",
  ],

  // --- Interface -----------------------------------------------------------
  evtSysMenu: [
    "Menu du jeu", "Game menu", "Menú del juego",
    "Spielmenü", "Menu di gioco", "Menu do jogo",
  ],
  evtDrawHud: [
    "Afficher l'interface", "Show HUD", "Mostrar la interfaz",
    "HUD anzeigen", "Mostra l'interfaccia", "Mostrar a interface",
  ],
  evtShowCharacterMenu: [
    "Menu du personnage", "Character menu", "Menú del personaje",
    "Charaktermenü", "Menu del personaggio", "Menu da personagem",
  ],
  evtShowHealthBars: [
    "Barres de vie", "Health bars", "Barras de vida",
    "Lebensbalken", "Barre della vita", "Barras de vida",
  ],
  evtToggleMinionHealthBars: [
    "Barres de vie des sbires", "Minion health bars", "Barras de vida de súbditos",
    "Vasallen-Lebensbalken", "Barre vita dei minion", "Barras de vida dos servos",
  ],
  evtShowScoreBoard: [
    "Tableau des scores", "Scoreboard", "Tabla de puntuación",
    "Punktetafel", "Tabellone", "Tabela de pontuação",
  ],
  evtHoldShowScoreBoard: [
    "Tableau des scores (maintenir)", "Scoreboard (hold)", "Tabla de puntuación (mantener)",
    "Punktetafel (halten)", "Tabellone (tieni premuto)", "Tabela de pontuação (manter)",
  ],
  evtShowSummonerNames: [
    "Noms d'invocateur", "Summoner names", "Nombres de invocador",
    "Beschwörernamen", "Nomi evocatore", "Nomes de invocador",
  ],
  evtShowVoicePanel: [
    "Panneau vocal", "Voice panel", "Panel de voz",
    "Sprachpanel", "Pannello vocale", "Painel de voz",
  ],
  evtTogglePlayerStats: [
    "Statistiques du joueur", "Player stats", "Estadísticas del jugador",
    "Spielerstatistiken", "Statistiche giocatore", "Estatísticas do jogador",
  ],
  evtToggleDeathRecapShowcase: [
    "Récapitulatif de mort", "Death recap", "Resumen de muerte",
    "Todesrückblick", "Riepilogo morte", "Resumo da morte",
  ],
  evtToggleFPSAndLatency: [
    "FPS et latence", "FPS and latency", "FPS y latencia",
    "FPS und Latenz", "FPS e latenza", "FPS e latência",
  ],
  evtToggleMouseClip: [
    "Souris confinée à la fenêtre", "Lock mouse to window", "Ratón limitado a la ventana",
    "Maus im Fenster halten", "Mouse bloccato nella finestra", "Rato preso à janela",
  ],

  // --- Boutique ------------------------------------------------------------
  evtOpenShop: [
    "Ouvrir la boutique", "Open shop", "Abrir la tienda",
    "Shop öffnen", "Apri il negozio", "Abrir a loja",
  ],
  evtShopFocusSearch: [
    "Boutique : rechercher", "Shop: search", "Tienda: buscar",
    "Shop: Suche", "Negozio: cerca", "Loja: procurar",
  ],
  evtShopSwitchTabs: [
    "Boutique : changer d'onglet", "Shop: switch tabs", "Tienda: cambiar pestaña",
    "Shop: Tab wechseln", "Negozio: cambia scheda", "Loja: mudar separador",
  ],

  // --- Divers --------------------------------------------------------------
  evtCastRoleBound: [
    "Lancer le sort de rôle", "Cast role-bound spell", "Lanzar hechizo de rol",
    "Rollenzauber wirken", "Lancia l'abilità di ruolo", "Lançar feitiço de função",
  ],
  evtUseItem7: [
    "Rappel (emplacement 7)", "Recall (slot 7)", "Regresar (ranura 7)",
    "Rückruf (Platz 7)", "Richiamo (slot 7)", "Regressar (espaço 7)",
  ],
};

/* Les neuf emplacements de la roue d'emotes sont numérotés à partir de 0 côté
 * client, mais affichés à partir de 1 : c'est ce que voit le joueur. */
const WHEEL: T6 = [
  "Roue d'emotes : emplacement", "Emote wheel: slot", "Rueda de emotes: ranura",
  "Emote-Rad: Platz", "Ruota emote: slot", "Roda de emotes: espaço",
];
for (let i = 0; i <= 8; i += 1) {
  STANDALONE[`evtRadialEmotePlaySlot${i}`] = WHEEL.map((s) => `${s} ${i + 1}`) as unknown as T6;
}

/** Familles de variantes de lancement. Ordre important : le préfixe le plus
 * long d'abord, sinon `evtSmartCast` avalerait `evtSmartCastWithIndicator`. */
const FAMILIES: { prefix: string; label: T6 }[] = [
  {
    prefix: "evtSmartPlusSelfCastWithIndicator",
    label: [
      "Cast rapide + auto avec indicateur", "Quick cast + self cast with indicator",
      "Lanzamiento rápido + propio con indicador", "Schnellwirken + Selbstwirken mit Indikator",
      "Lancio rapido + su di sé con indicatore", "Lançamento rápido + próprio com indicador",
    ],
  },
  {
    prefix: "evtSmartPlusSelfCast",
    label: [
      "Cast rapide + auto", "Quick cast + self cast", "Lanzamiento rápido + propio",
      "Schnellwirken + Selbstwirken", "Lancio rapido + su di sé", "Lançamento rápido + próprio",
    ],
  },
  {
    prefix: "evtSmartCastWithIndicator",
    label: [
      "Cast rapide avec indicateur", "Quick cast with indicator", "Lanzamiento rápido con indicador",
      "Schnellwirken mit Indikator", "Lancio rapido con indicatore", "Lançamento rápido com indicador",
    ],
  },
  {
    prefix: "evtSmartCast",
    label: [
      "Cast rapide", "Quick cast", "Lanzamiento rápido",
      "Schnellwirken", "Lancio rapido", "Lançamento rápido",
    ],
  },
  {
    prefix: "evtSelfCast",
    label: [
      "Auto-cast", "Self cast", "Lanzamiento sobre uno mismo",
      "Selbstwirken", "Lancio su di sé", "Lançamento sobre si",
    ],
  },
  {
    prefix: "evtNormalCast",
    label: [
      "Cast normal", "Normal cast", "Lanzamiento normal",
      "Normalwirken", "Lancio normale", "Lançamento normal",
    ],
  },
  {
    prefix: "evtLevelSpell",
    label: [
      "Améliorer", "Level up", "Mejorar",
      "Verbessern", "Potenzia", "Melhorar",
    ],
  },
];

/** Cibles possibles d'une famille. Là aussi, le plus long d'abord :
 * `AvatarSpell1` ne doit pas être coupé par `Spell`. */
const TARGETS: { match: RegExp; label: T6 }[] = [
  {
    match: /^AvatarSpell(\d)$/,
    label: [
      "Sort d'invocateur", "Summoner spell", "Hechizo de invocador",
      "Beschwörerzauber", "Incantesimo evocatore", "Feitiço de invocador",
    ],
  },
  {
    match: /^VisionItem$/,
    label: ["Babiole", "Trinket", "Baratija", "Schmuckstück", "Ninnolo", "Berloque"],
  },
  {
    match: /^RoleBound$/,
    label: [
      "Sort de rôle", "Role-bound spell", "Hechizo de rol",
      "Rollenzauber", "Abilità di ruolo", "Feitiço de função",
    ],
  },
  {
    match: /^Item(\d)$/,
    label: ["Objet", "Item", "Objeto", "Gegenstand", "Oggetto", "Item"],
  },
  {
    match: /^Spell(\d)$/,
    label: ["Sort", "Spell", "Hechizo", "Zauber", "Abilità", "Feitiço"],
  },
  // `evtLevelSpell1` laisse « 1 » comme cible nue.
  {
    match: /^(\d)$/,
    label: ["Sort", "Spell", "Hechizo", "Zauber", "Abilità", "Feitiço"],
  },
];

/** Libellé traduit d'un raccourci, ou `null` si le nom est inconnu — à charge
 * de l'appelant de retomber sur le nom brut plutôt que d'afficher du vide. */
export function hotkeyLabel(key: string, lang: Lang): string | null {
  const direct = STANDALONE[key];
  if (direct) return pick(direct, lang);

  for (const family of FAMILIES) {
    if (!key.startsWith(family.prefix)) continue;
    const rest = key.slice(family.prefix.length);
    for (const target of TARGETS) {
      const found = rest.match(target.match);
      if (!found) continue;
      const numero = found[1] ? ` ${found[1]}` : "";
      return `${pick(family.label, lang)} · ${pick(target.label, lang)}${numero}`;
    }
    // Famille reconnue mais cible inconnue : mieux vaut la famille seule que rien.
    return pick(family.label, lang);
  }
  return null;
}
