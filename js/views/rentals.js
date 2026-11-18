// Rentals: the heart of the system. Booking → hand-over → return, with live pricing, payments and a printable contract.
import { html, icon, $, matches, money, fmtDateTime, fmtDate, plate, carName, csv, download, todayISO, num, round2, raw } from '../util.js';
import { t } from '../i18n.js';
import { table, actBtn, wireActions, formModal, openModal, closeModal, confirmBox, toast, badge, plateTag, field, readForm } from '../ui.js';
import { lookups, carLabel } from '../schema.js';
import { priceRental, suggestDailyRate, overlaps } from '../rules.js';
import { S, reload } from '../store.js';

const FUEL = ['empty', '1/4', '1/2', '3/4', 'full'];
const isOverdue = (r) => r.status === 'active' && new Date(r.end_at) < new Date();
const tone = (r) => (isOverdue(r) ? 'overdue' : r.status);
const state = { q: '', filter: 'open' };

const FILTERS = {
  open: (r) => ['booked', 'active'].includes(r.status), booked: (r) => r.status === 'booked', active: (r) => r.status === 'active',
  overdue: isOverdue, returned: (r) => r.status === 'returned', cancelled: (r) => r.status === 'cancelled', all: () => true,
};

function carIsFree(vehicleId, startAt, endAt, exceptId) {
  return !S.data.rentals.some((r) => r.id !== exceptId && r.vehicle_id === vehicleId && ['booked', 'active'].includes(r.status) && overlaps(r.start_at, r.end_at, startAt, endAt));
}

