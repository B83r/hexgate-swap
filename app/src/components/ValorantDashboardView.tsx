import { BarChart3, Crosshair, RefreshCw, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import type { Account } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function ValorantDashboardView({ accounts, refreshing, onRefresh }: {
  accounts: Account[];
  refreshing: string | null;
  onRefresh: (name: string) => void;
}) {
  const { t } = useI18n();
  const hasStats = accounts.some((account) => account.valorant.stats);

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-3 pt-2">
      <div className="flex items-center gap-2 px-1">
        <BarChart3 className="h-4 w-4 text-[#ff4655]" />
        <h1 className="font-nav text-sm font-extrabold uppercase tracking-[.13em] text-text">{t("val.dashboard.title")}</h1>
      </div>
      {!hasStats && <div className="rounded-2xl border border-[#512a31] bg-[#160e14] px-5 py-9 text-center text-[12px] text-[#d6b7bc]">{t("val.dashboard.empty")}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {accounts.map((account) => {
          const stats = account.valorant.stats;
          const rank = stats?.rank;
          return (
            <article key={account.name} className={cn("rounded-2xl border bg-[#110c12]/90 p-4", account.active ? "border-[#d9aa58]" : "border-[#512a31]")}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-extrabold text-[#f5e9e9]">{account.riot_id || account.name}</h2>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[#d9aeb3]">{account.active ? t("card.connected") : "VALORANT"}</p>
                </div>
                <button onClick={() => onRefresh(account.name)} disabled={refreshing === account.name} className="rounded-lg border border-[#70303b] p-2 text-[#ff7180] transition hover:border-[#ff4655] disabled:opacity-50" title={t("val.dashboard.refresh")}>
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing === account.name && "animate-spin")} />
                </button>
              </div>
              {stats ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric icon={<Trophy className="h-3.5 w-3.5" />} label={rank?.label || "—"} value={rank?.rr !== null && rank?.rr !== undefined ? `${rank.rr} RR` : "—"} />
                <Metric icon={<BarChart3 className="h-3.5 w-3.5" />} label={stats.account_level !== null && stats.account_level !== undefined ? `${stats.account_level}` : "—"} value={t("val.dashboard.level")} />
                <Metric icon={<Crosshair className="h-3.5 w-3.5" />} label={stats.top_agent || "—"} value={t("val.dashboard.agent")} />
                <Metric icon={<BarChart3 className="h-3.5 w-3.5" />} label={`${stats.wins} V / ${stats.losses} D`} value={t("val.dashboard.history")} />
              </div> : <p className="mt-4 text-[11px] text-[#a68187]">{t("val.dashboard.empty")}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-xl border border-[#3f252b] bg-[#170f15] px-2.5 py-2">
    <div className="flex items-center gap-1 text-[#ff6472]">{icon}<span className="truncate text-[10px] font-bold">{label}</span></div>
    <p className="mt-1 truncate text-[10px] font-semibold text-[#e8c9cd]">{value}</p>
  </div>;
}
