// Reports: monthly P&L-style summary and per-car performance. Everything exports to CSV.
import { html, icon, money, sum, num, plate, carName, csv, download, todayISO, round2, groupBy } from '../util.js';
import { t } from '../i18n.js';
import { table, plateTag, wireActions } from '../ui.js';
import { lookups } from '../schema.js';
import { S } from '../store.js';

const monthKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleString('en-US', { month: 'short', year: 'numeric' });

function monthly() {
  const keys = []; const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); keys.push(monthKey(x)); }
  const rentals = groupBy(S.data.rentals.filter((r) => r.status !== 'cancelled'), (r) => monthKey(r.start_at));
  const pays = groupBy(S.data.payments, (p) => monthKey(p.paid_at));
  const exps = groupBy(S.data.expenses, (e) => monthKey(e.spent_on));
  const maint = groupBy(S.data.maintenance, (m) => monthKey(m.opened_on));
  return keys.map((k) => {
    const revenue = sum(rentals[k], 'subtotal');
    const collected = sum(pays[k], (p) => (p.kind === 'payment' ? p.amount : p.kind === 'refund' ? -p.amount : 0));
    const costs = round2(sum(exps[k], 'amount') + sum(maint[k], 'cost'));
    return { k, count: (rentals[k] || []).length, revenue, collected, costs, net: round2(revenue - costs) };
  });
}

function perCar() {
  const since = new Date(Date.now() - 90 * 86400000);
  return S.data.vehicles.map((v) => {
    const rs = S.data.rentals.filter((r) => r.vehicle_id === v.id && r.status !== 'cancelled');
    const recent = rs.filter((r) => new Date(r.end_at) > since);
    const daysOut = recent.reduce((a, r) => a + Math.max(0, (Math.min(Date.now(), new Date(r.returned_at || r.end_at)) - Math.max(since, new Date(r.start_at))) / 86400000), 0);
    const cost = sum(S.data.maintenance.filter((m) => m.vehicle_id === v.id), 'cost') + sum(S.data.expenses.filter((e) => e.vehicle_id === v.id), 'amount');
    const revenue = sum(rs, 'subtotal');
    return { v, rentals: rs.length, revenue, cost: round2(cost), util: Math.min(100, Math.round((daysOut / 90) * 100)), net: round2(revenue - cost) };
  }).sort((a, b) => b.revenue - a.revenue);
}

export function render(root) {
  const m = monthly(); const cars = perCar();
  const max = Math.max(1, ...m.map((r) => Math.max(r.revenue, r.costs)));
  const showCosts = S.can('expenses', 'read');
  root.innerHTML = html`
    <div class="page-head"><div><h1>${icon('chart-column')} ${t('Reports')}</h1><p class="muted">${t('Monthly summary')} · ${t('Revenue by car')}</p></div>
      <div class="head-actions"><button class="btn ghost" data-act="csv-month">${icon('download')} ${t('Monthly summary')}</button>
      <button class="btn ghost" data-act="csv-car">${icon('download')} ${t('Revenue by car')}</button></div></div>
    <section class="card"><header><h2>${t('Monthly summary')}</h2><div class="legend"><i class="active"></i>${t('Revenue')} ${showCosts ? html`<i class="overdue"></i>${t('Expenses')}` : ''}</div></header>
      <div class="bars">${m.map((r) => html`<div class="bar-col"><div class="bar-pair">
        <i class="rev" style="height:${((r.revenue / max) * 100).toFixed(1)}%" title="${money(r.revenue)}"></i>
        ${showCosts ? html`<i class="cost" style="height:${((r.costs / max) * 100).toFixed(1)}%" title="${money(r.costs)}"></i>` : ''}</div>
        <span>${monthLabel(r.k)}</span></div>`)}</div>
      ${table(m.slice().reverse(), [
        { label: 'Month', cell: (r) => monthLabel(r.k) }, { label: 'Rentals count', cell: (r) => r.count, cls: 'num' },
        { label: 'Revenue', cell: (r) => money(r.revenue), cls: 'num' }, { label: 'Collected', cell: (r) => money(r.collected), cls: 'num' },
        ...(showCosts ? [{ label: 'Expenses', cell: (r) => money(r.costs), cls: 'num' }, { label: 'Net', cell: (r) => html`<b class="${r.net < 0 ? 'neg' : 'pos'}">${money(r.net)}</b>`, cls: 'num' }] : []),
      ])}
      <p class="muted small">${t('Revenue')} = ${t('Subtotal')} (excl. ${t('VAT')}) of rentals starting in the month.${showCosts ? ` ${t('Expenses')} = ${t('Expenses')} + ${t('Maintenance')}.` : ''}</p></section>
    <section class="card"><header><h2>${t('Revenue by car')}</h2><span class="muted small">${t('Utilisation')}: 90d</span></header>
      ${table(cars, [
        { label: 'Car', cell: (r) => html`${plateTag(r.v)} <small class="muted">${carName(r.v)}</small>` },
        { label: 'Rentals count', cell: (r) => r.rentals, cls: 'num' }, { label: 'Revenue', cell: (r) => money(r.revenue), cls: 'num' },
        { label: 'Cost', cell: (r) => money(r.cost), cls: 'num' }, { label: 'Net', cell: (r) => html`<b class="${r.net < 0 ? 'neg' : 'pos'}">${money(r.net)}</b>`, cls: 'num' },
        { label: 'Utilisation', cell: (r) => html`<div class="meter sm"><i style="width:${r.util}%"></i></div><small>${r.util}%</small>` },
      ])}</section>`.toString();
}

export function mountReports(root) {
  wireActions(root, {
    'csv-month': () => download(`monthly-${todayISO()}.csv`, csv(monthly(), [
      { label: 'Month', key: 'k' }, { label: 'Rentals', key: 'count' }, { label: 'Revenue', key: 'revenue' }, { label: 'Collected', key: 'collected' },
      { label: 'Costs', key: 'costs' }, { label: 'Net', key: 'net' }])),
    'csv-car': () => download(`cars-${todayISO()}.csv`, csv(perCar(), [
      { label: 'Plate', csv: (r) => plate(r.v) }, { label: 'Car', csv: (r) => carName(r.v) }, { label: 'Rentals', key: 'rentals' },
      { label: 'Revenue', key: 'revenue' }, { label: 'Cost', key: 'cost' }, { label: 'Net', key: 'net' }, { label: 'Utilisation 90d %', key: 'util' }])),
  });
  render(root); return () => render(root);
}
