// Rentals: the heart of the system. Booking → hand-over → return, with live pricing, payments and a printable contract.
import { html, raw, icon, $, matches, money, fmtDateTime, fmtDate, plate, carName, csv, download, todayISO, num, round2 } from '../util.js';
import { t } from '../i18n.js';
import { table, actBtn, wireActions, formModal, openModal, closeModal, toast, badge, plateTag, readForm } from '../ui.js';
import { lookups, carLabel, nameOf } from '../schema.js';
import { priceRental, suggestDailyRate, overlaps, pickTariff, FUEL } from '../rules.js';
import { customerEntries, lastBalance } from '../ledger.js';
import { S, reload } from '../store.js';
import { scanCar, scanIdDocument, confirmIdCustomer } from './scan.js';
import { qrSvg, carLink } from './checkcard.js';

const priorKm = (id) => S.data.vehicle_replacements.filter((x) => x.rental_id === id)
  .reduce((a, x) => a + Math.max(0, num(x.old_odometer_in) - num(x.old_odometer_out ?? x.old_odometer_in)), 0);
const branchRef = (key, label) => ({ key, label, type: 'ref', ref: 'branches', refLabel: (b) => b.name, refFilter: (b) => b.active !== false });
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
// scan = { id, car, rateTouched }: what was scanned before the form was re-opened, to show the ticks.
function rentalForm(row, prefill = {}, scan = {}) {
  const isNew = !row;
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const home = S.me?.branch_id || S.data.branches.find((b) => b.active !== false)?.id || null;
  const r = row || { start_at: now.toISOString(), end_at: new Date(now.getTime() + 3 * 86400000).toISOString(), vat_rate: S.settings?.vat_rate ?? 5, deposit: S.settings?.default_deposit ?? 1000, fuel_out: 'full', status: 'booked', extras: 0, discount: 0,
    branch_out_id: home, branch_in_id: home, km_per_day: 0, extra_km_rate: 0, ...prefill };
  let fields = [
    { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', req: true, refLabel: (c) => `${c.full_name}${c.phone ? ' · ' + c.phone : ''}${c.blacklisted ? ' ⛔' : ''}`, refFilter: (c) => !c.blacklisted },
    { key: 'start_at', label: 'Start', type: 'datetime', req: true }, { key: 'end_at', label: 'End', type: 'datetime', req: true },
    { key: 'vehicle_id', label: 'Car', type: 'ref', ref: 'vehicles', req: true, refLabel: (v) => `${carLabel(v)} · ${money(v.daily_rate)}`, refFilter: (v) => v.status !== 'retired' },
    { key: 'daily_rate', label: 'Daily rate', type: 'money', req: true }, { key: 'extras', label: 'Extras', type: 'money' },
    { key: 'discount', label: 'Discount', type: 'money' }, { key: 'vat_rate', label: 'VAT %', type: 'number', max: 100 },
    { key: 'deposit', label: 'Deposit', type: 'money' }, { key: 'fuel_out', label: 'Fuel out', type: 'select', req: true, options: FUEL },
    { key: 'km_per_day', label: 'Km allowed per day', type: 'int', max: 10000, help: '0 = unlimited.' }, { key: 'extra_km_rate', label: 'Extra km rate', type: 'money' },
    branchRef('branch_out_id', 'Pick-up branch'), branchRef('branch_in_id', 'Return branch'),
    { key: 'driver_name', label: 'Additional driver', max: 120 }, { key: 'driver_license', label: 'Driver licence no.', max: 40 }, { key: 'driver_phone', label: 'Driver phone', type: 'tel', max: 30 },
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
      vals.tariff_card_id = card?.id || null;
      if (isNew) await S.backend.insert('rentals', vals);
      else { delete vals.status; await S.backend.update('rentals', row.id, vals); }
      toast(t('Saved')); await reload('rentals');
    },
  });
  const form = $('form', w);
  let rateTouched = !isNew || !!scan.rateTouched;
  // Two scans for a new booking: the customer's Emirates ID (finds or creates the customer) and the QR label in the car.
  if (isNew) {
    const cust = S.data.customers.find((c) => c.id === r.customer_id); const car = S.data.vehicles.find((c) => c.id === r.vehicle_id);
    form.insertAdjacentHTML('afterbegin', html`<div class="scan-bar">
      <button type="button" class="btn ${scan.id ? 'done' : 'ghost'}" data-scan="id">${icon(scan.id ? 'check' : 'id-card')} <span>${t('Scan Emirates ID')}<small>${scan.id && cust ? cust.full_name : t('Finds or adds the customer')}</small></span></button>
      <button type="button" class="btn ${scan.car ? 'done' : 'ghost'}" data-scan="car">${icon(scan.car ? 'check' : 'qr-code')} <span>${t('Scan car QR')}<small>${scan.car && car ? plate(car) : t('The label inside the car')}</small></span></button></div>`.toString());
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-scan]'); if (!b) return;
      const keep = { ...readForm(form, fields) }; for (const k of Object.keys(keep)) if (keep[k] === null || keep[k] === '') delete keep[k];
      let finished = false; let obs = null;
      const reopen = (patch, flags) => { if (finished) return; finished = true; obs?.disconnect(); rentalForm(null, { ...prefill, ...keep, ...patch }, { ...scan, ...flags, rateTouched }); };
      const again = (patch, flag) => reopen(patch, { [flag]: true });
      const back = () => reopen({}, {});
      if (b.dataset.scan === 'car') {
        scanCar((v) => {
          if (v.status === 'retired') { toast(`${plate(v)}: ${t('retired')}`, 'err'); return back(); }
          if (keep.start_at && keep.end_at && !carIsFree(v.id, keep.start_at, keep.end_at)) toast(`${plate(v)} ${t('is booked for these dates')}`, 'err');
          again({ vehicle_id: v.id }, 'car');
        });
      } else scanIdDocument((read) => confirmIdCustomer(read, (c) => again({ customer_id: c.id }, 'id')));
      // Closing the scan (or the customer check) without a result brings the booking form back as it was.
      obs = new MutationObserver(() => { if (!$('#modal')) setTimeout(() => { if (!$('#modal')) back(); }, 60); });
      obs.observe(document.body, { childList: true });
    });
  }
  let card = row?.tariff_card_id ? S.data.tariff_cards.find((c) => c.id === row.tariff_card_id) : null;
  // Tariff: the customer's own card for the car's group, else the group's standard card, else the car's own rates.
  const applyTariff = (v) => {
    const car = S.data.vehicles.find((c) => c.id === (v.vehicle_id || row?.vehicle_id)); if (!car) return;
    card = pickTariff(S.data.tariff_cards, car, v.customer_id || row?.customer_id, v.start_at);
    form.elements.daily_rate.value = suggestDailyRate(car, v.start_at, v.end_at, card);
    if (form.elements.km_per_day) { form.elements.km_per_day.value = card ? card.km_per_day : 0; form.elements.extra_km_rate.value = card ? card.extra_km_rate : 0; }
  };
  if (isNew && prefill.vehicle_id && !rateTouched) applyTariff(readForm(form, fields));
  const refresh = (ev) => {
    let v = readForm(form, fields);
    const car = S.data.vehicles.find((c) => c.id === (v.vehicle_id || row?.vehicle_id));
    if (ev && ['vehicle_id', 'start_at', 'end_at', 'customer_id'].includes(ev.target.name) && !rateTouched && car) { applyTariff(v); v = readForm(form, fields); }
    const p = priceRental({ ...r, ...v });
    const cust = S.data.customers.find((c) => c.id === (v.customer_id || row?.customer_id));
    const owed = cust ? lastBalance(customerEntries(cust.id, S.data)) : 0;
    const over = cust && cust.account_type === 'credit' && num(cust.credit_limit) > 0 && owed + p.total - (row ? num(row.total) : 0) > num(cust.credit_limit);
    $('[data-quote]', w).innerHTML = html`
      <div><span>${t('Days')}</span><b>${p.days}</b></div><div><span>${t('Subtotal')}</span><b>${money(p.subtotal)}</b></div>
      <div><span>${t('VAT')}</span><b>${money(p.vat)}</b></div><div class="big"><span>${t('Total')}</span><b>${money(p.total)}</b></div>
      ${card ? html`<div class="wide"><span>${icon('tag')} ${t('Tariff card')}</span><b>${card.name}${card.customer_id ? ` · ${t('Corporate')}` : ''}</b></div>` : ''}
      ${cust && owed > 0.009 ? html`<div class="wide"><span>${t('Customer already owes')}</span><b class="neg">${money(owed)}</b></div>` : ''}
      ${over ? html`<div class="wide warn">${icon('triangle-alert')} ${t('Over credit limit')} (${money(cust.credit_limit)})</div>` : ''}`.toString();
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
    { key: 'fuel_in', label: 'Fuel in', type: 'select', req: true, options: FUEL }, { key: 'extras', label: 'Extras', type: 'money', help: 'Fuel, damage, cleaning…' },
    branchRef('branch_in_id', 'Return branch'),
  ];
  const w = formModal({
    title: `${t('Return car')} · ${r.ref}`, fields, wide: false, data: S.data,
    row: { returned_at: new Date().toISOString(), odometer_in: r.odometer_out, fuel_in: 'full', extras: r.extras, branch_in_id: r.branch_in_id },
    extra: html`<p class="muted small">${icon('info')} ${t('For a check card with damages, photos and signatures use Check-out / check-in.')} <a href="#/checkcard?car=${r.vehicle_id}">${t('Open')}</a></p><div class="quote" data-quote></div>`,
    submitText: t('Return car'),
    onSubmit: async (v) => { await S.backend.update('rentals', r.id, { ...v, status: 'returned' }); toast(t('Saved')); await reload('rentals'); },
  });
  const form = $('form', w);
  const refresh = () => {
    const v = readForm(form, fields); const p = priceRental({ ...r, ...v, status: 'returned' }, { priorKm: priorKm(r.id), withKm: true });
    const bal = S.data.rental_balances.find((b) => b.rental_id === r.id);
    const due = round2(p.total + num(bal?.invoiced) - num(bal?.paid));
    $('[data-quote]', w).innerHTML = html`<div><span>${t('Days')}</span><b>${p.days}</b></div>
      ${p.extra_km_charge ? html`<div><span>${t('Extra km')}</span><b>${money(p.extra_km_charge)}</b></div>` : ''}
      <div><span>${t('Total')}</span><b>${money(p.total)}</b></div>${num(bal?.invoiced) ? html`<div><span>${t('Invoiced')}</span><b>${money(bal.invoiced)}</b></div>` : ''}
      <div><span>${t('Paid')}</span><b>${money(bal?.paid)}</b></div>
      <div class="big"><span>${t('Balance')}</span><b class="${due > 0 ? 'neg' : ''}">${money(due)}</b></div>`.toString();
  };
  form.addEventListener('input', refresh); refresh();
}

