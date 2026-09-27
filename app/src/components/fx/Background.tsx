import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { prefersReducedMotion } from "@/lib/theme";
import { subscribePointer } from "@/lib/pointer";

/**
 * Fond vivant monté derrière toute l'UI (fixed inset-0 -z-10) :
 * dégradé profond + vignette + filigrane hexagonal avec léger parallax à la souris.
 * Aucune boucle d'animation : le fond reste immobile (budget d'animation).
 */
export function Background() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const px = useSpring(useTransform(mx, [-1, 1], [8, -8]), { stiffness: 40, damping: 20 });
  const py = useSpring(useTransform(my, [-1, 1], [8, -8]), { stiffness: 40, damping: 20 });

  useEffect(() => {
    if (prefersReducedMotion()) return;
    // Listener mousemove mutualisé (module pointeur partagé) — plus de listener
    // window dédié ici, il est fusionné avec celui des particules (repel).
    return subscribePointer((clientX, clientY) => {
      mx.set((clientX / window.innerWidth) * 2 - 1);
      my.set((clientY / window.innerHeight) * 2 - 1);
    });
  }, [mx, my]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* couche 1 : dégradé profond + vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 0%, #0a1428 0%, #061020 45%, #010a13 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          boxShadow: "inset 0 0 240px 60px rgba(0,0,0,0.75)",
        }}
      />

      {/* filigrane hexagonal + parallax */}
      <motion.div className="absolute inset-[-20px]" style={{ x: px, y: py }}>
        <svg className="h-full w-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="hexbg" width="56" height="64" patternUnits="userSpaceOnUse" patternTransform="scale(1.4)">
              <path
                d="M28 2 L52 16 L52 44 L28 58 L4 44 L4 16 Z"
                fill="none"
                stroke="var(--color-gold)"
                strokeWidth="1.2"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hexbg)" />
        </svg>
      </motion.div>
    </div>
  );
}
