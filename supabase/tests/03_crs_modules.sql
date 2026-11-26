-- v2.1 modules: movements, replacement, km allowance, check cards, invoices, vouchers, access rules.
-- Run after 01_behaviour.sql and 02_fines_import.sql (reuses their users and the G 18703 car).
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(e text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email=e), ''), false);
  perform set_config('request.jwt.claim.role', case when e is null then 'anon' else 'authenticated' end, false);
end $$;
grant execute on function pg_temp.as_user(text) to anon, authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e','manager@x.test') on conflict do nothing;
update public.profiles set role='manager', active=true where email='manager@x.test';

-- 0. starter data and existing rows
do $$ begin
  if exists (select 1 from public.customers where code is null or code !~ '^C-\d+$') then raise exception 'FAIL customer codes'; end if;
  if (select count(*) from public.branches) <> 1 then raise exception 'FAIL main branch'; end if;
  if (select count(*) from public.masters where kind='checklist') < 5 then raise exception 'FAIL checklist masters'; end if;
  if not exists (select 1 from public.masters where kind='make' and value='Chevrolet') then raise exception 'FAIL makes from fleet'; end if;
  if exists (select 1 from public.rentals where extra_km_charge <> 0) then raise exception 'FAIL existing totals changed'; end if;
end $$;

-- 1. anon and pending users see none of the new tables
set role anon;
do $$ begin
  begin perform * from public.employees; raise exception 'FAIL anon employees'; exception when insufficient_privilege then null; end;
  begin perform public.check_out_in('{}'); raise exception 'FAIL anon check'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.profiles set active=false where email='pending@x.test';
select pg_temp.as_user('pending@x.test'); set role authenticated;
do $$ begin
  if (select count(*) from public.branches) + (select count(*) from public.invoices) + (select count(*) from public.masters) <> 0 then
    raise exception 'FAIL pending reads new tables'; end if;
end $$;
reset role;

-- 2. manager sets up masters; agent cannot
select pg_temp.as_user('manager@x.test'); set role authenticated;
do $$ declare g uuid; e uuid; begin
  insert into public.departments(name) values ('Operations');
  insert into public.employees(full_name, department_id, designation) values ('Rashid Driver', (select id from public.departments limit 1), 'Driver') returning id into e;
  if (select code from public.employees where id=e) !~ '^E-\d+$' then raise exception 'FAIL employee code'; end if;
  insert into public.tariff_groups(name) values ('Sports') returning id into g;
  insert into public.tariff_cards(name, tariff_group_id, daily_rate, km_per_day, extra_km_rate) values ('Sports standard', g, 1100, 250, 2);
  update public.vehicles set tariff_group_id = g, sipp_code = 'SCAR' where plate_number = '18703';
  begin update public.vehicles set sipp_code = 'bad' where plate_number = '18703'; raise exception 'FAIL sipp check'; exception when check_violation then null; end;
  insert into public.suppliers(name, category) values ('Al Futtaim Service', 'garage');
end $$;
reset role;
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ begin
  begin insert into public.branches(code, name) values ('X','X'); raise exception 'FAIL agent branch'; exception when insufficient_privilege then null; end;
  update public.tariff_cards set daily_rate = 1;
  if exists (select 1 from public.tariff_cards where daily_rate = 1) then raise exception 'FAIL agent edits tariff'; end if;
  if (select count(*) from public.bills) <> 0 then raise exception 'FAIL agent reads bills'; end if;
  begin insert into public.inspections(kind, context, vehicle_id, odometer, fuel) values ('checkout','rental','a0000000-0000-4000-8000-000000000001',1,'full');
    raise exception 'FAIL direct inspection insert'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. agent: staff movement (NRM), blocked rental hand-over, fine during staff use goes to the employee
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ declare mid uuid; cid uuid; rid uuid; v uuid := 'a0000000-0000-4000-8000-000000000002'; begin
  insert into public.movements(kind, vehicle_id, employee_id, purpose, out_at)
    values ('nrm', v, (select id from public.employees limit 1), 'Take to Sharjah branch', '2026-12-01 09:00+04') returning id into mid;
  if (select status from public.vehicles where id = v) <> 'nrm' then raise exception 'FAIL car not on nrm'; end if;
  begin insert into public.movements(kind, vehicle_id, employee_id) values ('custody', v, (select id from public.employees limit 1));
    raise exception 'FAIL second movement'; exception when raise_exception then null; end;
  insert into public.customers(full_name) values ('Nrm Test') returning id into cid;
  begin insert into public.rentals(customer_id, vehicle_id, start_at, end_at, daily_rate, status)
    values (cid, v, now(), now() + interval '2 days', 100, 'active'); raise exception 'FAIL rented while on nrm'; exception when raise_exception then null; end;
  begin insert into public.maintenance(vehicle_id) values (v); raise exception 'FAIL maintenance while on nrm'; exception when raise_exception then null; end;
  begin update public.movements set status='closed' where id = mid; raise exception 'FAIL close w/o odo'; exception when raise_exception then null; end;
  update public.movements set status='closed', odometer_in = 120, fuel_in = '3/4', in_at = '2026-12-01 18:00+04' where id = mid;
  if (select status || odometer from public.vehicles where id = v) <> 'available120' then raise exception 'FAIL movement close'; end if;
  begin update public.movements set notes='x' where id = mid; raise exception 'FAIL closed movement edited'; exception when raise_exception then null; end;
