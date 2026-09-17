import { useEffect, useState } from "react";
import { api, subscribeEvents } from "./api";

/**
 * Mode « Basse consommation » (réglage persisté backend `low_power_mode`).
 *
 * Quand actif : les animations permanentes (fond, particules, halos, beams,
 * sheen, logo), les backdrop-blurs et les fonds splash des cartes sont coupés —
 * seul endroit du produit où le visuel change, périmètre validé utilisateur.
 * La classe `low-power` est posée sur <html> (effets CSS, voir index.css) et
 * l'état est exposé aux composants React pour les branchements JS.
 *
 * Auto-activation à la PREMIÈRE utilisation si Windows est réglé sur « moins
 * d'animations » (prefers-reduced-motion) ; ensuite le choix explicite de
 * l'utilisateur (toggle réglages) est persisté et fait foi.
 *
 * Singleton : un seul init (fetch + abonnement SSE) par fenêtre.
 */
let _low = false;
let _initialized = false;
const _subs = new Set<(v: boolean) => void>();

function _apply(v: boolean) {
  if (v === _low && _initialized) return;
  _low = v;
  document.documentElement.classList.toggle("low-power", v);
  _subs.forEach((fn) => fn(v));
}

function _init() {
  if (_initialized) return;
  _initialized = true;
  api
    .getSettingsAll()
    .then((s) => {
      let v = !!s.low_power_mode;
      if (
        !v &&
        !localStorage.getItem("hexgate_low_power_auto_done") &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        v = true;
        api.setLowPower(true).catch(() => {});
      }
      localStorage.setItem("hexgate_low_power_auto_done", "1");
      _apply(v);
    })
    .catch(() => {});
  subscribeEvents((e) => {
    if (e.type === "low_power") _apply(!!e.data.enabled);
  });
}

export function useLowPower(): boolean {
  const [v, setV] = useState(_low);
  useEffect(() => {
    _init();
    setV(_low);
    _subs.add(setV);
    return () => {
      _subs.delete(setV);
    };
  }, []);
  return v;
}
