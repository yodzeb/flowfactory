// Upgrade definitions, costs, and translation of upgrade levels into simulation parameters.
// All balance knobs live here (and in levels.js for per-level numbers).

export const UPG = {
  speed:   { name: 'Speed',       desc: 'Faster processing (+15% per level)', base: 6,   g: 1.16, max: 25 },
  slots:   { name: 'Workers',     desc: 'One more parallel work slot',        base: 50,  g: 3.2,  max: 4 },
  queue:   { name: 'Buffer',      desc: 'More places in the input queue',     base: 12,  g: 1.4,  max: 12 },
  maint:   { name: 'Maintenance', desc: 'Less wear, faster repairs',          base: 25,  g: 1.4,  max: 10 },
  // Supply: +15%/level up to 22, then each of the last 3 levels is a big ×1.28 jump (and costs ×3 more).
  // Fully upgraded supply exceeds what a fully upgraded line can absorb: the throttle must be managed.
  rate:    { name: 'Supply',      desc: 'More raw material per minute',       base: 6,   g: 1.16, max: 25, late: { from: 22, mult: 1.28, cost: 3 } },
  bcap:    { name: 'Batch size',  desc: '+2 items per batch',                 base: 30,  g: 1.6,  max: 8 },
  tcap:    { name: 'Truck size',  desc: '+4 items per truck',                 base: 30,  g: 1.55, max: 8 },
  loaders: { name: 'Loaders',     desc: 'One more loader working in parallel', base: 40, g: 2.6,  max: 4 },
  lspeed:  { name: 'Forklifts',   desc: 'Faster loading (+15% per level)',    base: 8,   g: 1.17, max: 25 },
  trip:    { name: 'Route',       desc: 'Shorter truck round trip (+15%)',    base: 20,  g: 1.3,  max: 12 },
  fleet:   { name: 'Fleet',       desc: 'One more truck',                     base: 80,  g: 3,    max: 4 },
  buffer:  { name: 'Stock bins',  desc: '+2 places per input bin',            base: 15,  g: 1.5,  max: 6 },
  conveyor:{ name: 'Conveyors',   desc: 'All belts +10% faster',              base: 15,  g: 1.25, max: 15 },
};

export const NODE_UPGRADES = {
  source: ['rate'],
  station: ['speed', 'slots', 'queue', 'maint'],
  batch: ['speed', 'bcap', 'queue', 'maint'],
  assembly: ['speed', 'buffer', 'maint'],
  dock: ['lspeed', 'loaders', 'tcap', 'trip', 'fleet', 'queue'],
};

export function nodeUpgrades(def) {
  const list = NODE_UPGRADES[def.kind] || [];
  return list.filter((k) => k !== 'maint' || def.wear > 0);
}

// Global (HQ) upgrades, paid in absolute euros, apply to every factory.
export const GLOBAL = {
  training:    { name: 'Training',     desc: '+6% processing speed everywhere', base: 2e3,  g: 3.2, max: 25 },
  logistics:   { name: 'Logistics',    desc: '+8% belt, truck and supply speed',        base: 3e3,  g: 3.2, max: 25 },
  marketing:   { name: 'Marketing',    desc: '+10% sale value',                 base: 5e3,  g: 3.4, max: 40 },
  reliability: { name: 'Reliability',  desc: '-8% machine wear',                base: 8e3,  g: 3.3, max: 20 },
  cold:        { name: 'Cold storage', desc: '+12% shelf life',                 base: 1.2e4, g: 3.3, max: 20 },
  quality:     { name: 'Quality',      desc: '-10% defects',                    base: 1.5e4, g: 3.3, max: 20 },
};

export const MODERNIZE_MASTERY = 0.7;   // fraction of all local upgrade levels required
export const MODERNIZE_VALUE = 2;       // sale value multiplier per modernization
export const MODERNIZE_COST = 1.3;      // local upgrade cost multiplier per modernization
export const OFFLINE_CAP = 6 * 3600;    // seconds

