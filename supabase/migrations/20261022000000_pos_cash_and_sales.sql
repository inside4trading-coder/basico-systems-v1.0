-- Cajas, sesiones de caja y registro de ventas.
--
-- Port de basicosystems@f551478b (20260911172936 sublime_registers,
-- sublime_cash_sessions, sublime_cash_movements; 20260916142824
-- sublime_register_pos_sale; sublime_open/close_cash_session,
-- sublime_cash_session_summary). Cambios de fondo:
--   * El servidor calcula todo: precio de la base de datos (no del
--     navegador), tasa vigente (app.rate_at), impuesto por producto, IGTF y
--     reparto del descuento del carrito. El cliente manda qué vende, cuánto
--     descuenta y cómo paga.
--   * Los pagos tienen que cubrir el total; el vuelto se declara y queda en
--     el libro de caja.
--   * Numeración por tenant con contador bloqueado (Sublime: count(*)+1,
--     repetible con dos cajas a la vez).
--   * Conteo de caja por moneda en filas (cash_counts), no columnas _ref/_bs.
--   * El stock baja con un movimiento 'sale' en el kardex.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.tenant_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null,
  value bigint not null default 0,
  primary key (tenant_id, key)
);

create table public.registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  location_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id)
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  register_id uuid not null,
  location_id uuid not null,
  number text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid not null default auth.uid(),
  opened_at timestamptz not null default now(),
  opening_note text,
  closed_by uuid,
  closed_at timestamptz,
  closing_note text,
  unique (tenant_id, number),
  unique (tenant_id, id),
  foreign key (tenant_id, register_id) references public.registers (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id)
);
create unique index cash_sessions_one_open_idx on public.cash_sessions (register_id) where status = 'open';
create index cash_sessions_tenant_opened_idx on public.cash_sessions (tenant_id, opened_at desc);

create table public.cash_counts (
  tenant_id uuid not null,
  session_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opening numeric(16, 2) not null default 0 check (opening >= 0),
  expected numeric(16, 2),
  counted numeric(16, 2) check (counted is null or counted >= 0),
  difference numeric(16, 2),
  primary key (session_id, currency),
  foreign key (tenant_id, session_id) references public.cash_sessions (tenant_id, id) on delete cascade
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  number text not null,
  status text not null default 'completed' check (status in ('completed', 'voided')),
  location_id uuid not null,
  register_id uuid not null,
  session_id uuid not null,
  base_currency text not null,
  local_currency text,
  -- Tasa base→local con la que se cobró, de dónde salió y desde cuándo regía.
  rate numeric(18, 6),
  rate_source text,
  rate_effective_date date,
  prices_include_tax boolean not null,
  subtotal numeric(14, 2) not null,
  discount_total numeric(14, 2) not null,
  tax_total numeric(14, 2) not null,
  total numeric(14, 2) not null,
  igtf_total numeric(14, 2) not null default 0,
  paid_total numeric(14, 2) not null,
  change_total numeric(14, 2) not null default 0,
  units numeric(14, 3) not null,
  customer_name text,
  customer_doc text,
  note text,
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  sold_by uuid not null default auth.uid(),
  sold_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id),
  foreign key (tenant_id, register_id) references public.registers (tenant_id, id),
  foreign key (tenant_id, session_id) references public.cash_sessions (tenant_id, id)
);
create index sales_tenant_sold_idx on public.sales (tenant_id, sold_at desc);
create index sales_session_idx on public.sales (tenant_id, session_id);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  line integer not null,
  variant_id uuid not null,
  product_id uuid not null,
  description text not null,
  sku text,
  qty numeric(14, 3) not null check (qty > 0),
  unit_price numeric(14, 2) not null,
  gross numeric(14, 2) not null,
  discount numeric(14, 2) not null default 0,
  tax_rate numeric(5, 2) not null,
  tax_amount numeric(14, 2) not null,
  line_total numeric(14, 2) not null,
  unit_cost numeric(14, 4),
  unique (sale_id, line),
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id)
);
create index sale_items_variant_idx on public.sale_items (tenant_id, variant_id);

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  payment_method_id uuid not null,
  method_code text not null,
  method_name text not null,
  currency text not null,
  -- Monto en la moneda del método; amount_base es su equivalente en la moneda
  -- base con la tasa de la venta; igtf_base es la parte de IGTF incluida.
  amount numeric(16, 2) not null check (amount > 0),
  amount_base numeric(14, 2) not null,
  igtf_base numeric(14, 2) not null default 0,
  reference text,
  bank text,
  extra jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id) on delete cascade,
  foreign key (tenant_id, payment_method_id) references public.payment_methods (tenant_id, id)
);
create index sale_payments_sale_idx on public.sale_payments (tenant_id, sale_id);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  kind text not null check (kind in ('opening', 'cash_in', 'cash_out', 'sale_cash', 'change')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Positivo entra a la gaveta, negativo sale.
  amount numeric(16, 2) not null check (amount <> 0),
  sale_id uuid,
  note text,
  performed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, session_id) references public.cash_sessions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id)
);
create index cash_movements_session_idx on public.cash_movements (tenant_id, session_id, created_at);

