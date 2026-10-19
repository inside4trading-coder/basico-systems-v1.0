-- Conciliación bancaria: perfiles de importación, cargas de estados de cuenta,
-- líneas del banco y su vínculo con el libro de movimientos.
--
-- Portado de sublime_bank_import_profiles / sublime_bank_import_batches /
-- sublime_bank_movements / sublime_bank_reconciliations y de
-- sublime_autoreconcile_account (basicosystems@f551478b). Cambios de fondo:
--   * Todo con tenant_id y lectura limitada al negocio activo; las líneas y
--     cargas se escriben solo por RPC.
--   * Los duplicados los decide el servidor por identidad bancaria (fecha,
--     dirección, monto y referencia u operación normalizadas; sin referencia,
--     la descripción), no el navegador. Dos líneas idénticas en el mismo
--     archivo se respetan como #1 y #2.
--   * Una línea se vincula a lo sumo con un movimiento y viceversa. Anular el
--     movimiento devuelve la línea a "sin identificar".
--   * El perfil no conoce ningún banco: columnas por letra, número o nombre
--     de cabecera, formato de fecha y de número, y signo del monto.

-- ---------------------------------------------------------------------------
-- Perfiles de importación
-- ---------------------------------------------------------------------------

create table public.bank_import_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  account_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  -- Primera fila con datos (la de arriba es la cabecera), como la numera Excel.
  start_row integer not null default 2 check (start_row between 1 and 1000),
  sheet_name text check (sheet_name is null or length(sheet_name) <= 60),
  col_date text not null check (length(col_date) <= 60),
  col_time text check (length(col_time) <= 60),
  col_reference text check (length(col_reference) <= 60),
  col_operation text check (length(col_operation) <= 60),
  col_description text check (length(col_description) <= 60),
  col_debit text check (length(col_debit) <= 60),
  col_credit text check (length(col_credit) <= 60),
  col_amount text check (length(col_amount) <= 60),
  col_balance text check (length(col_balance) <= 60),
  date_format text not null default 'DMY' check (date_format in ('DMY', 'MDY', 'YMD')),
  decimal_separator text not null default 'comma' check (decimal_separator in ('comma', 'dot')),
  -- Con una sola columna de monto: positivo = entrada (lo usual) o salida.
  amount_sign text not null default 'positive_in' check (amount_sign in ('positive_in', 'positive_out')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, account_id, name),
  foreign key (tenant_id, account_id) references public.finance_accounts (tenant_id, id),
  check (col_amount is not null or col_debit is not null or col_credit is not null)
);
create trigger bank_import_profiles_touch before update on public.bank_import_profiles
  for each row execute function app.touch_updated_at();

alter table public.bank_import_profiles enable row level security;
revoke all on public.bank_import_profiles from anon;
revoke delete on public.bank_import_profiles from authenticated;
create policy tenant_read on public.bank_import_profiles for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_insert on public.bank_import_profiles for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_update on public.bank_import_profiles for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id))
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
-- La cuenta de un perfil no cambia: sus cargas quedan en ella.
revoke update on public.bank_import_profiles from authenticated;
grant update (name, start_row, sheet_name, col_date, col_time, col_reference, col_operation, col_description,
              col_debit, col_credit, col_amount, col_balance, date_format, decimal_separator, amount_sign, is_active)
  on public.bank_import_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Cargas y líneas del banco
-- ---------------------------------------------------------------------------

