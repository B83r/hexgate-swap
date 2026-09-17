// Données Data Dragon pour l'overlay cooldowns ennemis.
// Tout est INDICATIF : Riot n'expose ni l'ordre de montée des sorts, ni les runes
// exactes, ni le moment où un sort est lancé. On estime le rang d'après le niveau
// et l'ability haste d'après les objets visibles (exposés par la Live Client API).

const DD = "https://ddragon.leagueoflegends.com/cdn";

const jsonCache = new Map<string, Promise<unknown>>();
function fetchJson<T>(url: string): Promise<T> {
  let p = jsonCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    });
    // Ne pas mettre en cache un échec (réseau coupé…) : on retentera au prochain appel.
    p.catch(() => jsonCache.delete(url));
    jsonCache.set(url, p);
  }
  return p as Promise<T>;
}

/* ---------- Champions ---------- */

interface DdChampionListEntry {
  id: string;
  name: string;
}

/** Liste des champions : map normalisée (id minuscule + nom sans accents/espaces) → id Data Dragon. */
export async function fetchChampionKeyMap(v: string): Promise<Map<string, string>> {
  const data = await fetchJson<{ data: Record<string, DdChampionListEntry> }>(
    `${DD}/${v}/data/en_US/champion.json`
  );
  const map = new Map<string, string>();
  for (const c of Object.values(data.data)) {
    map.set(normalize(c.id), c.id);
    map.set(normalize(c.name), c.id);
  }
  return map;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

/**
 * Retrouve l'id Data Dragon d'un ennemi à partir des champs de la Live Client API.
 * `raw` = "game_character_displayname_MissFortune" → dernier segment = id interne
 * (fiable, y compris Wukong = "MonkeyKing"). Repli : match sur le nom affiché localisé.
 */
export function champIdFrom(raw: string, championName: string, keyMap: Map<string, string>): string | null {
  const seg = raw.split("_").pop() ?? "";
  return keyMap.get(normalize(seg)) ?? keyMap.get(normalize(championName)) ?? null;
}

export interface SpellInfo {
  slot: "Q" | "W" | "E" | "R";
  name: string;
  iconUrl: string;
  /** CD de base par rang (secondes) */
  cooldown: number[];
}

export async function fetchChampionSpells(champId: string, v: string): Promise<SpellInfo[]> {
  const data = await fetchJson<{
    data: Record<string, { spells: { name: string; image: { full: string }; cooldown: number[] }[] }>;
  }>(`${DD}/${v}/data/en_US/champion/${champId}.json`);
  const spells = data.data[champId]?.spells ?? [];
  const slots: SpellInfo["slot"][] = ["Q", "W", "E", "R"];
  return spells.slice(0, 4).map((s, i) => ({
    slot: slots[i],
    name: s.name,
    iconUrl: `${DD}/${v}/img/spell/${s.image.full}`,
    cooldown: s.cooldown,
  }));
}

export function champSquareUrl(champId: string, v: string): string {
  return `${DD}/${v}/img/champion/${champId}.png`;
}

/* ---------- Sorts d'invocateur ---------- */

export interface SummonerSpellInfo {
  name: string;
  iconUrl: string;
  cooldown: number;
}

/** Map clé interne ("SummonerFlash") → infos. */
export async function fetchSummonerSpellMap(v: string): Promise<Map<string, SummonerSpellInfo>> {
  const data = await fetchJson<{
    data: Record<string, { id: string; name: string; cooldown: number[]; image: { full: string } }>;
  }>(`${DD}/${v}/data/en_US/summoner.json`);
  const map = new Map<string, SummonerSpellInfo>();
  for (const s of Object.values(data.data)) {
    map.set(s.id, {
      name: s.name,
      iconUrl: `${DD}/${v}/img/spell/${s.image.full}`,
      cooldown: s.cooldown[0] ?? 0,
    });
  }
  return map;
}

/** "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" → "SummonerFlash". */
export function summKeyFrom(raw: string): string | null {
  const m = raw.match(/SummonerSpell_([A-Za-z]+)_/);
  return m ? m[1] : null;
}

/* ---------- Estimations ---------- */

/**
 * Rang estimé des sorts d'après le niveau (l'ordre de montée réel est inconnu) :
 * l'ulti est pris à 6/11/16, les points restants sont répartis uniformément
 * sur les 3 sorts de base.
 */
export function estimateRanks(level: number): { basic: number; ult: number } {
  const ult = level >= 16 ? 3 : level >= 11 ? 2 : level >= 6 ? 1 : 0;
  const basic = Math.min(5, Math.max(1, Math.ceil((level - ult) / 3)));
  return { basic, ult };
}

/**
 * Ability haste estimée d'après les objets visibles. Data Dragon ne met pas
 * l'haste dans `stats` : on la parse depuis la description HTML
 * ("<attention>20</attention> Ability Haste", locale en_US).
 */
export async function fetchItemHasteMap(v: string): Promise<Map<number, number>> {
  const data = await fetchJson<{ data: Record<string, { description?: string }> }>(
    `${DD}/${v}/data/en_US/item.json`
  );
  const map = new Map<number, number>();
  for (const [id, item] of Object.entries(data.data)) {
    const m = (item.description ?? "").match(/<attention>(\d+)<\/attention>\s*Ability Haste/i);
    if (m) map.set(Number(id), Number(m[1]));
  }
  return map;
}

export function itemsHaste(itemIds: number[], hasteMap: Map<number, number>): number {
  return itemIds.reduce((sum, id) => sum + (hasteMap.get(id) ?? 0), 0);
}

/** CD effectif (secondes) : base ajustée par l'ability haste. */
export function effectiveCd(baseCd: number, haste: number): number {
  return baseCd * (100 / (100 + haste));
}

export const INSPIRATION_TREE_ID = 8300;
export const IONIAN_BOOTS_ID = 3158;

/**
 * Summoner spell haste estimé d'un ennemi : Cosmic Insight (+18) est SUPPOSÉE
 * dès que l'arbre Inspiration est présent (les runes mineures exactes ne sont
 * pas exposées par l'API), Bottes ioniennes de lucidité (+12) d'après les objets.
 */
export function summonerHaste(runeTrees: number[], items: number[]): number {
  let haste = 0;
  if (runeTrees.includes(INSPIRATION_TREE_ID)) haste += 18;
  if (items.includes(IONIAN_BOOTS_ID)) haste += 12;
  return haste;
}

export function formatCd(seconds: number): string {
  if (seconds <= 0) return "—";
  const s = Math.round(seconds);
  return s >= 100 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}
