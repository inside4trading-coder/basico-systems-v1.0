-- Núcleo de catálogo e inventario.
--
-- Port del inventario de Sublime (basicosystems@f551478b:
-- 20260908002321 sublime_locations/products/variants/stocks,
-- 20260911163955 sublime_inventory_movements,
-- 20260925173947 sublime_inventory_entry/adjust/sign/lookup,
-- sublime_transfer_stock), generalizado:
--   * tenant_id en todo y RLS por membresía; escritura de catálogo solo
--     owner/admin/manager.
--   * variantes opcionales: todo producto tiene al menos una variante; las
--     opciones (talla, color, medida…) van en `options` jsonb, sin columnas fijas.
--   * cantidades numeric(14,3): se vende por unidad, metro o kilo.
--   * montos en la moneda base del tenant, sin sufijos _ref/_bs.
--   * códigos múltiples por variante, atributos propios por tenant y productos
--     relacionados: lo que distingue un rubro de otro es configuración.
--   * el stock solo cambia por las RPC de este archivo (un solo motor
--     auditable, regla heredada de AGENTS.md de basicosystems). El cliente no
--     tiene INSERT/UPDATE/DELETE sobre stocks ni movimientos.

-- ---------------------------------------------------------------------------
-- Sedes
-- ---------------------------------------------------------------------------

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  type text not null default 'store' check (type in ('store', 'warehouse', 'popup', 'external')),
  sells_in_pos boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, code),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  brand text,
  category text,
  description text,
  image_url text,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id)
);
create index products_tenant_name_idx on public.products (tenant_id, lower(name));

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id(),
  product_id uuid not null,
  -- {"Talla": "M", "Color": "Rojo"}; {} en un producto simple.
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  sku text,
  -- Precio de lista y precio vigente (oferta), en la moneda base del tenant.
  regular_price numeric(14, 2) check (regular_price is null or regular_price >= 0),
  price numeric(14, 2) check (price is null or price >= 0),
  discount_pct numeric(5, 2) generated always as (
    case
      when regular_price is null or price is null or regular_price <= 0 or price >= regular_price then 0
      else round(((regular_price - price) / regular_price) * 100, 2)
    end
  ) stored,
  cost numeric(14, 4) check (cost is null or cost >= 0),
  unit text not null default 'unidad',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create unique index variants_sku_uq on public.variants (tenant_id, upper(sku))
  where sku is not null and deleted_at is null;
create unique index variants_options_uq on public.variants (tenant_id, product_id, options)
  where deleted_at is null;
create index variants_product_idx on public.variants (product_id);

-- Códigos por variante: barras, interno, proveedor, número de parte… El tipo
-- lo nombra cada tenant; el buscador del POS mira todos.
create table public.product_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id(),
  variant_id uuid not null,
  kind text not null default 'barcode' check (kind ~ '^[a-z][a-z0-9_]{0,30}$'),
  code text not null check (length(trim(code)) > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id) on delete cascade
);
create unique index product_codes_uq on public.product_codes (tenant_id, kind, upper(code));
create index product_codes_lookup_idx on public.product_codes (tenant_id, upper(code));
create index product_codes_variant_idx on public.product_codes (variant_id);

-- Campos propios por tenant (marca del repuesto, principio activo, vehículo…).
create table public.attribute_defs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  label text not null check (length(trim(label)) > 0),
  type text not null default 'text' check (type in ('text', 'number', 'list')),
  choices text[],
  searchable boolean not null default true,
  multi boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id(),
  product_id uuid not null,
  attribute_id uuid not null,
  value text not null check (length(trim(value)) > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, attribute_id) references public.attribute_defs (tenant_id, id) on delete cascade,
  unique (product_id, attribute_id, value)
);
create index product_attribute_values_search_idx on public.product_attribute_values (tenant_id, lower(value));

