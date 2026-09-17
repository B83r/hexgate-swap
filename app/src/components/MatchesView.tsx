import { useState, useEffect, useMemo } from "react";
import { type Account, type Match, type ChampionStats, api, subscribeEvents } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RotateCw, Swords, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { ChampionIcon } from "@/components/ChampionIcon";
import { itemIconUrl, useDdragonVersion } from "@/lib/ddragon";

interface Props {
  accounts: Account[];
  activeAccount: Account | null;
}

const CHAMP_PERKS: Record<number, string> = {
  8005: "precision/presstheattack/presstheattack.png",
  // ⚠ asset nommé "lethaltempotemp" côté Riot (héritage du rework), pas "lethaltempo"
  8008: "precision/lethaltempo/lethaltempotemp.png",
  8021: "precision/fleetfootwork/fleetfootwork.png",
  8010: "precision/conqueror/conqueror.png",
  8112: "domination/electrocute/electrocute.png",
  8124: "domination/predator/predator.png",
  8128: "domination/darkharvest/darkharvest.png",
  9923: "domination/hailofblades/hailofblades.png",
  8214: "sorcery/summonaery/summonaery.png",
  8229: "sorcery/arcanecomet/arcanecomet.png",
  8230: "sorcery/phaserush/stormraiderssurgeruneicon2.png",
  8437: "resolve/graspoftheundying/graspoftheundying.png",
  8439: "resolve/veteranaftershock/veteranaftershock.png",
  8465: "resolve/guardian/guardian.png",
  8351: "inspiration/glacialaugment/glacialaugment.png",
  8360: "inspiration/unsealedspellbook/unsealedspellbook.png",
  8369: "inspiration/firststrike/firststrike.png",
  8000: "7201_precision.png",
  8100: "7200_domination.png",
  8200: "7202_sorcery.png",
  8400: "7204_resolve.png",
  8300: "7203_whimsy.png"
};

function getPerkIconUrl(id: number): string {
  const path = CHAMP_PERKS[id];
  if (!path) return "";
  return `/assets/riot/communitydragon/perk-images/styles/${path}`;
}

