// One definition per business object: its form fields and its list columns. The generic list view
// (views/records.js) turns these into search, table, CSV export, create/edit/delete — the same way everywhere.
// Optional hooks: toForm(row) → form values, fromForm(values, row) → row to save, editFields(row), filters, extraFilters.
import { html } from './util.js';
import { plate, carName, fmtDate, fmtDateTime, money, daysUntil, byId, num } from './util.js';
import { badge, plateTag } from './ui.js';
import { t } from './i18n.js';
import { ACRISS, describeSipp, FUEL } from './rules.js';
import { customerEntries, supplierEntries, employeeEntries, lastBalance } from './ledger.js';

const carLabel = (v) => `${plate(v)} · ${carName(v)}`;
const expiry = (d, days = 30) => {
  if (!d) return '—';
  const n = daysUntil(d);
  const cls = n < 0 ? 'red' : n <= days ? 'amber' : '';
  return html`<span class="exp ${cls}">${fmtDate(d)}</span>`;
};
export const masters = (data, kind, parent) => (data.masters || [])
  .filter((m) => m.kind === kind && m.active !== false && (parent == null || !m.parent || m.parent.toLowerCase() === String(parent).toLowerCase()))
  .sort((a, b) => a.sort - b.sort || a.value.localeCompare(b.value)).map((m) => m.value);
const nameOf = (rows, id, f = (r) => r.name) => { const r = (rows || []).find((x) => x.id === id); return r ? f(r) : ''; };
const active = (r) => r.active !== false;
const yesNo = (v) => (v === false ? badge('retired', t('Inactive')) : badge('available', t('Active')));

export const PAYMENT_METHODS = ['cash', 'card', 'bank', 'cheque'];
export const FINE_KINDS = ['salik', 'darb', 'mall_parking', 'traffic', 'parking', 'other'];
export const FINE_STATUS = ['new', 'charged', 'company', 'employee', 'unmatched', 'paid', 'disputed'];
export const MASTER_KINDS = ['make', 'model', 'engine', 'color', 'service_type', 'defect_type', 'checklist'];

// Service is due when the odometer passes the interval since the last service, or the service date is near.
export function serviceDue(v, settings, alertDays = 30) {
  if (!v || v.status === 'retired') return false;
  const interval = num(v.service_interval_km ?? settings?.service_interval_km);
  const kmDue = interval > 0 && v.last_service_km != null && num(v.odometer) >= num(v.last_service_km) + interval - 500;
  const d = daysUntil(v.next_service_date);
  return kmDue || (d != null && d <= Math.min(alertDays, 14));
}

