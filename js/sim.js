// Factory flow simulation. Pure logic (no DOM) so it can also run headless in Node.
//
// Model: nodes (sources, stations, batch ovens, assemblies, splits/merges, docks, markets)
// connected by accumulating conveyors. A node can only push an item downstream when the next
// conveyor has room; conveyors only deliver when the target queue has room. Blocking therefore
// propagates upstream and starvation propagates downstream.

import { nodeParams, globalEffects, MODERNIZE_VALUE } from './economy.js';

export const SPACING = 1.6;   // min distance between items on a belt (world units); items are 1.44 wide
export const ITEM_R = 0.72;

export const NODE_DIM = {
  station: [7, 4.6], batch: [9, 5.4], assembly: [8, 6], dock: [5, 6],
  source: [5.2, 5.2], sink: [5.2, 5.2], split: [2.6, 2.6], merge: [2.6, 2.6],
};

let ITEM_ID = 1;

class Edge {
  constructor(id, from, to, pts) {
    this.id = id; this.from = from; this.to = to; this.pts = pts;
    this.items = [];   // front (closest to target) first
    this.segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const l = Math.hypot(x1 - x0, y1 - y0);
      this.segs.push({ x0, y0, dx: (x1 - x0) / (l || 1), dy: (y1 - y0) / (l || 1), l, s: total });
      total += l;
    }
    this.total = total;
    const f = this.segs[0], b = this.segs[this.segs.length - 1];
    this.trim0 = half(from, f.dx, f.dy);
    this.trim1 = half(to, b.dx, b.dy);
    this.len = Math.max(0.5, total - this.trim0 - this.trim1);
  }
  pointAt(d) {
    const s = this.trim0 + d;
    for (const g of this.segs) {
      if (s <= g.s + g.l || g === this.segs[this.segs.length - 1]) {
        const u = Math.min(s - g.s, g.l);
        return [g.x0 + g.dx * u, g.y0 + g.dy * u];
      }
    }
    return this.pts[0];
  }
  canAccept() {
    return !this.items.length || this.items[this.items.length - 1].d >= SPACING;
  }
  push(item) {
    item.d = 0;
    this.items.push(item);
  }
}

function half(node, dx, dy) {
  const [w, h] = NODE_DIM[node.kind];
  return (Math.abs(dx) >= Math.abs(dy) ? w / 2 : h / 2) + 0.4;
}

function route(p0, p1, via) {
  if (via) return [p0, ...via, p1];
  if (Math.abs(p0[1] - p1[1]) < 0.01 || Math.abs(p0[0] - p1[0]) < 0.01) return [p0, p1];
  const mx = (p0[0] + p1[0]) / 2;
  return [p0, [mx, p0[1]], [mx, p1[1]], p1];
}

export class Factory {
  constructor(def, st, game) {
    this.def = def; this.st = st; this.game = game;
    this.t = 0;
    this.fx = [];
    this.viewed = false;
    this.nodes = [];
    this.byId = {};
    for (const nd of def.nodes) {
      const n = {
        id: nd.id, def: nd, kind: nd.kind, x: nd.x, y: nd.y,
        inE: [], outE: [], state: 'idle', queue: [], slots: [],
        wear: 0, broken: 0, util: 0, done: 0, doneSec: 0, rate: 0, rr: 0,
        floatAcc: 0, floatT: 0, acc: 0,
      };
      if (nd.kind === 'batch') Object.assign(n, { chamber: [], phase: 'load', t: 0, wait: 0 });
      if (nd.kind === 'assembly') {
        n.buf = {};
        for (const k in nd.recipe) n.buf[k] = [];
        n.slots = [{ item: null, t: 0, done: false }];
      }
      if (nd.kind === 'dock') Object.assign(n, { truck: null, idle: 0, trucksTotal: 0, away: [], departing: [], idleT: 0 });
      this.nodes.push(n);
      this.byId[n.id] = n;
    }
    this.edges = def.edges.map((ed, i) => {
      const [a, b, opt] = ed;
      const from = this.byId[a], to = this.byId[b];
      if (!from || !to) throw new Error(`${def.id}: bad edge ${a}->${b}`);
      const e = new Edge(i, from, to, route([from.x, from.y], [to.x, to.y], opt && opt.via));
      from.outE.push(e);
      to.inE.push(e);
      return e;
    });
    this.secT = 0; this.secAcc = 0; this.ema = 0; this.sinceChange = 0; this.spoilT = 0;
    this.lifetime = 0;
    this.stats = { sold: 0, wasted: 0, breakdowns: 0, overflow: 0 };
    this.batch = { start: 0, n: 0, va: 0, lead: 0, waste: 0 };
    this.batches = [];
    this.flip = false;
    this.refresh();
  }

