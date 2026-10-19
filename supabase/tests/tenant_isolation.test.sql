-- Test de aislamiento entre tenants. Bloquea el merge si falla.
--
-- Dos partes:
-- 1. Estructura, para cualquier tabla pública presente o futura: RLS activado,
--    tenant_id NOT NULL (o marca @global / @tenant-root a propósito), ninguna
--    policy con `true` y nada concedido a anon.
-- 2. Comportamiento sobre las tablas de tenancy: dos tenants, tres usuarios.
--    Cada tabla de negocio nueva agrega aquí su caso "A no lee ni escribe B".
--
-- Corre con `supabase test db`. Todo va en una transacción que se revierte.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- 1. Estructura
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not c.relrowsecurity $$,
  'toda tabla pública tiene RLS activado'
);

select is_empty(
  $$ select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (
         select 1 from pg_attribute a
         where a.attrelid = c.oid and a.attname = 'tenant_id'
           and a.attnotnull and not a.attisdropped
       )
       and coalesce(obj_description(c.oid, 'pg_class'), '') !~ '^@(global|tenant-root)\M' $$,
  'toda tabla pública tiene tenant_id NOT NULL o está marcada @global / @tenant-root'
);

select is_empty(
  $$ select tablename || '.' || policyname
     from pg_policies
     where schemaname = 'public'
       and (trim(coalesce(qual, '')) = 'true' or trim(coalesce(with_check, '')) = 'true') $$,
  'ninguna policy pública usa USING (true) ni WITH CHECK (true)'
);

select is_empty(
  $$ select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and coalesce(obj_description(c.oid, 'pg_class'), '') !~ '^@global\M'
       and (has_table_privilege('anon', c.oid, 'SELECT')
            or has_table_privilege('anon', c.oid, 'INSERT')
            or has_table_privilege('anon', c.oid, 'UPDATE')
            or has_table_privilege('anon', c.oid, 'DELETE')) $$,
  'anon no tiene privilegios sobre tablas de tenant'
);

-- La lectura de una tabla de negocio se limita al negocio activo
-- (current_tenant_id), no a todos los del usuario. Solo tenants y
-- tenant_members leen por membresía: el selector de negocio las necesita.
select is_empty(
  $$ select p.tablename || '.' || p.policyname
     from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('SELECT', 'ALL')
       and p.tablename not in ('tenants', 'tenant_members')
       and coalesce(p.qual, '') ~ 'auth_tenant_ids'
       and exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = p.tablename
           and c.column_name = 'tenant_id'
       ) $$,
  'ninguna policy de lectura de una tabla con tenant_id usa auth_tenant_ids (salvo tenants y tenant_members)'
);

-- Una RPC SECURITY DEFINER expuesta a authenticated es una decisión
-- deliberada: se marca con un comentario '@rpc …' y comprueba el rol dentro.
select is_empty(
  $$ select p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                and coalesce(obj_description(p.oid, 'pg_proc'), '') !~ '^@rpc\M')) $$,
  'funciones SECURITY DEFINER de public: nunca anon; authenticated solo si están marcadas @rpc'
);

-- ---------------------------------------------------------------------------
-- 2. Datos de prueba (como postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');

insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

insert into public.tenant_entitlements (tenant_id, key, value) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'max_locations', '5'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'estudio', 'true');

