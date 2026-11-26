-- Anamira Car Rental v2.1: the modules from the Speed CRS proposal.
--   Setup        branches, departments, masters (makes, models, service/defect types, check-list), control panel
--   Accounts     customer codes, cash/credit accounts and credit limits, suppliers, employees
--   Vehicles     SIPP/ACRISS code, engine, transmission, fuel, service interval, de-fleet, branch
--   Tariffs      tariff groups, tariff cards, allocation of cards to corporate customers, km limits
--   Rentals      extension, cut short, cancellation reason, agreement editing log, vehicle and driver replacement
--   Movements    NRM (staff use) and custody movements; garage movements extend maintenance jobs
--   Vouchers     invoices (with automatic Salik/Darb/fines invoices), supplier bills, payment and receipt vouchers
--   Check cards  mobile check-out/check-in with check-list, damages on a car diagram, photos and signatures
--   Tolls        Darb and mall parking, fines charged to staff during staff movements, reconciliation
--
-- Safe to run more than once, and safe on a database that already holds data: it only adds tables, columns,
-- rules and policies, and never deletes rows. Existing rentals keep their totals (new km charges default to 0).

-- ───────────────────────── control panel ─────────────────────────
alter table public.settings
  add column if not exists company_email        text    not null default '',
  add column if not exists company_website      text    not null default '',
  add column if not exists trade_license        text    not null default '',
  add column if not exists default_deposit      numeric(12,2) not null default 1000 check (default_deposit >= 0),
  add column if not exists alert_days           int     not null default 30 check (alert_days between 1 and 365),
  add column if not exists service_interval_km  int     not null default 10000 check (service_interval_km between 0 and 100000),
  add column if not exists invoice_fines_on_close boolean not null default true,
  -- Automatic fines invoices only cover fines from this date on, so fines from before v2.1 are not invoiced by surprise.
  add column if not exists fines_invoice_from   date    not null default current_date;

-- ───────────────────────── setup masters ─────────────────────────
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (length(trim(code)) between 1 and 12),
  name        text not null check (length(trim(name)) between 1 and 80),
  address     text not null default '',
  phone       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists branches_code_uq on public.branches (upper(code));

create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists departments_name_uq on public.departments (lower(name));

-- One table for the short lists the forms pick from.
create table if not exists public.masters (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('make','model','engine','service_type','defect_type','checklist','color')),
  value       text not null check (length(trim(value)) between 1 and 80),
  parent      text not null default '',          -- for a model: its make
  sort        int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists masters_uq on public.masters (kind, lower(value), lower(parent));

alter table public.profiles
  add column if not exists branch_id     uuid references public.branches(id) on delete set null,
  add column if not exists department_id uuid references public.departments(id) on delete set null;

-- ───────────────────────── accounts: customers, suppliers, employees ─────────────────────────
create sequence if not exists public.customer_code_seq start 1001;
alter table public.customers
  add column if not exists code             text,
  add column if not exists account_type     text not null default 'cash' check (account_type in ('cash','credit')),
  add column if not exists credit_limit     numeric(12,2) not null default 0 check (credit_limit >= 0),
  add column if not exists passport_number  text not null default '',
  add column if not exists passport_expiry  date,
  add column if not exists date_of_birth    date,
  add column if not exists trn              text not null default '',
  add column if not exists contact_person   text not null default '';
with o as (select id from public.customers where code is null or code = '' order by created_at, full_name)
update public.customers c set code = 'C-' || nextval('public.customer_code_seq') from o where c.id = o.id;
alter table public.customers alter column code set default ('C-' || nextval('public.customer_code_seq'));
alter table public.customers alter column code set not null;
create unique index if not exists customers_code_uq on public.customers (upper(code));
create index if not exists customers_passport_idx on public.customers (passport_number);
create index if not exists customers_license_idx on public.customers (license_number);

create sequence if not exists public.supplier_code_seq start 101;
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  code            text not null default ('S-' || nextval('public.supplier_code_seq')),
  name            text not null check (length(trim(name)) between 1 and 120),
  category        text not null default 'other' check (category in ('garage','parts','tyres','insurance','leasing','fuel','registration','other')),
  contact_person  text not null default '',
  phone           text not null default '',
  email           text not null default '',
  trn             text not null default '',
  address         text not null default '',
  active          boolean not null default true,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists suppliers_code_uq on public.suppliers (upper(code));

create sequence if not exists public.employee_code_seq start 101;
create table if not exists public.employees (
  id               uuid primary key default gen_random_uuid(),
  code             text not null default ('E-' || nextval('public.employee_code_seq')),
  full_name        text not null check (length(trim(full_name)) between 1 and 120),
  designation      text not null default '',
  department_id    uuid references public.departments(id) on delete set null,
  branch_id        uuid references public.branches(id) on delete set null,
  phone            text not null default '',
  email            text not null default '',
  emirates_id      text not null default '',
  passport_number  text not null default '',
  license_number   text not null default '',
  license_expiry   date,
  joined_on        date,
  active           boolean not null default true,
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists employees_code_uq on public.employees (upper(code));

-- ───────────────────────── tariffs ─────────────────────────
create table if not exists public.tariff_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 80),
  description  text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists tariff_groups_name_uq on public.tariff_groups (lower(name));

-- A card with no customer is the standard (walk-in) price of its group; a card with a customer is that
-- customer's allocated (corporate) price and wins over the standard card.
create table if not exists public.tariff_cards (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) between 1 and 80),
  tariff_group_id uuid not null references public.tariff_groups(id) on delete restrict,
  customer_id     uuid references public.customers(id) on delete cascade,
  valid_from      date not null default current_date,
  valid_to        date,
  daily_rate      numeric(12,2) not null check (daily_rate >= 0),
  weekly_rate     numeric(12,2) not null default 0 check (weekly_rate >= 0),
  monthly_rate    numeric(12,2) not null default 0 check (monthly_rate >= 0),
  km_per_day      int not null default 0 check (km_per_day between 0 and 10000),
  extra_km_rate   numeric(12,2) not null default 0 check (extra_km_rate >= 0),
  active          boolean not null default true,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tariff_cards_dates_chk check (valid_to is null or valid_to >= valid_from)
);
create index if not exists tariff_cards_group_idx on public.tariff_cards (tariff_group_id, customer_id);

-- ───────────────────────── vehicles ─────────────────────────
alter table public.vehicles
  add column if not exists branch_id          uuid references public.branches(id) on delete set null,
  add column if not exists tariff_group_id    uuid references public.tariff_groups(id) on delete set null,
  add column if not exists vin                text not null default '',
  add column if not exists engine_capacity    text not null default '',
  add column if not exists transmission       text not null default 'automatic',
  add column if not exists fuel_type          text not null default 'petrol',
  add column if not exists sipp_code          text not null default '',
  add column if not exists service_interval_km int,
  add column if not exists last_service_km    int,
  add column if not exists next_service_date  date,
  add column if not exists defleeted_on       date,
  add column if not exists defleet_reason     text not null default '',
  add column if not exists defleet_price      numeric(12,2) not null default 0;
alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check
  check (status in ('available','rented','maintenance','nrm','custody','retired'));
