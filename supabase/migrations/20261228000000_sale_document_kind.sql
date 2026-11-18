-- Venta con factura o con nota de entrega.
--
--   * tenants.allow_delivery_notes: el negocio habilita vender con nota de
--     entrega (apagado por defecto). La responsabilidad fiscal es del negocio.
--   * sales.document_kind ('invoice' | 'delivery_note'). Las ventas anteriores
--     quedan como 'invoice' (todas cobraron IVA).
--   * register_sale y register_sale_coupon reciben p_document_kind. Con nota de
--     entrega el IVA de cada línea es 0; la tasa del producto queda guardada.
--     El IGTF no cambia: depende del pago, no del documento.
--   * report_tax: solo cuenta facturas; las notas de entrega van aparte.

alter table public.tenants add column allow_delivery_notes boolean not null default false;
grant update (name, base_currency, local_currency, rate_source, is_special_taxpayer, prices_include_tax, igtf_rate,
              legal_name, tax_id, address, phone, receipt_footer, closing_reminder_time, channel_required,
              allow_delivery_notes)
  on public.tenants to authenticated;
revoke update (prices_include_tax) on public.tenants from authenticated;

alter table public.sales
  add column document_kind text not null default 'invoice' check (document_kind in ('invoice', 'delivery_note'));
create index sales_document_kind_idx on public.sales (tenant_id, document_kind, sold_at) where document_kind = 'delivery_note';

drop function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz, uuid, uuid, text, jsonb);
drop function public.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid, text, jsonb);
drop function app.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid, text, jsonb);
drop function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz, uuid, uuid, text, jsonb);

