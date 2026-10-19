-- Reportes y cierres (F3).
--
-- Portado de SublimeDashboard.tsx, SublimeCierres.tsx y SublimeFinanciero.tsx
-- (basicosystems@f551478b). Allí cada pantalla bajaba ventas, líneas y pagos
-- al navegador y sumaba ahí (hasta ~20 consultas). Aquí se agrega en la base:
-- una llamada por pantalla, con el negocio activo y el rango en hora de Caracas.
--
-- Todas son SECURITY INVOKER (las filtra RLS) y además filtran por el negocio
-- activo (app.current_tenant_id): las policies de lectura dejan ver todos los
-- negocios del usuario. Ven costos y márgenes: solo owner, admin y manager.

-- ---------------------------------------------------------------------------
-- Apoyo
-- ---------------------------------------------------------------------------

create or replace function app.report_tenant()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Los reportes son para dueños, administradores y encargados' using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end;
$$;
revoke all on function app.report_tenant() from public;
grant execute on function app.report_tenant() to authenticated;

-- Inicio de un día de Caracas como instante.
create or replace function app.caracas_day_start(p_day date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_day::timestamp at time zone 'America/Caracas'
$$;
revoke all on function app.caracas_day_start(date) from public;
grant execute on function app.caracas_day_start(date) to authenticated;

-- Indicadores de ventas de un rango. El margen solo cuenta líneas con costo
-- (sin costo no se inventa utilidad) y se calcula sin impuesto.
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
    'cost', (select coalesce(round(sum(qty * unit_cost), 2), 0) from l where unit_cost is not null)
  )
$$;
revoke all on function app.sales_kpis(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function app.sales_kpis(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ventas por periodo, sede, producto, método, cajero y hora
-- ---------------------------------------------------------------------------

create function public.report_sales(p_from date, p_to date, p_location_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
  v_days integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Rango de fechas inválido' using errcode = 'check_violation';
  end if;
  if p_to - p_from > 366 then
    raise exception 'El rango máximo es un año' using errcode = 'check_violation';
  end if;
  v_days := p_to - p_from + 1;
  v_start := app.caracas_day_start(p_from);
  v_end := app.caracas_day_start(p_to + 1);

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'summary', app.sales_kpis(v_tenant, v_start, v_end, p_location_id),
    -- Mismo largo, justo antes: para comparar.
    'previous', app.sales_kpis(v_tenant, app.caracas_day_start(p_from - v_days), v_start, p_location_id),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day::date, 'tickets', coalesce(x.tickets, 0), 'net', coalesce(x.net, 0)) order by d.day), '[]'::jsonb)
      from generate_series(p_from, p_to, interval '1 day') as d(day)
      left join (
        select (sold_at at time zone 'America/Caracas')::date as day, count(*) tickets, sum(total) net
        from public.sales
        where tenant_id = v_tenant and status = 'completed' and sold_at >= v_start and sold_at < v_end
          and (p_location_id is null or location_id = p_location_id)
        group by 1
      ) x on x.day = d.day::date
    ),
    'by_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', hour, 'tickets', tickets, 'net', net) order by hour), '[]'::jsonb)
      from (
        select extract(hour from sold_at at time zone 'America/Caracas')::int as hour, count(*) tickets, sum(total) net
        from public.sales
        where tenant_id = v_tenant and status = 'completed' and sold_at >= v_start and sold_at < v_end
          and (p_location_id is null or location_id = p_location_id)
        group by 1
      ) h
    ),
    'by_location', (
      select coalesce(jsonb_agg(jsonb_build_object('location_id', x.location_id, 'name', lo.name, 'tickets', x.tickets, 'net', x.net) order by x.net desc), '[]'::jsonb)
      from (
        select location_id, count(*) tickets, sum(total) net
        from public.sales
        where tenant_id = v_tenant and status = 'completed' and sold_at >= v_start and sold_at < v_end
          and (p_location_id is null or location_id = p_location_id)
        group by location_id
      ) x
      join public.locations lo on lo.id = x.location_id
    ),
    'by_product', (
      select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.net desc), '[]'::jsonb)
      from (
        select i.variant_id, max(i.description) as name, max(i.sku) as sku,
               sum(i.qty) as qty, sum(i.line_total) as net,
               round(sum(i.line_total - i.tax_amount) filter (where i.unit_cost is not null)
                     - sum(i.qty * i.unit_cost) filter (where i.unit_cost is not null), 2) as profit,
               bool_and(i.unit_cost is not null) as costed
        from public.sale_items i
        join public.sales s on s.id = i.sale_id
        where s.tenant_id = v_tenant and s.status = 'completed' and s.sold_at >= v_start and s.sold_at < v_end
          and (p_location_id is null or s.location_id = p_location_id)
        group by i.variant_id
        order by sum(i.line_total) desc
        limit 100
      ) p
    ),
    'by_method', (
      select coalesce(jsonb_agg(jsonb_build_object('method', method_name, 'currency', currency, 'count', n, 'amount', amount, 'amount_base', amount_base) order by amount_base desc), '[]'::jsonb)
      from (
        select p.method_name, p.currency, count(*) n, sum(p.amount) amount, sum(p.amount_base) amount_base
        from public.sale_payments p
        join public.sales s on s.id = p.sale_id
        where s.tenant_id = v_tenant and s.status = 'completed' and s.sold_at >= v_start and s.sold_at < v_end
          and (p_location_id is null or s.location_id = p_location_id)
        group by p.method_name, p.currency
      ) m
    ),
    'by_seller', (
      select coalesce(jsonb_agg(jsonb_build_object('seller', coalesce(tm.email, 'Usuario retirado'), 'tickets', x.tickets, 'net', x.net) order by x.net desc), '[]'::jsonb)
      from (
        select sold_by, count(*) tickets, sum(total) net
        from public.sales
        where tenant_id = v_tenant and status = 'completed' and sold_at >= v_start and sold_at < v_end
          and (p_location_id is null or location_id = p_location_id)
        group by sold_by
      ) x
      left join public.tenant_members tm on tm.tenant_id = v_tenant and tm.user_id = x.sold_by
    )
  );
