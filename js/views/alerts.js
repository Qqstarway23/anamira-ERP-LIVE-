// Alerts: everything that needs someone's attention, in one list. The dashboard shows the top of it.
import { html, icon, money, fmtDateTime, fmtDate, plate, carName, daysUntil, num } from '../util.js';
import { t } from '../i18n.js';
import { empty } from '../ui.js';
import { lookups, serviceDue, nameOf } from '../schema.js';
import { customerEntries, lastBalance } from '../ledger.js';
import { S } from '../store.js';

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export function collectAlerts() {
  const x = lookups(S.data); const items = []; const now = new Date();
  const days = num(S.settings?.alert_days) || 30;
  const add = (lvl, ic, text, tag, href, group) => items.push({ lvl, ic, text, tag: t(tag), href, group });
  for (const r of S.data.rentals) {
    const c = x.customers[r.customer_id]?.full_name; const v = plate(x.vehicles[r.vehicle_id]);
    if (r.status === 'active' && new Date(r.end_at) < now) add(3, 'clock', `${r.ref} · ${c} · ${v}`, 'Overdue', `#/rentals?open=${r.id}`, 'Rentals');
    else if (r.status === 'active' && sameDay(r.end_at, now)) add(2, 'undo-2', `${r.ref} · ${c} · ${v} · ${fmtDateTime(r.end_at)}`, 'Due back today', `#/rentals?open=${r.id}`, 'Rentals');
    if (r.status === 'booked' && new Date(r.start_at) <= new Date(now.getTime() + 86400000)) add(new Date(r.start_at) < now ? 3 : 2, 'key-round', `${r.ref} · ${c} · ${v} · ${fmtDateTime(r.start_at)}`, 'Pick-ups today', `#/rentals?open=${r.id}`, 'Rentals');
    if (r.status === 'returned' && num(x.balances[r.id]?.balance) > 0.009) add(2, 'circle-dollar-sign', `${r.ref} · ${c} · ${money(x.balances[r.id].balance)}`, 'Outstanding', `#/rentals?open=${r.id}`, 'Money');
  }
  for (const v of S.data.vehicles) {
    if (v.status === 'retired') continue;
    for (const [k, label] of [['insurance_expiry', 'Insurance expiry'], ['registration_expiry', 'Registration expiry']]) {
      const d = daysUntil(v[k]);
      if (d != null && d <= days) add(d < 0 ? 3 : d <= 7 ? 2 : 1, 'shield-check', `${plate(v)} · ${carName(v)} · ${fmtDate(v[k])}`, label, `#/fleet?preset=${k === 'insurance_expiry' ? 'insurance' : 'registration'}`, 'Fleet');
    }
    if (serviceDue(v, S.settings, days)) add(1, 'wrench', `${plate(v)} · ${carName(v)} · ${(+v.odometer).toLocaleString()} km`, 'Service due', '#/fleet?preset=service', 'Fleet');
  }
  const open = new Set(S.data.rentals.filter((r) => ['booked', 'active'].includes(r.status)).map((r) => r.customer_id));
  for (const c of S.data.customers) {
    if (!open.has(c.id)) continue;
    for (const [k, label] of [['license_expiry', 'Licence expiry'], ['id_expiry', 'ID expiry'], ['passport_expiry', 'Passport expiry']]) {
      const d = daysUntil(c[k]); if (d != null && d <= days) add(d < 0 ? 3 : 2, 'id-card', `${c.full_name} · ${fmtDate(c[k])}`, label, '#/customers', 'Customers');
    }
  }
  for (const c of S.data.customers.filter((c) => c.account_type === 'credit' && num(c.credit_limit) > 0)) {
    const bal = lastBalance(customerEntries(c.id, S.data));
    if (bal > num(c.credit_limit)) add(2, 'scale', `${c.full_name} · ${money(bal)} / ${money(c.credit_limit)}`, 'Over credit limit', `#/accounts?tab=customers&open=${c.id}`, 'Money');
  }
  for (const e of S.data.employees.filter((e) => e.active !== false)) {
    const d = daysUntil(e.license_expiry); if (d != null && d <= days) add(d < 0 ? 2 : 1, 'id-card', `${e.code} · ${e.full_name} · ${fmtDate(e.license_expiry)}`, 'Employee licence expiry', '#/people?tab=employees', 'Staff');
  }
  for (const m of S.data.movements.filter((m) => m.status === 'open')) {
    const late = m.expected_in_at && new Date(m.expected_in_at) < now;
    add(late ? 3 : 1, 'route', `${m.ref} · ${plate(x.vehicles[m.vehicle_id])} · ${nameOf(S.data.employees, m.employee_id, (e) => e.full_name)}`, late ? 'Staff car overdue' : 'Staff car out', '#/movements', 'Staff');
  }
  for (const m of S.data.maintenance.filter((m) => m.status === 'open')) {
    const late = m.expected_on && m.expected_on < now.toISOString().slice(0, 10);
    add(late ? 2 : 1, 'wrench', `${plate(x.vehicles[m.vehicle_id])} · ${m.job_type || t(m.kind)} · ${m.description}`, late ? 'Garage job late' : 'In the garage', '#/maintenance', 'Fleet');
  }
  const unmatched = S.data.fines.filter((f) => ['new', 'unmatched'].includes(f.status)).length;
  if (unmatched) add(2, 'siren', `${unmatched} ${t('Fines & Salik')}`, 'Not matched to a rental', '#/fines', 'Money');
  const notInv = S.data.fines.filter((f) => f.status === 'charged' && !f.invoice_id && f.customer_id && (!S.settings?.fines_invoice_from || new Date(f.occurred_at) >= new Date(`${S.settings.fines_invoice_from}T00:00:00`))).length;
  if (notInv && S.can('invoices', 'write')) add(1, 'file-check', `${notInv} ${t('charged fines not invoiced yet')}`, 'To invoice', '#/invoices', 'Money');
  for (const b of S.data.bills.filter((b) => b.status === 'open' && b.due_date && daysUntil(b.due_date) <= 7)) {
    add(daysUntil(b.due_date) < 0 ? 2 : 1, 'scroll', `${b.ref} · ${nameOf(S.data.suppliers, b.supplier_id)} · ${money(+b.amount + +b.vat)} · ${fmtDate(b.due_date)}`, 'Supplier bill due', '#/bills', 'Money');
  }
  const dmg = S.data.damages.filter((d) => d.status === 'open');
  const cars = new Set(dmg.map((d) => d.vehicle_id));
  if (dmg.length) add(1, 'circle-alert', `${dmg.length} ${t('open damages on')} ${cars.size} ${t('cars')}`, 'Damages to repair', '#/fleet?preset=damaged', 'Fleet');
  return items.sort((a, b) => b.lvl - a.lvl);
}

