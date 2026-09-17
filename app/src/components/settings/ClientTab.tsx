import { useI18n } from "@/lib/i18n";
import { Row, Toggle } from "./primitives";
import { useBackendSettings } from "./useBackendSettings";

/** Onglet « Client & lancement » : tout ce qui concerne la façon dont Hexgate
 * démarre et pilote le Riot Client / League. Ces réglages étaient jusqu'ici
 * rangés sous « Apparence », ce qui n'avait aucun rapport. */
export function ClientTab({ open }: { open: boolean }) {
  const { t } = useI18n();
  const { values, update } = useBackendSettings(open);
  if (!values) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <Row
        title={t("set.riotLaunch")}
        desc={t("set.riotLaunchDesc")}
        control={
          <select
            value={values.riot_client_autostart_mode || "normal"}
            onChange={(e) => update({ riot_client_autostart_mode: e.target.value })}
            className="cursor-pointer rounded border border-border/80 bg-[#050b14] px-2 py-1 text-[11px] text-text outline-none focus:border-gold"
          >
            <option value="normal">{t("set.riotLaunchNormal")}</option>
            <option value="minimized">{t("set.riotLaunchMin")}</option>
            <option value="hidden">{t("set.riotLaunchHidden")}</option>
          </select>
        }
      />
      <Row
        title={t("set.riotClose")}
        desc={t("set.riotCloseDesc")}
        control={
          <Toggle
            checked={values.riot_client_auto_close}
            onToggle={() => update({ riot_client_auto_close: !values.riot_client_auto_close })}
          />
        }
      />
      <Row
        title={t("set.gameSettings")}
        desc={t("set.gameSettingsDesc")}
        control={
          <Toggle
            checked={values.game_settings_sync_enabled}
            onToggle={() => update({ game_settings_sync_enabled: !values.game_settings_sync_enabled })}
          />
        }
      />
      <Row
        title={t("set.rememberProduct")}
        desc={t("set.rememberProductDesc")}
        control={<Toggle checked={values.remember_last_product} onToggle={() => update({ remember_last_product: !values.remember_last_product })} />}
      />
      <Row
        title={t("set.relayNotifs")}
        desc={t("set.relayNotifsDesc")}
        control={
          <Toggle
            checked={values.relay_client_notifications}
            onToggle={() => update({ relay_client_notifications: !values.relay_client_notifications })}
          />
        }
      />
    </div>
  );
}