end $$;
reset role;
select pg_temp.as_user('acct@x.test'); set role authenticated;
do $$ begin
  insert into public.fines(kind, reference, plate_code, plate_number, occurred_at, amount) values ('darb','DARB-1','CC','60743','2026-12-01 12:00+04',4);
  perform public.match_fines();
  if (select status from public.fines where reference='DARB-1') <> 'employee' or (select employee_id from public.fines where reference='DARB-1') is null then
    raise exception 'FAIL staff fine'; end if;
end $$;
reset role;

-- 4. agent: check-out on mobile, extension, cut short, vehicle replacement, check-in with km allowance
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ declare cid uuid; rid uuid; res jsonb; r public.rentals; v1 uuid := 'a0000000-0000-4000-8000-000000000005'; v2 uuid := 'a0000000-0000-4000-8000-000000000006'; begin
  insert into public.customers(full_name, account_type, credit_limit) values ('Corp Test LLC', 'credit', 5000) returning id into cid;
  insert into public.rentals(customer_id, vehicle_id, start_at, end_at, daily_rate, vat_rate, km_per_day, extra_km_rate)
    values (cid, v1, '2026-12-10 10:00+04', '2026-12-13 10:00+04', 200, 5, 100, 1.5) returning id into rid;
  -- check-out: needs odometer and fuel
  begin perform public.check_out_in(jsonb_build_object('kind','checkout','context','rental','rental_id',rid,'fuel','full'));
    raise exception 'FAIL check-out w/o odo'; exception when raise_exception then null; end;
  res := public.check_out_in(jsonb_build_object('kind','checkout','context','rental','rental_id',rid,'odometer',1000,'fuel','full',
           'checklist', jsonb_build_object('Spare tyre', true, 'GPS', false), 'customer_signature','data:image/png;base64,AAA',
           'damages', jsonb_build_array(jsonb_build_object('view','exterior','x',20,'y',30,'kind','scratch','photos',jsonb_build_array('a/b.jpg')))));
  if res->>'ref' !~ '^CC-' then raise exception 'FAIL check card ref %', res; end if;
  select * into r from public.rentals where id = rid;
  if r.status <> 'active' or r.odometer_out <> 1000 then raise exception 'FAIL check-out moved rental'; end if;
  if (select count(*) from public.damages where vehicle_id = v1 and status='open') <> 1 then raise exception 'FAIL damage saved'; end if;
  begin perform public.check_out_in(jsonb_build_object('kind','checkout','context','rental','rental_id',rid,'odometer',1000,'fuel','full'));
    raise exception 'FAIL double check-out'; exception when raise_exception then null; end;
  -- extension and cut short are logged
  update public.rentals set end_at = '2026-12-15 10:00+04' where id = rid;
  update public.rentals set end_at = '2026-12-14 10:00+04' where id = rid;
  if not exists (select 1 from public.rental_events where rental_id = rid and action='extended') or
     not exists (select 1 from public.rental_events where rental_id = rid and action='cut_short') then raise exception 'FAIL editing log'; end if;
  -- car and customer locked unless replaced through the function
  begin update public.rentals set vehicle_id = v2 where id = rid; raise exception 'FAIL car changed directly'; exception when raise_exception then null; end;
  begin perform public.replace_vehicle(rid, v2, 900, 'full'); raise exception 'FAIL odo lower'; exception when raise_exception then null; end;
  perform public.replace_vehicle(rid, v2, 1150, '3/4', null, 'full', 'AC broke', '2026-12-11 12:00+04');
  if (select vehicle_id from public.rentals where id = rid) <> v2 then raise exception 'FAIL replaced'; end if;
  if (select status from public.vehicles where id = v1) <> 'available' or (select odometer from public.vehicles where id = v1) < 1150 then raise exception 'FAIL old car back'; end if;
  if (select status from public.vehicles where id = v2) <> 'rented' then raise exception 'FAIL new car out'; end if;
  if not exists (select 1 from public.rental_events where rental_id = rid and action='vehicle_replaced') then raise exception 'FAIL replace logged'; end if;
  -- driver replacement
  update public.rentals set driver_name = 'First Driver' where id = rid;
  update public.rentals set driver_name = 'Second Driver' where id = rid;
  if not exists (select 1 from public.rental_events where rental_id = rid and action='driver_replaced') then raise exception 'FAIL driver logged'; end if;
  -- check-in: legs 150 km + (new car) 350 km = 500 km, allowance 4 days x 100 = 400, 100 km x 1.5 = 150
  select odometer_out into r.odometer_out from public.rentals where id = rid;
  res := public.check_out_in(jsonb_build_object('kind','checkin','context','rental','rental_id',rid,'odometer',r.odometer_out + 350,'fuel','full',
           'at','2026-12-14 09:00+04'));
  select * into r from public.rentals where id = rid;
  if r.status <> 'returned' or r.days <> 4 or r.extra_km_charge <> 150 or r.subtotal <> 950 or r.total <> 997.5 then
    raise exception 'FAIL km charge days=% km=% sub=% total=%', r.days, r.extra_km_charge, r.subtotal, r.total; end if;
  if (select count(*) from public.inspections where rental_id = rid) <> 2 then raise exception 'FAIL two check cards'; end if;
