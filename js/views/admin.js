// Team (user access), company settings and the activity log.
import { html, icon, fmtDateTime, $ } from '../util.js';
import { t } from '../i18n.js';
import { table, badge, wireActions, formModal, confirmBox, toast, field, readForm } from '../ui.js';
import { S, loadAll } from '../store.js';

// ── Team ─────────────────────────────────────────────────────────────────────
export function mountTeam(root) {
  let profiles = [];
  const load = async () => { profiles = await S.backend.list('profiles'); render(); };
  const render = () => {
    const admin = S.can('profiles', 'write');
    const pending = profiles.filter((p) => !p.active);
    root.innerHTML = html`
      <div class="page-head"><div><h1>${icon('user-cog')} ${t('Team')}</h1><p class="muted">${profiles.length} · ${pending.length} ${t('Waiting for approval')}</p></div></div>
      <div class="callout">${icon('info')}<div><b>How access works</b><p>New people sign up on the login page with their own email. They see nothing until an admin activates them here and picks a role. Every rule is enforced by the database, not just this screen.</p></div></div>
      <div class="roles">${[['admin', 'Everything, including team and settings'], ['manager', 'Fleet, rentals, fines, reports, expenses'], ['agent', 'Customers, rentals, payments, maintenance'], ['accountant', 'Payments, fines, expenses, reports']]
        .map(([r, d]) => html`<div>${badge(r)}<small class="muted">${d}</small></div>`)}</div>
      ${table(profiles, [
        { label: 'Full name', cell: (p) => html`<b>${p.full_name}</b>${p.id === S.me?.id ? html` <small class="muted">(you)</small>` : ''}<small class="muted block">${p.email}</small>` },
        { label: 'Role', cell: (p) => badge(p.role) }, { label: 'Status', cell: (p) => (p.active ? badge('available', t('Active')) : badge('new', t('Waiting for approval'))) },
        { label: 'Date', cell: (p) => fmtDateTime(p.created_at) },
      ], { actions: admin ? (p) => html`<button class="btn sm ghost" data-act="edit" data-id="${p.id}">${icon('pencil')} ${t('Edit')}</button>
          ${!p.active ? html`<button class="btn sm primary" data-act="activate" data-id="${p.id}">${icon('check')} ${t('Activate')}</button>` : ''}` : null })}`.toString();
  };
  wireActions(root, {
    activate: async (id) => { try { await S.backend.update('profiles', id, { active: true }); toast(t('Saved')); await load(); } catch (e) { toast(e.message, 'err'); } },
    edit: (id) => {
      const p = profiles.find((x) => x.id === id);
      formModal({
        title: `${t('Edit')} · ${p.email}`, wide: false, row: p,
        fields: [{ key: 'full_name', label: 'Full name', req: true, max: 80 }, { key: 'role', label: 'Role', type: 'select', req: true, options: ['admin', 'manager', 'agent', 'accountant'] },
          { key: 'active', label: 'Active', type: 'checkbox' }],
        onSubmit: async (v) => { await S.backend.update('profiles', id, v); toast(t('Saved')); await load(); },
      });
    },
  });
  load().catch((e) => toast(e.message, 'err'));
  return () => {};
}

// ── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_FIELDS = [
  { key: 'company_name', label: 'Company name', req: true, max: 120 }, { key: 'company_phone', label: 'Phone', max: 40 },
  { key: 'company_address', label: 'Address', max: 200, span: true }, { key: 'trn', label: 'TRN', max: 20 },
  { key: 'currency', label: 'Currency', type: 'select', req: true, options: ['AED', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD', 'USD', 'EUR'] },
  { key: 'vat_rate', label: 'VAT %', type: 'number', req: true, max: 100 }, { key: 'salik_fee', label: 'Salik admin fee', type: 'money', req: true },
  { key: 'fine_fee_pct', label: 'Fine admin fee %', type: 'number', req: true, max: 100 },
];
export function mountSettings(root) {
  const render = () => {
    const ro = !S.can('settings', 'write');
    root.innerHTML = html`
      <div class="page-head"><div><h1>${icon('settings')} ${t('Settings')}</h1><p class="muted">${ro ? t('Read only') : ''}</p></div></div>
      <section class="card"><form class="form" data-settings ${ro ? 'inert' : ''}>
        <fieldset ${ro ? 'disabled' : ''}><div class="grid-form">${SETTINGS_FIELDS.map((f) => field(f, S.settings?.[f.key]))}</div></fieldset>
        <div class="form-error" hidden></div>
        ${ro ? '' : html`<div class="form-actions"><button class="btn primary" type="submit">${icon('check')} ${t('Save')}</button></div>`}
      </form></section>
      <section class="card"><header><h2>${icon('lock')} Security</h2></header><ul class="checks">
        <li>${icon('circle-check')} Every table is protected by Row Level Security in the database.</li>
        <li>${icon('circle-check')} New sign-ups have no access until an admin activates them.</li>
        <li>${icon('circle-check')} Prices, VAT and totals are calculated by the database and cannot be changed from the browser.</li>
        <li>${icon('circle-check')} Double bookings are impossible: the database blocks overlapping rentals for the same car.</li>
        <li>${icon('circle-check')} Every change is written to the activity log, which nobody can edit.</li>
        <li>${icon('circle-check')} Only the public (publishable) key is in this app. No secret keys are shipped to browsers.</li></ul></section>`.toString();
    const form = $('[data-settings]', root);
    form?.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!form.checkValidity()) return form.reportValidity();
      try { S.settings = await S.backend.saveSettings(readForm(form, SETTINGS_FIELDS)); await loadAll(); toast(t('Saved')); }
      catch (ex) { const er = $('.form-error', form); er.textContent = ex.message; er.hidden = false; }
    });
  };
  render(); return () => {};
}

// ── Activity log ─────────────────────────────────────────────────────────────
export function mountActivity(root) {
  (async () => {
    let rows = [];
    try { rows = await S.backend.list('activity_log'); } catch (e) { toast(e.message, 'err'); }
    root.innerHTML = html`<div class="page-head"><div><h1>${icon('history')} ${t('Activity')}</h1><p class="muted">${rows.length}</p></div></div>
      ${table(rows, [
        { label: 'When', cell: (r) => fmtDateTime(r.at) }, { label: 'Who', cell: (r) => r.actor_name || '—' },
        { label: 'What', cell: (r) => html`${badge(r.action === 'delete' ? 'refund' : r.action === 'insert' ? 'payment' : 'booked', r.action)} <b>${t(r.entity === 'vehicles' ? 'Fleet' : r.entity[0].toUpperCase() + r.entity.slice(1))}</b>` },
        { label: 'Description', cell: (r) => r.summary },
      ])}`.toString();
  })();
  return () => {};
}