create table public.product_relations (
  tenant_id uuid not null default app.current_tenant_id(),
  product_id uuid not null,
  related_product_id uuid not null,
  kind text not null check (kind in ('substitute', 'complement')),
  created_at timestamptz not null default now(),
  primary key (product_id, related_product_id, kind),
  check (product_id <> related_product_id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, related_product_id) references public.products (tenant_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Existencias y movimientos
-- ---------------------------------------------------------------------------

create table public.stocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  variant_id uuid not null,
  location_id uuid not null,
  on_hand numeric(14, 3) not null default 0 check (on_hand >= 0),
  reserved numeric(14, 3) not null default 0 check (reserved >= 0),
  available numeric(14, 3) generated always as (greatest(on_hand - reserved, 0)) stored,
  last_counted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (variant_id, location_id),
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade
);
create index stocks_tenant_location_idx on public.stocks (tenant_id, location_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  variant_id uuid not null,
  location_id uuid not null,
  kind text not null check (kind in ('entry', 'adjustment', 'transfer_out', 'transfer_in', 'count', 'sale', 'sale_return')),
  qty_before numeric(14, 3) not null,
  qty_delta numeric(14, 3) not null check (qty_delta <> 0),
  qty_after numeric(14, 3) not null check (qty_after >= 0),
  reason text,
  note text,
  supplier text,
  expected_qty numeric(14, 3),
  unit_cost numeric(14, 4),
  unit_price numeric(14, 2),
  transfer_id uuid,
  corrects_movement_id uuid references public.inventory_movements (id),
  signature_status text not null default 'n/a' check (signature_status in ('n/a', 'pending', 'signed')),
  signed_by uuid,
  signed_at timestamptz,
  signature_note text,
  performed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade
);
create index inventory_movements_tenant_created_idx on public.inventory_movements (tenant_id, created_at desc);
create index inventory_movements_variant_idx on public.inventory_movements (variant_id, location_id);
create index inventory_movements_pending_idx on public.inventory_movements (tenant_id, created_at desc)
  where signature_status = 'pending';

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create trigger locations_touch before update on public.locations
  for each row execute function app.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();
create trigger variants_touch before update on public.variants
  for each row execute function app.touch_updated_at();
create trigger attribute_defs_touch before update on public.attribute_defs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.product_codes enable row level security;
alter table public.attribute_defs enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_relations enable row level security;
alter table public.stocks enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on
  public.locations, public.products, public.variants, public.product_codes,
  public.attribute_defs, public.product_attribute_values, public.product_relations,
  public.stocks, public.inventory_movements
from anon;

-- Borrado lógico: nadie borra filas de catálogo, sedes ni existencias desde el cliente.
revoke delete on public.locations, public.products, public.variants, public.attribute_defs from authenticated;
-- Stock y movimientos: solo lectura; cambian por RPC.
revoke insert, update, delete on public.stocks, public.inventory_movements from authenticated;

-- Lectura: cualquier miembro del tenant.
create policy tenant_read on public.locations for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.products for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.variants for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.product_codes for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.attribute_defs for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.product_attribute_values for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.product_relations for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.stocks for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy tenant_read on public.inventory_movements for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));

-- Escritura de catálogo y sedes: owner, admin o manager del tenant.
create policy catalog_insert on public.locations for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy catalog_update on public.locations for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));

create policy catalog_insert on public.products for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_update on public.products for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

create policy catalog_insert on public.variants for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_update on public.variants for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

create policy catalog_insert on public.product_codes for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_update on public.product_codes for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_delete on public.product_codes for delete to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

create policy catalog_insert on public.attribute_defs for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy catalog_update on public.attribute_defs for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));

create policy catalog_insert on public.product_attribute_values for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_delete on public.product_attribute_values for delete to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

create policy catalog_insert on public.product_relations for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_delete on public.product_relations for delete to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

