import { motion, type MotionProps } from "framer-motion";

export type LogoAnim = "none" | "spin" | "pulse" | "draw" | "sweep";

interface LogoProps {
  size?: number;
  /** Anime le tracé du contour une seule fois (splash d'ouverture). */
  draw?: boolean;
  /** Animation continue : "spin" | "pulse" | "draw" | "sweep". */
  anim?: LogoAnim;
  className?: string;
}

const HEX_OUTER = hexPath(50, 50, 46);
const HEX_MID = hexPath(50, 50, 40);
const ARC_TOP = "M 28.4 42.1 A 23 23 0 0 1 71.6 42.1";
const ARC_BOTTOM = "M 71.6 57.9 A 23 23 0 0 1 28.4 57.9";
const ARROW_R = "M 65 40 L 78.5 41 L 71 52 Z";
const ARROW_L = "M 35 60 L 21.5 59 L 29 48 Z";

/**
 * Logo Hextech : hexagone doré à double bordure + deux flèches de cycle
 * (symbole du swap). Couleurs alignées sur le thème via les variables CSS.
 */
export function Logo({ size = 56, draw = false, anim = "none", className }: LogoProps) {
  const drawProps = (delay: number): MotionProps =>
    draw
      ? {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { duration: 1.1, delay, ease: "easeInOut" },
        }
      : {};

  // animation continue des flèches de cycle
  const arrowLoop: MotionProps =
    anim === "draw"
      ? {
          initial: { pathLength: 0 },
          animate: { pathLength: [0, 1, 1, 0] },
          transition: { duration: 3, repeat: Infinity, ease: "easeInOut", times: [0, 0.45, 0.75, 1] },
        }
      : {};

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      style={{ transformBox: "view-box", transformOrigin: "50px 50px" }}
      // pulse : le logo entier respire
      animate={anim === "pulse" ? { scale: [1, 1.06, 1] } : undefined}
      transition={anim === "pulse" ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" } : undefined}
    >
      <defs>
        <linearGradient id="logoGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-gold-dim)" />
          <stop offset="50%" stopColor="var(--color-gold)" />
          <stop offset="100%" stopColor="var(--color-gold-bright)" />
        </linearGradient>
        <filter id="logoGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* fond hexagonal sombre */}
      <path d={HEX_OUTER} fill="#010a13" />
      {/* double bordure dorée */}
      <motion.path d={HEX_OUTER} stroke="url(#logoGold)" strokeWidth="5" strokeLinejoin="round" {...drawProps(0)} />
      <motion.path
        d={HEX_MID}
        stroke="var(--color-gold-bright)"
        strokeWidth="1.4"
        strokeOpacity="0.7"
        strokeLinejoin="round"
        {...drawProps(0.15)}
      />

      {/* sweep : un éclat doré parcourt la bordure de l'hexagone */}
      {anim === "sweep" && (
        <motion.path
          d={HEX_OUTER}
          stroke="var(--color-gold-bright)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="16 260"
          animate={{ strokeDashoffset: [0, -276] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          style={{ filter: "drop-shadow(0 0 3px var(--color-gold-bright))" }}
        />
      )}

      {/* flèches de cycle — pivotent en continu pour "spin" */}
      <motion.g
        filter="url(#logoGlow)"
        style={{ transformBox: "view-box", transformOrigin: "50px 50px" }}
        animate={anim === "spin" ? { rotate: 360 } : undefined}
        transition={anim === "spin" ? { duration: 3.5, repeat: Infinity, ease: "linear" } : undefined}
      >
        <motion.path d={ARC_TOP} stroke="var(--color-hextech-blue)" strokeWidth="5.5" strokeLinecap="round" {...drawProps(0.4)} {...arrowLoop} />
        <motion.path d={ARC_BOTTOM} stroke="var(--color-hextech-blue)" strokeWidth="5.5" strokeLinecap="round" {...drawProps(0.55)} {...arrowLoop} />
        <motion.path d={ARROW_R} fill="var(--color-hextech-blue)" {...drawProps(0.8)} {...arrowLoop} />
        <motion.path d={ARROW_L} fill="var(--color-hextech-blue)" {...drawProps(0.8)} {...arrowLoop} />
      </motion.g>
    </motion.svg>
  );
}

function hexPath(cx: number, cy: number, r: number): string {
  return (
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ") + " Z"
  );
}
