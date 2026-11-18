-- Behaviour + security tests. Run after the migrations; every block raises on failure.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','admin@x.test'),
 ('00000000-0000-0000-0000-00000000000b','agent@x.test'),
 ('00000000-0000-0000-0000-00000000000c','acct@x.test'),
 ('00000000-0000-0000-0000-00000000000d','pending@x.test');
-- bootstrap: first admin is activated by the owner (that is how the real project is set up)
update public.profiles set role='admin', active=true where email='admin@x.test';
update public.profiles set role='agent', active=true where email='agent@x.test';
update public.profiles set role='accountant', active=true where email='acct@x.test';

create or replace function pg_temp.as_user(e text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email=e), ''), false);
  perform set_config('request.jwt.claim.role', case when e is null then 'anon' else 'authenticated' end, false);
end $$;
grant execute on function pg_temp.as_user(text) to anon, authenticated;

-- 1. anon sees nothing and can do nothing
set role anon;
do $$ begin
  begin perform * from public.vehicles; raise exception 'FAIL anon read vehicles'; exception when insufficient_privilege then null; end;
  begin perform * from public.profiles; raise exception 'FAIL anon read profiles'; exception when insufficient_privilege then null; end;
  begin perform public.match_fines(); raise exception 'FAIL anon match'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 2. pending (inactive) user sees nothing
select pg_temp.as_user('pending@x.test'); set role authenticated;
do $$ begin
  if (select count(*) from public.vehicles) <> 0 then raise exception 'FAIL pending sees vehicles'; end if;
  if (select count(*) from public.settings) <> 0 then raise exception 'FAIL pending sees settings'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL pending should see only own profile'; end if;
  update public.profiles set role='admin', active=true where email='pending@x.test';
  if (select active from public.profiles where email='pending@x.test') then raise exception 'FAIL self-activation'; end if;
  begin insert into public.customers(full_name) values ('x'); raise exception 'FAIL pending insert'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. agent: can rent, cannot touch fleet / expenses / roles
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ declare cid uuid; rid uuid; r public.rentals; begin
  if (select count(*) from public.vehicles) <> 1 then raise exception 'FAIL agent cannot see legacy vehicle'; end if;
  update public.vehicles set daily_rate = 1 where true;
  if (select daily_rate from public.vehicles limit 1) = 1 then raise exception 'FAIL agent changed rate'; end if;
  begin insert into public.expenses(amount) values (5); raise exception 'FAIL agent expense'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.expenses) <> 0 then raise exception 'FAIL agent reads expenses'; end if;
  update public.profiles set role='admin' where email='agent@x.test';
  if (select role from public.profiles where email='agent@x.test') = 'admin' then raise exception 'FAIL agent self-promotion'; end if;
  begin update public.rentals set total = 0; raise exception 'FAIL agent may write total'; exception when insufficient_privilege then null; end;

  insert into public.customers(full_name, phone) values ('Ali Test', '0500000000') returning id into cid;
  insert into public.rentals(customer_id, vehicle_id, start_at, end_at, daily_rate, vat_rate, discount, extras)
    values (cid, 'a0000000-0000-4000-8000-000000000001', '2026-11-18 10:00+04', '2026-11-21 10:30+04', 1200, 5, 100, 50)
    returning * into r;
  if r.days <> 3 or r.subtotal <> 3550 or r.vat <> 177.5 or r.total <> 3727.5 or r.status <> 'booked' then
    raise exception 'FAIL pricing % % % %', r.days, r.subtotal, r.vat, r.total; end if;
  -- double booking blocked
  begin
    insert into public.rentals(customer_id, vehicle_id, start_at, end_at, daily_rate)
      values (cid, 'a0000000-0000-4000-8000-000000000001', '2026-11-20 10:00+04', '2026-11-22 10:00+04', 1200);
    raise exception 'FAIL double booking allowed';
  exception when exclusion_violation then null; end;
  -- start → car rented, odometer_out captured
  update public.rentals set status='active' where id=r.id;
  if (select status from public.vehicles where id=r.vehicle_id) <> 'rented' then raise exception 'FAIL car not rented'; end if;
  -- illegal move active → booked
  begin update public.rentals set status='booked' where id=r.id; raise exception 'FAIL illegal status move'; exception when raise_exception then null; end;
  -- return without odometer is refused
  begin update public.rentals set status='returned' where id=r.id; raise exception 'FAIL return w/o odo'; exception when raise_exception then null; end;
  update public.rentals set status='returned', odometer_in=450, fuel_in='3/4', returned_at='2026-11-22 12:00+04' where id=r.id;
  select * into r from public.rentals where id=r.id;
  if r.days <> 5 then raise exception 'FAIL late return billing days=%', r.days; end if;
  if (select status from public.vehicles where id=r.vehicle_id) <> 'available' or (select odometer from public.vehicles where id=r.vehicle_id) <> 450 then
    raise exception 'FAIL car not back'; end if;
  -- closed rental frozen
  begin update public.rentals set notes='x' where id=r.id; raise exception 'FAIL closed rental edited'; exception when raise_exception then null; end;
  -- payments
  insert into public.payments(rental_id, customer_id, amount, kind) values (r.id, cid, 1000, 'payment');
  insert into public.payments(rental_id, customer_id, amount, kind) values (r.id, cid, 500, 'deposit');
  if (select balance from public.rental_balances where rental_id=r.id) <> r.total - 1000 then raise exception 'FAIL balance'; end if;
  if (select deposit_held from public.rental_balances where rental_id=r.id) <> 500 then raise exception 'FAIL deposit'; end if;
  delete from public.payments where rental_id = r.id;
  if (select count(*) from public.payments where rental_id=r.id) <> 2 then raise exception 'FAIL agent deleted payment'; end if;
  -- blacklisted customer
  update public.customers set blacklisted=true where id=cid;
  begin
    insert into public.rentals(customer_id, vehicle_id, start_at, end_at, daily_rate)
      values (cid, 'a0000000-0000-4000-8000-000000000001', '2026-12-01', '2026-12-02', 1);
    raise exception 'FAIL blacklisted rented';
  exception when raise_exception then null; end;
  begin perform public.match_fines(); raise exception 'FAIL agent matched fines'; exception when raise_exception then null; end;
