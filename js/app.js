// Boot, app shell and router.
import { html, icon, $, mount } from './util.js';
import { t, getLang, setLang } from './i18n.js';
import { toast, closeModal, badge, confirmBox, formModal } from './ui.js';
import { S, loadAll, onData, startLive, reload } from './store.js';
import { createLiveBackend } from './backend-live.js';
import { createDemoBackend } from './backend-demo.js';
import { renderAuth, renderPending } from './views/auth.js';
import { mountDashboard } from './views/dashboard.js';
import { mountRentals } from './views/rentals.js';
import { mountReports } from './views/reports.js';
import { mountTeam, mountSettings, mountActivity } from './views/admin.js';
import { recordsView, simplePage as simple } from './views/records.js';
import { openFinesImport } from './views/fines-import.js';
import { fleetPage, movementsPage, maintenancePage } from './views/fleet.js';
import { mountCheckCard } from './views/checkcard.js';
import { invoicesPage, billsPage, vouchersPage } from './views/money.js';
import { mountAccounts } from './views/accounts.js';
import { mountSetup, mountPeople } from './views/setup.js';
import { mountOpsReports } from './views/ops-reports.js';
import { mountAlerts } from './views/alerts.js';
import { mountCustomers } from './views/customers.js';
import { CONFIG } from './config.js';

const app = $('#app');
const DEMO_FLAG = 'anamira.mode';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } } };

// ── Theme ────────────────────────────────────────────────────────────────────
const applyTheme = (th) => { if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme; };
applyTheme(store.get('anamira.theme'));

// ── Pages built from the generic records view ────────────────────────────────
function finesPage(root) {
  const v = recordsView('fines', {
    headerExtra: () => (S.can('fines', 'write') ? html`<button class="btn ghost" data-act="import">${icon('upload')} ${t('Import statement')}</button>
      <button class="btn ghost" data-act="match">${icon('link-2')} ${t('Match to rentals')}</button>
      <a class="btn ghost" href="#/opsreports?r=tolls">${icon('badge-check')} ${t('Reconcile')}</a>` : ''),
    presets: { notinv: { label: 'Charged, not invoiced', fn: (f) => f.status === 'charged' && !f.invoice_id }, staff: { label: 'Charged to employees', fn: (f) => f.status === 'employee' } },
    beforeTable: () => html`<p class="muted small">${icon('info')} <b>${t('Import statement')}</b> reads the Salik, Darb, mall parking, Dubai Police, RTA or other emirates' export (Excel or CSV) and links every row to the rental and customer that had the car at that time, even after a vehicle replacement. Fines during staff use or custody go to the employee. <b>${t('Match to rentals')}</b> does the same for rows added by hand. The admin fee comes from Settings.</p>`,
  });
  const draw = () => v.render(root);
  v.wire(root, { import: () => openFinesImport(), match: async () => { try { const n = await S.backend.rpc('match_fines'); toast(`${n} ✓`); await reload('fines'); } catch (e) { toast(e.message, 'err'); } } });
  draw(); return draw;
}

