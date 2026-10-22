-- Permisos por rol configurables (matriz rol × capacidad en Equipo).
--
--   * Las capacidades y sus valores por defecto viven en
--     app.capability_defaults() y en src/core/capabilities.ts (un test compara
--     ambos). Los defaults son exactamente los permisos fijos que había antes:
--     sin tocar la matriz, nada cambia.
--   * role_capabilities guarda solo las excepciones de cada negocio.
--   * El owner siempre puede todo y es el único que edita la matriz.
--   * Cada chequeo de rol de la base (has_tenant_role con una lista de roles)
--     pasa a app.has_capability(negocio, capacidad). Lo que solo puede hacer
--     un owner (dar o tocar el rol owner) sigue igual.

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
      'inventario.mover', true, 'inventario.firmar', true, 'inventario.todas_sedes', true,
      'reportes.ver', true, 'finanzas.operar', true, 'finanzas.anular', true, 'finanzas.cuentas', true,
      'config.negocio', true, 'config.sedes', true, 'equipo.gestionar', true,
      'fichaje.gestionar', true, 'fichaje.enlace', true, 'estudio.usar', true, 'estudio.configurar', true),
    'manager', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', true, 'caja.supervisar', true, 'caja.cupones', true, 'caja.cajeros', false,
      'catalogo.editar', true, 'catalogo.campos', false, 'inventario.minimos', true, 'inventario.conteos', true,
      'inventario.mover', true, 'inventario.firmar', false, 'inventario.todas_sedes', false,
      'reportes.ver', true, 'finanzas.operar', true, 'finanzas.anular', false, 'finanzas.cuentas', false,
      'config.negocio', false, 'config.sedes', false, 'equipo.gestionar', false,
      'fichaje.gestionar', true, 'fichaje.enlace', false, 'estudio.usar', true, 'estudio.configurar', false),
    'cajero', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', false, 'caja.supervisar', false, 'caja.cupones', false, 'caja.cajeros', false,
      'catalogo.editar', false, 'catalogo.campos', false, 'inventario.minimos', false, 'inventario.conteos', false,
      'inventario.mover', false, 'inventario.firmar', false, 'inventario.todas_sedes', false,
      'reportes.ver', false, 'finanzas.operar', false, 'finanzas.anular', false, 'finanzas.cuentas', false,
      'config.negocio', false, 'config.sedes', false, 'equipo.gestionar', false,
      'fichaje.gestionar', false, 'fichaje.enlace', false, 'estudio.usar', false, 'estudio.configurar', false)
  )
$$;

create table public.role_capabilities (
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'cajero')),
  capability text not null check (capability ~ '^[a-z_]+\.[a-z_]+$'),
  allowed boolean not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, role, capability)
);
alter table public.role_capabilities enable row level security;
revoke all on public.role_capabilities from anon;
revoke insert, update, delete on public.role_capabilities from authenticated;
-- Todo el equipo lee la matriz (la app la usa para mostrar u ocultar acciones).
create policy tenant_read on public.role_capabilities for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- ¿Quien llama puede hacer esto en este negocio? El owner siempre.
create or replace function app.has_capability(p_tenant_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and t.deleted_at is null
      and (m.role = 'owner'
           or coalesce(
                (select rc.allowed from public.role_capabilities rc
                 where rc.tenant_id = m.tenant_id and rc.role = m.role and rc.capability = p_capability),
                (app.capability_defaults() -> m.role ->> p_capability)::boolean,
                false))
  )
$$;
revoke all on function app.has_capability(uuid, text) from public;
grant execute on function app.has_capability(uuid, text) to authenticated;

create function public.has_capability(p_tenant_id uuid, p_capability text)
returns boolean language sql security invoker set search_path = '' as $$ select app.has_capability(p_tenant_id, p_capability) $$;
revoke all on function public.has_capability(uuid, text) from public, anon;
grant execute on function public.has_capability(uuid, text) to authenticated;

-- Capacidades de quien llama en el negocio activo (la app las usa para el menú y los botones).
create or replace function app.my_capabilities()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(k order by k), '{}')
  from jsonb_object_keys(app.capability_defaults() -> 'admin') k
  where app.has_capability(app.current_tenant_id(), k)
$$;
revoke all on function app.my_capabilities() from public;
grant execute on function app.my_capabilities() to authenticated;

create function public.my_capabilities()
returns text[] language sql security invoker set search_path = '' as $$ select app.my_capabilities() $$;
revoke all on function public.my_capabilities() from public, anon;
grant execute on function public.my_capabilities() to authenticated;