-- ---------------------------------------------------------------------------
-- Motor de movimientos (RPC)
--
-- Toda RPC deduce el tenant de la variante, exige rol en ESE tenant y que la
-- sede sea del mismo tenant. Bloquea la fila de stock (FOR UPDATE) antes de
-- leerla para que dos movimientos simultáneos no se pisen.
-- ---------------------------------------------------------------------------

create or replace function app.stock_row_for_update(p_tenant_id uuid, p_variant_id uuid, p_location_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on_hand numeric;
begin
  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.tenant_id = p_tenant_id and l.deleted_at is null
  ) then
    raise exception 'Sede no encontrada' using errcode = 'no_data_found';
  end if;

  insert into public.stocks (tenant_id, variant_id, location_id)
  values (p_tenant_id, p_variant_id, p_location_id)
  on conflict (variant_id, location_id) do nothing;

  select s.on_hand into v_on_hand
  from public.stocks s
  where s.variant_id = p_variant_id and s.location_id = p_location_id
  for update;

  return v_on_hand;
end;
$$;
revoke all on function app.stock_row_for_update(uuid, uuid, uuid) from public;

-- Variante activa del tenant del usuario con alguno de los roles dados.
create or replace function app.variant_for_write(p_variant_id uuid, p_roles text[])
returns public.variants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.variants;
begin
  select * into v from public.variants where id = p_variant_id and deleted_at is null;
  if not found then
    raise exception 'Variante no encontrada' using errcode = 'no_data_found';
  end if;
  if not app.has_tenant_role(v.tenant_id, p_roles) then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  return v;
end;
$$;
revoke all on function app.variant_for_write(uuid, text[]) from public;

