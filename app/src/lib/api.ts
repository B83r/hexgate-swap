// Client du moteur switcher Python (switcher/server.py), exposé en local par
// le sidecar Tauri. Port fixe en dev ; en prod le sidecar l'annonce sur stdout
// ("LOL_SWITCHER_READY port=XXXX"), lu côté Rust puis transmis au frontend.
import { invoke } from "@tauri-apps/api/core";

export const API_PORT = Number((import.meta as any).env?.VITE_SWITCHER_PORT) || 8722;
const BASE = `http://127.0.0.1:${API_PORT}`;

/** Jeton d'authentification du backend local (commande Rust `api_token`).
 *
 * Depuis le 23/09/2026, le backend refuse toute requête sans ce jeton : avant,
 * n'importe quel programme — voire une page web — pouvait exporter les sessions
 * Riot ou lui faire ouvrir un exécutable. Le backend le régénère à chaque
 * démarrage : sur un 401, on le relit une fois puis on rejoue la requête. */
let _token: string | null = null;
let _tokenRequest: Promise<string | null> | null = null;

async function apiToken(refresh = false): Promise<string | null> {
  if (refresh) _token = null;
  if (_token) return _token;
  if (!_tokenRequest) {
    _tokenRequest = invoke<string>("api_token")
      .then((token) => (_token = token))
      .catch(() => null) // hors Tauri, ou backend pas encore démarré
      .finally(() => { _tokenRequest = null; });
  }
  return _tokenRequest;
}

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
  /** Partie annulée : ni victoire ni défaite, exclue des statistiques. */
  remake?: boolean;
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

export type PresenceStatus = "chat" | "offline" | "mobile";
export interface DeceiveState {
  configured: boolean;
  available: boolean;
  running: boolean;
  connected: boolean;
  proxy_enabled: boolean;
  status: PresenceStatus;
  lobby_chat: boolean;
}

/** Éléments de l'identité de profil League qu'on sait retirer un par un.
 * L'API locale remplaçant l'objet entier, le backend réémet toujours les
 * éléments non listés à l'identique (cf. `lcu_api.clear_identity`). */
export type IdentityField = "tokens" | "banner" | "crest" | "prestige" | "title";

export interface SettingsPreset {
  name: string;
  game_sections: number;
  input_sections: number;
  saved_at: number | null;
}

export interface PresetsPayload {
  presets: SettingsPreset[];
  accounts: string[];
  /** Compte actuellement connecté : c'est de lui que se copient les réglages,
   * et c'est son nom que porte le modèle — l'utilisateur n'en invente aucun. */
  active: string | null;
  /** Synchro automatique au changement de compte. Si elle est désactivée,
   * appliquer un preset à des comptes n'aura aucun effet au prochain swap —
   * l'interface doit le dire plutôt que de laisser croire à un échec. */
  sync_enabled: boolean;
}

/** État de la messagerie du client Riot (bug « bloqué au lobby »).
 * `mismatch` n'est vrai que si l'edge attendu est CONNU et différent : une
 * région non cartographiée ne doit pas déclencher de fausse alerte. */
export interface QueueRepairState {
  client: boolean;
  affinity: string | null;
  expected: string | null;
  state: string | null;
  mismatch: boolean;
}