export const RESOURCES = {
  vehicles: {
    title: 'Fleet', icon: 'car', singular: 'car', search: ['plate_number', 'plate_code', 'make', 'model', 'color', 'vin', 'sipp_code'],
    filters: { key: 'status', values: ['available', 'rented', 'nrm', 'custody', 'maintenance', 'retired'] },
    fields: [
      { key: 'plate_code', label: 'Plate code', max: 4 }, { key: 'plate_number', label: 'Plate number', req: true, max: 10 },
      { key: 'emirate', label: 'Emirate', type: 'select', req: true, def: 'Dubai', options: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'] },
      { key: 'make', label: 'Make', req: true, max: 40, list: (d) => masters(d, 'make') },
      { key: 'model', label: 'Model', req: true, max: 60, list: (d) => masters(d, 'model') },
      { key: 'year', label: 'Year', type: 'int', min: 1990, max: 2100, def: () => new Date().getFullYear() },
      { key: 'category', label: 'Category', type: 'select', req: true, def: 'sedan', options: ['economy', 'sedan', 'suv', 'sports', 'luxury', 'van'] },
      { key: 'color', label: 'Color', max: 30, list: (d) => masters(d, 'color') },
      { key: 'vin', label: 'Chassis no. (VIN)', max: 30 },
      { key: 'engine_capacity', label: 'Engine capacity', max: 20, list: (d) => masters(d, 'engine') },
      { key: 'transmission', label: 'Transmission', type: 'select', req: true, def: 'automatic', options: ['automatic', 'manual'] },
      { key: 'fuel_type', label: 'Fuel type', type: 'select', req: true, def: 'petrol', options: ['petrol', 'diesel', 'hybrid', 'electric'] },
      ...ACRISS.map((a, i) => ({ key: `sipp_${i}`, label: `SIPP · ${a.label}`, type: 'select', options: Object.entries(a.options).map(([k, v]) => [k, `${k} · ${v}`]) })),
      { key: 'branch_id', label: 'Branch', type: 'ref', ref: 'branches', refLabel: (b) => b.name, refFilter: active },
      { key: 'tariff_group_id', label: 'Tariff group', type: 'ref', ref: 'tariff_groups', refLabel: (g) => g.name, refFilter: active },
      { key: 'daily_rate', label: 'Daily rate', type: 'money', req: true }, { key: 'weekly_rate', label: 'Weekly rate', type: 'money' },
      { key: 'monthly_rate', label: 'Monthly rate', type: 'money' }, { key: 'odometer', label: 'Odometer', type: 'int', def: 0 },
      { key: 'insurance_expiry', label: 'Insurance expiry', type: 'date' }, { key: 'registration_expiry', label: 'Registration expiry', type: 'date' },
      { key: 'service_interval_km', label: 'Service every (km)', type: 'int', max: 100000, help: 'Empty = the default from Settings.' },
      { key: 'last_service_km', label: 'Last service at (km)', type: 'int' }, { key: 'next_service_date', label: 'Next service date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', req: true, def: 'available', options: ['available', 'retired'],
        help: 'Rented, staff use, custody and maintenance are set automatically by rentals, movements and garage jobs.' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    toForm: (r) => ({ ...r, ...Object.fromEntries([0, 1, 2, 3].map((i) => [`sipp_${i}`, (r.sipp_code || '')[i] || ''])) }),
    fromForm: (v) => {
      const parts = [0, 1, 2, 3].map((i) => v[`sipp_${i}`] || '');
      const out = { ...v }; [0, 1, 2, 3].forEach((i) => delete out[`sipp_${i}`]);
      if (parts.some(Boolean) && !parts.every(Boolean)) throw new Error('Pick all four SIPP letters, or none.');
      out.sipp_code = parts.join('');
      return out;
    },
    columns: [
      { label: 'Plate', cell: (r) => plateTag(r), csv: plate },
      { label: 'Car', cell: (r) => html`<b>${carName(r)}</b><small class="muted block">${r.year || ''} · ${t(r.category)}${r.sipp_code ? html` · <span class="mono" title="${describeSipp(r.sipp_code)}">${r.sipp_code}</span>` : ''}</small>`, csv: carName },
      { label: 'Branch', cell: (r, x) => nameOf(x.data.branches, r.branch_id) || '—', csv: (r, x) => nameOf(x.data.branches, r.branch_id) },
      { label: 'Daily rate', cell: (r) => money(r.daily_rate), cls: 'num', key: 'daily_rate' },
      { label: 'Odometer', cell: (r, x) => html`${(+r.odometer || 0).toLocaleString()} km${serviceDue(r, x.settings) ? html`<small class="block">${badge('maintenance', t('Service due'))}</small>` : ''}`, cls: 'num', key: 'odometer' },
      { label: 'Insurance expiry', cell: (r) => expiry(r.insurance_expiry), key: 'insurance_expiry' },
      { label: 'Registration expiry', cell: (r) => expiry(r.registration_expiry), key: 'registration_expiry' },
      { label: 'Status', cell: (r) => badge(r.status), key: 'status' },
    ],
    // When editing, keep the automatic statuses selectable so the form does not silently change them.
    editFields: (row) => RESOURCES.vehicles.fields.map((f) => (f.key === 'status' && !['available', 'retired'].includes(row.status)
      ? { ...f, options: [row.status] } : f)),
  },

  customers: {
    title: 'Customers', icon: 'users', singular: 'customer',
    search: ['code', 'full_name', 'phone', 'email', 'id_number', 'passport_number', 'license_number', 'trn', 'nationality', 'contact_person'],
    filters: { key: 'account_type', values: ['cash', 'credit'] },
    fields: [
      { key: 'full_name', label: 'Full name', req: true, max: 120 },
      { key: 'code', label: 'Customer code', max: 20, help: 'Leave empty to number it automatically.' },
      { key: 'kind', label: 'Type', type: 'select', req: true, def: 'individual', options: ['individual', 'company'] },
      { key: 'account_type', label: 'Account', type: 'select', req: true, def: 'cash', options: [['cash', 'Walk-in (cash)'], ['credit', 'Corporate (credit)']] },
      { key: 'credit_limit', label: 'Credit limit', type: 'money', show: (v) => v.account_type === 'credit' },
      { key: 'contact_person', label: 'Contact person', max: 120, show: (v) => v.kind === 'company' },
      { key: 'trn', label: 'TRN', max: 20, show: (v) => v.kind === 'company' },
      { key: 'phone', label: 'Phone', type: 'tel', max: 30 }, { key: 'email', label: 'Email', type: 'email', max: 120 },
      { key: 'nationality', label: 'Nationality', max: 40 }, { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
      { key: 'id_number', label: 'Emirates ID / ID no.', max: 40 }, { key: 'id_expiry', label: 'ID expiry', type: 'date' },
      { key: 'passport_number', label: 'Passport no.', max: 40 }, { key: 'passport_expiry', label: 'Passport expiry', type: 'date' },
      { key: 'license_number', label: 'Licence no.', max: 40 }, { key: 'license_expiry', label: 'Licence expiry', type: 'date' },
      { key: 'address', label: 'Address', max: 200, span: true },
      { key: 'blacklisted', label: 'Blacklisted', type: 'checkbox', span: true },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    fromForm: (v) => { const out = { ...v }; if (!out.code) delete out.code; return out; },
    columns: [
      { label: 'Code', cell: (r) => html`<span class="mono">${r.code || '—'}</span>`, key: 'code' },
      { label: 'Customer', cell: (r) => html`<b>${r.full_name}</b> ${r.blacklisted ? badge('disputed', t('Blacklisted')) : ''}<small class="muted block">${t(r.kind)}${r.nationality ? ' · ' + r.nationality : ''}</small>`, csv: (r) => r.full_name },
      { label: 'Phone', cell: (r) => r.phone || '—', key: 'phone' },
      { label: 'ID / Passport no.', cell: (r) => html`${r.id_number || '—'}<small class="muted block">${r.passport_number || ''}</small>`, csv: (r) => [r.id_number, r.passport_number].filter(Boolean).join(' / ') },
      { label: 'Licence expiry', cell: (r) => expiry(r.license_expiry), key: 'license_expiry' },
      { label: 'Account', cell: (r) => html`${badge(r.account_type || 'cash', t(r.account_type === 'credit' ? 'Credit' : 'Cash'))}${r.account_type === 'credit' && +r.credit_limit ? html`<small class="muted block">${t('Limit')} ${money(r.credit_limit)}</small>` : ''}`, key: 'account_type' },
      { label: 'Balance', cell: (r, x) => { const b = x.custBalance?.(r.id) ?? 0; return html`<b class="${b > 0.009 ? 'neg' : b < -0.009 ? 'pos' : ''}">${money(b)}</b>`; }, cls: 'num', csv: (r, x) => x.custBalance?.(r.id) },
    ],
  },

  payments: {
    title: 'Payments', icon: 'wallet', singular: 'payment', permEdit: 'edit',
    search: ['ref', 'note', (r, x) => x.customers[r.customer_id]?.full_name, (r, x) => x.rentals[r.rental_id]?.ref],
    filters: { key: 'kind', values: ['payment', 'deposit', 'refund', 'deposit_return'] },
    fields: [
      { key: 'rental_id', label: 'Rental', type: 'ref', ref: 'rentals', refLabel: (r) => `${r.ref} · ${t(r.status)}`, refFilter: (r) => r.status !== 'cancelled' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', req: true, refLabel: (c) => `${c.code ? c.code + ' · ' : ''}${c.full_name}`, help: 'Filled from the rental when one is picked.' },
      { key: 'kind', label: 'Kind', type: 'select', req: true, def: 'payment', options: ['payment', 'deposit', 'refund', 'deposit_return'] },
      { key: 'method', label: 'Method', type: 'select', req: true, def: 'cash', options: PAYMENT_METHODS },
      { key: 'amount', label: 'Amount', type: 'money', req: true, min: 0.01 },
      { key: 'paid_at', label: 'Date', type: 'datetime', req: true, def: () => new Date().toISOString() },
      { key: 'note', label: 'Notes', type: 'textarea', span: true },
    ],
    columns: [
      { label: 'Reference', cell: (r) => html`<b class="mono">${r.ref}</b>`, key: 'ref' },
      { label: 'Date', cell: (r) => fmtDateTime(r.paid_at), key: 'paid_at' },
      { label: 'Customer', cell: (r, x) => x.customers[r.customer_id]?.full_name || '—', csv: (r, x) => x.customers[r.customer_id]?.full_name },
      { label: 'Rental', cell: (r, x) => (r.rental_id ? html`<a href="#/rentals?open=${r.rental_id}" class="mono">${x.rentals[r.rental_id]?.ref || ''}</a>` : '—'), csv: (r, x) => x.rentals[r.rental_id]?.ref },
      { label: 'Kind', cell: (r) => badge(r.kind), key: 'kind' },
      { label: 'Method', cell: (r) => t(r.method), key: 'method' },
      { label: 'Amount', cell: (r) => html`<b class="${['refund', 'deposit_return'].includes(r.kind) ? 'neg' : ''}">${money(r.amount)}</b>`, cls: 'num', key: 'amount' },
    ],
  },

  fines: {
    title: 'Fines & tolls', icon: 'siren', singular: 'fine',
    search: ['reference', 'plate_number', 'location', 'source', 'description', (r, x) => x.customers[r.customer_id]?.full_name, (r, x) => nameOf(x.data.employees, r.employee_id, (e) => e.full_name)],
    filters: { key: 'status', values: FINE_STATUS },
    extraFilters: { key: 'kind', values: FINE_KINDS },
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', req: true, def: 'salik', options: FINE_KINDS },
      { key: 'source', label: 'Authority', max: 60 },
      { key: 'reference', label: 'Reference', max: 60 },
      { key: 'plate_code', label: 'Plate code', max: 4 }, { key: 'plate_number', label: 'Plate number', req: true, max: 10 },
      { key: 'occurred_at', label: 'Occurred', type: 'datetime', req: true }, { key: 'location', label: 'Location', max: 120 },
      { key: 'description', label: 'Description', max: 300 }, { key: 'black_points', label: 'Black points', type: 'int', max: 24, def: 0 },
      { key: 'amount', label: 'Amount', type: 'money', req: true }, { key: 'admin_fee', label: 'Admin fee', type: 'money' },
      { key: 'status', label: 'Status', type: 'select', req: true, def: 'new', options: FINE_STATUS },
      { key: 'employee_id', label: 'Employee', type: 'ref', ref: 'employees', refLabel: (e) => `${e.code} · ${e.full_name}`, show: (v) => v.status === 'employee' },
    ],
    columns: [
      { label: 'Occurred', cell: (r) => fmtDateTime(r.occurred_at), key: 'occurred_at' },
      { label: 'Kind', cell: (r) => html`<b>${t(r.kind)}</b>${r.source ? html` <small class="muted">${r.source}</small>` : ''}<small class="muted block mono">${r.reference}</small>${r.description || r.location ? html`<small class="muted block">${[r.description, r.location].filter(Boolean).join(' · ')}</small>` : ''}`, csv: (r) => [r.kind, r.source, r.reference, r.description, r.location].filter(Boolean).join(' | ') },
      { label: 'Plate', cell: (r) => plateTag(r), csv: plate },
      { label: 'Charged to', cell: (r, x) => (r.customer_id ? html`${x.customers[r.customer_id]?.full_name}<small class="muted block mono">${x.rentals[r.rental_id]?.ref || ''}</small>`
        : r.employee_id ? html`${nameOf(x.data.employees, r.employee_id, (e) => e.full_name)}<small class="muted block">${t('Staff use')}</small>` : '—'),
      csv: (r, x) => x.customers[r.customer_id]?.full_name || nameOf(x.data.employees, r.employee_id, (e) => e.full_name) },
      { label: 'Amount', cell: (r) => html`${money(r.amount)}${+r.admin_fee ? html`<small class="muted block">+ ${money(r.admin_fee)}</small>` : ''}`, cls: 'num', key: 'amount' },
      { label: 'Status', cell: (r, x) => html`${badge(r.status)}${r.invoice_id ? html`<small class="muted block mono">${nameOf(x.data.invoices, r.invoice_id, (i) => i.ref)}</small>` : ''}${r.reconciled_at ? html`<small class="muted block">${t('Reconciled')}</small>` : ''}`, key: 'status' },
    ],
  },

  maintenance: {
    title: 'Garage & maintenance', icon: 'wrench', singular: 'job',
    search: ['description', 'vendor', 'job_type', (r, x) => plate(x.vehicles[r.vehicle_id]), (r, x) => carName(x.vehicles[r.vehicle_id]), (r, x) => nameOf(x.data.suppliers, r.supplier_id)],
    filters: { key: 'status', values: ['open', 'done'] },
    extraFilters: { key: 'kind', values: ['service', 'repair', 'tyres', 'accident', 'inspection', 'other'] },
    fields: [
      { key: 'vehicle_id', label: 'Car', type: 'ref', ref: 'vehicles', req: true, refLabel: carLabel, refFilter: (v) => v.status !== 'retired' },
      { key: 'kind', label: 'Kind', type: 'select', req: true, def: 'service', options: ['service', 'repair', 'tyres', 'accident', 'inspection', 'other'] },
      { key: 'job_type', label: 'Service / defect type', max: 80, list: (d) => [...masters(d, 'service_type'), ...masters(d, 'defect_type')] },
      { key: 'description', label: 'Description', max: 300, span: true },
      { key: 'supplier_id', label: 'Garage', type: 'ref', ref: 'suppliers', refLabel: (s) => s.name, refFilter: active },
      { key: 'vendor', label: 'Vendor (free text)', max: 80 },
      { key: 'employee_id', label: 'Driver who took it', type: 'ref', ref: 'employees', refLabel: (e) => e.full_name, refFilter: active },
      { key: 'cost', label: 'Cost', type: 'money' }, { key: 'odometer', label: 'Odometer', type: 'int' },
      { key: 'opened_on', label: 'Opened', type: 'date', req: true, def: () => new Date().toISOString() },
      { key: 'expected_on', label: 'Expected back', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', req: true, def: 'open', options: ['open', 'done'] },
    ],
    columns: [
      { label: 'Opened', cell: (r) => html`${fmtDate(r.opened_on)}${r.closed_on ? html`<small class="muted block">→ ${fmtDate(r.closed_on)}</small>` : r.expected_on ? html`<small class="muted block">${t('Expected back')} ${fmtDate(r.expected_on)}</small>` : ''}`, key: 'opened_on' },
      { label: 'Car', cell: (r, x) => html`${plateTag(x.vehicles[r.vehicle_id])} <small class="muted">${carName(x.vehicles[r.vehicle_id])}</small>`, csv: (r, x) => carLabel(x.vehicles[r.vehicle_id]) },
      { label: 'Kind', cell: (r) => html`<b>${t(r.kind)}</b>${r.job_type ? html` <small class="muted">${r.job_type}</small>` : ''}<small class="muted block">${r.description}</small>`, key: 'kind' },
      { label: 'Garage', cell: (r, x) => nameOf(x.data.suppliers, r.supplier_id) || r.vendor || '—', csv: (r, x) => nameOf(x.data.suppliers, r.supplier_id) || r.vendor },
      { label: 'Cost', cell: (r) => money(r.cost), cls: 'num', key: 'cost' },
      { label: 'Status', cell: (r) => badge(r.status), key: 'status' },
    ],
  },

  expenses: {
    title: 'Expenses', icon: 'receipt', singular: 'expense', search: ['description', 'category'],
    filters: { key: 'category', values: ['fuel', 'salary', 'rent', 'utilities', 'insurance', 'registration', 'marketing', 'office', 'other'] },
    fields: [
      { key: 'spent_on', label: 'Date', type: 'date', req: true, def: () => new Date().toISOString() },
      { key: 'category', label: 'Category', type: 'select', req: true, def: 'other', options: ['fuel', 'salary', 'rent', 'utilities', 'insurance', 'registration', 'marketing', 'office', 'other'] },
      { key: 'description', label: 'Description', max: 300, span: true },
      { key: 'amount', label: 'Amount', type: 'money', req: true, min: 0.01 }, { key: 'vat', label: 'VAT', type: 'money' },
      { key: 'method', label: 'Method', type: 'select', req: true, def: 'cash', options: PAYMENT_METHODS },
      { key: 'vehicle_id', label: 'Car', type: 'ref', ref: 'vehicles', refLabel: carLabel },
    ],
    columns: [
      { label: 'Date', cell: (r) => fmtDate(r.spent_on), key: 'spent_on' },
      { label: 'Category', cell: (r) => html`<b>${t(r.category)}</b><small class="muted block">${r.description}</small>`, key: 'category' },
      { label: 'Car', cell: (r, x) => (r.vehicle_id ? plateTag(x.vehicles[r.vehicle_id]) : '—'), csv: (r, x) => plate(x.vehicles[r.vehicle_id]) },
      { label: 'Method', cell: (r) => t(r.method), key: 'method' },
      { label: 'Amount', cell: (r) => html`<b>${money(+r.amount + +r.vat)}</b>${+r.vat ? html`<small class="muted block">${t('VAT')} ${money(r.vat)}</small>` : ''}`, cls: 'num', csv: (r) => +r.amount + +r.vat },
    ],
  },

  // ── Setup ──────────────────────────────────────────────────────────────────
  branches: {
    title: 'Branches', icon: 'map-pin', singular: 'branch', search: ['code', 'name', 'address', 'phone'],
    fields: [
      { key: 'code', label: 'Code', req: true, max: 12 }, { key: 'name', label: 'Name', req: true, max: 80 },
      { key: 'phone', label: 'Phone', type: 'tel', max: 30 }, { key: 'address', label: 'Address', max: 200 },
      { key: 'active', label: 'Active', type: 'checkbox', def: true },
    ],
    columns: [
      { label: 'Code', cell: (r) => html`<b class="mono">${r.code}</b>`, key: 'code' }, { label: 'Name', cell: (r) => r.name, key: 'name' },
      { label: 'Address', cell: (r) => r.address || '—', key: 'address' }, { label: 'Phone', cell: (r) => r.phone || '—', key: 'phone' },
      { label: 'Cars here', cell: (r, x) => x.data.vehicles.filter((v) => v.branch_id === r.id && v.status !== 'retired').length, cls: 'num' },
      { label: 'Status', cell: (r) => yesNo(r.active), csv: (r) => (r.active === false ? 'inactive' : 'active') },
    ],
  },
  departments: {
    title: 'Departments', icon: 'building', singular: 'department', search: ['name'],
    fields: [{ key: 'name', label: 'Name', req: true, max: 80 }, { key: 'active', label: 'Active', type: 'checkbox', def: true }],
    columns: [
      { label: 'Name', cell: (r) => html`<b>${r.name}</b>`, key: 'name' },
      { label: 'Employees', cell: (r, x) => x.data.employees.filter((e) => e.department_id === r.id).length, cls: 'num' },
      { label: 'Status', cell: (r) => yesNo(r.active), csv: (r) => (r.active === false ? 'inactive' : 'active') },
    ],
  },
  masters: {
    title: 'Masters', icon: 'list', singular: 'value', search: ['value', 'parent', 'kind'],
    filters: { key: 'kind', values: MASTER_KINDS },
    fields: [
      { key: 'kind', label: 'List', type: 'select', req: true, def: 'make', options: MASTER_KINDS },
      { key: 'value', label: 'Value', req: true, max: 80 },
      { key: 'parent', label: 'Make', max: 80, list: (d) => masters(d, 'make'), show: (v) => v.kind === 'model', help: 'Which make this model belongs to.' },
      { key: 'sort', label: 'Order', type: 'int', def: 0 },
      { key: 'active', label: 'Active', type: 'checkbox', def: true },
    ],
    fromForm: (v) => ({ ...v, parent: v.kind === 'model' ? (v.parent || '') : '' }),
    columns: [
      { label: 'List', cell: (r) => badge('booked', t(r.kind)), key: 'kind' },
      { label: 'Value', cell: (r) => html`<b>${r.value}</b>${r.parent ? html` <small class="muted">${r.parent}</small>` : ''}`, key: 'value' },
      { label: 'Order', cell: (r) => r.sort, cls: 'num', key: 'sort' },
      { label: 'Status', cell: (r) => yesNo(r.active), csv: (r) => (r.active === false ? 'inactive' : 'active') },
    ],
  },

  // ── Accounts ───────────────────────────────────────────────────────────────
  suppliers: {
    title: 'Suppliers', icon: 'truck', singular: 'supplier', search: ['code', 'name', 'contact_person', 'phone', 'email', 'trn'],
    filters: { key: 'category', values: ['garage', 'parts', 'tyres', 'insurance', 'leasing', 'fuel', 'registration', 'other'] },
    fields: [
      { key: 'name', label: 'Name', req: true, max: 120 }, { key: 'code', label: 'Supplier code', max: 20, help: 'Leave empty to number it automatically.' },
      { key: 'category', label: 'Category', type: 'select', req: true, def: 'garage', options: ['garage', 'parts', 'tyres', 'insurance', 'leasing', 'fuel', 'registration', 'other'] },
      { key: 'contact_person', label: 'Contact person', max: 120 }, { key: 'phone', label: 'Phone', type: 'tel', max: 30 },
      { key: 'email', label: 'Email', type: 'email', max: 120 }, { key: 'trn', label: 'TRN', max: 20 },
      { key: 'address', label: 'Address', max: 200 }, { key: 'active', label: 'Active', type: 'checkbox', def: true },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    fromForm: (v) => { const out = { ...v }; if (!out.code) delete out.code; return out; },
    columns: [
      { label: 'Code', cell: (r) => html`<span class="mono">${r.code}</span>`, key: 'code' },
      { label: 'Name', cell: (r) => html`<b>${r.name}</b><small class="muted block">${t(r.category)}${r.contact_person ? ' · ' + r.contact_person : ''}</small>`, key: 'name' },
      { label: 'Phone', cell: (r) => r.phone || '—', key: 'phone' },
      { label: 'Payable', cell: (r, x) => (x.supBalance ? money(x.supBalance(r.id)) : '—'), cls: 'num', csv: (r, x) => x.supBalance?.(r.id) },
      { label: 'Status', cell: (r) => yesNo(r.active), csv: (r) => (r.active === false ? 'inactive' : 'active') },
    ],
  },
  employees: {
    title: 'Employees', icon: 'id-card', singular: 'employee',
    search: ['code', 'full_name', 'designation', 'phone', 'email', 'emirates_id', 'passport_number', 'license_number', (r, x) => nameOf(x.data.departments, r.department_id)],
    fields: [
      { key: 'full_name', label: 'Full name', req: true, max: 120 }, { key: 'code', label: 'Employee code', max: 20, help: 'Leave empty to number it automatically.' },
      { key: 'designation', label: 'Designation', max: 80 },
      { key: 'department_id', label: 'Department', type: 'ref', ref: 'departments', refLabel: (d) => d.name, refFilter: active },
      { key: 'branch_id', label: 'Branch', type: 'ref', ref: 'branches', refLabel: (b) => b.name, refFilter: active },
      { key: 'phone', label: 'Phone', type: 'tel', max: 30 }, { key: 'email', label: 'Email', type: 'email', max: 120 },
      { key: 'emirates_id', label: 'Emirates ID', max: 40 }, { key: 'passport_number', label: 'Passport no.', max: 40 },
      { key: 'license_number', label: 'Licence no.', max: 40 }, { key: 'license_expiry', label: 'Licence expiry', type: 'date' },
      { key: 'joined_on', label: 'Joined on', type: 'date' }, { key: 'active', label: 'Active', type: 'checkbox', def: true },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    fromForm: (v) => { const out = { ...v }; if (!out.code) delete out.code; return out; },
    columns: [
      { label: 'Code', cell: (r) => html`<span class="mono">${r.code}</span>`, key: 'code' },
      { label: 'Employee', cell: (r, x) => html`<b>${r.full_name}</b><small class="muted block">${[r.designation, nameOf(x.data.departments, r.department_id)].filter(Boolean).join(' · ')}</small>`, csv: (r) => r.full_name },
      { label: 'Phone', cell: (r) => r.phone || '—', key: 'phone' },
      { label: 'Licence expiry', cell: (r) => expiry(r.license_expiry), key: 'license_expiry' },
      { label: 'Balance', cell: (r, x) => (x.empBalance ? money(x.empBalance(r.id)) : '—'), cls: 'num', csv: (r, x) => x.empBalance?.(r.id) },
      { label: 'Status', cell: (r) => yesNo(r.active), csv: (r) => (r.active === false ? 'inactive' : 'active') },
    ],
  },

  // ── Tariffs ────────────────────────────────────────────────────────────────
  tariff_groups: {
    title: 'Tariff groups', icon: 'layers', singular: 'group', search: ['name', 'description'],
    fields: [{ key: 'name', label: 'Name', req: true, max: 80 }, { key: 'description', label: 'Description', max: 300, span: true },
      { key: 'active', label: 'Active', type: 'checkbox', def: true }],
    columns: [
      { label: 'Name', cell: (r) => html`<b>${r.name}</b><small class="muted block">${r.description}</small>`, key: 'name' },
      { label: 'Cars', cell: (r, x) => x.data.vehicles.filter((v) => v.tariff_group_id === r.id && v.status !== 'retired').length, cls: 'num' },
      { label: 'Tariff cards', cell: (r, x) => x.data.tariff_cards.filter((c) => c.tariff_group_id === r.id).length, cls: 'num' },
      { label: 'Status', cell: (r) => yesNo(r.active), csv: (r) => (r.active === false ? 'inactive' : 'active') },
    ],
  },
  tariff_cards: {
    title: 'Tariff cards', icon: 'tag', singular: 'card', search: ['name', 'notes', (r, x) => nameOf(x.data.tariff_groups, r.tariff_group_id), (r, x) => x.customers[r.customer_id]?.full_name],
    fields: [
      { key: 'name', label: 'Name', req: true, max: 80 },
      { key: 'tariff_group_id', label: 'Tariff group', type: 'ref', ref: 'tariff_groups', req: true, refLabel: (g) => g.name, refFilter: active },
      { key: 'customer_id', label: 'Allocated to customer', type: 'ref', ref: 'customers', refLabel: (c) => `${c.code} · ${c.full_name}`, help: 'Leave empty for the standard (walk-in) price of the group.' },
      { key: 'valid_from', label: 'Valid from', type: 'date', req: true, def: () => new Date().toISOString() }, { key: 'valid_to', label: 'Valid to', type: 'date' },
      { key: 'daily_rate', label: 'Daily rate', type: 'money', req: true }, { key: 'weekly_rate', label: 'Weekly rate', type: 'money' },
      { key: 'monthly_rate', label: 'Monthly rate', type: 'money' },
      { key: 'km_per_day', label: 'Km allowed per day', type: 'int', max: 10000, def: 0, help: '0 = unlimited.' },
      { key: 'extra_km_rate', label: 'Extra km rate', type: 'money' },
      { key: 'active', label: 'Active', type: 'checkbox', def: true }, { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    columns: [
      { label: 'Name', cell: (r, x) => html`<b>${r.name}</b><small class="muted block">${nameOf(x.data.tariff_groups, r.tariff_group_id)}</small>`, key: 'name' },
      { label: 'Allocated to', cell: (r, x) => (r.customer_id ? html`${badge('credit', t('Corporate'))} ${x.customers[r.customer_id]?.full_name}` : badge('cash', t('Standard'))), csv: (r, x) => x.customers[r.customer_id]?.full_name || 'standard' },
      { label: 'Valid', cell: (r) => html`${fmtDate(r.valid_from)} → ${r.valid_to ? fmtDate(r.valid_to) : '∞'}`, csv: (r) => `${r.valid_from} - ${r.valid_to || ''}` },
      { label: 'Daily rate', cell: (r) => html`<b>${money(r.daily_rate)}</b><small class="muted block">${+r.weekly_rate ? `${money(r.weekly_rate)}/wk` : ''} ${+r.monthly_rate ? `${money(r.monthly_rate)}/mo` : ''}</small>`, cls: 'num', key: 'daily_rate' },
      { label: 'Km', cell: (r) => (+r.km_per_day ? html`${r.km_per_day}/d<small class="muted block">+${money(r.extra_km_rate)}/km</small>` : t('Unlimited')), csv: (r) => r.km_per_day },
      { label: 'Status', cell: (r) => yesNo(r.active), csv: (r) => (r.active === false ? 'inactive' : 'active') },
    ],
  },

  // ── Movements ──────────────────────────────────────────────────────────────
  movements: {
    title: 'Staff & custody movements', icon: 'route', singular: 'movement',
    search: ['ref', 'purpose', 'notes', (r, x) => plate(x.vehicles[r.vehicle_id]), (r, x) => nameOf(x.data.employees, r.employee_id, (e) => e.full_name)],
    filters: { key: 'status', values: ['open', 'closed'] },
    extraFilters: { key: 'kind', values: ['nrm', 'custody'] },
    fields: [
      { key: 'kind', label: 'Type', type: 'select', req: true, def: 'nrm', options: [['nrm', 'Staff use (NRM)'], ['custody', 'Custody']] },
      { key: 'vehicle_id', label: 'Car', type: 'ref', ref: 'vehicles', req: true, refLabel: carLabel, refFilter: (v) => v.status === 'available' },
      { key: 'employee_id', label: 'Employee', type: 'ref', ref: 'employees', req: true, refLabel: (e) => `${e.code} · ${e.full_name}`, refFilter: active },
      { key: 'purpose', label: 'Purpose', max: 300, span: true },
      { key: 'out_at', label: 'Out', type: 'datetime', req: true, def: () => new Date().toISOString() },
      { key: 'expected_in_at', label: 'Expected back', type: 'datetime' },
      { key: 'odometer_out', label: 'Odometer out', type: 'int', help: 'Empty = the car\'s current odometer.' },
      { key: 'fuel_out', label: 'Fuel out', type: 'select', req: true, def: 'full', options: FUEL },
      { key: 'from_branch_id', label: 'From branch', type: 'ref', ref: 'branches', refLabel: (b) => b.name, refFilter: active },
      { key: 'to_branch_id', label: 'To branch', type: 'ref', ref: 'branches', refLabel: (b) => b.name, refFilter: active },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    editFields: () => RESOURCES.movements.fields.filter((f) => !['kind', 'vehicle_id', 'odometer_out', 'fuel_out', 'out_at'].includes(f.key)),
    columns: [
      { label: 'Reference', cell: (r) => html`<b class="mono">${r.ref}</b><small class="muted block">${t(r.kind === 'nrm' ? 'Staff use (NRM)' : 'Custody')}</small>`, key: 'ref' },
      { label: 'Car', cell: (r, x) => html`${plateTag(x.vehicles[r.vehicle_id])}<small class="muted block">${carName(x.vehicles[r.vehicle_id])}</small>`, csv: (r, x) => carLabel(x.vehicles[r.vehicle_id]) },
      { label: 'Employee', cell: (r, x) => html`<b>${nameOf(x.data.employees, r.employee_id, (e) => e.full_name)}</b><small class="muted block">${r.purpose}</small>`, csv: (r, x) => nameOf(x.data.employees, r.employee_id, (e) => e.full_name) },
      { label: 'Out', cell: (r) => html`${fmtDateTime(r.out_at)}<small class="muted block">${r.in_at ? `→ ${fmtDateTime(r.in_at)}` : r.expected_in_at ? `${t('Expected back')} ${fmtDateTime(r.expected_in_at)}` : ''}</small>`, key: 'out_at' },
      { label: 'Km', cell: (r) => (r.odometer_in != null ? `${(r.odometer_in - r.odometer_out).toLocaleString()} km` : html`<small class="muted">${(+r.odometer_out || 0).toLocaleString()} →</small>`), cls: 'num', csv: (r) => (r.odometer_in != null ? r.odometer_in - r.odometer_out : '') },
      { label: 'Status', cell: (r) => badge(r.status === 'open' && r.expected_in_at && new Date(r.expected_in_at) < new Date() ? 'overdue' : r.status, r.status === 'open' && r.expected_in_at && new Date(r.expected_in_at) < new Date() ? t('Overdue') : null), key: 'status' },
    ],
  },

  // ── Vouchers ───────────────────────────────────────────────────────────────
  invoices: {
    title: 'Invoices', icon: 'file-text', singular: 'invoice', canEditRow: (r) => r.status === 'open',
    search: ['ref', 'description', (r, x) => x.customers[r.customer_id]?.full_name, (r, x) => x.customers[r.customer_id]?.code, (r, x) => x.rentals[r.rental_id]?.ref],
    filters: { key: 'status', values: ['open', 'void'] },
    extraFilters: { key: 'kind', values: ['fines', 'damage', 'fuel', 'rental', 'other'] },
    fields: [
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', req: true, refLabel: (c) => `${c.code} · ${c.full_name}` },
      { key: 'rental_id', label: 'Rental', type: 'ref', ref: 'rentals', refLabel: (r) => `${r.ref} · ${t(r.status)}`, refFilter: (r) => r.status !== 'cancelled', help: 'Optional. The invoice is then added to that agreement\'s balance.' },
      { key: 'kind', label: 'Kind', type: 'select', req: true, def: 'other', options: ['fines', 'damage', 'fuel', 'rental', 'other'] },
      { key: 'issued_on', label: 'Date', type: 'date', req: true, def: () => new Date().toISOString() }, { key: 'due_on', label: 'Due on', type: 'date' },
      { key: 'description', label: 'Description', max: 300, span: true },
      { key: 'amount', label: 'Amount (excl. VAT)', type: 'money', req: true }, { key: 'vat', label: 'VAT', type: 'money' },
    ],
    columns: [
      { label: 'Reference', cell: (r) => html`<b class="mono">${r.ref}</b>`, key: 'ref' },
      { label: 'Date', cell: (r) => html`${fmtDate(r.issued_on)}${r.due_on ? html`<small class="muted block">${t('Due on')} ${fmtDate(r.due_on)}</small>` : ''}`, key: 'issued_on' },
      { label: 'Customer', cell: (r, x) => html`${x.customers[r.customer_id]?.full_name || '—'}${r.rental_id ? html`<small class="block"><a class="mono" href="#/rentals?open=${r.rental_id}">${x.rentals[r.rental_id]?.ref}</a></small>` : ''}`, csv: (r, x) => x.customers[r.customer_id]?.full_name },
      { label: 'Kind', cell: (r) => html`<b>${t(r.kind)}</b><small class="muted block">${r.description}</small>`, key: 'kind' },
      { label: 'Total', cell: (r) => html`<b>${money(+r.amount + +r.vat)}</b>${+r.vat ? html`<small class="muted block">${t('VAT')} ${money(r.vat)}</small>` : ''}`, cls: 'num', csv: (r) => +r.amount + +r.vat },
      { label: 'Status', cell: (r) => badge(r.status), key: 'status' },
    ],
  },
  bills: {
    title: 'Supplier bills', icon: 'scroll', singular: 'bill',
    search: ['ref', 'bill_no', 'description', (r, x) => nameOf(x.data.suppliers, r.supplier_id)],
    filters: { key: 'status', values: ['open', 'void'] },
    extraFilters: { key: 'category', values: ['maintenance', 'parts', 'tyres', 'insurance', 'registration', 'leasing', 'fuel', 'rent', 'utilities', 'marketing', 'office', 'other'] },
    fields: [
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'suppliers', req: true, refLabel: (s) => `${s.code} · ${s.name}`, refFilter: active },
      { key: 'bill_no', label: 'Supplier invoice no.', max: 40 },
      { key: 'bill_date', label: 'Date', type: 'date', req: true, def: () => new Date().toISOString() }, { key: 'due_date', label: 'Due on', type: 'date' },
      { key: 'category', label: 'Category', type: 'select', req: true, def: 'maintenance', options: ['maintenance', 'parts', 'tyres', 'insurance', 'registration', 'leasing', 'fuel', 'rent', 'utilities', 'marketing', 'office', 'other'] },
      { key: 'description', label: 'Description', max: 300, span: true },
      { key: 'amount', label: 'Amount (excl. VAT)', type: 'money', req: true }, { key: 'vat', label: 'VAT', type: 'money' },
      { key: 'vehicle_id', label: 'Car', type: 'ref', ref: 'vehicles', refLabel: carLabel },
      { key: 'maintenance_id', label: 'Garage job', type: 'ref', ref: 'maintenance', refLabel: (m) => `${fmtDate(m.opened_on)} · ${t(m.kind)} · ${m.description}`.slice(0, 80) },
    ],
    editFields: () => [...RESOURCES.bills.fields, { key: 'status', label: 'Status', type: 'select', req: true, options: ['open', 'void'] }],
    columns: [
      { label: 'Reference', cell: (r) => html`<b class="mono">${r.ref}</b><small class="muted block">${r.bill_no}</small>`, key: 'ref' },
      { label: 'Date', cell: (r) => html`${fmtDate(r.bill_date)}${r.due_date ? html`<small class="muted block">${t('Due on')} ${fmtDate(r.due_date)}</small>` : ''}`, key: 'bill_date' },
      { label: 'Supplier', cell: (r, x) => html`<b>${nameOf(x.data.suppliers, r.supplier_id)}</b><small class="muted block">${t(r.category)} · ${r.description}</small>`, csv: (r, x) => nameOf(x.data.suppliers, r.supplier_id) },
      { label: 'Car', cell: (r, x) => (r.vehicle_id ? plateTag(x.vehicles[r.vehicle_id]) : '—'), csv: (r, x) => plate(x.vehicles[r.vehicle_id]) },
      { label: 'Total', cell: (r) => html`<b>${money(+r.amount + +r.vat)}</b>${+r.vat ? html`<small class="muted block">${t('VAT')} ${money(r.vat)}</small>` : ''}`, cls: 'num', csv: (r) => +r.amount + +r.vat },
      { label: 'Status', cell: (r) => badge(r.status), key: 'status' },
    ],
  },
  vouchers: {
    title: 'Payment & receipt vouchers', icon: 'banknote', singular: 'voucher',
    search: ['ref', 'party_name', 'note', 'cheque_no', (r, x) => nameOf(x.data.suppliers, r.supplier_id), (r, x) => nameOf(x.data.employees, r.employee_id, (e) => e.full_name)],
    filters: { key: 'direction', values: ['payment', 'receipt'] },
    extraFilters: { key: 'party_type', values: ['supplier', 'employee', 'other'] },
    fields: [
      { key: 'direction', label: 'Voucher', type: 'select', req: true, def: 'payment', options: [['payment', 'Payment voucher (money out)'], ['receipt', 'Receipt voucher (money in)']] },
      { key: 'party_type', label: 'Paid to / received from', type: 'select', req: true, def: 'supplier', options: [['supplier', 'Supplier'], ['employee', 'Employee'], ['other', 'Other']] },
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'suppliers', req: true, refLabel: (s) => `${s.code} · ${s.name}`, show: (v) => v.party_type === 'supplier' },
      { key: 'employee_id', label: 'Employee', type: 'ref', ref: 'employees', req: true, refLabel: (e) => `${e.code} · ${e.full_name}`, show: (v) => v.party_type === 'employee' },
      { key: 'party_name', label: 'Name', req: true, max: 120, show: (v) => v.party_type === 'other' },
      { key: 'purpose', label: 'Purpose', type: 'select', req: true, def: 'bill', options: ['bill', 'advance', 'salary', 'recovery', 'reimbursement', 'refund', 'other'] },
      { key: 'method', label: 'Method', type: 'select', req: true, def: 'bank', options: PAYMENT_METHODS },
      { key: 'cheque_no', label: 'Cheque / transfer no.', max: 40 },
      { key: 'amount', label: 'Amount', type: 'money', req: true, min: 0.01 },
      { key: 'paid_on', label: 'Date', type: 'date', req: true, def: () => new Date().toISOString() },
      { key: 'note', label: 'Notes', type: 'textarea', span: true },
    ],
    columns: [
      { label: 'Reference', cell: (r) => html`<b class="mono">${r.ref}</b>`, key: 'ref' },
      { label: 'Date', cell: (r) => fmtDate(r.paid_on), key: 'paid_on' },
      { label: 'Party', cell: (r, x) => html`<b>${r.party_type === 'supplier' ? nameOf(x.data.suppliers, r.supplier_id) : r.party_type === 'employee' ? nameOf(x.data.employees, r.employee_id, (e) => e.full_name) : r.party_name}</b><small class="muted block">${t(r.party_type)} · ${t(r.purpose)}</small>`,
        csv: (r, x) => (r.party_type === 'supplier' ? nameOf(x.data.suppliers, r.supplier_id) : r.party_type === 'employee' ? nameOf(x.data.employees, r.employee_id, (e) => e.full_name) : r.party_name) },
      { label: 'Method', cell: (r) => html`${t(r.method)}${r.cheque_no ? html`<small class="muted block">${r.cheque_no}</small>` : ''}`, key: 'method' },
      { label: 'Amount', cell: (r) => html`<b class="${r.direction === 'payment' ? 'neg' : 'pos'}">${r.direction === 'payment' ? '−' : '+'} ${money(r.amount)}</b>`, cls: 'num', key: 'amount' },
    ],
  },
};

const memo = (fn) => { const m = new Map(); return (id) => { if (!m.has(id)) m.set(id, fn(id)); return m.get(id); }; };
export const lookups = (data) => ({
  data, settings: data.settings,
  vehicles: byId(data.vehicles), customers: byId(data.customers), rentals: byId(data.rentals),
  balances: byId((data.rental_balances || []).map((b) => ({ ...b, id: b.rental_id }))),
  custBalance: memo((id) => lastBalance(customerEntries(id, data))),
  supBalance: memo((id) => lastBalance(supplierEntries(id, data))),
  empBalance: memo((id) => lastBalance(employeeEntries(id, data))),
});
export { carLabel, nameOf };