-- El owner marca o desmarca una capacidad para un rol. null vuelve al default.
create or replace function app.set_role_capability(p_role text, p_capability text, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner']) then
    raise exception 'Solo el dueño cambia los permisos' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('admin', 'manager', 'cajero') then
    raise exception 'Rol no válido' using errcode = 'check_violation';
  end if;
  if not (app.capability_defaults() -> 'admin') ? p_capability then
    raise exception 'No existe el permiso «%»', p_capability using errcode = 'check_violation';
  end if;
  if p_allowed is null or p_allowed = (app.capability_defaults() -> p_role ->> p_capability)::boolean then
    delete from public.role_capabilities where tenant_id = v_tenant and role = p_role and capability = p_capability;
  else
    insert into public.role_capabilities (tenant_id, role, capability, allowed)
    values (v_tenant, p_role, p_capability, p_allowed)
    on conflict (tenant_id, role, capability)
    do update set allowed = excluded.allowed, updated_by = auth.uid(), updated_at = now();
  end if;
end;
$$;
revoke all on function app.set_role_capability(text, text, boolean) from public;
grant execute on function app.set_role_capability(text, text, boolean) to authenticated;

create function public.set_role_capability(p_role text, p_capability text, p_allowed boolean)
returns void language sql security invoker set search_path = '' as $$ select app.set_role_capability(p_role, p_capability, p_allowed) $$;
revoke all on function public.set_role_capability(text, text, boolean) from public, anon;
grant execute on function public.set_role_capability(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Chequeos de rol → capacidades (generado desde las definiciones vigentes)
-- ---------------------------------------------------------------------------
-- app.add_clock_event(uuid,text,timestamp with time zone,text): fichaje.gestionar
CREATE OR REPLACE FUNCTION app.add_clock_event(p_staff_id uuid, p_kind text, p_at timestamp with time zone, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_staff public.cashiers;
  v_id uuid;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'fichaje.gestionar') then
    raise exception 'Solo dueño, administrador o encargado registran fichajes' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'fichaje', 'Fichaje');
  select * into v_staff from public.cashiers where id = p_staff_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Persona no encontrada' using errcode = 'no_data_found';
  end if;
  if p_kind not in ('entrada', 'salida', 'inicio_descanso', 'fin_descanso') then
    raise exception 'Marca no válida' using errcode = 'check_violation';
  end if;
  if p_at is null or p_at > now() + interval '5 minutes' or p_at < now() - interval '62 days' then
    raise exception 'La hora debe ser de los últimos 2 meses' using errcode = 'check_violation';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'Indica por qué se registra a mano' using errcode = 'check_violation';
  end if;
  insert into public.clock_events (tenant_id, staff_id, location_id, kind, event_at, source, status, note, created_by)
  values (v_tenant, v_staff.id, v_staff.location_id, p_kind, p_at, 'admin', 'ok', trim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- app.can_use_location(uuid,uuid): inventario.todas_sedes
CREATE OR REPLACE FUNCTION app.can_use_location(p_tenant_id uuid, p_location_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is null
      or app.has_capability(p_tenant_id, 'inventario.todas_sedes')
      or not exists (select 1 from public.member_locations ml where ml.tenant_id = p_tenant_id and ml.user_id = auth.uid())
      or exists (select 1 from public.member_locations ml
                 where ml.tenant_id = p_tenant_id and ml.user_id = auth.uid() and ml.location_id = p_location_id)
$function$;

-- app.cancel_inventory_count(uuid): inventario.conteos
CREATE OR REPLACE FUNCTION app.cancel_inventory_count(p_count_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'inventario.conteos') then
    raise exception 'Solo dueño, administrador o encargado anulan un conteo' using errcode = 'insufficient_privilege';
  end if;
  update public.inventory_counts set status = 'cancelled', closed_by = auth.uid(), closed_at = now()
  where id = p_count_id and tenant_id = v_tenant and status = 'open';
  if not found then
    raise exception 'Conteo no encontrado o ya cerrado' using errcode = 'no_data_found';
  end if;
end;
$function$;

-- app.cash_movement(uuid,text,text,numeric,text): caja.supervisar
CREATE OR REPLACE FUNCTION app.cash_movement(p_session_id uuid, p_kind text, p_currency text, p_amount numeric, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.cash_sessions;
  v_id uuid;
begin
  s := app.session_for_write(p_session_id);
  if p_kind not in ('cash_in', 'cash_out') then
    raise exception 'Tipo de movimiento inválido' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero' using errcode = 'check_violation';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  if p_kind = 'cash_out' and s.opened_by <> auth.uid()
     and not app.has_capability(s.tenant_id, 'caja.supervisar') then
    raise exception 'Solo quien abrió la caja o un encargado saca efectivo' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.cash_counts where session_id = s.id and currency = upper(p_currency)) then
    raise exception 'Moneda % no usada por el negocio', p_currency using errcode = 'check_violation';
  end if;
  insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, note)
  values (s.tenant_id, s.id, p_kind, upper(p_currency),
          case when p_kind = 'cash_out' then -round(p_amount, 2) else round(p_amount, 2) end, trim(p_note))
  returning id into v_id;
  return v_id;
end;
$function$;

-- app.catalog_import(text,text,jsonb): catalogo.editar
CREATE OR REPLACE FUNCTION app.catalog_import(p_file_name text, p_file_hash text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_tenant is null or not app.has_capability(v_tenant, 'catalogo.editar') then
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
$function$;

-- app.clock_key(): fichaje.gestionar
CREATE OR REPLACE FUNCTION app.clock_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.clock_key from public.tenants t
  where t.id = app.current_tenant_id() and app.has_capability(t.id, 'fichaje.gestionar')
$function$;

-- app.close_cash_session(uuid,jsonb,text): caja.supervisar
CREATE OR REPLACE FUNCTION app.close_cash_session(p_session_id uuid, p_counted jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.cash_sessions;
  c record;
  v_counted numeric;
begin
  s := app.session_for_write(p_session_id);
  if s.opened_by <> auth.uid() and not app.has_capability(s.tenant_id, 'caja.supervisar') then
    raise exception 'Solo quien abrió la caja o un encargado la cierra' using errcode = 'insufficient_privilege';
  end if;

  for c in select * from public.cash_counts where session_id = s.id
  loop
    select (x ->> 'amount')::numeric into v_counted
    from jsonb_array_elements(coalesce(p_counted, '[]'::jsonb)) x
    where upper(x ->> 'currency') = c.currency;
    if v_counted is null or v_counted < 0 then
      raise exception 'Falta el conteo de %', c.currency using errcode = 'check_violation';
    end if;
    update public.cash_counts set
      expected = (select coalesce(sum(m.amount), 0) from public.cash_movements m where m.session_id = s.id and m.currency = c.currency),
      counted = round(v_counted, 2)
    where session_id = s.id and currency = c.currency;
    update public.cash_counts set difference = counted - expected where session_id = s.id and currency = c.currency;
    v_counted := null;
  end loop;

  update public.cash_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now(), closing_note = nullif(trim(p_note), '')
  where id = s.id;

  return app.cash_session_summary(s.id);
end;
$function$;

-- app.close_inventory_count(uuid,boolean): inventario.conteos
CREATE OR REPLACE FUNCTION app.close_inventory_count(p_count_id uuid, p_missing_as_zero boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  c public.inventory_counts;
  x record;
  v_adjusted integer := 0;
  v_plus numeric := 0;
  v_minus numeric := 0;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'inventario.conteos') then
    raise exception 'Solo dueño, administrador o encargado cierran un conteo' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.inventory_counts where id = p_count_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Conteo no encontrado' using errcode = 'no_data_found';
  end if;
  if c.status <> 'open' then
    raise exception 'El conteo ya está cerrado' using errcode = 'check_violation';
  end if;

  -- Lo que dice el sistema al cerrar queda guardado junto a lo contado.
  update public.inventory_count_items i
  set expected = coalesce((select st.on_hand from public.stocks st where st.variant_id = i.variant_id and st.location_id = c.location_id), 0),
      counted = case when i.counted is null and coalesce(p_missing_as_zero, false) then 0 else i.counted end
  where i.count_id = c.id;

  for x in
    select i.variant_id, i.counted - i.expected as delta
    from public.inventory_count_items i
    where i.count_id = c.id and i.counted is not null and i.counted <> i.expected
  loop
    perform app.inventory_adjust(x.variant_id, c.location_id, x.delta, 'Conteo físico ' || c.number, c.note, null);
    v_adjusted := v_adjusted + 1;
    if x.delta > 0 then v_plus := v_plus + x.delta; else v_minus := v_minus - x.delta; end if;
  end loop;

  update public.inventory_counts
  set status = 'closed', closed_by = auth.uid(), closed_at = now(), adjustments = v_adjusted
  where id = c.id;
  return jsonb_build_object('adjustments', v_adjusted, 'plus', v_plus, 'minus', v_minus,
    'counted', (select count(*) from public.inventory_count_items where count_id = c.id and counted is not null),
    'items', (select count(*) from public.inventory_count_items where count_id = c.id));
end;
$function$;

-- app.finance_role(uuid): finanzas.operar
CREATE OR REPLACE FUNCTION app.finance_role(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.has_capability(p_tenant_id, 'finanzas.operar')
$function$;

-- app.finance_tenant(text[]): capacidad según la lista de roles
CREATE OR REPLACE FUNCTION app.finance_tenant(p_write_roles text[] DEFAULT ARRAY['owner'::text, 'admin'::text, 'manager'::text])
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, case when 'manager' = any (p_write_roles) then 'finanzas.operar' else 'finanzas.anular' end) then
    raise exception 'No tienes permiso para la administración de este negocio' using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end;
$function$;

-- app.inventory_sign(uuid,text): inventario.firmar
CREATE OR REPLACE FUNCTION app.inventory_sign(p_movement_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.inventory_movements;
begin
  select * into m from public.inventory_movements where id = p_movement_id for update;
  if not found or not app.has_capability(m.tenant_id, 'inventario.firmar') then
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
$function$;

-- app.onboarding_mark(text): config.negocio
CREATE OR REPLACE FUNCTION app.onboarding_mark(p_step text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'config.negocio') then
    raise exception 'Solo dueño o administrador configuran el negocio' using errcode = 'insufficient_privilege';
  end if;
  if p_step not in ('productos', 'equipo', 'listo') then
    raise exception 'Paso no válido' using errcode = 'check_violation';
  end if;
  update public.tenants
  set onboarding_steps = onboarding_steps || jsonb_build_object(p_step, now()),
      onboarding_completed_at = case when p_step = 'listo' then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end
  where id = v_tenant;
end;
$function$;

-- app.onboarding_setup_business(text,text,text,text,text,text,text,numeric,boolean): config.negocio
CREATE OR REPLACE FUNCTION app.onboarding_setup_business(p_name text, p_legal_name text, p_tax_id text, p_phone text, p_address text, p_location_name text, p_rate_source text, p_manual_rate numeric, p_special_taxpayer boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  t public.tenants;
  v_location uuid;
  v_code text;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'config.negocio') then
    raise exception 'Solo dueño o administrador configuran el negocio' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Escribe el nombre del negocio' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_location_name, ''))) = 0 then
    raise exception 'Escribe el nombre de la sede' using errcode = 'check_violation';
  end if;
  if p_rate_source not in ('bcv', 'manual') then
    raise exception 'Fuente de tasa no válida' using errcode = 'check_violation';
  end if;
  select * into t from public.tenants where id = v_tenant;
  if p_rate_source = 'manual' and (p_manual_rate is null or p_manual_rate <= 0) and t.local_currency is not null then
    raise exception 'Escribe la tasa del día' using errcode = 'check_violation';
  end if;

  update public.tenants
  set name = trim(p_name),
      legal_name = nullif(trim(p_legal_name), ''),
      tax_id = nullif(upper(trim(p_tax_id)), ''),
      phone = nullif(trim(p_phone), ''),
      address = nullif(trim(p_address), ''),
      rate_source = p_rate_source,
      is_special_taxpayer = coalesce(p_special_taxpayer, false),
      onboarding_steps = onboarding_steps || jsonb_build_object('negocio', now())
  where id = v_tenant;

  if p_rate_source = 'manual' and p_manual_rate > 0 and t.local_currency is not null then
    insert into public.tenant_rates (tenant_id, base_currency, quote_currency, rate, note)
    values (v_tenant, t.base_currency, t.local_currency, p_manual_rate, 'Asistente inicial');
  end if;

  select id into v_location from public.locations
  where tenant_id = v_tenant and deleted_at is null order by created_at limit 1;
  if v_location is null then
    v_code := left(regexp_replace(upper(app.fold(p_location_name)), '[^A-Z0-9]+', '', 'g'), 10);
    if v_code = '' then v_code := 'PRINCIPAL'; end if;
    insert into public.locations (tenant_id, name, code) values (v_tenant, trim(p_location_name), v_code)
    returning id into v_location;
  end if;
  if not exists (select 1 from public.registers where tenant_id = v_tenant and is_active) then
    insert into public.registers (tenant_id, location_id, name, code)
    values (v_tenant, v_location, 'Caja 1',
            case when exists (select 1 from public.registers where tenant_id = v_tenant and code = 'CAJA-1')
                 then 'CAJA-' || (select count(*) + 1 from public.registers where tenant_id = v_tenant)
                 else 'CAJA-1' end);
  end if;
end;
$function$;

-- app.plan_usage(): config.negocio
CREATE OR REPLACE FUNCTION app.plan_usage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'config.negocio') then
    raise exception 'Solo dueño o administrador' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'locations', (select count(*) from public.locations where tenant_id = v_tenant and deleted_at is null),
    'registers', (select count(*) from public.registers where tenant_id = v_tenant and is_active),
    'users', (select count(*) from public.tenant_members where tenant_id = v_tenant)
  );
end;
$function$;

-- app.product_image_allowed(text): catalogo.editar
CREATE OR REPLACE FUNCTION app.product_image_allowed(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return app.has_capability(v_folder::uuid, 'catalogo.editar');
end;
$function$;

-- app.regenerate_clock_key(): fichaje.enlace
CREATE OR REPLACE FUNCTION app.regenerate_clock_key()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_key text;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'fichaje.enlace') then
    raise exception 'Solo dueño o administrador cambian el enlace de fichaje' using errcode = 'insufficient_privilege';
  end if;
  v_key := translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_');
  update public.tenants set clock_key = v_key where id = v_tenant;
  return v_key;
end;
$function$;

-- app.report_tenant(): reportes.ver
CREATE OR REPLACE FUNCTION app.report_tenant()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_capability(v_tenant, 'reportes.ver') then
    raise exception 'Los reportes son para dueños, administradores y encargados' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'reportes', 'Reportes');
  return v_tenant;
end;
$function$;

-- app.review_clock_event(uuid,text,text): fichaje.gestionar
CREATE OR REPLACE FUNCTION app.review_clock_event(p_event_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'fichaje.gestionar') then
    raise exception 'Solo dueño, administrador o encargado revisan fichajes' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('aprobado', 'rechazado') then
    raise exception 'Estado no válido' using errcode = 'check_violation';
  end if;
  update public.clock_events
  set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
      note = coalesce(nullif(trim(p_note), ''), note)
  where id = p_event_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Fichaje no encontrado' using errcode = 'no_data_found';
  end if;
end;
$function$;

-- app.review_clock_events(uuid[],text,text): fichaje.gestionar
CREATE OR REPLACE FUNCTION app.review_clock_events(p_event_ids uuid[], p_status text, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_count integer;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'fichaje.gestionar') then
    raise exception 'Solo dueño, administrador o encargado revisan fichajes' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('aprobado', 'rechazado') then
    raise exception 'Estado no válido' using errcode = 'check_violation';
  end if;
  if p_status = 'rechazado' and nullif(trim(p_note), '') is null then
    raise exception 'Indica por qué se rechazan' using errcode = 'check_violation';
  end if;
  if cardinality(p_event_ids) > 500 then
    raise exception 'Máximo 500 fichajes a la vez' using errcode = 'check_violation';
  end if;
  update public.clock_events
  set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
      note = coalesce(nullif(trim(p_note), ''), note)
  where tenant_id = v_tenant and id = any (p_event_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- app.sale_for_correction(uuid): ventas.corregir
CREATE OR REPLACE FUNCTION app.sale_for_correction(p_sale_id uuid)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  s public.sales;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'ventas.corregir') then
    raise exception 'Solo dueño, administrador o encargado anulan o devuelven ventas' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'no_data_found';
  end if;
  if s.status <> 'completed' then
    raise exception 'La venta % ya está anulada', s.number using errcode = 'check_violation';
  end if;
  return s;
end;
$function$;

-- app.set_sale_invoice(uuid,text): ventas.corregir
CREATE OR REPLACE FUNCTION app.set_sale_invoice(p_sale_id uuid, p_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'ventas.corregir') then
    raise exception 'Solo dueño, administrador o encargado anotan la factura' using errcode = 'insufficient_privilege';
  end if;
  update public.sales set invoice_number = nullif(trim(p_number), '')
  where id = p_sale_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'no_data_found';
  end if;
end;
$function$;

-- app.set_staff_pin(uuid,text): fichaje.gestionar
CREATE OR REPLACE FUNCTION app.set_staff_pin(p_staff_id uuid, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'fichaje.gestionar') then
    raise exception 'Solo dueño, administrador o encargado asignan PIN' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'fichaje', 'Fichaje');
  if p_pin is null then
    update public.cashiers set pin_hash = null, pin_set_at = null, clock_enabled = false, pin_temporary = false
    where id = p_staff_id and tenant_id = v_tenant;
  else
    perform app.check_staff_pin(v_tenant, p_staff_id, p_pin);
    update public.cashiers
    set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_set_at = now(), clock_enabled = true, pin_temporary = true
    where id = p_staff_id and tenant_id = v_tenant;
  end if;
  if not found then
    raise exception 'Persona no encontrada' using errcode = 'no_data_found';
  end if;
end;
$function$;

-- app.set_stock_levels(uuid,uuid,numeric,numeric): inventario.minimos
CREATE OR REPLACE FUNCTION app.set_stock_levels(p_variant_id uuid, p_location_id uuid, p_min numeric, p_target numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'inventario.minimos') then
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
$function$;

-- app.start_inventory_count(uuid,text,boolean,text): inventario.conteos
CREATE OR REPLACE FUNCTION app.start_inventory_count(p_location_id uuid, p_category text DEFAULT NULL::text, p_blind boolean DEFAULT true, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'inventario.conteos') then
    raise exception 'Solo dueño, administrador o encargado abren un conteo' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'Sede no encontrada' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.inventory_counts where tenant_id = v_tenant and location_id = p_location_id and status = 'open') then
    raise exception 'Ya hay un conteo abierto en esa sede' using errcode = 'unique_violation';
  end if;
  insert into public.inventory_counts (tenant_id, number, location_id, category, blind, note)
  values (v_tenant, 'C-' || lpad(app.next_number(v_tenant, 'inventory_count')::text, 4, '0'), p_location_id,
          nullif(trim(p_category), ''), coalesce(p_blind, true), nullif(trim(p_note), ''))
  returning id into v_id;
  insert into public.inventory_count_items (tenant_id, count_id, variant_id)
  select v_tenant, v_id, st.variant_id
  from public.stocks st
  join public.variants v on v.id = st.variant_id and v.deleted_at is null and v.is_active
  join public.products p on p.id = v.product_id and p.deleted_at is null
  where st.tenant_id = v_tenant and st.location_id = p_location_id
    and (nullif(trim(p_category), '') is null or lower(p.category) = lower(trim(p_category)));
  return v_id;
