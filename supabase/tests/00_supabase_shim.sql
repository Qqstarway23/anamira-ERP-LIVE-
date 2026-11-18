-- Minimal stand-in for the Supabase platform, for local testing only.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
grant anon, authenticated, service_role to postgres;
create schema auth; create schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant create on schema public to postgres;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
create publication supabase_realtime;
create schema legacy;
create table public.vehicles as select
  'a0000000-0000-4000-8000-000000000001'::uuid id, 'G'::text plate_code, '18703'::text plate_number, 'Dubai'::text emirate,
  'Chevrolet'::text make, 'Corvette Stingray'::text model, 2023 as year, 'sports'::text category, null::text color,
  1200::numeric daily_rate, 7200::numeric weekly_rate, 26400::numeric monthly_rate, 0::numeric odometer,
  null::date insurance_expiry, null::date registration_expiry, null::text notes;
-- pretend v1 objects that the archive migration must move
create table public.erp_records (id int);
create schema private;
create function public.touch_updated_at() returns int language sql as 'select 1';
create function private.app_role() returns text language sql as 'select ''x''';
