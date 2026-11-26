// Operational reports: day summary, daily business report, fleet utilisation, monthly status grid, movement log,
// missing mileage, estimated revenue (by car and by agreement), agreements (incl. cancelled), receivables,
// payables and tolls / mall parking with reconciliation. Every report exports to CSV and prints.
import { html, icon, money, fmtDate, fmtDateTime, plate, carName, csv, download, todayISO, num, round2, sum, dateInput } from '../util.js';
import { t } from '../i18n.js';
import { table, plateTag, badge, toast, wireActions } from '../ui.js';
import { lookups, nameOf } from '../schema.js';
import { TOLL_KINDS } from '../rules.js';
import { BUCKETS } from '../ledger.js';
import { agingRows, openStatement } from './accounts.js';
import { printDoc } from './doc.js';
import { S, reload } from '../store.js';

const DAY = 86400000;
const dayStart = (d) => new Date(`${d}T00:00:00`);
const dayEnd = (d) => new Date(dayStart(d).getTime() + DAY);
const overlapMs = (a1, a2, b1, b2) => Math.max(0, Math.min(+a2, +b2) - Math.max(+a1, +b1));
const rentalEnd = (r) => new Date(r.returned_at || (r.status === 'active' ? Math.max(Date.now(), +new Date(r.end_at)) : r.end_at));
const daysOf = (from, to) => { const out = []; for (let d = dayStart(from); d < dayEnd(to); d = new Date(d.getTime() + DAY)) out.push(dateInput(d)); return out; };
const inRange = (v, from, to) => { const d = new Date(v); return d >= dayStart(from) && d < dayEnd(to); };
const fleet = () => S.data.vehicles.filter((v) => v.status !== 'retired' || v.defleeted_on);
const empName = (id) => nameOf(S.data.employees, id, (e) => e.full_name);
const collected = (p) => (p.kind === 'payment' ? num(p.amount) : p.kind === 'refund' ? -num(p.amount) : 0);

// Car status on one day: R rented, B booked, N staff use, C custody, M garage, X de-fleeted, A available.
function statusOn(v, d) {
  const a = dayStart(d); const b = dayEnd(d);
  if (v.defleeted_on && v.defleeted_on <= d) return 'X';
  if (S.data.rentals.some((r) => r.vehicle_id === v.id && ['active', 'returned'].includes(r.status) && overlapMs(new Date(r.start_at), rentalEnd(r), a, b) > 0)) return 'R';
  if (S.data.vehicle_replacements.some((p) => p.old_vehicle_id === v.id && overlapMs(new Date(S.data.rentals.find((r) => r.id === p.rental_id)?.start_at || p.replaced_at), new Date(p.replaced_at), a, b) > 0)) return 'R';
  const m = S.data.movements.find((x) => x.vehicle_id === v.id && overlapMs(new Date(x.out_at), new Date(x.in_at || Date.now()), a, b) > 0);
  if (m) return m.kind === 'nrm' ? 'N' : 'C';
  if (S.data.maintenance.some((x) => x.vehicle_id === v.id && x.opened_on <= d && (!x.closed_on || x.closed_on >= d) && (x.status === 'open' ? d <= todayISO() : true))) return 'M';
  if (S.data.rentals.some((r) => r.vehicle_id === v.id && r.status === 'booked' && overlapMs(new Date(r.start_at), new Date(r.end_at), a, b) > 0)) return 'B';
  return 'A';
}

