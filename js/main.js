// Entry point: game state, purchases, main loop, offline earnings, persistence, PWA.

import { LEVELS, LEVEL_BY_ID } from './levels.js';
import { Factory } from './sim.js';
import { UPG, GLOBAL, nodeUpgrades, upgCost, globalCost, factoryCostMult, mastery, MODERNIZE_MASTERY, OFFLINE_CAP } from './economy.js';
import { load, save, wipe, defaultState, newFac } from './save.js';
import { Renderer } from './render.js';
import { UI, applyTheme } from './ui.js';
import { money, fmtTime } from './util.js';

class Game {
  constructor(state) {
    this.state = state;
    this.global = state.global;
    this.F = {};
    this.cheat = new URLSearchParams(location.search).get('cheat') === '1';
    this.speed = 1;
    for (const L of LEVELS) if (this.owned(L.id)) this.F[L.id] = new Factory(L, state.fac[L.id], this);
  }
  owned(id) { return !!(this.state.fac[id] && this.state.fac[id].owned); }
  nextLevel() { return LEVELS.find((L) => !this.owned(L.id)) || null; }
  earn(x) { this.state.cash += x; this.state.total += x; }
  penalty(x) { this.state.cash = Math.max(0, this.state.cash - x); }
  spend(c) {
    if (this.state.cash < c) return false;
    this.state.cash -= c;
    return true;
  }
  rateMin() { let r = 0; for (const id in this.F) r += this.F[id].ema; return r * 60; }
  stableRate() { let r = 0; for (const id in this.F) r += this.F[id].st.stable || 0; return r; }

  buyNode(f, nid, key) {
    const lv = (f.st.lv[nid] = f.st.lv[nid] || {});
    const l = lv[key] || 0;
    if (l >= UPG[key].max) return;
    if (!this.spend(upgCost(key, l, factoryCostMult(f.def, f.st)))) return;
    lv[key] = l + 1;
    f.refresh();
  }
  buyConveyor(f) {
    const l = f.st.conveyor || 0;
    if (l >= UPG.conveyor.max) return;
    if (!this.spend(upgCost('conveyor', l, factoryCostMult(f.def, f.st)))) return;
    f.st.conveyor = l + 1;
    f.refresh();
  }
  buyGlobal(key) {
    const l = this.global[key] || 0;
    if (l >= GLOBAL[key].max) return;
    if (!this.spend(globalCost(key, l))) return;
    this.global[key] = l + 1;
    for (const id in this.F) this.F[id].refresh();
  }
  buyFactory(id) {
    const L = LEVEL_BY_ID[id];
    if (this.nextLevel() !== L || !this.spend(L.price)) return false;
    this.state.fac[id] = newFac(true);
    this.F[id] = new Factory(L, this.state.fac[id], this);
    save(this.state);
    return true;
  }
  modernize(id) {
    const f = this.F[id];
    if (mastery(f.def, f.st) < MODERNIZE_MASTERY) return;
    const st = f.st;
    st.lv = {};
    st.conveyor = 0;
    st.modern = (st.modern || 0) + 1;
    this.F[id] = new Factory(f.def, st, this);
    save(this.state);
  }
  setThrottle(f, nid, v) {
    f.st.throttle[nid] = v;
    f.refresh();
  }
  setRule(f, nid, rule) {
    f.st.rules[nid] = rule;
    f.refresh();
  }
  reset() {
    wipe();
    this.resetting = true;
    location.reload();
  }
  // Cheat helpers
  fastForward(secs) {
    const h = 1 / 20;
    for (const id in this.F) for (let t = 0; t < secs; t += h) this.F[id].step(h);
  }
  maxFactory(id) {
    const f = this.F[id];
    for (const n of f.def.nodes) {
      const lv = (f.st.lv[n.id] = f.st.lv[n.id] || {});
      for (const k of nodeUpgrades(n)) lv[k] = UPG[k].max;
    }
    f.st.conveyor = UPG.conveyor.max;
    f.refresh();
  }
  // Credit time spent away using each factory's stable average rate.
  offline(seconds) {
    const s = Math.min(seconds, OFFLINE_CAP);
    const gain = this.stableRate() * s;
    if (gain > 0) this.earn(gain);
    return { s, gain };
  }
}

// ---------- boot ----------
const state = load() || defaultState();
applyTheme(state.theme);
const game = new Game(state);
const renderer = new Renderer(document.getElementById('cv'));
const ui = new UI(game, renderer);
ui.init();
if (game.cheat) document.querySelector('.brand span').textContent = 'Flow · cheat';

const away = (Date.now() - state.t) / 1000;
if (away > 30) {
  const { s, gain } = game.offline(away);
  ui.dispCash = state.cash;
  if (gain > 0) {
    ui.modal(`<h2>Welcome back</h2><p>You were away ${fmtTime(away)}${away > OFFLINE_CAP ? ` (counted up to ${OFFLINE_CAP / 3600} h)` : ''}. Your factories kept running at their stable rate.</p>
      <div class="big">+${money(gain)}</div>`, [{ label: 'Continue', cls: 'solid' }]);
  }
} else if (!load()) {
  ui.modal(`<h2>Flow Factory</h2><p>Items flow from supply to market through stations with limited queues. When one station is too slow, everything upstream stalls.</p>
    <p>Find the bottleneck, upgrade it, watch it move. Balance the line, then expand.</p>`, [{ label: 'Start', cls: 'solid' }]);
}

// ---------- main loop ----------
const STEP = 1 / 60;
let last = performance.now();
let hiddenAt = 0;
let saveT = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  dt *= game.speed;
  for (const id in game.F) {
    const f = game.F[id];
    let t = dt;
    while (t > 1e-6) { const h = Math.min(STEP, t); f.step(h); t -= h; }
  }
  if (ui.view === 'factory') renderer.draw(ui.fac(), dt / game.speed);
  ui.tick(dt);
  saveT += dt;
  if (saveT > 10) { saveT = 0; save(state); }
  requestAnimationFrame(frame);
}
requestAnimationFrame((t) => { last = t; frame(t); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    save(state);
  } else if (hiddenAt) {
    const gap = (Date.now() - hiddenAt) / 1000;
    hiddenAt = 0;
    last = performance.now();
    if (gap > 3) {
      const { gain } = game.offline(gap);
      if (gain > 0 && gap > 60) ui.toast(`+${money(gain)} while away (${fmtTime(gap)})`);
    }
  }
});
window.addEventListener('pagehide', () => { if (!game.resetting) save(state); });

// ---------- PWA ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Handy for debugging in the console. __sim(seconds) fast-forwards every factory.
window.__game = game;
window.__ui = ui;
window.__sim = (secs) => {
  for (const id in game.F) for (let t = 0; t < secs; t += STEP) game.F[id].step(STEP);
  if (ui.view === 'factory') renderer.draw(ui.fac(), STEP);
  ui.tick(1);
};
