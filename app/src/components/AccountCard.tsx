import { useEffect, useState, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
} from "framer-motion";
import { AlertTriangle, Ban, GripVertical, Lock, Pin, Play, Plus, RotateCw, StickyNote, Swords, X } from "lucide-react";
import type { Account, Wallet } from "@/lib/api";
import { api, avatarUrl, rankEmblemUrl } from "@/lib/api";
import { queueDetails, rankInfo, wlLetters } from "@/lib/rank";
import { useI18n, type TFunc } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { profileIconUrl, useDdragonVersion } from "@/lib/ddragon";
import { useWindowActive } from "@/lib/useWindowActive";
import { useLowPower } from "@/lib/useLowPower";
import { BorderBeam } from "./fx/BorderBeam";
import { NumberTicker } from "./fx/NumberTicker";
import { MagneticButton } from "./fx/MagneticButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import beIcon from "@/assets/icons/be.png";
import rpIcon from "@/assets/icons/rp.png";

interface Props {
  account: Account;
  selected: boolean;
  onSelect: (name: string) => void;
  onSwap: (name: string, queueId?: number) => void;
  onEditNote: (name: string) => void;
  onReconnect: (name: string, queueId?: number) => void;
  onTogglePin: (name: string, pinned: boolean) => void;
  onDragHandlePointerDown: (e: React.PointerEvent) => void;
  onOpenRankDetail: (name: string) => void;
  onStartQueue: (queueId: number) => Promise<void>;
  onDodge?: () => void;
  reconnecting?: boolean;
  penaltySeconds?: number | null;
  blurred?: boolean;
  gameflowPhase?: string;
  wallet?: Wallet | null;
}

