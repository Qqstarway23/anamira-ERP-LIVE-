// Generic list page for any resource in schema.js: search, status filter, table, CSV, create/edit/delete.
import { html, icon, $, matches, csv, download, todayISO } from '../util.js';
import { t } from '../i18n.js';
import { table, actBtn, wireActions, formModal, confirmBox, toast } from '../ui.js';
import { RESOURCES, lookups } from '../schema.js';
import { S, reload } from '../store.js';

export function recordsView(name, { headerExtra, rowActions, beforeTable, viewToggle } = {}) {
  const R = RESOURCES[name];
  const state = { q: '', filter: '' };

  function rows() {
    const x = lookups(S.data);
    const q = state.q.toLowerCase();
    const keys = R.search.map((k) => (typeof k === 'function' ? (r) => k(r, x) : k));
    return S.data[name].filter((r) => (!state.filter || r[R.filters.key] === state.filter) && matches(r, q, keys));
  }

  function openForm(row) {
    const isNew = !row;
    const fields = (!isNew && R.editFields) ? R.editFields(row) : R.fields;
    formModal({
      title: isNew ? `${t('New')} · ${t(R.title)}` : `${t('Edit')} · ${t(R.title)}`,
      fields, row: row || {}, data: S.data,
      onSubmit: async (vals) => {
        if (isNew) await S.backend.insert(name, vals); else await S.backend.update(name, row.id, vals);
        toast(t('Saved')); await reload(name);
      },
    });
  }

  return {
    render(root) {
      const x = lookups(S.data);
      const list = rows();
      const canWrite = S.can(name, 'write');
      const canEdit = S.can(name, R.permEdit || 'write');
      const canRemove = S.can(name, 'remove');
      const cols = R.columns.map((c) => ({ ...c, cell: (r) => c.cell(r, x) }));
      const counts = Object.fromEntries(R.filters.values.map((v) => [v, S.data[name].filter((r) => r[R.filters.key] === v).length]));
      root.innerHTML = html`
        <div class="page-head">
          <div><h1>${icon(R.icon)} ${t(R.title)}</h1><p class="muted">${list.length} / ${S.data[name].length}</p></div>
          <div class="head-actions">${headerExtra?.() || ''}
            <button class="btn ghost" data-act="csv">${icon('download')} ${t('Export CSV')}</button>
            ${canWrite ? html`<button class="btn primary" data-act="new">${icon('plus')} ${t('New')}</button>` : html`<span class="badge gray">${icon('lock')} ${t('Read only')}</span>`}
          </div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input type="search" placeholder="${t('Search…')}" value="${state.q}" data-q aria-label="${t('Search…')}"></label>
          <div class="chips" role="tablist">
            <button class="chip ${!state.filter ? 'on' : ''}" data-act="filter" data-id="">${t('All')} <i>${S.data[name].length}</i></button>
            ${R.filters.values.filter((v) => counts[v]).map((v) => html`<button class="chip ${state.filter === v ? 'on' : ''}" data-act="filter" data-id="${v}">${t(v)} <i>${counts[v]}</i></button>`)}
          </div>
          ${viewToggle?.() || ''}
        </div>
        ${beforeTable?.(list) || ''}
        <div data-body>${(viewToggle && viewToggle.custom?.(list)) || table(list, cols, {
          actions: (canEdit || canRemove || rowActions) ? (r) => html`${rowActions?.(r) || ''}${canEdit ? actBtn('edit', r.id, 'pencil', 'Edit') : ''}${canRemove ? actBtn('del', r.id, 'trash-2', 'Delete', 'danger') : ''}` : null,
        })}</div>`.toString();

      const input = $('[data-q]', root);
      input.addEventListener('input', () => {
        state.q = input.value; const pos = input.selectionStart;
        this.render(root); const i = $('[data-q]', root); i.focus(); i.setSelectionRange(pos, pos);
      });
    },
    wire(root, extraHandlers = {}) {
      wireActions(root, {
        new: () => openForm(null),
        edit: (id) => openForm(S.data[name].find((r) => r.id === id)),
        del: async (id) => {
          if (!(await confirmBox(t('Are you sure?'), { okText: t('Yes, delete'), danger: true }))) return;
          try { await S.backend.remove(name, id); toast(t('Deleted')); await reload(name); } catch (e) { toast(e.message, 'err'); }
        },
        filter: (v) => { state.filter = v; this.render(root); },
        csv: () => {
          const x = lookups(S.data);
          const cols = R.columns.map((c) => ({ label: t(c.label), csv: c.csv ? (r) => c.csv(r, x) : (r) => r[c.key] }));
          download(`${name}-${todayISO()}.csv`, csv(rows(), cols));
        },
        ...extraHandlers,
      });
    },
    openForm,
  };
}