create table public.bank_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  account_id uuid not null,
  profile_id uuid,
  file_name text not null,
  file_hash text,
  rows_read integer not null default 0,
  rows_new integer not null default 0,
  rows_duplicate integer not null default 0,
  rows_error integer not null default 0,
  -- Filas no importadas: [{row, reason}] (errores de lectura y duplicadas).
  issues jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references public.finance_accounts (tenant_id, id),
  foreign key (tenant_id, profile_id) references public.bank_import_profiles (tenant_id, id)
);
create index bank_import_batches_account_idx on public.bank_import_batches (tenant_id, account_id, created_at desc);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  account_id uuid not null,
  batch_id uuid not null,
  row_number integer,
  line_date date not null,
  line_time time,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(16, 2) not null check (amount > 0),
  currency text not null,
  reference text,
  operation_number text,
  description text,
  balance numeric(18, 2),
  raw jsonb not null default '{}'::jsonb,
  identity_key text not null,
  occurrence integer not null default 1,
  -- unmatched: sin identificar · possible: hay movimientos del mismo monto
  -- cerca · matched: vinculada a un movimiento · ignored: no corresponde.
  status text not null default 'unmatched' check (status in ('unmatched', 'possible', 'matched', 'ignored')),
  movement_id uuid,
  match_kind text check (match_kind in ('auto', 'manual', 'created')),
  matched_by uuid,
  matched_at timestamptz,
  ignore_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, account_id, identity_key, occurrence),
  foreign key (tenant_id, account_id) references public.finance_accounts (tenant_id, id),
  foreign key (tenant_id, batch_id) references public.bank_import_batches (tenant_id, id),
  foreign key (tenant_id, movement_id) references public.finance_movements (tenant_id, id),
  check ((status = 'matched') = (movement_id is not null)),
  check ((status = 'ignored') = (ignore_reason is not null))
);
create unique index bank_statement_lines_movement_uq on public.bank_statement_lines (movement_id) where movement_id is not null;
create index bank_statement_lines_status_idx on public.bank_statement_lines (tenant_id, account_id, status, line_date desc);

alter table public.bank_import_batches enable row level security;
alter table public.bank_statement_lines enable row level security;
revoke all on public.bank_import_batches, public.bank_statement_lines from anon;
revoke insert, update, delete on public.bank_import_batches, public.bank_statement_lines from authenticated;
create policy tenant_read on public.bank_import_batches for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy tenant_read on public.bank_statement_lines for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));

-- ---------------------------------------------------------------------------
-- Identidad bancaria
-- ---------------------------------------------------------------------------

