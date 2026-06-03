// ═══════════════════════════════════════════════════════════════
//  Tranzy Chișinău Transport — Custom Lovelace Card  v1.0.0
//  Real-time bus & trolleybus arrival board for Home Assistant
// ═══════════════════════════════════════════════════════════════

const CARD_TAG     = "tranzy-chisinau-card";
const CARD_VERSION = "0.1.2";
const DSEG7_URL    = "https://cdn.jsdelivr.net/npm/dseg@0.46.0/fonts/DSEG7-Classic/DSEG7Classic-Regular.woff2";
const ROUTE_RE     = /^sensor\.tranzy_\d+_route_/;

// Inject DSEG7Classic font into document head (once per page load)
(function () {
  if (document.querySelector("[data-tranzy-font]")) return;
  const s = document.createElement("style");
  s.dataset.tranzyFont = "1";
  s.textContent = `@font-face{font-family:'DSEG7Classic';src:url('${DSEG7_URL}') format('woff2');font-display:swap}`;
  document.head.appendChild(s);
}());

console.info(
  `%c TRANZY-CHIȘINĂU-CARD %c v${CARD_VERSION} `,
  "background:#FFB300;color:#000;font-weight:700;padding:2px 8px;border-radius:3px 0 0 3px",
  "background:#1a0a00;color:#FFB300;padding:2px 8px;border-radius:0 3px 3px 0"
);

// ─── Helpers ────────────────────────────────────────────────────

function normalizeStops(cfg) {
  if (cfg.stops)    return cfg.stops;
  if (cfg.entities) return [{ entities: cfg.entities, title: cfg.title }];
  return [];
}

function etaToTime(etaMin) {
  const d = new Date(Date.now() + etaMin * 60_000);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h} ${m}`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function terminus(longName) {
  if (!longName) return "";
  return longName.split(" - ").pop().trim();
}

// ═══════════════════════════════════════════════════════════════
//  CARD
// ═══════════════════════════════════════════════════════════════

const CARD_CSS = `
:host { display: block; }

.card {
  background: #080808;
  border-radius: 14px;
  border: 1px solid rgba(255,179,0,0.18);
  overflow: hidden;
  box-shadow:
    0 8px 48px rgba(0,0,0,0.9),
    inset 0 1px 0 rgba(255,179,0,0.05);
}

.stop-section { padding: 10px 12px 8px; }

.stop-section + .stop-section {
  border-top: 1px solid rgba(255,179,0,0.07);
  padding-top: 12px;
}

.stop-header {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: rgba(255,179,0,0.38);
  margin-bottom: 8px;
  padding-left: 2px;
  font-family: 'Courier New', monospace;
}

.row {
  display: grid;
  grid-template-columns: 62px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-radius: 8px;
  background: rgba(255,179,0,0.018);
  border: 1px solid rgba(255,179,0,0.055);
  margin-bottom: 5px;
  min-height: 58px;
}
.row:last-child { margin-bottom: 0; }

.row.arriving {
  background: rgba(0,255,136,0.035);
  border-color: rgba(0,255,136,0.14);
}
.row.nodata { opacity: 0.26; }

.badge {
  background: #030303;
  border: 1px solid rgba(255,179,0,0.26);
  border-radius: 5px;
  padding: 7px 4px;
  text-align: center;
  font-family: 'DSEG7Classic', 'Courier New', monospace;
  font-size: 21px;
  color: #FFB300;
  text-shadow:
    0 0 6px rgba(255,179,0,0.95),
    0 0 18px rgba(255,140,0,0.4),
    0 0 40px rgba(255,120,0,0.15);
  box-shadow: inset 0 2px 12px rgba(0,0,0,0.75);
  white-space: nowrap;
  letter-spacing: 1px;
}
.arriving .badge {
  color: #00FF88;
  text-shadow:
    0 0 6px rgba(0,255,136,0.95),
    0 0 18px rgba(0,255,136,0.35),
    0 0 40px rgba(0,200,100,0.15);
  border-color: rgba(0,255,136,0.32);
}