  // Recompute all params from upgrade levels (call after any purchase).
  refresh() {
    const G = globalEffects(this.game.global);
    const st = this.st;
    this.p = {
      conveyor: 5 * (1 + 0.1 * (st.conveyor || 0)) * G.logi,
      valueMult: this.def.valueMult * Math.pow(MODERNIZE_VALUE, st.modern || 0) * G.market,
      lifeMult: G.cold,
    };
    for (const n of this.nodes) {
      n.p = nodeParams(n.def, (st.lv && st.lv[n.id]) || {}, G);
      if (n.kind === 'station') {
        while (n.slots.length < n.p.slots) n.slots.push({ item: null, t: 0, done: false });
        while (n.slots.length > n.p.slots) {
          const s = n.slots.pop();
          if (s.item) n.queue.unshift(s.item);
        }
      }
      if (n.kind === 'dock' && n.p.fleet > n.trucksTotal) {
        n.idle += n.p.fleet - n.trucksTotal;
        n.trucksTotal = n.p.fleet;
      }
      if (n.kind === 'split' || n.kind === 'station') {
        n.rule = n.def.route || (st.rules && st.rules[n.id]) || 'alt';
      }
      if (n.kind === 'source') n.throttle = st.throttle && st.throttle[n.id] != null ? st.throttle[n.id] : 1;
    }
    this.sinceChange = 0;
  }

  // ---------- items and value ----------
  newItem(type) {
    return { id: ITEM_ID++, type, born: this.t, fresh: this.t, va: 0, defect: false, d: 0, pop: 1 };
  }
  life(type) {
    const L = this.def.items[type].life;
    return L ? L * this.p.lifeMult : 0;
  }
  freshness(item) {
    const L = this.life(item.type);
    return L ? Math.max(0, 1 - (this.t - item.fresh) / L) : 1;
  }
  value(item) {
    let v = this.def.items[item.type].value * this.p.valueMult;
    if (item.defect) v *= 0.3;
    if (this.life(item.type)) v *= 0.4 + 0.6 * this.freshness(item);
    return v;
  }

  // ---------- money and stats ----------
  earn(amount, n) {
    this.game.earn(amount);
    this.secAcc += amount;
    this.lifetime += amount;
    this.st.earned = (this.st.earned || 0) + amount;
    if (this.viewed && n) n.floatAcc += amount;
  }
  waste(item, x, y, feeRate = 0.25) {
    const fee = this.def.items[item.type].value * this.p.valueMult * feeRate;
    this.game.penalty(fee);
    this.secAcc -= fee;
    this.stats.wasted++;
    this.batch.waste++;
    if (this.viewed) {
      this.fx.push({ kind: 'poof', x, y, t0: this.t, type: item.type });
      this.fx.push({ kind: 'text', x, y: y - 2, t0: this.t, text: '-€', bad: true });
    }
  }
  sold(item) {
    this.stats.sold++;
    const b = this.batch;
    b.n++;
    b.va += item.va;
    b.lead += this.t - item.born;
    if (b.n >= this.def.batchSize) {
      this.batches.push({
        dur: this.t - b.start, n: b.n,
        flow: b.lead > 0 ? b.va / b.lead : 0,
        yield: b.n / (b.n + b.waste),
        end: this.t,
      });
      if (this.batches.length > 12) this.batches.shift();
      this.batch = { start: this.t, n: 0, va: 0, lead: 0, waste: 0 };
    }
  }

