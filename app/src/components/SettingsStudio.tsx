import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronRight, RotateCcw, Search, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  api, type PresetsPayload, type SettingValue, type SettingsTree,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { hotkeyLabel } from "@/lib/hotkeyLabels";

/** Une modification en attente : quel arbre, quelle section, quelle clé. */
type Edit = { tree: "game" | "input"; section: string; key: string; value: SettingValue };
type Slot = { key: string; smart: string | null; fallback: string };

const editId = (e: { tree: string; section: string; key: string }) => `${e.tree}/${e.section}/${e.key}`;
/** Identifiant de capture clavier : toutes les sections de raccourcis sont
 * capturables, pas seulement `GameEvents`. */
const capId = (section: string, key: string) => `${section}/${key}`;

/* Correspondances relevées sur le client réel (voir CLAUDE_TRANS.md) — elles
 * reproduisent exactement la grille du menu « En jeu / Raccourcis » du client,
 * y compris l'ordre des objets 1 2 3 5 6 7 et la babiole sur la touche 4. */
const ABILITIES: Slot[] = [1, 2, 3, 4].map((n) => ({
  key: `evtCastSpell${n}`, smart: `evtCastSpell${n}smart`, fallback: "QWER"[n - 1],
}));
const SUMMONERS: Slot[] = [1, 2].map((n) => ({
  key: `evtCastAvatarSpell${n}`, smart: `evtCastAvatarSpell${n}smart`, fallback: "DF"[n - 1],
}));
const ITEMS: Slot[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  key: `evtUseItem${n}`, smart: `evtUseItem${n}smart`, fallback: "123567"[n - 1],
}));
const TRINKET: Slot[] = [
  { key: "evtUseVisionItem", smart: "evtUseVisionItemsmart", fallback: "4" },
];

/** Clés déjà couvertes par la grille principale : à ne pas répéter plus bas. */
const IN_GRID = new Set([...ABILITIES, ...SUMMONERS, ...ITEMS, ...TRINKET].map((s) => s.key));

/** Classement des 153 raccourcis restants, dans l'ordre d'affichage.
 *
 * Établi à partir des noms réellement présents chez le client (166 entrées
 * `GameEvents` + 5 `HUDEvents` + 2 `ShopEvents`), pas d'une liste devinée.
 * Le dernier motif attrape tout : si Riot ajoute une clé, elle apparaît dans
 * « divers » au lieu de disparaître silencieusement de l'écran. */
const CATEGORIES: { id: string; test: RegExp }[] = [
  { id: "pings", test: /Ping/i },
  { id: "camera", test: /^evt(Camera|DragScroll|Scroll)/ },
  { id: "move", test: /^evt(Player(Attack|Move|Hold|Stop)|PetMove|Select(Ally|Self)|ChampionOnly)/ },
  { id: "comm", test: /^evt(Emote|RadialEmote|Chat|ChampMastery)/ },
  { id: "ui", test: /^evt(Show|Toggle|Hold|OnUI|DrawHud|SysMenu)/ },
  { id: "shop", test: /Shop/i },
  { id: "levelSpell", test: /^evtLevelSpell/ },
  { id: "smartSelf", test: /^evtSmartPlusSelfCast/ },
  { id: "smartIndicator", test: /^evtSmartCastWithIndicator/ },
  { id: "smartCast", test: /^evtSmartCast/ },
  { id: "selfCast", test: /^evtSelfCast/ },
  { id: "normalCast", test: /^evtNormalCast/ },
  { id: "misc", test: /./ },
];

const FIELD =
  "h-8 rounded-lg border border-border bg-[#050b14] px-2 text-[11px] text-text outline-none focus:border-gold/60";
const GOLD_BTN =
  "h-8 shrink-0 cursor-pointer rounded-lg bg-gold px-3 text-[10px] font-bold text-black hover:bg-gold-bright disabled:opacity-50";