.dest {
  font-size: 11px;
  color: rgba(255,179,0,0.52);
  letter-spacing: 1.8px;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Courier New', monospace;
}
.arriving .dest { color: rgba(0,255,136,0.62); }

.time-block { text-align: right; white-space: nowrap; }

.arrival-time {
  display: block;
  font-family: 'DSEG7Classic', 'Courier New', monospace;
  font-size: 30px;
  color: #FFB300;
  text-shadow:
    0 0 8px rgba(255,179,0,0.85),
    0 0 22px rgba(255,140,0,0.35),
    0 0 50px rgba(255,120,0,0.12);
  letter-spacing: 3px;
  line-height: 1;
}
.arriving .arrival-time {
  color: #00FF88;
  text-shadow:
    0 0 8px rgba(0,255,136,0.85),
    0 0 22px rgba(0,255,136,0.32),
    0 0 50px rgba(0,200,100,0.12);
}

.eta-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  margin-top: 4px;
}

.eta-min {
  font-size: 10px;
  color: rgba(255,179,0,0.38);
  letter-spacing: 1px;
  font-family: 'Courier New', monospace;
}
.arriving .eta-min { color: rgba(0,255,136,0.42); }

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00FF88;
  box-shadow: 0 0 7px #00FF88, 0 0 14px rgba(0,255,136,0.4);
  animation: pulse 1.3s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.1; transform: scale(0.65); }
}

.empty {
  padding: 32px 16px;
  text-align: center;
  color: rgba(255,179,0,0.18);
  font-size: 11px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-family: monospace;
}

.card-foot { height: 6px; }
`;

class TranzyChisinauCard extends HTMLElement {
  constructor() {
    super();
    this._root   = this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass   = null;
  }

  static getConfigElement() {
    return document.createElement(`${CARD_TAG}-editor`);
  }

  static getStubConfig(hass) {
    const groups = {};
    for (const [id, state] of Object.entries(hass.states)) {
      if (!ROUTE_RE.test(id)) continue;
      const stop = state.attributes.stop_name ?? "Stop";
      (groups[stop] ??= []).push(id);
    }
    const stops = Object.entries(groups).map(([title, entities]) => ({ title, entities }));
    return { stops: stops.length ? stops : [{ entities: [] }] };
  }

  setConfig(config) {
    this._config = config;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  getCardSize() {
    const stops = normalizeStops(this._config ?? {});
    return Math.max(2, stops.reduce((n, s) => n + (s.entities?.length ?? 0) + 1, 0));
  }

  _render() {
    const stops = normalizeStops(this._config);

    const html = stops.map(stop => {
      const header = stop.title
        ? `<div class="stop-header">${esc(stop.title)}</div>`
        : "";
      const rows = (stop.entities ?? []).map(id => this._rowHtml(id)).join("");
      return `<div class="stop-section">${header}${rows}</div>`;
    }).join("");

    this._root.innerHTML = `
      <style>${CARD_CSS}</style>
      <div class="card">
        ${html || `<div class="empty">Edit card to add stops &amp; routes</div>`}
        <div class="card-foot"></div>
      </div>`;
  }

  _rowHtml(entityId) {
    const state = this._hass.states[entityId];
    if (!state) return "";

    const raw    = parseFloat(state.state);
    const hasEta = !isNaN(raw) && state.state !== "unavailable" && state.state !== "unknown";
    const status = state.attributes.status ?? (hasEta ? "on the way" : "no data");
    const cls    = status === "arriving" ? "arriving" : !hasEta ? "nodata" : "";

    const route   = esc(state.attributes.route ?? "?");
    const dest    = esc(terminus(state.attributes.route_long_name ?? ""));
    const timeStr = hasEta ? esc(etaToTime(raw)) : "-- --";
    const minStr  = hasEta ? `~${Math.round(raw)} мин` : "нет данных";
    const dot     = status === "arriving" ? `<div class="pulse-dot"></div>` : "";

    return `
      <div class="row ${cls}">
        <div class="badge">${route}</div>
        <div class="dest">${dest}</div>
        <div class="time-block">
          <span class="arrival-time">${timeStr}</span>
          <div class="eta-row"><span class="eta-min">${minStr}</span>${dot}</div>
        </div>
      </div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  EDITOR
