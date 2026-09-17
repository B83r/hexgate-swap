// Client du moteur switcher Python (switcher/server.py), exposé en local par
// le sidecar Tauri. Port fixe en dev ; en prod le sidecar l'annonce sur stdout
// ("LOL_SWITCHER_READY port=XXXX"), lu côté Rust puis transmis au frontend.
export const API_PORT = Number((import.meta as any).env?.VITE_SWITCHER_PORT) || 8722;
const BASE = `http://127.0.0.1:${API_PORT}`;

export interface Recap {
  wins: number;
  losses: number;
  lp_delta: number;
}

export interface Goal {
  tier: string;
  division: string | null;
  start_lp: number;
}

export interface PostSwap {
  queue_id: number | null;
  auto_join: boolean;
}

export interface PositionPrefs {
  first: string | null;
  second: string | null;
}

export interface ChampSelectPrefs {
  auto_declare_intent: boolean;
  auto_pick: boolean;
  auto_ban: boolean;
  priority_by_role: Record<string, string[]>;
  ban_priority: string[];
  chat_message_enabled: boolean;
  chat_message: string;
}

export interface Match {
  match_id: string;
  ts: number;
  queue_id: number;
  champion: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  duration_s: number;
  cs: number;
  role: string;
  items?: number[];
  keystone_id?: number;
  sub_style_id?: number;
}

export interface ChampionStats {
  champion: string;
  games: number;
  wins: number;
  winrate: number;
  kda_avg: number;
}

export interface RankedQueue {
  tier: string;
  division: string | null;
  lp: number;
  wins: number;
  losses: number;
}

export interface Rank {
  solo?: RankedQueue;
  flex?: RankedQueue;
}

export type Product = "league_of_legends" | "valorant";

/** Éléments de l'identité de profil League qu'on sait retirer un par un.
 * L'API locale remplaçant l'objet entier, le backend réémet toujours les
 * éléments non listés à l'identique (cf. `lcu_api.clear_identity`). */
export type IdentityField = "tokens" | "banner" | "crest" | "prestige" | "title";

/** Valeur d'un réglage League. `null` existe réellement : `evtPushToTalk` est
 * nul quand aucune touche n'est assignée — à traiter comme « non assigné »,
 * pas comme une absence de clé. Les nombres viennent des réglages de jeu
 * (échelles, volumes), les booléens des bascules et des Quickbinds. */
export type SettingValue = string | number | boolean | null;

/** Réglages League : section → clé → valeur. Deux niveaux, jamais plus. */
export type SettingsTree = Record<string, Record<string, SettingValue>>;

export interface LiveSettings {
  game: SettingsTree | null;
  input: SettingsTree | null;
}

export interface SettingsPreset {
  name: string;
  game_sections: number;
  input_sections: number;
  saved_at: number | null;
}

export interface PresetsPayload {
  presets: SettingsPreset[];
  accounts: string[];
  /** Synchro automatique au changement de compte. Si elle est désactivée,
   * appliquer un preset à des comptes n'aura aucun effet au prochain swap —
   * l'interface doit le dire plutôt que de laisser croire à un échec. */
  sync_enabled: boolean;
}

/** Familles d'échanges proposables en sélection des champions. */
export type SwapKind = "position" | "pick_order" | "champion";

/** État agrégé de l'onglet Outils. Tout est nullable : client League fermé,
 * hors sélection des champions ou hors fin de partie sont des cas NORMAUX,
 * pas des erreurs — l'onglet doit rester affichable dans tous les cas. */
export interface ToolsState {
  reroll: { current: number; cost: number; used: number; max: number } | null;
  swaps: { kind: SwapKind; id: number; cell_id: number | null }[];
  identity: Record<string, unknown> | null;
  honor_votes: number | null;
}

export interface ValorantProfile {
  initialized: boolean;
  tutorial_confirmed: boolean;
  pinned: boolean;
  status: "new" | "ready" | "expired";
  stats: ValorantStats | null;
}

