import { useRef, ReactNode } from "react";
import { motion, useSpring, useMotionValue, HTMLMotionProps } from "framer-motion";
import { prefersReducedMotion } from "@/lib/theme";

interface MagneticButtonProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  stiffness?: number;
  damping?: number;
  mass?: number;
  className?: string;
}

export function MagneticButton({
  children,
  stiffness = 150,
  damping = 15,
  mass = 0.5,
  className = "",
  ...props
}: MagneticButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springX = useSpring(x, { stiffness, damping, mass });
  const springY = useSpring(y, { stiffness, damping, mass });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const pullX = (e.clientX - centerX) * 0.3;
    const pullY = (e.clientY - centerY) * 0.3;
    x.set(pullX);
    y.set(pullY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        x: reduced ? 0 : springX,
        y: reduced ? 0 : springY,
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