  // ---------- routing ----------
  load(node) {
    let l = node.queue.length;
    if (node.slots) for (const s of node.slots) if (s.item) l++;
    if (node.chamber) l += node.chamber.length;
    return l;
  }
  route(n, item) {
    const outs = n.outE;
    if (!outs.length) return null;
    if (outs.length === 1) return outs[0].canAccept() ? outs[0] : null;
    let e;
    switch (n.rule) {
      case 'quality':
        e = item.defect ? outs[1] : outs[0];
        return e.canAccept() ? e : null;
      case 'type':
        e = outs[n.def.types[item.type] || 0];
        return e.canAccept() ? e : null;
      case 'least': {
        let best = null, bl = Infinity;
        for (const o of outs) {
          if (!o.canAccept()) continue;
          const l = o.items.length + this.load(o.to);
          if (l < bl) { bl = l; best = o; }
        }
        return best;
      }
      default: // strict alternate
        e = outs[n.rr % outs.length];
        if (e.canAccept()) { n.rr++; return e; }
        return null;
    }
  }

  offer(n, item) {
    const p = n.p;
    switch (n.kind) {
      case 'station': case 'batch': case 'dock':
        if (n.queue.length < p.queue) { n.queue.push(item); return true; }
        return false;
      case 'assembly': {
        const b = n.buf[item.type];
        if (b && b.length < p.buffer) { b.push(item); return true; }
        return false;
      }
      case 'split': case 'merge': {
        const e = this.route(n, item);
        if (e) { e.push(item); n.doneSec++; return true; }
        return false;
      }
      case 'sink': {
        this.earn(this.value(item), n);
        this.sold(item);
        n.doneSec++;
        return true;
      }
    }
    return false;
  }

  // ---------- main step ----------
  step(dt) {
    this.t += dt;
    const v = this.p.conveyor;
    this.flip = !this.flip;
    const E = this.edges;
    for (let k = 0; k < E.length; k++) this.moveEdge(this.flip ? E[k] : E[E.length - 1 - k], dt, v);
    for (const n of this.nodes) this.updateNode(n, dt);

    this.spoilT += dt;
    if (this.spoilT >= 0.25) { this.spoilT = 0; this.spoilSweep(); }

    this.secT += dt;
    if (this.secT >= 1) {
      this.secT -= 1;
      this.ema += (this.secAcc - this.ema) * (1 - Math.exp(-1 / 45));
      this.secAcc = 0;
      this.sinceChange += 1;
      this.bottleneck = this.findBottleneck();
      if (this.sinceChange > 90) this.st.stable = Math.max(0, this.ema);
      for (const n of this.nodes) {
        n.rate += (n.doneSec - n.rate) * (1 - Math.exp(-1 / 20));
        n.doneSec = 0;
      }
      if (this.fx.length) this.fx = this.fx.filter((f) => this.t - f.t0 < 2);
    }
  }

  moveEdge(e, dt, v) {
    const it = e.items;
    for (let i = 0; i < it.length; i++) {
      const lim = i === 0 ? e.len : it[i - 1].d - SPACING;
      const d = Math.min(it[i].d + v * dt, lim);
      if (d > it[i].d) it[i].d = d;
    }
    if (it.length && it[0].d >= e.len - 1e-6) {
      const n = e.to;
      if (n.inE.length > 1 && n.kind !== 'assembly' && !this.myTurn(n, e)) return;
      if (this.offer(n, it[0])) {
        it.shift();
        if (n.inE.length > 1) n.turn = n.inE.indexOf(e) + 1;
      }
    }
  }

