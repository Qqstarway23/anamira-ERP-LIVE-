// Machine readable zone (MRZ) of passports (TD3, 2 lines × 44) and ID cards such as the Emirates ID (TD1, 3 lines × 30).
// parseMrz() reads typed, pasted or camera-read (OCR) text. OCR mistakes such as O for 0 are repaired by position,
// and a line with one or two characters too many or too few is fixed by trying the variants whose check digits pass.
import { t } from './i18n.js';

const VAL = (c) => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55);
export const mrzCheck = (s) => s.split('').reduce((a, c, i) => a + VAL(c) * [7, 3, 1][i % 3], 0) % 10;
const okDigit = (field, digit) => (digit === '<' ? /^<*$/.test(field) : /\d/.test(digit) && mrzCheck(field) === +digit);

// ── OCR repair ───────────────────────────────────────────────────────────────
const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', Z: '2', S: '5', G: '6', B: '8', T: '7', A: '4' };
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B' };
// Character classes by position: d digit, D digit or <, a letter or <, x anything, s sex.
const fix = (s, pattern) => s.split('').map((c, i) => {
  const p = pattern[i] || 'x';
  if (p === 'd') return TO_DIGIT[c] || c;
  if (p === 'D') return c === '<' ? c : TO_DIGIT[c] || c;
  if (p === 'a') return TO_LETTER[c] || c;
  if (p === 's') return c === '<' ? c : { '0': 'M', 'H': 'M', 'N': 'M', 'P': 'F', 'E': 'F' }[c] || c;
  return c;
}).join('');
const TD1 = {
  l1: (s) => 'aaaaa' + (s.slice(2, 5) === 'ARE' ? 'DDDDDDDDDd' + 'DDDDDDDDDDDDDDD' : 'xxxxxxxxxd' + 'xxxxxxxxxxxxxxx'),
  l2: () => 'ddddddds' + 'ddddddd' + 'aaa' + 'xxxxxxxxxxx' + 'd',
  l3: () => 'a'.repeat(30),
};
const TD3 = { l1: () => 'Pa' + 'a'.repeat(42), l2: () => 'xxxxxxxxxd' + 'aaa' + 'ddddddd' + 's' + 'ddddddd' + 'x'.repeat(14) + 'Dd' };

// Variants of a line with up to two characters removed (too long) or '<' fillers added (too short).
function variants(s, n) {
  if (s.length === n) return [s];
  if (s.length > n + 2 || s.length < n - 2) return [];
  if (s.length < n) {
    const out = [s.padEnd(n, '<')];
    if (s.length === n - 1) for (let i = 0; i <= s.length; i++) out.push(s.slice(0, i) + '<' + s.slice(i));
    return out;
  }
  const out = new Set();
  for (let i = 0; i < s.length; i++) {
    const a = s.slice(0, i) + s.slice(i + 1);
    if (a.length === n) out.add(a); else for (let j = 0; j < a.length; j++) out.add(a.slice(0, j) + a.slice(j + 1));
  }
  return [...out];
}

// The candidates that score highest on their own check digits, those needing the fewest character fixes first.
const changes = (a, b) => a.split('').filter((c, i) => c !== b[i]).length;
const top = (raw, n, pattern, score) => {
  const cands = variants(raw, n).map((v) => { const s = fix(v, pattern(v)); return { s, sc: score(s), ch: changes(v, s) }; });
  const m = Math.max(-1, ...cands.map((c) => c.sc));
  return m < 0 ? [] : cands.filter((c) => c.sc === m).sort((a, b) => a.ch - b.ch).slice(0, 60).map((c) => c.s);
};

function repairTd1(raw) {
  const [r1, r2, r3] = raw;
  const c1 = top(r1, 30, TD1.l1, (s) => (/[IAC]/.test(s[0]) ? 1 : 0) + (okDigit(s.slice(5, 14), s[14]) ? 4 : 0));
  const c2 = top(r2, 30, TD1.l2, (s) => (okDigit(s.slice(0, 6), s[6]) ? 4 : 0) + (okDigit(s.slice(8, 14), s[14]) ? 4 : 0) + (/[MFX<]/.test(s[7]) ? 1 : 0));
  // The overall check digit spans lines 1 and 2, so it picks between candidates that tie on their own checks.
  let pick = null;
  for (const a of c1) for (const b of c2) {
    if (!pick && okDigit(a.slice(5, 30) + b.slice(0, 7) + b.slice(8, 15) + b.slice(18, 29), b[29])) pick = [a, b];
  }
  if (!pick && c1.length && c2.length) pick = [c1[0], c2[0]];
  const l3 = fix((r3.length > 30 ? r3.slice(0, 30) : r3.padEnd(30, '<')), TD1.l3());
  return pick ? [...pick, l3] : null;
}
function repairTd3(raw) {
  const [r1, r2] = raw;
  const l1 = fix((r1.length > 44 ? r1.slice(0, 44) : r1.padEnd(44, '<')), TD3.l1());
  const [l2] = top(r2, 44, TD3.l2, (s) => (okDigit(s.slice(0, 9), s[9]) ? 4 : 0) + (okDigit(s.slice(13, 19), s[19]) ? 4 : 0) + (okDigit(s.slice(21, 27), s[27]) ? 4 : 0)
    + (okDigit(s.slice(0, 10) + s.slice(13, 20) + s.slice(21, 43), s[43]) ? 2 : 0));
  return l2 ? [l1, l2] : null;
}

