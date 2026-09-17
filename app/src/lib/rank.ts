import type { Account } from "./api";

export const TIER_FR: Record<string, string> = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or",
  PLATINUM: "Platine", EMERALD: "Émeraude", DIAMOND: "Diamant",
  MASTER: "Maître", GRANDMASTER: "Grand Maître", CHALLENGER: "Challenger",
};

export const TIER_COLORS: Record<string, string> = {
  IRON: "#9a9a9a", BRONZE: "#c98d52", SILVER: "#c3d1d1", GOLD: "#f1c95c",
  PLATINUM: "#4fc0b2", EMERALD: "#3ddc97", DIAMOND: "#8aa6ff",
  MASTER: "#c084fc", GRANDMASTER: "#f87171", CHALLENGER: "#fcd34d",
};

/** Noms de tiers localisés (comme dans le client LoL) par code de langue. */
export const TIER_NAMES: Record<string, Record<string, string>> = {
  fr: TIER_FR,
  en: {
    IRON: "Iron", BRONZE: "Bronze", SILVER: "Silver", GOLD: "Gold",
    PLATINUM: "Platinum", EMERALD: "Emerald", DIAMOND: "Diamond",
    MASTER: "Master", GRANDMASTER: "Grandmaster", CHALLENGER: "Challenger",
  },
  es: {
    IRON: "Hierro", BRONZE: "Bronce", SILVER: "Plata", GOLD: "Oro",
    PLATINUM: "Platino", EMERALD: "Esmeralda", DIAMOND: "Diamante",
    MASTER: "Maestro", GRANDMASTER: "Gran maestro", CHALLENGER: "Aspirante",
  },
  de: {
    IRON: "Eisen", BRONZE: "Bronze", SILVER: "Silber", GOLD: "Gold",
    PLATINUM: "Platin", EMERALD: "Smaragd", DIAMOND: "Diamant",
    MASTER: "Meister", GRANDMASTER: "Großmeister", CHALLENGER: "Herausforderer",
  },
  it: {
    IRON: "Ferro", BRONZE: "Bronzo", SILVER: "Argento", GOLD: "Oro",
    PLATINUM: "Platino", EMERALD: "Smeraldo", DIAMOND: "Diamante",
    MASTER: "Maestro", GRANDMASTER: "Gran maestro", CHALLENGER: "Sfidante",
  },
  pt: {
    IRON: "Ferro", BRONZE: "Bronze", SILVER: "Prata", GOLD: "Ouro",
    PLATINUM: "Platina", EMERALD: "Esmeralda", DIAMOND: "Diamante",
    MASTER: "Mestre", GRANDMASTER: "Grão-mestre", CHALLENGER: "Desafiante",
  },
};

/** Abréviations victoire/défaite par langue (ex. "12V 8D" / "12W 8L"). */
const WL: Record<string, { w: string; l: string }> = {
  fr: { w: "V", l: "D" }, en: { w: "W", l: "L" }, es: { w: "V", l: "D" },
  de: { w: "S", l: "N" }, it: { w: "V", l: "S" }, pt: { w: "V", l: "D" },
};

/** Lettres victoire/défaite pour une langue (pour un affichage inline hors helpers). */
export function wlLetters(lang = "fr"): { w: string; l: string } {
  return WL[lang] ?? WL.fr;
}

/** Libellés des files classées par langue. */
const QUEUE_LABELS: Record<string, { solo: string; flex: string }> = {
  fr: { solo: "Classée Solo/Duo", flex: "Classée Flexible" },
  en: { solo: "Ranked Solo/Duo", flex: "Ranked Flex" },
  es: { solo: "Clasif. Solo/Dúo", flex: "Clasif. Flexible" },
  de: { solo: "Wertung Solo/Duo", flex: "Flex-Wertung" },
  it: { solo: "Classificata Solo/Duo", flex: "Classificata Flessibile" },
  pt: { solo: "Ranqueada Solo/Duo", flex: "Ranqueada Flexível" },
};

const FLEX_PREFIX: Record<string, string> = {
  fr: "Flex · ", en: "Flex · ", es: "Flex · ", de: "Flex · ", it: "Flex · ", pt: "Flex · ",
};

const UNRANKED: Record<string, string> = {
  fr: "Non classé", en: "Unranked", es: "Sin clasificar",
  de: "Unplatziert", it: "Non classificato", pt: "Sem classificação",
};

