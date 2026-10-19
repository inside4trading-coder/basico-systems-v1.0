-- Importación de catálogo y existencias desde Excel/CSV.
--
-- Port de sublime_apply_inventory_import + sublime_inventory_import_jobs
-- (basicosystems@f551478b, 20260920225310) y de la idea de plantillas de
-- core_import_templates (columna del archivo → campo interno), generalizado:
--   * el mapeo de columnas se guarda por tenant (import_templates) y se
--     reutiliza: el segundo cliente del mismo rubro se carga en minutos.
--   * todo o nada: si una fila falla en el servidor, no se aplica ninguna.
--   * el mismo archivo (huella SHA-256) no se aplica dos veces por tenant.
--   * las existencias no se escriben directo: cada sede queda con un
--     movimiento 'count' (conteo) en el kardex, como cualquier cambio de stock.

create table public.import_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- {"Columna del archivo": "campo interno"}; ver src/modules/inventory/import/fields.ts
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  file_name text not null,
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  total_rows integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, file_hash)
);

create trigger import_templates_touch before update on public.import_templates
  for each row execute function app.touch_updated_at();

alter table public.import_templates enable row level security;
alter table public.import_jobs enable row level security;
revoke all on public.import_templates, public.import_jobs from anon;
revoke insert, update, delete on public.import_jobs from authenticated;

create policy tenant_read on public.import_templates for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy catalog_insert on public.import_templates for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_update on public.import_templates for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy catalog_delete on public.import_templates for delete to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

create policy tenant_read on public.import_jobs for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));