const REPORTS = {
  day: {
    label: 'Day summary', icon: 'calendar-days', single: true,
    build(p) {
      const d = p.to; const a = dayStart(d); const b = dayEnd(d);
      const isDay = (v) => v && new Date(v) >= a && new Date(v) < b;
      const out = S.data.rentals.filter((r) => r.status !== 'cancelled' && r.status !== 'booked' && isDay(r.start_at));
      const back = S.data.rentals.filter((r) => isDay(r.returned_at));
      const made = S.data.rentals.filter((r) => isDay(r.created_at));
      const cancelled = S.data.rentals.filter((r) => isDay(r.cancelled_at));
      const pays = S.data.payments.filter((q) => isDay(q.paid_at));
      const byMethod = ['cash', 'card', 'bank', 'cheque'].map((m) => ({ m, n: round2(sum(pays.filter((q) => q.method === m), collected)) }));
      const vch = S.data.vouchers.filter((v) => v.paid_on === d);
      const rows = [
        ['Cars handed over', out.length, out.map((r) => r.ref).join(', ')], ['Cars returned', back.length, back.map((r) => r.ref).join(', ')],
        ['New bookings', made.length, made.map((r) => r.ref).join(', ')], ['Cancellations', cancelled.length, cancelled.map((r) => `${r.ref} (${r.cancel_reason})`).join(', ')],
        ['Billed on return', money(sum(back, 'total')), ''], ...byMethod.map((m) => [`${t('Collected')} · ${t(m.m)}`, money(m.n), '']),
        ['Deposits taken', money(sum(pays.filter((q) => q.kind === 'deposit'), 'amount')), ''], ['Deposits returned', money(sum(pays.filter((q) => q.kind === 'deposit_return'), 'amount')), ''],
        ['Payment vouchers', money(sum(vch.filter((v) => v.direction === 'payment'), 'amount')), vch.filter((v) => v.direction === 'payment').map((v) => v.ref).join(', ')],
        ['Receipt vouchers', money(sum(vch.filter((v) => v.direction === 'receipt'), 'amount')), ''],
        ['Fines and tolls recorded', S.data.fines.filter((f) => isDay(f.occurred_at)).length, ''],
        ['Cars out at end of day', S.data.vehicles.filter((v) => ['R', 'N', 'C'].includes(statusOn(v, d))).length, ''],
      ].map(([k, v, n]) => ({ k, v, n }));
      return { rows, cols: [{ label: 'Item', cell: (r) => t(r.k), csv: (r) => r.k }, { label: 'Value', cell: (r) => html`<b>${r.v}</b>`, cls: 'num', csv: (r) => r.v }, { label: 'Details', cell: (r) => html`<small class="muted">${r.n}</small>`, csv: (r) => r.n }] };
    },
  },
  dbr: {
    label: 'Daily business report', icon: 'chart-column',
    build(p) {
      const rows = daysOf(p.from, p.to).map((d) => {
        const on = (v) => v && dateInput(new Date(v)) === d;
        const pays = S.data.payments.filter((q) => on(q.paid_at));
        const ret = S.data.rentals.filter((r) => on(r.returned_at));
        const cars = fleet().filter((v) => statusOn(v, d) !== 'X');
        const rented = cars.filter((v) => statusOn(v, d) === 'R').length;
        return { d, opened: S.data.rentals.filter((r) => ['active', 'returned'].includes(r.status) && on(r.start_at)).length, returned: ret.length,
          cancelled: S.data.rentals.filter((r) => on(r.cancelled_at)).length, billed: sum(ret, 'subtotal'), collected: round2(sum(pays, collected)),
          deposits: round2(sum(pays.filter((q) => q.kind === 'deposit'), 'amount') - sum(pays.filter((q) => q.kind === 'deposit_return'), 'amount')),
          util: cars.length ? Math.round((rented / cars.length) * 100) : 0, rented, cars: cars.length };
      });
      const tot = { d: 'Total', opened: sum(rows, 'opened'), returned: sum(rows, 'returned'), cancelled: sum(rows, 'cancelled'), billed: sum(rows, 'billed'), collected: sum(rows, 'collected'), deposits: sum(rows, 'deposits'),
        util: rows.length ? Math.round(rows.reduce((a, r) => a + r.util, 0) / rows.length) : 0, total: true };
      return { rows: [...rows, tot], cols: [
        { label: 'Date', cell: (r) => (r.total ? html`<b>${t('Total')}</b>` : fmtDate(r.d)), csv: (r) => r.d }, { label: 'Opened', cell: (r) => r.opened, cls: 'num', csv: (r) => r.opened },
        { label: 'Returned', cell: (r) => r.returned, cls: 'num', csv: (r) => r.returned }, { label: 'Cancelled', cell: (r) => r.cancelled, cls: 'num', csv: (r) => r.cancelled },
        { label: 'Billed (excl. VAT)', cell: (r) => money(r.billed, false), cls: 'num', csv: (r) => r.billed }, { label: 'Collected', cell: (r) => money(r.collected, false), cls: 'num', csv: (r) => r.collected },
        { label: 'Net deposits', cell: (r) => money(r.deposits, false), cls: 'num', csv: (r) => r.deposits },
        { label: 'Utilisation', cell: (r) => html`${r.util}%${r.cars ? html`<small class="muted block">${r.rented}/${r.cars}</small>` : ''}`, cls: 'num', csv: (r) => r.util }] };
    },
  },
  utilisation: {
    label: 'Fleet utilisation', icon: 'timer',
    build(p) {
      const a = dayStart(p.from); const b = new Date(Math.min(+dayEnd(p.to), Date.now())); const span = Math.max(1, b - a);
      const rows = fleet().map((v) => {
        const rs = S.data.rentals.filter((r) => r.vehicle_id === v.id && ['active', 'returned'].includes(r.status));
        const rented = rs.reduce((s, r) => s + overlapMs(new Date(r.start_at), rentalEnd(r), a, b), 0);
        const staff = S.data.movements.filter((m) => m.vehicle_id === v.id).reduce((s, m) => s + overlapMs(new Date(m.out_at), new Date(m.in_at || Date.now()), a, b), 0);
        const garage = S.data.maintenance.filter((m) => m.vehicle_id === v.id).reduce((s, m) => s + overlapMs(dayStart(m.opened_on), m.closed_on ? dayEnd(m.closed_on) : new Date(), a, b), 0);
        const rev = sum(rs.filter((r) => inRange(r.start_at, p.from, p.to)), 'subtotal');
        return { v, rented: round2(rented / DAY), staff: round2(staff / DAY), garage: round2(garage / DAY), pct: Math.min(100, Math.round((rented / span) * 100)), rev, avail: round2(span / DAY) };
      }).sort((x, y) => y.pct - x.pct);
      return { rows, cols: [
        { label: 'Car', cell: (r) => html`${plateTag(r.v)} <small class="muted">${carName(r.v)}</small>`, csv: (r) => `${plate(r.v)} ${carName(r.v)}` },
        { label: 'Days rented', cell: (r) => r.rented, cls: 'num', csv: (r) => r.rented }, { label: 'Staff / custody days', cell: (r) => r.staff, cls: 'num', csv: (r) => r.staff },
        { label: 'Garage days', cell: (r) => r.garage, cls: 'num', csv: (r) => r.garage }, { label: 'Revenue', cell: (r) => money(r.rev, false), cls: 'num', csv: (r) => r.rev },
        { label: 'Utilisation', cell: (r) => html`<div class="meter sm"><i style="width:${r.pct}%"></i></div><small>${r.pct}%</small>`, csv: (r) => r.pct }] };
    },
  },
  grid: {
    label: 'Daily status grid', icon: 'layers', wide: true,
    build(p) {
      const days = daysOf(p.from, p.to).slice(0, 62);
      const rows = fleet().map((v) => ({ v, cells: days.map((d) => statusOn(v, d)) }));
      return { rows, days, cols: [
        { label: 'Car', cell: (r) => plateTag(r.v), csv: (r) => plate(r.v) },
        ...days.map((d, i) => ({ label: d.slice(8), cell: (r) => html`<span class="gs gs-${r.cells[i]}">${r.cells[i]}</span>`, cls: 'gc', csv: (r) => r.cells[i] })),
        { label: 'R', cell: (r) => r.cells.filter((c) => c === 'R').length, cls: 'num', csv: (r) => r.cells.filter((c) => c === 'R').length }],
        note: 'R rented · B booked · N staff use · C custody · M garage · A available · X de-fleeted' };
    },
  },
  movement: {
    label: 'Vehicle movement log', icon: 'route',
    build(p, x) {
      const ev = [];
      for (const r of S.data.rentals) {
        if (r.status !== 'cancelled' && r.status !== 'booked' && inRange(r.start_at, p.from, p.to)) ev.push({ at: r.start_at, v: r.vehicle_id, what: 'Rental out', ref: r.ref, who: x.customers[r.customer_id]?.full_name, odo: r.odometer_out, branch: nameOf(S.data.branches, r.branch_out_id) });
        if (r.returned_at && inRange(r.returned_at, p.from, p.to)) ev.push({ at: r.returned_at, v: r.vehicle_id, what: 'Rental in', ref: r.ref, who: x.customers[r.customer_id]?.full_name, odo: r.odometer_in, branch: nameOf(S.data.branches, r.branch_in_id) });
      }
      for (const rp of S.data.vehicle_replacements.filter((q) => inRange(q.replaced_at, p.from, p.to))) {
        const r = x.rentals[rp.rental_id];
        ev.push({ at: rp.replaced_at, v: rp.old_vehicle_id, what: 'Replaced (in)', ref: r?.ref, who: x.customers[r?.customer_id]?.full_name, odo: rp.old_odometer_in, branch: '' });
        ev.push({ at: rp.replaced_at, v: rp.new_vehicle_id, what: 'Replacement (out)', ref: r?.ref, who: x.customers[r?.customer_id]?.full_name, odo: rp.new_odometer_out, branch: '' });
      }
      for (const m of S.data.movements) {
        const k = m.kind === 'nrm' ? 'Staff use' : 'Custody';
        if (inRange(m.out_at, p.from, p.to)) ev.push({ at: m.out_at, v: m.vehicle_id, what: `${k} out`, ref: m.ref, who: empName(m.employee_id), odo: m.odometer_out, branch: nameOf(S.data.branches, m.from_branch_id) });
        if (m.in_at && inRange(m.in_at, p.from, p.to)) ev.push({ at: m.in_at, v: m.vehicle_id, what: `${k} in`, ref: m.ref, who: empName(m.employee_id), odo: m.odometer_in, branch: nameOf(S.data.branches, m.to_branch_id) });
      }
      for (const m of S.data.maintenance) {
        if (inRange(m.opened_on, p.from, p.to)) ev.push({ at: m.opened_on, v: m.vehicle_id, what: 'Garage in', ref: m.job_type || m.kind, who: nameOf(S.data.suppliers, m.supplier_id) || m.vendor, odo: m.odometer, branch: '' });
        if (m.closed_on && inRange(m.closed_on, p.from, p.to)) ev.push({ at: m.closed_on, v: m.vehicle_id, what: 'Garage out', ref: m.job_type || m.kind, who: nameOf(S.data.suppliers, m.supplier_id) || m.vendor, odo: null, branch: '' });
      }
      const rows = ev.filter((e) => !p.car || e.v === p.car).sort((a, b) => new Date(b.at) - new Date(a.at));
      return { rows, carFilter: true, cols: [
        { label: 'When', cell: (e) => fmtDateTime(e.at), csv: (e) => e.at }, { label: 'Car', cell: (e) => plateTag(x.vehicles[e.v]), csv: (e) => plate(x.vehicles[e.v]) },
        { label: 'Movement', cell: (e) => t(e.what), csv: (e) => e.what }, { label: 'Reference', cell: (e) => html`<span class="mono">${e.ref || ''}</span>`, csv: (e) => e.ref },
        { label: 'Who', cell: (e) => e.who || '—', csv: (e) => e.who }, { label: 'Odometer', cell: (e) => (e.odo != null ? (+e.odo).toLocaleString() : '—'), cls: 'num', csv: (e) => e.odo },
        { label: 'Branch', cell: (e) => e.branch || '—', csv: (e) => e.branch }] };
    },
  },
  mileage: {
    label: 'Missing mileage', icon: 'circle-alert',
    build(p, x) {
      const issues = [];
      for (const v of fleet()) {
        const legs = [];
        for (const r of S.data.rentals.filter((r) => r.vehicle_id === v.id && r.status === 'returned')) legs.push({ out: r.odometer_out, in: r.odometer_in, at: r.start_at, end: r.returned_at, ref: r.ref });
        for (const m of S.data.movements.filter((m) => m.vehicle_id === v.id && m.status === 'closed')) legs.push({ out: m.odometer_out, in: m.odometer_in, at: m.out_at, end: m.in_at, ref: m.ref });
        for (const q of S.data.vehicle_replacements.filter((q) => q.old_vehicle_id === v.id)) legs.push({ out: q.old_odometer_out, in: q.old_odometer_in, at: S.data.rentals.find((r) => r.id === q.rental_id)?.start_at || q.replaced_at, end: q.replaced_at, ref: x.rentals[q.rental_id]?.ref });
        legs.sort((a, b) => new Date(a.at) - new Date(b.at));
        legs.forEach((l, i) => {
          if (!inRange(l.end || l.at, p.from, p.to)) return;
          if (l.out == null || l.in == null) issues.push({ v, ref: l.ref, at: l.at, kind: 'Reading missing', km: null });
          const prev = legs[i - 1];
          if (prev?.in != null && l.out != null) {
            const gap = +l.out - +prev.in;
            if (gap > 50) issues.push({ v, ref: `${prev.ref} → ${l.ref}`, at: l.at, kind: 'Km not covered by any agreement or movement', km: gap });
            if (gap < 0) issues.push({ v, ref: `${prev.ref} → ${l.ref}`, at: l.at, kind: 'Odometer went backwards', km: gap });
          }
        });
      }
      return { rows: issues.sort((a, b) => new Date(b.at) - new Date(a.at)), note: 'Gaps over 50 km between one return and the next hand-over usually mean a trip that was not recorded.', cols: [
        { label: 'Car', cell: (r) => plateTag(r.v), csv: (r) => plate(r.v) }, { label: 'Between', cell: (r) => html`<span class="mono">${r.ref}</span>`, csv: (r) => r.ref },
        { label: 'Date', cell: (r) => fmtDate(r.at), csv: (r) => r.at }, { label: 'Issue', cell: (r) => html`<b>${t(r.kind)}</b>`, csv: (r) => r.kind },
        { label: 'Km', cell: (r) => (r.km != null ? html`<b class="neg">${r.km.toLocaleString()}</b>` : '—'), cls: 'num', csv: (r) => r.km }] };
    },
  },
  estcar: {
    label: 'Estimated revenue by car', icon: 'car-front',
    build(p) {
      const a = dayStart(p.from); const b = dayEnd(p.to);
      const est = (r) => round2(num(r.daily_rate) * overlapMs(new Date(r.start_at), r.status === 'returned' ? new Date(r.returned_at) : new Date(Math.max(+new Date(r.end_at), r.status === 'active' ? Date.now() : 0)), a, b) / DAY);
      const rows = fleet().map((v) => {
        const rs = S.data.rentals.filter((r) => r.vehicle_id === v.id && ['booked', 'active', 'returned'].includes(r.status));
        const earned = round2(sum(rs.filter((r) => r.status === 'returned'), est)); const running = round2(sum(rs.filter((r) => r.status === 'active'), est)); const booked = round2(sum(rs.filter((r) => r.status === 'booked'), est));
        return { v, earned, running, booked, total: round2(earned + running + booked) };
      }).sort((x, y) => y.total - x.total);
      return { rows, total: sum(rows, 'total'), note: 'Daily rate × days that fall inside the period (excl. VAT, extras and discounts). Running agreements count to today or their end date, whichever is later.', cols: [
        { label: 'Car', cell: (r) => html`${plateTag(r.v)} <small class="muted">${carName(r.v)}</small>`, csv: (r) => plate(r.v) },
        { label: 'Closed agreements', cell: (r) => money(r.earned, false), cls: 'num', csv: (r) => r.earned }, { label: 'Running', cell: (r) => money(r.running, false), cls: 'num', csv: (r) => r.running },
        { label: 'Booked', cell: (r) => money(r.booked, false), cls: 'num', csv: (r) => r.booked }, { label: 'Estimated total', cell: (r) => html`<b>${money(r.total)}</b>`, cls: 'num', csv: (r) => r.total }] };
    },
  },
  estagr: {
    label: 'Estimated revenue by agreement', icon: 'scroll',
    build(p, x) {
      const a = dayStart(p.from); const b = dayEnd(p.to);
      const rows = S.data.rentals.filter((r) => ['booked', 'active', 'returned'].includes(r.status)).map((r) => {
        const end = r.status === 'returned' ? new Date(r.returned_at) : new Date(Math.max(+new Date(r.end_at), r.status === 'active' ? Date.now() : 0));
        const ms = overlapMs(new Date(r.start_at), end, a, b);
        return { r, days: round2(ms / DAY), est: round2(num(r.daily_rate) * ms / DAY) };
      }).filter((q) => q.days > 0).sort((q, w) => new Date(w.r.start_at) - new Date(q.r.start_at));
      return { rows, total: sum(rows, 'est'), cols: [
        { label: 'Reference', cell: (q) => html`<a class="mono" href="#/rentals?open=${q.r.id}">${q.r.ref}</a>`, csv: (q) => q.r.ref }, { label: 'Status', cell: (q) => badge(q.r.status), csv: (q) => q.r.status },
        { label: 'Customer', cell: (q) => x.customers[q.r.customer_id]?.full_name, csv: (q) => x.customers[q.r.customer_id]?.full_name }, { label: 'Car', cell: (q) => plateTag(x.vehicles[q.r.vehicle_id]), csv: (q) => plate(x.vehicles[q.r.vehicle_id]) },
        { label: 'Days in period', cell: (q) => q.days, cls: 'num', csv: (q) => q.days }, { label: 'Daily rate', cell: (q) => money(q.r.daily_rate, false), cls: 'num', csv: (q) => q.r.daily_rate },
        { label: 'Estimated', cell: (q) => html`<b>${money(q.est, false)}</b>`, cls: 'num', csv: (q) => q.est }, { label: 'Agreement total', cell: (q) => money(q.r.total, false), cls: 'num', csv: (q) => q.r.total }] };
    },
  },
  agreements: {
    label: 'Agreements (incl. cancelled)', icon: 'file-text',
    build(p, x) {
      const rows = S.data.rentals.filter((r) => inRange(r.start_at, p.from, p.to) && (!p.status || r.status === p.status)).sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
      return { rows, statusFilter: true, total: sum(rows.filter((r) => r.status !== 'cancelled'), 'total'), cols: [
        { label: 'Reference', cell: (r) => html`<a class="mono" href="#/rentals?open=${r.id}">${r.ref}</a>`, csv: (r) => r.ref }, { label: 'Status', cell: (r) => badge(r.status), csv: (r) => r.status },
        { label: 'Customer', cell: (r) => x.customers[r.customer_id]?.full_name, csv: (r) => x.customers[r.customer_id]?.full_name }, { label: 'Car', cell: (r) => plateTag(x.vehicles[r.vehicle_id]), csv: (r) => plate(x.vehicles[r.vehicle_id]) },
        { label: 'Start', cell: (r) => html`${fmtDateTime(r.start_at)}<small class="muted block">→ ${fmtDateTime(r.returned_at || r.end_at)}</small>`, csv: (r) => r.start_at },
        { label: 'Days', cell: (r) => r.days, cls: 'num', csv: (r) => r.days }, { label: 'Total', cell: (r) => (r.status === 'cancelled' ? '—' : money(r.total, false)), cls: 'num', csv: (r) => r.total },
        { label: 'Balance', cell: (r) => (r.status === 'cancelled' ? '—' : money(x.balances[r.id]?.balance, false)), cls: 'num', csv: (r) => x.balances[r.id]?.balance },
        { label: 'Cancel reason', cell: (r) => r.cancel_reason || '', csv: (r) => r.cancel_reason }] };
    },
  },
  receivables: {
    label: 'Receivables (age analysis)', icon: 'users', single: true, asOf: true,
    build(p) {
      const rows = agingRows('customers', p.to);
      return { rows, link: 'customers', total: sum(rows, 'bal'), cols: [
        { label: 'Code', cell: (r) => html`<span class="mono">${r.code}</span>`, csv: (r) => r.code }, { label: 'Customer', cell: (r) => html`<button class="link" data-act="stmt" data-id="customers:${r.id}">${r.name}</button>`, csv: (r) => r.name },
        ...BUCKETS.map(([b]) => ({ label: b, cell: (r) => (r.ag[b] ? money(r.ag[b], false) : ''), cls: 'num', csv: (r) => r.ag[b] })),
        { label: 'Balance', cell: (r) => html`<b>${money(r.bal, false)}</b>`, cls: 'num', csv: (r) => r.bal }] };
    },
  },
  payables: {
    label: 'Payables (age analysis)', icon: 'truck', single: true, asOf: true, perm: ['bills', 'read'],
    build(p) {
      const rows = agingRows('suppliers', p.to);
      return { rows, total: sum(rows, 'bal'), cols: [
        { label: 'Code', cell: (r) => html`<span class="mono">${r.code}</span>`, csv: (r) => r.code }, { label: 'Supplier', cell: (r) => html`<button class="link" data-act="stmt" data-id="suppliers:${r.id}">${r.name}</button>`, csv: (r) => r.name },
        ...BUCKETS.map(([b]) => ({ label: b, cell: (r) => (r.ag[b] ? money(r.ag[b], false) : ''), cls: 'num', csv: (r) => r.ag[b] })),
        { label: 'Balance', cell: (r) => html`<b>${money(r.bal, false)}</b>`, cls: 'num', csv: (r) => r.bal }] };
    },
  },
  tolls: {
    label: 'Tolls & mall parking', icon: 'route',
    build(p) {
      const list = S.data.fines.filter((f) => TOLL_KINDS.includes(f.kind) && inRange(f.occurred_at, p.from, p.to) && (!p.kind || f.kind === p.kind));
      const rows = TOLL_KINDS.filter((k) => !p.kind || k === p.kind).flatMap((k) => ['charged', 'employee', 'company', 'unmatched', 'new', 'paid', 'disputed'].map((s) => {
        const g = list.filter((f) => f.kind === k && f.status === s);
        return { k, s, n: g.length, amount: sum(g, 'amount'), fee: sum(g, 'admin_fee'), invoiced: g.filter((f) => f.invoice_id).length, recon: g.filter((f) => f.reconciled_at).length };
      })).filter((r) => r.n);
      return { rows, tollFilter: true, reconcile: true, total: sum(rows, 'amount'), note: 'Reconcile marks every toll of that kind in the period as checked against the authority\'s statement.', cols: [
        { label: 'Kind', cell: (r) => t(r.k), csv: (r) => r.k }, { label: 'Status', cell: (r) => badge(r.s), csv: (r) => r.s }, { label: 'Count', cell: (r) => r.n, cls: 'num', csv: (r) => r.n },
        { label: 'Amount', cell: (r) => money(r.amount, false), cls: 'num', csv: (r) => r.amount }, { label: 'Admin fee', cell: (r) => money(r.fee, false), cls: 'num', csv: (r) => r.fee },
        { label: 'Invoiced', cell: (r) => r.invoiced, cls: 'num', csv: (r) => r.invoiced }, { label: 'Reconciled', cell: (r) => `${r.recon}/${r.n}`, cls: 'num', csv: (r) => r.recon }] };
    },
  },
};

