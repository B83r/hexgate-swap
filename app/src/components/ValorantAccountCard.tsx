import { Pin, Play, RotateCw, Sparkles } from "lucide-react";
import type { Account } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface Props {
  account: Account;
  selected: boolean;
  onSelect: (name: string) => void;
  onPlay: (account: Account) => void;
  /** Lancement direct, sans swap — réservé au compte déjà connecté. */
  onLaunch: (account: Account) => void;
  onTogglePin: (name: string, pinned: boolean) => void;
}

/** Carte VALORANT V1 : profil Riot partage, sans inventer de statistiques non lues. */
export function ValorantAccountCard({ account, selected, onSelect, onPlay, onLaunch, onTogglePin }: Props) {
  const { t } = useI18n();
  // La progression du tutoriel appartient au jeu Riot, pas à Hexgate : un
  // profil non expiré est toujours immédiatement jouable dans l'interface.
  const state = account.valorant.status === "expired" ? "expired" : "ready";
  const connected = account.active && state !== "expired";
  const label = state === "expired"
    ? t("val.repair")
    : state === "ready"
      ? t("val.play")
      : t("val.initialize");
  const status = connected
    ? t("card.connected")
    : state === "expired"
    ? t("val.expired")
    : state === "ready"
      ? t("val.ready")
      : t("val.new");
  const Icon = state === "expired" ? RotateCw : state === "ready" ? Play : Sparkles;
  const stats = account.valorant.stats;

  return (
    <article
      onClick={() => onSelect(account.name)}
      className={cn(
        "group flex min-h-[102px] items-center gap-4 rounded-2xl border bg-[#110c12]/90 px-5 py-3 transition-all duration-200",
        selected ? "border-[#ff4655] shadow-[0_0_22px_-9px_rgba(255,70,85,.8)]" : "border-[#48242b] hover:border-[#a93a45]",
      )}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#ff4655]/70 bg-[#220d14] shadow-[inset_0_0_16px_rgba(255,70,85,.18)]">
        <img src="/assets/riot/valorant/valorant.png" alt="VALORANT" className="h-8 w-8 rounded-md" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[17px] font-extrabold text-[#f5e9e9]">{account.riot_id || account.name}</h2>
          <span className="rounded border border-[#d6a34f]/50 px-1 py-0.5 text-[7px] font-black tracking-wider text-[#e7bf72]">VAL</span>
        </div>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#e6b8bd]">VALORANT · {status}{stats?.rank ? ` · ${stats.rank.label}${stats.rank.rr !== null ? ` ${stats.rank.rr} RR` : ""}` : ""}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(account.name, !account.pinned); }}
        title={account.pinned ? t("card.unpin") : t("card.pin")}
        className={cn("rounded-full border p-2 transition", account.pinned ? "border-[#d6a34f] text-[#d6a34f]" : "border-[#4e3035] text-[#8c6e73] hover:text-[#d6a34f]")}
      >
        <Pin className="h-3.5 w-3.5" fill={account.pinned ? "currentColor" : "none"} />
      </button>
      <div className="flex min-w-[166px] flex-col gap-1.5">
        {connected ? (
          // Compte déjà connecté : on montre le statut, mais on garde un
          // bouton de lancement. Avant le 13/09/2026 cette branche ne rendait
          // qu'un `<span>` inerte — le compte actif devenait injouable depuis
          // Hexgate, alors que la carte League, elle, laisse toujours lancer.
          // Le lancement passe par `onLaunch` et NON par `onPlay` : refaire un
          // swap tuerait le client Riot pour restaurer la session déjà en place.
          <>
            <span className="flex min-w-[166px] items-center justify-center gap-2 rounded-full border border-green bg-[#0e2a1e] px-4 py-1.5 text-[10px] font-black tracking-wide text-green">
              {t("card.connected")}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onLaunch(account); }}
              className="flex min-w-[166px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#ff4655] to-[#c92f42] px-4 py-2.5 text-[11px] font-black tracking-wide text-white transition hover:brightness-110 active:scale-95"
            >
              <Play className="h-3.5 w-3.5" /> {t("val.play")}
            </button>
          </>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(account); }}
            className={cn(
              "flex min-w-[166px] items-center justify-center gap-2 rounded-full px-4 py-3 text-[11px] font-black tracking-wide transition active:scale-95",
              state === "expired" ? "border border-[#ff4655]/70 bg-[#2a1118] text-[#ff8290] hover:bg-[#3a141d]" : "bg-gradient-to-r from-[#ff4655] to-[#c92f42] text-white hover:brightness-110",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        )}
      </div>
    </article>
  );
}
