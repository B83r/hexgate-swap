import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Interrupteur : le curseur glisse de la droite vers la gauche à l'activation
 * (animation `layout` de framer-motion). Historiquement « StreamerToggle », il
 * sert en réalité à TOUS les réglages booléens — d'où le renommage. */
export function Toggle({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "relative flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-300",
        checked ? "justify-start border-hextech-blue/70 bg-hextech-blue/25" : "justify-end border-border bg-border/40",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className={cn(
          "h-5 w-5 rounded-full shadow-md",
          checked ? "bg-hextech-blue shadow-hextech-blue/40" : "bg-muted",
        )}
      />
    </button>
  );
}

/** Carte d'un réglage : titre, description optionnelle, contrôle à droite.
 * `children` vertical (mise en page en colonne) via `stacked`. */
export function Row({
  title,
  desc,
  icon,
  control,
  children,
}: {
  title: string;
  desc?: string;
  icon?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-text">{title}</div>
            {desc && <div className="text-[10.5px] leading-snug text-muted">{desc}</div>}
          </div>
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}

/** Champ texte à validation explicite : le bouton n'apparaît que si la valeur a
 * changé, ce qui évite de laisser croire qu'une saisie non validée est
 * enregistrée (piège des anciens champs macro/ARAM/message de bienvenue). */
export function SavedInput({
  value,
  placeholder,
  onSave,
  type = "text",
  prefix,
}: {
  value: string;
  placeholder?: string;
  onSave: (next: string) => void;
  type?: "text" | "password";
  prefix?: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;

  return (
    <div className="flex items-center gap-2">
      {prefix && (
        <span className="w-6 shrink-0 select-none text-[10.5px] font-bold text-gold-dim">{prefix}</span>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) onSave(draft);
        }}
        className="h-8 flex-1 rounded-lg border border-gold-dim/40 bg-panel px-2.5 text-[11.5px] text-text outline-none focus:border-gold"
      />
      {dirty && (
        <Button
          onClick={() => onSave(draft)}
          className="h-8 shrink-0 cursor-pointer rounded-lg bg-gold px-2.5 text-[10px] font-bold text-black hover:bg-gold-bright"
        >
          {t("set.save")}
        </Button>
      )}
    </div>
  );
}

/** Titre de sous-groupe à l'intérieur d'un onglet. */
export function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gold-dim">{children}</h4>
  );
}
