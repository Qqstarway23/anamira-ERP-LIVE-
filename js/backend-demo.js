// Demo backend: runs entirely in this browser with sample data, so anyone can explore the system
// without an account. It re-implements the database rules so the demo behaves like the real thing.
import { priceRental, RENTAL_FLOW, overlaps, balanceOf, can } from './rules.js';
import { uuid, round2 } from './util.js';

const KEY = 'anamira.demo.v2';
const DAY = 86400000;

function seed() {
  const now = new Date(); now.setMinutes(0, 0, 0);
  const at = (d, h = 10) => { const x = new Date(now.getTime() + d * DAY); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const day = (d) => at(d).slice(0, 10);
  const V = (i, code, no, make, model, year, category, daily, weekly, monthly, extra = {}) => ({
    id: `a0000000-0000-4000-8000-00000000000${i}`, plate_code: code, plate_number: no, emirate: 'Dubai', make, model, year, category,
    color: '', daily_rate: daily, weekly_rate: weekly, monthly_rate: monthly, status: 'available', odometer: 12000 + i * 3150,
    insurance_expiry: day(40 + i * 37), registration_expiry: day(60 + i * 29), notes: '', created_at: at(-200), ...extra,
  });
  const vehicles = [
    V(1, 'G', '18703', 'Chevrolet', 'Corvette Stingray', 2023, 'sports', 1200, 7200, 26400, { color: 'Red' }),
    V(2, 'CC', '60743', 'Chevrolet', 'Camaro', 2023, 'sports', 600, 3600, 13200, { color: 'Yellow' }),
    V(3, 'B', '42894', 'GMC', 'Yukon', 2024, 'suv', 750, 4500, 16500, { color: 'Black', insurance_expiry: day(9) }),
    V(4, 'CC', '76781', 'Ford', 'Mustang', 2025, 'sports', 650, 3900, 14300, { color: 'Blue' }),
    V(5, 'D', '87201', 'Nissan', 'Rogue', 2024, 'suv', 250, 1500, 5500, { color: 'White' }),
    V(6, 'DD', '71278', 'Nissan', 'Sentra', 2024, 'sedan', 170, 1020, 3740, { color: 'Silver', registration_expiry: day(5) }),
    V(7, 'Q', '83931', 'Nissan', 'Sentra', 2025, 'sedan', 180, 1080, 3960, { color: 'Grey' }),
    V(8, 'DD', '83795', 'Nissan', 'Sentra', 2023, 'sedan', 160, 960, 3520, { color: 'White' }),
    V(9, 'O', '45189', 'Mercedes-Benz', 'E 320', 2023, 'luxury', 550, 3300, 12100, { color: 'Black' }),
  ];
  const C = (i, full_name, nationality, extra = {}) => ({
    id: `c0000000-0000-4000-8000-00000000000${i}`, full_name, kind: 'individual', phone: `+971 50 ${100 + i * 7}${i} 2${i}4${i}`,
    email: '', nationality, id_number: `784-19${80 + i}-${1000000 + i * 1234}-${i}`, id_expiry: day(300 + i * 20),
    license_number: `DXB-${400000 + i * 911}`, license_expiry: day(200 + i * 33), address: 'Dubai', blacklisted: false, notes: '',
    created_at: at(-90 + i), ...extra,
  });
  const customers = [
    C(1, 'Omar Al Mansoori', 'UAE'), C(2, 'Priya Nair', 'India'), C(3, 'James Whitaker', 'UK', { license_expiry: day(12) }),
    C(4, 'Fatima Haddad', 'Jordan'), C(5, 'Sergei Volkov', 'Russia', { blacklisted: true, notes: 'Unpaid fines from 2025' }),
    C(6, 'Bright Logistics LLC', 'UAE', { kind: 'company' }),
  ];
  const R = (n, c, v, status, s, e, extra = {}) => {
    const veh = vehicles[v - 1];
    const r = {
      id: uuid(), ref: `R-${1000 + n}`, customer_id: customers[c - 1].id, vehicle_id: veh.id, status, start_at: s, end_at: e,
      returned_at: null, daily_rate: veh.daily_rate, extras: 0, discount: 0, vat_rate: 5, deposit: 1000,
      odometer_out: status === 'booked' ? null : veh.odometer - 400, odometer_in: null, fuel_out: 'full', fuel_in: null,
      notes: '', created_by: 'demo-admin', created_at: s, ...extra,
    };
    return Object.assign(r, priceRental(r));
  };
  const rentals = [
    R(1, 1, 1, 'active', at(-2), at(2)), R(2, 2, 5, 'active', at(-10), at(4), { daily_rate: 214.29 }),
    R(3, 3, 9, 'active', at(-5), at(-1), { notes: 'Customer asked for 1 extra day by phone' }),
    R(4, 4, 7, 'booked', at(0, 15), at(3, 15)), R(5, 6, 3, 'booked', at(3), at(10), { daily_rate: 642.86, discount: 200 }),
    R(6, 1, 4, 'returned', at(-20), at(-15), { returned_at: at(-15), odometer_out: 15000, odometer_in: 15820, fuel_in: '3/4', extras: 150 }),
    R(7, 2, 2, 'returned', at(-35), at(-28), { returned_at: at(-28), odometer_out: 18000, odometer_in: 18950, fuel_in: 'full', daily_rate: 514.29 }),
    R(8, 4, 6, 'cancelled', at(-6), at(-4)),
  ];
  for (const r of rentals) Object.assign(r, priceRental(r));
  for (const r of rentals) if (r.status === 'active') vehicles.find((v) => v.id === r.vehicle_id).status = 'rented';
  vehicles[7].status = 'maintenance';
  // Five months of finished rentals so reports have a history.
  const history = [];
  const regulars = [1, 2, 3, 4, 6];
  vehicles.forEach((veh, i) => {
    let d = -150 + i * 2;
    for (let k = 0; d + 8 < -36; k++) {
      const len = 2 + ((i * 7 + k * 3) % 6);
      history.push(R(0, regulars[(i + k) % regulars.length], i + 1, 'returned', at(d), at(d + len), {
        returned_at: at(d + len), odometer_out: 8000 + k * 600, odometer_in: 8000 + k * 600 + len * 140, fuel_in: 'full', extras: (k % 3) * 50 }));
      d += len + 3 + ((i + k) % 5) * 2;
    }
  });
  const recent = [...rentals];
  rentals.push(...history);
  rentals.sort((a, b) => new Date(a.start_at) - new Date(b.start_at)).forEach((r, i) => { r.ref = `R-${1001 + i}`; });
  const P = (r, amount, kind = 'payment', method = 'card', d = 0) => ({
    id: uuid(), ref: `P-${5000 + Math.floor(Math.random() * 900)}`, rental_id: r.id, customer_id: r.customer_id, kind, method,
    amount, paid_at: new Date(new Date(r.start_at).getTime() + d * DAY).toISOString(), note: '', created_by: 'demo-admin', created_at: r.start_at,
  });
  const payments = [
    P(recent[0], 1000, 'deposit'), P(recent[0], 2000), P(recent[1], 1000, 'deposit', 'cash'), P(recent[1], 1500, 'payment', 'cash'),
    P(recent[2], recent[2].total, 'payment', 'bank'), P(recent[5], recent[5].total), P(recent[6], recent[6].total, 'payment', 'bank'),
    P(recent[5], 1000, 'deposit'), P(recent[5], 1000, 'deposit_return', 'card', 5),
    ...history.map((r, i) => P(r, r.total, 'payment', ['card', 'cash', 'bank'][i % 3], (r.days || 1))),
  ];
  payments.sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at));
  payments.forEach((p, i) => { p.ref = `P-${5001 + i}`; });
  const fines = [
    { kind: 'salik', reference: 'SLK-889120', plate_code: 'G', plate_number: '18703', occurred_at: at(-1, 8), location: 'Al Maktoum Bridge', amount: 4 },
    { kind: 'salik', reference: 'SLK-889433', plate_code: 'D', plate_number: '87201', occurred_at: at(-3, 18), location: 'Al Safa', amount: 4 },
    { kind: 'traffic', reference: 'DP-55120', plate_code: 'CC', plate_number: '76781', occurred_at: at(-17, 22), location: 'Sheikh Zayed Rd', amount: 600 },
    { kind: 'parking', reference: 'RTA-77310', plate_code: 'Q', plate_number: '83931', occurred_at: at(-40, 13), location: 'Deira', amount: 150 },
    { kind: 'traffic', reference: 'DP-55871', plate_code: 'X', plate_number: '11111', occurred_at: at(-8, 9), location: 'Al Khail Rd', amount: 400 },
  ].map((f) => ({ id: uuid(), admin_fee: 0, status: 'new', vehicle_id: null, rental_id: null, customer_id: null, created_at: f.occurred_at, ...f }));
  const maintenance = [
    { id: uuid(), vehicle_id: vehicles[7].id, kind: 'repair', description: 'AC compressor replacement', vendor: 'Al Futtaim Service', cost: 1850, odometer: vehicles[7].odometer, status: 'open', opened_on: day(-1), closed_on: null, created_at: at(-1) },
    { id: uuid(), vehicle_id: vehicles[0].id, kind: 'service', description: '20,000 km service', vendor: 'GM Service Centre', cost: 1200, odometer: 15000, status: 'done', opened_on: day(-25), closed_on: day(-24), created_at: at(-25) },
    { id: uuid(), vehicle_id: vehicles[5].id, kind: 'tyres', description: '4 new tyres', vendor: 'Tyre Plus', cost: 1400, odometer: null, status: 'done', opened_on: day(-50), closed_on: day(-50), created_at: at(-50) },
  ];
  const expenses = [
    ['fuel', 'Fuel top-ups', 820, 41, -6], ['insurance', 'Fleet insurance instalment', 6200, 0, -12], ['marketing', 'Google Ads', 1500, 75, -9],
    ...[0, 1, 2, 3, 4, 5].flatMap((m) => [['salary', 'Staff salaries', 18500, 0, -18 - m * 30], ['rent', 'Office rent', 9000, 450, -16 - m * 30],
      ['utilities', 'DEWA + internet', 1050 + m * 20, 52, -3 - m * 30]]),
  ].map(([category, description, amount, vat, d]) => ({ id: uuid(), category, description, amount, vat, method: 'bank', spent_on: day(d), vehicle_id: null, created_by: 'demo-admin', created_at: at(d) }));
  const profiles = [
    { id: 'demo-admin', email: 'faisal@demo.local', full_name: 'Faisal', role: 'admin', active: true, created_at: at(-200) },
    { id: 'demo-manager', email: 'fuad@demo.local', full_name: 'Fuad', role: 'manager', active: true, created_at: at(-190) },
    { id: 'demo-agent', email: 'hussein@demo.local', full_name: 'Hussein', role: 'agent', active: true, created_at: at(-180) },
    { id: 'demo-accountant', email: 'abu.saed@demo.local', full_name: 'Abu Saed', role: 'accountant', active: true, created_at: at(-170) },
    { id: 'demo-new', email: 'new.hire@demo.local', full_name: 'New hire', role: 'agent', active: false, created_at: at(-1) },
  ];
  const settings = { id: true, company_name: 'Anamira Car Rental', company_phone: '+971 4 000 0000', company_address: 'Al Quoz, Dubai, UAE', trn: '100000000000003', currency: 'AED', vat_rate: 5, salik_fee: 1, fine_fee_pct: 10 };
  return { vehicles, customers, rentals, payments, fines, maintenance, expenses, profiles, settings, activity_log: [], seq: { rental: 1009, payment: 5010, log: 1 } };
}

