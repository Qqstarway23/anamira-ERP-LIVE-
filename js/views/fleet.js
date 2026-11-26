// Fleet board, vehicle history, de-fleet; staff movements; garage & maintenance.
import { html, raw, icon, money, fmtDateTime, fmtDate, plate, carName, daysUntil, num } from '../util.js';
import { t } from '../i18n.js';
import { actBtn, badge, plateTag, table, openModal, formModal, toast, confirmBox } from '../ui.js';
import { lookups, nameOf, serviceDue } from '../schema.js';
import { describeSipp, FUEL } from '../rules.js';
import { recordsView } from './records.js';
import { diagramSvg, qrSvg, carLink, printQrLabels, printCheckCard } from './checkcard.js';
import { S, reload } from '../store.js';

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const within = (d, days) => { const n = daysUntil(d); return n != null && n <= days; };

// Everything that happened to one car: rentals, replacements, staff movements, garage jobs, check cards, damages, fines.
export function vehicleHistory(id) {
  const x = lookups(S.data); const v = x.vehicles[id]; if (!v) return;
  const ev = [];
  for (const r of S.data.rentals.filter((r) => r.vehicle_id === id && r.status !== 'cancelled')) {
    ev.push({ at: r.start_at, to: r.returned_at || r.end_at, kind: 'rental', ref: r.ref, href: `#/rentals?open=${r.id}`, who: x.customers[r.customer_id]?.full_name,
      km: r.odometer_in != null && r.odometer_out != null ? r.odometer_in - r.odometer_out : null, status: r.status });
  }
  for (const rep of S.data.vehicle_replacements.filter((p) => p.old_vehicle_id === id || p.new_vehicle_id === id)) {
    const r = x.rentals[rep.rental_id];
    ev.push({ at: rep.replaced_at, kind: 'vehicle_replaced', ref: r?.ref, href: r ? `#/rentals?open=${r.id}` : '', who: rep.old_vehicle_id === id ? `→ ${plate(x.vehicles[rep.new_vehicle_id])}` : `← ${plate(x.vehicles[rep.old_vehicle_id])}`, status: 'vehicle_replaced', note: rep.reason });
  }
  for (const m of S.data.movements.filter((m) => m.vehicle_id === id)) {
    ev.push({ at: m.out_at, to: m.in_at, kind: m.kind, ref: m.ref, who: nameOf(S.data.employees, m.employee_id, (e) => e.full_name), km: m.odometer_in != null ? m.odometer_in - m.odometer_out : null, status: m.status, note: m.purpose });
  }
  for (const m of S.data.maintenance.filter((m) => m.vehicle_id === id)) {
    ev.push({ at: m.opened_on, to: m.closed_on, kind: 'maintenance', ref: m.job_type || t(m.kind), who: nameOf(S.data.suppliers, m.supplier_id) || m.vendor, status: m.status, note: `${m.description} · ${money(m.cost)}` });
  }
  for (const f of S.data.fines.filter((f) => f.vehicle_id === id)) ev.push({ at: f.occurred_at, kind: f.kind, ref: f.reference, who: x.customers[f.customer_id]?.full_name || nameOf(S.data.employees, f.employee_id, (e) => e.full_name), status: f.status, note: `${f.location} · ${money(f.amount)}` });
  ev.sort((a, b) => new Date(b.at) - new Date(a.at));
  const dmg = S.data.damages.filter((d) => d.vehicle_id === id).map((d, i) => ({ ...d, label: i + 1 }));
  const cards = S.data.inspections.filter((i) => i.vehicle_id === id);
  const rev = S.data.rentals.filter((r) => r.vehicle_id === id && r.status !== 'cancelled').reduce((a, r) => a + num(r.subtotal), 0);
  const cost = S.data.maintenance.filter((m) => m.vehicle_id === id).reduce((a, m) => a + num(m.cost), 0);
  const w = openModal({
    title: html`${icon('car-front')} ${plate(v)} · ${carName(v)}`, wide: true,
    body: html`<div class="detail">
      <section><h3>${icon('car')} ${t('Car')}</h3><p>${plateTag(v)} ${badge(v.status)}</p><p class="muted">${v.year || ''} · ${v.color || ''} · ${t(v.transmission)} · ${t(v.fuel_type)}</p>
        ${v.sipp_code ? html`<p class="muted"><b class="mono">${v.sipp_code}</b> ${describeSipp(v.sipp_code)}</p>` : ''}${v.vin ? html`<p class="muted">VIN ${v.vin}</p>` : ''}
        <p class="muted">${(+v.odometer).toLocaleString()} km · ${nameOf(S.data.branches, v.branch_id)}</p></section>
      <section class="money-box"><div><span>${t('Revenue')}</span><b>${money(rev)}</b></div><div><span>${t('Garage costs')}</span><b>${money(cost)}</b></div>
        <div class="big"><span>${t('Net')}</span><b>${money(rev - cost)}</b></div>
        <div><span>${t('Insurance expiry')}</span><b>${fmtDate(v.insurance_expiry)}</b></div><div><span>${t('Registration expiry')}</span><b>${fmtDate(v.registration_expiry)}</b></div>
        ${v.defleeted_on ? html`<div><span>${t('De-fleeted')}</span><b>${fmtDate(v.defleeted_on)} · ${money(v.defleet_price)}</b></div>` : ''}</section>
      <section class="qr-box">${raw(qrSvg(carLink(v), 3))}<button class="btn sm ghost" data-h="qr">${icon('printer')} ${t('Print QR label')}</button></section></div>
    <h3 class="sub">${icon('circle-alert')} ${t('Damages')} <small class="muted">${dmg.filter((d) => d.status === 'open').length} ${t('open')}</small></h3>
    <div class="mini-diagrams">${diagramSvg('exterior', dmg)}${diagramSvg('interior', dmg)}</div>
    ${table(dmg, [{ label: '#', cell: (d) => d.label }, { label: 'Date', cell: (d) => fmtDate(d.created_at) }, { label: 'Kind', cell: (d) => html`${t(d.view)} · ${t(d.kind)} · ${badge(d.severity)}` },
      { label: 'Notes', cell: (d) => d.note || '—' }, { label: 'Status', cell: (d) => html`${badge(d.status)}${d.repaired_on ? html`<small class="muted block">${fmtDate(d.repaired_on)}</small>` : ''}` }],
    { empty: 'No damages recorded', actions: S.can('damages', 'write') ? (d) => (d.status === 'open' ? html`<button class="btn sm ghost" data-h="fix" data-id="${d.id}">${icon('check')} ${t('Mark repaired')}</button>` : '') : null })}
    <h3 class="sub">${icon('clipboard-check')} ${t('Check cards')}</h3>
    ${table(cards, [{ label: 'Reference', cell: (i) => html`<span class="mono">${i.ref}</span>` }, { label: 'When', cell: (i) => fmtDateTime(i.at) },
      { label: 'Check', cell: (i) => badge(i.kind, t(i.kind === 'checkout' ? 'Check-out' : 'Check-in')) }, { label: 'Odometer', cell: (i) => `${(+i.odometer).toLocaleString()} · ${t(i.fuel)}`, cls: 'num' }],
    { empty: 'No check cards yet', actions: (i) => html`<button class="icon-btn" data-h="card" data-id="${i.id}" aria-label="${t('Print check card')}" title="${t('Print check card')}">${icon('printer')}</button>` })}
    <h3 class="sub">${icon('history')} ${t('Movement log')}</h3>
    ${table(ev, [{ label: 'Date', cell: (e) => html`${fmtDateTime(e.at)}${e.to ? html`<small class="muted block">→ ${fmtDateTime(e.to)}</small>` : ''}` },
      { label: 'Kind', cell: (e) => html`${t(e.kind === 'nrm' ? 'Staff use (NRM)' : e.kind)}` }, { label: 'Reference', cell: (e) => (e.href ? html`<a class="mono" href="${e.href}">${e.ref}</a>` : html`<span class="mono">${e.ref || ''}</span>`) },
      { label: 'Who', cell: (e) => html`${e.who || '—'}${e.note ? html`<small class="muted block">${e.note}</small>` : ''}` }, { label: 'Km', cell: (e) => (e.km != null ? e.km.toLocaleString() : ''), cls: 'num' },
      { label: 'Status', cell: (e) => badge(e.status) }], { empty: 'Nothing here yet' })}`,
  });
  w.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    if (b.dataset.h === 'qr') printQrLabels([v]);
    if (b.dataset.h === 'card') printCheckCard(b.dataset.id);
    if (b.dataset.h === 'fix') {
      try { await S.backend.update('damages', b.dataset.id, { status: 'repaired' }); toast(t('Saved')); await reload('damages'); vehicleHistory(id); } catch (ex) { toast(ex.message, 'err'); }
    }
  });
}