alter table public.vehicles drop constraint if exists vehicles_sipp_chk;
alter table public.vehicles add constraint vehicles_sipp_chk check (sipp_code = '' or sipp_code ~ '^[A-Z]{4}$');
alter table public.vehicles drop constraint if exists vehicles_transmission_chk;
alter table public.vehicles add constraint vehicles_transmission_chk check (transmission in ('automatic','manual'));
alter table public.vehicles drop constraint if exists vehicles_fuel_chk;
alter table public.vehicles add constraint vehicles_fuel_chk check (fuel_type in ('petrol','diesel','hybrid','electric'));
alter table public.vehicles drop constraint if exists vehicles_service_chk;
alter table public.vehicles add constraint vehicles_service_chk
  check ((service_interval_km is null or service_interval_km between 0 and 100000) and (last_service_km is null or last_service_km >= 0));

-- ───────────────────────── rentals ─────────────────────────
alter table public.rentals
  add column if not exists branch_out_id    uuid references public.branches(id) on delete set null,
  add column if not exists branch_in_id     uuid references public.branches(id) on delete set null,
  add column if not exists tariff_card_id   uuid references public.tariff_cards(id) on delete set null,
  add column if not exists km_per_day       int not null default 0,
  add column if not exists extra_km_rate    numeric(12,2) not null default 0,
  add column if not exists extra_km_charge  numeric(12,2) not null default 0,
  add column if not exists driver_name      text not null default '',
  add column if not exists driver_license   text not null default '',
  add column if not exists driver_phone     text not null default '',
  add column if not exists cancel_reason    text not null default '',
  add column if not exists cancelled_at     timestamptz;
alter table public.rentals drop constraint if exists rentals_km_chk;
alter table public.rentals add constraint rentals_km_chk check (km_per_day between 0 and 10000 and extra_km_rate >= 0 and extra_km_charge >= 0);

-- Vehicle replacement during an agreement: one row per swap, keeping the readings of the car that came back.
create table if not exists public.vehicle_replacements (
  id               uuid primary key default gen_random_uuid(),
  rental_id        uuid not null references public.rentals(id) on delete cascade,
  replaced_at      timestamptz not null default now(),
  old_vehicle_id   uuid not null references public.vehicles(id) on delete restrict,
  new_vehicle_id   uuid not null references public.vehicles(id) on delete restrict,
  old_odometer_out int,
  old_odometer_in  int not null check (old_odometer_in >= 0),
  old_fuel_in      text not null check (old_fuel_in in ('empty','1/4','1/2','3/4','full')),
  new_odometer_out int not null check (new_odometer_out >= 0),
  new_fuel_out     text not null check (new_fuel_out in ('empty','1/4','1/2','3/4','full')),
  reason           text not null default '',
  created_by       uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists vehicle_replacements_rental_idx on public.vehicle_replacements (rental_id, replaced_at);
create index if not exists vehicle_replacements_old_idx on public.vehicle_replacements (old_vehicle_id);

-- Agreement editing log: one line per change to an agreement, with what changed.
create table if not exists public.rental_events (
  id          bigint generated always as identity primary key,
  rental_id   uuid not null references public.rentals(id) on delete cascade,
  at          timestamptz not null default now(),
  action      text not null,
  details     text not null default '',
  actor       uuid,
  actor_name  text not null default ''
);
create index if not exists rental_events_rental_idx on public.rental_events (rental_id, at);

-- Pricing + workflow rules (v2.1: staff movements, replacement, km allowance, cancellation time).
create or replace function private.rentals_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; c public.customers; billed_end timestamptz; driven int; replacing boolean := false;
begin
  if tg_op = 'UPDATE' then
    replacing := coalesce(current_setting('anamira.replacing', true), '') = new.id::text;
    if old.status in ('returned','cancelled') then
      raise exception 'Rental % is closed and cannot be changed', old.ref;
    end if;
    if new.status <> old.status and not (
         (old.status = 'booked' and new.status in ('active','cancelled')) or
         (old.status = 'active' and new.status = 'returned')) then
      raise exception 'Cannot move rental from % to %', old.status, new.status;
    end if;
    if old.status = 'active' and (new.customer_id <> old.customer_id or (new.vehicle_id <> old.vehicle_id and not replacing)) then
      raise exception 'Car and customer cannot change once the rental has started. Use Replace vehicle to swap the car.';
    end if;
    new.ref := old.ref; new.created_by := old.created_by; new.created_at := old.created_at;
    new.cancelled_at := case when new.status = 'cancelled' then coalesce(old.cancelled_at, now()) else null end;
  else
    if new.status not in ('booked','active') then
      raise exception 'New rentals start as booked or active';
    end if;
    new.cancelled_at := null;
  end if;

  select * into c from public.customers where id = new.customer_id;
  if c.blacklisted and (tg_op = 'INSERT' or new.status = 'active') then
    raise exception 'Customer % is blacklisted', c.full_name;
  end if;

  select * into v from public.vehicles where id = new.vehicle_id;
  if v.status = 'retired' then raise exception 'Car % is retired', v.plate_number; end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status = 'booked' or replacing) then
    if v.status = 'maintenance' then raise exception 'Car % is in maintenance', v.plate_number; end if;
    if v.status in ('nrm','custody') then raise exception 'Car % is out on a staff movement. Close the movement first.', v.plate_number; end if;
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
  new.days := greatest(1, ceil(extract(epoch from (billed_end - new.start_at)) / 86400.0 - 0.0417)::int); -- 1h grace
  -- Km allowance: charged on return, over all cars used on this agreement.
  new.extra_km_charge := 0;
  if new.status = 'returned' and new.km_per_day > 0 and new.extra_km_rate > 0 and new.odometer_out is not null then
    driven := (new.odometer_in - new.odometer_out)
              + coalesce((select sum(greatest(0, x.old_odometer_in - coalesce(x.old_odometer_out, x.old_odometer_in)))
                            from public.vehicle_replacements x where x.rental_id = new.id), 0);
    new.extra_km_charge := round(greatest(0, driven - new.km_per_day * new.days) * new.extra_km_rate, 2);
  end if;
  new.subtotal := round(new.days * new.daily_rate + new.extras + new.extra_km_charge - new.discount, 2);
  if new.subtotal < 0 then raise exception 'Discount is larger than the rental amount'; end if;
  new.vat   := round(new.subtotal * new.vat_rate / 100, 2);
  new.total := new.subtotal + new.vat;
  return new;
end $$;

create or replace function private.rentals_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.settings;
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
           odometer = greatest(odometer, coalesce(new.odometer_in, odometer)),
           branch_id = coalesce(new.branch_in_id, branch_id)
     where id = new.vehicle_id;
    select * into s from public.settings limit 1;
    if coalesce(s.invoice_fines_on_close, true) then
      perform private.invoice_pending_fines(new.id);
    end if;
  end if;
  return null;
end $$;

