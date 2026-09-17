import { useEffect, useRef } from "react";
import { accentColors, prefersReducedMotion } from "@/lib/theme";

interface Props {
  fire: number; // incrémenter pour déclencher un burst
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  color: string;
  size: number;
  life: number;
}

/** Burst de confettis dorés/bleus depuis le bas (déclenché via `fire`). */
export function Confetti({ fire }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bits = useRef<Bit[]>([]);
  const raf = useRef(0);

  useEffect(() => {
    if (fire === 0 || prefersReducedMotion()) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    ctx.scale(dpr, dpr);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;

    const { gold, blue, glow1 } = accentColors();
    const palette = [gold, blue, glow1, "#f0e6d2"];
    for (let i = 0; i < 80; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const speed = 6 + Math.random() * 7;
      bits.current.push({
        x: W / 2 + (Math.random() - 0.5) * 120,
        y: H + 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: palette[(Math.random() * palette.length) | 0],
        size: 4 + Math.random() * 5,
        life: 1,
      });
    }

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const b of bits.current) {
        if (b.life <= 0) continue;
        alive = true;
        b.vy += 0.22; // gravité
        b.vx *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.vr;
        b.life -= 0.009;
        ctx.save();
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * 0.6);
        ctx.restore();
      }
      if (alive) {
        raf.current = requestAnimationFrame(tick);
      } else {
        bits.current = [];
        ctx.clearRect(0, 0, w, h);
      }
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [fire]);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />;
}
