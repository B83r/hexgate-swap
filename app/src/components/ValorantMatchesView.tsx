import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Map as MapIcon, RefreshCw, Swords } from "lucide-react";
import type { Account } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

function displayDate(value: string | number | null): string {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function agentIcon(agent: string): string {
  const filename = agent.toLowerCase().replace(/[^a-z0-9]/g, "");
  // WebP local (compression ~85% vs les PNG d'origine, cf. Optim 3
  // PASSATION_HEXGATE_SWAP_V2_1.md §14) ; repli logo VALORANT géré par onError.
  return `/assets/riot/valorant/agents/${filename}.webp`;
}

export function ValorantMatchesView({ accounts, refreshing, onRefresh }: {
  accounts: Account[];
  refreshing: string | null;
  onRefresh: (name: string) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState("");
  const attemptedAutoSync = useRef(new Set<string>());
  useEffect(() => { if (!accounts.some((a) => a.name === selected)) setSelected(accounts.find((a) => a.active)?.name || accounts[0]?.name || ""); }, [accounts, selected]);
  const account = accounts.find((a) => a.name === selected) || null;
  const stats = account?.valorant.stats || null;
  // Une première ouverture d'un compte sans cache lance une seule synchro. Un
  // compte sans aucune partie obtient quand même un objet stats vide ensuite,
  // donc on ne martèle jamais HenrikDev à chaque changement d'onglet.
  useEffect(() => {
    if (!account || stats || refreshing || attemptedAutoSync.current.has(account.name)) return;
    attemptedAutoSync.current.add(account.name);
    onRefresh(account.name);
  }, [account, stats, refreshing, onRefresh]);
  const agents = useMemo(() => {
    const totals = new globalThis.Map<string, number>();
    stats?.matches.forEach((match) => totals.set(match.agent, (totals.get(match.agent) || 0) + 1));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [stats]);

  return <section className="mx-auto flex w-full max-w-5xl flex-col gap-3 pt-2">
    <div className="flex items-center gap-2 px-1"><Swords className="h-4 w-4 text-[#ff4655]" /><h1 className="font-nav text-sm font-extrabold uppercase tracking-[.13em] text-text">{t("val.matches.title")}</h1></div>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#41252c] bg-[#120d13] p-2">
      {accounts.map((item) => <button key={item.name} onClick={() => setSelected(item.name)} className={cn("rounded-lg px-3 py-1.5 text-[11px] font-bold transition", selected === item.name ? "bg-[#b83143] text-white" : "text-[#d1b2b6] hover:bg-[#2d1720]")}>{item.riot_id || item.name}</button>)}
      {account && <button onClick={() => onRefresh(account.name)} disabled={refreshing === account.name} className="ml-auto rounded-lg border border-[#70303b] p-1.5 text-[#ff7180] disabled:opacity-50" title={t("val.dashboard.refresh")}><RefreshCw className={cn("h-3.5 w-3.5", refreshing === account.name && "animate-spin")} /></button>}
    </div>
    {!stats ? <div className="rounded-2xl border border-[#512a31] bg-[#160e14] px-5 py-9 text-center text-[12px] text-[#d6b7bc]">{refreshing === account?.name ? t("val.matches.syncing") : t("val.matches.empty")}</div> : <div className="grid gap-3 lg:grid-cols-[.8fr_1.8fr]">
      <aside className="rounded-2xl border border-[#512a31] bg-[#110c12]/90 p-4"><div className="mb-3 flex items-center gap-2 text-[#ff6472]"><Crosshair className="h-4 w-4" /><span className="text-[11px] font-black uppercase tracking-wider">{t("val.dashboard.agent")}</span></div><div className="flex flex-col gap-2">{agents.map(([agent, games]) => <div key={agent} className="flex items-center justify-between rounded-lg border border-[#3f252b] bg-[#170f15] px-3 py-2 text-[12px]"><span className="font-bold text-[#f1dadd]">{agent}</span><span className="text-[#e7b65d]">{games}</span></div>)}</div></aside>
      <div className="flex flex-col gap-2">{stats.matches.map((match, index) => <article key={match.id || index} className="flex items-center gap-3 rounded-xl border border-[#512a31] bg-[#110c12]/90 px-4 py-3"><div className="relative shrink-0"><img src={agentIcon(match.agent)} alt="" loading="lazy" decoding="async" className="h-11 w-11 rounded-full border border-[#6c3440] bg-[#200f17] object-cover" onError={(event) => { event.currentTarget.src = "/assets/riot/valorant/valorant.png"; }} /><span className={cn("absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#110c12]", match.won === true ? "bg-green" : match.won === false ? "bg-[#ff4655]" : "bg-muted")} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-bold text-[#f5e9e9]">{match.agent}</span><span className="text-[11px] text-[#d0a4aa]">{match.kills ?? "—"}/{match.deaths ?? "—"}/{match.assists ?? "—"}</span></div><p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#9c7b81]"><MapIcon className="h-3 w-3" />{match.map} · {match.mode} · {displayDate(match.played_at)}</p></div><div className="text-right"><p className="text-[11px] font-bold text-[#e7bf72]">{match.score || "—"}</p><p className="text-[9px] uppercase text-[#98757b]">{match.won === true ? t("val.match.victory") : match.won === false ? t("val.match.defeat") : "—"}</p></div></article>)}</div>
    </div>}
  </section>;
}
