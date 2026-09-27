import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { avatarUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Product } from "@/lib/api";
import { Particles } from "./fx/Particles";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  account: string | null;
  iconId: number | null;
  currentStep: number; // -1 = idle, STEPS.length = terminé
  footer: string;
  footerTone: "muted" | "green" | "red";
  product?: Product;
}

/** Arc n°`i` d'un anneau découpé en `n` segments séparés par un petit intervalle. */
function arcPath(cx: number, cy: number, r: number, i: number, n: number): string {
  const gap = 0.16; // radians laissés vides entre deux segments
  const span = (Math.PI * 2) / n;
  const a0 = -Math.PI / 2 + span * i + gap / 2;
  const a1 = -Math.PI / 2 + span * (i + 1) - gap / 2;
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
}

export function SwapOverlay({ open, account, iconId, currentStep, footer, footerTone, product = "league_of_legends" }: Props) {
  const { t } = useI18n();
  const STEPS = [t("swap.step1"), t("swap.step2"), t("swap.step3"), t(product === "valorant" ? "swap.step4Val" : "swap.step4")];
  const launchWordmark = product === "valorant"
    ? "/assets/nextrank/logos/valorant-wordmark.webp"
    : "/assets/nextrank/logos/lol-wordmark.svg";
  const total = STEPS.length;
  const success = footerTone === "green";
  const error = footerTone === "red";
  const ringColor = error ? "#e05c5c" : success ? "#3ddc97" : "#c8aa6e";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
          animate={{ opacity: 1, backdropFilter: "blur(14px)" }}
          exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
          transition={{ duration: 0.4 }}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg/80"
        >
          {/* particules : convergence pendant, burst au succès */}
          <Particles
            key={success ? "burst" : "converge"}
            count={success ? 90 : 40}
            mode="converge"
            className="pointer-events-none absolute inset-0 h-full w-full"
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="relative flex flex-col items-center"
          >
            {/* ring hexagonal */}
            <motion.div
              className="relative h-[188px] w-[188px]"
              animate={error ? { x: [0, -8, 8, -6, 6, 0] } : {}}
              transition={{ duration: 0.35 }}
            >
              <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
                {/* Anneau à 4 segments : un par étape réelle du swap (fermeture du
                    client, restauration de la session, relance, lancement du jeu). */}
                {STEPS.map((_, i) => {
                  const done = i < currentStep || success;
                  const active = i === currentStep && !success && !error;
                  return (
                    <motion.path
                      key={i}
                      d={arcPath(100, 100, 80, i, total)}
                      fill="none"
                      strokeWidth="5"
                      strokeLinecap="round"
                      initial={false}
                      animate={{
                        stroke: done ? ringColor : active ? "#0ac8b9" : "#1e2d45",
                        opacity: active ? [0.55, 1, 0.55] : 1,
                      }}
                      transition={
                        active
                          ? { opacity: { duration: 1.2, repeat: Infinity, ease: "easeInOut" }, stroke: { duration: 0.3 } }
                          : { duration: 0.35 }
                      }
                      style={done ? { filter: `drop-shadow(0 0 5px ${ringColor})` } : undefined}
                    />
                  );
                })}
              </svg>

              {/* avatar du compte cible au centre */}
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.img
                  layoutId={`account-avatar-${account}`}
                  src={avatarUrl(iconId, account?.[0] ?? "?", ringColor)}
                  alt=""
                  className="h-[92px] w-[92px] rounded-full border-2"
                  style={{ borderColor: ringColor }}
                  animate={success ? { scale: [1, 1.08, 1] } : {}}
                  transition={{ duration: 0.6 }}
                />
              </div>
            </motion.div>

            <h2 className="mt-6 text-[18px] font-bold text-gold" style={{ fontFamily: "var(--font-display)" }}>
              {account}
            </h2>

            {/* étapes */}
            <div className="mt-4 flex flex-col gap-1.5">
              {STEPS.map((step, i) => {
                const done = i < currentStep || success;
                const active = i === currentStep && !success && !error;
                return (
                  <div
                    key={step}
                    className={cn(
                      "flex items-center gap-2 text-[13px] transition-colors",
                      done ? "text-green" : active ? "text-text" : "text-muted",
                    )}
                  >
                    <span className="flex h-4 w-4 items-center justify-center">
                      {done ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 15 }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </motion.span>
                      ) : active ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-hextech-blue" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-muted/40" />
                      )}
                    </span>
                    {i === 3 ? (
                      <span className="flex items-center gap-1.5">
                        <span>{t("swap.launching")}</span>
                        <img
                          src={launchWordmark}
                          alt={step}
                          className="h-[18px] w-auto max-w-[180px] object-contain object-left"
                        />
                      </span>
                    ) : step}
                  </div>
                );
              })}
            </div>

            {footer && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "mt-5 max-w-[320px] text-center text-[12px]",
                  success ? "text-green" : error ? "text-red" : "text-muted",
                )}
              >
                {footer}
              </motion.p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