create trigger registers_touch before update on public.registers
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: lectura por membresía; escritura solo por RPC (salvo cajas: dueño/admin)
-- ---------------------------------------------------------------------------

alter table public.tenant_counters enable row level security;
alter table public.registers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_counts enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.cash_movements enable row level security;

revoke all on public.tenant_counters, public.registers, public.cash_sessions, public.cash_counts,
  public.sales, public.sale_items, public.sale_payments, public.cash_movements from anon;
revoke all on public.tenant_counters from authenticated;
revoke insert, update, delete on public.cash_sessions, public.cash_counts, public.sales,
  public.sale_items, public.sale_payments, public.cash_movements from authenticated;
revoke delete on public.registers from authenticated;

create policy tenant_read on public.registers for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy supervisor_insert on public.registers for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy supervisor_update on public.registers for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));

create policy tenant_read on public.cash_sessions for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.cash_counts for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.sales for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.sale_items for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.sale_payments for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.cash_movements for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.tenant_counters for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));

-- ---------------------------------------------------------------------------
-- Apoyo
-- ---------------------------------------------------------------------------

-- Siguiente número de una serie del tenant. La fila queda bloqueada hasta el
-- final de la transacción: dos cajas a la vez nunca obtienen el mismo número.
create or replace function app.next_number(p_tenant_id uuid, p_key text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.tenant_counters as c (tenant_id, key, value)
  values (p_tenant_id, p_key, 1)
  on conflict (tenant_id, key) do update set value = c.value + 1
  returning value
$$;
revoke all on function app.next_number(uuid, text) from public;

-- Sesión abierta del tenant del usuario, bloqueada; falla si no puede operarla.
create or replace function app.session_for_write(p_session_id uuid)
returns public.cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cash_sessions;
begin
  select * into s from public.cash_sessions where id = p_session_id for update;
  if not found or s.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Sesión de caja no encontrada' using errcode = 'no_data_found';
  end if;
  if s.status <> 'open' then
    raise exception 'La caja ya está cerrada; abre una nueva sesión' using errcode = 'check_violation';
  end if;
  return s;
end;
$$;
revoke all on function app.session_for_write(uuid) from public;

-- ---------------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------------

-- p_opening: [{"currency": "USD", "amount": 20}, {"currency": "VES", "amount": 1000}]
create or replace function app.open_cash_session(p_register_id uuid, p_opening jsonb default '[]', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.registers;
  t public.tenants;
  v_session uuid;
  v_number text;
  v_item jsonb;
  v_amount numeric;
  v_currency text;
begin
  select * into r from public.registers where id = p_register_id for update;
  if not found or r.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Caja no encontrada' using errcode = 'no_data_found';
  end if;
  if not r.is_active then
    raise exception 'La caja está inactiva' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cash_sessions s where s.register_id = r.id and s.status = 'open') then
    raise exception 'Esta caja ya tiene una sesión abierta' using errcode = 'unique_violation';
  end if;
  select * into t from public.tenants where id = r.tenant_id;

  v_number := r.code || '-' || lpad(app.next_number(r.tenant_id, 'cash_session')::text, 5, '0');
  insert into public.cash_sessions (tenant_id, register_id, location_id, number, opening_note)
  values (r.tenant_id, r.id, r.location_id, v_number, nullif(trim(p_note), ''))
  returning id into v_session;

  -- Una fila de conteo por moneda que maneja el negocio, aunque abra en cero.
  insert into public.cash_counts (tenant_id, session_id, currency)
  select r.tenant_id, v_session, c from unnest(array_remove(array[t.base_currency, t.local_currency], null)) c;

  for v_item in select * from jsonb_array_elements(coalesce(p_opening, '[]'::jsonb))
  loop
    v_currency := upper(trim(v_item ->> 'currency'));
    v_amount := coalesce((v_item ->> 'amount')::numeric, 0);
    if v_amount < 0 then
      raise exception 'El fondo de caja no puede ser negativo' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.cash_counts where session_id = v_session and currency = v_currency) then
      raise exception 'Moneda % no usada por el negocio', v_currency using errcode = 'check_violation';
    end if;
    update public.cash_counts set opening = round(v_amount, 2) where session_id = v_session and currency = v_currency;
    if v_amount > 0 then
      insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, note)
      values (r.tenant_id, v_session, 'opening', v_currency, round(v_amount, 2), 'Fondo de caja');
    end if;
  end loop;

  return jsonb_build_object('session_id', v_session, 'number', v_number);
