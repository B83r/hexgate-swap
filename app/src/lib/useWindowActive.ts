import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";

/**
 * `true` quand la fenêtre principale est réellement REGARDÉE : au premier plan ET
 * non minimisée. Sert à couper les animations coûteuses (particules, aurores,
 * halos, border-beam) quand l'utilisateur ne voit pas l'app — typiquement pendant
 * une partie, League au premier plan. Repeindre 60 fps ce que personne ne regarde
 * est du pur gaspillage CPU/GPU.
 *
 * ⚠️ À n'utiliser QUE dans la fenêtre principale. Les overlays in-game ont leur
 * propre fenêtre qui n'a jamais le focus (click-through, always-on-top pendant que
 * le jeu a le focus) : y appliquer ce hook figerait leurs animations en pleine
 * partie, exactement quand elles doivent tourner.
 *
 * Singleton : un seul écouteur Tauri partagé par tous les composants abonnés
 * (sinon chaque carte enregistrerait son propre listener de focus).
 */
let _active = true;
let _initialized = false;
const _subs = new Set<(v: boolean) => void>();

function _set(v: boolean) {
  if (v === _active) return;
  _active = v;
  _subs.forEach((fn) => fn(v));
  // Le backend adapte la cadence de ses watchers (ping…) quand personne ne
  // regarde la fenêtre — fire-and-forget, jamais bloquant.
  api.setUiFocus(v).catch(() => {});
}

function _recompute() {
  try {
    getCurrentWindow()
      .isFocused()
      .then((focused) => _set(focused && document.visibilityState !== "hidden"))
      .catch(() => {});
  } catch {
    // hors contexte Tauri (preview navigateur) : on se base sur la seule visibilité
    _set(document.visibilityState !== "hidden");
  }
}

function _init() {
  if (_initialized) return;
  _initialized = true;
  try {
    getCurrentWindow()
      .onFocusChanged(({ payload }) => _set(payload && document.visibilityState !== "hidden"))
      .catch(() => {});
  } catch {
    // hors Tauri : rien à écouter
  }
  document.addEventListener("visibilitychange", _recompute);
  _recompute();
}

export function useWindowActive(): boolean {
  const [v, setV] = useState(_active);
  useEffect(() => {
    _init();
    setV(_active);
    _subs.add(setV);
    return () => {
      _subs.delete(setV);
    };
  }, []);
  return v;
}
