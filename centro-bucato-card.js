/*! Centro Bucato Card — centro di controllo lavatrice + asciugatrice per Home Assistant.
 *  Grafica realistica (SVG), oblò che gira, acqua/schiuma e vapore animati.
 *  Gira nel browser, legge/comanda le entità via hass → indipendente dal server esterno.
 *  Modificabile: editor visuale nativo (scegli entità, nomi, soglie).
 */
const CBC_VERSION = "1.0.0";
console.info(`%c CENTRO-BUCATO-CARD %c v${CBC_VERSION} `,
  "color:#06283d;background:#47b5ff;font-weight:700;border-radius:4px 0 0 4px",
  "color:#dff6ff;background:#06283d;border-radius:0 4px 4px 0");

const CBC_DEFAULT = {
  type: "custom:centro-bucato-card",
  title: "Lavatoio",
  lavatrice: { name: "Lavatrice", power: "sensor.lavatrice_power", energy: "sensor.lavatrice_energy", switch: "", soglia: 10 },
  asciugatrice: { name: "Asciugatrice", power: "sensor.asciugatrice_power", energy: "sensor.asciugatrice_energy", switch: "", soglia: 10 },
};

class CentroBucatoCard extends HTMLElement {
  setConfig(config) {
    this._cfg = {
      title: (config && config.title) || "Lavatoio",
      lavatrice: Object.assign({}, CBC_DEFAULT.lavatrice, (config && config.lavatrice) || {}),
      asciugatrice: Object.assign({}, CBC_DEFAULT.asciugatrice, (config && config.asciugatrice) || {}),
    };
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) { this._build(); this._built = true; }
    this._update();
  }

  getCardSize() { return 6; }
  static getConfigElement() { return document.createElement("centro-bucato-card-editor"); }
  static getStubConfig() { return JSON.parse(JSON.stringify(CBC_DEFAULT)); }

  _num(entity) {
    const s = this._hass && this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }

  _machineHTML(kind, m) {
    // kind: "wash" | "dry"
    const isWash = kind === "wash";
    const accent = isWash ? "#47b5ff" : "#ff8a3d";
    return `
    <div class="cbc-machine" data-kind="${kind}">
      <div class="cbc-glass-wrap">
        ${this._machineSVG(kind, accent)}
        <div class="cbc-led" data-role="led"></div>
      </div>
      <div class="cbc-info">
        <div class="cbc-name">${this._esc(m.name)}</div>
        <div class="cbc-state" data-role="state">—</div>
        <div class="cbc-metrics">
          <div class="cbc-metric"><span class="cbc-w" data-role="power">–</span><small>W</small></div>
          <div class="cbc-metric cbc-en"><span data-role="energy">–</span><small>kWh</small></div>
        </div>
        <button class="cbc-btn" data-role="btn">Dettagli</button>
      </div>
    </div>`;
  }

  // Disegno realistico della macchina (SVG). L'oblò e le animazioni sono comandate
  // da classi CSS aggiunte in _update (.running).
  _machineSVG(kind, accent) {
    const isWash = kind === "wash";
    return `
    <svg viewBox="0 0 200 240" class="cbc-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="body-${kind}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#eef2f6"/><stop offset="1" stop-color="#d7dee6"/>
        </linearGradient>
        <linearGradient id="panel-${kind}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f7fafc"/><stop offset="1" stop-color="#dbe3ec"/>
        </linearGradient>
        <radialGradient id="glassrim-${kind}" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.62" stop-color="#b8c2cc"/><stop offset="0.8" stop-color="#7b8794"/><stop offset="1" stop-color="#525c66"/>
        </radialGradient>
        <radialGradient id="glass-${kind}" cx="0.38" cy="0.34" r="0.75">
          <stop offset="0" stop-color="#3a4652"/><stop offset="0.55" stop-color="#222c36"/><stop offset="1" stop-color="#10161d"/>
        </radialGradient>
        <radialGradient id="reflect-${kind}" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="rgba(255,255,255,.55)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
        <clipPath id="drumclip-${kind}"><circle cx="100" cy="140" r="52"/></clipPath>
      </defs>

      <!-- corpo -->
      <rect x="26" y="10" width="148" height="222" rx="16" fill="url(#body-${kind})" stroke="#c2cbd4" stroke-width="1.5"/>
      <rect x="26" y="10" width="148" height="222" rx="16" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1" opacity=".6"/>

      <!-- pannello comandi -->
      <rect x="38" y="22" width="124" height="34" rx="8" fill="url(#panel-${kind})" stroke="#cfd8e2" stroke-width="1"/>
      <!-- display -->
      <rect x="46" y="30" width="52" height="18" rx="4" fill="#0f1720"/>
      <text x="72" y="43" text-anchor="middle" font-family="monospace" font-size="12" fill="${accent}" class="cbc-disp" data-role="disp">--:--</text>
      <!-- cassetto detersivo (solo lavatrice) o griglia (asciugatrice) -->
      ${isWash
        ? `<rect x="106" y="30" width="20" height="18" rx="3" fill="#e8eef4" stroke="#cbd5df"/><rect x="109" y="35" width="14" height="3" rx="1.5" fill="#b7c2cd"/>`
        : `<g stroke="#c3ccd6" stroke-width="2">${[0,1,2,3].map(i=>`<line x1="106" y1="${33+i*4}" x2="126" y2="${33+i*4}"/>`).join("")}</g>`}
      <!-- manopola -->
      <circle cx="146" cy="39" r="9" fill="#eef3f8" stroke="#c2ccd6" stroke-width="1.5"/>
      <circle cx="146" cy="39" r="9" fill="url(#reflect-${kind})"/>
      <line x1="146" y1="39" x2="146" y2="32" stroke="#7a8794" stroke-width="2" stroke-linecap="round" class="cbc-knob"/>

      <!-- ghiera oblò -->
      <circle cx="100" cy="140" r="66" fill="url(#glassrim-${kind})"/>
      <circle cx="100" cy="140" r="66" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="2"/>
      <!-- vetro scuro -->
      <circle cx="100" cy="140" r="54" fill="url(#glass-${kind})"/>

      <!-- interno cestello (ruota) -->
      <g clip-path="url(#drumclip-${kind})">
        <g class="cbc-drum" data-role="drum" style="transform-origin:100px 140px">
          <circle cx="100" cy="140" r="52" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="10"/>
          ${Array.from({length:12}).map((_,i)=>{const a=i*30*Math.PI/180;const x1=100+Math.cos(a)*20,y1=140+Math.sin(a)*20,x2=100+Math.cos(a)*50,y2=140+Math.sin(a)*50;return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(255,255,255,.08)" stroke-width="2"/>`}).join("")}
          <!-- fori cestello -->
          ${Array.from({length:24}).map((_,i)=>{const a=i*15*Math.PI/180;const r=38;const x=100+Math.cos(a)*r,y=140+Math.sin(a)*r;return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="rgba(255,255,255,.10)"/>`}).join("")}
          <!-- panni -->
          <ellipse cx="88" cy="150" rx="20" ry="14" fill="${isWash?'rgba(120,180,230,.30)':'rgba(255,180,120,.28)'}" class="cbc-cloth"/>
          <ellipse cx="115" cy="132" rx="16" ry="11" fill="${isWash?'rgba(200,225,245,.25)':'rgba(255,210,170,.24)'}" class="cbc-cloth2"/>
        </g>
        ${isWash ? `
        <!-- acqua -->
        <g class="cbc-water" data-role="water">
          <path class="cbc-wave" d="M48,166 q13,-8 26,0 t26,0 t26,0 t26,0 v40 h-104 z" fill="rgba(71,181,255,.42)"/>
          <path class="cbc-wave2" d="M48,170 q13,7 26,0 t26,0 t26,0 t26,0 v40 h-104 z" fill="rgba(71,181,255,.28)"/>
        </g>
        <!-- schiuma -->
        <g class="cbc-foam" data-role="foam">
          ${[[80,168],[95,172],[110,166],[122,171],[70,173]].map((p,i)=>`<circle class="cbc-bub b${i}" cx="${p[0]}" cy="${p[1]}" r="${3+ (i%3)}" fill="rgba(255,255,255,.5)"/>`).join("")}
        </g>` : `
        <!-- calore/vapore -->
        <g class="cbc-heat" data-role="heat">
          <circle cx="100" cy="140" r="52" fill="rgba(255,138,61,.10)"/>
          ${[[80,120],[100,112],[120,122]].map((p,i)=>`<path class="cbc-vapor v${i}" d="M${p[0]},${p[1]} q6,-10 0,-20 q-6,-10 0,-20" stroke="rgba(255,220,180,.5)" stroke-width="3" fill="none" stroke-linecap="round"/>`).join("")}
        </g>`}
      </g>

      <!-- riflesso vetro -->
      <ellipse cx="82" cy="120" rx="26" ry="16" fill="url(#reflect-${kind})" opacity=".5" transform="rotate(-25 82 120)"/>
      <circle cx="100" cy="140" r="54" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="2"/>
      <!-- maniglia oblò -->
      <rect x="150" y="132" width="10" height="16" rx="4" fill="#cdd6df" stroke="#aeb9c4"/>
    </svg>`;
  }

  _esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

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
      .cbc-glass-wrap{position:relative;width:100%;max-width:210px}
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
      .cbc-en{color:var(--cbc-muted);font-size:15px}
      .cbc-btn{margin-top:8px;background:rgba(255,255,255,.06);border:1px solid var(--cbc-stroke);color:var(--cbc-ink);
        border-radius:12px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;width:100%;transition:filter .15s}
      .cbc-btn:hover{filter:brightness(1.25)}
      .cbc-machine.on .cbc-btn{background:linear-gradient(135deg,rgba(71,181,255,.3),rgba(71,181,255,.15));border-color:transparent}
      /* animazioni: attive solo con .running */
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
      @media(prefers-reduced-motion:reduce){.cbc *{animation:none!important}}
    </style>
    <div class="cbc">
      <div class="cbc-head"><span class="ico">🧺</span><span class="t">${this._esc(this._cfg.title)}</span></div>
      <div class="cbc-grid">
        ${this._machineHTML("wash", this._cfg.lavatrice)}
        ${this._machineHTML("dry", this._cfg.asciugatrice)}
      </div>
    </div>`;
    // eventi
    const machines = this.querySelectorAll(".cbc-machine");
    machines[0].querySelector('[data-role="btn"]').onclick = () => this._action(this._cfg.lavatrice);
    machines[1].querySelector('[data-role="btn"]').onclick = () => this._action(this._cfg.asciugatrice);
    machines[0].querySelector(".cbc-glass-wrap").onclick = () => this._action(this._cfg.lavatrice);
    machines[1].querySelector(".cbc-glass-wrap").onclick = () => this._action(this._cfg.asciugatrice);
    this._m = [
      { el: machines[0], cfg: this._cfg.lavatrice },
      { el: machines[1], cfg: this._cfg.asciugatrice },
    ];
  }

  _action(m) {
    if (m.switch && this._hass.states[m.switch]) {
      this._hass.callService("switch", "toggle", { entity_id: m.switch });
    } else {
      const eid = m.power || m.energy;
      if (eid) this.dispatchEvent(new CustomEvent("hass-more-info",
        { detail: { entityId: eid }, bubbles: true, composed: true }));
    }
  }

  _update() {
    if (!this._m) return;
    for (const { el, cfg } of this._m) {
      const p = this._num(cfg.power);
      const running = p != null && p > (parseFloat(cfg.soglia) || 10);
      el.classList.toggle("running", running);
      const sw = cfg.switch && this._hass.states[cfg.switch];
      const on = running || (sw && sw.state === "on");
      el.classList.toggle("on", !!on);
      el.querySelector('[data-role="state"]').textContent =
        running ? "In funzione" : (sw ? (sw.state === "on" ? "Accesa · attesa" : "Spenta") : "Ferma");
      el.querySelector('[data-role="power"]').textContent = p != null ? Math.round(p) : "–";
      const e = this._num(cfg.energy);
      el.querySelector('[data-role="energy"]').textContent =
        e != null ? e.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : "–";
      const btn = el.querySelector('[data-role="btn"]');
      btn.textContent = cfg.switch ? (on ? "Spegni presa" : "Accendi presa") : "Dettagli";
      const disp = el.querySelector('[data-role="disp"]');
      if (disp) disp.textContent = running ? "IN CORSO" : "PRONTA";
    }
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
      lavatrice: Object.assign({}, CBC_DEFAULT.lavatrice, (config && config.lavatrice) || {}),
      asciugatrice: Object.assign({}, CBC_DEFAULT.asciugatrice, (config && config.asciugatrice) || {}),
    };
    this._render();
  }
  set hass(h) { this._hass = h; if (!this._done && h) { this._done = true; this._render(); } }

  _emit() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
  _setM(machine, key, val) { this._config[machine] = Object.assign({}, this._config[machine], { [key]: val }); this._emit(); }

  _opts(domainPrefixes, sel) {
    const hs = this._hass ? this._hass.states : {};
    const ids = Object.keys(hs).filter(id => domainPrefixes.some(p => id.startsWith(p))).sort();
    let out = `<option value=""${!sel ? " selected" : ""}>— nessuno —</option>`;
    for (const id of ids) {
      const fn = (hs[id].attributes && hs[id].attributes.friendly_name) || id;
      out += `<option value="${id}"${id === sel ? " selected" : ""}>${fn}</option>`;
    }
    // se il valore configurato non è tra gli stati (offline), mostralo comunque
    if (sel && !ids.includes(sel)) out += `<option value="${sel}" selected>${sel}</option>`;
    return out;
  }

  _machineFields(machine, label) {
    const m = this._config[machine];
    return `<div class="grp"><div class="grp-t">${label}</div>
      <div class="fld"><label>Nome</label><input type="text" data-m="${machine}" data-k="name" value="${(m.name||"").replace(/"/g,"&quot;")}"></div>
      <div class="fld"><label>Sensore potenza (W)</label><select data-m="${machine}" data-k="power">${this._opts(["sensor."], m.power)}</select></div>
      <div class="fld"><label>Sensore energia (kWh) — opzionale</label><select data-m="${machine}" data-k="energy">${this._opts(["sensor."], m.energy)}</select></div>
      <div class="fld"><label>Presa/interruttore — opzionale</label><select data-m="${machine}" data-k="switch">${this._opts(["switch.","input_boolean."], m.switch)}</select></div>
      <div class="fld"><label>Soglia "in funzione" (W)</label><input type="number" min="1" max="500" data-m="${machine}" data-k="soglia" value="${m.soglia||10}"></div>
    </div>`;
  }

  _render() {
    if (!this._config) return;
    this.innerHTML = `<style>
      .cbe{display:flex;flex-direction:column;gap:14px;padding:6px 2px;font-family:inherit}
      .cbe .fld{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .cbe label{font-size:13px;font-weight:600;color:var(--primary-text-color)}
      .cbe input,.cbe select{padding:10px 11px;border-radius:8px;font-size:15px;font-family:inherit;
        border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
      .cbe .grp{border:1px solid var(--divider-color);border-radius:12px;padding:10px 12px 12px}
      .cbe .grp-t{font-size:13px;font-weight:800;color:var(--primary-color);text-transform:uppercase;letter-spacing:.5px}
      .cbe .note{font-size:11.5px;color:var(--secondary-text-color);line-height:1.5}
    </style>
    <div class="cbe">
      <div class="fld"><label>Titolo</label><input type="text" data-top="title" value="${(this._config.title||"").replace(/"/g,"&quot;")}"></div>
      ${this._machineFields("lavatrice","🌀 Lavatrice")}
      ${this._machineFields("asciugatrice","🔥 Asciugatrice")}
      <div class="note">La macchina risulta "in funzione" quando la potenza supera la soglia. Se imposti una presa/interruttore, il pulsante la accende/spegne; altrimenti apre i dettagli.</div>
    </div>`;
    this.querySelector('[data-top="title"]').addEventListener("input", e => { this._config = Object.assign({}, this._config, { title: e.target.value }); this._emit(); });
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
  description: "Centro controllo lavatrice e asciugatrice con grafica realistica animata.",
  preview: true,
  documentationURL: "https://github.com/cristianwebonline/ha-centro-bucato-card",
});