-- Fila (ya normalizada por el cliente, revalidada aquí):
-- {
--   "row_number": 2,
--   "product_key": "pastillas de freno",
--   "sku": "PF-001",                       -- opcional si trae códigos
--   "product": {"name": "...", "brand": "...", "category": "...", "description": "...", "is_active": true},
--   "variant": {"options": {"Talla": "M"}, "regular_price": 30, "price": 25, "cost": 12, "unit": "unidad", "is_active": true},
--   "codes": [{"kind": "barcode", "code": "779..."}],
--   "attributes": [{"key": "vehiculo", "value": "Hilux 2010"}],
--   "stock": [{"location_code": "T1", "qty": 6}]
-- }
-- En "product" y "variant" solo vienen las celdas con valor: al actualizar,
-- una celda vacía conserva lo que había.
create or replace function app.catalog_import(p_file_name text, p_file_hash text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_job public.import_jobs;
  v_row jsonb;
  v_n integer;
  v_sku text;
  v_key text;
  v_product jsonb;
  v_variant jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_products jsonb := '{}'::jsonb;
  v_code jsonb;
  v_owner uuid;
  v_attr jsonb;
  v_def public.attribute_defs;
  v_stock jsonb;
  v_location uuid;
  v_before numeric;
  v_qty numeric;
  v_unit_cost numeric;
  v_unit_price numeric;
  c_products_created integer := 0;
  c_products_updated integer := 0;
  c_variants_created integer := 0;
  c_variants_updated integer := 0;
  c_stock_rows integer := 0;
  v_result jsonb;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Huella de archivo inválida' using errcode = 'check_violation';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'El archivo no tiene filas para importar' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'Máximo 20.000 filas por archivo' using errcode = 'check_violation';
  end if;

  select * into v_job from public.import_jobs where tenant_id = v_tenant and file_hash = p_file_hash;
  if found then
    return v_job.result || jsonb_build_object('job_id', v_job.id, 'already_applied', true);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_n := (v_row ->> 'row_number')::integer;
    v_sku := nullif(trim(v_row ->> 'sku'), '');
    v_key := lower(trim(coalesce(v_row ->> 'product_key', v_row -> 'product' ->> 'name', '')));
    v_product := coalesce(v_row -> 'product', '{}'::jsonb);
    v_variant := coalesce(v_row -> 'variant', '{}'::jsonb);
    v_product_id := null;
    v_variant_id := null;

    -- ¿Ya existe? Con SKU, solo por SKU (un SKU nuevo es un producto nuevo,
    -- aunque traiga un código ajeno: eso es un error, no un cambio de SKU).
    -- Sin SKU, por cualquiera de sus códigos.
    if v_sku is not null then
      select x.id, x.product_id into v_variant_id, v_product_id
      from public.variants x
      where x.tenant_id = v_tenant and x.deleted_at is null and upper(x.sku) = upper(v_sku)
      for update;
    else
      select c.variant_id, x.product_id into v_variant_id, v_product_id
      from jsonb_array_elements(coalesce(v_row -> 'codes', '[]'::jsonb)) rc
      join public.product_codes c
        on c.tenant_id = v_tenant and c.kind = rc ->> 'kind' and upper(c.code) = upper(trim(rc ->> 'code'))
      join public.variants x on x.id = c.variant_id and x.deleted_at is null
      limit 1;
    end if;

    if v_variant_id is not null then
      if v_product <> '{}'::jsonb then
        update public.products set
          name = coalesce(nullif(trim(v_product ->> 'name'), ''), name),
          brand = case when v_product ? 'brand' then nullif(trim(v_product ->> 'brand'), '') else brand end,
          category = case when v_product ? 'category' then nullif(trim(v_product ->> 'category'), '') else category end,
          description = case when v_product ? 'description' then nullif(trim(v_product ->> 'description'), '') else description end,
          is_active = coalesce((v_product ->> 'is_active')::boolean, is_active)
        where id = v_product_id;
        c_products_updated := c_products_updated + 1;
      end if;
      update public.variants set
        sku = coalesce(v_sku, sku),
        options = coalesce(v_variant -> 'options', options),
        regular_price = coalesce((v_variant ->> 'regular_price')::numeric, regular_price),
        price = coalesce((v_variant ->> 'price')::numeric, price),
        cost = coalesce((v_variant ->> 'cost')::numeric, cost),
        unit = coalesce(nullif(trim(v_variant ->> 'unit'), ''), unit),
        is_active = coalesce((v_variant ->> 'is_active')::boolean, is_active)
      where id = v_variant_id;
      c_variants_updated := c_variants_updated + 1;
    else
      if nullif(trim(v_product ->> 'name'), '') is null then
        raise exception 'Fila %: falta el nombre para crear el producto', v_n using errcode = 'check_violation';
      end if;
      v_product_id := nullif(v_products ->> v_key, '')::uuid;
      if v_product_id is null then
        insert into public.products (tenant_id, name, brand, category, description, is_active)
        values (
          v_tenant, trim(v_product ->> 'name'), nullif(trim(v_product ->> 'brand'), ''),
          nullif(trim(v_product ->> 'category'), ''), nullif(trim(v_product ->> 'description'), ''),
          coalesce((v_product ->> 'is_active')::boolean, true)
        ) returning id into v_product_id;
        v_products := v_products || jsonb_build_object(v_key, v_product_id);
        c_products_created := c_products_created + 1;
      end if;
      begin
        insert into public.variants (tenant_id, product_id, options, sku, regular_price, price, cost, unit, is_active)
        values (
          v_tenant, v_product_id, coalesce(v_variant -> 'options', '{}'::jsonb), v_sku,
          (v_variant ->> 'regular_price')::numeric,
          coalesce((v_variant ->> 'price')::numeric, (v_variant ->> 'regular_price')::numeric),
          (v_variant ->> 'cost')::numeric,
          coalesce(nullif(trim(v_variant ->> 'unit'), ''), 'unidad'),
          coalesce((v_variant ->> 'is_active')::boolean, true)
        ) returning id into v_variant_id;
      exception when unique_violation then
        raise exception 'Fila %: ese producto ya tiene una variante con las mismas opciones', v_n
          using errcode = 'unique_violation';
      end;
      c_variants_created := c_variants_created + 1;
    end if;

    -- Códigos: se agregan; si el código ya es de otro producto, se detiene todo.
    for v_code in select * from jsonb_array_elements(coalesce(v_row -> 'codes', '[]'::jsonb))
    loop
      select c.variant_id into v_owner
      from public.product_codes c
      where c.tenant_id = v_tenant and c.kind = v_code ->> 'kind' and upper(c.code) = upper(trim(v_code ->> 'code'));
      if v_owner is null then
        insert into public.product_codes (tenant_id, variant_id, kind, code)
        values (v_tenant, v_variant_id, v_code ->> 'kind', trim(v_code ->> 'code'));
      elsif v_owner <> v_variant_id then
        raise exception 'Fila %: el código % ya pertenece a otro producto', v_n, v_code ->> 'code'
          using errcode = 'unique_violation';
      end if;
      v_owner := null;
    end loop;

    -- Campos propios: un valor por campo, salvo los de valores múltiples.
    for v_attr in select * from jsonb_array_elements(coalesce(v_row -> 'attributes', '[]'::jsonb))
    loop
      select * into v_def from public.attribute_defs d where d.tenant_id = v_tenant and d.key = v_attr ->> 'key';
      if not found then
        raise exception 'Fila %: el campo % no existe en el catálogo', v_n, v_attr ->> 'key'
          using errcode = 'no_data_found';
      end if;
      if not v_def.multi then
        delete from public.product_attribute_values where product_id = v_product_id and attribute_id = v_def.id;
      end if;
      insert into public.product_attribute_values (tenant_id, product_id, attribute_id, value)
      values (v_tenant, v_product_id, v_def.id, trim(v_attr ->> 'value'))
      on conflict (product_id, attribute_id, value) do nothing;
    end loop;

    -- Existencias por sede: se deja la cantidad contada y queda el movimiento.
    for v_stock in select * from jsonb_array_elements(coalesce(v_row -> 'stock', '[]'::jsonb))
    loop
      v_qty := (v_stock ->> 'qty')::numeric;
      if v_qty is null or v_qty < 0 then
        raise exception 'Fila %: existencia inválida', v_n using errcode = 'check_violation';
      end if;
      select l.id into v_location from public.locations l
      where l.tenant_id = v_tenant and l.code = upper(trim(v_stock ->> 'location_code')) and l.deleted_at is null;
      if v_location is null then
        raise exception 'Fila %: la sede % no existe', v_n, v_stock ->> 'location_code' using errcode = 'no_data_found';
      end if;

      v_before := app.stock_row_for_update(v_tenant, v_variant_id, v_location);
      if v_qty <> v_before then
        select x.cost, coalesce(x.price, x.regular_price) into v_unit_cost, v_unit_price
        from public.variants x where x.id = v_variant_id;
        update public.stocks set on_hand = v_qty, last_counted_at = now(), updated_at = now()
        where variant_id = v_variant_id and location_id = v_location;
        insert into public.inventory_movements (
          tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after,
          note, unit_cost, unit_price, performed_by
        ) values (
          v_tenant, v_variant_id, v_location, 'count', v_before, v_qty - v_before, v_qty,
          'Importación: ' || coalesce(nullif(trim(p_file_name), ''), 'archivo'), v_unit_cost, v_unit_price, auth.uid()
        );
        c_stock_rows := c_stock_rows + 1;
      end if;
      v_location := null;
    end loop;
  end loop;

  v_result := jsonb_build_object(
    'products_created', c_products_created,
    'products_updated', c_products_updated,
    'variants_created', c_variants_created,
    'variants_updated', c_variants_updated,
    'stock_rows_applied', c_stock_rows
  );

  insert into public.import_jobs (tenant_id, file_name, file_hash, total_rows, result)
  values (v_tenant, coalesce(nullif(trim(p_file_name), ''), 'archivo'), p_file_hash, jsonb_array_length(p_rows), v_result)
  returning * into v_job;

  return v_result || jsonb_build_object('job_id', v_job.id, 'already_applied', false);
end;
$$;
comment on function app.catalog_import(text, text, jsonb) is 'Importación de catálogo y existencias del tenant activo. Owner/admin/manager. Todo o nada.';
revoke all on function app.catalog_import(text, text, jsonb) from public;
grant execute on function app.catalog_import(text, text, jsonb) to authenticated;

create function public.catalog_import(p_file_name text, p_file_hash text, p_rows jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.catalog_import(p_file_name, p_file_hash, p_rows)
$$;
revoke all on function public.catalog_import(text, text, jsonb) from public, anon;
grant execute on function public.catalog_import(text, text, jsonb) to authenticated;

-- 'count' como tipo de movimiento ya existe en inventory_movements; la vista
-- de control lo muestra como "Conteo".