function tierName(tier: string, lang: string): string {
  return (TIER_NAMES[lang] ?? TIER_FR)[tier] ?? tier;
}

export const NO_DIVISION = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

export const TIER_ORDER = [
  "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD",
  "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER",
];

/** Libellé localisé d'un rang, ex. "Platine IV" / "Platinum IV" ou "Maître" (sans division). */
export function rankLabel(tier: string | null | undefined, division: string | null | undefined, lang = "fr"): string {
  if (!tier) return UNRANKED[lang] ?? "Unranked";
  const div = NO_DIVISION.has(tier) ? "" : ` ${division ?? ""}`;
  return `${tierName(tier, lang)}${div}`;
}
const _DIV_ORDER: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
const _DIV_LABELS = ["IV", "III", "II", "I"];

/** LP absolu sur l'échelle (tier*400 + div*100 + lp) — même formule que le backend
 * (vault.ladder_lp), pour comparer deux points d'historique entre eux. */
export function ladderLp(tier: string | null | undefined, division: string | null | undefined, lp: number): number | null {
  if (!tier || !TIER_ORDER.includes(tier)) return null;
  const tierIndex = TIER_ORDER.indexOf(tier);
  const divIndex = NO_DIVISION.has(tier) ? 0 : (_DIV_ORDER[division ?? "I"] ?? 3);
  return tierIndex * 400 + divIndex * 100 + lp;
}

export interface ScoreRank {
  tier: string;
  division: string | null;
  lp: number;
}

/** Inverse de `ladderLp` : reconvertit un score d'échelle en tier/division/LP. */
export function scoreToRank(score: number): ScoreRank {
  const s = Math.max(0, score);
  const tIdx = Math.min(TIER_ORDER.length - 1, Math.floor(s / 400));
  const tier = TIER_ORDER[tIdx];
  if (NO_DIVISION.has(tier)) {
    return { tier, division: null, lp: Math.max(0, Math.round(s - tIdx * 400)) };
  }
  const rem = s - tIdx * 400;
  const dIdx = Math.max(0, Math.min(3, Math.floor(rem / 100)));
  return { tier, division: _DIV_LABELS[dIdx], lp: Math.max(0, Math.min(99, Math.round(rem - dIdx * 100))) };
}

// « Top % » approximatif du ladder au bas de chaque tier (division IV, 0 LP),
// d'après la distribution mondiale approximative des rangs. Riot n'expose PAS
// le vrai classement ladder via son API locale — c'est donc une ESTIMATION.
const _TIER_TOP_PCT: Record<string, number> = {
  IRON: 99, BRONZE: 88, SILVER: 68, GOLD: 50, PLATINUM: 33,
  EMERALD: 12, DIAMOND: 3.5, MASTER: 0.4, GRANDMASTER: 0.08, CHALLENGER: 0.02,
};

/** Estimation du percentile (« top X % ») pour un rang donné. */
export function ladderTopPct(tier: string, division: string | null | undefined, lp: number): number | null {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx < 0) return null;
  const base = _TIER_TOP_PCT[tier];
  const nextTier = TIER_ORDER[idx + 1];
  const next = nextTier ? _TIER_TOP_PCT[nextTier] : base * 0.3;
  const frac = NO_DIVISION.has(tier) ? 0 : ((_DIV_ORDER[division ?? "I"] ?? 3) * 100 + lp) / 400;
  return base + (next - base) * frac;
}

// Taille approximative de la population classée SoloQ par région (ordre de
// grandeur, pour convertir un percentile en position ladder « à la Porofessor »).
const _REGION_POP: Record<string, number> = {
  EUW: 3_200_000, EUNE: 1_700_000, NA: 2_400_000, KR: 2_000_000,
  BR: 1_800_000, LAN: 900_000, LAS: 700_000, OCE: 350_000,
  TR: 900_000, RU: 600_000, JP: 300_000,
  // alias au cas où le yaml Riot stocke un code plateforme (ex. "EUW1") plutôt
  // que le code région court — observé "EUW" bare sur cette machine, mais pas
  // garanti pour toutes les régions/versions du client.
  EUW1: 3_200_000, EUN1: 1_700_000, NA1: 2_400_000, BR1: 1_800_000,
  LA1: 900_000, LA2: 700_000, OC1: 350_000, TR1: 900_000, JP1: 300_000,
};
const _DEFAULT_POP = 3_200_000;

