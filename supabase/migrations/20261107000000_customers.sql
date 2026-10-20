-- Ficha de clientes.
--
-- Portado de sublime_customers y PosCustomerDialog (basicosystems@f551478b).
-- Un cliente se identifica por cédula/RIF o por teléfono, comparados sin
-- puntos, guiones ni espacios. En el POS se busca o se crea al cobrar; la
-- venta guarda el vínculo y, como antes, el nombre y el documento tal cual
-- (la nota de entrega y las ventas sin conexión los siguen usando).
--   * Cualquier miembro del equipo busca, crea y corrige clientes (el cajero
--     los da de alta al cobrar). No se borran: la venta los necesita.
--   * register_sale resuelve el cliente: el elegido (id), el que coincide por
--     documento o teléfono, o uno nuevo si hay nombre y documento o teléfono.
--     Solo con nombre queda como texto en la venta, sin ficha.
--   * customers_overview: búsqueda con compras, total y última compra.
--   * Las ventas ya hechas con documento se agrupan en fichas.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  doc text check (doc is null or length(trim(doc)) between 3 and 30),
  doc_key text generated always as (nullif(upper(regexp_replace(coalesce(doc, ''), '[^A-Za-z0-9]', '', 'g')), '')) stored,
  phone text check (phone is null or length(trim(phone)) between 7 and 30),
  phone_key text generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10), '')) stored,
  email text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  address text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index customers_doc_uq on public.customers (tenant_id, doc_key) where doc_key is not null;
create index customers_phone_idx on public.customers (tenant_id, phone_key) where phone_key is not null;
create index customers_name_idx on public.customers (tenant_id, lower(name));
create trigger customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();

alter table public.customers enable row level security;
revoke all on public.customers from anon;
create policy tenant_read on public.customers for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy member_insert on public.customers for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy member_update on public.customers for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
revoke update, delete on public.customers from authenticated;
grant update (name, doc, phone, email, address, notes) on public.customers to authenticated;

alter table public.sales add column customer_id uuid;
alter table public.sales add constraint sales_customer_fk foreign key (tenant_id, customer_id) references public.customers (tenant_id, id);
create index sales_customer_idx on public.sales (tenant_id, customer_id) where customer_id is not null;

