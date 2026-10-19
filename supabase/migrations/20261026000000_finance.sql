-- Administración: cuentas, movimientos y obligaciones (F3).
--
-- Portado de sublime_admin_accounts / sublime_admin_movements (20260914201611,
-- 20260914202656) y admin_obligations / admin_instances (20260504000914) de
-- basicosystems@f551478b. Cambios de fondo:
--   * Todo con tenant_id y lectura limitada al negocio activo. En Sublime las
--     cuentas y movimientos se leían con USING (true).
--   * Los movimientos son un libro: se escriben solo por RPC y no se borran;
--     se anulan con motivo. El saldo es el inicial más entradas menos salidas.
--   * Una venta del POS entra a la cuenta del método de pago (payment_methods.
--     account_id), no por coincidencia de nombres ("Zelle", "Caja USD"). El
--     efectivo entra al cerrar la caja: lo contado menos el fondo.
--   * Las cuotas de las obligaciones las genera el servidor (en Sublime, el
--     navegador), sin duplicar, y pagar una deja su salida en el libro.
-- Solo dueños, administradores y encargados ven y registran; crear o editar
-- cuentas y anular movimientos es de dueños y administradores.

create or replace function app.finance_role(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'manager'])
$$;
revoke all on function app.finance_role(uuid) from public;
grant execute on function app.finance_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cuentas
-- ---------------------------------------------------------------------------

create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'bank' check (kind in ('bank', 'cash', 'wallet', 'processor', 'other')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  institution text,
  -- Solo para reconocerla ("…4821"); nunca el número completo.
  number_hint text check (number_hint is null or length(number_hint) <= 12),
  opening_balance numeric(16, 2) not null default 0,
  opening_date date not null default current_date,
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);
create trigger finance_accounts_touch before update on public.finance_accounts
  for each row execute function app.touch_updated_at();

alter table public.finance_accounts enable row level security;
revoke all on public.finance_accounts from anon;
revoke delete on public.finance_accounts from authenticated;
create policy tenant_read on public.finance_accounts for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy supervisor_insert on public.finance_accounts for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy supervisor_update on public.finance_accounts for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
-- La moneda no cambia una vez creada: los movimientos ya están en ella.
revoke update on public.finance_accounts from authenticated;
grant update (name, kind, institution, number_hint, opening_balance, opening_date, is_active, position)
  on public.finance_accounts to authenticated;

-- A qué cuenta entra lo cobrado con cada método del POS.
alter table public.payment_methods add column account_id uuid;
alter table public.payment_methods
  add constraint payment_methods_account_fk foreign key (tenant_id, account_id)
  references public.finance_accounts (tenant_id, id);
create index payment_methods_account_idx on public.payment_methods (tenant_id, account_id);

create or replace function app.payment_method_account_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.finance_accounts a where a.id = new.account_id and a.currency = new.currency
  ) then
    raise exception 'La cuenta tiene que estar en %, la moneda del método', new.currency using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function app.payment_method_account_check() from public;
create trigger payment_methods_account_check before insert or update of account_id, currency on public.payment_methods
  for each row execute function app.payment_method_account_check();

-- ---------------------------------------------------------------------------
-- Movimientos
-- ---------------------------------------------------------------------------

create table public.finance_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  -- manual: registrado a mano · transfer: entre cuentas (dos filas con el
  -- mismo transfer_id) · sale: cobro del POS · cash_close: efectivo de un
  -- cierre de caja · obligation: pago de una cuota.
  kind text not null check (kind in ('manual', 'transfer', 'sale', 'cash_close', 'obligation')),
  amount numeric(16, 2) not null check (amount > 0),
  currency text not null,
  occurred_on date not null,
  category text,
  counterparty text,
  reference text,
  note text,
  transfer_id uuid,
  sale_payment_id uuid unique,
  cash_session_id uuid,
  obligation_instance_id uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references public.finance_accounts (tenant_id, id),
  check ((voided_at is null) = (void_reason is null))
);
create index finance_movements_account_idx on public.finance_movements (tenant_id, account_id, occurred_on desc);
create index finance_movements_date_idx on public.finance_movements (tenant_id, occurred_on desc);
create unique index finance_movements_cash_close_uq on public.finance_movements (cash_session_id, account_id) where kind = 'cash_close';

alter table public.finance_movements enable row level security;
revoke all on public.finance_movements from anon;
revoke insert, update, delete on public.finance_movements from authenticated;
create policy tenant_read on public.finance_movements for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));