// ── Agreement changes: extend / cut short, replace car, replace driver, cancel ──
function changeEnd(r) {
  formModal({
    title: `${t('Extend or cut short')} · ${r.ref}`, wide: false, row: { end_at: r.end_at },
    fields: [{ key: 'end_at', label: 'New end', type: 'datetime', req: true }],
    extra: html`<p class="muted small">${t('Current end')}: ${fmtDateTime(r.end_at)}. ${t('The price is recalculated from the new dates.')}</p>`,
    onSubmit: async (v) => {
      if (S.data.rentals.some((o) => o.id !== r.id && o.vehicle_id === r.vehicle_id && ['booked', 'active'].includes(o.status) && overlaps(o.start_at, o.end_at, r.start_at, v.end_at))) {
        throw new Error(t('This car is already booked for part of those dates.'));
      }
      await S.backend.update('rentals', r.id, { end_at: v.end_at }); toast(t('Saved')); await reload('rentals');
    },
  });
}
function replaceVehicle(r) {
  const x = lookups(S.data); const old = x.vehicles[r.vehicle_id];
  formModal({
    title: `${t('Replace vehicle')} · ${r.ref}`, data: S.data,
    row: { p_at: new Date().toISOString(), p_old_odometer: r.odometer_out, p_old_fuel: 'full', p_new_fuel: 'full' },
    fields: [
      { key: 'p_vehicle', label: 'New car', type: 'ref', ref: 'vehicles', req: true, refLabel: (v) => `${carLabel(v)} · ${money(v.daily_rate)}`, refFilter: (v) => v.status === 'available' && v.id !== r.vehicle_id },
      { key: 'p_at', label: 'When', type: 'datetime', req: true },
      { key: 'p_old_odometer', label: `${t('Odometer in')} · ${plate(old)}`, type: 'int', req: true, min: r.odometer_out ?? 0 },
      { key: 'p_old_fuel', label: `${t('Fuel in')} · ${plate(old)}`, type: 'select', req: true, options: FUEL },
      { key: 'p_new_odometer', label: 'Odometer out (new car)', type: 'int', help: 'Empty = the car\'s current odometer.' },
      { key: 'p_new_fuel', label: 'Fuel out (new car)', type: 'select', req: true, options: FUEL },
      { key: 'p_reason', label: 'Reason', max: 300, span: true, list: ['Breakdown', 'Accident', 'Customer request', 'Upgrade', 'Service due'] },
    ],
    extra: html`<p class="muted small">${icon('info')} ${t('The agreement keeps its number and price. Fines are matched to the right car for each part of the rental, and km on both cars count toward the allowance.')}</p>`,
    submitText: t('Replace vehicle'),
    onSubmit: async (v) => { await S.backend.rpc('replace_vehicle', { p_rental: r.id, ...v, p_new_odometer: v.p_new_odometer ?? null, p_reason: v.p_reason || '' }); toast(t('Saved')); await reload('rentals'); },
  });
}
function replaceDriver(r) {
  formModal({
    title: `${t('Replace driver')} · ${r.ref}`, wide: false, row: r,
    fields: [{ key: 'driver_name', label: 'Additional driver', max: 120 }, { key: 'driver_license', label: 'Driver licence no.', max: 40 }, { key: 'driver_phone', label: 'Driver phone', type: 'tel', max: 30 }],
    onSubmit: async (v) => { await S.backend.update('rentals', r.id, v); toast(t('Saved')); await reload('rentals'); },
  });
}
function cancelBooking(r) {
  formModal({
    title: `${t('Cancel booking')} · ${r.ref}`, wide: false, row: {},
    fields: [{ key: 'cancel_reason', label: 'Reason', req: true, max: 300, list: ['Customer cancelled', 'No show', 'Flight cancelled', 'Car not available', 'Duplicate booking'] }],
    submitText: t('Cancel booking'),
    onSubmit: async (v) => { await S.backend.update('rentals', r.id, { status: 'cancelled', cancel_reason: v.cancel_reason }); toast(t('Saved')); await reload('rentals'); },
  });
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
  const invs = S.data.invoices.filter((i) => i.rental_id === r.id);
  const reps = S.data.vehicle_replacements.filter((p) => p.rental_id === r.id);
  const events = S.data.rental_events.filter((e) => e.rental_id === r.id).sort((a, b) => new Date(b.at) - new Date(a.at));
  const cards = S.data.inspections.filter((i) => i.rental_id === r.id);
  const w = openModal({
    title: html`${r.ref} ${badge(tone(r), isOverdue(r) ? t('Overdue') : null)}`, wide: true,
    body: html`<div class="detail">
      <section><h3>${icon('users')} ${t('Customer')}</h3><p><b>${c?.full_name}</b></p><p class="muted">${c?.phone} · ${c?.id_number}</p>
        <p class="muted">${t('Licence no.')} ${c?.license_number || '—'} · ${fmtDate(c?.license_expiry)}</p></section>
      <section><h3>${icon('car')} ${t('Car')}</h3><p>${plateTag(v)} <b>${carName(v)}</b></p>
        <p class="muted">${t('Odometer out')}: ${r.odometer_out ?? '—'} · ${t('Odometer in')}: ${r.odometer_in ?? '—'}</p>
        <p class="muted">${t('Fuel out')}: ${t(r.fuel_out)} · ${t('Fuel in')}: ${r.fuel_in ? t(r.fuel_in) : '—'}</p>
        <p class="muted">${nameOf(S.data.branches, r.branch_out_id) || '—'} → ${nameOf(S.data.branches, r.branch_in_id) || '—'}</p>
        ${num(r.km_per_day) ? html`<p class="muted">${r.km_per_day} km/${t('day')} · +${money(r.extra_km_rate)}/km</p>` : ''}
        ${r.driver_name ? html`<p class="muted">${t('Additional driver')}: ${r.driver_name} ${r.driver_license ? `· ${r.driver_license}` : ''}</p>` : ''}</section>
      <section><h3>${icon('calendar')} ${t('Days')}</h3><p>${fmtDateTime(r.start_at)} → ${fmtDateTime(r.end_at)}</p>
        ${r.returned_at ? html`<p class="muted">${t('returned')}: ${fmtDateTime(r.returned_at)}</p>` : ''}<p><b>${r.days}</b> × ${money(r.daily_rate)}</p></section>
      <section class="money-box"><div><span>${t('Subtotal')}</span><b>${money(r.subtotal)}</b></div><div><span>${t('VAT')}</span><b>${money(r.vat)}</b></div>
        ${num(r.extra_km_charge) ? html`<div><span>${t('Extra km')}</span><b>${money(r.extra_km_charge)}</b></div>` : ''}
        <div><span>${t('Total')}</span><b>${money(r.total)}</b></div>${num(b.invoiced) ? html`<div><span>${t('Invoiced')}</span><b>${money(b.invoiced)}</b></div>` : ''}<div><span>${t('Paid')}</span><b>${money(b.paid)}</b></div>
        <div class="big"><span>${t('Balance')}</span><b class="${num(b.balance) > 0 ? 'neg' : 'pos'}">${money(b.balance)}</b></div>
        <div><span>${t('Deposit')}</span><b>${money(b.deposit_held)}</b></div></section>
    </div>
    <details class="qr-pair"><summary>${icon('qr-code')} ${t('QR codes: car and Emirates ID')}</summary><div class="c-qr">${contractQr(r, c, v)}</div></details>
    ${r.notes ? html`<p class="note">${r.notes}</p>` : ''}
    ${r.status === 'cancelled' && r.cancel_reason ? html`<p class="note">${t('Cancelled')}: ${r.cancel_reason} · ${fmtDateTime(r.cancelled_at)}</p>` : ''}
    ${reps.length ? html`<h3 class="sub">${icon('arrow-left-right')} ${t('Vehicle replacements')}</h3>${table(reps, [
      { label: 'When', cell: (p) => fmtDateTime(p.replaced_at) },
      { label: 'Car', cell: (p) => html`${plateTag(x.vehicles[p.old_vehicle_id])} → ${plateTag(x.vehicles[p.new_vehicle_id])}` },
      { label: 'Km', cell: (p) => `${p.old_odometer_out ?? '—'} → ${p.old_odometer_in}`, cls: 'num' }, { label: 'Reason', cell: (p) => p.reason || '—' }])}` : ''}
    <h3 class="sub">${icon('wallet')} ${t('Payments')}</h3>
    ${table(pays, [
      { label: 'Reference', cell: (p) => html`<span class="mono">${p.ref}</span>` }, { label: 'Date', cell: (p) => fmtDateTime(p.paid_at) },
      { label: 'Kind', cell: (p) => badge(p.kind) }, { label: 'Method', cell: (p) => t(p.method) }, { label: 'Amount', cell: (p) => money(p.amount), cls: 'num' }])}
    ${fines.length ? html`<h3 class="sub">${icon('siren')} ${t('Fines & Salik')}</h3>${table(fines, [
      { label: 'Occurred', cell: (f) => fmtDateTime(f.occurred_at) }, { label: 'Kind', cell: (f) => t(f.kind) },
      { label: 'Amount', cell: (f) => money(+f.amount + +f.admin_fee), cls: 'num' }, { label: 'Status', cell: (f) => badge(f.status) }])}` : ''}
    ${invs.length ? html`<h3 class="sub">${icon('file-text')} ${t('Invoices')}</h3>${table(invs, [
      { label: 'Reference', cell: (i) => html`<span class="mono">${i.ref}</span>` }, { label: 'Date', cell: (i) => fmtDate(i.issued_on) },
      { label: 'Description', cell: (i) => html`${t(i.kind)} <small class="muted">${i.description}</small>` },
      { label: 'Total', cell: (i) => money(num(i.amount) + num(i.vat)), cls: 'num' }, { label: 'Status', cell: (i) => badge(i.status) }])}` : ''}
    ${cards.length ? html`<h3 class="sub">${icon('clipboard-check')} ${t('Check cards')}</h3>${table(cards, [
      { label: 'Reference', cell: (i) => html`<a class="mono" href="#/checkcard">${i.ref}</a>` }, { label: 'When', cell: (i) => fmtDateTime(i.at) },
      { label: 'Check', cell: (i) => badge(i.kind, t(i.kind === 'checkout' ? 'Check-out' : 'Check-in')) },
      { label: 'Damages', cell: (i) => S.data.damages.filter((d) => d.inspection_id === i.id).length, cls: 'num' }])}` : ''}
    ${events.length ? html`<details class="events"><summary>${icon('history')} ${t('Agreement history')} (${events.length})</summary>${table(events, [
      { label: 'When', cell: (e) => fmtDateTime(e.at) }, { label: 'Who', cell: (e) => e.actor_name || '—' },
      { label: 'What', cell: (e) => badge(e.action, t(e.action.replace(/_/g, ' '))) }, { label: 'Details', cell: (e) => html`<small>${e.details}</small>` }])}</details>` : ''}
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
    ${big && can && ['booked', 'active'].includes(r.status) ? B('endchange', 'calendar-days', 'Extend or cut short') : ''}
    ${big && can && r.status === 'active' ? B('replace', 'arrow-left-right', 'Replace vehicle') : ''}
    ${big && can && ['booked', 'active'].includes(r.status) ? B('driver', 'user-round-check', 'Replace driver') : ''}
    ${big && S.can('inspections', 'write') && ['booked', 'active'].includes(r.status) ? html`<a class="btn ghost" href="#/checkcard?car=${r.vehicle_id}">${icon('clipboard-check')} ${t(r.status === 'booked' ? 'Check-out' : 'Check-in')}</a>` : ''}
    ${can && r.status === 'booked' ? B('cancel', 'ban', 'Cancel booking', 'danger') : ''}
    ${!big ? B('open', 'eye', 'Open') : ''}`;
}

// ── Printable contract ───────────────────────────────────────────────────────
// Two QR codes on every agreement: the car (opens its check-out / check-in) and the hirer (opens the customer record
// with the Emirates ID; staff sign-in is needed, the code itself holds no personal data).
export const customerLink = (c) => `${location.origin}${location.pathname}#/customers?customer=${c.id}`;
function contractQr(r, c, v) {
  return html`${v ? html`<figure>${raw(qrSvg(carLink(v), 3))}<figcaption><b>Car · السيارة</b><span>${plate(v)} · ${carName(v)}</span></figcaption></figure>` : ''}
    ${c ? html`<figure>${raw(qrSvg(customerLink(c), 3))}<figcaption><b>Hirer · Emirates ID · الهوية</b><span>${c.full_name}${c.id_number ? ` · ${c.id_number}` : ''}</span></figcaption></figure>` : ''}`;
}
function printContract(r) {
  const x = lookups(S.data); const c = x.customers[r.customer_id]; const v = x.vehicles[r.vehicle_id]; const s = S.settings || {};
  const b = x.balances[r.id] || {};
  const el = $('#print');
  el.innerHTML = html`<div class="contract">
    <header><img class="c-logo" src="assets/logo.png" alt="" width="70" height="70"><div class="c-co"><h1>${s.company_name}</h1><p>${s.company_address}${s.company_phone ? ' · ' + s.company_phone : ''}</p>${s.trn ? html`<p>TRN ${s.trn}</p>` : ''}</div>
      <div class="r"><h2>Rental Agreement · عقد إيجار</h2><p class="mono">${r.ref}</p><p>${fmtDate(new Date())}</p></div></header>
    <div class="cols">
      <section><h3>Hirer · المستأجر</h3><p><b>${c?.full_name}</b></p><p>${c?.phone}</p><p>ID ${c?.id_number} (${fmtDate(c?.id_expiry)})</p>
        <p>Licence ${c?.license_number} (${fmtDate(c?.license_expiry)})</p><p>${c?.nationality}</p></section>
      <section><h3>Vehicle · المركبة</h3><p><b>${carName(v)}</b> ${v?.year || ''}</p><p>Plate ${plate(v)} · ${v?.emirate}</p>
        <p>Odometer out ${r.odometer_out ?? '______'} · in ${r.odometer_in ?? '______'}</p><p>Fuel out ${r.fuel_out} · in ${r.fuel_in || '______'}</p>
        <p>Km allowed ${num(r.km_per_day) ? `${r.km_per_day}/day · extra ${money(r.extra_km_rate)}/km` : 'unlimited'}</p></section>
    </div>
    ${r.driver_name ? html`<p><b>Additional driver · سائق إضافي:</b> ${r.driver_name}${r.driver_license ? ` · Licence ${r.driver_license}` : ''}${r.driver_phone ? ` · ${r.driver_phone}` : ''}</p>` : ''}
    <p>Pick-up ${nameOf(S.data.branches, r.branch_out_id) || '—'} · Return ${nameOf(S.data.branches, r.branch_in_id) || '—'}</p>
    <table><tr><th>From</th><td>${fmtDateTime(r.start_at)}</td><th>To</th><td>${fmtDateTime(r.end_at)}</td></tr>
      <tr><th>Days</th><td>${r.days}</td><th>Daily rate</th><td>${money(r.daily_rate)}</td></tr>
      <tr><th>Extras</th><td>${money(r.extras)}</td><th>Discount</th><td>${money(r.discount)}</td></tr>
      ${num(r.extra_km_charge) ? html`<tr><th>Extra km</th><td colspan="3">${money(r.extra_km_charge)}</td></tr>` : ''}
      <tr><th>VAT ${r.vat_rate}%</th><td>${money(r.vat)}</td><th>Total</th><td><b>${money(r.total)}</b></td></tr>
      ${num(b.invoiced) ? html`<tr><th>Invoiced (fines etc.)</th><td colspan="3">${money(b.invoiced)}</td></tr>` : ''}
      <tr><th>Paid</th><td>${money(b.paid)}</td><th>Balance</th><td><b>${money(b.balance)}</b></td></tr>
      <tr><th>Deposit</th><td colspan="3">${money(r.deposit)}</td></tr></table>
    <div class="c-qr">${contractQr(r, c, v)}</div>
    <ol class="terms"><li>The hirer is responsible for all traffic fines, Salik and Darb tolls and parking charges during the rental, plus an admin fee. They are invoiced when the car is returned or when the authority reports them.</li>
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
    cancel: (id) => { after(); cancelBooking(find(id)); },
    endchange: (id) => { after(); changeEnd(find(id)); },
    replace: (id) => { after(); replaceVehicle(find(id)); },
    driver: (id) => { after(); replaceDriver(find(id)); },
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
  if (params.get('new') && S.can('rentals', 'write')) {
    const pre = {}; if (params.get('car')) pre.vehicle_id = params.get('car'); if (params.get('customer')) pre.customer_id = params.get('customer');
    rentalForm(null, pre, { id: !!params.get('idscan') && !!pre.customer_id });
  }
  const open = params.get('open'); if (open && S.data.rentals.some((r) => r.id === open)) detail(S.data.rentals.find((r) => r.id === open));
  return () => render(root);
}
export { rentalForm };
