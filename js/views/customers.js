// Customers: the generic list plus statement of account, and scanning the Emirates ID / passport to fill the form or find the customer.
import { html, icon, $ } from '../util.js';
import { t } from '../i18n.js';
import { actBtn, toast, openModal } from '../ui.js';
import { recordsView } from './records.js';
import { openStatement } from './accounts.js';
import { S } from '../store.js';
import { scanIdDocument, confirmIdCustomer } from './scan.js';

export { parseMrz, mrzCheck } from '../mrz.js';

export function mountCustomers(root, params) {
  let v;
  const formWithDoc = () => html`<p class="muted small">${icon('id-card')} <button type="button" class="link" data-doc>${t('Scan Emirates ID or passport')}</button> ${t('to fill name, number, nationality and dates.')}</p>`;
  v = recordsView('customers', {
    headerExtra: () => (S.can('customers', 'read') ? html`<button class="btn ghost" data-act="scanid">${icon('id-card')} ${t('Scan Emirates ID')}</button>` : ''),
    formExtra: formWithDoc,
    onFormMount: (w, row) => {
      w.addEventListener('click', (e) => {
        if (!e.target.closest('[data-doc]')) return;
        const f = $('form', w); const saved = Object.fromEntries([...new FormData(f)].map(([k, val]) => [k, val]));
        f.querySelectorAll('input[type=checkbox]').forEach((c) => { saved[c.name] = c.checked; });
        scanIdDocument((read) => {
          if (read.customer) { toast(`${read.customer.full_name}: ${t('already a customer')}`); v.openForm(read.customer); return; }
          const { data, warn } = read;
          const merged = { ...(row || {}), ...saved };
          for (const [k, val] of Object.entries(data)) if (val && !merged[k]) merged[k] = val; else if (val && k.endsWith('expiry')) merged[k] = val;
          if (row) v.openForm({ ...row, ...merged }); else v.openForm(null, merged);
          if (warn.length) toast(warn.join(' · '), 'err'); else toast(t('Filled from the document. Please check.'));
        });
      });
    },
    rowActions: (c) => html`${actBtn('stmt', c.id, 'scroll', 'Statement of account')}${S.can('rentals', 'write') && !c.blacklisted ? html`<a class="icon-btn" href="#/rentals?new=1&customer=${c.id}" title="${t('New rental')}" aria-label="${t('New rental')}">${icon('key-round')}</a>` : ''}`,
  });
  // Scan → the customer is found (or created); offer a new rental for them.
  const scanId = () => scanIdDocument((read) => confirmIdCustomer(read, (c) => {
    v.render(root);
    openModal({
      title: html`${icon('check')} ${c.full_name}`, wide: false,
      body: html`<p class="muted">${c.code || ''} · ${c.id_number || c.passport_number || ''}</p><div class="form-actions"><button class="btn ghost" data-close>${t('Close')}</button>
        ${S.can('rentals', 'write') ? html`<a class="btn primary" href="#/rentals?new=1&customer=${c.id}&idscan=1" data-close>${icon('key-round')} ${t('New rental')}</a>` : ''}</div>`,
    });
  }));
  v.wire(root, { stmt: (id) => openStatement('customers', id), scanid: scanId });
  v.render(root);
  const linked = params?.get('customer') && S.data.customers.find((c) => c.id === params.get('customer'));
  if (linked) { if (S.can('customers', 'write')) v.openForm(linked); else openStatement('customers', linked.id); }
  else if (params?.get('scan')) scanId();
  else if (params?.get('new') && S.can('customers', 'write')) v.openForm(null);
  return () => v.render(root);
}
