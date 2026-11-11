// DOM user interface: header counters, factory KPI bar, side panel, map, HQ, modals.

import { LEVELS, LEVEL_BY_ID, ITEM_STYLE } from './levels.js';
import {
  UPG, GLOBAL, nodeUpgrades, nodeParams, globalEffects, upgCost, globalCost,
  factoryCostMult, mastery, MODERNIZE_MASTERY, MODERNIZE_VALUE, OFFLINE_CAP, isLateJump,
} from './economy.js';
import { money, fmt, fmtTime, pct } from './util.js';
import { SPACING } from './sim.js';

const $ = (s, r = document) => r.querySelector(s);
const KIND_NAME = { source: 'Supply', station: 'Workstation', batch: 'Batch process', assembly: 'Assembly', dock: 'Truck dock', sink: 'Market', split: 'Splitter', merge: 'Merge' };
const STATE_NAME = { working: 'Working', blocked: 'Blocked (output full)', starved: 'Waiting for input', broken: 'Broken down, repairing', filling: 'Filling batch', waiting: 'Waiting for a truck', idle: 'Idle', overflow: 'Overflowing: supply is wasted' };
const STATE_VAR = { working: '--accent', blocked: '--warn', broken: '--bad', filling: '--accent', starved: '--muted', waiting: '--muted', idle: '--muted', overflow: '--bad' };

export class UI {
  constructor(game, renderer) {
    this.g = game;
    this.r = renderer;
    this.view = 'factory';
    this.sel = null;
    this.mapSel = null;
    this.dispCash = game.state.cash;
    this.dispRate = 0;
    this.tAcc = 0;
    this.live = {};
    this.buys = {};
  }

  init() {
    document.querySelectorAll('nav [data-view]').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    $('#themeBtn').addEventListener('click', () => this.toggleTheme());
    const cv = $('#cv');
    cv.addEventListener('click', (ev) => {
      const rect = cv.getBoundingClientRect();
      const n = this.r.hit(this.fac(), ev.clientX - rect.left, ev.clientY - rect.top);
      this.select(n && n !== this.sel ? n : null);
    });
    new ResizeObserver(() => this.r.resize()).observe($('.stage'));
    for (const id of ['panel', 'mappanel', 'hq']) this.bindClicks($('#' + id));
    this.openFactory(this.g.state.view in this.g.F ? this.g.state.view : 'l1');
  }

  fac() { return this.g.F[this.g.state.view]; }

