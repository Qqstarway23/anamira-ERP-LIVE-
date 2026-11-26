// Business rules shared by the rental form preview and demo mode.
// The live database enforces the same rules in private.rentals_before() — the database is the authority.
import { round2, num } from './util.js';

export const RENTAL_FLOW = { booked: ['active', 'cancelled'], active: ['returned'], returned: [], cancelled: [] };
export const FUEL = ['empty', '1/4', '1/2', '3/4', 'full'];
export const TOLL_KINDS = ['salik', 'darb', 'mall_parking'];

export function billedDays(startAt, endAt, returnedAt) {
  const start = new Date(startAt).getTime();
  const end = Math.max(new Date(endAt).getTime(), returnedAt ? new Date(returnedAt).getTime() : 0);
  if (!isFinite(start) || !isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.ceil((end - start) / 86400000 - 0.0417)); // 1 hour grace
}

// Km over the allowance, charged when the car comes back. priorKm = km driven on cars replaced during the agreement.
export function extraKmCharge(r, days, priorKm = 0) {
  if (!(num(r.km_per_day) > 0) || !(num(r.extra_km_rate) > 0) || r.odometer_in == null || r.odometer_in === '' || r.odometer_out == null) return 0;
  const driven = num(r.odometer_in) - num(r.odometer_out) + num(priorKm);
  return round2(Math.max(0, driven - num(r.km_per_day) * days) * num(r.extra_km_rate));
}

export function priceRental(r, { priorKm = 0, withKm = r.status === 'returned' } = {}) {
  const days = billedDays(r.start_at, r.end_at, r.returned_at);
  const km = withKm ? extraKmCharge(r, days, priorKm) : 0;
  const subtotal = round2(days * num(r.daily_rate) + num(r.extras) + km - num(r.discount));
  const vat = round2(subtotal * num(r.vat_rate) / 100);
  return { days, extra_km_charge: km, subtotal, vat, total: round2(subtotal + vat) };
}

const inRange = (card, at) => {
  const d = new Date(at); if (isNaN(d)) return true;
  const day = d.toISOString().slice(0, 10);
  return (!card.valid_from || card.valid_from <= day) && (!card.valid_to || card.valid_to >= day);
};
// The tariff card that applies: the customer's allocated card for the car's group, else the group's standard card.
export function pickTariff(cards, vehicle, customerId, at) {
  if (!vehicle?.tariff_group_id) return null;
  const ok = (cards || []).filter((c) => c.active !== false && c.tariff_group_id === vehicle.tariff_group_id && inRange(c, at));
  return ok.find((c) => customerId && c.customer_id === customerId) || ok.find((c) => !c.customer_id) || null;
}

// Best daily rate for a period, using weekly/monthly prices when they are cheaper. A tariff card wins over the car's own prices.
export function suggestDailyRate(vehicle, startAt, endAt, card = null) {
  const src = card || vehicle;
  if (!src) return 0;
  const d = billedDays(startAt, endAt);
  const opts = [num(src.daily_rate)];
  if (d >= 7 && num(src.weekly_rate) > 0) opts.push(num(src.weekly_rate) / 7);
  if (d >= 28 && num(src.monthly_rate) > 0) opts.push(num(src.monthly_rate) / 30);
  return round2(Math.min(...opts.filter((x) => x > 0)) || 0);
}

export const overlaps = (aStart, aEnd, bStart, bEnd) =>
  new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

export function balanceOf(rental, payments, invoices = []) {
  let paid = 0, deposit = 0, invoiced = 0;
  for (const p of payments) {
    if (p.rental_id !== rental.id) continue;
    if (p.kind === 'payment') paid += num(p.amount);
    else if (p.kind === 'refund') paid -= num(p.amount);
    else if (p.kind === 'deposit') deposit += num(p.amount);
    else if (p.kind === 'deposit_return') deposit -= num(p.amount);
  }
  for (const i of invoices) if (i.rental_id === rental.id && i.status === 'open') invoiced += num(i.amount) + num(i.vat);
  return { rental_id: rental.id, total: num(rental.total), paid: round2(paid), deposit_held: round2(deposit),
    invoiced: round2(invoiced), balance: round2(num(rental.total) + invoiced - paid) };
}

