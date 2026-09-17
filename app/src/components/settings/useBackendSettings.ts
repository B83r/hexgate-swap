import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

type All = Awaited<ReturnType<typeof api.getSettingsAll>>;
type Writable = Parameters<typeof api.updateSettings>[0];

/** Charge `/settings/all` à l'ouverture du dialog et expose un `update` optimiste.
 *
 * Chaque onglet appelle ce hook plutôt que de recevoir une quinzaine de props du
 * parent : la valeur est mise à jour localement tout de suite (pas de latence sur
 * les interrupteurs) puis persistée, et un échec réseau remet l'ancienne valeur
 * pour ne jamais afficher un réglage qui n'a pas été enregistré. */
export function useBackendSettings(open: boolean) {
  const [values, setValues] = useState<All | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.getSettingsAll()
      .then((res) => { if (!cancelled) setValues(res); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [open]);

  const update = useCallback(async (patch: Writable) => {
    const previous = values;
    setValues((v) => (v ? { ...v, ...patch } : v));
    try {
      await api.updateSettings(patch);
    } catch (e) {
      setValues(previous);  // l'écriture a échoué : ne pas mentir sur l'état réel
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [values]);

  return { values, update };
}
