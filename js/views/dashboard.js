// Dashboard: today at a glance, what needs attention, and a 14-day fleet timeline.
import { html, icon, money, fmtDateTime, fmtDate, plate, carName, daysUntil, sum, num, esc, raw } from '../util.js';
import { t } from '../i18n.js';
import { badge, plateTag, empty } from '../ui.js';
import { lookups } from '../schema.js';
import { S } from '../store.js';

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function attention(x) {
  const items = [];
  const now = new Date();
  for (const r of S.data.rentals) {
    const c = x.customers[r.customer_id]?.full_name; const v = plate(x.vehicles[r.vehicle_id]);
    if (r.status === 'active' && new Date(r.end_at) < now) items.push({ lvl: 3, ic: 'clock', text: `${r.ref} · ${c} · ${v}`, tag: t('Overdue'), href: `#/rentals?open=${r.id}` });
    else if (r.status === 'active' && sameDay(r.end_at, now)) items.push({ lvl: 2, ic: 'undo-2', text: `${r.ref} · ${c} · ${v} · ${fmtDateTime(r.end_at)}`, tag: t('Due back today'), href: `#/rentals?open=${r.id}` });
    if (r.status === 'booked' && new Date(r.start_at) <= new Date(now.getTime() + 86400000)) items.push({ lvl: new Date(r.start_at) < now ? 3 : 2, ic: 'key-round', text: `${r.ref} · ${c} · ${v} · ${fmtDateTime(r.start_at)}`, tag: t('Pick-ups today'), href: `#/rentals?open=${r.id}` });
    if (r.status === 'returned' && num(x.balances[r.id]?.balance) > 0.009) items.push({ lvl: 2, ic: 'circle-dollar-sign', text: `${r.ref} · ${c} · ${money(x.balances[r.id].balance)}`, tag: t('Outstanding'), href: `#/rentals?open=${r.id}` });
  }
  for (const v of S.data.vehicles) {
    if (v.status === 'retired') continue;
    for (const [k, label] of [['insurance_expiry', 'Insurance expiry'], ['registration_expiry', 'Registration expiry']]) {
      const d = daysUntil(v[k]);
      if (d != null && d <= 30) items.push({ lvl: d < 0 ? 3 : d <= 7 ? 2 : 1, ic: 'shield-check', text: `${plate(v)} · ${carName(v)} · ${fmtDate(v[k])}`, tag: t(label), href: '#/fleet' });
    }
  }
  const activeCustomers = new Set(S.data.rentals.filter((r) => ['booked', 'active'].includes(r.status)).map((r) => r.customer_id));
  for (const c of S.data.customers) {
    const d = daysUntil(c.license_expiry);
    if (activeCustomers.has(c.id) && d != null && d <= 30) items.push({ lvl: d < 0 ? 3 : 2, ic: 'file-text', text: `${c.full_name} · ${fmtDate(c.license_expiry)}`, tag: t('Licence expiry'), href: '#/customers' });
  }
  const unmatched = S.data.fines.filter((f) => ['new', 'unmatched'].includes(f.status)).length;
  if (unmatched) items.push({ lvl: 1, ic: 'siren', text: `${unmatched} ${t('Fines & Salik')}`, tag: t('new'), href: '#/fines' });
  for (const m of S.data.maintenance.filter((m) => m.status === 'open')) {
    items.push({ lvl: 1, ic: 'wrench', text: `${plate(x.vehicles[m.vehicle_id])} · ${t(m.kind)} · ${m.description}`, tag: t('Maintenance'), href: '#/maintenance' });
  }
  return items.sort((a, b) => b.lvl - a.lvl);
}

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
  const items = attention(x);
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
    <div class="fleet-strip">${['available', 'rented', 'maintenance'].map((s) => html`<a href="#/fleet" class="pill ${s}"><b>${byStatus(s)}</b> ${t(s)}</a>`)}</div>
    <div class="dash-grid">
      <section class="card"><header><h2>${icon('triangle-alert')} ${t('Needs attention')}</h2><span class="badge ${items.some((i) => i.lvl === 3) ? 'red' : 'gray'}">${items.length}</span></header>
        ${items.length ? html`<ul class="alerts">${items.slice(0, 12).map((i) => html`<li class="lvl${i.lvl}"><a href="${i.href}">${icon(i.ic)}<span>${i.text}</span><em>${i.tag}</em></a></li>`)}</ul>` : empty('Nothing here yet', 'circle-check')}
      </section>
      <section class="card span2"><header><h2>${icon('calendar')} ${t('Next 14 days')}</h2>
        <div class="legend"><i class="booked"></i>${t('booked')} <i class="active"></i>${t('active')} <i class="overdue"></i>${t('Overdue')} <i class="maint"></i>${t('maintenance')}</div></header>
        ${fleet.length ? timeline(x) : empty()}</section>
    </div>`.toString();
}
export function mountDashboard(root) { render(root); return () => render(root); }