end;
$function$;

-- app.studio_start(uuid,text,text,text,uuid,text,text[],text): estudio.usar
CREATE OR REPLACE FUNCTION app.studio_start(p_product_id uuid, p_kind text, p_scene text, p_source_path text, p_set_id uuid DEFAULT NULL::uuid, p_format text DEFAULT '1:1'::text, p_extra_paths text[] DEFAULT '{}'::text[], p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_usage jsonb;
  v_id uuid;
  v_path text;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'estudio.usar') then
    raise exception 'Solo dueño, administrador o encargado usan el Estudio' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'estudio', 'Estudio de IA');
  if p_kind not in ('catalogo', 'transparente', 'ambientado', 'persona') then
    raise exception 'Tipo de foto no válido' using errcode = 'check_violation';
  end if;
  if p_kind = 'persona' and not coalesce((select people_enabled from public.studio_settings where tenant_id = v_tenant), false) then
    raise exception 'Activa «Producto con persona» en la configuración del Estudio' using errcode = 'check_violation';
  end if;
  if p_kind = 'ambientado' and nullif(trim(p_scene), '') is null then
    raise exception 'Describe el ambiente de la foto' using errcode = 'check_violation';
  end if;
  if coalesce(p_format, '1:1') not in ('1:1', '4:5', '9:16', '16:9') then
    raise exception 'Formato no válido' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'Producto no encontrado' using errcode = 'no_data_found';
  end if;
  -- Las fotos de origen tienen que estar en la carpeta del negocio.
  if p_source_path is null or split_part(p_source_path, '/', 1) <> v_tenant::text then
    raise exception 'Foto de origen no válida' using errcode = 'check_violation';
  end if;
  if cardinality(coalesce(p_extra_paths, '{}')) > 3 then
    raise exception 'Máximo 3 fotos extra' using errcode = 'check_violation';
  end if;
  foreach v_path in array coalesce(p_extra_paths, '{}')
  loop
    if v_path is null or split_part(v_path, '/', 1) <> v_tenant::text then
      raise exception 'Foto extra no válida' using errcode = 'check_violation';
    end if;
  end loop;
  -- Un trabajo a la vez por negocio para que la cuota no se pase con clics seguidos.
  perform pg_advisory_xact_lock(hashtext('studio:' || v_tenant::text));
  v_usage := app.studio_usage();
  if (v_usage ->> 'used')::integer >= (v_usage ->> 'limit')::integer then
    raise exception 'Ya usaste las % fotos del Estudio de este mes', v_usage ->> 'limit' using errcode = 'check_violation';
  end if;
  insert into public.studio_jobs (tenant_id, product_id, kind, scene, source_path, set_id, format, extra_paths, notes)
  values (v_tenant, p_product_id, p_kind, nullif(trim(p_scene), ''), p_source_path, p_set_id, coalesce(p_format, '1:1'),
          coalesce(p_extra_paths, '{}'), nullif(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

-- app.studio_usage(): estudio.usar
CREATE OR REPLACE FUNCTION app.studio_usage()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'used', (select count(*) from public.studio_jobs j
             where j.tenant_id = app.current_tenant_id() and j.status <> 'fallido'
               and j.created_at >= app.caracas_day_start(date_trunc('month', (now() at time zone 'America/Caracas'))::date)),
    'limit', coalesce((app.entitled(app.current_tenant_id(), 'estudio_images_per_month'))::integer, 0))
  where app.has_capability(app.current_tenant_id(), 'estudio.usar')
$function$;

-- app.variant_for_write(uuid,text[]): capacidad según la lista de roles
CREATE OR REPLACE FUNCTION app.variant_for_write(p_variant_id uuid, p_roles text[])
 RETURNS variants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.variants;
begin
  select * into v from public.variants where id = p_variant_id and deleted_at is null;
  if not found then
    raise exception 'Variante no encontrada' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(v.tenant_id, 'inventario.mover') then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  return v;
end;
$function$;

-- attribute_defs.catalog_insert: catalogo.campos
alter policy "catalog_insert" on public.attribute_defs with check (app.has_capability(tenant_id, 'catalogo.campos'));

-- attribute_defs.catalog_update: catalogo.campos
alter policy "catalog_update" on public.attribute_defs using (app.has_capability(tenant_id, 'catalogo.campos')) with check (app.has_capability(tenant_id, 'catalogo.campos'));

-- cashiers.admin_insert: caja.cajeros
alter policy "admin_insert" on public.cashiers with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'caja.cajeros')));

