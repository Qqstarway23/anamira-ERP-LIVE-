// Camera scanning, all on the device (nothing is sent to an outside service):
// • car QR labels (the browser's own QR reader, or the bundled jsQR on browsers without one, such as iPhone Safari)
// • the Emirates ID / passport: the machine-readable lines (<<<) are read with the bundled Tesseract OCR
//   and checked with their check digits. A customer QR printed on our contracts is also accepted.
import { html, icon, $, fmtDate } from '../util.js';
import { t } from '../i18n.js';
import { openModal, closeModal, toast, formModal, badge } from '../ui.js';
import { parseMrz, formatEid } from '../mrz.js';
import { S, reload } from '../store.js';

const V = 'assets/vendor/';
const loaded = {};
function loadScript(src) {
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error(`${t('Could not load')} ${src}`)); };
    document.head.append(s);
  }));
}

// ── Camera ───────────────────────────────────────────────────────────────────
const hasCamera = () => !!navigator.mediaDevices?.getUserMedia;
async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  video.srcObject = stream; await video.play();
  return stream;
}
// Stop the camera when the modal closes, however it closes.
function onClose(w, fn) {
  new MutationObserver((_, o) => { if (!document.body.contains(w)) { o.disconnect(); fn(); } }).observe(document.body, { childList: true });
}
// A frame (or part of it, as fractions of width/height) on a canvas, scaled to at most maxW wide.
function grab(src, { x = 0, y = 0, w = 1, h = 1, maxW = 1400 } = {}) {
  const sw = src.videoWidth || src.naturalWidth || src.width; const sh = src.videoHeight || src.naturalHeight || src.height;
  const cw = Math.round(sw * w); const ch = Math.round(sh * h); const k = Math.min(1, maxW / cw);
  const c = document.createElement('canvas'); c.width = Math.round(cw * k); c.height = Math.round(ch * k);
  c.getContext('2d', { willReadFrequently: true }).drawImage(src, sw * x, sh * y, cw, ch, 0, 0, c.width, c.height);
  return c;
}

// ── QR ───────────────────────────────────────────────────────────────────────
let detector;
async function readQr(src) {
  if ('BarcodeDetector' in window) {
    try {
      detector ||= new window.BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(src); return codes.map((c) => c.rawValue);
    } catch { /* fall back to jsQR */ }
  }
  await loadScript(`${V}jsQR-1.4.0.js`);
  const c = grab(src, { maxW: 800 }); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const r = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
  return r ? [r.data] : [];
}

export function carFromText(text) {
  const s = String(text || '').trim();
  const m = s.match(/car=([0-9a-f-]{36})/i);
  if (m) return S.data.vehicles.find((v) => v.id === m[1]);
  const norm = (p) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s ? S.data.vehicles.find((v) => norm(`${v.plate_code}${v.plate_number}`) === norm(s) || norm(v.plate_number) === norm(s)) : null;
}

// Scan the QR label in a car (or type the plate). onCar(vehicle).
export function scanCar(onCar, { title = 'Scan car QR' } = {}) {
  let stream = null; let stop = false;
  const w = openModal({
    title: html`${icon('qr-code')} ${t(title)}`,
    body: html`${hasCamera() ? html`<div class="scan-box"><video class="scan-video" playsinline muted></video><i class="scan-square"></i></div><p class="muted small" data-status>${t('Point the camera at the QR label in the car.')}</p>` : html`<p class="muted">${t('This browser cannot use the camera. Type the plate instead.')}</p>`}
      <form class="form" data-manual><div class="fld"><label for="scan-plate">${t('Plate')}</label><input id="scan-plate" name="plate" placeholder="DD 71278" autocomplete="off"></div>
      <div class="form-actions"><button class="btn primary" type="submit">${icon('search')} ${t('Find car')}</button></div></form>`,
  });
  const end = () => { stop = true; stream?.getTracks().forEach((x) => x.stop()); };
  const done = (v) => { end(); closeModal(); onCar(v); };
  $('[data-manual]', w).addEventListener('submit', (e) => { e.preventDefault(); const v = carFromText(e.target.plate.value); if (v) done(v); else toast(t('No car with this plate'), 'err'); });
  onClose(w, end);
  if (!hasCamera()) return w;
  (async () => {
    try {
      const video = $('video', w); stream = await startCamera(video);
      const tick = async () => {
        if (stop) return;
        try {
          const codes = await readQr(video); const v = codes.map(carFromText).find(Boolean);
          if (v) return done(v);
          if (codes.length) $('[data-status]', w).textContent = t('This QR is not one of our car labels.');
        } catch { /* frame not ready */ }
        setTimeout(tick, 250);
      };
      tick();
    } catch (e) { const st = $('[data-status]', w); if (st) st.textContent = `${t('Camera not available')}: ${e.message}`; }
  })();
  return w;
}

