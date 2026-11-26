// Accounts: balances, statements of account and age analysis for customers, suppliers and employees.
import { html, icon, money, fmtDate, csv, download, todayISO, num, round2, matches, $ } from '../util.js';
import { t } from '../i18n.js';
import { table, openModal, wireActions, badge } from '../ui.js';
import { customerEntries, supplierEntries, employeeEntries, lastBalance, customerAging, supplierAging, depositHeld, BUCKETS, ageItems } from '../ledger.js';
import { printDoc } from './doc.js';
import { S } from '../store.js';

const KINDS = {
  customers: { label: 'Customers', icon: 'users', rows: () => S.data.customers, name: (c) => c.full_name, code: (c) => c.code, entries: customerEntries, aging: customerAging, word: 'Receivable' },
  suppliers: { label: 'Suppliers', icon: 'truck', rows: () => S.data.suppliers, name: (s) => s.name, code: (s) => s.code, entries: supplierEntries, aging: supplierAging, word: 'Payable', perm: ['bills', 'read'] },
  employees: { label: 'Employees', icon: 'id-card', rows: () => S.data.employees, name: (e) => e.full_name, code: (e) => e.code, entries: employeeEntries,
    aging: (id, d, asOf) => { const e = employeeEntries(id, d, asOf); return ageItems(e.filter((x) => x.debit > 0).map((x) => ({ date: x.date, amount: x.debit })), e.reduce((a, x) => a + num(x.credit), 0), asOf); }, word: 'Owed by employee' },
};

function statementRows(entries) {
  return entries.map((e) => ({ ...e, id: `${e.ref}-${e.date}` }));
}

export function openStatement(kind, id, asOf = todayISO(), from = '') {
  const K = KINDS[kind]; const p = K.rows().find((r) => r.id === id); if (!p) return;
  const all = K.entries(id, S.data, asOf);
  const before = from ? all.filter((e) => String(e.date).slice(0, 10) < from) : [];
  const opening = before.length ? before[before.length - 1].balance : 0;
  const shown = from ? all.filter((e) => String(e.date).slice(0, 10) >= from) : all;
  const closing = lastBalance(all); const ag = K.aging(id, S.data, asOf);
  const dep = kind === 'customers' ? depositHeld(id, S.data, asOf) : 0;
  const body = (forPrint) => html`
    ${forPrint ? html`<div class="cols"><section><h3>${t(K.label)}</h3><p><b>${K.name(p)}</b> <span class="mono">${K.code(p)}</span></p><p>${p.phone || ''}</p>${p.trn ? html`<p>TRN ${p.trn}</p>` : ''}</section>
      <section><h3>Period</h3><p>${from ? fmtDate(from) : 'Start'} → ${fmtDate(asOf)}</p></section></div>` : ''}
    <div class="aging">${BUCKETS.map(([b]) => html`<div><span>${b} ${t('days')}</span><b>${money(ag[b])}</b></div>`)}
      <div class="big"><span>${t(K.word)}</span><b class="${closing > 0 ? 'neg' : ''}">${money(closing)}</b></div>
      ${dep ? html`<div><span>${t('Deposit held')}</span><b>${money(dep)}</b></div>` : ''}${ag.advance ? html`<div><span>${t('Advance / unallocated')}</span><b>${money(ag.advance)}</b></div>` : ''}</div>
    ${table(statementRows([...(from ? [{ date: from, ref: '', kind: 'opening', text: t('Opening balance'), debit: 0, credit: 0, balance: opening }] : []), ...shown]), [
      { label: 'Date', cell: (e) => fmtDate(e.date) }, { label: 'Reference', cell: (e) => (e.link && !forPrint ? html`<a class="mono" href="${e.link}">${e.ref}</a>` : html`<span class="mono">${e.ref}</span>`) },
      { label: 'Description', cell: (e) => html`${t(e.kind)}${e.text ? html` <small class="muted">${e.text}</small>` : ''}${e.memo ? html` <small class="muted">(${t('memo')} ${money(e.memoAmount)})</small>` : ''}` },
      { label: 'Debit', cell: (e) => (e.debit ? money(e.debit, false) : ''), cls: 'num' }, { label: 'Credit', cell: (e) => (e.credit ? money(e.credit, false) : ''), cls: 'num' },
      { label: 'Balance', cell: (e) => html`<b>${money(e.balance, false)}</b>`, cls: 'num' },
    ], { empty: 'No entries in this period' })}`;
  const w = openModal({
    title: html`${icon('scroll')} ${t('Statement of account')} · ${K.name(p)}`, wide: true,
    body: html`<div class="toolbar"><label class="mini-select">${t('From')} <input type="date" data-from value="${from}"></label>
      <label class="mini-select">${t('As of')} <input type="date" data-asof value="${asOf}"></label>
      <button class="btn ghost" data-st="print">${icon('printer')} ${t('Print')}</button><button class="btn ghost" data-st="csv">${icon('download')} CSV</button>
      ${p.email ? html`<a class="btn ghost" href="mailto:${p.email}?subject=${encodeURIComponent(`${S.settings?.company_name || ''} statement of account ${asOf}`)}&body=${encodeURIComponent(`Dear ${K.name(p)},\n\nYour balance as of ${fmtDate(asOf)} is ${money(closing)}.\n\nRegards`)}">${icon('mail-check')} ${t('Email')}</a>` : ''}</div>
      ${body(false)}`,
  });
  w.addEventListener('change', (e) => { if (e.target.matches('[data-from],[data-asof]')) openStatement(kind, id, $('[data-asof]', w).value || todayISO(), $('[data-from]', w).value); });
  w.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    if (b.dataset.st === 'print') printDoc('Statement of account · كشف حساب', K.code(p), body(true), { date: asOf });
    if (b.dataset.st === 'csv') download(`statement-${K.code(p)}-${asOf}.csv`, csv(shown, [{ label: 'Date', csv: (e) => String(e.date).slice(0, 10) }, { label: 'Ref', key: 'ref' }, { label: 'Kind', key: 'kind' },
      { label: 'Description', key: 'text' }, { label: 'Debit', key: 'debit' }, { label: 'Credit', key: 'credit' }, { label: 'Balance', key: 'balance' }]));
  });
}