-- cashiers.admin_update: caja.cajeros
alter policy "admin_update" on public.cashiers using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'caja.cajeros'))) with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'caja.cajeros')));

-- clock_events.managers_read: fichaje.gestionar
alter policy "managers_read" on public.clock_events using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'fichaje.gestionar')));

-- coupons.manager_insert: caja.cupones
alter policy "manager_insert" on public.coupons with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'caja.cupones')));

-- coupons.manager_update: caja.cupones
alter policy "manager_update" on public.coupons using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'caja.cupones'))) with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'caja.cupones')));

-- finance_accounts.supervisor_insert: finanzas.cuentas
alter policy "supervisor_insert" on public.finance_accounts with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'finanzas.cuentas')));

-- finance_accounts.supervisor_update: finanzas.cuentas
alter policy "supervisor_update" on public.finance_accounts using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'finanzas.cuentas'))) with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'finanzas.cuentas')));

-- import_guides.admin_delete: finanzas.cuentas
alter policy "admin_delete" on public.import_guides using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'finanzas.cuentas')));

-- import_guides.admin_insert: finanzas.cuentas
alter policy "admin_insert" on public.import_guides with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'finanzas.cuentas')));

-- import_guides.admin_update: finanzas.cuentas
alter policy "admin_update" on public.import_guides using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'finanzas.cuentas'))) with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'finanzas.cuentas')));

