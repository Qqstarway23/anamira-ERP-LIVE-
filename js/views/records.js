// Generic list page for any resource in schema.js: search, filters, table, CSV, create/edit/delete.
import { html, icon, $, matches, csv, download, todayISO } from '../util.js';
import { t } from '../i18n.js';
import { table, actBtn, wireActions, formModal, confirmBox, toast } from '../ui.js';
import { RESOURCES, lookups } from '../schema.js';
import { S, reload } from '../store.js';

// opts: headerExtra, rowActions, beforeTable, viewToggle, presets {key: {label, fn}}, initial {filter, extra, preset, q},
//       formExtra(row), onFormMount(w, row), afterSave(saved, isNew), title
export function recordsView(name, opts = {}) {
  const { headerExtra, rowActions, beforeTable, viewToggle, presets = {}, initial = {}, formExtra, onFormMount, afterSave } = opts;
  const R = RESOURCES[name];
  const state = { q: initial.q || '', filter: initial.filter || '', extra: initial.extra || '', preset: initial.preset || '' };

  function rows() {
    const x = lookups(S.data);
    const q = state.q.toLowerCase();
    const keys = R.search.map((k) => (typeof k === 'function' ? (r) => k(r, x) : k));
    const p = presets[state.preset]?.fn;
    return S.data[name].filter((r) => (!state.filter || String(r[R.filters.key]) === state.filter)
      && (!state.extra || String(r[R.extraFilters.key]) === state.extra)
      && (!p || p(r, x)) && matches(r, q, keys));
  }

  function openForm(row, prefill = {}) {
    const isNew = !row;
    const fields = (!isNew && R.editFields) ? R.editFields(row) : R.fields;
    const start = isNew ? prefill : (R.toForm ? R.toForm(row) : row);
    formModal({
      title: isNew ? `${t('New')} · ${t(R.title)}` : `${t('Edit')} · ${t(R.title)}`,
      fields, row: start, data: S.data, extra: formExtra?.(row) || '',
      onMount: (w) => onFormMount?.(w, row),
      onSubmit: async (vals) => {
        const out = R.fromForm ? R.fromForm(vals, row) : vals;
        const saved = isNew ? await S.backend.insert(name, out) : await S.backend.update(name, row.id, out);
        toast(t('Saved')); await reload(name);
        afterSave?.(saved, isNew);
      },
    });
  }

  return {
    state,
    render(root) {
      const x = lookups(S.data);
      const list = rows();
      const canWrite = S.can(name, 'write');
      const canEdit = S.can(name, R.permEdit || 'write');
      const canRemove = S.can(name, 'remove');
      const cols = R.columns.map((c) => ({ ...c, cell: (r) => c.cell(r, x) }));
      const chips = (F, cur, act) => {
        if (!F) return '';
        const counts = Object.fromEntries(F.values.map((v) => [v, S.data[name].filter((r) => String(r[F.key]) === v).length]));
        return html`<div class="chips" role="tablist">
          <button class="chip ${!cur ? 'on' : ''}" data-act="${act}" data-id="">${t('All')} <i>${S.data[name].length}</i></button>
          ${F.values.filter((v) => counts[v] || cur === v).map((v) => html`<button class="chip ${cur === v ? 'on' : ''}" data-act="${act}" data-id="${v}">${t(v)} <i>${counts[v]}</i></button>`)}</div>`;
      };
      root.innerHTML = html`
        <div class="page-head">
          <div><h1>${icon(R.icon)} ${t(opts.title || R.title)}</h1><p class="muted">${list.length} / ${S.data[name].length}</p></div>
          <div class="head-actions">${headerExtra?.() || ''}
            <button class="btn ghost" data-act="csv">${icon('download')} ${t('Export CSV')}</button>
            ${canWrite ? html`<button class="btn primary" data-act="new">${icon('plus')} ${t('New')}</button>` : html`<span class="badge gray">${icon('lock')} ${t('Read only')}</span>`}
          </div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input type="search" placeholder="${t('Search…')}" value="${state.q}" data-q aria-label="${t('Search…')}"></label>
          ${chips(R.filters, state.filter, 'filter')}
          ${viewToggle?.() || ''}
        </div>
        ${R.extraFilters || Object.keys(presets).length ? html`<div class="toolbar sub">
          ${R.extraFilters ? html`<label class="mini-select">${t(R.extraFilters.label || 'Kind')}<select data-extra><option value="">${t('All')}</option>
            ${R.extraFilters.values.map((v) => html`<option value="${v}" ${state.extra === v ? 'selected' : ''}>${t(v)}</option>`)}</select></label>` : ''}
          ${Object.keys(presets).length ? html`<div class="chips">${Object.entries(presets).map(([k, p]) => {
            const n = S.data[name].filter((r) => p.fn(r, x)).length;
            return html`<button class="chip ${state.preset === k ? 'on' : ''} ${n && p.alert ? 'alert' : ''}" data-act="preset" data-id="${state.preset === k ? '' : k}">${t(p.label)} <i>${n}</i></button>`;
          })}</div>` : ''}</div>` : ''}
        ${beforeTable?.(list) || ''}
        <div data-body>${(viewToggle && viewToggle.custom?.(list)) || table(list, cols, {
          actions: (canEdit || canRemove || rowActions) ? (r) => html`${rowActions?.(r) || ''}${canEdit && (!R.canEditRow || R.canEditRow(r)) ? actBtn('edit', r.id, 'pencil', 'Edit') : ''}${canRemove ? actBtn('del', r.id, 'trash-2', 'Delete', 'danger') : ''}` : null,
        })}</div>`.toString();

      const input = $('[data-q]', root);
      input.addEventListener('input', () => {
        state.q = input.value; const pos = input.selectionStart;
        this.render(root); const i = $('[data-q]', root); i.focus(); i.setSelectionRange(pos, pos);
      });
      $('[data-extra]', root)?.addEventListener('change', (e) => { state.extra = e.target.value; this.render(root); });
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
        preset: (v) => { state.preset = v; this.render(root); },
        csv: () => {
          const x = lookups(S.data);
          const cols = R.columns.map((c) => ({ label: t(c.label), csv: c.csv ? (r) => c.csv(r, x) : (r) => r[c.key] }));
          download(`${name}-${todayISO()}.csv`, csv(rows(), cols));
        },
        ...extraHandlers,
      });
    },
    openForm,
    rows,
  };
}

// A page that is just the generic list.
export const simplePage = (name, opts) => (root) => { const v = recordsView(name, opts); v.wire(root); v.render(root); return () => v.render(root); };
