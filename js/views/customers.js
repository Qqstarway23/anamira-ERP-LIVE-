// Customers: the generic list plus statement of account and "read passport / ID" (MRZ) to fill the form.
import { html, icon, $ } from '../util.js';
import { t } from '../i18n.js';
import { actBtn, openModal, closeModal, toast } from '../ui.js';
import { recordsView } from './records.js';
import { openStatement } from './accounts.js';
import { S } from '../store.js';

// ── MRZ (machine readable zone) of passports (TD3, 2×44) and ID cards such as the Emirates ID (TD1, 3×30) ──
const VAL = (c) => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55);
export const mrzCheck = (s) => s.split('').reduce((a, c, i) => a + VAL(c) * [7, 3, 1][i % 3], 0) % 10;
const okDigit = (field, digit) => digit === '<' ? /^<*$/.test(field) : mrzCheck(field) === +digit;
// YYMMDD → ISO date. Birth dates are in the past; expiry dates may be up to ~30 years ahead.
function mrzDate(s, kind) {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = +s.slice(0, 2); const now = new Date().getFullYear() % 100;
  const century = kind === 'birth' ? (yy > now ? 1900 : 2000) : (yy < 70 ? 2000 : 1900);
  const d = `${century + yy}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return isNaN(new Date(d)) ? null : d;
}
const clean = (s) => s.replace(/<+/g, ' ').trim();
const names = (s) => { const [sur, giv = ''] = s.split('<<'); return [clean(giv), clean(sur)].filter(Boolean).join(' '); };
const NATIONS = { ARE: 'UAE', IND: 'India', PAK: 'Pakistan', GBR: 'UK', USA: 'USA', PHL: 'Philippines', EGY: 'Egypt', JOR: 'Jordan', RUS: 'Russia', SAU: 'Saudi Arabia', LBN: 'Lebanon', SYR: 'Syria', BGD: 'Bangladesh', LKA: 'Sri Lanka', NPL: 'Nepal', CHN: 'China', FRA: 'France', DEU: 'Germany', ITA: 'Italy', CAN: 'Canada', AUS: 'Australia', KEN: 'Kenya', NGA: 'Nigeria', IRN: 'Iran', IRQ: 'Iraq', OMN: 'Oman', QAT: 'Qatar', KWT: 'Kuwait', BHR: 'Bahrain', TUR: 'Turkey', UKR: 'Ukraine', ZAF: 'South Africa' };
const nation = (c) => NATIONS[c] || c;

export function parseMrz(text) {
  const lines = String(text || '').toUpperCase().replace(/[ \t]/g, '').replace(/«/g, '<').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Z0-9<]{25,}$/.test(l));
  const warn = [];
  if (lines.length >= 2 && lines.some((l) => l.length === 44)) {
    const i = lines.findIndex((l) => l.length === 44 && l[0] === 'P'); const l1 = lines[i >= 0 ? i : 0]; const l2 = lines[(i >= 0 ? i : 0) + 1];
    if (!l2 || l2.length !== 44) throw new Error(t('Could not read the passport lines.'));
    const no = l2.slice(0, 9); const dob = l2.slice(13, 19); const exp = l2.slice(21, 27);
    if (!okDigit(no, l2[9])) warn.push(t('Passport number check digit does not match'));
    if (!okDigit(dob, l2[19])) warn.push(t('Date of birth check digit does not match'));
    if (!okDigit(exp, l2[27])) warn.push(t('Expiry check digit does not match'));
    return { data: { full_name: names(l1.slice(5)), passport_number: clean(no).replace(/ /g, ''), nationality: nation(l2.slice(10, 13).replace(/</g, '')),
      date_of_birth: mrzDate(dob, 'birth'), passport_expiry: mrzDate(exp, 'expiry') }, warn, kind: 'passport' };
  }
  if (lines.length >= 3 && lines.slice(0, 3).every((l) => l.length === 30)) {
    const [l1, l2, l3] = lines;
    const doc = l1.slice(5, 14); const opt = clean(l1.slice(15, 30)).replace(/ /g, ''); const dob = l2.slice(0, 6); const exp = l2.slice(8, 14);
    if (!okDigit(doc, l1[14])) warn.push(t('Document number check digit does not match'));
    if (!okDigit(dob, l2[6])) warn.push(t('Date of birth check digit does not match'));
    if (!okDigit(exp, l2[14])) warn.push(t('Expiry check digit does not match'));
    const eid = /^784\d{12}$/.test(opt) ? `${opt.slice(0, 3)}-${opt.slice(3, 7)}-${opt.slice(7, 14)}-${opt.slice(14)}` : '';
    return { data: { full_name: names(l3), id_number: eid || clean(doc).replace(/ /g, ''), nationality: nation(l2.slice(15, 18).replace(/</g, '')),
      date_of_birth: mrzDate(dob, 'birth'), id_expiry: mrzDate(exp, 'expiry') }, warn, kind: 'id' };
  }
  throw new Error(t('Paste the 2 lines at the bottom of a passport, or the 3 lines on the back of an ID card.'));
}

// Fill the open customer form (only fields that are empty, unless the user agrees to overwrite).
function readDocument(form) {
  const w = openModal({
    title: html`${icon('scan-line')} ${t('Read passport or ID')}`,
    body: html`<p class="muted small">${t('Type or paste the machine-readable lines (the rows with <<< at the bottom of the passport page, or on the back of the Emirates ID). A document scanner in keyboard mode can type them here.')}</p>
      <form class="form" data-mrz><div class="fld span"><textarea name="mrz" rows="4" class="mono" spellcheck="false" placeholder="P<AREAL<MANSOORI<<OMAR<<<<<<<<<<<<<<<<<<<<<<&#10;N1234567<6ARE8001019M3001016<<<<<<<<<<<<<<04"></textarea></div>
      <div class="form-error" hidden></div><div class="form-actions"><button type="button" class="btn ghost" data-close>${t('Cancel')}</button><button class="btn primary" type="submit">${icon('check')} ${t('Fill the form')}</button></div></form>`,
  });
  // The customer form stays in the page underneath: keep a copy of its values and restore them in a new modal after reading.
  $('[data-mrz]', w).addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const { data, warn } = parseMrz(e.target.mrz.value);
      closeModal();
      form(data);
      if (warn.length) toast(warn.join(' · '), 'err'); else toast(t('Filled from the document. Please check.'));
    } catch (ex) { const er = $('.form-error', w); er.textContent = ex.message; er.hidden = false; }
  });
}

export function mountCustomers(root, params) {
  let v;
  const formWithDoc = (row) => html`<p class="muted small">${icon('id-card')} <button type="button" class="link" data-doc>${t('Read passport or ID')}</button> ${t('to fill name, number, nationality and dates.')}</p>`;
  v = recordsView('customers', {
    formExtra: formWithDoc,
    onFormMount: (w, row) => {
      w.addEventListener('click', (e) => {
        if (!e.target.closest('[data-doc]')) return;
        const f = $('form', w); const saved = Object.fromEntries([...new FormData(f)].map(([k, val]) => [k, val]));
        f.querySelectorAll('input[type=checkbox]').forEach((c) => { saved[c.name] = c.checked; });
        readDocument((data) => {
          const merged = { ...(row || {}), ...saved };
          for (const [k, val] of Object.entries(data)) if (val && !merged[k]) merged[k] = val; else if (val && k.endsWith('expiry')) merged[k] = val;
          if (row) v.openForm({ ...row, ...merged }); else v.openForm(null, merged);
        });
      });
    },
    rowActions: (c) => html`${actBtn('stmt', c.id, 'scroll', 'Statement of account')}${S.can('rentals', 'write') && !c.blacklisted ? html`<a class="icon-btn" href="#/rentals?new=1&customer=${c.id}" title="${t('New rental')}" aria-label="${t('New rental')}">${icon('key-round')}</a>` : ''}`,
  });
  v.wire(root, { stmt: (id) => openStatement('customers', id) });
  v.render(root);
  if (params?.get('new') && S.can('customers', 'write')) v.openForm(null);
  return () => v.render(root);
}