end $$;
reset role;

-- 5. fines on each car of a replaced agreement go to that agreement; invoices and balances
select pg_temp.as_user('acct@x.test'); set role authenticated;
do $$ declare rid uuid; inv uuid; bal numeric; n int; begin
  select id into rid from public.rentals where km_per_day = 100;
  insert into public.fines(kind, reference, plate_code, plate_number, occurred_at, amount) values
    ('salik','L1','D','87201','2026-12-10 15:00+04',4),     -- first car, before the swap
    ('salik','L2','DD','71278','2026-12-12 15:00+04',4),    -- second car, after the swap
    ('traffic','L3','D','87201','2026-12-12 15:00+04',300), -- first car after the swap: not this customer
    ('salik','OLD','DD','71278','2026-11-01 15:00+04',4);   -- before the invoicing start date
  perform public.match_fines();
  if (select count(*) from public.fines where reference in ('L1','L2') and rental_id = rid and status='charged') <> 2 then raise exception 'FAIL legs'; end if;
  if (select status from public.fines where reference='L3') <> 'company' then raise exception 'FAIL after-swap fine'; end if;
  update public.settings set fines_invoice_from = '2026-12-01';
  select balance into bal from public.rental_balances where rental_id = rid;
  n := public.invoice_fines();
  if n < 1 then raise exception 'FAIL no invoice'; end if;
  select invoice_id into inv from public.fines where reference = 'L1';
  if inv is null or (select invoice_id from public.fines where reference='L2') <> inv then raise exception 'FAIL one invoice per agreement'; end if;
  if (select amount || '/' || vat || '/' || total from public.invoices where id = inv) <> '10.00/0.10/10.10' then
    raise exception 'FAIL invoice amounts %', (select amount || '/' || vat || '/' || total from public.invoices where id = inv); end if;
  if exists (select 1 from public.fines where reference = 'OLD' and invoice_id is not null) then raise exception 'FAIL old fine invoiced'; end if;
  if (select balance from public.rental_balances where rental_id = rid) <> bal + 10.10 then raise exception 'FAIL balance with invoice'; end if;
  if public.invoice_fines() <> 0 then raise exception 'FAIL invoiced twice'; end if;
  begin update public.invoices set total = 1 where id = inv; raise exception 'FAIL total writable'; exception when insufficient_privilege or generated_always then null; end;
  update public.invoices set status = 'void' where id = inv;
  if exists (select 1 from public.fines where invoice_id = inv) then raise exception 'FAIL void releases fines'; end if;
  begin update public.invoices set amount = 1 where id = inv; raise exception 'FAIL void edited'; exception when raise_exception then null; end;
  -- reconciliation
  n := (select count(*) from public.fines where kind = 'salik' and occurred_at >= '2026-12-01 00:00+04' and occurred_at < '2027-01-01 00:00+04');
  if n < 2 or public.reconcile_fines('salik', '2026-12-01', '2026-12-31') <> n then raise exception 'FAIL reconcile count'; end if;
  if public.reconcile_fines('salik', '2026-12-01', '2026-12-31') <> 0 then raise exception 'FAIL reconcile twice'; end if;
  -- bills and vouchers
  insert into public.bills(supplier_id, bill_no, amount, vat) values ((select id from public.suppliers limit 1), 'INV-77', 1000, 50);
  insert into public.vouchers(direction, party_type, supplier_id, purpose, amount) values ('payment','supplier',(select id from public.suppliers limit 1),'bill',600);
  insert into public.vouchers(direction, party_type, employee_id, purpose, amount) values ('receipt','employee',(select id from public.employees limit 1),'recovery',4);
  if (select string_agg(left(ref, 3), ',' order by ref) from public.vouchers) <> 'PV-,RV-' then raise exception 'FAIL voucher refs'; end if;
  begin insert into public.vouchers(direction, party_type, purpose, amount) values ('payment','supplier','bill',1); raise exception 'FAIL voucher w/o party'; exception when check_violation then null; end;
