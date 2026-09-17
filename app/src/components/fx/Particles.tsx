import { useEffect, useRef } from "react";
import { accentColors, prefersReducedMotion, withAlpha } from "@/lib/theme";
import { subscribePointer } from "@/lib/pointer";

interface Particle {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  a: number;
  tw: number; // vitesse de scintillement
  gold: boolean;
  bucket: number; // index du sprite glow pré-rendu (par tranche de rayon)
}

interface Props {
  count?: number;
  className?: string;
  /** Zone d'apparition initiale et sens : "drift" (fond) ou "converge" (vers le centre). */
  mode?: "drift" | "converge";
}

// Glow figé (ex-`shadowBlur=6` par particule/frame, le poste canvas le plus cher).
const GLOW = 6;
const R_MIN = 0.6;
const R_MAX = 2.4;
const BUCKETS = 8; // tranches de rayon → cœur net, glow constant, pixels identiques

interface Sprite {
  canvas: HTMLCanvasElement;
  size: number; // côté en px CSS (identique pour tous les buckets)
}

/**
 * Pré-rend un sprite glow pour une couleur + un rayon de cœur donné. Réplique
 * EXACTEMENT le rendu d'origine `arc(r) + shadowBlur=6` : cœur plein à alpha 1,
 * halo (shadow) à alpha 0.8 — le ratio 0.8 est ensuite préservé car chaque
 * particule applique `globalAlpha = alpha` (le scintillement) au drawImage, ce
 * qui module cœur ET halo dans la même proportion qu'avant (fill=alpha,
 * shadow=alpha*0.8). shadowBlur n'est donc calculé qu'UNE fois par bucket, plus
 * jamais par frame.
 */
function makeSprite(color: string, coreR: number, dpr: number, size: number): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size * dpr);
  canvas.height = Math.ceil(size * dpr);
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = size / 2;
  g.beginPath();
  g.arc(c, c, coreR, 0, Math.PI * 2);
  g.fillStyle = withAlpha(color, 1);
  g.shadowBlur = GLOW;
  g.shadowColor = withAlpha(color, 0.8);
  g.fill();
  return { canvas, size };
}

/**
 * Poussière lumineuse sur canvas (léger, ~80 particules). Se met en pause quand
 * la fenêtre est cachée et respecte prefers-reduced-motion.
 */
export function Particles({ count = 80, className, mode = "drift" }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const colors = accentColors();

    // Sprites glow pré-rendus : BUCKETS rayons × 2 couleurs. Taille commune
    // (dimensionnée sur R_MAX + le débordement du glow) → offset de centrage
    // constant. Générés une fois, réutilisés à chaque frame via drawImage.
    // marge = 3× le blur : au-delà de ~2,5σ le halo est sous le seuil visible,
    // donc aucun clip perceptible (glow strictement identique à l'ancien rendu).
    const spriteSize = Math.ceil((R_MAX + GLOW * 3) * 2);
    const bucketR = (i: number) => R_MIN + (i / (BUCKETS - 1)) * (R_MAX - R_MIN);
    const goldSprites = Array.from({ length: BUCKETS }, (_, i) =>
      makeSprite(colors.gold, bucketR(i), dpr, spriteSize),
    );
    const blueSprites = Array.from({ length: BUCKETS }, (_, i) =>
      makeSprite(colors.blue, bucketR(i), dpr, spriteSize),
    );
    const half = spriteSize / 2;

    const bucketOf = (r: number) =>
      Math.max(0, Math.min(BUCKETS - 1, Math.round(((r - R_MIN) / (R_MAX - R_MIN)) * (BUCKETS - 1))));

    const particles: Particle[] = Array.from({ length: count }, () => spawn());

    function spawn(): Particle {
      const r = 0.6 + Math.random() * 1.8;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r,
        vy: mode === "drift" ? -(0.05 + Math.random() * 0.25) : 0,
        vx: (Math.random() - 0.5) * 0.15,
        a: 0.1 + Math.random() * 0.5,
        tw: 0.005 + Math.random() * 0.02,
        gold: Math.random() > 0.35,
        bucket: bucketOf(r),
      };
    }

    let mouseX = -1000;
    let mouseY = -1000;
    const unsubscribe = subscribePointer((clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = clientX - rect.left;
      mouseY = clientY - rect.top;
    });

    let raf = 0;
    let twPhase = 0;
    const cx = () => w / 2;
    const cy = () => h / 2;

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      twPhase += 0.02;
      for (const p of particles) {
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let repelX = 0;
        let repelY = 0;
        if (dist < 120 && dist > 0.1) {
          const force = (120 - dist) / 120;
          repelX = (dx / dist) * force * 2;
          repelY = (dy / dist) * force * 2;
        }

        if (mode === "converge") {
          p.x += (cx() - p.x) * 0.008 + p.vx + repelX;
          p.y += (cy() - p.y) * 0.008 + repelY;
        } else {
          p.y += p.vy + repelY;
          p.x += p.vx + repelX;
          if (p.y < -20) {
            p.y = h + 20;
            p.x = Math.random() * w;
          }
          if (p.y > h + 20) p.y = -20;
          if (p.x < -20) p.x = w + 20;
          if (p.x > w + 20) p.x = -20;
        }
        const alpha = p.a * (0.6 + 0.4 * Math.sin(twPhase * (p.tw * 60)));
        const sprite = p.gold ? goldSprites[p.bucket] : blueSprites[p.bucket];
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.drawImage(sprite.canvas, p.x - half, p.y - half, spriteSize, spriteSize);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [count, mode]);

  return <canvas ref={ref} className={className} />;
}
