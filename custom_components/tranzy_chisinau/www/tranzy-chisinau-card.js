// ═══════════════════════════════════════════════════════════════
//  Tranzy Chișinău Transport — Custom Lovelace Card  v1.0.0
//  Real-time bus & trolleybus arrival board for Home Assistant
// ═══════════════════════════════════════════════════════════════

const CARD_TAG     = "tranzy-chisinau-card";
const CARD_VERSION = "0.1.7";
const DSEG7_URL    = "https://cdn.jsdelivr.net/npm/dseg@0.46.0/fonts/DSEG7-Classic/DSEG7Classic-Regular.woff2";

// Identify Tranzy route sensors by attribute (entity_id format is not reliable)
const isTranzyRoute = state => state?.attributes?.tranzy_sensor === "route";

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
      if (!isTranzyRoute(state)) continue;
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
.field label { font-size: 11px; color: var(--secondary-text-color, #888); letter-spacing: 0.5px; }
.field input[type=text], .field select {
  padding: 9px 11px;
  border: 1px solid var(--divider-color, rgba(255,255,255,0.18));
  border-radius: 6px;
  background: var(--card-background-color, #1a1a1a);
  color: var(--primary-text-color, #e0e0e0);
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
}

.routes-label { font-size: 11px; color: var(--secondary-text-color, #888); letter-spacing: 0.5px; }
.routes-list { display: flex; flex-direction: column; gap: 2px; }

.route-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 6px; border-radius: 6px; cursor: pointer; transition: background 0.1s;
}
.route-row:hover { background: rgba(255,179,0,0.04); }
.route-row input[type=checkbox] { width: 16px; height: 16px; accent-color: #FFB300; cursor: pointer; flex-shrink: 0; }

.pill {
  background: rgba(255,179,0,0.1); color: #FFB300;
  border-radius: 4px; padding: 2px 8px; font-size: 12px;
  font-family: monospace; font-weight: 700; min-width: 34px; text-align: center; flex-shrink: 0;
}
.route-name { font-size: 13px; color: var(--primary-text-color, #ccc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hint { font-size: 12px; color: var(--secondary-text-color, #888); font-style: italic; padding: 4px 0; }

.btn-add {
  width: 100%; padding: 11px;
  border: 1px dashed rgba(255,179,0,0.28); border-radius: 8px;
  background: rgba(255,179,0,0.03); color: rgba(255,179,0,0.6);
  font-size: 13px; letter-spacing: 1px; cursor: pointer; transition: all 0.15s;
}
.btn-add:hover { background: rgba(255,179,0,0.07); border-color: rgba(255,179,0,0.45); color: #FFB300; }

/* ── Wizard ─────────────────────────────────────── */
.wizard {
  border: 1px solid rgba(255,179,0,0.3);
  border-radius: 10px;
  padding: 16px;
  background: rgba(255,179,0,0.04);
  display: flex; flex-direction: column; gap: 12px;
}
.wiz-title {
  font-size: 10px; font-weight: 700; letter-spacing: 2px;
  text-transform: uppercase; color: rgba(255,179,0,0.7); font-family: monospace;
}
.wiz-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.btn-geo {
  padding: 10px 14px; border-radius: 7px; cursor: pointer; font-size: 13px;
  background: rgba(255,179,0,0.12); border: 1px solid rgba(255,179,0,0.35);
  color: #FFB300; transition: all 0.15s; white-space: nowrap;
}
.btn-geo:hover { background: rgba(255,179,0,0.2); }
.btn-geo:disabled { opacity: 0.4; cursor: default; }

.wiz-input {
  padding: 9px 11px; border-radius: 6px; font-size: 13px;
  border: 1px solid var(--divider-color, rgba(255,255,255,0.18));
  background: var(--card-background-color, #1a1a1a);
  color: var(--primary-text-color, #e0e0e0);
  width: 120px; box-sizing: border-box;
}
.btn-search {
  padding: 9px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
  background: rgba(255,179,0,0.15); border: 1px solid rgba(255,179,0,0.4);
  color: #FFB300; white-space: nowrap;
}
.btn-search:hover { background: rgba(255,179,0,0.25); }

.wiz-divider { font-size: 11px; color: var(--secondary-text-color, #777); padding: 2px 0; }

.stop-option {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 8px; border-radius: 7px; cursor: pointer;
  border: 1px solid transparent; transition: all 0.1s;
}
.stop-option:hover { background: rgba(255,179,0,0.04); border-color: rgba(255,179,0,0.1); }
.stop-option input[type=radio] { accent-color: #FFB300; width: 16px; height: 16px; flex-shrink: 0; }
.stop-name { font-size: 14px; color: var(--primary-text-color, #e0e0e0); flex: 1; }
.stop-dist { font-size: 11px; color: var(--secondary-text-color, #888); white-space: nowrap; }

.route-group-label {
  font-size: 10px; font-weight: 700; letter-spacing: 2px;
  text-transform: uppercase; color: var(--secondary-text-color, #888);
  padding: 8px 0 4px; font-family: monospace;
}

.wiz-actions { display: flex; gap: 8px; margin-top: 4px; }
.btn-next {
  flex: 1; padding: 10px; border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 600;
  background: rgba(255,179,0,0.15); border: 1px solid rgba(255,179,0,0.4); color: #FFB300;
  transition: all 0.15s;
}
.btn-next:hover { background: rgba(255,179,0,0.25); }
.btn-next:disabled { opacity: 0.35; cursor: default; }
.btn-cancel {
  padding: 10px 14px; border-radius: 7px; cursor: pointer; font-size: 13px;
  background: transparent; border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
  color: var(--secondary-text-color, #888);
}
.btn-cancel:hover { color: var(--primary-text-color, #ccc); }

.wiz-status { font-size: 13px; color: var(--secondary-text-color, #888); font-style: italic; }
.wiz-error { font-size: 13px; color: #ff6b6b; }
.wiz-success { font-size: 13px; color: #00cc66; font-weight: 600; }
`;

class TranzyChisinauCardEditor extends HTMLElement {
  constructor() {
    super();
    this._root   = this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass   = null;
    // Wizard state: null | 'location' | 'searching' | 'stops' | 'routes' | 'saving' | 'done' | 'error'
    this._wiz      = null;
    this._wizData  = {};
  }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config));
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Don't re-render while user is actively typing (focused input)
    const active = this._root.activeElement;
    if (!active || active.tagName === "SELECT" || active.type === "checkbox" || active.type === "radio") {
      this._render();
    }
  }

  _discover() {
    const groups = {};
    for (const [id, state] of Object.entries(this._hass?.states ?? {})) {
      if (!isTranzyRoute(state)) continue;
      const stop  = state.attributes.stop_name ?? "Unknown";
      const route = state.attributes.route     ?? id;
      const dest  = state.attributes.route_long_name
        ? state.attributes.route_long_name.split(" - ").pop().trim() : "";
      if (!groups[stop]) groups[stop] = [];
      groups[stop].push({ id, route, dest });
    }
    for (const g of Object.values(groups))
      g.sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
    return groups;
  }

  _stopNameFor(entities, discovered) {
    for (const [name, sensors] of Object.entries(discovered))
      if (entities.some(id => sensors.some(s => s.id === id))) return name;
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

      const opts = ["", ...stopNames].map(n =>
        `<option value="${esc(n)}" ${n === matched ? "selected" : ""}>${n ? esc(n) : "— выбрать —"}</option>`
      ).join("");

      const routeRows = sensors.length
        ? sensors.map(({ id, route, dest }) => `
            <div class="route-row">
              <input type="checkbox" data-stop="${idx}" data-entity="${esc(id)}"
                     ${selected.has(id) ? "checked" : ""}>
              <span class="pill">${esc(route)}</span>
              <span class="route-name">${esc(dest || id)}</span>
            </div>`).join("")
        : `<div class="hint">Выберите остановку выше чтобы увидеть маршруты</div>`;

      return `
        <div class="stop-block">
          <div class="stop-top">
            <span class="stop-num">Остановка ${idx + 1}</span>
            <button class="btn-remove" data-action="remove" data-idx="${idx}">Удалить ✕</button>
          </div>
          <div class="field">
            <label>Название в карточке</label>
            <input type="text" data-action="title" data-idx="${idx}"
                   placeholder="Spre muncă / Acasă / ..."
                   value="${esc(stop.title ?? "")}">
          </div>
          ${stopNames.length ? `
          <div class="field">
            <label>Остановка из интеграции</label>
            <select data-action="pick-stop" data-idx="${idx}">${opts}</select>
          </div>` : ""}
          <div class="routes-label">Маршруты</div>
          <div class="routes-list">${routeRows}</div>
        </div>`;
    }).join("");

    const wizHtml = this._renderWizard();

    this._root.innerHTML = `
      <style>${EDITOR_CSS}</style>
      <div class="editor">
        ${blocksHtml}
        ${wizHtml || `<button class="btn-add" data-action="open-wiz">+ Добавить остановку</button>`}
      </div>`;

    this._wireExisting();
    this._wireWizard();
  }

  // ── Existing stops wiring ─────────────────────────────────────
  _wireExisting() {
    this._root.querySelectorAll("[data-action=title]").forEach(el =>
      el.addEventListener("change", () => this._handle(el)));
    this._root.querySelectorAll("[data-action=pick-stop]").forEach(el =>
      el.addEventListener("change", () => this._handle(el)));
    this._root.querySelectorAll("[data-action=remove]").forEach(el =>
      el.addEventListener("click", () => this._handle(el)));
    this._root.querySelectorAll("[data-action=open-wiz]").forEach(el =>
      el.addEventListener("click", () => { this._wiz = "location"; this._wizData = {}; this._render(); }));
    this._root.querySelectorAll("input[type=checkbox][data-entity]").forEach(el =>
      el.addEventListener("change", () => this._handle(el)));
  }

  _handle(el) {
    const action = el.dataset.action;
    const idx    = parseInt(el.dataset.idx ?? "-1");
    const stops  = JSON.parse(JSON.stringify(normalizeStops(this._config)));

    if (action === "title") {
      const v = el.value.trim();
      stops[idx] = { ...stops[idx] };
      if (v) stops[idx].title = v; else delete stops[idx].title;
    } else if (action === "pick-stop") {
      const group = this._discover()[el.value] ?? [];
      stops[idx] = { ...stops[idx], entities: group.map(s => s.id) };
    } else if (action === "remove") {
      stops.splice(idx, 1);
    } else if (el.dataset.entity) {
      const si  = parseInt(el.dataset.stop);
      const eid = el.dataset.entity;
      let ents  = [...(stops[si].entities ?? [])];
      if (el.checked) { if (!ents.includes(eid)) ents.push(eid); }
      else            { ents = ents.filter(id => id !== eid); }
      stops[si] = { ...stops[si], entities: ents };
    }

    this._saveStops(stops);
    this._render();
  }

  _saveStops(stops) {
    const cfg = { ...this._config, stops };
    delete cfg.entities;
    delete cfg.title;
    this._config = cfg;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: cfg }, bubbles: true, composed: true,
    }));
  }

  // ── Wizard ────────────────────────────────────────────────────
  _renderWizard() {
    if (!this._wiz) return "";

    const d = this._wizData;

    if (this._wiz === "location") {
      return `
        <div class="wizard">
          <div class="wiz-title">➕ Новая остановка — шаг 1: место</div>
          <div class="wiz-row">
            <button class="btn-geo" id="wiz-geo">📍 Моё местоположение</button>
          </div>
          <div class="wiz-divider">или введите координаты вручную:</div>
          <div class="wiz-row">
            <input class="wiz-input" id="wiz-lat" type="number" step="0.0001"
                   placeholder="Широта (47.01)" value="${d.lat ?? ""}">
            <input class="wiz-input" id="wiz-lon" type="number" step="0.0001"
                   placeholder="Долгота (28.86)" value="${d.lon ?? ""}">
            <button class="btn-search" id="wiz-search">Найти →</button>
          </div>
          <div class="wiz-actions">
            <button class="btn-cancel" id="wiz-cancel">Отмена</button>
          </div>
        </div>`;
    }

    if (this._wiz === "searching") {
      return `
        <div class="wizard">
          <div class="wiz-title">➕ Новая остановка</div>
          <div class="wiz-status">🔍 Ищу ближайшие остановки…</div>
        </div>`;
    }

    if (this._wiz === "stops") {
      const stopsHtml = (d.stops ?? []).map(s => `
        <label class="stop-option">
          <input type="radio" name="wiz-stop" value="${s.stop_id}"
                 data-lat="${s.stop_lat}" data-lon="${s.stop_lon}"
                 data-name="${esc(s.stop_name)}"
                 ${d.selectedStop?.stop_id === s.stop_id ? "checked" : ""}>
          <span class="stop-name">${esc(s.stop_name)}</span>
          <span class="stop-dist">${s.distance_m} м</span>
        </label>`).join("");

      return `
        <div class="wizard">
          <div class="wiz-title">➕ Новая остановка — шаг 2: остановка</div>
          ${stopsHtml}
          <div class="wiz-actions">
            <button class="btn-cancel" id="wiz-cancel">Отмена</button>
            <button class="btn-next" id="wiz-next-stop" ${d.selectedStop ? "" : "disabled"}>
              Выбрать маршруты →
            </button>
          </div>
        </div>`;
    }

    if (this._wiz === "routes") {
      const routes = d.routes ?? [];
      const selRoutes = new Set(d.selectedRoutes ?? []);
      const sortKey = r => String(r.route_short_name ?? "").padStart(4, "0");

      const troll = routes.filter(r => r.route_type === 11).sort((a,b) => sortKey(a).localeCompare(sortKey(b)));
      const bus   = routes.filter(r => r.route_type === 3).sort((a,b) => sortKey(a).localeCompare(sortKey(b)));
      const other = routes.filter(r => r.route_type !== 11 && r.route_type !== 3).sort((a,b) => sortKey(a).localeCompare(sortKey(b)));

      const makeRows = (list, emoji) => list.map(r => {
        const rid  = String(r.route_id);
        const long = r.route_long_name ? r.route_long_name.split(" - ").pop().trim() : "";
        return `
          <div class="route-row">
            <input type="checkbox" class="wiz-route-cb" value="${esc(rid)}"
                   ${selRoutes.has(rid) ? "checked" : ""}>
            <span class="pill">${esc(emoji)} ${esc(String(r.route_short_name ?? rid))}</span>
            <span class="route-name">${esc(long)}</span>
          </div>`;
      }).join("");

      const trollHtml = troll.length ? `<div class="route-group-label">🚎 Троллейбусы</div>${makeRows(troll, "🚎")}` : "";
      const busHtml   = bus.length   ? `<div class="route-group-label">🚌 Автобусы</div>${makeRows(bus, "🚌")}` : "";
      const otherHtml = other.length ? `<div class="route-group-label">🚐 Прочие</div>${makeRows(other, "🚐")}` : "";

      return `
        <div class="wizard">
          <div class="wiz-title">➕ ${esc(d.selectedStop?.stop_name ?? "")} — шаг 3: маршруты</div>
          ${trollHtml}${busHtml}${otherHtml}
          <div class="wiz-actions">
            <button class="btn-cancel" id="wiz-back">← Назад</button>
            <button class="btn-next" id="wiz-confirm" ${selRoutes.size ? "" : "disabled"}>
              Добавить остановку ✓
            </button>
          </div>
        </div>`;
    }

    if (this._wiz === "saving") {
      return `
        <div class="wizard">
          <div class="wiz-title">➕ Новая остановка</div>
          <div class="wiz-status">💾 Сохраняю…</div>
        </div>`;
    }

    if (this._wiz === "done") {
      return `
        <div class="wizard">
          <div class="wiz-success">✓ Остановка добавлена! Обновите страницу если маршруты не появились.</div>
          <div class="wiz-actions">
            <button class="btn-next" id="wiz-done-ok">Готово</button>
          </div>
        </div>`;
    }

    if (this._wiz === "error") {
      return `
        <div class="wizard">
          <div class="wiz-error">⚠ ${esc(d.error ?? "Неизвестная ошибка")}</div>
          <div class="wiz-actions">
            <button class="btn-cancel" id="wiz-cancel">Закрыть</button>
            <button class="btn-next" id="wiz-retry">Попробовать снова</button>
          </div>
        </div>`;
    }

    return "";
  }

  _wireWizard() {
    const $ = id => this._root.getElementById(id);

    $("wiz-cancel")?.addEventListener("click", () => { this._wiz = null; this._render(); });
    $("wiz-retry")?.addEventListener("click",  () => { this._wiz = "location"; this._wizData = {}; this._render(); });
    $("wiz-back")?.addEventListener("click",   () => { this._wiz = "stops"; this._render(); });
    $("wiz-done-ok")?.addEventListener("click", () => { this._wiz = null; this._render(); });

    // Step 1: geolocation
    $("wiz-geo")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        this._wizData.error = "Геолокация не поддерживается браузером";
        this._wiz = "error"; this._render(); return;
      }
      const btn = $("wiz-geo");
      if (btn) btn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        pos => this._findStops(pos.coords.latitude, pos.coords.longitude),
        ()  => { this._wizData.error = "Не удалось получить местоположение"; this._wiz = "error"; this._render(); },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });

    $("wiz-search")?.addEventListener("click", () => {
      const lat = parseFloat(this._root.getElementById("wiz-lat")?.value);
      const lon = parseFloat(this._root.getElementById("wiz-lon")?.value);
      if (isNaN(lat) || isNaN(lon)) return;
      this._findStops(lat, lon);
    });

    // Step 2: stop radio buttons
    this._root.querySelectorAll("input[name=wiz-stop]").forEach(rb => {
      rb.addEventListener("change", () => {
        this._wizData.selectedStop = {
          stop_id: parseInt(rb.value),
          stop_name: rb.dataset.name,
          stop_lat: parseFloat(rb.dataset.lat),
          stop_lon: parseFloat(rb.dataset.lon),
        };
        this._root.getElementById("wiz-next-stop")?.removeAttribute("disabled");
      });
    });

    $("wiz-next-stop")?.addEventListener("click", () => {
      if (!this._wizData.selectedStop) return;
      this._wiz = "routes";
      this._wizData.selectedRoutes = [];
      this._render();
    });

    // Step 3: route checkboxes
    this._root.querySelectorAll(".wiz-route-cb").forEach(cb => {
      cb.addEventListener("change", () => {
        const checked = [...this._root.querySelectorAll(".wiz-route-cb:checked")].map(c => c.value);
        this._wizData.selectedRoutes = checked;
        const btn = this._root.getElementById("wiz-confirm");
        if (btn) btn.disabled = checked.length === 0;
      });
    });

    $("wiz-confirm")?.addEventListener("click", () => this._addStop());
  }

  async _findStops(lat, lon) {
    this._wizData.lat = lat;
    this._wizData.lon = lon;
    this._wiz = "searching";
    this._render();

    try {
      const result = await this._hass.callWS({
        type: "tranzy_chisinau/find_stops",
        lat, lon,
      });
      this._wizData.stops  = result.stops;
      this._wizData.routes = result.routes;
      this._wizData.selectedStop   = null;
      this._wizData.selectedRoutes = [];
      this._wiz = "stops";
    } catch (e) {
      this._wizData.error = String(e?.message ?? e);
      this._wiz = "error";
    }
    this._render();
  }

  async _addStop() {
    const { selectedStop, selectedRoutes } = this._wizData;
    if (!selectedStop || !selectedRoutes?.length) return;

    this._wiz = "saving";
    this._render();

    try {
      await this._hass.callWS({
        type:       "tranzy_chisinau/add_stop",
        stop_id:    selectedStop.stop_id,
        stop_name:  selectedStop.stop_name,
        stop_lat:   selectedStop.stop_lat,
        stop_lon:   selectedStop.stop_lon,
        routes:     selectedRoutes,
      });
      this._wiz = "done";

      // Auto-add new stop to card config after a short delay
      setTimeout(() => {
        const newEntities = Object.entries(this._hass.states)
          .filter(([, s]) => isTranzyRoute(s) && s.attributes.stop_name === selectedStop.stop_name)
          .map(([id]) => id);

        const stops = JSON.parse(JSON.stringify(normalizeStops(this._config)));
        stops.push({
          title: selectedStop.stop_name,
          entities: newEntities.filter(id =>
            selectedRoutes.some(rid => id.includes(rid.replace(/\D/g, "")))
          ).length ? newEntities : newEntities,
        });
        this._saveStops(stops);
        this._render();
      }, 3000);

    } catch (e) {
      this._wizData.error = String(e?.message ?? e);
      this._wiz = "error";
      this._render();
    }
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
