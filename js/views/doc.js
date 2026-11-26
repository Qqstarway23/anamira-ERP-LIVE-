// Printable documents on the company letterhead: vouchers, invoices, statements, check cards, reports.
// Everything goes through #print and the browser's print dialog, which can also save as PDF.
import { html, $, fmtDate } from '../util.js';
import { S } from '../store.js';

export function letterhead(title, ref = '', date = new Date()) {
  const s = S.settings || {};
  return html`<header><img class="c-logo" src="assets/logo.png" alt="" width="70" height="70"><div class="c-co"><h1>${s.company_name}</h1>
    <p>${s.company_address}${s.company_phone ? ' · ' + s.company_phone : ''}</p>
    <p>${[s.company_email, s.company_website, s.trn ? `TRN ${s.trn}` : '', s.trade_license ? `Licence ${s.trade_license}` : ''].filter(Boolean).join(' · ')}</p></div>
    <div class="r"><h2>${title}</h2>${ref ? html`<p class="mono">${ref}</p>` : ''}<p>${fmtDate(date)}</p></div></header>`;
}

// body: html view. opts.landscape for wide reports.
export function printDoc(title, ref, body, { date, landscape = false } = {}) {
  const el = $('#print');
  el.innerHTML = html`<div class="contract ${landscape ? 'landscape' : ''}">${letterhead(title, ref, date)}${body}</div>`.toString();
  // Wait for images (logo, photos, QR codes) so they appear on the printout.
  const imgs = [...el.querySelectorAll('img')].filter((i) => !i.complete);
  Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; }))), new Promise((r) => setTimeout(r, 1500))])
    .then(() => window.print());
}

// Amount in words for vouchers (English, whole units + fils/cents).
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
  for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= v) return words(Math.floor(n / v)) + ' ' + w + (n % v ? (n % v < 100 ? ' and ' : ' ') + words(n % v) : '');
  }
  return '';
}
export function amountInWords(v, currency = 'AED') {
  const n = Math.round(Math.abs(+v || 0) * 100); const whole = Math.floor(n / 100); const frac = n % 100;
  const sub = currency === 'AED' ? 'fils' : 'cents';
  const s = `${currency} ${whole ? words(whole) : 'zero'}${frac ? ` and ${words(frac)} ${sub}` : ''} only`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
