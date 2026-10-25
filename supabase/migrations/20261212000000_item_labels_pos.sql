-- Etiquetas por unidad en el POS: escanear la pieza, venderla y liberarla al
-- anular o devolver.
--
--   * catalog_lookup reconoce el código de una pieza (match_kind = 'unidad') y
--     devuelve su variante.
--   * item_labels.sale_item_id / sold_at: qué venta se llevó cada pieza. Una
--     pieza vendida no cuenta como «con etiqueta» en existencia.
--   * attach_sale_units(): después de registrar la venta, liga las piezas
--     escaneadas a sus líneas. Es tolerante: si una pieza ya se vendió o está
--     desactivada (p. ej. venta sin conexión que se sincroniza tarde), la
--     venta queda igual y esa pieza no se liga.
--   * Anular una venta libera sus piezas; una devolución libera tantas como
--     unidades devueltas de la línea (las últimas ligadas).
--   * El buscador muestra en qué venta salió cada pieza.

alter table public.item_labels
  add column sale_item_id uuid references public.sale_items (id) on delete set null,
  add column sold_at timestamptz;
create index item_labels_sale_item_idx on public.item_labels (sale_item_id) where sale_item_id is not null;

CREATE OR REPLACE FUNCTION app.catalog_lookup(p_query text, p_limit integer DEFAULT 30)
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

  -- Código de una pieza (etiqueta por unidad): lleva a su variante.
  if v_ids is null then
    select array_agg(distinct l.variant_id), 'unidad' into v_ids, v_kind
    from public.item_labels l
    join public.variants x on x.id = l.variant_id and x.deleted_at is null
    where l.tenant_id = v_tenant and upper(l.code) = upper(q);
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

