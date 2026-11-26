// Application state: who is signed in, company settings, and the data tables they may read.
import { can } from './rules.js';
import { setCurrency, debounce } from './util.js';

export const TABLES = ['vehicles', 'customers', 'rentals', 'payments', 'fines', 'maintenance', 'expenses', 'rental_balances',
  'branches', 'departments', 'masters', 'employees', 'suppliers', 'tariff_groups', 'tariff_cards', 'movements',
  'invoices', 'bills', 'vouchers', 'inspections', 'damages', 'vehicle_replacements', 'rental_events'];
const DEPENDS = {
  rentals: ['rental_balances', 'vehicles', 'rental_events', 'vehicle_replacements', 'invoices', 'fines', 'inspections', 'damages'],
  payments: ['rental_balances'], invoices: ['rental_balances', 'fines'], fines: ['invoices', 'rental_balances'],
  maintenance: ['vehicles', 'damages'], movements: ['vehicles', 'inspections', 'damages'], inspections: ['damages'],
};

export const S = {
  backend: null,
  me: null,
  settings: null,
  data: Object.fromEntries(TABLES.map((t) => [t, []])),
  get role() { return this.me?.active ? this.me.role : null; },
  can(table, action) { return can(this.role, table, action); },
};
const readable = (t) => ['rental_balances'].includes(t) || S.can(t, 'read');

const listeners = new Set();
export const onData = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export async function loadAll() {
  const results = await Promise.all(TABLES.map((t) =>
    (!readable(t) ? Promise.resolve([]) : S.backend.list(t)).catch((e) => { console.warn(t, e); return []; })));
  TABLES.forEach((t, i) => { S.data[t] = results[i] || []; });
  S.settings = (await S.backend.settings()) || { currency: 'AED', vat_rate: 5, company_name: 'Anamira Car Rental' };
  S.data.settings = S.settings;
  setCurrency(S.settings.currency);
  emit();
}

export async function reload(...tables) {
  const all = new Set(tables.flatMap((t) => [t, ...(DEPENDS[t] || [])]).filter((t) => TABLES.includes(t)));
  await Promise.all([...all].map(async (t) => {
    if (!readable(t)) return;
    try { S.data[t] = await S.backend.list(t); } catch (e) { console.warn(t, e); }
  }));
  emit();
}

// Realtime: coalesce bursts of changes from other users into one refresh.
const pending = new Set();
const flush = debounce(() => { const t = [...pending]; pending.clear(); reload(...t); }, 400);
export function startLive() { S.backend.subscribe((table) => { pending.add(table); flush(); }); }
