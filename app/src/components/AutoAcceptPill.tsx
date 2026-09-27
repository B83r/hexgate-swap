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
    // Le libellé est posé sous la pastille (positionné hors flux : la rangée de
    // boutons garde sa hauteur). Il remplace l'ancien intitulé « Auto-accept · »
    // qui disparaissait sous 1024 px — l'interrupteur n'était alors qu'une
    // icône éclair sans nom.
    <div className="relative shrink-0">
      <button
        onClick={onToggle}
        title={t("nav.autoAccept")}
        className={cn(
          "flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[11px] font-bold transition-colors font-nav",
          enabled
            ? "border-green bg-[#0e2a1e] text-green hover:bg-[#143a2a]"
            : "border-border bg-panel text-muted hover:bg-card-hover",
        )}
      >
        <Zap
          className="h-3.5 w-3.5"
          style={enabled ? undefined : { fill: "url(#icon-gold-grad)", stroke: "none" }}
        />
        {enabled ? "ON" : "OFF"}
      </button>
      <span
        className={cn(
          "pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold font-nav",
          enabled ? "text-green" : "text-muted",
        )}
      >
        {t("nav.autoAccept")}
      </span>
    </div>
  );
}