-- ---------------------------------------------------------------------------
-- Obligaciones (gastos fijos, impuestos, alquiler, nómina…) y sus cuotas
-- ---------------------------------------------------------------------------

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text,
  counterparty text,
  amount numeric(16, 2) check (amount is null or amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  frequency text not null check (frequency in ('once', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')),
  -- Primer vencimiento; los siguientes salen de la frecuencia.
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  account_id uuid,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references public.finance_accounts (tenant_id, id)
);
create trigger obligations_touch before update on public.obligations
  for each row execute function app.touch_updated_at();

alter table public.obligations enable row level security;
revoke all on public.obligations from anon;
revoke delete on public.obligations from authenticated;
create policy tenant_read on public.obligations for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_insert on public.obligations for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_update on public.obligations for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id))
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));

create table public.obligation_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  obligation_id uuid not null,
  due_date date not null,
  amount numeric(16, 2),
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'skipped')),
  paid_on date,
  paid_by uuid,
  movement_id uuid,
  note text,
  unique (obligation_id, due_date),
  unique (tenant_id, id),
  foreign key (tenant_id, obligation_id) references public.obligations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, movement_id) references public.finance_movements (tenant_id, id)
);
create index obligation_instances_due_idx on public.obligation_instances (tenant_id, status, due_date);

alter table public.obligation_instances enable row level security;
revoke all on public.obligation_instances from anon;
revoke insert, update, delete on public.obligation_instances from authenticated;
create policy tenant_read on public.obligation_instances for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));

alter table public.finance_movements
  add constraint finance_movements_instance_fk foreign key (tenant_id, obligation_instance_id)
  references public.obligation_instances (tenant_id, id);

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

create or replace function app.finance_tenant(p_write_roles text[] default array['owner', 'admin', 'manager'])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, p_write_roles) then
    raise exception 'No tienes permiso para la administración de este negocio' using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end;
$$;
revoke all on function app.finance_tenant(text[]) from public;
grant execute on function app.finance_tenant(text[]) to authenticated;

create or replace function app.finance_account_for_write(p_tenant uuid, p_account_id uuid)
returns public.finance_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.finance_accounts;
begin
  select * into a from public.finance_accounts where id = p_account_id and tenant_id = p_tenant;
  if not found then
    raise exception 'Cuenta no encontrada' using errcode = 'no_data_found';
  end if;
  if not a.is_active then
    raise exception 'La cuenta % está inactiva', a.name using errcode = 'check_violation';
  end if;
  return a;
end;
$$;
revoke all on function app.finance_account_for_write(uuid, uuid) from public;

