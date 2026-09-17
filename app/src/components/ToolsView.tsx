import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight, BellOff, Dices, Eraser, Image, HeartHandshake, Keyboard, Save, Sparkles, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type Account, type IdentityField, type SwapKind, type ToolsState } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Row } from "./settings/primitives";
import { SettingsStudio } from "./SettingsStudio";

/** Ordre d'affichage des cases à cocher du retrait d'identité. */
const IDENTITY_FIELDS: IdentityField[] = ["tokens", "banner", "crest", "prestige", "title"];

/** Intitulé de section.
 *
 * DOIT rester au niveau module. Définie dans le corps de `ToolsView`, elle
 * devenait un type de composant NEUF à chaque rendu : React démontait puis
 * remontait tout le sous-arbre, `SettingsStudio` perdait son état et
 * rechargeait en boucle — l'interface « s'ouvrait et se refermait »
 * (constaté le 13/09/2026). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-0.5 text-[10px] font-bold uppercase tracking-wider text-gold/80">{title}</h2>
      {children}
    </section>
  );
}

/** Onglet « Outils » : toutes les actions ponctuelles sur le client League.
 *
 * Rapatrié depuis Réglages → Outils le 12/09/2026. Ce ne sont pas des
 * préférences : rien n'est persisté, chaque bouton agit immédiatement sur le
 * client en cours. Les mélanger aux réglages les rendait introuvables.
 *
 * League uniquement — tout passe par l'API locale du client LoL, que VALORANT
 * n'expose pas. */
