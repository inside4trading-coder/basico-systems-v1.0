-- Búsqueda sin tildes ni mayúsculas.
--
-- "bujia" encuentra "Bujía" y "pena" encuentra "Peña": la gente escribe sin
-- tildes en el POS. app.fold baja a minúsculas y quita tildes y diéresis
-- (sin extensión unaccent); lo usan el buscador del catálogo y el de clientes.

create or replace function app.fold(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(lower(p), 'áéíóúüñàèìòùâêîôûäëïöÿç', 'aeiouunaeiouaeiouaeioyc')
$$;
grant execute on function app.fold(text) to authenticated;

-- catalog_lookup: igual que en 20261019020000_inventory_core.sql, comparando con app.fold.
create or replace function app.catalog_lookup(p_query text, p_limit integer DEFAULT 30)
 RETURNS TABLE(variant_id uuid, product_id uuid, product_name text, options jsonb, brand text, sku text, price numeric, cost numeric, unit text, match_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  q text := trim(coalesce(p_query, ''));
  v_ids uuid[];
  v_kind text;
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  if q = '' then
    return;
  end if;

  select array_agg(x.id), 'sku' into v_ids, v_kind
  from public.variants x
  where x.tenant_id = v_tenant and x.deleted_at is null and upper(x.sku) = upper(q);

  if v_ids is null then
    select array_agg(distinct c.variant_id), min(c.kind) into v_ids, v_kind
    from public.product_codes c
    join public.variants x on x.id = c.variant_id and x.deleted_at is null
    where c.tenant_id = v_tenant and upper(c.code) = upper(q);
  end if;

  if v_ids is null then
    select array_agg(s.id), 'texto' into v_ids, v_kind
    from (
      select x.id
      from public.variants x
      join public.products p on p.id = x.product_id and p.deleted_at is null
      where x.tenant_id = v_tenant and x.deleted_at is null
        and not exists (
          select 1 from regexp_split_to_table(app.fold(q), '\s+') w
          where w <> '' and position(w in app.fold(concat_ws(' ',
            p.name, p.brand, p.category, x.sku,
            (select string_agg(value, ' ') from jsonb_each_text(x.options)),
            (select string_agg(av.value, ' ')
               from public.product_attribute_values av
               join public.attribute_defs d on d.id = av.attribute_id and d.searchable
              where av.product_id = p.id)
          ))) = 0
        )
      order by p.name, x.sku
      limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) s;
  end if;

  return query
  select x.id, p.id, p.name, x.options, p.brand, x.sku,
         coalesce(x.price, x.regular_price), x.cost, x.unit, v_kind
  from public.variants x
  join public.products p on p.id = x.product_id
  where x.id = any (coalesce(v_ids, '{}'))
  order by p.name, x.sku;
end;
$function$;

-- customers_overview: igual que en 20261107000000_customers.sql, con app.fold.
create or replace function app.customers_overview(p_query text default null, p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(app.fold(trim(p_query)), '') as q,
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
      and (q.q is null or app.fold(c.name) like '%' || q.q || '%' or lower(coalesce(c.email, '')) like '%' || q.q || '%'
           or (q.k is not null and (c.doc_key like '%' || q.k || '%' or c.phone_key like '%' || q.k || '%')))
    group by c.id
    order by max(s.sold_at) desc nulls last, c.name
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_purchase desc nulls last, x.name), '[]'::jsonb) from x
$$;
