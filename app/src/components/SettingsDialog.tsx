import { useState } from "react";
import { Eye, Gamepad2, Info, Save, Settings2, Swords } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { type Account } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GeneralTab } from "./settings/GeneralTab";
import { ClientTab } from "./settings/ClientTab";
import { GameTab } from "./settings/GameTab";
import { DataTab } from "./settings/DataTab";
import { OverlayView } from "./OverlayView";
import { AboutTab } from "./settings/AboutTab";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  streamerMode: boolean;
  onToggleStreamer: () => void;
}

// Échange du 12/09/2026 : les actions ponctuelles sur le client (« Outils »)
// ont quitté ce dialogue pour un onglet principal — ce ne sont pas des
// réglages, les ranger ici les rendait introuvables. L'overlay a fait le
// chemin inverse : il occupait un onglet principal alors qu'on le configure
// une fois puis qu'on l'oublie. Voir `components/ToolsView.tsx`.
type TabId = "general" | "client" | "game" | "overlay" | "data" | "about";

const TABS: { id: TabId; labelKey: string; Icon: typeof Settings2 }[] = [
  { id: "general", labelKey: "set.tab.general", Icon: Settings2 },
  { id: "client", labelKey: "set.tab.client", Icon: Gamepad2 },
  { id: "game", labelKey: "set.tab.game", Icon: Swords },
  // Réutilise `nav.overlay` : le libellé existe déjà dans les 6 langues depuis
  // l'époque où l'overlay était un onglet principal.
  { id: "overlay", labelKey: "nav.overlay", Icon: Eye },
  { id: "data", labelKey: "set.tab.data", Icon: Save },
  { id: "about", labelKey: "set.tab.about", Icon: Info },
];

/** Réglages en onglets latéraux.
 *
 * L'ancienne version empilait 24 contrôles dans sept sections d'une colonne
 * unique, avec des rangements faux (le lancement du Riot Client était sous
 * « Apparence ») et des actions ponctuelles mélangées aux préférences. Chaque
 * onglet ne gère plus que son propre état : c'est pour ça qu'ils lisent les
 * réglages backend eux-mêmes (`useBackendSettings`) plutôt que de recevoir une
 * quinzaine de props d'ici. */
export function SettingsDialog({ open, onOpenChange, accounts, streamerMode, onToggleStreamer }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>("general");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-panel p-0 text-text sm:max-w-[720px]">
        <div className="flex max-h-[76vh] min-h-[440px]">
          {/* Colonne des onglets */}
          <nav className="flex w-[170px] shrink-0 flex-col gap-1 border-r border-border/60 bg-[#070d17] p-2.5">
            <DialogHeader className="px-1.5 pb-2 pt-1 text-left">
              <DialogTitle className="text-[15px] text-gold">{t("settings.title")}</DialogTitle>
              <DialogDescription className="sr-only">{t("settings.subtitle")}</DialogDescription>
            </DialogHeader>
            {TABS.map(({ id, labelKey, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold transition-colors",
                  tab === id
                    ? "bg-gold/10 text-gold"
                    : "text-muted hover:bg-card-hover hover:text-text",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(labelKey)}</span>
              </button>
            ))}
          </nav>

          {/* Panneau de l'onglet actif */}
          <div className="flex-1 overflow-y-auto p-4">
            {tab === "general" && (
              <GeneralTab open={open} streamerMode={streamerMode} onToggleStreamer={onToggleStreamer} />
            )}
            {tab === "client" && <ClientTab open={open} />}
            {tab === "game" && <GameTab open={open} />}
            {tab === "data" && <DataTab open={open} accounts={accounts} />}
            {tab === "overlay" && <OverlayView />}
            {tab === "about" && <AboutTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
