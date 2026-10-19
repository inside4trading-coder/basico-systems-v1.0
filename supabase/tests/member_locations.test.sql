-- Acceso por sede.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'encargado-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'encargado2-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
-- Plan con más sedes, cajas y usuarios que el básico (excepción de plataforma).
insert into public.tenant_entitlements (tenant_id, key, value)
select t.id, k, '10'::jsonb from public.tenants t, unnest(array['max_locations', 'max_registers', 'max_users']) k
on conflict do nothing;
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'manager'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000004', 'manager');
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Cabudare', 'CAB'),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Barquisimeto', 'BQT');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333331', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja CAB', 'C1'),
  ('aaaaaaaa-3333-3333-3333-333333333332', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja BQT', 'C2');
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'FA', 10);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- Dueño asigna Cabudare al primer encargado.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.member_locations (tenant_id, user_id, location_id)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-2222-2222-2222-222222222221') $$,
  'el dueño limita un encargado a una sede'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.member_locations (tenant_id, user_id, location_id)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-2222-2222-2222-222222222222') $$,
  '42501', null,
  'el encargado no se da acceso a otra sede'
);
select lives_ok(
  $$ select public.inventory_entry('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 5) $$,
  'registra entradas en su sede'
);
select throws_ok(
  $$ select public.inventory_entry('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 5) $$,
  '42501', 'No tienes acceso a la sede Barquisimeto',
  'no en otra sede'
);
select throws_ok(
  $$ select public.inventory_transfer('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-2222-2222-2222-222222222222', 1) $$,
  '42501', null,
  'un traslado necesita acceso a las dos sedes'
);
select throws_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333332') $$,
  '42501', null,
  'no abre caja en otra sede'
);
select lives_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') $$,
  'sí en la suya'
);

-- Sin sedes asignadas: todas.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.inventory_entry('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 5) $$,
  'un encargado sin sedes asignadas trabaja en todas'
);
select is((select count(*)::int from public.member_locations), 1, 've las asignaciones del negocio');

select * from finish();
rollback;