end;
$$;
revoke all on function public.report_sales(date, date, uuid) from public, anon;
grant execute on function public.report_sales(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Stock valorizado
-- ---------------------------------------------------------------------------

create function public.report_stock_value(p_location_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
begin
  return jsonb_build_object(
    'by_location', (
      select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.cost_value desc), '[]'::jsonb)
      from (
        select lo.id as location_id, lo.name,
               count(*) filter (where st.on_hand > 0) as skus,
               coalesce(sum(st.on_hand), 0) as units,
               coalesce(round(sum(st.on_hand * v.cost), 2), 0) as cost_value,
               coalesce(round(sum(st.on_hand * coalesce(v.price, v.regular_price)), 2), 0) as retail_value,
               count(*) filter (where st.on_hand > 0 and v.cost is null) as missing_cost
        from public.stocks st
        join public.variants v on v.id = st.variant_id and v.deleted_at is null
        join public.locations lo on lo.id = st.location_id and lo.deleted_at is null
        where st.tenant_id = v_tenant and (p_location_id is null or st.location_id = p_location_id)
        group by lo.id, lo.name
      ) x
    ),
    'top', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.cost_value desc nulls last), '[]'::jsonb)
      from (
        select v.id as variant_id, p.name, v.sku, v.options,
               sum(st.on_hand) as units, v.cost, coalesce(v.price, v.regular_price) as price,
               round(sum(st.on_hand) * v.cost, 2) as cost_value,
               round(sum(st.on_hand) * coalesce(v.price, v.regular_price), 2) as retail_value
        from public.stocks st
        join public.variants v on v.id = st.variant_id and v.deleted_at is null
        join public.products p on p.id = v.product_id and p.deleted_at is null
        where st.tenant_id = v_tenant and st.on_hand > 0 and (p_location_id is null or st.location_id = p_location_id)
        group by v.id, p.name
        order by round(sum(st.on_hand) * v.cost, 2) desc nulls last
        limit 200
      ) t
    )
  );
