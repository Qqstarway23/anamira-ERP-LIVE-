-- Anamira Car Rental v2: core schema
-- Design rules
--   * One table per business object, plain columns (no JSON blobs).
--   * Money is numeric(12,2). Totals are computed by the database, never trusted from the browser.
--   * Every table has RLS. Access is decided by the caller's role in public.profiles.
--   * New sign-ups get NO access until an admin activates them.

create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ───────────────────────── helpers ─────────────────────────
create or replace function private.touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create or replace function private.norm_plate(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- ───────────────────────── people ─────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'agent' check (role in ('admin','manager','agent','accountant')),
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Role of the signed-in user, or null when not signed in / not activated.
create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function private.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = any(roles), false)
$$;

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() is not null
$$;

-- New auth user → inactive agent profile. An admin must activate it.
create or replace function private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(coalesce(new.email,''), '@', 1)), 80))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.on_auth_user_created();

-- Guard: the team can never lose its last active admin, and nobody but an admin may change roles.
create or replace function private.guard_profiles() returns trigger
language plpgsql security definer set search_path = '' as $$
declare losing_admin boolean;
begin
  if tg_op = 'DELETE' then
    losing_admin := old.role = 'admin' and old.active;
  else
    if new.id <> old.id or new.email <> old.email then
      raise exception 'Profile id and email cannot be changed';
    end if;
    losing_admin := old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active);
  end if;
  if losing_admin and not exists (select 1 from public.profiles p where p.role = 'admin' and p.active and p.id <> old.id) then
    raise exception 'At least one active admin is required';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger profiles_guard before update or delete on public.profiles
  for each row execute function private.guard_profiles();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch();

-- ───────────────────────── settings (single row) ─────────────────────────
create table public.settings (
  id               boolean primary key default true check (id),
  company_name     text not null default 'Anamira Car Rental',
  company_phone    text not null default '',
  company_address  text not null default 'Dubai, UAE',
  trn              text not null default '',
  currency         text not null default 'AED',
  vat_rate         numeric(5,2) not null default 5 check (vat_rate between 0 and 100),
  salik_fee        numeric(12,2) not null default 1 check (salik_fee >= 0),
  fine_fee_pct     numeric(5,2) not null default 10 check (fine_fee_pct between 0 and 100),
  updated_at       timestamptz not null default now()
);
insert into public.settings default values;
create trigger settings_touch before update on public.settings for each row execute function private.touch();

-- ───────────────────────── fleet ─────────────────────────
create table public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  plate_code          text not null default '',
  plate_number        text not null check (length(trim(plate_number)) > 0),
  emirate             text not null default 'Dubai',
  make                text not null,
  model               text not null,
  year                int check (year between 1990 and 2100),
  category            text not null default 'sedan' check (category in ('economy','sedan','suv','sports','luxury','van')),
  color               text not null default '',
  daily_rate          numeric(12,2) not null default 0 check (daily_rate >= 0),
  weekly_rate         numeric(12,2) not null default 0 check (weekly_rate >= 0),
  monthly_rate        numeric(12,2) not null default 0 check (monthly_rate >= 0),
  status              text not null default 'available' check (status in ('available','rented','maintenance','retired')),
  odometer            int not null default 0 check (odometer >= 0),
  insurance_expiry    date,
  registration_expiry date,
  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vehicles_plate_uq unique (emirate, plate_code, plate_number)
);
create trigger vehicles_touch before update on public.vehicles for each row execute function private.touch();

-- ───────────────────────── customers ─────────────────────────
create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(trim(full_name)) > 0),
  kind            text not null default 'individual' check (kind in ('individual','company')),
  phone           text not null default '',
  email           text not null default '',
  nationality     text not null default '',
  id_number       text not null default '',
  id_expiry       date,
  license_number  text not null default '',
  license_expiry  date,
  address         text not null default '',
  blacklisted     boolean not null default false,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index customers_phone_idx on public.customers (phone);
create trigger customers_touch before update on public.customers for each row execute function private.touch();