// ── OCR (Tesseract, loaded the first time it is needed, about 5 MB) ──────────
let ocrP = null;
function ocr() {
  return (ocrP ||= (async () => {
    await loadScript(`${V}tesseract/tesseract.min.js`);
    const base = new URL(`${V}tesseract/`, location.href).href;
    const w = await window.Tesseract.createWorker('ocrb_int', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, ''), workerBlobURL: false });
    await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6', preserve_interword_spaces: '0' });
    return w;
  })().catch((e) => { ocrP = null; throw e; }));
}
// Grey, stretched contrast: the machine-readable lines are black on a light background.
function prep(c) {
  const g = c.getContext('2d', { willReadFrequently: true }); const d = g.getImageData(0, 0, c.width, c.height); const p = d.data;
  let lo = 255; let hi = 0; const grey = new Uint8ClampedArray(p.length / 4);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; grey[j] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = (grey[j] - lo) * k; p[i] = p[i + 1] = p[i + 2] = v; }
  g.putImageData(d, 0, 0); return c;
}
function rotate180(c) {
  const r = document.createElement('canvas'); r.width = c.width; r.height = c.height;
  const g = r.getContext('2d'); g.translate(c.width, c.height); g.rotate(Math.PI); g.drawImage(c, 0, 0); return r;
}
// Read the document lines from an image or video frame. Returns parseMrz()'s result or null.
export async function readMrzImage(src, { region, both = false } = {}) {
  const w = await ocr();
  const tries = [prep(grab(src, region))];
  if (both) tries.push(rotate180(tries[0]));
  let bestTry = null;
  for (const c of tries) {
    const { data } = await w.recognize(c);
    try { const r = parseMrz(data.text); if (r.valid) return r; bestTry ||= r; } catch { /* no lines in this image */ }
  }
  return bestTry;
}

// ── Emirates ID ──────────────────────────────────────────────────────────────
const digits = (s) => String(s || '').replace(/\D/g, '');
export function findCustomer(d) {
  const eid = digits(d.id_number); const pass = String(d.passport_number || '').toUpperCase();
  return S.data.customers.find((c) => (eid.length >= 8 && digits(c.id_number) === eid) || (pass && String(c.passport_number || '').toUpperCase() === pass)) || null;
}
function customerFromQr(text) {
  const m = String(text || '').match(/customer=([0-9a-f-]{36})/i);
  if (m) return S.data.customers.find((c) => c.id === m[1]) || null;
  const eid = formatEid(text); return eid ? findCustomer({ id_number: eid }) : null;
}

