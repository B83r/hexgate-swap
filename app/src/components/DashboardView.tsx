import { useState, useEffect, useMemo } from "react";
import {
  type Account, type Recap, type RankHistoryPoint, type Match,
  api, rankEmblemUrl, avatarUrl,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { rankInfo, wlLetters, TIER_NAMES, TIER_ORDER as TIER_LIST } from "@/lib/rank";
import { cn } from "@/lib/utils";
import { Target, Trophy, Trash2, Flame, Crown, Zap } from "lucide-react";
import { ChampionIcon } from "@/components/ChampionIcon";
import { profileIconUrl, useDdragonVersion } from "@/lib/ddragon";

interface Props {
  accounts: Account[];
  recapTotal: Recap | null;
  onRefresh: () => void;
}

const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const TIER_ORDER: Record<string, number> = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9
};
const DIV_ORDER: Record<string, number> = {
  IV: 0, III: 1, II: 2, I: 3
};

/** Nombre de parties récentes moyennées pour estimer le LP net par partie. */
const GOAL_SAMPLE_GAMES = 5;

function getCumulativeLp(tier: string, division: string | null, lp: number): number {
  const t = tier.toUpperCase();
  const tVal = TIER_ORDER[t] ?? 0;
  const dVal = DIV_ORDER[division?.toUpperCase() || "IV"] ?? 0;
  if (tVal >= 7) {
    return 7000 + lp;
  }
  return tVal * 400 + dVal * 100 + lp;
}

function estimateMmr(tier: string, division: string | null, winrate: number | null): string {
  if (!tier || tier === "UNRANKED" || tier === "NONE") return "Unranked";
  const wr = winrate != null ? winrate : 50;
  const divisions = ["IV", "III", "II", "I"];
  const div = division || "IV";
  let divIndex = divisions.indexOf(div);

  if (wr >= 58) {
    divIndex += 2;
  } else if (wr >= 53) {
    divIndex += 1;
  } else if (wr <= 43) {
    divIndex -= 1;
  }

  let tierIndex = TIERS.indexOf(tier.toUpperCase());
  if (tierIndex === -1) return tier;

  if (divIndex > 3) {
    divIndex -= 4;
    tierIndex += 1;
  } else if (divIndex < 0) {
    divIndex += 4;
    tierIndex -= 1;
  }

  tierIndex = Math.max(0, Math.min(TIERS.length - 1, tierIndex));
  divIndex = Math.max(0, Math.min(3, divIndex));

  if (tierIndex >= 7) {
    return TIERS[tierIndex];
  }
  return `${TIERS[tierIndex]} ${divisions[divIndex]}`;
}

const ROLE_LABELS: Record<string, string> = {
  TOP: "🛡️ TOP",
  JUNGLE: "🌲 JGL",
  MIDDLE: "🔮 MID",
  BOTTOM: "🏹 ADC",
  UTILITY: "💚 SUP"
};

function DashboardAvatar({ iconId, initial, ring, className }: {
  iconId: number | null | undefined; initial: string; ring: string; className?: string;
}) {
  const ddVersion = useDdragonVersion();
  const [src, setSrc] = useState(
    iconId
      ? profileIconUrl(iconId, ddVersion)
      : avatarUrl(iconId ?? null, initial, ring)
  );

  useEffect(() => {
    if (iconId) setSrc(profileIconUrl(iconId, ddVersion));
  }, [iconId, ddVersion]);

  return (
    <img
      src={src}
      onError={() => {
        if (src.includes("ddragon")) {
          setSrc(avatarUrl(iconId ?? null, initial, ring));
        }
      }}
      alt=""
      className={className ?? "h-9 w-9 rounded-full border border-gold-dim"}
    />
  );
}

/** Score cumulé d'un point d'historique (même échelle que getCumulativeLp). */
function pointScore(p: RankHistoryPoint): number | null {
  if (!p.tier) return null;
  return getCumulativeLp(p.tier, p.division, p.lp);
}

function dayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function DashboardView({ accounts, recapTotal, onRefresh }: Props) {
  const { t, lang } = useI18n();
  const active = accounts.find((a) => a.active) ?? null;

  const [history, setHistory] = useState<RankHistoryPoint[]>([]);
  const [peak, setPeak] = useState<RankHistoryPoint | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalTier, setGoalTier] = useState("GOLD");
  const [goalDiv, setGoalDiv] = useState("IV");

  useEffect(() => {
    if (!active) return;
    api.getRankHistory(active.name)
      .then((r) => { setHistory(r.points || []); setPeak(r.peak); })
      .catch(() => { setHistory([]); setPeak(null); });
    api.getMatches(active.name).then(setMatches).catch(() => setMatches([]));
  }, [active?.name]);

  const handleSetGoal = async () => {
    if (!active) return;
    try {
      await api.setGoal(active.name, goalTier, goalDiv);
      setEditingGoal(false);
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveGoal = async () => {
    if (!active) return;
    try {
      await api.setGoal(active.name, null, null);
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  // ---- Analyses dérivées de l'historique local + des matchs en cache ----
  const analysis = useMemo(() => {
    const scored = history
      .map((p) => ({ ts: p.ts, score: pointScore(p), games: p.wins + p.losses }))
      .filter((p): p is { ts: number; score: number; games: number } => p.score !== null)
      .sort((a, b) => a.ts - b.ts);

    // Dernier score de chaque jour → deltas quotidiens
    const lastPerDay = new Map<string, { ts: number; score: number }>();
    for (const p of scored) lastPerDay.set(dayKey(p.ts), p);
    const days = [...lastPerDay.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const dailyDeltas: { day: string; delta: number }[] = [];
    for (let i = 1; i < days.length; i++) {
      dailyDeltas.push({ day: days[i][0], delta: days[i][1].score - days[i - 1][1].score });
    }

    const todayKey = dayKey(Date.now() / 1000);
    const historyTodayDelta = dailyDeltas.find((d) => d.day === todayKey)?.delta ?? null;

    // Séries de victoires (matchs classés en cache, du plus ancien au plus récent)
    const ordered = [...matches].sort((a, b) => a.ts - b.ts);
    let bestStreak = 0, run = 0;
    for (const m of ordered) {
      run = m.win ? run + 1 : 0;
      bestStreak = Math.max(bestStreak, run);
    }
    let currentStreak = 0;
    for (let i = ordered.length - 1; i >= 0 && ordered[i].win; i--) currentStreak++;

    // LP net moyen PAR PARTIE, sur les 5 dernières parties classées.
    //
    // Le compteur wins+losses du snapshot est ce qui identifie une vraie partie :
    // le rank_history est échantillonné périodiquement, donc la majorité des
    // couples de snapshots consécutifs sont séparés par ZÉRO partie. L'ancienne
    // version moyennait tous ces deltas, y compris les zéros, ce qui écrasait la
    // moyenne vers 0 et faisait exploser le nombre de parties estimé.
    const perGameDeltas: number[] = [];
    for (let i = 1; i < scored.length; i++) {
      const playedGames = scored[i].games - scored[i - 1].games;
      if (playedGames <= 0) continue;
      const diff = scored[i].score - scored[i - 1].score;
      // Garde-fou : au-delà de 200 LP par partie c'est un artefact (reset de
      // saison, resynchro Riot API), pas un gain réel.
      if (Math.abs(diff) / playedGames > 200) continue;
      // Un snapshot peut couvrir plusieurs parties : on répartit le delta.
      for (let g = 0; g < playedGames; g++) perGameDeltas.push(diff / playedGames);
    }
    const sample = perGameDeltas.slice(-GOAL_SAMPLE_GAMES);
    const avgNetLpPerGame = sample.length >= 2
      ? sample.reduce((s, d) => s + d, 0) / sample.length
      : null;
    const sampleSize = sample.length;

    // Rythme réel : parties jouées sur les 7 derniers jours
    const cutoff7d = Date.now() / 1000 - 7 * 86400;
    const gamesLast7d = matches.filter((m) => m.ts >= cutoff7d).length;
    const avgGamesPerDay = gamesLast7d > 0 ? gamesLast7d / 7 : null;

    return { historyTodayDelta, bestStreak, currentStreak, avgNetLpPerGame, sampleSize, avgGamesPerDay };
  }, [history, matches]);

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted px-6">
        <Zap className="h-9 w-9 text-gold-dim" />
        <p className="text-sm font-bold text-text">{t("dash.noActive")}</p>
        <p className="text-[11px] leading-relaxed max-w-xs">
          {t("dash.noActiveHint")}
        </p>
      </div>
    );
  }

  const info = rankInfo(active, lang);
  const queue = active.rank?.solo ?? active.rank?.flex ?? null;
  const wr = info.winrate != null ? Math.round(info.winrate) : null;
  const recap = active.recap ?? recapTotal;
  const todayLp = recap?.lp_delta ?? analysis.historyTodayDelta ?? 0;

  const currentLp = getCumulativeLp(info.tier || "IRON", queue?.division ?? "IV", info.lp || 0);
  const goal = active.goal ?? null;
  const goalLp = goal ? getCumulativeLp(goal.tier, goal.division || "IV", 0) : null;
  const goalTierName = goal
    ? ((TIER_NAMES[lang] ?? TIER_NAMES.fr)[goal.tier.toUpperCase()] ?? goal.tier).toUpperCase()
    : "";
  const gap = goalLp !== null ? goalLp - currentLp : null;
  const percent = goalLp ? Math.max(0, Math.min(100, Math.round((currentLp / goalLp) * 100))) : 0;
  // Halo près du but : 0 → 1 dans les 10 derniers % avant l'objectif.
  const haloIntensity = percent >= 90 ? (percent - 90) / 10 : 0;

  // Projection au rythme réel constaté : LP net moyen/partie (vrais deltas de
  // rank_history, pas une hypothèse fixe de +20) × rythme de jeu réel (parties
  // des 7 derniers jours). Repli sur l'ancienne estimation à +20 LP/victoire
  // nette si l'historique local est trop jeune pour être fiable.
  // Une moyenne nulle ou négative (série de défaites) ne permet aucune
  // projection : on retombe alors sur l'hypothèse générique de +20 LP, et le
  // libellé bascule sur « victoires estimées » pour ne pas afficher un rythme
  // qui n'existe pas.
  const netLpPerGame = analysis.avgNetLpPerGame && analysis.avgNetLpPerGame > 0
    ? analysis.avgNetLpPerGame
    : null;
  const gamesNeeded = gap !== null && gap > 0 ? Math.ceil(gap / (netLpPerGame ?? 20)) : 0;
  const daysNeeded = gamesNeeded > 0 && analysis.avgGamesPerDay
    ? Math.max(1, Math.ceil(gamesNeeded / analysis.avgGamesPerDay))
    : null;
  const isPreciseEstimate = netLpPerGame !== null;

  // Jalons : frontières de tiers (tous les 400 LP cumulés) entre 0 et l'objectif
  const milestones: { pos: number; tier: string; passed: boolean; next: boolean }[] = [];
  if (goalLp) {
    let nextFound = false;
    for (let b = 400; b < goalLp; b += 400) {
      const pos = (b / goalLp) * 100;
      if (pos < 6 || pos > 93) continue;
      const passed = currentLp >= b;
      const next = !passed && !nextFound;
      if (next) nextFound = true;
      milestones.push({ pos, tier: TIERS[Math.min(9, b / 400)], passed, next });
    }
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto px-1 py-1">
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes runicBreathe {
          0%, 100% { box-shadow: 0 0 4px rgba(200,170,110,0.3); }
          50% { box-shadow: 0 0 16px rgba(240,230,210,0.75); }
        }
        @keyframes runicSweep {
          0% { left: -80px; }
          100% { left: 110%; }
        }
        .runic-fill {
          position: relative;
          overflow: hidden;
          background: linear-gradient(90deg, #785a28, #c8aa6e);
          animation: runicBreathe 2.6s ease-in-out infinite;
        }
        .runic-fill::before {
          content: "";
          position: absolute;
          top: 0; bottom: 0;
          width: 70px;
          background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.7), rgba(255,255,255,0));
          animation: runicSweep 2.6s linear infinite;
        }
      `}} />

      {/* ---- Héros : compte connecté ---- */}
      {/* shrink-0 : sans lui les blocs (overflow-hidden) s'écrasent dans le flex
          column quand la fenêtre est petite et se chevauchent. */}
      <div className="relative shrink-0 overflow-hidden rounded-2xl border border-[#0ac8b9]/40 bg-gradient-to-r from-gold/10 via-[#0ac8b9]/5 to-[#0a1424]/60 p-3.5 shadow-[0_0_15px_rgba(10,200,185,0.12)]">
        <div className="absolute top-0 right-0 h-24 w-24 bg-gradient-to-br from-gold/10 to-transparent blur-xl pointer-events-none" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative h-12 w-12 shrink-0">
            <DashboardAvatar
              iconId={active.icon_id}
              initial={active.name[0]}
              ring="#3ddc97"
              className="h-12 w-12 rounded-full border-2 border-[#3ddc97]/70"
            />
            {active.level != null && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded border border-gold-dim bg-[#0a1428] px-1 text-[8px] font-bold text-gold">
                {active.level}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-bold text-sm truncate text-text">{active.riot_id || active.name}</h3>
              <span className="shrink-0 rounded-full border border-[#3ddc97]/40 bg-[#0e2a1e] px-1.5 py-0.5 text-[7.5px] font-extrabold uppercase tracking-wider text-green">
                {t("dash.connected")}
              </span>
            </div>
            <span className="text-[9px] text-muted uppercase tracking-wider">{active.region}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <img src={rankEmblemUrl(info.tier)} alt="" className="h-10 w-10" />
            <div>
              <div className="text-[12px] font-bold" style={{ color: info.color }}>{info.main}</div>
              <div className="text-[9.5px] text-muted leading-tight">
                {info.lp != null ? `${info.lp} LP` : t("dash.unranked")}
                {wr != null && ` · ${wr}% WR`}
              </div>
              {info.tier && info.tier !== "UNRANKED" && (
                <div className="text-[8.5px] text-[#0ac8b9] font-bold leading-tight uppercase tracking-wide select-none">
                  MMR : {estimateMmr(info.tier, queue?.division ?? "IV", wr)}
                </div>
              )}
            </div>
          </div>

          {active.most_played_champ && (
            <div className="hidden sm:flex items-center shrink-0" title={t("dash.mostPlayed", { champ: active.most_played_champ })}>
              <ChampionIcon
                champion={active.most_played_champ}
                className="h-8 w-8 rounded-full border border-gold-dim text-[10px]"
              />
            </div>
          )}
        </div>

        {/* Récap session + MVP + rôles */}
        <div className="mt-2.5 pt-2.5 border-t border-border/15 flex flex-wrap items-center gap-2">
          <span className={cn(
            "text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 whitespace-nowrap",
            todayLp >= 0 ? "border-green/30 bg-[#0e2a1e] text-green" : "border-red/30 bg-[#2a0e10] text-red"
          )}>
            {todayLp >= 0 ? "+" : ""}{todayLp} LP {recap ? `· ${recap.wins}${wlLetters(lang).w} - ${recap.losses}${wlLetters(lang).l}` : ""} {t("dash.today")}
          </span>
          {analysis.currentStreak >= 2 && (
            <span className="flex items-center gap-1 text-[9.5px] font-bold text-gold-bright bg-gold/10 border border-gold/30 px-2 py-0.5 rounded-full select-none">
              <Flame className="h-3 w-3 text-red" />
              {t("dash.winStreak", { n: analysis.currentStreak })}
            </span>
          )}
          {active.mvp_today && (
            <span className="flex items-center gap-1 text-[9px] text-muted bg-gold/5 border border-gold/25 px-2 py-0.5 rounded-full select-none">
              <span className="text-gold-bright">👑 {t("dashboard.mvp")} :</span>
              <span className="text-text font-bold truncate">{active.mvp_today.champion}</span>
            </span>
          )}
          {active.roles_today && Object.entries(active.roles_today).map(([role, stats]: [string, any]) => (
            <span key={role} className="text-[8.5px] bg-card border border-border px-1.5 py-0.5 rounded text-muted font-bold select-none">
              {ROLE_LABELS[role] || role} : <span className="text-text">{stats.wins}/{stats.games}</span>
            </span>
          ))}
        </div>
      </div>

      {/* ---- Barre de progression vers l'objectif (pulsation runique) ---- */}
      <div className="relative shrink-0 rounded-2xl border border-gold-dim bg-[#0a1220]/80 p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4.5 w-4.5 text-gold animate-pulse" />
            <h3 className="text-[12px] font-bold text-gold-bright tracking-wider uppercase">
              {t("goal.progress")}
            </h3>
          </div>
          {goal ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-text">
                {t("goal.label")} <span className="text-gold uppercase">{goalTierName} {goal.division}</span>
              </span>
              <button
                onClick={handleRemoveGoal}
                title={t("goal.remove")}
                className="text-red/60 hover:text-red hover:bg-red/10 rounded p-1 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>

        {goal && goalLp ? (
          <>
            <div className="flex items-center justify-between text-[9.5px] font-bold text-muted select-none mb-1">
              <span>{t("dashboard.goalDistance")}</span>
              <span className="text-gold-bright">
                {percent}% · {gap !== null && gap > 0 ? t("dashboard.goalRemaining", { lp: gap }) : t("dashboard.goalReached")}
              </span>
            </div>

            {/* La barre — jalons de tiers au-dessus, remplissage runique */}
            <div className="relative pt-5 pb-1">
              {milestones.map((m) => (
                <img
                  key={m.pos}
                  src={rankEmblemUrl(m.tier)}
                  alt={m.tier}
                  title={m.tier}
                  className={cn(
                    "absolute top-0 h-5 w-5 -translate-x-1/2 transition-all duration-500",
                    m.passed
                      ? "opacity-100 drop-shadow-[0_0_5px_rgba(240,230,210,0.8)]"
                      : m.next
                        ? "opacity-70 animate-pulse"
                        : "opacity-30 grayscale"
                  )}
                  style={{ left: `${m.pos}%` }}
                />
              ))}
              <img
                src={rankEmblemUrl(goal.tier)}
                alt={goal.tier}
                title={`${t("goal.label")} ${goalTierName} ${goal.division}`}
                className={cn(
                  "absolute top-0 right-0 h-5 w-5",
                  percent >= 100 ? "drop-shadow-[0_0_6px_rgba(240,230,210,0.9)]" : "opacity-80"
                )}
              />

              <div className="h-4 w-full bg-[#050b14] rounded-full overflow-hidden border border-gold-dim/40 relative">
                {milestones.map((m) => (
                  <div
                    key={`tick-${m.pos}`}
                    className="absolute top-0 bottom-0 w-px bg-gold-dim/40"
                    style={{ left: `${m.pos}%` }}
                  />
                ))}
                <div
                  className="h-full rounded-full runic-fill"
                  style={{ width: `${percent}%`, transition: "width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                />
              </div>

              {/* Halo près du but : grossit et déborde légèrement de la barre
                  dans les 10 derniers % avant l'objectif — signal d'anticipation.
                  Sibling (pas enfant) de la piste car celle-ci a overflow-hidden ;
                  top:28px = pt-5 (20px) + moitié de la piste h-4 (8px), son centre vertical. */}
              {haloIntensity > 0 && (
                <div
                  className="pointer-events-none absolute rounded-full"
                  style={{
                    top: "28px",
                    left: `${percent}%`,
                    width: `${8 + haloIntensity * 22}px`,
                    height: `${8 + haloIntensity * 22}px`,
                    transform: "translate(-50%, -50%)",
                    background: "radial-gradient(circle, rgba(240,230,210,0.9) 0%, rgba(200,170,110,0.5) 45%, rgba(200,170,110,0) 75%)",
                    filter: `blur(${2 + haloIntensity * 3}px)`,
                    opacity: 0.55 + haloIntensity * 0.45,
                    transition: "all 1s ease",
                  }}
                />
              )}
            </div>

            {gap !== null && gap > 0 && (
              <div
                className="text-[9px] text-muted leading-none select-none mt-1"
                title={isPreciseEstimate
                  ? t("dash.paceBasis", { n: analysis.sampleSize, lp: Math.round(netLpPerGame!) })
                  : undefined}
              >
                {isPreciseEstimate ? (
                  <>
                    {t(gamesNeeded > 1 ? "dash.paceGames" : "dash.paceGame", { n: gamesNeeded })}
                    {daysNeeded ? t(daysNeeded > 1 ? "dash.paceDays" : "dash.paceDay", { n: daysNeeded }) : ""}
                  </>
                ) : (
                  t("dashboard.estimateWins", { n: gamesNeeded })
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="flex items-center gap-1.5 text-[10.5px] text-muted italic">
              <Target className="h-3.5 w-3.5 text-gold-dim" /> {t("goal.none")}
            </span>
            {editingGoal ? (
              <div className="flex items-center gap-1 bg-[#0d1624] border border-gold-dim/40 rounded px-1.5 py-1">
                <select
                  value={goalTier}
                  onChange={(e) => setGoalTier(e.target.value)}
                  className="bg-transparent text-gold font-bold outline-none border-none text-[9px] cursor-pointer"
                >
                  {TIER_LIST.map((tier) => (
                    <option key={tier} value={tier}>
                      {(TIER_NAMES[lang] ?? TIER_NAMES.fr)[tier].toUpperCase()}
                    </option>
                  ))}
                </select>
                <select
                  value={goalDiv}
                  onChange={(e) => setGoalDiv(e.target.value)}
                  className="bg-transparent text-gold font-bold outline-none border-none text-[9px] cursor-pointer"
                >
                  <option value="I">I</option>
                  <option value="II">II</option>
                  <option value="III">III</option>
                  <option value="IV">IV</option>
                </select>
                <button
                  onClick={handleSetGoal}
                  className="bg-gold hover:bg-gold-bright text-black font-extrabold text-[8px] rounded px-1.5 py-0.5 ml-1 transition-colors uppercase"
                >
                  OK
                </button>
                <button
                  onClick={() => setEditingGoal(false)}
                  className="text-muted hover:text-text text-[8px] rounded px-1.5 py-0.5 transition-colors"
                >
                  X
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingGoal(true)}
                className="text-gold hover:text-gold-bright font-bold uppercase tracking-wider text-[8px] border border-gold/30 hover:border-gold px-2 py-0.5 rounded-full transition-all duration-300 hover:bg-gold/5"
              >
                {t("goal.set")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---- Records personnels ---- */}
      <div className="grid shrink-0 grid-cols-2 gap-2.5 pb-2">
        <div className="rounded-2xl border border-border bg-[#0a1220]/60 p-3 flex flex-col items-center text-center gap-1">
          <Flame className="h-4 w-4 text-red" />
          <span className="text-[13px] font-extrabold text-gold-bright">{analysis.bestStreak || "--"}</span>
          <span className="text-[8.5px] text-muted uppercase tracking-wider leading-tight">{t("dash.bestStreak")}</span>
        </div>
        <div className="rounded-2xl border border-border bg-[#0a1220]/60 p-3 flex flex-col items-center text-center gap-1">
          <Crown className="h-4 w-4 text-gold" />
          {peak && peak.tier ? (
            <span className="flex items-center gap-1 text-[11px] font-extrabold text-gold-bright">
              <img src={rankEmblemUrl(peak.tier)} alt="" className="h-4 w-4" />
              {peak.tier} {peak.division || ""}
            </span>
          ) : (
            <span className="text-[13px] font-extrabold text-gold-bright">--</span>
          )}
          <span className="text-[8.5px] text-muted uppercase tracking-wider leading-tight">{t("dash.peakTracked")}</span>
        </div>
      </div>
    </div>
  );
}