CREATE FUNCTION app.register_sale(p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb, p_cart_discount numeric DEFAULT 0, p_change jsonb DEFAULT NULL::jsonb, p_customer jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_sold_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_channel_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_fulfillment text DEFAULT NULL::text, p_delivery jsonb DEFAULT NULL::jsonb, p_document_kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_desc text;
  v_kind text;
  v_channel uuid;
  v_cashier uuid;
  v_needs_fulfillment boolean := false;
  v_fulfillment text;
  v_delivery jsonb;
  v_key text;
  v_src uuid;
  v_src_name text;
  v_item_id uuid;
  v_doc text;
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

  -- Documento: factura (con IVA) o nota de entrega (sin IVA), si el negocio la habilitó.
  v_doc := coalesce(nullif(trim(p_document_kind), ''), 'invoice');
  if v_doc not in ('invoice', 'delivery_note') then
    raise exception 'Tipo de documento no válido' using errcode = 'check_violation';
  end if;
  if v_doc = 'delivery_note' and not t.allow_delivery_notes then
    raise exception 'Este negocio no vende con nota de entrega' using errcode = 'check_violation';
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

  -- Origen de la venta: uno activo del negocio; obligatorio si el negocio lo pide.
  if p_channel_id is not null then
    select id, requires_fulfillment into v_channel, v_needs_fulfillment
    from public.sales_channels where id = p_channel_id and tenant_id = t.id and is_active;
    if v_channel is null then
      raise exception 'Origen de venta no disponible' using errcode = 'no_data_found';
    end if;
  elsif t.channel_required and exists (select 1 from public.sales_channels where tenant_id = t.id and is_active) then
    raise exception 'Elige el origen de la venta' using errcode = 'check_violation';
  end if;

  -- Modalidad de entrega: los orígenes a distancia piden retiro o envío, y el
  -- envío guarda una foto de los datos del destinatario en la venta.
  if v_needs_fulfillment then
    v_fulfillment := nullif(trim(p_fulfillment), '');
    if v_fulfillment is null then
      raise exception 'Elige si la venta es para retirar o para enviar' using errcode = 'check_violation';
    end if;
    if v_fulfillment not in ('pickup', 'envio') then
      raise exception 'Modalidad de entrega no válida' using errcode = 'check_violation';
    end if;
  elsif nullif(trim(p_fulfillment), '') is not null then
    raise exception 'Este origen no lleva modalidad de entrega' using errcode = 'check_violation';
  end if;
  if v_fulfillment = 'envio' then
    v_delivery := '{}'::jsonb;
    foreach v_key in array array['first_name', 'last_name', 'phone', 'doc', 'address', 'municipality', 'state', 'carrier']
    loop
      if nullif(trim(p_delivery ->> v_key), '') is null then
        raise exception 'Faltan datos del envío' using errcode = 'check_violation';
      end if;
      v_delivery := v_delivery || jsonb_build_object(v_key, left(trim(p_delivery ->> v_key), 300));
    end loop;
    if v_delivery ->> 'carrier' not in ('MRW', 'Zoom', 'Liberty') then
      raise exception 'Empresa de envío no válida' using errcode = 'check_violation';
    end if;
  end if;

  -- Quién atendió la caja (personal de caja de la sede o de todas).
  if p_cashier_id is not null then
    select id into v_cashier from public.cashiers
    where id = p_cashier_id and tenant_id = t.id and is_active and (location_id is null or location_id = s.location_id);
    if v_cashier is null then
      raise exception 'Cajero no disponible en esta sede' using errcode = 'no_data_found';
    end if;
  end if;

  -- Cliente de la ficha: el elegido, o el que coincide por cédula/RIF o
  -- teléfono, o uno nuevo si trae con qué identificarlo.
  v_customer := app.resolve_customer(t.id, p_customer);
  v_number := 'V-' || lpad(app.next_number(t.id, 'sale')::text, 6, '0');
  insert into public.sales (
    tenant_id, number, location_id, register_id, session_id, base_currency, local_currency,
    rate, rate_source, rate_effective_date, prices_include_tax,
    subtotal, discount_total, tax_total, total, paid_total, units,
    customer_id, customer_name, customer_doc, note, idempotency_key, sold_at, captured_offline, channel_id, cashier_id,
    fulfillment, delivery, document_kind
  ) values (
    t.id, v_number, s.location_id, s.register_id, s.id, t.base_currency, t.local_currency,
    v_rate, v_rate_source, v_rate_date, t.prices_include_tax,
    0, 0, 0, 0, 0, 0,
    v_customer.id, coalesce(nullif(trim(p_customer ->> 'name'), ''), v_customer.name),
    coalesce(nullif(trim(p_customer ->> 'doc'), ''), v_customer.doc),
    nullif(trim(p_note), ''), p_idempotency_key, v_at, p_sold_at is not null, v_channel, v_cashier,
    v_fulfillment, v_delivery, v_doc
  ) returning id into v_sale;

  -- Líneas: precio y costo salen de la base de datos.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Cantidad inválida en la línea %', v_line using errcode = 'check_violation';
    end if;
    if coalesce((v_item ->> 'manual')::boolean, false) then
      -- Concepto que no viene del inventario (mano de obra, instalación…):
      -- precio del cajero, impuesto elegido o el del negocio, sin stock.
      v_desc := left(nullif(trim(v_item ->> 'description'), ''), 120);
      v_kind := coalesce(nullif(v_item ->> 'kind', ''), 'servicio');
      if v_desc is null then
        raise exception 'Línea %: falta la descripción del concepto', v_line using errcode = 'check_violation';
      end if;
      if v_kind not in ('producto', 'servicio', 'extra') then
        raise exception 'Línea %: tipo de concepto inválido', v_line using errcode = 'check_violation';
      end if;
      v_price := round((v_item ->> 'price')::numeric, 2);
      if v_price is null or v_price <= 0 or v_price > 1000000 then
        raise exception 'Línea %: precio inválido', v_line using errcode = 'check_violation';
      end if;
      v_gross := round(v_price * v_qty, 2);
      v_line_disc := round(coalesce((v_item ->> 'discount')::numeric, 0), 2);
      if v_line_disc < 0 or v_line_disc > v_gross then
        raise exception 'Línea %: descuento inválido', v_line using errcode = 'check_violation';
      end if;
      if nullif(v_item ->> 'tax_rate_id', '') is not null then
        select x.rate into v_tax_rate from public.tax_rates x where x.id = (v_item ->> 'tax_rate_id')::uuid and x.tenant_id = t.id;
        if not found then
          raise exception 'Línea %: impuesto no encontrado', v_line using errcode = 'no_data_found';
        end if;
      else
        select coalesce((select x.rate from public.tax_rates x where x.tenant_id = t.id and x.is_default), 0) into v_tax_rate;
      end if;
      insert into public.sale_items (
        tenant_id, sale_id, line, variant_id, product_id, description, sku, qty, unit_price, gross,
        discount, tax_rate, tax_amount, line_total, unit_cost, manual_kind
      ) values (
        t.id, v_sale, v_line, null, null, v_desc, null, v_qty, v_price, v_gross, v_line_disc, v_tax_rate, 0, 0, null, v_kind
      );
    else
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

      -- Encargo: sale de la existencia de un aliado (sede externa) en vez de la
      -- de la caja, y queda pendiente pagarle el costo.
      v_src := s.location_id;
      v_src_name := null;
      if nullif(v_item ->> 'from_location_id', '') is not null then
        v_src := null;
        select l.id, l.name into v_src, v_src_name from public.locations l
        where l.id = (v_item ->> 'from_location_id')::uuid and l.tenant_id = t.id
          and l.type = 'external' and l.is_active and l.deleted_at is null;
        if v_src is null then
          raise exception 'Línea %: aliado no disponible', v_line using errcode = 'no_data_found';
        end if;
      end if;

      -- Stock: misma regla que el resto del inventario (fila bloqueada, sin negativos).
      v_before := app.stock_row_for_update(t.id, v.id, v_src);
      if (select st.available from public.stocks st where st.variant_id = v.id and st.location_id = v_src) < v_qty then
        raise exception 'Stock insuficiente de %: hay %', p.name, v_before using errcode = 'check_violation';
      end if;
      update public.stocks set on_hand = on_hand - v_qty, updated_at = now()
      where variant_id = v.id and location_id = v_src;
      insert into public.inventory_movements (
        tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, note, unit_cost, unit_price
      ) values (
        t.id, v.id, v_src, 'sale', v_before, -v_qty, v_before - v_qty,
        'Venta ' || v_number || coalesce(' · encargo ' || v_src_name, ''), v.cost, v_price
      );

      insert into public.sale_items (
        tenant_id, sale_id, line, variant_id, product_id, description, sku, qty, unit_price, gross,
        discount, tax_rate, tax_amount, line_total, unit_cost, source_location_id
      ) values (
        t.id, v_sale, v_line, v.id, p.id,
        p.name || coalesce(nullif(' — ' || (select string_agg(value, ' · ') from jsonb_each_text(v.options)), ' — '), ''),
        v.sku, v_qty, v_price, v_gross, v_line_disc, v_tax_rate, 0, 0, v.cost,
        case when v_src_name is not null then v_src end
      ) returning id into v_item_id;
      if v_src_name is not null then
        insert into public.partner_payables (tenant_id, location_id, sale_id, sale_item_id, variant_id, qty, unit_cost, amount)
        values (t.id, v_src, v_sale, v_item_id, v.id, v_qty, v.cost, case when v.cost is null then null else round(v.cost * v_qty, 2) end);
      end if;
    end if;
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
    if v_doc = 'delivery_note' then
      v_tax := 0;
    elsif t.prices_include_tax then
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
$function$;

revoke all on function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz, uuid, uuid, text, jsonb, text) from public;
grant execute on function app.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz, uuid, uuid, text, jsonb, text) to authenticated;

