-- Etiquetas por unidad pendientes al recibir mercancía.
--
--   * Cada entrada de inventario (kind = 'entry') de un producto con etiqueta
--     por unidad deja piezas por etiquetar: lo que entró menos las etiquetas
--     activas generadas para esa entrada.
--   * Cuentan las entradas desde que se activó el producto
--     (products.track_units_since), no las de antes.
--   * item_labels.movement_id liga cada etiqueta con su entrada.
--   * Una entrada se puede descartar con motivo («ya venían etiquetadas»).
--   * No toca stock ni movimientos.

alter table public.products add column track_units_since timestamptz;
update public.products set track_units_since = now() where track_units and track_units_since is null;

alter table public.item_labels add column movement_id uuid references public.inventory_movements (id) on delete set null;
create index item_labels_movement_idx on public.item_labels (movement_id) where movement_id is not null;

create table public.item_label_dismissals (
  movement_id uuid primary key references public.inventory_movements (id) on delete cascade,
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 200),
  dismissed_by uuid default auth.uid(),
  dismissed_at timestamptz not null default now()
);
create index item_label_dismissals_tenant_idx on public.item_label_dismissals (tenant_id);
alter table public.item_label_dismissals enable row level security;
revoke all on public.item_label_dismissals from anon;
revoke insert, update, delete on public.item_label_dismissals from authenticated;
create policy tenant_read on public.item_label_dismissals for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Activar guarda desde cuándo: las entradas anteriores no quedan pendientes.
create or replace function app.set_product_track_units(p_product_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  select * into p from public.products where id = p_product_id and tenant_id = app.current_tenant_id() and deleted_at is null;
  if not found then
    raise exception 'Producto no encontrado' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(p.tenant_id, 'inventario.etiquetas') then
    raise exception 'No tienes permiso para las etiquetas por unidad' using errcode = 'insufficient_privilege';
  end if;
  if p_enabled and not exists (
    select 1 from public.variants v where v.product_id = p.id and v.deleted_at is null and not app.unit_is_measured(v.unit)
  ) then
    raise exception 'Este producto se vende por peso o medida: no lleva etiqueta por unidad' using errcode = 'check_violation';
  end if;
  update public.products
  set track_units = coalesce(p_enabled, false),
      track_units_since = case when coalesce(p_enabled, false) and not p.track_units then now() else track_units_since end
  where id = p.id;
end;
$$;

-- Piezas por etiquetar de una entrada (lo que entró menos las etiquetas activas ligadas).
create or replace function app.item_label_entry_pending(p_movement_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(0, floor(m.qty_delta)::integer
    - (select count(*) from public.item_labels l where l.movement_id = m.id and l.status <> 'disabled')::integer)
  from public.inventory_movements m
  where m.id = p_movement_id
$$;
revoke all on function app.item_label_entry_pending(uuid) from public;

-- Lista de llegadas por etiquetar.
create or replace function app.item_label_queue()
returns table (
  movement_id uuid, received_at timestamptz, location_name text, supplier text, note text,
  product_id uuid, product_name text, variant_id uuid, sku text, options jsonb,
  qty numeric, labeled integer, pending integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.created_at, loc.name, m.supplier, m.note,
         p.id, p.name, v.id, v.sku, v.options,
         m.qty_delta,
         floor(m.qty_delta)::integer - app.item_label_entry_pending(m.id),
         app.item_label_entry_pending(m.id)
  from public.inventory_movements m
  join public.variants v on v.id = m.variant_id and v.deleted_at is null
  join public.products p on p.id = v.product_id and p.track_units and p.deleted_at is null
  join public.locations loc on loc.id = m.location_id
  where m.tenant_id = app.current_tenant_id()
    and m.kind = 'entry' and m.qty_delta >= 1
    and m.created_at >= coalesce(p.track_units_since, 'infinity'::timestamptz)
    and not app.unit_is_measured(v.unit)
    and not exists (select 1 from public.item_label_dismissals d where d.movement_id = m.id)
    and app.item_label_entry_pending(m.id) > 0
  order by m.created_at desc
  limit 300
$$;
revoke all on function app.item_label_queue() from public;
grant execute on function app.item_label_queue() to authenticated;

create function public.item_label_queue()
returns table (
  movement_id uuid, received_at timestamptz, location_name text, supplier text, note text,
  product_id uuid, product_name text, variant_id uuid, sku text, options jsonb,
  qty numeric, labeled integer, pending integer
)
language sql security invoker set search_path = '' as $$ select * from app.item_label_queue() $$;
revoke all on function public.item_label_queue() from public, anon;
grant execute on function public.item_label_queue() to authenticated;

-- Descartar una llegada (no se etiqueta): queda registrado quién y por qué.
create or replace function app.dismiss_item_label_entry(p_movement_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.inventory_movements;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into m from public.inventory_movements where id = p_movement_id and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'Entrada no encontrada' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(m.tenant_id, 'inventario.etiquetas') then
    raise exception 'No tienes permiso para las etiquetas por unidad' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'Escribe el motivo' using errcode = 'check_violation';
  end if;
  insert into public.item_label_dismissals (movement_id, tenant_id, reason)
  values (m.id, m.tenant_id, left(v_reason, 200))
  on conflict (movement_id) do nothing;
end;
$$;
revoke all on function app.dismiss_item_label_entry(uuid, text) from public;
grant execute on function app.dismiss_item_label_entry(uuid, text) to authenticated;

create function public.dismiss_item_label_entry(p_movement_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select app.dismiss_item_label_entry(p_movement_id, p_reason) $$;
revoke all on function public.dismiss_item_label_entry(uuid, text) from public, anon;
grant execute on function public.dismiss_item_label_entry(uuid, text) to authenticated;

-- generate_item_labels: opcionalmente ligadas a una entrada (máximo lo pendiente).
drop function public.generate_item_labels(uuid, integer, text[], text);
drop function app.generate_item_labels(uuid, integer, text[], text);

create function app.generate_item_labels(
  p_variant_id uuid, p_quantity integer, p_serials text[] default null, p_origin text default 'manual',
  p_movement_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.variants;
  p public.products;
  m public.inventory_movements;
  v_sku text;
  v_last integer;
  v_serials text[];
  v_count integer;
  v_ids uuid[];
  v_origin text := p_origin;
begin
  select * into v from public.variants where id = p_variant_id and tenant_id = app.current_tenant_id() and deleted_at is null for update;
  if not found then
    raise exception 'Producto no encontrado' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(v.tenant_id, 'inventario.etiquetas') then
    raise exception 'No tienes permiso para las etiquetas por unidad' using errcode = 'insufficient_privilege';
  end if;
  select * into p from public.products where id = v.product_id;
  if not p.track_units then
    raise exception 'Activa la etiqueta por unidad en este producto' using errcode = 'check_violation';
  end if;
  if app.unit_is_measured(v.unit) then
    raise exception 'Se vende por peso o medida: no lleva etiqueta por unidad' using errcode = 'check_violation';
  end if;
  if p_movement_id is not null then
    select * into m from public.inventory_movements where id = p_movement_id and tenant_id = v.tenant_id for update;
    if not found or m.variant_id <> v.id or m.kind <> 'entry' then
      raise exception 'La entrada no corresponde a este producto' using errcode = 'check_violation';
    end if;
    v_origin := 'recepcion';
  end if;
  if coalesce(v_origin, '') !~ '^[a-z_]{1,30}$' then
    raise exception 'Origen no válido' using errcode = 'check_violation';
  end if;

  if p_serials is not null and cardinality(p_serials) > 0 then
    select array_agg(s order by ord) into v_serials
    from (select trim(x) as s, ord from unnest(p_serials) with ordinality as u(x, ord)) z
    where s <> '';
    v_count := coalesce(cardinality(v_serials), 0);
    if v_count = 0 then
      raise exception 'Escribe al menos un serial' using errcode = 'check_violation';
    end if;
  else
    v_count := p_quantity;
  end if;
  if p_movement_id is not null and coalesce(v_count, 0) > app.item_label_entry_pending(m.id) then
    raise exception 'A esta entrada le faltan % por etiquetar', app.item_label_entry_pending(m.id) using errcode = 'check_violation';
  end if;

  if v_serials is not null then
    if v_count > 500 then
      raise exception 'Máximo 500 etiquetas por vez' using errcode = 'check_violation';
    end if;
    if exists (select 1 from unnest(v_serials) s where length(s) > 64) then
      raise exception 'Un serial tiene más de 64 caracteres' using errcode = 'check_violation';
    end if;
    if (select count(distinct upper(s)) from unnest(v_serials) s) < v_count then
      raise exception 'Hay seriales repetidos en la lista' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.item_labels l join unnest(v_serials) s on upper(l.code) = upper(s) where l.tenant_id = v.tenant_id) then
      raise exception 'Ya existe una etiqueta con el serial %',
        (select s from unnest(v_serials) s join public.item_labels l on upper(l.code) = upper(s) and l.tenant_id = v.tenant_id limit 1)
        using errcode = 'unique_violation';
    end if;
    with ins as (
      insert into public.item_labels (tenant_id, variant_id, code, is_serial, origin, movement_id)
      select v.tenant_id, v.id, s, true, v_origin, p_movement_id from unnest(v_serials) with ordinality as u(s, ord) order by ord
      returning id
    )
    select array_agg(id) into v_ids from ins;
    return jsonb_build_object('created', v_count, 'ids', to_jsonb(v_ids));
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 500 then
    raise exception 'Entre 1 y 500 etiquetas por vez' using errcode = 'check_violation';
  end if;
  v_sku := upper(regexp_replace(trim(coalesce(v.sku, '')), '[^A-Za-z0-9-]+', '-', 'g'));
  if v_sku = '' then
    raise exception 'El producto necesita un SKU para numerar sus unidades' using errcode = 'check_violation';
  end if;
  select coalesce(max(unit_number), 0) into v_last from public.item_labels where variant_id = v.id;
  if exists (
    select 1 from public.item_labels l, generate_series(v_last + 1, v_last + p_quantity) n
    where l.tenant_id = v.tenant_id and upper(l.code) = v_sku || '-' || lpad(n::text, 5, '0')
  ) then
    raise exception 'Ya existe una etiqueta con un código de esta serie: cambia el SKU o usa seriales' using errcode = 'unique_violation';
  end if;
  with ins as (
    insert into public.item_labels (tenant_id, variant_id, unit_number, code, origin, movement_id)
    select v.tenant_id, v.id, n, v_sku || '-' || lpad(n::text, 5, '0'), v_origin, p_movement_id
    from generate_series(v_last + 1, v_last + p_quantity) n
    order by n
    returning id
  )
  select array_agg(id) into v_ids from ins;
  return jsonb_build_object('created', p_quantity, 'from', v_last + 1, 'to', v_last + p_quantity, 'ids', to_jsonb(v_ids));
end;
$$;
revoke all on function app.generate_item_labels(uuid, integer, text[], text, uuid) from public;
grant execute on function app.generate_item_labels(uuid, integer, text[], text, uuid) to authenticated;

create function public.generate_item_labels(
  p_variant_id uuid, p_quantity integer, p_serials text[] default null, p_origin text default 'manual',
  p_movement_id uuid default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.generate_item_labels(p_variant_id, p_quantity, p_serials, p_origin, p_movement_id)
$$;
revoke all on function public.generate_item_labels(uuid, integer, text[], text, uuid) from public, anon;
grant execute on function public.generate_item_labels(uuid, integer, text[], text, uuid) to authenticated;