end;
$$;
revoke all on function app.open_cash_session(uuid, jsonb, text) from public;
grant execute on function app.open_cash_session(uuid, jsonb, text) to authenticated;

-- Entrada o salida de efectivo fuera de ventas (cambio para la gaveta, pago a
-- un proveedor…). La salida la hace quien abrió la caja o un encargado.
create or replace function app.cash_movement(p_session_id uuid, p_kind text, p_currency text, p_amount numeric, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cash_sessions;
  v_id uuid;
begin
  s := app.session_for_write(p_session_id);
  if p_kind not in ('cash_in', 'cash_out') then
    raise exception 'Tipo de movimiento inválido' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero' using errcode = 'check_violation';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  if p_kind = 'cash_out' and s.opened_by <> auth.uid()
     and not app.has_tenant_role(s.tenant_id, array['owner', 'admin', 'manager']) then
    raise exception 'Solo quien abrió la caja o un encargado saca efectivo' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.cash_counts where session_id = s.id and currency = upper(p_currency)) then
    raise exception 'Moneda % no usada por el negocio', p_currency using errcode = 'check_violation';
  end if;
  insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, note)
  values (s.tenant_id, s.id, p_kind, upper(p_currency),
          case when p_kind = 'cash_out' then -round(p_amount, 2) else round(p_amount, 2) end, trim(p_note))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.cash_movement(uuid, text, text, numeric, text) from public;
grant execute on function app.cash_movement(uuid, text, text, numeric, text) to authenticated;

-- Resumen de la sesión: efectivo esperado por moneda, ventas y cobros por método.
create or replace function app.cash_session_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.cash_sessions;
begin
  select * into s from public.cash_sessions where id = p_session_id;
  if not found or s.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Sesión de caja no encontrada' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object(
    'session_id', s.id,
    'number', s.number,
    'status', s.status,
    'opened_at', s.opened_at,
    'closed_at', s.closed_at,
    'cash', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'currency', c.currency,
        'opening', c.opening,
        'expected', coalesce(c.expected, (select coalesce(sum(m.amount), 0) from public.cash_movements m where m.session_id = s.id and m.currency = c.currency)),
        'counted', c.counted,
        'difference', c.difference
      ) order by c.currency), '[]'::jsonb)
      from public.cash_counts c where c.session_id = s.id
    ),
    'sales', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0), 'discount', coalesce(sum(discount_total), 0),
                                'tax', coalesce(sum(tax_total), 0), 'igtf', coalesce(sum(igtf_total), 0))
      from public.sales where session_id = s.id and status = 'completed'
    ),
    'by_method', (
      select coalesce(jsonb_agg(jsonb_build_object('method', x.method_name, 'currency', x.currency, 'amount', x.amount, 'amount_base', x.amount_base) order by x.method_name), '[]'::jsonb)
      from (
        select p.method_name, p.currency, sum(p.amount) amount, sum(p.amount_base) amount_base
        from public.sale_payments p join public.sales v on v.id = p.sale_id
        where v.session_id = s.id and v.status = 'completed'
        group by p.method_name, p.currency
      ) x
    )
  );