  // Round-robin fairness between belts feeding the same node (avoids one input starving another).
  myTurn(n, e) {
    const k = n.inE.length;
    const start = (n.turn || 0) % k;
    for (let i = 0; i < k; i++) {
      const c = n.inE[(start + i) % k];
      if (c.items.length && c.items[0].d >= c.len - 1e-6) return c === e;
    }
    return true;
  }

  breakdown(n) {
    n.broken = n.p.repair;
    n.wear *= 0.3;
    this.stats.breakdowns++;
    if (this.viewed) this.fx.push({ kind: 'text', x: n.x, y: n.y - 4, t0: this.t, text: 'breakdown', bad: true });
  }

  applyWear(n, dt, busy, pressure) {
    const p = n.p;
    if (!p.wear) return;
    if (busy) n.wear = Math.min(1, n.wear + p.wear * dt * (1 + 6 * pressure * pressure));
    else n.wear = Math.max(0, n.wear - 0.01 * dt);
    if (busy && Math.random() < 0.3 * n.wear * n.wear * n.wear * dt) this.breakdown(n);
  }

  defectRoll(n) {
    const pd = (n.p.defect || 0) + (n.p.wear ? 0.3 * n.wear * n.wear : 0);
    return Math.random() < pd;
  }

  updateNode(n, dt) {
    const p = n.p;
    if (n.floatT > 0) n.floatT -= dt;
    if (n.floatAcc > 0 && n.floatT <= 0 && this.viewed) {
      this.fx.push({ kind: 'text', x: n.x, y: n.y - 3.5, t0: this.t, text: '+€' + fmtShort(n.floatAcc) });
      n.floatAcc = 0;
      n.floatT = 0.7;
    }
    if (n.broken > 0) {
      n.broken -= dt;
      if (n.broken < 0) n.broken = 0;
      n.state = 'broken';
      n.util += (0 - n.util) * dt / 10;
      return;
    }
    switch (n.kind) {
      case 'source': this.updSource(n, dt); break;
      case 'station': this.updStation(n, dt); break;
      case 'batch': this.updBatch(n, dt); break;
      case 'assembly': this.updAssembly(n, dt); break;
      case 'dock': this.updDock(n, dt); break;
      default: return;
    }
    const k = dt / 10;
    n.blk = (n.blk || 0) + ((n.state === 'blocked' ? 1 : 0) - (n.blk || 0)) * k;
    n.qf = (n.qf || 0) + (this.queueFill(n) - (n.qf || 0)) * k;
  }

  queueFill(n) {
    if (n.kind === 'assembly') {
      let m = 1;
      for (const key in n.buf) m = Math.min(m, n.buf[key].length / n.p.buffer);
      return m;
    }
    return n.p.queue ? n.queue.length / n.p.queue : 0;
  }

  // The bottleneck: a node with a full input queue whose own output is not blocked.
  findBottleneck() {
    let best = null, bs = 0;
    for (const n of this.nodes) {
      if (n.kind === 'source' || n.kind === 'sink' || n.kind === 'split' || n.kind === 'merge') continue;
      if ((n.qf || 0) < 0.5 || (n.blk || 0) > 0.3) continue;
      const sc = n.qf + n.util;
      if (sc > bs) { bs = sc; best = n; }
    }
    return best;
  }

  // Supply is pushed by the supplier: items go onto the belt, else into a small stock at the gate,
  // else they are wasted (with a disposal fee). Over-supplying therefore costs money.
  updSource(n, dt) {
    const e = n.outE[0];
    if (n.queue.length && e.canAccept()) { e.push(n.queue.shift()); n.doneSec++; }
    n.acc += n.p.rate * n.throttle * dt;
    let state = n.throttle > 0 ? 'working' : 'idle';
    while (n.acc >= 1) {
      n.acc -= 1;
      const it = this.newItem(n.def.type);
      if (!n.queue.length && e.canAccept()) { e.push(it); n.doneSec++; }
      else if (n.queue.length < n.p.queue) n.queue.push(it);
      else { this.waste(it, n.x, n.y, 0.1); this.stats.overflow++; n.overflow = (n.overflow || 0) + 1; }
    }
    if (n.queue.length >= n.p.queue) state = 'overflow';
    else if (n.queue.length) state = 'blocked';
    n.state = state;
    n.util += ((state === 'working' ? n.throttle : 0) - n.util) * dt / 10;
  }

