-- Anamira Car Rental v2: access control
--
-- Role matrix (only ACTIVE profiles get any access; anon gets nothing at all)
--                 read                       create / edit                 delete
--   vehicles      everyone                   admin, manager                admin
--   customers     everyone                   admin, manager, agent         admin, manager
--   rentals       everyone                   admin, manager, agent         admin
--   payments      everyone                   admin, manager, agent, acct   admin, accountant
--   fines         everyone                   admin, manager, accountant    admin
--   maintenance   everyone                   admin, manager, agent         admin, manager
--   expenses      admin, manager, accountant admin, manager, accountant    admin, accountant
--   settings      everyone                   admin                         -
--   profiles      self / admin, manager      admin (edit only)             admin
--   activity_log  admin, manager             (database only)               -

alter table public.profiles     enable row level security;
alter table public.settings     enable row level security;
alter table public.vehicles     enable row level security;
alter table public.customers    enable row level security;
alter table public.rentals      enable row level security;
alter table public.payments     enable row level security;
alter table public.fines        enable row level security;
alter table public.maintenance  enable row level security;
alter table public.expenses     enable row level security;
alter table public.activity_log enable row level security;

-- profiles
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.has_role('admin','manager')));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using ((select private.has_role('admin')) and id <> (select auth.uid()));

-- settings
create policy settings_read on public.settings for select to authenticated using ((select private.is_member()));
create policy settings_admin_update on public.settings for update to authenticated
  using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));

-- vehicles
create policy vehicles_read   on public.vehicles for select to authenticated using ((select private.is_member()));
create policy vehicles_insert on public.vehicles for insert to authenticated with check ((select private.has_role('admin','manager')));
create policy vehicles_update on public.vehicles for update to authenticated
  using ((select private.has_role('admin','manager'))) with check ((select private.has_role('admin','manager')));
create policy vehicles_delete on public.vehicles for delete to authenticated using ((select private.has_role('admin')));

-- customers
create policy customers_read   on public.customers for select to authenticated using ((select private.is_member()));
create policy customers_insert on public.customers for insert to authenticated with check ((select private.has_role('admin','manager','agent')));
create policy customers_update on public.customers for update to authenticated
  using ((select private.has_role('admin','manager','agent'))) with check ((select private.has_role('admin','manager','agent')));
create policy customers_delete on public.customers for delete to authenticated using ((select private.has_role('admin','manager')));

-- rentals
create policy rentals_read   on public.rentals for select to authenticated using ((select private.is_member()));
create policy rentals_insert on public.rentals for insert to authenticated with check ((select private.has_role('admin','manager','agent')));
create policy rentals_update on public.rentals for update to authenticated
  using ((select private.has_role('admin','manager','agent'))) with check ((select private.has_role('admin','manager','agent')));
create policy rentals_delete on public.rentals for delete to authenticated using ((select private.has_role('admin')));

-- payments
create policy payments_read   on public.payments for select to authenticated using ((select private.is_member()));
create policy payments_insert on public.payments for insert to authenticated with check ((select private.has_role('admin','manager','agent','accountant')));
create policy payments_update on public.payments for update to authenticated
  using ((select private.has_role('admin','accountant'))) with check ((select private.has_role('admin','accountant')));
create policy payments_delete on public.payments for delete to authenticated using ((select private.has_role('admin','accountant')));

-- fines
create policy fines_read   on public.fines for select to authenticated using ((select private.is_member()));
create policy fines_insert on public.fines for insert to authenticated with check ((select private.has_role('admin','manager','accountant')));
create policy fines_update on public.fines for update to authenticated
  using ((select private.has_role('admin','manager','accountant'))) with check ((select private.has_role('admin','manager','accountant')));
create policy fines_delete on public.fines for delete to authenticated using ((select private.has_role('admin')));

-- maintenance
create policy maintenance_read   on public.maintenance for select to authenticated using ((select private.is_member()));
create policy maintenance_insert on public.maintenance for insert to authenticated with check ((select private.has_role('admin','manager','agent')));
create policy maintenance_update on public.maintenance for update to authenticated
  using ((select private.has_role('admin','manager','agent'))) with check ((select private.has_role('admin','manager','agent')));
