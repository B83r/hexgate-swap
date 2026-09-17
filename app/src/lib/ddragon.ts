import { useEffect, useState } from "react";

// Dernière version Data Dragon connue au moment de ce build — utilisée le
// temps que la vraie version courante soit récupérée dynamiquement ci-dessous.
// Ne JAMAIS figer une version ici sans le fetch dynamique : un champion sorti
// après cette version affiche une icône cassée (cas vécu : "Locke" en texte
// brut sur l'historique de matchs, la version était pinnée à 14.22.1).
const FALLBACK_VERSION = "16.13.1";

let version = FALLBACK_VERSION;
let fetchStarted = false;
const listeners = new Set<() => void>();

function fetchLatestVersion() {
  if (fetchStarted) return;
  fetchStarted = true;
  fetch("https://ddragon.leagueoflegends.com/api/versions.json")
    .then((r) => r.json())
    .then((versions: string[]) => {
      if (versions?.[0] && versions[0] !== version) {
        version = versions[0];
        listeners.forEach((l) => l());
      }
    })
    .catch(() => {});
}
fetchLatestVersion();

/** Version Data Dragon courante (récupérée dynamiquement au démarrage de l'app). */
export function useDdragonVersion(): string {
  const [v, setV] = useState(version);
  useEffect(() => {
    const listener = () => setV(version);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return v;
}

export function champIconUrl(champion: string, ddVersion: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${champion}.png`;
}
export function itemIconUrl(itemId: number, ddVersion: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/item/${itemId}.png`;
}
export function profileIconUrl(iconId: number, ddVersion: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png`;
}
