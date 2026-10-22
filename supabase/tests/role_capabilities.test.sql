-- Permisos por rol configurables: defaults, excepciones, owner y guardia.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

-- Ningún chequeo de la base usa ya una lista de roles: todo pasa por
-- capacidades, salvo lo exclusivo del owner.
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
       and p.prosrc ~* 'has_tenant_role\([^)]*''(admin|manager|cajero)''' $$,
  'ninguna función chequea roles admin/manager/cajero a mano');
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
     where coalesce(qual, '') || coalesce(with_check, '') ~* 'has_tenant_role\([^)]*''(admin|manager|cajero)''' $$,
  'ninguna policy chequea roles admin/manager/cajero a mano');

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'manager'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- Defaults: los permisos de siempre.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(app.has_capability('aaaaaaaa-1111-1111-1111-111111111111', 'catalogo.editar'), 'el encargado edita el catálogo por defecto');
select ok(not app.has_capability('aaaaaaaa-1111-1111-1111-111111111111', 'config.negocio'), 'el encargado no configura el negocio por defecto');
select lives_ok($$ insert into public.products (name) values ('Filtro') $$, 'el encargado crea productos');
select throws_ok($$ select public.set_role_capability('cajero', 'reportes.ver', true) $$, '42501',
                 'Solo el dueño cambia los permisos', 'solo el dueño edita la matriz');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.my_capabilities(), array['pos.vender'], 'el cajero solo vende por defecto');
select throws_ok($$ insert into public.products (name) values ('Bujía') $$, '42501', null, 'el cajero no crea productos');

-- El dueño cambia la matriz.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(cardinality(public.my_capabilities()), cardinality(array(select jsonb_object_keys(app.capability_defaults() -> 'admin'))),
          'el dueño tiene todas las capacidades');
select throws_ok($$ select public.set_role_capability('owner', 'reportes.ver', false) $$, '23514', 'Rol no válido', 'al dueño no se le quitan permisos');
select throws_ok($$ select public.set_role_capability('cajero', 'inventado.algo', true) $$, '23514', 'No existe el permiso «inventado.algo»',
                 'solo capacidades que existen');
select lives_ok($$ select public.set_role_capability('manager', 'catalogo.editar', false) $$, 'quita catálogo al encargado');
select lives_ok($$ select public.set_role_capability('cajero', 'catalogo.editar', true) $$, 'da catálogo al cajero');
select is((select count(*)::int from public.role_capabilities), 2, 'se guardan solo las excepciones');

-- La base respeta la matriz.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ insert into public.products (name) values ('Aceite') $$, '42501', null, 'el encargado ya no crea productos');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ insert into public.products (name) values ('Bujía') $$, 'el cajero ahora crea productos');
select ok('catalogo.editar' = any (public.my_capabilities()), 'la app lo ve en sus capacidades');

-- Volver al default borra la excepción.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_role_capability('manager', 'catalogo.editar', true) $$, 'devuelve catálogo al encargado');
select is((select count(*)::int from public.role_capabilities), 1, 'igual al default no se guarda');

-- Sin vender: el cajero no abre caja.
select lives_ok($$ select public.set_role_capability('cajero', 'pos.vender', false) $$, 'quita vender al cajero');
reset role;
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Centro', 'CENTRO');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja 1', 'CAJA-1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333', '[]'::jsonb, null) $$, '42501',
                 'Tu rol no tiene permiso para vender ni operar la caja', 'sin «vender» no abre caja');

-- Las excepciones de A no se ven ni aplican en B.
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.role_capabilities), 0, 'B no ve la matriz de A');

select * from finish();
rollback;
