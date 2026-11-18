// Live backend: Supabase (Postgres + Auth + Realtime). All access rules are enforced by RLS in the database.
import { CONFIG } from './config.js';

const TABLES = {
  vehicles: { order: 'plate_number' },
  customers: { order: 'full_name' },
  rentals: { order: 'start_at', desc: true },
  payments: { order: 'paid_at', desc: true },
  fines: { order: 'occurred_at', desc: true },
  maintenance: { order: 'opened_on', desc: true },
  expenses: { order: 'spent_on', desc: true },
  rental_balances: {},
  profiles: { order: 'created_at' },
  activity_log: { order: 'at', desc: true, limit: 300 },
};

const FRIENDLY = [
  [/rentals_no_overlap|exclusion/i, 'This car is already booked for part of those dates.'],
  [/vehicles_plate_uq/i, 'A car with this plate already exists.'],
  [/fines_ref_uq/i, 'A fine with this reference already exists.'],
  [/violates foreign key|still referenced/i, 'This record is used elsewhere (for example by a rental or payment), so it cannot be deleted.'],
  [/row-level security|permission denied/i, 'Your role is not allowed to do this.'],
  [/Invalid login credentials/i, 'Wrong email or password.'],
  [/Email not confirmed/i, 'Please confirm your email first (check your inbox).'],
];
export function friendly(err) {
  const msg = err?.message || String(err);
  for (const [re, text] of FRIENDLY) if (re.test(msg)) return text;
  return msg;
}

export function createLiveBackend() {
  if (!window.supabase?.createClient) throw new Error('Supabase client failed to load');
  const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const ok = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };
  let channel = null;

  return {
    mode: 'live',
    async session() { return ok(await sb.auth.getSession()).session; },
    onAuth(cb) { sb.auth.onAuthStateChange((e, s) => cb(s, e)); },
    async updatePassword(password) { return ok(await sb.auth.updateUser({ password })); },
    async signIn(email, password) { return ok(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, full_name) {
      return ok(await sb.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: location.origin + location.pathname } }));
    },
    async resetPassword(email) {
      return ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
    },
    async signOut() { await sb.auth.signOut(); },
    async me() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return null;
      return ok(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
    },
    async settings() { return ok(await sb.from('settings').select('*').maybeSingle()); },
    async saveSettings(patch) { return ok(await sb.from('settings').update(patch).eq('id', true).select().single()); },
    async list(table) {
      const cfg = TABLES[table] || {};
      let q = sb.from(table).select('*');
      if (cfg.order) q = q.order(cfg.order, { ascending: !cfg.desc });
      q = q.limit(cfg.limit || 5000);
      return ok(await q);
    },
    async insert(table, row) { return ok(await sb.from(table).insert(row).select().single()); },
    async update(table, id, patch) { return ok(await sb.from(table).update(patch).eq('id', id).select().single()); },
    async remove(table, id) {
      const rows = ok(await sb.from(table).delete().eq('id', id).select('id'));
      if (!rows?.length) throw new Error(friendly('permission denied'));
    },
    async rpc(name, args) { return ok(await sb.rpc(name, args || {})); },
    subscribe(onChange) {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel('anamira-live');
      for (const t of ['vehicles', 'customers', 'rentals', 'payments', 'fines', 'maintenance', 'expenses']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => onChange(t));
      }
      channel.subscribe();
    },
  };
}