end;
$$;
revoke all on function app.cash_session_summary(uuid) from public;
grant execute on function app.cash_session_summary(uuid) to authenticated;

-- Cierre: p_counted = [{"currency": "USD", "amount": 45}, …]. Guarda esperado,
-- contado y diferencia por moneda. Cierra quien abrió o un encargado.
create or replace function app.close_cash_session(p_session_id uuid, p_counted jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cash_sessions;
  c record;
  v_counted numeric;
begin
  s := app.session_for_write(p_session_id);
  if s.opened_by <> auth.uid() and not app.has_tenant_role(s.tenant_id, array['owner', 'admin', 'manager']) then
    raise exception 'Solo quien abrió la caja o un encargado la cierra' using errcode = 'insufficient_privilege';
  end if;

  for c in select * from public.cash_counts where session_id = s.id
  loop
    select (x ->> 'amount')::numeric into v_counted
    from jsonb_array_elements(coalesce(p_counted, '[]'::jsonb)) x
    where upper(x ->> 'currency') = c.currency;
    if v_counted is null or v_counted < 0 then
      raise exception 'Falta el conteo de %', c.currency using errcode = 'check_violation';
    end if;
    update public.cash_counts set
      expected = (select coalesce(sum(m.amount), 0) from public.cash_movements m where m.session_id = s.id and m.currency = c.currency),
      counted = round(v_counted, 2)
    where session_id = s.id and currency = c.currency;
    update public.cash_counts set difference = counted - expected where session_id = s.id and currency = c.currency;
    v_counted := null;
  end loop;

  update public.cash_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now(), closing_note = nullif(trim(p_note), '')
  where id = s.id;

  return app.cash_session_summary(s.id);
end;
$$;
revoke all on function app.close_cash_session(uuid, jsonb, text) from public;
grant execute on function app.close_cash_session(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Venta
-- ---------------------------------------------------------------------------

-- p_items:    [{"variant_id": "…", "qty": 2, "discount": 1.5}]  (descuento de línea en moneda base)
-- p_cart_discount: descuento sobre el total, en moneda base; se reparte entre líneas.
-- p_payments: [{"payment_method_id": "…", "amount": 22000, "reference": "…", "bank": "…"}]
-- p_change:   {"currency": "USD", "amount": 5} si se dio vuelto en efectivo.
create or replace function app.register_sale(
  p_idempotency_key text,
  p_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_cart_discount numeric default 0,
  p_change jsonb default null,
  p_customer jsonb default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cash_sessions;
  t public.tenants;
  v_existing public.sales;
  v_rate numeric;
  v_rate_source text;
  v_rate_date date;
  v_sale uuid;
  v_number text;
  v_item jsonb;
  v_pay jsonb;
  v public.variants;
  p public.products;
  m public.payment_methods;
  v_line integer := 0;
  v_qty numeric;
  v_price numeric;
  v_gross numeric;
  v_line_disc numeric;
  v_tax_rate numeric;
  v_before numeric;
  v_subtotal numeric := 0;
  v_line_discounts numeric := 0;
  v_cart_disc numeric := round(coalesce(p_cart_discount, 0), 2);
  v_units numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_igtf_total numeric := 0;
  v_amount numeric;
  v_amount_base numeric;
  v_igtf numeric;
  v_change_base numeric := 0;
  v_change_amount numeric;
  v_change_currency text;
  v_has_cash boolean := false;
  li record;
  v_remaining numeric;
  v_share numeric;
  v_count integer;
  v_net numeric;
  v_tax numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'Falta el identificador del cobro' using errcode = 'check_violation';
  end if;

  select * into s from public.cash_sessions where id = p_session_id;
  if not found or s.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Sesión de caja no encontrada' using errcode = 'no_data_found';
  end if;

  -- Reintento del mismo cobro (doble toque, reconexión): devuelve la venta ya hecha.
  select * into v_existing from public.sales where tenant_id = s.tenant_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('sale_id', v_existing.id, 'number', v_existing.number, 'total', v_existing.total, 'duplicate', true);
  end if;

  s := app.session_for_write(p_session_id);
  select * into t from public.tenants where id = s.tenant_id;
  if t.status <> 'active' then
    raise exception 'La cuenta está suspendida' using errcode = 'insufficient_privilege';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos' using errcode = 'check_violation';
  end if;
  if v_cart_disc < 0 then
    raise exception 'Descuento inválido' using errcode = 'check_violation';
  end if;

  if t.local_currency is not null then
    select r.rate, r.source, r.effective_date into v_rate, v_rate_source, v_rate_date from app.rate_at(t.id) r limit 1;
  end if;

  v_number := 'V-' || lpad(app.next_number(t.id, 'sale')::text, 6, '0');
  insert into public.sales (
    tenant_id, number, location_id, register_id, session_id, base_currency, local_currency,
    rate, rate_source, rate_effective_date, prices_include_tax,
    subtotal, discount_total, tax_total, total, paid_total, units,
    customer_name, customer_doc, note, idempotency_key
  ) values (
    t.id, v_number, s.location_id, s.register_id, s.id, t.base_currency, t.local_currency,
    v_rate, v_rate_source, v_rate_date, t.prices_include_tax,
    0, 0, 0, 0, 0, 0,
    nullif(trim(p_customer ->> 'name'), ''), nullif(trim(p_customer ->> 'doc'), ''),
    nullif(trim(p_note), ''), p_idempotency_key
  ) returning id into v_sale;

  -- Líneas: precio y costo salen de la base de datos.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Cantidad inválida en la línea %', v_line using errcode = 'check_violation';
    end if;
    select * into v from public.variants where id = (v_item ->> 'variant_id')::uuid and tenant_id = t.id and deleted_at is null;
    if not found or not v.is_active then
      raise exception 'Línea %: producto no disponible', v_line using errcode = 'no_data_found';
    end if;
    select * into p from public.products where id = v.product_id;
    if not p.is_active or p.deleted_at is not null then
      raise exception 'Línea %: % no está activo', v_line, p.name using errcode = 'check_violation';
    end if;
    v_price := coalesce(v.price, v.regular_price);
    if v_price is null or v_price <= 0 then
      raise exception '% no tiene precio', p.name using errcode = 'check_violation';
    end if;

    v_gross := round(v_price * v_qty, 2);
    v_line_disc := round(coalesce((v_item ->> 'discount')::numeric, 0), 2);
    if v_line_disc < 0 or v_line_disc > v_gross then
      raise exception 'Línea %: descuento inválido', v_line using errcode = 'check_violation';
    end if;

    select coalesce(
      (select x.rate from public.tax_rates x where x.id = p.tax_rate_id),
      (select x.rate from public.tax_rates x where x.tenant_id = t.id and x.is_default),
      0) into v_tax_rate;

    -- Stock: misma regla que el resto del inventario (fila bloqueada, sin negativos).
    v_before := app.stock_row_for_update(t.id, v.id, s.location_id);
    if (select st.available from public.stocks st where st.variant_id = v.id and st.location_id = s.location_id) < v_qty then
      raise exception 'Stock insuficiente de %: hay %', p.name, v_before using errcode = 'check_violation';
    end if;
    update public.stocks set on_hand = on_hand - v_qty, updated_at = now()
    where variant_id = v.id and location_id = s.location_id;
    insert into public.inventory_movements (
      tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, note, unit_cost, unit_price
    ) values (
      t.id, v.id, s.location_id, 'sale', v_before, -v_qty, v_before - v_qty, 'Venta ' || v_number, v.cost, v_price
    );

    insert into public.sale_items (
      tenant_id, sale_id, line, variant_id, product_id, description, sku, qty, unit_price, gross,
      discount, tax_rate, tax_amount, line_total, unit_cost
    ) values (
      t.id, v_sale, v_line, v.id, p.id,
      p.name || coalesce(nullif(' — ' || (select string_agg(value, ' · ') from jsonb_each_text(v.options)), ' — '), ''),
      v.sku, v_qty, v_price, v_gross, v_line_disc, v_tax_rate, 0, 0, v.cost
    );
    v_subtotal := v_subtotal + v_gross;
    v_line_discounts := v_line_discounts + v_line_disc;
    v_units := v_units + v_qty;
  end loop;

  if v_cart_disc > v_subtotal - v_line_discounts then
    raise exception 'El descuento supera el total' using errcode = 'check_violation';
  end if;

  -- Reparto del descuento del carrito en proporción a cada línea; la última
  -- se lleva el redondeo. Luego impuesto y total por línea.
  v_remaining := v_cart_disc;
  select count(*) into v_count from public.sale_items where sale_id = v_sale;
  for li in select * from public.sale_items where sale_id = v_sale order by line
  loop
    if li.line = v_count then
      v_share := v_remaining;
    elsif v_subtotal - v_line_discounts > 0 then
      v_share := round(v_cart_disc * (li.gross - li.discount) / (v_subtotal - v_line_discounts), 2);
    else
      v_share := 0;
    end if;
    v_remaining := v_remaining - v_share;
    v_net := li.gross - li.discount - v_share;
    if t.prices_include_tax then
      v_tax := round(v_net - v_net / (1 + li.tax_rate / 100), 2);
    else
      v_tax := round(v_net * li.tax_rate / 100, 2);
      v_net := v_net + v_tax;
    end if;
    update public.sale_items set discount = li.discount + v_share, tax_amount = v_tax, line_total = v_net
    where id = li.id;
    v_tax_total := v_tax_total + v_tax;
    v_total := v_total + v_net;
  end loop;

  -- Pagos: el servidor convierte con la tasa de la venta y calcula el IGTF.
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Falta el pago' using errcode = 'check_violation';
  end if;
  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    select * into m from public.payment_methods
    where id = (v_pay ->> 'payment_method_id')::uuid and tenant_id = t.id and is_active;
    if not found then
      raise exception 'Método de pago no disponible' using errcode = 'no_data_found';
    end if;
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    if v_amount is null or v_amount <= 0 then
      raise exception 'Monto inválido en %', m.name using errcode = 'check_violation';
    end if;
    if m.currency = t.base_currency then
      v_amount_base := v_amount;
    elsif m.currency = t.local_currency then
      if v_rate is null then
        raise exception 'No hay tasa de cambio vigente' using errcode = 'no_data_found';
      end if;
      v_amount_base := round(v_amount / v_rate, 2);
    else
      raise exception 'El método % usa una moneda que el negocio no maneja', m.name using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from jsonb_array_elements(m.fields) f
      where (f ->> 'required')::boolean
        and nullif(trim(v_pay ->> (f ->> 'id')), '') is null
        and nullif(trim(v_pay -> 'extra' ->> (f ->> 'id')), '') is null
    ) then
      raise exception 'Faltan datos del pago con %', m.name using errcode = 'check_violation';
    end if;

    -- IGTF: el pago en divisas incluye el impuesto; lo aplicado a la venta es amount/(1+r).
    v_igtf := 0;
    if t.is_special_taxpayer and m.applies_igtf and t.igtf_rate > 0 then
      v_igtf := v_amount_base - round(v_amount_base / (1 + t.igtf_rate / 100), 2);
    end if;
    if m.kind = 'cash' then
      v_has_cash := true;
    end if;

    insert into public.sale_payments (
      tenant_id, sale_id, payment_method_id, method_code, method_name, currency,
      amount, amount_base, igtf_base, reference, bank, extra
    ) values (
      t.id, v_sale, m.id, m.code, m.name, m.currency, v_amount, v_amount_base, v_igtf,
      nullif(trim(v_pay ->> 'reference'), ''), nullif(trim(v_pay ->> 'bank'), ''), coalesce(v_pay -> 'extra', '{}'::jsonb)
    );
    if m.kind = 'cash' then
      insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, sale_id, note)
      values (t.id, s.id, 'sale_cash', m.currency, v_amount, v_sale, 'Venta ' || v_number);
    end if;
    v_paid := v_paid + v_amount_base;
    v_igtf_total := v_igtf_total + v_igtf;
  end loop;

  -- Vuelto declarado por el cajero (sale de la gaveta).
  if p_change is not null and coalesce((p_change ->> 'amount')::numeric, 0) > 0 then
    if not v_has_cash then
      raise exception 'Solo se da vuelto cuando se cobra en efectivo' using errcode = 'check_violation';
    end if;
    v_change_currency := upper(p_change ->> 'currency');
    v_change_amount := round((p_change ->> 'amount')::numeric, 2);
    if v_change_currency = t.base_currency then
      v_change_base := v_change_amount;
    elsif v_change_currency = t.local_currency and v_rate is not null then
      v_change_base := round(v_change_amount / v_rate, 2);
    else
      raise exception 'Moneda de vuelto inválida' using errcode = 'check_violation';
    end if;
    insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, sale_id, note)
    values (t.id, s.id, 'change', v_change_currency, -v_change_amount, v_sale, 'Vuelto venta ' || v_number);
  end if;

  -- Lo pagado, menos IGTF y vuelto, tiene que cubrir el total. Tolerancia: un
  -- centavo de la base por cada pago (redondeo de la conversión).
  if v_paid - v_igtf_total - v_change_base < v_total - 0.01 * jsonb_array_length(p_payments) then
    raise exception 'Falta cobrar % %', round(v_total - (v_paid - v_igtf_total - v_change_base), 2), t.base_currency
      using errcode = 'check_violation';
  end if;
  if v_paid - v_igtf_total - v_change_base > v_total + 0.01 * jsonb_array_length(p_payments) then
    raise exception 'Se cobró % % de más: registra el vuelto', round((v_paid - v_igtf_total - v_change_base) - v_total, 2), t.base_currency
      using errcode = 'check_violation';
  end if;

  update public.sales set
    subtotal = round(v_subtotal, 2),
    discount_total = round(v_line_discounts + v_cart_disc, 2),
    tax_total = round(v_tax_total, 2),
    total = round(v_total, 2),
    igtf_total = round(v_igtf_total, 2),
    paid_total = round(v_paid, 2),
    change_total = round(v_change_base, 2),
    units = v_units
  where id = v_sale;

  return jsonb_build_object(
    'sale_id', v_sale, 'number', v_number, 'total', round(v_total, 2), 'igtf', round(v_igtf_total, 2),
    'rate', v_rate, 'duplicate', false
  );
