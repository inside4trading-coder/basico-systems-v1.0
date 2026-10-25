-- Etiquetas por unidad: cada pieza lleva su propio código (consecutivo o serial).
--
--   * products.track_units: se activa por producto. Los que se venden por peso
--     o medida (kg, litro, metro…) no llevan etiqueta por unidad.
--   * item_labels: una fila por pieza. Código único por negocio: SKU-00001 o el
--     serial del fabricante. Estados: generada, impresa, desactivada. Nunca se
--     borran; se desactivan con motivo.
--   * No crea inventario: el stock sigue por variante.
--   * Permiso nuevo «inventario.etiquetas» (admin y encargado por defecto) para
--     generar, marcar impresas y desactivar.

alter table public.products add column track_units boolean not null default false;

-- Unidades de peso o medida: no se etiquetan por pieza.
create or replace function app.unit_is_measured(p_unit text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(p_unit, ''), '[^a-zA-Z]', '', 'g')) in (
    'kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'g', 'gr', 'grs', 'gramo', 'gramos',
    'l', 'lt', 'lts', 'litro', 'litros', 'ml', 'mililitro', 'mililitros',
    'm', 'mt', 'mts', 'metro', 'metros', 'cm', 'centimetro', 'centimetros',
    'lb', 'lbs', 'libra', 'libras', 'oz', 'onza', 'onzas', 'gal', 'galon', 'galones'
  )
$$;
revoke all on function app.unit_is_measured(text) from public;

create table public.item_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  variant_id uuid not null,
  unit_number integer check (unit_number is null or unit_number > 0),
  code text not null check (length(code) between 1 and 64),
  is_serial boolean not null default false,
  status text not null default 'generated' check (status in ('generated', 'printed', 'disabled')),
  origin text not null default 'manual' check (origin ~ '^[a-z_]{1,30}$'),
  disabled_reason text check (disabled_reason is null or length(disabled_reason) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  disabled_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id) on delete cascade,
  check ((status = 'disabled') = (disabled_at is not null))
);
create unique index item_labels_code_uq on public.item_labels (tenant_id, upper(code));
create unique index item_labels_unit_uq on public.item_labels (variant_id, unit_number) where unit_number is not null;
create index item_labels_variant_idx on public.item_labels (variant_id, status);

alter table public.item_labels enable row level security;
revoke all on public.item_labels from anon;
revoke insert, update, delete on public.item_labels from authenticated;
create policy tenant_read on public.item_labels for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Permiso nuevo: etiquetas por unidad.
create or replace function app.capability_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'admin', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', true, 'caja.supervisar', true, 'caja.cupones', true, 'caja.cajeros', true,
      'catalogo.editar', true, 'catalogo.campos', true, 'inventario.minimos', true, 'inventario.conteos', true,
      'inventario.mover', true, 'inventario.firmar', true, 'inventario.todas_sedes', true, 'inventario.etiquetas', true,
      'reportes.ver', true, 'finanzas.operar', true, 'finanzas.anular', true, 'finanzas.cuentas', true,
      'config.negocio', true, 'config.sedes', true, 'equipo.gestionar', true,
      'fichaje.gestionar', true, 'fichaje.enlace', true, 'estudio.usar', true, 'estudio.configurar', true),
    'manager', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', true, 'caja.supervisar', true, 'caja.cupones', true, 'caja.cajeros', false,
      'catalogo.editar', true, 'catalogo.campos', false, 'inventario.minimos', true, 'inventario.conteos', true,
      'inventario.mover', true, 'inventario.firmar', false, 'inventario.todas_sedes', false, 'inventario.etiquetas', true,
      'reportes.ver', true, 'finanzas.operar', true, 'finanzas.anular', false, 'finanzas.cuentas', false,
      'config.negocio', false, 'config.sedes', false, 'equipo.gestionar', false,
      'fichaje.gestionar', true, 'fichaje.enlace', false, 'estudio.usar', true, 'estudio.configurar', false),
    'cajero', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', false, 'caja.supervisar', false, 'caja.cupones', false, 'caja.cajeros', false,
      'catalogo.editar', false, 'catalogo.campos', false, 'inventario.minimos', false, 'inventario.conteos', false,
      'inventario.mover', false, 'inventario.firmar', false, 'inventario.todas_sedes', false, 'inventario.etiquetas', false,
      'reportes.ver', false, 'finanzas.operar', false, 'finanzas.anular', false, 'finanzas.cuentas', false,
      'config.negocio', false, 'config.sedes', false, 'equipo.gestionar', false,
      'fichaje.gestionar', false, 'fichaje.enlace', false, 'estudio.usar', false, 'estudio.configurar', false)
  )
$$;

-- Activa o apaga la etiqueta por unidad de un producto.
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
  update public.products set track_units = coalesce(p_enabled, false) where id = p.id;
end;
$$;
revoke all on function app.set_product_track_units(uuid, boolean) from public;
grant execute on function app.set_product_track_units(uuid, boolean) to authenticated;

