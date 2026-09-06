/*! Centro Bucato Card — card indipendente per una lavatrice O un'asciugatrice.
 *  Grafica realistica (SVG) diversa per tipo, oblò animato, rilevamento fase dal
 *  consumo istantaneo (Ferma/Lavaggio/Centrifuga/Riscaldamento), storico cicli e
 *  costo ricostruiti dallo storico energia di HA. Gira nel browser, indipendente
 *  dal server esterno. Metti due card (kind: lavatrice / kind: asciugatrice) per
 *  avere due controlli separati e spostabili singolarmente.
 */
const CBC_VERSION = "3.1.0";
console.info(`%c CENTRO-BUCATO-CARD %c v${CBC_VERSION} `,
  "color:#06283d;background:#47b5ff;font-weight:700;border-radius:4px 0 0 4px",
  "color:#dff6ff;background:#06283d;border-radius:0 4px 4px 0");

const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

// Impedisce a librerie tipo "hass-swipe-navigation" di leggere un tocco/trascinamento
// dentro questa card come uno swipe di cambio-vista. Ferma la propagazione del gesto
// (senza preventDefault): lo scroll verticale della pagina e i tap sui pulsanti
// continuano a funzionare normalmente.
function stopSwipeNavHijack(el) {
  ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove"].forEach(evt =>
    el.addEventListener(evt, e => e.stopPropagation(), { passive: true }));
}

const CBC_DEFAULTS = {
  lavatrice: { kind: "lavatrice", name: "Lavatrice", power: "sensor.lavatrice_power", energy: "sensor.lavatrice_energy",
    switch: "", soglia: 10, soglia_centrifuga: 300, soglia_riscaldamento: 1500, prezzo_kwh: 0.30, storico_giorni: 14 },
  asciugatrice: { kind: "asciugatrice", name: "Asciugatrice", power: "sensor.asciugatrice_power", energy: "sensor.asciugatrice_energy",
    switch: "", soglia: 10, soglia_riscaldamento: 800, prezzo_kwh: 0.30, storico_giorni: 14 },
};

// Classifica la fase dal consumo istantaneo. Euristica basata su soglie di
// potenza (non è il programma reale della macchina, ma un'ottima stima visiva).
function classifyPhase(kind, p, cfg) {
  if (p == null || p <= (parseFloat(cfg.soglia) || 10)) return { key: "off", label: "Ferma" };
  if (kind === "lavatrice") {
    const sr = parseFloat(cfg.soglia_riscaldamento) || 0;
    const sc = parseFloat(cfg.soglia_centrifuga) || 0;
    if (sr > 0 && p >= sr) return { key: "heat", label: "Riscaldamento acqua" };
    if (sc > 0 && p >= sc) return { key: "spin", label: "Centrifuga" };
    return { key: "wash", label: "Lavaggio / risciacquo" };
  } else {
    const sr = parseFloat(cfg.soglia_riscaldamento) || 0;
    if (sr > 0 && p >= sr) return { key: "heat", label: "Asciugatura (riscaldamento)" };
    return { key: "cool", label: "Ventilazione" };
  }
}

// Etichetta corta per il display a 10 caratteri sul pannello (diverso dal testo
// esteso sotto il nome). "CENTRIFUGA" ci sta esatta, le altre sono abbreviate.
function dispLabelFor(kind, key) {
  if (key === "wash") return "LAVAGGIO";
  if (key === "spin") return "CENTRIFUGA";
  if (key === "heat") return kind === "lavatrice" ? "RISCALDO" : "ASCIUGO";
  if (key === "cool") return "VENTOLA";
  return "IN CORSO";
}

