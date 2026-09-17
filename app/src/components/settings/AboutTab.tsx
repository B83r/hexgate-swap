import { ShieldHalf } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Row } from "./primitives";
import { APP_VERSION } from "@/lib/version";

/** Onglet « À propos » : version et mention légale de non-affiliation à Riot
 * Games — obligatoire dans la policy Riot pour toute application tierce. */
export function AboutTab() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2.5">
      <Row
        title="Hexgate Swap"
        desc={`${t("set.aboutVersion")} ${APP_VERSION}`}
        icon={<ShieldHalf className="h-4 w-4 shrink-0 text-gold" />}
      />
      <p className="rounded-xl border border-border bg-card px-3.5 py-3 text-[10.5px] leading-relaxed text-muted">
        {t("set.aboutRiot")}
      </p>
    </div>
  );
}