-- Referencia normalizada: solo letras y dígitos, sin ceros a la izquierda
-- (00000108860 = 108860).
create or replace function app.bank_ref(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select ltrim(upper(regexp_replace(coalesce(p_value, ''), '[^0-9A-Za-z]', '', 'g')), '0')
$$;

-- Fecha, dirección, monto y referencia u operación. La descripción solo
-- cuenta sin referencia ni operación: el banco la cambia entre exportaciones.
create or replace function app.bank_identity(p_date date, p_direction text, p_amount numeric, p_reference text, p_operation text, p_description text)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws('|', p_date::text, p_direction, round(p_amount, 2)::text, app.bank_ref(p_reference), app.bank_ref(p_operation),
    case when app.bank_ref(p_reference) = '' and app.bank_ref(p_operation) = ''
         then left(regexp_replace(lower(trim(coalesce(p_description, ''))), '\s+', ' ', 'g'), 120) else '' end)
$$;

-- ---------------------------------------------------------------------------
-- Conciliación
-- ---------------------------------------------------------------------------

-- Clasifica una línea abierta. Con p_allow_auto, si un solo movimiento de la
-- misma cuenta, dirección y monto, a ±p_days días, tiene la misma referencia,
-- la vincula. Si no, "posible" cuando hay movimientos del mismo monto cerca.
create or replace function app.bank_classify_line(p_line_id uuid, p_days integer, p_allow_auto boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_statement_lines;
  v_count integer;
  v_movement uuid;
begin
  select * into l from public.bank_statement_lines where id = p_line_id for update;
  if not found or l.status not in ('unmatched', 'possible') then
    return l.status;
  end if;

  if p_allow_auto and (app.bank_ref(l.reference) <> '' or app.bank_ref(l.operation_number) <> '') then
    select count(*), min(m.id::text)::uuid into v_count, v_movement
    from public.finance_movements m
    where m.tenant_id = l.tenant_id and m.account_id = l.account_id and m.voided_at is null
      and m.direction = l.direction and m.amount = l.amount
      and m.occurred_on between l.line_date - p_days and l.line_date + p_days
      and app.bank_ref(m.reference) <> ''
      and app.bank_ref(m.reference) in (app.bank_ref(l.reference), app.bank_ref(l.operation_number))
      and not exists (select 1 from public.bank_statement_lines x where x.movement_id = m.id);
    if v_count = 1 then
      update public.bank_statement_lines
      set status = 'matched', movement_id = v_movement, match_kind = 'auto', matched_by = auth.uid(), matched_at = now()
      where id = l.id;
      return 'matched';
    end if;
  end if;

  select count(*) into v_count
  from public.finance_movements m
  where m.tenant_id = l.tenant_id and m.account_id = l.account_id and m.voided_at is null
    and m.direction = l.direction and m.amount = l.amount
    and m.occurred_on between l.line_date - p_days and l.line_date + p_days
    and not exists (select 1 from public.bank_statement_lines x where x.movement_id = m.id);
  update public.bank_statement_lines set status = case when v_count > 0 then 'possible' else 'unmatched' end
  where id = l.id;
  return case when v_count > 0 then 'possible' else 'unmatched' end;
end;
$$;
revoke all on function app.bank_classify_line(uuid, integer, boolean) from public;

create or replace function app.bank_autoreconcile(p_account_id uuid, p_days integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_line uuid;
  v_status text;
  v_auto integer := 0;
  v_possible integer := 0;
  v_unmatched integer := 0;
begin
  if p_days is null or p_days < 0 or p_days > 15 then
    raise exception 'Días de tolerancia inválidos' using errcode = 'check_violation';
  end if;
  for v_line in
    select id from public.bank_statement_lines
    where tenant_id = v_tenant and account_id = p_account_id and status in ('unmatched', 'possible')
    order by line_date, row_number
  loop
    v_status := app.bank_classify_line(v_line, p_days, true);
    if v_status = 'matched' then v_auto := v_auto + 1;
    elsif v_status = 'possible' then v_possible := v_possible + 1;
    else v_unmatched := v_unmatched + 1;
    end if;
  end loop;
  return jsonb_build_object('auto_matched', v_auto, 'possible', v_possible, 'unmatched', v_unmatched);
end;
$$;
revoke all on function app.bank_autoreconcile(uuid, integer) from public;
grant execute on function app.bank_autoreconcile(uuid, integer) to authenticated;

-- Carga de un estado de cuenta ya leído en el navegador con el perfil.
-- p_rows: [{row, date, time, direction, amount, reference, operation,
-- description, balance, raw}]. p_issues: filas que no se pudieron leer.
create or replace function app.import_bank_statement(
  p_account_id uuid, p_profile_id uuid, p_file_name text, p_file_hash text, p_rows jsonb, p_issues jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  a public.finance_accounts;
  v_batch uuid;
  v_total integer;
  v_new integer;
  v_issues jsonb := coalesce(p_issues, '[]'::jsonb);
  v_auto jsonb;
begin
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if p_profile_id is not null and not exists (
    select 1 from public.bank_import_profiles where id = p_profile_id and tenant_id = v_tenant and account_id = a.id
  ) then
    raise exception 'El perfil no es de esta cuenta' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_typeof(v_issues) <> 'array' then
    raise exception 'Formato de carga inválido' using errcode = 'check_violation';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 5000 then
    raise exception 'Máximo 5.000 líneas por carga' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r("date" date, direction text, amount numeric)
    where r."date" is null or r.direction not in ('in', 'out') or r.direction is null or r.amount is null or round(r.amount, 2) <= 0
  ) then
    raise exception 'Hay líneas sin fecha, dirección o monto válido' using errcode = 'check_violation';
  end if;

  insert into public.bank_import_batches (tenant_id, account_id, profile_id, file_name, file_hash, rows_read, rows_error)
  values (v_tenant, a.id, p_profile_id, left(coalesce(nullif(trim(p_file_name), ''), 'Estado de cuenta'), 200), p_file_hash,
          v_total + jsonb_array_length(v_issues), jsonb_array_length(v_issues))
  returning id into v_batch;

  with src as (
    select r.*, app.bank_identity(r."date", r.direction, r.amount, r.reference, r.operation, r.description) as identity_key
    from jsonb_to_recordset(p_rows) as r(
      "row" integer, "date" date, "time" text, direction text, amount numeric, reference text, operation text,
      description text, balance numeric, raw jsonb)
  ),
  numbered as (
    select src.*, row_number() over (partition by identity_key order by "row") as occurrence from src
  ),
  ins as (
    insert into public.bank_statement_lines (
      tenant_id, account_id, batch_id, row_number, line_date, line_time, direction, amount, currency,
      reference, operation_number, description, balance, raw, identity_key, occurrence
    )
    select v_tenant, a.id, v_batch, n."row", n."date", nullif(n."time", '')::time, n.direction, round(n.amount, 2), a.currency,
           nullif(trim(n.reference), ''), nullif(trim(n.operation), ''), nullif(trim(n.description), ''), n.balance,
           coalesce(n.raw, '{}'::jsonb), n.identity_key, n.occurrence
    from numbered n
    on conflict (tenant_id, account_id, identity_key, occurrence) do nothing
    returning bank_statement_lines.row_number as inserted_row
  ),
  dup as (
    select n."row" from numbered n where not exists (select 1 from ins where ins.inserted_row = n."row")
  )
  select (select count(*) from ins),
         v_issues || coalesce((select jsonb_agg(jsonb_build_object('row', "row", 'reason', 'Ya estaba cargada') order by "row") from dup), '[]'::jsonb)
  into v_new, v_issues;

  update public.bank_import_batches
  set rows_new = v_new, rows_duplicate = v_total - v_new, issues = v_issues
  where id = v_batch;

  v_auto := app.bank_autoreconcile(a.id, 3);
  return jsonb_build_object('batch_id', v_batch, 'inserted', v_new, 'duplicates', v_total - v_new,
                            'errors', jsonb_array_length(coalesce(p_issues, '[]'::jsonb))) || v_auto;
end;
$$;
revoke all on function app.import_bank_statement(uuid, uuid, text, text, jsonb, jsonb) from public;
grant execute on function app.import_bank_statement(uuid, uuid, text, text, jsonb, jsonb) to authenticated;

create or replace function app.bank_line_for_write(p_tenant uuid, p_line_id uuid)
returns public.bank_statement_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_statement_lines;
begin
  select * into l from public.bank_statement_lines where id = p_line_id and tenant_id = p_tenant for update;
  if not found then
    raise exception 'Línea del banco no encontrada' using errcode = 'no_data_found';
  end if;
  return l;
end;
$$;
revoke all on function app.bank_line_for_write(uuid, uuid) from public;

-- Vincular a mano con un movimiento existente: misma cuenta, dirección y monto.
create or replace function app.match_bank_line(p_line_id uuid, p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines := app.bank_line_for_write(v_tenant, p_line_id);
  m public.finance_movements;
begin
  if l.status not in ('unmatched', 'possible') then
    raise exception 'La línea ya está conciliada o ignorada' using errcode = 'check_violation';
  end if;
  select * into m from public.finance_movements where id = p_movement_id and tenant_id = v_tenant;
  if not found or m.voided_at is not null then
    raise exception 'Movimiento no encontrado o anulado' using errcode = 'no_data_found';
  end if;
  if m.account_id <> l.account_id or m.direction <> l.direction or m.amount <> l.amount then
    raise exception 'El movimiento debe ser de la misma cuenta, dirección y monto' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.bank_statement_lines where movement_id = m.id) then
    raise exception 'Ese movimiento ya está conciliado con otra línea' using errcode = 'unique_violation';
  end if;
  update public.bank_statement_lines
  set status = 'matched', movement_id = m.id, match_kind = 'manual', matched_by = auth.uid(), matched_at = now()
  where id = l.id;
end;
$$;
revoke all on function app.match_bank_line(uuid, uuid) from public;
grant execute on function app.match_bank_line(uuid, uuid) to authenticated;

-- Registrar en el libro lo que el banco muestra y no estaba (comisión,
-- depósito, pago) y dejarlo conciliado.
create or replace function app.create_movement_from_bank_line(
  p_line_id uuid, p_category text default null, p_counterparty text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines := app.bank_line_for_write(v_tenant, p_line_id);
  a public.finance_accounts;
  v_movement uuid;
begin
  if l.status not in ('unmatched', 'possible') then
    raise exception 'La línea ya está conciliada o ignorada' using errcode = 'check_violation';
  end if;
  a := app.finance_account_for_write(v_tenant, l.account_id);
  insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note)
  values (v_tenant, a.id, l.direction, 'manual', l.amount, a.currency, l.line_date,
          nullif(trim(p_category), ''), nullif(trim(p_counterparty), ''), coalesce(l.reference, l.operation_number),
          coalesce(nullif(trim(p_note), ''), l.description))
  returning id into v_movement;
  update public.bank_statement_lines
  set status = 'matched', movement_id = v_movement, match_kind = 'created', matched_by = auth.uid(), matched_at = now()
  where id = l.id;
  return v_movement;
end;
$$;
revoke all on function app.create_movement_from_bank_line(uuid, text, text, text) from public;
grant execute on function app.create_movement_from_bank_line(uuid, text, text, text) to authenticated;

create or replace function app.ignore_bank_line(p_line_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines := app.bank_line_for_write(v_tenant, p_line_id);
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica por qué se ignora' using errcode = 'check_violation';
  end if;
  if l.status not in ('unmatched', 'possible') then
    raise exception 'Solo se ignora una línea abierta' using errcode = 'check_violation';
  end if;
  update public.bank_statement_lines set status = 'ignored', ignore_reason = trim(p_reason), matched_by = auth.uid(), matched_at = now()
  where id = l.id;
end;
$$;
revoke all on function app.ignore_bank_line(uuid, text) from public;
grant execute on function app.ignore_bank_line(uuid, text) to authenticated;

-- Deshacer: una conciliada o ignorada vuelve a abrirse (sin volver a
-- vincularse sola con el mismo movimiento).
create or replace function app.reopen_bank_line(p_line_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines := app.bank_line_for_write(v_tenant, p_line_id);
begin
  if l.status not in ('matched', 'ignored') then
    raise exception 'La línea ya está abierta' using errcode = 'check_violation';
  end if;
  update public.bank_statement_lines
  set status = 'unmatched', movement_id = null, match_kind = null, matched_by = null, matched_at = null, ignore_reason = null
  where id = l.id;
  return app.bank_classify_line(l.id, 3, false);
end;
$$;
revoke all on function app.reopen_bank_line(uuid) from public;
grant execute on function app.reopen_bank_line(uuid) to authenticated;

-- Anular un movimiento libera la línea del banco que lo conciliaba.
create or replace function app.bank_release_voided_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update public.bank_statement_lines
    set status = 'unmatched', movement_id = null, match_kind = null, matched_by = null, matched_at = null
    where movement_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function app.bank_release_voided_movement() from public;
create trigger finance_movements_bank_release after update of voided_at on public.finance_movements
  for each row execute function app.bank_release_voided_movement();

-- ---------------------------------------------------------------------------
-- Resumen: pendientes del banco
-- ---------------------------------------------------------------------------

create or replace function app.bank_pending()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unmatched', count(*) filter (where status = 'unmatched'),
    'possible', count(*) filter (where status = 'possible'),
    'last_import', (select max(created_at) from public.bank_import_batches b where b.tenant_id = app.finance_tenant()))
  from public.bank_statement_lines
  where tenant_id = app.finance_tenant()
$$;
revoke all on function app.bank_pending() from public;
grant execute on function app.bank_pending() to authenticated;

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create function public.bank_autoreconcile(p_account_id uuid, p_days integer default 3)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.bank_autoreconcile(p_account_id, p_days)
$$;
create function public.import_bank_statement(
  p_account_id uuid, p_profile_id uuid, p_file_name text, p_file_hash text, p_rows jsonb, p_issues jsonb default '[]'::jsonb
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.import_bank_statement(p_account_id, p_profile_id, p_file_name, p_file_hash, p_rows, p_issues)
$$;
create function public.match_bank_line(p_line_id uuid, p_movement_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select app.match_bank_line(p_line_id, p_movement_id)
$$;
create function public.create_movement_from_bank_line(p_line_id uuid, p_category text default null, p_counterparty text default null, p_note text default null)
returns uuid language sql security invoker set search_path = '' as $$
  select app.create_movement_from_bank_line(p_line_id, p_category, p_counterparty, p_note)
$$;
create function public.ignore_bank_line(p_line_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  select app.ignore_bank_line(p_line_id, p_reason)
$$;
create function public.reopen_bank_line(p_line_id uuid)
returns text language sql security invoker set search_path = '' as $$
  select app.reopen_bank_line(p_line_id)
$$;
create function public.bank_pending()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.bank_pending()
$$;

revoke all on function public.bank_autoreconcile(uuid, integer) from public, anon;
revoke all on function public.import_bank_statement(uuid, uuid, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.match_bank_line(uuid, uuid) from public, anon;
revoke all on function public.create_movement_from_bank_line(uuid, text, text, text) from public, anon;
revoke all on function public.ignore_bank_line(uuid, text) from public, anon;
revoke all on function public.reopen_bank_line(uuid) from public, anon;
revoke all on function public.bank_pending() from public, anon;
grant execute on function public.bank_autoreconcile(uuid, integer) to authenticated;
grant execute on function public.import_bank_statement(uuid, uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.match_bank_line(uuid, uuid) to authenticated;
grant execute on function public.create_movement_from_bank_line(uuid, text, text, text) to authenticated;
grant execute on function public.ignore_bank_line(uuid, text) to authenticated;
grant execute on function public.reopen_bank_line(uuid) to authenticated;
grant execute on function public.bank_pending() to authenticated;
