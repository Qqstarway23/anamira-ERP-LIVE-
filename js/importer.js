// Reads fines and Salik statements exported from the official portals (Salik, Dubai Police, RTA, other emirates)
// and turns them into rows for public.import_fines(). Works with CSV, Excel .xlsx, and rows pasted from Excel.
// No dependencies: .xlsx is unzipped with the browser's DecompressionStream.

export const FIELDS = [
  { key: 'reference', label: 'Reference' },
  { key: 'date', label: 'Date', req: true },
  { key: 'time', label: 'Time' },
  { key: 'plate', label: 'Plate (code and number together)' },
  { key: 'plate_code', label: 'Plate code' },
  { key: 'plate_number', label: 'Plate number' },
  { key: 'amount', label: 'Amount', req: true },
  { key: 'source', label: 'Authority' },
  { key: 'location', label: 'Location' },
  { key: 'description', label: 'Description' },
  { key: 'black_points', label: 'Black points' },
];

// Header words, in priority order: the first rule that fits a column wins, and each field takes one column.
const RULES = [
  ['black_points', /black|points|نقاط|النقاط/],
  ['reference', /(trans(action)?|trip|ticket|fine|violation|penalty|reference|ref|receipt)[\s._-]*(id|no\b|no\.|num|number|#)|^ref\b|reference|رقم المخالفة|رقم المعاملة|رقم الرحلة/],
  ['plate_code', /plate[\s._-]*(code|letter)|^code$|^category$|رمز|الفئة/],
  ['plate_number', /plate[\s._-]*(no\b|no\.|num|number|#)|رقم اللوحة/],
  ['plate', /plate|vehicle|لوحة|اللوحة|المركبة/],
  ['location', /gate|location|place|road|street|area|الموقع|البوابة|المكان/],
  ['amount', /amount|toll|value|charge|aed|price|المبلغ|القيمة|قيمة/],
  ['source', /source|authority|emirate|issued|issuer|جهة|الإمارة|الامارة/],
  ['date', /date|تاريخ|التاريخ/],
  ['time', /time|وقت|الوقت/],
  ['description', /description|violation|offen[cs]e|type|details|reason|المخالفة|الوصف/],
];

// ── Reading files ─────────────────────────────────────────────────────────────
export async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new Error('Old .xls files cannot be read. Open the file in Excel and save it as .xlsx or CSV.');
  if (name.endsWith('.pdf')) throw new Error('PDF statements cannot be read. Download the Excel or CSV version of the statement instead.');
  if (name.endsWith('.xlsx')) return readXlsx(await file.arrayBuffer());
  return parseText(await file.text());
}

export function parseText(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/).slice(0, 20).join('\n');
  const count = (c) => (first.match(new RegExp(c === '\t' ? '\t' : `\\${c}`, 'g')) || []).length;
  const delim = ['\t', ',', ';', '|'].sort((a, b) => count(b) - count(a))[0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx file.');
  const total = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {}; const dec = new TextDecoder();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true); const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true); const extraLen = dv.getUint16(p + 30, true); const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files[name] = { method, size, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const f = files[name]; if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const data = u8.subarray(start, start + f.size);
    return dec.decode(f.method === 0 ? data : await inflate(data));
  };
}

const colIndex = (ref) => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

export async function readXlsx(buf) {
  const get = await unzip(buf);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const text = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');
  const ssXml = await get('xl/sharedStrings.xml');
  const shared = ssXml ? [...xml(ssXml).getElementsByTagName('si')].map(text) : [];
  // First sheet in workbook order
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml'); const rels = await get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : `xl/${t}`; }
  }
  const sheet = await get(sheetPath);
  if (!sheet) throw new Error('No worksheet found in this file.');
  const rows = [];
  for (const r of xml(sheet).getElementsByTagName('row')) {
    const out = [];
    for (const c of r.getElementsByTagName('c')) {
      const i = colIndex(c.getAttribute('r') || 'A'); const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val = type === 's' ? shared[+v] ?? '' : type === 'inlineStr' ? text(c) : v;
      if (type !== 's' && type !== 'inlineStr' && type !== 'str' && v !== '' && !isNaN(+v)) val = +v;
      out[i] = val;
    }
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
    rows.push(out.map((c) => (typeof c === 'string' ? c.trim() : c)));
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

// ── Column detection ─────────────────────────────────────────────────────────
function mapHeader(header) {
  const map = {};
  header.forEach((h, i) => {
    const s = String(h ?? '').toLowerCase().trim(); if (!s) return;
    for (const [key, re] of RULES) {
      if (map[key] !== undefined || !re.test(s)) continue;
      if (key === 'time' && /date|تاريخ/.test(s)) continue;
      map[key] = i; break;
    }
  });
  return map;
}

export function detect(rows) {
  let best = { headerIndex: 0, map: {}, score: -1 };
  rows.slice(0, 15).forEach((r, i) => {
    const map = mapHeader(r);
    const score = Object.keys(map).length + (map.date !== undefined ? 2 : 0) + (map.amount !== undefined ? 2 : 0)
      + (map.plate !== undefined || map.plate_number !== undefined ? 2 : 0);
    if (score > best.score) best = { headerIndex: i, map, score };
  });
  return best;
}

// ── Values ───────────────────────────────────────────────────────────────────
const EMIRATE_WORDS = /^(DUBAI|DXB|DU|AD|AUH|ABUDHABI|ABU|DHABI|SHJ|SHARJAH|SH|AJM|AJMAN|AJ|UAQ|UMMALQUWAIN|RAK|RASALKHAIMAH|FUJ|FUJAIRAH|FJ|PRIVATE|PVT|UAE)$/;
export function splitPlate(s) {
  const tokens = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  let number = ''; let code = '';
  for (const t of tokens) {
    const glued = t.match(/^([A-Z]{1,2})(\d{1,6})$/) || t.match(/^(\d{1,6})([A-Z]{1,2})$/);
    if (glued && !number) { const [a, b] = /^\d/.test(glued[1]) ? [glued[2], glued[1]] : [glued[1], glued[2]]; code = a; number = b; continue; }
    if (/^\d{3,6}$/.test(t) && (!number || t.length > number.length)) { if (number && !code && number.length <= 2) code = number; number = t; continue; }
    if (!code && !EMIRATE_WORDS.test(t) && /^([A-Z]{1,2}|\d{1,2})$/.test(t)) code = t;
  }
  return { plate_code: code, plate_number: number };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, '0');

function serialToParts(n) { // Excel serial date (days since 1899-12-30), in local (Dubai) time
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

function parseTime(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') { const secs = Math.round((v % 1) * 86400); return { h: Math.floor(secs / 3600), mi: Math.floor(secs / 60) % 60, s: secs % 60 }; }
  const m = String(v).trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm]|ص|م)?/);
  if (!m) return null;
  let h = +m[1]; const ap = (m[4] || '').toLowerCase();
  if ((ap === 'pm' || ap === 'م') && h < 12) h += 12;
  if ((ap === 'am' || ap === 'ص') && h === 12) h = 0;
  return { h, mi: +m[2], s: +(m[3] || 0) };
}