end;
$$;
revoke all on function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text) from public;
grant execute on function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Envoltorios públicos (SECURITY INVOKER)
-- ---------------------------------------------------------------------------

create function public.open_cash_session(p_register_id uuid, p_opening jsonb default '[]', p_note text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.open_cash_session(p_register_id, p_opening, p_note)
$$;
create function public.cash_movement(p_session_id uuid, p_kind text, p_currency text, p_amount numeric, p_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.cash_movement(p_session_id, p_kind, p_currency, p_amount, p_note)
$$;
create function public.cash_session_summary(p_session_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.cash_session_summary(p_session_id)
$$;
create function public.close_cash_session(p_session_id uuid, p_counted jsonb, p_note text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.close_cash_session(p_session_id, p_counted, p_note)
$$;
create function public.register_sale(
  p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb,
  p_cart_discount numeric default 0, p_change jsonb default null, p_customer jsonb default null, p_note text default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.register_sale(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_change, p_customer, p_note)
$$;

revoke all on function public.open_cash_session(uuid, jsonb, text) from public, anon;
revoke all on function public.cash_movement(uuid, text, text, numeric, text) from public, anon;
revoke all on function public.cash_session_summary(uuid) from public, anon;
revoke all on function public.close_cash_session(uuid, jsonb, text) from public, anon;
revoke all on function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text) from public, anon;
grant execute on function public.open_cash_session(uuid, jsonb, text) to authenticated;
grant execute on function public.cash_movement(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.cash_session_summary(uuid) to authenticated;
grant execute on function public.close_cash_session(uuid, jsonb, text) to authenticated;
grant execute on function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text) to authenticated;