// Pick the MRZ lines out of free text (typed, or OCR output with noise lines around them) and repair them.
export function mrzLines(text) {
  const rows = String(text || '').toUpperCase().replace(/[«‹]/g, '<').replace(/[ \t]/g, '').split(/\r?\n/).map((l) => l.replace(/[^A-Z0-9<]/g, '')).filter((l) => l.length >= 2);
  // Passport: a line starting with P (typed ones may leave out the trailing <<<) and a line about 44 long under it
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i][0] === 'P' && rows[i].length >= 10 && rows[i].length <= 46 && rows[i + 1].length >= 42 && rows[i + 1].length <= 46) { const r = repairTd3([rows[i], rows[i + 1]]); if (r) return { kind: 'passport', lines: r }; }
  }
  // ID card: two lines about 30 long, then the name line (padded if typed short)
  for (let i = 0; i < rows.length - 1; i++) {
    if ([rows[i], rows[i + 1]].every((l) => l.length >= 28 && l.length <= 32) && /^[IAC1L]/.test(rows[i])) {
      const r = repairTd1([rows[i], rows[i + 1], rows[i + 2] || '']); if (r) return { kind: 'id', lines: r };
    }
  }
  return null;
}

// YYMMDD → ISO date. Birth dates are in the past; expiry dates may be up to ~30 years ahead.
function mrzDate(s, kind) {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = +s.slice(0, 2); const now = new Date().getFullYear() % 100;
  const century = kind === 'birth' ? (yy > now ? 1900 : 2000) : (yy < 70 ? 2000 : 1900);
  const d = `${century + yy}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  const dt = new Date(d);
  return isNaN(dt) || dt.toISOString().slice(0, 10) !== d ? null : d;
}
const clean = (s) => s.replace(/<+/g, ' ').trim();
const names = (s) => { const [sur, giv = ''] = s.split('<<'); return [clean(giv), clean(sur)].filter(Boolean).join(' '); };
const NATIONS = { ARE: 'UAE', IND: 'India', PAK: 'Pakistan', GBR: 'UK', USA: 'USA', PHL: 'Philippines', EGY: 'Egypt', JOR: 'Jordan', RUS: 'Russia', SAU: 'Saudi Arabia', LBN: 'Lebanon', SYR: 'Syria', BGD: 'Bangladesh', LKA: 'Sri Lanka', NPL: 'Nepal', CHN: 'China', FRA: 'France', DEU: 'Germany', D: 'Germany', ITA: 'Italy', CAN: 'Canada', AUS: 'Australia', KEN: 'Kenya', NGA: 'Nigeria', IRN: 'Iran', IRQ: 'Iraq', OMN: 'Oman', QAT: 'Qatar', KWT: 'Kuwait', BHR: 'Bahrain', TUR: 'Turkey', UKR: 'Ukraine', ZAF: 'South Africa', YEM: 'Yemen', SDN: 'Sudan', MAR: 'Morocco', TUN: 'Tunisia', DZA: 'Algeria', AFG: 'Afghanistan', ETH: 'Ethiopia', UGA: 'Uganda', IDN: 'Indonesia', VNM: 'Vietnam', THA: 'Thailand', KAZ: 'Kazakhstan', UZB: 'Uzbekistan', ESP: 'Spain', NLD: 'Netherlands', IRL: 'Ireland', BRA: 'Brazil', MEX: 'Mexico' };
const nation = (c) => NATIONS[c] || c;
// 784-YYYY-NNNNNNN-C
export const formatEid = (s) => { const d = String(s || '').replace(/\D/g, ''); return /^784\d{12}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}` : ''; };

// → { data: {full_name, passport_number|id_number, nationality, date_of_birth, passport_expiry|id_expiry, gender}, warn: [...], kind, valid, lines }
export function parseMrz(text) {
  const found = mrzLines(text);
  if (!found) throw new Error(t('Paste the 2 lines at the bottom of a passport, or the 3 lines on the back of an ID card.'));
  const warn = [];
  if (found.kind === 'passport') {
    const [l1, l2] = found.lines;
    const no = l2.slice(0, 9); const dob = l2.slice(13, 19); const exp = l2.slice(21, 27);
    if (!okDigit(no, l2[9])) warn.push(t('Passport number check digit does not match'));
    if (!okDigit(dob, l2[19])) warn.push(t('Date of birth check digit does not match'));
    if (!okDigit(exp, l2[27])) warn.push(t('Expiry check digit does not match'));
    const composite = okDigit(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), l2[43]);
    return { data: { full_name: names(l1.slice(5)), passport_number: clean(no).replace(/ /g, ''), nationality: nation(l2.slice(10, 13).replace(/</g, '')),
      date_of_birth: mrzDate(dob, 'birth'), passport_expiry: mrzDate(exp, 'expiry'), gender: l2[20] }, warn, kind: 'passport', valid: !warn.length && composite, lines: found.lines };
  }
  const [l1, l2, l3] = found.lines;
  const doc = l1.slice(5, 14); const opt = clean(l1.slice(15, 30)).replace(/ /g, ''); const dob = l2.slice(0, 6); const exp = l2.slice(8, 14);
  if (!okDigit(doc, l1[14])) warn.push(t('Document number check digit does not match'));
  if (!okDigit(dob, l2[6])) warn.push(t('Date of birth check digit does not match'));
  if (!okDigit(exp, l2[14])) warn.push(t('Expiry check digit does not match'));
  const composite = okDigit(l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29), l2[29]);
  if (!warn.length && !composite) warn.push(t('Overall check digit does not match'));
  const eid = formatEid(opt);
  return { data: { full_name: names(l3), id_number: eid || clean(doc).replace(/ /g, ''), nationality: nation(l2.slice(15, 18).replace(/</g, '')),
    date_of_birth: mrzDate(dob, 'birth'), id_expiry: mrzDate(exp, 'expiry'), gender: l2[7] }, warn, kind: 'id', valid: !warn.length, lines: found.lines, eid };
}
