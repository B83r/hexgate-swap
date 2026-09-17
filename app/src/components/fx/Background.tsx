import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Particles } from "./Particles";
import { prefersReducedMotion } from "@/lib/theme";
import { useWindowActive } from "@/lib/useWindowActive";
import { useLowPower } from "@/lib/useLowPower";
import { subscribePointer } from "@/lib/pointer";

/**
 * Fond vivant monté derrière toute l'UI (fixed inset-0 -z-10) :
 * dégradé profond + vignette, aurora blobs en dérive, poussière dorée,
 * filigrane hexagonal avec léger parallax à la souris.
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

  // Animations lourdes coupées quand l'utilisateur ne regarde pas la fenêtre
  // (partie en cours, app en arrière-plan), quand il a demandé moins de
  // mouvement, ou en mode Basse consommation.
  const active = useWindowActive();
  const lowPower = useLowPower();
  const animate = !prefersReducedMotion() && active && !lowPower;

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

      {/* couche 2 : aurora blobs — mêmes trajectoires/durées, mais en keyframes
          CSS (transform/opacity compositor-only) au lieu de framer JS/frame. */}
      {animate && (
        <>
          <div
            className="aurora-1 absolute h-[420px] w-[420px] rounded-full blur-3xl"
            style={{ background: "var(--glow-1)", opacity: 0.14, top: "-8%", left: "-6%" }}
          />
          <div
            className="aurora-2 absolute h-[380px] w-[380px] rounded-full blur-3xl"
            style={{ background: "var(--glow-2)", opacity: 0.12, bottom: "-10%", right: "-4%" }}
          />
          <div
            className="aurora-3 absolute left-1/2 top-1/3 h-[300px] w-[300px] rounded-full blur-3xl"
            style={{ background: "var(--glow-1)", opacity: 0.06 }}
          />
        </>
      )}

      {/* couche 3 : poussière lumineuse (canvas rAF — coupée hors focus) */}
      {animate && <Particles count={70} className="absolute inset-0 h-full w-full" />}

      {/* couche 4 : filigrane hexagonal + parallax */}
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