-- ───────────────────────── rentals ─────────────────────────
create sequence public.rental_ref_seq start 1001;
create table public.rentals (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('R-' || nextval('public.rental_ref_seq')),
  customer_id   uuid not null references public.customers(id) on delete restrict,
  vehicle_id    uuid not null references public.vehicles(id) on delete restrict,
  status        text not null default 'booked' check (status in ('booked','active','returned','cancelled')),
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  returned_at   timestamptz,
  daily_rate    numeric(12,2) not null check (daily_rate >= 0),
  days          int not null default 1,
  extras        numeric(12,2) not null default 0 check (extras >= 0),
  discount      numeric(12,2) not null default 0 check (discount >= 0),
  vat_rate      numeric(5,2) not null default 5 check (vat_rate between 0 and 100),
  subtotal      numeric(12,2) not null default 0,
  vat           numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  deposit       numeric(12,2) not null default 0 check (deposit >= 0),
  odometer_out  int check (odometer_out >= 0),
  odometer_in   int check (odometer_in >= 0),
  fuel_out      text not null default 'full' check (fuel_out in ('empty','1/4','1/2','3/4','full')),
  fuel_in       text check (fuel_in in ('empty','1/4','1/2','3/4','full')),
  notes         text not null default '',
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rentals_period_chk check (end_at > start_at),
  constraint rentals_odo_chk check (odometer_in is null or odometer_out is null or odometer_in >= odometer_out),
  -- A car can never be double-booked.
  constraint rentals_no_overlap exclude using gist (
    vehicle_id with =, tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('booked','active'))
);
create index rentals_customer_idx on public.rentals (customer_id);
create index rentals_vehicle_idx on public.rentals (vehicle_id, start_at);
create index rentals_status_idx on public.rentals (status);

-- Pricing + workflow rules, enforced on every write.
create or replace function private.rentals_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; c public.customers; billed_end timestamptz;
begin
  if tg_op = 'UPDATE' then
    -- Allowed status moves: booked→active|cancelled, active→returned. Closed rentals are frozen.
    if old.status in ('returned','cancelled') then
      raise exception 'Rental % is closed and cannot be changed', old.ref;
    end if;
    if new.status <> old.status and not (
         (old.status = 'booked' and new.status in ('active','cancelled')) or
         (old.status = 'active' and new.status = 'returned')) then
      raise exception 'Cannot move rental from % to %', old.status, new.status;
    end if;
    if old.status = 'active' and (new.vehicle_id <> old.vehicle_id or new.customer_id <> old.customer_id) then
      raise exception 'Car and customer cannot change once the rental has started';
    end if;
    new.ref := old.ref; new.created_by := old.created_by; new.created_at := old.created_at;
  else
    if new.status not in ('booked','active') then
      raise exception 'New rentals start as booked or active';
    end if;
  end if;

  select * into c from public.customers where id = new.customer_id;
  if c.blacklisted and (tg_op = 'INSERT' or new.status = 'active') then
    raise exception 'Customer % is blacklisted', c.full_name;
  end if;

  select * into v from public.vehicles where id = new.vehicle_id;
  if v.status = 'retired' then raise exception 'Car % is retired', v.plate_number; end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status = 'booked') then
    if v.status = 'maintenance' then raise exception 'Car % is in maintenance', v.plate_number; end if;
    if exists (select 1 from public.rentals k where k.vehicle_id = new.vehicle_id and k.status = 'active' and k.id <> new.id) then
      raise exception 'Car % is still out on another rental', v.plate_number;
    end if;
    new.odometer_out := coalesce(new.odometer_out, v.odometer);
  end if;

  if new.status = 'returned' then
    new.returned_at := coalesce(new.returned_at, now());
    if new.odometer_in is null then raise exception 'Enter the odometer reading on return'; end if;
    if new.fuel_in is null then raise exception 'Enter the fuel level on return'; end if;
  end if;

  -- Bill until the later of planned end and actual return, at least 1 day; partial days round up.
  billed_end := greatest(new.end_at, coalesce(new.returned_at, new.end_at));
  new.days     := greatest(1, ceil(extract(epoch from (billed_end - new.start_at)) / 86400.0 - 0.0417)::int); -- 1h grace
  new.subtotal := round(new.days * new.daily_rate + new.extras - new.discount, 2);
  if new.subtotal < 0 then raise exception 'Discount is larger than the rental amount'; end if;
  new.vat      := round(new.subtotal * new.vat_rate / 100, 2);
  new.total    := new.subtotal + new.vat;
  return new;
