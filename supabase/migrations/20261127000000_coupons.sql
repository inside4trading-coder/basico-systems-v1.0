-- Cupones de descuento en el POS.
--
-- Un cupón es un código con un descuento en porcentaje o en monto (moneda
-- base), con vigencia, compra mínima y usos máximos opcionales. Lo crean
-- dueño, administrador o encargado en Configuración.
--   * validate_coupon: el POS consulta el cupón antes de cobrar.
--   * register_sale_coupon: registra la venta con register_sale y, en la misma
--     transacción, comprueba el cupón contra lo que calculó el servidor. Si el
--     descuento no cuadra o el cupón ya no vale, la venta no se registra.
--   * Los usos se cuentan sobre ventas no anuladas: anular devuelve el uso.
-- El cupón necesita conexión; las ventas sin conexión no lo llevan.

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  description text check (description is null or length(description) <= 120),
  kind text not null check (kind in ('percent', 'amount')),
  value numeric(12, 2) not null check (value > 0),
  min_purchase numeric(12, 2) not null default 0 check (min_purchase >= 0),
  starts_on date,
  ends_on date,
  max_uses integer check (max_uses is null or max_uses > 0),
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  check (kind <> 'percent' or value <= 100),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

alter table public.coupons enable row level security;
revoke all on public.coupons from anon;
revoke delete on public.coupons from authenticated;
create policy tenant_read on public.coupons for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy manager_insert on public.coupons for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy manager_update on public.coupons for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']))
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
revoke update on public.coupons from authenticated;
grant update (description, kind, value, min_purchase, starts_on, ends_on, max_uses, is_active) on public.coupons to authenticated;

alter table public.sales add column coupon_id uuid;
alter table public.sales add column coupon_code text;
alter table public.sales add column coupon_discount numeric(14, 2) not null default 0;
alter table public.sales add constraint sales_coupon_fk foreign key (tenant_id, coupon_id) references public.coupons (tenant_id, id);
create index sales_coupon_idx on public.sales (tenant_id, coupon_id) where coupon_id is not null;

