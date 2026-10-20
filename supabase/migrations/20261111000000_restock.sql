-- Necesidad de reposición.
--
-- Portado de SublimeNecesidadReposicion (basicosystems@f551478b), que repone
-- la tienda según lo vendido. Aquí, por variante y sede:
--   * Mínimo y objetivo opcionales (stocks.min_qty / target_qty). Con mínimo,
--     se repone cuando lo disponible llega a él, hasta el objetivo.
--   * Sin mínimo, por rotación: lo vendido en los últimos N días da la venta
--     diaria; si lo disponible no cubre `p_cover_days`, se repone hasta cubrirlos.
--   * De dónde sacarlo: otras sedes con disponible por encima de su mínimo.
-- Los mínimos los ponen dueño, administrador o encargado; el reporte sigue las
-- reglas de los demás reportes (plan con Reportes; dueño, administrador o
-- encargado).

alter table public.stocks
  add column min_qty numeric(14, 3) check (min_qty is null or min_qty >= 0),
  add column target_qty numeric(14, 3) check (target_qty is null or target_qty > 0),
  add constraint stocks_target_over_min check (target_qty is null or min_qty is null or target_qty > min_qty);

create or replace function app.set_stock_levels(p_variant_id uuid, p_location_id uuid, p_min numeric, p_target numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.variants where id = p_variant_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'Producto no encontrado' using errcode = 'no_data_found';
  end if;
  if p_min is not null and p_min < 0 or p_target is not null and p_target <= 0 or p_min is not null and p_target is not null and p_target <= p_min then
    raise exception 'El objetivo debe ser mayor que el mínimo' using errcode = 'check_violation';
  end if;
  perform app.stock_row_for_update(v_tenant, p_variant_id, p_location_id);
  update public.stocks set min_qty = p_min, target_qty = p_target, updated_at = now()
  where variant_id = p_variant_id and location_id = p_location_id;
end;
$$;
revoke all on function app.set_stock_levels(uuid, uuid, numeric, numeric) from public;
grant execute on function app.set_stock_levels(uuid, uuid, numeric, numeric) to authenticated;

create function public.set_stock_levels(p_variant_id uuid, p_location_id uuid, p_min numeric, p_target numeric)
returns void language sql security invoker set search_path = '' as $$ select app.set_stock_levels(p_variant_id, p_location_id, p_min, p_target) $$;
revoke all on function public.set_stock_levels(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.set_stock_levels(uuid, uuid, numeric, numeric) to authenticated;

create function public.report_restock(p_location_id uuid default null, p_days integer default 30, p_cover_days integer default 15)
returns table (
  variant_id uuid,
  name text,
  sku text,
  options jsonb,
  location_id uuid,
  location_name text,
  available numeric,
  min_qty numeric,
  target_qty numeric,
  sold numeric,
  daily numeric,
  days_left numeric,
  suggested numeric,
  reason text,
  sources jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
begin
  if p_days is null or p_days not between 7 and 365 then
    raise exception 'Días de venta inválidos (7 a 365)' using errcode = 'check_violation';
  end if;
  if p_cover_days is null or p_cover_days not between 1 and 180 then
    raise exception 'Días a cubrir inválidos (1 a 180)' using errcode = 'check_violation';
  end if;
  return query
  with base as (
    select st.variant_id, st.location_id, st.available, st.min_qty, st.target_qty,
           coalesce((select sum(-m.qty_delta) from public.inventory_movements m
                     where m.variant_id = st.variant_id and m.location_id = st.location_id and m.kind = 'sale'
                       and m.created_at >= now() - make_interval(days => p_days)), 0) as sold
    from public.stocks st
    join public.locations lo on lo.id = st.location_id and lo.deleted_at is null and lo.is_active
    where st.tenant_id = v_tenant and (p_location_id is null or st.location_id = p_location_id)
  ),
  calc as (
    select b.*, round(b.sold / p_days, 3) as daily,
           case
             when b.min_qty is not null and b.available <= b.min_qty
               then greatest(ceil(coalesce(b.target_qty, b.min_qty * 2, 1) - b.available), 1)
             when b.min_qty is null and b.sold > 0 and b.available < ceil(b.sold / p_days * p_cover_days)
               then ceil(b.sold / p_days * p_cover_days) - b.available
           end as suggested,
           case when b.min_qty is not null then 'min' else 'rotacion' end as reason
    from base b
  )
  select c.variant_id, p.name, v.sku, v.options, c.location_id, lo.name, c.available, c.min_qty, c.target_qty, c.sold, c.daily,
         case when c.daily > 0 then round(c.available / c.daily, 1) end,
         c.suggested, c.reason,
         coalesce((
           select jsonb_agg(jsonb_build_object('location_id', o.location_id, 'name', ol.name,
                                               'spare', o.available - coalesce(o.min_qty, 0)) order by o.available - coalesce(o.min_qty, 0) desc)
           from public.stocks o
           join public.locations ol on ol.id = o.location_id and ol.deleted_at is null and ol.is_active
           where o.variant_id = c.variant_id and o.location_id <> c.location_id and o.available - coalesce(o.min_qty, 0) > 0
         ), '[]'::jsonb)
  from calc c
  join public.variants v on v.id = c.variant_id and v.deleted_at is null and v.is_active
  join public.products p on p.id = v.product_id and p.deleted_at is null and p.is_active
  join public.locations lo on lo.id = c.location_id
  where c.suggested is not null and c.suggested > 0
  order by (c.available <= coalesce(c.min_qty, 0)) desc, case when c.daily > 0 then c.available / c.daily end nulls last, p.name
  limit 500;
end;
$$;
revoke all on function public.report_restock(uuid, integer, integer) from public, anon;
grant execute on function public.report_restock(uuid, integer, integer) to authenticated;
