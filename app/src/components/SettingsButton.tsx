import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface Props {
  onClick: () => void;
  className?: string;
}

export function SettingsButton({ onClick, className }: Props) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      aria-label={t("settings.title")}
      className={cn(
        "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-panel text-muted transition-colors hover:border-gold-dim hover:text-gold",
        className,
      )}
    >
      <Settings className="h-[15px] w-[15px]" />
    </button>
  );
}