// ═══════════════════════════════════════════════════════════════

const EDITOR_CSS = `
:host { display: block; }
.editor { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

.stop-block {
  border: 1px solid var(--divider-color, rgba(255,255,255,0.12));
  border-radius: 10px;
  padding: 14px;
  background: var(--secondary-background-color, rgba(0,0,0,0.15));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stop-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stop-num {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: rgba(255,179,0,0.65);
  font-family: monospace;
}

.btn-remove {
  background: rgba(255,59,48,0.12);
  border: 1px solid rgba(255,59,48,0.28);
  color: rgba(255,59,48,0.75);
  border-radius: 5px;
  padding: 3px 9px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.6;
}
.btn-remove:hover { background: rgba(255,59,48,0.22); color: #ff3b30; }

.field { display: flex; flex-direction: column; gap: 4px; }

.field label {
  font-size: 11px;
  color: var(--secondary-text-color, #888);
  letter-spacing: 0.5px;
}

.field input[type=text],
.field select {
  padding: 9px 11px;
  border: 1px solid var(--divider-color, rgba(255,255,255,0.18));
  border-radius: 6px;
  background: var(--card-background-color, #1a1a1a);
  color: var(--primary-text-color, #e0e0e0);
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
}

.routes-label {
  font-size: 11px;
  color: var(--secondary-text-color, #888);
  letter-spacing: 0.5px;
}

.routes-list { display: flex; flex-direction: column; gap: 2px; }

.route-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}
.route-row:hover { background: rgba(255,179,0,0.04); }

.route-row input[type=checkbox] {
  width: 16px; height: 16px;
  accent-color: #FFB300;
  cursor: pointer;
  flex-shrink: 0;
}

.pill {
  background: rgba(255,179,0,0.1);
  color: #FFB300;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  font-family: monospace;
  font-weight: 700;
  min-width: 34px;
  text-align: center;
  flex-shrink: 0;
}

.route-name {
  font-size: 13px;
  color: var(--primary-text-color, #ccc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hint {
  font-size: 12px;
  color: var(--secondary-text-color, #888);
  font-style: italic;
  padding: 4px 0;
}

.btn-add {
  width: 100%;
  padding: 11px;
  border: 1px dashed rgba(255,179,0,0.28);
  border-radius: 8px;
  background: rgba(255,179,0,0.03);
  color: rgba(255,179,0,0.6);
  font-size: 13px;
  letter-spacing: 1px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-add:hover {
  background: rgba(255,179,0,0.07);
  border-color: rgba(255,179,0,0.45);
  color: #FFB300;
}
`;

