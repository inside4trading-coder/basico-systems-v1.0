-- Catálogo del POS: lo que se puede vender en la sede de la caja, lo más
-- vendido primero.
--
-- Con el buscador vacío el POS muestra tarjetas de productos (como el
-- catálogo del ERP, SublimePosApp en basicosystems@f551478b) en vez de una
-- pantalla en blanco: los más vendidos en la sede los últimos 30 días, luego
-- por nombre, con su disponible, precio sin IVA e IVA del producto (el PVP se
-- calcula en pantalla) y foto si tiene. Filtra por categoría.
-- Cualquier miembro del equipo lo usa; solo productos activos con precio y
-- existencia en esa sede.

create or replace function app.pos_catalog(p_location_id uuid, p_category text default null, p_limit integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_default_tax numeric;
begin
  if v_tenant is null or v_tenant not in (select app.auth_tenant_ids()) then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant) then
    raise exception 'Sede no encontrada' using errcode = 'no_data_found';
  end if;
  select coalesce((select x.rate from public.tax_rates x where x.tenant_id = v_tenant and x.is_default), 0) into v_default_tax;

  return jsonb_build_object(
    'categories', (
      select coalesce(jsonb_agg(c.category order by c.category), '[]'::jsonb)
      from (
        select distinct p.category
        from public.stocks st
        join public.variants v on v.id = st.variant_id and v.deleted_at is null and v.is_active
        join public.products p on p.id = v.product_id and p.deleted_at is null and p.is_active
        where st.tenant_id = v_tenant and st.location_id = p_location_id and st.available > 0
          and nullif(trim(p.category), '') is not null
      ) c
    ),
    'items', (
      with sold as (
        select m.variant_id, sum(-m.qty_delta) as qty
        from public.inventory_movements m
        where m.tenant_id = v_tenant and m.location_id = p_location_id and m.kind = 'sale'
          and m.created_at >= now() - interval '30 days'
        group by m.variant_id
      )
      select coalesce(jsonb_agg(to_jsonb(x) order by x.sold desc, x.product_name, x.sku), '[]'::jsonb)
      from (
        select v.id as variant_id, p.id as product_id, p.name as product_name, v.options, p.brand, v.sku,
               coalesce(v.price, v.regular_price) as price, v.unit, p.category, p.image_url,
               'catalogo' as match_kind, st.available,
               coalesce((select x.rate from public.tax_rates x where x.id = p.tax_rate_id), v_default_tax) as tax_rate,
               coalesce(sold.qty, 0) as sold
        from public.stocks st
        join public.variants v on v.id = st.variant_id and v.deleted_at is null and v.is_active
        join public.products p on p.id = v.product_id and p.deleted_at is null and p.is_active
        left join sold on sold.variant_id = v.id
        where st.tenant_id = v_tenant and st.location_id = p_location_id and st.available > 0
          and coalesce(v.price, v.regular_price) > 0
          and (nullif(trim(p_category), '') is null or p.category = trim(p_category))
        order by coalesce(sold.qty, 0) desc, p.name, v.sku
        limit greatest(1, least(coalesce(p_limit, 60), 200))
      ) x
    )
  );
end;
$$;
revoke all on function app.pos_catalog(uuid, text, integer) from public;
grant execute on function app.pos_catalog(uuid, text, integer) to authenticated;

create function public.pos_catalog(p_location_id uuid, p_category text default null, p_limit integer default 60)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.pos_catalog(p_location_id, p_category, p_limit) $$;
revoke all on function public.pos_catalog(uuid, text, integer) from public, anon;
grant execute on function public.pos_catalog(uuid, text, integer) to authenticated;
