import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { subscribeEvents, type ServerEvent } from "./lib/api";
import "./index.css";
import "./overlay.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useGameOnlyWindow } from "./lib/useGameOnlyWindow";
import { I18nProvider, useI18n } from "./lib/i18n";

// Ne jamais laisser un appel Tauri refusé (ACL) ou absent (navigateur) démonter l'overlay.
function applyClickThrough(ignore: boolean) {
  try {
    getCurrentWindow()
      .setIgnoreCursorEvents(ignore)
      .catch((err) => console.error("overlay: setIgnoreCursorEvents rejeté", err));
  } catch (err) {
    console.error("overlay: fenêtre Tauri indisponible", err);
  }
}

function OverlayApp() {
  const { t } = useI18n();
  const [stats, setStats] = useState<{ cs: number; time: number; cs_per_min: number; active: boolean } | null>(null);
  const [locked, setLocked] = useState(true);
  const [showCs, setShowCs] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const isLocked = localStorage.getItem("hexgate_overlay_locked") === "true";
    setLocked(isLocked);
    applyClickThrough(isLocked);
    setShowCs(localStorage.getItem("hexgate_overlay_mod_csmin") !== "false");
    setEnabled(localStorage.getItem("hexgate_overlay_enabled") !== "false");

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "hexgate_overlay_locked") {
        const nextLocked = e.newValue !== "false";
        setLocked(nextLocked);
        applyClickThrough(nextLocked);
      }
      if (e.key === "hexgate_overlay_mod_csmin") {
        setShowCs(e.newValue !== "false");
      }
      if (e.key === "hexgate_overlay_enabled") {
        setEnabled(e.newValue !== "false");
      }
    };
    window.addEventListener("storage", handleStorageChange);

    const unsub = subscribeEvents((e: ServerEvent) => {
      if (e.type === "live_game_stats") {
        setStats(e.data);
      }
    });

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      unsub();
    };
  }, []);

  // La fenêtre OS ne doit exister à l'écran QUE pendant une vraie partie en cours
  // (jamais en mode démo/positionnement, jamais juste parce que le toggle "Activer"
  // est coché) — voir la règle "overlays in-game" dans CLAUDE.md.
  const shouldShow = enabled && !!stats && stats.active && showCs;
  useGameOnlyWindow(shouldShow, "overlay");

  // Désactivation rapide depuis l'overlay (croix). Uniquement cliquable en mode
  // déverrouillé : en mode verrouillé, la fenêtre est click-through (les clics
  // passent au jeu), donc aucun élément interne — croix comprise — ne peut être
  // cliqué. Repli : déverrouiller depuis les Réglages pour pouvoir cliquer.
  const handleDisable = () => {
    setEnabled(false);
    localStorage.setItem("hexgate_overlay_enabled", "false");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "hexgate_overlay_enabled", newValue: "false" })
    );
  };

  if (!shouldShow) {
    return null;
  }

  return (
    <div
      data-tauri-drag-region
      className={`h-screen w-screen flex items-center justify-center p-1 select-none overflow-hidden ${
        locked ? "" : "cursor-move"
      }`}
    >
      <div
        data-tauri-drag-region
        className="relative flex h-10 items-stretch drop-shadow-[0_3px_10px_rgba(0,0,0,0.6)]"
      >
        {!locked && (
          <button
            onClick={handleDisable}
            title={t("ovl.disableCs")}
            className="absolute -top-1 -right-1 z-10 flex h-[18px] w-[18px] items-center justify-center text-[13px] font-bold leading-none text-[#e84057]/70 opacity-60 transition-opacity hover:opacity-100 hover:text-[#e84057]"
          >
            ×
          </button>
        )}
        <div
          data-tauri-drag-region
          className="flex items-center pl-[18px] pr-[14px] text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#1a1206]"
          style={{
            background: "linear-gradient(180deg,#d9bc80,#b7975c)",
            clipPath: "polygon(10px 0,100% 0,100% 100%,0 100%)",
          }}
        >
          CS/min
        </div>
        <div
          data-tauri-drag-region
          className="flex items-center gap-3 pl-[14px] pr-5 border-t-2 border-gold"
          style={{
            background: "linear-gradient(180deg,#0e1822,#050d14)",
            clipPath: "polygon(0 0,100% 0,calc(100% - 10px) 100%,0 100%)",
          }}
        >
          <span data-tauri-drag-region className="text-[19px] font-extrabold text-white leading-none tabular-nums">
            {stats!.cs_per_min.toFixed(1)}
          </span>
          <span data-tauri-drag-region className="text-[8px] uppercase tracking-[0.14em] text-[#6f8496] -mr-1.5">
            Total
          </span>
          <span data-tauri-drag-region className="text-[12px] font-bold text-hextech-blue leading-none tabular-nums">
            {stats!.cs}
          </span>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <OverlayApp />
    </I18nProvider>
  </React.StrictMode>
);