class CentroBucatoCard extends HTMLElement {
  setConfig(config) {
    const kind = (config && config.kind) === "asciugatrice" ? "asciugatrice" : "lavatrice";
    const base = CBC_DEFAULTS[kind];
    this._cfg = Object.assign({}, base, config || {}, { kind });
    if (!config || !config.name) this._cfg.name = base.name;
    this._built = false;
    this._hist = null;
    this._histLoading = false;
    this._histTs = 0;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) { this._build(); this._built = true; this._loadHistory(); }
    this._update();
    if (!this._histLoading && Date.now() - this._histTs > 10 * 60 * 1000) this._loadHistory();
  }

  getCardSize() { return 6; }
  static getConfigElement() { return document.createElement("centro-bucato-card-editor"); }
  static getStubConfig() { return JSON.parse(JSON.stringify(CBC_DEFAULTS.lavatrice)); }

  _num(entity) {
    const s = this._hass && this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }
  _fmt(x) { return (Math.round(x * 100) / 100).toLocaleString("it-IT", { minimumFractionDigits: x < 10 ? 2 : 1, maximumFractionDigits: 2 }); }
  _fmtE(k) { return "≈ " + (k * (parseFloat(this._cfg.prezzo_kwh) || 0)).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  _dkey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  _dlabel(d) { return `${WD[(d.getDay() + 6) % 7]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
  _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---- storico cicli, ricostruito dallo storico energia (recorder statistics) ----
  async _loadHistory() {
    if (!this._hass || !this._cfg.energy) { this._hist = null; return; }
    this._histLoading = true;
    const days = parseInt(this._cfg.storico_giorni) || 14;
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);
    try {
      const res = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(), end_time: now.toISOString(),
        statistic_ids: [this._cfg.energy], period: "hour", types: ["change"],
      });
      const rows = (res && res[this._cfg.energy]) || [];
      this._hist = this._computeCycles(rows);
    } catch (e) {
      this._hist = null;
      console.warn("[centro-bucato-card] storico non disponibile:", e);
    }
    this._histLoading = false;
    this._histTs = Date.now();
    this._update();
  }

  _computeCycles(rows) {
    const NOISE = 0.01; // kWh/ora: sotto questa soglia consideriamo "spenta" (standby)
    const GAP_MERGE_H = 1; // un'ora di pausa in mezzo non spezza il ciclo (es. ammollo)
    const buckets = rows.map(r => ({ t: new Date(r.start), kwh: (r.change && r.change > 0) ? r.change : 0 }))
      .sort((a, b) => a.t - b.t);
    const runs = [];
    let cur = null;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const active = b.kwh > NOISE;
      if (active) {
        if (!cur) cur = { start: b.t, end: new Date(b.t.getTime() + 3600000), kwh: 0 };
        cur.end = new Date(b.t.getTime() + 3600000);
        cur.kwh += b.kwh;
      } else if (cur) {
        const bridged = buckets.slice(i + 1, i + 1 + GAP_MERGE_H).some(x => x.kwh > NOISE);
        if (!bridged) { runs.push(cur); cur = null; }
      }
    }
    if (cur) runs.push(cur);
    const cycles = runs.filter(r => r.kwh > 0.03).map(r => ({
      start: r.start, end: r.end, kwh: Math.round(r.kwh * 1000) / 1000,
      hours: Math.max(1, Math.round((r.end - r.start) / 3600000)),
    })).sort((a, b) => b.start - a.start);
    const daily = {};
    for (const b of buckets) { const k = this._dkey(b.t); daily[k] = (daily[k] || 0) + b.kwh; }
    return { cycles, daily };
  }

  _isOngoing(cycle) { return (Date.now() - cycle.end.getTime()) < 2 * 3600000; }

  // ---- grafica macchina (diversa lavatrice/asciugatrice) --------------------
  _machineSVG() {
    const isWash = this._cfg.kind === "lavatrice";
    const kind = isWash ? "wash" : "dry";
    const accent = isWash ? "#47b5ff" : "#ff8a3d";
    const bodyTint = isWash ? "#eef4fa" : "#faf3ea";
    return `
    <svg viewBox="0 0 200 250" class="cbc-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="body-${kind}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="${bodyTint}"/><stop offset="1" stop-color="#d7dee6"/>
        </linearGradient>
        <linearGradient id="panel-${kind}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f7fafc"/><stop offset="1" stop-color="#dbe3ec"/>
        </linearGradient>
        <radialGradient id="glassrim-${kind}" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.62" stop-color="${isWash ? '#aebdcc' : '#ccb8a4'}"/><stop offset="0.8" stop-color="${isWash ? '#71828f' : '#8f7b68'}"/><stop offset="1" stop-color="#4a4038"/>
        </radialGradient>
        <radialGradient id="glass-${kind}" cx="0.38" cy="0.34" r="0.75">
          <stop offset="0" stop-color="${isWash ? '#3a4d5c' : '#4a3a2c'}"/><stop offset="0.55" stop-color="${isWash ? '#202c36' : '#2c2018'}"/><stop offset="1" stop-color="#10161d"/>
        </radialGradient>
        <radialGradient id="reflect-${kind}" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="rgba(255,255,255,.55)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
        <clipPath id="drumclip-${kind}"><circle cx="100" cy="138" r="50"/></clipPath>
      </defs>

      <rect x="26" y="10" width="148" height="230" rx="16" fill="url(#body-${kind})" stroke="#c2cbd4" stroke-width="1.5"/>
      <rect x="26" y="10" width="148" height="230" rx="16" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1" opacity=".6"/>

      <rect x="38" y="22" width="124" height="34" rx="8" fill="url(#panel-${kind})" stroke="#cfd8e2" stroke-width="1"/>
      <rect x="46" y="30" width="52" height="18" rx="4" fill="#0f1720"/>
      <text x="72" y="43" text-anchor="middle" font-family="monospace" font-size="12" fill="${accent}" data-role="disp">--:--</text>

      ${isWash ? `
      <g>
        <rect x="106" y="28" width="24" height="20" rx="3" fill="#e3edf7" stroke="#b9c9d8" stroke-width="1"/>
        <rect x="109" y="46" width="18" height="2.4" rx="1.2" fill="#9fb3c4"/>
        <path d="M118 32 c3 4 3 7 0 9 c-3 -2 -3 -5 0 -9 z" fill="${accent}" opacity=".85"/>
      </g>
      <circle cx="146" cy="39" r="9" fill="#eef3f8" stroke="#c2ccd6" stroke-width="1.5"/>
      <circle cx="146" cy="39" r="9" fill="url(#reflect-${kind})"/>
      <line x1="146" y1="39" x2="146" y2="32" stroke="#7a8794" stroke-width="2" stroke-linecap="round"/>
      ` : `
      <g>
        <circle cx="118" cy="39" r="11" fill="#eef3f8" stroke="#c2ccd6" stroke-width="1.5"/>
        <path d="M118,39 m-9,0 a9,9 0 0 1 9,-9" stroke="#8fd6ff" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M118,39 m9,0 a9,9 0 0 1 -4.5,7.8" stroke="#ff8a3d" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <line x1="118" y1="39" x2="118" y2="31" stroke="#7a8794" stroke-width="2" stroke-linecap="round" transform="rotate(35 118 39)"/>
      </g>
      <g transform="translate(140,24)"><rect x="0" y="0" width="16" height="8" rx="4" fill="#cfd8e2" stroke="#b7c2ce"/>
        <line x1="3" y1="4" x2="13" y2="4" stroke="#8b98a6" stroke-width="1.2"/></g>
      `}

      <circle cx="100" cy="138" r="64" fill="url(#glassrim-${kind})"/>
      <circle cx="100" cy="138" r="64" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="2"/>
      <circle cx="100" cy="138" r="52" fill="url(#glass-${kind})"/>

      ${isWash ? `
      <g stroke="#8fd6ff" stroke-width="2" opacity=".65" stroke-linecap="round">
        <line x1="158" y1="120" x2="164" y2="120"/><line x1="159" y1="128" x2="164" y2="128"/><line x1="159" y1="136" x2="164" y2="136"/>
      </g>` : ``}

      <g clip-path="url(#drumclip-${kind})">
        <g class="cbc-drum" data-role="drum" style="transform-origin:100px 138px">
          <circle cx="100" cy="138" r="50" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="10"/>
          ${Array.from({ length: 12 }).map((_, i) => { const a = i * 30 * Math.PI / 180; const x1 = 100 + Math.cos(a) * 19, y1 = 138 + Math.sin(a) * 19, x2 = 100 + Math.cos(a) * 48, y2 = 138 + Math.sin(a) * 48; return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(255,255,255,.08)" stroke-width="2"/>`; }).join("")}
          ${Array.from({ length: 24 }).map((_, i) => { const a = i * 15 * Math.PI / 180; const r = 37; const x = 100 + Math.cos(a) * r, y = 138 + Math.sin(a) * r; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="rgba(255,255,255,.10)"/>`; }).join("")}
          <ellipse cx="88" cy="148" rx="20" ry="14" fill="${isWash ? 'rgba(120,180,230,.30)' : 'rgba(255,180,120,.28)'}" class="cbc-cloth"/>
          <ellipse cx="115" cy="130" rx="16" ry="11" fill="${isWash ? 'rgba(200,225,245,.25)' : 'rgba(255,210,170,.24)'}" class="cbc-cloth2"/>
        </g>
        ${isWash ? `
        <g class="cbc-water" data-role="water">
          <path class="cbc-wave" d="M48,164 q13,-8 26,0 t26,0 t26,0 t26,0 v40 h-104 z" fill="rgba(71,181,255,.42)"/>
          <path class="cbc-wave2" d="M48,168 q13,7 26,0 t26,0 t26,0 t26,0 v40 h-104 z" fill="rgba(71,181,255,.28)"/>
        </g>
        <g class="cbc-foam" data-role="foam">
          ${[[80, 166], [95, 170], [110, 164], [122, 169], [70, 171]].map((p, i) => `<circle class="cbc-bub b${i}" cx="${p[0]}" cy="${p[1]}" r="${3 + (i % 3)}" fill="rgba(255,255,255,.5)"/>`).join("")}
        </g>` : `
        <g class="cbc-heat" data-role="heat">
          <circle cx="100" cy="138" r="50" fill="rgba(255,138,61,.10)"/>
          ${[[80, 118], [100, 110], [120, 120]].map((p, i) => `<path class="cbc-vapor v${i}" d="M${p[0]},${p[1]} q6,-10 0,-20 q-6,-10 0,-20" stroke="rgba(255,220,180,.5)" stroke-width="3" fill="none" stroke-linecap="round"/>`).join("")}
        </g>`}
      </g>

      <ellipse cx="82" cy="118" rx="26" ry="16" fill="url(#reflect-${kind})" opacity=".5" transform="rotate(-25 82 118)"/>
      <circle cx="100" cy="138" r="52" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="2"/>
      <rect x="148" y="130" width="10" height="16" rx="4" fill="#cdd6df" stroke="#aeb9c4"/>

      ${isWash ? `
      <rect x="40" y="236" width="10" height="6" rx="2" fill="#b9c2cc"/><rect x="150" y="236" width="10" height="6" rx="2" fill="#b9c2cc"/>
      ` : `
      <g><rect x="55" y="210" width="90" height="16" rx="5" fill="#f2ede6" stroke="#d8cfc2" stroke-width="1.2"/>
        <rect x="94" y="215" width="12" height="4" rx="2" fill="#c7bcac"/>
        <text x="100" y="222" text-anchor="middle" font-size="6" fill="#9c8f7c" font-family="sans-serif">FILTRO</text></g>
      <rect x="40" y="236" width="10" height="6" rx="2" fill="#c9bda8"/><rect x="150" y="236" width="10" height="6" rx="2" fill="#c9bda8"/>
      `}
    </svg>`;
  }

  _build() {
    const isWash = this._cfg.kind === "lavatrice";
    this.innerHTML = `
    <style>
      .cbc{--cbc-panel:rgba(30,38,48,.72);--cbc-stroke:rgba(255,255,255,.09);--cbc-ink:#eaf1f8;--cbc-muted:#93a1b0;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--cbc-ink);padding:6px}
      .cbc *{box-sizing:border-box}
      .cbc-machine{background:var(--cbc-panel);border:1px solid var(--cbc-stroke);border-radius:22px;padding:16px 14px;
        display:flex;flex-direction:column;align-items:center;gap:6px;backdrop-filter:blur(14px);
        box-shadow:0 10px 26px rgba(0,0,0,.35);position:relative;overflow:hidden}
      .cbc-machine::before{content:"";position:absolute;inset:0;border-radius:22px;pointer-events:none;
        background:radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.06),transparent 60%)}
      .cbc-glass-wrap{position:relative;width:100%;max-width:210px;cursor:pointer}
      .cbc-svg{width:100%;height:auto;display:block;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))}
      .cbc-led{position:absolute;top:20px;right:20%;width:9px;height:9px;border-radius:50%;background:#556;
        box-shadow:0 0 0 2px rgba(0,0,0,.2);transition:background .3s}
      .cbc-machine.running .cbc-led{animation:cbc-blink 1.6s infinite}
      .cbc-machine[data-phase="wash"] .cbc-led{background:#47b5ff;box-shadow:0 0 10px #47b5ff,0 0 0 2px rgba(0,0,0,.2)}
      .cbc-machine[data-phase="spin"] .cbc-led{background:#a06bff;box-shadow:0 0 10px #a06bff,0 0 0 2px rgba(0,0,0,.2)}
      .cbc-machine[data-phase="heat"] .cbc-led{background:#ff5442;box-shadow:0 0 10px #ff5442,0 0 0 2px rgba(0,0,0,.2)}
      .cbc-machine[data-phase="cool"] .cbc-led{background:#38e08a;box-shadow:0 0 10px #38e08a,0 0 0 2px rgba(0,0,0,.2)}
      @keyframes cbc-blink{50%{opacity:.35}}
      .cbc-name{font-size:16px;font-weight:800;margin-top:4px}
      .cbc-plugbadge{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;margin-top:5px;
        font-size:10.5px;font-weight:800;letter-spacing:.3px;background:rgba(255,255,255,.06);border:1px solid var(--cbc-stroke);
        color:var(--cbc-muted);cursor:pointer;transition:transform .12s,filter .15s}
      .cbc-plugbadge:hover{transform:translateY(-1px);filter:brightness(1.15)}
      .cbc-plugbadge .dot{width:7px;height:7px;border-radius:50%;background:#5a6572;flex:0 0 auto}
      .cbc-plugbadge[data-plug="on"]{background:rgba(56,224,138,.16);border-color:rgba(56,224,138,.45);color:#8ff0b4;
        animation:cbc-plug-blink 3s ease-in-out infinite}
      .cbc-plugbadge[data-plug="on"] .dot{background:#38e08a;box-shadow:0 0 6px #38e08a}
      .cbc-plugbadge[data-plug="off"]{background:rgba(255,84,66,.10);border-color:rgba(255,84,66,.3);color:#ffb0a3}
      .cbc-plugbadge[data-plug="off"] .dot{background:#ff5442}
      @keyframes cbc-plug-blink{0%,100%{opacity:1}50%{opacity:.55}}
      /* sfondo dell'intera card tinto quando la presa è accesa */
      .cbc-machine{transition:background-color .6s ease,border-color .6s ease}
      .cbc-machine.plug-on{background-color:rgba(56,224,138,.09);border-color:rgba(56,224,138,.28)}
      .cbc-state{font-size:12.5px;font-weight:700;color:var(--cbc-muted);transition:color .3s}
      .cbc-machine[data-phase="wash"] .cbc-state{color:#47b5ff}
      .cbc-machine[data-phase="spin"] .cbc-state{color:#a06bff}
      .cbc-machine[data-phase="heat"] .cbc-state{color:#ff5442}
      .cbc-machine[data-phase="cool"] .cbc-state{color:#38e08a}
      .cbc-metrics{display:flex;gap:14px;margin-top:2px}
      .cbc-metric{font-size:22px;font-weight:850;font-variant-numeric:tabular-nums;line-height:1}
      .cbc-metric small{font-size:10px;color:var(--cbc-muted);font-weight:700;margin-left:2px}
      .cbc-lastcycle{font-size:11.5px;color:var(--cbc-muted);text-align:center;line-height:1.4;margin-top:4px}
      .cbc-lastcycle b{color:var(--cbc-ink);font-weight:800}
      .cbc-lastcycle .eur{color:#ffb020;font-weight:800}
      .cbc-actions{display:flex;flex-direction:column;gap:6px;width:100%;margin-top:10px}
      .cbc-btn{background:rgba(255,255,255,.06);border:1px solid var(--cbc-stroke);color:var(--cbc-ink);
        border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer;width:100%;transition:filter .15s}
      .cbc-btn:hover{filter:brightness(1.25)}
      .cbc-btn-pwr[data-on="1"]{background:linear-gradient(135deg,rgba(71,181,255,.3),rgba(71,181,255,.15));border-color:transparent}
      .cbc-drum{animation:none}
      .cbc-machine.running .cbc-drum{animation:cbc-spin 2.4s linear infinite}
      .cbc-machine[data-phase="spin"] .cbc-drum{animation:cbc-spin .55s linear infinite}
      @keyframes cbc-spin{to{transform:rotate(360deg)}}
      .cbc-water,.cbc-foam,.cbc-heat{opacity:0;transition:opacity .5s}
      .cbc-machine.running .cbc-water,.cbc-machine.running .cbc-foam,.cbc-machine.running .cbc-heat{opacity:1}
      .cbc-wave{animation:none}
      .cbc-machine.running .cbc-wave{animation:cbc-wave 2.2s ease-in-out infinite alternate}
      .cbc-machine.running .cbc-wave2{animation:cbc-wave 2.6s ease-in-out infinite alternate-reverse}
      @keyframes cbc-wave{from{transform:translateX(-8px)}to{transform:translateX(8px)}}
      .cbc-bub{opacity:0}
      .cbc-machine.running .cbc-bub{animation:cbc-bub 2.4s ease-in infinite}
      .cbc-machine.running .cbc-bub.b1{animation-delay:.5s}.cbc-machine.running .cbc-bub.b2{animation-delay:1s}
      .cbc-machine.running .cbc-bub.b3{animation-delay:1.4s}.cbc-machine.running .cbc-bub.b4{animation-delay:.8s}
      @keyframes cbc-bub{0%{opacity:0;transform:translateY(6px)}30%{opacity:.8}100%{opacity:0;transform:translateY(-26px)}}
      .cbc-vapor{opacity:0}
      .cbc-machine.running .cbc-vapor{animation:cbc-vapor 2.6s ease-in-out infinite}
      .cbc-machine.running .cbc-vapor.v1{animation-delay:.6s}.cbc-machine.running .cbc-vapor.v2{animation-delay:1.2s}
      @keyframes cbc-vapor{0%{opacity:0;transform:translateY(6px) scale(.9)}40%{opacity:.7}100%{opacity:0;transform:translateY(-16px) scale(1.1)}}
      .cbc-scrim{position:fixed;inset:0;background:rgba(4,5,8,.62);backdrop-filter:blur(6px);display:flex;
        align-items:center;justify-content:center;padding:22px;z-index:9;opacity:0;pointer-events:none;transition:opacity .18s}
      .cbc-scrim.on{opacity:1;pointer-events:auto}
      .cbc-modal{width:100%;max-width:380px;max-height:80vh;overflow-y:auto;background:#1a1b21;border:1px solid rgba(255,255,255,.16);
        border-radius:24px;padding:20px 18px;box-shadow:0 24px 60px rgba(0,0,0,.6);transform:translateY(14px) scale(.97);transition:transform .2s}
      .cbc-scrim.on .cbc-modal{transform:none}
      .cbc-mh{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
      .cbc-mt{font-size:17px;font-weight:850}
      .cbc-x{width:30px;height:30px;border-radius:50%;border:1px solid var(--cbc-stroke);background:rgba(255,255,255,.05);color:var(--cbc-ink);font-size:15px;cursor:pointer;flex:0 0 auto}
      .cbc-tabs{display:flex;gap:8px;margin-bottom:12px}
      .cbc-tab{flex:1;text-align:center;padding:8px;border-radius:10px;font-size:12px;font-weight:800;cursor:pointer;
        background:rgba(255,255,255,.05);border:1px solid var(--cbc-stroke);color:var(--cbc-muted)}
      .cbc-tab.sel{background:linear-gradient(135deg,rgba(71,181,255,.25),rgba(71,181,255,.12));color:var(--cbc-ink);border-color:transparent}
      .cbc-mchart{display:flex;align-items:flex-end;gap:3px;height:80px;margin-bottom:16px}
      .cbc-mcol{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:3px}
      .cbc-mbar{width:100%;max-width:14px;border-radius:3px 3px 1px 1px;min-height:2px;background:linear-gradient(180deg,#47b5ff,#2a86c9)}
      .cbc-mhl{font-size:7.5px;color:var(--cbc-muted);font-weight:700}
      .cbc-clist{display:flex;flex-direction:column;gap:8px}
      .cbc-crow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;
        background:rgba(255,255,255,.04);border-radius:12px;border:1px solid var(--cbc-stroke)}
      .cbc-crow .cd{font-size:12.5px;font-weight:700}
      .cbc-crow .ch{font-size:10.5px;color:var(--cbc-muted);margin-top:1px}
      .cbc-crow .cv{text-align:right;font-size:13px;font-weight:850;font-variant-numeric:tabular-nums}
      .cbc-crow .cv small{display:block;font-size:10px;color:#ffb020;font-weight:700}
      .cbc-empty{color:var(--cbc-muted);font-size:13px;text-align:center;padding:20px 0}
      @media(prefers-reduced-motion:reduce){.cbc *{animation:none!important}}
    </style>
    <div class="cbc">
      <div class="cbc-machine" data-kind="${isWash ? 'wash' : 'dry'}">
        <div class="cbc-glass-wrap" data-role="tap">${this._machineSVG()}<div class="cbc-led" data-role="led"></div></div>
        <div class="cbc-name">${this._esc(this._cfg.name)}</div>
        <div class="cbc-plugbadge" data-role="plugbadge" hidden><span class="dot"></span><span class="lbl">—</span></div>
        <div class="cbc-state" data-role="state">—</div>
        <div class="cbc-metrics"><div class="cbc-metric"><span data-role="power">–</span><small>W</small></div></div>
        <div class="cbc-lastcycle" data-role="lastcycle" hidden></div>
        <div class="cbc-actions">
          <button class="cbc-btn" data-role="histbtn">📜 Storico e costi</button>
        </div>
      </div>
    </div>`;
    stopSwipeNavHijack(this.querySelector(".cbc"));
    this._el = this.querySelector(".cbc-machine");
    this.querySelector('[data-role="tap"]').onclick = () => this._openHistory();
    this.querySelector('[data-role="histbtn"]').onclick = () => this._openHistory();
    const badge = this.querySelector('[data-role="plugbadge"]');
    badge.onclick = e => { e.stopPropagation(); this._togglePower(); };
  }

  _togglePower() {
    if (this._cfg.switch && this._hass.states[this._cfg.switch]) {
      this._hass.callService("switch", "toggle", { entity_id: this._cfg.switch });
    }
  }

  _update() {
    if (!this._el) return;
    const p = this._num(this._cfg.power);
    const phase = classifyPhase(this._cfg.kind, p, this._cfg);
    const running = phase.key !== "off";
    this._el.classList.toggle("running", running);
    this._el.dataset.phase = phase.key;
    this._el.querySelector('[data-role="state"]').textContent = phase.label;
    this._el.querySelector('[data-role="power"]').textContent = p != null ? Math.round(p) : "–";
    const sw = this._cfg.switch && this._hass.states[this._cfg.switch];
    // Display: se la presa è spenta non ha senso dire "PRONTA" (non lo è, è staccata) →
    // "SPENTA". Presa accesa e ferma → "PRONTA". Presa accesa e in un programma →
    // il nome della fase (es. "CENTRIFUGA").
    const disp = this._el.querySelector('[data-role="disp"]');
    if (disp) {
      if (sw && sw.state !== "on") disp.textContent = "SPENTA";
      else if (!running) disp.textContent = "PRONTA";
      else disp.textContent = dispLabelFor(this._cfg.kind, phase.key);
    }
    // Badge = comando: stato REALE della presa (fatto, non stima), separato dalla
    // fase — la presa può essere accesa anche a macchina ferma (in attesa). Tocco
    // il badge per accendere/spegnere; quando è acceso lampeggia piano e lo sfondo
    // della card si tinge, così si capisce a colpo d'occhio senza leggere il testo.
    const badge = this._el.querySelector('[data-role="plugbadge"]');
    if (sw) {
      badge.hidden = false;
      const plugOn = sw.state === "on";
      badge.dataset.plug = plugOn ? "on" : "off";
      badge.querySelector(".lbl").textContent = plugOn ? "Presa accesa" : "Presa spenta";
      this._el.classList.toggle("plug-on", plugOn);
    } else {
      badge.hidden = true;
      this._el.classList.remove("plug-on");
    }
    const lc = this._el.querySelector('[data-role="lastcycle"]');
    const hist = this._hist;
    if (hist && hist.cycles && hist.cycles.length) {
      const last = running ? hist.cycles.find(c => !this._isOngoing(c)) : hist.cycles[0];
      if (last) {
        lc.hidden = false;
        lc.innerHTML = `Ultimo ciclo: <b>~${last.hours}h</b> · <b>${this._fmt(last.kwh)} kWh</b> · <span class="eur">${this._fmtE(last.kwh)}</span>`;
      } else lc.hidden = true;
    } else lc.hidden = true;
  }

  _openHistory() {
    const hist = this._hist, cfg = this._cfg;
    let ov = this.querySelector(".cbc-scrim");
    if (!ov) { ov = document.createElement("div"); ov.className = "cbc-scrim"; this.querySelector(".cbc").appendChild(ov); }
    if (!cfg.energy) {
      ov.innerHTML = `<div class="cbc-modal"><div class="cbc-mh"><div class="cbc-mt">${this._esc(cfg.name)}</div><button class="cbc-x">✕</button></div>
        <div class="cbc-empty">Configura un sensore di energia (nell'editor della card) per vedere storico e grafico.</div></div>`;
      requestAnimationFrame(() => ov.classList.add("on"));
      ov.querySelector(".cbc-x").onclick = () => ov.classList.remove("on");
      ov.onclick = e => { if (e.target === ov) ov.classList.remove("on"); };
      return;
    }
    let period = "7";
    const render = () => {
      const daily = (hist && hist.daily) || {};
      const days = parseInt(period);
      const today = new Date();
      const bars = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400000);
        bars.push({ label: this._dlabel(d), v: daily[this._dkey(d)] || 0 });
      }
      const mx = Math.max(...bars.map(b => b.v), 0.05);
      const totKwh = bars.reduce((a, b) => a + b.v, 0);
      const chartHTML = bars.map((b, i) => {
        const hp = Math.max(2, Math.round(b.v / mx * 100));
        const showLbl = days <= 7 || i % Math.ceil(days / 7) === 0;
        return `<div class="cbc-mcol"><div class="cbc-mbar" style="height:${hp}%"></div>
          <div class="cbc-mhl">${showLbl ? b.label.split(" ")[1] : ""}</div></div>`;
      }).join("");
      const cycles = (hist && hist.cycles) || [];
      const listHTML = cycles.length ? cycles.slice(0, 10).map(c => `
        <div class="cbc-crow"><div><div class="cd">${this._dlabel(c.start)}, ${String(c.start.getHours()).padStart(2, "0")}:00</div>
          <div class="ch">durata ~${c.hours}h</div></div>
          <div class="cv">${this._fmt(c.kwh)} kWh<small>${this._fmtE(c.kwh)}</small></div></div>`).join("")
        : `<div class="cbc-empty">Nessun ciclo rilevato negli ultimi ${cfg.storico_giorni} giorni.</div>`;
      ov.innerHTML = `<div class="cbc-modal">
        <div class="cbc-mh"><div><div class="cbc-mt">${this._esc(cfg.name)}</div>
          <div style="font-size:11.5px;color:var(--cbc-muted);margin-top:2px">${this._fmt(totKwh)} kWh negli ultimi ${days} giorni · ${this._fmtE(totKwh)}</div></div>
          <button class="cbc-x">✕</button></div>
        <div class="cbc-tabs">
          <div class="cbc-tab${period === "7" ? " sel" : ""}" data-p="7">7 giorni</div>
          <div class="cbc-tab${period === "30" ? " sel" : ""}" data-p="30">30 giorni</div>
        </div>
        <div class="cbc-mchart">${chartHTML}</div>
        <div style="font-size:12px;font-weight:800;margin-bottom:8px;color:var(--cbc-ink)">📜 Cicli recenti</div>
        <div class="cbc-clist">${listHTML}</div>
      </div>`;
      ov.querySelector(".cbc-x").onclick = () => ov.classList.remove("on");
      ov.querySelectorAll(".cbc-tab").forEach(t => t.onclick = () => { period = t.dataset.p; render(); });
    };
    render();
    requestAnimationFrame(() => ov.classList.add("on"));
    ov.onclick = e => { if (e.target === ov) ov.classList.remove("on"); };
  }
}
customElements.define("centro-bucato-card", CentroBucatoCard);

// ===========================================================================
// Editor
// ===========================================================================
class CentroBucatoCardEditor extends HTMLElement {
  setConfig(config) {
    const kind = (config && config.kind) === "asciugatrice" ? "asciugatrice" : "lavatrice";
    this._config = Object.assign({}, CBC_DEFAULTS[kind], config || {}, { kind });
    this._render();
  }
  set hass(h) { this._hass = h; if (!this._done && h) { this._done = true; this._render(); } }

  _emit() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
  _set(key, val) { this._config = Object.assign({}, this._config, { [key]: val }); this._emit(); }

  _opts(domainPrefixes, sel) {
    const hs = this._hass ? this._hass.states : {};
    const ids = Object.keys(hs).filter(id => domainPrefixes.some(p => id.startsWith(p))).sort();
    let out = `<option value=""${!sel ? " selected" : ""}>— nessuno —</option>`;
    for (const id of ids) {
      const fn = (hs[id].attributes && hs[id].attributes.friendly_name) || id;
      out += `<option value="${id}"${id === sel ? " selected" : ""}>${fn}</option>`;
    }
    if (sel && !ids.includes(sel)) out += `<option value="${sel}" selected>${sel}</option>`;
    return out;
  }

  _render() {
    const c = this._config;
    const isWash = c.kind === "lavatrice";
    this.innerHTML = `<style>
      .cbe{display:flex;flex-direction:column;gap:14px;padding:6px 2px;font-family:inherit}
      .cbe .fld{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .cbe label{font-size:13px;font-weight:600;color:var(--primary-text-color)}
      .cbe .h{font-size:11px;color:var(--secondary-text-color)}
      .cbe input,.cbe select{padding:10px 11px;border-radius:8px;font-size:15px;font-family:inherit;
        border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
      .cbe .row{display:flex;gap:12px}.cbe .row>.fld{flex:1}
      .cbe .note{font-size:11.5px;color:var(--secondary-text-color);line-height:1.5;margin-top:4px}
    </style>
    <div class="cbe">
      <div class="fld"><label>Tipo macchina</label>
        <select id="f_kind"><option value="lavatrice"${isWash ? " selected" : ""}>🌀 Lavatrice</option>
          <option value="asciugatrice"${!isWash ? " selected" : ""}>🔥 Asciugatrice</option></select></div>
      <div class="fld"><label>Nome</label><input type="text" id="f_name" value="${(c.name || "").replace(/"/g, "&quot;")}"></div>
      <div class="fld"><label>Sensore potenza (W)</label><select id="f_power">${this._opts(["sensor."], c.power)}</select></div>
      <div class="fld"><label>Sensore energia (kWh) — per storico/costo</label><select id="f_energy">${this._opts(["sensor."], c.energy)}</select></div>
      <div class="fld"><label>Presa/interruttore — opzionale</label><select id="f_switch">${this._opts(["switch.", "input_boolean."], c.switch)}</select></div>
      <div class="fld"><label>Soglia "in funzione" (W)</label><input type="number" min="1" max="500" id="f_soglia" value="${c.soglia || 10}"></div>
      ${isWash ? `
      <div class="row">
        <div class="fld"><label>Soglia centrifuga (W)</label><span class="h">0 = disattiva</span>
          <input type="number" min="0" max="3000" id="f_sc" value="${c.soglia_centrifuga || 0}"></div>
        <div class="fld"><label>Soglia riscaldamento (W)</label><span class="h">0 = disattiva</span>
          <input type="number" min="0" max="3000" id="f_sr" value="${c.soglia_riscaldamento || 0}"></div>
      </div>` : `
      <div class="fld"><label>Soglia riscaldamento (W)</label><span class="h">sopra = "in riscaldamento", 0 = disattiva</span>
        <input type="number" min="0" max="3000" id="f_sr" value="${c.soglia_riscaldamento || 0}"></div>`}
      <div class="row">
        <div class="fld"><label>Prezzo energia (€/kWh)</label>
          <input type="number" step="0.01" min="0" max="5" id="f_price" value="${c.prezzo_kwh}"></div>
        <div class="fld"><label>Storico (giorni)</label>
          <select id="f_days"><option value="7"${c.storico_giorni == 7 ? " selected" : ""}>7 giorni</option>
            <option value="14"${c.storico_giorni == 14 ? " selected" : ""}>14 giorni</option>
            <option value="30"${c.storico_giorni == 30 ? " selected" : ""}>30 giorni</option></select></div>
      </div>
      <div class="note">💡 Le soglie di fase sono una STIMA dal consumo: guarda i watt reali durante un ciclo (Storico → oppure "Sviluppatori → Stati") e regola qui i valori che separano meglio lavaggio/centrifuga/riscaldamento sulla tua macchina.</div>
    </div>`;
    const on = (id, ev, fn) => { const el = this.querySelector(id); if (el) el.addEventListener(ev, fn); };
    on("#f_kind", "change", e => { this._set("kind", e.target.value); });
    on("#f_name", "input", e => this._set("name", e.target.value));
    on("#f_power", "change", e => this._set("power", e.target.value));
    on("#f_energy", "change", e => this._set("energy", e.target.value));
    on("#f_switch", "change", e => this._set("switch", e.target.value));
    on("#f_soglia", "change", e => this._set("soglia", parseInt(e.target.value) || 10));
    on("#f_sc", "change", e => this._set("soglia_centrifuga", parseInt(e.target.value) || 0));
    on("#f_sr", "change", e => this._set("soglia_riscaldamento", parseInt(e.target.value) || 0));
    on("#f_price", "change", e => this._set("prezzo_kwh", parseFloat(String(e.target.value).replace(",", ".")) || 0.30));
    on("#f_days", "change", e => this._set("storico_giorni", parseInt(e.target.value) || 14));
  }
}
customElements.define("centro-bucato-card-editor", CentroBucatoCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "centro-bucato-card",
  name: "Centro Bucato Card",
  description: "Card indipendente per lavatrice o asciugatrice: fase dal consumo, storico e costo.",
  preview: true,
  documentationURL: "https://github.com/cristianwebonline/ha-centro-bucato-card",
});