end $$;
reset role;

-- 4. accountant: fines matching + expenses
select pg_temp.as_user('acct@x.test'); set role authenticated;
do $$ declare n int; begin
  insert into public.fines(kind, reference, plate_code, plate_number, occurred_at, amount) values
    ('salik','S1','G','18703','2026-11-19 09:00+04',4),
    ('traffic','T1','G','018703','2026-11-25 09:00+04',600),
    ('parking','K1','Z','99999','2026-11-19 09:00+04',200);
  n := public.match_fines();
  if n <> 3 then raise exception 'FAIL matched %', n; end if;
  if (select status||admin_fee from public.fines where reference='S1') <> 'charged1.00' then raise exception 'FAIL salik match'; end if;
  if (select status from public.fines where reference='T1') <> 'company' then raise exception 'FAIL company usage'; end if;
  if (select status from public.fines where reference='K1') <> 'unmatched' then raise exception 'FAIL unmatched'; end if;
  insert into public.expenses(amount, category) values (100, 'fuel');
  begin insert into public.vehicles(plate_number, make, model) values ('1','a','b'); raise exception 'FAIL acct adds car'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.activity_log) <> 0 then raise exception 'FAIL acct reads log'; end if;
end $$;
reset role;

-- 5. admin: maintenance flow, last-admin guard, audit log
select pg_temp.as_user('admin@x.test'); set role authenticated;
do $$ declare mid uuid; begin
  insert into public.maintenance(vehicle_id, kind, cost, odometer) values ('a0000000-0000-4000-8000-000000000001','service',300,500) returning id into mid;
  if (select status from public.vehicles limit 1) <> 'maintenance' then raise exception 'FAIL maint status'; end if;
  update public.maintenance set status='done' where id=mid;
  if (select status||odometer from public.vehicles limit 1) <> 'available500' then raise exception 'FAIL maint done'; end if;
  begin update public.profiles set role='agent' where email='admin@x.test'; raise exception 'FAIL last admin demoted'; exception when raise_exception then null; end;
  update public.profiles set active=true where email='pending@x.test';
  if not (select active from public.profiles where email='pending@x.test') then raise exception 'FAIL admin activate'; end if;
  if (select count(*) from public.activity_log) < 10 then raise exception 'FAIL audit log'; end if;
  if (select count(*) from public.expenses) <> 1 then raise exception 'FAIL admin reads expenses'; end if;
  update public.settings set vat_rate = 5;
end $$;
reset role;
select 'ALL TESTS PASSED' as result;