// Scan the back of the Emirates ID (or a passport photo page, or a customer QR from one of our contracts).
// onRead({ data, valid, warn }) for a document, or onRead({ customer }) for a known customer.
export function scanIdDocument(onRead) {
  let stream = null; let stop = false; let busy = false; let tries = 0;
  const cam = hasCamera();
  const w = openModal({
    title: html`${icon('id-card')} ${t('Scan Emirates ID')}`, wide: false,
    body: html`${cam ? html`<div class="scan-box id"><video class="scan-video" playsinline muted></video><i class="scan-card"><em>${t('ID number lines')} &lt;&lt;&lt;</em></i></div>` : ''}
      <p class="small scan-status" data-status>${cam ? t('Hold the back of the Emirates ID inside the frame, with the 3 lines of <<< at the bottom. Good light, no glare.') : t('This browser cannot use the camera. Take a photo of the back of the ID instead.')}</p>
      <div class="form-actions wrap">
        <label class="btn ghost">${icon('image')} ${t('Take or choose a photo')}<input type="file" accept="image/*" capture="environment" data-photo hidden></label>
        <button type="button" class="btn ghost" data-type>${icon('scan-line')} ${t('Type the lines')}</button></div>
      <form class="form" data-mrz hidden><p class="muted small">${t('Type or paste the machine-readable lines (the rows with <<< at the bottom of the passport page, or on the back of the Emirates ID). A document scanner in keyboard mode can type them here.')}</p>
        <div class="fld span"><textarea name="mrz" rows="4" class="mono" spellcheck="false" placeholder="ILARE123456789<784198012345671&#10;8001014M3001019IND<<<<<<<<<<<8&#10;SHARMA<<RAHUL<KUMAR<<<<<<<<<<<"></textarea></div>
        <div class="form-error" hidden></div><div class="form-actions"><button class="btn primary" type="submit">${icon('check')} ${t('Read')}</button></div></form>`,
  });
  const status = (msg, tone = '') => { const el = $('[data-status]', w); if (el) { el.textContent = msg; el.className = `small scan-status ${tone}`; } };
  const end = () => { stop = true; stream?.getTracks().forEach((x) => x.stop()); };
  const done = (r) => { end(); closeModal(); onRead(r); };
  onClose(w, end);

  $('[data-type]', w).addEventListener('click', () => { const f = $('[data-mrz]', w); f.hidden = false; f.mrz.focus(); });
  $('[data-mrz]', w).addEventListener('submit', (e) => {
    e.preventDefault();
    try { done(parseMrz(e.target.mrz.value)); } catch (ex) { const er = $('.form-error', w); er.textContent = ex.message; er.hidden = false; }
  });
  $('[data-photo]', w).addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    busy = true; status(t('Reading the photo…'));
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      const qr = (await readQr(img).catch(() => [])).map(customerFromQr).find(Boolean);
      if (qr) return done({ customer: qr });
      const r = await readMrzImage(img, { region: { maxW: 1800 }, both: true });
      URL.revokeObjectURL(img.src);
      if (r) return done(r);
      status(t('Could not find the ID lines in this photo. Take it closer, straight on, with the <<< lines sharp.'), 'neg');
    } catch (ex) { status(ex.message, 'neg'); } finally { busy = false; e.target.value = ''; }
  });

  if (!cam) return w;
  (async () => {
    let video;
    try { video = $('video', w); stream = await startCamera(video); } catch (e) { status(`${t('Camera not available')}: ${e.message}. ${t('Take a photo of the back of the ID instead.')}`, 'neg'); return; }
    status(t('Loading the text reader…'));
    try { await ocr(); } catch (e) { status(e.message, 'neg'); return; }
    status(t('Hold the back of the Emirates ID inside the frame, with the 3 lines of <<< at the bottom. Good light, no glare.'));
    let closest = null; let warned = false; const since = Date.now();
    const tick = async () => {
      if (stop) return;
      if (busy || !video.videoWidth) { setTimeout(tick, 300); return; }
      busy = true;
      try {
        const qr = (await readQr(video).catch(() => [])).map(customerFromQr).find(Boolean);
        if (qr) return done({ customer: qr });
        // The lines sit in the lower part of the card frame drawn on screen; every third try reads the whole picture.
        const r = await readMrzImage(video, { region: tries++ % 3 === 2 ? { maxW: 1600 } : { y: 0.3, h: 0.65, maxW: 1400 } });
        if (stop) return;
        if (r?.valid) return done(r);
        if (r) closest = r;
        if (!warned && Date.now() - since > 8000) { warned = true; status(t('Still reading… move the card a little closer and avoid glare.'), 'warn'); }
        if (Date.now() - since > 15000 && closest) {
          status(t('The lines were read but a check digit does not match. You can use what was read and correct it, or keep trying.'), 'warn');
          if (!$('[data-use]', w)) {
            $('.form-actions', w).insertAdjacentHTML('afterbegin', html`<button type="button" class="btn primary" data-use>${icon('check')} ${t('Use what was read')}</button>`.toString());
            $('[data-use]', w).addEventListener('click', () => done(closest));
          }
        }
      } catch (ex) { console.warn(ex); } finally { busy = false; }
      setTimeout(tick, 150);
    };
    tick();
  })();
  return w;
}

