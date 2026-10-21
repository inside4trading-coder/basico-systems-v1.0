-- Precios sin IVA.
--
-- El negocio escribe el precio sin IVA y la app muestra al lado el PVP (con
-- el IVA del producto). Cada venta ya guarda la base y el IVA por línea
-- (register_sale con prices_include_tax = false), así que el IVA cobrado en un
-- periodo sale de las ventas:
--   * Los precios de los negocios que los tenían con IVA incluido se pasan a
--     sin IVA con la tasa de cada producto (o la del negocio). Las ventas ya
--     hechas no cambian.
--   * prices_include_tax queda en false para todos y deja de ser editable.
--   * report_tax: base imponible e IVA por tasa del periodo, menos
--     devoluciones, e IGTF aparte.
--   * seed_demo_tenant: igual que en 20261118000000_demo_refresh.sql, con
--     precios sin IVA y los cobros calculados con el IVA.

update public.variants v
set regular_price = round(v.regular_price / (1 + r.rate / 100), 2),
    price = round(v.price / (1 + r.rate / 100), 2)
from public.products p
join public.tenants t on t.id = p.tenant_id
cross join lateral (
  select coalesce(
    (select x.rate from public.tax_rates x where x.id = p.tax_rate_id),
    (select x.rate from public.tax_rates x where x.tenant_id = t.id and x.is_default),
    0) as rate
) r
where v.product_id = p.id and t.prices_include_tax and r.rate > 0;

update public.tenants set prices_include_tax = false where prices_include_tax;
alter table public.tenants alter column prices_include_tax set default false;
revoke update (prices_include_tax) on public.tenants from authenticated;

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
        where s.tenant_id = v_tenant and s.status = 'completed' and s.sold_at >= v_start and s.sold_at < v_end
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
    'tickets', (
      select count(*)
      from public.sales
      where tenant_id = v_tenant and status = 'completed' and sold_at >= v_start and sold_at < v_end
        and (p_location_id is null or location_id = p_location_id)
    )
  );
end;
$$;
revoke all on function app.report_tax(date, date, uuid) from public;
grant execute on function app.report_tax(date, date, uuid) to authenticated;

create function public.report_tax(p_from date, p_to date, p_location_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.report_tax(p_from, p_to, p_location_id) $$;
revoke all on function public.report_tax(date, date, uuid) from public, anon;
grant execute on function public.report_tax(date, date, uuid) to authenticated;

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
  v_channel uuid;
  v_cashier uuid;
  v_ch_store uuid;
  v_ch_wa uuid;
  v_ch_ig uuid;
  v_ch_delivery uuid;
  v_cashiers_cab uuid[];
  v_cashiers_bqt uuid[];
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
  set base_currency = 'USD', local_currency = 'VES', rate_source = 'manual', prices_include_tax = false,
      is_special_taxpayer = false, status = 'active',
      legal_name = 'Repuestos Lara Demo, C.A.', tax_id = 'J-50123456-1',
      address = 'Av. Intercomunal Cabudare-Barquisimeto, Lara', phone = '0251-2611234',
      receipt_footer = 'Gracias por su compra. Cambios en 7 días con esta nota.',
      closing_reminder_time = '17:30', channel_required = false
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
  update public.locations set address = 'C.C. Cabudare, local 12', phone = '0251-2611234' where id = v_cab;
  update public.locations set address = 'Av. Lara, C.C. Babilon, local 4', phone = '0251-2547788' where id = v_bqt;

  -- Personal de caja y orígenes de venta.
  insert into public.cashiers (tenant_id, name, location_id) values
    (t.id, 'Yolimar Suárez', v_cab), (t.id, 'Jesús Escalona', v_cab), (t.id, 'Daniela Mújica', v_bqt), (t.id, 'Rafael Piña', null);
  select array_agg(id order by name) into v_cashiers_cab from public.cashiers where tenant_id = t.id and (location_id = v_cab or location_id is null);
  select array_agg(id order by name) into v_cashiers_bqt from public.cashiers where tenant_id = t.id and (location_id = v_bqt or location_id is null);
  select id into v_ch_store from public.sales_channels where tenant_id = t.id and name = 'Tienda';
  select id into v_ch_wa from public.sales_channels where tenant_id = t.id and name = 'WhatsApp';
  select id into v_ch_ig from public.sales_channels where tenant_id = t.id and name = 'Instagram';
  select id into v_ch_delivery from public.sales_channels where tenant_id = t.id and name = 'Delivery';

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
    v_r := round(v_r / 1.16, 2);  -- precio sin IVA (16 %)
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
        -- Total con IVA, redondeado por línea como en register_sale.
        select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'qty', qty)),
               sum(round(price * qty, 2) + round(round(price * qty, 2) * 0.16, 2))
        into v_items, v_total
        from (
          select c.variant_id, c.price, least(c.pack * (1 + floor(random()::numeric * 1.4)::int), floor(s.on_hand)::int) as qty
          from pg_temp.demo_catalog c
          join public.stocks s on s.variant_id = c.variant_id and s.location_id = v_loc and s.on_hand >= 1
          order by -ln(random()::numeric + 0.000001) / c.weight  -- muestreo ponderado por popularidad
          limit 1 + floor(random()::numeric * 2.6)::int
        ) z where qty >= 1;
        continue when v_items is null;
        -- Algunas ventas llevan instalación (concepto manual, sin stock).
        if random()::numeric < 0.07 then
          v_items := v_items || jsonb_build_array(jsonb_build_object('manual', true, 'kind', 'servicio', 'description', 'Instalación', 'price', 4.31, 'qty', 1));
          v_total := v_total + 5;
        end if;
        v_r := random()::numeric;
        v_channel := case when v_r < 0.6 then v_ch_store when v_r < 0.85 then v_ch_wa when v_r < 0.95 then v_ch_ig else v_ch_delivery end;
        v_cashier := case when v_loc = v_cab then v_cashiers_cab[1 + floor(random()::numeric * array_length(v_cashiers_cab, 1))::int]
                          else v_cashiers_bqt[1 + floor(random()::numeric * array_length(v_cashiers_bqt, 1))::int] end;

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

        v_sale := app.register_sale('demo-' || md5(t.id::text || v_at::text || v_loc::text), v_session, v_items, v_payments, 0, null, v_customer, null, v_at,
                                    v_channel, v_cashier);

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
    select c.variant_id, round(c.price * c.pack, 2) + round(round(c.price * c.pack, 2) * 0.16, 2) into v_reg, v_total
    from pg_temp.demo_catalog c join public.stocks s on s.variant_id = c.variant_id and s.location_id = v_cab and s.on_hand >= c.pack
    order by c.weight desc offset k limit 1;
    v_sale := app.register_sale('demo-hoy-' || k || '-' || md5(t.id::text), v_session,
                                jsonb_build_array(jsonb_build_object('variant_id', v_reg, 'qty', (select pack from pg_temp.demo_catalog where variant_id = v_reg))),
                                jsonb_build_array(jsonb_build_object('payment_method_id', v_pm_cash_usd, 'amount', v_total)));
  end loop;
  perform app.void_sale((v_sale ->> 'sale_id')::uuid, 'El cliente trajo el repuesto equivocado del vehículo');

  -- Mínimo y objetivo para lo que más rota en Barquisimeto (Reposición).
  update public.stocks st set min_qty = greatest(ceil(c.weight * c.pack * 1.5), 2), target_qty = greatest(ceil(c.weight * c.pack * 4), 4)
  from pg_temp.demo_catalog c
  where st.variant_id = c.variant_id and st.location_id = v_bqt and c.weight >= 5;

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
