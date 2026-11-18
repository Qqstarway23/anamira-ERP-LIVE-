-- Archive the v1 schema into "legacy" instead of deleting it.
-- Nothing is dropped: every v1 table and its rows stay readable to the service role.
create schema if not exists legacy;
revoke all on schema legacy from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;

do $$
declare t text;
begin
  foreach t in array array['staff','vehicles','customers','contracts','vouchers','vehicle_breaches','erp_records','profiles'] loop
    if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I set schema legacy', t);
    end if;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.touch_updated_at()','public.check_voucher_balanced()','public.normalize_plate(text)',
                           'public.handle_new_user()','public.reconcile_vehicle_breaches(numeric, numeric)',
                           'private.app_role()','private.is_staff()'] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set schema legacy', f);
    end if;
  end loop;
end $$;

revoke all on all tables in schema legacy from anon, authenticated;
revoke all on all functions in schema legacy from public, anon, authenticated;
