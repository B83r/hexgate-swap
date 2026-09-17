import { useEffect, useRef } from "react";
import { animate, useInView, useMotionValue } from "framer-motion";

interface Props {
  value: number;
  className?: string;
  duration?: number;
}

/** Compteur dont les chiffres « roulent » jusqu'à la valeur (Magic UI). */
export function NumberTicker({ value, className, duration = 1.1 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px" });
  const mv = useMotionValue(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = Math.round(v).toString();
      },
    });
    return () => controls.stop();
  }, [inView, value, duration, mv]);

  return <span ref={ref} className={className}>0</span>;
}