export function agingRows(kind, asOf) {
  const K = KINDS[kind];
  return K.rows().map((p) => {
    const ag = K.aging(p.id, S.data, asOf); const bal = lastBalance(K.entries(p.id, S.data, asOf));
    return { id: p.id, p, ag, bal, name: K.name(p), code: K.code(p) };
  }).filter((r) => Math.abs(r.bal) > 0.009 || r.ag.total > 0);
}

export function mountAccounts(root, params) {
  const kinds = Object.keys(KINDS).filter((k) => !KINDS[k].perm || S.can(...KINDS[k].perm));
  const st = { kind: kinds.includes(params?.get('tab')) ? params.get('tab') : kinds[0], asOf: todayISO(), q: '', all: false };
  const render = () => {
    const K = KINDS[st.kind];
    const rows = (st.all ? K.rows().map((p) => ({ id: p.id, p, name: K.name(p), code: K.code(p), ag: K.aging(p.id, S.data, st.asOf), bal: lastBalance(K.entries(p.id, S.data, st.asOf)) })) : agingRows(st.kind, st.asOf))
      .filter((r) => matches(r, st.q.toLowerCase(), ['name', 'code']));
    const tot = (k) => round2(rows.reduce((a, r) => a + (k === 'bal' ? r.bal : num(r.ag[k])), 0));
    root.innerHTML = html`<div class="page-head"><div><h1>${icon('scale')} ${t('Accounts')}</h1><p class="muted">${t('Balances and age analysis. Open a row for the statement of account.')}</p></div>
      <div class="head-actions"><button class="btn ghost" data-act="csv">${icon('download')} ${t('Export CSV')}</button></div></div>
      <div class="tabs">${kinds.map((k) => html`<button class="${k === st.kind ? 'on' : ''}" data-act="kind" data-id="${k}">${icon(KINDS[k].icon)} ${t(KINDS[k].label)}</button>`)}</div>
      <div class="toolbar"><label class="search">${icon('search')}<input type="search" data-q value="${st.q}" placeholder="${t('Search…')}" aria-label="${t('Search…')}"></label>
        <label class="mini-select">${t('As of')} <input type="date" data-asof value="${st.asOf}"></label>
        <label class="mini-select"><input type="checkbox" data-all ${st.all ? 'checked' : ''}> ${t('Show zero balances')}</label></div>
      <div class="kpis sm">${BUCKETS.map(([b]) => html`<div class="kpi"><span>${b} ${t('days')}</span><b>${money(tot(b))}</b></div>`)}<div class="kpi"><span>${t(K.word)}</span><b>${money(tot('bal'))}</b></div></div>
      ${table(rows, [
        { label: 'Code', cell: (r) => html`<span class="mono">${r.code}</span>` },
        { label: 'Name', cell: (r) => html`<button class="link" data-act="open" data-id="${r.id}"><b>${r.name}</b></button>${st.kind === 'customers' && r.p.account_type === 'credit' ? html` ${badge('credit', t('Credit'))}` : ''}` },
        ...BUCKETS.map(([b]) => ({ label: `${b}`, cell: (r) => (r.ag[b] ? money(r.ag[b], false) : ''), cls: 'num' })),
        { label: 'Balance', cell: (r) => html`<b class="${r.bal > 0 ? 'neg' : ''}">${money(r.bal)}</b>${st.kind === 'customers' && num(r.p.credit_limit) > 0 && r.bal > num(r.p.credit_limit) ? html`<small class="neg block">${t('Over credit limit')}</small>` : ''}`, cls: 'num' },
      ], { empty: 'No open balances', actions: (r) => html`<button class="icon-btn" data-act="open" data-id="${r.id}" title="${t('Statement of account')}" aria-label="${t('Statement of account')}">${icon('scroll')}</button>` })}`.toString();
    const q = $('[data-q]', root);
    q.addEventListener('input', () => { st.q = q.value; const p = q.selectionStart; render(); const i = $('[data-q]', root); i.focus(); i.setSelectionRange(p, p); });
    $('[data-asof]', root).addEventListener('change', (e) => { st.asOf = e.target.value || todayISO(); render(); });
    $('[data-all]', root).addEventListener('change', (e) => { st.all = e.target.checked; render(); });
    root._rows = rows;
  };
  wireActions(root, {
    kind: (k) => { st.kind = k; render(); },
    open: (id) => openStatement(st.kind, id, st.asOf),
    csv: () => download(`${st.kind}-aging-${st.asOf}.csv`, csv(root._rows || [], [{ label: 'Code', key: 'code' }, { label: 'Name', key: 'name' },
      ...BUCKETS.map(([b]) => ({ label: b, csv: (r) => r.ag[b] })), { label: 'Balance', key: 'bal' }])),
  });
  render();
  const open = params?.get('open'); if (open) openStatement(st.kind, open, st.asOf);
  return render;
}
