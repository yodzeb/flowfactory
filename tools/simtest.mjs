// Headless check: run every level for N simulated seconds and print throughput & KPIs.
// Usage: node tools/simtest.mjs [seconds] [throttle]
import { LEVELS } from '../js/levels.js';
import { Factory } from '../js/sim.js';

const secs = Number(process.argv[2] || 600);
const throttle = process.argv[3] != null ? Number(process.argv[3]) : 1;

for (const def of LEVELS) {
  const game = { cash: 0, global: {}, earn(x) { this.cash += x; }, penalty(x) { this.cash = Math.max(0, this.cash - x); } };
  const st = { lv: {}, conveyor: 0, modern: 0, throttle: {}, rules: {} };
  for (const n of def.nodes) if (n.kind === 'source') st.throttle[n.id] = throttle;
  const f = new Factory(def, st, game);
  const dt = 1 / 30;
  for (let t = 0; t < secs; t += dt) f.step(dt);
  const k = f.kpi();
  const base = f.p.valueMult;
  console.log(
    `${def.id.padEnd(4)} ${def.name.padEnd(13)} €/min=${(k.rateMin / base).toFixed(1).padStart(6)}×tier`,
    `sold=${String(f.stats.sold).padStart(5)} ovf=${String(f.stats.overflow).padStart(4)} waste=${String(f.stats.wasted).padStart(4)} brk=${String(f.stats.breakdowns).padStart(3)}`,
    `batch=${k.batchDur.toFixed(1)}s flow=${(k.flow * 100).toFixed(0)}% yield=${(k.yield * 100).toFixed(0)}%`,
    '| util', f.nodes.filter((n) => n.p.time || n.kind === 'dock').map((n) => `${n.id}:${Math.round(n.util * 100)}`).join(' '),
  );
}
