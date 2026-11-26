// Small UI kit: toasts, modals, forms, tables, badges. Everything renders through html`` (auto-escaped).
import { html, raw, mount, $, $$, icon, esc, money, fmtDate, fmtDateTime, localInput, dateInput, num } from './util.js';
import { t } from './i18n.js';

// ── Toasts ───────────────────────────────────────────────────────────────────
export function toast(msg, kind = 'ok') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  mount(el, html`${icon(kind === 'err' ? 'triangle-alert' : 'circle-check')}<span>${msg}</span>`);
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'err' ? 6000 : 3000);
}

// ── Modal ────────────────────────────────────────────────────────────────────
let lastFocus = null;
export function openModal({ title, body, wide = false, onMount }) {
  closeModal();
  lastFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'modal';
  mount(wrap, html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header><h2 id="modal-title">${title}</h2><button class="icon-btn" data-close aria-label="${t('Close')}">${icon('x')}</button></header>
    <div class="modal-body">${body}</div></div>`);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeModal(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.body.append(wrap);
  document.body.classList.add('no-scroll');
  onMount?.(wrap);
  setTimeout(() => $('input:not([type=hidden]),select,textarea,button.btn', wrap.querySelector('.modal-body'))?.focus(), 30);
  return wrap;
}
export function closeModal() {
  $('#modal')?.remove();
  document.body.classList.remove('no-scroll');
  lastFocus?.focus?.();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal')) closeModal(); });

export function confirmBox(message, { okText = t('Confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; closeModal(); resolve(v); } };
    const w = openModal({
      title: t('Are you sure?'),
      body: html`<p class="muted">${message}</p><div class="form-actions">
        <button class="btn ghost" data-no>${t('Cancel')}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${okText}</button></div>`,
    });
    w.addEventListener('click', (e) => { if (e.target.closest('[data-yes]')) finish(true); else if (e.target.closest('[data-no],[data-close]')) finish(false); });
    new MutationObserver((_, obs) => { if (!document.body.contains(w)) { obs.disconnect(); finish(false); } }).observe(document.body, { childList: true });
  });
}

// ── Forms ────────────────────────────────────────────────────────────────────
// Field: { key, label, type, options, req, min, max, step, span, help, ref, refLabel, refFilter, def, show }
export function field(f, value, ctx = {}) {
  const id = `f-${f.key}`;
  const v = value ?? (typeof f.def === 'function' ? f.def() : f.def) ?? '';
  const req = f.req ? raw(' required') : '';
  const label = html`<label for="${id}">${t(f.label)}${f.req ? html`<b class="req">*</b>` : ''}</label>`;
  let input;
  switch (f.type) {
    case 'textarea': input = html`<textarea id="${id}" name="${f.key}" rows="3"${req} maxlength="2000">${v}</textarea>`; break;
    case 'select': {
      // options: array of values or [value, label] pairs, or a function of the form data returning one
      const opts = (typeof f.options === 'function' ? f.options(ctx.data || {}, ctx.row || {}) : f.options).map((o) => (Array.isArray(o) ? o : [o, t(o)]));
      input = html`<select id="${id}" name="${f.key}"${req}>${f.req ? '' : html`<option value="">—</option>`}
        ${opts.map(([o, l]) => html`<option value="${o}" ${String(v) === String(o) ? raw('selected') : ''}>${l}</option>`)}</select>`;
      break;
    }
    case 'ref': {
      const rows = (ctx.data?.[f.ref] || []).filter((r) => !f.refFilter || f.refFilter(r, ctx.row || {}) || r.id === v);
      input = html`<select id="${id}" name="${f.key}"${req}><option value="">—</option>
        ${rows.map((r) => html`<option value="${r.id}" ${r.id === v ? raw('selected') : ''}>${f.refLabel(r)}</option>`)}</select>`;
      break;
    }
    case 'checkbox':
      return html`<div class="fld check ${f.span ? 'span' : ''}" ${f.show ? raw(`data-show-for="${esc(f.key)}"`) : ''}><label><input type="checkbox" id="${id}" name="${f.key}" ${v ? raw('checked') : ''}> ${t(f.label)}</label></div>`;
    case 'datetime': input = html`<input type="datetime-local" id="${id}" name="${f.key}" value="${localInput(v)}"${req}>`; break;
    case 'date': input = html`<input type="date" id="${id}" name="${f.key}" value="${dateInput(v)}"${req}>`; break;
    case 'money': case 'number': case 'int':
      input = html`<input type="number" inputmode="decimal" id="${id}" name="${f.key}" value="${v}" min="${f.min ?? 0}" ${f.max != null ? raw(`max="${esc(f.max)}"`) : ''} step="${f.step ?? (f.type === 'int' ? 1 : '0.01')}"${req}>`;
      break;
    default: {
      // f.list: suggestions (array, or function of the form data) shown as a datalist; the field stays free text.
      const list = typeof f.list === 'function' ? f.list(ctx.data || {}, ctx.row || {}) : f.list;
      input = html`<input type="${f.type || 'text'}" id="${id}" name="${f.key}" value="${v}" maxlength="${f.max ?? 200}"${req} ${f.pattern ? raw(`pattern="${esc(f.pattern)}"`) : ''} ${list ? raw(`list="dl-${esc(f.key)}"`) : ''} autocomplete="off">${list ? html`<datalist id="dl-${f.key}">${[...new Set(list)].map((o) => html`<option value="${o}"></option>`)}</datalist>` : ''}`;
    }
  }
  return html`<div class="fld ${f.span ? 'span' : ''}" ${f.show ? raw(`data-show-for="${esc(f.key)}"`) : ''}>${label}${input}${f.help ? html`<small class="muted">${t(f.help)}</small>` : ''}</div>`;
}

export function readForm(form, fields) {
  const fd = new FormData(form);
  const out = {};
  for (const f of fields) {
    if (!form.elements[f.key]) continue;
    const raw = fd.get(f.key);
    switch (f.type) {
      case 'checkbox': out[f.key] = form.elements[f.key].checked; break;
      case 'money': case 'number': out[f.key] = raw === '' || raw == null ? (f.req ? null : 0) : Math.round(num(raw) * 100) / 100; break;
      case 'int': out[f.key] = raw === '' || raw == null ? null : Math.trunc(num(raw)); break;
      case 'datetime': out[f.key] = raw ? new Date(raw).toISOString() : null; break;
      case 'date': case 'ref': case 'select': out[f.key] = raw || null; break;
      default: out[f.key] = String(raw ?? '').trim();
    }
  }
  return out;
}

export function formModal({ title, fields, row = {}, data, onSubmit, submitText = t('Save'), wide = true, extra = '', onMount }) {
  const w = openModal({
    title, wide,
    body: html`<form class="form" novalidate>
      <div class="grid-form">${fields.map((f) => field(f, row[f.key], { data, row }))}</div>
      ${extra}
      <div class="form-error" hidden></div>
      <div class="form-actions"><button type="button" class="btn ghost" data-close>${t('Cancel')}</button>
      <button type="submit" class="btn primary">${icon('check')} ${submitText}</button></div></form>`,
    onMount,
  });
  const form = $('form', w);
  // Fields with show(values) appear only when it returns true; hidden ones are disabled so they are neither validated nor saved.
  const conditional = fields.filter((f) => f.show);
  const syncShow = () => {
    if (!conditional.length) return;
    const vals = { ...row, ...readForm(form, fields) };
    for (const f of conditional) {
      const box = form.querySelector(`[data-show-for="${f.key}"]`); if (!box) continue;
      const vis = !!f.show(vals);
      box.hidden = !vis; box.querySelectorAll('input,select,textarea').forEach((el) => { el.disabled = !vis; });
    }
  };
  form.addEventListener('change', syncShow); syncShow();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true; err.hidden = true;
    try { await onSubmit(readForm(form, fields), form); closeModal(); }
    catch (ex) { err.textContent = ex.message || String(ex); err.hidden = false; }
    finally { btn.disabled = false; }
  });
  return w;
}

// ── Display helpers ──────────────────────────────────────────────────────────
const TONE = {
  available: 'green', active: 'blue', rented: 'blue', booked: 'amber', returned: 'gray', cancelled: 'gray', maintenance: 'orange',
  retired: 'gray', open: 'orange', done: 'green', new: 'amber', charged: 'blue', company: 'violet', unmatched: 'red', paid: 'green',
  disputed: 'red', payment: 'green', refund: 'red', deposit: 'violet', deposit_return: 'gray', overdue: 'red',
  admin: 'violet', manager: 'blue', agent: 'green', accountant: 'amber',
  nrm: 'violet', custody: 'violet', closed: 'gray', employee: 'violet', void: 'gray', repaired: 'green', cash: 'gray', credit: 'blue',
  checkout: 'blue', checkin: 'green', minor: 'amber', major: 'red', receipt: 'green', handed_over: 'blue', opened: 'amber', closed_ok: 'green',
  extended: 'blue', cut_short: 'amber', vehicle_replaced: 'violet', driver_replaced: 'violet', edited: 'gray',
};
export const badge = (s, label) => html`<span class="badge ${TONE[s] || 'gray'}">${label ?? t(s)}</span>`;
export const plateTag = (v) => (v ? html`<span class="plate"><i>${v.plate_code || '·'}</i>${v.plate_number}</span>` : '—');
export const empty = (text = 'Nothing here yet', ic = 'sparkles') => html`<div class="empty">${icon(ic)}<p>${t(text)}</p></div>`;
export const fmt = { money, date: fmtDate, datetime: fmtDateTime };

// Table: cols = [{ label, cell: row => view, cls, sort: row => value }]
export function table(rows, cols, { actions, rowAttr, empty: emptyText } = {}) {
  if (!rows.length) return empty(emptyText);
  return html`<div class="table-wrap"><table class="tbl"><thead><tr>
    ${cols.map((c) => html`<th class="${c.cls || ''}">${t(c.label)}</th>`)}${actions ? html`<th class="act"></th>` : ''}</tr></thead>
    <tbody>${rows.map((r) => html`<tr ${rowAttr ? rowAttr(r) : ''}>
      ${cols.map((c) => html`<td class="${c.cls || ''}" data-label="${t(c.label)}">${c.cell(r)}</td>`)}
      ${actions ? html`<td class="act">${actions(r)}</td>` : ''}</tr>`)}</tbody></table></div>`;
}

export const actBtn = (action, id, ic, label, cls = '') =>
  html`<button class="icon-btn ${cls}" data-act="${action}" data-id="${id}" title="${t(label)}" aria-label="${t(label)}">${icon(ic)}</button>`;

export function wireActions(root, handlers) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    const h = handlers[b.dataset.act];
    if (h) { e.preventDefault(); h(b.dataset.id, b); }
  });
}
export { $$ };