export interface ValorantMatch {
  id: string;
  map: string;
  played_at: string | number | null;
  mode: string;
  agent: string;
  won: boolean | null;
  score: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

export interface ValorantStats {
  rank: { label: string; rr: number | null; elo?: number | null; last_change?: number | null } | null;
  account_level: number | null;
  title: string | null;
  matches: ValorantMatch[];
  top_agent: string | null;
  wins: number;
  losses: number;
  last_synced: number;
  source: "henrikdev";
}

export interface ProductStatus {
  league_of_legends: "none" | "client" | "in_game";
  valorant: "none" | "client" | "in_game";
}

export interface Account {
  name: string;
  region: string;
  expired: boolean;
  riot_id: string | null;
  level: number | null;
  rank: Rank | null;
  icon_id: number | null;
  active: boolean;
  lp_delta: number | null;
  note: string | null;
  pinned: boolean;
  recap?: Recap | null;
  goal?: Goal | null;
  post_swap?: PostSwap | null;
  champ_select?: ChampSelectPrefs;
  position_prefs?: PositionPrefs | null;
  most_played_champ?: string | null;
  roles_today?: Record<string, { wins: number; games: number }> | null;
  mvp_today?: { champion: string; wins: number; games: number; losses: number; kda: number } | null;
  wallet?: Wallet | null;
  valorant: ValorantProfile;
}

export interface Wallet {
  blue_essence: number;
  rp: number;
}

export interface RankHistoryPoint {
  ts: number;
  tier: string | null;
  division: string | null;
  lp: number;
  wins: number;
  losses: number;
}

export function avatarUrl(icon_id: number | null, initial: string, ringHex: string): string {
  const ring = ringHex.replace("#", "");
  return `${BASE}/assets/avatar/${icon_id ?? "none"}-${encodeURIComponent(initial)}-${ring}`;
}

export function rankEmblemUrl(tier: string | null): string {
  // ?v=3 (14/09/2026) : même cause que le passage à v2, nouvelle occurrence —
  // le sidecar PyInstaller packagé (Optim 1) n'embarquait pas backend/assets/,
  // donc rank_emblem() servait silencieusement le badge de repli (hexagone +
  // lettre, ~900 o) au lieu du vrai PNG (~150 Ko). Corrigé côté build
  // (build-sidecar.ps1 : --add-data), mais le cache disque de WebView2 avait
  // déjà mémorisé la réponse de repli sous l'URL ?v=2 — un bump de version est
  // le seul moyen de forcer une vraie relecture réseau sans purger le cache
  // à la main. Bumper systématiquement si `rank_emblem()` ou son bundling
  // changent à nouveau.
  return `${BASE}/assets/ranks/${(tier ?? "unranked").toLowerCase()}.png?v=3`;
}

export function logoUrl(): string {
  return `${BASE}/assets/logo.png`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  listAccounts: (product: Product = "league_of_legends") =>
    req<{ accounts: Account[]; active: string | null; recap_total: Recap | null; product: Product; product_status: ProductStatus }>(`/accounts?product=${product}`),
  getProductStatus: () => req<ProductStatus>("/products/status"),
  suggestName: () => req<{ name: string | null }>("/suggest-name"),
  getAutoAccept: () => req<{ enabled: boolean }>("/autoaccept"),
  setAutoAccept: (enabled: boolean) =>
    req<{ enabled: boolean }>("/autoaccept", { method: "POST", body: JSON.stringify({ enabled }) }),
  startSwap: (name: string, product: Product = "league_of_legends", queue_id?: number) =>
    req<{ started: boolean }>("/swap", { method: "POST", body: JSON.stringify({ name, product, queue_id }) }),
  capture: (name: string) =>
    req<{ account: Account }>("/capture", { method: "POST", body: JSON.stringify({ name }) }),
  addAccount: (product: Product = "league_of_legends") =>
    req<{ started: boolean }>("/add-account", { method: "POST", body: JSON.stringify({ product }) }),
  deleteAccount: (name: string, mode: "all" | "valorant" = "all") =>
    req<{ ok: boolean }>("/delete", { method: "POST", body: JSON.stringify({ name, mode }) }),
  getStreamerMode: () => req<{ enabled: boolean }>("/streamer-mode"),
  setStreamerMode: (enabled: boolean) =>
    req<{ enabled: boolean }>("/streamer-mode", { method: "POST", body: JSON.stringify({ enabled }) }),
  exportAccounts: (names: string[], password: string) =>
    req<{ filename: string; data: string }>("/export", {
      method: "POST",
      body: JSON.stringify({ names, password }),
    }),
  importAccounts: (data: string, password: string) =>
    req<{ imported: string[] }>("/import", { method: "POST", body: JSON.stringify({ data, password }) }),
  setNote: (name: string, note: string) =>
    req<{ ok: boolean }>("/note", { method: "POST", body: JSON.stringify({ name, note }) }),
  reconnect: (name: string, queue_id?: number) =>
    req<{ started: boolean }>("/reconnect", { method: "POST", body: JSON.stringify({ name, queue_id }) }),
  getQueuePenalty: () =>
    req<{ penalty: { seconds_remaining: number; reason: string | null } | null }>("/queue-penalty"),
  getWallet: () => req<{ wallet: Wallet | null }>("/wallet"),
  setPinned: (name: string, pinned: boolean, product: Product = "league_of_legends") =>
    req<{ ok: boolean }>("/pin", { method: "POST", body: JSON.stringify({ name, pinned, product }) }),
  setValorantTutorial: (name: string, confirmed: boolean) =>
    req<{ ok: boolean }>("/valorant/tutorial", { method: "POST", body: JSON.stringify({ name, confirmed }) }),
  refreshValorant: (name: string) =>
    req<{ started: boolean }>("/valorant/refresh", { method: "POST", body: JSON.stringify({ name }) }),
  /** `champion` = `raw` de l'adversaire ciblé : il reste renseigné même quand le
   *  Mode Streamer du client LoL vide le riot_id, et permet au backend de savoir
   *  qu'une cible EST épinglée (sans insight possible) plutôt que de retomber à
   *  tort sur l'adversaire de lane. */
  setInsightTarget: (riot_id: string, champion = "") =>
    req<{ ok: boolean }>("/live-game/insight-target", {
      method: "POST",
      body: JSON.stringify({ riot_id, champion }),
    }),
  reorder: (order: string[]) =>
    req<{ ok: boolean }>("/reorder", { method: "POST", body: JSON.stringify({ order }) }),
  getRankHistory: (name: string) =>
    req<{
      points: RankHistoryPoint[];
      peak: RankHistoryPoint | null;
      trend_7d: number | null;
      riot_last_sync: number | null;
      riot_cooldown_remaining: number;
    }>(`/rank-history?name=${encodeURIComponent(name)}`),
  refreshRiot: (name: string) =>
    req<{ started: boolean }>("/refresh-riot", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  setGoal: (name: string, tier: string | null, division: string | null) =>
    req<{ ok: boolean }>("/goal", { method: "POST", body: JSON.stringify({ name, tier, division }) }),
  getGameflow: () => req<{ phase: string; since: number }>("/gameflow"),
  setPostSwap: (name: string, queue_id: number | null, auto_join: boolean) =>
    req<{ ok: boolean }>("/post-swap", { method: "POST", body: JSON.stringify({ name, queue_id, auto_join }) }),
  getMatches: (name: string) => req<Match[]>(`/matches?name=${encodeURIComponent(name)}`),
  refreshMatches: (name: string) =>
    req<{ started: boolean }>("/matches-refresh", { method: "POST", body: JSON.stringify({ name }) }),
  getChampionStats: (name: string) => req<ChampionStats[]>(`/champion-stats?name=${encodeURIComponent(name)}`),
  getLiveGame: () => req<any>("/live-game"),
  getFriends: () => req<any[]>("/chat/friends"),
  sendChatMessage: (friendJid: string, text: string) =>
    req<{ ok: boolean }>("/chat/message", {
      method: "POST",
      body: JSON.stringify({ friendJid, text }),
    }),
  getReplayState: (matchId: string) => req<{ state: string }>(`/replays/state?matchId=${encodeURIComponent(matchId)}`),
  downloadReplay: (matchId: string) =>
    req<{ ok: boolean }>("/replays/download", {
      method: "POST",
      body: JSON.stringify({ matchId }),
    }),
  getServerStatus: (region: string) => req<any>(`/server-status?region=${encodeURIComponent(region)}`),
  getMatchmakingSearch: () => req<any>("/matchmaking-search"),
  getAutoAcceptDelay: () => req<{ delay: number }>("/settings/autoaccept-delay"),
  setAutoAcceptDelay: (delay: number) => req<{ delay: number }>("/settings/autoaccept-delay", { method: "POST", body: JSON.stringify({ delay }) }),
  getCloudBackup: () => req<{ path: string | null; password?: string }>("/settings/cloud-backup"),
  setCloudBackup: (path: string | null, password?: string) => req<{ path: string | null }>("/settings/cloud-backup", { method: "POST", body: JSON.stringify({ path, password }) }),
  updatePresence: (statusMessage: string, availability: string) => req<{ ok: boolean }>("/chat/me", { method: "POST", body: JSON.stringify({ statusMessage, availability }) }),
  createPracticeLobby: () => req<{ ok: boolean }>("/lobby/practice", { method: "POST" }),
  closeLeagueClient: () => req<{ ok: boolean }>("/lcu/close", { method: "POST" }),
  repairLeague: () => req<{ ok: boolean }>("/lcu/repair", { method: "POST" }),
  openUrl: (url: string) => req<{ ok: boolean }>("/open-url", { method: "POST", body: JSON.stringify({ url }) }),
  exportMatchesJSON: (filename: string, matches: Match[]) => req<{ ok: boolean; path?: string; cancelled?: boolean }>("/matches/export", { method: "POST", body: JSON.stringify({ filename, matches }) }),
  /** Ouvre l'explorateur Windows pour enregistrer une image (données PNG en base64). */
  saveImage: (filename: string, dataBase64: string) =>
    req<{ ok: boolean; path?: string; cancelled?: boolean }>("/save-image", {
      method: "POST",
      body: JSON.stringify({ filename, data: dataBase64 }),
    }),
  getPingServers: () => req<{ selected: string; servers: PingServer[] }>("/ping/servers"),
  setPingRegion: (region: string) =>
    req<{ ok: boolean; region: string }>("/ping/region", {
      method: "POST",
      body: JSON.stringify({ region }),
    }),
  getSettingsAll: () => req<{
    auto_accept_delay: number;
    cloud_backup_path: string | null;
    cloud_backup_password?: string;
    auto_accept_invitations: boolean;
    aram_sniper_champions: string;
    lobby_welcome_message: string;
    streamer_mode: boolean;
    riot_client_auto_close: boolean;
    riot_client_autostart_mode: string;
    auto_mute_all_on_start: boolean;
    macro_f5_text: string;
    macro_f6_text: string;
    skip_end_of_game: boolean;
    end_of_game_message: string;
    end_of_game_message_team_only: boolean;
    relay_client_notifications: boolean;
    game_settings_sync_enabled: boolean;
    opponent_insight_enabled: boolean;
    low_power_mode: boolean;
    remember_last_product: boolean;
    henrikdev_configured: boolean;
    is_admin?: boolean;
  }>("/settings/all"),
  updateSettings: (settings: Partial<{
    auto_accept_delay: number;
    cloud_backup_path: string | null;
    cloud_backup_password?: string;
    auto_accept_invitations: boolean;
    aram_sniper_champions: string;
    lobby_welcome_message: string;
    streamer_mode: boolean;
    riot_client_auto_close: boolean;
    riot_client_autostart_mode: string;
    auto_mute_all_on_start: boolean;
    macro_f5_text: string;
    macro_f6_text: string;
    skip_end_of_game: boolean;
    end_of_game_message: string;
    end_of_game_message_team_only: boolean;
    relay_client_notifications: boolean;
    game_settings_sync_enabled: boolean;
    opponent_insight_enabled: boolean;
    remember_last_product: boolean;
    henrikdev_api_key: string;
  }>) => req<{ ok: boolean }>("/settings/update", { method: "POST", body: JSON.stringify(settings) }),
  spectateFriend: (puuid: string) => req<{ ok: boolean }>("/friends/spectate", { method: "POST", body: JSON.stringify({ puuid }) }),
  openChests: () => req<{ ok: boolean; count: number }>("/loot/open-chests", { method: "POST" }),
  disenchantWardsIcons: () => req<{ ok: boolean; count: number }>("/loot/disenchant-wards-icons", { method: "POST" }),
  disenchantChampionShards: (keepUnowned: boolean) =>
    req<{ ok: boolean; count: number }>("/loot/disenchant-champions", {
      method: "POST",
      body: JSON.stringify({ keep_unowned: keepUnowned }),
    }),
  /** Éléments retirables de l'identité de profil League. */
  clearIdentity: (fields: IdentityField[]) =>
    req<{ ok: boolean; count: number }>("/challenges/clear-identity", {
      method: "POST",
      body: JSON.stringify({ fields }),
    }),
  /** Démarre un jeu Riot sans rien changer à la session — pour le compte déjà
   * connecté, chez qui un swap complet tuerait le client pour rien. */
  launchProduct: (product: Product) =>
    req<{ ok: boolean }>("/product/launch", { method: "POST", body: JSON.stringify({ product }) }),
  toolsState: () => req<ToolsState>("/tools/state"),
  setProfileIcon: (icon_id: number) =>
    req<{ ok: boolean }>("/tools/profile-icon", { method: "POST", body: JSON.stringify({ icon_id }) }),
  setProfileBackground: (skin_id: number) =>
    req<{ ok: boolean }>("/tools/profile-background", { method: "POST", body: JSON.stringify({ skin_id }) }),
  saveIdentity: (name: string) =>
    req<{ ok: boolean }>("/tools/identity/save", { method: "POST", body: JSON.stringify({ name }) }),
  restoreIdentity: (name: string) =>
    req<{ ok: boolean }>("/tools/identity/restore", { method: "POST", body: JSON.stringify({ name }) }),
  settingsPresets: () => req<PresetsPayload>("/tools/presets"),
  currentSettings: () => req<LiveSettings>("/tools/settings/current"),
  savePreset: (name: string) =>
    req<{ ok: boolean }>("/tools/presets/save", { method: "POST", body: JSON.stringify({ name }) }),
  deletePreset: (name: string) =>
    req<{ ok: boolean }>("/tools/presets/delete", { method: "POST", body: JSON.stringify({ name }) }),
  applyPreset: (name: string, accounts: string[], live: boolean) =>
    req<{ ok: boolean; accounts: number; live: boolean; sync_enabled: boolean; errors: string[] }>(
      "/tools/presets/apply",
      { method: "POST", body: JSON.stringify({ name, accounts, live }) },
    ),
  editSettings: (patch: { game?: SettingsTree; input?: SettingsTree }) =>
    req<{ ok: boolean }>("/tools/settings/edit", { method: "POST", body: JSON.stringify(patch) }),
  saveGameSettings: (name: string) =>
    req<{ ok: boolean }>("/tools/settings/save", { method: "POST", body: JSON.stringify({ name }) }),
  restoreGameSettings: (name: string) =>
    req<{ ok: boolean }>("/tools/settings/restore", { method: "POST", body: JSON.stringify({ name }) }),
  honorRandomAlly: () =>
    req<{ ok: boolean; player: { name: string; champion: string } | null }>("/tools/honor", { method: "POST" }),
  rerollChampion: () => req<{ ok: boolean }>("/tools/reroll", { method: "POST" }),
  respondToSwap: (kind: SwapKind, id: number, action: "accept" | "decline") =>
    req<{ ok: boolean }>("/tools/swaps/respond", { method: "POST", body: JSON.stringify({ kind, id, action }) }),
  clearNotifications: () =>
    req<{ ok: boolean; count: number }>("/tools/notifications/clear", { method: "POST" }),
  setChampSelectPrefs: (name: string, prefs: Partial<ChampSelectPrefs>) =>
    req<{ ok: boolean }>("/champ-select-prefs", { method: "POST", body: JSON.stringify({ name, ...prefs }) }),
  dodgeLobby: () => req<{ ok: boolean }>("/lobby/dodge", { method: "POST" }),
  startQueue: (queue_id: number) =>
    req<{ started: boolean }>("/queue/start", { method: "POST", body: JSON.stringify({ queue_id }) }),
  setUiFocus: (active: boolean) =>
    req<{ ok: boolean }>("/ui-focus", { method: "POST", body: JSON.stringify({ active }) }),
  setLowPower: (enabled: boolean) =>
    req<{ enabled: boolean }>("/settings/low-power", { method: "POST", body: JSON.stringify({ enabled }) }),
  setPositionPrefs: (name: string, first: string | null, second: string | null) =>
    req<{ ok: boolean }>("/position-prefs", { method: "POST", body: JSON.stringify({ name, first, second }) }),
  getFriendRequests: () => req<any[]>("/chat/friend-requests"),
  acceptFriendRequest: (id: string) =>
    req<{ ok: boolean }>("/chat/friend-requests/accept", { method: "POST", body: JSON.stringify({ id }) }),
  declineFriendRequest: (id: string) =>
    req<{ ok: boolean }>("/chat/friend-requests/decline", { method: "POST", body: JSON.stringify({ id }) }),
};

export type ServerEvent =
  | { type: "swap_status"; data: string }
  | { type: "swap_done"; data: string }
  | { type: "swap_error"; data: string }
  | { type: "reconnect_done"; data: string }
  | { type: "reconnect_error"; data: string }
  | { type: "accounts_changed"; data: null }
  | { type: "backfill_done"; data: { name: string; added: number; total: number } }
  | { type: "backfill_error"; data: { name: string; error: string } }
  | { type: "matches_done"; data: { name: string; count: number } }
  | { type: "matches_error"; data: { name: string; error: string; code?: string } }
  | { type: "valorant_sync_done"; data: { name: string } }
  | { type: "valorant_sync_error"; data: { name: string; error: string; code: string } }
  | { type: "gameflow"; data: { phase: string; since: number } }
  | { type: "auto_accept"; data: { name: string } }
  | { type: "obs_status"; data: { running: boolean } }
  | { type: "ping_update"; data: PingUpdate }
  | { type: "live_game_stats"; data: { cs: number; time: number; cs_per_min: number; active: boolean } }
  | { type: "live_game_enemies"; data: LiveGameEnemies }
  | { type: "live_game_opponent_insight"; data: LiveGameOpponentInsight }
  | { type: "low_power"; data: { enabled: boolean } }
  | { type: "wallet_update"; data: { blue_essence: number; rp: number } }
  | { type: "toast"; text: string; kind: "ok" | "info" | "warn" | "zap" };

/** Un serveur de jeu League proposé dans le sélecteur de ping de l'en-tête. */
export interface PingServer {
  /** Identifiant de plateforme Riot (EUW1, NA1, KR…) */
  id: string;
  /** Libellé court affiché (EUW, NA, KR…) */
  label: string;
  city: string;
}

export interface PingUpdate {
  /** Latence en ms, -1 si le serveur est injoignable. */
  latency: number;
  region: string;
  label: string;
  city: string;
  /**
   * true = repli sur un point de mesure situé dans la ville du datacenter,
   * la passerelle de jeu Riot n'ayant pas répondu. La valeur reste une
   * indication de latence réseau vers cette zone, pas le ping en partie.
   */
  estimated: boolean;
}

export interface LiveGameEnemy {
  /** Nom affiché localisé ("Miss Fortune") */
  champion: string;
  /** Id interne brut ("game_character_displayname_MissFortune") — dernier segment = id Data Dragon */
  raw: string;
  /** "" si masqué (Mode Streamer du client LoL actif chez l'observateur) */
  riot_id: string;
  level: number;
  /** TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY ("" si inconnu) */
  position: string;
  items: number[];
  /** rawDisplayName des 2 sorts d'invocateur ("...SummonerSpell_SummonerFlash_...") */
  spells: string[];
  /** Ids des 2 arbres de runes (8300 = Inspiration) — runes mineures non exposées */
  rune_trees: number[];
  dead: boolean;
}

export interface LiveGameEnemies {
  my_position: string;
  enemies: LiveGameEnemy[];
  active: boolean;
}

export interface LiveGameOpponentInsight {
  riot_id: string;
  /** Mon champion au moment de la requête (le matchup est calculé pour CE champion) */
  champion: string;
  active: boolean;
  /** Message si la requête a échoué (clé Riot expirée, compte introuvable…) */
  error: string | null;
  /** Rang SoloQ actuel (saison en cours) — null si non classé */
  solo: { tier: string; division: string | null; lp: number; wins: number; losses: number } | null;
  /** Bilan dans SES games récentes où son adversaire de lane jouait mon champion */
  matchup: { wins: number; losses: number; sample: number };
  /**
   * "Pic observé" LOCAL par Hexgate au fil de vos rencontres — PAS un vrai
   * historique Riot (non exposé par l'API). Grandit au fil du temps.
   */
  peak: { tier?: string; division?: string | null; lp?: number; seen_count: number };
}

/** Connexion SSE UNIQUE par fenêtre, multiplexée vers tous les abonnés.
 * Avant : chaque appel ouvrait sa propre EventSource (la fenêtre principale en
 * cumulait 2-3) — autant de threads bloqués côté backend et de parsing dupliqué.
 * La connexion est fermée quand le dernier abonné se désabonne. */
let _sse: EventSource | null = null;
const _sseSubs = new Set<(e: ServerEvent) => void>();

export function subscribeEvents(onEvent: (e: ServerEvent) => void): () => void {
  _sseSubs.add(onEvent);
  if (!_sse) {
    _sse = new EventSource(`${BASE}/events`);
    _sse.onmessage = (msg) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        return; /* ligne non-JSON ignorée */
      }
      _sseSubs.forEach((fn) => fn(parsed));
    };
  }
  return () => {
    _sseSubs.delete(onEvent);
    if (_sseSubs.size === 0 && _sse) {
      _sse.close();
      _sse = null;
    }
  };
}
