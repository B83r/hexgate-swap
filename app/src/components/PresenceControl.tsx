import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, LoaderCircle, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, type DeceiveState, type PresenceStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const statuses: PresenceStatus[] = ["offline", "mobile", "chat"];

export function PresenceControl() {
  const { t } = useI18n();
  const [state, setState] = useState<DeceiveState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => api.getDeceiveState().then((next) => {
      if (alive) setState(next);
    }).catch(() => { if (alive) setState(null); });
    void refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  const change = async (status: PresenceStatus, enabled: boolean, lobbyChat: boolean) => {
    if (!state || busy) return;
    setBusy(true);
    try {
      const next = state.connected
        ? await api.updateDeceiveState(status, enabled, lobbyChat)
        : await api.configureDeceive(enabled, status);
      setState(next);
      toast.success(next.connected ? t("presence.applied") : t("presence.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const launch = async (product: "league_of_legends" | "valorant" | "bacon") => {
    if (busy) return;
    setBusy(true);
    try {
      await api.startWithDeceive(product);
      toast.success(t("presence.starting"));
      setState(await api.getDeceiveState());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const active = Boolean(state?.connected && state.proxy_enabled && state.configured);
  const mode = state?.status ?? "offline";
  const label = active ? t(`presence.${mode}`) : state?.configured ? t("presence.on") : t("presence.off");
  const Icon = active && mode === "mobile" ? Smartphone : active && mode === "chat" ? Eye : EyeOff;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-label={`${t("presence.title")}: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        title={t("presence.title")}
        className={`flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 font-nav text-[10px] font-bold transition-colors ${active ? "border-green/50 bg-[#0e2a1e] text-green hover:bg-[#143a2a]" : state?.configured ? "border-gold/50 bg-gold/10 text-gold hover:bg-gold/15" : "border-border bg-panel text-muted hover:bg-card-hover"}`}
      >
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
        <span className="hidden max-w-20 truncate sm:inline">{label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap font-nav text-[11px] font-semibold text-muted">
        {t("presence.title")}
      </span>

      {expanded && (
        <div role="dialog" aria-label={t("presence.title")} className="absolute right-0 top-full z-50 mt-5 w-64 rounded-xl border border-gold/35 bg-[#081526] p-3 text-text shadow-[0_18px_45px_rgba(0,0,0,0.65)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-gold">{t("presence.title")}</span>
            <span className={`text-[9px] font-bold ${active ? "text-green" : "text-muted"}`}>
              {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : active ? t("presence.active") : state?.running ? t("presence.connecting") : t("presence.inactive")}
            </span>
          </div>
          {!state ? (
            <p className="text-[10px] text-muted">{t("presence.unavailable")}</p>
          ) : !state.available ? (
            <p className="text-[10px] text-muted">{t("presence.engineMissing")}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-text">{t("presence.enable")}</span>
                <button
                  type="button"
                  onClick={() => void change(mode, !state.configured, state.lobby_chat)}
                  disabled={busy}
                  aria-pressed={state.configured}
                  className={`rounded border px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${state.configured ? "border-green/40 bg-green/10 text-green" : "border-border text-muted hover:text-text"}`}
                >
                  {state.configured ? t("presence.on") : t("presence.off")}
                </button>
              </div>
              <div role="group" aria-label={t("presence.mode")} className="space-y-1">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted">{t("presence.mode")}</p>
                {statuses.map((value) => {
                  const OptionIcon = value === "mobile" ? Smartphone : value === "chat" ? Eye : EyeOff;
                  const selected = state.configured && mode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void change(value, true, state.lobby_chat)}
                      disabled={busy}
                      aria-pressed={selected}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold transition-colors disabled:opacity-50 ${selected ? "border-gold/50 bg-gold/10 text-gold" : "border-border/50 text-text hover:border-gold/35 hover:bg-card-hover/30"}`}
                    >
                      <OptionIcon className="h-3.5 w-3.5" />
                      <span className="flex-1">{t(`presence.${value}`)}</span>
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
              </div>
              {state.connected && (
                <label className="flex cursor-pointer items-center gap-2 text-[10px] text-muted">
                  <input type="checkbox" checked={state.lobby_chat} onChange={(event) => void change(mode, state.configured, event.target.checked)} disabled={busy} className="accent-[#d9ad54]" />
                  {t("presence.lobbyChat")}
                </label>
              )}
              {state.configured && !state.connected && (
                <>
                  <p className="text-[9px] leading-relaxed text-muted">{t("presence.nextLaunch")}</p>
                  {!state.running && (
                    <div className="flex gap-1">
                      <button type="button" disabled={busy} onClick={() => void launch("league_of_legends")} className="flex-1 rounded border border-border px-1 py-1 text-[9px] hover:border-gold/60 disabled:opacity-50">LoL</button>
                      <button type="button" disabled={busy} onClick={() => void launch("valorant")} className="flex-1 rounded border border-border px-1 py-1 text-[9px] hover:border-gold/60 disabled:opacity-50">VALORANT</button>
                      <button type="button" disabled={busy} onClick={() => void launch("bacon")} className="flex-1 rounded border border-border px-1 py-1 text-[9px] hover:border-gold/60 disabled:opacity-50">LoR</button>
                    </div>
                  )}
                </>
              )}
              {active && <p className="text-[9px] leading-relaxed text-muted">{t("presence.friend")}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