export const alertList = (items) => (items.length
  ? html`<ul class="alerts">${items.map((i) => html`<li class="lvl${i.lvl}"><a href="${i.href}">${icon(i.ic)}<span>${i.text}</span><em>${i.tag}</em></a></li>`)}</ul>`
  : empty('Nothing needs attention', 'circle-check'));

export function mountAlerts(root) {
  const st = { group: '' };
  const render = () => {
    const all = collectAlerts(); const groups = [...new Set(all.map((i) => i.group))];
    const list = all.filter((i) => !st.group || i.group === st.group);
    root.innerHTML = html`<div class="page-head"><div><h1>${icon('bell')} ${t('Alerts')}</h1><p class="muted">${all.filter((i) => i.lvl === 3).length} ${t('urgent')} · ${all.length} ${t('total')}</p></div></div>
      <div class="toolbar"><div class="chips"><button class="chip ${!st.group ? 'on' : ''}" data-g="">${t('All')} <i>${all.length}</i></button>
        ${groups.map((g) => html`<button class="chip ${st.group === g ? 'on' : ''}" data-g="${g}">${t(g)} <i>${all.filter((i) => i.group === g).length}</i></button>`)}</div></div>
      <section class="card">${alertList(list)}</section>`.toString();
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) { st.group = b.dataset.g; render(); } });
  render(); return render;
}
