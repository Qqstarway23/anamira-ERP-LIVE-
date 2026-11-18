// Sign in / sign up / reset, plus the "waiting for approval" screen.
import { html, icon, $ } from '../util.js';
import { t, getLang, setLang } from '../i18n.js';
import { CONFIG } from '../config.js';

export function renderAuth(root, { backend, onDemo, onLang }) {
  let mode = 'in';
  const draw = (msg = '', kind = '') => {
    root.innerHTML = html`<div class="auth">
      <aside class="auth-art"><div class="brand big">${icon('car')}<span>Anamira<small>Car Rental ERP</small></span></div>
        <h1>Rent smarter.<br>Run the whole fleet from one screen.</h1>
        <ul><li>${icon('key-round')} Book → hand over → return in three clicks</li><li>${icon('shield-check')} No double bookings, enforced by the database</li>
        <li>${icon('siren')} Salik and fines matched to the right customer automatically</li><li>${icon('chart-column')} Live revenue, balances and utilisation</li></ul></aside>
      <main class="auth-box">
        <div class="auth-top"><button class="btn ghost sm" data-lang>${icon('languages')} ${getLang() === 'ar' ? 'English' : 'العربية'}</button></div>
        <h2>${mode === 'in' ? t('Sign in') : mode === 'up' ? t('Create account') : t('Forgot password?')}</h2>
        <form class="form" data-auth novalidate>
          ${mode === 'up' ? html`<div class="fld"><label for="a-name">${t('Full name')}</label><input id="a-name" name="name" required maxlength="80" autocomplete="name"></div>` : ''}
          <div class="fld"><label for="a-email">${t('Email')}</label><input id="a-email" name="email" type="email" required maxlength="120" autocomplete="email"></div>
          ${mode !== 'reset' ? html`<div class="fld"><label for="a-pw">${t('Password')}</label><input id="a-pw" name="password" type="password" required minlength="${mode === 'up' ? 10 : 6}" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}">${mode === 'up' ? html`<small class="muted">At least 10 characters.</small>` : ''}</div>` : ''}
          <div class="form-msg ${kind}" ${msg ? '' : 'hidden'}>${msg}</div>
          <button class="btn primary block" type="submit">${mode === 'in' ? t('Sign in') : mode === 'up' ? t('Create account') : t('Confirm')}</button>
        </form>
        <div class="auth-links">
          ${mode !== 'in' ? html`<button class="link" data-mode="in">${t('Sign in')}</button>` : html`<button class="link" data-mode="up">${t('Create account')}</button><button class="link" data-mode="reset">${t('Forgot password?')}</button>`}
        </div>
        <div class="divider"><span>or</span></div>
        <button class="btn ghost block" data-demo>${icon('sparkles')} ${t('Try the demo')}</button>
        <p class="muted small center">Demo runs only in your browser with sample data. Nothing is sent to the server.</p>
        <p class="muted small center">v${CONFIG.version}</p>
      </main></div>`.toString();
    $('[data-auth]', root).addEventListener('submit', submit);
  };
  async function submit(e) {
    e.preventDefault();
    const f = e.target; if (!f.checkValidity()) return f.reportValidity();
    const v = Object.fromEntries(new FormData(f));
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      if (mode === 'in') await backend.signIn(v.email.trim(), v.password);
      else if (mode === 'up') {
        await backend.signUp(v.email.trim(), v.password, v.name.trim());
        mode = 'in'; return draw('Account created. Check your email to confirm it, then ask an admin to activate you.', 'ok');
      } else { await backend.resetPassword(v.email.trim()); return draw('If that email has an account, a reset link is on its way.', 'ok'); }
    } catch (ex) { draw(ex.message, 'err'); }
    finally { btn.disabled = false; }
  }
  root.onclick = (e) => {
    const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; draw(); }
    if (e.target.closest('[data-demo]')) onDemo();
    if (e.target.closest('[data-lang]')) { setLang(getLang() === 'ar' ? 'en' : 'ar'); onLang?.(); draw(); }
  };
  draw();
}

export function renderPending(root, me, { onSignOut }) {
  root.innerHTML = html`<div class="auth"><main class="auth-box wide-center">
    <div class="pending-ic">${icon('clock')}</div><h2>${t('Waiting for approval')}</h2>
    <p>Hi <b>${me?.full_name || me?.email}</b>, your account is ready but an admin still has to activate it and give you a role.</p>
    <p class="muted">Ask your manager to open <b>Team</b> and press <b>Activate</b>. Then reload this page.</p>
    <div class="form-actions center"><button class="btn ghost" data-reload>${icon('refresh-cw')} Reload</button><button class="btn ghost" data-out>${icon('log-out')} ${t('Sign out')}</button></div>
  </main></div>`.toString();
  root.onclick = (e) => { if (e.target.closest('[data-out]')) onSignOut(); if (e.target.closest('[data-reload]')) location.reload(); };
}
