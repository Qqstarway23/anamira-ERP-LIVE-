// "Import statement" on the Fines & Salik page: read an official export, check the columns, preview, import, match.
import { html, icon, $, mount, money, fmtDateTime, download } from '../util.js';
import { t } from '../i18n.js';
import { openModal, closeModal, toast, badge, plateTag } from '../ui.js';
import { S, reload } from '../store.js';
import { FIELDS, readFile, parseText, detect, toFines, TEMPLATE } from '../importer.js';

const KINDS = [['auto', 'Detect from each row'], ['salik', 'Salik trips and Salik fines'], ['traffic', 'Traffic fines (Police / RTA)'], ['parking', 'Parking fines']];
const SOURCES = ['Salik', 'Dubai Police', 'RTA', 'Abu Dhabi Police', 'Sharjah Police', 'Ajman Police', 'Umm Al Quwain Police', 'Ras Al Khaimah Police', 'Fujairah Police'];
const CHUNK = 1000;

export function openFinesImport() {
  const st = { rows: null, headerIndex: 0, map: {}, kind: 'auto', source: '', fileName: '' };

  const w = openModal({
    title: t('Import statement'), wide: true,
    body: html`<div class="form import">
      <p class="muted small">${icon('info')} Download the statement from the Salik business account, Dubai Police, RTA or another emirate's portal as Excel (.xlsx) or CSV, then drop it here. You can also copy the rows in Excel and paste them below. Rows already in the system are skipped, and every new row is matched to the rental that had the car at that time.</p>
      <div class="grid-form">
        <div class="fld"><label for="imp-kind">${t('Statement type')}</label><select id="imp-kind">${KINDS.map(([v, l]) => html`<option value="${v}">${t(l)}</option>`)}</select></div>
        <div class="fld"><label for="imp-src">${t('Authority')}</label><input id="imp-src" list="imp-src-list" maxlength="60" placeholder="${t('Taken from the file when it has a column for it')}" autocomplete="off">
          <datalist id="imp-src-list">${SOURCES.map((s) => html`<option value="${s}"></option>`)}</datalist></div>
        <div class="fld"><label for="imp-file">${t('File (.xlsx or .csv)')}</label><input type="file" id="imp-file" accept=".xlsx,.csv,.txt,.tsv,.xls,.pdf"></div>
        <div class="fld"><label>&nbsp;</label><button type="button" class="btn ghost" data-template>${icon('download')} ${t('Download a blank template')}</button></div>
        <div class="fld span"><label for="imp-paste">${t('Or paste rows from Excel (with the header row)')}</label><textarea id="imp-paste" rows="3" maxlength="2000000"></textarea></div>
      </div>
      <div data-preview></div>
      <div class="form-error" hidden></div>
      <div class="form-actions"><button type="button" class="btn ghost" data-close>${t('Cancel')}</button>
        <button type="button" class="btn primary" data-go disabled>${icon('check')} ${t('Import and match')}</button></div>
    </div>`,
  });

  const err = $('.form-error', w);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const parsed = () => (st.rows ? toFines(st.rows, st.headerIndex, st.map, { kind: st.kind, source: st.source }) : []);

  function load(rows, name) {
    showErr('');
    if (!rows?.length) { st.rows = null; showErr(t('No rows found.')); return draw(); }
    const d = detect(rows);
    Object.assign(st, { rows, headerIndex: d.headerIndex, map: d.map, fileName: name });
    draw();
  }

  function draw() {
    const box = $('[data-preview]', w); const go = $('[data-go]', w);
    if (!st.rows) { mount(box, ''); go.disabled = true; return; }
    const header = st.rows[st.headerIndex] || [];
    const cols = header.map((h, i) => [i, String(h || `#${i + 1}`)]);
    const list = parsed();
    const good = list.filter((f) => !f.error); const bad = list.length - good.length;
    go.disabled = !good.length;
    go.lastChild.textContent = ` ${t('Import and match')} (${good.length})`;
    mount(box, html`
      <h3 class="small">${icon('sliders-horizontal')} ${t('Columns')} <span class="muted">· ${st.fileName}</span></h3>
      <div class="grid-form map-grid">${FIELDS.map((f) => html`<div class="fld"><label for="map-${f.key}">${t(f.label)}${f.req ? html`<b class="req">*</b>` : ''}</label>
        <select id="map-${f.key}" data-map="${f.key}"><option value="">—</option>${cols.map(([i, h]) => html`<option value="${i}" ${String(st.map[f.key]) === String(i) ? 'selected' : ''}>${h}</option>`)}</select></div>`)}</div>
      <p class="small">${badge('paid', `${good.length} ${t('ready')}`)} ${bad ? badge('unmatched', `${bad} ${t('will be skipped')}`) : ''}
        <span class="muted">${t('Times are read as Dubai time.')}</span></p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>${t('Occurred')}</th><th>${t('Kind')}</th><th>${t('Plate')}</th><th>${t('Reference')}</th><th>${t('Details')}</th><th class="num">${t('Amount')}</th><th></th></tr></thead>
        <tbody>${list.slice(0, 12).map((f) => html`<tr>
          <td>${f.occurred_at ? fmtDateTime(f.occurred_at) : '—'}</td><td>${t(f.kind)}<small class="muted block">${f.source}</small></td>
          <td>${f.plate_number ? plateTag(f) : '—'}</td><td class="mono">${f.reference || '—'}</td>
          <td><small>${[f.location, f.description].filter(Boolean).join(' · ') || '—'}${f.black_points ? ` · ${f.black_points} ${t('black points')}` : ''}</small></td>
          <td class="num">${f.amount == null ? '—' : money(f.amount)}</td><td>${f.error ? badge('unmatched', t(f.error)) : icon('check')}</td></tr>`)}</tbody></table></div>
      ${list.length > 12 ? html`<p class="muted small">… ${list.length - 12} ${t('more rows')}</p>` : ''}`);
  }

  $('#imp-file', w).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { load(await readFile(file), file.name); } catch (ex) { st.rows = null; draw(); showErr(ex.message); }
  });
  $('#imp-paste', w).addEventListener('input', (e) => load(parseText(e.target.value), t('Pasted rows')));
  $('#imp-kind', w).addEventListener('change', (e) => { st.kind = e.target.value; if (st.kind === 'salik' && !$('#imp-src', w).value) { $('#imp-src', w).value = 'Salik'; st.source = 'Salik'; } draw(); });
  $('#imp-src', w).addEventListener('input', (e) => { st.source = e.target.value.trim(); draw(); });
  w.addEventListener('change', (e) => { const k = e.target.dataset?.map; if (k) { st.map[k] = e.target.value === '' ? undefined : +e.target.value; draw(); } });
  $('[data-template]', w).addEventListener('click', () => download('fines-import-template.csv', TEMPLATE));

  $('[data-go]', w).addEventListener('click', async (e) => {
    const btn = e.currentTarget; const rows = parsed().filter((f) => !f.error).map(({ error, ...f }) => f);
    if (!rows.length) return;
    btn.disabled = true; showErr('');
    const tot = { received: 0, inserted: 0, duplicates: 0, invalid: 0, charged: 0, company: 0, unmatched: 0 };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await S.backend.rpc('import_fines', { rows: rows.slice(i, i + CHUNK) });
        for (const k of Object.keys(tot)) tot[k] += +r?.[k] || 0;
      }
      closeModal(); await reload('fines');
      toast(`${tot.inserted} ${t('added')} · ${tot.charged} ${t('charged to customers')} · ${tot.company} ${t('company')} · ${tot.unmatched} ${t('unmatched')}${tot.duplicates ? ` · ${tot.duplicates} ${t('already in the system')}` : ''}`);
    } catch (ex) { showErr(ex.message); btn.disabled = false; }
  });
}