-- Entrada de mercancía (compra, recepción, restock).
create or replace function public.inventory_entry(
  p_variant_id uuid,
  p_location_id uuid,
  p_qty numeric,
  p_unit_cost numeric default null,
  p_supplier text default null,
  p_note text default null,
  p_expected_qty numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.variants;
  v_before numeric;
  v_after numeric;
  v_mov uuid;
begin
  v := app.variant_for_write(p_variant_id, array['owner', 'admin', 'manager']);
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then
    raise exception 'Cantidad inválida' using errcode = 'check_violation';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Costo inválido' using errcode = 'check_violation';
  end if;

  v_before := app.stock_row_for_update(v.tenant_id, v.id, p_location_id);
  v_after := v_before + p_qty;

  update public.stocks set on_hand = v_after, updated_at = now()
  where variant_id = v.id and location_id = p_location_id;

  insert into public.inventory_movements (
    tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after,
    note, supplier, expected_qty, unit_cost, unit_price, performed_by
  ) values (
    v.tenant_id, v.id, p_location_id, 'entry', v_before, p_qty, v_after,
    nullif(trim(p_note), ''), nullif(trim(p_supplier), ''), p_expected_qty,
    coalesce(p_unit_cost, v.cost), coalesce(v.price, v.regular_price), auth.uid()
  ) returning id into v_mov;

  return jsonb_build_object('movement_id', v_mov, 'before', v_before, 'after', v_after);
end;
$$;
comment on function public.inventory_entry(uuid, uuid, numeric, numeric, text, text, numeric)
  is '@rpc Entrada de mercancía. Rol owner/admin/manager en el tenant de la variante.';

-- Ajuste manual: aplica al instante y queda pendiente de firma.
create or replace function public.inventory_adjust(
  p_variant_id uuid,
  p_location_id uuid,
  p_delta numeric,
  p_reason text,
  p_note text default null,
  p_corrects_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.variants;
  v_before numeric;
  v_after numeric;
  v_mov uuid;
begin
  v := app.variant_for_write(p_variant_id, array['owner', 'admin', 'manager']);
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad no puede ser 0' using errcode = 'check_violation';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'El motivo es obligatorio' using errcode = 'check_violation';
  end if;
  if p_corrects_id is not null and not exists (
    select 1 from public.inventory_movements m
    where m.id = p_corrects_id and m.tenant_id = v.tenant_id and m.kind = 'adjustment'
  ) then
    raise exception 'El ajuste a corregir no existe' using errcode = 'no_data_found';
  end if;

  v_before := app.stock_row_for_update(v.tenant_id, v.id, p_location_id);
  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'Stock insuficiente: hay % y quieres restar %', v_before, abs(p_delta)
      using errcode = 'check_violation';
  end if;

  update public.stocks set on_hand = v_after, updated_at = now()
  where variant_id = v.id and location_id = p_location_id;

  insert into public.inventory_movements (
    tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after,
    reason, note, unit_cost, unit_price, signature_status, corrects_movement_id, performed_by
  ) values (
    v.tenant_id, v.id, p_location_id, 'adjustment', v_before, p_delta, v_after,
    trim(p_reason), nullif(trim(p_note), ''), v.cost, coalesce(v.price, v.regular_price),
    'pending', p_corrects_id, auth.uid()
  ) returning id into v_mov;

  return jsonb_build_object('movement_id', v_mov, 'before', v_before, 'after', v_after);
end;
$$;
comment on function public.inventory_adjust(uuid, uuid, numeric, text, text, uuid)
  is '@rpc Ajuste manual pendiente de firma. Rol owner/admin/manager.';

-- Firma de un ajuste: owner o admin, y nunca quien lo hizo.
create or replace function public.inventory_sign(p_movement_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.inventory_movements;
begin
  select * into m from public.inventory_movements where id = p_movement_id for update;
  if not found or not app.has_tenant_role(m.tenant_id, array['owner', 'admin']) then
    raise exception 'Solo un dueño o administrador puede firmar' using errcode = 'insufficient_privilege';
  end if;
  if m.signature_status <> 'pending' then
    raise exception 'El ajuste no está pendiente de firma' using errcode = 'check_violation';
  end if;
  if m.performed_by = auth.uid() then
    raise exception 'Un ajuste lo firma otra persona, no quien lo hizo' using errcode = 'check_violation';
  end if;

  update public.inventory_movements
  set signature_status = 'signed', signed_by = auth.uid(), signed_at = now(),
      signature_note = nullif(trim(p_note), '')
  where id = p_movement_id;
end;
$$;
comment on function public.inventory_sign(uuid, text)
  is '@rpc Firma de ajuste. Owner/admin del tenant, distinto de quien ajustó.';

-- Traslado entre sedes del mismo tenant, atómico.
create or replace function public.inventory_transfer(
  p_variant_id uuid,
  p_from_location uuid,
  p_to_location uuid,
  p_qty numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.variants;
  v_from_before numeric;
  v_from_available numeric;
  v_to_before numeric;
  v_transfer uuid := gen_random_uuid();
begin
  v := app.variant_for_write(p_variant_id, array['owner', 'admin', 'manager']);
  if p_from_location is null or p_to_location is null or p_from_location = p_to_location then
    raise exception 'El origen y el destino deben ser sedes distintas' using errcode = 'check_violation';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'La cantidad debe ser mayor que cero' using errcode = 'check_violation';
  end if;

  -- Orden fijo de bloqueo para que dos traslados cruzados no se bloqueen entre sí.
  if p_from_location < p_to_location then
    v_from_before := app.stock_row_for_update(v.tenant_id, v.id, p_from_location);
    v_to_before := app.stock_row_for_update(v.tenant_id, v.id, p_to_location);
  else
    v_to_before := app.stock_row_for_update(v.tenant_id, v.id, p_to_location);
    v_from_before := app.stock_row_for_update(v.tenant_id, v.id, p_from_location);
  end if;

  select s.available into v_from_available
  from public.stocks s where s.variant_id = v.id and s.location_id = p_from_location;
  if p_qty > v_from_available then
    raise exception 'Solo hay % disponibles en el origen', v_from_available using errcode = 'check_violation';
  end if;

  update public.stocks set on_hand = v_from_before - p_qty, updated_at = now()
  where variant_id = v.id and location_id = p_from_location;
  update public.stocks set on_hand = v_to_before + p_qty, updated_at = now()
  where variant_id = v.id and location_id = p_to_location;

  insert into public.inventory_movements (
    tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after,
    note, unit_cost, unit_price, transfer_id, performed_by
  ) values
    (v.tenant_id, v.id, p_from_location, 'transfer_out', v_from_before, -p_qty, v_from_before - p_qty,
     nullif(trim(p_note), ''), v.cost, coalesce(v.price, v.regular_price), v_transfer, auth.uid()),
    (v.tenant_id, v.id, p_to_location, 'transfer_in', v_to_before, p_qty, v_to_before + p_qty,
     nullif(trim(p_note), ''), v.cost, coalesce(v.price, v.regular_price), v_transfer, auth.uid());

  return jsonb_build_object('transfer_id', v_transfer, 'from_after', v_from_before - p_qty, 'to_after', v_to_before + p_qty);
end;
$$;
comment on function public.inventory_transfer(uuid, uuid, uuid, numeric, text)
  is '@rpc Traslado entre sedes del mismo tenant. Rol owner/admin/manager.';

-- Búsqueda para escáner y buscador: código exacto (SKU o cualquier código),
-- y si no hay, texto en nombre, marca, categoría, opciones y atributos
-- buscables. Solo dentro del tenant activo.
create or replace function public.catalog_lookup(p_query text, p_limit integer default 30)
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  options jsonb,
  brand text,
  sku text,
  price numeric,
  cost numeric,
  unit text,
  match_kind text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
          select 1 from regexp_split_to_table(lower(q), '\s+') w
          where w <> '' and position(w in lower(concat_ws(' ',
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
$$;
comment on function public.catalog_lookup(text, integer)
  is '@rpc Buscador de catálogo del tenant activo (header x-tenant-id).';

revoke all on function public.inventory_entry(uuid, uuid, numeric, numeric, text, text, numeric) from public, anon;
revoke all on function public.inventory_adjust(uuid, uuid, numeric, text, text, uuid) from public, anon;
revoke all on function public.inventory_sign(uuid, text) from public, anon;
revoke all on function public.inventory_transfer(uuid, uuid, uuid, numeric, text) from public, anon;
revoke all on function public.catalog_lookup(text, integer) from public, anon;
grant execute on function public.inventory_entry(uuid, uuid, numeric, numeric, text, text, numeric) to authenticated;
grant execute on function public.inventory_adjust(uuid, uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.inventory_sign(uuid, text) to authenticated;
grant execute on function public.inventory_transfer(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.catalog_lookup(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Vista para historial, firmas y reportes (respeta la RLS de quien consulta)
-- ---------------------------------------------------------------------------

create view public.inventory_control_v with (security_invoker = true) as
select
  m.id, m.tenant_id, m.created_at, m.variant_id, m.location_id, l.name as location_name,
  m.kind, m.qty_before, m.qty_delta, m.qty_after, m.reason, m.note, m.supplier, m.expected_qty,
  m.unit_cost, m.unit_price, m.transfer_id, m.corrects_movement_id,
  m.signature_status, m.signed_by, m.signed_at, m.signature_note,
  m.performed_by, pm.email as performed_by_email, sm.email as signed_by_email,
  x.sku, x.options, p.id as product_id, p.name as product_name, p.brand, p.category
from public.inventory_movements m
join public.variants x on x.id = m.variant_id
join public.products p on p.id = x.product_id
join public.locations l on l.id = m.location_id
left join public.tenant_members pm on pm.tenant_id = m.tenant_id and pm.user_id = m.performed_by
left join public.tenant_members sm on sm.tenant_id = m.tenant_id and sm.user_id = m.signed_by;

revoke all on public.inventory_control_v from anon;
grant select on public.inventory_control_v to authenticated;
