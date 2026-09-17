import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface Props {
  enabled: boolean;
  onToggle: () => void;
}

export function AutoAcceptPill({ enabled, onToggle }: Props) {
  const { t } = useI18n();
  return (
    <button
      onClick={onToggle}
      title={t("nav.autoAccept")}
      className={cn(
        "flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[11px] font-bold transition-colors font-nav",
        enabled
          ? "border-green bg-[#0e2a1e] text-green hover:bg-[#143a2a]"
          : "border-border bg-panel text-muted hover:bg-card-hover",
      )}
    >
      <Zap
        className="h-3.5 w-3.5"
        style={enabled ? undefined : { fill: "url(#icon-gold-grad)", stroke: "none" }}
      />
      {/* Sous 1024 px, c'est ce libellé qui cède, pas celui des onglets : la
          navigation prime sur un interrupteur dont l'icône et l'état suffisent
          à se relire, et dont l'intitulé complet reste dans l'infobulle. */}
      <span className="hidden lg:inline">{t("nav.autoAccept")}&nbsp;·&nbsp;</span>
      {enabled ? "ON" : "OFF"}
    </button>
  );
}
