-- Anular ventas y devoluciones.
--
-- Portado de sublime_register_sale_return y la anulación de SublimeVentas
-- (basicosystems@f551478b). Reglas:
--   * Anular deja la venta como si no hubiera ocurrido: solo mientras su caja
--     sigue abierta. Devuelve el stock, saca de la gaveta el efectivo que
--     entró (y devuelve el vuelto), anula sus entradas en el libro y cancela
--     su cuenta por cobrar sin cobros. Si la caja ya cerró, se hace una
--     devolución.
--   * Devolución: total o parcial, por línea, sin pasar de lo vendido menos
--     lo ya devuelto. Puede reponer el stock (o no, si la pieza vino dañada)
--     y reintegrar el dinero por un método: efectivo sale de la caja abierta;
--     otro método sale de su cuenta en el libro.
--   * Solo dueño, administrador o encargado. La venta queda; la devolución
--     tiene su propio número (D-000001) y resta en los reportes.

alter table public.sales
  add column voided_at timestamptz,
  add column voided_by uuid,
  add column void_reason text,
  add constraint sales_void_consistent check ((status = 'voided') = (voided_at is not null and void_reason is not null));

alter table public.cash_movements drop constraint cash_movements_kind_check;
alter table public.cash_movements add constraint cash_movements_kind_check
  check (kind in ('opening', 'cash_in', 'cash_out', 'sale_cash', 'change', 'sale_void', 'refund'));

alter table public.finance_movements drop constraint finance_movements_kind_check;
alter table public.finance_movements add constraint finance_movements_kind_check
  check (kind in ('manual', 'transfer', 'sale', 'cash_close', 'obligation', 'receivable', 'provider', 'refund'));

-- ---------------------------------------------------------------------------
-- Devoluciones
-- ---------------------------------------------------------------------------

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  number text not null,
  location_id uuid not null,
  -- Caja donde salió el efectivo del reintegro (si fue en efectivo).
  session_id uuid,
  reason text not null check (length(trim(reason)) > 0),
  -- Monto devuelto en la moneda base de la venta (con impuestos).
  total numeric(14, 2) not null check (total >= 0),
  restock boolean not null default true,
  refund_method_id uuid,
  refund_method_name text,
  refund_currency text,
  refund_amount numeric(16, 2),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, id),
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id),
  foreign key (tenant_id, session_id) references public.cash_sessions (tenant_id, id),
  foreign key (tenant_id, refund_method_id) references public.payment_methods (tenant_id, id)
);
create index sale_returns_sale_idx on public.sale_returns (tenant_id, sale_id);
create index sale_returns_created_idx on public.sale_returns (tenant_id, created_at desc);

create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  return_id uuid not null,
  sale_item_id uuid not null,
  variant_id uuid not null,
  description text not null,
  qty numeric(14, 3) not null check (qty > 0),
  amount numeric(14, 2) not null check (amount >= 0),
  unique (return_id, sale_item_id),
  foreign key (tenant_id, return_id) references public.sale_returns (tenant_id, id) on delete cascade
);
create index sale_return_items_item_idx on public.sale_return_items (sale_item_id);

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
revoke all on public.sale_returns, public.sale_return_items from anon;
revoke insert, update, delete on public.sale_returns, public.sale_return_items from authenticated;
create policy tenant_read on public.sale_returns for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy tenant_read on public.sale_return_items for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Venta para anular o devolver: del negocio activo y con rol de supervisor.
create or replace function app.sale_for_correction(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  s public.sales;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado anulan o devuelven ventas' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'no_data_found';
  end if;
  if s.status <> 'completed' then
    raise exception 'La venta % ya está anulada', s.number using errcode = 'check_violation';
  end if;
  return s;
end;
$$;
revoke all on function app.sale_for_correction(uuid) from public;

-- Repone (p_qty > 0) el stock de una variante con su movimiento de inventario.
create or replace function app.restock_from_sale(p_tenant uuid, p_variant_id uuid, p_location_id uuid, p_qty numeric, p_note text, p_unit_price numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before numeric;
begin
  v_before := app.stock_row_for_update(p_tenant, p_variant_id, p_location_id);
  update public.stocks set on_hand = on_hand + p_qty, updated_at = now()
  where variant_id = p_variant_id and location_id = p_location_id;
  insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, note, unit_cost, unit_price)
  values (p_tenant, p_variant_id, p_location_id, 'sale_return', v_before, p_qty, v_before + p_qty, p_note,
          (select cost from public.variants where id = p_variant_id), p_unit_price);
end;
$$;
revoke all on function app.restock_from_sale(uuid, uuid, uuid, numeric, text, numeric) from public;

-- ---------------------------------------------------------------------------
-- Anular
-- ---------------------------------------------------------------------------

create or replace function app.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sales := app.sale_for_correction(p_sale_id);
  i public.sale_items;
  c public.cash_movements;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica por qué se anula' using errcode = 'check_violation';
  end if;
  if (select status from public.cash_sessions where id = s.session_id) <> 'open' then
    raise exception 'La caja de la venta % ya cerró: registra una devolución', s.number using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sale_returns where sale_id = s.id) then
    raise exception 'La venta % tiene devoluciones: no se anula', s.number using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.receivables r join public.receivable_collections rc on rc.receivable_id = r.id
             where r.sale_id = s.id and rc.voided_at is null) then
    raise exception 'La venta % tiene cobros en Por cobrar: anúlalos primero', s.number using errcode = 'check_violation';
  end if;

  for i in select * from public.sale_items where sale_id = s.id order by line loop
    perform app.restock_from_sale(s.tenant_id, i.variant_id, s.location_id, i.qty, 'Anulación ' || s.number, i.unit_price);
  end loop;

  -- El efectivo que entró sale y el vuelto que salió vuelve.
  for c in select * from public.cash_movements where sale_id = s.id and kind in ('sale_cash', 'change') loop
    insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, sale_id, note)
    values (s.tenant_id, s.session_id, 'sale_void', c.currency, -c.amount, s.id, 'Anulación ' || s.number);
  end loop;

  update public.finance_movements set voided_at = now(), voided_by = auth.uid(), void_reason = 'Venta ' || s.number || ' anulada: ' || trim(p_reason)
  where voided_at is null and sale_payment_id in (select id from public.sale_payments where sale_id = s.id);

  update public.sales set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = s.id;
