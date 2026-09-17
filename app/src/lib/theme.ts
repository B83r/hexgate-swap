/** Lecture des couleurs d'accent du thème actif (variables CSS) pour le canvas. */

export interface AccentColors {
  gold: string;
  blue: string;
  glow1: string;
  glow2: string;
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function accentColors(): AccentColors {
  return {
    gold: readVar("--color-gold", "#c8aa6e"),
    blue: readVar("--color-hextech-blue", "#0ac8b9"),
    glow1: readVar("--glow-1", "#c8aa6e"),
    glow2: readVar("--glow-2", "#0ac8b9"),
  };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Convertit "#rrggbb" en "rgba(r,g,b,a)". */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
