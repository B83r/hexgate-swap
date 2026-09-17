import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Synchronise la visibilité RÉELLE de la fenêtre OS (show/hide Tauri) avec `shouldShow`.
 * La fenêtre d'un overlay existe toujours au-dessus du jeu tant qu'elle n'est pas .hide()-ée
 * explicitement — un simple `return null` côté React ne suffit pas à la faire disparaître.
 * Voir la règle "overlays in-game" dans CLAUDE.md avant de créer un nouvel overlay.
 */
export function useGameOnlyWindow(shouldShow: boolean, label: string) {
  const visible = useRef<boolean | null>(null);

  useEffect(() => {
    if (visible.current === shouldShow) return;
    visible.current = shouldShow;
    try {
      const win = getCurrentWindow();
      (shouldShow ? win.show() : win.hide()).catch((err) =>
        console.error(`${label}: show/hide rejeté`, err)
      );
    } catch (err) {
      console.error(`${label}: fenêtre Tauri indisponible`, err);
    }
  }, [shouldShow, label]);
}