export function MatchesView({ accounts, activeAccount }: Props) {
  const { t } = useI18n();
  const ddVersion = useDdragonVersion();
  const [selectedAcc, setSelectedAcc] = useState<string>("");
  const [activeSubTab, setActiveSubTab] = useState<"history" | "stats" | "live">("history");
  
  const [matches, setMatches] = useState<Match[]>([]);
  const [stats, setStats] = useState<ChampionStats[]>([]);
  const [liveData, setLiveData] = useState<any>(null);
  
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [replayStates, setReplayStates] = useState<Record<string, string>>({});
  const [downloadingReplays, setDownloadingReplays] = useState<Record<string, boolean>>({});

  // Set default selected account
  useEffect(() => {
    if (activeAccount) {
      setSelectedAcc(activeAccount.name);
    } else if (accounts.length > 0 && !selectedAcc) {
      setSelectedAcc(accounts[0].name);
    }
  }, [activeAccount, accounts]);

  // Load matches and stats when selection changes
  const loadData = async (name: string) => {
    if (!name) return;
    setLoading(true);
    try {
      const [mList, cStats] = await Promise.all([
        api.getMatches(name),
        api.getChampionStats(name)
      ]);
      setMatches(mList);
      setStats(cStats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedAcc);
  }, [selectedAcc]);

  // Refresh matches trigger
  const handleRefresh = async () => {
    if (!selectedAcc) return;
    setRefreshing(true);
    try {
      await api.refreshMatches(selectedAcc);
      toast.info(t("mv.refreshStarted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setRefreshing(false);
    }
  };

  const handleExportJSON = async () => {
    if (!matches || matches.length === 0) {
      toast.error(t("mv.nothingToExport"));
      return;
    }
    try {
      const filename = `${selectedAcc}-match-history.json`;
      const res = await api.exportMatchesJSON(filename, matches);
      if (res.ok) {
        toast.success(t("mv.exportSaved"));
      } else if (res.cancelled) {
        toast.info(t("mv.exportCancelled"));
      } else {
        toast.error(t("mv.exportError"));
      }
    } catch (e) {
      toast.error(t("mv.exportError"));
    }
  };

  const visionStats = useMemo(() => {
    if (!matches || matches.length === 0) return null;
    const validMatches = matches.filter(m => (m as any).vision_score !== undefined);
    if (validMatches.length === 0) return null;

    let totalScore = 0;
    let totalPlaced = 0;
    let totalKilled = 0;
    let totalPink = 0;

    for (const m of validMatches) {
      totalScore += (m as any).vision_score ?? 0;
      totalPlaced += (m as any).wards_placed ?? 0;
      totalKilled += (m as any).wards_killed ?? 0;
      totalPink += (m as any).pink_placed ?? 0;
    }

    const count = validMatches.length;
    return {
      avgScore: (totalScore / count).toFixed(1),
      avgPlaced: (totalPlaced / count).toFixed(1),
      avgKilled: (totalKilled / count).toFixed(1),
      avgPink: (totalPink / count).toFixed(1),
      count
    };
  }, [matches]);

  // Poll live game data if live tab is active
  useEffect(() => {
    if (activeSubTab !== "live") {
      setLiveData(null);
      return;
    }
    const fetchLive = () => {
      api.getLiveGame()
        .then((data) => {
          if (data && data.activePlayer) {
            setLiveData(data);
          } else {
            setLiveData(null);
          }
        })
        .catch(() => setLiveData(null));
    };
    fetchLive();
    const id = setInterval(fetchLive, 8000);
    return () => clearInterval(id);
  }, [activeSubTab]);

  // SSE Sync Done listener (connexion partagée de la fenêtre — pas d'EventSource dédiée)
  useEffect(() => {
    return subscribeEvents((e: any) => {
      if (e.type === "matches_done" && e.data.name === selectedAcc) {
        toast.success(t("mv.refreshDone"));
        setRefreshing(false);
        loadData(selectedAcc);
      } else if (e.type === "matches_error" && e.data.name === selectedAcc) {
        if (e.data.code === "key_expired") {
          toast.error(t("mv.keyExpired"));
        } else {
          toast.error(t("mv.refreshError", { error: e.data.error }));
        }
        setRefreshing(false);
      }
    });
  }, [selectedAcc]);

  const handleDownloadReplay = async (matchId: string) => {
    setDownloadingReplays(prev => ({ ...prev, [matchId]: true }));
    try {
      await api.downloadReplay(matchId);
      toast.success(t("replay.toastStarted"));
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const res = await api.getReplayState(matchId);
          setReplayStates(prev => ({ ...prev, [matchId]: res.state }));
          if (res.state === "downloaded" || res.state === "failed" || attempts > 12) {
            clearInterval(interval);
            setDownloadingReplays(prev => ({ ...prev, [matchId]: false }));
            if (res.state === "downloaded") {
              toast.success(t("replay.success"));
            }
          }
        } catch {
          clearInterval(interval);
          setDownloadingReplays(prev => ({ ...prev, [matchId]: false }));
        }
      }, 2500);
    } catch {
      toast.error(t("replay.toastError"));
      setDownloadingReplays(prev => ({ ...prev, [matchId]: false }));
    }
  };

  const targetAcc = accounts.find(a => a.name === selectedAcc);

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      {/* Selector and Main Controls */}
      <div className="flex items-center justify-between gap-3 px-1">
        <select
          value={selectedAcc}
          onChange={(e) => setSelectedAcc(e.target.value)}
          className="flex-1 bg-[#050b14] border border-gold-dim/40 rounded-lg px-3 py-1.5 text-xs text-gold font-semibold outline-none focus:border-gold"
        >
          {accounts.map((a) => (
            <option key={a.name} value={a.name}>
              {a.riot_id || a.name} ({a.region})
            </option>
          ))}
        </select>

        <div className="flex bg-[#050b14]/80 p-0.5 border border-border rounded-lg text-[10px] font-bold uppercase tracking-wider">
          <button
            onClick={() => setActiveSubTab("history")}
            className={cn("px-2.5 py-1 rounded-md transition-all", activeSubTab === "history" ? "bg-gold text-black" : "text-muted hover:text-text")}
          >
            Matches
          </button>
          <button
            onClick={() => setActiveSubTab("stats")}
            className={cn("px-2.5 py-1 rounded-md transition-all", activeSubTab === "stats" ? "bg-gold text-black" : "text-muted hover:text-text")}
          >
            Champs
          </button>
          <button
            onClick={() => setActiveSubTab("live")}
            className={cn("px-2.5 py-1 rounded-md transition-all relative", activeSubTab === "live" ? "bg-gold text-black" : "text-muted hover:text-text")}
          >
            Live
            {activeAccount?.active && (
              <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red border border-black animate-ping" />
            )}
          </button>
        </div>
      </div>

      {/* Viewport Area */}
      <div className="flex-1 overflow-y-auto px-1 pr-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center pt-24 gap-3 text-muted">
            <RotateCw className="h-7 w-7 animate-spin text-gold" />
            <span className="text-[11px]">{t("matches.loading")}</span>
          </div>
        ) : activeSubTab === "history" ? (
          <div className="flex flex-col gap-2.5 pb-4">
            {/* Action Bar */}
            <div className="flex items-center justify-between border-b border-border/25 pb-2">
              <span className="text-[10px] text-muted">
                {t("matches.cached", { n: matches.length })}
              </span>
              <div className="flex items-center gap-1.5">
                {matches.length > 0 && (
                  <button
                    onClick={handleExportJSON}
                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border border-border bg-[#0e1624]/60 text-muted hover:text-text px-2.5 py-1 rounded-full transition-all cursor-pointer"
                  >
                    {t("mv.exportJson")}
                  </button>
                )}
                <button
                  disabled={refreshing || !targetAcc?.riot_id}
                  onClick={handleRefresh}
                  className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border border-gold/30 hover:border-gold bg-[#0e1624] text-gold px-2.5 py-1 rounded-full transition-all disabled:opacity-50 cursor-pointer"
                >
                  <RotateCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
                  {t("matches.refresh")}
                </button>
              </div>
            </div>

            {matches.length === 0 ? (
              <div className="flex flex-col items-center justify-center pt-16 text-center text-muted gap-2">
                <AlertCircle className="h-8 w-8 text-muted/60" />
                <p className="text-xs font-semibold">{t("matches.empty")}</p>
                <p className="text-[10px] text-muted max-w-xs leading-relaxed">
                  {t("matches.refreshHint")}
                </p>
              </div>
            ) : (
              matches.map((m) => {
                const kda = `${m.kills}/${m.deaths}/${m.assists}`;
                const ratio = m.deaths > 0 ? ((m.kills + m.assists) / m.deaths).toFixed(2) : (m.kills + m.assists).toFixed(2);
                const min = Math.floor(m.duration_s / 60);
                const csMin = (m.cs / (m.duration_s / 60 || 1)).toFixed(1);
                
                return (
                  <div
                    key={m.match_id}
                    className={cn(
                      "relative overflow-hidden rounded-xl border bg-card p-2.5 transition-all duration-300 grid grid-cols-[8px_50px_22px_1fr_135px] items-center gap-2",
                      m.win 
                        ? "border-green/20 hover:border-green/45 shadow-[inset_3px_0_0_#3ddc97]" 
                        : "border-red/20 hover:border-red/45 shadow-[inset_3px_0_0_#e05c5c]"
                    )}
                  >
                    {/* Padding decoration side */}
                    <div />

                    {/* Champ Icon */}
                    <div className="relative h-11 w-11 shrink-0">
                      <ChampionIcon
                        champion={m.champion}
                        className="h-11 w-11 rounded-lg border border-gold-dim text-[13px]"
                      />
                      <span className={cn(
                        "absolute -bottom-1 -right-1 text-[7.5px] font-extrabold px-1 rounded border leading-none py-0.5",
                        m.win ? "bg-[#0e2a1e] border-green/30 text-green" : "bg-[#2a0e10] border-red/30 text-red"
                      )}>
                        {m.win ? "V" : "D"}
                      </span>
                    </div>

                    {/* Runes Column */}
                    <div className="flex flex-col gap-1 justify-center shrink-0">
                      {m.keystone_id && getPerkIconUrl(m.keystone_id) ? (
                        <img
                          src={getPerkIconUrl(m.keystone_id)}
                          alt=""
                          className="h-5 w-5 bg-black/40 rounded-full border border-border/20 p-0.5"
                          title={t("mv.keystone")}
                          onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                        />
                      ) : (
                        <div className="h-5 w-5 bg-black/20 rounded-full border border-border/10" />
                      )}
                      {m.sub_style_id && getPerkIconUrl(m.sub_style_id) ? (
                        <img
                          src={getPerkIconUrl(m.sub_style_id)}
                          alt=""
                          className="h-4.5 w-4.5 bg-black/40 rounded-full opacity-80"
                          title={t("mv.subStyle")}
                          onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                        />
                      ) : (
                        <div className="h-4.5 w-4.5 bg-black/20 rounded-full" />
                      )}
                    </div>

                    {/* Middle stats details */}
                    <div className="min-w-0 flex flex-col justify-center gap-0.5">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-extrabold text-gold-bright truncate">{m.champion}</span>
                          <span className="text-[9px] text-muted shrink-0">
                            {m.queue_id === 420 ? "SoloQ" : "FlexQ"}
                          </span>
                        </div>
                        {/* Download replay button */}
                        <button
                          onClick={() => handleDownloadReplay(m.match_id)}
                          disabled={downloadingReplays[m.match_id]}
                          className={cn(
                            "text-[8px] font-extrabold px-1.5 py-0.5 rounded transition-colors uppercase shrink-0 select-none",
                            replayStates[m.match_id] === "downloaded" 
                              ? "bg-green/10 border border-green/30 text-green"
                              : downloadingReplays[m.match_id]
                                ? "bg-gold/10 border border-gold/30 text-gold animate-pulse"
                                : "bg-card-hover border border-border hover:border-gold hover:text-gold text-muted"
                          )}
                        >
                          {replayStates[m.match_id] === "downloaded" 
                            ? t("replay.ready") 
                            : downloadingReplays[m.match_id] 
                              ? t("replay.downloading") 
                              : t("replay.download")}
                        </button>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[11px] font-bold text-text">{kda}</span>
                        <span className="text-[9px] text-muted">({ratio} KDA)</span>
                      </div>
                      <div className="text-[9px] text-muted leading-none">
                        {m.cs} CS ({csMin}/m) · {min} min
                      </div>
                    </div>

                    {/* Items inventory grid */}
                    <div className="grid grid-cols-7 gap-1">
                      {(m.items || [0, 0, 0, 0, 0, 0, 0]).map((itemId, i) => {
                        return (
                          <div 
                            key={i} 
                            className="h-[16px] w-[16px] rounded border border-border/40 bg-[#020810] flex items-center justify-center overflow-hidden"
                          >
                            {itemId > 0 ? (
                              <img
                                src={itemIconUrl(itemId, ddVersion)}
                                alt=""
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : activeSubTab === "stats" ? (
          <div className="flex flex-col gap-3 pb-4">
            <div className="border-b border-border/25 pb-2">
              <h3 className="text-xs font-bold text-gold-bright uppercase tracking-wider">
                {t("champStats.title")}
              </h3>
              <p className="text-[10px] text-muted italic mt-0.5">{t("champStats.scope")}</p>
            </div>

            {/* Vision Analytics Panel */}
            {visionStats ? (
              <div className="bg-[#0a1220]/50 border border-gold-dim/35 rounded-xl p-3 mb-1 flex flex-col gap-2">
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-gold-dim border-b border-border/25 pb-1 select-none">
                  {t("mv.visionTitle")}
                </span>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-[#050b14]/70 border border-border/50 rounded-lg p-1.5 flex flex-col justify-center select-none">
                    <span className="text-[7.5px] text-muted uppercase font-bold leading-none">{t("mv.visionScore")}</span>
                    <span className="text-[11px] font-bold text-gold-bright mt-0.5">{visionStats.avgScore}</span>
                  </div>
                  <div className="bg-[#050b14]/70 border border-border/50 rounded-lg p-1.5 flex flex-col justify-center select-none">
                    <span className="text-[7.5px] text-muted uppercase font-bold leading-none">{t("mv.wardsPlaced")}</span>
                    <span className="text-[11px] font-bold text-gold-bright mt-0.5">{visionStats.avgPlaced}</span>
                  </div>
                  <div className="bg-[#050b14]/70 border border-border/50 rounded-lg p-1.5 flex flex-col justify-center select-none">
                    <span className="text-[7.5px] text-muted uppercase font-bold leading-none">{t("mv.wardsKilled")}</span>
                    <span className="text-[11px] font-bold text-gold-bright mt-0.5">{visionStats.avgKilled}</span>
                  </div>
                  <div className="bg-[#050b14]/70 border border-border/50 rounded-lg p-1.5 flex flex-col justify-center select-none">
                    <span className="text-[7.5px] text-muted uppercase font-bold leading-none">{t("mv.pinks")}</span>
                    <span className="text-[11px] font-bold text-gold-bright mt-0.5">{visionStats.avgPink}</span>
                  </div>
                </div>
              </div>
            ) : matches.length > 0 ? (
              <div className="bg-[#0a1220]/20 border border-dashed border-border/30 rounded-xl p-3 mb-1 text-center select-none">
                <span className="text-[9px] text-muted block leading-normal">
                  {t("mv.visionEmpty")}
                </span>
              </div>
            ) : null}

            {stats.length === 0 ? (
              <div className="text-center text-muted text-[11px] pt-12">
                {t("champStats.empty")}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {stats.map((s) => {
                  const wrPct = s.winrate;
                  return (
                    <div key={s.champion} className="relative overflow-hidden rounded-xl border border-border bg-[#050b14]/40 p-2.5 grid grid-cols-[36px_1fr_80px] items-center gap-3">
                      {/* Avatar */}
                      <ChampionIcon
                        champion={s.champion}
                        className="h-9 w-9 rounded-full border border-gold-dim text-[11px]"
                      />

                      {/* Info & WR Progress */}
                      <div className="min-w-0 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11px] font-bold">
                          <span className="text-text">{s.champion}</span>
                          <span className="text-gold">{wrPct}% WR</span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 w-full bg-[#101c2a] rounded-full overflow-hidden border border-border/20">
                          <div 
                            className={cn(
                              "h-full rounded-full bg-gradient-to-r",
                              wrPct >= 50 ? "from-gold/70 to-gold" : "from-[#a04a52] to-red"
                            )}
                            style={{ width: `${wrPct}%` }}
                          />
                        </div>
                      </div>

                      {/* Games & KDA */}
                      <div className="text-right flex flex-col justify-center gap-0.5 shrink-0">
                        <div className="text-[10px] font-extrabold text-gold-bright">
                          {t("champStats.games", { n: s.games })}
                        </div>
                        {(() => {
                          const lpContrib = (s.wins - (s.games - s.wins)) * 20;
                          return (
                            <div className={cn(
                              "text-[8.5px] font-bold px-1.5 py-0.5 rounded leading-none mt-0.5 select-none text-center inline-block ml-auto",
                              lpContrib >= 0 ? "bg-green/10 text-green border border-green/20" : "bg-red/10 text-red border border-red/20"
                            )}>
                              {lpContrib >= 0 ? "+" : ""}{lpContrib} LP
                            </div>
                          );
                        })()}
                        <div className="text-[9px] text-muted leading-none mt-1">
                          {s.kda_avg.toFixed(2)} KDA
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Live game tracker */
          <div className="flex flex-col gap-3 pb-4">
            <div className="border-b border-border/25 pb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gold-bright uppercase tracking-wider">
                Live Game Tracker
              </h3>
              <span className={cn(
                "text-[9px] font-bold px-2 py-0.5 rounded border",
                liveData ? "bg-[#2a0e10] border-red/40 text-red animate-pulse" : "bg-[#0e1624] border-border/30 text-muted"
              )}>
                {liveData ? "EN JEU" : "INACTIF"}
              </span>
            </div>

            {liveData ? (
              <div className="flex flex-col gap-3 bg-[#0a1220]/75 border border-gold-dim/40 rounded-2xl p-3.5 relative overflow-hidden">
                <div className="absolute top-0 right-0 h-32 w-32 bg-gradient-to-br from-gold/10 to-transparent blur-2xl" />
                
                {/* Active champ & Game duration */}
                <div className="flex items-center gap-3">
                  <ChampionIcon
                    champion={
                      (liveData.allPlayers || []).find(
                        (p: any) => p.summonerName === liveData.activePlayer.summonerName,
                      )?.championName || ""
                    }
                    className="h-12 w-12 rounded-lg border border-gold text-[14px]"
                  />
                  <div>
                    <h4 className="font-extrabold text-xs text-text">{liveData.activePlayer.summonerName || "Joueur"}</h4>
                    <span className="text-[10px] text-muted flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Durée : {Math.floor(liveData.gameData.gameTime / 60)} min
                    </span>
                  </div>
                </div>

                {/* Stats recap row */}
                <div className="grid grid-cols-3 gap-2 text-center border-t border-b border-border/30 py-2.5">
                  <div>
                    <span className="block text-[9px] text-muted uppercase tracking-wider">KDA</span>
                    <span className="text-xs font-bold text-gold-bright">
                      {liveData.activePlayer.championStats.kills || 0} / {liveData.activePlayer.championStats.deaths || 0} / {liveData.activePlayer.championStats.assists || 0}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-muted uppercase tracking-wider">CS</span>
                    <span className="text-xs font-bold text-gold-bright">
                      {liveData.activePlayer.championStats.creepScore || 0}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-muted uppercase tracking-wider">Gold</span>
                    <span className="text-xs font-bold text-gold-bright">
                      {Math.round(liveData.activePlayer.championStats.currentGold || 0)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center pt-16 text-center text-muted gap-2.5 p-4 border border-dashed border-border/40 rounded-2xl">
                <Swords className="h-9 w-9 text-muted/50" />
                <p className="text-xs font-bold text-text">{t("mv.noLiveGame")}</p>
                <p className="text-[10px] leading-relaxed max-w-xs">
                  {t("mv.noLiveGameHint")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