end $$;
reset role;
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ begin
  begin perform public.invoice_fines(); raise exception 'FAIL agent invoices'; exception when raise_exception then null; end;
  begin perform public.reconcile_fines('salik', '2026-01-01', '2026-12-31'); raise exception 'FAIL agent reconciles'; exception when raise_exception then null; end;
  if (select count(*) from public.vouchers) <> 0 then raise exception 'FAIL agent reads vouchers'; end if;
  -- repair a damage
  update public.damages set status = 'repaired' where status = 'open';
  if exists (select 1 from public.damages where status = 'repaired' and repaired_on is null) then raise exception 'FAIL repaired date'; end if;
  begin update public.damages set x = 1; raise exception 'FAIL damage position writable'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 6. closing an agreement invoices its charged fines automatically; audit trail records changes
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ declare cid uuid; rid uuid; begin
  insert into public.customers(full_name) values ('Auto Invoice') returning id into cid;
  insert into public.rentals(customer_id, vehicle_id, start_at, end_at, daily_rate, status)
    values (cid, 'a0000000-0000-4000-8000-000000000007', '2026-12-20 10:00+04', '2026-12-22 10:00+04', 100, 'active') returning id into rid;
end $$;
reset role;
select pg_temp.as_user('acct@x.test'); set role authenticated;
insert into public.fines(kind, reference, plate_code, plate_number, occurred_at, amount) values ('salik','AUTO1','Q','83931','2026-12-21 10:00+04',4);
select public.match_fines();
reset role;
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ declare rid uuid; begin
  select k.id into rid from public.rentals k join public.customers c on c.id = k.customer_id where c.full_name = 'Auto Invoice';
  update public.rentals set status='returned', odometer_in = 99999, fuel_in = 'full', returned_at = '2026-12-22 10:00+04' where id = rid;
  if (select count(*) from public.invoices where rental_id = rid and kind = 'fines') <> 1 then raise exception 'FAIL invoice on close'; end if;
  if (select invoiced from public.rental_balances where rental_id = rid) <> 5.05 then raise exception 'FAIL invoiced in balance'; end if;
end $$;
reset role;
select pg_temp.as_user('admin@x.test'); set role authenticated;
do $$ begin
  if not exists (select 1 from public.activity_log where entity = 'rentals' and action = 'update' and changes like '%end_at%') then
    raise exception 'FAIL audit changes'; end if;
  if not exists (select 1 from public.activity_log where entity = 'inspections') then raise exception 'FAIL audit inspections'; end if;
  delete from public.inspections where ref = (select min(ref) from public.inspections);
end $$;
reset role;
-- 7. nightly job follows the auto-invoice switch; a car handed over early can still be replaced
do $$ declare cid uuid; rid uuid; n int; begin
  update public.settings set invoice_fines_on_close = false;
  insert into public.customers(full_name) values ('Nightly Off') returning id into cid;
  insert into public.rentals(customer_id, vehicle_id, start_at, end_at, daily_rate, status)
    values (cid, 'a0000000-0000-4000-8000-000000000007', '2027-01-10 10:00+04', '2027-01-12 10:00+04', 100, 'active') returning id into rid;
  insert into public.fines(kind, reference, plate_code, plate_number, occurred_at, amount) values ('salik','NIGHT1','Q','83931','2027-01-11 10:00+04',4);
  n := (private.daily_fines_job()->>'invoices')::int;
  if n <> 0 or exists (select 1 from public.invoices where rental_id = rid) then raise exception 'FAIL nightly job ignored the switch'; end if;
  update public.settings set invoice_fines_on_close = true;
  n := (private.daily_fines_job()->>'invoices')::int;
  if n < 1 or not exists (select 1 from public.invoices where rental_id = rid) then raise exception 'FAIL nightly job did not invoice'; end if;
  -- replaced 2 hours before the booked start (car handed over early)
  perform public.replace_vehicle(rid, (select id from public.vehicles where status = 'available' order by plate_number limit 1),
    (select odometer_out from public.rentals where id = rid), 'full', null, 'full', 'early swap', timestamptz '2027-01-10 08:00+04');
  if (select count(*) from public.vehicle_replacements where rental_id = rid) <> 1 then raise exception 'FAIL early replacement'; end if;
end $$;
select 'CRS TESTS PASSED' as result;
