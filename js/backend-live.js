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
  activity_log: { order: 'at', desc: true, limit: 500 },
  branches: { order: 'code' }, departments: { order: 'name' }, masters: { order: 'sort' },
  employees: { order: 'full_name' }, suppliers: { order: 'name' }, tariff_groups: { order: 'name' }, tariff_cards: { order: 'valid_from', desc: true },
  movements: { order: 'out_at', desc: true }, invoices: { order: 'issued_on', desc: true }, bills: { order: 'bill_date', desc: true },
  vouchers: { order: 'paid_on', desc: true }, damages: { order: 'created_at', desc: true },
  vehicle_replacements: { order: 'replaced_at', desc: true }, rental_events: { order: 'at', desc: true, limit: 5000 },
  // Signatures are large: the list leaves them out, get() fetches them for one check card.
  inspections: { order: 'at', desc: true, select: 'id,ref,kind,context,rental_id,movement_id,vehicle_id,at,odometer,fuel,checklist,photos,notes,staff_name,created_by,created_at' },
};
const LIVE = ['vehicles', 'customers', 'rentals', 'payments', 'fines', 'maintenance', 'expenses', 'branches', 'departments', 'masters',
  'employees', 'suppliers', 'tariff_groups', 'tariff_cards', 'movements', 'inspections', 'damages', 'invoices', 'bills', 'vouchers'];
const BUCKET = 'inspections';

const FRIENDLY = [
  [/rentals_no_overlap|exclusion/i, 'This car is already booked for part of those dates.'],
  [/vehicles_plate_uq/i, 'A car with this plate already exists.'],
  [/fines_ref_uq/i, 'A fine with this reference already exists.'],
  [/customers_code_uq|suppliers_code_uq|employees_code_uq|branches_code_uq/i, 'This code is already used.'],
  [/masters_uq|departments_name_uq|tariff_groups_name_uq/i, 'This name is already in the list.'],
  [/movements_one_open_uq/i, 'This car already has an open staff movement.'],
  [/vehicles_sipp_chk/i, 'The SIPP code must be four capital letters.'],
  [/vouchers_party_chk/i, 'Pick who the voucher is paid to or received from.'],
  [/tariff_cards_dates_chk/i, '"Valid to" must be on or after "valid from".'],
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
      let q = sb.from(table).select(cfg.select || '*');
      if (cfg.order) q = q.order(cfg.order, { ascending: !cfg.desc });
      q = q.limit(cfg.limit || 5000);
      return ok(await q);
    },
    async get(table, id) { return ok(await sb.from(table).select('*').eq('id', id).maybeSingle()); },
    // Photos for check cards live in a private Storage bucket; the app shows them through short-lived signed links.
    async uploadPhoto(blob, folder = 'misc') {
      const path = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
      ok(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false }));
      return path;
    },
    async photoUrls(paths) {
      if (!paths?.length) return {};
      const res = ok(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600));
      return Object.fromEntries((res || []).filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]));
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
      for (const t of LIVE) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => onChange(t));
      }
      channel.subscribe();
    },
  };
}
