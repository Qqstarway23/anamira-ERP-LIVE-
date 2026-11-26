// Dashboard: today at a glance, what needs attention, and a 14-day fleet timeline.
import { html, icon, money, carName, sum, num } from '../util.js';
import { t } from '../i18n.js';
import { badge, plateTag, empty } from '../ui.js';
import { lookups } from '../schema.js';
import { S } from '../store.js';
import { collectAlerts, alertList } from './alerts.js';

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function timeline(x) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const DAYS = 14; const end = new Date(start.getTime() + DAYS * 86400000);
  const pct = (d) => Math.max(0, Math.min(100, ((new Date(d) - start) / (end - start)) * 100));
  const cars = S.data.vehicles.filter((v) => v.status !== 'retired');
  const head = Array.from({ length: DAYS }, (_, i) => new Date(start.getTime() + i * 86400000));
  const nowPct = pct(new Date());
  return html`<div class="timeline" role="table" aria-label="${t('Next 14 days')}">
    <div class="tl-row tl-head"><div class="tl-car"></div><div class="tl-track">${head.map((d) => html`<span class="${[0, 6].includes(d.getDay()) ? 'we' : ''}">${d.getDate()}<small>${d.toLocaleString('en-US', { weekday: 'narrow' })}</small></span>`)}</div></div>
    ${cars.map((v) => {
      const bars = S.data.rentals.filter((r) => r.vehicle_id === v.id && ['booked', 'active'].includes(r.status) && new Date(r.start_at) < end && new Date(r.end_at) > start);
      const jobs = S.data.maintenance.filter((m) => m.vehicle_id === v.id && m.status === 'open');
      return html`<div class="tl-row"><div class="tl-car">${plateTag(v)}<small>${carName(v)}</small></div><div class="tl-track">
        ${jobs.length ? html`<a href="#/maintenance" class="bar maint" style="left:0;width:${nowPct.toFixed(2)}%" title="${t('Maintenance')}">${icon('wrench')}</a>` : ''}
        ${bars.map((r) => {
          const l = pct(r.start_at); const w = Math.max(1.5, pct(r.end_at) - l);
          const late = r.status === 'active' && new Date(r.end_at) < new Date();
          return html`<a href="#/rentals?open=${r.id}" class="bar ${late ? 'overdue' : r.status}" style="left:${l.toFixed(2)}%;width:${(late ? nowPct - l + 1 : w).toFixed(2)}%" title="${r.ref} · ${x.customers[r.customer_id]?.full_name}">${x.customers[r.customer_id]?.full_name?.split(' ')[0] || r.ref}</a>`;
        })}
        <i class="now" style="left:${nowPct.toFixed(2)}%"></i></div></div>`;
    })}</div>`;
}

export function render(root) {
  const x = lookups(S.data);
  const fleet = S.data.vehicles.filter((v) => v.status !== 'retired');
  const out = S.data.rentals.filter((r) => r.status === 'active');
  const util = fleet.length ? Math.round((out.length / fleet.length) * 100) : 0;
  const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const monthRentals = S.data.rentals.filter((r) => r.status !== 'cancelled' && new Date(r.start_at) >= m0);
  const collected = sum(S.data.payments.filter((p) => new Date(p.paid_at) >= m0), (p) => (p.kind === 'payment' ? p.amount : p.kind === 'refund' ? -p.amount : 0));
  const outstanding = sum(S.data.rentals.filter((r) => ['active', 'returned'].includes(r.status)), (r) => Math.max(0, num(x.balances[r.id]?.balance)));
  const items = collectAlerts();
  const byStatus = (s) => fleet.filter((v) => v.status === s).length;
  const hello = S.me?.full_name ? `${S.me.full_name.split(' ')[0]}` : '';
  root.innerHTML = html`
    <div class="page-head"><div><h1>${t('Dashboard')}</h1><p class="muted">${hello ? `👋 ${hello} · ` : ''}${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="head-actions">${S.can('rentals', 'write') ? html`<a class="btn primary" href="#/rentals?new=1">${icon('plus')} ${t('New rental')}</a>` : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><span>${icon('car')} ${t('Cars out now')}</span><b>${out.length}<small>/ ${fleet.length}</small></b>
        <div class="meter"><i style="width:${util}%"></i></div><em>${t('Utilisation')} ${util}%</em></div>
      <div class="kpi"><span>${icon('key-round')} ${t('Pick-ups today')}</span><b>${S.data.rentals.filter((r) => r.status === 'booked' && sameDay(r.start_at, new Date())).length}</b>
        <em>${t('Due back today')}: ${out.filter((r) => sameDay(r.end_at, new Date())).length} · <span class="${out.some((r) => new Date(r.end_at) < new Date()) ? 'neg' : ''}">${t('Overdue')}: ${out.filter((r) => new Date(r.end_at) < new Date()).length}</span></em></div>
      <div class="kpi"><span>${icon('chart-column')} ${t('Revenue')} · ${t('This month')}</span><b>${money(sum(monthRentals, 'total'))}</b><em>${monthRentals.length} ${t('Rentals')}</em></div>
      <div class="kpi"><span>${icon('coins')} ${t('Collected')} · ${t('This month')}</span><b>${money(collected)}</b><em class="${outstanding > 0 ? 'neg' : ''}">${t('Outstanding')}: ${money(outstanding)}</em></div>
    </div>
    <div class="fleet-strip">${['available', 'rented', 'nrm', 'custody', 'maintenance'].filter((s) => s !== 'custody' || byStatus(s)).map((s) => html`<a href="#/fleet" class="pill ${s}"><b>${byStatus(s)}</b> ${t(s === 'nrm' ? 'Staff use (NRM)' : s)}</a>`)}
      ${S.can('inspections', 'write') ? html`<a href="#/checkcard" class="pill ops">${icon('clipboard-check')} ${t('Check-out / check-in')}</a>` : ''}
      <a href="#/checkcard" class="pill ops"><b>${S.data.inspections.filter((i) => sameDay(i.at, new Date())).length}</b> ${t('check cards today')}</a>
      ${S.can('invoices', 'read') ? html`<a href="#/invoices" class="pill ops"><b>${S.data.invoices.filter((i) => i.status === 'open').length}</b> ${t('open invoices')}</a>` : ''}</div>
    <div class="dash-grid">
      <section class="card"><header><h2>${icon('triangle-alert')} ${t('Needs attention')}</h2><span class="badge ${items.some((i) => i.lvl === 3) ? 'red' : 'gray'}">${items.length}</span></header>
        ${alertList(items.slice(0, 12))}${items.length > 12 ? html`<p><a href="#/alerts">${t('See all alerts')} (${items.length})</a></p>` : ''}
      </section>
      <section class="card span2"><header><h2>${icon('calendar')} ${t('Next 14 days')}</h2>
        <div class="legend"><i class="booked"></i>${t('booked')} <i class="active"></i>${t('active')} <i class="overdue"></i>${t('Overdue')} <i class="maint"></i>${t('maintenance')}</div></header>
        ${fleet.length ? timeline(x) : empty()}</section>
    </div>`.toString();
}
export function mountDashboard(root) { render(root); return () => render(root); }