class TranzyChisinauCardEditor extends HTMLElement {
  constructor() {
    super();
    this._root   = this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass   = null;
  }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config));
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  // Group all tranzy route sensors by stop_name
  _discover() {
    const groups = {};
    for (const [id, state] of Object.entries(this._hass?.states ?? {})) {
      if (!ROUTE_RE.test(id)) continue;
      const stop  = state.attributes.stop_name ?? "Unknown";
      const route = state.attributes.route     ?? id;
      const dest  = state.attributes.route_long_name
        ? state.attributes.route_long_name.split(" - ").pop().trim()
        : "";
      if (!groups[stop]) groups[stop] = [];
      groups[stop].push({ id, route, dest });
    }
    for (const g of Object.values(groups)) {
      g.sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
    }
    return groups;
  }

  _stopNameFor(entities, discovered) {
    for (const [name, sensors] of Object.entries(discovered)) {
      if (entities.some(id => sensors.some(s => s.id === id))) return name;
    }
    return "";
  }

  _render() {
    if (!this._hass) return;

    const stops      = normalizeStops(this._config);
    const discovered = this._discover();
    const stopNames  = Object.keys(discovered);

    const blocksHtml = stops.map((stop, idx) => {
      const matched  = this._stopNameFor(stop.entities ?? [], discovered);
      const sensors  = matched ? (discovered[matched] ?? []) : [];
      const selected = new Set(stop.entities ?? []);

      // Stop selector options — include all stops (let user pick)
      const opts = ["", ...stopNames].map(n =>
        `<option value="${esc(n)}" ${n === matched ? "selected" : ""}>${n ? esc(n) : "— выбрать остановку —"}</option>`
      ).join("");

      const routeRows = sensors.length
        ? sensors.map(({ id, route, dest }) => `
            <div class="route-row">
              <input type="checkbox" data-stop="${idx}" data-entity="${esc(id)}"
                     ${selected.has(id) ? "checked" : ""}>
              <span class="pill">${esc(route)}</span>
              <span class="route-name">${esc(dest || id)}</span>
            </div>`).join("")
        : `<div class="hint">Выберите остановку выше, чтобы увидеть маршруты</div>`;

      return `
        <div class="stop-block">
          <div class="stop-top">
            <span class="stop-num">Остановка ${idx + 1}</span>
            <button class="btn-remove" data-action="remove" data-idx="${idx}">Удалить ✕</button>
          </div>
          <div class="field">
            <label>Название (отображается на карточке)</label>
            <input type="text" data-action="title" data-idx="${idx}"
                   placeholder="Spre muncă / Acasă / ..."
                   value="${esc(stop.title ?? "")}">
          </div>
          ${stopNames.length ? `
          <div class="field">
            <label>Остановка из интеграции</label>
            <select data-action="pick-stop" data-idx="${idx}">${opts}</select>
          </div>` : `<div class="hint">Интеграция Tranzy не найдена. Сначала добавьте её в Настройки → Устройства и Службы.</div>`}
          <div class="routes-label">Маршруты</div>
          <div class="routes-list">${routeRows}</div>
        </div>`;
    }).join("");

    this._root.innerHTML = `
      <style>${EDITOR_CSS}</style>
      <div class="editor">
        ${blocksHtml}
        <button class="btn-add" data-action="add">+ Добавить остановку</button>
      </div>`;

    // Wire events
    this._root.querySelectorAll("input[type=text]").forEach(el =>
      el.addEventListener("change", () => this._handle(el)));
    this._root.querySelectorAll("select").forEach(el =>
      el.addEventListener("change", () => this._handle(el)));
    this._root.querySelectorAll("input[type=checkbox]").forEach(el =>
      el.addEventListener("change", () => this._handle(el)));
    this._root.querySelectorAll("button").forEach(el =>
      el.addEventListener("click", () => this._handle(el)));
  }

  _handle(el) {
    const action = el.dataset.action;
    const idx    = parseInt(el.dataset.idx ?? "-1");
    const stops  = JSON.parse(JSON.stringify(normalizeStops(this._config)));

    if (action === "title") {
      const v = el.value.trim();
      stops[idx] = { ...stops[idx], ...(v ? { title: v } : {}) };
      if (!v) delete stops[idx].title;

    } else if (action === "pick-stop") {
      const discovered = this._discover();
      const group      = discovered[el.value] ?? [];
      stops[idx] = { ...stops[idx], entities: group.map(s => s.id) };

    } else if (action === "remove") {
      stops.splice(idx, 1);

    } else if (action === "add") {
      stops.push({ entities: [] });

    } else if (el.dataset.entity) {
      const si       = parseInt(el.dataset.stop);
      const eid      = el.dataset.entity;
      let   entities = [...(stops[si].entities ?? [])];
      if (el.checked) { if (!entities.includes(eid)) entities.push(eid); }
      else            { entities = entities.filter(id => id !== eid); }
      stops[si] = { ...stops[si], entities };
    }

    // Always store as stops format; drop legacy entities key
    const newCfg = { ...this._config, stops };
    delete newCfg.entities;
    delete newCfg.title; // title is per-stop now
    this._config = newCfg;

    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
    this._render();
  }
}

// ─── Register ────────────────────────────────────────────────────

customElements.define(CARD_TAG, TranzyChisinauCard);
customElements.define(`${CARD_TAG}-editor`, TranzyChisinauCardEditor);

window.customCards ??= [];
window.customCards.push({
  type:        CARD_TAG,
  name:        "Tranzy Chișinău Transport",
  description: "Panoul de sosiri în timp real · Real-time arrival board for Chișinău",
  preview:     true,
});
