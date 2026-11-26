// Check-out / check-in (vehicle check card): phone-friendly wizard with QR scan, check-list, damage diagram,
// photos and signatures. Saving goes through one database call (check_out_in) so the rental or staff movement,
// the check card and its damages are written together or not at all.
import { html, raw, icon, $, $$, fmtDateTime, plate, carName, todayISO } from '../util.js';
import { t } from '../i18n.js';
import { table, actBtn, wireActions, openModal, closeModal, toast, badge, plateTag } from '../ui.js';
import { lookups, masters, nameOf, carLabel } from '../schema.js';
import { FUEL } from '../rules.js';
import { printDoc } from './doc.js';
import { S, reload } from '../store.js';

export const DAMAGE_KINDS = ['scratch', 'dent', 'crack', 'broken', 'missing', 'stain', 'burn', 'other'];
const DAMAGE_COLOR = { scratch: '#e0a100', dent: '#e86a10', crack: '#d6336c', broken: '#c92a2a', missing: '#7048e8', stain: '#1c7ed6', burn: '#5c3d2e', other: '#495057' };

// ── QR codes ─────────────────────────────────────────────────────────────────
export const carLink = (v) => `${location.origin}${location.pathname}#/checkcard?car=${v.id}`;
export function qrSvg(text, cell = 4) {
  if (typeof window.qrcode !== 'function') return '';
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
export function printQrLabels(cars) {
  printDoc('Car QR labels', '', html`<p class="terms">Stick a label inside each car (for example on the driver's door frame). Scanning it on the check-out / check-in page opens that car.</p>
    <div class="qr-labels">${cars.map((v) => html`<div class="qr-label">${raw(qrSvg(carLink(v), 3))}<b>${plate(v)}</b><small>${carName(v)}</small></div>`)}</div>`);
}
function carFromText(text) {
  const s = String(text || '').trim();
  const m = s.match(/car=([0-9a-f-]{36})/i);
  if (m) return S.data.vehicles.find((v) => v.id === m[1]);
  const norm = (p) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return S.data.vehicles.find((v) => norm(`${v.plate_code}${v.plate_number}`) === norm(s) || norm(v.plate_number) === norm(s));
}
// Camera scan with the browser's built-in detector (Chrome / Android / recent Safari). Falls back to typing the plate.
function scanQr(onCar) {
  const supported = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  let stream = null; let stop = false;
  const w = openModal({
    title: html`${icon('qr-code')} ${t('Scan car QR')}`,
    body: html`${supported ? html`<video class="scan-video" playsinline muted></video><p class="muted small">${t('Point the camera at the QR label in the car.')}</p>` : html`<p class="muted">${t('This browser cannot scan QR codes. Type the plate instead.')}</p>`}
      <form class="form" data-manual><div class="fld"><label for="scan-plate">${t('Plate')}</label><input id="scan-plate" name="plate" placeholder="DD 71278" autocomplete="off"></div>
      <div class="form-actions"><button class="btn primary" type="submit">${icon('search')} ${t('Find car')}</button></div></form>`,
  });
  const done = (v) => { stop = true; stream?.getTracks().forEach((x) => x.stop()); closeModal(); onCar(v); };
  $('[data-manual]', w).addEventListener('submit', (e) => { e.preventDefault(); const v = carFromText(e.target.plate.value); if (v) done(v); else toast(t('No car with this plate'), 'err'); });
  new MutationObserver((_, o) => { if (!document.body.contains(w)) { o.disconnect(); stop = true; stream?.getTracks().forEach((x) => x.stop()); } }).observe(document.body, { childList: true });
  if (!supported) return;
  (async () => {
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = $('video', w); if (!video) return;
      video.srcObject = stream; await video.play();
      const tick = async () => {
        if (stop) return;
        try { const codes = await det.detect(video); const v = codes.map((c) => carFromText(c.rawValue)).find(Boolean); if (v) return done(v); } catch { /* frame not ready */ }
        setTimeout(tick, 250);
      };
      tick();
    } catch (e) { toast(`${t('Camera not available')}: ${e.message}`, 'err'); }
  })();
}

