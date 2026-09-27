import { LifeBuoy, Lock, ShieldHalf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Row } from "./primitives";
import { APP_VERSION } from "@/lib/version";

const SUPPORT_URL = "https://github.com/B83r/hexgate-swap/issues";

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
      <p className="rounded-xl border border-border bg-card px-3.5 py-3 text-[11px] leading-relaxed text-muted">
        {t("set.aboutRiot")}
      </p>
      <Row title={t("set.aboutPrivacy")} desc={t("set.aboutPrivacyDesc")} icon={<Lock className="h-4 w-4 shrink-0 text-gold" />} />
      <Row
        title={t("set.aboutSupport")}
        desc={t("set.aboutSupportDesc")}
        icon={<LifeBuoy className="h-4 w-4 shrink-0 text-gold" />}
        control={
          <Button
            onClick={() => void api.openUrl(SUPPORT_URL)}
            className="h-8 shrink-0 cursor-pointer rounded-lg border border-gold/30 bg-[#0e1624]/60 px-3 text-[11px] font-bold text-gold hover:border-gold hover:bg-gold/5"
          >
            {t("set.aboutSupportBtn")}
          </Button>
        }
      />
    </div>
  );
}
