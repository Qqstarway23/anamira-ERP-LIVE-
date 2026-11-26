// Setup: branches, departments, master lists (makes, models, check-list items…), tariffs, employees and suppliers.
import { html, icon, $ } from '../util.js';
import { t } from '../i18n.js';
import { recordsView } from './records.js';
import { ACRISS } from '../rules.js';
import { S } from '../store.js';

// A page with tabs, each tab a generic list. Every switch builds a fresh container so click handlers never stack.
export function tabbedPage(tabs, { title, ic, intro } = {}) {
  return (root, params) => {
    const visible = tabs.filter((x) => !x.perm || S.can(...x.perm));
    let cur = visible.find((x) => x.id === params?.get('tab'))?.id || visible[0]?.id;
    let view = null; let body = null;
    const head = () => html`<div class="page-head"><div><h1>${icon(ic)} ${t(title)}</h1>${intro ? html`<p class="muted">${t(intro)}</p>` : ''}</div></div>
      <div class="tabs" role="tablist">${visible.map((x) => html`<button role="tab" class="${x.id === cur ? 'on' : ''}" aria-selected="${x.id === cur}" data-tab="${x.id}">${icon(x.icon)} ${t(x.label)}</button>`)}</div>`;
    const open = () => {
      root.innerHTML = head().toString();
      body = document.createElement('div'); root.append(body);
      const tab = visible.find((x) => x.id === cur);
      view = tab.mount(body, params);
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      cur = b.dataset.tab; history.replaceState(null, '', `#/${location.hash.slice(2).split('?')[0]}?tab=${cur}`); open();
    });
    open();
    return () => { $('.tabs', root) && view?.(); };
  };
}

export const listTab = (name, opts = {}) => (el) => { const v = recordsView(name, opts); v.wire(el); v.render(el); return () => v.render(el); };

const sippGuide = () => html`<details class="card guide"><summary>${icon('info')} ${t('SIPP / ACRISS code guide')}</summary>
  <p class="muted small">${t('Four letters describe the car: category, type, transmission and drive, fuel and air-con. Example: CDAR = Compact, 4-5 door, automatic, petrol with air-con.')}</p>
  <div class="sipp-grid">${ACRISS.map((a) => html`<div><h4>${t(a.label)}</h4><dl>${Object.entries(a.options).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></div>`)}</div></details>`;

export const mountSetup = tabbedPage([
  { id: 'branches', label: 'Branches', icon: 'map-pin', mount: listTab('branches') },
  { id: 'departments', label: 'Departments', icon: 'building', mount: listTab('departments') },
  { id: 'masters', label: 'Masters', icon: 'list', mount: listTab('masters', { beforeTable: sippGuide }) },
  { id: 'tariff_groups', label: 'Tariff groups', icon: 'layers', mount: listTab('tariff_groups') },
  { id: 'tariff_cards', label: 'Tariff cards', icon: 'tag', mount: listTab('tariff_cards', {
    beforeTable: () => html`<p class="muted small">${icon('info')} ${t('A rental picks the price automatically: the customer\'s own card for the car\'s tariff group first, otherwise the standard card of that group, otherwise the car\'s own rates.')}</p>` }) },
], { title: 'Setup', ic: 'settings', intro: 'Lists and prices used across the system.' });

export const mountPeople = tabbedPage([
  { id: 'employees', label: 'Employees', icon: 'id-card', mount: listTab('employees') },
  { id: 'suppliers', label: 'Suppliers', icon: 'truck', mount: listTab('suppliers') },
], { title: 'Employees & suppliers', ic: 'users' });