function formatCurrency(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const OPGG_REGIONS: Record<string, string> = {
  EUW: "euw", EUNE: "eune", NA: "na", KR: "kr", BR: "br", LAN: "lan",
  LAS: "las", OCE: "oce", RU: "ru", TR: "tr", JP: "jp",
};

function opggUrl(acc: { region: string; riot_id?: string | null; name: string }, live = false): string {
  const reg = OPGG_REGIONS[acc.region] || "euw";
  const namePart = (acc.riot_id || acc.name).replace("#", "-");
  return `https://www.op.gg/summoners/${reg}/${encodeURIComponent(namePart)}${live ? "/ingame" : ""}`;
}

function AccountCardImpl({
  account: acc, selected, onSelect, onSwap, onEditNote, onReconnect, onTogglePin,
  onDragHandlePointerDown, onOpenRankDetail, onStartQueue, onDodge, reconnecting, penaltySeconds, blurred, gameflowPhase, wallet,
}: Props) {
  const { t, lang } = useI18n();
  const [selectedQueue, setSelectedQueue] = useState<number | null>(null);
  const [launching, setLaunching] = useState(false);

  // Le sélecteur de voie + bouton « Lancer (file) » sont dispo AUSSI sur un compte
  // déjà connecté, tant qu'il est au repos dans le client (ni en file, ni en
  // sélection, ni en partie) — l'automatisation (lobby + matchmaking) n'a pas
  // besoin de la loop de swap initiale.
  const idlePhase = gameflowPhase === undefined || ["", "None"].includes(gameflowPhase);
  const canLaunch = acc.active && !acc.expired && idlePhase;

  const handleLaunch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedQueue == null || launching) return;
    setLaunching(true);
    try {
      // Le backend répond 202 immédiatement (travail en tâche de fond) : aucune
      // attente ici. Le bouton s'éteint dès que la phase change (push WebSocket),
      // avec un garde-fou si le lancement échoue silencieusement côté client.
      await onStartQueue(selectedQueue);
      window.setTimeout(() => setLaunching(false), 6000);
    } catch {
      setLaunching(false);
    }
  };

  // Extinction du bouton « Lancer » pilotée par la réalité du client : dès que la
  // phase quitte le repos (lobby créé / file rejointe), on rend la main — zéro
  // délai artificiel, la transition est aussi instantanée que la détection push.
  useEffect(() => {
    if (launching && !idlePhase) {
      setLaunching(false);
      setSelectedQueue(null);
    }
  }, [launching, idlePhase]);
  const info = rankInfo(acc, lang);
  const display = acc.riot_id || acc.name;
  const ring = acc.active ? "#c8aa6e" : acc.expired ? "#e05c5c" : "#785a28";
  // `reduced` coupe les animations permanentes de la carte (border-beam, halo
  // pulsant, tilt, spotlight). Actif aussi quand la fenêtre n'est pas regardée
  // (partie en cours) et en mode Basse consommation.
  const windowActive = useWindowActive();
  const lowPower = useLowPower();
  const reduced = prefersReducedMotion() || !windowActive || lowPower;
  const penalty = acc.active && penaltySeconds ? penaltySeconds : null;
  const ddVersion = useDdragonVersion();

  const [avatarSrc, setAvatarSrc] = useState(
    acc.icon_id
      ? profileIconUrl(acc.icon_id, ddVersion)
      : avatarUrl(acc.icon_id, display[0] ?? "?", ring)
  );

  useEffect(() => {
    setAvatarSrc(
      acc.icon_id
        ? profileIconUrl(acc.icon_id, ddVersion)
        : avatarUrl(acc.icon_id, display[0] ?? "?", ring)
    );
  }, [acc.icon_id, display, ring, ddVersion]);

  let sub = acc.region + (acc.level ? `  ·  ${t("card.level")} ${acc.level}` : "");
  if (acc.riot_id && acc.riot_id !== acc.name) sub = `${acc.name}  ·  ${sub}`;
  if (acc.expired) sub = reconnecting ? t("card.reconnecting") : `⚠ ${t("card.expired")}`;

  // spotlight (position souris) + tilt 3D holographique
  const mx = useMotionValue(-999);
  const my = useMotionValue(-999);
  const rotateX = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const ref = useRef<HTMLDivElement>(null);

  // D1 — splash art (grosse texture GPU) chargé seulement quand la carte entre
  // dans le viewport (avec 150px de marge d'anticipation). Une fois affiché il
  // reste chargé (disconnect) : pas de flash au re-scroll. Aucune baisse de
  // résolution en mode normal — on ne fait que DIFFÉRER le fetch/décodage.
  const [splashInView, setSplashInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSplashInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "150px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const spotlight = useMotionTemplate`radial-gradient(280px circle at ${mx}px ${my}px, rgba(200,170,110,0.15), transparent 80%)`;
  
  // Glare holographique
  const angle = useMotionTemplate`${rotateX}deg`;
  const glare = useMotionTemplate`linear-gradient(${angle}, rgba(255,255,255,0.08) 0%, transparent 20%, transparent 80%, rgba(200,170,110,0.05) 100%)`;

  const onMove = (e: React.MouseEvent) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    mx.set(x);
    my.set(y);
    rotateY.set(((x / r.width) - 0.5) * 3.5);
    rotateX.set(-((y / r.height) - 0.5) * 3.5);
  };
  const onLeave = () => {
    mx.set(-999);
    my.set(-999);
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.div
      ref={ref}
      layout
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={() => onSelect(acc.name)}
      onDoubleClick={(e) => {
        if (!acc.active && !acc.expired) {
          e.stopPropagation();
          onSwap(acc.name, selectedQueue || undefined);
        }
      }}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      className={cn(
        "group relative grid grid-cols-[74px_minmax(0,1fr)_176px_178px] items-center overflow-hidden rounded-2xl border bg-card px-2 py-3 cursor-pointer transition-colors",
        acc.active
          ? "border-gold/60"
          : selected
            ? "border-hextech-blue"
            : "border-border hover:border-border-hover",
      )}
    >
      {/* arrière-plan splash art du champion le plus joué (retiré en Basse conso :
          grosses textures GPU) */}
      {acc.most_played_champ && !lowPower && splashInView && (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center opacity-8 pointer-events-none transition-opacity duration-500 group-hover:opacity-12"
          style={{
            backgroundImage: `url(https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${acc.most_played_champ}_0.jpg)`,
            maskImage: "linear-gradient(to right, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.1) 70%, rgba(0,0,0,0) 100%)",
            WebkitMaskImage: "linear-gradient(to right, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.1) 70%, rgba(0,0,0,0) 100%)",
          }}
        />
      )}

      {/* spotlight doré qui suit la souris + glare */}
      {!reduced && (
        <>
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 z-0"
            style={{ background: spotlight }}
          />
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 z-0 mix-blend-overlay"
            style={{ background: glare }}
          />
        </>
      )}

      {/* bordure animée pour le compte actif */}
      {acc.active && !reduced && <BorderBeam color="#c8aa6e" duration={4.5} />}

      {/* poignée de drag + épingle favori, discrètes (visibles au survol) */}
      <div className="absolute left-1.5 top-1.5 z-20 flex items-center gap-0.5">
        <button
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragHandlePointerDown(e);
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("card.reorder")}
          className="cursor-grab rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-gold group-hover:opacity-40 active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(acc.name, !acc.pinned);
          }}
          aria-label={acc.pinned ? t("card.unpin") : t("card.pin")}
          className={cn(
            "rounded p-0.5 transition-opacity hover:text-gold",
            acc.pinned ? "text-gold opacity-80" : "text-muted opacity-0 group-hover:opacity-40",
          )}
        >
          <Pin className={cn("h-3 w-3", acc.pinned && "fill-current")} />
        </button>
      </div>

      {/* ---- contenu ---- */}
      <div className="relative z-10 flex justify-center">
        <div className="relative h-12 w-12 flex items-center justify-center">
          <img
            src={avatarSrc}
            onError={() => setAvatarSrc(avatarUrl(acc.icon_id, display[0] ?? "?", ring))}
            alt=""
            decoding="async"
            loading="lazy"
            className="h-12 w-12 rounded-full border-2"
            style={{ borderColor: ring }}
          />
          {acc.level != null && (
            <img
              src={`/assets/riot/communitydragon/profile-borders/theme-${levelBorderTheme(acc.level)}-border.png`}
              alt=""
              decoding="async"
              loading="lazy"
              className="absolute -inset-2.5 h-[68px] w-[68px] max-w-none pointer-events-none select-none z-10"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          {acc.level != null && (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded border border-gold-dim bg-[#0a1428] px-1 text-[8px] font-bold text-gold select-none leading-none py-0.5 z-20">
              {acc.level}
            </span>
          )}
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 items-center gap-1.5 pl-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className={cn("truncate font-semibold text-text", blurred && "blur-[6px] select-none")}
            >
              {display}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.openUrl(opggUrl(acc));
              }}
              className="px-1 py-0.5 rounded border border-gold/40 bg-gold/5 text-[7px] font-extrabold text-gold hover:bg-gold hover:text-black transition-colors select-none shrink-0 cursor-pointer"
              title={t("card.opggProfile")}
            >
              OP.GG
            </button>
            {acc.active && gameflowPhase === "InProgress" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  api.openUrl(opggUrl(acc, true));
                }}
                className="px-1.5 py-0.5 rounded border border-gold bg-gold/15 text-[7px] font-extrabold text-gold hover:bg-gold hover:text-black transition-all select-none shrink-0 cursor-pointer animate-pulse shadow-[0_0_8px_rgba(200,170,110,0.5)]"
                title={t("card.opggLive")}
              >
                LIVE GAME
              </button>
            )}
          </div>
          <div
            className={cn(
              "truncate text-[11px]",
              acc.expired || penalty ? "text-red" : "text-muted",
              blurred && "blur-[6px] select-none",
            )}
          >
            {penalty ? (
              <>
                <Lock className="mr-1 inline h-3 w-3 -translate-y-px" />
                {t("card.queueRestricted")} · {formatMMSS(penalty)}
              </>
            ) : (
              <>
                {acc.expired && <AlertTriangle className="mr-1 inline h-3 w-3 -translate-y-px" />}
                {sub}
              </>
            )}
          </div>
          {(() => {
            const walletToShow = wallet || acc.wallet;
            if (!acc.active || !walletToShow) return null;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="mt-0.5 flex items-center gap-2.5 text-[9.5px] font-semibold text-muted select-none">
                    <span className="flex items-center gap-1 text-hextech-blue">
                      <img src={beIcon} alt="" className="h-3.5 w-3.5 object-contain" />
                      {formatCurrency(walletToShow.blue_essence)}
                    </span>
                    <span className="flex items-center gap-1 text-gold">
                      <img src={rpIcon} alt="" className="h-3.5 w-3.5 object-contain" />
                      {formatCurrency(walletToShow.rp)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {walletToShow.blue_essence.toLocaleString()} {t("card.blueEssence")} · {walletToShow.rp.toLocaleString()} RP
                </TooltipContent>
              </Tooltip>
            );
          })()}
        </div>
        <NoteBadge note={acc.note} blurred={blurred} onClick={() => onEditNote(acc.name)} />
      </div>

      <RankBlock
        account={acc}
        info={info}
        reduced={reduced}
        blurred={blurred}
        onOpenRankDetail={() => onOpenRankDetail(acc.name)}
      />

      <div className="relative z-10 flex items-center justify-end gap-2 pr-3">
        {(!acc.active || canLaunch) && (
          <div className="flex flex-col items-center gap-0.5 min-w-[50px]">
            <QueueSelector
              account={acc}
              selectedId={selectedQueue}
              onChange={setSelectedQueue}
            />
            <span className="text-[7px] font-extrabold text-gold uppercase tracking-wider select-none font-mono text-center leading-none mt-0.5">
              {queueLabel(QUEUES.find((q) => q.id === selectedQueue) ?? QUEUES[0], t, true)}
            </span>
          </div>
        )}
        {acc.active ? (
          gameflowPhase === "InProgress" ? (
            <span className="flex h-[34px] w-[92px] items-center justify-center rounded-full border border-red bg-[#2a0e10] text-[10px] font-bold text-red animate-pulse">
              {t("card.inGame")}
            </span>
          ) : launching ? (
            // Garde le bouton doré pendant la transition create_lobby -> matchmaking
            // pour éviter un flash "EN LOBBY" juste après le clic sur « Lancer ».
            <MagneticButton className="relative flex shrink-0">
              <button
                disabled
                className="play-btn relative flex h-[34px] items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full bg-gold px-3 text-[9.5px] font-bold text-[#0a0f14] opacity-80"
              >
                <RotateCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                …
              </button>
            </MagneticButton>
          ) : gameflowPhase === "ChampSelect" ? (
            <div className="flex flex-col items-center gap-1">
              <span className="flex h-[26px] w-[92px] items-center justify-center rounded-full border border-purple bg-[#1a0e2a] text-[10px] font-bold text-purple animate-pulse">
                {t("card.champSelect")}
              </span>
              {onDodge && <LeaveButton onClick={onDodge} label={t("card.leave")} />}
            </div>
          ) : gameflowPhase === "Matchmaking" ? (
            <div className="flex flex-col items-center gap-1">
              <span className="flex h-[26px] w-[92px] items-center justify-center rounded-full border border-hextech-blue bg-[#0a1e2a] text-[10px] font-bold text-hextech-blue animate-pulse">
                {t("card.inQueue")}
              </span>
              {onDodge && <LeaveButton onClick={onDodge} label={t("card.leave")} />}
            </div>
          ) : gameflowPhase === "Lobby" ? (
            <div className="flex flex-col items-center gap-1">
              <span className="flex h-[26px] w-[92px] items-center justify-center rounded-full border border-gold-dim bg-[#1a1608] text-[10px] font-bold text-gold">
                {t("card.inLobby")}
              </span>
              {onDodge && <LeaveButton onClick={onDodge} label={t("card.leave")} />}
            </div>
          ) : canLaunch && selectedQueue !== null ? (
            <MagneticButton className="relative flex shrink-0">
              <button
                onClick={handleLaunch}
                className="play-btn relative flex h-[34px] items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full bg-gold px-2.5 text-[9.5px] font-bold text-[#0a0f14] transition-all hover:shadow-[0_0_20px_rgba(200,170,110,0.6)] active:scale-95"
              >
                <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
                {t("card.launch", { queue: queueLabel(QUEUES.find((q) => q.id === selectedQueue) ?? QUEUES[0], t, true) })}
              </button>
            </MagneticButton>
          ) : (
            <span className="flex h-[34px] w-[92px] items-center justify-center rounded-full border border-green bg-[#0e2a1e] text-[11px] font-bold text-green">
              {t("card.connected")}
            </span>
          )
        ) : acc.expired ? (
          <button
            disabled={reconnecting}
            onClick={(e) => {
              e.stopPropagation();
              onReconnect(acc.name, selectedQueue || undefined);
            }}
            className="relative flex h-[34px] w-[104px] items-center justify-center gap-1 overflow-hidden rounded-full border border-red bg-[#2a1216] text-[10px] font-bold tracking-tight text-red transition-colors disabled:opacity-60"
          >
            <RotateCw className={cn("h-3 w-3 shrink-0", reconnecting && "animate-spin")} />
            {reconnecting ? "…" : t("card.reconnect")}
          </button>
        ) : (
          <MagneticButton className="relative flex shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwap(acc.name, selectedQueue || undefined);
              }}
              className="play-btn relative flex h-[34px] w-[92px] items-center justify-center gap-1 overflow-hidden rounded-full bg-gold text-[12px] font-bold text-[#0a0f14] transition-all hover:shadow-[0_0_20px_rgba(200,170,110,0.6)] active:scale-95"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {t("card.play")}
            </button>
          </MagneticButton>
        )}
      </div>
    </motion.div>
  );
}