end;
$$;
revoke all on function public.report_stock_value(uuid) from public, anon;
grant execute on function public.report_stock_value(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sin rotación: con existencia y sin ventas en los últimos N días
-- ---------------------------------------------------------------------------

create function public.report_slow_movers(p_days integer default 60, p_location_id uuid default null)
returns table (
  variant_id uuid,
  name text,
  sku text,
  options jsonb,
  location_id uuid,
  location_name text,
  on_hand numeric,
  cost_value numeric,
  last_sold_at timestamptz,
  first_stocked_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
begin
  if p_days is null or p_days < 1 or p_days > 730 then
    raise exception 'Días inválidos (1 a 730)' using errcode = 'check_violation';
  end if;
  return query
  select v.id, p.name, v.sku, v.options, lo.id, lo.name, st.on_hand,
         round(st.on_hand * v.cost, 2),
         (select max(m.created_at) from public.inventory_movements m
           where m.variant_id = v.id and m.location_id = st.location_id and m.kind = 'sale'),
         (select min(m.created_at) from public.inventory_movements m
           where m.variant_id = v.id and m.location_id = st.location_id)
  from public.stocks st
  join public.variants v on v.id = st.variant_id and v.deleted_at is null and v.is_active
  join public.products p on p.id = v.product_id and p.deleted_at is null and p.is_active
  join public.locations lo on lo.id = st.location_id and lo.deleted_at is null
  where st.tenant_id = v_tenant and st.on_hand > 0
    and (p_location_id is null or st.location_id = p_location_id)
    and not exists (
      select 1 from public.inventory_movements m
      where m.variant_id = v.id and m.location_id = st.location_id and m.kind = 'sale'
        and m.created_at >= now() - make_interval(days => p_days)
    )
    -- Lo que llegó hace menos de N días todavía no tuvo tiempo de rotar.
    and coalesce((select min(m.created_at) from public.inventory_movements m
                   where m.variant_id = v.id and m.location_id = st.location_id), '-infinity') < now() - make_interval(days => p_days)
  order by round(st.on_hand * v.cost, 2) desc nulls last, p.name
  limit 500;
end;
$$;
revoke all on function public.report_slow_movers(integer, uuid) from public, anon;
grant execute on function public.report_slow_movers(integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cierres de caja
-- ---------------------------------------------------------------------------

create function public.report_cash_sessions(p_from date, p_to date, p_location_id uuid default null)
returns table (
  session_id uuid,
  number text,
  status text,
  register_name text,
  location_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  opened_by text,
  closed_by text,
  closing_note text,
  sales_count bigint,
  sales_total numeric,
  offline_count bigint,
  counts jsonb,
  by_method jsonb,
  has_difference boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Rango de fechas inválido' using errcode = 'check_violation';
  end if;
  return query
  select cs.id, cs.number, cs.status, r.name, lo.name, cs.opened_at, cs.closed_at,
         ob.email, cb.email, cs.closing_note,
         (select count(*) from public.sales s where s.session_id = cs.id and s.status = 'completed'),
         (select coalesce(sum(s.total), 0) from public.sales s where s.session_id = cs.id and s.status = 'completed'),
         (select count(*) from public.sales s where s.session_id = cs.id and s.status = 'completed' and s.captured_offline),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'currency', c.currency, 'opening', c.opening,
             'expected', coalesce(c.expected, (select coalesce(sum(m.amount), 0) from public.cash_movements m where m.session_id = cs.id and m.currency = c.currency)),
             'counted', c.counted, 'difference', c.difference) order by c.currency), '[]'::jsonb)
          from public.cash_counts c where c.session_id = cs.id),
         (select coalesce(jsonb_agg(jsonb_build_object('method', x.method_name, 'currency', x.currency, 'amount', x.amount, 'amount_base', x.amount_base) order by x.amount_base desc), '[]'::jsonb)
          from (
            select p.method_name, p.currency, sum(p.amount) amount, sum(p.amount_base) amount_base
            from public.sale_payments p join public.sales s on s.id = p.sale_id
            where s.session_id = cs.id and s.status = 'completed'
            group by p.method_name, p.currency
          ) x),
         exists (select 1 from public.cash_counts c where c.session_id = cs.id and abs(coalesce(c.difference, 0)) >= 0.01)
  from public.cash_sessions cs
  join public.registers r on r.id = cs.register_id
  join public.locations lo on lo.id = cs.location_id
  left join public.tenant_members ob on ob.tenant_id = cs.tenant_id and ob.user_id = cs.opened_by
  left join public.tenant_members cb on cb.tenant_id = cs.tenant_id and cb.user_id = cs.closed_by
  where cs.tenant_id = v_tenant
    and cs.opened_at >= app.caracas_day_start(p_from) and cs.opened_at < app.caracas_day_start(p_to + 1)
    and (p_location_id is null or cs.location_id = p_location_id)
  order by cs.opened_at desc
  limit 500;
end;
$$;
revoke all on function public.report_cash_sessions(date, date, uuid) from public, anon;
grant execute on function public.report_cash_sessions(date, date, uuid) to authenticated;

-- El catálogo sin conexión (20261023000000) también se limita al negocio
-- activo: con dos negocios, el POS de uno no debe guardar productos del otro.
create or replace function public.pos_catalog_snapshot(p_location_id uuid)
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
  where x.tenant_id = app.current_tenant_id()
    and x.deleted_at is null and x.is_active and p.deleted_at is null and p.is_active
  order by p.name, x.sku
$$;
