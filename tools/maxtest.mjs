// Fully upgraded factories: net income per throttle level. Shows whether max supply overwhelms the line.
// Usage: node tools/maxtest.mjs [seconds] [supplyLevel] [beltTechLevel]
import { LEVELS } from '../js/levels.js';
import { Factory } from '../js/sim.js';
import { UPG, nodeUpgrades } from '../js/economy.js';

const secs = Number(process.argv[2] || 400);
const supplyLv = process.argv[3] != null ? Number(process.argv[3]) : UPG.rate.max;
const belts = Number(process.argv[4] || 0);
const throttles = [0.3, 0.45, 0.6, 0.75, 0.9, 1];

for (const def of LEVELS) {
  const row = [];
  for (const th of throttles) {
    const game = { cash: 0, global: { belts }, earn(x) { this.cash += x; }, penalty(x) { this.cash -= x; } };
    const st = { lv: {}, conveyor: UPG.conveyor.max, modern: 0, throttle: {}, rules: {} };
    for (const n of def.nodes) {
      st.lv[n.id] = {};
      for (const k of nodeUpgrades(n)) st.lv[n.id][k] = k === 'rate' ? supplyLv : UPG[k].max;
      if (n.kind === 'source') st.throttle[n.id] = th;
      if (n.kind === 'split' && !n.route) st.rules[n.id] = 'least';
    }
    const f = new Factory(def, st, game);
    const warm = 60, dt = 1 / 30;
    for (let t = 0; t < warm; t += dt) f.step(dt);
    const c0 = game.cash;
    for (let t = 0; t < secs; t += dt) f.step(dt);
    const net = (game.cash - c0) / secs * 60 / def.valueMult;
    row.push(`${Math.round(th * 100)}%:${net.toFixed(0).padStart(5)} ovf${String(f.stats.overflow).padStart(5)}${th === 1 && f.bottleneck ? " bn:" + f.bottleneck.id : ""}`);
  }
  console.log(def.id.padEnd(4), row.join(' | '));
}