-- Usos vigentes de un cupón.
create or replace function app.coupon_uses(p_coupon_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.sales where coupon_id = p_coupon_id and status <> 'voided'
$$;
revoke all on function app.coupon_uses(uuid) from public;

-- El cupón por código, si vale hoy (hora de Caracas). Sin el monto: eso se
-- calcula con la compra.
create or replace function app.coupon_for_sale(p_tenant_id uuid, p_code text, p_lock boolean default false)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.coupons;
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  if p_lock then
    select * into c from public.coupons where tenant_id = p_tenant_id and code = upper(trim(p_code)) for update;
  else
    select * into c from public.coupons where tenant_id = p_tenant_id and code = upper(trim(p_code));
  end if;
  if not found or not c.is_active then
    raise exception 'Cupón no válido' using errcode = 'no_data_found';
  end if;
  if c.starts_on is not null and v_today < c.starts_on then
    raise exception 'El cupón aún no está vigente' using errcode = 'check_violation';
  end if;
  if c.ends_on is not null and v_today > c.ends_on then
    raise exception 'El cupón está vencido' using errcode = 'check_violation';
  end if;
  if c.max_uses is not null and app.coupon_uses(c.id) >= c.max_uses then
    raise exception 'El cupón ya se usó todas las veces permitidas' using errcode = 'check_violation';
  end if;
  return c;
end;
$$;
revoke all on function app.coupon_for_sale(uuid, text, boolean) from public;

-- Descuento del cupón sobre la compra después de los descuentos por línea.
create or replace function app.coupon_amount(c public.coupons, p_base numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_base <= 0 then 0
              when c.kind = 'percent' then round(p_base * c.value / 100, 2)
              else least(round(c.value, 2), round(p_base, 2)) end
$$;
revoke all on function app.coupon_amount(public.coupons, numeric) from public;

-- Consulta del POS antes de cobrar.
create or replace function app.validate_coupon(p_code text, p_base numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  c public.coupons;
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  c := app.coupon_for_sale(v_tenant, p_code);
  if coalesce(p_base, 0) < c.min_purchase then
    raise exception 'El cupón pide una compra mínima de %', to_char(c.min_purchase, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  return jsonb_build_object('id', c.id, 'code', c.code, 'description', c.description, 'kind', c.kind, 'value', c.value,
                            'min_purchase', c.min_purchase, 'discount', app.coupon_amount(c, coalesce(p_base, 0)));
end;
$$;
revoke all on function app.validate_coupon(text, numeric) from public;
grant execute on function app.validate_coupon(text, numeric) to authenticated;

create or replace function app.register_sale_coupon(
  p_idempotency_key text,
  p_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_cart_discount numeric,
  p_coupon_code text,
  p_coupon_discount numeric,
  p_change jsonb default null,
  p_customer jsonb default null,
  p_note text default null,
  p_channel_id uuid default null,
  p_cashier_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cash_sessions;
  c public.coupons;
  sale public.sales;
  v_result jsonb;
  v_base numeric;
  v_expected numeric;
begin
  select * into s from public.cash_sessions where id = p_session_id;
  if not found or s.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Sesión de caja no encontrada' using errcode = 'no_data_found';
  end if;
  -- Reintento del mismo cobro: la venta ya existe con su cupón.
  if exists (select 1 from public.sales where tenant_id = s.tenant_id and idempotency_key = p_idempotency_key) then
    return app.register_sale(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_change, p_customer, p_note,
                             null, p_channel_id, p_cashier_id);
  end if;

  -- El bloqueo ordena dos ventas que usan el último cupo a la vez.
  c := app.coupon_for_sale(s.tenant_id, p_coupon_code, true);
  if coalesce(p_coupon_discount, 0) <= 0 or coalesce(p_cart_discount, 0) < p_coupon_discount then
    raise exception 'Descuento del cupón inválido' using errcode = 'check_violation';
  end if;

  v_result := app.register_sale(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_change, p_customer, p_note,
                                null, p_channel_id, p_cashier_id);
  select * into sale from public.sales where id = (v_result ->> 'sale_id')::uuid;

  -- Base del cupón: lo vendido menos los descuentos por línea.
  v_base := sale.subtotal - sale.discount_total + round(p_cart_discount, 2);
  if v_base < c.min_purchase then
    raise exception 'El cupón pide una compra mínima de %', to_char(c.min_purchase, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  v_expected := app.coupon_amount(c, v_base);
  if abs(v_expected - round(p_coupon_discount, 2)) >= 0.01 then
    raise exception 'El descuento del cupón cambió; vuelve a aplicarlo' using errcode = 'check_violation';
  end if;

  update public.sales set coupon_id = c.id, coupon_code = c.code, coupon_discount = v_expected where id = sale.id;
  return v_result || jsonb_build_object('coupon_code', c.code, 'coupon_discount', v_expected);
end;
$$;
revoke all on function app.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid) from public;
grant execute on function app.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid) to authenticated;

create function public.validate_coupon(p_code text, p_base numeric)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.validate_coupon(p_code, p_base)
$$;
create function public.register_sale_coupon(
  p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb,
  p_cart_discount numeric, p_coupon_code text, p_coupon_discount numeric,
  p_change jsonb default null, p_customer jsonb default null, p_note text default null,
  p_channel_id uuid default null, p_cashier_id uuid default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.register_sale_coupon(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_coupon_code,
                                  p_coupon_discount, p_change, p_customer, p_note, p_channel_id, p_cashier_id)
$$;
-- Usos de cada cupón para la pantalla de Configuración.
create function public.coupon_usage()
returns table (coupon_id uuid, uses integer, discount_total numeric)
language sql stable security invoker set search_path = '' as $$
  select s.coupon_id, count(*)::integer, coalesce(sum(s.coupon_discount), 0)
  from public.sales s
  where s.coupon_id is not null and s.status <> 'voided'
  group by s.coupon_id
$$;
revoke all on function public.validate_coupon(text, numeric) from public, anon;
revoke all on function public.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid) from public, anon;
revoke all on function public.coupon_usage() from public, anon;
grant execute on function public.validate_coupon(text, numeric) to authenticated;
grant execute on function public.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid) to authenticated;
grant execute on function public.coupon_usage() to authenticated;
