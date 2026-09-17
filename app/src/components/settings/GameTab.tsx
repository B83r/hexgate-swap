import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GroupTitle, Row, SavedInput, Toggle } from "./primitives";
import { useBackendSettings } from "./useBackendSettings";

/** Onglet « File & partie » : automatisations qui s'appliquent pendant la
 * recherche de partie, la sélection des champions et le match lui-même. */
export function GameTab({ open }: { open: boolean }) {
  const { t } = useI18n();
  const { values, update } = useBackendSettings(open);
  // Le curseur ne persiste qu'au relâchement : sinon chaque cran traversé
  // déclencherait une écriture backend.
  const [delay, setDelay] = useState(0);

  useEffect(() => {
    if (values) setDelay(values.auto_accept_delay);
  }, [values?.auto_accept_delay]);

  if (!values) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <Row title={t("set.autoAcceptDelay")} control={<span className="text-[11px] font-bold text-gold">{delay}s</span>}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            onPointerUp={() => update({ auto_accept_delay: delay })}
            onKeyUp={() => update({ auto_accept_delay: delay })}
            className="flex-1 cursor-pointer accent-gold"
          />
          <span className="select-none text-[10px] text-muted">{t("set.autoAcceptDelayHint")}</span>
        </div>
      </Row>

      <Row
        title={t("set.autoAcceptInv")}
        desc={t("set.autoAcceptInvDesc")}
        control={
          <Toggle
            checked={values.auto_accept_invitations}
            onToggle={() => update({ auto_accept_invitations: !values.auto_accept_invitations })}
          />
        }
      />
      <Row
        title={t("set.skipEog")}
        desc={t("set.skipEogDesc")}
        control={
          <Toggle
            checked={values.skip_end_of_game}
            onToggle={() => update({ skip_end_of_game: !values.skip_end_of_game })}
          />
        }
      />
      <Row
        title={t("set.muteAll")}
        desc={t("set.muteAllDesc")}
        control={
          <Toggle
            checked={values.auto_mute_all_on_start}
            onToggle={() => update({ auto_mute_all_on_start: !values.auto_mute_all_on_start })}
          />
        }
      />

      <GroupTitle>{t("set.macros")}</GroupTitle>
      <Row title={t("set.macros")} desc={t("set.macrosDesc")}>
        <div className="flex flex-col gap-2">
          <SavedInput
            prefix="F5 :"
            value={values.macro_f5_text || ""}
            placeholder={t("set.phMacroF5")}
            onSave={(v) => update({ macro_f5_text: v })}
          />
          <SavedInput
            prefix="F6 :"
            value={values.macro_f6_text || ""}
            placeholder={t("set.phMacroF6")}
            onSave={(v) => update({ macro_f6_text: v })}
          />
        </div>
        {values.is_admin === false && (
          <div className="mt-1 flex items-start gap-2.5 rounded-lg border border-red/40 bg-red/5 p-2.5 text-[9.5px] leading-relaxed text-red">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <span className="font-bold">{t("set.adminWarnTitle")} : </span>
              {t("set.adminWarn")}
            </div>
          </div>
        )}
      </Row>

      <Row title={t("set.welcomeMsg")} desc={t("set.welcomeMsgDesc")}>
        <SavedInput
          value={values.lobby_welcome_message || ""}
          placeholder={t("set.phWelcome")}
          onSave={(v) => update({ lobby_welcome_message: v })}
        />
      </Row>

      <Row title={t("set.eogMsg")} desc={t("set.eogMsgDesc")}>
        <SavedInput
          value={values.end_of_game_message || ""}
          placeholder={t("set.phEogMsg")}
          onSave={(v) => update({ end_of_game_message: v })}
        />
        {/* Un interrupteur nu à droite du titre se lisait comme un
            « activer/désactiver » : rien n'indiquait qu'il choisissait le
            destinataire. Deux options nommées lèvent l'ambiguïté. */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-gold-dim">
            {t("set.eogMsgTarget")}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-gold-dim/40">
            {[
              { teamOnly: false, label: t("set.eogMsgToAll") },
              { teamOnly: true, label: t("set.eogMsgToTeam") },
            ].map((opt) => (
              <button
                key={String(opt.teamOnly)}
                type="button"
                onClick={() => update({ end_of_game_message_team_only: opt.teamOnly })}
                className={cn(
                  "cursor-pointer px-2.5 py-1 text-[10.5px] font-semibold transition-colors",
                  values.end_of_game_message_team_only === opt.teamOnly
                    ? "bg-gold text-black"
                    : "bg-panel text-muted hover:text-text",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Row>

      <Row title={t("set.aram")} desc={t("set.aramDesc")}>
        <SavedInput
          value={values.aram_sniper_champions || ""}
          placeholder="Ex: Yasuo, Yone, Ezreal…"
          onSave={(v) => update({ aram_sniper_champions: v })}
        />
      </Row>
    </div>
  );
}
