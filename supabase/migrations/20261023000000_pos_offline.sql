-- POS en contingencia (sin conexión).
--
-- El navegador guarda la venta en una cola local cuando no hay red y la manda
-- al volver, con la misma clave de idempotencia. Para que valga lo que pasó en
-- caja y no lo que dice el reloj al sincronizar:
--   * register_sale acepta p_sold_at: la hora en que se cobró. La tasa es la
--     vigente a esa hora; se valida que no sea futura ni anterior a la apertura
--     de la sesión. La venta queda marcada captured_offline.
--   * pos_catalog_snapshot devuelve el catálogo de una sede (precio, impuesto,
--     disponible, códigos y texto buscable) para buscar sin conexión.
-- El stock sigue sin quedar negativo: si al sincronizar ya no alcanza, la venta
-- se rechaza y el POS la deja en "requiere atención".

alter table public.sales add column captured_offline boolean not null default false;
comment on column public.sales.captured_offline is 'Cobrada sin conexión y sincronizada después; sold_at es la hora del cobro.';

drop function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text);
drop function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text);

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

  v_number := 'V-' || lpad(app.next_number(t.id, 'sale')::text, 6, '0');
  insert into public.sales (
    tenant_id, number, location_id, register_id, session_id, base_currency, local_currency,
    rate, rate_source, rate_effective_date, prices_include_tax,
    subtotal, discount_total, tax_total, total, paid_total, units,
    customer_name, customer_doc, note, idempotency_key, sold_at, captured_offline
  ) values (
    t.id, v_number, s.location_id, s.register_id, s.id, t.base_currency, t.local_currency,
    v_rate, v_rate_source, v_rate_date, t.prices_include_tax,
    0, 0, 0, 0, 0, 0,
    nullif(trim(p_customer ->> 'name'), ''), nullif(trim(p_customer ->> 'doc'), ''),
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

revoke all on function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz) from public;
grant execute on function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz) to authenticated;

create function public.register_sale(
  p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb,
  p_cart_discount numeric default 0, p_change jsonb default null, p_customer jsonb default null, p_note text default null,
  p_sold_at timestamptz default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.register_sale(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_change, p_customer, p_note, p_sold_at)
$$;
revoke all on function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz) from public, anon;
grant execute on function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz) to authenticated;

-- Catálogo de una sede para el POS sin conexión. SECURITY INVOKER: lo filtra
-- RLS con el tenant activo, como cualquier select del cliente.
create function public.pos_catalog_snapshot(p_location_id uuid)
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  options jsonb,
  brand text,
  sku text,
  price numeric,
  unit text,
  tax_rate numeric,
  available numeric,
  codes text[],
  search text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    x.id, p.id, p.name, x.options, p.brand, x.sku,
    coalesce(x.price, x.regular_price), x.unit,
    coalesce(
      (select r.rate from public.tax_rates r where r.id = p.tax_rate_id),
      (select r.rate from public.tax_rates r where r.tenant_id = p.tenant_id and r.is_default),
      0),
    coalesce((select st.available from public.stocks st where st.variant_id = x.id and st.location_id = p_location_id), 0),
    coalesce((select array_agg(c.code order by c.code) from public.product_codes c where c.variant_id = x.id), '{}'),
    lower(concat_ws(' ',
      p.name, p.brand, p.category, x.sku,
      (select string_agg(value, ' ') from jsonb_each_text(x.options)),
      (select string_agg(av.value, ' ')
         from public.product_attribute_values av
         join public.attribute_defs d on d.id = av.attribute_id and d.searchable
        where av.product_id = p.id)))
  from public.variants x
  join public.products p on p.id = x.product_id
  where x.deleted_at is null and x.is_active and p.deleted_at is null and p.is_active
  order by p.name, x.sku
$$;
revoke all on function public.pos_catalog_snapshot(uuid) from public, anon;
grant execute on function public.pos_catalog_snapshot(uuid) to authenticated;