// ── Damage diagram ───────────────────────────────────────────────────────────
const EXTERIOR = `<rect x="70" y="20" width="160" height="360" rx="60" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M95 105 Q150 80 205 105 L195 150 Q150 138 105 150 Z" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M105 290 Q150 300 195 290 L205 330 Q150 350 95 330 Z" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="105" y="155" width="90" height="130" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"/>
  <rect x="50" y="70" width="20" height="50" rx="6" fill="currentColor" opacity=".35"/><rect x="230" y="70" width="20" height="50" rx="6" fill="currentColor" opacity=".35"/>
  <rect x="50" y="280" width="20" height="50" rx="6" fill="currentColor" opacity=".35"/><rect x="230" y="280" width="20" height="50" rx="6" fill="currentColor" opacity=".35"/>
  <line x1="70" y1="200" x2="230" y2="200" stroke="currentColor" stroke-width="1" opacity=".4"/>
  <text x="150" y="14" text-anchor="middle" font-size="11" fill="currentColor">FRONT</text><text x="150" y="396" text-anchor="middle" font-size="11" fill="currentColor">REAR</text>
  <text x="40" y="205" text-anchor="middle" font-size="11" fill="currentColor" transform="rotate(-90 40 205)">LEFT</text><text x="262" y="205" text-anchor="middle" font-size="11" fill="currentColor" transform="rotate(90 262 205)">RIGHT</text>`;
const INTERIOR = `<rect x="70" y="20" width="160" height="360" rx="40" fill="none" stroke="currentColor" stroke-width="3"/>
  <rect x="85" y="40" width="130" height="50" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="120" cy="65" r="16" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="85" y="120" width="55" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="2"/><rect x="160" y="120" width="55" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="85" y="220" width="130" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="85" y="310" width="130" height="55" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="150" y="14" text-anchor="middle" font-size="11" fill="currentColor">DASHBOARD</text><text x="150" y="342" text-anchor="middle" font-size="10" fill="currentColor">BOOT</text>`;

export function diagramSvg(view, marks, { interactive = false } = {}) {
  return html`<svg class="diagram ${interactive ? 'live' : ''}" viewBox="0 0 300 400" role="img" aria-label="${t(view)}" data-view="${view}">
    <rect width="300" height="400" fill="transparent"/>${raw(view === 'interior' ? INTERIOR : EXTERIOR)}
    ${marks.filter((d) => d.view === view).map((d, i) => html`<g class="mark ${d.old ? 'old' : ''} ${d.status === 'repaired' ? 'fixed' : ''}" data-mark="${d._i ?? i}" transform="translate(${(d.x * 3).toFixed(1)} ${(d.y * 4).toFixed(1)})">
      <circle r="9" fill="${d.old ? '#adb5bd' : DAMAGE_COLOR[d.kind] || '#495057'}" stroke="#fff" stroke-width="2"/>
      <text y="4" text-anchor="middle" font-size="10" fill="#fff" font-weight="700">${d.label ?? i + 1}</text></g>`)}
  </svg>`;
}
const legend = () => html`<div class="dmg-legend">${DAMAGE_KINDS.map((k) => html`<span><i style="background:${DAMAGE_COLOR[k]}"></i>${t(k)}</span>`)}<span><i style="background:#adb5bd"></i>${t('Already recorded')}</span></div>`;

// ── Photos ───────────────────────────────────────────────────────────────────
export function resizeImage(file, max = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo')); };
    img.src = url;
  });
}

// ── Signature pad ────────────────────────────────────────────────────────────
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d'); let drawing = false; let dirty = false;
  const fit = () => { const r = canvas.getBoundingClientRect(); canvas.width = Math.max(300, r.width * 2); canvas.height = 300; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; };
  fit();
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; dirty = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); e.preventDefault(); });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    value() {
      if (!dirty) return '';
      // White background + JPEG keeps the signature small (well under the database limit).
      const c = document.createElement('canvas'); c.width = 600; c.height = 180; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    },
  };
}

// ── What is happening with this car right now ────────────────────────────────
export function suggestFor(v) {
  const booked = S.data.rentals.filter((r) => r.vehicle_id === v.id && r.status === 'booked').sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0];
  const active = S.data.rentals.find((r) => r.vehicle_id === v.id && r.status === 'active');
  const mv = S.data.movements.find((m) => m.vehicle_id === v.id && m.status === 'open');
  if (active) return { kind: 'checkin', context: 'rental', rental_id: active.id };
  if (mv) return { kind: 'checkin', context: mv.kind, movement_id: mv.id };
  if (booked && v.status === 'available') return { kind: 'checkout', context: 'rental', rental_id: booked.id };
  return { kind: 'checkout', context: 'nrm' };
}

