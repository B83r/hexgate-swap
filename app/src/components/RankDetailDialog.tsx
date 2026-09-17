import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover as PopoverPrimitive } from "radix-ui";
import { AlertTriangle, Check, RotateCw, Trophy, Share2, Swords } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { api, rankEmblemUrl, type Account, type ChampSelectPrefs, type RankHistoryPoint } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  TIER_COLORS,
  TIER_ORDER,
  NO_DIVISION,
  ladderLp,
  rankLabel,
  estimateMmr,
  wlLetters,
} from "@/lib/rank";

/** Blob → base64 nu (sans le préfixe `data:image/png;base64,`). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Rang nullable minimal requis pour afficher une stat footer (Peak/MMR). */
type NullableRank = { tier: string | null; division: string | null; lp: number };

/** Libellé court « division – LP » (le tier est porté par l'emblème à côté). */
function shortRank(r: NullableRank): string {
  if (!r.tier) return "—";
  const div = NO_DIVISION.has(r.tier) ? "" : `${r.division ?? ""} `;
  return `${div}– ${r.lp} LP`;
}

interface HistoryData {
  points: RankHistoryPoint[];
  peak: RankHistoryPoint | null;
  trend_7d: number | null;
  riot_last_sync: number | null;
  riot_cooldown_remaining: number;
}

/** Formatte une durée (secondes) en unité courte h/j — même abréviation dans
 * toutes les langues supportées (compact, compréhensible sans traduction). */
function formatDuration(seconds: number): string {
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hours = Math.ceil(seconds / 3600);
  if (hours < 24) return `${hours} h`;
  return `${Math.ceil(hours / 24)} j`;
}

function formatAgo(tsSeconds: number): string {
  const elapsed = Date.now() / 1000 - tsSeconds;
  if (elapsed < 3600) return `${Math.max(1, Math.round(elapsed / 60))}min`;
  if (elapsed < 86400) return `${Math.round(elapsed / 3600)}h`;
  return `${Math.round(elapsed / 86400)}j`;
}

interface Props {
  account: Account | null;
  onClose: () => void;
}

/** Détail du rang SoloQ d'un compte, calqué sur les overlays de tracker (Porofessor,
 * op.gg…) : emblème + LP, classement ladder, graphe de progression avec l'échelle de
 * tiers en axe vertical, puis pic et MMR. Riot n'exposant via son API locale ni le
 * vrai classement ladder ni le MMR, ces deux stats sont des ESTIMATIONS honnêtes
 * (détaillées dans le « ? »), tandis que le pic est réellement suivi localement. */