create or replace function app.resolve_customer(p_tenant_id uuid, p_customer jsonb)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  v_name text := nullif(trim(p_customer ->> 'name'), '');
  v_doc text := nullif(trim(p_customer ->> 'doc'), '');
  v_phone text := nullif(trim(p_customer ->> 'phone'), '');
  v_doc_key text := nullif(upper(regexp_replace(coalesce(v_doc, ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_phone_key text := nullif(right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 10), '');
begin
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    return null;
  end if;
  if nullif(p_customer ->> 'id', '') is not null then
    select * into c from public.customers where id = (p_customer ->> 'id')::uuid and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Cliente no encontrado' using errcode = 'no_data_found';
    end if;
    return c;
  end if;
  if v_doc_key is not null then
    select * into c from public.customers where tenant_id = p_tenant_id and doc_key = v_doc_key;
  end if;
  if c.id is null and v_phone_key is not null and length(v_phone_key) >= 7 then
    select * into c from public.customers where tenant_id = p_tenant_id and phone_key = v_phone_key
    order by created_at limit 1;
  end if;
  if c.id is not null then
    -- Completa lo que la ficha no tenía, sin pisar lo que ya tiene.
    if (c.doc is null and v_doc is not null and length(v_doc) between 3 and 30)
       or (c.phone is null and v_phone is not null and length(v_phone) between 7 and 30) then
      update public.customers
      set doc = coalesce(doc, case when length(v_doc) between 3 and 30 then v_doc end),
          phone = coalesce(phone, case when length(v_phone) between 7 and 30 then v_phone end)
      where id = c.id
      returning * into c;
    end if;
    return c;
  end if;
  if v_name is null or (v_doc_key is null and v_phone_key is null) then
    return null;
  end if;
  insert into public.customers (tenant_id, name, doc, phone, email)
  values (p_tenant_id, left(v_name, 120),
          case when length(v_doc) between 3 and 30 then v_doc end,
          case when length(v_phone) between 7 and 30 then v_phone end,
          case when trim(p_customer ->> 'email') ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then trim(p_customer ->> 'email') end)
  returning * into c;
  return c;
end;
$$;
revoke all on function app.resolve_customer(uuid, jsonb) from public;

-- register_sale: igual que en 20261023000000_pos_offline.sql, con el cliente
-- resuelto y guardado en la venta.
create or replace function app.register_sale(
  p_idempotency_key text,
  p_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_cart_discount numeric default 0,
  p_change jsonb default null,
  p_customer jsonb default null,
  p_note text default null,
  p_sold_at timestamptz default null
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
  v_at timestamptz := now();
  v_customer public.customers;
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

  -- Venta hecha sin conexión: vale la hora en que se cobró (tasa de ese
  -- momento), dentro de la sesión y nunca en el futuro.
  if p_sold_at is not null then
    if p_sold_at > now() + interval '5 minutes' then
      raise exception 'La hora de la venta está en el futuro' using errcode = 'check_violation';
    end if;
    if p_sold_at < s.opened_at - interval '1 minute' then
      raise exception 'La venta es anterior a la apertura de la caja' using errcode = 'check_violation';
    end if;
    v_at := least(p_sold_at, now());
  end if;
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
    select r.rate, r.source, r.effective_date into v_rate, v_rate_source, v_rate_date from app.rate_at(t.id, v_at) r limit 1;
  end if;

  -- Cliente de la ficha: el elegido, o el que coincide por cédula/RIF o
  -- teléfono, o uno nuevo si trae con qué identificarlo.
  v_customer := app.resolve_customer(t.id, p_customer);
  v_number := 'V-' || lpad(app.next_number(t.id, 'sale')::text, 6, '0');
  insert into public.sales (
    tenant_id, number, location_id, register_id, session_id, base_currency, local_currency,
    rate, rate_source, rate_effective_date, prices_include_tax,
    subtotal, discount_total, tax_total, total, paid_total, units,
    customer_id, customer_name, customer_doc, note, idempotency_key, sold_at, captured_offline
  ) values (
    t.id, v_number, s.location_id, s.register_id, s.id, t.base_currency, t.local_currency,
    v_rate, v_rate_source, v_rate_date, t.prices_include_tax,
    0, 0, 0, 0, 0, 0,
    v_customer.id, coalesce(nullif(trim(p_customer ->> 'name'), ''), v_customer.name),
    coalesce(nullif(trim(p_customer ->> 'doc'), ''), v_customer.doc),
    nullif(trim(p_note), ''), p_idempotency_key, v_at, p_sold_at is not null
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

-- Búsqueda de clientes con su historial resumido.
create or replace function app.customers_overview(p_query text default null, p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(lower(trim(p_query)), '') as q,
           nullif(upper(regexp_replace(coalesce(p_query, ''), '[^A-Za-z0-9]', '', 'g')), '') as k
  ),
  x as (
    select c.id, c.name, c.doc, c.phone, c.email, c.address, c.notes, c.created_at,
           count(s.id) filter (where s.status = 'completed') as purchases,
           coalesce(sum(s.total) filter (where s.status = 'completed'), 0) as total,
           max(s.sold_at) filter (where s.status = 'completed') as last_purchase
    from public.customers c
    cross join q
    left join public.sales s on s.tenant_id = c.tenant_id and s.customer_id = c.id
    where c.tenant_id = app.current_tenant_id()
      and (q.q is null or lower(c.name) like '%' || q.q || '%' or lower(coalesce(c.email, '')) like '%' || q.q || '%'
           or (q.k is not null and (c.doc_key like '%' || q.k || '%' or c.phone_key like '%' || q.k || '%')))
    group by c.id
    order by max(s.sold_at) desc nulls last, c.name
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_purchase desc nulls last, x.name), '[]'::jsonb) from x
$$;
revoke all on function app.customers_overview(text, integer) from public;
grant execute on function app.customers_overview(text, integer) to authenticated;

create function public.customers_overview(p_query text default null, p_limit integer default 200)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.customers_overview(p_query, p_limit) $$;
revoke all on function public.customers_overview(text, integer) from public, anon;
grant execute on function public.customers_overview(text, integer) to authenticated;

-- Ventas ya hechas con documento: una ficha por documento, con el nombre más reciente.
insert into public.customers (tenant_id, name, doc, created_by, created_at)
select distinct on (s.tenant_id, upper(regexp_replace(s.customer_doc, '[^A-Za-z0-9]', '', 'g')))
       s.tenant_id, left(coalesce(s.customer_name, s.customer_doc), 120), trim(s.customer_doc), s.sold_by, s.sold_at
from public.sales s
where nullif(upper(regexp_replace(coalesce(s.customer_doc, ''), '[^A-Za-z0-9]', '', 'g')), '') is not null
  and length(trim(s.customer_doc)) between 3 and 30
order by s.tenant_id, upper(regexp_replace(s.customer_doc, '[^A-Za-z0-9]', '', 'g')), s.sold_at desc
on conflict do nothing;
update public.sales s set customer_id = c.id
from public.customers c
where c.tenant_id = s.tenant_id
  and c.doc_key = nullif(upper(regexp_replace(coalesce(s.customer_doc, ''), '[^A-Za-z0-9]', '', 'g')), '')
  and s.customer_id is null;

-- Negocio demo: clientes fijos (misma cédula y teléfono) que vuelven a comprar,
-- también al contado. Igual que en 20261106000000_demo_tenant.sql salvo eso.
create or replace function app.seed_demo_tenant(p_tenant_id uuid, p_days integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_owner uuid;
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_start date;
  v_pass integer;
  v_left integer;
  v_table text;
  -- Sedes, cajas y cuentas
  v_cab uuid;
  v_bqt uuid;
  v_reg_cab uuid;
  v_reg_bqt uuid;
  v_acc_banesco uuid;
  v_acc_mercantil uuid;
  v_acc_zelle uuid;
  v_acc_cash_usd uuid;
  v_acc_cash_ves uuid;
  v_pm_cash_usd uuid;
  v_pm_cash_ves uuid;
  v_pm_mobile uuid;
  v_pm_card uuid;
  v_pm_zelle uuid;
  v_pm_cashea uuid;
  v_attr_vehicle uuid;
  -- Bucles
  d date;
  k integer;
  i integer;
  n integer;
  v_loc uuid;
  v_reg uuid;
  v_session uuid;
  v_rate numeric;
  v_final_rate numeric;
  v_times timestamptz[];
  v_at timestamptz;
  v_items jsonb;
  v_total numeric;
  v_payments jsonb;
  v_customer jsonb;
  v_r numeric;
  v_sale jsonb;
  v_rec public.receivables;
  v_counted jsonb;
  v_ref integer := 104230;
  x record;
  v_customers text[] := array[
    'María Pérez', 'José Rodríguez', 'Carlos Mendoza', 'Ana Torres', 'Luis Gutiérrez', 'Yolimar Suárez',
    'Pedro Álvarez', 'Andreína Colmenárez', 'Jesús Escalona', 'Taller El Rápido', 'Taller Hermanos Giménez',
    'Daniela Mújica', 'Rafael Piña', 'Oriana Castillo', 'Transporte Los Cardones'];
  v_vehicles text[] := array[
    'Toyota Corolla 1.8 2009-2014', 'Toyota Hilux 2.7 2006-2015', 'Toyota Fortuner 2.7 2008-2015',
    'Chevrolet Aveo 1.6 2005-2012', 'Chevrolet Optra 1.8 2006-2011', 'Ford Fiesta 1.6 2004-2011',
    'Mitsubishi Lancer 2.0 2008-2014'];
  v_lines jsonb := '[]'::jsonb;
  v_row integer := 1;
  v_balance numeric;
  v_sales integer;
begin
  select * into t from public.tenants where id = p_tenant_id for update;
  if not found or not t.is_demo then
    raise exception 'Solo se siembra un negocio marcado como demo' using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days not between 7 and 120 then
    raise exception 'Entre 7 y 120 días' using errcode = 'check_violation';
  end if;
  select m.user_id into v_owner from public.tenant_members m
  where m.tenant_id = t.id and m.role = 'owner' order by m.created_at limit 1;
  if v_owner is null then
    raise exception 'El negocio demo necesita un dueño' using errcode = 'check_violation';
  end if;
  v_start := v_today - p_days;
  perform setseed(0.4242);  -- mismos datos en cada siembra

  -- -------------------------------------------------------------------------
  -- Borrar todo lo del negocio menos el equipo y el plan. Varias pasadas: el
  -- orden de las llaves foráneas se resuelve solo; el único ciclo
  -- (movimiento ↔ cuota de obligación) se corta antes.
  -- -------------------------------------------------------------------------
  update public.finance_movements set obligation_instance_id = null where tenant_id = t.id and obligation_instance_id is not null;
  for v_pass in 1..15 loop
    v_left := 0;
    for v_table in
      select c.table_name::text
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and tb.table_type = 'BASE TABLE'
        and c.table_name not in ('tenants', 'tenant_members', 'tenant_entitlements')
    loop
      begin
        execute format('delete from public.%I where tenant_id = $1', v_table) using t.id;
      exception when foreign_key_violation then
        v_left := v_left + 1;
      end;
    end loop;
    exit when v_left = 0;
  end loop;
  if v_left > 0 then
    raise exception 'No se pudo vaciar el negocio demo' using errcode = 'check_violation';
  end if;

  update public.tenants
  set base_currency = 'USD', local_currency = 'VES', rate_source = 'manual', prices_include_tax = true,
      is_special_taxpayer = false, status = 'active'
  where id = t.id;
  perform app.seed_tenant_defaults(t.id);
  perform app.seed_finance_catalog(t.id);
  insert into public.tenant_entitlements (tenant_id, key, value) values
    (t.id, 'max_locations', '2'), (t.id, 'max_registers', '3')
  on conflict (tenant_id, key) do update set value = excluded.value, expires_at = null;

  -- Las funciones de la app leen el usuario y el negocio de la petición.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-tenant-id', t.id)::text, true);

  -- -------------------------------------------------------------------------
  -- Tasa propia diaria: sube hasta la tasa BCV vigente (o 880 sin datos).
  -- -------------------------------------------------------------------------
  v_final_rate := coalesce(
    (select e.rate from public.exchange_rates e where e.base_currency = 'USD' and e.quote_currency = 'VES'
     order by e.effective_date desc, (e.source = 'bcv') desc limit 1), 880);
  for k in 0..p_days + 1 loop
    d := v_start - 1 + k;
    insert into public.tenant_rates (tenant_id, base_currency, quote_currency, rate, note, set_by, created_at)
    values (t.id, 'USD', 'VES', round(v_final_rate * power(0.88, (p_days + 1 - k)::numeric / (p_days + 1)), 4),
            'Tasa del día', v_owner, (d::timestamp + interval '7 hours') at time zone 'America/Caracas');
  end loop;

  -- -------------------------------------------------------------------------
  -- Sedes, cajas, cuentas y métodos de pago
  -- -------------------------------------------------------------------------
  insert into public.locations (tenant_id, name, code, type) values (t.id, 'Tienda Cabudare', 'CAB', 'store') returning id into v_cab;
  insert into public.locations (tenant_id, name, code, type) values (t.id, 'Tienda Barquisimeto', 'BQT', 'store') returning id into v_bqt;
  insert into public.registers (tenant_id, location_id, name, code) values (t.id, v_cab, 'Caja Cabudare', 'C1') returning id into v_reg_cab;
  insert into public.registers (tenant_id, location_id, name, code) values (t.id, v_bqt, 'Caja Barquisimeto', 'C2') returning id into v_reg_bqt;

  insert into public.finance_accounts (tenant_id, name, kind, currency, institution, number_hint, opening_balance, opening_date, position) values
    (t.id, 'Banesco Bs', 'bank', 'VES', 'Banesco', '4417', 180000, v_start - 1, 1) returning id into v_acc_banesco;
  insert into public.finance_accounts (tenant_id, name, kind, currency, institution, number_hint, opening_balance, opening_date, position) values
    (t.id, 'Mercantil Bs', 'bank', 'VES', 'Mercantil', '0921', 60000, v_start - 1, 2) returning id into v_acc_mercantil;
  insert into public.finance_accounts (tenant_id, name, kind, currency, institution, opening_balance, opening_date, position) values
    (t.id, 'Zelle', 'wallet', 'USD', 'Bank of America', 9000, v_start - 1, 3) returning id into v_acc_zelle;
  insert into public.finance_accounts (tenant_id, name, kind, currency, opening_balance, opening_date, position) values
    (t.id, 'Caja fuerte USD', 'cash', 'USD', 300, v_start - 1, 4) returning id into v_acc_cash_usd;
  insert into public.finance_accounts (tenant_id, name, kind, currency, opening_balance, opening_date, position) values
    (t.id, 'Caja fuerte Bs', 'cash', 'VES', 15000, v_start - 1, 5) returning id into v_acc_cash_ves;

  select id into v_pm_cash_usd from public.payment_methods where tenant_id = t.id and code = 'cash_base';
  select id into v_pm_cash_ves from public.payment_methods where tenant_id = t.id and code = 'cash_local';
  select id into v_pm_mobile from public.payment_methods where tenant_id = t.id and code = 'mobile_payment';
  select id into v_pm_card from public.payment_methods where tenant_id = t.id and code = 'card';
  select id into v_pm_zelle from public.payment_methods where tenant_id = t.id and code = 'zelle';
  select id into v_pm_cashea from public.payment_methods where tenant_id = t.id and code = 'cashea';
  update public.payment_methods set account_id = case code
      when 'cash_base' then v_acc_cash_usd when 'cash_local' then v_acc_cash_ves
      when 'mobile_payment' then v_acc_banesco when 'transfer' then v_acc_banesco
      when 'card' then v_acc_mercantil when 'zelle' then v_acc_zelle end,
    banks = case when code in ('mobile_payment', 'transfer') then array['Banesco'] else banks end
  where tenant_id = t.id and code <> 'cashea';

  -- -------------------------------------------------------------------------
  -- Catálogo de repuestos: plantilla × vehículo × marca. Las marcas de un
  -- mismo repuesto y vehículo quedan como equivalentes.
  -- -------------------------------------------------------------------------
  insert into public.attribute_defs (tenant_id, key, label, type, choices, searchable, multi, position)
  values (t.id, 'vehiculo', 'Vehículo compatible', 'list', v_vehicles, true, true, 1)
  returning id into v_attr_vehicle;

  drop table if exists pg_temp.demo_catalog;
  create temp table demo_catalog (
    variant_id uuid, product_id uuid, template text, vehicle text, price numeric, cost numeric, weight numeric, pack integer
  ) on commit drop;

  for x in
    select tp.*, v.vehicle, v.vn, b.brand, b.bn
    from (values
      ('Filtro de aceite', 'Filtros', array['Wix', 'Toyota'], 9.0, 0.55, 10, 1, true),
      ('Filtro de aire', 'Filtros', array['Wix', 'Mann'], 16.0, 0.55, 5, 1, true),
      ('Filtro de gasolina', 'Filtros', array['Bosch'], 12.0, 0.55, 3, 1, true),
      ('Pastillas de freno delanteras', 'Frenos', array['Bosch', 'Toyota'], 34.0, 0.58, 5, 1, true),
      ('Bandas de freno traseras', 'Frenos', array['Bosch'], 28.0, 0.58, 2, 1, true),
      ('Disco de freno delantero', 'Frenos', array['Brembo'], 58.0, 0.6, 1.5, 1, true),
      ('Bujía de iridio', 'Encendido', array['NGK', 'Denso'], 11.0, 0.5, 6, 4, true),
      ('Bobina de encendido', 'Encendido', array['Denso'], 62.0, 0.6, 1, 1, true),
      ('Kit de correa de tiempo', 'Correas', array['Gates'], 85.0, 0.6, 1, 1, true),
      ('Correa de accesorios', 'Correas', array['Gates', 'Dayco'], 19.0, 0.55, 2.5, 1, true),
      ('Amortiguador delantero', 'Suspensión', array['Monroe', 'KYB'], 74.0, 0.6, 1.2, 2, true),
      ('Terminal de dirección', 'Suspensión', array['Moog'], 18.0, 0.55, 2, 1, true),
      ('Meseta inferior', 'Suspensión', array['Moog'], 44.0, 0.58, 1, 1, true),
      ('Bomba de agua', 'Refrigeración', array['Aisin'], 52.0, 0.6, 1, 1, true),
      ('Aceite 15W-40 mineral 1 L', 'Lubricantes', array['Castrol', 'Mobil'], 7.5, 0.6, 9, 4, false),
      ('Aceite 5W-30 sintético 1 L', 'Lubricantes', array['Castrol', 'Mobil'], 11.5, 0.6, 5, 4, false),
      ('Refrigerante verde 1 gal', 'Lubricantes', array['Prestone'], 14.0, 0.55, 3, 1, false),
      ('Líquido de frenos DOT 4', 'Lubricantes', array['Bosch'], 8.0, 0.55, 2, 1, false),
      ('Batería 12V 800 A', 'Eléctrico', array['Duncan'], 125.0, 0.7, 0.8, 1, false),
      ('Bombillo H4 60/55 W', 'Eléctrico', array['Philips'], 6.0, 0.5, 3, 2, false)
    ) as tp(name, category, brands, price, cost_ratio, weight, pack, by_vehicle)
    -- Cada repuesto por vehículo se ofrece para 4 de los 7 vehículos.
    cross join lateral (
      select vv.vehicle, vv.vn from unnest(v_vehicles) with ordinality as vv(vehicle, vn)
      where tp.by_vehicle and (vv.vn + length(tp.name)) % 7 < 4
      union all
      select null, 0 where not tp.by_vehicle
    ) v
    cross join lateral unnest(tp.brands) with ordinality as b(brand, bn)
  loop
    insert into public.products (tenant_id, name, brand, category, created_by)
    values (t.id, x.name || coalesce(' ' || split_part(x.vehicle, ' ', 2), '') || ' ' || x.brand, x.brand, x.category, v_owner)
    returning id into v_session;  -- id del producto (reuso de variable)
    v_r := round((x.price * (0.9 + x.bn * 0.12 + (x.vn % 3) * 0.04))::numeric, 2);
    insert into public.variants (tenant_id, product_id, sku, regular_price, price, cost)
    values (t.id, v_session, upper(left(x.brand, 3)) || '-' || lpad((1000 + v_row)::text, 5, '0'), v_r, v_r, round(v_r * x.cost_ratio, 2))
    returning id into v_reg;  -- id de la variante (reuso de variable)
    insert into public.product_codes (tenant_id, variant_id, kind, code) values
      (t.id, v_reg, 'barcode', '759' || lpad((910000000 + v_row * 7919)::text, 10, '0')),
      (t.id, v_reg, 'parte', upper(left(x.brand, 2)) || (40000 + v_row * 37)::text || '-' || (10 + v_row % 89)::text);
    if x.vehicle is not null then
      insert into public.product_attribute_values (tenant_id, product_id, attribute_id, value) values (t.id, v_session, v_attr_vehicle, x.vehicle);
    end if;
    insert into pg_temp.demo_catalog values (v_reg, v_session, x.name, x.vehicle, v_r, round(v_r * x.cost_ratio, 2), x.weight, x.pack);
    v_row := v_row + 1;
  end loop;

  insert into public.product_relations (tenant_id, product_id, related_product_id, kind)
  select t.id, a.product_id, b.product_id, 'substitute'
  from pg_temp.demo_catalog a
  join pg_temp.demo_catalog b on b.template = a.template and b.vehicle is not distinct from a.vehicle and b.product_id <> a.product_id;

  -- Inventario inicial (con proveedor y costo) y reposición a mitad de periodo.
  for x in select * from pg_temp.demo_catalog loop
    perform app.inventory_entry(x.variant_id, v_cab, greatest(ceil(x.weight * x.pack * 9 + random()::numeric * 8), 4), x.cost,
                                'Distribuidora Lara Repuestos', 'Inventario inicial', null::numeric);
    if random()::numeric < 0.75 then
      perform app.inventory_entry(x.variant_id, v_bqt, greatest(ceil(x.weight * x.pack * 4 + random()::numeric * 4), 3), x.cost,
                                  'Distribuidora Lara Repuestos', 'Inventario inicial', null::numeric);
    end if;
  end loop;
  update public.inventory_movements set created_at = ((v_start - 1)::timestamp + interval '10 hours') at time zone 'America/Caracas'
  where tenant_id = t.id;

  -- -------------------------------------------------------------------------
  -- Ventas: cada día hábil una sesión por tienda, de 08:30 a 18:00.
  -- -------------------------------------------------------------------------
  for k in 0..p_days - 1 loop
    d := v_start + k;
    continue when extract(dow from d) = 0;  -- domingo cerrado

    if k % 15 = 14 then  -- reposición quincenal de lo que está bajo
      for x in select c.*, s.location_id from pg_temp.demo_catalog c join public.stocks s on s.variant_id = c.variant_id
               where s.on_hand < c.weight * c.pack * 3 and random()::numeric < 0.85 loop
        perform app.inventory_entry(x.variant_id, x.location_id, ceil(x.weight * x.pack * (case when x.location_id = v_cab then 6 else 3 end)),
                                    x.cost, 'Distribuidora Lara Repuestos', 'Reposición', null::numeric);
      end loop;
      update public.inventory_movements set created_at = (d::timestamp + interval '8 hours') at time zone 'America/Caracas'
      where tenant_id = t.id and note = 'Reposición' and created_at > now() - interval '1 hour';
    end if;

    foreach v_loc in array array[v_cab, v_bqt] loop
      v_reg := case when v_loc = v_cab then v_reg_cab else v_reg_bqt end;
      v_session := (app.open_cash_session(v_reg, '[{"currency":"USD","amount":20},{"currency":"VES","amount":3000}]'::jsonb, null) ->> 'session_id')::uuid;
      update public.cash_sessions set opened_at = (d::timestamp + interval '8 hours 30 minutes') at time zone 'America/Caracas' where id = v_session;

      n := case when v_loc = v_cab then 6 + floor(random()::numeric * 7)::int else 3 + floor(random()::numeric * 5)::int end;
      if extract(dow from d) = 6 then n := n + 3; end if;  -- sábado
      n := round(n * (0.8 + 0.45 * k / p_days));  -- el negocio crece en el periodo
      select array_agg(ts order by ts) into v_times
      from (select (d::timestamp + interval '9 hours' + random() * interval '8 hours 45 minutes') at time zone 'America/Caracas' as ts
            from generate_series(1, n)) z;

      foreach v_at in array v_times loop
        -- 1 a 3 renglones, elegidos por popularidad entre lo que hay en la tienda.
        select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'qty', qty)), sum(price * qty)
        into v_items, v_total
        from (
          select c.variant_id, c.price, least(c.pack * (1 + floor(random()::numeric * 1.4)::int), floor(s.on_hand)::int) as qty
          from pg_temp.demo_catalog c
          join public.stocks s on s.variant_id = c.variant_id and s.location_id = v_loc and s.on_hand >= 1
          order by -ln(random()::numeric + 0.000001) / c.weight  -- muestreo ponderado por popularidad
          limit 1 + floor(random()::numeric * 2.6)::int
        ) z where qty >= 1;
        continue when v_items is null;

        v_rate := (select r.rate from app.rate_at(t.id, v_at) r);
        v_r := random()::numeric;
        v_customer := null;
        v_ref := v_ref + 1 + floor(random()::numeric * 40)::int;
        if v_r < 0.28 then
          v_payments := jsonb_build_array(jsonb_build_object('payment_method_id', v_pm_cash_usd, 'amount', v_total));
          if random()::numeric < 0.3 then
            i := 1 + floor(random()::numeric * array_length(v_customers, 1))::int;
            v_customer := jsonb_build_object('name', v_customers[i],
                                             'doc', case when v_customers[i] like 'T%' then 'J-' || (40100000 + i * 7919) || '-' || (i % 9)
                                                         else 'V-' || (12000000 + i * 1046527) end,
                                             'phone', '04' || (case i % 3 when 0 then '14' when 1 then '24' else '12' end) || '-' || (5100000 + i * 37171));
          end if;
        elsif v_r < 0.55 then
          v_payments := jsonb_build_array(jsonb_build_object('payment_method_id', v_pm_mobile, 'amount', round(v_total * v_rate, 2),
                                                             'bank', 'Banesco', 'reference', v_ref::text));
        elsif v_r < 0.70 then
          v_payments := jsonb_build_array(jsonb_build_object('payment_method_id', v_pm_card, 'amount', round(v_total * v_rate, 2),
                                                             'reference', v_ref::text));
        elsif v_r < 0.80 then
          v_payments := jsonb_build_array(jsonb_build_object('payment_method_id', v_pm_zelle, 'amount', v_total, 'reference', 'Z' || v_ref));
        elsif v_r < 0.86 then
          v_payments := jsonb_build_array(jsonb_build_object('payment_method_id', v_pm_cash_ves, 'amount', round(v_total * v_rate, 2)));
        elsif v_r < 0.93 or v_total < 40 then
          -- Mixto: parte en dólares, el resto por pago móvil.
          v_payments := jsonb_build_array(
            jsonb_build_object('payment_method_id', v_pm_cash_usd, 'amount', floor(v_total / 2)),
            jsonb_build_object('payment_method_id', v_pm_mobile, 'amount', round((v_total - floor(v_total / 2)) * v_rate, 2),
                               'bank', 'Banesco', 'reference', v_ref::text));
        else
          -- Cashea: inicial en dólares, el resto en cuotas.
          -- Clientes fijos (misma cédula y teléfono) que vuelven a comprar.
          i := 1 + floor(random()::numeric * array_length(v_customers, 1))::int;
          v_customer := jsonb_build_object('name', v_customers[i],
                                           'doc', case when v_customers[i] like 'T%' then 'J-' || (40100000 + i * 7919) || '-' || (i % 9)
                                                       else 'V-' || (12000000 + i * 1046527) end,
                                           'phone', '04' || (case i % 3 when 0 then '14' when 1 then '24' else '12' end) || '-' || (5100000 + i * 37171));
          v_payments := jsonb_build_array(
            jsonb_build_object('payment_method_id', v_pm_cash_usd, 'amount', round(v_total * 0.4, 2)),
            jsonb_build_object('payment_method_id', v_pm_cashea, 'amount', v_total - round(v_total * 0.4, 2), 'reference', (880000 + v_ref)::text));
        end if;

        v_sale := app.register_sale('demo-' || md5(t.id::text || v_at::text || v_loc::text), v_session, v_items, v_payments, 0, null, v_customer, null, v_at);

        -- Cashea cobra en 3 cuotas quincenales.
        select * into v_rec from public.receivables where sale_id = (v_sale ->> 'sale_id')::uuid;
        if v_rec.id is not null then
          delete from public.receivable_installments where receivable_id = v_rec.id;
          perform app.receivable_set_installments(v_rec, jsonb_build_array(
            jsonb_build_object('due_date', d + 14, 'amount', round(v_rec.amount / 3, 2)),
            jsonb_build_object('due_date', d + 28, 'amount', round(v_rec.amount / 3, 2)),
            jsonb_build_object('due_date', d + 42, 'amount', v_rec.amount - 2 * round(v_rec.amount / 3, 2))));
          update public.receivables set commission_rate = 5 where id = v_rec.id;
        end if;
      end loop;

      -- Cierre: se cuenta lo esperado (a veces falta un dólar).
      select jsonb_agg(jsonb_build_object('currency', c.currency,
               'amount', (select coalesce(sum(m.amount), 0) from public.cash_movements m where m.session_id = v_session and m.currency = c.currency)
                         - case when c.currency = 'USD' and random()::numeric < 0.08 then 1 else 0 end))
      into v_counted
      from public.cash_counts c where c.session_id = v_session;
      perform app.close_cash_session(v_session, v_counted, null);
      update public.cash_sessions set closed_at = (d::timestamp + interval '18 hours') at time zone 'America/Caracas' where id = v_session;
      update public.finance_movements set occurred_on = d where cash_session_id = v_session;
    end loop;
  end loop;

  -- La app fecha con now() lo que hace en el momento: se lleva a la hora de la
  -- venta. Y p_sold_at marca la venta como cobrada sin conexión, que aquí no es.
  update public.sales set captured_offline = false where tenant_id = t.id;
  update public.inventory_movements m set created_at = s.sold_at
  from public.sales s where s.tenant_id = t.id and m.tenant_id = t.id and m.kind = 'sale' and m.note = 'Venta ' || s.number;
  update public.cash_movements m set created_at = cs.opened_at
  from public.cash_sessions cs where m.session_id = cs.id and cs.tenant_id = t.id and m.sale_id is null;
  update public.cash_movements m set created_at = s.sold_at from public.sales s where m.sale_id = s.id and s.tenant_id = t.id;

  -- Caja de hoy abierta en Cabudare con dos ventas; una se anuló (solo se
  -- anula con la caja abierta).
  v_session := (app.open_cash_session(v_reg_cab, '[{"currency":"USD","amount":20},{"currency":"VES","amount":3000}]'::jsonb, null) ->> 'session_id')::uuid;
  for k in 1..2 loop
    select c.variant_id, c.price * c.pack into v_reg, v_total
    from pg_temp.demo_catalog c join public.stocks s on s.variant_id = c.variant_id and s.location_id = v_cab and s.on_hand >= c.pack
    order by c.weight desc offset k limit 1;
    v_sale := app.register_sale('demo-hoy-' || k || '-' || md5(t.id::text), v_session,
                                jsonb_build_array(jsonb_build_object('variant_id', v_reg, 'qty', (select pack from pg_temp.demo_catalog where variant_id = v_reg))),
                                jsonb_build_array(jsonb_build_object('payment_method_id', v_pm_cash_usd, 'amount', v_total)));
  end loop;
  perform app.void_sale((v_sale ->> 'sale_id')::uuid, 'El cliente trajo el repuesto equivocado del vehículo');

  -- -------------------------------------------------------------------------
  -- Cashea: los clientes pagan sus cuotas por pago móvil a Banesco. Se cobra
  -- casi todo lo vencido; algunas cuotas quedan atrasadas.
  -- -------------------------------------------------------------------------
  for x in
    select i.*, r.customer_name from public.receivable_installments i join public.receivables r on r.id = i.receivable_id
    where r.tenant_id = t.id and r.status = 'open' and i.due_date < v_today - 1 order by i.due_date
  loop
    continue when random()::numeric < 0.18;
    v_rate := app.rate_on_day(t.id, x.due_date);
    v_ref := v_ref + 1 + floor(random()::numeric * 40)::int;
    perform app.collect_receivable(x.receivable_id, v_acc_banesco, round(x.amount * v_rate, 2), x.due_date, 'customer', x.amount,
                                   v_ref::text, 'Cuota ' || x.number || ' · ' || x.customer_name);
  end loop;

  -- -------------------------------------------------------------------------
  -- Gastos: obligaciones fijas pagadas por Zelle y compras al proveedor.
  -- -------------------------------------------------------------------------
  insert into public.obligations (tenant_id, name, category, counterparty, amount, currency, frequency, start_date, account_id) values
    (t.id, 'Alquiler tienda Cabudare', 'Alquiler', 'Inversiones Las Mercedes', 450, 'USD', 'monthly', date_trunc('month', v_start)::date + 4, v_acc_zelle),
    (t.id, 'Alquiler tienda Barquisimeto', 'Alquiler', 'Centro Comercial Babilon', 380, 'USD', 'monthly', date_trunc('month', v_start)::date + 4, v_acc_zelle),
    (t.id, 'Nómina', 'Nómina', 'Personal', 1100, 'USD', 'biweekly', v_start + 3, v_acc_zelle),
    (t.id, 'Internet y teléfono', 'Servicios', 'Inter', 45, 'USD', 'monthly', date_trunc('month', v_start)::date + 9, v_acc_zelle),
    (t.id, 'Contador', 'Servicios', 'Escritorio contable Méndez', 80, 'USD', 'monthly', date_trunc('month', v_start)::date + 14, v_acc_zelle),
    (t.id, 'Patente municipal', 'Impuestos', 'Alcaldía de Palavecino', 120, 'USD', 'quarterly', date_trunc('month', v_start)::date + 19, v_acc_zelle);
  perform app.refresh_obligations();
  for x in
    select i.* from public.obligation_instances i join public.obligations o on o.id = i.obligation_id
    where i.tenant_id = t.id and i.status = 'pending' and i.due_date < v_today - 2 and o.name <> 'Internet y teléfono'
       or i.tenant_id = t.id and i.status = 'pending' and i.due_date < v_today - 35 and o.name = 'Internet y teléfono'
  loop
    perform app.pay_obligation(x.id, v_acc_zelle, x.amount, x.due_date, null, null, null, false);
  end loop;

  -- Compras semanales al proveedor: se repone con ~80 % de lo que entró a
  -- cada cuenta en la semana (Zelle queda para nómina y alquileres).
  for k in 0..p_days / 7 loop
    d := v_start + k * 7 + 6;
    continue when d >= v_today;
    for x in
      select m.account_id, m.currency, sum(m.amount) as inflow
      from public.finance_movements m
      where m.tenant_id = t.id and m.direction = 'in' and m.voided_at is null and m.account_id <> v_acc_zelle
        and m.occurred_on between d - 6 and d
      group by m.account_id, m.currency
    loop
      v_ref := v_ref + 17;
      insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note, created_by)
      values (t.id, x.account_id, 'out', 'manual', round(x.inflow * (0.75 + random()::numeric * 0.1), 2), x.currency, d, 'Proveedores',
              'Distribuidora Lara Repuestos', v_ref::text, 'Compra de mercancía', v_owner);
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- Estado de cuenta de Banesco de los últimos 10 días: lo que entró y salió
  -- por la cuenta, comisiones del banco y dos entradas por identificar (una
  -- es la cuota de un cliente de Cashea).
  -- -------------------------------------------------------------------------
  insert into public.bank_fee_rules (tenant_id, account_id, phrase, match, fee_type)
  values (t.id, v_acc_banesco, 'COM. PAGO MOVIL', 'starts', 'Pago móvil');

  v_row := 2;
  for x in
    select m.occurred_on, m.direction, m.amount, m.reference,
           case m.kind when 'sale' then 'PAGO MOVIL RECIBIDO ' || coalesce(m.reference, '')
                       when 'receivable' then 'PAGO MOVIL RECIBIDO ' || coalesce(m.reference, '')
                       else 'TRANSF A 0134 DIST LARA REPUESTOS' end as description
    from public.finance_movements m
    where m.tenant_id = t.id and m.account_id = v_acc_banesco and m.voided_at is null and m.occurred_on >= v_today - 10
    order by m.occurred_on, m.created_at
  loop
    v_lines := v_lines || jsonb_build_object('row', v_row, 'date', x.occurred_on, 'direction', x.direction, 'amount', x.amount,
                                             'reference', x.reference, 'description', x.description);
    v_row := v_row + 1;
    if x.direction = 'in' and x.description like 'PAGO MOVIL%' then
      v_lines := v_lines || jsonb_build_object('row', v_row, 'date', x.occurred_on, 'direction', 'out', 'amount', round(x.amount * 0.003, 2),
                                               'reference', x.reference, 'description', 'COM. PAGO MOVIL ' || x.reference);
      v_row := v_row + 1;
    end if;
  end loop;
  -- Cuota atrasada pagada ayer y todavía sin registrar.
  select i.*, r.customer_name into x
  from public.receivable_installments i join public.receivables r on r.id = i.receivable_id
  where r.tenant_id = t.id and r.status = 'open' and i.due_date < v_today - 1 and i.amount - i.collected - i.covered > 0.005
  order by i.due_date limit 1;
  if x.id is not null then
    v_lines := v_lines || jsonb_build_object('row', v_row, 'date', v_today - 1, 'direction', 'in',
                                             'amount', round((x.amount - x.collected - x.covered) * app.rate_on_day(t.id, v_today - 1), 2),
                                             'reference', '7711' || v_row, 'description', 'PAGO MOVIL 0414 ' || upper(x.customer_name));
    v_row := v_row + 1;
  end if;
  v_lines := v_lines || jsonb_build_object('row', v_row, 'date', v_today - 2, 'direction', 'in', 'amount', 12500,
                                           'reference', '5520' || v_row, 'description', 'TRANSF RECIBIDA 0102 ');
  perform app.import_bank_statement(v_acc_banesco, null, 'banesco-ultimos-10-dias.xlsx', md5(v_lines::text), v_lines, '[]'::jsonb);

  select count(*) into v_sales from public.sales where tenant_id = t.id;
  return jsonb_build_object(
    'products', (select count(*) from public.products where tenant_id = t.id),
    'sales', v_sales,
    'receivables', (select count(*) from public.receivables where tenant_id = t.id),
    'bank_lines', (select count(*) from public.bank_statement_lines where tenant_id = t.id),
    'pending_lines', (select count(*) from public.bank_statement_lines where tenant_id = t.id and status in ('unmatched', 'possible'))
  );
end;
$$;