function changePassword() {
  formModal({
    title: t('Change password'), wide: false, submitText: t('Save'),
    fields: [{ key: 'password', label: 'New password', type: 'password', req: true, max: 72 }, { key: 'again', label: 'Repeat new password', type: 'password', req: true, max: 72 }],
    onSubmit: async (v) => {
      if ((v.password || '').length < 10) throw new Error(t('Use at least 10 characters.'));
      if (v.password !== v.again) throw new Error(t('The two passwords are different.'));
      await S.backend.updatePassword(v.password); toast(t('Saved'));
    },
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────
const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', group: 'Operations', mount: mountDashboard },
  { id: 'alerts', label: 'Alerts', icon: 'bell', group: 'Operations', mount: mountAlerts },
  { id: 'rentals', label: 'Rentals', icon: 'key-round', group: 'Operations', mount: mountRentals },
  { id: 'checkcard', label: 'Check-out / check-in', icon: 'clipboard-check', group: 'Operations', mount: mountCheckCard },
  { id: 'fleet', label: 'Fleet', icon: 'car', group: 'Operations', mount: fleetPage },
  { id: 'movements', label: 'Staff & custody', icon: 'route', group: 'Operations', mount: movementsPage },
  { id: 'customers', label: 'Customers', icon: 'users', group: 'Operations', mount: mountCustomers },
  { id: 'maintenance', label: 'Garage & maintenance', icon: 'wrench', group: 'Operations', mount: maintenancePage },
  { id: 'payments', label: 'Payments', icon: 'wallet', group: 'Money', mount: simple('payments') },
  { id: 'invoices', label: 'Invoices', icon: 'file-text', group: 'Money', mount: invoicesPage },
  { id: 'fines', label: 'Fines & Salik', icon: 'siren', group: 'Money', mount: finesPage },
  { id: 'bills', label: 'Supplier bills', icon: 'scroll', group: 'Money', mount: billsPage, perm: ['bills', 'read'] },
  { id: 'vouchers', label: 'Vouchers', icon: 'banknote', group: 'Money', mount: vouchersPage, perm: ['vouchers', 'read'] },
  { id: 'expenses', label: 'Expenses', icon: 'receipt', group: 'Money', mount: simple('expenses'), perm: ['expenses', 'read'] },
  { id: 'accounts', label: 'Accounts', icon: 'scale', group: 'Money', mount: mountAccounts },
  { id: 'reports', label: 'Reports', icon: 'chart-column', group: 'Reports', mount: mountReports },
  { id: 'opsreports', label: 'Operational reports', icon: 'calendar-days', group: 'Reports', mount: mountOpsReports },
  { id: 'people', label: 'Employees & suppliers', icon: 'id-card', group: 'Setup', mount: mountPeople },
  { id: 'setup', label: 'Setup', icon: 'list', group: 'Setup', mount: mountSetup },
  { id: 'team', label: 'Team', icon: 'user-cog', group: 'Setup', mount: mountTeam, perm: ['profiles', 'read'] },
  { id: 'activity', label: 'Activity', icon: 'history', group: 'Setup', mount: mountActivity, perm: ['activity', 'read'] },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Setup', mount: mountSettings },
];
const allowed = (r) => !r.perm || S.can(...r.perm);

let rerender = null;
function route() {
  const [path, qs] = (location.hash.slice(2) || 'dashboard').split('?');
  const r = ROUTES.find((x) => x.id === path && allowed(x)) || ROUTES[0];
  closeModal();
  $$nav();
  const main = $('#main');
  main.innerHTML = '';
  main.className = `page-${r.id}`;
  const view = document.createElement('div');
  main.append(view);
  rerender = r.mount(view, new URLSearchParams(qs || '')) || null;
  document.title = `${t(r.label)} · ${S.settings?.company_name || 'Anamira'}`;
  main.focus({ preventScroll: true });
  $('#shell')?.classList.remove('nav-open');
}
function $$nav() {
  const cur = (location.hash.slice(2) || 'dashboard').split('?')[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === cur));
}

function shell() {
  const groups = ['Operations', 'Money', 'Reports', 'Setup'];
  const demo = S.backend.mode === 'demo';
  mount(app, html`<div id="shell" class="shell">
    <aside class="side">
      <a class="brand" href="#/dashboard"><img class="logo" src="assets/logo.png" alt="" width="46" height="46"><span>${S.settings?.company_name || 'Anamira'}<small>ERP · v${CONFIG.version}</small></span></a>
      <nav id="nav">${groups.map((g) => {
        const items = ROUTES.filter((r) => r.group === g && allowed(r));
        return items.length ? html`<p class="nav-group">${t(g)}</p>${items.map((r) => html`<a href="#/${r.id}" data-id="${r.id}">${icon(r.icon)}<span>${t(r.label)}</span></a>`)}` : '';
      })}</nav>
      <div class="side-foot">
        <div class="me"><span class="avatar">${(S.me?.full_name || '?').slice(0, 1).toUpperCase()}</span><div><b>${S.me?.full_name}</b>${badge(S.role)}</div></div>
        <div class="side-tools">
          <button class="icon-btn" data-ui="theme" title="${t('Theme')}" aria-label="${t('Theme')}">${icon('moon')}</button>
          <button class="icon-btn" data-ui="lang" title="${t('Language')}" aria-label="${t('Language')}">${icon('languages')}</button>
          ${demo ? '' : html`<button class="icon-btn" data-ui="pw" title="${t('Change password')}" aria-label="${t('Change password')}">${icon('key-square')}</button>`}
          <button class="icon-btn" data-ui="out" title="${demo ? t('Exit demo') : t('Sign out')}" aria-label="${t('Sign out')}">${icon('log-out')}</button>
        </div>
      </div>
    </aside>
    <div class="body">
      ${demo ? html`<div class="demo-bar">${icon('sparkles')} <b>${t('Demo mode')}</b><span class="muted">Sample data, stored only in this browser.</span>
        <label>${t('View as')} <select data-ui="role">${['admin', 'manager', 'agent', 'accountant'].map((r) => html`<option value="${r}" ${r === S.role ? 'selected' : ''}>${t(r)}</option>`)}</select></label>
        <button class="btn sm ghost" data-ui="reset">${icon('refresh-cw')} Reset</button><button class="btn sm ghost" data-ui="out">${t('Exit demo')}</button></div>` : ''}
      <header class="topbar"><button class="icon-btn" data-ui="menu" aria-label="Menu">${icon('menu')}</button><span class="brand-sm"><img class="logo" src="assets/logo.png" alt="" width="32" height="32">${S.settings?.company_name || 'Anamira'}</span></header>
      <main id="main" tabindex="-1"></main>
    </div></div>`);
  app.onclick = async (e) => {
    const b = e.target.closest('[data-ui]'); if (!b || b.tagName === 'SELECT') return;
    const a = b.dataset.ui;
    if (a === 'menu') $('#shell').classList.toggle('nav-open');
    if (a === 'pw') changePassword();
    if (a === 'theme') {
      const dark = document.documentElement.dataset.theme === 'dark';
      const th = dark ? 'light' : 'dark'; store.set('anamira.theme', th); applyTheme(th);
    }
    if (a === 'lang') { setLang(getLang() === 'ar' ? 'en' : 'ar'); shell(); route(); }
    if (a === 'out') {
      if (demo) { store.set(DEMO_FLAG, null); location.hash = ''; location.reload(); return; }
      await S.backend.signOut(); location.hash = ''; location.reload();
    }
    if (a === 'reset' && await confirmBox('Reset the demo data?')) { S.backend.reset(); await loadAll(); shell(); route(); }
  };
  app.onchange = async (e) => {
    if (e.target.matches('[data-ui=role]')) { S.backend.setRole(e.target.value); S.me = await S.backend.me(); await loadAll(); shell(); route(); }
  };
}

// Shown after the user opens a password-reset link from their email.
function askNewPassword(backend) {
  formModal({
    title: 'Set a new password', wide: false, submitText: t('Save'),
    fields: [{ key: 'password', label: 'Password', type: 'password', req: true, max: 72 }],
    onSubmit: async (v) => {
      if ((v.password || '').length < 10) throw new Error('Use at least 10 characters.');
      await backend.updatePassword(v.password); toast(t('Saved'));
    },
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function start(backend) {
  S.backend = backend;
  const session = await backend.session();
  if (!session) {
    return renderAuth(app, {
      backend,
      onDemo: () => { store.set(DEMO_FLAG, 'demo'); location.reload(); },
    });
  }
  S.me = await backend.me();
  if (!S.me?.active) return renderPending(app, S.me, { onSignOut: async () => { await backend.signOut(); location.reload(); } });
  await loadAll();
  shell();
  route();
  window.addEventListener('hashchange', route);
  onData(() => { if (!document.querySelector('#modal')) rerender?.(); });
  startLive();
}

async function boot() {
  let backend;
  try {
    backend = store.get(DEMO_FLAG) === 'demo' ? createDemoBackend() : createLiveBackend();
  } catch (e) {
    console.error(e);
    store.set(DEMO_FLAG, null);
    mount(app, html`<div class="fatal">${icon('triangle-alert')}<h2>Could not connect</h2><p>${e.message}</p></div>`);
    return;
  }
  if (backend.mode === 'live') {
    // Reload whenever the signed-in user changes (sign in, sign out, expired session in another tab).
    let last;
    backend.onAuth((s, ev) => {
      if (ev === 'PASSWORD_RECOVERY') { setTimeout(() => askNewPassword(backend), 1200); last = s?.user?.id || null; return; }
      const id = s?.user?.id || null; if (last !== undefined && id !== last) location.reload(); last = id;
    });
  }
  try { await start(backend); } catch (e) {
    console.error(e);
    mount(app, html`<div class="fatal">${icon('triangle-alert')}<h2>Something went wrong</h2><p>${e.message}</p><button class="btn primary">Reload</button></div>`);
    $('.fatal button', app)?.addEventListener('click', () => location.reload());
  }
}
window.addEventListener('unhandledrejection', (e) => { toast(e.reason?.message || String(e.reason), 'err'); });
boot();