const GHOST_BTN =
  "h-8 shrink-0 cursor-pointer rounded-lg border border-gold/30 bg-[#0e1624]/60 px-3 text-[10px] font-bold text-gold transition-all hover:border-gold hover:bg-gold/5 disabled:opacity-50";

/** Le client écrit tantôt `null`, tantôt la CHAÎNE "null", tantôt
 * `"[<Unbound>]"` pour dire « pas de touche ». Les trois valent non assigné. */
function isUnbound(value: SettingValue): boolean {
  return value == null || value === "null" || String(value).includes("<Unbound>");
}

/** `[Ctrl][c]` -> `CTRL+C`, `[q]` -> `Q`, non assigné -> `—`.
 * Une valeur peut porter plusieurs liaisons séparées par une virgule
 * (`"[Ctrl] [l], [Ctrl] [Return]"`) : seule la première tient dans la case, la
 * valeur complète reste modifiable dans l'éditeur détaillé. */
function displayBinding(value: SettingValue): string {
  if (isUnbound(value)) return "—";
  const first = String(value).split(",")[0];
  const parts = [...first.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  if (!parts.length) return "—";
  return parts.map((p) => (p.length === 1 ? p.toUpperCase() : p)).join("+");
}

/** `evtPlayerAttackMove` -> `Player Attack Move`.
 *
 * Les 153 noms d'événements viennent du client et ne sont pas traduits : les
 * traduire en six langues serait 918 chaînes inventées, et le nom brut reste
 * la seule référence fiable pour chercher. On se contente de le rendre
 * lisible. */
function prettifyKey(key: string): string {
  return key
    .replace(/^ev(en)?t/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------------ */
/* Sous-composants au niveau MODULE.                                          */
/*                                                                            */
/* Ils étaient définis dans le corps de `SettingsStudio`. React y voyait un    */
/* type de composant NEUF à chaque rendu et remontait tout le sous-arbre : la  */
/* grille disparaissait puis réapparaissait, les champs perdaient le focus à   */
/* chaque frappe, et l'état était rechargé en boucle. Symptôme rapporté le     */
/* 13/09/2026 : « l'interface s'ouvre et se referme ».                        */
/* Ne jamais redéclarer un composant à l'intérieur d'un rendu.                 */
/* ------------------------------------------------------------------------ */

/** Une case de touche et son éclair de cast rapide, comme dans le menu du jeu. */
function KeyCap({
  label, title, capturing, dirty, smart, onCapture, onToggleSmart,
}: {
  label: string;
  title: string;
  capturing: boolean;
  dirty: boolean;
  smart: { on: boolean; dirty: boolean } | null;
  onCapture: () => void;
  onToggleSmart: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={onCapture}
        title={title}
        className={`flex h-[52px] w-[52px] items-center justify-center rounded-md border text-[15px] font-bold uppercase transition-colors ${
          capturing
            ? "animate-pulse border-gold bg-gold/20 text-gold"
            : dirty
              ? "border-gold bg-gold/10 text-gold"
              : "border-border bg-[#0b1420] text-text hover:border-gold/60"
        }`}
      >
        {capturing ? "…" : label}
      </button>
      {smart && (
        <button
          type="button"
          onClick={onToggleSmart}
          title={title}
          className={`flex h-[19px] w-[52px] items-center justify-center rounded-sm border transition-colors ${
            smart.on
              ? "border-gold bg-gold/15 text-gold"
              : "border-border bg-[#070d17] text-muted hover:border-gold/40"
          } ${smart.dirty ? "ring-1 ring-gold/60" : ""}`}
        >
          <Zap className={`h-3 w-3 ${smart.on ? "fill-gold" : ""}`} />
        </button>
      )}
    </div>
  );
}

function SlotGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Une ligne « nom du raccourci → touche », pour tout ce qui n'est pas dans la
 * grille principale. */
function HotkeyRow({
  label, title, binding, capturing, dirty, onCapture,
}: {
  label: string;
  title: string;
  binding: string;
  capturing: boolean;
  dirty: boolean;
  onCapture: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 hover:bg-gold/5">
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted" title={title}>
        {label}
      </span>
      <button
        type="button"
        onClick={onCapture}
        title={title}
        className={`h-[24px] min-w-[86px] shrink-0 rounded border px-1.5 text-[10px] font-bold uppercase transition-colors ${
          capturing
            ? "animate-pulse border-gold bg-gold/20 text-gold"
            : dirty
              ? "border-gold bg-gold/10 text-gold"
              : "border-border bg-[#0b1420] text-text hover:border-gold/60"
        }`}
      >
        {capturing ? "…" : binding}
      </button>
    </div>
  );
}

function GameToggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-start gap-2 text-[10.5px] leading-snug text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-gold"
      />
      {label}
    </label>
  );
}

/** Traduit une frappe en chaîne au format du client. Échap = retirer la touche.
 * Chaîne vide = modificateur seul, il faut continuer d'attendre. */
function bindingFromEvent(e: KeyboardEvent): string {
  if (e.key === "Escape") return "[<Unbound>]";
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return "";
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("[Ctrl]");
  if (e.altKey) mods.push("[Alt]");
  if (e.shiftKey) mods.push("[Shift]");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key === "Enter") key = "Return";
  else if (key.length === 1) key = key.toLowerCase();
  return `${mods.join("")}[${key}]`;
}

