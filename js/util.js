// Small shared helpers (number formatting, math).

const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td'];

export function fmt(n) {
  if (!isFinite(n)) return '∞';
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (n < 1000) {
    s = n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0);
  } else {
    let i = -1;
    while (n >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
    if (n >= 1000) return (neg ? '-' : '') + (n * 1000 ** (i + 1)).toExponential(2);
    s = (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)) + UNITS[i];
  }
  return (neg ? '-' : '') + s;
}

export const money = (n) => '€' + fmt(n);

export function fmtTime(s) {
  s = Math.max(0, s);
  if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + String(Math.floor(s % 60)).padStart(2, '0') + 's';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm';
  return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const pct = (v) => Math.round(v * 100) + '%';