function defleet(v) {
  formModal({
    title: `${t('De-fleet')} · ${plate(v)}`, wide: false, row: { defleeted_on: new Date().toISOString(), defleet_reason: 'sold', defleet_price: 0 },
    fields: [{ key: 'defleeted_on', label: 'Date', type: 'date', req: true }, { key: 'defleet_reason', label: 'Reason', req: true, max: 200, list: ['sold', 'total loss', 'lease returned', 'transferred'] },
      { key: 'defleet_price', label: 'Sale price', type: 'money' }],
    submitText: t('De-fleet'),
    onSubmit: async (vals) => {
      if (S.data.rentals.some((r) => r.vehicle_id === v.id && ['booked', 'active'].includes(r.status))) throw new Error(t('This car still has open rentals. Close or move them first.'));
      await S.backend.update('vehicles', v.id, { ...vals, status: 'retired' }); toast(t('Saved')); await reload('vehicles');
    },
  });
}

const PRESETS = {
  insurance: { label: 'Insurance due', alert: true, fn: (v, x) => v.status !== 'retired' && within(v.insurance_expiry, x.settings?.alert_days ?? 30) },
  registration: { label: 'Registration due', alert: true, fn: (v, x) => v.status !== 'retired' && within(v.registration_expiry, x.settings?.alert_days ?? 30) },
  service: { label: 'Service due', alert: true, fn: (v, x) => serviceDue(v, x.settings, x.settings?.alert_days ?? 30) },
  damaged: { label: 'Open damages', fn: (v) => S.data.damages.some((d) => d.vehicle_id === v.id && d.status === 'open') },
};