create policy maintenance_delete on public.maintenance for delete to authenticated using ((select private.has_role('admin','manager')));

-- expenses
create policy expenses_read   on public.expenses for select to authenticated using ((select private.has_role('admin','manager','accountant')));
create policy expenses_insert on public.expenses for insert to authenticated with check ((select private.has_role('admin','manager','accountant')));
create policy expenses_update on public.expenses for update to authenticated
  using ((select private.has_role('admin','manager','accountant'))) with check ((select private.has_role('admin','manager','accountant')));
create policy expenses_delete on public.expenses for delete to authenticated using ((select private.has_role('admin','accountant')));

-- activity log: read-only for admin/manager, written only by the database trigger
create policy activity_read on public.activity_log for select to authenticated using ((select private.has_role('admin','manager')));

-- ───────── grants: anon gets nothing; authenticated gets only what RLS then narrows ─────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant select, insert, update, delete on public.vehicles, public.customers, public.rentals,
      public.payments, public.fines, public.maintenance, public.expenses to authenticated;
grant select, update, delete on public.profiles to authenticated;
grant select, update on public.settings to authenticated;
grant select on public.activity_log, public.rental_balances to authenticated;
grant usage on sequence public.rental_ref_seq, public.payment_ref_seq to authenticated;

-- Column-level lock-down: totals, refs and audit columns are set by the database only.
revoke update on public.rentals from authenticated;
grant update (customer_id, vehicle_id, status, start_at, end_at, returned_at, daily_rate, extras, discount,
              vat_rate, deposit, odometer_out, odometer_in, fuel_out, fuel_in, notes) on public.rentals to authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, role, active) on public.profiles to authenticated;
revoke update on public.vehicles from authenticated;
grant update (plate_code, plate_number, emirate, make, model, year, category, color, daily_rate, weekly_rate,
              monthly_rate, status, odometer, insurance_expiry, registration_expiry, notes) on public.vehicles to authenticated;

-- Functions callable from the app
grant execute on function public.match_fines() to authenticated;
grant execute on function private.my_role(), private.has_role(text[]), private.is_member() to authenticated;

-- Do not let future objects silently become public
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from public, anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ───────── live updates ─────────
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['vehicles','customers','rentals','payments','fines','maintenance','expenses'] loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- ───────── carry the existing fleet over from v1 ─────────
-- The nine cars from v1, written out so this step does not depend on the legacy schema.
insert into public.vehicles (id, plate_code, plate_number, emirate, make, model, year, category, daily_rate, weekly_rate, monthly_rate) values
  ('a0000000-0000-4000-8000-000000000001','G', '18703','Dubai','Chevrolet',    'Corvette Stingray',2023,'sports',1200,7200,26400),
  ('a0000000-0000-4000-8000-000000000002','CC','60743','Dubai','Chevrolet',    'Camaro',           2023,'sports', 600,3600,13200),
  ('a0000000-0000-4000-8000-000000000003','B', '42894','Dubai','GMC',          'Yukon',            2024,'suv',    750,4500,16500),
  ('a0000000-0000-4000-8000-000000000004','CC','76781','Dubai','Ford',         'Mustang',          2025,'sports', 650,3900,14300),
  ('a0000000-0000-4000-8000-000000000005','D', '87201','Dubai','Nissan',       'Rogue',            2024,'suv',    250,1500, 5500),
  ('a0000000-0000-4000-8000-000000000006','DD','71278','Dubai','Nissan',       'Sentra',           2024,'sedan',  170,1020, 3740),
  ('a0000000-0000-4000-8000-000000000007','Q', '83931','Dubai','Nissan',       'Sentra',           2025,'sedan',  180,1080, 3960),
  ('a0000000-0000-4000-8000-000000000008','DD','83795','Dubai','Nissan',       'Sentra',           2023,'sedan',  160, 960, 3520),
  ('a0000000-0000-4000-8000-000000000009','O', '45189','Dubai','Mercedes-Benz','E 320',            2023,'luxury', 550,3300,12100)
on conflict do nothing;