-- ---------------------------------------------------------------------------
-- 3. Owner de A
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers',
  '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select results_eq(
  $$ select id from public.tenants $$,
  $$ values ('aaaaaaaa-1111-1111-1111-111111111111'::uuid) $$,
  'A solo ve su propio tenant'
);
select is_empty(
  $$ select 1 from public.tenant_members where tenant_id = 'bbbbbbbb-1111-1111-1111-111111111111' $$,
  'A no ve miembros de B'
);
select is_empty(
  $$ select 1 from public.tenant_entitlements where tenant_id = 'bbbbbbbb-1111-1111-1111-111111111111' $$,
  'A no ve entitlements de B'
);
select results_eq(
  $$ with u as (
       update public.tenants set name = 'hackeado'
       where id = 'bbbbbbbb-1111-1111-1111-111111111111' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'A no puede editar el tenant B'
);
select throws_ok(
  $$ insert into public.tenant_members (tenant_id, user_id, role)
     values ('bbbbbbbb-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner') $$,
  '42501', null,
  'A no puede meterse como miembro de B'
);
select throws_ok(
  $$ insert into public.tenant_entitlements (tenant_id, key, value)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'estudio', 'true') $$,
  '42501', null,
  'A no puede darse entitlements a sí mismo'
);
select throws_ok(
  $$ update public.tenants set status = 'active'
     where id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  '42501', null,
  'A no puede tocar el status de su tenant (lo maneja la plataforma)'
);
select results_eq(
  $$ with u as (
       update public.tenants set name = 'Tienda A renombrada'
       where id = 'aaaaaaaa-1111-1111-1111-111111111111' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'A sí puede renombrar su tenant'
);
select throws_ok(
  $$ delete from public.tenant_members
     where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111'
       and user_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null,
  'el único owner no puede salir del tenant'
);

-- Header x-tenant-id
select is(app.current_tenant_id(), 'aaaaaaaa-1111-1111-1111-111111111111'::uuid,
  'current_tenant_id devuelve el tenant propio del header');
select set_config('request.headers',
  '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is(app.current_tenant_id(), null::uuid,
  'current_tenant_id ignora un tenant ajeno en el header');
select set_config('request.headers', '{"x-tenant-id":"no-es-uuid"}', true);
select is(app.current_tenant_id(), null::uuid,
  'current_tenant_id ignora un header mal formado');
select set_config('request.headers', '{}', true);
select is(app.current_tenant_id(), null::uuid,
  'current_tenant_id es null sin header');

-- ---------------------------------------------------------------------------
-- 4. Cajero de A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ select count(*)::int from public.tenant_members $$,
  $$ values (2) $$,
  'el cajero ve a su equipo'
);
select results_eq(
  $$ with u as (
       update public.tenants set name = 'cajero edita'
       where id = 'aaaaaaaa-1111-1111-1111-111111111111' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'el cajero no puede editar el tenant'
);
select throws_ok(
  $$ insert into public.tenant_members (tenant_id, user_id, role)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'admin') $$,
  '42501', null,
  'el cajero no puede invitar miembros'
);
select results_eq(
  $$ with u as (
       update public.tenant_members set role = 'owner'
       where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111'
         and user_id = 'aaaaaaaa-0000-0000-0000-000000000002' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'el cajero no puede subirse de rol'
);

-- ---------------------------------------------------------------------------
-- 5. Owner de B y entitlements
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers',
  '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);

select results_eq(
  $$ select count(*)::int from public.tenant_entitlements $$,
  $$ values (2) $$,
  'B ve sus propios entitlements'
);
select is(
  app.tenant_entitlement('bbbbbbbb-1111-1111-1111-111111111111', 'max_locations', '1'),
  '5'::jsonb,
  'la excepción del tenant gana al default'
);
select is(
  app.tenant_entitlement('bbbbbbbb-1111-1111-1111-111111111111', 'can_export', 'true'),
  'true'::jsonb,
  'sin excepción se usa el default de código'
);
select is_empty(
  $$ select 1 from public.tenants where id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  'B no ve el tenant A'
);

-- ---------------------------------------------------------------------------
-- 6. Usuario miembro de dos negocios
--
-- Una fila en cada tabla con tenant_id, en A y en B. Con el header de un
-- negocio, el usuario ve filas propias en cada tabla y ninguna del otro.
-- tenant_members queda fuera: el selector necesita todas las membresías.
-- Una tabla de negocio nueva sin fila sembrada aquí hace fallar la prueba.
-- ---------------------------------------------------------------------------

reset role;

insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-0000-0000-000000000001', 'dual@test.local', 'authenticated', 'authenticated');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001', 'admin'),
  -- Encargado y no cajero: Administración (finance_*, obligations) solo la
  -- leen owner, admin y manager, y aquí se comprueba que vea filas propias.
  ('bbbbbbbb-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001', 'manager');