export function upgCost(key, lvl, costMult) {
  const u = UPG[key];
  let c = u.base * costMult * Math.pow(u.g, lvl);
  if (u.late && lvl >= u.late.from) c *= Math.pow(u.late.cost, lvl - u.late.from + 1);
  return c;
}

// True when buying the next level of `key` is one of the big late jumps.
export function isLateJump(key, lvl) {
  const u = UPG[key];
  return !!(u.late && lvl >= u.late.from && lvl < u.max);
}

// `jump` (per source, see levels.js) overrides the size of the late jumps.
export function supplyMult(L, jump) {
  const late = UPG.rate.late;
  return (1 + 0.15 * Math.min(L, late.from)) * Math.pow(jump || late.mult, Math.max(0, L - late.from));
}

export function globalCost(key, lvl) {
  const u = GLOBAL[key];
  return u.base * Math.pow(u.g, lvl);
}

export function globalEffects(g) {
  const L = (k) => g[k] || 0;
  return {
    train: 1 + 0.06 * L('training'),
    logi: 1 + 0.08 * L('logistics'),
    market: 1 + 0.1 * L('marketing'),
    rel: Math.pow(0.92, L('reliability')),
    cold: 1 + 0.12 * L('cold'),
    qual: Math.pow(0.9, L('quality')),
  };
}

// Fraction of local upgrade levels bought (used to unlock modernization).
export function mastery(def, st) {
  let have = 0, max = 0;
  for (const n of def.nodes) {
    for (const k of nodeUpgrades(n)) {
      max += UPG[k].max;
      have += (st.lv[n.id] && st.lv[n.id][k]) || 0;
    }
  }
  max += UPG.conveyor.max;
  have += st.conveyor || 0;
  return max ? have / max : 0;
}

export function factoryCostMult(def, st) {
  return def.valueMult * Math.pow(MODERNIZE_COST, st.modern || 0);
}

// Translate upgrade levels into runtime params for one node.
export function nodeParams(def, lv, G) {
  const L = (k) => lv[k] || 0;
  const p = {};
  const speed = (1 + 0.15 * L('speed')) * G.train;
  const maint = Math.pow(0.82, L('maint'));
  switch (def.kind) {
    case 'source':
      p.rate = def.rate * supplyMult(L('rate'), def.jump) * G.logi;
      p.queue = def.stock || 6;   // small stock at the gate; beyond it, delivered supply is wasted
      break;
    case 'station':
      p.time = def.time / speed;
      p.slots = (def.slots || 1) + L('slots');
      p.queue = (def.queue || 4) + 2 * L('queue');
      p.wear = (def.wear || 0) * maint * G.rel;
      p.repair = (def.repair || 6) * Math.pow(0.9, L('maint'));
      p.defect = (def.defect || 0) * G.qual;
      break;
    case 'batch':
      p.time = def.time / speed;
      p.cap = def.cap + 2 * L('bcap');
      p.queue = (def.queue || 6) + 4 * L('queue');   // batch processes need bigger buffers
      p.maxWait = def.maxWait || 8;
      p.wear = (def.wear || 0) * maint * G.rel;
      p.repair = (def.repair || 8) * Math.pow(0.9, L('maint'));
      break;
    case 'assembly':
      p.time = def.time / speed;
      p.buffer = (def.buffer || 3) + 2 * L('buffer');
      p.wear = (def.wear || 0) * maint * G.rel;
      p.repair = (def.repair || 6) * Math.pow(0.9, L('maint'));
      p.defect = (def.defect || 0) * G.qual;
      break;
    case 'dock':
      p.cap = def.cap + 4 * L('tcap');
      p.loaders = 1 + L('loaders');
      p.trip = def.trip / ((1 + 0.15 * L('trip')) * G.logi);
      p.fleet = 1 + L('fleet');
      p.lspeed = (1 + 0.15 * L('lspeed')) * G.train;
      p.loadBase = def.loadBase / p.lspeed;
      p.loadDist = def.loadDist / p.lspeed;
      p.queue = (def.queue || 8) + 2 * L('queue');
      break;
  }
  return p;
}
