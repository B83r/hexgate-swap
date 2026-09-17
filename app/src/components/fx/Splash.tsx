import { AnimatePresence, motion } from "framer-motion";
import { Logo } from "../Logo";

interface Props {
  show: boolean;
}

/** Écran d'ouverture : le logo se dessine, flash doré, puis révèle l'app. */
export function Splash({ show }: Props) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-bg"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <motion.div
            className="relative"
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 1.15, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            {/* halo qui pulse */}
            <motion.div
              className="absolute inset-0 rounded-full blur-2xl"
              style={{ background: "var(--color-gold)" }}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: [0, 0.35, 0.15], scale: [0.5, 1.4, 1.2] }}
              transition={{ duration: 1.6, times: [0, 0.7, 1] }}
            />
            <Logo size={140} draw className="relative" />
          </motion.div>

          <motion.p
            className="absolute bottom-[32%] text-[12px] font-semibold tracking-[0.3em] text-gold/70"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1, duration: 0.5 }}
          >
            HEXGATE SWAP
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
