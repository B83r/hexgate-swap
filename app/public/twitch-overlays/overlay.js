const params = new URLSearchParams(window.location.search);

const text = {
  partner: (params.get("partner") || "THIS STREAM").toUpperCase(),
  session: (params.get("session") || "RANKED TEAMMATE SESSION").toUpperCase(),
  site: (params.get("site") || "NEXTRANK.EU").toUpperCase(),
  rank: (params.get("rank") || "RADIANT").toUpperCase(),
};

const defaultAlignment = {
  corner: "br",
  strip: "bl",
  hud: "tr",
  mark: "tl",
};

const allowedAlignments = new Set(["tl", "tr", "bl", "br", "center"]);
const requestedScale = Number.parseFloat(params.get("scale") || "1");
const scale = Number.isFinite(requestedScale)
  ? Math.min(2, Math.max(0.5, requestedScale))
  : 1;

document.documentElement.style.setProperty("--overlay-scale", String(scale));
document.body.classList.toggle("motion-off", params.get("motion") === "off");

function brandIcon(extraClass = "") {
  return `
    <span class="brand-icon ${extraClass}" aria-hidden="true">
      <span class="bolt"></span>
      <span class="status-dot"></span>
    </span>
  `;
}

function wordmark(extraClass = "") {
  return `
    <span class="wordmark ${extraClass}" aria-label="NextRank">
      <span class="word-next">NEXT</span><span class="word-rank">RANK</span>
    </span>
  `;
}

function cornerSignal() {
  return `
    <div class="overlay-scale">
      <section class="overlay-unit corner-card" aria-label="NextRank, in partnership with ${text.partner}">
        <span class="energy-sweep" aria-hidden="true"></span>
        ${brandIcon()}
        <span class="divider" aria-hidden="true"></span>
        <span class="corner-copy">
          ${wordmark()}
          <span class="partnership">IN PARTNERSHIP WITH <span data-field="partner"></span></span>
        </span>
      </section>
    </div>
  `;
}

function broadcastStrip() {
  return `
    <div class="overlay-scale">
      <section class="overlay-unit broadcast-strip" aria-label="NextRank ranked teammate session">
        <span class="strip-signal" aria-hidden="true"></span>
        ${brandIcon("brand-icon-strip")}
        ${wordmark("wordmark-strip")}
        <span class="divider divider-strip" aria-hidden="true"></span>
        <span class="session-copy"><span data-field="session"></span><b>·</b><span data-field="site"></span></span>
      </section>
    </div>
  `;
}

function hudFrame() {
  return `
    <div class="overlay-scale">
      <section class="overlay-unit hud-shell" aria-label="NextRank teammate rank ${text.rank}">
        <div class="hud-panel">
          <span class="hud-scan" aria-hidden="true"></span>
          <div class="hud-top">
            ${brandIcon("brand-icon-hud")}
            ${wordmark("wordmark-hud")}
          </div>
          <span class="hud-divider" aria-hidden="true"></span>
          <div class="rank-row">
            <span>TEAMMATE RANK:</span>
            <strong data-field="rank"></strong>
          </div>
        </div>
      </section>
    </div>
  `;
}

function bareMark() {
  return `
    <div class="overlay-scale">
      <section class="overlay-unit bare-mark" aria-label="NextRank">
        ${brandIcon("brand-icon-mark")}
        ${wordmark("wordmark-mark")}
        <span class="mark-shine" aria-hidden="true"></span>
      </section>
    </div>
  `;
}

const renderers = {
  corner: cornerSignal,
  strip: broadcastStrip,
  hud: hudFrame,
  mark: bareMark,
};

function fillDynamicText(container) {
  for (const [field, value] of Object.entries(text)) {
    container.querySelectorAll(`[data-field="${field}"]`).forEach((node) => {
      node.textContent = value;
    });
  }
}

function mountVariant(target, variant) {
  const render = renderers[variant];
  if (!render) return;
  target.innerHTML = render();
  target.dataset.renderedVariant = variant;
  fillDynamicText(target);
}

const pageVariant = document.body.dataset.variant || "corner";

if (pageVariant === "all") {
  document.querySelectorAll("[data-mount]").forEach((target) => {
    mountVariant(target, target.dataset.mount);
  });
} else {
  const root = document.querySelector("#overlay-root");
  if (root) {
    const requestedAlignment = params.get("align") || defaultAlignment[pageVariant];
    const alignment = allowedAlignments.has(requestedAlignment)
      ? requestedAlignment
      : defaultAlignment[pageVariant];
    root.classList.add(`align-${alignment}`);
    mountVariant(root, pageVariant);
  }
}