// ── Wizard ───────────────────────────────────────────────────────────────────
function wizard(root, start, onDone) {
  const x = lookups(S.data);
  const st = { step: 0, view: 'exterior', marks: [], photos: [], checklist: {}, ...start };
  const car = () => x.vehicles[st.vehicle_id];
  const STEPS = ['Car', 'Readings', 'Damages', 'Photos', 'Signatures'];
  const oldMarks = () => S.data.damages.filter((d) => d.vehicle_id === st.vehicle_id && d.status === 'open').map((d, i) => ({ ...d, old: true, label: '•', _i: `o${i}` }));
  const rentalOptions = () => S.data.rentals.filter((r) => r.vehicle_id === st.vehicle_id && r.status === (st.kind === 'checkout' ? 'booked' : 'active'));
  const movementOptions = () => S.data.movements.filter((m) => m.vehicle_id === st.vehicle_id && m.status === 'open' && m.kind === st.context);
  const items = masters(S.data, 'checklist');
  if (!Object.keys(st.checklist).length) items.forEach((i) => { st.checklist[i] = true; });

  const stepCar = () => {
    const v = car();
    return html`<div class="grid-form">
      <div class="fld span"><label>${t('Car')}</label><div class="row-gap"><select name="vehicle_id" data-w="car"><option value="">—</option>
        ${S.data.vehicles.filter((c) => c.status !== 'retired').map((c) => html`<option value="${c.id}" ${c.id === st.vehicle_id ? 'selected' : ''}>${carLabel(c)} · ${t(c.status)}</option>`)}</select>
        <button type="button" class="btn ghost" data-w="scan">${icon('scan-line')} ${t('Scan QR')}</button></div></div>
      ${v ? html`<div class="fld"><label>${t('Check')}</label><div class="seg">${['checkout', 'checkin'].map((k) => html`<button type="button" class="${st.kind === k ? 'on' : ''}" data-w="kind" data-v="${k}">${t(k === 'checkout' ? 'Check-out' : 'Check-in')}</button>`)}</div></div>
        <div class="fld"><label>${t('For')}</label><div class="seg">${[['rental', 'Rental'], ['nrm', 'Staff use (NRM)'], ['custody', 'Custody']].map(([k, l]) => html`<button type="button" class="${st.context === k ? 'on' : ''}" data-w="ctx" data-v="${k}">${t(l)}</button>`)}</div></div>
        ${st.context === 'rental' ? html`<div class="fld span"><label>${t('Rental agreement')}</label><select name="rental_id" data-w="pick">${rentalOptions().length ? '' : html`<option value="">${t('No matching rental for this car')}</option>`}
            ${rentalOptions().map((r) => html`<option value="${r.id}" ${r.id === st.rental_id ? 'selected' : ''}>${r.ref} · ${x.customers[r.customer_id]?.full_name} · ${fmtDateTime(r.start_at)} → ${fmtDateTime(r.end_at)}</option>`)}</select></div>`
        : st.kind === 'checkin' ? html`<div class="fld span"><label>${t('Staff movement')}</label><select name="movement_id" data-w="pick">${movementOptions().length ? '' : html`<option value="">${t('No open movement for this car')}</option>`}
            ${movementOptions().map((m) => html`<option value="${m.id}" ${m.id === st.movement_id ? 'selected' : ''}>${m.ref} · ${nameOf(S.data.employees, m.employee_id, (e) => e.full_name)} · ${fmtDateTime(m.out_at)}</option>`)}</select></div>`
          : html`<div class="fld"><label>${t('Employee')}<b class="req">*</b></label><select name="employee_id" data-w="field"><option value="">—</option>
              ${S.data.employees.filter((e) => e.active !== false).map((e) => html`<option value="${e.id}" ${e.id === st.employee_id ? 'selected' : ''}>${e.code} · ${e.full_name}</option>`)}</select></div>
            <div class="fld"><label>${t('Expected back')}</label><input type="datetime-local" name="expected_in_at" data-w="field" value="${st.expected_in_at || ''}"></div>
            <div class="fld span"><label>${t('Purpose')}</label><input name="purpose" maxlength="300" data-w="field" value="${st.purpose || ''}"></div>`}
        <div class="fld"><label>${t(st.kind === 'checkout' ? 'To branch' : 'Returned to branch')}</label><select name="branch_id" data-w="field"><option value="">—</option>
          ${S.data.branches.filter((b) => b.active !== false).map((b) => html`<option value="${b.id}" ${b.id === (st.branch_id ?? v.branch_id) ? 'selected' : ''}>${b.name}</option>`)}</select></div>
        <div class="car-mini">${plateTag(v)} <b>${carName(v)}</b> ${badge(v.status)}<small class="muted">${(+v.odometer).toLocaleString()} km · ${oldMarks().length} ${t('open damages')}</small></div>` : ''}
      </div>`;
  };
  const stepReadings = () => html`<div class="grid-form">
      <div class="fld"><label>${t('Odometer')}<b class="req">*</b></label><input type="number" inputmode="numeric" name="odometer" min="0" step="1" data-w="field" value="${st.odometer ?? car()?.odometer ?? ''}" required></div>
      <div class="fld"><label>${t('Fuel')}<b class="req">*</b></label><div class="seg fuel">${FUEL.map((f) => html`<button type="button" class="${(st.fuel || 'full') === f ? 'on' : ''}" data-w="fuel" data-v="${f}">${t(f)}</button>`)}</div></div>
      <div class="fld span"><label>${t('Check-list')}</label><div class="checklist">${items.map((i) => html`<label><input type="checkbox" data-check="${i}" ${st.checklist[i] ? 'checked' : ''}> ${i}</label>`)}</div>
        ${items.length ? '' : html`<small class="muted">${t('Add check-list items in Setup → Masters.')}</small>`}</div>
      <div class="fld span"><label>${t('Notes')}</label><textarea name="notes" rows="2" maxlength="2000" data-w="field">${st.notes || ''}</textarea></div></div>`;
  const stepDamages = () => html`<div class="seg">${['exterior', 'interior'].map((vw) => html`<button type="button" class="${st.view === vw ? 'on' : ''}" data-w="view" data-v="${vw}">${t(vw)}</button>`)}</div>
      <p class="muted small">${t('Tap the picture where the damage is. Grey dots are damages already recorded and not yet repaired.')}</p>
      <div class="diagram-wrap">${diagramSvg(st.view, [...oldMarks(), ...st.marks.map((m, i) => ({ ...m, _i: i, label: i + 1 }))], { interactive: true })}</div>${legend()}
      ${st.marks.length ? html`<ol class="dmg-list">${st.marks.map((m, i) => html`<li><b>${i + 1}</b> ${t(m.view)} · <span style="color:${DAMAGE_COLOR[m.kind]}">${t(m.kind)}</span> · ${t(m.severity)}${m.note ? ` · ${m.note}` : ''}${m.files?.length ? html` · ${icon('camera')} ${m.files.length}` : ''}
        <button type="button" class="icon-btn danger" data-w="unmark" data-v="${i}" aria-label="${t('Delete')}">${icon('trash-2')}</button></li>`)}</ol>` : html`<p class="muted small">${t('No new damage.')}</p>`}`;
  const stepPhotos = () => html`<label class="drop">${icon('camera')} <span>${t('Take or add photos')}</span><input type="file" accept="image/*" capture="environment" multiple data-w="photos" hidden></label>
      <div class="thumbs">${st.photos.map((p, i) => html`<figure><img src="${p.url}" alt=""><button type="button" class="icon-btn danger" data-w="unphoto" data-v="${i}" aria-label="${t('Delete')}">${icon('x')}</button></figure>`)}</div>
      <p class="muted small">${t('Photos are reduced to about 1280 px before upload.')} ${st.photos.length}/30</p>`;
  const stepSign = () => html`<div class="grid-form">
      <div class="fld span"><label>${t(st.context === 'rental' ? 'Customer signature' : 'Employee signature')}</label><canvas class="sig" data-sig="customer"></canvas><button type="button" class="btn sm ghost" data-w="clear" data-v="customer">${t('Clear')}</button></div>
      <div class="fld"><label>${t('Staff name')}</label><input name="staff_name" maxlength="120" data-w="field" value="${st.staff_name ?? S.me?.full_name ?? ''}"></div>
      <div class="fld span"><label>${t('Staff signature')}</label><canvas class="sig" data-sig="staff"></canvas><button type="button" class="btn sm ghost" data-w="clear" data-v="staff">${t('Clear')}</button></div></div>
      <div class="quote">${(() => { const v = car(); return html`<div><span>${t('Car')}</span><b>${plate(v)}</b></div><div><span>${t('Odometer')}</span><b>${st.odometer}</b></div><div><span>${t('Fuel')}</span><b>${t(st.fuel || 'full')}</b></div><div><span>${t('New damages')}</span><b>${st.marks.length}</b></div><div><span>${t('Photos')}</span><b>${st.photos.length}</b></div>`; })()}</div>`;
  const body = [stepCar, stepReadings, stepDamages, stepPhotos, stepSign];
  let pads = {};

  const save = (form) => {
    form?.querySelectorAll('[data-w=field],[data-w=pick]').forEach((el) => { st[el.name] = el.value; });
    form?.querySelectorAll('[data-check]').forEach((el) => { st.checklist[el.dataset.check] = el.checked; });
    if (pads.customer) { st.customer_signature = pads.customer.value() || st.customer_signature || ''; st.staff_signature = pads.staff.value() || st.staff_signature || ''; }
  };
  const valid = () => {
    if (st.step === 0) {
      if (!car()) return t('Pick the car');
      if (st.context === 'rental' && !st.rental_id) return t('Pick the rental agreement');
      if (st.context !== 'rental' && st.kind === 'checkin' && !st.movement_id) return t('Pick the staff movement');
      if (st.context !== 'rental' && st.kind === 'checkout' && !st.employee_id) return t('Pick the employee who takes the car');
      if (st.context !== 'rental' && st.kind === 'checkout' && car().status !== 'available') return `${t('This car is not available')} (${t(car().status)})`;
    }
    if (st.step === 1) {
      if (st.odometer === '' || st.odometer == null || +st.odometer < 0) return t('Enter the odometer reading');
      const min = st.kind === 'checkin' ? (st.context === 'rental' ? S.data.rentals.find((r) => r.id === st.rental_id)?.odometer_out : S.data.movements.find((m) => m.id === st.movement_id)?.odometer_out) : null;
      if (min != null && +st.odometer < +min) return `${t('Odometer cannot be lower than when the car went out')} (${min})`;
    }
    return '';
  };
  const draw = () => {
    root.innerHTML = html`<div class="page-head"><div><h1>${icon('clipboard-check')} ${t(st.kind === 'checkin' ? 'Check-in' : 'Check-out')}</h1><p class="muted">${car() ? html`${plate(car())} · ${carName(car())}` : t('Vehicle check card')}</p></div>
      <div class="head-actions"><button class="btn ghost" data-w="cancel">${icon('x')} ${t('Cancel')}</button></div></div>
      <ol class="steps">${STEPS.map((s, i) => html`<li class="${i === st.step ? 'on' : i < st.step ? 'done' : ''}"><b>${i + 1}</b><span>${t(s)}</span></li>`)}</ol>
      <form class="card wiz" novalidate>${body[st.step]()}<div class="form-error" hidden></div>
      <div class="form-actions">${st.step ? html`<button type="button" class="btn ghost" data-w="back">${icon('arrow-left-right')} ${t('Back')}</button>` : ''}
        ${st.step < STEPS.length - 1 ? html`<button type="button" class="btn primary" data-w="next">${t('Next')}</button>` : html`<button type="submit" class="btn primary">${icon('check')} ${t('Save check card')}</button>`}</div></form>`.toString();
    pads = {};
    $$('canvas[data-sig]', root).forEach((c) => { pads[c.dataset.sig] = signaturePad(c); });
  };
  const err = (m) => { const e = $('.form-error', root); if (e) { e.textContent = m; e.hidden = !m; } if (m) e?.scrollIntoView({ block: 'nearest' }); };
  const addMark = (e) => {
    const svg = e.target.closest('svg.diagram.live'); if (!svg || e.target.closest('.mark.old')) return;
    const hit = e.target.closest('.mark:not(.old)');
    if (hit) return;
    const r = svg.getBoundingClientRect();
    const px = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); const py = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    const w = openModal({
      title: t('Add damage'),
      body: html`<form class="form"><div class="grid-form">
        <div class="fld"><label>${t('Kind')}</label><select name="kind">${DAMAGE_KINDS.map((k) => html`<option value="${k}">${t(k)}</option>`)}</select></div>
        <div class="fld"><label>${t('Severity')}</label><select name="severity"><option value="minor">${t('minor')}</option><option value="major">${t('major')}</option></select></div>
        <div class="fld span"><label>${t('Notes')}</label><input name="note" maxlength="300" list="dl-defect"><datalist id="dl-defect">${masters(S.data, 'defect_type').map((d) => html`<option value="${d}"></option>`)}</datalist></div>
        <div class="fld span"><label>${t('Photo')}</label><input type="file" name="photo" accept="image/*" capture="environment" multiple></div></div>
        <div class="form-actions"><button type="button" class="btn ghost" data-close>${t('Cancel')}</button><button class="btn primary" type="submit">${icon('check')} ${t('Add')}</button></div></form>`,
    });
    $('form', w).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try {
        const files = await Promise.all([...f.photo.files].slice(0, 5).map((x) => resizeImage(x)));
        st.marks.push({ view: st.view, x: +px.toFixed(2), y: +py.toFixed(2), kind: f.kind.value, severity: f.severity.value, note: f.note.value.trim(), files });
        closeModal(); draw();
      } catch (ex) { toast(ex.message, 'err'); }
    });
  };

  root.onclick = async (e) => {
    if (e.target.closest('svg.diagram.live')) return addMark(e);
    const b = e.target.closest('[data-w]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
    const form = $('form.wiz', root); const a = b.dataset.w; const val = b.dataset.v;
    if (a === 'cancel') return onDone(null);
    save(form);
    if (a === 'scan') return scanQr((v) => { Object.assign(st, { vehicle_id: v.id, rental_id: null, movement_id: null, ...suggestFor(v) }); draw(); });
    if (a === 'kind' || a === 'ctx') {
      if (a === 'kind') st.kind = val; else st.context = val;
      st.rental_id = rentalOptions()[0]?.id || null; st.movement_id = movementOptions()[0]?.id || null; return draw();
    }
    if (a === 'fuel') { st.fuel = val; return draw(); }
    if (a === 'view') { st.view = val; return draw(); }
    if (a === 'unmark') { st.marks.splice(+val, 1); return draw(); }
    if (a === 'unphoto') { URL.revokeObjectURL(st.photos[+val].url); st.photos.splice(+val, 1); return draw(); }
    if (a === 'clear') { pads[val]?.clear(); st[`${val === 'customer' ? 'customer' : 'staff'}_signature`] = ''; return; }
    if (a === 'back') { st.step--; return draw(); }
    if (a === 'next') { const m = valid(); if (m) return err(m); st.step++; return draw(); }
  };
  root.onchange = async (e) => {
    const el = e.target;
    if (el.dataset.w === 'car') { save($('form.wiz', root)); const v = x.vehicles[el.value]; st.vehicle_id = el.value || null; st.odometer = null; Object.assign(st, { rental_id: null, movement_id: null }, v ? suggestFor(v) : {}); return draw(); }
    if (el.dataset.w === 'photos') {
      try {
        for (const f of [...el.files].slice(0, 30 - st.photos.length)) { const blob = await resizeImage(f); st.photos.push({ blob, url: URL.createObjectURL(blob) }); }
      } catch (ex) { toast(ex.message, 'err'); }
      save($('form.wiz', root)); draw();
    }
  };
  root.onsubmit = async (e) => {
    e.preventDefault(); const form = e.target; save(form);
    const btn = $('button[type=submit]', form); btn.disabled = true; err('');
    try {
      const folder = `${todayISO()}-${plate(car()).replace(/\s+/g, '')}`;
      const up = async (blob) => S.backend.uploadPhoto(blob, folder);
      const photos = []; for (const p of st.photos) photos.push(await up(p.blob));
      const damages = [];
      for (const m of st.marks) { const ph = []; for (const f of m.files || []) ph.push(await up(f)); damages.push({ view: m.view, x: m.x, y: m.y, kind: m.kind, severity: m.severity, note: m.note, photos: ph }); }
      const payload = {
        kind: st.kind, context: st.context, vehicle_id: st.vehicle_id, rental_id: st.context === 'rental' ? st.rental_id : null, movement_id: st.context !== 'rental' && st.kind === 'checkin' ? st.movement_id : null,
        employee_id: st.employee_id || null, purpose: st.purpose || '', expected_in_at: st.expected_in_at ? new Date(st.expected_in_at).toISOString() : null,
        branch_id: st.branch_id || null, odometer: +st.odometer, fuel: st.fuel || 'full', checklist: st.checklist, notes: st.notes || '', staff_name: st.staff_name ?? S.me?.full_name ?? '',
        customer_signature: st.customer_signature || '', staff_signature: st.staff_signature || '', photos, damages, at: new Date().toISOString(),
      };
      const res = await S.backend.rpc('check_out_in', { payload });
      st.photos.forEach((p) => URL.revokeObjectURL(p.url));
      toast(`${t('Saved')} · ${res.ref}`);
      await reload('inspections', 'rentals', 'movements');
      onDone(res);
    } catch (ex) { err(ex.message); btn.disabled = false; }
  };
  draw();
}