export function createDemoBackend() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db || !db.seq) db = seed();
  let role = db.viewAs || 'admin';
  let listener = () => {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ } };
  const meId = () => `demo-${role}`;
  const deny = () => { throw new Error('Your role is not allowed to do this.'); };
  const need = (table, action) => { if (!can(role, table, action)) deny(); };
  const find = (table, id) => db[table].find((r) => r.id === id);
  const log = (entity, row, action, extra = '') => {
    const label = row.ref || row.full_name || (row.plate_number ? `${row.plate_code} ${row.plate_number}` : '') || row.description || '';
    db.activity_log.unshift({ id: db.seq.log++, at: new Date().toISOString(), actor: meId(), actor_name: find('profiles', meId())?.full_name || role,
      entity, entity_id: row.id, action, summary: (label + extra).slice(0, 200) });
    db.activity_log.length = Math.min(db.activity_log.length, 300);
  };

  function rentalRules(next, prev) {
    if (prev) {
      if (['returned', 'cancelled'].includes(prev.status)) throw new Error(`Rental ${prev.ref} is closed and cannot be changed`);
      if (next.status !== prev.status && !RENTAL_FLOW[prev.status].includes(next.status)) throw new Error(`Cannot move rental from ${prev.status} to ${next.status}`);
      if (prev.status === 'active' && (next.vehicle_id !== prev.vehicle_id || next.customer_id !== prev.customer_id)) throw new Error('Car and customer cannot change once the rental has started');
    } else if (!['booked', 'active'].includes(next.status)) throw new Error('New rentals start as booked or active');
    if (!(new Date(next.end_at) > new Date(next.start_at))) throw new Error('End must be after start');
    const c = find('customers', next.customer_id); const v = find('vehicles', next.vehicle_id);
    if (!c || !v) throw new Error('Pick a customer and a car');
    if (c.blacklisted && (!prev || next.status === 'active')) throw new Error(`Customer ${c.full_name} is blacklisted`);
    if (v.status === 'retired') throw new Error(`Car ${v.plate_number} is retired`);
    if (['booked', 'active'].includes(next.status) && db.rentals.some((r) => r.id !== next.id && r.vehicle_id === next.vehicle_id &&
        ['booked', 'active'].includes(r.status) && overlaps(r.start_at, r.end_at, next.start_at, next.end_at))) {
      throw new Error('This car is already booked for part of those dates.');
    }
    if (next.status === 'active' && (!prev || prev.status === 'booked')) {
      if (v.status === 'maintenance') throw new Error(`Car ${v.plate_number} is in maintenance`);
      if (db.rentals.some((r) => r.id !== next.id && r.vehicle_id === v.id && r.status === 'active')) throw new Error(`Car ${v.plate_number} is still out on another rental`);
      next.odometer_out ??= v.odometer;
    }
    if (next.status === 'returned') {
      next.returned_at ||= new Date().toISOString();
      if (next.odometer_in == null || next.odometer_in === '') throw new Error('Enter the odometer reading on return');
      if (!next.fuel_in) throw new Error('Enter the fuel level on return');
      if (next.odometer_out != null && +next.odometer_in < +next.odometer_out) throw new Error('Odometer in cannot be lower than odometer out');
    }
    const p = priceRental(next);
    if (p.subtotal < 0) throw new Error('Discount is larger than the rental amount');
    Object.assign(next, p);
    // side effects on the car
    if (next.status === 'active') v.status = 'rented';
    if (prev?.status === 'active' && next.status === 'returned') {
      if (v.status === 'rented') v.status = 'available';
      v.odometer = Math.max(v.odometer, +next.odometer_in || 0);
    }
  }

  function maintenanceRules(m) {
    const v = find('vehicles', m.vehicle_id); if (!v) throw new Error('Pick a car');
    if (m.status === 'open') {
      if (db.rentals.some((r) => r.vehicle_id === v.id && r.status === 'active')) throw new Error('This car is out on a rental. Return it first.');
      if (v.status === 'available') v.status = 'maintenance';
    } else {
      m.closed_on ||= new Date().toISOString().slice(0, 10);
      if (!db.maintenance.some((x) => x.vehicle_id === v.id && x.status === 'open' && x.id !== m.id) && v.status === 'maintenance') v.status = 'available';
    }
    if (m.odometer) v.odometer = Math.max(v.odometer, +m.odometer);
  }

  const DEFAULTS = {
    vehicles: { plate_code: '', emirate: 'Dubai', category: 'sedan', color: '', daily_rate: 0, weekly_rate: 0, monthly_rate: 0, status: 'available', odometer: 0, notes: '' },
    customers: { kind: 'individual', phone: '', email: '', nationality: '', id_number: '', license_number: '', address: '', blacklisted: false, notes: '' },
    rentals: { status: 'booked', extras: 0, discount: 0, vat_rate: 5, deposit: 0, fuel_out: 'full', notes: '', returned_at: null, odometer_in: null, fuel_in: null },
    payments: { kind: 'payment', method: 'cash', note: '' },
    fines: { kind: 'salik', reference: '', plate_code: '', location: '', admin_fee: 0, status: 'new', vehicle_id: null, rental_id: null, customer_id: null },
    maintenance: { kind: 'service', description: '', vendor: '', cost: 0, status: 'open', closed_on: null },
    expenses: { category: 'other', description: '', vat: 0, method: 'cash', vehicle_id: null },
  };
  const clean = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '' && !['notes', 'description', 'note', 'plate_code', 'reference'].includes(k) ? null : v]));

  return {
    mode: 'demo',
    get role() { return role; },
    setRole(r) { role = r; db.viewAs = r; save(); },
    reset() { db = seed(); db.viewAs = role; save(); },
    async session() { return { user: { id: meId() } }; },
    onAuth() {},
    async signOut() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
    async me() { return { ...find('profiles', meId()), role, active: true }; },
    async settings() { return { ...db.settings }; },
    async saveSettings(patch) { need('settings', 'write'); Object.assign(db.settings, patch); save(); return { ...db.settings }; },
    async list(table) {
      if (table === 'rental_balances') return db.rentals.map((r) => balanceOf(r, db.payments));
      if (table === 'expenses' && !can(role, 'expenses', 'read')) return [];
      if (table === 'profiles' && !can(role, 'profiles', 'read')) return db.profiles.filter((p) => p.id === meId());
      if (table === 'activity_log') return can(role, 'activity', 'read') ? db.activity_log : [];
      return structuredClone(db[table] || []);
    },
    async insert(table, row) {
      need(table, 'write');
      const next = { ...DEFAULTS[table], ...clean(row), id: uuid(), created_at: new Date().toISOString() };
      if (table === 'rentals') { next.ref = `R-${db.seq.rental++}`; next.created_by = meId(); rentalRules(next, null); }
      if (table === 'payments') {
        if (!(+next.amount > 0)) throw new Error('Amount must be more than zero');
        next.ref = `P-${db.seq.payment++}`; next.paid_at ||= new Date().toISOString(); next.created_by = meId();
        if (next.rental_id) next.customer_id = find('rentals', next.rental_id)?.customer_id;
      }
      if (table === 'maintenance') maintenanceRules(next);
      if (table === 'vehicles' && db.vehicles.some((v) => v.emirate === next.emirate && v.plate_code === next.plate_code && v.plate_number === next.plate_number)) {
        throw new Error('A car with this plate already exists.');
      }
      for (const k of ['amount', 'daily_rate', 'cost']) if (k in next) next[k] = round2(next[k]);
      db[table].unshift(next); log(table, next, 'insert'); save(); listener(table);
      return structuredClone(next);
    },
    async update(table, id, patch) {
      if (table === 'profiles') {
        need('profiles', 'write');
        const p = find('profiles', id);
        const n = { ...p, ...patch };
        if (p.role === 'admin' && p.active && (n.role !== 'admin' || !n.active) && !db.profiles.some((x) => x.id !== id && x.role === 'admin' && x.active)) {
          throw new Error('At least one active admin is required');
        }
        Object.assign(p, patch); log('profiles', p, 'update'); save(); return p;
      }
      need(table, table === 'payments' ? 'edit' : 'write');
      const prev = find(table, id); if (!prev) throw new Error('Not found');
      const next = { ...prev, ...clean(patch) };
      if (table === 'rentals') rentalRules(next, prev);
      if (table === 'maintenance') maintenanceRules(next);
      Object.assign(prev, next);
      log(table, prev, 'update', patch.status && patch.status !== undefined ? ` → ${patch.status}` : ''); save(); listener(table);
      return structuredClone(prev);
    },
    async remove(table, id) {
      need(table, 'remove');
      const row = find(table, id);
      const used = {
        vehicles: () => db.rentals.some((r) => r.vehicle_id === id) || db.maintenance.some((m) => m.vehicle_id === id),
        customers: () => db.rentals.some((r) => r.customer_id === id) || db.payments.some((p) => p.customer_id === id),
        rentals: () => db.payments.some((p) => p.rental_id === id),
      }[table];
      if (used?.()) throw new Error('This record is used elsewhere (for example by a rental or payment), so it cannot be deleted.');
      if (table === 'profiles' && id === meId()) deny();
      if (table === 'rentals' && row.status === 'active') { const v = find('vehicles', row.vehicle_id); if (v?.status === 'rented') v.status = 'available'; }
      db[table] = db[table].filter((r) => r.id !== id); log(table, row, 'delete'); save(); listener(table);
    },
    async rpc(name) {
      if (name !== 'match_fines') throw new Error('Unknown action');
      need('fines', 'write');
      const s = db.settings; let n = 0;
      const norm = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      for (const f of db.fines.filter((x) => ['new', 'unmatched'].includes(x.status))) {
        const v = db.vehicles.find((x) => x.plate_number.replace(/^0+/, '') === f.plate_number.replace(/^0+/, '') && (!f.plate_code || norm(x.plate_code) === norm(f.plate_code)));
        if (!v) f.status = 'unmatched';
        else {
          const r = db.rentals.filter((k) => k.vehicle_id === v.id && ['active', 'returned'].includes(k.status) &&
              new Date(f.occurred_at) >= new Date(k.start_at) &&
              new Date(f.occurred_at) <= new Date(k.returned_at || Math.max(new Date(k.end_at), Date.now())))
            .sort((a, b) => new Date(b.start_at) - new Date(a.start_at))[0];
          Object.assign(f, { vehicle_id: v.id });
          if (!r) Object.assign(f, { status: 'company', admin_fee: 0 });
          else Object.assign(f, { rental_id: r.id, customer_id: r.customer_id, status: 'charged', admin_fee: f.kind === 'salik' ? s.salik_fee : round2(f.amount * s.fine_fee_pct / 100) });
        }
        n++;
      }
      save(); listener('fines'); return n;
    },
    subscribe(cb) { listener = cb; },
  };
}