export function mountOpsReports(root, params) {
  const first = new Date(); first.setDate(1);
  const ids = Object.keys(REPORTS).filter((k) => !REPORTS[k].perm || S.can(...REPORTS[k].perm));
  const p = { id: ids.includes(params?.get('r')) ? params.get('r') : 'day', from: dateInput(first), to: todayISO(), car: '', status: '', kind: '' };
  let out = null;
  const render = () => {
    const R = REPORTS[p.id]; const x = lookups(S.data);
    out = R.build(p, x);
    root.innerHTML = html`<div class="page-head"><div><h1>${icon('chart-column')} ${t('Operational reports')}</h1><p class="muted">${t(R.label)}</p></div>
      <div class="head-actions"><button class="btn ghost" data-act="print">${icon('printer')} ${t('Print')}</button><button class="btn ghost" data-act="csv">${icon('download')} ${t('Export CSV')}</button></div></div>
      <div class="report-layout"><nav class="report-nav">${ids.map((k) => html`<button class="${k === p.id ? 'on' : ''}" data-act="pick" data-id="${k}">${icon(REPORTS[k].icon)} ${t(REPORTS[k].label)}</button>`)}</nav>
      <section class="report-body">
        <div class="toolbar">${R.single ? html`<label class="mini-select">${t(R.asOf ? 'As of' : 'Date')} <input type="date" data-p="to" value="${p.to}"></label>`
          : html`<label class="mini-select">${t('From')} <input type="date" data-p="from" value="${p.from}"></label><label class="mini-select">${t('To')} <input type="date" data-p="to" value="${p.to}"></label>`}
          ${out.carFilter ? html`<label class="mini-select">${t('Car')} <select data-p="car"><option value="">${t('All')}</option>${S.data.vehicles.map((v) => html`<option value="${v.id}" ${p.car === v.id ? 'selected' : ''}>${plate(v)}</option>`)}</select></label>` : ''}
          ${out.statusFilter ? html`<label class="mini-select">${t('Status')} <select data-p="status"><option value="">${t('All')}</option>${['booked', 'active', 'returned', 'cancelled'].map((s) => html`<option value="${s}" ${p.status === s ? 'selected' : ''}>${t(s)}</option>`)}</select></label>` : ''}
          ${out.tollFilter ? html`<label class="mini-select">${t('Kind')} <select data-p="kind"><option value="">${t('All')}</option>${TOLL_KINDS.map((s) => html`<option value="${s}" ${p.kind === s ? 'selected' : ''}>${t(s)}</option>`)}</select></label>` : ''}
          ${out.reconcile && S.can('fines', 'write') ? html`<button class="btn ghost" data-act="recon" ${p.kind ? '' : 'disabled'} title="${t('Pick a kind first')}">${icon('badge-check')} ${t('Reconcile period')}</button>` : ''}
        </div>
        ${out.total != null ? html`<div class="kpis sm"><div class="kpi"><span>${t('Total')}</span><b>${money(out.total)}</b><em>${out.rows.length} ${t('rows')}</em></div></div>` : ''}
        ${out.note ? html`<p class="muted small">${icon('info')} ${t(out.note)}</p>` : ''}
        <div class="${R.wide ? 'grid-report' : ''}">${table(out.rows, out.cols, { empty: 'Nothing in this period' })}</div>
      </section></div>`.toString();
  };
  root.addEventListener('change', (e) => { const k = e.target.dataset.p; if (!k) return; p[k] = e.target.value; if (k === 'from' && p.to < p.from) p.to = p.from; render(); });
  wireActions(root, {
    pick: (id) => { p.id = id; history.replaceState(null, '', `#/opsreports?r=${id}`); render(); },
    csv: () => download(`${p.id}-${p.from}-${p.to}.csv`, csv(out.rows, out.cols.map((c) => ({ label: t(c.label), csv: c.csv })))),
    print: () => { const R = REPORTS[p.id]; printDoc(t(R.label), R.single ? fmtDate(p.to) : `${fmtDate(p.from)} → ${fmtDate(p.to)}`, html`${out.note ? html`<p class="terms">${t(out.note)}</p>` : ''}${table(out.rows, out.cols)}`, { landscape: !!R.wide || out.cols.length > 7 }); },
    stmt: (v) => { const [k, id] = v.split(':'); openStatement(k, id, p.to); },
    recon: async () => {
      try { const n = await S.backend.rpc('reconcile_fines', { p_kind: p.kind, p_from: p.from, p_to: p.to }); toast(`${n} ${t('marked reconciled')}`); await reload('fines'); } catch (e) { toast(e.message, 'err'); }
    },
  });
  render();
  return render;
}
