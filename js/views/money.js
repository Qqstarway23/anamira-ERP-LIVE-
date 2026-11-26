// Invoices (to customers), supplier bills and payment / receipt vouchers, each printable.
import { html, icon, money, fmtDate, fmtDateTime, plate, num, round2 } from '../util.js';
import { t } from '../i18n.js';
import { actBtn, confirmBox, toast } from '../ui.js';
import { lookups, nameOf } from '../schema.js';
import { recordsView } from './records.js';
import { printDoc, amountInWords } from './doc.js';
import { S, reload } from '../store.js';

const cur = () => S.settings?.currency || 'AED';

export function printInvoice(inv) {
  const x = lookups(S.data); const c = x.customers[inv.customer_id]; const r = x.rentals[inv.rental_id];
  const fines = S.data.fines.filter((f) => f.invoice_id === inv.id).sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const total = round2(num(inv.amount) + num(inv.vat));
  printDoc(inv.kind === 'fines' ? 'Tax invoice · Fines & tolls' : 'Tax invoice · فاتورة ضريبية', inv.ref, html`
    ${inv.status === 'void' ? html`<p class="void-stamp">VOID</p>` : ''}
    <div class="cols"><section><h3>Bill to</h3><p><b>${c?.full_name}</b> <span class="mono">${c?.code}</span></p><p>${c?.phone}</p>
      ${c?.trn ? html`<p>TRN ${c.trn}</p>` : ''}${c?.address ? html`<p>${c.address}</p>` : ''}</section>
      <section><h3>Details</h3><p>Date ${fmtDate(inv.issued_on)}${inv.due_on ? ` · Due ${fmtDate(inv.due_on)}` : ''}</p>
      ${r ? html`<p>Agreement <b class="mono">${r.ref}</b> · ${plate(x.vehicles[r.vehicle_id])}</p>` : ''}<p>${inv.description}</p></section></div>
    ${fines.length ? html`<table><tr><th>Date</th><th>Kind</th><th>Reference</th><th>Plate</th><th>Location</th><th class="num">Amount</th><th class="num">Admin fee</th></tr>
      ${fines.map((f) => html`<tr><td>${fmtDateTime(f.occurred_at)}</td><td>${t(f.kind)}</td><td>${f.reference}</td><td>${f.plate_code} ${f.plate_number}</td><td>${f.location}</td>
        <td class="num">${money(f.amount, false)}</td><td class="num">${money(f.admin_fee, false)}</td></tr>`)}</table>` : ''}
    <table class="totals"><tr><th>Amount</th><td class="num">${money(inv.amount)}</td></tr><tr><th>VAT</th><td class="num">${money(inv.vat)}</td></tr>
      <tr><th>Total</th><td class="num"><b>${money(total)}</b></td></tr></table>
    <p class="words">${amountInWords(total, cur())}</p>
    ${inv.kind === 'fines' ? html`<p class="terms">Government fines and tolls are passed on at cost. VAT applies to the admin fee only.</p>` : ''}
    <div class="sign"><div>Received by</div><div>For ${S.settings?.company_name}</div></div>`, { date: inv.issued_on });
}

export function invoicesPage(root) {
  const v = recordsView('invoices', {
    headerExtra: () => (S.can('invoices', 'write') ? html`<button class="btn ghost" data-act="invfines" title="${t('One invoice per agreement for charged fines and tolls that are not invoiced yet.')}">${icon('file-check')} ${t('Invoice charged fines')}</button>` : ''),
    beforeTable: (list) => {
      const open = list.filter((i) => i.status === 'open');
      const pend = S.data.fines.filter((f) => f.status === 'charged' && !f.invoice_id && f.customer_id).length;
      return html`<div class="kpis sm"><div class="kpi"><span>${t('Open')}</span><b>${money(open.reduce((a, i) => a + num(i.amount) + num(i.vat), 0))}</b><em>${open.length}</em></div>
        <div class="kpi"><span>${t('Charged fines not invoiced')}</span><b>${pend}</b><em>${t('Invoice date limit')}: ${fmtDate(S.settings?.fines_invoice_from)}</em></div></div>`;
    },
    rowActions: (i) => html`${actBtn('print', i.id, 'printer', 'Print')}${i.status === 'open' && S.can('invoices', 'write') ? actBtn('void', i.id, 'circle-x', 'Void', 'danger') : ''}`,
  });
  const find = (id) => S.data.invoices.find((i) => i.id === id);
  v.wire(root, {
    print: (id) => printInvoice(find(id)),
    void: async (id) => {
      const i = find(id);
      if (!(await confirmBox(`${t('Void')} ${i.ref}? ${i.kind === 'fines' ? t('Its fines become available to invoice again.') : ''}`, { okText: t('Void'), danger: true }))) return;
      try { await S.backend.update('invoices', id, { status: 'void' }); toast(t('Saved')); await reload('invoices'); } catch (e) { toast(e.message, 'err'); }
    },
    invfines: async () => {
      try { const n = await S.backend.rpc('invoice_fines'); toast(`${n} ${t('invoices created')}`); await reload('invoices'); } catch (e) { toast(e.message, 'err'); }
    },
  });
  const draw = () => v.render(root); draw(); return draw;
}