// ── Printable check card ─────────────────────────────────────────────────────
export async function printCheckCard(id) {
  let ins;
  try { ins = await S.backend.get('inspections', id); } catch (e) { return toast(e.message, 'err'); }
  if (!ins) return;
  const x = lookups(S.data); const v = x.vehicles[ins.vehicle_id];
  const r = ins.rental_id && x.rentals[ins.rental_id]; const c = r && x.customers[r.customer_id];
  const mv = ins.movement_id && S.data.movements.find((m) => m.id === ins.movement_id);
  const marks = S.data.damages.filter((d) => d.vehicle_id === ins.vehicle_id && (d.inspection_id === ins.id || (d.status === 'open' && new Date(d.created_at) < new Date(ins.at))))
    .map((d, i) => ({ ...d, label: i + 1, old: d.inspection_id !== ins.id }));
  const urls = await S.backend.photoUrls([...(ins.photos || []), ...marks.flatMap((d) => d.photos || [])]).catch(() => ({}));
  printDoc(`Vehicle check card · ${ins.kind === 'checkout' ? 'Check-out' : 'Check-in'}`, ins.ref, html`
    <div class="cols"><section><h3>Vehicle</h3><p><b>${plate(v)}</b> · ${carName(v)} ${v?.year || ''}</p><p>${v?.color || ''} ${v?.vin ? `· VIN ${v.vin}` : ''}</p>
      <p>Odometer <b>${(+ins.odometer).toLocaleString()} km</b> · Fuel <b>${ins.fuel}</b></p></section>
      <section><h3>${r ? 'Rental' : 'Staff movement'}</h3>${r ? html`<p><b class="mono">${r.ref}</b> · ${c?.full_name}</p><p>${c?.phone || ''} · Licence ${c?.license_number || '—'}</p><p>${fmtDateTime(r.start_at)} → ${fmtDateTime(r.end_at)}</p>`
        : mv ? html`<p><b class="mono">${mv.ref}</b> · ${t(mv.kind === 'nrm' ? 'Staff use (NRM)' : 'Custody')}</p><p>${nameOf(S.data.employees, mv.employee_id, (e) => e.full_name)}</p><p>${mv.purpose}</p>` : ''}
        <p>${fmtDateTime(ins.at)} · ${ins.staff_name}</p></section></div>
    <div class="cols"><section><h3>Check-list</h3><ul class="cl">${Object.entries(ins.checklist || {}).map(([k, ok]) => html`<li>${ok ? '☑' : '☐'} ${k}</li>`)}</ul>${ins.notes ? html`<p>${ins.notes}</p>` : ''}</section>
      <section><h3>Damages</h3><div class="print-diagrams">${diagramSvg('exterior', marks)}${diagramSvg('interior', marks)}</div>
        <ol class="cl">${marks.map((d) => html`<li>${d.label}. ${d.view} · ${d.kind} · ${d.severity}${d.note ? ` · ${d.note}` : ''}${d.old ? ' (earlier)' : ''}${d.status === 'repaired' ? ' (repaired)' : ''}</li>`)}</ol></section></div>
    ${Object.keys(urls).length ? html`<div class="print-photos">${Object.values(urls).slice(0, 12).map((u) => html`<img src="${u}" alt="">`)}</div>` : ''}
    <div class="sign"><div>${ins.customer_signature ? html`<img class="sig-img" src="${ins.customer_signature}" alt="">` : ''}${r ? 'Customer' : 'Employee'} signature</div>
      <div>${ins.staff_signature ? html`<img class="sig-img" src="${ins.staff_signature}" alt="">` : ''}Staff · ${ins.staff_name}</div></div>`, { date: ins.at });
}

