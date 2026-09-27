import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type PresetsPayload } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const GOLD_BTN =
  "h-8 shrink-0 cursor-pointer rounded-lg bg-gold px-3 text-[10px] font-bold text-black hover:bg-gold-bright disabled:opacity-50";

/** Recopie les réglages de jeu et les raccourcis d'un compte sur les autres.
 *
 * Réécrit le 20/09/2026 : l'écran précédent demandait d'inventer un nom de
 * « preset », puis d'appliquer une « configuration » à des « cibles », et
 * affichait un avertissement quand la synchro au changement de compte était
 * coupée — trois abstractions pour une seule intention réelle, « je prends les
 * réglages de ce compte-là et je les mets partout ». Il est désormais écrit
 * comme la phrase qu'on a en tête : étape 1, on copie depuis le compte
 * connecté (le modèle porte son nom, personne n'a à le choisir) ; étape 2, on
 * applique à tous les comptes, et la synchro est activée au passage puisque
 * c'est elle qui rend l'opération effective.
 *
 * Le client League doit être ouvert pour COPIER (les réglages sont lus depuis
 * lui) ; appliquer à des comptes hors-ligne fonctionne, l'effet est simplement
 * différé à leur prochaine connexion. */
export function SettingsStudio({ accounts }: { accounts: string[] }) {
  const { t } = useI18n();
  const [payload, setPayload] = useState<PresetsPayload | null>(null);
  const [model, setModel] = useState("");
  const [targets, setTargets] = useState<string[] | null>(null); // null = tous
  const [pickTargets, setPickTargets] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await api.settingsPresets();
      setPayload(next);
      // Le modèle sélectionné suit ce qui existe réellement : sans ça, un
      // modèle supprimé laissait un nom fantôme et « Appliquer » échouait en 404.
      setModel((current) =>
        next.presets.some((p) => p.name === current)
          ? current
          : next.presets[next.presets.length - 1]?.name ?? "",
      );
    } catch {
      setPayload(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Le modèle porte le nom du compte dont il vient : c'est l'unique repère
   * utile (« les réglages de HideIntheShnek »), et recopier depuis le même
   * compte remplace simplement l'ancienne version. */
  const copyFromActive = async () => {
    const source = payload?.active;
    if (!source) return;
    setBusy(true);
    try {
      const res = await api.savePreset(source);
      if (res.ok) {
        toast.success(t("studio.copied", { name: source }));
        setModel(source);
        await reload();
      } else toast.error(t("studio.copyFail"));
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(false);
    }
  };

  const applyToAccounts = async () => {
    if (!model) return;
    const chosen = targets ?? accounts;
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const res = await api.applyPreset(model, chosen, true, true);
      if (!res.ok) toast.error(t("studio.applyPartial", { n: res.errors.length }));
      else if (res.sync_turned_on) toast.success(t("studio.appliedSyncOn", { n: res.accounts }));
      else toast.success(t("studio.applied", { n: res.accounts }));
      await reload();
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(false);
    }
  };

  const removeModel = async () => {
    if (!model) return;
    setBusy(true);
    try {
      await api.deletePreset(model);
      toast.success(t("studio.modelDeleted"));
      await reload();
    } catch {
      toast.error(t("studio.modelDeleteFail"));
    } finally {
      setBusy(false);
    }
  };

  const active = payload?.active ?? null;
  const models = payload?.presets ?? [];
  const chosen = targets ?? accounts;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <p className="text-[10.5px] leading-snug text-muted">{t("studio.intro")}</p>

      {/* Étape 1 — copier depuis le compte connecté */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-[#050b14]/60 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-text">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[9px] font-black text-black">
            1
          </span>
          {t("studio.step1")}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[10.5px] text-muted">
            {active ? t("studio.step1From", { name: active }) : t("studio.step1NoAccount")}
          </span>
          <Button disabled={busy || !active} onClick={copyFromActive} className={GOLD_BTN}>
            <Copy className="mr-1 h-3 w-3" />
            {t("studio.copyBtn")}
          </Button>
        </div>
      </div>

      {/* Étape 2 — appliquer aux autres comptes */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-[#050b14]/60 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-text">
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black ${
              models.length ? "bg-gold text-black" : "bg-border text-muted"
            }`}
          >
            2
          </span>
          {t("studio.step2")}
        </div>

        {models.length === 0 ? (
          <p className="text-[10.5px] leading-snug text-muted">{t("studio.step2Empty")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-[#050b14] px-2 text-[11px] text-text outline-none focus:border-gold/60"
              >
                {models.map((p) => (
                  <option key={p.name} value={p.name}>
                    {t("studio.modelOf", { name: p.name })}
                  </option>
                ))}
              </select>
              <Button
                disabled={busy || !model}
                onClick={removeModel}
                className="h-8 shrink-0 cursor-pointer rounded-lg border border-red/40 bg-red/10 px-2.5 text-[10px] font-bold text-red hover:bg-red/20 disabled:opacity-50"
                title={t("studio.deleteModel")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button
              disabled={busy || !model || chosen.length === 0}
              onClick={applyToAccounts}
              className="h-9 w-full cursor-pointer rounded-lg bg-gold text-[11px] font-bold text-black hover:bg-gold-bright disabled:opacity-50"
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {targets === null
                ? t("studio.applyAll", { n: accounts.length })
                : t("studio.applySome", { n: chosen.length })}
            </Button>
            <p className="text-[10px] leading-snug text-muted">{t("studio.step2Effect")}</p>

            <button
              type="button"
              onClick={() => setPickTargets((v) => !v)}
              className="flex cursor-pointer items-center gap-1 self-start text-[10px] font-bold text-gold hover:underline"
            >
              <Users className="h-3 w-3" />
              {t("studio.chooseAccounts")}
              <ChevronDown className={`h-3 w-3 transition-transform ${pickTargets ? "rotate-180" : ""}`} />
            </button>

            {pickTargets && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border/40 pt-1.5">
                {accounts.map((name) => {
                  const checked = targets === null || targets.includes(name);
                  return (
                    <label
                      key={name}
                      className="flex cursor-pointer select-none items-center gap-2 text-[10.5px] text-muted"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setTargets((prev) => {
                            const base = prev ?? accounts;
                            const next = e.target.checked
                              ? [...new Set([...base, name])]
                              : base.filter((n) => n !== name);
                            return next.length === accounts.length ? null : next;
                          })
                        }
                        className="h-3.5 w-3.5 accent-gold"
                      />
                      <span className="truncate">{name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
