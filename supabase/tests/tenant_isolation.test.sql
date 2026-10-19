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

select is_empty(
  $$ select p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE')) $$,
  'ninguna función SECURITY DEFINER de public la ejecutan anon ni authenticated'
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
-- 6. Sin sesión
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
