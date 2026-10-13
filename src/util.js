'use strict';

// ---- Safe HTML templating -------------------------------------------------
// `html` escapes every interpolated value unless it is already a SafeHtml.
// Arrays are flattened, null/undefined/false render as nothing.
class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new SafeHtml(out);
}
const raw = (s) => new SafeHtml(String(s));

// ---- Time -----------------------------------------------------------------
const DAY = 86400000;
const HOUR = 3600000;
const iso = (d = new Date()) => new Date(d).toISOString();
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / DAY;
const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / HOUR;
const dateOnly = (d) => iso(d).slice(0, 10);

// ---- Tags (stored as comma-separated strings) -----------------------------
const tags = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const toTags = (v, allowed) => {
  const list = Array.isArray(v) ? v : tags(v);
  const uniq = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
  return (allowed ? uniq.filter((x) => allowed.includes(x)) : uniq).join(',');
};

// ---- Numbers --------------------------------------------------------------
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 0) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

module.exports = {
  html, raw, escape, SafeHtml, iso, addDays, daysBetween, hoursBetween, dateOnly,
  DAY, HOUR, tags, toTags, clamp, avg, median, round,
};