create function public.set_product_track_units(p_product_id uuid, p_enabled boolean)
returns void language sql security invoker set search_path = '' as $$ select app.set_product_track_units(p_product_id, p_enabled) $$;
revoke all on function public.set_product_track_units(uuid, boolean) from public, anon;
grant execute on function public.set_product_track_units(uuid, boolean) to authenticated;

-- Genera etiquetas para una variante: consecutivas (SKU-00001…) o con los
-- seriales que se escriben o escanean. Máximo 500 por vez.
create or replace function app.generate_item_labels(
  p_variant_id uuid, p_quantity integer, p_serials text[] default null, p_origin text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.variants;
  p public.products;
  v_sku text;
  v_last integer;
  v_serials text[];
  v_count integer;
  v_ids uuid[];
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
  if coalesce(p_origin, '') !~ '^[a-z_]{1,30}$' then
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
      insert into public.item_labels (tenant_id, variant_id, code, is_serial, origin)
      select v.tenant_id, v.id, s, true, p_origin from unnest(v_serials) with ordinality as u(s, ord) order by ord
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
    insert into public.item_labels (tenant_id, variant_id, unit_number, code, origin)
    select v.tenant_id, v.id, n, v_sku || '-' || lpad(n::text, 5, '0'), p_origin
    from generate_series(v_last + 1, v_last + p_quantity) n
    order by n
    returning id
  )
  select array_agg(id) into v_ids from ins;
  return jsonb_build_object('created', p_quantity, 'from', v_last + 1, 'to', v_last + p_quantity, 'ids', to_jsonb(v_ids));
end;
$$;
revoke all on function app.generate_item_labels(uuid, integer, text[], text) from public;
grant execute on function app.generate_item_labels(uuid, integer, text[], text) to authenticated;

create function public.generate_item_labels(
  p_variant_id uuid, p_quantity integer, p_serials text[] default null, p_origin text default 'manual'
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.generate_item_labels(p_variant_id, p_quantity, p_serials, p_origin)
$$;
revoke all on function public.generate_item_labels(uuid, integer, text[], text) from public, anon;
grant execute on function public.generate_item_labels(uuid, integer, text[], text) to authenticated;

-- Marca impresas (las desactivadas no cambian).
create or replace function app.mark_item_labels_printed(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_count integer;
begin
  if not app.has_capability(v_tenant, 'inventario.etiquetas') then
    raise exception 'No tienes permiso para las etiquetas por unidad' using errcode = 'insufficient_privilege';
  end if;
  update public.item_labels set status = 'printed', printed_at = coalesce(printed_at, now())
  where tenant_id = v_tenant and id = any (p_ids) and status <> 'disabled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.mark_item_labels_printed(uuid[]) from public;
grant execute on function app.mark_item_labels_printed(uuid[]) to authenticated;

create function public.mark_item_labels_printed(p_ids uuid[])
returns integer language sql security invoker set search_path = '' as $$ select app.mark_item_labels_printed(p_ids) $$;
revoke all on function public.mark_item_labels_printed(uuid[]) from public, anon;
grant execute on function public.mark_item_labels_printed(uuid[]) to authenticated;

-- Desactiva con motivo (pieza dañada, perdida, etiqueta mal impresa). No se borra.
create or replace function app.disable_item_labels(p_ids uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_count integer;
begin
  if not app.has_capability(v_tenant, 'inventario.etiquetas') then
    raise exception 'No tienes permiso para las etiquetas por unidad' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'Escribe el motivo' using errcode = 'check_violation';
  end if;
  update public.item_labels set status = 'disabled', disabled_at = now(), disabled_reason = left(v_reason, 200)
  where tenant_id = v_tenant and id = any (p_ids) and status <> 'disabled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.disable_item_labels(uuid[], text) from public;
grant execute on function app.disable_item_labels(uuid[], text) to authenticated;

create function public.disable_item_labels(p_ids uuid[], p_reason text)
returns integer language sql security invoker set search_path = '' as $$ select app.disable_item_labels(p_ids, p_reason) $$;
revoke all on function public.disable_item_labels(uuid[], text) from public, anon;
grant execute on function public.disable_item_labels(uuid[], text) to authenticated;

-- Resumen por variante de los productos por unidad: existencias y etiquetas.
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
         (select count(*) from public.item_labels l where l.variant_id = v.id and l.status <> 'disabled'),
         (select count(*) from public.item_labels l where l.variant_id = v.id and l.status = 'generated'),
         (select count(*) from public.item_labels l where l.variant_id = v.id and l.status = 'disabled')
  from public.products p
  join public.variants v on v.product_id = p.id and v.deleted_at is null
  where p.tenant_id = app.current_tenant_id() and p.track_units and p.deleted_at is null
  order by p.name, v.sku
$$;
revoke all on function app.item_label_overview() from public;
grant execute on function app.item_label_overview() to authenticated;

create function public.item_label_overview()
returns table (
  product_id uuid, product_name text, variant_id uuid, sku text, options jsonb, unit text,
  on_hand numeric, active_labels bigint, to_print bigint, disabled_labels bigint
)
language sql security invoker set search_path = '' as $$ select * from app.item_label_overview() $$;
revoke all on function public.item_label_overview() from public, anon;
grant execute on function public.item_label_overview() to authenticated;