async function showCard(id) {
  const ins = S.data.inspections.find((i) => i.id === id); if (!ins) return;
  const x = lookups(S.data);
  const marks = S.data.damages.filter((d) => d.inspection_id === id).map((d, i) => ({ ...d, label: i + 1 }));
  const urls = await S.backend.photoUrls([...(ins.photos || []), ...marks.flatMap((d) => d.photos || [])]).catch(() => ({}));
  const w = openModal({
    title: html`${ins.ref} ${badge(ins.kind, t(ins.kind === 'checkout' ? 'Check-out' : 'Check-in'))}`, wide: true,
    body: html`<div class="detail"><section><h3>${icon('car')} ${t('Car')}</h3><p>${plateTag(x.vehicles[ins.vehicle_id])} ${carName(x.vehicles[ins.vehicle_id])}</p>
        <p class="muted">${(+ins.odometer).toLocaleString()} km · ${t('Fuel')} ${t(ins.fuel)}</p><p class="muted">${fmtDateTime(ins.at)} · ${ins.staff_name}</p></section>
      <section><h3>${icon('square-check-big')} ${t('Check-list')}</h3><ul class="cl">${Object.entries(ins.checklist || {}).map(([k, ok]) => html`<li class="${ok ? '' : 'neg'}">${ok ? '✓' : '✗'} ${k}</li>`)}</ul></section>
      <section><h3>${icon('circle-alert')} ${t('Damages')}</h3><div class="mini-diagrams">${diagramSvg('exterior', marks)}${diagramSvg('interior', marks)}</div></section></div>
      ${ins.notes ? html`<p class="note">${ins.notes}</p>` : ''}
      ${Object.keys(urls).length ? html`<div class="thumbs">${Object.values(urls).map((u) => html`<figure><a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt=""></a></figure>`)}</div>` : ''}
      <div class="form-actions"><button class="btn primary" data-pc="${id}">${icon('printer')} ${t('Print check card')}</button></div>`,
  });
  w.addEventListener('click', (e) => { const b = e.target.closest('[data-pc]'); if (b) printCheckCard(b.dataset.pc); });
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function mountCheckCard(root, params) {
  let mode = 'list'; const q = { kind: '' };
  const listView = () => {
    const x = lookups(S.data);
    const rows = S.data.inspections.filter((i) => !q.kind || i.kind === q.kind);
    const waiting = S.data.rentals.filter((r) => r.status === 'booked' && new Date(r.start_at) < new Date(Date.now() + 86400000));
    const due = S.data.rentals.filter((r) => r.status === 'active' && new Date(r.end_at) < new Date(Date.now() + 86400000));
    const canDo = S.can('inspections', 'write');
    root.onclick = null; root.onchange = null; root.onsubmit = null;
    root.innerHTML = html`<div class="page-head"><div><h1>${icon('clipboard-check')} ${t('Check-out / check-in')}</h1><p class="muted">${t('Vehicle check cards with check-list, damages, photos and signatures.')}</p></div>
      <div class="head-actions"><button class="btn ghost" data-act="qr">${icon('qr-code')} ${t('Print QR labels')}</button>
        ${canDo ? html`<button class="btn ghost" data-act="scan">${icon('scan-line')} ${t('Scan QR')}</button><button class="btn primary" data-act="start">${icon('plus')} ${t('New check card')}</button>` : ''}</div></div>
      ${canDo && (waiting.length || due.length) ? html`<div class="quick">${waiting.map((r) => html`<button class="chip" data-act="go" data-id="${r.vehicle_id}">${icon('key-round')} ${t('Check-out')} · ${r.ref} · ${plate(x.vehicles[r.vehicle_id])}</button>`)}
        ${due.map((r) => html`<button class="chip ${new Date(r.end_at) < new Date() ? 'alert' : ''}" data-act="go" data-id="${r.vehicle_id}">${icon('undo-2')} ${t('Check-in')} · ${r.ref} · ${plate(x.vehicles[r.vehicle_id])}</button>`)}</div>` : ''}
      <div class="toolbar"><div class="chips">${['', 'checkout', 'checkin'].map((k) => html`<button class="chip ${q.kind === k ? 'on' : ''}" data-act="kind" data-id="${k}">${t(k === '' ? 'All' : k === 'checkout' ? 'Check-out' : 'Check-in')}</button>`)}</div></div>
      ${table(rows, [
        { label: 'Reference', cell: (i) => html`<button class="link mono" data-act="open" data-id="${i.id}">${i.ref}</button>` },
        { label: 'When', cell: (i) => fmtDateTime(i.at) },
        { label: 'Check', cell: (i) => html`${badge(i.kind, t(i.kind === 'checkout' ? 'Check-out' : 'Check-in'))}<small class="muted block">${t(i.context === 'rental' ? 'Rental' : i.context === 'nrm' ? 'Staff use (NRM)' : 'Custody')}</small>` },
        { label: 'Car', cell: (i) => html`${plateTag(x.vehicles[i.vehicle_id])}<small class="muted block">${carName(x.vehicles[i.vehicle_id])}</small>` },
        { label: 'Agreement', cell: (i) => (i.rental_id ? html`<a class="mono" href="#/rentals?open=${i.rental_id}">${x.rentals[i.rental_id]?.ref}</a><small class="muted block">${x.customers[x.rentals[i.rental_id]?.customer_id]?.full_name || ''}</small>` : html`<span class="mono">${S.data.movements.find((m) => m.id === i.movement_id)?.ref || '—'}</span>`) },
        { label: 'Odometer', cell: (i) => html`${(+i.odometer).toLocaleString()}<small class="muted block">${t('Fuel')} ${t(i.fuel)}</small>`, cls: 'num' },
        { label: 'Damages', cell: (i) => { const n = S.data.damages.filter((d) => d.inspection_id === i.id).length; return n ? badge('major', String(n)) : '—'; }, cls: 'num' },
      ], { empty: 'No check cards yet', actions: (i) => html`${actBtn('open', i.id, 'eye', 'Open')}${actBtn('print', i.id, 'printer', 'Print check card')}` })}`.toString();
  };
  const startWizard = (start = {}) => {
    mode = 'wizard';
    wizard(root, { kind: 'checkout', context: 'rental', ...start }, (res) => {
      mode = 'list'; history.replaceState(null, '', '#/checkcard'); listView();
      if (res?.id) showCard(res.id);
    });
  };
  const startForCar = (v) => startWizard({ vehicle_id: v.id, ...suggestFor(v) });
  wireActions(root, {
    start: () => startWizard(), scan: () => scanQr(startForCar), go: (id) => startForCar(S.data.vehicles.find((v) => v.id === id)),
    open: (id) => showCard(id), print: (id) => printCheckCard(id), kind: (k) => { q.kind = k; listView(); },
    qr: () => printQrLabels(S.data.vehicles.filter((v) => v.status !== 'retired')),
  });
  const car = params?.get('car') && S.data.vehicles.find((v) => v.id === params.get('car'));
  if (car && S.can('inspections', 'write')) startForCar(car); else listView();
  return () => { if (mode === 'list') listView(); };
}