export function fleetPage(root, params) {
  let board = store.get('anamira.fleetView') !== 'list';
  const v = recordsView('vehicles', {
    presets: PRESETS, initial: { preset: params?.get('preset') || '' },
    headerExtra: () => html`<button class="btn ghost" data-act="qrall">${icon('qr-code')} ${t('QR labels')}</button>`,
    rowActions: (c) => html`${actBtn('hist', c.id, 'history', 'History')}${S.can('vehicles', 'write') && c.status !== 'retired' ? actBtn('defleet', c.id, 'flag', 'De-fleet') : ''}`,
    viewToggle: Object.assign(() => html`<div class="seg"><button class="${board ? 'on' : ''}" data-act="board" data-id="1">${t('Board')}</button><button class="${!board ? 'on' : ''}" data-act="board" data-id="">${t('List')}</button></div>`, {
      custom: (list) => (board ? html`<div class="car-grid">${list.map((c) => {
        const r = S.data.rentals.find((x) => x.vehicle_id === c.id && x.status === 'active');
        const mv = S.data.movements.find((m) => m.vehicle_id === c.id && m.status === 'open');
        const next = S.data.rentals.filter((x) => x.vehicle_id === c.id && x.status === 'booked').sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0];
        const cust = (id) => S.data.customers.find((x) => x.id === id)?.full_name;
        const dmg = S.data.damages.filter((d) => d.vehicle_id === c.id && d.status === 'open').length;
        const x = lookups(S.data);
        const flags = [PRESETS.insurance.fn(c, x) && t('Insurance due'), PRESETS.registration.fn(c, x) && t('Registration due'), PRESETS.service.fn(c, x) && t('Service due')].filter(Boolean);
        return html`<article class="car-card ${c.status}">
          <header>${plateTag(c)}${badge(c.status, c.status === 'nrm' ? t('Staff use (NRM)') : null)}</header>
          <h3>${carName(c)}</h3><p class="muted">${c.year || ''} · ${t(c.category)}${c.color ? ' · ' + c.color : ''} · ${(+c.odometer).toLocaleString()} km${c.sipp_code ? ` · ${c.sipp_code}` : ''}</p>
          <div class="price">${money(c.daily_rate)}<small>/day</small></div>
          ${r ? html`<p class="small">${icon('clock')} ${cust(r.customer_id)} · <a href="#/rentals?open=${r.id}">${r.ref}</a></p>`
            : mv ? html`<p class="small">${icon('route')} ${nameOf(S.data.employees, mv.employee_id, (e) => e.full_name)} · ${mv.ref}</p>`
              : next ? html`<p class="small muted">${icon('calendar')} ${t('booked')} ${new Date(next.start_at).toLocaleDateString('en-GB')}</p>` : html`<p class="small muted">&nbsp;</p>`}
          ${flags.length || dmg ? html`<p class="flags">${flags.map((f) => html`<span class="badge amber">${f}</span>`)}${dmg ? html`<span class="badge red">${dmg} ${t('damages')}</span>` : ''}</p>` : ''}
          <footer>${c.status === 'available' && S.can('rentals', 'write') ? html`<a class="btn sm primary" href="#/rentals?new=1&car=${c.id}">${icon('key-round')} ${t('New rental')}</a>` : ''}
            ${S.can('inspections', 'write') && c.status !== 'retired' ? html`<a class="btn sm ghost" href="#/checkcard?car=${c.id}" title="${t('Check-out / check-in')}">${icon('clipboard-check')}</a>` : ''}
            ${actBtn('hist', c.id, 'history', 'History')}${S.can('vehicles', 'write') ? actBtn('edit', c.id, 'pencil', 'Edit') : ''}</footer></article>`;
      })}</div>` : null),
    }),
  });
  const draw = () => v.render(root);
  v.wire(root, {
    board: (on) => { board = !!on; store.set('anamira.fleetView', board ? 'board' : 'list'); draw(); },
    hist: (id) => vehicleHistory(id), defleet: (id) => defleet(S.data.vehicles.find((c) => c.id === id)),
    qrall: () => printQrLabels(v.rows().filter((c) => c.status !== 'retired')),
  });
  draw();
  if (params?.get('history')) vehicleHistory(params.get('history'));
  return draw;
}

