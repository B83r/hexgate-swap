import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { Toaster, toast } from "sonner";
import { Plus, Save, Trash2, AlertTriangle, Search, BarChart2, List, Swords, MessageSquare, Wrench } from "lucide-react";
import { api, subscribeEvents, type Account, type ServerEvent, type Recap, type Wallet, type Product, type ProductStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Header } from "@/components/Header";
import { AccountCard } from "@/components/AccountCard";
import { ValorantAccountCard } from "@/components/ValorantAccountCard";
import { SwapOverlay } from "@/components/SwapOverlay";
import { AutoAcceptPill } from "@/components/AutoAcceptPill";
import { NameDialog } from "@/components/NameDialog";
import { NoteDialog } from "@/components/NoteDialog";
import { RankDetailDialog } from "@/components/RankDetailDialog";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Background } from "@/components/fx/Background";
import { Splash } from "@/components/fx/Splash";
import { Confetti } from "@/components/fx/Confetti";
import { Logo } from "@/components/Logo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, Info, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardView } from "@/components/DashboardView";
import { MatchesView } from "@/components/MatchesView";
import { ValorantDashboardView } from "@/components/ValorantDashboardView";
import { ValorantMatchesView } from "@/components/ValorantMatchesView";
import { ToolsView } from "@/components/ToolsView";
import { ChatPanel } from "@/components/ChatPanel";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { useWindowActive } from "@/lib/useWindowActive";

const SWAP_STEP_FROM_STATUS: Array<[string, number]> = [
  ["Fermeture", 0],
  ["Restauration", 1],
  ["Relance", 2],
  ["Attente", 2],
  ["Session acceptée", 3],
  ["Connecté sur", 4],
];

interface SwapState {
  account: string;
  product: Product;
  step: number;
  footer: string;
  tone: "muted" | "green" | "red";
}

interface SortableAccountCardProps {
  account: Account;
  index: number;
  splash: boolean;
  selected: boolean;
  onSelect: (name: string) => void;
  onSwap: (name: string, queueId?: number) => void;
  onEditNote: (name: string) => void;
  onReconnect: (name: string, queueId?: number) => void;
  onTogglePin: (name: string, pinned: boolean) => void;
  onOpenRankDetail: (name: string) => void;
  onStartQueue: (queueId: number) => Promise<void>;
  reconnecting: boolean;
  penaltySeconds: number | null;
  blurred: boolean;
  gameflowPhase?: string;
  wallet?: Wallet | null;
  onDodge?: () => void;
}

/** Enveloppe une AccountCard dans un Reorder.Item (drag via poignée dédiée uniquement,
 * pour ne jamais interférer avec le clic/double-clic/hover de la carte elle-même). */
const SortableAccountCard = memo(function SortableAccountCard({ account, index: _index, splash, ...cardProps }: SortableAccountCardProps) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      value={account}
      dragListener={false}
      dragControls={dragControls}
      initial={splash ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {/* wrapper interne (et pas le Reorder.Item que framer mesure pour le drag) :
          content-visibility saute peinture+style des cartes hors viewport */}
      <div className="cv-card">
        <AccountCard account={account} onDragHandlePointerDown={(e) => dragControls.start(e)} {...cardProps} />
      </div>
    </Reorder.Item>
  );
});

