-- Inventario de aliados y venta por encargo.
--
--   * Un aliado comercial es una sede de tipo 'external': su lista de
--     productos se importa a esa sede como cualquier existencia. El producto
--     es uno solo; puede tener existencia propia y en uno o más aliados.
--   * El POS puede vender por encargo: la línea lleva from_location_id, la
--     existencia sale del aliado (no de la caja) y queda un pendiente por
--     pagarle al aliado el costo del producto.
--   * Anular o devolver regresa la existencia al aliado y cancela o reduce el
--     pendiente que aún no se pagó.

alter table public.sale_items add column source_location_id uuid;
alter table public.sale_items
  add constraint sale_items_source_location_fk foreign key (tenant_id, source_location_id) references public.locations (tenant_id, id);
create index sale_items_source_location_idx on public.sale_items (tenant_id, source_location_id) where source_location_id is not null;

create table public.partner_payables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null,
  sale_id uuid not null,
  sale_item_id uuid not null references public.sale_items (id) on delete cascade,
  variant_id uuid not null,
  qty numeric(14, 3) not null check (qty >= 0),
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  amount numeric(14, 2) check (amount is null or amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_at timestamptz,
  paid_by uuid,
  created_at timestamptz not null default now(),
  unique (sale_item_id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id),
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id)
);
create index partner_payables_open_idx on public.partner_payables (tenant_id, location_id, status, created_at desc);
create index partner_payables_sale_idx on public.partner_payables (tenant_id, sale_id);
create index partner_payables_variant_idx on public.partner_payables (tenant_id, variant_id);

alter table public.partner_payables enable row level security;
revoke all on public.partner_payables from anon;
revoke insert, update, delete on public.partner_payables from authenticated;
create policy tenant_read on public.partner_payables for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));


-- Un aliado no es una sede del negocio: no cuenta para el límite de sedes del plan.
create or replace function app.enforce_location_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null and new.type <> 'external'
     and (tg_op = 'INSERT' or old.deleted_at is not null or old.type = 'external') then
    perform app.require_quota(new.tenant_id, 'max_locations',
      (select count(*) from public.locations
       where tenant_id = new.tenant_id and deleted_at is null and type <> 'external' and id <> new.id),
      case when coalesce((app.entitled(new.tenant_id, 'max_locations'))::integer, 0) = 1 then 'sede' else 'sedes' end);
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_location_quota() from public;
drop trigger locations_quota on public.locations;
create trigger locations_quota before insert or update of deleted_at, type on public.locations
  for each row execute function app.enforce_location_quota();

CREATE OR REPLACE FUNCTION app.plan_usage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'config.negocio') then
    raise exception 'Solo dueño o administrador' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'locations', (select count(*) from public.locations where tenant_id = v_tenant and deleted_at is null and type <> 'external'),
    'registers', (select count(*) from public.registers where tenant_id = v_tenant and is_active),
    'users', (select count(*) from public.tenant_members where tenant_id = v_tenant)
  );
end;
$function$;

-- register_sale: igual que antes, más la venta por encargo (from_location_id).
CREATE OR REPLACE FUNCTION app.register_sale(p_idempotency_key text, p_session_id uuid, p_items jsonb, p_payments jsonb, p_cart_discount numeric DEFAULT 0, p_change jsonb DEFAULT NULL::jsonb, p_customer jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_sold_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_channel_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_fulfillment text DEFAULT NULL::text, p_delivery jsonb DEFAULT NULL::jsonb)
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
    fulfillment, delivery
  ) values (
    t.id, v_number, s.location_id, s.register_id, s.id, t.base_currency, t.local_currency,
    v_rate, v_rate_source, v_rate_date, t.prices_include_tax,
    0, 0, 0, 0, 0, 0,
    v_customer.id, coalesce(nullif(trim(p_customer ->> 'name'), ''), v_customer.name),
    coalesce(nullif(trim(p_customer ->> 'doc'), ''), v_customer.doc),
    nullif(trim(p_note), ''), p_idempotency_key, v_at, p_sold_at is not null, v_channel, v_cashier,
    v_fulfillment, v_delivery
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
$function$;


-- Anular: la existencia vuelve a donde salió y el pendiente con el aliado se cancela.
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
  if exists (select 1 from public.partner_payables where sale_id = s.id and status = 'paid') then
    raise exception 'La venta % ya se le pagó al aliado: registra una devolución', s.number using errcode = 'check_violation';
  end if;

  for i in select * from public.sale_items where sale_id = s.id order by line loop
    perform app.restock_from_sale(s.tenant_id, i.variant_id, coalesce(i.source_location_id, s.location_id), i.qty, 'Anulación ' || s.number, i.unit_price);
  end loop;
  update public.partner_payables set status = 'cancelled' where sale_id = s.id and status = 'pending';

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

-- Devolver: igual que antes, con la sede de origen de cada línea.
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
      perform app.restock_from_sale(s.tenant_id, i.variant_id, coalesce(i.source_location_id, s.location_id), x.qty,
                                    'Devolución ' || v_number || ' de ' || s.number, i.unit_price);
    end if;
    -- Encargo aún sin pagar: se le debe menos al aliado.
    update public.partner_payables pp set
      qty = greatest(pp.qty - x.qty, 0),
      amount = case when pp.unit_cost is null then null else round(pp.unit_cost * greatest(pp.qty - x.qty, 0), 2) end,
      status = case when pp.qty - x.qty <= 0.0005 then 'cancelled' else pp.status end
    where pp.sale_item_id = i.id and pp.status = 'pending';
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

-- Pagar al aliado: marca pendientes como pagados.
create or replace function app.partner_payables_mark_paid(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_count integer;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'finanzas.operar') then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.partner_payables where id = any(p_ids) and tenant_id = v_tenant and status = 'pending' and amount is null) then
    raise exception 'Hay encargos sin costo: complétalo antes de pagar' using errcode = 'check_violation';
  end if;
  update public.partner_payables set status = 'paid', paid_at = now(), paid_by = auth.uid()
  where id = any(p_ids) and tenant_id = v_tenant and status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.partner_payables_mark_paid(uuid[]) from public, anon;
grant execute on function app.partner_payables_mark_paid(uuid[]) to authenticated;

create function public.partner_payables_mark_paid(p_ids uuid[])
returns integer language sql set search_path = '' as $$ select app.partner_payables_mark_paid(p_ids) $$;
revoke all on function public.partner_payables_mark_paid(uuid[]) from public, anon;
grant execute on function public.partner_payables_mark_paid(uuid[]) to authenticated;

-- Costo de un encargo que llegó sin costo (o con otro acordado).
create or replace function app.set_partner_payable_cost(p_id uuid, p_unit_cost numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'finanzas.operar') then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Costo inválido' using errcode = 'check_violation';
  end if;
  update public.partner_payables set unit_cost = p_unit_cost, amount = round(p_unit_cost * qty, 2)
  where id = p_id and tenant_id = v_tenant and status = 'pending';
  if not found then
    raise exception 'Encargo no encontrado o ya pagado' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.set_partner_payable_cost(uuid, numeric) from public, anon;
grant execute on function app.set_partner_payable_cost(uuid, numeric) to authenticated;

create function public.set_partner_payable_cost(p_id uuid, p_unit_cost numeric)
returns void language sql set search_path = '' as $$ select app.set_partner_payable_cost(p_id, p_unit_cost) $$;
revoke all on function public.set_partner_payable_cost(uuid, numeric) from public, anon;
grant execute on function public.set_partner_payable_cost(uuid, numeric) to authenticated;