end;
$$;
revoke all on function app.void_sale(uuid, text) from public;
grant execute on function app.void_sale(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Devolver
-- ---------------------------------------------------------------------------

-- p_items: [{sale_item_id, qty}]. p_refund_method_id null: sin reintegro
-- (cambio por otro producto, nota de crédito a mano). Efectivo: p_session_id
-- es la caja abierta de donde sale.
create or replace function app.create_sale_return(
  p_sale_id uuid, p_items jsonb, p_reason text, p_restock boolean default true,
  p_refund_method_id uuid default null, p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sales := app.sale_for_correction(p_sale_id);
  t public.tenants;
  m public.payment_methods;
  cs public.cash_sessions;
  x record;
  i public.sale_items;
  v_returned numeric;
  v_amount numeric;
  v_total numeric := 0;
  v_return uuid;
  v_number text;
  v_rate numeric;
  v_refund numeric;
  v_account uuid;
begin
  select * into t from public.tenants where id = s.tenant_id;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo de la devolución' using errcode = 'check_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige qué se devuelve' using errcode = 'check_violation';
  end if;

  v_number := 'D-' || lpad(app.next_number(s.tenant_id, 'return')::text, 6, '0');
  insert into public.sale_returns (tenant_id, sale_id, number, location_id, reason, total, restock)
  values (s.tenant_id, s.id, v_number, s.location_id, trim(p_reason), 0, coalesce(p_restock, true))
  returning id into v_return;

  for x in select * from jsonb_to_recordset(p_items) as r(sale_item_id uuid, qty numeric) loop
    select * into i from public.sale_items where id = x.sale_item_id and sale_id = s.id;
    if not found then
      raise exception 'Esa línea no es de la venta %', s.number using errcode = 'check_violation';
    end if;
    if x.qty is null or x.qty <= 0 then
      continue;
    end if;
    select coalesce(sum(ri.qty), 0) into v_returned from public.sale_return_items ri where ri.sale_item_id = i.id;
    if x.qty > i.qty - v_returned + 0.0005 then
      raise exception 'De % se vendieron % y ya se devolvieron %', i.description, i.qty, v_returned using errcode = 'check_violation';
    end if;
    v_amount := round(i.line_total / i.qty * x.qty, 2);
    v_total := v_total + v_amount;
    insert into public.sale_return_items (tenant_id, return_id, sale_item_id, variant_id, description, qty, amount)
    values (s.tenant_id, v_return, i.id, i.variant_id, i.description, x.qty, v_amount);
    if coalesce(p_restock, true) then
      perform app.restock_from_sale(s.tenant_id, i.variant_id, s.location_id, x.qty, 'Devolución ' || v_number || ' de ' || s.number, i.unit_price);
    end if;
  end loop;
  if not exists (select 1 from public.sale_return_items where return_id = v_return) then
    raise exception 'Elige qué se devuelve' using errcode = 'check_violation';
  end if;

  if p_refund_method_id is not null and v_total > 0 then
    select * into m from public.payment_methods where id = p_refund_method_id and tenant_id = s.tenant_id;
    if not found then
      raise exception 'Método de reintegro no encontrado' using errcode = 'no_data_found';
    end if;
    if m.kind = 'bnpl' then
      raise exception 'Lo vendido con % se ajusta en Por cobrar, no se reintegra aquí', m.name using errcode = 'check_violation';
    end if;
    if m.currency = t.base_currency then
      v_refund := v_total;
    else
      select r.rate into v_rate from app.rate_at(s.tenant_id) r;
      if v_rate is null then
        raise exception 'Sin tasa vigente para reintegrar en %', m.currency using errcode = 'check_violation';
      end if;
      v_refund := round(v_total * v_rate, 2);
    end if;

    if m.kind = 'cash' then
      if p_session_id is null then
        raise exception 'Para reintegrar en efectivo abre una caja' using errcode = 'check_violation';
      end if;
      cs := app.session_for_write(p_session_id);
      if cs.tenant_id <> s.tenant_id then
        raise exception 'Sesión de caja no encontrada' using errcode = 'no_data_found';
      end if;
      insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, sale_id, note)
      values (s.tenant_id, cs.id, 'refund', m.currency, -v_refund, s.id, 'Devolución ' || v_number);
    else
      v_account := m.account_id;
      if v_account is not null then
        insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, note)
        values (s.tenant_id, v_account, 'out', 'refund', v_refund, m.currency, (now() at time zone 'America/Caracas')::date,
                'Devoluciones', s.customer_name, 'Devolución ' || v_number || ' de ' || s.number);
      end if;
    end if;
    update public.sale_returns
    set refund_method_id = m.id, refund_method_name = m.name, refund_currency = m.currency, refund_amount = v_refund, session_id = cs.id
    where id = v_return;
  end if;

  update public.sale_returns set total = v_total where id = v_return;
  return jsonb_build_object('return_id', v_return, 'number', v_number, 'total', v_total, 'refund_amount', v_refund, 'refund_currency', m.currency);
