import { useState, useEffect } from "react";
import { champIconUrl, useDdragonVersion } from "@/lib/ddragon";
import { cn } from "@/lib/utils";

/**
 * Icône de champion avec repli propre : si Data Dragon n'a pas encore
 * l'image (champion tout juste sorti, version pas encore synchronisée),
 * affiche un médaillon avec l'initiale au lieu du texte brut cassé du <img alt>.
 */
export function ChampionIcon({ champion, className }: { champion: string; className?: string }) {
  const ddVersion = useDdragonVersion();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [champion]);

  if (!champion || failed) {
    return (
      <div
        className={cn(
          className,
          "flex items-center justify-center bg-[#0a1220] text-gold-dim font-extrabold select-none",
        )}
        title={champion || undefined}
      >
        {champion ? champion[0] : "?"}
      </div>
    );
  }

  return (
    <img
      src={champIconUrl(champion, ddVersion)}
      alt={champion}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
