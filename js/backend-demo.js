// Demo backend: runs entirely in this browser with sample data, so anyone can explore the system
// without an account. It re-implements the database rules so the demo behaves like the real thing.
import { priceRental, RENTAL_FLOW, overlaps, balanceOf, can, TOLL_KINDS } from './rules.js';
import { uuid, round2 } from './util.js';

const KEY = 'anamira.demo.v3';
const DAY = 86400000;

function seed() {
  const now = new Date(); now.setMinutes(0, 0, 0);
  const at = (d, h = 10) => { const x = new Date(now.getTime() + d * DAY); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const day = (d) => at(d).slice(0, 10);
  const id = (p, i) => `${p}0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

  const branches = [
    { id: id('b', 1), code: 'MAIN', name: 'Al Quoz (main)', address: 'Al Quoz Industrial 3, Dubai', phone: '+971 4 000 0000', active: true, created_at: at(-300) },
    { id: id('b', 2), code: 'DXB', name: 'Dubai Airport T3', address: 'Terminal 3 arrivals, Dubai', phone: '+971 4 000 0001', active: true, created_at: at(-300) },
  ];
  const departments = [
    { id: id('d', 1), name: 'Operations', active: true, created_at: at(-300) },
    { id: id('d', 2), name: 'Accounts', active: true, created_at: at(-300) },
  ];
  const employees = [
    { id: id('e', 1), code: 'E-101', full_name: 'Rashid Khan', designation: 'Driver', department_id: id('d', 1), branch_id: id('b', 1), phone: '+971 55 100 2001', email: '', emirates_id: '784-1990-1234567-1', passport_number: '', license_number: 'DXB-77120', license_expiry: day(200), joined_on: day(-700), active: true, notes: '', created_at: at(-300) },
    { id: id('e', 2), code: 'E-102', full_name: 'Maria Santos', designation: 'Rental agent', department_id: id('d', 1), branch_id: id('b', 2), phone: '+971 55 100 2002', email: '', emirates_id: '', passport_number: 'P1234567', license_number: '', license_expiry: null, joined_on: day(-400), active: true, notes: '', created_at: at(-300) },
    { id: id('e', 3), code: 'E-103', full_name: 'Abu Saed', designation: 'Accountant', department_id: id('d', 2), branch_id: id('b', 1), phone: '+971 55 100 2003', email: '', emirates_id: '', passport_number: '', license_number: 'DXB-66001', license_expiry: day(25), joined_on: day(-900), active: true, notes: '', created_at: at(-300) },
  ];
  const suppliers = [
    { id: id('5', 1), code: 'S-101', name: 'Al Futtaim Service', category: 'garage', contact_person: 'Service desk', phone: '+971 4 200 0000', email: '', trn: '100200300400003', address: 'Al Quoz', active: true, notes: '', created_at: at(-300) },
    { id: id('5', 2), code: 'S-102', name: 'Tyre Plus', category: 'tyres', contact_person: '', phone: '+971 4 300 0000', email: '', trn: '', address: 'Al Barsha', active: true, notes: '', created_at: at(-300) },
    { id: id('5', 3), code: 'S-103', name: 'Orient Insurance', category: 'insurance', contact_person: 'Fleet team', phone: '+971 4 400 0000', email: '', trn: '', address: '', active: true, notes: '', created_at: at(-300) },
  ];
  const tariff_groups = [
    { id: id('9', 1), name: 'Economy sedans', description: 'Nissan Sentra class', active: true, created_at: at(-300) },
    { id: id('9', 2), name: 'SUVs', description: 'Rogue, Yukon', active: true, created_at: at(-300) },
    { id: id('9', 3), name: 'Sports & luxury', description: 'Corvette, Camaro, Mustang, E-Class', active: true, created_at: at(-300) },
  ];
  const card = (i, name, g, daily, weekly, monthly, km, extra, customer_id = null) => ({ id: id('7', i), name, tariff_group_id: id('9', g), customer_id,
    valid_from: day(-200), valid_to: null, daily_rate: daily, weekly_rate: weekly, monthly_rate: monthly, km_per_day: km, extra_km_rate: extra, active: true, notes: '', created_at: at(-200) });

  const V = (i, code, no, make, model, year, category, daily, weekly, monthly, extra = {}) => ({
    id: `a0000000-0000-4000-8000-00000000000${i}`, plate_code: code, plate_number: no, emirate: 'Dubai', make, model, year, category,
    color: '', daily_rate: daily, weekly_rate: weekly, monthly_rate: monthly, status: 'available', odometer: 12000 + i * 3150,
    insurance_expiry: day(40 + i * 37), registration_expiry: day(60 + i * 29), notes: '', created_at: at(-200),
    branch_id: id('b', i % 3 === 0 ? 2 : 1), tariff_group_id: null, vin: '', engine_capacity: '', transmission: 'automatic', fuel_type: 'petrol',
    sipp_code: '', service_interval_km: null, last_service_km: 12000 + i * 3150 - 4000, next_service_date: null, defleeted_on: null, defleet_reason: '', defleet_price: 0, ...extra,
  });
  const vehicles = [
    V(1, 'G', '18703', 'Chevrolet', 'Corvette Stingray', 2023, 'sports', 1200, 7200, 26400, { color: 'Red', tariff_group_id: id('9', 3), sipp_code: 'XTAR', engine_capacity: '6.2L V8' }),
    V(2, 'CC', '60743', 'Chevrolet', 'Camaro', 2023, 'sports', 600, 3600, 13200, { color: 'Yellow', tariff_group_id: id('9', 3), sipp_code: 'SSAR' }),
    V(3, 'B', '42894', 'GMC', 'Yukon', 2024, 'suv', 750, 4500, 16500, { color: 'Black', insurance_expiry: day(9), tariff_group_id: id('9', 2), sipp_code: 'FFAR' }),
    V(4, 'CC', '76781', 'Ford', 'Mustang', 2025, 'sports', 650, 3900, 14300, { color: 'Blue', tariff_group_id: id('9', 3), sipp_code: 'STAR' }),
    V(5, 'D', '87201', 'Nissan', 'Rogue', 2024, 'suv', 250, 1500, 5500, { color: 'White', tariff_group_id: id('9', 2), sipp_code: 'IFAR', last_service_km: 17000 }),
    V(6, 'DD', '71278', 'Nissan', 'Sentra', 2024, 'sedan', 170, 1020, 3740, { color: 'Silver', registration_expiry: day(5), tariff_group_id: id('9', 1), sipp_code: 'CDAR' }),
    V(7, 'Q', '83931', 'Nissan', 'Sentra', 2025, 'sedan', 180, 1080, 3960, { color: 'Grey', tariff_group_id: id('9', 1), sipp_code: 'CDAR' }),
    V(8, 'DD', '83795', 'Nissan', 'Sentra', 2023, 'sedan', 160, 960, 3520, { color: 'White', tariff_group_id: id('9', 1), sipp_code: 'CDAR' }),
    V(9, 'O', '45189', 'Mercedes-Benz', 'E 320', 2023, 'luxury', 550, 3300, 12100, { color: 'Black', tariff_group_id: id('9', 3), sipp_code: 'PDAR' }),
  ];
  const C = (i, full_name, nationality, extra = {}) => ({
    id: `c0000000-0000-4000-8000-00000000000${i}`, code: `C-${1000 + i}`, full_name, kind: 'individual', account_type: 'cash', credit_limit: 0,
    phone: `+971 50 ${100 + i * 7}${i} 2${i}4${i}`, email: '', nationality, id_number: `784-19${80 + i}-${1000000 + i * 1234}-${i}`, id_expiry: day(300 + i * 20),
    passport_number: `N${700000 + i * 31}`, passport_expiry: day(900), date_of_birth: null, trn: '', contact_person: '',
    license_number: `DXB-${400000 + i * 911}`, license_expiry: day(200 + i * 33), address: 'Dubai', blacklisted: false, notes: '',
    created_at: at(-90 + i), ...extra,
  });
  const customers = [
    C(1, 'Omar Al Mansoori', 'UAE'), C(2, 'Priya Nair', 'India'), C(3, 'James Whitaker', 'UK', { license_expiry: day(12) }),
    C(4, 'Fatima Haddad', 'Jordan'), C(5, 'Sergei Volkov', 'Russia', { blacklisted: true, notes: 'Unpaid fines from 2025' }),
    C(6, 'Bright Logistics LLC', 'UAE', { kind: 'company', account_type: 'credit', credit_limit: 10000, trn: '100345678900003', contact_person: 'Hana (fleet manager)', passport_number: '', id_number: '' }),
  ];
  const tariff_cards = [
    card(1, 'Economy standard', 1, 180, 1050, 3900, 250, 0.5), card(2, 'SUV standard', 2, 300, 1800, 6500, 250, 0.75),
    card(3, 'Sports & luxury standard', 3, 650, 3900, 14000, 200, 2), card(4, 'Bright Logistics · SUV', 2, 220, 1300, 4800, 300, 0.5, customers[5].id),
  ];
  const R = (n, c, v, status, s, e, extra = {}) => {
    const veh = vehicles[v - 1];
    const r = {
      id: uuid(), ref: `R-${1000 + n}`, customer_id: customers[c - 1].id, vehicle_id: veh.id, status, start_at: s, end_at: e,
      returned_at: null, daily_rate: veh.daily_rate, extras: 0, discount: 0, vat_rate: 5, deposit: 1000,
      odometer_out: status === 'booked' ? null : veh.odometer - 400, odometer_in: null, fuel_out: 'full', fuel_in: null,
      notes: '', created_by: 'demo-admin', created_at: s, branch_out_id: veh.branch_id, branch_in_id: veh.branch_id, tariff_card_id: null,
      km_per_day: 0, extra_km_rate: 0, extra_km_charge: 0, driver_name: '', driver_license: '', driver_phone: '', cancel_reason: '', cancelled_at: null, ...extra,
    };
    return Object.assign(r, priceRental(r));
  };
  const rentals = [
    R(1, 1, 1, 'active', at(-2), at(2)), R(2, 2, 5, 'active', at(-10), at(4), { daily_rate: 214.29 }),
    R(3, 3, 9, 'active', at(-5), at(-1), { notes: 'Customer asked for 1 extra day by phone' }),
    R(4, 4, 7, 'booked', at(0, 15), at(3, 15)), R(5, 6, 3, 'booked', at(3), at(10), { daily_rate: 642.86, discount: 200, km_per_day: 300, extra_km_rate: 0.5, driver_name: 'Hana Saleh', driver_license: 'DXB-551200' }),
    R(6, 1, 4, 'returned', at(-20), at(-15), { returned_at: at(-15), odometer_out: 15000, odometer_in: 15820, fuel_in: '3/4', extras: 150 }),
    R(7, 2, 2, 'returned', at(-35), at(-28), { returned_at: at(-28), odometer_out: 18000, odometer_in: 18950, fuel_in: 'full', daily_rate: 514.29 }),
    R(8, 4, 6, 'cancelled', at(-6), at(-4), { cancel_reason: 'Flight cancelled', cancelled_at: at(-7) }),
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
    { kind: 'salik', source: 'Salik', reference: 'SLK-889120', plate_code: 'G', plate_number: '18703', occurred_at: at(-1, 8), location: 'Al Maktoum Bridge', amount: 4 },
    { kind: 'salik', source: 'Salik', reference: 'SLK-889433', plate_code: 'D', plate_number: '87201', occurred_at: at(-3, 18), location: 'Al Safa', amount: 4 },
    { kind: 'darb', source: 'Darb (Abu Dhabi)', reference: 'DRB-22014', plate_code: 'D', plate_number: '87201', occurred_at: at(-4, 9), location: 'Sheikh Zayed Bridge', amount: 4 },
    { kind: 'mall_parking', source: 'Salik e-parking', reference: 'MP-50121', plate_code: 'G', plate_number: '18703', occurred_at: at(-1, 20), location: 'Dubai Mall', amount: 20 },
    { kind: 'traffic', source: 'Dubai Police', reference: 'DP-55120', plate_code: 'CC', plate_number: '76781', occurred_at: at(-17, 22), location: 'Sheikh Zayed Rd', amount: 600, black_points: 4, description: 'Speeding' },
    { kind: 'parking', source: 'RTA', reference: 'RTA-77310', plate_code: 'Q', plate_number: '83931', occurred_at: at(-40, 13), location: 'Deira', amount: 150 },
    { kind: 'traffic', source: 'Dubai Police', reference: 'DP-55871', plate_code: 'X', plate_number: '11111', occurred_at: at(-8, 9), location: 'Al Khail Rd', amount: 400 },
  ].map((f) => ({ id: uuid(), admin_fee: 0, status: 'new', vehicle_id: null, rental_id: null, customer_id: null, employee_id: null, invoice_id: null,
    reconciled_at: null, source: '', description: '', black_points: 0, created_at: f.occurred_at, imported_at: null, ...f }));
  const maintenance = [
    { id: uuid(), vehicle_id: vehicles[7].id, kind: 'repair', job_type: 'AC not cooling', description: 'AC compressor replacement', vendor: '', supplier_id: suppliers[0].id, employee_id: employees[0].id, cost: 1850, odometer: vehicles[7].odometer, status: 'open', opened_on: day(-1), expected_on: day(2), closed_on: null, created_at: at(-1) },
    { id: uuid(), vehicle_id: vehicles[0].id, kind: 'service', job_type: 'General service', description: '20,000 km service', vendor: '', supplier_id: suppliers[0].id, employee_id: null, cost: 1200, odometer: 15000, status: 'done', opened_on: day(-25), expected_on: null, closed_on: day(-24), created_at: at(-25) },
    { id: uuid(), vehicle_id: vehicles[5].id, kind: 'tyres', job_type: '', description: '4 new tyres', vendor: '', supplier_id: suppliers[1].id, employee_id: null, cost: 1400, odometer: null, status: 'done', opened_on: day(-50), expected_on: null, closed_on: day(-50), created_at: at(-50) },
  ];
  const expenses = [
    ['fuel', 'Fuel top-ups', 820, 41, -6], ['insurance', 'Fleet insurance instalment', 6200, 0, -12], ['marketing', 'Google Ads', 1500, 75, -9],
    ...[0, 1, 2, 3, 4, 5].flatMap((m) => [['salary', 'Staff salaries', 18500, 0, -18 - m * 30], ['rent', 'Office rent', 9000, 450, -16 - m * 30],
      ['utilities', 'DEWA + internet', 1050 + m * 20, 52, -3 - m * 30]]),
  ].map(([category, description, amount, vat, d]) => ({ id: uuid(), category, description, amount, vat, method: 'bank', spent_on: day(d), vehicle_id: null, created_by: 'demo-admin', created_at: at(d) }));
  // A staff movement under way (NRM) and a finished custody.
  vehicles[5].status = 'nrm';
  const movements = [
    { id: uuid(), ref: 'MV-1002', kind: 'nrm', vehicle_id: vehicles[5].id, employee_id: employees[0].id, from_branch_id: id('b', 1), to_branch_id: id('b', 2), purpose: 'Move car to the airport branch',
      status: 'open', out_at: at(0, 8), expected_in_at: at(0, 18), odometer_out: vehicles[5].odometer, fuel_out: 'full', in_at: null, odometer_in: null, fuel_in: null, notes: '', created_by: 'demo-admin', created_at: at(0, 8) },
    { id: uuid(), ref: 'MV-1001', kind: 'custody', vehicle_id: vehicles[6].id, employee_id: employees[1].id, from_branch_id: id('b', 1), to_branch_id: id('b', 1), purpose: 'Weekend on-call car',
      status: 'closed', out_at: at(-9, 18), expected_in_at: at(-7, 9), odometer_out: vehicles[6].odometer - 300, fuel_out: 'full', in_at: at(-7, 9), odometer_in: vehicles[6].odometer - 120, fuel_in: '3/4', notes: '', created_by: 'demo-admin', created_at: at(-9) },
  ];
  const insp = (r, kind, odo, extra = {}) => ({ id: uuid(), ref: '', kind, context: 'rental', rental_id: r.id, movement_id: null, vehicle_id: r.vehicle_id, at: kind === 'checkout' ? r.start_at : r.returned_at,
    odometer: odo, fuel: 'full', checklist: { 'Spare tyre': true, Toolkit: true, Jack: true, 'First aid kit': true, GPS: false, 'Baby seat': false, Handbook: true },
    photos: [], notes: '', staff_name: 'Maria Santos', customer_signature: '', staff_signature: '', created_by: 'demo-agent', created_at: r.start_at, ...extra });
  const inspections = [insp(recent[0], 'checkout', recent[0].odometer_out), insp(recent[1], 'checkout', recent[1].odometer_out), insp(recent[5], 'checkout', 15000), insp(recent[5], 'checkin', 15820, { fuel: '3/4' })];
  inspections.sort((a, b) => new Date(a.at) - new Date(b.at)).forEach((x, i) => { x.ref = `CC-${1001 + i}`; }); inspections.reverse();
  const damages = [
    { id: uuid(), vehicle_id: vehicles[0].id, inspection_id: inspections.find((x) => x.rental_id === recent[0].id).id, view: 'exterior', x: 22, y: 18, kind: 'scratch', severity: 'minor', note: 'Front bumper, left', photos: [], status: 'open', repaired_on: null, maintenance_id: null, created_by: 'demo-agent', created_at: recent[0].start_at },
    { id: uuid(), vehicle_id: vehicles[0].id, inspection_id: null, view: 'interior', x: 64, y: 40, kind: 'stain', severity: 'minor', note: 'Rear seat', photos: [], status: 'open', repaired_on: null, maintenance_id: null, created_by: 'demo-agent', created_at: at(-30) },
    { id: uuid(), vehicle_id: vehicles[3].id, inspection_id: null, view: 'exterior', x: 70, y: 80, kind: 'dent', severity: 'major', note: 'Rear door', photos: [], status: 'repaired', repaired_on: day(-12), maintenance_id: null, created_by: 'demo-agent', created_at: at(-15) },
  ];
  const bills = [
    { id: uuid(), ref: 'BL-1001', supplier_id: suppliers[0].id, bill_no: 'AFS-9921', bill_date: day(-24), due_date: day(6), category: 'maintenance', description: '20,000 km service G 18703', amount: 1200, vat: 60, vehicle_id: vehicles[0].id, maintenance_id: maintenance[1].id, status: 'open', created_by: 'demo-accountant', created_at: at(-24) },
    { id: uuid(), ref: 'BL-1002', supplier_id: suppliers[1].id, bill_no: 'TP-3310', bill_date: day(-50), due_date: day(-20), category: 'tyres', description: '4 tyres DD 71278', amount: 1400, vat: 70, vehicle_id: vehicles[5].id, maintenance_id: maintenance[2].id, status: 'open', created_by: 'demo-accountant', created_at: at(-50) },
    { id: uuid(), ref: 'BL-1003', supplier_id: suppliers[2].id, bill_no: 'OI-2026-77', bill_date: day(-75), due_date: day(-45), category: 'insurance', description: 'Fleet insurance Q3', amount: 6200, vat: 0, vehicle_id: null, maintenance_id: null, status: 'open', created_by: 'demo-accountant', created_at: at(-75) },
  ];
  const vouchers = [
    { id: uuid(), ref: 'PV-1001', direction: 'payment', party_type: 'supplier', supplier_id: suppliers[1].id, employee_id: null, party_name: '', purpose: 'bill', method: 'bank', amount: 1470, paid_on: day(-30), cheque_no: 'TRF-00812', note: 'Tyres', created_by: 'demo-accountant', created_at: at(-30) },
    { id: uuid(), ref: 'PV-1002', direction: 'payment', party_type: 'supplier', supplier_id: suppliers[2].id, employee_id: null, party_name: '', purpose: 'bill', method: 'cheque', amount: 3000, paid_on: day(-40), cheque_no: 'CHQ-1188', note: '', created_by: 'demo-accountant', created_at: at(-40) },
    { id: uuid(), ref: 'PV-1003', direction: 'payment', party_type: 'employee', supplier_id: null, employee_id: employees[0].id, party_name: '', purpose: 'advance', method: 'cash', amount: 500, paid_on: day(-10), cheque_no: '', note: 'Salary advance', created_by: 'demo-accountant', created_at: at(-10) },
  ];
  const masters = [];
  const M = (kind, value, sort = 0, parent = '') => masters.push({ id: uuid(), kind, value, parent, sort, active: true, created_at: at(-300) });
  ['Spare tyre', 'Toolkit', 'Jack', 'First aid kit', 'Fire extinguisher', 'GPS', 'Baby seat', 'Handbook', 'Registration card (Mulkiya)'].forEach((v, i) => M('checklist', v, i + 1));
  ['Oil and filter change', 'General service', 'Brake service', 'Tyre rotation and alignment', 'AC service', 'Battery check'].forEach((v, i) => M('service_type', v, i + 1));
  ['Accident damage', 'Body scratch or dent', 'Engine fault', 'Electrical fault', 'Puncture', 'Windscreen chip or crack', 'AC not cooling'].forEach((v, i) => M('defect_type', v, i + 1));
  ['1.6L', '2.0L', '2.5L', '3.0L', '3.5L', '5.0L V8', '6.2L V8'].forEach((v, i) => M('engine', v, i + 1));
  ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Yellow'].forEach((v, i) => M('color', v, i + 1));
  [...new Set(vehicles.map((v) => v.make))].forEach((v) => M('make', v));
  [...new Set(vehicles.map((v) => `${v.make}|${v.model}`))].forEach((k) => { const [mk, md] = k.split('|'); M('model', md, 0, mk); });
  const rental_events = recent.map((r) => ({ id: 0, rental_id: r.id, at: r.created_at, action: 'opened', details: `${r.status}`, actor: 'demo-admin', actor_name: 'Faisal' }));
  rental_events.push({ id: 0, rental_id: recent[2].id, at: at(-2), action: 'extended', details: 'end_at: earlier → later', actor: 'demo-agent', actor_name: 'Hussein' });
  rental_events.push({ id: 0, rental_id: recent[7].id, at: at(-7), action: 'cancelled', details: 'status: booked → cancelled; cancel_reason: — → Flight cancelled', actor: 'demo-agent', actor_name: 'Hussein' });
  rental_events.forEach((e, i) => { e.id = i + 1; });
  const profiles = [
    { id: 'demo-admin', email: 'faisal@demo.local', full_name: 'Faisal', role: 'admin', active: true, branch_id: id('b', 1), department_id: null, created_at: at(-200) },
    { id: 'demo-manager', email: 'fuad@demo.local', full_name: 'Fuad', role: 'manager', active: true, branch_id: id('b', 1), department_id: id('d', 1), created_at: at(-190) },
    { id: 'demo-agent', email: 'hussein@demo.local', full_name: 'Hussein', role: 'agent', active: true, branch_id: id('b', 2), department_id: id('d', 1), created_at: at(-180) },
    { id: 'demo-accountant', email: 'abu.saed@demo.local', full_name: 'Abu Saed', role: 'accountant', active: true, branch_id: id('b', 1), department_id: id('d', 2), created_at: at(-170) },
    { id: 'demo-new', email: 'new.hire@demo.local', full_name: 'New hire', role: 'agent', active: false, branch_id: null, department_id: null, created_at: at(-1) },
  ];
  const settings = { id: true, company_name: 'Anamira Car Rental', company_phone: '+971 4 000 0000', company_address: 'Al Quoz, Dubai, UAE', trn: '100000000000003', currency: 'AED', vat_rate: 5, salik_fee: 1, fine_fee_pct: 10,
    company_email: 'info@anamira.example', company_website: '', trade_license: '', default_deposit: 1000, alert_days: 30, service_interval_km: 10000, invoice_fines_on_close: true, fines_invoice_from: day(-60) };
  const db = { vehicles, customers, rentals, payments, fines, maintenance, expenses, profiles, settings, activity_log: [], branches, departments, masters, employees, suppliers,
    tariff_groups, tariff_cards, movements, invoices: [], bills, vouchers, inspections, damages, vehicle_replacements: [], rental_events, photos: {},
    seq: { rental: 1009, payment: 5010, log: 1, event: rental_events.length + 1, customer: 1010, supplier: 104, employee: 104, movement: 1003, invoice: 1001, bill: 1004, voucher: 1004, inspection: 1001 + inspections.length } };
  return db;
}

export function createDemoBackend() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  const fresh = !db || !db.seq || !db.movements;
  if (fresh) db = seed();
  let role = db.viewAs || 'admin';
  let listener = () => {};
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {
      // Storage full (usually photos): drop stored photos and try again so the rest of the demo keeps working.
      try { db.photos = {}; localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* blocked */ }
    }
  };
  if (fresh) save();
  const meId = () => `demo-${role}`;
  const meName = () => find('profiles', meId())?.full_name || role;
  const deny = () => { throw new Error('Your role is not allowed to do this.'); };
  const need = (table, action) => { if (!can(role, table, action)) deny(); };
  const find = (table, id) => db[table].find((r) => r.id === id);
  const plateOf = (v) => (v ? `${v.plate_code} ${v.plate_number}`.trim() : '');
  const log = (entity, row, action, extra = '', changes = '') => {
    const label = row.ref || (row.code && (row.full_name || row.name) ? `${row.code} ${row.full_name || row.name}` : '') || row.full_name || row.name
      || (row.plate_number ? `${row.plate_code} ${row.plate_number}` : '') || row.value || row.description || '';
    db.activity_log.unshift({ id: db.seq.log++, at: new Date().toISOString(), actor: meId(), actor_name: meName(),
      entity, entity_id: row.id, action, summary: (label + extra).slice(0, 200), changes: changes.slice(0, 1500) });
    db.activity_log.length = Math.min(db.activity_log.length, 500);
  };
  const diff = (prev, next) => Object.keys(next).filter((k) => !['updated_at', 'customer_signature', 'staff_signature', 'photos'].includes(k)
    && JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null))
    .map((k) => `${k}: ${String(prev[k] ?? '—').slice(0, 40)} → ${String(next[k] ?? '—').slice(0, 40)}`).join('; ');

  // ── Agreement editing log (mirrors private.rental_events_log) ──
  const EVENT_KEYS = ['status', 'customer_id', 'vehicle_id', 'start_at', 'end_at', 'returned_at', 'daily_rate', 'extras', 'discount', 'vat_rate', 'deposit',
    'odometer_out', 'odometer_in', 'fuel_out', 'fuel_in', 'km_per_day', 'extra_km_rate', 'extra_km_charge', 'driver_name', 'driver_license', 'driver_phone',
    'branch_out_id', 'branch_in_id', 'total', 'notes', 'cancel_reason'];
  const fmtD = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '') : '—');
  function rentalEvent(next, prev) {
    let act; const det = [];
    if (!prev) { act = 'opened'; det.push(`${fmtD(next.start_at)} → ${fmtD(next.end_at)}, ${next.status}`); }
    else {
      for (const k of EVENT_KEYS) {
        if (JSON.stringify(prev[k] ?? null) === JSON.stringify(next[k] ?? null) || (+prev[k] === +next[k] && prev[k] !== '' && next[k] !== '' && prev[k] != null && next[k] != null && !isNaN(+prev[k]))) continue;
        let ov = prev[k]; let nv = next[k];
        if (k === 'vehicle_id') { ov = plateOf(find('vehicles', ov)); nv = plateOf(find('vehicles', nv)); }
        if (k === 'customer_id') { ov = find('customers', ov)?.full_name; nv = find('customers', nv)?.full_name; }
        if (k.startsWith('branch_')) { ov = find('branches', ov)?.name; nv = find('branches', nv)?.name; }
        if (['start_at', 'end_at', 'returned_at'].includes(k)) { ov = ov && fmtD(ov); nv = nv && fmtD(nv); }
        det.push(`${k}: ${String(ov ?? '—').slice(0, 60)} → ${String(nv ?? '—').slice(0, 60)}`);
      }
      if (!det.length) return;
      act = next.status !== prev.status ? ({ active: 'handed_over', returned: 'closed', cancelled: 'cancelled' }[next.status] || 'edited')
        : next.vehicle_id !== prev.vehicle_id ? 'vehicle_replaced'
          : next.driver_name !== prev.driver_name && prev.driver_name ? 'driver_replaced'
            : new Date(next.end_at) > new Date(prev.end_at) ? 'extended' : new Date(next.end_at) < new Date(prev.end_at) ? 'cut_short' : 'edited';
    }
    db.rental_events.unshift({ id: db.seq.event++, rental_id: next.id, at: new Date().toISOString(), action: act, details: det.join('; ').slice(0, 2000), actor: meId(), actor_name: meName() });
  }

  const priorKm = (rentalId) => db.vehicle_replacements.filter((x) => x.rental_id === rentalId)
    .reduce((a, x) => a + Math.max(0, x.old_odometer_in - (x.old_odometer_out ?? x.old_odometer_in)), 0);

  function rentalRules(next, prev, { replacing = false } = {}) {
    if (prev) {
      if (['returned', 'cancelled'].includes(prev.status)) throw new Error(`Rental ${prev.ref} is closed and cannot be changed`);
      if (next.status !== prev.status && !RENTAL_FLOW[prev.status].includes(next.status)) throw new Error(`Cannot move rental from ${prev.status} to ${next.status}`);
      if (prev.status === 'active' && (next.customer_id !== prev.customer_id || (next.vehicle_id !== prev.vehicle_id && !replacing))) {
        throw new Error('Car and customer cannot change once the rental has started. Use Replace vehicle to swap the car.');
      }
      next.cancelled_at = next.status === 'cancelled' ? (prev.cancelled_at || new Date().toISOString()) : null;
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
    if (next.status === 'active' && (!prev || prev.status === 'booked' || replacing)) {
      if (v.status === 'maintenance') throw new Error(`Car ${v.plate_number} is in maintenance`);
      if (['nrm', 'custody'].includes(v.status)) throw new Error(`Car ${v.plate_number} is out on a staff movement. Close the movement first.`);
      if (db.rentals.some((r) => r.id !== next.id && r.vehicle_id === v.id && r.status === 'active')) throw new Error(`Car ${v.plate_number} is still out on another rental`);
      next.odometer_out ??= v.odometer;
    }
    if (next.status === 'returned') {
      next.returned_at ||= new Date().toISOString();
      if (next.odometer_in == null || next.odometer_in === '') throw new Error('Enter the odometer reading on return');
      if (!next.fuel_in) throw new Error('Enter the fuel level on return');
      if (next.odometer_out != null && +next.odometer_in < +next.odometer_out) throw new Error('Odometer in cannot be lower than odometer out');
    }
    const p = priceRental(next, { priorKm: priorKm(next.id), withKm: next.status === 'returned' });
    if (p.subtotal < 0) throw new Error('Discount is larger than the rental amount');
    Object.assign(next, p);
    // side effects on the car
    if (next.status === 'active') v.status = 'rented';
    if (prev?.status === 'active' && next.status === 'returned') {
      if (v.status === 'rented') v.status = 'available';
      v.odometer = Math.max(v.odometer, +next.odometer_in || 0);
      if (next.branch_in_id) v.branch_id = next.branch_in_id;
    }
  }
  function afterRental(next, prev) {
    rentalEvent(next, prev);
    if (prev?.status === 'active' && next.status === 'returned' && db.settings.invoice_fines_on_close !== false) invoicePending(next.id);
  }

  function maintenanceRules(m, prev) {
    const v = find('vehicles', m.vehicle_id); if (!v) throw new Error('Pick a car');
    if (m.status === 'open') {
      if (db.rentals.some((r) => r.vehicle_id === v.id && r.status === 'active')) throw new Error('This car is out on a rental. Return it first.');
      if (['nrm', 'custody'].includes(v.status)) throw new Error('This car is out on a staff movement. Close the movement first.');
      if (v.status === 'available') v.status = 'maintenance';
    } else {
      m.closed_on ||= new Date().toISOString().slice(0, 10);
      if (!db.maintenance.some((x) => x.vehicle_id === v.id && x.status === 'open' && x.id !== m.id) && v.status === 'maintenance') v.status = 'available';
      if (m.kind === 'service' && (!prev || prev.status === 'open')) v.last_service_km = Math.max(+v.last_service_km || 0, +(m.odometer ?? v.odometer));
    }
    if (m.odometer) v.odometer = Math.max(v.odometer, +m.odometer);
  }

  function movementRules(m, prev) {
    const v = find('vehicles', m.vehicle_id); if (!v) throw new Error('Pick a car');
    if (prev) {
      if (prev.status === 'closed') throw new Error(`Movement ${prev.ref} is closed and cannot be changed`);
      if (m.vehicle_id !== prev.vehicle_id || m.kind !== prev.kind) throw new Error('Car and type cannot change once the movement is open');
    } else {
      if (m.status !== 'open') throw new Error('New movements start open');
      if (!m.employee_id) throw new Error('Pick the employee who takes the car');
      if (v.status !== 'available') throw new Error(`Car ${v.plate_number} is not available for a staff movement (it is ${v.status})`);
      m.odometer_out ??= v.odometer; m.from_branch_id ||= v.branch_id || null;
    }
    if (m.status === 'closed') {
      m.in_at ||= new Date().toISOString();
      if (m.odometer_in == null || m.odometer_in === '') throw new Error('Enter the odometer reading on return');
      if (!m.fuel_in) throw new Error('Enter the fuel level on return');
      if (+m.odometer_in < +m.odometer_out) throw new Error(`Odometer in cannot be lower than odometer out (${m.odometer_out})`);
      if (new Date(m.in_at) < new Date(m.out_at)) throw new Error('Return time cannot be before the car went out');
      if (v.status === m.kind) v.status = 'available';
      v.odometer = Math.max(v.odometer, +m.odometer_in); if (m.to_branch_id) v.branch_id = m.to_branch_id;
    } else if (!prev) v.status = m.kind;
  }

  const DEFAULTS = {
    vehicles: { plate_code: '', emirate: 'Dubai', category: 'sedan', color: '', daily_rate: 0, weekly_rate: 0, monthly_rate: 0, status: 'available', odometer: 0, notes: '',
      branch_id: null, tariff_group_id: null, vin: '', engine_capacity: '', transmission: 'automatic', fuel_type: 'petrol', sipp_code: '', service_interval_km: null,
      last_service_km: null, next_service_date: null, defleeted_on: null, defleet_reason: '', defleet_price: 0 },
    customers: { kind: 'individual', account_type: 'cash', credit_limit: 0, phone: '', email: '', nationality: '', id_number: '', passport_number: '', license_number: '', address: '', trn: '', contact_person: '', blacklisted: false, notes: '' },
    rentals: { status: 'booked', extras: 0, discount: 0, vat_rate: 5, deposit: 0, fuel_out: 'full', notes: '', returned_at: null, odometer_in: null, fuel_in: null,
      branch_out_id: null, branch_in_id: null, tariff_card_id: null, km_per_day: 0, extra_km_rate: 0, extra_km_charge: 0, driver_name: '', driver_license: '', driver_phone: '', cancel_reason: '', cancelled_at: null },
    payments: { kind: 'payment', method: 'cash', note: '' },
    fines: { kind: 'salik', source: '', reference: '', plate_code: '', location: '', description: '', black_points: 0, admin_fee: 0, status: 'new', vehicle_id: null, rental_id: null, customer_id: null, employee_id: null, invoice_id: null, reconciled_at: null },
    maintenance: { kind: 'service', job_type: '', description: '', vendor: '', supplier_id: null, employee_id: null, cost: 0, status: 'open', closed_on: null, expected_on: null },
    expenses: { category: 'other', description: '', vat: 0, method: 'cash', vehicle_id: null },
    branches: { address: '', phone: '', active: true }, departments: { active: true }, masters: { parent: '', sort: 0, active: true },
    employees: { designation: '', department_id: null, branch_id: null, phone: '', email: '', emirates_id: '', passport_number: '', license_number: '', license_expiry: null, joined_on: null, active: true, notes: '' },
    suppliers: { category: 'other', contact_person: '', phone: '', email: '', trn: '', address: '', active: true, notes: '' },
    tariff_groups: { description: '', active: true },
    tariff_cards: { customer_id: null, valid_to: null, weekly_rate: 0, monthly_rate: 0, km_per_day: 0, extra_km_rate: 0, active: true, notes: '' },
    movements: { kind: 'nrm', from_branch_id: null, to_branch_id: null, purpose: '', status: 'open', expected_in_at: null, fuel_out: 'full', in_at: null, odometer_in: null, fuel_in: null, notes: '' },
    invoices: { rental_id: null, kind: 'other', due_on: null, description: '', vat: 0, status: 'open' },
    bills: { bill_no: '', due_date: null, category: 'other', description: '', vat: 0, vehicle_id: null, maintenance_id: null, status: 'open' },
    vouchers: { direction: 'payment', party_type: 'supplier', supplier_id: null, employee_id: null, party_name: '', purpose: 'bill', method: 'bank', cheque_no: '', note: '' },
  };
  const KEEP_EMPTY = ['notes', 'description', 'note', 'plate_code', 'reference', 'code', 'address', 'phone', 'email', 'purpose', 'job_type', 'vendor', 'bill_no',
    'cheque_no', 'party_name', 'parent', 'driver_name', 'driver_license', 'driver_phone', 'cancel_reason', 'designation', 'emirates_id', 'passport_number',
    'license_number', 'id_number', 'nationality', 'trn', 'contact_person', 'vin', 'engine_capacity', 'sipp_code', 'color', 'source', 'location', 'defleet_reason'];
  const clean = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '' && !KEEP_EMPTY.includes(k) ? null : v]));
  const nextRef = (prefix, key) => `${prefix}${db.seq[key]++}`;
  const uniq = (table, key, value, idSelf, msg) => {
    if (db[table].some((r) => r.id !== idSelf && String(r[key] || '').toLowerCase() === String(value || '').toLowerCase())) throw new Error(msg);
  };

  function beforeWrite(table, next, prev) {
    if (table === 'rentals') rentalRules(next, prev);
    if (table === 'maintenance') maintenanceRules(next, prev);
    if (table === 'movements') movementRules(next, prev);
    if (table === 'customers') { if (!prev && !next.code) next.code = nextRef('C-', 'customer'); uniq('customers', 'code', next.code, next.id, 'This code is already used.'); }
    if (table === 'suppliers') { if (!prev && !next.code) next.code = nextRef('S-', 'supplier'); uniq('suppliers', 'code', next.code, next.id, 'This code is already used.'); }
    if (table === 'employees') { if (!prev && !next.code) next.code = nextRef('E-', 'employee'); uniq('employees', 'code', next.code, next.id, 'This code is already used.'); }
    if (table === 'branches') uniq('branches', 'code', next.code, next.id, 'This code is already used.');
    if (table === 'departments' || table === 'tariff_groups') uniq(table, 'name', next.name, next.id, 'This name is already in the list.');
    if (table === 'masters' && db.masters.some((m) => m.id !== next.id && m.kind === next.kind && m.value.toLowerCase() === String(next.value).toLowerCase() && (m.parent || '').toLowerCase() === (next.parent || '').toLowerCase())) throw new Error('This name is already in the list.');
    if (table === 'vehicles') {
      if (next.sipp_code && !/^[A-Z]{4}$/.test(next.sipp_code)) throw new Error('The SIPP code must be four capital letters.');
      if (db.vehicles.some((v) => v.id !== next.id && v.emirate === next.emirate && v.plate_code === next.plate_code && v.plate_number === next.plate_number)) throw new Error('A car with this plate already exists.');
    }
    if (table === 'tariff_cards' && next.valid_to && next.valid_to < next.valid_from) throw new Error('"Valid to" must be on or after "valid from".');
    if (table === 'invoices') {
      if (prev?.status === 'void') throw new Error(`Invoice ${prev.ref} is void and cannot be changed`);
      if (next.rental_id) next.customer_id = find('rentals', next.rental_id)?.customer_id;
      if (!prev) next.ref = nextRef('INV-', 'invoice');
      if (next.status === 'void' && prev?.status !== 'void') db.fines.forEach((f) => { if (f.invoice_id === next.id) f.invoice_id = null; });
    }
    if (table === 'bills' && !prev) next.ref = nextRef('BL-', 'bill');
    if (table === 'vouchers') {
      if (!prev) next.ref = `${next.direction === 'payment' ? 'PV-' : 'RV-'}${db.seq.voucher++}`;
      else if (next.direction !== prev.direction) next.ref = `${next.direction === 'payment' ? 'PV-' : 'RV-'}${prev.ref.slice(3)}`;
      if (next.party_type !== 'supplier') next.supplier_id = null;
      if (next.party_type !== 'employee') next.employee_id = null;
      if ((next.party_type === 'supplier' && !next.supplier_id) || (next.party_type === 'employee' && !next.employee_id) || (next.party_type === 'other' && !String(next.party_name || '').trim())) {
        throw new Error('Pick who the voucher is paid to or received from.');
      }
      if (!(+next.amount > 0)) throw new Error('Amount must be more than zero');
    }
    if (table === 'damages') { if (next.status === 'repaired') next.repaired_on ||= new Date().toISOString().slice(0, 10); else { next.repaired_on = null; next.maintenance_id = null; } }
  }

  // ── Fines: match, import, invoice, reconcile (mirror the SQL functions) ──
  function legs(vehicleId) {
    const out = [];
    for (const k of db.rentals.filter((r) => ['active', 'returned'].includes(r.status))) {
      const reps = db.vehicle_replacements.filter((x) => x.rental_id === k.id).sort((a, b) => new Date(a.replaced_at) - new Date(b.replaced_at));
      let from = k.start_at;
      for (const x of reps) { out.push({ rental: k, vehicle_id: x.old_vehicle_id, from, to: x.replaced_at }); from = x.replaced_at; }
      out.push({ rental: k, vehicle_id: k.vehicle_id, from, to: k.returned_at || new Date(Math.max(new Date(k.end_at), Date.now())).toISOString() });
    }
    return out.filter((l) => l.vehicle_id === vehicleId);
  }
  function matchCore() {
    const s = db.settings; let n = 0;
    const norm = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const f of db.fines.filter((x) => ['new', 'unmatched'].includes(x.status))) {
      const v = db.vehicles.find((x) => x.plate_number.replace(/^0+/, '') === f.plate_number.replace(/^0+/, '') && (!f.plate_code || norm(x.plate_code) === norm(f.plate_code)));
      if (!v) f.status = 'unmatched';
      else {
        const t = new Date(f.occurred_at);
        const leg = legs(v.id).filter((l) => t >= new Date(l.from) && t <= new Date(l.to)).sort((a, b) => new Date(b.from) - new Date(a.from))[0];
        f.vehicle_id = v.id;
        if (leg) Object.assign(f, { rental_id: leg.rental.id, customer_id: leg.rental.customer_id, employee_id: null, status: 'charged', admin_fee: TOLL_KINDS.includes(f.kind) ? s.salik_fee : round2(f.amount * s.fine_fee_pct / 100) });
        else {
          const m = db.movements.filter((x) => x.vehicle_id === v.id && t >= new Date(x.out_at) && t <= new Date(x.in_at || Date.now())).sort((a, b) => new Date(b.out_at) - new Date(a.out_at))[0];
          if (m) Object.assign(f, { employee_id: m.employee_id, rental_id: null, customer_id: null, status: 'employee', admin_fee: 0 });
          else Object.assign(f, { status: 'company', admin_fee: 0 });
        }
      }
      n++;
    }
    return n;
  }
  function invoicePending(rentalId = null) {
    const since = db.settings.fines_invoice_from ? new Date(`${db.settings.fines_invoice_from}T00:00:00+04:00`) : new Date(0);
    const groups = {};
    for (const f of db.fines) {
      if (f.status !== 'charged' || f.invoice_id || !f.customer_id || (rentalId && f.rental_id !== rentalId) || new Date(f.occurred_at) < since) continue;
      (groups[`${f.customer_id}|${f.rental_id}`] ||= []).push(f);
    }
    let n = 0;
    for (const list of Object.values(groups)) {
      const amt = round2(list.reduce((a, f) => a + +f.amount + +f.admin_fee, 0)); const fee = list.reduce((a, f) => a + +f.admin_fee, 0);
      const times = list.map((f) => new Date(f.occurred_at)).sort((a, b) => a - b);
      const d = (x) => x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const inv = { ...DEFAULTS.invoices, id: uuid(), ref: nextRef('INV-', 'invoice'), customer_id: list[0].customer_id, rental_id: list[0].rental_id, kind: 'fines',
        issued_on: new Date().toISOString().slice(0, 10), description: `${list.length} charge(s): ${[...new Set(list.map((f) => f.kind.replace('_', ' ')))].join(', ')}, ${d(times[0])} to ${d(times[times.length - 1])}`,
        amount: amt, vat: round2(fee * db.settings.vat_rate / 100), created_by: meId(), created_at: new Date().toISOString() };
      db.invoices.unshift(inv); list.forEach((f) => { f.invoice_id = inv.id; }); log('invoices', inv, 'insert'); n++;
    }
    return n;
  }
  function importFines(rows) {
    need('fines', 'write');
    const norm = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const stamp = new Date().toISOString(); const out = { received: rows.length, inserted: 0, duplicates: 0, invalid: 0 };
    for (const x of rows) {
      const f = { ...DEFAULTS.fines, kind: x.kind || 'salik', source: String(x.source || '').slice(0, 60), reference: String(x.reference || '').trim().slice(0, 60),
        plate_code: norm(x.plate_code).slice(0, 4), plate_number: norm(x.plate_number).slice(0, 10), occurred_at: x.occurred_at,
        location: String(x.location || '').slice(0, 120), description: String(x.description || '').slice(0, 300),
        amount: round2(x.amount), black_points: Math.max(0, Math.min(24, +x.black_points || 0)) };
      if (!f.plate_number || !f.occurred_at || isNaN(new Date(f.occurred_at)) || !(+x.amount >= 0) || !['salik', 'darb', 'mall_parking', 'traffic', 'parking', 'other'].includes(f.kind)) { out.invalid++; continue; }
      const dup = db.fines.some((g) => g.kind === f.kind && (f.reference ? g.reference === f.reference
        : g.plate_number === f.plate_number && +new Date(g.occurred_at) === +new Date(f.occurred_at) && +g.amount === f.amount));
      if (dup) { out.duplicates++; continue; }
      Object.assign(f, { id: uuid(), created_at: stamp, imported_at: stamp });
      db.fines.unshift(f); out.inserted++;
    }
    log('fines', { id: stamp, description: 'Statement import' }, 'insert', ` · ${out.inserted} rows`);
    matchCore();
    out.charged = db.fines.filter((g) => g.imported_at === stamp && g.status === 'charged').length;
    out.company = db.fines.filter((g) => g.imported_at === stamp && ['company', 'employee'].includes(g.status)).length;
    out.unmatched = db.fines.filter((g) => g.imported_at === stamp && g.status === 'unmatched').length;
    return out;
  }

  // ── Vehicle replacement and check cards ──
  function replaceVehicle(a) {
    need('rentals', 'write');
    const r = find('rentals', a.p_rental); if (!r) throw new Error('Rental not found');
    if (r.status !== 'active') throw new Error('Only a running rental can have its car replaced');
    if (a.p_vehicle === r.vehicle_id) throw new Error('Pick a different car');
    const ov = find('vehicles', r.vehicle_id); const nv = find('vehicles', a.p_vehicle);
    if (!nv) throw new Error('Car not found');
    if (nv.status !== 'available') throw new Error(`Car ${nv.plate_number} is not available (it is ${nv.status})`);
    if (a.p_old_odometer == null || +a.p_old_odometer < (+r.odometer_out || 0)) throw new Error(`The returned car's odometer cannot be lower than when it went out (${r.odometer_out || 0})`);
    const when = a.p_at || new Date().toISOString();
    if (new Date(when) < new Date(new Date(r.start_at).getTime() - DAY) || new Date(when) > new Date(Math.max(new Date(r.end_at), Date.now()) + DAY)) throw new Error('The replacement time must be within the rental');
    const next = { ...r, vehicle_id: nv.id, odometer_out: a.p_new_odometer ?? nv.odometer, fuel_out: a.p_new_fuel || 'full' };
    const rep = { id: uuid(), rental_id: r.id, replaced_at: when, old_vehicle_id: ov.id, new_vehicle_id: nv.id, old_odometer_out: r.odometer_out, old_odometer_in: +a.p_old_odometer,
      old_fuel_in: a.p_old_fuel, new_odometer_out: next.odometer_out, new_fuel_out: next.fuel_out, reason: String(a.p_reason || '').slice(0, 300), created_by: meId(), created_at: new Date().toISOString() };
    db.vehicle_replacements.unshift(rep);
    try { rentalRules(next, r, { replacing: true }); } catch (e) { db.vehicle_replacements.shift(); throw e; }
    const prev = { ...r }; Object.assign(r, next); afterRental(r, prev);
    if (ov.status === 'rented') ov.status = 'available';
    ov.odometer = Math.max(ov.odometer, +a.p_old_odometer);
    log('rentals', r, 'update', ' · vehicle replaced'); save(); listener('rentals');
    return structuredClone(r);
  }
  function checkOutIn(p) {
    if (!can(role, 'inspections', 'write')) deny();
    const k = p.kind; const ctx = p.context; const when = p.at || new Date().toISOString();
    if (!['checkout', 'checkin'].includes(k) || !['rental', 'nrm', 'custody'].includes(ctx)) throw new Error('Unknown check type');
    if (p.odometer == null || p.odometer === '' || +p.odometer < 0) throw new Error('Enter the odometer reading');
    if (!['empty', '1/4', '1/2', '3/4', 'full'].includes(p.fuel)) throw new Error('Enter the fuel level');
    const snapshot = JSON.stringify(db);
    try {
      let rental = null; let mv = null; let veh;
      if (ctx === 'rental') {
        rental = find('rentals', p.rental_id); if (!rental) throw new Error('Pick the rental agreement');
        const prev = { ...rental };
        const next = k === 'checkout'
          ? (rental.status !== 'booked' ? (() => { throw new Error(`Rental ${rental.ref} is not waiting to be handed over (it is ${rental.status})`); })() : { ...rental, status: 'active', odometer_out: +p.odometer, fuel_out: p.fuel })
          : (rental.status !== 'active' ? (() => { throw new Error(`Rental ${rental.ref} is not out (it is ${rental.status})`); })() : { ...rental, status: 'returned', odometer_in: +p.odometer, fuel_in: p.fuel, returned_at: when, branch_in_id: p.branch_id || rental.branch_in_id });
        rentalRules(next, prev); Object.assign(rental, next); afterRental(rental, prev); log('rentals', rental, 'update', ` → ${rental.status}`);
        veh = rental.vehicle_id;
      } else if (k === 'checkout') {
        if (!p.vehicle_id) throw new Error('Pick the car');
        if (!p.employee_id) throw new Error('Pick the employee who takes the car');
        mv = { ...DEFAULTS.movements, id: uuid(), ref: nextRef('MV-', 'movement'), kind: ctx, vehicle_id: p.vehicle_id, employee_id: p.employee_id, purpose: String(p.purpose || '').slice(0, 300),
          out_at: when, expected_in_at: p.expected_in_at || null, odometer_out: +p.odometer, fuel_out: p.fuel, to_branch_id: p.branch_id || null, created_by: meId(), created_at: new Date().toISOString() };
        movementRules(mv, null); db.movements.unshift(mv); log('movements', mv, 'insert');
        veh = mv.vehicle_id;
      } else {
        mv = find('movements', p.movement_id); if (!mv) throw new Error('Pick the staff movement');
        if (mv.status !== 'open') throw new Error(`Movement ${mv.ref} is already closed`);
        const next = { ...mv, status: 'closed', odometer_in: +p.odometer, fuel_in: p.fuel, in_at: when, to_branch_id: p.branch_id || mv.to_branch_id };
        movementRules(next, mv); Object.assign(mv, next); log('movements', mv, 'update', ' → closed');
        veh = mv.vehicle_id;
      }
      const ins = { id: uuid(), ref: nextRef('CC-', 'inspection'), kind: k, context: ctx, rental_id: rental?.id || null, movement_id: mv?.id || null, vehicle_id: veh, at: when,
        odometer: +p.odometer, fuel: p.fuel, checklist: p.checklist && typeof p.checklist === 'object' ? p.checklist : {}, photos: (p.photos || []).slice(0, 30),
        notes: String(p.notes || '').slice(0, 2000), staff_name: String(p.staff_name || '').slice(0, 120), customer_signature: p.customer_signature || '', staff_signature: p.staff_signature || '',
        created_by: meId(), created_at: new Date().toISOString() };
      db.inspections.unshift(ins); log('inspections', ins, 'insert');
      for (const d of (p.damages || []).slice(0, 60)) {
        db.damages.unshift({ id: uuid(), vehicle_id: veh, inspection_id: ins.id, view: d.view || 'exterior', x: +d.x, y: +d.y, kind: d.kind || 'scratch', severity: d.severity || 'minor',
          note: String(d.note || '').slice(0, 300), photos: d.photos || [], status: 'open', repaired_on: null, maintenance_id: null, created_by: meId(), created_at: new Date().toISOString() });
      }
      save(); listener('inspections');
      return { id: ins.id, ref: ins.ref, rental_id: rental?.id || null, movement_id: mv?.id || null };
    } catch (e) { db = JSON.parse(snapshot); throw e; }
  }

  return {
    mode: 'demo',
    get role() { return role; },
    setRole(r) { role = r; db.viewAs = r; save(); },
    reset() { db = seed(); db.viewAs = role; save(); },
    async session() { return { user: { id: meId() } }; },
    onAuth() {},
    async updatePassword() { /* the demo has no password */ },
    async signOut() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
    async me() { return { ...find('profiles', meId()), role, active: true }; },
    async settings() { return { ...db.settings }; },
    async saveSettings(patch) { need('settings', 'write'); Object.assign(db.settings, patch); save(); return { ...db.settings }; },
    async list(table) {
      if (table === 'rental_balances') return db.rentals.map((r) => balanceOf(r, db.payments, db.invoices));
      if (table === 'profiles' && !can(role, 'profiles', 'read')) return db.profiles.filter((p) => p.id === meId());
      if (table === 'activity_log') return can(role, 'activity', 'read') ? structuredClone(db.activity_log) : [];
      if (!['rental_events', 'vehicle_replacements', 'profiles'].includes(table) && !can(role, table, 'read')) return [];
      return structuredClone(db[table] || []);
    },
    async get(table, id) { return structuredClone(find(table, id) || null); },
    async uploadPhoto(blob) {
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      const path = `demo/${uuid()}.jpg`; db.photos[path] = data; save(); return path;
    },
    async photoUrls(paths) { return Object.fromEntries((paths || []).filter((p) => db.photos[p]).map((p) => [p, db.photos[p]])); },
    async insert(table, row) {
      if (['inspections', 'rental_events', 'vehicle_replacements'].includes(table)) deny();
      need(table, 'write');
      const next = { ...DEFAULTS[table], ...clean(row), id: uuid(), created_at: new Date().toISOString() };
      delete next.total;
      if (table === 'rentals') { next.ref = `R-${db.seq.rental++}`; next.created_by = meId(); }
      if (table === 'payments') {
        if (!(+next.amount > 0)) throw new Error('Amount must be more than zero');
        next.ref = `P-${db.seq.payment++}`; next.paid_at ||= new Date().toISOString(); next.created_by = meId();
        if (next.rental_id) next.customer_id = find('rentals', next.rental_id)?.customer_id;
      }
      if (table === 'movements') { next.ref = nextRef('MV-', 'movement'); next.created_by = meId(); next.out_at ||= new Date().toISOString(); }
      beforeWrite(table, next, null);
      for (const k of ['amount', 'daily_rate', 'cost', 'vat']) if (k in next && next[k] != null) next[k] = round2(next[k]);
      db[table].unshift(next);
      if (table === 'rentals') afterRental(next, null);
      log(table, next, 'insert'); save(); listener(table);
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
        const ch = diff(p, n); Object.assign(p, patch); log('profiles', p, 'update', '', ch); save(); return p;
      }
      if (['inspections', 'rental_events', 'vehicle_replacements'].includes(table)) deny();
      need(table, table === 'payments' ? 'edit' : 'write');
      const prev = find(table, id); if (!prev) throw new Error('Not found');
      const before = { ...prev };
      const next = { ...prev, ...clean(patch) };
      if (table === 'damages') Object.assign(next, { x: prev.x, y: prev.y, view: prev.view, kind: prev.kind, vehicle_id: prev.vehicle_id });
      beforeWrite(table, next, prev);
      Object.assign(prev, next);
      if (table === 'rentals') afterRental(prev, before);
      log(table, prev, 'update', patch.status && patch.status !== before.status ? ` → ${patch.status}` : '', diff(before, prev)); save(); listener(table);
      return structuredClone(prev);
    },
    async remove(table, id) {
      need(table, 'remove');
      const row = find(table, id); if (!row) throw new Error('Not found');
      const used = {
        vehicles: () => db.rentals.some((r) => r.vehicle_id === id) || db.maintenance.some((m) => m.vehicle_id === id) || db.movements.some((m) => m.vehicle_id === id) || db.inspections.some((m) => m.vehicle_id === id),
        customers: () => db.rentals.some((r) => r.customer_id === id) || db.payments.some((p) => p.customer_id === id) || db.invoices.some((p) => p.customer_id === id),
        rentals: () => db.payments.some((p) => p.rental_id === id) || db.invoices.some((p) => p.rental_id === id),
        employees: () => db.movements.some((m) => m.employee_id === id) || db.vouchers.some((v) => v.employee_id === id),
        suppliers: () => db.bills.some((b) => b.supplier_id === id) || db.vouchers.some((v) => v.supplier_id === id),
        tariff_groups: () => db.tariff_cards.some((c) => c.tariff_group_id === id),
        maintenance: () => false,
      }[table];
      if (used?.()) throw new Error('This record is used elsewhere (for example by a rental or payment), so it cannot be deleted.');
      if (table === 'profiles' && id === meId()) deny();
      if (table === 'rentals' && row.status === 'active') { const v = find('vehicles', row.vehicle_id); if (v?.status === 'rented') v.status = 'available'; }
      if (table === 'movements' && row.status === 'open') { const v = find('vehicles', row.vehicle_id); if (v?.status === row.kind) v.status = 'available'; }
      if (table === 'inspections') db.damages.forEach((d) => { if (d.inspection_id === id) d.inspection_id = null; });
      if (table === 'invoices') db.fines.forEach((f) => { if (f.invoice_id === id) f.invoice_id = null; });
      db[table] = db[table].filter((r) => r.id !== id); log(table, row, 'delete'); save(); listener(table);
    },
    async rpc(name, args = {}) {
      let out;
      if (name === 'import_fines') out = importFines(args.rows || []);
      else if (name === 'match_fines') { need('fines', 'write'); out = matchCore(); }
      else if (name === 'invoice_fines') { need('invoices', 'write'); out = invoicePending(null); }
      else if (name === 'reconcile_fines') {
        need('fines', 'write');
        if (!args.p_from || !args.p_to || args.p_to < args.p_from) throw new Error('Pick a valid period');
        const a = new Date(`${args.p_from}T00:00:00+04:00`); const b = new Date(new Date(`${args.p_to}T00:00:00+04:00`).getTime() + DAY);
        out = 0; for (const f of db.fines) if (f.kind === args.p_kind && !f.reconciled_at && new Date(f.occurred_at) >= a && new Date(f.occurred_at) < b) { f.reconciled_at = new Date().toISOString(); out++; }
      } else if (name === 'replace_vehicle') return replaceVehicle(args);
      else if (name === 'check_out_in') return checkOutIn(args.payload || {});
      else throw new Error('Unknown action');
      save(); listener(name === 'invoice_fines' ? 'invoices' : 'fines'); return out;
    },
    subscribe(cb) { listener = cb; },
  };
}