// ── New / edit rental ────────────────────────────────────────────────────────
function rentalForm(row, prefill = {}) {
  const isNew = !row;
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const r = row || { start_at: now.toISOString(), end_at: new Date(now.getTime() + 3 * 86400000).toISOString(), vat_rate: S.settings?.vat_rate ?? 5, deposit: 1000, fuel_out: 'full', status: 'booked', extras: 0, discount: 0, ...prefill };
  let fields = [
    { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', req: true, refLabel: (c) => `${c.full_name}${c.phone ? ' · ' + c.phone : ''}${c.blacklisted ? ' ⛔' : ''}`, refFilter: (c) => !c.blacklisted },
    { key: 'start_at', label: 'Start', type: 'datetime', req: true }, { key: 'end_at', label: 'End', type: 'datetime', req: true },
    { key: 'vehicle_id', label: 'Car', type: 'ref', ref: 'vehicles', req: true, refLabel: (v) => `${carLabel(v)} · ${money(v.daily_rate)}`, refFilter: (v) => v.status !== 'retired' },
    { key: 'daily_rate', label: 'Daily rate', type: 'money', req: true }, { key: 'extras', label: 'Extras', type: 'money' },
    { key: 'discount', label: 'Discount', type: 'money' }, { key: 'vat_rate', label: 'VAT %', type: 'number', max: 100 },
    { key: 'deposit', label: 'Deposit', type: 'money' }, { key: 'fuel_out', label: 'Fuel out', type: 'select', req: true, options: FUEL },
    ...(isNew ? [{ key: 'status', label: 'Status', type: 'select', req: true, options: ['booked', 'active'], help: 'Choose active if the customer takes the car right now.' }] : []),
    { key: 'notes', label: 'Notes', type: 'textarea', span: true },
  ];
  // Once the car is out, customer and car are fixed (the database enforces this too).
  if (row?.status === 'active') fields = fields.filter((f) => !['customer_id', 'vehicle_id'].includes(f.key));
  const w = formModal({
    title: isNew ? t('New rental') : `${t('Edit')} · ${row.ref}`, fields, row: r, data: S.data,
    extra: html`<div class="quote" data-quote></div><div class="avail" data-avail></div>`,
    submitText: isNew ? t('Save') : t('Save'),
    onSubmit: async (vals) => {
      if (isNew) await S.backend.insert('rentals', vals);
      else { delete vals.status; await S.backend.update('rentals', row.id, vals); }
      toast(t('Saved')); await reload('rentals');
    },
  });
  const form = $('form', w);
  let rateTouched = !isNew;
  if (isNew && prefill.vehicle_id) { const c = S.data.vehicles.find((x) => x.id === prefill.vehicle_id); if (c) form.elements.daily_rate.value = suggestDailyRate(c, r.start_at, r.end_at); }
  const refresh = (ev) => {
    const v = readForm(form, fields);
    const car = S.data.vehicles.find((c) => c.id === (v.vehicle_id || row?.vehicle_id));
    if (ev && ['vehicle_id', 'start_at', 'end_at'].includes(ev.target.name) && !rateTouched && car) {
      form.elements.daily_rate.value = suggestDailyRate(car, v.start_at, v.end_at);
      v.daily_rate = num(form.elements.daily_rate.value);
    }
    const p = priceRental({ ...r, ...v });
    $('[data-quote]', w).innerHTML = html`
      <div><span>${t('Days')}</span><b>${p.days}</b></div><div><span>${t('Subtotal')}</span><b>${money(p.subtotal)}</b></div>
      <div><span>${t('VAT')}</span><b>${money(p.vat)}</b></div><div class="big"><span>${t('Total')}</span><b>${money(p.total)}</b></div>`.toString();
    // Show which cars are free for the chosen dates
    const free = v.start_at && v.end_at ? S.data.vehicles.filter((c) => c.status !== 'retired' && carIsFree(c.id, v.start_at, v.end_at, row?.id)) : [];
    const sel = form.elements.vehicle_id;
    if (sel) for (const o of sel.options) if (o.value) o.disabled = !free.some((c) => c.id === o.value);
    $('[data-avail]', w).innerHTML = html`${icon('car')} ${free.length} ${t('Available')} ${car && !free.some((c) => c.id === car.id) ? html`<b class="neg">· ${plate(car)} ${t('booked')}</b>` : ''}`.toString();
  };
  form.addEventListener('input', (e) => { if (e.target.name === 'daily_rate') rateTouched = true; refresh(e); });
  refresh();
}

// ── Hand-over / return / payment ─────────────────────────────────────────────
async function handOver(r) {
  const car = S.data.vehicles.find((v) => v.id === r.vehicle_id);
  formModal({
    title: `${t('Hand over car')} · ${r.ref}`, wide: false,
    fields: [{ key: 'odometer_out', label: 'Odometer out', type: 'int', req: true }, { key: 'fuel_out', label: 'Fuel out', type: 'select', req: true, options: FUEL }],
    row: { odometer_out: r.odometer_out ?? car?.odometer, fuel_out: r.fuel_out },
    submitText: t('Hand over car'),
    onSubmit: async (v) => { await S.backend.update('rentals', r.id, { ...v, status: 'active' }); toast(t('Saved')); await reload('rentals'); },
  });
}
function returnCar(r) {
  const fields = [
    { key: 'returned_at', label: 'Return car', type: 'datetime', req: true }, { key: 'odometer_in', label: 'Odometer in', type: 'int', req: true, min: r.odometer_out ?? 0 },
    { key: 'fuel_in', label: 'Fuel in', type: 'select', req: true, options: FUEL }, { key: 'extras', label: 'Extras', type: 'money', help: 'Fuel, damage, extra km, cleaning…' },
  ];
  const w = formModal({
    title: `${t('Return car')} · ${r.ref}`, fields, wide: false,
    row: { returned_at: new Date().toISOString(), odometer_in: r.odometer_out, fuel_in: 'full', extras: r.extras },
    extra: html`<div class="quote" data-quote></div>`, submitText: t('Return car'),
    onSubmit: async (v) => { await S.backend.update('rentals', r.id, { ...v, status: 'returned' }); toast(t('Saved')); await reload('rentals'); },
  });
  const form = $('form', w);
  const refresh = () => {
    const v = readForm(form, fields); const p = priceRental({ ...r, ...v });
    const bal = S.data.rental_balances.find((b) => b.rental_id === r.id);
    const due = round2(p.total - num(bal?.paid));
    $('[data-quote]', w).innerHTML = html`<div><span>${t('Days')}</span><b>${p.days}</b></div>
      <div><span>${t('Total')}</span><b>${money(p.total)}</b></div><div><span>${t('Paid')}</span><b>${money(bal?.paid)}</b></div>
      <div class="big"><span>${t('Balance')}</span><b class="${due > 0 ? 'neg' : ''}">${money(due)}</b></div>`.toString();
  };
  form.addEventListener('input', refresh); refresh();
}
export function takePayment(r, kind = 'payment') {
  const bal = S.data.rental_balances.find((b) => b.rental_id === r.id);
  const suggested = kind === 'deposit' ? r.deposit : kind === 'deposit_return' ? num(bal?.deposit_held) : Math.max(0, num(bal?.balance));
  formModal({
    title: `${t('Take payment')} · ${r.ref}`, wide: false,
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', req: true, options: ['payment', 'deposit', 'refund', 'deposit_return'] },
      { key: 'method', label: 'Method', type: 'select', req: true, options: ['cash', 'card', 'bank', 'cheque'] },
      { key: 'amount', label: 'Amount', type: 'money', req: true, min: 0.01 }, { key: 'note', label: 'Notes', type: 'textarea', span: true },
    ],
    row: { kind, method: 'card', amount: suggested || '' },
    onSubmit: async (v) => {
      await S.backend.insert('payments', { ...v, rental_id: r.id, customer_id: r.customer_id, paid_at: new Date().toISOString() });
      toast(t('Saved')); await reload('payments');
    },
  });
}

