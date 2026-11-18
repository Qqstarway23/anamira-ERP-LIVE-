import { ICONS } from './icons.js';

// ── Safe HTML ────────────────────────────────────────────────────────────────
// Every interpolated value is escaped unless it is itself the result of html``/raw().
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}
export const mount = (el, view) => { el.innerHTML = part(view); };

// ── DOM ──────────────────────────────────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const icon = (name, cls = '') =>
  raw(`<svg class="ic ${esc(cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);

// ── Formatting ───────────────────────────────────────────────────────────────
export const num = (v) => (Number.isFinite(+v) ? +v : 0);
export const round2 = (v) => Math.round(num(v) * 100) / 100;
let currency = 'AED';
export const setCurrency = (c) => { currency = c || 'AED'; };
export const money = (v, withCur = true) => {
  const s = num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withCur ? `${currency} ${s}` : s;
};
export const pad = (n) => String(n).padStart(2, '0');
export const toDate = (v) => (v ? new Date(v) : null);
export const fmtDate = (v) => {
  const d = toDate(v); if (!d || isNaN(d)) return '—';
  return `${pad(d.getDate())} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
};
export const fmtDateTime = (v) => {
  const d = toDate(v); if (!d || isNaN(d)) return '—';
  return `${fmtDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// Value for <input type="datetime-local"> in the user's local time
export const localInput = (v) => {
  const d = toDate(v); if (!d || isNaN(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const dateInput = (v) => {
  const d = toDate(v); if (!d || isNaN(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const todayISO = () => dateInput(new Date());
export const daysUntil = (v) => {
  const d = toDate(v); if (!d) return null;
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
};
export const plate = (v) => (v ? `${v.plate_code ? v.plate_code + ' ' : ''}${v.plate_number}` : '—');
export const carName = (v) => (v ? `${v.make} ${v.model}` : '—');

// ── Misc ─────────────────────────────────────────────────────────────────────
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const uuid = () => crypto.randomUUID();
export const byId = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r]));
export const sum = (rows, f) => round2((rows || []).reduce((a, r) => a + num(typeof f === 'function' ? f(r) : r[f]), 0));
export const groupBy = (rows, f) => (rows || []).reduce((m, r) => { const k = f(r); (m[k] ||= []).push(r); return m; }, {});
export const matches = (row, q, keys) => !q || keys.some((k) => String(typeof k === 'function' ? k(row) : row[k] ?? '').toLowerCase().includes(q));
export const csv = (rows, cols) => {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // block spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => cell(c.label)).join(','), ...rows.map((r) => cols.map((c) => cell(c.csv ? c.csv(r) : r[c.key])).join(','))].join('\n');
};
export const download = (name, text, type = 'text/csv') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