/** Studio de réglages et raccourcis, calqué sur le menu « En jeu / Raccourcis »
 * du client League.
 *
 * Ce que la lecture du client a appris et qui gouverne ce composant :
 * - `Quickbinds` ne contient que des booléens — c'est le cast rapide, rendu ici
 *   par l'éclair sous chaque case, comme en jeu ;
 * - `GameEvents` porte 166 liaisons au format `[Ctrl][c]`, dont 13 seulement
 *   dans la grille principale : les 153 autres sont listées par catégorie ;
 * - une entrée peut valoir `null`, la chaîne `"null"` ou `"[<Unbound>]"` ;
 * - les réglages de jeu mélangent booléens, entiers et flottants.
 *
 * Pas de « Restaurer les valeurs par défaut » : le LCU n'expose aucune source
 * de valeurs d'usine, un tel bouton serait un mensonge. Les presets couvrent le
 * besoin réel (revenir à une configuration connue).
 *
 * Les écritures partent en PATCH : seules les sections modifiées sont envoyées. */
export function SettingsStudio({ accounts }: { accounts: string[] }) {
  const { t, lang } = useI18n();
  /** Libellé traduit, avec repli sur le nom brut rendu lisible : un raccourci
   * ajouté par Riot et pas encore traduit doit rester identifiable, pas vide. */
  const labelOf = useCallback(
    (key: string) => hotkeyLabel(key, lang) ?? prettifyKey(key),
    [lang],
  );
  const [payload, setPayload] = useState<PresetsPayload | null>(null);
  const [game, setGame] = useState<SettingsTree | null>(null);
  const [input, setInput] = useState<SettingsTree | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [capturing, setCapturing] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Catégories repliées par défaut. Avant, les 160 raccourcis vivaient dans un
  // conteneur à ascenseur PROPRE, imbriqué dans celui de la page : dans une
  // fenêtre de 600 px la molette scrollait la liste interne et on ne pouvait
  // plus remonter à la grille. Replier règle la longueur sans imbriquer.
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [advanced, setAdvanced] = useState(false);
  const [preset, setPreset] = useState("");
  const [newName, setNewName] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.settingsPresets(), api.currentSettings()]);
      setPayload(p);
      setGame(s.game);
      setInput(s.input);
      setEdits({});
    } catch {
      setPayload(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Valeur courante d'une entrée : la modification en attente prime sur le
   * client. Sans ça, une case reviendrait à son ancienne valeur au rendu. */
  const valueOf = useCallback(
    (tree: "game" | "input", section: string, key: string): SettingValue => {
      const pending = edits[editId({ tree, section, key })];
      if (pending) return pending.value;
      return ((tree === "input" ? input : game)?.[section]?.[key] ?? null) as SettingValue;
    },
    [edits, game, input],
  );

  const setEdit = useCallback(
    (tree: "game" | "input", section: string, key: string, value: SettingValue) => {
      setEdits((prev) => ({ ...prev, [editId({ tree, section, key })]: { tree, section, key, value } }));
    },
    [],
  );

  // Capture clavier : un seul écouteur global, monté uniquement pendant une
  // capture. L'effet se rejoue quand `capturing` change, donc la fermeture lit
  // toujours la bonne cible — pas besoin de ref.
  useEffect(() => {
    if (!capturing) return;
    const [section, key] = capturing.split("/");
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const binding = bindingFromEvent(e);
      if (!binding) return; // modificateur seul : on attend la vraie touche
      setEdit("input", section, key, binding);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, setEdit]);

  const pendingCount = Object.keys(edits).length;

  const applyEdits = async () => {
    if (!pendingCount) return;
    const patch: { game?: SettingsTree; input?: SettingsTree } = {};
    for (const edit of Object.values(edits)) {
      const tree = (patch[edit.tree] ??= {});
      (tree[edit.section] ??= {})[edit.key] = edit.value;
    }
    setBusy(true);
    try {
      const res = await api.editSettings(patch);
      if (res.ok) {
        toast.success(t("studio.editsApplied", { n: pendingCount }));
        await reload();
      } else toast.error(t("studio.editsFail"));
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(false);
    }
  };

  /** Bascule tous les Quickbinds d'un coup — les deux boutons du menu in-game. */
  const setAllSmart = (on: boolean) => {
    const quickbinds = input?.Quickbinds ?? {};
    setEdits((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(quickbinds)) {
        next[editId({ tree: "input", section: "Quickbinds", key })] = {
          tree: "input", section: "Quickbinds", key, value: on,
        };
      }
      return next;
    });
  };

  const savePreset = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await api.savePreset(name);
      if (res.ok) {
        toast.success(t("studio.presetSaved", { name }));
        setNewName("");
        setPreset(name);
        await reload();
      } else toast.error(t("studio.presetSaveFail"));
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = async () => {
    if (!preset) return;
    setBusy(true);
    try {
      const res = await api.applyPreset(preset, targets, live);
      if (!res.ok) toast.error(t("studio.applyPartial", { n: res.errors.length }));
      else if (res.sync_enabled) toast.success(t("studio.applied", { n: res.accounts }));
      else toast.warning(t("studio.appliedNoSync", { n: res.accounts }));
      await reload();
    } catch {
      toast.error(t("set.lcuRequired"));
    } finally {
      setBusy(false);
    }
  };

  const removePreset = async () => {
    if (!preset) return;
    setBusy(true);
    try {
      await api.deletePreset(preset);
      toast.success(t("studio.presetDeleted"));
      setPreset("");
      await reload();
    } catch {
      toast.error(t("studio.presetDeleteFail"));
    } finally {
      setBusy(false);
    }
  };

  /** Tous les raccourcis hors grille principale, rangés par catégorie et
   * filtrés par la recherche. Une catégorie vide n'est pas rendue. */
  const hotkeyCategories = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const buckets = new Map<string, { section: string; key: string }[]>();
    const sections = ["GameEvents", "HUDEvents", "ShopEvents"];
    for (const section of sections) {
      for (const key of Object.keys(input?.[section] ?? {})) {
        if (section === "GameEvents" && IN_GRID.has(key)) continue;
        // La recherche porte sur le libellé TRADUIT autant que sur le nom
        // brut : chercher « ping » en français doit trouver, et chercher
        // `evtPlayerPingOMW` aussi.
        if (
          needle &&
          !labelOf(key).toLowerCase().includes(needle) &&
          !key.toLowerCase().includes(needle)
        ) {
          continue;
        }
        const cat = CATEGORIES.find((c) => c.test.test(key)) ?? CATEGORIES[CATEGORIES.length - 1];
        const bucket = buckets.get(cat.id) ?? [];
        bucket.push({ section, key });
        buckets.set(cat.id, bucket);
      }
    }
    return CATEGORIES.filter((c) => buckets.has(c.id)).map((c) => ({
      id: c.id,
      entries: buckets.get(c.id)!.sort((a, b) => a.key.localeCompare(b.key)),
    }));
  }, [input, filter, labelOf]);

  const totalHotkeys = useMemo(
    () => hotkeyCategories.reduce((n, c) => n + c.entries.length, 0),
    [hotkeyCategories],
  );

  /** Réglages de jeu (hors raccourcis), pour l'éditeur détaillé. */
  const gameGroups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const out: [string, string[]][] = [];
    for (const [section, entries] of Object.entries(game ?? {})) {
      const keys = Object.keys(entries ?? {}).filter(
        (k) => !needle || k.toLowerCase().includes(needle) || section.toLowerCase().includes(needle),
      );
      if (keys.length) out.push([section, keys.sort()]);
    }
    return out;
  }, [game, filter]);

  const allSelected = targets.length === 0 || targets.length === accounts.length;
  const hasClient = Boolean(game || input);
  const searching = filter.trim().length > 0;

  /** Fabrique les props d'une case de la grille depuis l'état courant. */
  const capFor = (slot: Slot) => {
    const binding = valueOf("input", "GameEvents", slot.key);
    const shown = displayBinding(binding);
    return {
      title: slot.key,
      label: isUnbound(binding) ? slot.fallback : shown,
      capturing: capturing === capId("GameEvents", slot.key),
      dirty: editId({ tree: "input", section: "GameEvents", key: slot.key }) in edits,
      smart: slot.smart
        ? {
            on: valueOf("input", "Quickbinds", slot.smart) === true,
            dirty: editId({ tree: "input", section: "Quickbinds", key: slot.smart }) in edits,
          }
        : null,
      onCapture: () =>
        setCapturing((c) => (c === capId("GameEvents", slot.key) ? null : capId("GameEvents", slot.key))),
      onToggleSmart: () =>
        slot.smart &&
        setEdit("input", "Quickbinds", slot.smart, valueOf("input", "Quickbinds", slot.smart) !== true),
    };
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ------------------------------------------------ menu style in-game */}
      <div className="overflow-hidden rounded-xl border border-gold/25 bg-gradient-to-b from-[#0a1420] to-[#060d16]">
        <div className="flex items-center justify-between gap-2 border-b border-gold/20 px-3.5 py-2.5">
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-gold">
            {t("studio.title")}
          </h3>
          {pendingCount > 0 && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button disabled={busy} onClick={() => setEdits({})} className={GHOST_BTN} title={t("studio.discard")}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button disabled={busy} onClick={applyEdits} className={GOLD_BTN}>
                <Check className="mr-1 h-3.5 w-3.5" />
                {t("studio.applyEdits", { n: pendingCount })}
              </Button>
            </div>
          )}
        </div>

        {!hasClient ? (
          <p className="px-3.5 py-4 text-[10.5px] text-muted">{t("set.lcuRequired")}</p>
        ) : (
          <div className="flex flex-col gap-3 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text">
                {t("studio.primary")}
              </span>
              <div className="flex gap-1.5">
                <Button disabled={busy} onClick={() => setAllSmart(true)} className={GHOST_BTN}>
                  {t("studio.quickCastAll")}
                </Button>
                <Button disabled={busy} onClick={() => setAllSmart(false)} className={GHOST_BTN}>
                  {t("studio.normalCastAll")}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <SlotGroup label={t("studio.abilities")}>
                {ABILITIES.map((s) => <KeyCap key={s.key} {...capFor(s)} />)}
              </SlotGroup>
              <SlotGroup label={t("studio.summoners")}>
                {SUMMONERS.map((s) => <KeyCap key={s.key} {...capFor(s)} />)}
              </SlotGroup>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <SlotGroup label={t("studio.items")}>
                {ITEMS.map((s) => <KeyCap key={s.key} {...capFor(s)} />)}
              </SlotGroup>
              <SlotGroup label={t("studio.trinket")}>
                {TRINKET.map((s) => <KeyCap key={s.key} {...capFor(s)} />)}
              </SlotGroup>
            </div>

            <p className="text-[10px] leading-snug text-muted">{t("studio.captureHint")}</p>

            <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text">
                {t("studio.indicatorTitle")}
              </span>
              <GameToggle
                label={t("studio.onKeyRelease")}
                checked={valueOf("game", "HUD", "SmartCastOnKeyRelease") === true}
                onChange={(v) => setEdit("game", "HUD", "SmartCastOnKeyRelease", v)}
              />
              <GameToggle
                label={t("studio.castWhenNewSpell")}
                checked={valueOf("game", "HUD", "SmartCastWithIndicator_CastWhenNewSpellSelected") === true}
                onChange={(v) => setEdit("game", "HUD", "SmartCastWithIndicator_CastWhenNewSpellSelected", v)}
              />
            </div>

            {/* --------------------------------- tous les autres raccourcis */}
            <div className="flex flex-col gap-2 border-t border-border/40 pt-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text">
                  {t("studio.additional")}
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-muted">
                    ({totalHotkeys})
                  </span>
                </span>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("studio.searchPlaceholder")}
                  className={`${FIELD} w-full pl-7`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                {hotkeyCategories.length === 0 && (
                  <p className="text-[10.5px] text-muted">{t("studio.noMatch")}</p>
                )}
                {hotkeyCategories.map((cat) => {
                  // Une recherche en cours ouvre tout : l'utilisateur cherche une
                  // clé précise, la lui cacher derrière un repli n'aurait aucun sens.
                  const open = searching || openCats[cat.id] === true;
                  return (
                    <div key={cat.id} className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => setOpenCats((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                        className="flex cursor-pointer items-center gap-1.5 rounded px-0.5 py-0.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-gold/70 hover:text-gold"
                      >
                        <ChevronRight
                          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                        />
                        {t(`studio.cat.${cat.id}`)}
                        <span className="font-normal normal-case tracking-normal text-muted">
                          ({cat.entries.length})
                        </span>
                      </button>
                      {open &&
                        cat.entries.map(({ section, key }) => {
                          const binding = valueOf("input", section, key);
                          return (
                            <HotkeyRow
                              key={`${section}/${key}`}
                              label={labelOf(key)}
                              title={`${section}.${key}`}
                              binding={displayBinding(binding)}
                              capturing={capturing === capId(section, key)}
                              dirty={editId({ tree: "input", section, key }) in edits}
                              onCapture={() =>
                                setCapturing((c) => (c === capId(section, key) ? null : capId(section, key)))
                              }
                            />
                          );
                        })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- presets */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
        <div className="text-[12.5px] font-semibold text-text">{t("studio.presets")}</div>
        <p className="text-[10.5px] leading-snug text-muted">{t("studio.presetsDesc")}</p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("studio.presetNamePlaceholder")}
            className={`${FIELD} min-w-0 flex-1`}
          />
          <Button disabled={busy || !newName.trim()} onClick={savePreset} className={GOLD_BTN}>
            {t("studio.captureCurrent")}
          </Button>
        </div>

        {payload && payload.presets.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className={`${FIELD} min-w-0 flex-1`}
              >
                <option value="">{t("studio.choosePreset")}</option>
                {payload.presets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} — {p.input_sections + p.game_sections} {t("studio.sections")}
                  </option>
                ))}
              </select>
              <Button disabled={busy || !preset} onClick={applyPreset} className={GOLD_BTN}>
                {t("studio.apply")}
              </Button>
              <Button
                disabled={busy || !preset}
                onClick={removePreset}
                className="h-8 shrink-0 cursor-pointer rounded-lg border border-red/40 bg-red/10 px-2.5 text-[10px] font-bold text-red hover:bg-red/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-[#050b14]/60 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  {t("studio.targets")}
                </span>
                <button
                  type="button"
                  onClick={() => setTargets(allSelected ? [accounts[0]].filter(Boolean) : [])}
                  className="cursor-pointer text-[10px] font-bold text-gold hover:underline"
                >
                  {allSelected ? t("studio.selectSome") : t("studio.selectAll")}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {accounts.map((name) => (
                  <label key={name} className="flex cursor-pointer select-none items-center gap-2 text-[10.5px] text-muted">
                    <input
                      type="checkbox"
                      checked={targets.length === 0 || targets.includes(name)}
                      onChange={(e) =>
                        setTargets((prev) => {
                          const base = prev.length === 0 ? accounts : prev;
                          return e.target.checked
                            ? [...new Set([...base, name])]
                            : base.filter((n) => n !== name);
                        })
                      }
                      className="h-3.5 w-3.5 accent-gold"
                    />
                    <span className="truncate">{name}</span>
                  </label>
                ))}
              </div>
              <label className="flex cursor-pointer select-none items-center gap-2 border-t border-border/40 pt-1.5 text-[10.5px] text-muted">
                <input
                  type="checkbox"
                  checked={live}
                  onChange={(e) => setLive(e.target.checked)}
                  className="h-3.5 w-3.5 accent-gold"
                />
                {t("studio.alsoLive")}
              </label>
            </div>

            {payload.sync_enabled === false && (
              <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/5 px-2.5 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                <p className="text-[10px] leading-snug text-gold/90">{t("studio.syncOff")}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ------------------------- réglages de jeu (hors raccourcis) -------- */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="flex cursor-pointer items-center justify-between gap-2 text-left"
        >
          <span className="text-[12.5px] font-semibold text-text">{t("studio.editor")}</span>
          <span className="text-[10px] font-bold text-gold">{advanced ? "−" : "+"}</span>
        </button>

        {advanced && hasClient && (
          <>
            <div className="flex flex-col gap-2">
              {gameGroups.length === 0 && <p className="text-[10.5px] text-muted">{t("studio.noMatch")}</p>}
              {gameGroups.map(([section, keys]) => (
                <div key={section} className="flex flex-col gap-1">
                  <div className="sticky top-0 bg-card py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-gold/70">
                    {section}
                    <span className="ml-1.5 font-normal text-muted">({keys.length})</span>
                  </div>
                  {keys.map((key) => {
                    const id = editId({ tree: "game", section, key });
                    const value = valueOf("game", section, key);
                    return (
                      <div
                        key={id}
                        className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 ${
                          id in edits ? "bg-gold/10" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted" title={key}>
                          {key}
                        </span>
                        {typeof value === "boolean" ? (
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) => setEdit("game", section, key, e.target.checked)}
                            className="h-3.5 w-3.5 shrink-0 accent-gold"
                          />
                        ) : typeof value === "number" ? (
                          <input
                            type="number"
                            step="any"
                            value={value}
                            onChange={(e) => setEdit("game", section, key, Number(e.target.value))}
                            className={`${FIELD} w-24 shrink-0 text-right`}
                          />
                        ) : (
                          <input
                            value={value == null ? "" : String(value)}
                            onChange={(e) => setEdit("game", section, key, e.target.value)}
                            className={`${FIELD} w-40 shrink-0 font-mono text-[10px]`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="text-[10px] leading-snug text-muted">{t("studio.formatHint")}</p>
          </>
        )}
      </div>
    </div>
  );
}