-- import_templates.catalog_delete: catalogo.editar
alter policy "catalog_delete" on public.import_templates using (app.has_capability(tenant_id, 'catalogo.editar'));

-- import_templates.catalog_insert: catalogo.editar
alter policy "catalog_insert" on public.import_templates with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- import_templates.catalog_update: catalogo.editar
alter policy "catalog_update" on public.import_templates using (app.has_capability(tenant_id, 'catalogo.editar')) with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- locations.catalog_insert: config.sedes
alter policy "catalog_insert" on public.locations with check (app.has_capability(tenant_id, 'config.sedes'));

-- locations.catalog_update: config.sedes
alter policy "catalog_update" on public.locations using (app.has_capability(tenant_id, 'config.sedes')) with check (app.has_capability(tenant_id, 'config.sedes'));

-- member_locations.team_delete: equipo.gestionar
alter policy "team_delete" on public.member_locations using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'equipo.gestionar')));

-- member_locations.team_insert: equipo.gestionar
alter policy "team_insert" on public.member_locations with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'equipo.gestionar')));

-- payment_methods.supervisor_insert: config.negocio
alter policy "supervisor_insert" on public.payment_methods with check (app.has_capability(tenant_id, 'config.negocio'));

-- payment_methods.supervisor_update: config.negocio
alter policy "supervisor_update" on public.payment_methods using (app.has_capability(tenant_id, 'config.negocio')) with check (app.has_capability(tenant_id, 'config.negocio'));