/** Carte mémoïsée : les handlers reçus d'App sont stables (useCallback []), donc
 * un re-render d'App qui ne touche pas cette carte (busy, swap, recherche, phase
 * d'un autre compte…) ne la re-render plus. */
export const AccountCard = memo(AccountCardImpl);

/** Petit lien « Quitter » sous les badges de phase (lobby / file / sélection) :
 * déclenche la sortie via le backend (dodge quitV2 en champ select, sinon
 * suppression du lobby). */
function LeaveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="text-[8px] font-bold uppercase tracking-wider text-red/70 hover:text-red underline decoration-dotted underline-offset-2"
    >
      {label}
    </button>
  );
}

function NoteBadge({
  note,
  blurred,
  onClick,
}: {
  note: string | null;
  blurred?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };

  if (!note) {
    return (
      <button
        onClick={handleClick}
        aria-label={t("card.addNote")}
        className="shrink-0 rounded-full p-1 text-muted opacity-0 transition-opacity hover:text-gold group-hover:opacity-50"
      >
        <Plus className="h-3 w-3" />
      </button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          aria-label={t("card.editNote")}
          className="shrink-0 rounded-full p-1 text-gold-dim transition-colors hover:text-gold"
        >
          <StickyNote className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className={cn(blurred && "blur-[6px] select-none")}>
        {note}
      </TooltipContent>
    </Tooltip>
  );
}

function RankBlock({
  account: acc,
  info,
  reduced,
  blurred,
  onOpenRankDetail,
}: {
  account: Account;
  info: ReturnType<typeof rankInfo>;
  reduced: boolean;
  blurred?: boolean;
  onOpenRankDetail: () => void;
}) {
  const { lang } = useI18n();
  const wl = wlLetters(lang);
  const lpPct = info.lp != null ? Math.min(info.lp, 100) / 100 : 0;
  const details = queueDetails(acc, lang);

  const block = (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpenRankDetail();
      }}
      className="relative z-10 flex cursor-pointer items-center justify-end gap-2.5 pr-1"
    >
      <div className="relative h-[52px] w-[52px] shrink-0">
        {/* halo pulsant couleur du tier (keyframes CSS, mêmes durée/amplitude) */}
        {info.tier && !reduced && (
          <div
            className="tier-halo absolute inset-0 rounded-full blur-md"
            style={{ background: info.color }}
          />
        )}
        {/* arc de LP autour de l'emblème */}
        {info.lp != null && (
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="24" fill="none" stroke="#1e2d45" strokeWidth="2" />
            <motion.circle
              cx="26"
              cy="26"
              r="24"
              fill="none"
              stroke={info.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 24}
              initial={{ strokeDashoffset: 2 * Math.PI * 24 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 24 * (1 - lpPct) }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            />
          </svg>
        )}
        <motion.img
          src={rankEmblemUrl(info.tier)}
          alt=""
          decoding="async"
          loading="lazy"
          className="absolute inset-[6px] h-10 w-10"
          whileHover={{ scale: 1.16, rotate: [0, -5, 5, 0] }}
          transition={{ duration: 0.35 }}
        />
      </div>

      <div className="flex min-w-0 flex-col justify-center">
        <div className="truncate text-sm font-bold leading-tight" style={{ color: info.color }}>
          {info.main}
        </div>
        <div className="truncate text-[10px] text-muted">
          {info.lp != null ? (
            <>
              <NumberTicker value={info.lp} /> LP
              {info.winrate !== null && ` · ${info.wins}${wl.w} ${info.losses}${wl.l}`}
            </>
          ) : (
            info.detail || "—"
          )}
        </div>
        {info.winrate !== null && (
          <div className="mt-1 h-1 w-[104px] overflow-hidden rounded-full bg-wr-loss">
            <motion.div
              className="h-full rounded-full bg-green"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(info.winrate * 100)}%` }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (details.length === 0) return block;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{block}</TooltipTrigger>
      <TooltipContent side="top" className="w-56">
        <div
          className={cn(
            "mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gold",
            blurred && "blur-[6px] select-none",
          )}
        >
          {acc.riot_id || acc.name}
        </div>
        <div className="flex flex-col gap-2">
          {details.map((d) => (
            <div key={d.label}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-muted">{d.label}</span>
                <span className="text-[12px] font-bold" style={{ color: d.color }}>
                  {d.rankText}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted">
                <span>{d.lp} LP</span>
                <span>
                  {d.wins}{wl.w} {d.losses}{wl.l}
                  {d.winrate !== null && (
                    <span
                      className={cn(
                        "ml-1 font-semibold",
                        d.winrate >= 0.5 ? "text-green" : "text-red",
                      )}
                    >
                      {Math.round(d.winrate * 100)}%
                    </span>
                  )}
                </span>
              </div>
              {d.winrate !== null && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-wr-loss">
                  <div
                    className="h-full rounded-full bg-green"
                    style={{ width: `${Math.round(d.winrate * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const LOCAL_RIOT_ASSETS = "/assets/riot/communitydragon";
const CREST_BASE = `${LOCAL_RIOT_ASSETS}/ranked-mini-crests`;
// Arena est saisonnier : son dossier `cherry` disparaît parfois de `latest`.
// Cette version conserve l'asset officiel et l'URL versionnée est immuable.
const ARENA_ICON = `${LOCAL_RIOT_ASSETS}/game-modes/arena.png`;

function levelBorderTheme(level: number): number {
  const thresholds = [500, 475, 450, 425, 400, 375, 350, 325, 300, 275, 250, 225, 200, 175, 150, 125, 100, 75, 50, 30, 1];
  const descendingIndex = thresholds.findIndex((minimum) => level >= minimum);
  return descendingIndex < 0 ? 1 : 21 - descendingIndex;
}

/** Mini-crest officiel du tier (ranked-mini-crests), unranked si pas de rang. */
function tierCrestUrl(tier?: string | null): string {
  return `${CREST_BASE}/${(tier ?? "unranked").toLowerCase()}.svg`;
}

/** Libellé d'une file. Seule l'entrée « aucune file » est traduisible : les
 * autres sont les noms officiels des files Riot, identiques dans toutes les
 * langues du client (leurs `label` ne passent donc pas par le dictionnaire). */
function queueLabel(q: { id: number | null; label: string; shortLabel: string }, t: TFunc, short = false): string {
  const raw = short ? q.shortLabel : q.label;
  return q.id === null ? t(raw) : raw;
}

const QUEUES = [
  { id: null, label: "queue.none", shortLabel: "queue.noneShort", iconUrl: null, color: "text-muted", textColor: "#7c8aa0", glow: "rgba(124,138,160,0.6)" },
  { id: 420, label: "Ranked Solo/Duo", shortLabel: "Solo/Duo", iconUrl: "dynamic-solo", color: "text-gold", textColor: "#c8aa6e", glow: "rgba(200,170,110,0.8)" },
  { id: 440, label: "Ranked Flex", shortLabel: "Flex", iconUrl: "dynamic-flex", color: "text-hextech-blue", textColor: "#0ac8b9", glow: "rgba(10,200,185,0.8)" },
  { id: 400, label: "Normal Draft", shortLabel: "Normal", iconUrl: `${LOCAL_RIOT_ASSETS}/game-modes/normal.png`, color: "text-green", textColor: "#3ddc97", glow: "rgba(61,220,151,0.8)" },
  { id: 450, label: "ARAM", shortLabel: "ARAM", iconUrl: `${LOCAL_RIOT_ASSETS}/game-modes/aram.png`, color: "text-tier-master", textColor: "#c084fc", glow: "rgba(192,132,252,0.8)" },
  { id: 2400, label: "ARAM Mayhem", shortLabel: "Mayhem", iconUrl: `${LOCAL_RIOT_ASSETS}/game-modes/mayhem.png`, color: "text-tier-grandmaster animate-pulse", textColor: "#f87171", glow: "rgba(248,113,113,0.8)" },
  { id: 1700, label: "Arena", shortLabel: "Arena", iconUrl: ARENA_ICON, color: "text-red", textColor: "#e05c5c", glow: "rgba(224,92,92,0.8)" },
];

/** Icône d'une file : crest de tier dynamique (Solo/Flex), emblème officiel, ou glyphe "aucune". */
function QueueIcon({ queue, account }: { queue: (typeof QUEUES)[number]; account: Account }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (queue.id === null) {
    return <Ban className="h-[60%] w-[60%] text-muted pointer-events-none" strokeWidth={1.7} />;
  }
  let url = queue.iconUrl as string;
  if (url === "dynamic-solo") url = tierCrestUrl(account.rank?.solo?.tier);
  else if (url === "dynamic-flex") url = tierCrestUrl(account.rank?.flex?.tier);
  if (failedUrl === url) {
    return <Swords className={cn("h-[62%] w-[62%] pointer-events-none", queue.color)} strokeWidth={1.7} />;
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      className="h-full w-full object-contain pointer-events-none"
      onError={() => setFailedUrl(url)}
    />
  );
}

function QueueSelector({
  account,
  selectedId,
  onChange,
}: {
  account: Account;
  selectedId: number | null;
  onChange: (id: number | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    const onResize = () => updatePos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize, true);
    };
  }, [open, updatePos]);

  const current = QUEUES.find((q) => q.id === selectedId) || QUEUES[0];

  const triggerX = pos.left + pos.width / 2;
  const triggerY = pos.top + pos.height / 2;
  const radius = 88; // Rayon de projection circulaire

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ top: r.top, left: r.left, width: r.width, height: r.height });
          }
          setOpen((o) => !o);
        }}
        className={cn(
          "flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full border transition-all duration-300 hover:border-gold hover:shadow-[0_0_12px_rgba(200,170,110,0.5)] p-0.5",
          open
            ? "border-gold bg-gold-dim/20 shadow-[0_0_8px_rgba(200,170,110,0.4)]"
            : selectedId !== null
              ? "border-gold bg-gold-dim/15 shadow-[0_0_8px_rgba(200,170,110,0.3)]"
              : "border-hextech-blue/60 bg-[#0a1a2a]/80 shadow-[0_0_8px_rgba(10,200,185,0.25)]"
        )}
        title={t("card.autoQueue", { queue: queueLabel(current, t) })}
      >
        <QueueIcon queue={current} account={account} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-[9999] overflow-hidden">
              {/* Backdrop sombre flouté */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0 } }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute inset-0 bg-[#010a13]/70 backdrop-blur-[2px]"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
              />

              {/* Bouton de fermeture central premium */}
              <motion.button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
                style={{
                  position: "fixed",
                  left: triggerX - 18,
                  top: triggerY - 18,
                  zIndex: 10001,
                }}
                initial={{ scale: 0.55, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.55, opacity: 0, transition: { duration: 0 } }}
                whileHover={{ scale: 1.08 }}
                transition={{ duration: 0.18, ease: [0.34, 1.56, 0.64, 1] }}
                className="flex h-[36px] w-[36px] items-center justify-center rounded-full border border-gold bg-[#0c1626] text-gold shadow-[0_0_15px_rgba(200,170,110,0.5)] transition-all hover:bg-gold hover:text-[#0c1626] hover:shadow-[0_0_20px_rgba(200,170,110,0.8)] will-change-transform"
              >
                <X className="h-4 w-4" />
              </motion.button>

              {/* Burst des 7 options en 360° */}
              {QUEUES.map((q, i) => {
                const active = q.id === selectedId;

                const angle = -90 + i * (360 / 7);
                const rad = (angle * Math.PI) / 180;
                const x = radius * Math.cos(rad);
                const y = radius * Math.sin(rad);

                return (
                  <motion.button
                    key={q.id ?? "none"}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(q.id);
                      setOpen(false);
                    }}
                    style={{
                      position: "fixed",
                      left: triggerX - 18,
                      top: triggerY - 18,
                      zIndex: 10000,
                    }}
                    initial={{ scale: 0.3, opacity: 0, x: 0, y: 0 }}
                    animate={{ scale: 1, opacity: 1, x, y }}
                    exit={{ scale: 0.3, opacity: 0, x: 0, y: 0, transition: { duration: 0 } }}
                    whileHover={{
                      scale: 1.12,
                      boxShadow: `0 0 20px ${q.glow}`,
                      transition: { duration: 0.12, ease: "easeOut" }
                    }}
                    transition={{
                      // "Hextech Bloom" : éclosion rapide depuis le centre, rebond doux (GPU only)
                      duration: 0.2,
                      ease: [0.22, 1.3, 0.36, 1],
                      delay: i * 0.01,
                      opacity: { duration: 0.1, ease: "easeOut", delay: i * 0.01 },
                    }}
                    className={cn(
                      "flex h-[36px] w-[36px] items-center justify-center rounded-full border bg-[#050b14]/90 backdrop-blur-md transition-all duration-300 relative will-change-transform will-change-opacity p-0.5",
                      active
                        ? "border-gold bg-[#0e1626] shadow-[0_0_15px_rgba(200,170,110,0.7)] scale-105"
                        : cn(
                            "border-border hover:border-gold",
                            q.id === null ? "hover:shadow-[0_0_10px_rgba(124,138,160,0.3)]" : "",
                            q.id === 420 ? "hover:shadow-[0_0_12px_rgba(200,170,110,0.5)]" : "",
                            q.id === 440 ? "hover:shadow-[0_0_12px_rgba(10,200,185,0.5)]" : "",
                            q.id === 400 ? "hover:shadow-[0_0_12px_rgba(61,220,151,0.5)]" : "",
                            q.id === 450 ? "hover:shadow-[0_0_12px_rgba(192,132,252,0.5)]" : "",
                            q.id === 2400 ? "hover:shadow-[0_0_12px_rgba(248,113,113,0.5)]" : "",
                            q.id === 1700 ? "hover:shadow-[0_0_12px_rgba(224,92,92,0.5)]" : ""
                          )
                    )}
                  >
                    <QueueIcon queue={q} account={account} />

                    {/* Glowing label text underneath the button */}
                    <span 
                      className="absolute top-[38px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[8.5px] font-extrabold tracking-wider uppercase font-mono select-none pointer-events-none"
                      style={{ 
                        color: "#c8aa6e",
                        textShadow: "0 0 6px rgba(200,170,110,0.8)",
                      }}
                    >
                      {queueLabel(q, t, true)}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
