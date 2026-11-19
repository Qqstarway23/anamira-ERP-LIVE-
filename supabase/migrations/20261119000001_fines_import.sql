-- Fines & Salik statement import.
-- Adds the authority, description and black points of a fine, and import_fines(), which takes the rows of an
-- official statement export (Salik, Dubai Police, RTA, other emirates), skips ones already in the system,
-- inserts the rest and runs match_fines() so every new row is linked to the car, rental and customer at once.

alter table public.fines
  add column if not exists source       text not null default '' check (length(source) <= 60),
  add column if not exists description  text not null default '' check (length(description) <= 300),
  add column if not exists black_points int  not null default 0 check (black_points between 0 and 24),
  add column if not exists imported_at  timestamptz;

create index if not exists fines_dedupe_idx on public.fines (kind, plate_number, occurred_at);

-- rows: [{kind, source, reference, plate_code, plate_number, occurred_at, location, description, amount, black_points}]
-- Returns {received, inserted, duplicates, invalid, charged, company, unmatched}; the last three count this batch only.
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
      if pn = '' or at is null or amt is null or amt < 0 or k not in ('salik','traffic','parking','other') then
        n_bad := n_bad + 1; continue;
      end if;
      -- already imported: same reference, or (no reference) same plate, time and amount
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

  perform public.match_fines();

  return jsonb_build_object(
    'received', n_all, 'inserted', n_in, 'duplicates', n_dup, 'invalid', n_bad,
    'charged',   (select count(*) from public.fines where imported_at = stamp and status = 'charged'),
    'company',   (select count(*) from public.fines where imported_at = stamp and status = 'company'),
    'unmatched', (select count(*) from public.fines where imported_at = stamp and status = 'unmatched'));
end $$;

revoke all on function public.import_fines(jsonb) from public, anon;
grant execute on function public.import_fines(jsonb) to authenticated;