function _ordinalSuffix(n: number): string {
  const r100 = n % 100;
  if (r100 >= 11 && r100 <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

export interface LadderPosition {
  rank: number;
  ordinal: string; // ex. « 916,001st »
  pct: number;
}

/** Position ladder ESTIMÉE (percentile × population régionale approximative).
 * Riot n'expose pas le vrai classement ladder via son API locale. */
export function ladderPosition(
  tier: string,
  division: string | null | undefined,
  lp: number,
  region: string | null | undefined,
): LadderPosition | null {
  const pct = ladderTopPct(tier, division, lp);
  if (pct == null) return null;
  const pop = _REGION_POP[(region ?? "").toUpperCase()] ?? _DEFAULT_POP;
  const rank = Math.max(1, Math.round((pct / 100) * pop));
  return {
    rank,
    ordinal: `${rank.toLocaleString("en-US")}${_ordinalSuffix(rank)}`,
    pct,
  };
}

/** MMR estimé : rang actuel ajusté par le winrate (Riot n'expose pas le vrai MMR). */
export function estimateMmr(tier: string, division: string | null | undefined, lp: number, winrate: number | null): ScoreRank {
  const bias = winrate == null ? 0 : Math.round((winrate - 0.5) * 900);
  if (NO_DIVISION.has(tier)) {
    // Master/GM/Challenger n'ont pas de LP plafonné à 400 : les frontières entre
    // ces paliers ne sont de toute façon pas déterminées par le LP (promotion
    // par classement, pas par seuil), donc on ne peut pas décoder un score vers
    // un autre tier apex sans inventer une frontière arbitraire. On ajuste
    // seulement le LP, sans changer de tier.
    return { tier, division: null, lp: Math.max(0, lp + bias) };
  }
  const cur = ladderLp(tier, division, lp) ?? 0;
  return scoreToRank(cur + bias);
}

export interface QueueDetail {
  label: string;
  rankText: string;
  lp: number;
  wins: number;
  losses: number;
  winrate: number | null;
  color: string;
}

/** Détail formaté d'une file classée (pour le tooltip riche). */
export function queueDetails(account: Account, lang = "fr"): QueueDetail[] {
  const rank = account.rank ?? {};
  const labels = QUEUE_LABELS[lang] ?? QUEUE_LABELS.fr;
  const out: QueueDetail[] = [];
  for (const key of ["solo", "flex"] as const) {
    const q = (rank as Record<string, any>)[key];
    if (!q) continue;
    const div = NO_DIVISION.has(q.tier) ? "" : ` ${q.division ?? ""}`;
    const total = q.wins + q.losses;
    out.push({
      label: labels[key],
      rankText: `${tierName(q.tier, lang)}${div}`,
      lp: q.lp,
      wins: q.wins,
      losses: q.losses,
      winrate: total ? q.wins / total : null,
      color: TIER_COLORS[q.tier] ?? "#7c8aa0",
    });
  }
  return out;
}

export interface RankInfo {
  tier: string | null;
  main: string;
  detail: string;
  color: string;
  winrate: number | null;
  lp: number | null;
  wins: number;
  losses: number;
}

export function rankInfo(account: Account, lang = "fr"): RankInfo {
  const rank = account.rank ?? {};
  const queue = rank.solo ?? rank.flex;
  const prefix = rank.solo ? "" : rank.flex ? (FLEX_PREFIX[lang] ?? "Flex · ") : "";
  if (!queue) {
    return {
      tier: null, main: UNRANKED[lang] ?? "Unranked", detail: "", color: "#7c8aa0",
      winrate: null, lp: null, wins: 0, losses: 0,
    };
  }
  const div = NO_DIVISION.has(queue.tier) ? "" : ` ${queue.division ?? ""}`;
  const total = queue.wins + queue.losses;
  const winrate = total ? queue.wins / total : null;
  const wl = WL[lang] ?? WL.fr;
  let detail = `${queue.lp} LP`;
  if (winrate !== null) detail += ` · ${queue.wins}${wl.w} ${queue.losses}${wl.l}`;
  return {
    tier: queue.tier,
    main: `${prefix}${tierName(queue.tier, lang)}${div}`,
    detail,
    color: TIER_COLORS[queue.tier] ?? "#7c8aa0",
    winrate,
    lp: queue.lp,
    wins: queue.wins,
    losses: queue.losses,
  };
}