  updStation(n, dt) {
    const p = n.p;
    let busy = 0, blocked = 0;
    for (const s of n.slots) {
      if (s.item && !s.done) {
        s.t += dt;
        busy++;
        if (s.t >= p.time) {
          s.done = true;
          s.item.va += p.time;
          if (n.def.fix) s.item.defect = false;
          else if (this.defectRoll(n)) s.item.defect = true;
        }
      }
      if (s.item && s.done) {
        if (n.def.scrap && s.item.defect) {
          this.waste(s.item, n.x, n.y);
          s.item = null;
        } else {
          const e = this.route(n, s.item);
          if (e) { e.push(s.item); s.item = null; n.doneSec++; }
          else blocked++;
        }
      }
      if (!s.item && n.queue.length) {
        s.item = n.queue.shift();
        s.t = 0; s.done = false;
      }
    }
    n.state = busy ? 'working' : blocked ? 'blocked' : 'starved';
    n.util += (busy / n.slots.length - n.util) * dt / 10;
    this.applyWear(n, dt, busy > 0, n.queue.length / p.queue);
  }

  updBatch(n, dt) {
    const p = n.p;
    if (n.phase === 'load') {
      while (n.chamber.length < p.cap && n.queue.length) n.chamber.push(n.queue.shift());
      if (n.chamber.length) n.wait += dt;
      if (n.chamber.length >= p.cap || (n.chamber.length && n.wait >= p.maxWait)) {
        n.phase = 'cook'; n.t = 0;
      }
      n.state = n.chamber.length ? 'filling' : 'starved';
      n.util += (0 - n.util) * dt / 10;
    } else if (n.phase === 'cook') {
      n.t += dt;
      n.state = 'working';
      n.util += (1 - n.util) * dt / 10;
      this.applyWear(n, dt, true, n.queue.length / p.queue);
      if (n.t >= p.time) {
        for (const it of n.chamber) {
          it.va += p.time;
          if (n.def.outType) { it.type = n.def.outType; it.fresh = this.t; it.pop = 1; }
        }
        n.phase = 'unload';
      }
    } else {
      while (n.chamber.length) {
        const e = this.route(n, n.chamber[0]);
        if (!e) break;
        e.push(n.chamber.shift());
        n.doneSec++;
      }
      if (!n.chamber.length) { n.phase = 'load'; n.wait = 0; }
      else n.state = 'blocked';
      n.util += (0 - n.util) * dt / 10;
    }
  }

  updAssembly(n, dt) {
    const p = n.p, s = n.slots[0];
    let busy = false;
    if (s.item && !s.done) {
      busy = true;
      s.t += dt;
      if (s.t >= p.time) {
        s.done = true;
        s.item.va += p.time;
        if (this.defectRoll(n)) s.item.defect = true;
      }
    }
    if (s.item && s.done) {
      const e = this.route(n, s.item);
      if (e) { e.push(s.item); s.item = null; n.doneSec++; }
    }
    if (!s.item) {
      const r = n.def.recipe;
      let ok = true;
      for (const k in r) if (n.buf[k].length < r[k]) { ok = false; break; }
      if (ok) {
        const parts = [];
        for (const k in r) parts.push(...n.buf[k].splice(0, r[k]));
        const it = this.newItem(n.def.outType);
        it.born = Math.min(...parts.map((q) => q.born));
        it.va = Math.max(...parts.map((q) => q.va));
        it.defect = parts.some((q) => q.defect);
        s.item = it; s.t = 0; s.done = false;
      }
    }
    n.state = busy ? 'working' : s.item ? 'blocked' : 'starved';
    n.util += ((busy ? 1 : 0) - n.util) * dt / 10;
    let fill = 0, cnt = 0;
    for (const k in n.buf) { fill += n.buf[k].length / p.buffer; cnt++; }
    this.applyWear(n, dt, busy, cnt ? fill / cnt : 0);
  }

