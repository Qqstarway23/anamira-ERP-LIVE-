-- Statement import tests. Run after 01_behaviour.sql (reuses its users, the G 18703 car and rental R-1001).
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(e text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email=e), ''), false);
  perform set_config('request.jwt.claim.role', case when e is null then 'anon' else 'authenticated' end, false);
end $$;
grant execute on function pg_temp.as_user(text) to anon, authenticated;

-- anon and agent cannot import
set role anon;
do $$ begin
  begin perform public.import_fines('[]'); raise exception 'FAIL anon import'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_user('agent@x.test'); set role authenticated;
do $$ begin
  begin perform public.import_fines('[]'); raise exception 'FAIL agent import'; exception when raise_exception then null; end;
end $$;
reset role;

select pg_temp.as_user('acct@x.test'); set role authenticated;
do $$ declare r jsonb; begin
  r := public.import_fines('[
    {"kind":"salik","source":"Salik","reference":"TX-1","plate_code":"g","plate_number":"18703","occurred_at":"2026-11-19T09:00:00+04:00","location":"Al Safa","amount":4},
    {"kind":"traffic","source":"Dubai Police","reference":"DP-9","plate_code":"G","plate_number":"018703","occurred_at":"2026-11-20T23:10:00+04:00","description":"Speeding","amount":600,"black_points":0},
    {"kind":"salik","source":"Salik","plate_code":"G","plate_number":"18703","occurred_at":"2026-12-25T10:00:00+04:00","location":"Al Barsha","amount":4},
    {"kind":"traffic","source":"Abu Dhabi Police","reference":"AD-1","plate_code":"X","plate_number":"999","occurred_at":"2026-11-19T10:00:00+04:00","amount":400},
    {"kind":"salik","reference":"S1","plate_number":"18703","occurred_at":"2026-11-19T10:00:00+04:00","amount":4},
    {"kind":"salik","plate_number":"","occurred_at":"2026-11-19T10:00:00+04:00","amount":4},
    {"kind":"salik","plate_number":"18703","occurred_at":"not a date","amount":4},
    {"kind":"salik","plate_number":"18703","occurred_at":"2026-11-19T10:00:00+04:00","amount":-1}
  ]');
  if r->>'received' <> '8' or r->>'inserted' <> '4' or r->>'duplicates' <> '1' or r->>'invalid' <> '3' then raise exception 'FAIL counts %', r; end if;
  if r->>'charged' <> '2' or r->>'company' <> '1' or r->>'unmatched' <> '1' then raise exception 'FAIL match counts %', r; end if;
  if (select status || admin_fee from public.fines where reference = 'TX-1') <> 'charged1.00' then raise exception 'FAIL salik linked'; end if;
  if (select customer_id is null or status <> 'charged' or admin_fee <> 60 from public.fines where reference = 'DP-9') then raise exception 'FAIL fine linked'; end if;
  if (select plate_code from public.fines where reference = 'TX-1') <> 'G' then raise exception 'FAIL plate normalised'; end if;
  -- running the same file again adds nothing
  r := public.import_fines('[{"kind":"salik","plate_code":"G","plate_number":"18703","occurred_at":"2026-12-25T06:00:00Z","location":"Al Barsha","amount":4},
                             {"kind":"traffic","reference":"DP-9","plate_number":"18703","occurred_at":"2026-11-20T23:10:00+04:00","amount":600}]');
  if r->>'inserted' <> '0' or r->>'duplicates' <> '2' then raise exception 'FAIL re-import %', r; end if;
end $$;
reset role;
select 'IMPORT TESTS PASSED' as result;