create function public.register_sale(
  p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb, p_cart_discount numeric default 0,
  p_change jsonb default null, p_customer jsonb default null, p_note text default null, p_sold_at timestamptz default null,
  p_channel_id uuid default null, p_cashier_id uuid default null, p_fulfillment text default null, p_delivery jsonb default null,
  p_document_kind text default null
) returns jsonb language sql set search_path = '' as $$
  select app.register_sale(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_change, p_customer, p_note,
                           p_sold_at, p_channel_id, p_cashier_id, p_fulfillment, p_delivery, p_document_kind)
$$;
revoke all on function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz, uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.register_sale(text, uuid, jsonb, jsonb, numeric, jsonb, jsonb, text, timestamptz, uuid, uuid, text, jsonb, text) to authenticated;

CREATE FUNCTION app.register_sale_coupon(p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb, p_cart_discount numeric, p_coupon_code text, p_coupon_discount numeric, p_change jsonb DEFAULT NULL::jsonb, p_customer jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_channel_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_fulfillment text DEFAULT NULL::text, p_delivery jsonb DEFAULT NULL::jsonb, p_document_kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                             null, p_channel_id, p_cashier_id, p_fulfillment, p_delivery, p_document_kind);
  end if;

  -- El bloqueo ordena dos ventas que usan el último cupo a la vez.
  c := app.coupon_for_sale(s.tenant_id, p_coupon_code, true);
  if coalesce(p_coupon_discount, 0) <= 0 or coalesce(p_cart_discount, 0) < p_coupon_discount then
    raise exception 'Descuento del cupón inválido' using errcode = 'check_violation';
  end if;

  v_result := app.register_sale(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_change, p_customer, p_note,
                                null, p_channel_id, p_cashier_id, p_fulfillment, p_delivery, p_document_kind);
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
$function$;