  updDock(n, dt) {
    const p = n.p;
    for (const a of n.away) a.t -= dt;
    while (n.away.length && n.away[0].t <= 0) { n.away.shift(); n.idle++; }
    if (n.departing.length && this.t - n.departing[0].t0 > 2) n.departing.shift();
    if (!n.truck && n.idle > 0) {
      n.idle--;
      n.truck = { load: [], loading: [], arrive: 1, cap: p.cap };
    }
    const tr = n.truck;
    if (!tr) {
      n.state = n.queue.length >= p.queue ? 'blocked' : 'waiting';
      n.util += (0 - n.util) * dt / 10;
      return;
    }
    if (tr.arrive > 0) {
      tr.arrive -= dt;
      n.state = 'waiting';
      return;
    }
    while (tr.loading.length < p.loaders && n.queue.length && tr.load.length + tr.loading.length < tr.cap) {
      const idx = tr.load.length + tr.loading.length;
      tr.loading.push({ item: n.queue.shift(), idx, t: 0, dur: p.loadBase + p.loadDist * (1 - idx / tr.cap) });
    }
    for (let i = tr.loading.length - 1; i >= 0; i--) {
      const L = tr.loading[i];
      L.t += dt;
      if (L.t >= L.dur) {
        tr.loading.splice(i, 1);
        L.item.slot = L.idx;
        L.item.val = this.value(L.item);
        tr.load.push(L.item);
      }
    }
    if (!tr.loading.length && !n.queue.length) n.idleT += dt; else n.idleT = 0;
    n.state = tr.loading.length ? 'working' : 'starved';
    n.util += ((tr.loading.length ? 1 : 0) - n.util) * dt / 10;
    if (tr.load.length >= tr.cap || (tr.load.length && !tr.loading.length && n.idleT > 20)) {
      let total = 0;
      for (const it of tr.load) { total += it.val; this.sold(it); }
      this.earn(total, n);
      n.doneSec += tr.load.length;
      n.away.push({ t: p.trip, total: p.trip });
      n.departing.push({ t0: this.t, items: tr.load, cap: tr.cap });
      n.truck = null;
      n.idleT = 0;
    }
  }

  spoilSweep() {
    const t = this.t;
    const check = (arr, x, y) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        const L = this.life(it.type);
        if (L && t - it.fresh > L) {
          arr.splice(i, 1);
          const pos = x == null ? it._edge.pointAt(it.d) : [x, y];
          this.waste(it, pos[0], pos[1]);
        }
      }
    };
    for (const e of this.edges) {
      for (const it of e.items) it._edge = e;
      check(e.items);
    }
    for (const n of this.nodes) {
      if (n.queue.length) check(n.queue, n.x, n.y);
      if (n.chamber && n.phase === 'load') check(n.chamber, n.x, n.y);
      if (n.buf) for (const k in n.buf) check(n.buf[k], n.x, n.y);
    }
  }

  // Snapshot of KPIs for UI.
  kpi() {
    const b = this.batches;
    const last = b.slice(-5);
    const avg = (f) => (last.length ? last.reduce((a, x) => a + f(x), 0) / last.length : 0);
    return {
      rateMin: this.ema * 60,
      batchDur: avg((x) => x.dur),
      flow: avg((x) => x.flow),
      yield: last.length ? avg((x) => x.yield) : 1,
      eff: last.length ? avg((x) => x.flow * x.yield) : 0,
      progress: this.batch.n / this.def.batchSize,
      count: b.length,
    };
  }
}

function fmtShort(n) {
  if (n < 10) return n.toFixed(2);
  if (n < 1000) return n.toFixed(0);
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];
  let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(1) : n.toFixed(0)) + u[i];
}