export default function App() {
  const { t } = useI18n();
  // Réf toujours à jour pour les callbacks SSE (souscrits une fois) afin qu'ils
  // utilisent la langue courante sans re-souscrire à chaque changement de langue.
  const tRef = useRef(t);
  tRef.current = t;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [product, setProduct] = useState<Product>("league_of_legends");
  const [productStatus, setProductStatus] = useState<ProductStatus>({ league_of_legends: "none", valorant: "none" });
  const [rememberProduct, setRememberProduct] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [autoAccept, setAutoAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitial, setDialogInitial] = useState("");
  const [swap, setSwap] = useState<SwapState | null>(null);
  const [splash, setSplash] = useState(true);
  const [confetti, setConfetti] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streamerMode, setStreamerMode] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [penaltySeconds, setPenaltySeconds] = useState<number | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [rankDetailFor, setRankDetailFor] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "dashboard" | "matches" | "tools">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [recapTotal, setRecapTotal] = useState<Recap | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [gameflow, setGameflow] = useState<{ phase: string; since: number }>({ phase: "None", since: 0 });
  const [estimatedQueueTime, setEstimatedQueueTime] = useState<number | null>(null);
  const [valorantRefreshing, setValorantRefreshing] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const windowActive = useWindowActive();

  // Refs « toujours à jour » pour que les handlers passés aux cartes soient
  // STABLES (useCallback []). Sans ça, chaque re-render d'App recrée les closures
  // et casse le React.memo des cartes (voir SortableAccountCard mémoïsé).
  const busyRef = useRef(false);
  const accountsRef = useRef<Account[]>([]);
  const reconnectingRef = useRef<string | null>(null);
  const gameflowRef = useRef(gameflow);
  gameflowRef.current = gameflow;
  busyRef.current = busy;
  accountsRef.current = accounts;
  reconnectingRef.current = reconnecting;

  // Gel des animations décoratives CSS pures quand personne ne regarde la fenêtre
  // (le gating framer-motion est déjà géré par useWindowActive dans chaque
  // composant ; cette classe couvre les @keyframes CSS : sheen, border-beam,
  // runic, animate-pulse marqués fx-decor — voir index.css).
  useEffect(() => {
    document.documentElement.classList.toggle("fx-frozen", !windowActive);
  }, [windowActive]);

  useEffect(() => {
    if (gameflow.phase !== "Matchmaking") {
      setEstimatedQueueTime(null);
      return;
    }
    const poll = () => {
      api.getMatchmakingSearch()
        .then(data => {
          if (data && data.estimatedQueueTime) {
            setEstimatedQueueTime(Math.round(data.estimatedQueueTime));
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [gameflow.phase]);

  // État gameflow initial : le flux SSE ne pousse « gameflow » que sur CHANGEMENT.
  // Si l'app (ou la connexion SSE) démarre alors qu'on est déjà en lobby / file /
  // partie, on récupère la phase courante immédiatement pour ne pas rester bloqué
  // sur un état périmé (« None ») jusqu'au prochain changement.
  useEffect(() => {
    api.getGameflow().then((g) => setGameflow(g)).catch(() => {});
  }, []);

  // Pénalité de file (dodge) : sondée toutes les 15s SEULEMENT quand la fenêtre
  // est regardée (poll immédiat au regain de focus). Fenêtre en arrière-plan =
  // zéro requête ; le décompte local (effet suivant) continue, lui, tant qu'une
  // pénalité est en cours pour rester juste au retour.
  useEffect(() => {
    if (!windowActive) return;
    const poll = () =>
      api
        .getQueuePenalty()
        .then(({ penalty }) => setPenaltySeconds(penalty ? Math.round(penalty.seconds_remaining) : null))
        .catch(() => {});
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [windowActive]);

  // Décompte local : l'interval n'existe QUE si une pénalité court réellement
  // (avant : un setState par seconde en permanence, pour rien).
  useEffect(() => {
    if (penaltySeconds === null || penaltySeconds <= 0) return;
    const id = setInterval(() => {
      setPenaltySeconds((s) => (s !== null && s > 0 ? s - 1 : s));
    }, 1000);
    return () => clearInterval(id);
  }, [penaltySeconds !== null && penaltySeconds > 0]);

  // Solde EB/RP du compte connecté : sondé toutes les 30s, seulement fenêtre
  // regardée (poll immédiat au regain de focus). LCU local, pas de coût externe.
  useEffect(() => {
    if (!windowActive) return;
    const poll = () =>
      api
        .getWallet()
        .then(({ wallet }) => setWallet(wallet))
        .catch(() => setWallet(null));
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [windowActive]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Démo client-only de l'overlay de swap (dev) : ?demo=swap ou ?demo=swap-fail
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo !== "swap" && demo !== "swap-fail") return;
    const name = accounts[0]?.name ?? "Compte démo";
    setSplash(false);
    const timers: number[] = [];
    setSwap({ account: name, product, step: 0, footer: "", tone: "muted" });
    [1, 2, 3].forEach((s, i) =>
      timers.push(window.setTimeout(() => setSwap((p) => (p ? { ...p, step: s } : p)), 900 * (i + 1))),
    );
    timers.push(
      window.setTimeout(() => {
        if (demo === "swap-fail") {
          setSwap((p) => (p ? { ...p, footer: tRef.current("app.demoFail"), tone: "red" } : p));
        } else {
          setSwap((p) => (p ? { ...p, step: 4, footer: tRef.current("app.swapSuccess"), tone: "green" } : p));
        }
      }, 3800),
    );
    return () => timers.forEach(clearTimeout);
  }, [accounts]);

  const refresh = useCallback(() => {
    return api.listAccounts(product).then(({ accounts, recap_total, product_status }) => {
      setAccounts(accounts);
      setRecapTotal(recap_total || null);
      setProductStatus(product_status);
    });
  }, [product]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    // Au tout premier lancement, la fenêtre s'affiche avant que le sidecar
    // Python (extraction PyInstaller + imports + sauvegarde de démarrage)
    // n'écoute sur son port : le premier appel peut donc échouer par pure
    // course de démarrage. On retente vite plutôt que de laisser la liste
    // vide en attendant un event SSE qui n'arrivera peut-être jamais.
    const tryLoad = () => {
      attempts += 1;
      refresh()
        .then(() => {
          if (!cancelled) setSplash(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (attempts >= 40) {
            setSplash(false); // ~6 s : ne pas rester bloqué si le backend ne démarre pas
            return;
          }
          setTimeout(tryLoad, 150);
        });
    };
    tryLoad();
    api.getSettingsAll().then((values) => {
      const enabled = values.remember_last_product;
      setRememberProduct(enabled);
      const saved = localStorage.getItem("hexgate_last_product");
      if (enabled && (saved === "league_of_legends" || saved === "valorant")) setProduct(saved);
    }).catch(() => {});
    api.getAutoAccept().then(({ enabled }) => setAutoAccept(enabled));
    api.getStreamerMode().then(({ enabled }) => setStreamerMode(enabled));

    const unsubscribe = subscribeEvents((e: ServerEvent) => {
      const showNotif = (title: string, body: string) => {
        if (localStorage.getItem("native_notifications_enabled") !== "false") {
          sendNotification({ title, body });
        }
      };

      if (e.type === "toast") {
        toast(e.text);
      } else if (e.type === "swap_status") {
        const hit = SWAP_STEP_FROM_STATUS.find(([prefix]) => e.data.startsWith(prefix));
        setSwap((prev) =>
          prev
            ? {
                ...prev,
                step: hit ? hit[1] : prev.step,
                footer: e.data.startsWith("Session de") ? e.data : prev.footer,
              }
            : prev,
        );
      } else if (e.type === "swap_done") {
        setSwap((prev) =>
          prev ? { ...prev, step: 4, footer: tRef.current("app.swapSuccess"), tone: "green" } : prev,
        );
        showNotif("Hexgate Swap", tRef.current("app.notifSwapOk", { name: e.data }));
        setTimeout(() => setSwap(null), 1300);
        setBusy(false);
        refresh();
      } else if (e.type === "swap_error") {
        setSwap((prev) => (prev ? { ...prev, footer: tRef.current("app.swapFail", { msg: e.data.split("\n")[0] }), tone: "red" } : prev));
        showNotif(tRef.current("app.notifSwapErr"), e.data.split("\n")[0]);
        setTimeout(() => setSwap(null), 2600);
        setBusy(false);
        refresh();
        toast.error(e.data.split("\n")[0]);
      } else if (e.type === "accounts_changed") {
        refresh();
      } else if (e.type === "valorant_sync_done") {
        setValorantRefreshing(null);
        toast.success(tRef.current("val.sync.done", { name: e.data.name }));
        refresh();
      } else if (e.type === "valorant_sync_error") {
        setValorantRefreshing(null);
        toast.error(e.data.error);
      } else if (e.type === "reconnect_done") {
        setReconnecting((prev) => (prev === e.data ? null : prev));
        showNotif("Hexgate Swap", tRef.current("app.notifReconnectOk", { name: e.data }));
        refresh();
      } else if (e.type === "reconnect_error") {
        setReconnecting(null);
        showNotif(tRef.current("app.notifReconnectErr"), e.data.split("\n")[0]);
        refresh();
        toast.error(e.data.split("\n")[0]);
      } else if (e.type === "gameflow") {
        setGameflow({ phase: e.data.phase, since: e.data.since });
        if (e.data.phase === "ReadyCheck") {
          showNotif(tRef.current("app.notifMatchFound"), tRef.current("app.notifMatchFoundBody"));
        } else if (e.data.phase === "ChampSelect") {
          showNotif(tRef.current("app.notifChampSelect"), tRef.current("app.notifChampSelectBody"));
        } else if (e.data.phase === "InProgress") {
          showNotif(tRef.current("app.notifInGame"), tRef.current("app.notifInGameBody"));
        }
      } else if (e.type === "auto_accept") {
        const name = e.data.name;
        const acc = accounts.find((a) => a.name === name);
        if (acc && acc.most_played_champ) {
          playChooseQuote(acc.most_played_champ);
        }
      } else if (e.type === "obs_status") {
        if (e.data.running) {
          setStreamerMode(true);
          api.setStreamerMode(true);
          toast.info(tRef.current("app.streamerAuto"));
        }
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  const refreshValorant = useCallback(async (name: string) => {
    setValorantRefreshing(name);
    try {
      await api.refreshValorant(name);
      toast.info(tRef.current("val.sync.started"));
    } catch (error) {
      setValorantRefreshing(null);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (rememberProduct) localStorage.setItem("hexgate_last_product", product);
  }, [product, rememberProduct]);

  useEffect(() => {
    const id = window.setInterval(() => api.getProductStatus().then(setProductStatus).catch(() => {}), 4000);
    return () => window.clearInterval(id);
  }, []);

  // Handlers passés aux cartes : STABLES (useCallback []) via refs pour ne pas
  // casser le React.memo des cartes. Chaque handler reçoit le `name` du compte.
  const startSwap = useCallback(async (name: string, queueId?: number, targetProduct: Product = product) => {
    if (busyRef.current) return;
    const target = accountsRef.current.find((a) => a.name === name);
    if (target?.active && targetProduct === "league_of_legends") return;
    setBusy(true);
    setSwap({ account: name, product: targetProduct, step: 0, footer: "", tone: "muted" });
    try {
      await api.startSwap(name, targetProduct, queueId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setSwap(null);
      setBusy(false);
    }
  }, [product]);

  const startReconnect = useCallback(async (name: string, queueId?: number) => {
    if (reconnectingRef.current) return;
    setReconnecting(name);
    try {
      await api.reconnect(name, queueId);
      toast.info(tRef.current("app.toastReconnecting", { name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setReconnecting(null);
    }
  }, []);

  // Lance la file directement sur le compte déjà connecté (bouton « Lancer (file) »
  // de la carte active) : pas de swap, on pilote juste le lobby + matchmaking LCU.
  const startQueue = useCallback(async (queueId: number) => {
    try {
      await api.startQueue(queueId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const doLeave = useCallback(async () => {
    try {
      await api.dodgeLobby();
      toast.info(t("app.lobbyLeft"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // « Quitter » : en pleine sélection des champions (partie déjà acceptée), le seul
  // dodge fiable est de FERMER le client League → avertissement + confirmation. En
  // simple lobby / file d'attente, quitter est inoffensif → on part directement.
  const dodgeLobby = useCallback(() => {
    if (gameflowRef.current.phase !== "ChampSelect") {
      doLeave();
      return;
    }
    setConfirm({
      title: tRef.current("app.dodgeTitle"),
      description: <p>{tRef.current("app.dodgeDesc")}</p>,
      confirmLabel: tRef.current("app.dodgeConfirm"),
      danger: true,
      onConfirm: doLeave,
    });
  }, [doLeave]);

  const openCapture = async () => {
    if (busy) return;
    const { name } = await api.suggestName();
    setDialogInitial(name ?? "");
    setDialogOpen(true);
  };

  const confirmCapture = async (name: string) => {
    setDialogOpen(false);
    const exists = accounts.some((a) => a.name === name);
    const doCapture = async () => {
      try {
        const { account } = await api.capture(name);
        toast.success(t("app.toastSaved", { name: account.name }));
        setConfetti((c) => c + 1);
        refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    };
    if (exists) {
      setConfirm({
        title: t("app.replaceTitle"),
        description: <p>{t("app.replaceDesc", { name })}</p>,
        confirmLabel: t("app.replaceConfirm"),
        onConfirm: doCapture,
      });
      return;
    }
    doCapture();
  };

  const addAccount = () => {
    if (busy) return;
    setConfirm({
      title: t("app.addTitle"),
      description: (
        <>
          <p>{t("app.addDesc1")}</p>
          <p>{t("app.addDesc2")}</p>
          <p className="flex items-start gap-1.5 text-red">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("app.addDesc3")}
          </p>
        </>
      ),
      confirmLabel: t("app.addConfirm"),
      onConfirm: async () => {
        setBusy(true);
        try {
          await api.addAccount(product);
          toast.info(t("app.toastConnectSave"));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const deleteSelected = () => {
    if (busy || !selected) {
      toast.info(t("app.deleteHint"));
      return;
    }
    const removeAll = async () => {
      await api.deleteAccount(selected, "all");
      toast.success(t("app.toastDeleted", { name: selected }));
      setSelected(null);
      refresh();
    };
    if (product === "valorant") {
      const resetValorant = async () => {
        await api.deleteAccount(selected, "valorant");
        toast.success(t("val.resetDone", { name: selected }));
        setSelected(null);
        refresh();
      };
      setConfirm({
        title: t("val.deleteTitle"),
        description: <p>{t("val.deleteDesc", { name: selected })}</p>,
        secondaryLabel: t("val.deleteValOnly"), onSecondary: resetValorant,
        confirmLabel: t("val.deleteAll"), danger: true, onConfirm: removeAll,
      });
      return;
    }
    setConfirm({
      title: t("app.deleteTitle"),
      description: <p>{t("app.deleteDesc", { name: selected })}</p>,
      confirmLabel: t("app.deleteConfirm"),
      danger: true,
      onConfirm: removeAll,
    });
  };

  const toggleAutoAccept = async () => {
    const next = !autoAccept;
    setAutoAccept(next);
    await api.setAutoAccept(next);
    toast(next ? t("app.autoOn") : t("app.autoOff"));
  };

  const toggleStreamerMode = async () => {
    const next = !streamerMode;
    setStreamerMode(next);
    await api.setStreamerMode(next);
  };

  const saveNote = async (note: string) => {
    if (!noteFor) return;
    const name = noteFor;
    setNoteFor(null);
    await api.setNote(name, note);
    refresh();
  };

  const togglePin = useCallback(async (name: string, pinned: boolean) => {
    setAccounts((prev) => {
      const next = prev.map((a) => (a.name === name ? { ...a, pinned } : a));
      next.sort((a, b) => Number(b.pinned) - Number(a.pinned));
      return next;
    });
    await api.setPinned(name, pinned, product);
    refresh();
  }, [refresh, product]);

  const switchProduct = useCallback((next: Product) => {
    if (next === product) return;
    setProduct(next);
    setSelected(null);
    setView("list");
  }, [product]);

  /** Démarre VALORANT pour le compte DÉJÀ connecté : aucun swap, donc aucun
   * client Riot tué. On ne confirme que si une partie est en cours, seul cas
   * où le lancement peut déranger quelque chose. */
  const launchValorant = useCallback((account: Account) => {
    const strong = productStatus.valorant === "in_game" || productStatus.league_of_legends === "in_game";
    const go = async () => {
      try {
        await api.launchProduct("valorant");
        toast.success(tRef.current("val.launching", { name: account.riot_id || account.name }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    };
    if (!strong) {
      void go();
      return;
    }
    setConfirm({
      title: tRef.current("val.strongTitle"),
      description: <p>{tRef.current("val.strongDesc", { name: account.riot_id || account.name })}</p>,
      confirmLabel: tRef.current("val.play"),
      danger: true,
      onConfirm: go,
    });
  }, [productStatus]);

  const startValorant = useCallback((account: Account) => {
    const strong = productStatus.valorant === "in_game" || productStatus.league_of_legends === "in_game";
    const proceed = async () => {
      if (account.valorant.status === "expired") {
        setReconnecting(account.name);
        try {
          await api.reconnect(account.name);
          toast.info(tRef.current("app.toastReconnecting", { name: account.name }));
        } catch (e) {
          setReconnecting(null);
          toast.error(e instanceof Error ? e.message : String(e));
        }
      } else {
        startSwap(account.name, undefined, "valorant");
      }
    };
    setConfirm({
      title: tRef.current(strong ? "val.strongTitle" : "val.launchTitle"),
      description: <p>{tRef.current(strong ? "val.strongDesc" : "val.launchDesc", { name: account.riot_id || account.name })}</p>,
      confirmLabel: tRef.current(account.valorant.status === "expired" ? "val.repair" : account.valorant.status === "new" ? "val.initialize" : "val.play"),
      danger: strong,
      onConfirm: proceed,
    });
  }, [productStatus, startSwap]);

  // Sélecteurs stables (name-based) pour ne pas recréer de closures par carte.
  const handleSelect = useCallback((name: string) => setSelected(name), []);
  const handleEditNote = useCallback((name: string) => setNoteFor(name), []);
  const handleOpenRank = useCallback((name: string) => setRankDetailFor(name), []);

  const handleReorder = (next: Account[]) => {
    setAccounts(next);
    api.reorder(next.map((a) => a.name));
  };



  const filteredAccounts = accounts.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.riot_id && a.riot_id.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  return (
    <TooltipProvider delayDuration={200}>
    <div className="relative flex h-screen flex-col">
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id="icon-gold-grad" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="22">
            <stop offset="0" stopColor="#f0e6d2" />
            <stop offset="0.45" stopColor="#c8aa6e" />
            <stop offset="1" stopColor="#785a28" />
          </linearGradient>
        </defs>
      </svg>
      <Background />
      <Splash show={splash} />
      <Confetti fire={confetti} />
      <Header penaltySeconds={penaltySeconds} product={product} productStatus={productStatus} onProductChange={switchProduct} />

      {/* Premium Segmented Tab Switcher.
          Ordre de sacrifice en fenêtre étroite : d'abord l'estimation de file
          d'attente, puis les libellés des pastilles de droite, et seulement en
          tout dernier ceux des onglets. La priorité était inversée jusqu'au
          26/07 : à 768 px la navigation se réduisait à quatre icônes nues —
          illisibles — pendant que « Auto-accept · OFF » gardait tout son texte.
          Le groupe de droite reste `shrink-0` pour que le bouton réglages ne
          sorte jamais du cadre. */}
      <div className="flex items-center justify-between gap-2 px-4 pt-2.5 pb-2 border-b border-border/10 bg-[#020912]/20">
        <div className="flex min-w-0 shrink overflow-x-auto bg-[#050b14]/90 p-0.5 border border-border/40 rounded-xl text-[10px] font-bold uppercase tracking-wider font-nav [scrollbar-width:none]">
          {(product === "valorant" ? [
            { id: "list", labelKey: "nav.accounts", Icon: List },
            { id: "dashboard", labelKey: "nav.dashboard", Icon: BarChart2 },
            { id: "matches", labelKey: "nav.matches", Icon: Swords },
          ] : [
            { id: "list", labelKey: "nav.accounts", Icon: List },
            { id: "dashboard", labelKey: "nav.dashboard", Icon: BarChart2 },
            { id: "matches", labelKey: "nav.matches", Icon: Swords },
            // A remplacé l'onglet « Overlay » le 12/09/2026 : les réglages
            // d'overlay ne sont consultés qu'une fois puis oubliés, ils sont
            // passés dans Réglages → Overlay. League uniquement : tout cet
            // onglet passe par l'API locale du client LoL, absente de VALORANT.
            { id: "tools", labelKey: "nav.tools", Icon: Wrench },
          ] as const).map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id as "list" | "dashboard" | "matches" | "tools")}
              title={t(labelKey)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg transition-all duration-300",
                view === id ? "bg-gold text-black shadow-md font-extrabold" : "text-muted hover:text-text hover:bg-card-hover/20"
              )}
            >
              <Icon className="h-3.5 w-3.5" style={view === id ? undefined : { stroke: "url(#icon-gold-grad)" }} />
              <span className="hidden sm:inline">{t(labelKey)}</span>
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Premier élément sacrifié : à 1024 px les pastilles reprennent
              déjà leur libellé complet, ajouter l'estimation par-dessus
              repoussait les onglets en défilement. */}
          {estimatedQueueTime !== null && (
            <span className="hidden xl:inline text-[10px] font-bold text-gold bg-gold/10 border border-gold/30 px-2.5 py-1 rounded-xl uppercase tracking-wider animate-pulse select-none">
              {t("nav.queueEta", { time: `${Math.floor(estimatedQueueTime / 60)}m${estimatedQueueTime % 60}s` })}
            </span>
          )}
          {product === "league_of_legends" && <AutoAcceptPill enabled={autoAccept} onToggle={toggleAutoAccept} />}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={cn(
              "h-[28px] w-[28px] shrink-0 flex items-center justify-center rounded-full border transition-all duration-300",
              chatOpen
                ? "bg-gold text-black border-gold shadow-md"
                : "border-border/60 bg-card-hover/20 text-muted hover:text-text hover:border-border"
            )}
            title={t("app.chatTitle")}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <SettingsButton onClick={() => setSettingsOpen(true)} />
        </div>
      </div>

      {/* Main content body switcher */}
      <div className="flex-1 overflow-y-auto px-4 py-1.5">
        {view === "list" ? (
          <div className="flex flex-col gap-2.5 h-full">
            {/* Quick Search Bar */}
            {accounts.length > 0 && (
              <div className="relative flex items-center bg-[#050b14]/60 border border-border/80 rounded-xl px-3 py-1.5 focus-within:border-gold transition-colors duration-300">
                <Search className="h-4 w-4 text-muted mr-2" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={t("search.placeholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-xs text-text placeholder-muted font-nav"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-[10px] text-muted hover:text-text font-bold px-1.5">
                    Clear
                  </button>
                )}
              </div>
            )}

            {filteredAccounts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 pt-14 text-center">
                <Logo size={96} anim="spin" className="opacity-80" />
                <p className="text-[15px] font-bold text-text">
                  {accounts.length === 0 ? t("app.emptyTitle") : t("search.empty")}
                </p>
                <p className="text-[12px] text-muted">
                  {accounts.length === 0 ? (
                    <>
                      {t("app.emptyLine1")}
                      <br />
                      {t("app.emptyLine2")}
                    </>
                  ) : (
                    t("search.emptyHint")
                  )}
                </p>
              </div>
            ) : product === "valorant" ? (
              <div className="flex flex-col gap-[10px] transition-opacity duration-200">
                {filteredAccounts.map((acc) => <ValorantAccountCard key={acc.name} account={acc} selected={selected === acc.name} onSelect={handleSelect} onPlay={startValorant} onLaunch={launchValorant} onTogglePin={togglePin} />)}
              </div>
            ) : (
              <Reorder.Group
                as="div"
                axis="y"
                values={filteredAccounts}
                onReorder={(next) => handleReorder(next)}
                className="flex flex-col gap-[10px]"
              >
                <AnimatePresence initial={false}>
                  {filteredAccounts.map((acc, i) => (
                    <SortableAccountCard
                      key={acc.name}
                      account={acc}
                      index={i}
                      splash={splash}
                      selected={selected === acc.name}
                      onSelect={handleSelect}
                      onSwap={startSwap}
                      onEditNote={handleEditNote}
                      onReconnect={startReconnect}
                      onTogglePin={togglePin}
                      onOpenRankDetail={handleOpenRank}
                      onStartQueue={startQueue}
                      reconnecting={reconnecting === acc.name}
                      penaltySeconds={acc.active ? penaltySeconds : null}
                      blurred={streamerMode}
                      gameflowPhase={acc.active ? gameflow.phase : "None"}
                      wallet={acc.active ? wallet : null}
                      onDodge={acc.active ? dodgeLobby : undefined}
                    />
                  ))}
                </AnimatePresence>
              </Reorder.Group>
            )}
          </div>
        ) : view === "dashboard" ? (
          product === "valorant"
            ? <ValorantDashboardView accounts={accounts} refreshing={valorantRefreshing} onRefresh={refreshValorant} />
            : <DashboardView accounts={accounts} recapTotal={recapTotal} onRefresh={refresh} />
        ) : view === "matches" ? (
          product === "valorant"
            ? <ValorantMatchesView accounts={accounts} refreshing={valorantRefreshing} onRefresh={refreshValorant} />
            : <MatchesView accounts={accounts} activeAccount={accounts.find((a) => a.active) || null} />
        ) : (
          <ToolsView accounts={accounts} />
        )}
      </div>

      {/* Footer buttons row */}
      {view === "list" && (
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex gap-2.5">
            <button
              onClick={addAccount}
              className="group flex h-[38px] items-center gap-2 rounded-full bg-gradient-to-b from-gold to-[#a5842f] py-0 pl-2 pr-4 text-[12px] font-bold text-[#0a0f14] shadow-[0_4px_14px_-3px_rgba(200,170,110,0.5)] transition-all hover:from-gold-bright hover:to-gold hover:shadow-[0_6px_20px_-3px_rgba(240,230,210,0.55)] active:scale-95"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/15 transition-transform duration-300 group-hover:rotate-90">
                <Plus className="h-4 w-4" />
              </span>
              {t("app.addAccount")}
            </button>
            <button
              onClick={openCapture}
              className="group flex h-[38px] items-center gap-2 rounded-full border border-hextech-blue/40 bg-hextech-blue/[0.06] px-4 text-[12px] font-semibold text-hextech-blue shadow-[inset_0_0_12px_-7px_rgba(10,200,185,0.6)] transition-all hover:border-hextech-blue/80 hover:bg-hextech-blue/15 hover:shadow-[0_0_16px_-4px_rgba(10,200,185,0.5)] active:scale-95"
            >
              <Save className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5" />
              {t("app.saveSession")}
            </button>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={deleteSelected}
                className={cn(
                  "flex h-[38px] items-center gap-1.5 rounded-full px-4 text-[12px] transition-colors",
                  selected
                    ? "text-[#a06a72] hover:bg-[#3a2028]"
                    : "cursor-default text-[#5a4148]",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("app.delete")}
              </button>
            </TooltipTrigger>
            {!selected && (
              <TooltipContent side="top">{t("app.deleteTooltip")}</TooltipContent>
            )}
          </Tooltip>
        </div>
      )}

      <SwapOverlay
        open={swap !== null}
        account={swap?.account ?? null}
        iconId={accounts.find((a) => a.name === swap?.account)?.icon_id ?? null}
        currentStep={swap?.step ?? -1}
        footer={swap?.footer ?? ""}
        footerTone={swap?.tone ?? "muted"}
        product={swap?.product}
      />

      <NameDialog
        open={dialogOpen}
        initial={dialogInitial}
        onCancel={() => setDialogOpen(false)}
        onConfirm={confirmCapture}
      />

      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />

      <NoteDialog
        open={noteFor !== null}
        accountName={noteFor}
        initial={accounts.find((a) => a.name === noteFor)?.note ?? ""}
        onCancel={() => setNoteFor(null)}
        onConfirm={saveNote}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        accounts={accounts}
        streamerMode={streamerMode}
        onToggleStreamer={toggleStreamerMode}
      />

      <RankDetailDialog
        account={accounts.find((a) => a.name === rankDetailFor) ?? null}
        onClose={() => setRankDetailFor(null)}
      />

      <Toaster
        position="bottom-right"
        icons={{
          success: <CheckCircle2 className="h-4 w-4 text-green" />,
          error: <XCircle className="h-4 w-4 text-red" />,
          info: <Info className="h-4 w-4 text-hextech-blue" />,
          loading: <Zap className="h-4 w-4 text-gold" />,
        }}
        toastOptions={{
          style: {
            background: "#0a1428",
            border: "1px solid #785a28",
            color: "#f0e6d2",
            boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
          },
        }}
      />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
    </TooltipProvider>
  );
}

const CHAMP_KEYS: Record<string, number> = {
  Aatrox: 266, Ahri: 103, Akali: 84, Akshan: 166, Alistar: 12, Ambessa: 799, Amumu: 32, Anivia: 34, Annie: 1, Aphelios: 523, Ashe: 22, AurelionSol: 136, Aurora: 893, Azir: 268, Bard: 432, Belveth: 200, Blitzcrank: 53, Brand: 63, Braum: 201, Briar: 233, Caitlyn: 51, Camille: 164, Cassiopeia: 69, Chogath: 31, Corki: 42, Darius: 122, Diana: 131, DrMundo: 36, Draven: 119, Ekko: 245, Elise: 60, Evelynn: 28, Ezreal: 81, Fiddlesticks: 9, Fiora: 114, Fizz: 105, Galio: 3, Gangplank: 41, Garen: 86, Gnar: 150, Gragas: 79, Graves: 104, Gwen: 887, Hecarim: 120, Heimerdinger: 74, Hwei: 910, Illaoi: 420, Irelia: 39, Ivern: 427, Janna: 40, JarvanIV: 59, Jax: 24, Jayce: 126, Jhin: 202, Jinx: 222, Kaisa: 145, Kalista: 429, Karma: 43, Karthus: 30, Kassadin: 38, Katarina: 55, Kayle: 10, Kayn: 141, Kennen: 85, Khazix: 121, Kindred: 203, Kled: 240, KogMaw: 96, KSante: 897, Leblanc: 7, LeeSin: 64, Leona: 89, Lillia: 876, Lissandra: 127, Locke: 805, Lucian: 236, Lulu: 117, Lux: 99, Malphite: 54, Malzahar: 90, Maokai: 57, MasterYi: 11, Mel: 800, Milio: 902, MissFortune: 21, MonkeyKing: 62, Wukong: 62, Mordekaiser: 82, Morgana: 25, Naafiri: 950, Nami: 267, Nasus: 75, Nautilus: 111, Neeko: 518, Nidalee: 76, Nilah: 895, Nocturne: 56, Nunu: 20, Olaf: 2, Orianna: 61, Ornn: 516, Pantheon: 80, Poppy: 78, Pyke: 555, Qiyana: 246, Quinn: 133, Rakan: 497, Rammus: 33, RekSai: 421, Rell: 526, Renata: 888, Renekton: 58, Rengar: 107, Riven: 92, Rumble: 68, Ryze: 13, Samira: 360, Sejuani: 113, Senna: 235, Seraphine: 147, Sett: 875, Shaco: 35, Shen: 98, Shyvana: 102, Singed: 27, Sion: 14, Sivir: 15, Skarner: 72, Smolder: 901, Sona: 37, Soraka: 16, Swain: 50, Sylas: 517, Syndra: 134, TahmKench: 223, Taliyah: 163, Talon: 91, Taric: 44, Teemo: 17, Thresh: 412, Tristana: 18, Trundle: 48, Tryndamere: 23, TwistedFate: 4, Twitch: 29, Udyr: 77, Urgot: 6, Varus: 110, Vayne: 67, Veigar: 45, Velkoz: 161, Vex: 711, Vi: 254, Viego: 234, Viktor: 112, Vladimir: 8, Volibear: 106, Warwick: 19, Xayah: 498, Xerath: 101, XinZhao: 5, Yasuo: 157, Yone: 777, Yorick: 83, Yunara: 804, Yuumi: 350, Zaahen: 904, Zac: 154, Zed: 238, Zeri: 221, Ziggs: 115, Zilean: 26, Zoe: 142, Zyra: 143
};

const playChooseQuote = (champName: string) => {
  const key = CHAMP_KEYS[champName];
  if (!key) return;
  const url = `/assets/riot/communitydragon/champion-choose-vo/${key}.ogg`;
  const audio = new Audio(url);
  audio.volume = 0.55;
  audio.play().catch(() => {});
};
