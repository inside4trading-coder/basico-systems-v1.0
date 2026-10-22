-- Suspensión en la base y gestión del equipo (cambiar rol, quitar).

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'admin-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'admin'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'cajero');
insert into public.products (tenant_id, name) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Activo: todo normal.
select is(app.current_tenant_id(), 'aaaaaaaa-1111-1111-1111-111111111111'::uuid, 'negocio activo');
select is((select count(*)::int from public.products), 1, 've sus productos');

-- Suspendido: sin negocio activo, nada de datos, pero sigue viendo su estado.
reset role;
update public.tenants set status = 'suspended' where id = 'aaaaaaaa-1111-1111-1111-111111111111';
set local role authenticated;
select is(app.current_tenant_id(), null, 'suspendido: sin negocio activo');
select is((select count(*)::int from public.products), 0, 'suspendido: no lee datos de negocio');
select throws_ok($$ insert into public.products (name) values ('Nuevo') $$, '42501', null, 'suspendido: no escribe');
select is((select status from public.tenants where id = 'aaaaaaaa-1111-1111-1111-111111111111'), 'suspended',
          'suspendido: ve el estado para la pantalla de cuenta suspendida');
select is((select count(*)::int from public.tenant_members), 3, 'suspendido: ve su membresía');

reset role;
update public.tenants set status = 'active' where id = 'aaaaaaaa-1111-1111-1111-111111111111';
set local role authenticated;
select is((select count(*)::int from public.products), 1, 'reactivado: vuelve a ver sus datos');

-- Equipo: el admin cambia roles y quita, pero no toca al owner.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ update public.tenant_members set role = 'manager' where user_id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
                'el admin cambia el rol de un cajero');
select is((select role from public.tenant_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 'manager', 'rol cambiado');
select is_empty($$ update public.tenant_members set role = 'admin' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
                'el admin no cambia al owner');
select throws_ok($$ update public.tenant_members set role = 'owner' where user_id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
                 '42501', null, 'el admin no nombra owners');
select is_empty($$ delete from public.tenant_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
                'el admin no quita al owner');
select isnt_empty($$ delete from public.tenant_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003' returning 1 $$,
                  'el admin quita a un miembro');

-- El owner no puede dejar el negocio sin owner.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ update public.tenant_members set role = 'admin' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
                 '23514', null, 'el único owner no se degrada');
select lives_ok($$ update public.tenant_members set role = 'owner' where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
                'el owner nombra a otro owner');

select * from finish();
rollback;
