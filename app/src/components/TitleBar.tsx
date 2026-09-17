import { Minus, Square, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Contrôles de fenêtre flottants (coin haut-droit), par-dessus le header. */
export function WindowControls() {
  const { t } = useI18n();
  const minimize = async () => isTauri && (await win()).minimize();
  const toggleMax = async () => isTauri && (await win()).toggleMaximize();
  const close = async () => isTauri && (await win()).close();

  return (
    <div className="absolute right-1.5 top-1.5 z-40 flex items-center">
      <TitleButton onClick={minimize} label={t("win.minimize")}>
        <Minus className="h-3.5 w-3.5" />
      </TitleButton>
      <TitleButton onClick={toggleMax} label={t("win.maximize")}>
        <Square className="h-3 w-3" />
      </TitleButton>
      <TitleButton onClick={close} label={t("win.close")} danger>
        <X className="h-3.5 w-3.5" />
      </TitleButton>
    </div>
  );
}

function TitleButton({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={
        "flex h-7 w-9 items-center justify-center rounded-md text-muted/80 backdrop-blur-sm transition-colors " +
        (danger ? "hover:bg-red hover:text-white" : "hover:bg-white/10 hover:text-text")
      }
    >
      {children}
    </button>
  );
}