create or replace function app.finance_movement(
  p_account_id uuid, p_direction text, p_amount numeric, p_occurred_on date,
  p_category text default null, p_counterparty text default null, p_reference text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  a public.finance_accounts;
  v_id uuid;
begin
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if p_direction not in ('in', 'out') then
    raise exception 'Dirección inválida' using errcode = 'check_violation';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  if p_occurred_on is null or p_occurred_on > (now() at time zone 'America/Caracas')::date + 1 then
    raise exception 'Fecha inválida' using errcode = 'check_violation';
  end if;
  insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note)
  values (v_tenant, a.id, p_direction, 'manual', round(p_amount, 2), a.currency, p_occurred_on,
          nullif(trim(p_category), ''), nullif(trim(p_counterparty), ''), nullif(trim(p_reference), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.finance_movement(uuid, text, numeric, date, text, text, text, text) from public;
grant execute on function app.finance_movement(uuid, text, numeric, date, text, text, text, text) to authenticated;

-- Entre cuentas. Con monedas distintas es un cambio: sale un monto y entra otro.
create or replace function app.finance_transfer(
  p_from_account uuid, p_to_account uuid, p_amount_out numeric, p_amount_in numeric, p_occurred_on date, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  a_from public.finance_accounts;
  a_to public.finance_accounts;
  v_in numeric;
  v_transfer uuid := gen_random_uuid();
begin
  if p_from_account = p_to_account then
    raise exception 'Elige dos cuentas distintas' using errcode = 'check_violation';
  end if;
  a_from := app.finance_account_for_write(v_tenant, p_from_account);
  a_to := app.finance_account_for_write(v_tenant, p_to_account);
  if p_amount_out is null or round(p_amount_out, 2) <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  v_in := round(coalesce(p_amount_in, p_amount_out), 2);
  if a_from.currency = a_to.currency and v_in <> round(p_amount_out, 2) then
    raise exception 'Entre cuentas de la misma moneda entra lo mismo que sale' using errcode = 'check_violation';
  end if;
  if v_in <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, note, transfer_id, counterparty)
  values
    (v_tenant, a_from.id, 'out', 'transfer', round(p_amount_out, 2), a_from.currency, p_occurred_on, nullif(trim(p_note), ''), v_transfer, a_to.name),
    (v_tenant, a_to.id, 'in', 'transfer', v_in, a_to.currency, p_occurred_on, nullif(trim(p_note), ''), v_transfer, a_from.name);
  return v_transfer;
end;
$$;
revoke all on function app.finance_transfer(uuid, uuid, numeric, numeric, date, text) from public;
grant execute on function app.finance_transfer(uuid, uuid, numeric, numeric, date, text) to authenticated;

-- Anular: el movimiento queda en el libro, marcado. Los del POS no se anulan
-- aquí: siguen a la venta y al cierre de caja.
create or replace function app.void_finance_movement(p_movement_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant(array['owner', 'admin']);
  m public.finance_movements;
begin
  select * into m from public.finance_movements where id = p_movement_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Movimiento no encontrado' using errcode = 'no_data_found';
  end if;
  if m.voided_at is not null then
    raise exception 'Ya estaba anulado' using errcode = 'check_violation';
  end if;
  if m.kind in ('sale', 'cash_close') then
    raise exception 'Los cobros del POS se corrigen desde la venta o el cierre de caja' using errcode = 'check_violation';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  update public.finance_movements
  set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where tenant_id = v_tenant and (id = m.id or (m.transfer_id is not null and transfer_id = m.transfer_id));
  -- Anular el pago de una cuota la deja pendiente otra vez.
  if m.obligation_instance_id is not null then
    update public.obligation_instances
    set status = 'pending', paid_on = null, paid_by = null, movement_id = null
    where id = m.obligation_instance_id;
  end if;
end;
$$;
revoke all on function app.void_finance_movement(uuid, text) from public;
grant execute on function app.void_finance_movement(uuid, text) to authenticated;

-- Fechas de vencimiento de una obligación entre dos días (incluidos).
create or replace function app.obligation_due_dates(p_frequency text, p_start date, p_end date, p_from date, p_until date)
returns setof date
language sql
immutable
set search_path = ''
as $$
  select d::date
  from (
    select case p_frequency
             when 'once' then p_start
             when 'weekly' then p_start + n * 7
             when 'biweekly' then p_start + n * 14
             -- Desde el inicio cada vez: el 31 queda en 28/30 y vuelve al 31.
             else (p_start + make_interval(months => n * case p_frequency
                     when 'monthly' then 1 when 'bimonthly' then 2 when 'quarterly' then 3
                     when 'semiannual' then 6 when 'annual' then 12 end))::date
           end as d
    from generate_series(0, case when p_frequency = 'once' then 0 else 600 end) as n
  ) x
  where d >= p_from and d <= p_until and d >= p_start and (p_end is null or d <= p_end)
$$;
revoke all on function app.obligation_due_dates(text, date, date, date, date) from public;
grant execute on function app.obligation_due_dates(text, date, date, date, date) to authenticated;

-- Crea las cuotas que faltan hasta 120 días adelante y pone al día las
-- pendientes futuras con el monto actual. Idempotente.
create or replace function app.refresh_obligations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_count integer;
begin
  -- Pendientes futuras de obligaciones inactivas o fuera de su fin: sobran.
  delete from public.obligation_instances i
  using public.obligations o
  where i.obligation_id = o.id and i.tenant_id = v_tenant and i.status = 'pending' and i.due_date >= v_today
    and (not o.is_active or (o.end_date is not null and i.due_date > o.end_date)
         or i.due_date not in (select app.obligation_due_dates(o.frequency, o.start_date, o.end_date, i.due_date, i.due_date)));

  update public.obligation_instances i
  set amount = o.amount, currency = o.currency
  from public.obligations o
  where i.obligation_id = o.id and i.tenant_id = v_tenant and i.status = 'pending' and i.due_date >= v_today
    and (i.amount is distinct from o.amount or i.currency <> o.currency);

  insert into public.obligation_instances (tenant_id, obligation_id, due_date, amount, currency)
  select o.tenant_id, o.id, d, o.amount, o.currency
  from public.obligations o,
       lateral app.obligation_due_dates(o.frequency, o.start_date, o.end_date, o.start_date, v_today + 120) d
  where o.tenant_id = v_tenant and o.is_active
  on conflict (obligation_id, due_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.refresh_obligations() from public;
grant execute on function app.refresh_obligations() to authenticated;

create or replace function app.pay_obligation(
  p_instance_id uuid, p_account_id uuid, p_amount numeric, p_paid_on date, p_reference text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  i public.obligation_instances;
  o public.obligations;
  a public.finance_accounts;
  v_movement uuid;
begin
  select * into i from public.obligation_instances where id = p_instance_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Cuota no encontrada' using errcode = 'no_data_found';
  end if;
  if i.status <> 'pending' then
    raise exception 'La cuota ya está %', case i.status when 'paid' then 'pagada' else 'omitida' end using errcode = 'check_violation';
  end if;
  select * into o from public.obligations where id = i.obligation_id;
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  insert into public.finance_movements (
    tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note, obligation_instance_id
  ) values (
    v_tenant, a.id, 'out', 'obligation', round(p_amount, 2), a.currency, coalesce(p_paid_on, (now() at time zone 'America/Caracas')::date),
    coalesce(o.category, 'Obligaciones'), coalesce(o.counterparty, o.name), nullif(trim(p_reference), ''),
    coalesce(nullif(trim(p_note), ''), o.name || ' · vence ' || to_char(i.due_date, 'DD/MM/YYYY')), i.id
  ) returning id into v_movement;
  update public.obligation_instances
  set status = 'paid', paid_on = coalesce(p_paid_on, (now() at time zone 'America/Caracas')::date), paid_by = auth.uid(),
      movement_id = v_movement, note = nullif(trim(p_note), '')
  where id = i.id;
  return v_movement;
end;
$$;
revoke all on function app.pay_obligation(uuid, uuid, numeric, date, text, text) from public;
grant execute on function app.pay_obligation(uuid, uuid, numeric, date, text, text) to authenticated;

create or replace function app.skip_obligation(p_instance_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
begin
  if nullif(trim(p_note), '') is null then
    raise exception 'Indica por qué no se paga' using errcode = 'check_violation';
  end if;
  update public.obligation_instances set status = 'skipped', note = trim(p_note)
  where id = p_instance_id and tenant_id = v_tenant and status = 'pending';
  if not found then
    raise exception 'Cuota no encontrada o ya resuelta' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.skip_obligation(uuid, text) from public;
grant execute on function app.skip_obligation(uuid, text) to authenticated;

-- Saldos por cuenta y cuotas vencidas o próximas (7 días).
create or replace function app.finance_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  return jsonb_build_object(
    'accounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'kind', a.kind, 'currency', a.currency, 'is_active', a.is_active,
        'balance', a.opening_balance + coalesce((
          select sum(case m.direction when 'in' then m.amount else -m.amount end)
          from public.finance_movements m
          where m.account_id = a.id and m.voided_at is null and m.occurred_on >= a.opening_date), 0),
        'last_movement_on', (select max(m.occurred_on) from public.finance_movements m where m.account_id = a.id and m.voided_at is null)
      ) order by a.position, a.name), '[]'::jsonb)
      from public.finance_accounts a where a.tenant_id = v_tenant
    ),
    'overdue', (
      select jsonb_build_object('count', coalesce(sum(x.n), 0), 'by_currency', coalesce(jsonb_object_agg(x.currency, x.total), '{}'::jsonb))
      from (select i.currency, sum(coalesce(i.amount, 0)) total, count(*) n
            from public.obligation_instances i
            where i.tenant_id = v_tenant and i.status = 'pending' and i.due_date < v_today
            group by i.currency) x
    ),
    'upcoming', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'obligation_id', o.id, 'name', o.name, 'due_date', i.due_date, 'amount', i.amount, 'currency', i.currency
      ) order by i.due_date, o.name), '[]'::jsonb)
      from public.obligation_instances i join public.obligations o on o.id = i.obligation_id
      where i.tenant_id = v_tenant and i.status = 'pending' and i.due_date <= v_today + 7
    )
  );