export function ToolsView({ accounts }: { accounts: Account[] }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [keepUnowned, setKeepUnowned] = useState(true);
  const [identity, setIdentity] = useState<IdentityField[]>([]);
  const [iconId, setIconId] = useState("");
  const [skinId, setSkinId] = useState("");
  const [target, setTarget] = useState(accounts[0]?.name ?? "");
  const [state, setState] = useState<ToolsState | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await api.toolsState());
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    // Le compte visé suit la liste : sans ça, supprimer le compte sélectionné
    // laissait un nom fantôme et les actions échouaient en 404.
    if (!accounts.some((a) => a.name === target)) setTarget(accounts[0]?.name ?? "");
  }, [accounts, target]);

  /** Exécute une action LCU en gérant l'occupation, le compte d'objets
   * traités et l'absence de client, puis rafraîchit l'état affiché. */
  const run = async (
    id: string,
    call: () => Promise<{ ok: boolean; count: number }>,
    doneKey: string,
    noneKey: string,
    failKey = "set.disFail",
  ) => {
    setBusy(id);
    try {
      const res = await call();
      if (res.ok && res.count > 0) toast.success(t(doneKey, { n: res.count }));
      else if (res.ok) toast.info(t(noneKey));
      else toast.error(t(failKey));
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(null);
      void reload();
    }
  };

  /** Variante pour les actions sans compteur : succès ou échec. */
  const runSimple = async (
    id: string,
    call: () => Promise<{ ok: boolean }>,
    okKey: string,
    failKey: string,
  ) => {
    setBusy(id);
    try {
      const res = await call();
      if (res.ok) toast.success(t(okKey));
      else toast.error(t(failKey));
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(null);
      void reload();
    }
  };

  const honor = async () => {
    setBusy("honor");
    try {
      const res = await api.honorRandomAlly();
      if (res.ok && res.player) toast.success(t("tools.honorOk", { name: res.player.name }));
      else toast.info(t("tools.honorNone"));
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(null);
      void reload();
    }
  };

  const swap = async (kind: SwapKind, id: number, action: "accept" | "decline") => {
    setBusy(`swap-${id}`);
    try {
      const res = await api.respondToSwap(kind, id, action);
      if (res.ok) toast.success(t(action === "accept" ? "tools.swapAccepted" : "tools.swapDeclined"));
      else toast.error(t("tools.swapFail"));
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(null);
      void reload();
    }
  };

  const repair = async () => {
    try {
      const res = await api.repairLeague();
      if (res.ok) toast.success(t("set.repairOk"));
      else toast.error(t("set.repairFail"));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const numericBtn =
    "h-8 shrink-0 cursor-pointer rounded-lg bg-gold px-3 text-[10px] font-bold text-black hover:bg-gold-bright disabled:opacity-50";
  const ghostBtn =
    "h-8 shrink-0 cursor-pointer rounded-lg border border-gold/30 bg-[#0e1624]/60 px-3 text-[10px] font-bold text-gold transition-all hover:border-gold hover:bg-gold/5 disabled:opacity-50";
  const numberInput =
    "h-8 w-24 rounded-lg border border-border bg-[#050b14] px-2 text-[11px] text-text outline-none focus:border-gold/60";

  return (
    <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3">
      <p className="text-[10.5px] leading-snug text-muted">{t("set.toolsIntro")}</p>

      <Section title={t("tools.section.profile")}>
        <Row
          title={t("set.identity")}
          desc={t("set.identityDesc")}
          icon={<Eraser className="h-4 w-4 shrink-0 text-muted" />}
          control={
            <Button
              disabled={busy !== null || identity.length === 0}
              onClick={() =>
                run("identity", () => api.clearIdentity(identity), "set.identityDone", "set.identityNone", "set.identityFail")
              }
              className={numericBtn}
            >
              {t("set.identityBtn")}
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {IDENTITY_FIELDS.map((field) => (
              <label key={field} className="flex cursor-pointer select-none items-center gap-2 text-[10.5px] text-muted">
                <input
                  type="checkbox"
                  checked={identity.includes(field)}
                  onChange={(e) =>
                    setIdentity((prev) =>
                      e.target.checked ? [...prev, field] : prev.filter((f) => f !== field),
                    )
                  }
                  className="h-3.5 w-3.5 accent-gold"
                />
                {t(`set.identity.${field}`)}
              </label>
            ))}
          </div>
        </Row>

        <Row
          title={t("tools.icon")}
          desc={t("tools.iconDesc")}
          icon={<Sparkles className="h-4 w-4 shrink-0 text-muted" />}
          control={
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                min={0}
                value={iconId}
                onChange={(e) => setIconId(e.target.value)}
                placeholder="0"
                className={numberInput}
              />
              <Button
                disabled={busy !== null || !iconId}
                onClick={() =>
                  runSimple("icon", () => api.setProfileIcon(Number(iconId)), "tools.iconOk", "tools.iconFail")
                }
                className={numericBtn}
              >
                {t("tools.apply")}
              </Button>
            </div>
          }
        />

        <Row
          title={t("tools.background")}
          desc={t("tools.backgroundDesc")}
          icon={<Image className="h-4 w-4 shrink-0 text-muted" />}
          control={
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                min={0}
                value={skinId}
                onChange={(e) => setSkinId(e.target.value)}
                placeholder="0"
                className={numberInput}
              />
              <Button
                disabled={busy !== null || !skinId}
                onClick={() =>
                  runSimple("bg", () => api.setProfileBackground(Number(skinId)), "tools.backgroundOk", "tools.backgroundFail")
                }
                className={numericBtn}
              >
                {t("tools.apply")}
              </Button>
            </div>
          }
        />

        <Row
          title={t("tools.identityBackup")}
          desc={t("tools.identityBackupDesc")}
          icon={<Save className="h-4 w-4 shrink-0 text-muted" />}
        >
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-[#050b14] px-2 text-[11px] text-text outline-none focus:border-gold/60"
            >
              {accounts.length === 0 && <option value="">{t("tools.noAccount")}</option>}
              {accounts.map((a) => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
            <Button
              disabled={busy !== null || !target}
              onClick={() => runSimple("idsave", () => api.saveIdentity(target), "tools.identitySaved", "tools.identitySaveFail")}
              className={numericBtn}
            >
              {t("tools.save")}
            </Button>
            <Button
              disabled={busy !== null || !target}
              onClick={() => runSimple("idrestore", () => api.restoreIdentity(target), "tools.identityRestored", "tools.identityRestoreFail")}
              className={ghostBtn}
            >
              {t("tools.restore")}
            </Button>
          </div>
        </Row>
      </Section>

      <Section title={t("tools.section.settings")}>
        <SettingsStudio accounts={accounts.map((a) => a.name)} />
      </Section>

      <Section title={t("tools.section.game")}>
        <Row
          title={t("tools.honor")}
          desc={
            state?.honor_votes != null
              ? t("tools.honorVotes", { n: state.honor_votes })
              : t("tools.honorDesc")
          }
          icon={<HeartHandshake className="h-4 w-4 shrink-0 text-muted" />}
          control={
            <Button disabled={busy !== null} onClick={honor} className={numericBtn}>
              {t("tools.honorBtn")}
            </Button>
          }
        />

        <Row
          title={t("tools.reroll")}
          desc={
            state?.reroll
              ? t("tools.rerollPoints", { n: state.reroll.current, cost: state.reroll.cost })
              : t("tools.rerollDesc")
          }
          icon={<Dices className="h-4 w-4 shrink-0 text-muted" />}
          control={
            <Button
              disabled={busy !== null}
              onClick={() => runSimple("reroll", api.rerollChampion, "tools.rerollOk", "tools.rerollFail")}
              className={numericBtn}
            >
              {t("tools.rerollBtn")}
            </Button>
          }
        />

        <Row
          title={t("tools.swaps")}
          desc={t("tools.swapsDesc")}
          icon={<ArrowLeftRight className="h-4 w-4 shrink-0 text-muted" />}
        >
          {!state?.swaps.length ? (
            <p className="text-[10.5px] text-muted">{t("tools.swapsNone")}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {state.swaps.map((s) => (
                <div key={`${s.kind}-${s.id}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-text">{t(`tools.swapKind.${s.kind}`)}</span>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      disabled={busy !== null}
                      onClick={() => swap(s.kind, s.id, "accept")}
                      className={numericBtn}
                    >
                      {t("tools.swapAccept")}
                    </Button>
                    <Button
                      disabled={busy !== null}
                      onClick={() => swap(s.kind, s.id, "decline")}
                      className={ghostBtn}
                    >
                      {t("tools.swapDecline")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Row>
      </Section>

      <Section title={t("tools.section.loot")}>
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={busy !== null}
            onClick={() => run("chests", api.openChests, "set.chestsDone", "set.chestsNone")}
            className="h-11 cursor-pointer select-none rounded-xl border border-gold/30 bg-[#0e1624]/60 py-2 text-[10px] font-bold text-gold transition-all hover:border-gold hover:bg-gold/5 disabled:opacity-50"
          >
            {t("set.chests")}
          </Button>
          <Button
            disabled={busy !== null}
            onClick={() => run("wards", api.disenchantWardsIcons, "set.disWardsDone", "set.disWardsNone")}
            className="h-11 cursor-pointer select-none rounded-xl border border-gold/30 bg-[#0e1624]/60 py-2 text-[10px] font-bold text-gold transition-all hover:border-gold hover:bg-gold/5 disabled:opacity-50"
          >
            {t("set.disWards")}
          </Button>
        </div>

        <Row
          title={t("set.disChamps")}
          control={
            <Button
              disabled={busy !== null}
              onClick={() =>
                run("champs", () => api.disenchantChampionShards(keepUnowned), "set.disChampsDone", "set.disChampsNone")
              }
              className={numericBtn}
            >
              {t("set.disChampsBtn")}
            </Button>
          }
        >
          <label className="flex cursor-pointer select-none items-center gap-2 text-[10.5px] text-muted">
            <input
              type="checkbox"
              checked={keepUnowned}
              onChange={(e) => setKeepUnowned(e.target.checked)}
              className="h-3.5 w-3.5 accent-gold"
            />
            {t("set.disChampsKeep")}
          </label>
        </Row>
      </Section>

      <Section title={t("tools.section.client")}>
        <Row
          title={t("tools.settings")}
          desc={t("tools.settingsDesc")}
          icon={<Keyboard className="h-4 w-4 shrink-0 text-muted" />}
        >
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-[#050b14] px-2 text-[11px] text-text outline-none focus:border-gold/60"
            >
              {accounts.length === 0 && <option value="">{t("tools.noAccount")}</option>}
              {accounts.map((a) => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
            <Button
              disabled={busy !== null || !target}
              onClick={() => runSimple("setsave", () => api.saveGameSettings(target), "tools.settingsSaved", "tools.settingsSaveFail")}
              className={numericBtn}
            >
              {t("tools.save")}
            </Button>
            <Button
              disabled={busy !== null || !target}
              onClick={() => runSimple("setrestore", () => api.restoreGameSettings(target), "tools.settingsRestored", "tools.settingsRestoreFail")}
              className={ghostBtn}
            >
              {t("tools.restore")}
            </Button>
          </div>
        </Row>

        <Row
          title={t("tools.notifications")}
          desc={t("tools.notificationsDesc")}
          icon={<BellOff className="h-4 w-4 shrink-0 text-muted" />}
          control={
            <Button
              disabled={busy !== null}
              onClick={() =>
                run("notifs", api.clearNotifications, "tools.notificationsDone", "tools.notificationsNone")
              }
              className={numericBtn}
            >
              {t("tools.notificationsBtn")}
            </Button>
          }
        />

        <Row
          title={t("set.repair")}
          desc={t("set.repairDesc")}
          icon={<Wrench className="h-4 w-4 shrink-0 text-muted" />}
          control={
            <Button
              onClick={repair}
              className="h-8 cursor-pointer rounded-lg border border-red/40 bg-red/10 px-3 text-[11px] font-bold text-red transition-all hover:bg-red/20"
            >
              {t("set.repairBtn")}
            </Button>
          }
        />
      </Section>
    </div>
  );
}