end $$;
create trigger rentals_before before insert or update on public.rentals
  for each row execute function private.rentals_before();
create trigger rentals_touch before update on public.rentals for each row execute function private.touch();

-- Keep the car's status and odometer in step with its rentals.
create or replace function private.rentals_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'active' then
      update public.vehicles set status = 'available' where id = old.vehicle_id and status = 'rented';
    end if;
    return null;
  end if;
  if new.status = 'active' then
    update public.vehicles set status = 'rented' where id = new.vehicle_id and status <> 'rented';
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status = 'returned' then
    update public.vehicles
       set status = case when status = 'rented' then 'available' else status end,
           odometer = greatest(odometer, coalesce(new.odometer_in, odometer))
     where id = new.vehicle_id;
  end if;
  return null;
end $$;
create trigger rentals_after after insert or update or delete on public.rentals
  for each row execute function private.rentals_after();

-- ───────────────────────── payments ─────────────────────────
create sequence public.payment_ref_seq start 5001;
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique default ('P-' || nextval('public.payment_ref_seq')),
  rental_id    uuid references public.rentals(id) on delete restrict,
  customer_id  uuid not null references public.customers(id) on delete restrict,
  kind         text not null default 'payment' check (kind in ('payment','refund','deposit','deposit_return')),
  method       text not null default 'cash' check (method in ('cash','card','bank','cheque')),
  amount       numeric(12,2) not null check (amount > 0),
  paid_at      timestamptz not null default now(),
  note         text not null default '',
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index payments_rental_idx on public.payments (rental_id);
create index payments_customer_idx on public.payments (customer_id);

create or replace function private.payments_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.rentals;
begin
  if new.rental_id is not null then
    select * into r from public.rentals where id = new.rental_id;
    new.customer_id := r.customer_id;   -- a payment always belongs to the rental's customer
  end if;
  if tg_op = 'UPDATE' then new.ref := old.ref; new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
create trigger payments_before before insert or update on public.payments
  for each row execute function private.payments_before();