function RankProgressBar({ tier, division, lp }: { tier: string | null; division: string | null; lp: number }) {
  if (!tier || !division || ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier)) {
    return null;
  }

  const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
  const DIVISIONS = ["IV", "III", "II", "I"];
  
  const tierIdx = TIERS.indexOf(tier);
  const divIdx = DIVISIONS.indexOf(division);
  if (tierIdx === -1 || divIdx === -1) return null;

  const shortTier = tier.charAt(0);
  const nodes = [];

  for (let i = 0; i < 4; i++) {
    nodes.push({ label: `${shortTier}${4 - i}`, state: i <= divIdx ? "passed" : i === divIdx + 1 ? "next" : "locked" });
  }
  
  if (tierIdx < TIERS.length - 1) {
    nodes.push({ label: `${TIERS[tierIdx + 1].charAt(0)}4`, state: divIdx === 3 ? "next" : "locked" });
  } else {
    nodes.push({ label: "M", state: divIdx === 3 ? "next" : "locked" });
  }

  // Position du point actuel proportionnellement aux LP (0 à 100)
  // LP peut parfois dépasser 100 visuellement si c'est la promo, on limite à 99% du segment
  const safeLp = Math.max(0, Math.min(99, lp));
  const progressPct = ((divIdx + (safeLp / 100)) / (nodes.length - 1)) * 100;

  return (
    <div className="relative mt-4 mb-5 flex w-full items-center justify-between">
      {/* Ligne de fond */}
      <div className="absolute left-3 right-3 top-2 h-1.5 -translate-y-1/2 rounded-full bg-[#1b2942]" />
      
      {/* Ligne remplie */}
      <motion.div 
        className="absolute left-3 top-2 h-1.5 -translate-y-1/2 rounded-full bg-[#209b58]"
        initial={{ width: 0 }}
        animate={{ width: `calc((100% - 24px) * ${progressPct / 100})` }}
        transition={{ duration: 1, ease: "easeOut" }}
      />

      {/* Curseur absolu indiquant le rang et les LP exacts */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.5, type: "spring" }}
        className="absolute top-2 z-20 flex flex-col items-center -translate-y-1/2 -translate-x-1/2"
        style={{ left: `calc(12px + (100% - 24px) * ${progressPct / 100})` }}
      >
        <div className="absolute -top-4 text-[#209b58] text-[10px]">▼</div>
        <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#209b58] bg-[#209b58] shadow-[0_0_12px_rgba(32,155,88,0.9)]">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </div>
      </motion.div>

      {/* Noeuds fixes d'intervalles */}
      {nodes.map((node, i) => {
        const isPassed = node.state === "passed";
        const isNext = node.state === "next";
        return (
          <div key={i} className="relative z-10 flex w-6 flex-col items-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.1, type: "spring" }}
              className={`mt-0.5 flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] ${
                isPassed
                  ? "border-[#209b58] bg-[#209b58]"
                  : isNext
                  ? "border-[#0ac8b9] bg-white shadow-[0_0_12px_rgba(10,200,185,1)]"
                  : "border-[#1b2942] bg-[#0a1220]"
              }`}
            />
            
            <span className={`mt-2.5 text-[11px] font-bold ${
              isPassed ? "text-[#209b58]" : isNext ? "text-[#0ac8b9]" : "text-muted"
            }`}>
              {node.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function RankDetailDialog({ account, onClose }: Props) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<HistoryData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!account) {
      setData(null);
      return;
    }
    let cancelled = false;
    setData(null);
    setErr(null);
    api
      .getRankHistory(account.name)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {
        if (!cancelled) {
          setData({ points: [], peak: null, trend_7d: null, riot_last_sync: null, riot_cooldown_remaining: 0 });
        }
      });
    return () => {
      cancelled = true;
    };
    // keyed sur le nom (primitif stable), pas l'objet account : App.tsx recrée
    // un nouvel objet Account à chaque `accounts_changed` (poll de rang en
    // arrière-plan sur n'importe quel compte), ce qui redéclenchait cet effet
    // et refetchait l'historique en boucle pour rien tant que le dialog reste ouvert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.name]);

  async function handleRefresh() {
    if (!account || busy) return;
    const cooldown = data?.riot_cooldown_remaining ?? 0;
    if (cooldown > 0) return;
    const name = account.name;
    const before = data?.points.length ?? 0;
    setBusy(true);
    setErr(null);
    try {
      await api.refreshRiot(name);
      // le sync est asynchrone côté serveur (Match-V5 = plusieurs appels) :
      // on sonde l'historique jusqu'à ce qu'il grandisse ou expire le timeout.
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const d = await api.getRankHistory(name);
        if (d.points.length > before || d.riot_last_sync !== data?.riot_last_sync) {
          setData(d);
          return;
        }
      }
      setData(await api.getRankHistory(name));
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : t("rank.refreshError"));
    } finally {
      setBusy(false);
    }
  }

  const solo = account?.rank?.solo ?? null;
  const total = solo ? solo.wins + solo.losses : 0;
  const winrate = solo && total ? solo.wins / total : null;
  const wrPct = winrate !== null ? Math.round(winrate * 100) : null;

  const mmr = solo ? estimateMmr(solo.tier, solo.division, solo.lp, winrate) : null;
  const peakRank: NullableRank | null = data?.peak
    ? { tier: data.peak.tier, division: data.peak.division, lp: data.peak.lp }
    : null;

  const soloColor = solo ? TIER_COLORS[solo.tier] ?? "#7c8aa0" : "#7c8aa0";

  const handleShareAction = async (mode: "copy" | "download") => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 420;
    const ctx = canvas.getContext("2d");
    if (!ctx || !solo) return;

    // 1. Draw Background Gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 420);
    grad.addColorStop(0, "#0a1424");
    grad.addColorStop(1, "#02070e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 420);

    // 2. Draw border
    ctx.strokeStyle = "#c8aa6e"; // Hextech Gold
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 580, 400);
    
    // Inner gold line
    ctx.strokeStyle = "#785a28";
    ctx.lineWidth = 1;
    ctx.strokeRect(16, 16, 568, 388);

    // 3. Draw Title / Header
    ctx.fillStyle = "#f0e6d2";
    ctx.font = "bold 20px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(t("rank.cardTitle"), 300, 52);

    // 4. Draw Account details (Riot ID)
    ctx.fillStyle = "#ffffff";
    ctx.font = "extrabold 32px Segoe UI";
    ctx.fillText(account?.riot_id || account?.name || "", 300, 110);

    // 5. Draw Rank Emblem & Stats
    ctx.fillStyle = "#0ac8b9"; // Cyan accent
    ctx.font = "bold 24px Segoe UI";
    const rankName = rankLabel(solo.tier, solo.division, lang);
    ctx.fillText(`${rankName} – ${solo.lp} LP`, 300, 155);

    // Winrate
    const totalGames = solo.wins + solo.losses;
    const winratePct = totalGames > 0 ? Math.round((solo.wins / totalGames) * 100) : 0;
    ctx.fillStyle = "#809bbd";
    ctx.font = "600 17px Segoe UI";
    ctx.fillText(`${solo.wins} ${wlLetters(lang).w}  /  ${solo.losses} ${wlLetters(lang).l}  (${winratePct}%)`, 300, 195);

    // Peak Rank & MMR
    ctx.fillStyle = "#f0e6d2";
    ctx.font = "bold 15px Segoe UI";
    const peakLabelStr = t("rank.cardPeak", { rank: shortRank(data?.peak || { tier: solo.tier, division: solo.division, lp: solo.lp }) });
    ctx.fillText(peakLabelStr, 300, 235);

    const mmrEstimate = estimateMmr(solo.tier, solo.division, solo.lp, totalGames > 0 ? solo.wins / totalGames : 0.5);
    ctx.fillText(t("rank.cardMmr", { rank: rankLabel(mmrEstimate.tier, mmrEstimate.division, lang) }), 300, 265);

    // 6. Draw Footer branding
    ctx.fillStyle = "#785a28";
    ctx.font = "600 12px Segoe UI";
    ctx.fillText(t("rank.cardFooter"), 300, 385);

    // Try to load rank emblem to draw it!
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = rankEmblemUrl(solo.tier);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        setTimeout(reject, 1000);
      });
      ctx.drawImage(img, 260, 280, 80, 80);
    } catch {
      ctx.fillStyle = "#c8aa6e";
      ctx.beginPath();
      ctx.arc(300, 320, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      if (mode === "copy") {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          toast.success(t("rank.cardCopied"));
        } catch {
          toast.error(t("rank.cardClipboardFail"));
        }
      } else {
        // Dans une webview Tauri, `<a download>` écrit sans rien demander (ou
        // ne fait rien du tout) : on passe par le backend, qui ouvre le vrai
        // sélecteur de fichiers Windows et gère PNG comme JPEG.
        try {
          const base64 = await blobToBase64(blob);
          const res = await api.saveImage(`${account?.name || "hexgate"}-profile.png`, base64);
          if (res.cancelled) toast(t("rank.imgCancelled"));
          else if (res.ok) toast.success(t("rank.cardSaved"));
          else toast.error(t("rank.cardClipboardFail"));
        } catch {
          toast.error(t("rank.cardClipboardFail"));
        }
      }
    }, "image/png");
  };

  return (
    <Dialog open={account !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="gap-0 overflow-hidden rounded-2xl border border-white/10 bg-[#060c16]/70 backdrop-blur-3xl shadow-[0_0_40px_rgba(0,0,0,0.8)] p-0 text-text sm:max-w-[352px]"
      >
        <div className="absolute inset-0 z-[-1] pointer-events-none opacity-[0.03]" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')" }} />
        {account && (
          <div className="max-h-[82vh] overflow-y-auto">
            <DialogTitle className="sr-only">
              {account.riot_id || account.name}
            </DialogTitle>

            {!solo ? (
              <div className="px-5 py-10">
                <DialogHeader>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                    <Trophy className="h-3.5 w-3.5 text-gold" /> {t("rank.classedSolo")}
                  </div>
                </DialogHeader>
                <p className="pt-6 text-center text-[13px] text-muted">
                  {t("rank.notRanked")}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3.5 px-5 pt-5">
                  {/* En-tête « Classé Solo » */}
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                    <Trophy className="h-3.5 w-3.5 text-gold" /> {t("rank.classedSolo")}
                  </div>

                  {/* Emblème + rang + winrate */}
                  <div className="flex items-center gap-4">
                    <img
                      src={rankEmblemUrl(solo.tier)}
                      alt=""
                      className="h-14 w-14 shrink-0 drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
                    />
                    <div className="min-w-0">
                      <div
                        className="truncate text-[20px] font-extrabold uppercase leading-tight tracking-tight"
                        style={{ color: soloColor }}
                      >
                        {rankLabel(solo.tier, solo.division, lang)} – {solo.lp} LP
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[13px] font-bold">
                        <motion.span
                          animate={{ textShadow: ["0px 0px 8px rgba(61,220,151,0.7)", "0px 0px 24px rgba(61,220,151,1)", "0px 0px 8px rgba(61,220,151,0.7)"] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                          className="text-[#3ddc97]"
                        >
                          {solo.wins} W
                        </motion.span>
                        <span className="text-muted/40">|</span>
                        <motion.span
                          animate={{ textShadow: ["0px 0px 8px rgba(224,92,92,0.7)", "0px 0px 24px rgba(224,92,92,1)", "0px 0px 8px rgba(224,92,92,0.7)"] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.75 }}
                          className="text-[#e05c5c]"
                        >
                          {solo.losses} L
                        </motion.span>
                        {wrPct !== null && (
                          <span className="ml-1 text-muted">
                            ({wrPct}%)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <RankProgressBar tier={solo.tier} division={solo.division} lp={solo.lp} />

                  {/* Graphe de progression */}
                  {data && data.points.length >= 2 ? (
                    <RankGraph points={data.points} />
                  ) : (
                    <p className="rounded-lg border border-dashed border-border py-8 text-center text-[11px] text-muted">
                      {t("rank.notEnough")}
                    </p>
                  )}

                  {/* Rafraîchir le cache Riot API (auto-rempli à l'ajout du compte,
                      throttlé côté serveur à une fois par 24h) */}
                  {(() => {
                    const cooldown = data?.riot_cooldown_remaining ?? 0;
                    const onCooldown = cooldown > 0;
                    return (
                      <>
                        <button
                          type="button"
                          onClick={handleRefresh}
                          disabled={busy || onCooldown}
                          title={onCooldown ? t("rank.refreshCooldown", { h: formatDuration(cooldown) }) : undefined}
                          className="flex items-center justify-center gap-1.5 rounded-lg border border-[#1b2942] bg-[#111f34] py-2 text-[11px] font-semibold text-muted transition hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RotateCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                          {busy
                            ? t("rank.refreshing")
                            : onCooldown
                              ? t("rank.refreshCooldown", { h: formatDuration(cooldown) })
                              : t("rank.refresh")}
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleShareAction("copy")}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-[#1b2942] bg-[#111f34] py-2 text-[10px] font-bold text-muted transition hover:border-gold/50 hover:text-gold"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {t("rank.copyCard")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShareAction("download")}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-[#1b2942] bg-[#111f34] py-2 text-[10px] font-bold text-muted transition hover:border-gold/50 hover:text-gold"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            {t("rank.saveCard")}
                          </button>
                        </div>
                        <p className="-mt-1.5 text-center text-[10px] text-muted/70">
                          {data?.riot_last_sync
                            ? t("rank.lastSync", { time: formatAgo(data.riot_last_sync) })
                            : t("rank.neverSynced")}
                        </p>
                      </>
                    );
                  })()}
                  {err && (
                    <p className="-mt-1.5 text-center text-[10.5px] text-red-400">{err}</p>
                  )}
                </div>

                {/* Barre footer : PEAK · MMR · aide */}
                <div className="mt-3.5 flex items-stretch bg-[#0a1220] text-[12px]">
                  <FooterStat label={t("rank.peak")} rank={peakRank} />
                  <div className="my-2 w-px bg-[#1b2942]" />
                  <FooterStat label={t("rank.mmr")} rank={mmr} />
                  <HelpButton />
                </div>
              </>
            )}

            <PositionPrefsSection account={account} />
            <ChampSelectPrefsSection account={account} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const POSITION_OPTIONS = [
  { value: "", label: "rank.posNone" },
  { value: "TOP", label: "Top" },
  { value: "JUNGLE", label: "Jungle" },
  { value: "MIDDLE", label: "Mid" },
  { value: "BOTTOM", label: "Bot" },
  { value: "UTILITY", label: "Support" },
];

/** Rôles préférés appliqués automatiquement (position-preferences LCU) juste
 * avant de rejoindre la file, à chaque swap vers ce compte. */
function PositionPrefsSection({ account }: { account: Account }) {
  const { t } = useI18n();
  const [first, setFirst] = useState(account.position_prefs?.first ?? "");
  const [second, setSecond] = useState(account.position_prefs?.second ?? "");

  useEffect(() => {
    setFirst(account.position_prefs?.first ?? "");
    setSecond(account.position_prefs?.second ?? "");
  }, [account.name, account.position_prefs]);

  const save = async (f: string, s: string) => {
    setFirst(f);
    setSecond(s);
    try {
      await api.setPositionPrefs(account.name, f || null, s || null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-5 mt-3.5 flex items-center gap-2 rounded-xl border border-[#1b2942] bg-[#0a1220] px-3.5 py-3">
      <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted shrink-0">{t("rank.preQueueRoles")}</span>
      <select
        value={first}
        onChange={(e) => save(e.target.value, second)}
        className="h-7 flex-1 rounded-md border border-gold-dim/30 bg-panel px-1.5 text-[10.5px] text-text outline-none focus:border-gold cursor-pointer"
      >
        {POSITION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.value === "" ? t(o.label) : o.label}</option>
        ))}
      </select>
      <select
        value={second}
        onChange={(e) => save(first, e.target.value)}
        className="h-7 flex-1 rounded-md border border-gold-dim/30 bg-panel px-1.5 text-[10.5px] text-text outline-none focus:border-gold cursor-pointer"
      >
        {POSITION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.value === "" ? t(o.label) : o.label}</option>
        ))}
      </select>
    </div>
  );
}

const ROLES: { key: string; label: string }[] = [
  { key: "TOP", label: "Top" },
  { key: "JUNGLE", label: "Jungle" },
  { key: "MIDDLE", label: "Mid" },
  { key: "BOTTOM", label: "Bot" },
  { key: "UTILITY", label: "Support" },
];

const EMPTY_PREFS: ChampSelectPrefs = {
  auto_declare_intent: false,
  auto_pick: false,
  auto_ban: false,
  priority_by_role: { TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [], ANY: [] },
  ban_priority: [],
  chat_message_enabled: false,
  chat_message: "",
};

function toCsv(list: string[] | undefined): string {
  return (list || []).join(", ");
}

function fromCsv(csv: string): string[] {
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Section « Champ select » : auto-déclaration d'intention, auto-pick/ban par
 * rôle, chat prédéfini — persistés par compte (meta.json["champ_select"]). */
function ChampSelectPrefsSection({ account }: { account: Account }) {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<ChampSelectPrefs>(account.champ_select ?? EMPTY_PREFS);
  const [saving, setSaving] = useState(false);
  // Miroir synchrone de l'état : les `onBlur` des champs texte et les `onChange`
  // des cases peuvent se suivre dans le même cycle React. En repartant de
  // `prefs` (figé au rendu), la seconde écriture écrasait la première — c'est
  // ce qui laissait « message de chat activé » avec un message vide.
  const prefsRef = useRef(prefs);

  useEffect(() => {
    const next = account.champ_select ?? EMPTY_PREFS;
    prefsRef.current = next;
    setPrefs(next);
  }, [account.name, account.champ_select]);

  const save = async (patch: Partial<ChampSelectPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    setSaving(true);
    try {
      await api.setChampSelectPrefs(account.name, next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: "auto_declare_intent" | "auto_pick" | "auto_ban" | "chat_message_enabled") => {
    save({ [key]: !prefsRef.current[key] });
  };

  const noChampPriority = Object.values(prefs.priority_by_role || {}).every((l) => !l?.length);
  const emptyAutomations = [
    prefs.auto_declare_intent && noChampPriority ? t("rank.autoIntent") : null,
    prefs.auto_pick && noChampPriority ? t("rank.autoPick") : null,
    prefs.auto_ban && !prefs.ban_priority?.length ? t("rank.autoBan") : null,
    prefs.chat_message_enabled && !prefs.chat_message.trim() ? t("rank.autoChatMsg") : null,
  ].filter((v): v is string => v !== null);

  return (
    <div className="mx-5 mt-3.5 mb-4 flex flex-col gap-2.5 rounded-xl border border-[#1b2942] bg-[#0a1220] px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
        <Swords className="h-3.5 w-3.5 text-hextech-blue" /> {t("rank.champSelectAuto")}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-text select-none">
          <input type="checkbox" checked={prefs.auto_declare_intent} onChange={() => toggle("auto_declare_intent")} className="h-3.5 w-3.5 accent-hextech-blue" />
          {t("rank.autoIntent")}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-text select-none">
          <input type="checkbox" checked={prefs.auto_pick} onChange={() => toggle("auto_pick")} className="h-3.5 w-3.5 accent-gold" />
          {t("rank.autoPick")}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-text select-none">
          <input type="checkbox" checked={prefs.auto_ban} onChange={() => toggle("auto_ban")} className="h-3.5 w-3.5 accent-red" />
          {t("rank.autoBan")}
        </label>
      </div>

      {/* Une automatisation cochée mais sans champion à jouer ne fait
          strictement rien : sans ce rappel, elle passe pour cassée. */}
      {emptyAutomations.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-gold-dim/40 bg-gold/5 px-2 py-1.5 text-[9.5px] leading-snug text-gold-dim">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>{t("rank.autoEmpty", { list: emptyAutomations.join(", ") })}</span>
        </div>
      )}

      {(prefs.auto_declare_intent || prefs.auto_pick) && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[9.5px] text-muted">{t("rank.champPriority")}</span>
          {ROLES.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[9.5px] font-bold text-gold-dim">{r.label}</span>
              <input
                type="text"
                defaultValue={toCsv(prefs.priority_by_role?.[r.key])}
                placeholder={t("rank.phChamps")}
                onBlur={(e) =>
                  save({
                    priority_by_role: {
                      ...prefsRef.current.priority_by_role,
                      [r.key]: fromCsv(e.target.value),
                    },
                  })
                }
                className="h-7 flex-1 rounded-md border border-gold-dim/30 bg-panel px-2 text-[10.5px] text-text outline-none focus:border-gold"
              />
            </div>
          ))}
        </div>
      )}

      {prefs.auto_ban && (
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[9.5px] font-bold text-red/80">{t("rank.banPriority")}</span>
          <input
            type="text"
            defaultValue={toCsv(prefs.ban_priority)}
            placeholder={t("rank.phBans")}
            onBlur={(e) => save({ ban_priority: fromCsv(e.target.value) })}
            className="h-7 flex-1 rounded-md border border-gold-dim/30 bg-panel px-2 text-[10.5px] text-text outline-none focus:border-gold"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-[#1b2942] pt-2.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-text select-none">
          <input type="checkbox" checked={prefs.chat_message_enabled} onChange={() => toggle("chat_message_enabled")} className="h-3.5 w-3.5 accent-hextech-blue" />
          {t("rank.autoChatMsg")}
        </label>
        {prefs.chat_message_enabled && (
          <input
            type="text"
            defaultValue={prefs.chat_message}
            placeholder={t("rank.phChatMsg")}
            onBlur={(e) => save({ chat_message: e.target.value })}
            className="h-7 rounded-md border border-gold-dim/30 bg-panel px-2 text-[10.5px] text-text outline-none focus:border-gold"
          />
        )}
      </div>

      {saving && <span className="text-[9px] text-muted">{t("rank.saving")}</span>}
    </div>
  );
}

function FooterStat({
  label,
  rank,
}: {
  label: string;
  rank: NullableRank | null;
}) {
  return (
    <div className="flex flex-1 items-center gap-2 px-3.5 py-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {rank && rank.tier ? (
        <span className="flex items-center gap-1.5">
          <img src={rankEmblemUrl(rank.tier)} alt="" className="h-5 w-5 shrink-0" />
          <span className="font-bold text-text/90">{shortRank(rank)}</span>
        </span>
      ) : (
        <span className="text-muted">—</span>
      )}
    </div>
  );
}

/** Bulle d'aide : s'ouvre au CLIC (Popover porté, jamais au survol), et se ferme
 * au clic extérieur / Échap — corrige l'ancien tooltip qui s'ouvrait tout seul. */
function HelpButton() {
  const { t } = useI18n();
  return (
    <div className="flex items-center pr-3.5">
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-border-hover text-[10px] font-bold text-muted transition-colors hover:border-gold hover:text-gold data-[state=open]:border-gold data-[state=open]:text-gold"
            aria-label={t("rank.helpAria")}
          >
            ?
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="top"
            align="end"
            sideOffset={6}
            collisionPadding={10}
            className="z-50 w-64 rounded-lg border border-gold-dim/60 bg-panel p-3 text-[10.5px] leading-snug text-muted shadow-xl shadow-black/50 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            {t("rank.help")}
            <PopoverPrimitive.Arrow className="fill-panel" />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}

function bezierPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cp1x = p0.x + (p1.x - p0.x) / 3;
    const cp1y = p0.y;
    const cp2x = p0.x + 2 * (p1.x - p0.x) / 3;
    const cp2y = p1.y;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function RankGraph({ points }: { points: RankHistoryPoint[] }) {
  const { t, lang } = useI18n();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const W = 312;
  const H = 154; // Agrandit pour les dates
  const AXIS_X = 13;
  const PLOT_L = 30;
  const PLOT_R = W - 6;
  const PLOT_T = 8;
  const PLOT_B = H - 24; // Libère 24px en bas

  const scores = points.map((p) => ladderLp(p.tier, p.division, p.lp) ?? 0);
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);

  const minTs = Math.min(...points.map((p) => p.ts));
  const maxTs = Math.max(...points.map((p) => p.ts));
  const timeSpan = Math.max(0, maxTs - minTs);
  let startLabel = "";
  if (timeSpan > 0) {
    const days = Math.round(timeSpan / 86400);
    startLabel = days === 0 ? "Il y a <24h" : `Il y a ${days} j`;
  } else {
    startLabel = "Aujourd'hui";
  }

  let loTier = Math.floor((rawMin - 20) / 400);
  let hiTier = Math.floor((rawMax + 20) / 400);
  while (hiTier - loTier < 2) {
    if (loTier > 0) loTier -= 1;
    if (hiTier - loTier < 2 && hiTier < TIER_ORDER.length - 1) hiTier += 1;
    if (loTier <= 0 && hiTier >= TIER_ORDER.length - 1) break;
  }
  loTier = Math.max(0, loTier);
  hiTier = Math.min(TIER_ORDER.length - 1, hiTier);

  const yLo = Math.min(loTier * 400, rawMin - 20);
  const yHi = Math.max((hiTier + 1) * 400, rawMax + 20);
  const range = Math.max(yHi - yLo, 1);

  const x = (i: number) => PLOT_L + (i * (PLOT_R - PLOT_L)) / (points.length - 1);
  const y = (score: number) => PLOT_T + (PLOT_B - PLOT_T) * (1 - (score - yLo) / range);

  const boundaries: number[] = [];
  for (let t = loTier; t <= hiTier + 1; t++) boundaries.push(t);

  const chartPoints = points.map((_, i) => ({ x: x(i), y: y(scores[i]) }));
  const linePath = bezierPath(chartPoints);
  const areaPath = chartPoints.length > 0 ? `${linePath} L ${x(points.length - 1)} ${PLOT_B} L ${x(0)} ${PLOT_B} Z` : "";
  const last = points.length - 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full relative">
      <defs>
        <linearGradient id="rg-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0ac8b9" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#0ac8b9" stopOpacity="0" />
        </linearGradient>
        <filter id="rg-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#0ac8b9" floodOpacity="0.5" />
        </filter>
      </defs>

      {boundaries.map((t) => {
        const gy = y(t * 400);
        const tier = t < TIER_ORDER.length ? TIER_ORDER[t] : null;
        return (
          <g key={t}>
            <line
              x1={PLOT_L - 4}
              y1={gy}
              x2={PLOT_R}
              y2={gy}
              stroke="#ffffff"
              strokeOpacity={0.07}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            {tier && (
              <image
                href={rankEmblemUrl(tier)}
                x={AXIS_X - 9}
                y={gy - 9}
                width={18}
                height={18}
                opacity={0.95}
              />
            )}
          </g>
        );
      })}

      {/* Area & Spline Curve */}
      {chartPoints.length > 0 && (
        <>
          <motion.path 
            d={areaPath} 
            fill="url(#rg-area)" 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5, delay: 0.2 }}
          />
          <motion.path 
            d={linePath} 
            fill="none" 
            stroke="#0ac8b9" 
            strokeWidth={2.5} 
            strokeLinecap="round" 
            filter="url(#rg-glow)"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, ease: "easeInOut" }}
          />
        </>
      )}

      {/* Hover Guide Line */}
      {hoveredIndex !== null && chartPoints[hoveredIndex] && (
        <line
          x1={chartPoints[hoveredIndex].x}
          y1={PLOT_T}
          x2={chartPoints[hoveredIndex].x}
          y2={PLOT_B}
          stroke="#0ac8b9"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}

      {/* Current point / Hover highlight point */}
      {hoveredIndex !== null && chartPoints[hoveredIndex] ? (
        <circle
          cx={chartPoints[hoveredIndex].x}
          cy={chartPoints[hoveredIndex].y}
          r={5.5}
          fill="#ffffff"
          stroke="#0ac8b9"
          strokeWidth={2}
        />
      ) : (
        chartPoints[last] && (
          <circle
            cx={chartPoints[last].x}
            cy={chartPoints[last].y}
            r={3.5}
            fill="#ffffff"
            stroke="#0ac8b9"
            strokeWidth={1.5}
          />
        )
      )}

      {/* Invisible hover zones */}
      {chartPoints.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={12}
          fill="transparent"
          className="cursor-pointer"
          onMouseEnter={() => setHoveredIndex(i)}
          onMouseLeave={() => setHoveredIndex(null)}
        />
      ))}

      {/* Interactive Tooltip Card */}
      {hoveredIndex !== null && chartPoints[hoveredIndex] && (
        <g pointerEvents="none">
          <rect
            x={Math.max(4, Math.min(W - 104, chartPoints[hoveredIndex].x - 50))}
            y={Math.max(4, chartPoints[hoveredIndex].y - 36)}
            width={100}
            height={28}
            rx={5}
            fill="#060c16"
            stroke="#785a28"
            strokeWidth={1}
          />
          <text
            x={Math.max(54, Math.min(W - 54, chartPoints[hoveredIndex].x))}
            y={Math.max(15, chartPoints[hoveredIndex].y - 25)}
            fill="#ffffff"
            fontSize="8"
            fontWeight="bold"
            textAnchor="middle"
          >
            {rankLabel(points[hoveredIndex].tier, points[hoveredIndex].division, lang)}
          </text>
          <text
            x={Math.max(54, Math.min(W - 54, chartPoints[hoveredIndex].x))}
            y={Math.max(24, chartPoints[hoveredIndex].y - 16)}
            fill="#0ac8b9"
            fontSize="7.5"
            fontWeight="bold"
            textAnchor="middle"
          >
            {points[hoveredIndex].lp} LP ({formatAgo(points[hoveredIndex].ts)})
          </text>
        </g>
      )}

      {/* X-axis labels */}
      <text x={PLOT_L} y={H - 6} fill="#809bbd" fontSize="9.5" fontWeight="600" textAnchor="start">
        {startLabel}
      </text>
      <text x={PLOT_R} y={H - 6} fill="#809bbd" fontSize="9.5" fontWeight="600" textAnchor="end">
        {t("rank.today")}
      </text>
    </svg>
  );
}
