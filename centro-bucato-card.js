/*! Centro Bucato Card — centro di controllo lavatrice + asciugatrice per Home Assistant.
 *  Grafica realistica e DISTINTA per ogni macchina (SVG), oblò che gira, acqua/schiuma
 *  e vapore animati, storico cicli e costo ricostruiti dallo storico energia di HA
 *  (nessun helper nuovo da creare). Gira nel browser → indipendente dal server esterno.
 */
const CBC_VERSION = "2.0.0";
console.info(`%c CENTRO-BUCATO-CARD %c v${CBC_VERSION} `,
  "color:#06283d;background:#47b5ff;font-weight:700;border-radius:4px 0 0 4px",
  "color:#dff6ff;background:#06283d;border-radius:0 4px 4px 0");

const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const CBC_DEFAULT = {
  type: "custom:centro-bucato-card",
  title: "Lavatoio",
  prezzo_kwh: 0.30,
  storico_giorni: 14,
  lavatrice: { name: "Lavatrice", power: "sensor.lavatrice_power", energy: "sensor.lavatrice_energy", switch: "", soglia: 10 },
  asciugatrice: { name: "Asciugatrice", power: "sensor.asciugatrice_power", energy: "sensor.asciugatrice_energy", switch: "", soglia: 10 },
};

