import { useEffect, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Eye, EyeOff, Lock, Unlock, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function OverlayView() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(true);
  const [modCsmin, setModCsmin] = useState(true);
  const [cdEnabled, setCdEnabled] = useState(false);
  const [cdLocked, setCdLocked] = useState(true);
  const [insightEnabled, setInsightEnabled] = useState(false);

  useEffect(() => {
    const isEnabled = localStorage.getItem("hexgate_overlay_enabled") !== "false"; // Default to true
    const isLocked = localStorage.getItem("hexgate_overlay_locked") === "true"; // Default to false (unlocked)
    setEnabled(isEnabled);
    setLocked(isLocked);
    setModCsmin(localStorage.getItem("hexgate_overlay_mod_csmin") !== "false"); // Default to true
    const isCdEnabled = localStorage.getItem("hexgate_overlay_cd_enabled") === "true"; // Default to false (bêta)
    const isCdLocked = localStorage.getItem("hexgate_overlay_cd_locked") === "true";
    setCdEnabled(isCdEnabled);
    setCdLocked(isCdLocked);
    // Rien à faire ici quand c'est activé : chaque fenêtre overlay se montre
    // elle-même dès qu'une vraie partie démarre (voir overlay.tsx/overlay-cd.tsx).
    // On force juste le masquage immédiat si c'est désactivé, au cas où une
    // fenêtre serait restée visible d'une session précédente.
    if (!isCdEnabled) {
      WebviewWindow.getByLabel("overlay_cd").then((win) => win?.hide().catch(() => {}));
    }
    if (!isEnabled) {
      WebviewWindow.getByLabel("overlay").then((win) => win?.hide().catch(() => {}));
    }

    api.getSettingsAll().then((res) => setInsightEnabled(res.opponent_insight_enabled)).catch(() => {});
  }, []);

  const handleToggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem("hexgate_overlay_enabled", next ? "true" : "false");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "hexgate_overlay_enabled", newValue: next ? "true" : "false" })
    );

    if (!next) {
      // Désactivation : masquage immédiat, même en pleine partie.
      const win = await WebviewWindow.getByLabel("overlay");
      try {
        await win?.hide();
      } catch (e) {
        console.error("Failed to hide overlay window", e);
      }
      toast.info(t("ovw.csOff"));
    } else {
      toast.success(t("ovw.csOn"));
    }
  };

  const handleToggleModCsmin = () => {
    const next = !modCsmin;
    setModCsmin(next);
    localStorage.setItem("hexgate_overlay_mod_csmin", next ? "true" : "false");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "hexgate_overlay_mod_csmin",
        newValue: next ? "true" : "false",
      })
    );
    toast[next ? "success" : "info"](next ? t("ovw.csModuleOn") : t("ovw.csModuleOff"));
  };

  const handleToggleCdEnabled = async () => {
    const next = !cdEnabled;
    setCdEnabled(next);
    localStorage.setItem("hexgate_overlay_cd_enabled", next ? "true" : "false");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "hexgate_overlay_cd_enabled", newValue: next ? "true" : "false" })
    );

    if (!next) {
      // Désactivation : masquage immédiat, même en pleine partie.
      const win = await WebviewWindow.getByLabel("overlay_cd");
      try {
        await win?.hide();
      } catch (e) {
        console.error("Failed to hide cooldown overlay window", e);
      }
      toast.info(t("ovw.cdOff"));
    } else {
      toast.success(t("ovw.cdOn"));
    }
  };

  const handleToggleInsight = async () => {
    const next = !insightEnabled;
    setInsightEnabled(next);
    try {
      await api.updateSettings({ opponent_insight_enabled: next });
      toast[next ? "success" : "info"](
        next ? t("ovw.insightOn") : t("ovw.insightOff")
      );
    } catch (e) {
      setInsightEnabled(!next);
      console.error("Failed to update opponent_insight_enabled", e);
      toast.error(t("ovw.updateFailed"));
    }
  };

  const handleToggleCdLocked = () => {
    const next = !cdLocked;
    setCdLocked(next);
    localStorage.setItem("hexgate_overlay_cd_locked", next ? "true" : "false");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "hexgate_overlay_cd_locked",
        newValue: next ? "true" : "false",
      })
    );
    if (next) {
      toast.success(t("ovw.cdLocked"));
    } else {
      toast.info(t("ovw.cdUnlocked"));
    }
  };

  const handleToggleLocked = () => {
    const next = !locked;
    setLocked(next);
    localStorage.setItem("hexgate_overlay_locked", next ? "true" : "false");
    
    // Dispatch a storage event to alert the overlay window instantly
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "hexgate_overlay_locked",
        newValue: next ? "true" : "false",
      })
    );

    if (next) {
      toast.success(t("ovw.csLocked"));
    } else {
      toast.info(t("ovw.csUnlocked"));
    }
  };

  return (
    <div className="flex flex-col gap-5 p-1 max-w-[620px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header section */}
      <div className="flex items-center gap-3 border-b border-border/10 pb-4">
        <div className="h-9 w-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center text-gold">
          <Settings2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-extrabold text-gold uppercase tracking-wider leading-none">
            {t("ovw.title")}
          </h2>
          <p className="text-[10px] text-muted mt-1.5">
            {t("ovw.subtitle")}
          </p>
        </div>
      </div>

      {/* Main Settings Card */}
      <div className="flex flex-col gap-4 bg-[#020a13]/60 border border-border/50 rounded-2xl p-5 backdrop-blur-md">
        
        {/* Toggle Switch : Enable / Disable */}
        <div className="flex items-center justify-between border-b border-border/10 pb-4">
          <div className="flex flex-col gap-1 pr-6">
            <span className="text-xs font-bold text-text flex items-center gap-1.5">
              {enabled ? (
                <Eye className="h-4 w-4 text-hextech-blue" />
              ) : (
                <EyeOff className="h-4 w-4 text-muted" />
              )}
              {t("ovw.enable")}
            </span>
            <span className="text-[9.5px] text-muted leading-relaxed">
              {t("ovw.enableDesc")}
            </span>
          </div>
          
          <button
            onClick={handleToggleEnabled}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              enabled ? "bg-gold" : "bg-[#091428] border-border/40"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out mt-0.5",
                enabled ? "translate-x-4 bg-black" : "translate-x-0.5 bg-muted"
              )}
            />
          </button>
        </div>

        {/* Lock / Position Control */}
        <div className={cn(
          "flex items-center justify-between transition-all duration-300",
          enabled ? "opacity-100 pointer-events-auto" : "opacity-40 pointer-events-none"
        )}>
          <div className="flex flex-col gap-1 pr-6">
            <span className="text-xs font-bold text-text flex items-center gap-1.5">
              {locked ? (
                <Lock className="h-4 w-4 text-gold" />
              ) : (
                <Unlock className="h-4 w-4 text-hextech-blue animate-bounce" />
              )}
              {t("ovw.lockCs")}
            </span>
            <span className="text-[9.5px] text-muted leading-relaxed">
              {t("ovw.lockCsDesc")}
            </span>
          </div>

          <button
            disabled={!enabled}
            onClick={handleToggleLocked}
            className={cn(
              "flex h-[28px] px-3.5 items-center justify-center gap-1.5 rounded-full border transition-all duration-300 text-[10px] font-extrabold uppercase tracking-wider",
              locked
                ? "border-border/60 bg-card-hover/20 text-muted hover:text-text hover:border-border cursor-pointer"
                : "bg-gold border-gold text-black hover:bg-gold-bright shadow-md cursor-pointer animate-pulse"
            )}
          >
            {locked ? (
              <>
                <Unlock className="h-3 w-3" />
                {t("ovw.unlock")}
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" />
                {t("ovw.lock")}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Modules Card */}
      <div className={cn(
        "flex flex-col gap-4 bg-[#020a13]/60 border border-border/50 rounded-2xl p-5 backdrop-blur-md transition-all duration-300",
        enabled ? "opacity-100 pointer-events-auto" : "opacity-40 pointer-events-none"
      )}>
        <span className="text-[10px] font-extrabold text-muted uppercase tracking-widest">
          {t("ovw.modules")}
        </span>

        {/* Module : CS/min */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1 pr-6">
            <span className="text-xs font-bold text-text">{t("ovw.csModule")}</span>
            <span className="text-[9.5px] text-muted leading-relaxed">
              {t("ovw.csModuleDesc")}
            </span>
          </div>
          <button
            disabled={!enabled}
            onClick={handleToggleModCsmin}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              modCsmin ? "bg-gold" : "bg-[#091428] border-border/40"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out mt-0.5",
                modCsmin ? "translate-x-4 bg-black" : "translate-x-0.5 bg-muted"
              )}
            />
          </button>
        </div>
      </div>

      {/* Cooldown Overlay Card */}
      <div className="flex flex-col gap-4 bg-[#020a13]/60 border border-border/50 rounded-2xl p-5 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border/10 pb-4">
          <div className="flex flex-col gap-1 pr-6">
            <span className="text-xs font-bold text-text flex items-center gap-1.5">
              {cdEnabled ? (
                <Eye className="h-4 w-4 text-hextech-blue" />
              ) : (
                <EyeOff className="h-4 w-4 text-muted" />
              )}
              {t("ovw.cdModule")}
              <span className="rounded-full border border-gold/40 px-1.5 py-px text-[8px] font-extrabold uppercase tracking-wider text-gold">
                {t("ovw.beta")}
              </span>
            </span>
            <span className="text-[9.5px] text-muted leading-relaxed">
              {t("ovw.cdModuleDesc")}
            </span>
          </div>
          <button
            onClick={handleToggleCdEnabled}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              cdEnabled ? "bg-gold" : "bg-[#091428] border-border/40"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out mt-0.5",
                cdEnabled ? "translate-x-4 bg-black" : "translate-x-0.5 bg-muted"
              )}
            />
          </button>
        </div>

        <div className={cn(
          "flex items-center justify-between transition-all duration-300",
          cdEnabled ? "opacity-100 pointer-events-auto" : "opacity-40 pointer-events-none"
        )}>
          <div className="flex flex-col gap-1 pr-6">
            <span className="text-xs font-bold text-text flex items-center gap-1.5">
              {cdLocked ? (
                <Lock className="h-4 w-4 text-gold" />
              ) : (
                <Unlock className="h-4 w-4 text-hextech-blue animate-bounce" />
              )}
              {t("ovw.lockCd")}
            </span>
            <span className="text-[9.5px] text-muted leading-relaxed">
              {t("ovw.lockCdDesc")}
            </span>
          </div>
          <button
            disabled={!cdEnabled}
            onClick={handleToggleCdLocked}
            className={cn(
              "flex h-[28px] px-3.5 items-center justify-center gap-1.5 rounded-full border transition-all duration-300 text-[10px] font-extrabold uppercase tracking-wider",
              cdLocked
                ? "border-border/60 bg-card-hover/20 text-muted hover:text-text hover:border-border cursor-pointer"
                : "bg-gold border-gold text-black hover:bg-gold-bright shadow-md cursor-pointer animate-pulse"
            )}
          >
            {cdLocked ? (
              <>
                <Unlock className="h-3 w-3" />
                {t("ovw.unlock")}
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" />
                {t("ovw.lock")}
              </>
            )}
          </button>
        </div>

        <div className={cn(
          "flex items-center justify-between border-t border-border/10 pt-4 transition-all duration-300",
          cdEnabled ? "opacity-100 pointer-events-auto" : "opacity-40 pointer-events-none"
        )}>
          <div className="flex flex-col gap-1 pr-6">
            <span className="text-xs font-bold text-text">
              {t("ovw.insight")}
              <span className="ml-1.5 rounded-full border border-gold/40 px-1.5 py-px text-[8px] font-extrabold uppercase tracking-wider text-gold">
                {t("ovw.beta")}
              </span>
            </span>
            <span className="text-[9.5px] text-muted leading-relaxed">
              {t("ovw.insightDesc")}
            </span>
          </div>
          <button
            disabled={!cdEnabled}
            onClick={handleToggleInsight}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              insightEnabled ? "bg-gold" : "bg-[#091428] border-border/40"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out mt-0.5",
                insightEnabled ? "translate-x-4 bg-black" : "translate-x-0.5 bg-muted"
              )}
            />
          </button>
        </div>
      </div>

      {/* Info Notice Box */}
      <div className="flex gap-3 bg-[#0a1428]/40 border border-hextech-blue/20 rounded-xl p-3.5">
        <div className="text-hextech-blue text-xs mt-0.5">ℹ</div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-hextech-blue uppercase tracking-wide">
            {t("ovw.tipTitle")}
          </span>
          <span className="text-[9.5px] text-muted leading-relaxed">
            {t("ovw.tipDesc")}
          </span>
        </div>
      </div>
    </div>
  );
}