-- ───────────────────────── fines & salik ─────────────────────────
create table public.fines (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'salik' check (kind in ('salik','traffic','parking','other')),
  reference     text not null default '',
  plate_code    text not null default '',
  plate_number  text not null,
  occurred_at   timestamptz not null,
  location      text not null default '',
  amount        numeric(12,2) not null check (amount >= 0),
  admin_fee     numeric(12,2) not null default 0 check (admin_fee >= 0),
  status        text not null default 'new' check (status in ('new','charged','company','unmatched','paid','disputed')),
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  rental_id     uuid references public.rentals(id) on delete set null,
  customer_id   uuid references public.customers(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index fines_ref_uq on public.fines (kind, reference) where reference <> '';
create index fines_plate_idx on public.fines (plate_number, occurred_at);
create index fines_rental_idx on public.fines (rental_id);
create trigger fines_touch before update on public.fines for each row execute function private.touch();

-- Match every new/unmatched fine to the car and the rental that was running at that moment.
create or replace function public.match_fines() returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; f record; v uuid; r public.rentals; s public.settings;
begin
  if not private.has_role('admin','manager','accountant') then
    raise exception 'Only admin, manager or accountant can match fines';
  end if;
  select * into s from public.settings limit 1;
  for f in select * from public.fines where status in ('new','unmatched') for update loop
    select id into v from public.vehicles
     where ltrim(plate_number, '0') = ltrim(f.plate_number, '0')
       and (f.plate_code = '' or private.norm_plate(plate_code) = private.norm_plate(f.plate_code))
     order by created_at limit 1;
    if v is null then
      update public.fines set status = 'unmatched' where id = f.id;
    else
      select * into r from public.rentals k
       where k.vehicle_id = v and k.status in ('active','returned')
         and f.occurred_at >= k.start_at
         and f.occurred_at <= coalesce(k.returned_at, greatest(k.end_at, now()))
       order by k.start_at desc limit 1;
      if r.id is null then
        update public.fines set vehicle_id = v, status = 'company', admin_fee = 0 where id = f.id;
      else
        update public.fines set vehicle_id = v, rental_id = r.id, customer_id = r.customer_id, status = 'charged',
               admin_fee = case when f.kind = 'salik' then s.salik_fee else round(f.amount * s.fine_fee_pct / 100, 2) end
         where id = f.id;
      end if;
    end if;
    n := n + 1; v := null; r := null;
  end loop;
  return n;
end $$;

-- ───────────────────────── maintenance ─────────────────────────
create table public.maintenance (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id) on delete restrict,
  kind         text not null default 'service' check (kind in ('service','repair','tyres','accident','inspection','other')),
  description  text not null default '',
  vendor       text not null default '',
  cost         numeric(12,2) not null default 0 check (cost >= 0),
  odometer     int check (odometer >= 0),
  status       text not null default 'open' check (status in ('open','done')),
  opened_on    date not null default current_date,
  closed_on    date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index maintenance_vehicle_idx on public.maintenance (vehicle_id);
create trigger maintenance_touch before update on public.maintenance for each row execute function private.touch();

create or replace function private.maintenance_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'open' then
    if exists (select 1 from public.rentals where vehicle_id = new.vehicle_id and status = 'active') then
      raise exception 'This car is out on a rental. Return it first.';
    end if;
    update public.vehicles set status = 'maintenance' where id = new.vehicle_id and status = 'available';
  elsif new.status = 'done' then
    new.closed_on := coalesce(new.closed_on, current_date);
    if not exists (select 1 from public.maintenance m where m.vehicle_id = new.vehicle_id and m.status = 'open' and m.id <> new.id) then
      update public.vehicles set status = 'available' where id = new.vehicle_id and status = 'maintenance';
    end if;
  end if;
  if new.odometer is not null then
    update public.vehicles set odometer = greatest(odometer, new.odometer) where id = new.vehicle_id;
  end if;
  return new;
end $$;
create trigger maintenance_sync before insert or update on public.maintenance
  for each row execute function private.maintenance_sync();

-- ───────────────────────── expenses ─────────────────────────
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  category     text not null default 'other' check (category in ('fuel','salary','rent','utilities','insurance','registration','marketing','office','other')),
  description  text not null default '',
  amount       numeric(12,2) not null check (amount > 0),
  vat          numeric(12,2) not null default 0 check (vat >= 0),
  method       text not null default 'cash' check (method in ('cash','card','bank','cheque')),
  spent_on     date not null default current_date,
  vehicle_id   uuid references public.vehicles(id) on delete set null,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (spent_on);

-- ───────────────────────── activity log ─────────────────────────
create table public.activity_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text not null default '',
  entity     text not null,
  entity_id  text not null,
  action     text not null,
  summary    text not null default ''
);
create index activity_log_at_idx on public.activity_log (at desc);

create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec jsonb; label text;
begin
  rec := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  label := coalesce(rec->>'ref', rec->>'full_name', nullif(trim(coalesce(rec->>'plate_code','') || ' ' || coalesce(rec->>'plate_number','')), ''), rec->>'description', '');
  if tg_op = 'UPDATE' and rec ? 'status' and (to_jsonb(old)->>'status') is distinct from (rec->>'status') then
    label := label || ' → ' || (rec->>'status');
  end if;
  insert into public.activity_log (actor, actor_name, entity, entity_id, action, summary)
  values (auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'system'),
          tg_table_name, rec->>'id', lower(tg_op), left(label, 200));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['vehicles','customers','rentals','payments','fines','maintenance','expenses','profiles'] loop
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$s for each row execute function private.log_change()', t);
  end loop;
end $$;

-- ───────────────────────── reporting view ─────────────────────────
create view public.rental_balances with (security_invoker = true) as
select r.id as rental_id,
       r.total,
       coalesce(sum(case p.kind when 'payment' then p.amount when 'refund' then -p.amount else 0 end), 0)::numeric(12,2) as paid,
       coalesce(sum(case p.kind when 'deposit' then p.amount when 'deposit_return' then -p.amount else 0 end), 0)::numeric(12,2) as deposit_held,
       (r.total - coalesce(sum(case p.kind when 'payment' then p.amount when 'refund' then -p.amount else 0 end), 0))::numeric(12,2) as balance
  from public.rentals r
  left join public.payments p on p.rental_id = r.id
 group by r.id, r.total;