-- product_attribute_values.catalog_delete: catalogo.editar
alter policy "catalog_delete" on public.product_attribute_values using (app.has_capability(tenant_id, 'catalogo.editar'));

-- product_attribute_values.catalog_insert: catalogo.editar
alter policy "catalog_insert" on public.product_attribute_values with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- product_codes.catalog_delete: catalogo.editar
alter policy "catalog_delete" on public.product_codes using (app.has_capability(tenant_id, 'catalogo.editar'));

-- product_codes.catalog_insert: catalogo.editar
alter policy "catalog_insert" on public.product_codes with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- product_codes.catalog_update: catalogo.editar
alter policy "catalog_update" on public.product_codes using (app.has_capability(tenant_id, 'catalogo.editar')) with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- product_relations.catalog_delete: catalogo.editar
alter policy "catalog_delete" on public.product_relations using (app.has_capability(tenant_id, 'catalogo.editar'));

-- product_relations.catalog_insert: catalogo.editar
alter policy "catalog_insert" on public.product_relations with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- products.catalog_insert: catalogo.editar
alter policy "catalog_insert" on public.products with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- products.catalog_update: catalogo.editar
alter policy "catalog_update" on public.products using (app.has_capability(tenant_id, 'catalogo.editar')) with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- registers.supervisor_insert: config.sedes
alter policy "supervisor_insert" on public.registers with check (app.has_capability(tenant_id, 'config.sedes'));