// Returns an ISO timestamp in Dubai time (+04:00), or null.
export function parseWhen(dateV, timeV) {
  let parts = null;
  if (typeof dateV === 'number' && dateV > 20000 && dateV < 80000) parts = serialToParts(dateV);
  else {
    const s = String(dateV ?? '').trim().replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660);
    if (!s) return null;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/);
    if (iso) { const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? null : d.toISOString(); }
    let m = null;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) parts = { y: +m[1], m: +m[2], d: +m[3] };
    else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
      let [a, b] = [+m[1], +m[2]];
      if (b > 12 && a <= 12) [a, b] = [b, a]; // month-first export
      parts = { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: b, d: a };
    } else if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{2,4})/))) {
      parts = { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: MONTHS[m[2].toLowerCase()], d: +m[1] };
    } else if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/))) {
      parts = { y: +m[3], m: MONTHS[m[1].toLowerCase()], d: +m[2] };
    }
    if (!parts || !parts.m) return null;
    Object.assign(parts, parseTime(s.slice(m[0].length)) || {});
  }
  const t = parseTime(timeV); if (t) Object.assign(parts, t);
  const { y, m, d, h = 0, mi = 0, s = 0 } = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59 || y < 2000 || y > 2100) return null;
  const out = new Date(`${y}-${p2(m)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(s)}+04:00`);
  return isNaN(out) ? null : out.toISOString();
}

export function parseAmount(v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v ?? '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660).replace(/[^0-9.\-]/g, '');
  if (!s || isNaN(+s)) return null;
  return Math.round(Math.abs(+s) * 100) / 100;
}

export function guessKind(defaultKind, source, description) {
  const s = `${source || ''} ${description || ''}`.toLowerCase();
  if (defaultKind !== 'auto') return defaultKind;
  if (/salik|سالك|toll/.test(s)) return 'salik';
  if (/parking|mawaqif|مواقف/.test(s)) return 'parking';
  return 'traffic';
}

// rows → [{ kind, source, reference, plate_code, plate_number, occurred_at, location, description, amount, black_points, error }]
export function toFines(rows, headerIndex, map, { kind = 'auto', source = '' } = {}) {
  const at = (r, k) => (map[k] === undefined || map[k] === '' ? '' : r[+map[k]] ?? '');
  return rows.slice(headerIndex + 1).map((r) => {
    const plate = map.plate !== undefined && map.plate !== '' ? splitPlate(at(r, 'plate')) : { plate_code: '', plate_number: '' };
    if (at(r, 'plate_number') !== '') plate.plate_number = String(at(r, 'plate_number')).replace(/\D/g, '');
    if (at(r, 'plate_code') !== '') plate.plate_code = String(at(r, 'plate_code')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const src = String(at(r, 'source') || source || '').slice(0, 60);
    const desc = String(at(r, 'description')).slice(0, 300);
    const f = {
      kind: guessKind(kind, src, desc), source: src,
      reference: String(at(r, 'reference')).slice(0, 60),
      ...plate,
      occurred_at: parseWhen(at(r, 'date'), at(r, 'time')),
      location: String(at(r, 'location')).slice(0, 120), description: desc,
      amount: parseAmount(at(r, 'amount')),
      black_points: Math.max(0, Math.min(24, parseInt(at(r, 'black_points'), 10) || 0)),
    };
    f.error = !f.plate_number ? 'No plate number' : !f.occurred_at ? 'Date not understood' : f.amount == null ? 'No amount' : '';
    return f;
  }).filter((f) => f.plate_number || f.occurred_at); // drop totals and blank lines
}

export const TEMPLATE = 'Reference,Date,Time,Plate code,Plate number,Amount,Authority,Location,Description,Black points\n'
  + 'DP-1234567,19/11/2026,14:35,D,87201,600,Dubai Police,Sheikh Zayed Road,Exceeding the speed limit by 30 km/h,0\n'
  + 'SLK-889120,19/11/2026,08:12,G,18703,4,Salik,Al Maktoum Bridge,Toll trip,0\n';
