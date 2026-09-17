import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Bell, Check, ChevronDown, EyeOff, Globe, HardDrive, Leaf } from "lucide-react";
import { api } from "@/lib/api";
import { LANGS, useI18n, type Lang } from "@/lib/i18n";
import { useLowPower } from "@/lib/useLowPower";
import { cn } from "@/lib/utils";
import { Row, Toggle } from "./primitives";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Sélecteur de langue : bouton drapeau + liste déroulante animée. */
function LanguageSelect() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (code: Lang) => {
    setLang(code);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 min-w-[142px] items-center gap-2 rounded-lg border bg-panel px-2.5 text-[12.5px] font-semibold text-text transition-colors",
          open ? "border-gold" : "border-gold-dim hover:border-gold",
        )}
      >
        <span className="text-[15px] leading-none">{current.flag}</span>
        <span className="flex-1 text-left">{current.label}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-gold-dim/70 bg-panel p-1 shadow-xl shadow-black/50"
          >
            {LANGS.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  onClick={() => pick(l.code)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
                    l.code === lang ? "bg-card-hover text-gold" : "text-text hover:bg-card-hover",
                  )}
                >
                  <span className="text-[15px] leading-none">{l.flag}</span>
                  <span className="flex-1">{l.label}</span>
                  {l.code === lang && <Check className="h-3.5 w-3.5 text-gold" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

interface Props {
  open: boolean;
  streamerMode: boolean;
  onToggleStreamer: () => void;
}

/** Onglet « Général » : ce qui relève de l'application elle-même (langue,
 * apparence, intégration Windows) — rien qui touche au client League. */
export function GeneralTab({ open, streamerMode, onToggleStreamer }: Props) {
  const { t } = useI18n();
  const lowPower = useLowPower();
  const [autostartActive, setAutostartActive] = useState(false);
  const [notifGranted, setNotifGranted] = useState(
    () => localStorage.getItem("native_notifications_enabled") !== "false",
  );

  useEffect(() => {
    if (!open) return;
    isAutostartEnabled().then(setAutostartActive).catch(console.error);
    isPermissionGranted()
      .then((granted) => {
        const localVal = localStorage.getItem("native_notifications_enabled") !== "false";
        setNotifGranted(granted && localVal);
      })
      .catch(console.error);
  }, [open]);

  const toggleAutostart = async () => {
    try {
      if (autostartActive) {
        await disableAutostart();
        setAutostartActive(false);
        toast.info(t("set.autostartOff"));
      } else {
        await enableAutostart();
        setAutostartActive(true);
        toast.info(t("set.autostartOn"));
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const toggleNotif = async () => {
    try {
      if (notifGranted) {
        localStorage.setItem("native_notifications_enabled", "false");
        setNotifGranted(false);
        toast.info(t("set.notifOff"));
        return;
      }
      let permission = await isPermissionGranted();
      if (!permission) permission = (await requestPermission()) === "granted";
      localStorage.setItem("native_notifications_enabled", permission ? "true" : "false");
      setNotifGranted(permission);
      if (permission) {
        toast.success(t("set.notifOn"));
        sendNotification({ title: "Hexgate Swap", body: t("set.notifOn") });
      } else {
        toast.error(t("set.notifDenied"));
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <Row
        title={t("settings.language")}
        desc={t("settings.languageDesc")}
        icon={<Globe className="h-4 w-4 shrink-0 text-muted" />}
        control={<LanguageSelect />}
      />
      <Row
        title={t("settings.streamer")}
        desc={t("settings.streamerDesc")}
        icon={<EyeOff className="h-4 w-4 shrink-0 text-muted" />}
        control={<Toggle checked={streamerMode} onToggle={onToggleStreamer} />}
      />
      <Row
        title={t("settings.lowPower")}
        desc={t("settings.lowPowerDesc")}
        icon={<Leaf className="h-4 w-4 shrink-0 text-muted" />}
        control={<Toggle checked={lowPower} onToggle={() => api.setLowPower(!lowPower).catch(() => {})} />}
      />
      <Row
        title={t("settings.nativeNotif")}
        desc={t("settings.nativeNotifDesc")}
        icon={<Bell className="h-4 w-4 shrink-0 text-muted" />}
        control={<Toggle checked={notifGranted} onToggle={toggleNotif} />}
      />
      <Row
        title={t("settings.autostart")}
        desc={t("settings.autostartDesc")}
        icon={<HardDrive className="h-4 w-4 shrink-0 text-muted" />}
        control={<Toggle checked={autostartActive} onToggle={toggleAutostart} />}
      />
    </div>
  );
}