// ── Staff movements (NRM / custody) ──────────────────────────────────────────
function closeMovement(m) {
  formModal({
    title: `${t('Close movement')} · ${m.ref}`, wide: false, row: { in_at: new Date().toISOString(), odometer_in: m.odometer_out, fuel_in: 'full', to_branch_id: m.to_branch_id },
    fields: [{ key: 'in_at', label: 'Returned', type: 'datetime', req: true }, { key: 'odometer_in', label: 'Odometer in', type: 'int', req: true, min: m.odometer_out ?? 0 },
      { key: 'fuel_in', label: 'Fuel in', type: 'select', req: true, options: FUEL },
      { key: 'to_branch_id', label: 'Returned to branch', type: 'ref', ref: 'branches', refLabel: (b) => b.name, refFilter: (b) => b.active !== false }],
    data: S.data, submitText: t('Close movement'),
    extra: html`<p class="muted small">${icon('info')} ${t('For a full check card with damages and signatures, use Check-out / check-in instead.')}</p>`,
    onSubmit: async (vals) => {
      // The time box has no seconds: a car closed in the same minute it went out would look like it came back before it left.
      const gap = new Date(m.out_at) - new Date(vals.in_at);
      if (gap > 0 && gap < 60000) vals.in_at = m.out_at;
      await S.backend.update('movements', m.id, { ...vals, status: 'closed' }); toast(t('Saved')); await reload('movements');
    },
  });
}
export function movementsPage(root) {
  const v = recordsView('movements', {
    initial: { filter: 'open' },
    beforeTable: () => html`<p class="muted small">${icon('info')} ${t('Staff use (NRM) is a car moved or used by an employee, for example to another branch or the garage. Custody is a car handed to an employee for a longer time. Fines during either are charged to the employee.')}</p>`,
    rowActions: (m) => html`${m.status === 'open' && S.can('movements', 'write') ? actBtn('close', m.id, 'undo-2', 'Close movement') : ''}${S.can('inspections', 'write') && m.status === 'open' ? html`<a class="icon-btn" href="#/checkcard?car=${m.vehicle_id}" title="${t('Check-in')}" aria-label="${t('Check-in')}">${icon('clipboard-check')}</a>` : ''}`,
  });
  v.wire(root, { close: (id) => closeMovement(S.data.movements.find((m) => m.id === id)) });
  const draw = () => v.render(root); draw(); return draw;
}

// ── Garage & maintenance ─────────────────────────────────────────────────────
export function maintenancePage(root) {
  const v = recordsView('maintenance', {
    presets: { late: { label: 'Past expected date', alert: true, fn: (m) => m.status === 'open' && m.expected_on && m.expected_on < new Date().toISOString().slice(0, 10) } },
    rowActions: (m) => (m.status === 'open' && S.can('maintenance', 'write') ? actBtn('done', m.id, 'check', 'Mark done') : ''),
  });
  v.wire(root, {
    done: async (id) => {
      const m = S.data.maintenance.find((x) => x.id === id);
      const open = S.data.damages.filter((d) => d.vehicle_id === m.vehicle_id && d.status === 'open');
      try {
        await S.backend.update('maintenance', id, { status: 'done' });
        if (open.length && S.can('damages', 'write') && await confirmBox(`${open.length} ${t('open damages on this car. Mark them repaired by this job?')}`, { okText: t('Mark repaired') })) {
          for (const d of open) await S.backend.update('damages', d.id, { status: 'repaired', maintenance_id: id });
        }
        toast(t('Saved')); await reload('maintenance');
      } catch (e) { toast(e.message, 'err'); }
    },
  });
  const draw = () => v.render(root); draw(); return draw;
}
