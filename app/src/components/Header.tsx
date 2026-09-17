import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Logo } from "./Logo";
import { WindowControls } from "./TitleBar";
import { api, subscribeEvents, type PingServer, type PingUpdate, type Product, type ProductStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWindowActive } from "@/lib/useWindowActive";
import { useLowPower } from "@/lib/useLowPower";
import { useI18n } from "@/lib/i18n";

/** Bandeau décoratif : dégradé bleu nuit + diagonales dorées + hexagones (SVG, léger). */
function Banner() {
  const hexagons = useMemo(
    () => [[0.72, 64], [0.8, 40], [0.88, 84], [0.62, 30], [0.95, 52]] as const,
    [],
  );
  return (
    <svg
      viewBox="0 0 1200 104"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="bannerGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1f3a" />
          <stop offset="100%" stopColor="#010a13" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="edgeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-gold)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--color-gold)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--color-gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="1200" height="104" fill="url(#bannerGrad)" />
      {Array.from({ length: 26 }).map((_, i) => (
        <line key={i} x1={i * 46 - 96} y1={104} x2={i * 46} y2={0} stroke="var(--color-gold)" strokeOpacity="0.07" />
      ))}
      {hexagons.map(([xr, r], i) => (
        <polygon key={i} points={hexPoints(xr * 1200, 52, r)} fill="none" stroke="var(--color-gold)" strokeOpacity="0.12" strokeWidth="2" />
      ))}
      <rect y="102" width="1200" height="2" fill="url(#edgeGrad)" />
    </svg>
  );
}

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
}

