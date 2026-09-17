interface Props {
  color?: string;
  duration?: number;
}

/**
 * Bordure lumineuse animée : un conic-gradient dont seul l'angle tourne
 * (via @property, cf. index.css), visible sur un liseré de 1.5px. Le parent
 * doit être `relative` et arrondi (rounded-[inherit]).
 */
export function BorderBeam({ color = "#3ddc97", duration = 4 }: Props) {
  return (
    <div
      aria-hidden
      className="border-beam pointer-events-none absolute inset-0 rounded-[inherit]"
      style={
        {
          "--beam-color": color,
          "--beam-duration": `${duration}s`,
        } as React.CSSProperties
      }
    />
  );
}