class CentroBucatoCard extends HTMLElement {
  setConfig(config) {
    this._cfg = {
      title: (config && config.title) || "Lavatoio",
      prezzo_kwh: (config && config.prezzo_kwh != null) ? config.prezzo_kwh : 0.30,
      storico_giorni: (config && config.storico_giorni) || 14,
      lavatrice: Object.assign({}, CBC_DEFAULT.lavatrice, (config && config.lavatrice) || {}),
      asciugatrice: Object.assign({}, CBC_DEFAULT.asciugatrice, (config && config.asciugatrice) || {}),
    };
    this._built = false;
    this._hist = { lavatrice: null, asciugatrice: null };
    this._histLoading = false;
    this._histTs = 0;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) { this._build(); this._built = true; this._loadHistory(); }
    this._update();
    // ricarica lo storico ogni 10 minuti (non ad ogni tick di stato)
    if (!this._histLoading && Date.now() - this._histTs > 10 * 60 * 1000) this._loadHistory();
  }

  disconnectedCallback() { if (this._histTimer) clearTimeout(this._histTimer); }

  getCardSize() { return 7; }
  static getConfigElement() { return document.createElement("centro-bucato-card-editor"); }
  static getStubConfig() { return JSON.parse(JSON.stringify(CBC_DEFAULT)); }

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
    if (!this._hass) return;
    this._histLoading = true;
    const days = parseInt(this._cfg.storico_giorni) || 14;
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);
    for (const kind of ["lavatrice", "asciugatrice"]) {
      const m = this._cfg[kind];
      if (!m.energy) { this._hist[kind] = null; continue; }
      try {
        const res = await this._hass.callWS({
          type: "recorder/statistics_during_period",
          start_time: start.toISOString(), end_time: now.toISOString(),
          statistic_ids: [m.energy], period: "hour", types: ["change"],
        });
        const rows = (res && res[m.energy]) || [];
        this._hist[kind] = this._computeCycles(rows);
      } catch (e) {
        this._hist[kind] = null;
        console.warn("[centro-bucato-card] storico non disponibile per", kind, e);
      }
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

  // ---- grafica macchina ------------------------------------------------------
  _machineHTML(kind, m) {
    const isWash = kind === "wash";
    return `
    <div class="cbc-machine" data-kind="${kind}">
      <div class="cbc-glass-wrap" data-role="tap">
        ${this._machineSVG(kind)}
        <div class="cbc-led" data-role="led"></div>
      </div>
      <div class="cbc-info">
        <div class="cbc-name">${this._esc(m.name)}</div>
        <div class="cbc-state" data-role="state">—</div>
        <div class="cbc-metrics">
          <div class="cbc-metric"><span class="cbc-w" data-role="power">–</span><small>W</small></div>
        </div>
        <div class="cbc-lastcycle" data-role="lastcycle" hidden></div>
        <div class="cbc-actions">
          <button class="cbc-btn cbc-btn-hist" data-role="histbtn">📜 Storico e costi</button>
          <button class="cbc-btn cbc-btn-pwr" data-role="btn" hidden></button>
        </div>
      </div>
    </div>`;
  }

  // Disegno SVG realistico — DIVERSO per lavatrice (cassetto detersivo, tacche
  // livello acqua, LED blu) e asciugatrice (sportellino filtro lanugine in basso,
  // sfiato posteriore, manopola temperatura, vetro ambrato).
  _machineSVG(kind) {
    const isWash = kind === "wash";
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

      <!-- corpo -->
      <rect x="26" y="10" width="148" height="230" rx="16" fill="url(#body-${kind})" stroke="#c2cbd4" stroke-width="1.5"/>
      <rect x="26" y="10" width="148" height="230" rx="16" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1" opacity=".6"/>

      <!-- pannello comandi -->
      <rect x="38" y="22" width="124" height="34" rx="8" fill="url(#panel-${kind})" stroke="#cfd8e2" stroke-width="1"/>
      <rect x="46" y="30" width="52" height="18" rx="4" fill="#0f1720"/>
      <text x="72" y="43" text-anchor="middle" font-family="monospace" font-size="12" fill="${accent}" data-role="disp">--:--</text>

      ${isWash ? `
      <!-- LAVATRICE: cassetto detersivo (blu, con goccia) -->
      <g data-role="drawer">
        <rect x="106" y="28" width="24" height="20" rx="3" fill="#e3edf7" stroke="#b9c9d8" stroke-width="1"/>
        <rect x="109" y="46" width="18" height="2.4" rx="1.2" fill="#9fb3c4"/>
        <path d="M118 32 c3 4 3 7 0 9 c-3 -2 -3 -5 0 -9 z" fill="${accent}" opacity=".85"/>
      </g>
      <!-- manopola -->
      <circle cx="146" cy="39" r="9" fill="#eef3f8" stroke="#c2ccd6" stroke-width="1.5"/>
      <circle cx="146" cy="39" r="9" fill="url(#reflect-${kind})"/>
      <line x1="146" y1="39" x2="146" y2="32" stroke="#7a8794" stroke-width="2" stroke-linecap="round"/>
      ` : `
      <!-- ASCIUGATRICE: manopola temperatura grande con settori colore, sfiato -->
      <g>
        <circle cx="118" cy="39" r="11" fill="#eef3f8" stroke="#c2ccd6" stroke-width="1.5"/>
        <path d="M118,39 m-9,0 a9,9 0 0 1 9,-9" stroke="#8fd6ff" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M118,39 m9,0 a9,9 0 0 1 -4.5,7.8" stroke="#ff8a3d" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <line x1="118" y1="39" x2="118" y2="31" stroke="#7a8794" stroke-width="2" stroke-linecap="round" transform="rotate(35 118 39)"/>
      </g>
      <!-- sfogo/vent posteriore -->
      <g transform="translate(140,24)"><rect x="0" y="0" width="16" height="8" rx="4" fill="#cfd8e2" stroke="#b7c2ce"/>
        <line x1="3" y1="4" x2="13" y2="4" stroke="#8b98a6" stroke-width="1.2"/></g>
      `}

      <!-- ghiera oblò -->
      <circle cx="100" cy="138" r="64" fill="url(#glassrim-${kind})"/>
      <circle cx="100" cy="138" r="64" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="2"/>
      <circle cx="100" cy="138" r="52" fill="url(#glass-${kind})"/>

      ${isWash ? `
      <!-- tacche livello acqua (solo lavatrice), sul bordo destro della ghiera -->
      <g stroke="#8fd6ff" stroke-width="2" opacity=".65" stroke-linecap="round">
        <line x1="158" y1="120" x2="164" y2="120"/><line x1="159" y1="128" x2="164" y2="128"/><line x1="159" y1="136" x2="164" y2="136"/>
      </g>` : ``}

      <!-- interno cestello (ruota) -->
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
      <!-- LAVATRICE: piedini semplici -->
      <rect x="40" y="236" width="10" height="6" rx="2" fill="#b9c2cc"/><rect x="150" y="236" width="10" height="6" rx="2" fill="#b9c2cc"/>
      ` : `
      <!-- ASCIUGATRICE: sportellino filtro lanugine, in basso -->
      <g data-role="lint">
        <rect x="55" y="210" width="90" height="16" rx="5" fill="#f2ede6" stroke="#d8cfc2" stroke-width="1.2"/>
        <rect x="94" y="215" width="12" height="4" rx="2" fill="#c7bcac"/>
        <text x="100" y="222" text-anchor="middle" font-size="6" fill="#9c8f7c" font-family="sans-serif">FILTRO</text>
      </g>
      <rect x="40" y="236" width="10" height="6" rx="2" fill="#c9bda8"/><rect x="150" y="236" width="10" height="6" rx="2" fill="#c9bda8"/>
      `}
    </svg>`;
  }

  // ---- shell / stili -----------------------------------------------------------
  _build() {
    this.innerHTML = `
    <style>
      .cbc{--cbc-bg:rgba(20,26,33,.6);--cbc-panel:rgba(30,38,48,.72);--cbc-stroke:rgba(255,255,255,.09);
        --cbc-ink:#eaf1f8;--cbc-muted:#93a1b0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
        color:var(--cbc-ink);display:flex;flex-direction:column;gap:14px;padding:6px}
      .cbc *{box-sizing:border-box}
      .cbc-head{display:flex;align-items:center;gap:10px;padding:2px 4px}
      .cbc-head .t{font-size:18px;font-weight:850;letter-spacing:-.2px}
      .cbc-head .ico{font-size:20px}
      .cbc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      @media(max-width:430px){.cbc-grid{grid-template-columns:1fr}}
      .cbc-machine{background:var(--cbc-panel);border:1px solid var(--cbc-stroke);border-radius:22px;padding:14px 12px;
        display:flex;flex-direction:column;align-items:center;gap:6px;backdrop-filter:blur(14px);
        box-shadow:0 10px 26px rgba(0,0,0,.35);position:relative;overflow:hidden}
      .cbc-machine::before{content:"";position:absolute;inset:0;border-radius:22px;pointer-events:none;
        background:radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.06),transparent 60%)}
      .cbc-glass-wrap{position:relative;width:100%;max-width:200px;cursor:pointer}
      .cbc-svg{width:100%;height:auto;display:block;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))}
      .cbc-led{position:absolute;top:20px;right:20%;width:9px;height:9px;border-radius:50%;background:#556;box-shadow:0 0 0 2px rgba(0,0,0,.2)}
      .cbc-machine.running .cbc-led{background:#38e08a;box-shadow:0 0 10px #38e08a,0 0 0 2px rgba(0,0,0,.2);animation:cbc-blink 1.6s infinite}
      @keyframes cbc-blink{50%{opacity:.35}}
      .cbc-name{font-size:15px;font-weight:800;margin-top:2px}
      .cbc-state{font-size:12px;font-weight:700;color:var(--cbc-muted)}
      .cbc-machine.running .cbc-state{color:#38e08a}
      .cbc-metrics{display:flex;gap:14px;margin-top:2px}
      .cbc-metric{font-size:20px;font-weight:850;font-variant-numeric:tabular-nums;line-height:1}
      .cbc-metric small{font-size:10px;color:var(--cbc-muted);font-weight:700;margin-left:2px}
      .cbc-lastcycle{font-size:11.5px;color:var(--cbc-muted);text-align:center;line-height:1.4;margin-top:2px}
      .cbc-lastcycle b{color:var(--cbc-ink);font-weight:800}
      .cbc-lastcycle .eur{color:#ffb020;font-weight:800}
      .cbc-actions{display:flex;flex-direction:column;gap:6px;width:100%;margin-top:8px}
      .cbc-btn{background:rgba(255,255,255,.06);border:1px solid var(--cbc-stroke);color:var(--cbc-ink);
        border-radius:12px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;width:100%;transition:filter .15s}
      .cbc-btn:hover{filter:brightness(1.25)}
      .cbc-btn-pwr[data-on="1"]{background:linear-gradient(135deg,rgba(71,181,255,.3),rgba(71,181,255,.15));border-color:transparent}
      /* animazioni */
      .cbc-drum{animation:none}
      .cbc-machine.running .cbc-drum{animation:cbc-spin 2.4s linear infinite}
      .cbc-machine.running[data-kind="dry"] .cbc-drum{animation-duration:3.2s}
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
      /* modal storico */
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
      <div class="cbc-head"><span class="ico">🧺</span><span class="t">${this._esc(this._cfg.title)}</span></div>
      <div class="cbc-grid">
        ${this._machineHTML("wash", this._cfg.lavatrice)}
        ${this._machineHTML("dry", this._cfg.asciugatrice)}
      </div>
    </div>`;
    const machines = this.querySelectorAll(".cbc-machine");
    this._m = [
      { el: machines[0], kind: "lavatrice", cfg: this._cfg.lavatrice },
      { el: machines[1], kind: "asciugatrice", cfg: this._cfg.asciugatrice },
    ];
    for (const { el, kind, cfg } of this._m) {
      el.querySelector('[data-role="tap"]').onclick = () => this._openHistory(kind, cfg);
      el.querySelector('[data-role="histbtn"]').onclick = () => this._openHistory(kind, cfg);
      el.querySelector('[data-role="btn"]').onclick = () => this._togglePower(cfg);
    }
  }

  _togglePower(cfg) {
    if (cfg.switch && this._hass.states[cfg.switch]) {
      this._hass.callService("switch", "toggle", { entity_id: cfg.switch });
    }
  }

  _update() {
    if (!this._m) return;
    for (const { el, kind, cfg } of this._m) {
      const p = this._num(cfg.power);
      const running = p != null && p > (parseFloat(cfg.soglia) || 10);
      el.classList.toggle("running", running);
      const sw = cfg.switch && this._hass.states[cfg.switch];
      const on = running || (sw && sw.state === "on");
      el.querySelector('[data-role="state"]').textContent =
        running ? "In funzione" : (sw ? (sw.state === "on" ? "Accesa · attesa" : "Spenta") : "Ferma");
      el.querySelector('[data-role="power"]').textContent = p != null ? Math.round(p) : "–";
      const disp = el.querySelector('[data-role="disp"]');
      if (disp) disp.textContent = running ? "IN CORSO" : "PRONTA";
      const btn = el.querySelector('[data-role="btn"]');
      if (cfg.switch) {
        btn.hidden = false;
        btn.textContent = on ? "🔌 Spegni presa" : "🔌 Accendi presa";
        btn.dataset.on = on ? "1" : "0";
      } else btn.hidden = true;
      // ultimo ciclo completato (costo visibile sulla card, non solo nel modal)
      const lc = el.querySelector('[data-role="lastcycle"]');
      const hist = this._hist[kind];
      if (hist && hist.cycles && hist.cycles.length) {
        const last = running ? hist.cycles.find(c => !this._isOngoing(c)) : hist.cycles[0];
        if (last) {
          lc.hidden = false;
          lc.innerHTML = `Ultimo ciclo: <b>~${last.hours}h</b> · <b>${this._fmt(last.kwh)} kWh</b> · <span class="eur">${this._fmtE(last.kwh)}</span>`;
        } else lc.hidden = true;
      } else lc.hidden = true;
    }
  }

  _isOngoing(cycle) { return (Date.now() - cycle.end.getTime()) < 2 * 3600000; }

  // ---- modal storico + grafico -------------------------------------------------
  _openHistory(kind, cfg) {
    const hist = this._hist[kind];
    let ov = this.querySelector(".cbc-scrim");
    if (!ov) { ov = document.createElement("div"); ov.className = "cbc-scrim"; this.querySelector(".cbc").appendChild(ov); }
    if (!cfg.energy) {
      ov.innerHTML = `<div class="cbc-modal"><div class="cbc-mh"><div class="cbc-mt">${this._esc(cfg.name)}</div><button class="cbc-x">✕</button></div>
        <div class="cbc-empty">Configura un sensore di energia per questa macchina (nell'editor della card) per vedere storico e grafico.</div></div>`;
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
        : `<div class="cbc-empty">Nessun ciclo rilevato negli ultimi ${this._cfg.storico_giorni} giorni.</div>`;
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
    this._config = {
      title: (config && config.title) || "Lavatoio",
      prezzo_kwh: (config && config.prezzo_kwh != null) ? config.prezzo_kwh : 0.30,
      storico_giorni: (config && config.storico_giorni) || 14,
      lavatrice: Object.assign({}, CBC_DEFAULT.lavatrice, (config && config.lavatrice) || {}),
      asciugatrice: Object.assign({}, CBC_DEFAULT.asciugatrice, (config && config.asciugatrice) || {}),
    };
    this._render();
  }
  set hass(h) { this._hass = h; if (!this._done && h) { this._done = true; this._render(); } }

  _emit() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
  _setTop(key, val) { this._config = Object.assign({}, this._config, { [key]: val }); this._emit(); }
  _setM(machine, key, val) { this._config[machine] = Object.assign({}, this._config[machine], { [key]: val }); this._emit(); }

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

  _machineFields(machine, label) {
    const m = this._config[machine];
    return `<div class="grp"><div class="grp-t">${label}</div>
      <div class="fld"><label>Nome</label><input type="text" data-m="${machine}" data-k="name" value="${(m.name || "").replace(/"/g, "&quot;")}"></div>
      <div class="fld"><label>Sensore potenza (W)</label><select data-m="${machine}" data-k="power">${this._opts(["sensor."], m.power)}</select></div>
      <div class="fld"><label>Sensore energia (kWh) — per storico/costo</label><select data-m="${machine}" data-k="energy">${this._opts(["sensor."], m.energy)}</select></div>
      <div class="fld"><label>Presa/interruttore — opzionale</label><select data-m="${machine}" data-k="switch">${this._opts(["switch.", "input_boolean."], m.switch)}</select></div>
      <div class="fld"><label>Soglia "in funzione" (W)</label><input type="number" min="1" max="500" data-m="${machine}" data-k="soglia" value="${m.soglia || 10}"></div>
    </div>`;
  }

  _render() {
    if (!this._config) return;
    this.innerHTML = `<style>
      .cbe{display:flex;flex-direction:column;gap:14px;padding:6px 2px;font-family:inherit}
      .cbe .fld{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .cbe label{font-size:13px;font-weight:600;color:var(--primary-text-color)}
      .cbe .h{font-size:11px;color:var(--secondary-text-color)}
      .cbe input,.cbe select{padding:10px 11px;border-radius:8px;font-size:15px;font-family:inherit;
        border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
      .cbe .row{display:flex;gap:12px}.cbe .row>.fld{flex:1}
      .cbe .grp{border:1px solid var(--divider-color);border-radius:12px;padding:10px 12px 12px;margin-top:6px}
      .cbe .grp-t{font-size:13px;font-weight:800;color:var(--primary-color);text-transform:uppercase;letter-spacing:.5px}
      .cbe .note{font-size:11.5px;color:var(--secondary-text-color);line-height:1.5}
    </style>
    <div class="cbe">
      <div class="fld"><label>Titolo</label><input type="text" data-top="title" value="${(this._config.title || "").replace(/"/g, "&quot;")}"></div>
      <div class="row">
        <div class="fld"><label>Prezzo energia (€/kWh)</label>
          <input type="number" step="0.01" min="0" max="5" data-top="prezzo_kwh" value="${this._config.prezzo_kwh}"></div>
        <div class="fld"><label>Storico (giorni)</label>
          <select data-top="storico_giorni">
            <option value="7"${this._config.storico_giorni == 7 ? " selected" : ""}>7 giorni</option>
            <option value="14"${this._config.storico_giorni == 14 ? " selected" : ""}>14 giorni</option>
            <option value="30"${this._config.storico_giorni == 30 ? " selected" : ""}>30 giorni</option>
          </select></div>
      </div>
      ${this._machineFields("lavatrice", "🌀 Lavatrice")}
      ${this._machineFields("asciugatrice", "🔥 Asciugatrice")}
      <div class="note">Storico e costo per ciclo vengono ricostruiti dallo storico energia già presente in Home Assistant (nessun dato nuovo da configurare altrove). Tocca l'oblò o "Storico e costi" sulla card per vedere il dettaglio.</div>
    </div>`;
    this.querySelector('[data-top="title"]').addEventListener("input", e => this._setTop("title", e.target.value));
    this.querySelector('[data-top="prezzo_kwh"]').addEventListener("change", e => this._setTop("prezzo_kwh", parseFloat(String(e.target.value).replace(",", ".")) || 0.30));
    this.querySelector('[data-top="storico_giorni"]').addEventListener("change", e => this._setTop("storico_giorni", parseInt(e.target.value) || 14));
    this.querySelectorAll("[data-m]").forEach(el => {
      const ev = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(ev, e => {
        let v = e.target.value;
        if (el.dataset.k === "soglia") v = parseInt(v) || 10;
        this._setM(el.dataset.m, el.dataset.k, v);
      });
    });
  }
}
customElements.define("centro-bucato-card-editor", CentroBucatoCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "centro-bucato-card",
  name: "Centro Bucato Card",
  description: "Centro controllo lavatrice e asciugatrice: grafica realistica, storico cicli e costo.",
  preview: true,
  documentationURL: "https://github.com/cristianwebonline/ha-centro-bucato-card",
});