export function Header({ penaltySeconds, product, productStatus, onProductChange }: {
  penaltySeconds?: number | null;
  product: Product;
  productStatus: ProductStatus;
  onProductChange: (product: Product) => void;
}) {
  const [ping, setPing] = useState<PingUpdate | null>(null);
  const [servers, setServers] = useState<PingServer[]>([]);
  const [region, setRegion] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Fermeture différée : sans ça, traverser le petit espace entre le libellé et
  // le menu referme celui-ci avant qu'on ait pu cliquer une ligne.
  const closeTimer = useRef<number | null>(null);
  // Le menu est rendu dans un portail : il doit donc se positionner lui-même à
  // partir de la position écran de son déclencheur.
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const { t } = useI18n();
  const windowActive = useWindowActive();
  const lowPower = useLowPower();
  // Pénalité de dodge : sondée + décomptée dans App (source unique), reçue en prop.
  const penalty = penaltySeconds && penaltySeconds > 0 ? penaltySeconds : null;

  useEffect(() => {
    const unsub = subscribeEvents((e) => {
      if (e.type === "ping_update") {
        setPing(e.data);
        setRegion(e.data.region);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    api.getPingServers()
      .then((r) => {
        setServers(r.servers);
        setRegion((cur) => cur ?? r.selected);
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  // Mesuré à l'ouverture, puis re-mesuré au redimensionnement : la fenêtre est
  // librement redimensionnable et l'en-tête est centré, l'ancre bouge donc.
  useLayoutEffect(() => {
    if (!pickerOpen) return;
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setAnchor(r);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [pickerOpen]);

  const openPicker = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setPickerOpen(true);
  };
  const schedulePickerClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPickerOpen(false), 220);
  };

  const selectRegion = (id: string) => {
    setRegion(id);
    // Optimiste : la valeur affichée devient « … » jusqu'à la mesure poussée en SSE.
    setPing(null);
    setPickerOpen(false);
    api.setPingRegion(id).catch(() => {});
  };

  const currentLabel = servers.find((s) => s.id === region)?.label ?? ping?.label ?? "";
  const latency = ping?.latency ?? null;
  const pingColor = (ms: number) =>
    ms === -1 ? "bg-red" : ms < 50 ? "bg-green" : ms < 110 ? "bg-gold" : "bg-red";

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div data-tauri-drag-region className="relative h-[104px] shrink-0 overflow-hidden">
      <Banner />
      <WindowControls />
      <div data-tauri-drag-region className="pointer-events-none relative flex h-full items-center justify-center gap-3.5 px-6">
        <Logo size={58} anim={windowActive && !lowPower ? "spin" : "none"} />
        <div className="flex flex-col items-start gap-1.5">
          <h1 className="text-[19px] font-bold tracking-[0.06em] text-gold flex items-center gap-2">
            HEXGATE&nbsp;&nbsp;SWAP
          {penalty !== null && (
            <div className="pointer-events-auto flex items-center border border-red/40 bg-red/10 px-2 py-0.5 rounded-full text-red text-[8px] font-extrabold uppercase tracking-wider ml-1 animate-pulse fx-decor" title={t("header.dodgePenalty")}>
              Dodge : {formatTime(penalty)}
            </div>
          )}
          {(servers.length > 0 || ping) && (
            <div className="relative flex flex-col items-center gap-0.5 ml-2 mt-0.5">
              {/* La bulle de latence n'est plus qu'un afficheur : plus aucun
                  survol ne déclenche d'ouverture ici. */}
              <div
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-[#020912]/80 px-2 py-0.5"
                title={
                  ping?.estimated
                    ? t("header.pingEstimated", { city: ping.city })
                    : t("header.pingTitle")
                }
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full animate-pulse fx-decor",
                  latency === null ? "bg-muted" : pingColor(latency),
                )} />
                <span className="text-[7.5px] font-bold text-muted uppercase tracking-wider select-none">
                  {latency === null ? "…" : latency === -1 ? "Ping --" : `${ping?.estimated ? "≈" : ""}${latency} ms`}
                </span>
              </div>

              {/* Le libellé du serveur est le déclencheur du sélecteur. */}
              <button
                ref={anchorRef}
                onMouseEnter={openPicker}
                onMouseLeave={schedulePickerClose}
                onClick={(e) => {
                  e.stopPropagation();
                  // Ouvrir, jamais basculer : le survol a déjà ouvert le menu
                  // avant que le clic parte, si bien qu'une bascule le refermait
                  // dans le même geste. La fermeture reste le départ du curseur.
                  openPicker();
                }}
                title={t("header.pingServerPicker")}
                className="pointer-events-auto text-[6.5px] font-extrabold uppercase tracking-wider select-none leading-none mt-0.5 transition hover:brightness-125"
                style={{
                  color: "#c8aa6e",
                  textShadow: "0 0 4px rgba(200, 170, 110, 0.6)",
                }}
              >
                {t("header.pingServer", { server: currentLabel })} ▾
              </button>

              {/* Rendu dans un portail : l'en-tête est `overflow-hidden` sur
                  104 px de haut pour découper sa bannière, ce qui tronquait le
                  menu quelle que soit sa hauteur maximale. Il est donc sorti du
                  flux et positionné en coordonnées écran. */}
              {pickerOpen && servers.length > 0 && anchor &&
                createPortal(
                  <div
                    onMouseEnter={openPicker}
                    onMouseLeave={schedulePickerClose}
                    style={{
                      top: anchor.bottom + 6,
                      // Bridé aux bords : la fenêtre descend jusqu'à 440 px de
                      // large, où un menu centré sur l'ancre déborderait.
                      left: Math.min(
                        Math.max(anchor.left + anchor.width / 2, 92),
                        window.innerWidth - 92,
                      ),
                    }}
                    className="fixed z-[100] max-h-[min(60vh,320px)] w-[176px] -translate-x-1/2 overflow-y-auto rounded-lg border border-border/80 bg-[#060c16]/95 p-1 shadow-2xl backdrop-blur-md"
                  >
                    <div className="border-b border-border/20 px-1.5 pb-1 pt-0.5 text-[8px] font-extrabold uppercase tracking-wider text-gold-dim">
                      {t("header.pingServerPicker")}
                    </div>
                    {servers.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => selectRegion(s.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left transition-colors",
                          s.id === region ? "bg-gold/15 text-gold" : "text-muted hover:bg-card-hover hover:text-text",
                        )}
                      >
                        <span className="text-[9px] font-extrabold uppercase tracking-wider">{s.label}</span>
                        <span className="truncate text-[8px] opacity-70">{s.city}</span>
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
            </div>
          )}
          </h1>
          <div className="pointer-events-auto flex h-[34px] rounded-lg border border-border/70 bg-[#050b14]/90 p-0.5 shadow-lg">
            {(["league_of_legends", "valorant"] as const).map((id) => {
              const active = product === id;
              const running = productStatus[id] !== "none";
              return <button key={id} onClick={() => onProductChange(id)} className={cn(
                "relative flex items-center gap-1.5 rounded-md px-3 text-[9px] font-black tracking-wider transition-all",
                active ? id === "valorant" ? "bg-[#7f2330] text-white" : "bg-gold text-[#0a0f14]" : "text-muted hover:text-text",
              )}>
                {id === "valorant" ? (
                  <img src="/assets/riot/valorant/valorant.png" alt="VALORANT" className="h-[18px] w-[18px] rounded-[3px]" />
                ) : (
                  <img src="/assets/riot/league/league.png" alt="League of Legends" className="h-[18px] w-[18px] rounded-[3px]" />
                )}
                {id === "valorant" ? "VALORANT" : "LoL"}
                {running && <span className="h-1.5 w-1.5 rounded-full bg-green shadow-[0_0_7px_#26d07c]" />}
              </button>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