revoke all on function app.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid, text, jsonb, text) from public;
grant execute on function app.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid, text, jsonb, text) to authenticated;

create function public.register_sale_coupon(
  p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb, p_cart_discount numeric,
  p_coupon_code text, p_coupon_discount numeric, p_change jsonb default null, p_customer jsonb default null,
  p_note text default null, p_channel_id uuid default null, p_cashier_id uuid default null,
  p_fulfillment text default null, p_delivery jsonb default null, p_document_kind text default null
) returns jsonb language sql set search_path = '' as $$
  select app.register_sale_coupon(p_idempotency_key, p_session_id, p_items, p_payments, p_cart_discount, p_coupon_code,
                                  p_coupon_discount, p_change, p_customer, p_note, p_channel_id, p_cashier_id,
                                  p_fulfillment, p_delivery, p_document_kind)
$$;
revoke all on function public.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.register_sale_coupon(text, uuid, jsonb, jsonb, numeric, text, numeric, jsonb, jsonb, text, uuid, uuid, text, jsonb, text) to authenticated;

-- report_tax: el IVA sale solo de las facturas.
create or replace function app.report_tax(p_from date, p_to date, p_location_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Periodo inválido' using errcode = 'check_violation';
  end if;
  v_start := app.caracas_day_start(p_from);
  v_end := app.caracas_day_start(p_to + 1);

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'base_currency', (select base_currency from public.tenants where id = v_tenant),
    -- Ventas cobradas (las anuladas no cuentan), por tasa de IVA.
    'sales', (
      select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'tax', tax, 'lines', lines) order by rate desc), '[]'::jsonb)
      from (
        select i.tax_rate as rate, round(sum(i.line_total - i.tax_amount), 2) as base, round(sum(i.tax_amount), 2) as tax, count(*) as lines
        from public.sale_items i
        join public.sales s on s.id = i.sale_id
        where s.tenant_id = v_tenant and s.status = 'completed' and s.document_kind = 'invoice'
          and s.sold_at >= v_start and s.sold_at < v_end
          and (p_location_id is null or s.location_id = p_location_id)
        group by i.tax_rate
      ) x
    ),
    -- Devoluciones del periodo, en proporción a la línea devuelta.
    'returns', (
      select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'tax', tax) order by rate desc), '[]'::jsonb)
      from (
        select i.tax_rate as rate,
               round(sum(ri.amount * (i.line_total - i.tax_amount) / nullif(i.line_total, 0)), 2) as base,
               round(sum(ri.amount * i.tax_amount / nullif(i.line_total, 0)), 2) as tax
        from public.sale_returns r
        join public.sale_return_items ri on ri.return_id = r.id
        join public.sale_items i on i.id = ri.sale_item_id
        join public.sales s on s.id = r.sale_id and s.document_kind = 'invoice'
        where r.tenant_id = v_tenant and r.created_at >= v_start and r.created_at < v_end
          and (p_location_id is null or r.location_id = p_location_id)
        group by i.tax_rate
      ) x
    ),
    'igtf', (
      select coalesce(round(sum(igtf_total), 2), 0)
      from public.sales
      where tenant_id = v_tenant and status = 'completed' and sold_at >= v_start and sold_at < v_end
        and (p_location_id is null or location_id = p_location_id)
    ),
    -- Ventas con nota de entrega: van aparte, sin IVA.
    'delivery_notes', (
      select jsonb_build_object('total', coalesce(round(sum(total), 2), 0), 'tickets', count(*))
      from public.sales
      where tenant_id = v_tenant and status = 'completed' and document_kind = 'delivery_note'
        and sold_at >= v_start and sold_at < v_end
        and (p_location_id is null or location_id = p_location_id)
    ),
    'tickets', (
      select count(*)
      from public.sales
      where tenant_id = v_tenant and status = 'completed' and document_kind = 'invoice' and sold_at >= v_start and sold_at < v_end
        and (p_location_id is null or location_id = p_location_id)
    )
  );
end;
$$;
