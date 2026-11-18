// One definition per business object: its form fields and its list columns. The generic list view
// (views/records.js) turns these into search, table, CSV export, create/edit/delete — the same way everywhere.
import { html } from './util.js';
import { plate, carName, fmtDate, fmtDateTime, money, daysUntil, byId } from './util.js';
import { badge, plateTag } from './ui.js';
import { t } from './i18n.js';

const carLabel = (v) => `${plate(v)} · ${carName(v)}`;
const expiry = (d) => {
  if (!d) return '—';
  const n = daysUntil(d);
  const cls = n < 0 ? 'red' : n <= 30 ? 'amber' : '';
  return html`<span class="exp ${cls}">${fmtDate(d)}</span>`;
};

export const RESOURCES = {
  vehicles: {
    title: 'Fleet', icon: 'car', singular: 'car', search: ['plate_number', 'plate_code', 'make', 'model', 'color'],
    filters: { key: 'status', values: ['available', 'rented', 'maintenance', 'retired'] },
    fields: [
      { key: 'plate_code', label: 'Plate code', max: 4 }, { key: 'plate_number', label: 'Plate number', req: true, max: 10 },
      { key: 'emirate', label: 'Emirate', type: 'select', req: true, def: 'Dubai', options: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'] },
      { key: 'make', label: 'Make', req: true, max: 40 }, { key: 'model', label: 'Model', req: true, max: 60 },
      { key: 'year', label: 'Year', type: 'int', min: 1990, max: 2100, def: () => new Date().getFullYear() },
      { key: 'category', label: 'Category', type: 'select', req: true, def: 'sedan', options: ['economy', 'sedan', 'suv', 'sports', 'luxury', 'van'] },
      { key: 'color', label: 'Color', max: 30 },
      { key: 'daily_rate', label: 'Daily rate', type: 'money', req: true }, { key: 'weekly_rate', label: 'Weekly rate', type: 'money' },
      { key: 'monthly_rate', label: 'Monthly rate', type: 'money' }, { key: 'odometer', label: 'Odometer', type: 'int', def: 0 },
      { key: 'insurance_expiry', label: 'Insurance expiry', type: 'date' }, { key: 'registration_expiry', label: 'Registration expiry', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', req: true, def: 'available', options: ['available', 'retired'],
        help: 'Rented and maintenance are set automatically by rentals and maintenance jobs.' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    columns: [
      { label: 'Plate', cell: (r) => plateTag(r), csv: plate },
      { label: 'Car', cell: (r) => html`<b>${carName(r)}</b><small class="muted block">${r.year || ''} · ${t(r.category)}</small>`, csv: carName },
      { label: 'Daily rate', cell: (r) => money(r.daily_rate), cls: 'num', key: 'daily_rate' },
      { label: 'Odometer', cell: (r) => `${(+r.odometer || 0).toLocaleString()} km`, cls: 'num', key: 'odometer' },
      { label: 'Insurance expiry', cell: (r) => expiry(r.insurance_expiry), key: 'insurance_expiry' },
      { label: 'Registration expiry', cell: (r) => expiry(r.registration_expiry), key: 'registration_expiry' },
      { label: 'Status', cell: (r) => badge(r.status), key: 'status' },
    ],
    // When editing, keep the automatic statuses selectable so the form does not silently change them.
    editFields: (row) => RESOURCES.vehicles.fields.map((f) => (f.key === 'status' && ['rented', 'maintenance'].includes(row.status)
      ? { ...f, options: [row.status] } : f)),
  },

  customers: {
    title: 'Customers', icon: 'users', singular: 'customer', search: ['full_name', 'phone', 'email', 'id_number', 'license_number', 'nationality'],
    filters: { key: 'kind', values: ['individual', 'company'] },
    fields: [
      { key: 'full_name', label: 'Full name', req: true, max: 120 },
      { key: 'kind', label: 'Type', type: 'select', req: true, def: 'individual', options: ['individual', 'company'] },
      { key: 'phone', label: 'Phone', type: 'tel', max: 30 }, { key: 'email', label: 'Email', type: 'email', max: 120 },
      { key: 'nationality', label: 'Nationality', max: 40 }, { key: 'id_number', label: 'ID / Passport no.', max: 40 },
      { key: 'id_expiry', label: 'ID expiry', type: 'date' }, { key: 'license_number', label: 'Licence no.', max: 40 },
      { key: 'license_expiry', label: 'Licence expiry', type: 'date' }, { key: 'address', label: 'Address', max: 200 },
      { key: 'blacklisted', label: 'Blacklisted', type: 'checkbox', span: true },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
    ],
    columns: [
      { label: 'Customer', cell: (r) => html`<b>${r.full_name}</b> ${r.blacklisted ? badge('disputed', t('Blacklisted')) : ''}<small class="muted block">${t(r.kind)}${r.nationality ? ' · ' + r.nationality : ''}</small>`, csv: (r) => r.full_name },
      { label: 'Phone', cell: (r) => r.phone || '—', key: 'phone' },
      { label: 'ID / Passport no.', cell: (r) => html`${r.id_number || '—'}<small class="muted block">${r.id_expiry ? fmtDate(r.id_expiry) : ''}</small>`, key: 'id_number' },
      { label: 'Licence expiry', cell: (r) => expiry(r.license_expiry), key: 'license_expiry' },
    ],
  },

  payments: {
    title: 'Payments', icon: 'wallet', singular: 'payment', permEdit: 'edit',
    search: ['ref', 'note', (r, x) => x.customers[r.customer_id]?.full_name, (r, x) => x.rentals[r.rental_id]?.ref],
    filters: { key: 'kind', values: ['payment', 'deposit', 'refund', 'deposit_return'] },
    fields: [
      { key: 'rental_id', label: 'Rental', type: 'ref', ref: 'rentals', refLabel: (r) => `${r.ref} · ${t(r.status)}`, refFilter: (r) => r.status !== 'cancelled' },
      { key: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', req: true, refLabel: (c) => c.full_name, help: 'Filled from the rental when one is picked.' },
      { key: 'kind', label: 'Kind', type: 'select', req: true, def: 'payment', options: ['payment', 'deposit', 'refund', 'deposit_return'] },
      { key: 'method', label: 'Method', type: 'select', req: true, def: 'cash', options: ['cash', 'card', 'bank', 'cheque'] },
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
    title: 'Fines & Salik', icon: 'siren', singular: 'fine',
    search: ['reference', 'plate_number', 'location', (r, x) => x.customers[r.customer_id]?.full_name],
    filters: { key: 'status', values: ['new', 'charged', 'company', 'unmatched', 'paid', 'disputed'] },
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', req: true, def: 'salik', options: ['salik', 'traffic', 'parking', 'other'] },
      { key: 'reference', label: 'Reference', max: 60 },
      { key: 'plate_code', label: 'Plate code', max: 4 }, { key: 'plate_number', label: 'Plate number', req: true, max: 10 },
      { key: 'occurred_at', label: 'Occurred', type: 'datetime', req: true }, { key: 'location', label: 'Location', max: 120 },
      { key: 'amount', label: 'Amount', type: 'money', req: true }, { key: 'admin_fee', label: 'Admin fee', type: 'money' },
      { key: 'status', label: 'Status', type: 'select', req: true, def: 'new', options: ['new', 'charged', 'company', 'unmatched', 'paid', 'disputed'] },
    ],
    columns: [
      { label: 'Occurred', cell: (r) => fmtDateTime(r.occurred_at), key: 'occurred_at' },
      { label: 'Kind', cell: (r) => html`<b>${t(r.kind)}</b><small class="muted block mono">${r.reference}</small>`, key: 'kind' },
      { label: 'Plate', cell: (r) => plateTag(r), csv: plate },
      { label: 'Customer', cell: (r, x) => (r.customer_id ? html`${x.customers[r.customer_id]?.full_name}<small class="muted block mono">${x.rentals[r.rental_id]?.ref || ''}</small>` : '—'), csv: (r, x) => x.customers[r.customer_id]?.full_name },
      { label: 'Amount', cell: (r) => html`${money(r.amount)}${+r.admin_fee ? html`<small class="muted block">+ ${money(r.admin_fee)}</small>` : ''}`, cls: 'num', key: 'amount' },
      { label: 'Status', cell: (r) => badge(r.status), key: 'status' },
    ],
  },

  maintenance: {
    title: 'Maintenance', icon: 'wrench', singular: 'job',
    search: ['description', 'vendor', (r, x) => plate(x.vehicles[r.vehicle_id]), (r, x) => carName(x.vehicles[r.vehicle_id])],
    filters: { key: 'status', values: ['open', 'done'] },
    fields: [
      { key: 'vehicle_id', label: 'Car', type: 'ref', ref: 'vehicles', req: true, refLabel: carLabel, refFilter: (v) => v.status !== 'retired' },
      { key: 'kind', label: 'Kind', type: 'select', req: true, def: 'service', options: ['service', 'repair', 'tyres', 'accident', 'inspection', 'other'] },
      { key: 'description', label: 'Description', max: 300, span: true }, { key: 'vendor', label: 'Vendor', max: 80 },
      { key: 'cost', label: 'Cost', type: 'money' }, { key: 'odometer', label: 'Odometer', type: 'int' },
      { key: 'opened_on', label: 'Opened', type: 'date', req: true, def: () => new Date().toISOString() },
      { key: 'status', label: 'Status', type: 'select', req: true, def: 'open', options: ['open', 'done'] },
    ],
    columns: [
      { label: 'Opened', cell: (r) => fmtDate(r.opened_on), key: 'opened_on' },
      { label: 'Car', cell: (r, x) => html`${plateTag(x.vehicles[r.vehicle_id])} <small class="muted">${carName(x.vehicles[r.vehicle_id])}</small>`, csv: (r, x) => carLabel(x.vehicles[r.vehicle_id]) },
      { label: 'Kind', cell: (r) => html`<b>${t(r.kind)}</b><small class="muted block">${r.description}</small>`, key: 'kind' },
      { label: 'Vendor', cell: (r) => r.vendor || '—', key: 'vendor' },
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
      { key: 'method', label: 'Method', type: 'select', req: true, def: 'cash', options: ['cash', 'card', 'bank', 'cheque'] },
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
};

export const lookups = (data) => ({
  vehicles: byId(data.vehicles), customers: byId(data.customers), rentals: byId(data.rentals), balances: byId((data.rental_balances || []).map((b) => ({ ...b, id: b.rental_id }))),
});
export { carLabel };