end;
$$;
revoke all on function app.finance_summary() from public;
grant execute on function app.finance_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- El POS alimenta el libro
-- ---------------------------------------------------------------------------

-- Cobro no en efectivo: entra a la cuenta del método en el momento de la venta.
create or replace function app.finance_from_sale_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.payment_methods;
  s public.sales;
begin
  select * into m from public.payment_methods where id = new.payment_method_id;
  if m.account_id is null or m.kind = 'cash' then
    return new;
  end if;
  select * into s from public.sales where id = new.sale_id;
  insert into public.finance_movements (
    tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note, sale_payment_id
  ) values (
    new.tenant_id, m.account_id, 'in', 'sale', new.amount, new.currency, (s.sold_at at time zone 'America/Caracas')::date,
    'Ventas', s.customer_name, new.reference,
    'Venta ' || s.number || ' · ' || new.method_name || coalesce(' · ' || new.bank, ''), new.id
  ) on conflict (sale_payment_id) do nothing;
  return new;
end;
$$;
revoke all on function app.finance_from_sale_payment() from public;
create trigger sale_payments_finance after insert on public.sale_payments
  for each row execute function app.finance_from_sale_payment();

-- Efectivo: al cerrar la caja entra (o sale) lo contado menos el fondo, a la
-- cuenta del método de efectivo de esa moneda.
create or replace function app.finance_from_cash_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_account uuid;
  v_net numeric;
