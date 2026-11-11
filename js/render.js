// Canvas renderer for one factory. World coords (100 x 56) are fitted to the canvas;
// on portrait screens the layout is transposed so the flow goes top -> bottom.

import { NODE_DIM, ITEM_R, SPACING } from './sim.js';
import { ITEM_STYLE } from './levels.js';

const TAU = Math.PI * 2;

function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.frame = 0;
    this.sel = null;
    this.readTheme();
  }

  readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const get = (k) => hexToRgb(cs.getPropertyValue('--' + k).trim() || '#888');
    this.C = {};
    for (const k of ['bg', 'fg', 'muted', 'belt', 'tick', 'node', 'node2', 'stroke', 'accent', 'warn', 'bad', 'good', 'spoil']) this.C[k] = get(k);
    this.IC = {};
    for (const k of ['teal', 'coral', 'violet', 'sand', 'amber', 'blue', 'ice', 'gold', 'pink']) this.IC[k] = get('i-' + k);
    this.font = cs.getPropertyValue('--font').trim() || 'system-ui, sans-serif';
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.layout();
    this.frame += 2; // force items to snap to new positions
  }

  // World bounding box of a factory (nodes + queues above + labels below + trucks).
  bbox(f) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of f.nodes) {
      const [w, h] = NODE_DIM[n.kind];
      const top = { station: 6.5, batch: 6.5, dock: 6.5, assembly: 10, source: 4.5 }[n.kind] || 0;
      x0 = Math.min(x0, n.x - w / 2 - 1);
      x1 = Math.max(x1, n.kind === 'dock' ? n.x + 19.5 : n.x + w / 2 + 1);
      y0 = Math.min(y0, n.y - h / 2 - top);
      y1 = Math.max(y1, n.y + h / 2 + 3.5);
    }
    for (const e of f.edges) for (const [x, y] of e.pts) {
      x0 = Math.min(x0, x - 2); x1 = Math.max(x1, x + 2); y0 = Math.min(y0, y - 2); y1 = Math.max(y1, y + 2);
    }
    return [x0, y0, x1, y1];
  }

  layout() {
    if (!this.f || !this.W) return;
    const [x0, y0, x1, y1] = this.bbox(this.f);
    const bw = x1 - x0, bh = y1 - y0, pad = 12;
    const W = this.W - 2 * pad, H = this.H - 2 * pad;
    // pick the orientation that gives the largest scale; cap so small factories don't look huge
    const sN = Math.min(W / bw, H / bh), sT = Math.min(W / bh, H / bw);
    this.tr = sT > sN * 1.08;
    const cap = Math.min(this.W, this.H) / 30;
    this.s = Math.max(0.5, Math.min(this.tr ? sT : sN, Math.max(cap, 9)));
    const ww = (this.tr ? bh : bw) * this.s, wh = (this.tr ? bw : bh) * this.s;
    this.bx = x0; this.by = y0;
    this.ox = (this.W - ww) / 2;
    this.oy = (this.H - wh) / 2;
    this.gw = this.W / this.s; this.gh = this.H / this.s;
  }

  P(x, y) {
    x -= this.bx; y -= this.by;
    return this.tr ? [this.ox + y * this.s, this.oy + x * this.s] : [this.ox + x * this.s, this.oy + y * this.s];
  }
  dims(kind) {
    const [w, h] = NODE_DIM[kind];
    return this.tr ? [h * this.s, w * this.s] : [w * this.s, h * this.s];
  }
  rectW(x0, y0, x1, y1) {
    const a = this.P(x0, y0), b = this.P(x1, y1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
  }

  stateColor(st) {
    const C = this.C;
    switch (st) {
      case 'working': return C.accent;
      case 'blocked': return C.warn;
      case 'broken': case 'overflow': return C.bad;
      case 'filling': return mix(C.accent, C.muted, 0.5);
      default: return C.muted;
    }
  }

  hit(f, sx, sy) {
    let best = null, bd = Infinity;
    for (const n of f.nodes) {
      const [x, y] = this.P(n.x, n.y);
      const [w, h] = this.dims(n.kind);
      let dx = Math.abs(sx - x) - w / 2, dy = Math.abs(sy - y) - h / 2;
      if (n.kind === 'dock') {
        const [rx, ry, rw, rh] = this.truckRect(n, 0);
        if (sx >= rx && sx <= rx + rw && sy >= ry && sy <= ry + rh) return n;
      }
      const d = Math.max(dx, dy);
      if (d < 8 && d < bd) { bd = d; best = n; }
    }
    return best;
  }

  truckRect(n, off) {
    return this.rectW(n.x + 3.2 + off, n.y - 3.3, n.x + 19 + off, n.y + 3.3);
  }

  // ---------- items ----------
  itemColor(f, it) {
    const st = ITEM_STYLE[it.type];
    let c = this.IC[st.color];
    const L = f.life(it.type);
    if (L) c = mix(c, this.C.spoil, Math.min(1, (f.t - it.fresh) / L) * 0.85);
    return c;
  }

  drawItem(f, it, tx, ty, scale = 1) {
    const ctx = this.ctx;
    const k = this.k;
    if (it._f !== this.frame - 1 && it._f !== this.frame) { it.sx = tx; it.sy = ty; }
    else { it.sx += (tx - it.sx) * k; it.sy += (ty - it.sy) * k; }
    it._f = this.frame;
    if (it.pop > 0) it.pop = Math.max(0, it.pop - this.dt * 3);
    const r = ITEM_R * this.s * scale * (1 + 0.5 * (it.pop || 0));
    const c = this.itemColor(f, it);
    shape(ctx, ITEM_STYLE[it.type].shape, it.sx, it.sy, r);
    ctx.fillStyle = rgb(c);
    ctx.fill();
    if (it.defect) {
      ctx.lineWidth = Math.max(1, r * 0.3);
      ctx.strokeStyle = rgb(this.C.bad, 0.9);
      ctx.stroke();
    }
  }

  // ---------- main draw ----------
  draw(f, dt) {
    const ctx = this.ctx, C = this.C, s = this.s;
    if (f !== this.f) { this.f = f; this.layout(); this.frame += 2; }
    this.frame++;
    this.dt = dt;
    this.k = 1 - Math.exp(-dt * 16);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = rgb(C.bg);
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawGrid();

    // belts
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const e of f.edges) {
      ctx.beginPath();
      e.pts.forEach(([x, y], i) => { const [a, b] = this.P(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.strokeStyle = rgb(C.belt);
      ctx.lineWidth = 2.1 * s;
      ctx.stroke();
      // jammed belt: front item waiting at the end and the belt packed
      const it = e.items;
      if (it.length && it[0].d >= e.len - 1e-6) {
        const full = it.length >= Math.floor(e.len / SPACING);
        ctx.strokeStyle = rgb(C.warn, full ? 0.32 : 0.12);
        ctx.stroke();
      }
      ctx.setLineDash([0.18 * s, 1.1 * s]);
      ctx.lineDashOffset = -((f.t * f.p.conveyor * s) % (1.28 * s));
      ctx.strokeStyle = rgb(C.tick);
      ctx.lineWidth = 1.2 * s;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const n of f.nodes) this.drawNode(f, n);
    if (f.bottleneck) this.tag(f.bottleneck, 'bottleneck');

    for (const e of f.edges) {
      for (const it of e.items) {
        const [x, y] = e.pointAt(it.d);
        const [a, b] = this.P(x, y);
        this.drawItem(f, it, a, b);
      }
    }
    this.drawFx(f);
  }

  drawGrid() {
    const ctx = this.ctx, s = this.s;
    ctx.fillStyle = rgb(this.C.tick, 0.35);
    const step = 4 * s;
    const r = Math.max(0.6, s * 0.08);
    const sx = ((this.ox % step) + step) % step, sy = ((this.oy % step) + step) % step;
    for (let x = sx; x < this.W; x += step) {
      for (let y = sy; y < this.H; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
  }

  rr(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  nodeBox(n, fillCol) {
    const ctx = this.ctx, s = this.s;
    const [cx, cy] = this.P(n.x, n.y);
    const [w, h] = this.dims(n.kind);
    const x = cx - w / 2, y = cy - h / 2;
    const sc = this.stateColor(n.state);
    const selected = this.sel === n;
    if (selected) {
      ctx.save();
      ctx.shadowColor = rgb(this.C.accent, 0.55);
      ctx.shadowBlur = 18;
    }
    this.rr(x, y, w, h, 1.1 * s);
    ctx.fillStyle = rgb(fillCol || this.C.node);
    ctx.fill();
    if (selected) ctx.restore();
    let a = 1;
    if (n.state === 'broken') a = 0.55 + 0.45 * Math.sin(performance.now() / 120);
    ctx.lineWidth = (selected ? 0.45 : 0.28) * s;
    ctx.strokeStyle = rgb(sc, a);
    ctx.stroke();
    return { cx, cy, w, h, x, y };
  }

  label(n, b) {
    const ctx = this.ctx;
    const fs = Math.max(10, Math.min(14, this.s * 1.7));
    ctx.font = `500 ${fs}px ${this.font}`;
    ctx.fillStyle = rgb(this.C.muted);
    if (this.tr) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(n.def.label || n.id, b.cx + b.w / 2 + 0.8 * this.s, b.cy);
    } else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(n.def.label || n.id, b.cx, b.cy + b.h / 2 + 0.8 * this.s);
    }
  }

  // Grid of waiting items on the input side of a node (above it, or left of it when transposed),
  // with faint dots for free capacity and a pressure bar. Returns the depth used (px).
  queueGrid(f, items, cap, b, off = 0, cols = 6) {
    const ctx = this.ctx, s = this.s, tr = this.tr;
    const cell = 1.55 * s;
    const shown = Math.min(cap, 48);
    cols = Math.min(cols, Math.max(1, shown));
    const rows = Math.ceil(shown / cols);
    const span = cols * cell;
    const pos = (i) => {
      const a = i % cols, r = Math.floor(i / cols);
      return tr ? [b.x - off - cell * (r + 0.5) - 0.2 * s, b.cy - span / 2 + cell * (a + 0.5)]
        : [b.cx - span / 2 + cell * (a + 0.5), b.y - off - cell * (r + 0.5) - 0.2 * s];
    };
    for (let i = 0; i < shown; i++) {
      const [x, y] = pos(i);
      if (i < items.length) this.drawItem(f, items[i], x, y, 0.85);
      else {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, 0.18 * s), 0, TAU);
        ctx.fillStyle = rgb(this.C.muted, 0.35);
        ctx.fill();
      }
    }
    if (items.length > shown) {
      const [x, y] = pos(shown - 1);
      for (let i = shown; i < items.length; i++) { items[i].sx = x; items[i].sy = y; items[i]._f = this.frame; }
    }
    const depth = rows * cell + 0.7 * s;
    if (cap > 0) {
      const fill = Math.min(1, items.length / cap);
      const col = rgb(fill > 0.85 ? this.C.warn : this.C.accent, 0.8);
      ctx.fillStyle = rgb(this.C.belt);
      if (tr) {
        const x = b.x - off - depth, y = b.cy - span / 2;
        ctx.fillRect(x, y, 0.3 * s, span);
        ctx.fillStyle = col; ctx.fillRect(x, y + span * (1 - fill), 0.3 * s, span * fill);
      } else {
        const x = b.cx - span / 2, y = b.y - off - depth;
        ctx.fillRect(x, y, span, 0.3 * s);
        ctx.fillStyle = col; ctx.fillRect(x, y, span * fill, 0.3 * s);
      }
    }
    return { depth: depth + 0.3 * s, span };
  }

  wearBar(n, x, y, w, h) {
    if (!n.p.wear) return;
    const ctx = this.ctx, s = this.s;
    const c = mix(this.C.good, this.C.bad, Math.min(1, n.wear * 1.6));
    ctx.fillStyle = rgb(c, 0.85);
    ctx.fillRect(x + 0.8 * s, y + h - 0.65 * s, (w - 1.6 * s) * n.wear, 0.28 * s);
  }

  drawNode(f, n) {
    const ctx = this.ctx, s = this.s, C = this.C;
    const p = n.p;
    switch (n.kind) {
      case 'source': {
        const [cx, cy] = this.P(n.x, n.y);
        const r = 2.6 * s;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
        ctx.fillStyle = rgb(C.node); ctx.fill();
        ctx.lineWidth = (this.sel === n ? 0.45 : 0.28) * s;
        ctx.strokeStyle = rgb(this.stateColor(n.state), n.state === 'overflow' ? 0.55 + 0.45 * Math.sin(performance.now() / 120) : 1); ctx.stroke();
        // throttle arc
        ctx.beginPath();
        ctx.arc(cx, cy, r + 0.7 * s, -Math.PI / 2, -Math.PI / 2 + TAU * n.throttle);
        ctx.strokeStyle = rgb(C.accent, 0.5); ctx.lineWidth = 0.3 * s; ctx.stroke();
        shape(ctx, ITEM_STYLE[n.def.type].shape, cx, cy, 1.1 * s);
        ctx.fillStyle = rgb(this.IC[ITEM_STYLE[n.def.type].color]); ctx.fill();
        const box = { cx, cy, w: 2 * r, h: 2 * r, x: cx - r, y: cy - r };
        this.queueGrid(f, n.queue, p.queue, box, 0.6 * s, 6);
        this.label(n, box);
        break;
      }
      case 'sink': {
        const [cx, cy] = this.P(n.x, n.y);
        const r = 2.6 * s;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
        ctx.fillStyle = rgb(C.node); ctx.fill();
        ctx.lineWidth = 0.28 * s; ctx.strokeStyle = rgb(C.good); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, TAU);
        ctx.strokeStyle = rgb(C.good, 0.5); ctx.stroke();
        ctx.font = `600 ${Math.max(10, s * 1.8)}px ${this.font}`;
        ctx.fillStyle = rgb(C.good); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('€', cx, cy + 0.1 * s);
        this.label(n, { cx, cy, w: 2 * r, h: 2 * r });
        break;
      }
      case 'split': case 'merge': {
        const [cx, cy] = this.P(n.x, n.y);
        ctx.beginPath(); ctx.arc(cx, cy, 1.3 * s, 0, TAU);
        ctx.fillStyle = rgb(this.sel === n ? C.accent : C.stroke); ctx.fill();
        break;
      }
      case 'station': {
        const b = this.nodeBox(n);
        const k = n.slots.length;
        const inner = b.w - 1.6 * s;
        for (let i = 0; i < k; i++) {
          const sl = n.slots[i];
          const sx = b.x + 0.8 * s + inner * (i + 0.5) / k;
          const sy = b.cy - 0.35 * s;
          // progress bar
          const pw = Math.min(inner / k - 0.4 * s, 3.2 * s);
          ctx.fillStyle = rgb(C.belt);
          ctx.fillRect(sx - pw / 2, b.cy + 1.1 * s, pw, 0.3 * s);
          if (sl.item) {
            const prog = sl.done ? 1 : Math.min(1, sl.t / p.time);
            ctx.fillStyle = rgb(sl.done ? C.warn : C.accent);
            ctx.fillRect(sx - pw / 2, b.cy + 1.1 * s, pw * prog, 0.3 * s);
            this.drawItem(f, sl.item, sx, sy, 1.05);
          } else {
            ctx.beginPath(); ctx.arc(sx, sy, 0.3 * s, 0, TAU);
            ctx.fillStyle = rgb(C.muted, 0.4); ctx.fill();
          }
        }
        this.wearBar(n, b.x, b.y, b.w, b.h);
        if (n.def.route === 'quality' || n.def.scrap) this.badge(b, '✓');
        if (n.def.fix) this.badge(b, '↺');
        this.queueGrid(f, n.queue, p.queue, b);
        this.label(n, b);
        break;
      }
      case 'batch': {
        const b = this.nodeBox(n, n.phase === 'cook' ? mix(C.node, C.warn, 0.12) : C.node);
        if (n.phase === 'cook') {
          ctx.fillStyle = rgb(C.warn, 0.18);
          this.rr(b.x, b.y, b.w * Math.min(1, n.t / p.time), b.h, 1.1 * s);
          ctx.fill();
        } else if (n.phase === 'load' && n.chamber.length) {
          ctx.fillStyle = rgb(C.muted, 0.5);
          ctx.fillRect(b.x + 0.8 * s, b.y + b.h - 0.6 * s, (b.w - 1.6 * s) * Math.min(1, n.wait / p.maxWait), 0.25 * s);
        }
        const cap = n.phase === 'load' ? p.cap : Math.max(n.chamber.length, 1);
        const rows = 2, cols = Math.ceil(Math.max(cap, p.cap) / rows);
        const cw = (b.w - 1.4 * s) / cols, ch = (b.h - 1.6 * s) / rows;
        for (let i = 0; i < Math.max(p.cap, n.chamber.length); i++) {
          const x = b.x + 0.7 * s + cw * ((i % cols) + 0.5);
          const y = b.y + 0.7 * s + ch * (Math.floor(i / cols) + 0.5);
          if (i < n.chamber.length) this.drawItem(f, n.chamber[i], x, y, Math.min(1, cw / (2.2 * s)));
          else { ctx.beginPath(); ctx.arc(x, y, 0.2 * s, 0, TAU); ctx.fillStyle = rgb(C.muted, 0.35); ctx.fill(); }
        }
        this.wearBar(n, b.x, b.y, b.w, b.h);
        this.queueGrid(f, n.queue, p.queue, b, 0, p.queue > 12 ? 8 : 6);
        this.label(n, b);
        break;
      }
      case 'assembly': {
        const b = this.nodeBox(n);
        const sl = n.slots[0];
        const pw = 3.6 * s;
        ctx.fillStyle = rgb(C.belt);
        ctx.fillRect(b.cx - pw / 2, b.cy + 1.5 * s, pw, 0.3 * s);
        if (sl.item) {
          ctx.fillStyle = rgb(sl.done ? C.warn : C.accent);
          ctx.fillRect(b.cx - pw / 2, b.cy + 1.5 * s, pw * (sl.done ? 1 : Math.min(1, sl.t / p.time)), 0.3 * s);
          this.drawItem(f, sl.item, b.cx, b.cy - 0.2 * s, 1.25);
        } else {
          shape(ctx, ITEM_STYLE[n.def.outType].shape, b.cx, b.cy - 0.2 * s, ITEM_R * s * 1.2);
          ctx.strokeStyle = rgb(C.muted, 0.5); ctx.lineWidth = 0.15 * s; ctx.stroke();
        }
        this.wearBar(n, b.x, b.y, b.w, b.h);
        // input bins stacked above, one row group per input type
        let off = 0;
        for (const key of Object.keys(n.buf).reverse()) {
          const q = this.queueGrid(f, n.buf[key], p.buffer, b, off, 7);
          // small type marker with recipe count
          const [mx, my] = this.tr ? [b.x - off - 0.9 * s, b.cy - q.span / 2 - 1.1 * s]
            : [b.cx - q.span / 2 - 1.2 * s, b.y - off - 0.95 * s];
          shape(ctx, ITEM_STYLE[key].shape, mx, my, 0.45 * s);
          ctx.fillStyle = rgb(C.muted, 0.7); ctx.fill();
          ctx.font = `500 ${Math.max(9, s * 1.1)}px ${this.font}`;
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText('×' + n.def.recipe[key], mx - 0.7 * s, my);
          off += q.depth + 0.8 * s;
        }
        this.label(n, b);
        break;
      }
      case 'dock': return this.drawDock(f, n);
    }
  }

  tag(n, txt) {
    const ctx = this.ctx, s = this.s;
    const [cx, cy] = this.P(n.x, n.y);
    const [w, h] = this.dims(n.kind);
    const fs = Math.max(9, Math.min(12, s * 1.3));
    ctx.font = `600 ${fs}px ${this.font}`;
    ctx.fillStyle = rgb(this.C.warn);
    if (this.tr) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(txt, cx + w / 2 + 0.8 * s, cy + 0.9 * s); }
    else { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(txt, cx, cy + h / 2 + 0.8 * s + fs * 1.25); }
  }

  badge(b, txt) {
    const ctx = this.ctx, s = this.s;
    ctx.font = `600 ${Math.max(9, s * 1.2)}px ${this.font}`;
    ctx.fillStyle = rgb(this.C.muted);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(txt, b.x + b.w - 0.5 * s, b.y + 0.35 * s);
  }

  drawDock(f, n) {
    const ctx = this.ctx, s = this.s, C = this.C, p = n.p;
    const b = this.nodeBox(n);
    // fleet dots
    const total = n.trucksTotal;
    for (let i = 0; i < total; i++) {
      const x = b.cx + (i - (total - 1) / 2) * 1.2 * s;
      const y = b.cy + 1.6 * s;
      ctx.beginPath(); ctx.arc(x, y, 0.38 * s, 0, TAU);
      const awayCount = n.away.length;
      if (i < awayCount) { ctx.strokeStyle = rgb(C.muted); ctx.lineWidth = 0.15 * s; ctx.stroke(); }
      else { ctx.fillStyle = rgb(C.accent); ctx.fill(); }
    }
    // next truck countdown
    if (!n.truck && n.away.length) {
      const a = n.away[0];
      ctx.beginPath();
      ctx.arc(b.cx, b.cy - 0.6 * s, 1.2 * s, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - a.t / a.total));
      ctx.strokeStyle = rgb(C.accent, 0.7); ctx.lineWidth = 0.3 * s; ctx.stroke();
    }
    this.queueGrid(f, n.queue, p.queue, b, 0, p.queue > 12 ? 7 : 5);
    this.label(n, b);

    for (const d of n.departing) {
      const age = f.t - d.t0;
      const off = age * age * 6;
      this.drawTruck(f, n, off, Math.max(0, 1 - age / 1.6), d.items, [], d.cap);
    }
    const tr = n.truck;
    if (tr) {
      const off = tr.arrive > 0 ? tr.arrive * tr.arrive * 10 : 0;
      this.drawTruck(f, n, off, tr.arrive > 0 ? 1 - tr.arrive : 1, tr.load, tr.loading, tr.cap);
    }
  }

  drawTruck(f, n, off, alpha, load, loading, cap) {
    const ctx = this.ctx, s = this.s, C = this.C;
    ctx.save();
    ctx.globalAlpha = alpha;
    const bodyEnd = 16.2;
    const [bx, by, bw, bh] = this.rectW(n.x + 3.2 + off, n.y - 3.1, n.x + bodyEnd + off, n.y + 3.1);
    this.rr(bx, by, bw, bh, 0.8 * s);
    ctx.fillStyle = rgb(C.node2); ctx.fill();
    ctx.strokeStyle = rgb(C.stroke); ctx.lineWidth = 0.22 * s; ctx.stroke();
    const [cx, cy, cw, ch] = this.rectW(n.x + bodyEnd + 0.5 + off, n.y - 2.2, n.x + 19 + off, n.y + 2.2);
    this.rr(cx, cy, cw, ch, 0.8 * s);
    ctx.fillStyle = rgb(C.stroke); ctx.fill();
    // slots: deepest first (far end), door side last
    const rows = 3, cols = Math.ceil(cap / rows);
    const len = bodyEnd - 3.2 - 1.2, cell = Math.min(len / cols, 5.4 / rows);
    const slotPos = (idx) => {
      const col = cols - 1 - Math.floor(idx / rows), row = idx % rows;
      const x = n.x + 3.8 + off + (len - cols * cell) + cell * (col + 0.5);
      const y = n.y - (rows * cell) / 2 + cell * (row + 0.5);
      return this.P(x, y);
    };
    const sc = Math.min(1, cell / 1.7);
    for (let i = load.length; i < cap; i++) {
      const [x, y] = slotPos(i);
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, 0.15 * s), 0, TAU);
      ctx.fillStyle = rgb(C.muted, 0.35); ctx.fill();
    }
    for (const it of load) {
      const [x, y] = slotPos(it.slot);
      this.drawItem(f, it, x, y, sc);
    }
    for (const L of loading) {
      const [tx, ty] = slotPos(L.idx);
      const [dx, dy] = this.P(n.x + 2.6 + off, n.y);
      const u = Math.min(1, L.t / L.dur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      L.item._f = this.frame; // driven directly, no smoothing
      L.item.sx = dx + (tx - dx) * e; L.item.sy = dy + (ty - dy) * e;
      const r = ITEM_R * s * sc;
      shape(ctx, ITEM_STYLE[L.item.type].shape, L.item.sx, L.item.sy, r);
      ctx.fillStyle = rgb(this.itemColor(f, L.item)); ctx.fill();
    }
    ctx.restore();
  }

  drawFx(f) {
    const ctx = this.ctx, s = this.s, C = this.C;
    for (const fx of f.fx) {
      const age = f.t - fx.t0;
      if (age > 1.6) continue;
      const [x, y] = this.P(fx.x, fx.y);
      if (fx.kind === 'poof') {
        const u = age / 0.8;
        if (u > 1) continue;
        ctx.beginPath(); ctx.arc(x, y, (0.8 + 2.6 * u) * s, 0, TAU);
        ctx.strokeStyle = rgb(C.bad, 0.6 * (1 - u)); ctx.lineWidth = 0.25 * s; ctx.stroke();
      } else {
        const u = age / 1.6;
        ctx.font = `600 ${Math.max(10, s * 1.45)}px ${this.font}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = rgb(fx.bad ? C.bad : C.good, 1 - u * u);
        ctx.fillText(fx.text, x, y - u * 2.5 * s);
      }
    }
  }
}

export function shape(ctx, kind, x, y, r) {
  ctx.beginPath();
  switch (kind) {
    case 'circle': ctx.arc(x, y, r, 0, TAU); break;
    case 'square': { const a = r * 0.88; ctx.roundRect ? ctx.roundRect(x - a, y - a, 2 * a, 2 * a, r * 0.25) : ctx.rect(x - a, y - a, 2 * a, 2 * a); break; }
    case 'triangle': poly(ctx, x, y + r * 0.12, r * 1.15, 3, -Math.PI / 2); break;
    case 'diamond': poly(ctx, x, y, r * 1.1, 4, -Math.PI / 2); break;
    case 'hexagon': poly(ctx, x, y, r * 1.05, 6, 0); break;
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.55 : r * 1.15;
        i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    }
    default: ctx.arc(x, y, r, 0, TAU);
  }
}

function poly(ctx, x, y, r, n, a0) {
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * TAU) / n;
    i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}