end;
$$;
revoke all on function app.create_sale_return(uuid, jsonb, text, boolean, uuid, uuid) from public;
grant execute on function app.create_sale_return(uuid, jsonb, text, boolean, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reportes y cierre: las devoluciones restan
-- ---------------------------------------------------------------------------

create or replace function app.sales_kpis(p_tenant uuid, p_from timestamptz, p_to timestamptz, p_location_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select * from public.sales
    where tenant_id = p_tenant and status = 'completed'
      and sold_at >= p_from and sold_at < p_to
      and (p_location_id is null or location_id = p_location_id)
  ), l as (
    select i.* from public.sale_items i join s on s.id = i.sale_id
  ), r as (
    select * from public.sale_returns
    where tenant_id = p_tenant and created_at >= p_from and created_at < p_to
      and (p_location_id is null or location_id = p_location_id)
  )
  select jsonb_build_object(
    'tickets', (select count(*) from s),
    'units', (select coalesce(sum(units), 0) from s),
    'gross', (select coalesce(sum(subtotal), 0) from s),
    'discount', (select coalesce(sum(discount_total), 0) from s),
    'tax', (select coalesce(sum(tax_total), 0) from s),
    'net', (select coalesce(sum(total), 0) from s),
    'igtf', (select coalesce(sum(igtf_total), 0) from s),
    'offline', (select count(*) from s where captured_offline),
    'lines', (select count(*) from l),
    'lines_costed', (select count(*) from l where unit_cost is not null),
    'net_costed', (select coalesce(round(sum(line_total - tax_amount), 2), 0) from l where unit_cost is not null),
    'cost', (select coalesce(round(sum(qty * unit_cost), 2), 0) from l where unit_cost is not null),
    'returns', (select count(*) from r),
    'returns_total', (select coalesce(sum(total), 0) from r),
    'voided', (select count(*) from public.sales v
               where v.tenant_id = p_tenant and v.status = 'voided' and v.sold_at >= p_from and v.sold_at < p_to
                 and (p_location_id is null or v.location_id = p_location_id))
  )
$$;

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
    'voided', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0)) from public.sales where session_id = s.id and status = 'voided'),
    'returns', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0))
      from public.sale_returns where session_id = s.id
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

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create function public.void_sale(p_sale_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select app.void_sale(p_sale_id, p_reason) $$;
create function public.create_sale_return(
  p_sale_id uuid, p_items jsonb, p_reason text, p_restock boolean default true,
  p_refund_method_id uuid default null, p_session_id uuid default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.create_sale_return(p_sale_id, p_items, p_reason, p_restock, p_refund_method_id, p_session_id)
$$;
revoke all on function public.void_sale(uuid, text) from public, anon;
revoke all on function public.create_sale_return(uuid, jsonb, text, boolean, uuid, uuid) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.create_sale_return(uuid, jsonb, text, boolean, uuid, uuid) to authenticated;