// After a scan: show what was read, match an existing customer or create one, then onCustomer(customer).
// Fields that the ID does not carry (phone, licence) can be added here too.
export function confirmIdCustomer(read, onCustomer) {
  if (read.customer) return afterPick(read.customer, onCustomer);
  const d = read.data; const existing = findCustomer(d);
  const canWrite = S.can('customers', 'write');
  if (!existing && !canWrite) { toast(t('No customer with this ID, and you cannot add customers.'), 'err'); return; }
  const base = existing || { kind: 'individual', account_type: 'cash' };
  const row = { ...base };
  // Fill what the document gives: empty fields always, and the newer expiry date / number when the card was renewed.
  for (const [k, val] of Object.entries(d)) if (val && k !== 'gender' && (!row[k] || k.endsWith('expiry') || k === 'id_number')) row[k] = val;
  const fields = [
    { key: 'full_name', label: 'Full name', req: true, max: 120 },
    { key: 'id_number', label: 'Emirates ID / ID no.', max: 40 }, { key: 'id_expiry', label: 'ID expiry', type: 'date' },
    ...(d.passport_number ? [{ key: 'passport_number', label: 'Passport no.', max: 40 }, { key: 'passport_expiry', label: 'Passport expiry', type: 'date' }] : []),
    { key: 'nationality', label: 'Nationality', max: 40 }, { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
    { key: 'phone', label: 'Phone', type: 'tel', max: 30 }, { key: 'email', label: 'Email', type: 'email', max: 120 },
    { key: 'license_number', label: 'Licence no.', max: 40 }, { key: 'license_expiry', label: 'Licence expiry', type: 'date' },
  ];
  const expired = row.id_expiry && row.id_expiry < new Date().toISOString().slice(0, 10);
  formModal({
    title: html`${icon('id-card')} ${existing ? t('Customer found') : t('New customer from the ID')}`, fields, row, data: S.data, wide: true,
    submitText: existing ? t('Use this customer') : t('Create customer'),
    extra: html`<div class="scan-result">
      ${existing ? html`<p>${icon('users')} <b>${existing.full_name}</b> <span class="mono">${existing.code || ''}</span> ${existing.blacklisted ? badge('disputed', t('Blacklisted')) : ''}<small class="muted block">${t('Matched by the ID number. Changes you make here are saved to the customer.')}</small></p>`
        : html`<p class="muted small">${icon('user-plus')} ${t('No customer has this ID yet. Check the details, add the phone number, and the customer is created.')}</p>`}
      ${read.valid ? html`<p class="pos small">${icon('check')} ${t('All check digits match.')}</p>` : html`<p class="neg small">${icon('triangle-alert')} ${(read.warn || []).join(' · ')}. ${t('Please compare with the card.')}</p>`}
      ${expired ? html`<p class="neg small">${icon('triangle-alert')} ${t('This ID has expired')} (${fmtDate(row.id_expiry)}).</p>` : ''}</div>`,
    onSubmit: async (vals) => {
      let c;
      if (existing) {
        const patch = Object.fromEntries(Object.entries(vals).filter(([k, v]) => (v ?? '') !== (existing[k] ?? '')));
        c = Object.keys(patch).length && canWrite ? await S.backend.update('customers', existing.id, patch) : existing;
      } else c = await S.backend.insert('customers', { kind: 'individual', account_type: 'cash', ...vals });
      await reload('customers');
      c = S.data.customers.find((x) => x.id === (c?.id || existing?.id)) || c;
      toast(existing ? t('Customer updated') : t('Customer created'));
      setTimeout(() => afterPick(c, onCustomer), 0); // formModal closes itself after this returns
    },
  });
}
function afterPick(c, onCustomer) {
  if (c.blacklisted) { toast(`${c.full_name}: ${t('Blacklisted')}`, 'err'); return; }
  onCustomer(c);
}
