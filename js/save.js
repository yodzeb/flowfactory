// Persistence in localStorage. Only upgrade state is saved; the live items in a factory are not
// (factories restart empty and refill within a minute; offline earnings use the stable rate).

const KEY = 'flowfactory.v1';

export function newFac(owned) {
  return { owned, lv: {}, conveyor: 0, modern: 0, throttle: {}, rules: {}, stable: 0, earned: 0 };
}

export function defaultState() {
  const now = Date.now();
  return {
    v: 1, cash: 0, total: 0, global: {},
    fac: { l1: newFac(true) },
    view: 'l1', theme: null, t: now, started: now,
  };
}

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return s;
  } catch (e) { /* ignore */ }
  return null;
}

export function save(state) {
  state.t = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