insert into public.tenant_entitlements (tenant_id, key, value) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '3');

do $$
declare
  t uuid;
  v_loc uuid;
  v_prod uuid;
  v_prod2 uuid;
  v_var uuid;
  v_attr uuid;
  v_reg uuid;
  v_sess uuid;
  v_sale uuid;
  v_pm public.payment_methods;
  v_acc uuid;
  v_obl uuid;
  v_inst uuid;
  v_mov uuid;
begin
  foreach t in array array[
    'aaaaaaaa-1111-1111-1111-111111111111',
    'bbbbbbbb-1111-1111-1111-111111111111'
  ]::uuid[] loop
    insert into public.locations (tenant_id, name, code)
      values (t, 'Sede aislamiento', 'ISO-1') returning id into v_loc;
    insert into public.products (tenant_id, name) values (t, 'Producto 1') returning id into v_prod;
    insert into public.products (tenant_id, name) values (t, 'Producto 2') returning id into v_prod2;
    insert into public.variants (tenant_id, product_id, sku, price)
      values (t, v_prod, 'ISO-SKU', 10) returning id into v_var;
    insert into public.product_codes (tenant_id, variant_id, kind, code)
      values (t, v_var, 'barcode', 'ISO-' || left(t::text, 8));
    insert into public.attribute_defs (tenant_id, key, label)
      values (t, 'iso_attr', 'Atributo') returning id into v_attr;
    insert into public.product_attribute_values (tenant_id, product_id, attribute_id, value)
      values (t, v_prod, v_attr, 'valor');
    insert into public.product_relations (tenant_id, product_id, related_product_id, kind)
      values (t, v_prod, v_prod2, 'substitute');
    insert into public.stocks (tenant_id, variant_id, location_id, on_hand)
      values (t, v_var, v_loc, 5);
    insert into public.inventory_movements
      (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after)
      values (t, v_var, v_loc, 'entry', 0, 5, 5);
    insert into public.import_templates (tenant_id, name, mapping)
      values (t, 'Plantilla', '{}'::jsonb);
    insert into public.import_jobs (tenant_id, file_name, file_hash)
      values (t, 'catalogo.csv', repeat('a', 64));
    insert into public.tenant_rates (tenant_id, base_currency, quote_currency, rate)
      values (t, 'USD', 'VES', 100);
    insert into public.registers (tenant_id, location_id, name, code)
      values (t, v_loc, 'Caja 1', 'ISO-C1') returning id into v_reg;
    insert into public.cash_sessions (tenant_id, register_id, location_id, number)
      values (t, v_reg, v_loc, 'ISO-S1') returning id into v_sess;
    insert into public.cash_counts (tenant_id, session_id, currency) values (t, v_sess, 'USD');
    insert into public.cash_movements (tenant_id, session_id, kind, currency, amount)
      values (t, v_sess, 'cash_in', 'USD', 1);
    insert into public.sales
      (tenant_id, number, location_id, register_id, session_id, base_currency,
       prices_include_tax, subtotal, discount_total, tax_total, total, paid_total, units,
       idempotency_key)
      values (t, 'ISO-V1', v_loc, v_reg, v_sess, 'USD', false, 10, 0, 0, 10, 10, 1,
              'iso-test-' || left(t::text, 8))
      returning id into v_sale;
    insert into public.sale_items
      (tenant_id, sale_id, line, variant_id, product_id, description, qty, unit_price,
       gross, tax_rate, tax_amount, line_total)
      values (t, v_sale, 1, v_var, v_prod, 'Producto 1', 1, 10, 10, 0, 0, 10);
    select * into v_pm from public.payment_methods where tenant_id = t limit 1;
    insert into public.sale_payments
      (tenant_id, sale_id, payment_method_id, method_code, method_name, currency, amount, amount_base)
      values (t, v_sale, v_pm.id, v_pm.code, v_pm.name, 'USD', 10, 10);
    insert into public.tenant_counters (tenant_id, key) values (t, 'iso_test');
    insert into public.finance_accounts (tenant_id, name, currency)
      values (t, 'Cuenta aislamiento', 'USD') returning id into v_acc;
    insert into public.obligations (tenant_id, name, currency, frequency, start_date)
      values (t, 'Obligación aislamiento', 'USD', 'once', current_date) returning id into v_obl;
    insert into public.obligation_instances (tenant_id, obligation_id, due_date, currency)
      values (t, v_obl, current_date, 'USD') returning id into v_inst;
    insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, obligation_instance_id)
      values (t, v_acc, 'out', 'obligation', 1, 'USD', current_date, v_inst) returning id into v_mov;
  end loop;