// ── Detail drawer ────────────────────────────────────────────────────────────
function detail(r) {
  const x = lookups(S.data);
  const c = x.customers[r.customer_id]; const v = x.vehicles[r.vehicle_id]; const b = x.balances[r.id] || {};
  const pays = S.data.payments.filter((p) => p.rental_id === r.id);
  const fines = S.data.fines.filter((f) => f.rental_id === r.id);
  const w = openModal({
    title: html`${r.ref} ${badge(tone(r), isOverdue(r) ? t('Overdue') : null)}`, wide: true,
    body: html`<div class="detail">
      <section><h3>${icon('users')} ${t('Customer')}</h3><p><b>${c?.full_name}</b></p><p class="muted">${c?.phone} · ${c?.id_number}</p>
        <p class="muted">${t('Licence no.')} ${c?.license_number || '—'} · ${fmtDate(c?.license_expiry)}</p></section>
      <section><h3>${icon('car')} ${t('Car')}</h3><p>${plateTag(v)} <b>${carName(v)}</b></p>
        <p class="muted">${t('Odometer out')}: ${r.odometer_out ?? '—'} · ${t('Odometer in')}: ${r.odometer_in ?? '—'}</p>
        <p class="muted">${t('Fuel out')}: ${t(r.fuel_out)} · ${t('Fuel in')}: ${r.fuel_in ? t(r.fuel_in) : '—'}</p></section>
      <section><h3>${icon('calendar')} ${t('Days')}</h3><p>${fmtDateTime(r.start_at)} → ${fmtDateTime(r.end_at)}</p>
        ${r.returned_at ? html`<p class="muted">${t('returned')}: ${fmtDateTime(r.returned_at)}</p>` : ''}<p><b>${r.days}</b> × ${money(r.daily_rate)}</p></section>
      <section class="money-box"><div><span>${t('Subtotal')}</span><b>${money(r.subtotal)}</b></div><div><span>${t('VAT')}</span><b>${money(r.vat)}</b></div>
        <div><span>${t('Total')}</span><b>${money(r.total)}</b></div><div><span>${t('Paid')}</span><b>${money(b.paid)}</b></div>
        <div class="big"><span>${t('Balance')}</span><b class="${num(b.balance) > 0 ? 'neg' : 'pos'}">${money(b.balance)}</b></div>
        <div><span>${t('Deposit')}</span><b>${money(b.deposit_held)}</b></div></section>
    </div>
    ${r.notes ? html`<p class="note">${r.notes}</p>` : ''}
    <h3 class="sub">${icon('wallet')} ${t('Payments')}</h3>
    ${table(pays, [
      { label: 'Reference', cell: (p) => html`<span class="mono">${p.ref}</span>` }, { label: 'Date', cell: (p) => fmtDateTime(p.paid_at) },
      { label: 'Kind', cell: (p) => badge(p.kind) }, { label: 'Method', cell: (p) => t(p.method) }, { label: 'Amount', cell: (p) => money(p.amount), cls: 'num' }])}
    ${fines.length ? html`<h3 class="sub">${icon('siren')} ${t('Fines & Salik')}</h3>${table(fines, [
      { label: 'Occurred', cell: (f) => fmtDateTime(f.occurred_at) }, { label: 'Kind', cell: (f) => t(f.kind) },
      { label: 'Amount', cell: (f) => money(+f.amount + +f.admin_fee), cls: 'num' }, { label: 'Status', cell: (f) => badge(f.status) }])}` : ''}
    <div class="form-actions wrap">${actionButtons(r, true)}</div>`,
  });
  wire(w, true);
}

