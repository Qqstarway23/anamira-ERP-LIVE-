// Statements of account and age analysis for customers (receivable), suppliers (payable) and employees.
// Pure functions over the loaded data, so the same numbers appear on screens, statements and reports.
import { num, round2 } from './util.js';

const day = (d) => (d ? String(d).slice(0, 10) : '');
const upTo = (asOf) => (e) => !asOf || day(e.date) <= asOf;

// sign 1: balance = debits - credits (customer, employee); sign -1: credits - debits (supplier: amount payable).
function withRunning(entries, sign = 1) {
  let bal = 0;
  return entries.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.order - b.order)
    .map((e) => { bal = round2(bal + sign * (num(e.debit) - num(e.credit))); return { ...e, balance: bal }; });
}

// Customer: debit = what the customer owes (agreements, invoices, refunds paid out); credit = receipts.
export function customerEntries(customerId, d, asOf) {
  const out = [];
  for (const r of d.rentals || []) {
    if (r.customer_id !== customerId || !['active', 'returned'].includes(r.status)) continue;
    out.push({ date: r.start_at, ref: r.ref, kind: 'rental', text: `${r.days} d`, debit: num(r.total), credit: 0, link: `#/rentals?open=${r.id}`, order: 1 });
  }
  for (const i of d.invoices || []) {
    if (i.customer_id !== customerId || i.status !== 'open') continue;
    out.push({ date: i.issued_on, ref: i.ref, kind: 'invoice', text: i.description, debit: round2(num(i.amount) + num(i.vat)), credit: 0, order: 2 });
  }
  for (const p of d.payments || []) {
    if (p.customer_id !== customerId) continue;
    if (p.kind === 'payment') out.push({ date: p.paid_at, ref: p.ref, kind: 'receipt', text: p.method, debit: 0, credit: num(p.amount), order: 3 });
    if (p.kind === 'refund') out.push({ date: p.paid_at, ref: p.ref, kind: 'refund', text: p.method, debit: num(p.amount), credit: 0, order: 4 });
  }
  return withRunning(out.filter(upTo(asOf)));
}
export function depositHeld(customerId, d, asOf) {
  return round2((d.payments || []).filter((p) => p.customer_id === customerId && (!asOf || day(p.paid_at) <= asOf))
    .reduce((a, p) => a + (p.kind === 'deposit' ? num(p.amount) : p.kind === 'deposit_return' ? -num(p.amount) : 0), 0));
}

// Supplier: credit = bills (we owe them); debit = payment vouchers. Balance shown as amount payable.
export function supplierEntries(supplierId, d, asOf) {
  const out = [];
  for (const b of d.bills || []) {
    if (b.supplier_id !== supplierId || b.status !== 'open') continue;
    out.push({ date: b.bill_date, ref: b.ref, kind: 'bill', text: [b.bill_no, b.description].filter(Boolean).join(' · '), debit: 0, credit: round2(num(b.amount) + num(b.vat)), order: 1 });
  }
  for (const v of d.vouchers || []) {
    if (v.party_type !== 'supplier' || v.supplier_id !== supplierId) continue;
    const pay = v.direction === 'payment';
    out.push({ date: v.paid_on, ref: v.ref, kind: pay ? 'payment' : 'receipt', text: [v.purpose, v.note].filter(Boolean).join(' · '), debit: pay ? num(v.amount) : 0, credit: pay ? 0 : num(v.amount), order: 2 });
  }
  return withRunning(out.filter(upTo(asOf)), -1);
}

// Employee: debit = advances paid and fines/tolls incurred during staff use; credit = recoveries received.
// Salary and reimbursements are company costs, so they are listed but do not change the balance.
export function employeeEntries(employeeId, d, asOf) {
  const out = [];
  for (const f of d.fines || []) {
    if (f.employee_id !== employeeId || f.status !== 'employee') continue;
    out.push({ date: f.occurred_at, ref: f.reference || f.kind, kind: f.kind, text: [f.location, f.description].filter(Boolean).join(' · '), debit: num(f.amount), credit: 0, order: 1 });
  }
  for (const v of d.vouchers || []) {
    if (v.party_type !== 'employee' || v.employee_id !== employeeId) continue;
    const memo = v.direction === 'payment' && ['salary', 'reimbursement'].includes(v.purpose);
    out.push({ date: v.paid_on, ref: v.ref, kind: v.purpose, text: v.note, memo,
      debit: !memo && v.direction === 'payment' ? num(v.amount) : 0, credit: v.direction === 'receipt' ? num(v.amount) : 0,
      memoAmount: memo ? num(v.amount) : 0, order: 2 });
  }
  return withRunning(out.filter(upTo(asOf)));
}

export const lastBalance = (entries) => (entries.length ? entries[entries.length - 1].balance : 0);

// Age analysis: payments settle the oldest open items first (FIFO). Returns the open amount per age bucket.
export const BUCKETS = [['0-30', 0, 30], ['31-60', 31, 60], ['61-90', 61, 90], ['90+', 91, Infinity]];
export function ageItems(items, settled, asOf) {
  const ref = new Date(`${asOf || new Date().toISOString().slice(0, 10)}T23:59:59`);
  const out = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0, advance: 0 };
  let left = num(settled);
  for (const it of [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const use = Math.min(left, num(it.amount)); left = round2(left - use);
    const open = round2(num(it.amount) - use); if (open <= 0) continue;
    const age = Math.max(0, Math.floor((ref - new Date(it.date)) / 86400000));
    const b = BUCKETS.find(([, lo, hi]) => age >= lo && age <= hi);
    out[b[0]] = round2(out[b[0]] + open); out.total = round2(out.total + open);
  }
  out.advance = round2(left);
  return out;
}
export function customerAging(customerId, d, asOf) {
  const e = customerEntries(customerId, d, asOf);
  return ageItems(e.filter((x) => x.debit > 0).map((x) => ({ date: x.date, amount: x.debit })), e.reduce((a, x) => a + num(x.credit), 0), asOf);
}
export function supplierAging(supplierId, d, asOf) {
  const e = supplierEntries(supplierId, d, asOf);
  return ageItems(e.filter((x) => x.credit > 0).map((x) => ({ date: x.date, amount: x.credit })), e.reduce((a, x) => a + num(x.debit), 0), asOf);
}
