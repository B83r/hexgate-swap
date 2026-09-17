import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { api, subscribeEvents, type ServerEvent, type LiveGameEnemies, type LiveGameEnemy, type LiveGameOpponentInsight } from "./lib/api";
import "./index.css";
import "./overlay.css";
import { useDdragonVersion } from "./lib/ddragon";
import { useGameOnlyWindow } from "./lib/useGameOnlyWindow";
import { rankLabel, wlLetters } from "./lib/rank";
import { I18nProvider, useI18n } from "./lib/i18n";
import {
  champIdFrom,
  champSquareUrl,
  effectiveCd,
  estimateRanks,
  fetchChampionKeyMap,
  fetchChampionSpells,
  fetchItemHasteMap,
  fetchSummonerSpellMap,
  formatCd,
  itemsHaste,
  summKeyFrom,
  summonerHaste,
  type SpellInfo,
  type SummonerSpellInfo,
} from "./lib/cooldowns";

function OverlayCdApp() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<LiveGameEnemies | null>(null);
  const [locked, setLocked] = useState(true);
  const [enabled, setEnabled] = useState(false);
  // Champion épinglé manuellement (raw id) ; null = suivi auto du vis-à-vis de lane.
  const [pinned, setPinned] = useState<string | null>(null);
  const version = useDdragonVersion();

  const [keyMap, setKeyMap] = useState<Map<string, string> | null>(null);
  const [summMap, setSummMap] = useState<Map<string, SummonerSpellInfo> | null>(null);
  const [hasteMap, setHasteMap] = useState<Map<number, number> | null>(null);
  const [spells, setSpells] = useState<SpellInfo[] | null>(null);
  // Suivi manuel des sorts d'invocateur : clé "raw|index" → fin du décompte (epoch ms).
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [insight, setInsight] = useState<LiveGameOpponentInsight | null>(null);

  useEffect(() => {
    setLocked(localStorage.getItem("hexgate_overlay_cd_locked") === "true");
    setEnabled(localStorage.getItem("hexgate_overlay_cd_enabled") === "true");
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "hexgate_overlay_cd_locked") setLocked(e.newValue !== "false");
      if (e.key === "hexgate_overlay_cd_enabled") setEnabled(e.newValue === "true");
    };
    window.addEventListener("storage", handleStorageChange);

    const unsub = subscribeEvents((e: ServerEvent) => {
      if (e.type === "live_game_enemies") {
        setData(e.data);
        if (!e.data.active) {
          setPinned(null); // fin de partie → retour au suivi auto
          setTimers({});
          setInsight(null);
        }
      }
      if (e.type === "live_game_opponent_insight") {
        setInsight(e.data.active ? e.data : null);
      }
    });
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      unsub();
    };
  }, []);

  // Tic du décompte : 500 ms tant qu'au moins un timer tourne, purge des expirés.
  useEffect(() => {
    if (!Object.keys(timers).length) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      setTimers((prev) => {
        const alive = Object.fromEntries(Object.entries(prev).filter(([, end]) => end > t));
        return Object.keys(alive).length === Object.keys(prev).length ? prev : alive;
      });
    }, 500);
    return () => window.clearInterval(id);
  }, [timers]);

  // Référentiels Data Dragon (une seule fois par version) — différés jusqu'à la
  // PREMIÈRE partie détectée : la fenêtre overlay vit cachée en permanence, pas
  // de téléchargement/parsing de gros JSON au boot pour rien.
  const inGame = !!data?.active;
  useEffect(() => {
    if (!inGame) return;
    let dead = false;
    fetchChampionKeyMap(version).then((m) => !dead && setKeyMap(m)).catch(() => {});
    fetchSummonerSpellMap(version).then((m) => !dead && setSummMap(m)).catch(() => {});
    fetchItemHasteMap(version).then((m) => !dead && setHasteMap(m)).catch(() => {});
    return () => {
      dead = true;
    };
  }, [version, inGame]);

  const enemies = data?.active ? data.enemies : [];
  // L'adversaire de LANE réel, suivi par défaut tant que rien n'est épinglé.
  const laneOpponent: LiveGameEnemy | null = useMemo(
    () => enemies.find((e) => e.position && e.position === data?.my_position) ?? null,
    [enemies, data?.my_position]
  );
  const selected: LiveGameEnemy | null = useMemo(() => {
    if (!enemies.length) return null;
    if (pinned) {
      const p = enemies.find((e) => e.raw === pinned);
      if (p) return p;
    }
    return laneOpponent ?? enemies[0];
  }, [enemies, pinned, laneOpponent]);

  // Le backend fetch l'insight (WR/matchup/pic) pour l'adversaire actuellement
  // ciblé côté serveur — on le lui indique à chaque changement de sélection,
  // pour qu'un clic sur un autre portrait mette bien à jour ces stats (et pas
  // seulement les cooldowns/sorts, qui eux sont déjà purement dérivés de
  // `selected` côté frontend).
  // On envoie toujours la cible, y compris "" quand la sélection est masquée
  // (Mode Streamer du client LoL : riot_id vide) ou absente — sinon le backend
  // garderait un ancien target_riot_id et rediffuserait un insight périmé pour
  // un adversaire qu'on ne cible plus. "" côté serveur = pas de fetch / repli
  // propre sur l'adversaire de lane.
  // On joint le champion (`raw`), toujours renseigné même masqué : sans lui, un
  // adversaire masqué ET épinglé était indiscernable d'« aucun épinglage », et
  // le backend fetchait l'adversaire de lane pour un résultat que l'overlay
  // jetait ensuite (bug #9).
  useEffect(() => {
    api.setInsightTarget(selected?.riot_id ?? "", selected?.raw ?? "").catch(() => {});
  }, [selected?.riot_id, selected?.raw]);

  const activeInsight =
    insight && selected && insight.riot_id === selected.riot_id ? insight : null;

  const selectedId = useMemo(
    () => (selected && keyMap ? champIdFrom(selected.raw, selected.champion, keyMap) : null),
    [selected, keyMap]
  );

  useEffect(() => {
    if (!selectedId) {
      setSpells(null);
      return;
    }
    let dead = false;
    fetchChampionSpells(selectedId, version)
      .then((s) => !dead && setSpells(s))
      .catch(() => !dead && setSpells(null));
    return () => {
      dead = true;
    };
  }, [selectedId, version]);

  // La fenêtre OS ne doit exister à l'écran QUE pendant une vraie partie en cours
  // (jamais en mode démo/positionnement, jamais juste parce que le toggle "Activer"
  // est coché) — voir la règle "overlays in-game" dans CLAUDE.md.
  const shouldShow = enabled && !!data && data.active && !!selected && !!keyMap;
  useGameOnlyWindow(shouldShow, "overlay-cd");

  // Désactivation rapide depuis l'overlay (croix). Ce widget n'est jamais
  // click-through (il doit rester cliquable en jeu pour changer de champion
  // épinglé), donc la croix fonctionne toujours, verrouillé ou non.
  const handleDisable = () => {
    setEnabled(false);
    localStorage.setItem("hexgate_overlay_cd_enabled", "false");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "hexgate_overlay_cd_enabled", newValue: "false" })
    );
  };

  if (!shouldShow) {
    return null;
  }

  const haste = hasteMap ? itemsHaste(selected.items, hasteMap) : 0;
  const summHaste = summonerHaste(selected.rune_trees ?? [], selected.items);
  const ranks = estimateRanks(selected.level);
  const dragProps = locked ? {} : ({ "data-tauri-drag-region": true } as const);

  return (
    <div
      {...dragProps}
      className={`h-screen w-screen flex items-center justify-center select-none overflow-hidden ${locked ? "" : "cursor-move"}`}
    >
      <div
        {...dragProps}
        className="relative flex flex-col gap-1.5 px-3 pt-2 pb-2.5 border-t-2 border-gold drop-shadow-[0_3px_10px_rgba(0,0,0,0.6)]"
        style={{
          background: "linear-gradient(180deg,#0e1822,#050d14)",
          clipPath: "polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)",
        }}
      >
        <button
          onClick={handleDisable}
          title={t("ovl.disableCd")}
          className="absolute -top-1 -right-1 z-10 flex h-[18px] w-[18px] items-center justify-center text-[13px] font-bold leading-none text-[#e84057]/70 opacity-60 transition-opacity hover:opacity-100 hover:text-[#e84057]"
        >
          ×
        </button>
        {/* Rangée des 5 ennemis — clic pour épingler */}
        <div {...dragProps} className="flex items-center gap-1.5">
          {enemies.map((e) => {
            const id = champIdFrom(e.raw, e.champion, keyMap);
            const isSel = selected.raw === e.raw;
            return (
              <button
                key={e.raw || e.champion}
                onClick={() => setPinned(e.raw)}
                title={e.champion}
                className={`relative h-[26px] w-[26px] shrink-0 overflow-hidden rounded-[3px] transition-all ${
                  isSel ? "ring-2 ring-gold" : "ring-1 ring-border/40 opacity-75 hover:opacity-100"
                } ${e.dead ? "grayscale" : ""}`}
              >
                {id ? (
                  <img src={champSquareUrl(id, version)} alt={e.champion} className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-[#091428] text-[9px] font-bold text-muted">
                    {e.champion.slice(0, 2)}
                  </span>
                )}
                <span className="absolute bottom-0 right-0 bg-black/85 px-[3px] text-[8px] font-bold leading-[10px] text-gold-bright tabular-nums">
                  {e.level}
                </span>
                {(timers[`${e.raw}|0`] || timers[`${e.raw}|1`]) && (
                  <span className="absolute left-0 top-0 h-[7px] w-[7px] rounded-full bg-hextech-blue shadow-[0_0_4px_#0ac8b9] animate-pulse" />
                )}
              </button>
            );
          })}
          <span {...dragProps} className="ml-auto pl-1 text-[7px] font-extrabold uppercase tracking-[0.18em] text-[#6f8496]">
            CD est.
          </span>
        </div>

        {/* Q/W/E du champion ennemi sélectionné + sorts d'invocateur — le R
            (ultimate) est volontairement exclu : Riot interdit depuis le
            13/03/2025 le tracking (auto ou manuel) du cooldown d'ultimate
            adverse, cf. politique "Game Integrity". Ne pas le réintroduire. */}
        <div {...dragProps} className="flex items-end gap-2">
          {(spells ?? []).filter((s) => s.slot !== "R").map((s) => {
            const rank = ranks.basic;
            const base = rank > 0 ? s.cooldown[Math.min(rank, s.cooldown.length) - 1] : 0;
            const cd = rank > 0 ? effectiveCd(base, haste) : 0;
            return (
              <div key={s.slot} className="flex w-[30px] flex-col items-center gap-0.5">
                <div className={`relative h-[28px] w-[28px] overflow-hidden rounded-[3px] ring-1 ring-border/50 ${rank === 0 ? "grayscale opacity-50" : ""}`}>
                  <img src={s.iconUrl} alt={s.name} title={s.name} className="h-full w-full object-cover" draggable={false} />
                  <span className="absolute bottom-0 left-0 bg-black/85 px-[3px] text-[7px] font-bold leading-[9px] text-muted">
                    {s.slot}
                  </span>
                </div>
                <span className={`text-[10px] font-extrabold leading-none tabular-nums ${rank === 0 ? "text-muted" : "text-gold-bright"}`}>
                  {formatCd(cd)}
                </span>
              </div>
            );
          })}
          {spells === null && (
            <span className="text-[9px] text-muted italic">{t("ovl.loadingSpells")}</span>
          )}
          <div {...dragProps} className="mx-0.5 h-7 w-px self-center bg-gold/30" />
          {selected.spells.map((rawSpell, i) => {
            const key = summKeyFrom(rawSpell);
            const info = key && summMap ? summMap.get(key) : null;
            if (!info) return <span key={i} className="w-[24px]" />;
            const effCd = effectiveCd(info.cooldown, summHaste);
            const tKey = `${selected.raw}|${i}`;
            const end = timers[tKey];
            const remaining = end ? Math.max(0, (end - now) / 1000) : 0;
            const running = end !== undefined && remaining > 0;
            return (
              <button
                key={i}
                onClick={() => setTimers((t) => ({ ...t, [tKey]: Date.now() + effCd * 1000 }))}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  setTimers((t) => {
                    const { [tKey]: _drop, ...rest } = t;
                    return rest;
                  });
                }}
                title={t("ovl.spellHint", { name: info.name })}
                className="flex w-[24px] cursor-pointer flex-col items-center gap-0.5"
              >
                <span className={`relative h-[22px] w-[22px] overflow-hidden rounded-[3px] ring-1 ${running ? "ring-[#e84057]/80" : "ring-border/50"}`}>
                  <img
                    src={info.iconUrl}
                    alt={info.name}
                    className={`h-full w-full object-cover ${running ? "grayscale brightness-50" : ""}`}
                    draggable={false}
                  />
                </span>
                <span className={`text-[9px] font-bold leading-none tabular-nums ${running ? "text-[#e84057]" : "text-hextech-blue"}`}>
                  {running ? formatCd(remaining) : formatCd(effCd)}
                </span>
              </button>
            );
          })}
        </div>

        {activeInsight && !activeInsight.error && (
          <div {...dragProps} className="flex items-center gap-2 border-t border-gold/15 pt-1.5 text-[9px] leading-none">
            <span className="font-extrabold uppercase tracking-[0.1em] text-[#6f8496]">
              WR <span className="font-extrabold text-gold-bright">{winratePct(activeInsight.solo)}</span>
              {activeInsight.solo && (
                <span className="text-[#6f8496]"> ({activeInsight.solo.wins + activeInsight.solo.losses})</span>
              )}
            </span>
            <span className="h-3 w-px bg-gold/20" />
            <span className="font-extrabold uppercase tracking-[0.1em] text-[#6f8496]">
              vs {activeInsight.champion}{" "}
              <span className="font-extrabold text-hextech-blue">
                {activeInsight.matchup.sample > 0
                  ? `${activeInsight.matchup.wins}${wlLetters(lang).w}-${activeInsight.matchup.losses}${wlLetters(lang).l}`
                  : "—"}
              </span>
            </span>
            <span className="h-3 w-px bg-gold/20" />
            <span className="font-extrabold uppercase tracking-[0.1em] text-[#6f8496]">
              {t("ovl.peak")}{" "}
              <span className="font-extrabold text-gold-bright">
                {activeInsight.peak.tier ? rankLabel(activeInsight.peak.tier, activeInsight.peak.division, lang) : "—"}
              </span>
            </span>
          </div>
        )}
        {activeInsight?.error && (
          <div {...dragProps} className="border-t border-gold/15 pt-1.5 text-[9px] italic text-[#e84057]">
            {t("ovl.insightUnavailable")} {activeInsight.error}
          </div>
        )}
      </div>
    </div>
  );
}

function winratePct(solo: LiveGameOpponentInsight["solo"]): string {
  if (!solo) return "N/A";
  const total = solo.wins + solo.losses;
  if (total === 0) return "N/A";
  return `${Math.round((solo.wins / total) * 100)}%`;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <OverlayCdApp />
    </I18nProvider>
  </React.StrictMode>
);