function actionButtons(r, big = false) {
  const can = S.can('rentals', 'write'); const pay = S.can('payments', 'write');
  const B = (act, ic, label, cls = 'ghost') => (big ? html`<button class="btn ${cls}" data-act="${act}" data-id="${r.id}">${icon(ic)} ${t(label)}</button>` : actBtn(act, r.id, ic, label));
  return html`
    ${can && r.status === 'booked' ? B('handover', 'key-round', 'Hand over car', 'primary') : ''}
    ${can && r.status === 'active' ? B('return', 'undo-2', 'Return car', 'primary') : ''}
    ${pay && r.status !== 'cancelled' ? B('pay', 'hand-coins', 'Take payment') : ''}
    ${B('print', 'printer', 'Print contract')}
    ${can && ['booked', 'active'].includes(r.status) ? B('edit', 'pencil', 'Edit') : ''}
    ${can && r.status === 'booked' ? B('cancel', 'ban', 'Cancel booking', 'danger') : ''}
    ${!big ? B('open', 'eye', 'Open') : ''}`;
}

// ── Printable contract ───────────────────────────────────────────────────────
function printContract(r) {
  const x = lookups(S.data); const c = x.customers[r.customer_id]; const v = x.vehicles[r.vehicle_id]; const s = S.settings || {};
  const b = x.balances[r.id] || {};
  const el = $('#print');
  el.innerHTML = html`<div class="contract">
    <header><div><h1>${s.company_name}</h1><p>${s.company_address}${s.company_phone ? ' · ' + s.company_phone : ''}</p>${s.trn ? html`<p>TRN ${s.trn}</p>` : ''}</div>
      <div class="r"><h2>Rental Agreement · عقد إيجار</h2><p class="mono">${r.ref}</p><p>${fmtDate(new Date())}</p></div></header>
    <div class="cols">
      <section><h3>Hirer · المستأجر</h3><p><b>${c?.full_name}</b></p><p>${c?.phone}</p><p>ID ${c?.id_number} (${fmtDate(c?.id_expiry)})</p>
        <p>Licence ${c?.license_number} (${fmtDate(c?.license_expiry)})</p><p>${c?.nationality}</p></section>
      <section><h3>Vehicle · المركبة</h3><p><b>${carName(v)}</b> ${v?.year || ''}</p><p>Plate ${plate(v)} · ${v?.emirate}</p>
        <p>Odometer out ${r.odometer_out ?? '______'} · in ${r.odometer_in ?? '______'}</p><p>Fuel out ${r.fuel_out} · in ${r.fuel_in || '______'}</p></section>
    </div>
    <table><tr><th>From</th><td>${fmtDateTime(r.start_at)}</td><th>To</th><td>${fmtDateTime(r.end_at)}</td></tr>
      <tr><th>Days</th><td>${r.days}</td><th>Daily rate</th><td>${money(r.daily_rate)}</td></tr>
      <tr><th>Extras</th><td>${money(r.extras)}</td><th>Discount</th><td>${money(r.discount)}</td></tr>
      <tr><th>VAT ${r.vat_rate}%</th><td>${money(r.vat)}</td><th>Total</th><td><b>${money(r.total)}</b></td></tr>
      <tr><th>Paid</th><td>${money(b.paid)}</td><th>Balance</th><td><b>${money(b.balance)}</b></td></tr>
      <tr><th>Deposit</th><td colspan="3">${money(r.deposit)}</td></tr></table>
    <ol class="terms"><li>The hirer is responsible for all traffic fines, Salik tolls and parking charges during the rental, plus an admin fee.</li>
      <li>The car must be returned with the same fuel level. Late returns are charged per started day after a 1-hour grace period.</li>
      <li>Only the named hirer may drive the car. Smoking is not permitted.</li><li>The deposit is returned after fines are checked.</li></ol>
    <div class="sign"><div>Hirer signature · توقيع المستأجر</div><div>For ${s.company_name}</div></div></div>`.toString();
  window.print();
}

// ── Page ─────────────────────────────────────────────────────────────────────
function wire(root, inModal = false) {
  const find = (id) => S.data.rentals.find((r) => r.id === id);
  const after = () => { if (inModal) closeModal(); };
  wireActions(root, {
    new: () => rentalForm(null),
    open: (id) => detail(find(id)),
    edit: (id) => { after(); rentalForm(find(id)); },
    handover: (id) => { after(); handOver(find(id)); },
    return: (id) => { after(); returnCar(find(id)); },
    pay: (id) => { after(); takePayment(find(id)); },
    print: (id) => printContract(find(id)),
    cancel: async (id) => {
      after();
      if (!(await confirmBox(`${t('Cancel booking')} ${find(id).ref}?`, { okText: t('Cancel booking'), danger: true }))) return;
      try { await S.backend.update('rentals', id, { status: 'cancelled' }); toast(t('Saved')); await reload('rentals'); } catch (e) { toast(e.message, 'err'); }
    },
    filter: (f) => { state.filter = f; render(root); },
    csv: () => {
      const x = lookups(S.data);
      download(`rentals-${todayISO()}.csv`, csv(list(), [
        { label: 'Ref', csv: (r) => r.ref }, { label: 'Status', csv: (r) => r.status }, { label: 'Customer', csv: (r) => x.customers[r.customer_id]?.full_name },
        { label: 'Plate', csv: (r) => plate(x.vehicles[r.vehicle_id]) }, { label: 'Car', csv: (r) => carName(x.vehicles[r.vehicle_id]) },
        { label: 'Start', csv: (r) => r.start_at }, { label: 'End', csv: (r) => r.end_at }, { label: 'Days', csv: (r) => r.days },
        { label: 'Total', csv: (r) => r.total }, { label: 'Paid', csv: (r) => x.balances[r.id]?.paid }, { label: 'Balance', csv: (r) => x.balances[r.id]?.balance }]));
    },
  });
}