  // ---------- generic live bindings ----------
  bindClicks(root) {
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const fn = this.acts[b.dataset.act];
      if (fn) fn(b.dataset.arg);
    });
    root.addEventListener('input', (ev) => {
      const el = ev.target.closest('[data-inp]');
      if (el && this.inps[el.dataset.inp]) this.inps[el.dataset.inp](el.value);
    });
  }
  setLive(root) {
    this.liveEls = [...document.querySelectorAll('[data-live]')];
    this.buyEls = [...document.querySelectorAll('[data-buy]')];
  }
  refreshLive() {
    const cash = this.g.state.cash;
    for (const el of this.liveEls) {
      const f = this.live[el.dataset.live];
      if (!f) continue;
      const v = f();
      if (el._v !== v) { el._v = v; if (el.dataset.html != null) el.innerHTML = v; else el.textContent = v; }
    }
    for (const el of this.buyEls) {
      const b = this.buys[el.dataset.buy];
      if (!b) continue;
      const cost = b.cost();
      const maxed = cost == null;
      const dis = maxed || cash < cost || (b.can && !b.can());
      if (el.disabled !== dis) el.disabled = dis;
      const label = maxed ? 'Max' : (b.label ? b.label() : money(cost));
      if (el._l !== label) { el._l = label; el.textContent = label; }
    }
  }

  // ---------- frame tick ----------
  tick(dt) {
    const s = this.g.state;
    // cash trends smoothly toward the exact value (~1s settle)
    const k = 1 - Math.exp(-dt / 0.33);
    this.dispCash += (s.cash - this.dispCash) * k;
    if (Math.abs(s.cash - this.dispCash) < Math.max(0.005, s.cash * 1e-7)) this.dispCash = s.cash;
    const rate = this.g.rateMin();
    this.dispRate += (rate - this.dispRate) * (1 - Math.exp(-dt / 0.8));
    setText($('#cash'), money(this.dispCash));
    setText($('#rate'), money(this.dispRate) + ' / min');
    this.tAcc += dt;
    if (this.tAcc > 0.25) {
      this.tAcc = 0;
      this.refreshLive();
      if (this.view === 'map') this.updMap();
    }
  }

  // ---------- navigation ----------
  setView(v) {
    this.view = v;
    document.querySelectorAll('nav [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('on', el.id === 'v-' + v));
    for (const id in this.g.F) this.g.F[id].viewed = v === 'factory' && id === this.g.state.view;
    if (v === 'factory') { this.r.resize(); this.buildPanel(); }
    if (v === 'map') { this.mapSel = this.mapSel || this.g.state.view; this.buildMap(); this.buildMapPanel(); }
    if (v === 'hq') this.buildHQ();
  }

  openFactory(id) {
    this.g.state.view = id;
    this.sel = null;
    this.r.sel = null;
    this.buildFbar();
    this.setView('factory');
  }

  select(n) {
    this.sel = n;
    this.r.sel = n;
    this.buildPanel();
  }

  toggleTheme() {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    this.g.state.theme = next;
    applyTheme(next);
    this.r.readTheme();
    if (this.view === 'map') this.buildMap();
  }

  // ---------- factory bar ----------
  buildFbar() {
    const f = this.fac(), d = f.def, st = f.st;
    $('#fbar').innerHTML = `
      <div class="title">${d.name} <small>Tier ${d.tier}</small> <span class="stars">${'★'.repeat(st.modern || 0)}</span></div>
      <div class="kpis">
        <div class="kpi" style="flex-direction:row;align-items:center;gap:8px">
          <svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--belt)" stroke-width="4"/>
          <circle data-ring cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="94.2" stroke-dashoffset="94.2" transform="rotate(-90 18 18)"/></svg>
          <div style="display:flex;flex-direction:column"><b data-live="k.batch">-</b><span>Batch of ${d.batchSize}</span></div>
        </div>
        <div class="kpi"><b data-live="k.speed">-</b><span>Items / min</span></div>
        <div class="kpi"><b data-live="k.flow">-</b><span>Flow eff.</span></div>
        <div class="kpi"><b data-live="k.yield">-</b><span>Yield</span></div>
        <div class="kpi"><b data-live="k.rate">-</b><span>€ / min</span></div>
      </div>`;
    const K = () => f.kpi();
    Object.assign(this.live, {
      'k.batch': () => { const k = K(); this.ring(k.progress); return k.count ? fmtTime(k.batchDur) : '…'; },
      'k.speed': () => { const k = K(); return k.count ? (d.batchSize / k.batchDur * 60).toFixed(1) : '…'; },
      'k.flow': () => { const k = K(); return k.count ? pct(k.flow) : '…'; },
      'k.yield': () => { const k = K(); return k.count ? pct(k.yield) : '…'; },
      'k.rate': () => money(f.ema * 60),
    });
  }
  ring(p) {
    const el = document.querySelector('[data-ring]');
    if (el) el.setAttribute('stroke-dashoffset', (94.2 * (1 - p)).toFixed(1));
  }

  // ---------- side panel ----------
  buildPanel() {
    const f = this.fac();
    this.acts = this.acts || {};
    this.inps = this.inps || {};
    this.live = {};
    this.buys = {};
    this.buildFbarLive();
    const el = $('#panel');
    el.innerHTML = this.sel ? this.nodePanel(f, this.sel) : this.overviewPanel(f);
    this.setLive();
    this.refreshLive();
  }
  buildFbarLive() { this.buildFbar(); }

  overviewPanel(f) {
    const d = f.def, st = f.st, g = this.g;
    let h = `<h2>${d.name}</h2><div class="sub">Tier ${d.tier} · sale value ×${fmt(f.p.valueMult)}${st.modern ? ` · modernized ${st.modern}×` : ''}</div>
      <p>${d.blurb}</p>
      <h3>Performance</h3>
      <div class="stats">
        <div>Income</div><div data-live="o.rate"></div>
        <div>Stable rate (offline)</div><div data-live="o.stable"></div>
        <div>Last batches</div><div data-live="o.eff"></div>
        <div>Sold / wasted</div><div data-live="o.sw"></div>
        <div>Supply overflow</div><div data-live="o.ovf"></div>
        <div>Breakdowns</div><div data-live="o.brk"></div>
        <div>Lifetime earnings</div><div data-live="o.life"></div>
      </div>
      <div class="chart" data-live="o.chart" data-html></div>
      <div class="sub">Items/min of the last batches (faded = low yield)</div>`;
    Object.assign(this.live, {
      'o.rate': () => money(f.ema * 60) + ' / min',
      'o.stable': () => money((st.stable || 0) * 60) + ' / min',
      'o.eff': () => { const k = f.kpi(); return k.count ? `${pct(k.flow)} flow · ${pct(k.yield)} yield` : 'measuring…'; },
      'o.sw': () => `${f.stats.sold} / ${f.stats.wasted}`,
      'o.brk': () => String(f.stats.breakdowns),
      'o.ovf': () => String(f.stats.overflow),
      'o.life': () => money(st.earned || 0),
      'o.chart': () => {
        const b = f.batches;
        if (!b.length) return '';
        const sp = b.map((x) => x.n / x.dur);
        const mx = Math.max(...sp);
        return b.map((x, i) => `<i style="height:${(sp[i] / mx * 100).toFixed(0)}%;opacity:${(0.25 + 0.75 * x.yield).toFixed(2)}" title="${fmtTime(x.dur)}"></i>`).join('');
      },
    });

    const sources = f.nodes.filter((n) => n.kind === 'source');
    h += `<h3>Supply release</h3><p class="sub">Suppliers deliver at this rate whatever happens. What the line cannot absorb piles up at the gate (6 places), then is sent back with a small fee. Full queues also wear machines faster.</p>`;
    for (const n of sources) {
      const v = Math.round(n.throttle * 100);
      h += `<div class="slider"><span>${n.def.label}</span><span class="num" data-live="thr.${n.id}"></span>
        <input type="range" min="0" max="100" step="1" value="${v}" data-inp="thr.${n.id}"></div>`;
      this.live['thr.' + n.id] = () => `${Math.round(n.throttle * 100)}% · ${(n.p.rate * n.throttle * 60).toFixed(1)}/min`;
      this.inps['thr.' + n.id] = (val) => g.setThrottle(f, n.id, val / 100);
    }
    const splits = f.nodes.filter((n) => (n.kind === 'split') && !n.def.route);
    if (splits.length) {
      h += `<h3>Routing</h3>`;
      for (const n of splits) h += this.ruleRow(f, n);
    }
    h += `<h3>Factory</h3>` + this.upgRow('conv', 'conveyor', st.conveyor || 0,
      () => {
        const nxt = f.p.conveyor / (1 + 0.1 * (st.conveyor || 0)) * (1 + 0.1 * ((st.conveyor || 0) + 1));
        return `belt max ${(f.beltCap() * 60).toFixed(0)} → ${(nxt / SPACING * 60).toFixed(0)} items/min`;
      });
    this.live['ef.conv.max'] = () => `Belts carry at most ${(f.beltCap() * 60).toFixed(0)} items/min (HQ Belt tech raises it)`;
    h += `<div class="sub" data-live="ef.conv.max"></div>`;
    this.buys.conv = {
      cost: () => ((st.conveyor || 0) >= UPG.conveyor.max ? null : upgCost('conveyor', st.conveyor || 0, factoryCostMult(d, st))),
    };
    this.acts.conv = () => { g.buyConveyor(f); this.buildPanel(); };

    // modernization
    h += `<h3>Modernization</h3>
      <p class="sub">Reset this factory's local upgrades for a permanent ×${MODERNIZE_VALUE} sale value here. Requires ${pct(MODERNIZE_MASTERY)} of all local upgrade levels.</p>
      <div class="bar"><i data-live="o.mbar" style="width:0"></i></div>
      <div class="rowline"><span class="sub" data-live="o.mtxt"></span><button class="btn warn" data-act="modern" data-buy="modern">Modernize</button></div>`;
    this.live['o.mtxt'] = () => `Mastery ${pct(mastery(d, st))}`;
    this.live['o.mbar'] = () => { const el = document.querySelector('[data-live="o.mbar"]'); if (el) el.style.width = pct(Math.min(1, mastery(d, st) / MODERNIZE_MASTERY)); return ''; };
    this.buys.modern = { cost: () => 0, can: () => mastery(d, st) >= MODERNIZE_MASTERY, label: () => 'Modernize' };
    this.acts.modern = () => this.confirm('Modernize ' + d.name + '?',
      `All local upgrades of this factory go back to level 0 and the line restarts empty. In exchange its sale value is multiplied by ${MODERNIZE_VALUE}, permanently. Upgrade costs here grow ×1.3.`,
      'Modernize', () => { g.modernize(f.def.id); this.openFactory(f.def.id); });

    h += `<div class="hint">Tap any station to inspect and upgrade it. Watch the colors: <span style="color:var(--accent)">working</span>, <span style="color:var(--warn)">blocked</span>, <span style="color:var(--bad)">broken</span>, grey is waiting. The slowest busy station is your bottleneck.</div>`;
    return h;
  }

  ruleRow(f, n) {
    const rid = 'rule.' + n.id;
    this.acts[rid] = (arg) => { this.g.setRule(f, n.id, arg); this.buildPanel(); };
    const b = (v, t) => `<button class="${n.rule === v ? 'on' : ''}" data-act="${rid}" data-arg="${v}">${t}</button>`;
    return `<div class="rowline"><span>${n.def.label}</span><span class="seg">${b('alt', 'Alternate')}${b('least', 'Least loaded')}</span></div>`;
  }

  upgRow(id, key, lvl, effect) {
    const u = UPG[key];
    const max = lvl >= u.max;
    this.live['ef.' + id] = () => (max ? 'maxed' : effect());
    return `<div class="upg"><div class="nm">${u.name}<span class="lv">${lvl}/${u.max}</span></div>
      <button data-act="${id}" data-buy="${id}"></button>
      <div class="ef" data-live="ef.${id}"></div></div>`;
  }

  nodePanel(f, n) {
    const d = n.def, g = this.g, st = f.st;
    const G = globalEffects(g.global);
    let h = `<button class="back" data-act="back">← ${f.def.name}</button>
      <h2>${d.label || n.id}</h2><div class="sub">${KIND_NAME[n.kind]}${d.recipe ? ' · ' + recipeText(d) : ''}${d.route === 'quality' ? ' · defects → rework' : ''}${d.scrap ? ' · defects scrapped' : ''}${d.fix ? ' · repairs defects' : ''}</div>
      <h3>Live</h3><div class="stats">`;
    this.acts.back = () => this.select(null);
    const row = (k, lbl, fn) => { h += `<div>${lbl}</div><div data-live="${k}" ${k === 'n.state' ? 'data-html' : ''}></div>`; this.live[k] = fn; };
    row('n.state', 'State', () => `<span class="dot" style="background:var(${STATE_VAR[n.state] || '--muted'})"></span>${STATE_NAME[n.state] || n.state}${f.bottleneck === n ? ' · <b style="color:var(--warn)">bottleneck</b>' : ''}`);
    if (n.kind !== 'sink' && n.kind !== 'split' && n.kind !== 'merge') row('n.util', 'Utilization', () => pct(n.util));
    row('n.thr', 'Throughput', () => (n.rate * 60).toFixed(1) + ' / min');
    const cap = capacity(n);
    if (cap != null) row('n.cap', 'Capacity', () => {
      const c = capacity(n), belt = f.beltCap() * 60;
      const limited = n.kind !== 'source' && n.outE.length === 1 && n.outE[0].to.kind !== 'sink' && c > belt;
      return c.toFixed(1) + ' / min' + (limited ? ` · belt max ${belt.toFixed(0)}` : '');
    });
    if (cap != null && n.kind !== 'source') {
      row('n.bl', 'Backlog', () => {
        const b = f.backlog(n);
        const room = n.kind === 'assembly' ? Infinity : n.p.queue;
        if (b <= room) return String(b);
        const flow = n.rateLong || 0, c = Math.min(capacity(n), n.outE.length === 1 && n.outE[0].to.kind !== 'sink' ? f.beltCap() * 60 : Infinity) / 60;
        return `${b} (buffer + belt) · ` + (c > flow * 1.02 && n.state !== 'broken' ? `clears in ~${fmtTime(b / (c - flow))}` : n.state === 'broken' ? 'growing' : 'not clearing');
      });
    }
    if (n.queue && ['station', 'batch', 'dock'].includes(n.kind)) row('n.q', 'Queue', () => `${n.queue.length} / ${n.p.queue}`);
    if (n.p.wear) row('n.wear', 'Wear', () => pct(n.wear));
    if (n.kind === 'batch') row('n.ch', 'Chamber', () => `${n.chamber.length} / ${n.p.cap} · ${n.phase}`);
    if (n.kind === 'assembly') for (const k in n.buf) row('n.b' + k, `Bin ${ITEM_STYLE[k].shape}`, () => `${n.buf[k].length} / ${n.p.buffer}`);
    if (n.kind === 'dock') {
      row('n.tr', 'Truck', () => (n.truck ? `${n.truck.load.length} / ${n.truck.cap} loaded` : n.away.length ? `back in ${fmtTime(n.away[0].t)}` : '-'));
      row('n.fl', 'Fleet', () => `${n.trucksTotal - n.away.length} / ${n.trucksTotal} at base`);
    }
    if (n.kind === 'source') {
      row('n.rt', 'Max supply', () => (n.p.rate * 60).toFixed(1) + ' / min');
      row('n.stk', 'Gate stock', () => `${n.queue.length} / ${n.p.queue}`);
      row('n.ovf', 'Wasted (overflow)', () => String(n.overflow || 0));
    }
    h += `</div>`;

    if (n.kind === 'source') {
      h += `<p class="sub" data-live="n.hint"></p>`;
      this.live['n.hint'] = () => {
        if (n.queue.length < n.p.queue * 0.5) return '';
        const beltMax = f.beltCap() * 60;
        if (n.p.rate * n.throttle * 60 > beltMax * 0.97)
          return `Belt full: this supply is more than a belt can carry (${beltMax.toFixed(0)} items/min). Upgrade Conveyors or HQ Belt tech, or lower the throttle.`;
        const b = f.bottleneck;
        return 'The line cannot absorb this supply' + (b ? `: ${b.def.label} is the bottleneck.` : '.') + ' Lower the throttle or upgrade the bottleneck.';
      };
      h += `<h3>Release</h3><div class="slider"><span>Throttle</span><span class="num" data-live="thr"></span>
        <input type="range" min="0" max="100" step="1" value="${Math.round(n.throttle * 100)}" data-inp="thr"></div>`;
      this.live.thr = () => `${Math.round(n.throttle * 100)}% · ${(n.p.rate * n.throttle * 60).toFixed(1)}/min`;
      this.inps.thr = (v) => g.setThrottle(f, n.id, v / 100);
    }
    if (n.kind === 'split' && !d.route) h += `<h3>Routing</h3>` + this.ruleRow(f, n);
    if (n.kind === 'split' && d.route === 'type') h += `<p class="sub">Sorts items by type. If the target line is full, the sorter waits, blocking everything behind it.</p>`;

    const keys = nodeUpgrades(d);
    if (keys.length) {
      h += `<h3>Upgrades</h3>`;
      const lv = (st.lv[n.id] = st.lv[n.id] || {});
      for (const key of keys) {
        const id = 'u.' + key;
        const lvl = lv[key] || 0;
        h += this.upgRow(id, key, lvl, () => (isLateJump(key, lv[key] || 0) ? '⚠ big jump: ' : '') + effectText(d, key, lv, G));
        this.buys[id] = { cost: () => ((lv[key] || 0) >= UPG[key].max ? null : upgCost(key, lv[key] || 0, factoryCostMult(f.def, st))) };
        this.acts[id] = () => { g.buyNode(f, n.id, key); this.buildPanel(); };
      }
    } else if (n.kind === 'sink') {
      h += `<p>Sells everything instantly. Perishable items lose value with age, defective ones sell at 30%.</p>`;
    } else if (n.kind === 'merge') {
      h += `<p>Joins belts, taking turns between inputs.</p>`;
    }
    return h;
  }

  // ---------- map ----------
  buildMap() {
    const svg = $('#mapsvg');
    const pos = MAP_POS;
    let h = '';
    for (let i = 0; i < LEVELS.length - 1; i++) {
      const [x0, y0] = pos[i], [x1, y1] = pos[i + 1];
      const both = this.g.owned(LEVELS[i].id) && this.g.owned(LEVELS[i + 1].id);
      const mx = (x0 + x1) / 2 + (y1 - y0) * 0.25, my = (y0 + y1) / 2 - (x1 - x0) * 0.25;
      h += `<path d="M${x0} ${y0} Q${mx} ${my} ${x1} ${y1}" fill="none" stroke="var(${both ? '--accent' : '--stroke'})" stroke-width="${both ? 3 : 2}" stroke-dasharray="${both ? '' : '6 8'}" opacity="${both ? 0.6 : 0.5}" stroke-linecap="round"/>`;
    }
    LEVELS.forEach((L, i) => {
      const [x, y] = pos[i];
      const owned = this.g.owned(L.id);
      const next = this.g.nextLevel() === L;
      const sel = this.mapSel === L.id;
      const hex = hexPath(x, y, 34);
      const fill = owned ? 'var(--accent)' : next ? 'var(--node)' : 'var(--node2)';
      const stroke = sel ? 'var(--fg)' : owned ? 'var(--accent)' : 'var(--stroke)';
      h += `<g class="site" data-site="${L.id}">
        <path class="hex" d="${hex}" fill="${fill}" fill-opacity="${owned ? 0.2 : 1}" stroke="${stroke}" stroke-width="${sel ? 3 : 2}" ${next && !owned ? 'stroke-dasharray="5 5"' : ''} opacity="${owned || next ? 1 : 0.55}"/>
        <text x="${x}" y="${y + 6}" text-anchor="middle" font-size="18" font-weight="600" fill="var(${owned ? '--fg' : '--muted'})">${L.tier}</text>
        <text x="${x}" y="${y + 56}" text-anchor="middle" font-size="15" font-weight="500" fill="var(${owned ? '--fg' : '--muted'})">${L.name}</text>
        <text x="${x}" y="${y + 75}" text-anchor="middle" font-size="13" fill="var(--muted)" data-mlive="${L.id}"></text>
        ${owned && this.g.state.fac[L.id].modern ? `<text x="${x}" y="${y - 42}" text-anchor="middle" font-size="12" fill="var(--i-gold)">${'★'.repeat(this.g.state.fac[L.id].modern)}</text>` : ''}
      </g>`;
    });
    svg.innerHTML = h;
    svg.querySelectorAll('.site').forEach((el) => el.addEventListener('click', () => {
      this.mapSel = el.dataset.site;
      this.buildMap();
      this.buildMapPanel();
    }));
    this.updMap();
  }
  updMap() {
    document.querySelectorAll('[data-mlive]').forEach((el) => {
      const id = el.dataset.mlive;
      const L = LEVEL_BY_ID[id];
      let t = '';
      if (this.g.owned(id)) t = money(this.g.F[id].ema * 60) + '/min';
      else if (this.g.nextLevel() === L) t = money(L.price);
      if (el.textContent !== t) el.textContent = t;
    });
  }
  buildMapPanel() {
    const L = LEVEL_BY_ID[this.mapSel];
    const owned = this.g.owned(L.id);
    const next = this.g.nextLevel() === L;
    this.acts = this.acts || {};
    this.live = {};
    this.buys = {};
    let h = `<h2>${L.name}</h2><div class="sub">Tier ${L.tier} · ${L.nodes.length} nodes</div><p>${L.blurb}</p>`;
    if (owned) {
      const f = this.g.F[L.id];
      h += `<div class="stats">
        <div>Income</div><div data-live="m.rate"></div>
        <div>Batch efficiency</div><div data-live="m.eff"></div>
        <div>Mastery</div><div data-live="m.mas"></div>
        <div>Modernized</div><div>${f.st.modern || 0}×</div></div>
        <div class="rowline" style="margin-top:12px"><span></span><button class="btn solid" data-act="enter">Open factory</button></div>`;
      this.live['m.rate'] = () => money(f.ema * 60) + ' / min';
      this.live['m.eff'] = () => { const k = f.kpi(); return k.count ? `${pct(k.flow)} flow · ${pct(k.yield)} yield` : 'measuring…'; };
      this.live['m.mas'] = () => pct(mastery(L, f.st));
      this.acts.enter = () => this.openFactory(L.id);
    } else if (next) {
      h += `<div class="rowline"><span>Price</span><button class="btn" data-act="buyfac" data-buy="buyfac"></button></div>
        <p class="sub">Each new factory has a much higher ceiling than the previous one, and keeps running alongside the others.</p>`;
      this.buys.buyfac = { cost: () => L.price };
      this.acts.buyfac = () => { if (this.g.buyFactory(L.id)) { this.toast(L.name + ' acquired'); this.openFactory(L.id); } };
    } else {
      h += `<p class="sub">Locked. Acquire the previous site first.</p>`;
    }
    $('#mappanel').innerHTML = h;
    this.setLive();
    this.refreshLive();
  }

  // ---------- HQ ----------
  buildHQ() {
    const g = this.g, s = g.state;
    this.acts = this.acts || {};
    this.live = {};
    this.buys = {};
    let h = `<div class="hq-inner"><h2>Headquarters</h2>
      <p class="sub">Group-wide upgrades apply to every factory, current and future.</p>
      <div class="stats" style="max-width:420px;margin-top:12px">
        <div>Total earned</div><div data-live="h.tot"></div>
        <div>Factories</div><div>${Object.keys(g.F).length} / ${LEVELS.length}</div>
        <div>Stable rate (used offline)</div><div data-live="h.st"></div>
        <div>Offline earnings cap</div><div>${OFFLINE_CAP / 3600} h</div>
        <div>Playing since</div><div>${new Date(s.started).toLocaleDateString()}</div>
      </div><div class="cards">`;
    this.live['h.tot'] = () => money(s.total);
    this.live['h.st'] = () => money(g.stableRate() * 60) + ' / min';
    for (const key in GLOBAL) {
      const u = GLOBAL[key];
      const id = 'g.' + key;
      h += `<div class="card"><div class="nm">${u.name} <span class="sub">${s.global[key] || 0}/${u.max}</span></div>
        <div class="ef">${u.desc}</div><div class="ef" data-live="${id}.e"></div>
        <button class="btn" data-act="${id}" data-buy="${id}"></button></div>`;
      this.live[id + '.e'] = () => globalEffectText(key, s.global[key] || 0);
      this.buys[id] = { cost: () => ((s.global[key] || 0) >= u.max ? null : globalCost(key, s.global[key] || 0)) };
      this.acts[id] = () => { g.buyGlobal(key); this.buildHQ(); };
    }
    if (g.cheat) h += `</div>` + this.cheatHtml() + `<div>`;
    h += `</div><h3 style="margin-top:36px;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase">Save</h3>
      <div class="rowline" style="max-width:420px"><span class="sub">Progress is saved in this browser automatically.</span>
      <button class="btn warn" data-act="reset">Reset game</button></div></div>`;
    this.acts.reset = () => this.confirm('Reset everything?', 'All factories, upgrades and cash will be deleted from this browser. This cannot be undone.', 'Delete save', () => g.reset());
    $('#hq').innerHTML = h;
    this.setLive();
    this.refreshLive();
  }

  // ---------- cheat mode (?cheat=1) ----------
  cheatHtml() {
    const g = this.g;
    const btn = (act, arg, label, cls = '') => `<button class="btn ${cls}" data-act="${act}" data-arg="${arg}">${label}</button>`;
    Object.assign(this.acts, {
      'c.add': (a) => { g.earn(Number(a)); this.toast('+' + money(Number(a))); },
      'c.mul': () => { g.earn(Math.max(1000, g.state.cash * 9)); this.toast('Cash ×10'); },
      'c.speed': (a) => { g.speed = Number(a); this.buildHQ(); },
      'c.ff': (a) => { g.fastForward(Number(a)); this.toast('Skipped ' + fmtTime(Number(a))); },
      'c.next': () => { const L = g.nextLevel(); if (L) { g.earn(L.price); g.buyFactory(L.id); this.toast(L.name + ' unlocked'); this.buildHQ(); } },
      'c.max': () => { g.maxFactory(g.state.view); this.toast('All upgrades maxed in ' + LEVEL_BY_ID[g.state.view].name); },
      'c.zero': () => { g.state.cash = 0; this.dispCash = 0; },
    });
    const amounts = [1e3, 1e6, 1e9, 1e12, 1e15];
    return `<h3 style="margin-top:36px;color:var(--bad);font-size:11px;letter-spacing:.08em;text-transform:uppercase">Cheat mode</h3>
      <div class="cards">
        <div class="card"><div class="nm">Money</div><div class="ef">Add cash instantly.</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${amounts.map((a) => btn('c.add', a, '+' + money(a))).join('')}${btn('c.mul', 0, '×10')}${btn('c.zero', 0, 'Set to 0', 'warn')}</div></div>
        <div class="card"><div class="nm">Time speed <span class="sub">×${g.speed}</span></div><div class="ef">Simulation speed for all factories.</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${[1, 2, 5, 10, 20].map((v) => btn('c.speed', v, '×' + v, g.speed === v ? 'solid' : '')).join('')}</div></div>
        <div class="card"><div class="nm">Fast forward</div><div class="ef">Simulate every factory for a while (real sim, not the offline average).</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${[60, 600, 3600].map((v) => btn('c.ff', v, '+' + fmtTime(v))).join('')}</div></div>
        <div class="card"><div class="nm">Factories</div><div class="ef">Unlock the next site for free, or max every local upgrade of the factory last opened (${LEVEL_BY_ID[g.state.view].name}).</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${btn('c.next', 0, 'Unlock next')}${btn('c.max', 0, 'Max current', 'warn')}</div></div>
      </div>`;
  }

  // ---------- modal / toast ----------
  modal(html, actions) {
    const m = $('#modal');
    m.innerHTML = `<div class="box">${html}<div class="actions">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${a.label}</button>`).join('')}</div></div>`;
    m.hidden = false;
    m.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      m.hidden = true;
      const a = actions[+b.dataset.i];
      if (a.fn) a.fn();
    }));
  }
  confirm(title, text, ok, fn) {
    this.modal(`<h2>${title}</h2><p>${text}</p>`, [{ label: 'Cancel' }, { label: ok, cls: 'warn', fn }]);
  }
  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('on'), 2600);
  }
}

// ---------- helpers ----------
const MAP_POS = [[100, 450], [230, 380], [360, 450], [490, 375], [620, 445], [760, 370], [880, 255], [745, 160], [590, 105], [430, 150]];

function hexPath(x, y, r) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    d += (i ? 'L' : 'M') + (x + Math.cos(a) * r).toFixed(1) + ' ' + (y + Math.sin(a) * r).toFixed(1);
  }
  return d + 'Z';
}

function setText(el, t) { if (el._t !== t) { el._t = t; el.textContent = t; } }

export function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m = document.querySelector('meta[name="theme-color"]');
  if (m && bg) m.setAttribute('content', bg);
}

function recipeText(d) {
  const sym = { circle: '●', triangle: '▲', square: '■', diamond: '◆', hexagon: '⬢', star: '★' };
  const parts = Object.entries(d.recipe).map(([k, n]) => `${n}${sym[ITEM_STYLE[k].shape]}`);
  return parts.join(' + ') + ' → ' + sym[ITEM_STYLE[d.outType].shape];
}

// Theoretical max throughput of a node, items/min.
function capacity(n) {
  const p = n.p;
  switch (n.kind) {
    case 'station': return (p.slots / p.time) * 60;
    case 'batch': return (p.cap / p.time) * 60;
    case 'assembly': return (1 / p.time) * 60;
    case 'source': return p.rate * 60;
    case 'dock': {
      const load = (p.cap * (p.loadBase + p.loadDist / 2)) / p.loaders;
      const cycle = Math.max(load, (load + p.trip + 1) / p.fleet);
      return (p.cap / cycle) * 60;
    }
  }
  return null;
}

function effectText(def, key, lv, G) {
  const cur = nodeParams(def, lv, G);
  const nxt = nodeParams(def, { ...lv, [key]: (lv[key] || 0) + 1 }, G);
  switch (key) {
    case 'speed': return `${cur.time.toFixed(2)}s → ${nxt.time.toFixed(2)}s per item${def.kind === 'batch' ? ' batch' : ''}`;
    case 'slots': return `${cur.slots} → ${nxt.slots} workers`;
    case 'queue': return `${cur.queue} → ${nxt.queue} places`;
    case 'maint': return `wear ×${(cur.wear / def.wear).toFixed(2)} → ×${(nxt.wear / def.wear).toFixed(2)}, repair ${cur.repair.toFixed(1)}s → ${nxt.repair.toFixed(1)}s`;
    case 'rate': return `${(cur.rate * 60).toFixed(1)} → ${(nxt.rate * 60).toFixed(1)} / min max`;
    case 'bcap': case 'tcap': return `${cur.cap} → ${nxt.cap} items`;
    case 'loaders': return `${cur.loaders} → ${nxt.loaders} loaders`;
    case 'lspeed': return `avg ${(cur.loadBase + cur.loadDist / 2).toFixed(2)}s → ${(nxt.loadBase + nxt.loadDist / 2).toFixed(2)}s per item`;
    case 'trip': return `round trip ${cur.trip.toFixed(1)}s → ${nxt.trip.toFixed(1)}s`;
    case 'fleet': return `${cur.fleet} → ${nxt.fleet} trucks`;
    case 'buffer': return `${cur.buffer} → ${nxt.buffer} per bin`;
  }
  return '';
}

function globalEffectText(key, l) {
  const e0 = globalEffects({ [key]: l }), e1 = globalEffects({ [key]: l + 1 });
  const m = { training: 'train', logistics: 'logi', belts: 'belt', marketing: 'market', reliability: 'rel', cold: 'cold', quality: 'qual' }[key];
  return `×${e0[m].toFixed(2)} → ×${e1[m].toFixed(2)}`;
}