-- registers.supervisor_update: config.sedes
alter policy "supervisor_update" on public.registers using (app.has_capability(tenant_id, 'config.sedes')) with check (app.has_capability(tenant_id, 'config.sedes'));

-- sales_channels.admin_insert: config.negocio
alter policy "admin_insert" on public.sales_channels with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'config.negocio')));

-- sales_channels.admin_update: config.negocio
alter policy "admin_update" on public.sales_channels using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'config.negocio'))) with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'config.negocio')));

-- studio_jobs.catalog_read: estudio.usar
alter policy "catalog_read" on public.studio_jobs using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'estudio.usar')));

-- studio_settings.admin_insert: estudio.configurar
alter policy "admin_insert" on public.studio_settings with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'estudio.configurar')));

-- studio_settings.admin_update: estudio.configurar
alter policy "admin_update" on public.studio_settings using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'estudio.configurar'))) with check (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'estudio.configurar')));

-- studio_settings.catalog_read: estudio.usar
alter policy "catalog_read" on public.studio_settings using (((tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id)) AND app.has_capability(tenant_id, 'estudio.usar')));

-- tax_rates.supervisor_insert: config.negocio
alter policy "supervisor_insert" on public.tax_rates with check (app.has_capability(tenant_id, 'config.negocio'));

-- tax_rates.supervisor_update: config.negocio
alter policy "supervisor_update" on public.tax_rates using (app.has_capability(tenant_id, 'config.negocio')) with check (app.has_capability(tenant_id, 'config.negocio'));