function list() {
  const x = lookups(S.data); const q = state.q.toLowerCase();
  return S.data.rentals.filter(FILTERS[state.filter]).filter((r) => matches(r, q, ['ref', (r) => x.customers[r.customer_id]?.full_name, (r) => x.customers[r.customer_id]?.phone, (r) => plate(x.vehicles[r.vehicle_id]), (r) => carName(x.vehicles[r.vehicle_id])]));
}

export function render(root) {
  const x = lookups(S.data);
  const rows = list();
  const count = (f) => S.data.rentals.filter(FILTERS[f]).length;
  root.innerHTML = html`
    <div class="page-head"><div><h1>${icon('key-round')} ${t('Rentals')}</h1><p class="muted">${rows.length} / ${S.data.rentals.length}</p></div>
      <div class="head-actions"><button class="btn ghost" data-act="csv">${icon('download')} ${t('Export CSV')}</button>
      ${S.can('rentals', 'write') ? html`<button class="btn primary" data-act="new">${icon('plus')} ${t('New rental')}</button>` : ''}</div></div>
    <div class="toolbar"><label class="search">${icon('search')}<input type="search" data-q placeholder="${t('Search…')}" value="${state.q}" aria-label="${t('Search…')}"></label>
      <div class="chips">${['open', 'booked', 'active', 'overdue', 'returned', 'cancelled', 'all'].map((f) => html`<button class="chip ${state.filter === f ? 'on' : ''} ${f === 'overdue' && count(f) ? 'alert' : ''}" data-act="filter" data-id="${f}">${t(f === 'open' ? 'Open' : f === 'all' ? 'All' : f === 'overdue' ? 'Overdue' : f)} <i>${count(f)}</i></button>`)}</div></div>
    ${table(rows, [
      { label: 'Reference', cell: (r) => html`<button class="link mono" data-act="open" data-id="${r.id}">${r.ref}</button>` },
      { label: 'Customer', cell: (r) => html`<b>${x.customers[r.customer_id]?.full_name}</b><small class="muted block">${x.customers[r.customer_id]?.phone}</small>` },
      { label: 'Car', cell: (r) => html`${plateTag(x.vehicles[r.vehicle_id])}<small class="muted block">${carName(x.vehicles[r.vehicle_id])}</small>` },
      { label: 'Start', cell: (r) => html`${fmtDateTime(r.start_at)}<small class="muted block">→ ${fmtDateTime(r.end_at)}</small>` },
      { label: 'Total', cell: (r) => html`<b>${money(r.total)}</b><small class="muted block">${r.days} ${t('Days')}</small>`, cls: 'num' },
      { label: 'Balance', cell: (r) => { const b = num(x.balances[r.id]?.balance); return r.status === 'cancelled' ? '—' : html`<b class="${b > 0 ? 'neg' : 'pos'}">${money(b)}</b>`; }, cls: 'num' },
      { label: 'Status', cell: (r) => badge(tone(r), isOverdue(r) ? t('Overdue') : null) },
    ], { actions: (r) => actionButtons(r), empty: 'Nothing here yet' })}`.toString();
  const input = $('[data-q]', root);
  input.addEventListener('input', () => { state.q = input.value; const p = input.selectionStart; render(root); const i = $('[data-q]', root); i.focus(); i.setSelectionRange(p, p); });
}

export function mountRentals(root, params) {
  wire(root);
  render(root);
  if (params.get('new') && S.can('rentals', 'write')) rentalForm(null, params.get('car') ? { vehicle_id: params.get('car') } : {});
  const open = params.get('open'); if (open && S.data.rentals.some((r) => r.id === open)) detail(S.data.rentals.find((r) => r.id === open));
  return () => render(root);
}
export { rentalForm };