export interface QueueRepairResult {
  ok: boolean;
  before: QueueRepairState;
  after: QueueRepairState;
  lobby_recreated: boolean;
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

async function req<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const token = await apiToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Hexgate-Token": token } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401 && !retried) {
    // Backend redémarré depuis la dernière lecture : nouveau jeton.
    await apiToken(true);
    return req<T>(path, init, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  loginCredentials: (name: string, action: "status" | "save" | "delete", username?: string, password?: string) =>
    req<{ configured: boolean }>("/login-credentials", { method: "POST", body: JSON.stringify({ name, action, username, password }) }),
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
  reconnect: (name: string, queue_id?: number, product: Product = "league_of_legends") =>
    req<{ started: boolean }>("/reconnect", { method: "POST", body: JSON.stringify({ name, queue_id, product }) }),
  getQueuePenalty: () =>
    req<{ penalty: { seconds_remaining: number; reason: string | null } | null }>("/queue-penalty"),
  getWallet: () => req<{ wallet: Wallet | null }>("/wallet"),
  setPinned: (name: string, pinned: boolean, product: Product = "league_of_legends") =>
    req<{ ok: boolean }>("/pin", { method: "POST", body: JSON.stringify({ name, pinned, product }) }),
  setValorantTutorial: (name: string, confirmed: boolean) =>
    req<{ ok: boolean }>("/valorant/tutorial", { method: "POST", body: JSON.stringify({ name, confirmed }) }),
  refreshValorant: (name: string) =>
    req<{ started: boolean }>("/valorant/refresh", { method: "POST", body: JSON.stringify({ name }) }),
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
  getDeceiveState: () => req<DeceiveState>("/deceive"),
  configureDeceive: (enabled: boolean, status: PresenceStatus) =>
    req<DeceiveState>("/deceive/config", { method: "POST", body: JSON.stringify({ enabled, status }) }),
  updateDeceiveState: (status: PresenceStatus, enabled: boolean, lobbyChat: boolean) =>
    req<DeceiveState>("/deceive/state", { method: "POST", body: JSON.stringify({ status, enabled, lobbyChat }) }),
  startWithDeceive: (product: Product | "bacon") =>
    req<{ ok: boolean }>("/deceive/start", { method: "POST", body: JSON.stringify({ product }) }),
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
  getCloudBackup: () => req<{ path: string | null; password_configured: boolean }>("/settings/cloud-backup"),
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
    cloud_backup_password_configured: boolean;
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
    low_power_mode: boolean;
    remember_last_product: boolean;
    henrikdev_configured: boolean;
    riot_api_key_configured: boolean;
    is_admin?: boolean;
  }>("/settings/all"),
  updateSettings: (settings: Partial<{
    auto_accept_delay: number;
    cloud_backup_path: string | null;
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
    remember_last_product: boolean;
    henrikdev_api_key: string;
    riot_api_key: string;
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
  savePreset: (name: string) =>
    req<{ ok: boolean }>("/tools/presets/save", { method: "POST", body: JSON.stringify({ name }) }),
  deletePreset: (name: string) =>
    req<{ ok: boolean }>("/tools/presets/delete", { method: "POST", body: JSON.stringify({ name }) }),
  applyPreset: (name: string, accounts: string[], live: boolean, enable_sync = false) =>
    req<{
      ok: boolean; accounts: number; live: boolean;
      sync_enabled: boolean; sync_turned_on: boolean; errors: string[];
    }>(
      "/tools/presets/apply",
      { method: "POST", body: JSON.stringify({ name, accounts, live, enable_sync }) },
    ),
  honorRandomAlly: () =>
    req<{ ok: boolean; player: { name: string; champion: string } | null }>("/tools/honor", { method: "POST" }),
  rerollChampion: () => req<{ ok: boolean }>("/tools/reroll", { method: "POST" }),
  respondToSwap: (kind: SwapKind, id: number, action: "accept" | "decline") =>
    req<{ ok: boolean }>("/tools/swaps/respond", { method: "POST", body: JSON.stringify({ kind, id, action }) }),
  clearNotifications: () =>
    req<{ ok: boolean; count: number }>("/tools/notifications/clear", { method: "POST" }),
  queueRepairState: () => req<QueueRepairState>("/tools/queue-repair"),
  repairQueue: () =>
    req<QueueRepairResult>("/tools/queue-repair", { method: "POST" }),
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

/** Connexion SSE UNIQUE par fenêtre, multiplexée vers tous les abonnés.
 * Avant : chaque appel ouvrait sa propre EventSource (la fenêtre principale en
 * cumulait 2-3) — autant de threads bloqués côté backend et de parsing dupliqué.
 * La connexion est fermée quand le dernier abonné se désabonne. */
let _sse: EventSource | null = null;
const _sseSubs = new Set<(e: ServerEvent) => void>();

let _sseOpening = false;

/** Ouvre le flux d'événements. EventSource ne sait pas envoyer d'en-tête : le
 * jeton passe en paramètre d'URL (accepté par le backend pour `/events` seul). */
function openEvents(refreshToken = false): void {
  if (_sse || _sseOpening || _sseSubs.size === 0) return;
  _sseOpening = true;
  void apiToken(refreshToken).then((token) => {
    _sseOpening = false;
    if (_sse || _sseSubs.size === 0) return;
    const es = new EventSource(`${BASE}/events?token=${encodeURIComponent(token ?? "")}`);
    es.onmessage = (msg) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        return; /* ligne non-JSON ignorée */
      }
      _sseSubs.forEach((fn) => fn(parsed));
    };
    es.onerror = () => {
      // Coupure réseau : EventSource se reconnecte seul (état CONNECTING).
      // Refus 401 (backend redémarré, nouveau jeton) : il abandonne pour de
      // bon (CLOSED) — on rouvre avec un jeton relu.
      if (es.readyState === EventSource.CLOSED && _sse === es) {
        _sse = null;
        window.setTimeout(() => openEvents(true), 2000);
      }
    };
    _sse = es;
  });
}

export function subscribeEvents(onEvent: (e: ServerEvent) => void): () => void {
  _sseSubs.add(onEvent);
  openEvents();
  return () => {
    _sseSubs.delete(onEvent);
    if (_sseSubs.size === 0 && _sse) {
      _sse.close();
      _sse = null;
    }
  };
}