end;
$$;

-- Consultas armadas sobre todas las tablas públicas con tenant_id que
-- authenticated puede leer (salvo tenant_members): filas de otro negocio
-- visibles, y tablas sin fila propia. tenant_counters no se lee desde el
-- cliente (sin SELECT), pero igual tiene su policy de negocio activo.
select set_config('test.foreign_rows', (
  select string_agg(format(
    'select %L::text from public.%I where tenant_id is distinct from %L::uuid',
    c.relname, c.relname, '__OWN__'), ' union all ')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname <> 'tenant_members'
    and has_table_privilege('authenticated', c.oid, 'SELECT')
), true);
select set_config('test.missing_own', (
  select string_agg(format(
    'select %L::text from public.%I having count(*) = 0',
    c.relname, c.relname), ' union all ')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname <> 'tenant_members'
    and has_table_privilege('authenticated', c.oid, 'SELECT')
), true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Header de A
select set_config('request.headers',
  '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select is_empty(
  replace(current_setting('test.foreign_rows'), '__OWN__', 'aaaaaaaa-1111-1111-1111-111111111111'),
  'con el header de A, el usuario de dos negocios no ve filas de B en ninguna tabla'
);
select is_empty(
  current_setting('test.missing_own'),
  'con el header de A, el usuario de dos negocios ve filas de A en cada tabla'
);
select results_eq(
  $$ select count(*)::int from public.tenant_members
     where user_id = 'cccccccc-0000-0000-0000-000000000001' $$,
  $$ values (2) $$,
  'con el header de A, el selector sigue viendo las dos membresías'
);

-- Header de B
select set_config('request.headers',
  '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is_empty(
  replace(current_setting('test.foreign_rows'), '__OWN__', 'bbbbbbbb-1111-1111-1111-111111111111'),
  'con el header de B, el usuario de dos negocios no ve filas de A en ninguna tabla'
);
select is_empty(
  current_setting('test.missing_own'),
  'con el header de B, el usuario de dos negocios ve filas de B en cada tabla'
);

-- Sin header, o con un negocio ajeno, no se lee nada de negocio.
select set_config('request.headers', '{}', true);
select is_empty(
  replace(current_setting('test.foreign_rows'), '__OWN__', '00000000-0000-0000-0000-000000000000'),
  'sin header, el usuario de dos negocios no lee filas de negocio'
);
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers',
  '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select is_empty(
  replace(current_setting('test.foreign_rows'), '__OWN__', '00000000-0000-0000-0000-000000000000'),
  'el owner de B con el header de A no lee filas de negocio'
);

reset role;

-- ---------------------------------------------------------------------------
-- 7. Sin sesión
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
select throws_ok(
  $$ select 1 from public.tenants $$,
  '42501', null,
  'anon no puede leer tenants'
);

reset role;
select * from finish();
rollback;
