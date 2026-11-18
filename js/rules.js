// Business rules shared by the rental form preview and demo mode.
// The live database enforces the same rules in private.rentals_before() — the database is the authority.
import { round2, num } from './util.js';

export const RENTAL_FLOW = { booked: ['active', 'cancelled'], active: ['returned'], returned: [], cancelled: [] };

export function billedDays(startAt, endAt, returnedAt) {
  const start = new Date(startAt).getTime();
  const end = Math.max(new Date(endAt).getTime(), returnedAt ? new Date(returnedAt).getTime() : 0);
  if (!isFinite(start) || !isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.ceil((end - start) / 86400000 - 0.0417)); // 1 hour grace
}

export function priceRental(r) {
  const days = billedDays(r.start_at, r.end_at, r.returned_at);
  const subtotal = round2(days * num(r.daily_rate) + num(r.extras) - num(r.discount));
  const vat = round2(subtotal * num(r.vat_rate) / 100);
  return { days, subtotal, vat, total: round2(subtotal + vat) };
}

// Best daily rate for a period, using weekly/monthly prices when they are cheaper.
export function suggestDailyRate(vehicle, startAt, endAt) {
  if (!vehicle) return 0;
  const d = billedDays(startAt, endAt);
  const opts = [num(vehicle.daily_rate)];
  if (d >= 7 && num(vehicle.weekly_rate) > 0) opts.push(num(vehicle.weekly_rate) / 7);
  if (d >= 28 && num(vehicle.monthly_rate) > 0) opts.push(num(vehicle.monthly_rate) / 30);
  return round2(Math.min(...opts.filter((x) => x > 0)) || 0);
}

export const overlaps = (aStart, aEnd, bStart, bEnd) =>
  new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

export function balanceOf(rental, payments) {
  let paid = 0, deposit = 0;
  for (const p of payments) {
    if (p.rental_id !== rental.id) continue;
    if (p.kind === 'payment') paid += num(p.amount);
    else if (p.kind === 'refund') paid -= num(p.amount);
    else if (p.kind === 'deposit') deposit += num(p.amount);
    else if (p.kind === 'deposit_return') deposit -= num(p.amount);
  }
  return { rental_id: rental.id, total: num(rental.total), paid: round2(paid), deposit_held: round2(deposit), balance: round2(num(rental.total) - paid) };
}

// Who may do what in the app. Mirrors the RLS policies in supabase/migrations/*_security.sql.
const MATRIX = {
  vehicles:    { write: ['admin', 'manager'], remove: ['admin'] },
  customers:   { write: ['admin', 'manager', 'agent'], remove: ['admin', 'manager'] },
  rentals:     { write: ['admin', 'manager', 'agent'], remove: ['admin'] },
  payments:    { write: ['admin', 'manager', 'agent', 'accountant'], edit: ['admin', 'accountant'], remove: ['admin', 'accountant'] },
  fines:       { write: ['admin', 'manager', 'accountant'], remove: ['admin'] },
  maintenance: { write: ['admin', 'manager', 'agent'], remove: ['admin', 'manager'] },
  expenses:    { read: ['admin', 'manager', 'accountant'], write: ['admin', 'manager', 'accountant'], remove: ['admin', 'accountant'] },
  settings:    { write: ['admin'] },
  profiles:    { read: ['admin', 'manager'], write: ['admin'], remove: ['admin'] },
  activity:    { read: ['admin', 'manager'] },
};
export function can(role, table, action) {
  const m = MATRIX[table]; if (!role || !m) return false;
  if (action === 'read') return !m.read || m.read.includes(role);
  if (action === 'edit') return (m.edit || m.write || []).includes(role);
  return (m[action] || []).includes(role);
}