-- tenant_members.tenant_members_delete: equipo.gestionar
alter policy "tenant_members_delete" on public.tenant_members using ((app.has_capability(tenant_id, 'equipo.gestionar') AND ((role <> 'owner'::text) OR app.has_tenant_role(tenant_id, ARRAY['owner'::text]))));

-- tenant_members.tenant_members_insert: equipo.gestionar
alter policy "tenant_members_insert" on public.tenant_members with check ((app.has_capability(tenant_id, 'equipo.gestionar') AND ((role <> 'owner'::text) OR app.has_tenant_role(tenant_id, ARRAY['owner'::text]))));

-- tenant_members.tenant_members_update: equipo.gestionar
alter policy "tenant_members_update" on public.tenant_members using ((app.has_capability(tenant_id, 'equipo.gestionar') AND ((role <> 'owner'::text) OR app.has_tenant_role(tenant_id, ARRAY['owner'::text])))) with check ((app.has_capability(tenant_id, 'equipo.gestionar') AND ((role <> 'owner'::text) OR app.has_tenant_role(tenant_id, ARRAY['owner'::text]))));

-- tenant_rates.supervisor_insert: config.negocio
alter policy "supervisor_insert" on public.tenant_rates with check (app.has_capability(tenant_id, 'config.negocio'));

-- tenants.tenants_update: config.negocio
alter policy "tenants_update" on public.tenants using (app.has_capability(id, 'config.negocio')) with check (app.has_capability(id, 'config.negocio'));

-- variants.catalog_insert: catalogo.editar
alter policy "catalog_insert" on public.variants with check (app.has_capability(tenant_id, 'catalogo.editar'));

-- variants.catalog_update: catalogo.editar
alter policy "catalog_update" on public.variants using (app.has_capability(tenant_id, 'catalogo.editar')) with check (app.has_capability(tenant_id, 'catalogo.editar')
);

-- app.session_for_write(uuid): pos.vender
CREATE OR REPLACE FUNCTION app.session_for_write(p_session_id uuid)
 RETURNS cash_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.cash_sessions;
begin
  select * into s from public.cash_sessions where id = p_session_id for update;
  if not found or s.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Sesión de caja no encontrada' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(s.tenant_id, 'pos.vender') then
    raise exception 'Tu rol no tiene permiso para vender ni operar la caja' using errcode = 'insufficient_privilege';
  end if;
  if s.status <> 'open' then
    raise exception 'La caja ya está cerrada; abre una nueva sesión' using errcode = 'check_violation';
  end if;
  return s;
end;
$function$;

-- app.open_cash_session(uuid,jsonb,text): pos.vender
CREATE OR REPLACE FUNCTION app.open_cash_session(p_register_id uuid, p_opening jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.registers;
  t public.tenants;
  v_session uuid;
  v_number text;
  v_item jsonb;
  v_amount numeric;
  v_currency text;
begin
  select * into r from public.registers where id = p_register_id for update;
  if not found or r.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Caja no encontrada' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(r.tenant_id, 'pos.vender') then
    raise exception 'Tu rol no tiene permiso para vender ni operar la caja' using errcode = 'insufficient_privilege';
  end if;
  if not r.is_active then
    raise exception 'La caja está inactiva' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cash_sessions s where s.register_id = r.id and s.status = 'open') then
    raise exception 'Esta caja ya tiene una sesión abierta' using errcode = 'unique_violation';
  end if;
  select * into t from public.tenants where id = r.tenant_id;

  v_number := r.code || '-' || lpad(app.next_number(r.tenant_id, 'cash_session')::text, 5, '0');
  insert into public.cash_sessions (tenant_id, register_id, location_id, number, opening_note)
  values (r.tenant_id, r.id, r.location_id, v_number, nullif(trim(p_note), ''))
  returning id into v_session;

  -- Una fila de conteo por moneda que maneja el negocio, aunque abra en cero.
  insert into public.cash_counts (tenant_id, session_id, currency)
  select r.tenant_id, v_session, c from unnest(array_remove(array[t.base_currency, t.local_currency], null)) c;

  for v_item in select * from jsonb_array_elements(coalesce(p_opening, '[]'::jsonb))
  loop
    v_currency := upper(trim(v_item ->> 'currency'));
    v_amount := coalesce((v_item ->> 'amount')::numeric, 0);
    if v_amount < 0 then
      raise exception 'El fondo de caja no puede ser negativo' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.cash_counts where session_id = v_session and currency = v_currency) then
      raise exception 'Moneda % no usada por el negocio', v_currency using errcode = 'check_violation';
    end if;
    update public.cash_counts set opening = round(v_amount, 2) where session_id = v_session and currency = v_currency;
    if v_amount > 0 then
      insert into public.cash_movements (tenant_id, session_id, kind, currency, amount, note)
      values (r.tenant_id, v_session, 'opening', v_currency, round(v_amount, 2), 'Fondo de caja');
    end if;
  end loop;

  return jsonb_build_object('session_id', v_session, 'number', v_number);
end;
$function$;