begin
  if not (old.status = 'open' and new.status = 'closed') then
    return new;
  end if;
  for c in select * from public.cash_counts where session_id = new.id and counted is not null
  loop
    select pm.account_id into v_account
    from public.payment_methods pm
    where pm.tenant_id = new.tenant_id and pm.kind = 'cash' and pm.currency = c.currency and pm.account_id is not null
    order by pm.is_active desc, pm.position
    limit 1;
    v_net := round(c.counted - c.opening, 2);
    if v_account is null or v_net = 0 then
      continue;
    end if;
    insert into public.finance_movements (
      tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, note, cash_session_id
    ) values (
      new.tenant_id, v_account, case when v_net > 0 then 'in' else 'out' end, 'cash_close', abs(v_net), c.currency,
      (coalesce(new.closed_at, now()) at time zone 'America/Caracas')::date, 'Ventas',
      'Cierre de caja ' || new.number || ' (contado menos fondo)', new.id
    ) on conflict do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function app.finance_from_cash_close() from public;
create trigger cash_sessions_finance after update of status on public.cash_sessions
  for each row execute function app.finance_from_cash_close();

-- ---------------------------------------------------------------------------
-- Envoltorios públicos (SECURITY INVOKER)
-- ---------------------------------------------------------------------------

create function public.finance_movement(
  p_account_id uuid, p_direction text, p_amount numeric, p_occurred_on date,
  p_category text default null, p_counterparty text default null, p_reference text default null, p_note text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.finance_movement(p_account_id, p_direction, p_amount, p_occurred_on, p_category, p_counterparty, p_reference, p_note)
$$;
create function public.finance_transfer(
  p_from_account uuid, p_to_account uuid, p_amount_out numeric, p_amount_in numeric, p_occurred_on date, p_note text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.finance_transfer(p_from_account, p_to_account, p_amount_out, p_amount_in, p_occurred_on, p_note)
$$;
create function public.void_finance_movement(p_movement_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  select app.void_finance_movement(p_movement_id, p_reason)
$$;
create function public.refresh_obligations()
returns integer language sql security invoker set search_path = '' as $$
  select app.refresh_obligations()
$$;
create function public.pay_obligation(
  p_instance_id uuid, p_account_id uuid, p_amount numeric, p_paid_on date, p_reference text default null, p_note text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.pay_obligation(p_instance_id, p_account_id, p_amount, p_paid_on, p_reference, p_note)
$$;
create function public.skip_obligation(p_instance_id uuid, p_note text)
returns void language sql security invoker set search_path = '' as $$
  select app.skip_obligation(p_instance_id, p_note)
$$;
create function public.finance_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.finance_summary()
$$;

revoke all on function public.finance_movement(uuid, text, numeric, date, text, text, text, text) from public, anon;
revoke all on function public.finance_transfer(uuid, uuid, numeric, numeric, date, text) from public, anon;
revoke all on function public.void_finance_movement(uuid, text) from public, anon;
revoke all on function public.refresh_obligations() from public, anon;
revoke all on function public.pay_obligation(uuid, uuid, numeric, date, text, text) from public, anon;
revoke all on function public.skip_obligation(uuid, text) from public, anon;
revoke all on function public.finance_summary() from public, anon;
grant execute on function public.finance_movement(uuid, text, numeric, date, text, text, text, text) to authenticated;
grant execute on function public.finance_transfer(uuid, uuid, numeric, numeric, date, text) to authenticated;
grant execute on function public.void_finance_movement(uuid, text) to authenticated;
grant execute on function public.refresh_obligations() to authenticated;
grant execute on function public.pay_obligation(uuid, uuid, numeric, date, text, text) to authenticated;
grant execute on function public.skip_obligation(uuid, text) to authenticated;
grant execute on function public.finance_summary() to authenticated;