export function billsPage(root) {
  const v = recordsView('bills', {
    beforeTable: (list) => {
      const open = list.filter((b) => b.status === 'open');
      const overdue = open.filter((b) => b.due_date && b.due_date < new Date().toISOString().slice(0, 10));
      const paid = S.data.vouchers.filter((p) => p.party_type === 'supplier' && p.direction === 'payment').reduce((a, p) => a + num(p.amount), 0);
      return html`<div class="kpis sm"><div class="kpi"><span>${t('Billed')}</span><b>${money(open.reduce((a, b) => a + num(b.amount) + num(b.vat), 0))}</b><em>${open.length}</em></div>
        <div class="kpi"><span>${t('Paid to suppliers')}</span><b>${money(paid)}</b><em><a href="#/accounts?tab=suppliers">${t('Supplier statements')}</a></em></div>
        <div class="kpi"><span>${t('Past due date')}</span><b class="${overdue.length ? 'neg' : ''}">${overdue.length}</b></div></div>`;
    },
    rowActions: (b) => (S.can('vouchers', 'write') && b.status === 'open' ? actBtn('pay', b.id, 'banknote', 'Pay') : ''),
  });
  v.wire(root, {
    pay: (id) => {
      const b = S.data.bills.find((x) => x.id === id);
      recordsView('vouchers').openForm(null);
      // prefill after the form opens
      setTimeout(() => {
        const f = document.querySelector('#modal form'); if (!f) return;
        const set = (k, val) => { if (f.elements[k]) { f.elements[k].value = val; f.elements[k].dispatchEvent(new Event('change', { bubbles: true })); } };
        set('direction', 'payment'); set('party_type', 'supplier'); set('supplier_id', b.supplier_id); set('purpose', 'bill');
        set('amount', round2(num(b.amount) + num(b.vat))); set('note', `${b.ref}${b.bill_no ? ' / ' + b.bill_no : ''}`);
      }, 40);
    },
  });
  const draw = () => v.render(root); draw(); return draw;
}

export function printVoucher(vc) {
  const party = vc.party_type === 'supplier' ? nameOf(S.data.suppliers, vc.supplier_id) : vc.party_type === 'employee' ? nameOf(S.data.employees, vc.employee_id, (e) => `${e.code} · ${e.full_name}`) : vc.party_name;
  const pay = vc.direction === 'payment';
  printDoc(pay ? 'Payment voucher · سند صرف' : 'Receipt voucher · سند قبض', vc.ref, html`
    <table><tr><th>${pay ? 'Paid to' : 'Received from'}</th><td colspan="3"><b>${party}</b> (${t(vc.party_type)})</td></tr>
      <tr><th>Amount</th><td><b>${money(vc.amount)}</b></td><th>Date</th><td>${fmtDate(vc.paid_on)}</td></tr>
      <tr><th>Method</th><td>${t(vc.method)}</td><th>Cheque / transfer no.</th><td>${vc.cheque_no || '—'}</td></tr>
      <tr><th>Purpose</th><td colspan="3">${t(vc.purpose)}${vc.note ? ' · ' + vc.note : ''}</td></tr></table>
    <p class="words">${amountInWords(vc.amount, cur())}</p>
    <div class="sign three"><div>Prepared by</div><div>Approved by</div><div>${pay ? 'Received by' : 'Paid by'}</div></div>`, { date: vc.paid_on });
}

export function vouchersPage(root) {
  const v = recordsView('vouchers', {
    beforeTable: (list) => {
      const s = (d) => list.filter((p) => p.direction === d).reduce((a, p) => a + num(p.amount), 0);
      return html`<div class="kpis sm"><div class="kpi"><span>${t('Payments')}</span><b class="neg">${money(s('payment'))}</b></div>
        <div class="kpi"><span>${t('Receipts')}</span><b class="pos">${money(s('receipt'))}</b></div></div>`;
    },
    rowActions: (p) => actBtn('print', p.id, 'printer', 'Print'),
  });
  v.wire(root, { print: (id) => printVoucher(S.data.vouchers.find((p) => p.id === id)) });
  const draw = () => v.render(root); draw(); return draw;
}