create or replace function app.attach_sale_units(p_sale_id uuid, p_units jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sales;
  u jsonb;
  si record;
  v_variant uuid;
  v_ids uuid[];
  v_room integer;
  v_done integer := 0;
  v_n integer;
begin
  select * into s from public.sales where id = p_sale_id and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(s.tenant_id, 'pos.vender') then
    raise exception 'No tienes permiso para vender' using errcode = 'insufficient_privilege';
  end if;
  if s.status <> 'completed' or jsonb_typeof(coalesce(p_units, '[]'::jsonb)) <> 'array' then
    return 0;
  end if;

  for u in select * from jsonb_array_elements(p_units)
  loop
    v_variant := nullif(u ->> 'variant_id', '')::uuid;
    if v_variant is null or jsonb_typeof(u -> 'label_ids') <> 'array' then
      continue;
    end if;
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(u -> 'label_ids') x;
    for si in
      select i.id, floor(i.qty)::integer as qty from public.sale_items i
      where i.sale_id = s.id and i.variant_id = v_variant order by i.line
    loop
      v_room := si.qty - (select count(*) from public.item_labels l where l.sale_item_id = si.id)::integer;
      continue when v_room <= 0;
      with pick as (
        select l.id from public.item_labels l
        where l.tenant_id = s.tenant_id and l.variant_id = v_variant and l.id = any (v_ids)
          and l.status <> 'disabled' and l.sale_item_id is null
        order by array_position(v_ids, l.id)
        limit v_room
        for update
      )
      update public.item_labels l set sale_item_id = si.id, sold_at = s.sold_at
      from pick where l.id = pick.id;
      get diagnostics v_n = row_count;
      v_done := v_done + v_n;
    end loop;
  end loop;
  return v_done;
end;
$$;
revoke all on function app.attach_sale_units(uuid, jsonb) from public;
grant execute on function app.attach_sale_units(uuid, jsonb) to authenticated;

create function public.attach_sale_units(p_sale_id uuid, p_units jsonb)
returns integer language sql security invoker set search_path = '' as $$ select app.attach_sale_units(p_sale_id, p_units) $$;
revoke all on function public.attach_sale_units(uuid, jsonb) from public, anon;
grant execute on function public.attach_sale_units(uuid, jsonb) to authenticated;

-- Anular la venta: sus piezas vuelven a estar disponibles.
create or replace function app.release_units_on_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'voided' and old.status <> 'voided' then
    update public.item_labels l set sale_item_id = null, sold_at = null
    from public.sale_items i
    where i.sale_id = new.id and l.sale_item_id = i.id;
  end if;
  return new;
end;
$$;
revoke all on function app.release_units_on_void() from public;

create trigger sales_release_units_on_void
  after update of status on public.sales
  for each row execute function app.release_units_on_void();

-- Devolución: se liberan tantas piezas como unidades devueltas de la línea.
create or replace function app.release_units_on_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sale_item_id is not null and floor(new.qty) >= 1 then
    update public.item_labels l set sale_item_id = null, sold_at = null
    where l.id in (
      select x.id from public.item_labels x
      where x.sale_item_id = new.sale_item_id
      order by x.sold_at desc nulls last, x.code desc
      limit floor(new.qty)::integer
    );
  end if;
  return new;
end;
$$;
revoke all on function app.release_units_on_return() from public;

create trigger sale_return_items_release_units
  after insert on public.sale_return_items
  for each row execute function app.release_units_on_return();

-- Resumen: una pieza vendida ya no está en existencia.
create or replace function app.item_label_overview()
returns table (
  product_id uuid, product_name text, variant_id uuid, sku text, options jsonb, unit text,
  on_hand numeric, active_labels bigint, to_print bigint, disabled_labels bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, v.id, v.sku, v.options, v.unit,
         coalesce((select sum(s.on_hand) from public.stocks s where s.variant_id = v.id), 0),
         (select count(*) from public.item_labels l where l.variant_id = v.id and l.status <> 'disabled' and l.sale_item_id is null),
         (select count(*) from public.item_labels l where l.variant_id = v.id and l.status = 'generated' and l.sale_item_id is null),
         (select count(*) from public.item_labels l where l.variant_id = v.id and l.status = 'disabled')
  from public.products p
  join public.variants v on v.product_id = p.id and v.deleted_at is null
  where p.tenant_id = app.current_tenant_id() and p.track_units and p.deleted_at is null
  order by p.name, v.sku
$$;

-- Buscador: también en qué venta salió.
drop function public.search_item_labels(text);
drop function app.search_item_labels(text);

create function app.search_item_labels(p_query text)
returns table (
  id uuid, code text, is_serial boolean, status text, origin text, disabled_reason text,
  created_at timestamptz, printed_at timestamptz, disabled_at timestamptz,
  variant_id uuid, sku text, options jsonb, product_id uuid, product_name text,
  entry_at timestamptz, entry_note text, entry_supplier text, times_printed bigint,
  sale_id uuid, sale_number text, sold_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as raw)
  select l.id, l.code, l.is_serial, l.status, l.origin, l.disabled_reason,
         l.created_at, l.printed_at, l.disabled_at,
         v.id, v.sku, v.options, p.id, p.name,
         m.created_at, m.note, m.supplier,
         (select count(*) from public.label_print_jobs j where j.tenant_id = l.tenant_id and l.id = any (j.label_ids)),
         sa.id, sa.number, l.sold_at
  from q, public.item_labels l
  join public.variants v on v.id = l.variant_id
  join public.products p on p.id = v.product_id
  left join public.inventory_movements m on m.id = l.movement_id
  left join public.sale_items si on si.id = l.sale_item_id
  left join public.sales sa on sa.id = si.sale_id
  where l.tenant_id = app.current_tenant_id()
    and q.raw is not null and length(q.raw) >= 2
    and (upper(l.code) like '%' || upper(q.raw) || '%'
         or upper(coalesce(v.sku, '')) like '%' || upper(q.raw) || '%'
         or app.fold(p.name) like '%' || app.fold(q.raw) || '%')
  order by (upper(l.code) = upper(q.raw)) desc, p.name, l.unit_number nulls last, l.code
  limit 200
$$;
revoke all on function app.search_item_labels(text) from public;
grant execute on function app.search_item_labels(text) to authenticated;

create function public.search_item_labels(p_query text)
returns table (
  id uuid, code text, is_serial boolean, status text, origin text, disabled_reason text,
  created_at timestamptz, printed_at timestamptz, disabled_at timestamptz,
  variant_id uuid, sku text, options jsonb, product_id uuid, product_name text,
  entry_at timestamptz, entry_note text, entry_supplier text, times_printed bigint,
  sale_id uuid, sale_number text, sold_at timestamptz
)
language sql security invoker set search_path = '' as $$ select * from app.search_item_labels(p_query) $$;
revoke all on function public.search_item_labels(text) from public, anon;
grant execute on function public.search_item_labels(text) to authenticated;