// SIPP / ACRISS vehicle codes: 4 letters (category, type, transmission/drive, fuel/air-con).
export const ACRISS = [
  { label: 'Category', options: { M: 'Mini', N: 'Mini Elite', E: 'Economy', H: 'Economy Elite', C: 'Compact', D: 'Compact Elite', I: 'Intermediate', J: 'Intermediate Elite', S: 'Standard', R: 'Standard Elite', F: 'Fullsize', G: 'Fullsize Elite', P: 'Premium', U: 'Premium Elite', L: 'Luxury', W: 'Luxury Elite', O: 'Oversize', X: 'Special' } },
  { label: 'Type', options: { B: '2-3 door', C: '2/4 door', D: '4-5 door', W: 'Wagon / estate', V: 'Passenger van', L: 'Limousine / sedan', S: 'Sport', T: 'Convertible', F: 'SUV', J: 'Open air all terrain', X: 'Special', P: 'Pick-up regular cab', Q: 'Pick-up extended cab', Z: 'Special offer car', E: 'Coupe', M: 'Monospace', R: 'Recreational vehicle', H: 'Motor home', Y: '2 wheel vehicle', N: 'Roadster', G: 'Crossover', K: 'Commercial van / truck' } },
  { label: 'Transmission / drive', options: { M: 'Manual, unspecified drive', N: 'Manual 4WD', C: 'Manual AWD', A: 'Auto, unspecified drive', B: 'Auto 4WD', D: 'Auto AWD' } },
  { label: 'Fuel / air-con', options: { R: 'Unspecified fuel, air-con', N: 'Unspecified fuel, no air-con', D: 'Diesel, air-con', Q: 'Diesel, no air-con', H: 'Hybrid, air-con', I: 'Hybrid, no air-con', E: 'Electric, air-con', C: 'Electric, no air-con', L: 'LPG/CNG, air-con', S: 'LPG/CNG, no air-con', A: 'Hydrogen, air-con', B: 'Hydrogen, no air-con', M: 'Multi fuel, air-con', F: 'Multi fuel, no air-con', V: 'Petrol, air-con', Z: 'Petrol, no air-con', U: 'Ethanol, air-con', X: 'Ethanol, no air-con' } },
];
export const describeSipp = (code) => (code && /^[A-Z]{4}$/.test(code)
  ? code.split('').map((ch, i) => ACRISS[i].options[ch] || '?').join(' · ') : '');

// Who may do what in the app. Mirrors the RLS policies in supabase/migrations/*.sql.
const SETUP = { write: ['admin', 'manager'], remove: ['admin'] };
const MATRIX = {
  vehicles:      { write: ['admin', 'manager'], remove: ['admin'] },
  customers:     { write: ['admin', 'manager', 'agent'], remove: ['admin', 'manager'] },
  rentals:       { write: ['admin', 'manager', 'agent'], remove: ['admin'] },
  payments:      { write: ['admin', 'manager', 'agent', 'accountant'], edit: ['admin', 'accountant'], remove: ['admin', 'accountant'] },
  fines:         { write: ['admin', 'manager', 'accountant'], remove: ['admin'] },
  maintenance:   { write: ['admin', 'manager', 'agent'], remove: ['admin', 'manager'] },
  expenses:      { read: ['admin', 'manager', 'accountant'], write: ['admin', 'manager', 'accountant'], remove: ['admin', 'accountant'] },
  settings:      { write: ['admin'] },
  profiles:      { read: ['admin', 'manager'], write: ['admin'], remove: ['admin'] },
  activity:      { read: ['admin', 'manager'] },
  branches: SETUP, departments: SETUP, masters: SETUP, tariff_groups: SETUP, tariff_cards: SETUP, employees: SETUP,
  suppliers:     { write: ['admin', 'manager', 'accountant'], remove: ['admin'] },
  movements:     { write: ['admin', 'manager', 'agent'], remove: ['admin'] },
  inspections:   { write: ['admin', 'manager', 'agent'], remove: ['admin'] },   // written through check_out_in()
  damages:       { write: ['admin', 'manager', 'agent'], remove: ['admin'] },
  invoices:      { write: ['admin', 'manager', 'accountant'], remove: ['admin'] },
  bills:         { read: ['admin', 'manager', 'accountant'], write: ['admin', 'manager', 'accountant'], remove: ['admin', 'accountant'] },
  vouchers:      { read: ['admin', 'manager', 'accountant'], write: ['admin', 'manager', 'accountant'], remove: ['admin', 'accountant'] },
  rental_events: {}, vehicle_replacements: {},
};
export const ROLES = ['admin', 'manager', 'agent', 'accountant'];
export function can(role, table, action) {
  const m = MATRIX[table]; if (!role || !m) return false;
  if (action === 'read') return !m.read || m.read.includes(role);
  if (action === 'edit') return (m.edit || m.write || []).includes(role);
  return (m[action] || []).includes(role);
}
export const ACCESS_TABLES = Object.keys(MATRIX).filter((k) => !['rental_events', 'vehicle_replacements'].includes(k));