-- Writes the agreement editing log.
create or replace function private.rental_events_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare act text; det text[] := '{}'; o jsonb; n jsonb; k text; ov text; nv text;
begin
  if tg_op = 'INSERT' then
    act := 'opened';
    det := array[format('%s → %s, %s', to_char(new.start_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI'),
                        to_char(new.end_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI'), new.status)];
  else
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array array['status','customer_id','vehicle_id','start_at','end_at','returned_at','daily_rate','extras','discount',
                             'vat_rate','deposit','odometer_out','odometer_in','fuel_out','fuel_in','km_per_day','extra_km_rate',
                             'extra_km_charge','driver_name','driver_license','driver_phone','branch_out_id','branch_in_id',
                             'total','notes','cancel_reason'] loop
      if o->k is distinct from n->k then
        ov := o->>k; nv := n->>k;
        if k = 'vehicle_id' then
          ov := (select trim(plate_code || ' ' || plate_number) from public.vehicles where id = old.vehicle_id);
          nv := (select trim(plate_code || ' ' || plate_number) from public.vehicles where id = new.vehicle_id);
        elsif k = 'customer_id' then
          ov := (select full_name from public.customers where id = old.customer_id);
          nv := (select full_name from public.customers where id = new.customer_id);
        elsif k in ('branch_out_id','branch_in_id') then
          ov := (select name from public.branches where id = (o->>k)::uuid);
          nv := (select name from public.branches where id = (n->>k)::uuid);
        elsif k in ('start_at','end_at','returned_at') then
          ov := to_char((o->>k)::timestamptz at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI');
          nv := to_char((n->>k)::timestamptz at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI');
        end if;
        det := det || format('%s: %s → %s', k, coalesce(left(ov, 60), '—'), coalesce(left(nv, 60), '—'));
      end if;
    end loop;
    if cardinality(det) = 0 then return null; end if;
    act := case
      when new.status <> old.status then
        case new.status when 'active' then 'handed_over' when 'returned' then 'closed' when 'cancelled' then 'cancelled' else 'edited' end
      when new.vehicle_id <> old.vehicle_id then 'vehicle_replaced'
      when new.driver_name is distinct from old.driver_name and old.driver_name <> '' then 'driver_replaced'
      when new.end_at > old.end_at then 'extended'
      when new.end_at < old.end_at then 'cut_short'
      else 'edited' end;
  end if;
  insert into public.rental_events (rental_id, action, details, actor, actor_name)
  values (new.id, act, left(array_to_string(det, '; '), 2000), auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'system'));
  return null;
end $$;
drop trigger if exists rentals_events on public.rentals;
create trigger rentals_events after insert or update on public.rentals
  for each row execute function private.rental_events_log();

-- Swap the car on a running agreement (breakdown, upgrade, customer request).
create or replace function public.replace_vehicle(p_rental uuid, p_vehicle uuid, p_old_odometer int, p_old_fuel text,
                                                  p_new_odometer int default null, p_new_fuel text default 'full',
                                                  p_reason text default '', p_at timestamptz default now())
returns public.rentals
language plpgsql security definer set search_path = '' as $$
declare r public.rentals; nv public.vehicles; ov public.vehicles;
begin
  if not private.has_role('admin','manager','agent') then
    raise exception 'Only admin, manager or agent can replace a vehicle';
  end if;
  select * into r from public.rentals where id = p_rental for update;
  if r.id is null then raise exception 'Rental not found'; end if;
  if r.status <> 'active' then raise exception 'Only a running rental can have its car replaced'; end if;
  if p_vehicle = r.vehicle_id then raise exception 'Pick a different car'; end if;
  select * into ov from public.vehicles where id = r.vehicle_id for update;
  select * into nv from public.vehicles where id = p_vehicle for update;
  if nv.id is null then raise exception 'Car not found'; end if;
  if nv.status <> 'available' then raise exception 'Car % is not available (it is %)', nv.plate_number, nv.status; end if;
  if p_old_odometer is null or p_old_odometer < coalesce(r.odometer_out, 0) then
    raise exception 'The returned car''s odometer cannot be lower than when it went out (%)', coalesce(r.odometer_out, 0);
  end if;
  if p_old_fuel not in ('empty','1/4','1/2','3/4','full') or coalesce(p_new_fuel, 'full') not in ('empty','1/4','1/2','3/4','full') then
    raise exception 'Pick a fuel level';
  end if;
  if p_at is null or p_at < r.start_at - interval '1 day' or p_at > greatest(r.end_at, now()) + interval '1 day' then
    raise exception 'The replacement time must be within the rental';
  end if;

  insert into public.vehicle_replacements (rental_id, replaced_at, old_vehicle_id, new_vehicle_id, old_odometer_out, old_odometer_in,
                                           old_fuel_in, new_odometer_out, new_fuel_out, reason)
  values (r.id, p_at, ov.id, nv.id, r.odometer_out, p_old_odometer, p_old_fuel, coalesce(p_new_odometer, nv.odometer),
          coalesce(p_new_fuel, 'full'), left(coalesce(p_reason, ''), 300));

  perform set_config('anamira.replacing', r.id::text, true);
  update public.rentals set vehicle_id = nv.id, odometer_out = coalesce(p_new_odometer, nv.odometer), fuel_out = coalesce(p_new_fuel, 'full')
   where id = r.id returning * into r;
  perform set_config('anamira.replacing', '', true);

  update public.vehicles set status = case when status = 'rented' then 'available' else status end,
         odometer = greatest(odometer, p_old_odometer)
   where id = ov.id;
  return r;
end $$;

-- ───────────────────────── staff (NRM) and custody movements ─────────────────────────
create sequence if not exists public.movement_ref_seq start 1001;
create table if not exists public.movements (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default ('MV-' || nextval('public.movement_ref_seq')),
  kind            text not null default 'nrm' check (kind in ('nrm','custody')),
  vehicle_id      uuid not null references public.vehicles(id) on delete restrict,
  employee_id     uuid not null references public.employees(id) on delete restrict,
  from_branch_id  uuid references public.branches(id) on delete set null,
  to_branch_id    uuid references public.branches(id) on delete set null,
  purpose         text not null default '',
  status          text not null default 'open' check (status in ('open','closed')),
  out_at          timestamptz not null default now(),
  expected_in_at  timestamptz,
  odometer_out    int check (odometer_out >= 0),
  fuel_out        text not null default 'full' check (fuel_out in ('empty','1/4','1/2','3/4','full')),
  in_at           timestamptz,
  odometer_in     int check (odometer_in >= 0),
  fuel_in         text check (fuel_in in ('empty','1/4','1/2','3/4','full')),
  notes           text not null default '',
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint movements_odo_chk check (odometer_in is null or odometer_out is null or odometer_in >= odometer_out),
  constraint movements_time_chk check (in_at is null or in_at >= out_at)
);
create index if not exists movements_vehicle_idx on public.movements (vehicle_id, out_at);
create unique index if not exists movements_one_open_uq on public.movements (vehicle_id) where status = 'open';

create or replace function private.movements_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'closed' then raise exception 'Movement % is closed and cannot be changed', old.ref; end if;
    if new.vehicle_id <> old.vehicle_id or new.kind <> old.kind then
      raise exception 'Car and type cannot change once the movement is open';
    end if;
    new.ref := old.ref; new.created_by := old.created_by; new.created_at := old.created_at;
  else
    if new.status <> 'open' then raise exception 'New movements start open'; end if;
  end if;
  select * into v from public.vehicles where id = new.vehicle_id;
  if tg_op = 'INSERT' then
    if v.status <> 'available' then
      raise exception 'Car % is not available for a staff movement (it is %)', v.plate_number, v.status;
    end if;
    new.odometer_out := coalesce(new.odometer_out, v.odometer);
    new.from_branch_id := coalesce(new.from_branch_id, v.branch_id);
  end if;
  if new.status = 'closed' then
    new.in_at := coalesce(new.in_at, now());
    if new.odometer_in is null then raise exception 'Enter the odometer reading on return'; end if;
    if new.fuel_in is null then raise exception 'Enter the fuel level on return'; end if;
    if new.odometer_out is not null and new.odometer_in < new.odometer_out then
      raise exception 'Odometer in cannot be lower than odometer out (%)', new.odometer_out;
    end if;
    if new.in_at < new.out_at then raise exception 'Return time cannot be before the car went out'; end if;
  end if;
  return new;
end $$;

create or replace function private.movements_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'open' then
      update public.vehicles set status = 'available' where id = old.vehicle_id and status = old.kind;
    end if;
    return null;
  end if;
  if new.status = 'open' then
    update public.vehicles set status = new.kind where id = new.vehicle_id and status = 'available';
  elsif tg_op = 'UPDATE' and old.status = 'open' and new.status = 'closed' then
    update public.vehicles
       set status = case when status = new.kind then 'available' else status end,
           odometer = greatest(odometer, coalesce(new.odometer_in, odometer)),
           branch_id = coalesce(new.to_branch_id, branch_id)
     where id = new.vehicle_id;
  end if;
  return null;
end $$;
drop trigger if exists movements_before on public.movements;
create trigger movements_before before insert or update on public.movements for each row execute function private.movements_before();
drop trigger if exists movements_after on public.movements;
create trigger movements_after after insert or update or delete on public.movements for each row execute function private.movements_after();

-- ───────────────────────── garage movements (maintenance jobs) ─────────────────────────
alter table public.maintenance
  add column if not exists supplier_id  uuid references public.suppliers(id) on delete set null,
  add column if not exists employee_id  uuid references public.employees(id) on delete set null,
  add column if not exists job_type     text not null default '',
  add column if not exists expected_on  date;

create or replace function private.maintenance_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles;
begin
  select * into v from public.vehicles where id = new.vehicle_id;
  if new.status = 'open' then
    if exists (select 1 from public.rentals where vehicle_id = new.vehicle_id and status = 'active') then
      raise exception 'This car is out on a rental. Return it first.';
    end if;
    if v.status in ('nrm','custody') then
      raise exception 'This car is out on a staff movement. Close the movement first.';
    end if;
    update public.vehicles set status = 'maintenance' where id = new.vehicle_id and status = 'available';
  elsif new.status = 'done' then
    new.closed_on := coalesce(new.closed_on, current_date);
    if not exists (select 1 from public.maintenance m where m.vehicle_id = new.vehicle_id and m.status = 'open' and m.id <> new.id) then
      update public.vehicles set status = 'available' where id = new.vehicle_id and status = 'maintenance';
    end if;
    if new.kind = 'service' and (tg_op = 'INSERT' or old.status = 'open') then
      update public.vehicles set last_service_km = greatest(coalesce(last_service_km, 0), coalesce(new.odometer, odometer))
       where id = new.vehicle_id;
    end if;
  end if;
  if new.odometer is not null then
    update public.vehicles set odometer = greatest(odometer, new.odometer) where id = new.vehicle_id;
  end if;
  return new;
end $$;

-- ───────────────────────── vouchers: invoices, bills, payment/receipt vouchers ─────────────────────────
create sequence if not exists public.invoice_ref_seq start 1001;
create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique default ('INV-' || nextval('public.invoice_ref_seq')),
  customer_id  uuid not null references public.customers(id) on delete restrict,
  rental_id    uuid references public.rentals(id) on delete restrict,
  kind         text not null default 'other' check (kind in ('fines','damage','fuel','rental','other')),
  issued_on    date not null default current_date,
  due_on       date,
  description  text not null default '',
  amount       numeric(12,2) not null check (amount >= 0),
  vat          numeric(12,2) not null default 0 check (vat >= 0),
  total        numeric(12,2) generated always as (amount + vat) stored,
  status       text not null default 'open' check (status in ('open','void')),
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists invoices_customer_idx on public.invoices (customer_id, issued_on);
create index if not exists invoices_rental_idx on public.invoices (rental_id);

create or replace function private.invoices_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'void' then raise exception 'Invoice % is void and cannot be changed', old.ref; end if;
    new.ref := old.ref; new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  if new.rental_id is not null then
    new.customer_id := (select customer_id from public.rentals where id = new.rental_id);
  end if;
  return new;
end $$;
-- A voided fines invoice releases its fines so they can be invoiced again (or waived by changing their status).
create or replace function private.invoices_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update public.fines set invoice_id = null where invoice_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists invoices_before on public.invoices;
create trigger invoices_before before insert or update on public.invoices for each row execute function private.invoices_before();
drop trigger if exists invoices_after on public.invoices;
create trigger invoices_after after update on public.invoices for each row execute function private.invoices_after();

create sequence if not exists public.bill_ref_seq start 1001;
create table if not exists public.bills (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default ('BL-' || nextval('public.bill_ref_seq')),
  supplier_id     uuid not null references public.suppliers(id) on delete restrict,
  bill_no         text not null default '',
  bill_date       date not null default current_date,
  due_date        date,
  category        text not null default 'other' check (category in ('maintenance','parts','tyres','insurance','registration','leasing','fuel','rent','utilities','marketing','office','other')),
  description     text not null default '',
  amount          numeric(12,2) not null check (amount >= 0),
  vat             numeric(12,2) not null default 0 check (vat >= 0),
  total           numeric(12,2) generated always as (amount + vat) stored,
  vehicle_id      uuid references public.vehicles(id) on delete set null,
  maintenance_id  uuid references public.maintenance(id) on delete set null,
  status          text not null default 'open' check (status in ('open','void')),
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists bills_supplier_idx on public.bills (supplier_id, bill_date);

create sequence if not exists public.voucher_ref_seq start 1001;
create table if not exists public.vouchers (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  direction    text not null default 'payment' check (direction in ('payment','receipt')),
  party_type   text not null default 'supplier' check (party_type in ('supplier','employee','other')),
  supplier_id  uuid references public.suppliers(id) on delete restrict,
  employee_id  uuid references public.employees(id) on delete restrict,
  party_name   text not null default '',
  purpose      text not null default 'bill' check (purpose in ('bill','advance','salary','recovery','reimbursement','refund','other')),
  method       text not null default 'bank' check (method in ('cash','card','bank','cheque')),
  amount       numeric(12,2) not null check (amount > 0),
  paid_on      date not null default current_date,
  cheque_no    text not null default '',
  note         text not null default '',
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint vouchers_party_chk check (
    (party_type = 'supplier' and supplier_id is not null) or
    (party_type = 'employee' and employee_id is not null) or
    (party_type = 'other' and length(trim(party_name)) > 0))
);
create index if not exists vouchers_supplier_idx on public.vouchers (supplier_id);
create index if not exists vouchers_employee_idx on public.vouchers (employee_id);

create or replace function private.vouchers_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.ref := case when new.direction = old.direction then old.ref
                    else (case new.direction when 'payment' then 'PV-' else 'RV-' end) || substr(old.ref, 4) end;
    new.created_by := old.created_by; new.created_at := old.created_at;
  else
    new.ref := (case new.direction when 'payment' then 'PV-' else 'RV-' end) || nextval('public.voucher_ref_seq');
  end if;
  if new.party_type <> 'supplier' then new.supplier_id := null; end if;
  if new.party_type <> 'employee' then new.employee_id := null; end if;
  return new;
end $$;
drop trigger if exists vouchers_before on public.vouchers;
create trigger vouchers_before before insert or update on public.vouchers for each row execute function private.vouchers_before();

-- ───────────────────────── fines, Salik, Darb, mall parking ─────────────────────────
alter table public.fines
  add column if not exists employee_id    uuid references public.employees(id) on delete set null,
  add column if not exists invoice_id     uuid references public.invoices(id) on delete set null,
  add column if not exists reconciled_at  timestamptz;
alter table public.fines drop constraint if exists fines_kind_check;
alter table public.fines add constraint fines_kind_check check (kind in ('salik','darb','mall_parking','traffic','parking','other'));
alter table public.fines drop constraint if exists fines_status_check;
alter table public.fines add constraint fines_status_check
  check (status in ('new','charged','company','employee','unmatched','paid','disputed'));
create index if not exists fines_invoice_idx on public.fines (invoice_id);

-- Who had each car when: one row per (rental, car) leg, so a fine after a vehicle replacement goes to the right car.
create or replace function private.rental_legs(p_vehicle uuid)
returns table (rental_id uuid, customer_id uuid, from_at timestamptz, to_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with reps as (
    select x.rental_id, x.old_vehicle_id, x.replaced_at,
           lag(x.replaced_at) over (partition by x.rental_id order by x.replaced_at) as prev_at
      from public.vehicle_replacements x
  ), legs as (
    select k.id, k.customer_id, x.old_vehicle_id as vehicle_id, coalesce(x.prev_at, k.start_at) as from_at, x.replaced_at as to_at
      from reps x join public.rentals k on k.id = x.rental_id
     where k.status in ('active','returned')
    union all
    select k.id, k.customer_id, k.vehicle_id,
           coalesce((select max(y.replaced_at) from public.vehicle_replacements y where y.rental_id = k.id), k.start_at),
           coalesce(k.returned_at, greatest(k.end_at, now()))
      from public.rentals k
     where k.status in ('active','returned')
  )
  select l.id, l.customer_id, l.from_at, l.to_at from legs l where l.vehicle_id = p_vehicle
$$;

-- Match every new/unmatched fine to the car, then to the rental (customer) or staff movement (employee) of that moment.
create or replace function private.match_fines_core() returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; f record; v uuid; r_id uuid; c_id uuid; m_emp uuid; s public.settings;
begin
  select * into s from public.settings limit 1;
  for f in select * from public.fines where status in ('new','unmatched') for update loop
    v := null; r_id := null; c_id := null; m_emp := null;
    select id into v from public.vehicles
     where ltrim(plate_number, '0') = ltrim(f.plate_number, '0')
       and (f.plate_code = '' or private.norm_plate(plate_code) = private.norm_plate(f.plate_code))
     order by created_at limit 1;
    if v is null then
      update public.fines set status = 'unmatched' where id = f.id;
    else
      select l.rental_id, l.customer_id into r_id, c_id from private.rental_legs(v) l
       where f.occurred_at >= l.from_at and f.occurred_at <= l.to_at
       order by l.from_at desc limit 1;
      if r_id is not null then
        update public.fines set vehicle_id = v, rental_id = r_id, customer_id = c_id, employee_id = null, status = 'charged',
               admin_fee = case when f.kind in ('salik','darb','mall_parking') then s.salik_fee
                                else round(f.amount * s.fine_fee_pct / 100, 2) end
         where id = f.id;
      else
        select mv.employee_id into m_emp from public.movements mv
         where mv.vehicle_id = v and f.occurred_at >= mv.out_at and f.occurred_at <= coalesce(mv.in_at, now())
         order by mv.out_at desc limit 1;
        if m_emp is not null then
          update public.fines set vehicle_id = v, employee_id = m_emp, rental_id = null, customer_id = null,
                 status = 'employee', admin_fee = 0 where id = f.id;
        else
          update public.fines set vehicle_id = v, status = 'company', admin_fee = 0 where id = f.id;
        end if;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.match_fines() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('admin','manager','accountant') then
    raise exception 'Only admin, manager or accountant can match fines';
  end if;
  return private.match_fines_core();
end $$;

-- Statement import (from 20261119000001), now also accepting Darb and mall parking rows.
create or replace function public.import_fines(rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb; k text; ref text; pc text; pn text; at timestamptz; amt numeric; stamp timestamptz := clock_timestamp();
  n_in int := 0; n_dup int := 0; n_bad int := 0; n_all int := 0;
begin
  if not private.has_role('admin','manager','accountant') then
    raise exception 'Only admin, manager or accountant can import fines';
  end if;
  if jsonb_typeof(rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;
  if jsonb_array_length(rows) > 5000 then raise exception 'Import at most 5000 rows at a time'; end if;

  for x in select * from jsonb_array_elements(rows) loop
    n_all := n_all + 1;
    begin
      k   := coalesce(nullif(x->>'kind', ''), 'salik');
      ref := left(trim(coalesce(x->>'reference', '')), 60);
      pc  := left(private.norm_plate(x->>'plate_code'), 4);
      pn  := left(private.norm_plate(x->>'plate_number'), 10);
      at  := (x->>'occurred_at')::timestamptz;
      amt := round((x->>'amount')::numeric, 2);
      if pn = '' or at is null or amt is null or amt < 0 or k not in ('salik','darb','mall_parking','traffic','parking','other') then
        n_bad := n_bad + 1; continue;
      end if;
      if (ref <> '' and exists (select 1 from public.fines f where f.kind = k and f.reference = ref))
         or (ref = '' and exists (select 1 from public.fines f where f.kind = k and f.plate_number = pn
                                    and f.occurred_at = at and f.amount = amt)) then
        n_dup := n_dup + 1; continue;
      end if;
      insert into public.fines (kind, source, reference, plate_code, plate_number, occurred_at, location, description,
                                amount, black_points, status, imported_at)
      values (k, left(trim(coalesce(x->>'source', '')), 60), ref, pc, pn, at, left(trim(coalesce(x->>'location', '')), 120),
              left(trim(coalesce(x->>'description', '')), 300), amt,
              least(greatest(coalesce(nullif(x->>'black_points', '')::int, 0), 0), 24), 'new', stamp);
      n_in := n_in + 1;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
                   or numeric_value_out_of_range or check_violation then
      n_bad := n_bad + 1;
    end;
  end loop;

  perform private.match_fines_core();

  return jsonb_build_object(
    'received', n_all, 'inserted', n_in, 'duplicates', n_dup, 'invalid', n_bad,
    'charged',   (select count(*) from public.fines where imported_at = stamp and status = 'charged'),
    'company',   (select count(*) from public.fines where imported_at = stamp and status in ('company','employee')),
    'unmatched', (select count(*) from public.fines where imported_at = stamp and status = 'unmatched'));
end $$;

-- Invoice every fine/toll charged to a customer and not yet invoiced: one invoice per agreement.
-- The admin fee carries VAT; the fine or toll itself is passed on without VAT.
create or replace function private.invoice_pending_fines(p_rental uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare g record; inv uuid; n int := 0; rate numeric; since date;
begin
  select vat_rate, fines_invoice_from into rate, since from public.settings limit 1;
  for g in
    select f.customer_id, f.rental_id, array_agg(f.id) as ids, count(*) as cnt,
           sum(f.amount + f.admin_fee) as amt, sum(f.admin_fee) as fee,
           string_agg(distinct f.kind, ', ') as kinds, min(f.occurred_at) as first_at, max(f.occurred_at) as last_at
      from public.fines f
     where f.status = 'charged' and f.invoice_id is null and f.customer_id is not null
       and (p_rental is null or f.rental_id = p_rental)
       and f.occurred_at >= (coalesce(since, '2000-01-01')::timestamp at time zone 'Asia/Dubai')
     group by f.customer_id, f.rental_id
  loop
    insert into public.invoices (customer_id, rental_id, kind, description, amount, vat)
    values (g.customer_id, g.rental_id, 'fines',
            format('%s charge(s): %s, %s to %s', g.cnt, replace(g.kinds, '_', ' '),
                   to_char(g.first_at at time zone 'Asia/Dubai', 'DD Mon YYYY'), to_char(g.last_at at time zone 'Asia/Dubai', 'DD Mon YYYY')),
            g.amt, round(g.fee * coalesce(rate, 0) / 100, 2))
    returning id into inv;
    update public.fines set invoice_id = inv where id = any(g.ids);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.invoice_fines() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('admin','manager','accountant') then
    raise exception 'Only admin, manager or accountant can create invoices';
  end if;
  return private.invoice_pending_fines(null);
end $$;

-- Mark a statement period as reconciled (mall parking, Salik, Darb or fines).
create or replace function public.reconcile_fines(p_kind text, p_from date, p_to date) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.has_role('admin','manager','accountant') then
    raise exception 'Only admin, manager or accountant can reconcile';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a valid period'; end if;
  update public.fines set reconciled_at = now()
   where kind = p_kind and reconciled_at is null
     and occurred_at >= (p_from::timestamp at time zone 'Asia/Dubai')
     and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Dubai');
  get diagnostics n = row_count;
  return n;
end $$;

-- Daily job: match new fines and invoice everything charged (also callable from the app).
create or replace function private.daily_fines_job() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m int; i int;
begin
  m := private.match_fines_core();
  -- Automatic invoicing follows the same switch as invoicing on return (Settings).
  if coalesce((select invoice_fines_on_close from public.settings limit 1), true) then
    i := private.invoice_pending_fines(null);
  else
    i := 0;
  end if;
  return jsonb_build_object('matched', m, 'invoices', i);
end $$;

-- ───────────────────────── rental balances include agreement invoices ─────────────────────────
create or replace view public.rental_balances with (security_invoker = true) as
select r.id as rental_id,
       r.total,
       coalesce(p.paid, 0)::numeric(12,2) as paid,
       coalesce(p.deposit_held, 0)::numeric(12,2) as deposit_held,
       (r.total + coalesce(i.invoiced, 0) - coalesce(p.paid, 0))::numeric(12,2) as balance,
       coalesce(i.invoiced, 0)::numeric(12,2) as invoiced
  from public.rentals r
  left join (select rental_id,
                    sum(case kind when 'payment' then amount when 'refund' then -amount else 0 end) as paid,
                    sum(case kind when 'deposit' then amount when 'deposit_return' then -amount else 0 end) as deposit_held
               from public.payments where rental_id is not null group by rental_id) p on p.rental_id = r.id
  left join (select rental_id, sum(total) as invoiced
               from public.invoices where status = 'open' and rental_id is not null group by rental_id) i on i.rental_id = r.id;

-- ───────────────────────── mobile check-out / check-in (check cards) ─────────────────────────
create sequence if not exists public.inspection_ref_seq start 1001;
create table if not exists public.inspections (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text not null unique default ('CC-' || nextval('public.inspection_ref_seq')),
  kind                text not null check (kind in ('checkout','checkin')),
  context             text not null check (context in ('rental','nrm','custody')),
  rental_id           uuid references public.rentals(id) on delete cascade,
  movement_id         uuid references public.movements(id) on delete cascade,
  vehicle_id          uuid not null references public.vehicles(id) on delete restrict,
  at                  timestamptz not null default now(),
  odometer            int not null check (odometer >= 0),
  fuel                text not null check (fuel in ('empty','1/4','1/2','3/4','full')),
  checklist           jsonb not null default '{}' check (jsonb_typeof(checklist) = 'object'),
  photos              text[] not null default '{}',
  notes               text not null default '',
  staff_name          text not null default '',
  customer_signature  text not null default '' check (length(customer_signature) <= 400000),
  staff_signature     text not null default '' check (length(staff_signature) <= 400000),
  created_by          uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists inspections_vehicle_idx on public.inspections (vehicle_id, at);
create index if not exists inspections_rental_idx on public.inspections (rental_id);

create table if not exists public.damages (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  inspection_id   uuid references public.inspections(id) on delete set null,
  view            text not null default 'exterior' check (view in ('exterior','interior')),
  x               numeric(5,2) not null check (x between 0 and 100),
  y               numeric(5,2) not null check (y between 0 and 100),
  kind            text not null default 'scratch' check (kind in ('scratch','dent','crack','broken','missing','stain','burn','other')),
  severity        text not null default 'minor' check (severity in ('minor','major')),
  note            text not null default '',
  photos          text[] not null default '{}',
  status          text not null default 'open' check (status in ('open','repaired')),
  repaired_on     date,
  maintenance_id  uuid references public.maintenance(id) on delete set null,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists damages_vehicle_idx on public.damages (vehicle_id, status);

create or replace function private.damages_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'repaired' then new.repaired_on := coalesce(new.repaired_on, current_date);
  else new.repaired_on := null; new.maintenance_id := null; end if;
  return new;
end $$;
drop trigger if exists damages_before on public.damages;
create trigger damages_before before insert or update on public.damages for each row execute function private.damages_before();

-- One call does the whole check-out or check-in: moves the agreement or staff movement, saves the check card,
-- the check-list, signatures, photos and any new damages. Everything succeeds or nothing is saved.
create or replace function public.check_out_in(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k text := payload->>'kind'; ctx text := payload->>'context';
  at timestamptz := coalesce(nullif(payload->>'at', '')::timestamptz, now());
  odo int := nullif(payload->>'odometer', '')::int; fuel text := payload->>'fuel';
  r public.rentals; m public.movements; veh uuid; ins public.inspections; d jsonb;
begin
  if not private.has_role('admin','manager','agent') then
    raise exception 'Only admin, manager or agent can check cars out or in';
  end if;
  if k not in ('checkout','checkin') or ctx not in ('rental','nrm','custody') then raise exception 'Unknown check type'; end if;
  if odo is null or odo < 0 then raise exception 'Enter the odometer reading'; end if;
  if fuel is null or fuel not in ('empty','1/4','1/2','3/4','full') then raise exception 'Enter the fuel level'; end if;
  if jsonb_typeof(coalesce(payload->'damages', '[]')) <> 'array' or jsonb_array_length(coalesce(payload->'damages', '[]')) > 60 then
    raise exception 'Too many damages in one check card';
  end if;

  if ctx = 'rental' then
    select * into r from public.rentals where id = nullif(payload->>'rental_id', '')::uuid for update;
    if r.id is null then raise exception 'Pick the rental agreement'; end if;
    if k = 'checkout' then
      if r.status <> 'booked' then raise exception 'Rental % is not waiting to be handed over (it is %)', r.ref, r.status; end if;
      update public.rentals set status = 'active', odometer_out = odo, fuel_out = fuel where id = r.id returning * into r;
    else
      if r.status <> 'active' then raise exception 'Rental % is not out (it is %)', r.ref, r.status; end if;
      update public.rentals set status = 'returned', odometer_in = odo, fuel_in = fuel, returned_at = at,
             branch_in_id = coalesce(nullif(payload->>'branch_id', '')::uuid, branch_in_id)
       where id = r.id returning * into r;
    end if;
    veh := r.vehicle_id;
  else
    if k = 'checkout' then
      if nullif(payload->>'vehicle_id', '') is null then raise exception 'Pick the car'; end if;
      if nullif(payload->>'employee_id', '') is null then raise exception 'Pick the employee who takes the car'; end if;
      insert into public.movements (kind, vehicle_id, employee_id, purpose, out_at, expected_in_at, odometer_out, fuel_out, to_branch_id)
      values (ctx, nullif(payload->>'vehicle_id', '')::uuid, nullif(payload->>'employee_id', '')::uuid,
              left(coalesce(payload->>'purpose', ''), 300), at, nullif(payload->>'expected_in_at', '')::timestamptz, odo, fuel,
              nullif(payload->>'branch_id', '')::uuid)
      returning * into m;
    else
      select * into m from public.movements where id = nullif(payload->>'movement_id', '')::uuid for update;
      if m.id is null then raise exception 'Pick the staff movement'; end if;
      if m.status <> 'open' then raise exception 'Movement % is already closed', m.ref; end if;
      update public.movements set status = 'closed', odometer_in = odo, fuel_in = fuel, in_at = at,
             to_branch_id = coalesce(nullif(payload->>'branch_id', '')::uuid, to_branch_id)
       where id = m.id returning * into m;
    end if;
    veh := m.vehicle_id;
  end if;

  insert into public.inspections (kind, context, rental_id, movement_id, vehicle_id, at, odometer, fuel, checklist, photos, notes,
                                  staff_name, customer_signature, staff_signature)
  values (k, ctx, r.id, m.id, veh, at, odo, fuel,
          case when jsonb_typeof(payload->'checklist') = 'object' then payload->'checklist' else '{}'::jsonb end,
          coalesce((select array_agg(left(p, 300)) from jsonb_array_elements_text(coalesce(payload->'photos', '[]')) p), '{}'),
          left(coalesce(payload->>'notes', ''), 2000), left(coalesce(payload->>'staff_name', ''), 120),
          coalesce(payload->>'customer_signature', ''), coalesce(payload->>'staff_signature', ''))
  returning * into ins;

  for d in select * from jsonb_array_elements(coalesce(payload->'damages', '[]')) loop
    insert into public.damages (vehicle_id, inspection_id, view, x, y, kind, severity, note, photos)
    values (veh, ins.id, coalesce(d->>'view', 'exterior'), (d->>'x')::numeric, (d->>'y')::numeric, coalesce(d->>'kind', 'scratch'),
            coalesce(d->>'severity', 'minor'), left(coalesce(d->>'note', ''), 300),
            coalesce((select array_agg(left(p, 300)) from jsonb_array_elements_text(coalesce(d->'photos', '[]')) p), '{}'));
  end loop;

  return jsonb_build_object('id', ins.id, 'ref', ins.ref, 'rental_id', r.id, 'movement_id', m.id);
end $$;

-- ───────────────────────── audit trail: record what changed ─────────────────────────
alter table public.activity_log add column if not exists changes text not null default '';

create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec jsonb; prev jsonb; label text; diff text[] := '{}'; k text;
begin
  rec := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  label := coalesce(rec->>'ref', rec->>'code' || ' ' || coalesce(rec->>'full_name', rec->>'name', ''), rec->>'full_name', rec->>'name',
                    nullif(trim(coalesce(rec->>'plate_code','') || ' ' || coalesce(rec->>'plate_number','')), ''),
                    rec->>'value', rec->>'description', '');
  if tg_op = 'UPDATE' then
    prev := to_jsonb(old);
    if rec ? 'status' and (prev->>'status') is distinct from (rec->>'status') then
      label := label || ' → ' || (rec->>'status');
    end if;
    for k in select jsonb_object_keys(rec) loop
      if k not in ('updated_at','customer_signature','staff_signature','photos') and (prev->k) is distinct from (rec->k) then
        diff := diff || format('%s: %s → %s', k, coalesce(left(prev->>k, 40), '—'), coalesce(left(rec->>k, 40), '—'));
      end if;
    end loop;
  end if;
  insert into public.activity_log (actor, actor_name, entity, entity_id, action, summary, changes)
  values (auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'system'),
          tg_table_name, rec->>'id', lower(tg_op), left(label, 200), left(array_to_string(diff, '; '), 1500));
  return null;
end $$;

-- ───────────────────────── housekeeping triggers ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['branches','departments','masters','suppliers','employees','tariff_groups','tariff_cards',
                           'movements','invoices','bills'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function private.touch()', t);
  end loop;
  foreach t in array array['branches','departments','masters','suppliers','employees','tariff_groups','tariff_cards',
                           'movements','invoices','bills','vouchers','inspections','damages','vehicle_replacements'] loop
    execute format('drop trigger if exists %1$s_log on public.%1$s', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$s for each row execute function private.log_change()', t);
  end loop;
end $$;

-- ───────────────────────── access control for the new tables ─────────────────────────
--                      read                        create / edit                    delete
--   branches,          everyone                    admin, manager                   admin
--   departments, masters, tariff_groups, tariff_cards, employees  (same)
--   suppliers          everyone                    admin, manager, accountant       admin
--   movements          everyone                    admin, manager, agent            admin
--   inspections        everyone                    (check_out_in only)              admin
--   damages            everyone                    admin, manager, agent (repair)   admin
--   invoices           everyone                    admin, manager, accountant       admin
--   bills, vouchers    admin, manager, accountant  admin, manager, accountant       admin, accountant
--   rental_events, vehicle_replacements   everyone, written by the database only
do $$
declare t text; spec record;
begin
  for spec in select * from (values
      ('branches',      'member', 'admin,manager',            'admin'),
      ('departments',   'member', 'admin,manager',            'admin'),
      ('masters',       'member', 'admin,manager',            'admin'),
      ('tariff_groups', 'member', 'admin,manager',            'admin'),
      ('tariff_cards',  'member', 'admin,manager',            'admin'),
      ('employees',     'member', 'admin,manager',            'admin'),
      ('suppliers',     'member', 'admin,manager,accountant', 'admin'),
      ('movements',     'member', 'admin,manager,agent',      'admin'),
      ('inspections',   'member', '',                         'admin'),
      ('damages',       'member', 'admin,manager,agent',      'admin'),
      ('invoices',      'member', 'admin,manager,accountant', 'admin'),
      ('bills',         'admin,manager,accountant', 'admin,manager,accountant', 'admin,accountant'),
      ('vouchers',      'admin,manager,accountant', 'admin,manager,accountant', 'admin,accountant'),
      ('rental_events', 'member', '',                         ''),
      ('vehicle_replacements', 'member', '',                  '')
    ) as s(tbl, rd, wr, del) loop
    t := spec.tbl;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (%2$s)', t,
                   case when spec.rd = 'member' then '(select private.is_member())'
                        else format('(select private.has_role(%s))', (select string_agg(quote_literal(x), ',') from unnest(string_to_array(spec.rd, ',')) x)) end);
    if spec.wr <> '' then
      execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select private.has_role(%2$s)))', t,
                     (select string_agg(quote_literal(x), ',') from unnest(string_to_array(spec.wr, ',')) x));
      execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select private.has_role(%2$s))) with check ((select private.has_role(%2$s)))', t,
                     (select string_agg(quote_literal(x), ',') from unnest(string_to_array(spec.wr, ',')) x));
    end if;
    if spec.del <> '' then
      execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select private.has_role(%2$s)))', t,
                     (select string_agg(quote_literal(x), ',') from unnest(string_to_array(spec.del, ',')) x));
    end if;
  end loop;
end $$;

revoke all on public.branches, public.departments, public.masters, public.tariff_groups, public.tariff_cards, public.employees,
              public.suppliers, public.movements, public.inspections, public.damages, public.invoices, public.bills, public.vouchers,
              public.rental_events, public.vehicle_replacements from anon, authenticated;
grant select, insert, update, delete on public.branches, public.departments, public.masters, public.tariff_groups,
      public.tariff_cards, public.employees, public.suppliers, public.movements, public.invoices, public.bills, public.vouchers to authenticated;
grant select, delete on public.inspections to authenticated;
grant select, update, delete on public.damages to authenticated;
grant select on public.rental_events, public.vehicle_replacements, public.rental_balances to authenticated;

-- Column-level lock-down for the new tables: refs, totals and audit columns come from the database.
revoke update on public.movements from authenticated;
grant update (employee_id, from_branch_id, to_branch_id, purpose, status, out_at, expected_in_at, odometer_out, fuel_out,
              in_at, odometer_in, fuel_in, notes) on public.movements to authenticated;
revoke update on public.invoices from authenticated;
grant update (customer_id, rental_id, kind, issued_on, due_on, description, amount, vat, status) on public.invoices to authenticated;
revoke update on public.bills from authenticated;
grant update (supplier_id, bill_no, bill_date, due_date, category, description, amount, vat, vehicle_id, maintenance_id, status)
  on public.bills to authenticated;
revoke update on public.vouchers from authenticated;
grant update (direction, party_type, supplier_id, employee_id, party_name, purpose, method, amount, paid_on, cheque_no, note)
  on public.vouchers to authenticated;
revoke update on public.damages from authenticated;
grant update (status, repaired_on, maintenance_id, note) on public.damages to authenticated;

-- Existing tables: let the app edit the new columns.
grant update (customer_id, vehicle_id, status, start_at, end_at, returned_at, daily_rate, extras, discount,
              vat_rate, deposit, odometer_out, odometer_in, fuel_out, fuel_in, notes,
              branch_out_id, branch_in_id, tariff_card_id, km_per_day, extra_km_rate,
              driver_name, driver_license, driver_phone, cancel_reason) on public.rentals to authenticated;
grant update (plate_code, plate_number, emirate, make, model, year, category, color, daily_rate, weekly_rate,
              monthly_rate, status, odometer, insurance_expiry, registration_expiry, notes,
              branch_id, tariff_group_id, vin, engine_capacity, transmission, fuel_type, sipp_code,
              service_interval_km, last_service_km, next_service_date, defleeted_on, defleet_reason, defleet_price)
  on public.vehicles to authenticated;
grant update (full_name, role, active, branch_id, department_id) on public.profiles to authenticated;

grant usage on sequence public.customer_code_seq, public.supplier_code_seq, public.employee_code_seq, public.movement_ref_seq,
      public.invoice_ref_seq, public.bill_ref_seq, public.voucher_ref_seq, public.inspection_ref_seq to authenticated;

revoke all on function public.replace_vehicle(uuid, uuid, int, text, int, text, text, timestamptz) from public, anon;
revoke all on function public.check_out_in(jsonb) from public, anon;
revoke all on function public.invoice_fines() from public, anon;
revoke all on function public.reconcile_fines(text, date, date) from public, anon;
revoke all on function public.import_fines(jsonb) from public, anon;
revoke all on function public.match_fines() from public, anon;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function public.replace_vehicle(uuid, uuid, int, text, int, text, text, timestamptz), public.check_out_in(jsonb),
      public.invoice_fines(), public.reconcile_fines(text, date, date), public.import_fines(jsonb), public.match_fines() to authenticated;
grant execute on function private.my_role(), private.has_role(text[]), private.is_member() to authenticated;

-- ───────────────────────── live updates ─────────────────────────
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['branches','departments','masters','tariff_groups','tariff_cards','employees','suppliers',
                           'movements','inspections','damages','invoices','bills','vouchers'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ───────────────────────── photo storage for check cards ─────────────────────────
-- Private bucket: photos are only visible to signed-in, activated staff.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Supabase Storage not found: skipping the check-card photo bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('inspections', 'inspections', false, 5242880, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;
  execute 'drop policy if exists inspections_photos_read on storage.objects';
  execute 'drop policy if exists inspections_photos_insert on storage.objects';
  execute 'drop policy if exists inspections_photos_delete on storage.objects';
  execute $p$create policy inspections_photos_read on storage.objects for select to authenticated
             using (bucket_id = 'inspections' and (select private.is_member()))$p$;
  execute $p$create policy inspections_photos_insert on storage.objects for insert to authenticated
             with check (bucket_id = 'inspections' and (select private.has_role('admin','manager','agent')))$p$;
  execute $p$create policy inspections_photos_delete on storage.objects for delete to authenticated
             using (bucket_id = 'inspections' and (select private.has_role('admin')))$p$;
end $$;

-- ───────────────────────── daily automatic fines/Salik invoices ─────────────────────────
-- Uses pg_cron when the project has it (Database → Extensions → pg_cron). Without it, use "Invoice charged fines"
-- on the Invoices page; agreements are still charged automatically when they close.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available (%). Enable it in Database → Extensions to run the daily fines job.', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('anamira-daily-fines', '0 22 * * *', 'select private.daily_fines_job()'); -- 02:00 Dubai time
  end if;
end $$;

-- ───────────────────────── starter data (only where empty) ─────────────────────────
insert into public.branches (code, name, address)
select 'MAIN', 'Main branch', coalesce((select company_address from public.settings limit 1), 'Dubai, UAE')
 where not exists (select 1 from public.branches);

insert into public.masters (kind, value, sort)
select v.kind, v.value, v.sort from (values
  ('checklist','Spare tyre',1),('checklist','Toolkit',2),('checklist','Jack',3),('checklist','First aid kit',4),
  ('checklist','Fire extinguisher',5),('checklist','GPS',6),('checklist','Baby seat',7),('checklist','Handbook',8),
  ('checklist','Registration card (Mulkiya)',9),
  ('service_type','Oil and filter change',1),('service_type','General service',2),('service_type','Brake service',3),
  ('service_type','Tyre rotation and alignment',4),('service_type','AC service',5),('service_type','Battery check',6),
  ('defect_type','Accident damage',1),('defect_type','Body scratch or dent',2),('defect_type','Engine fault',3),
  ('defect_type','Electrical fault',4),('defect_type','Puncture',5),('defect_type','Windscreen chip or crack',6),
  ('defect_type','AC not cooling',7),
  ('engine','1.6L',1),('engine','2.0L',2),('engine','2.5L',3),('engine','3.0L',4),('engine','3.5L',5),('engine','5.0L V8',6),('engine','6.2L V8',7)
) as v(kind, value, sort)
where not exists (select 1 from public.masters m where m.kind = v.kind and lower(m.value) = lower(v.value) and m.parent = '')
on conflict do nothing;

insert into public.masters (kind, value)
select distinct 'make', trim(make) from public.vehicles x
 where trim(make) <> '' and not exists (select 1 from public.masters m where m.kind = 'make' and lower(m.value) = lower(trim(x.make)) and m.parent = '')
on conflict do nothing;
insert into public.masters (kind, value, parent)
select distinct 'model', trim(model), trim(make) from public.vehicles x
 where trim(model) <> '' and not exists (select 1 from public.masters m where m.kind = 'model' and lower(m.value) = lower(trim(x.model)) and lower(m.parent) = lower(trim(x.make)))
on conflict do nothing;
