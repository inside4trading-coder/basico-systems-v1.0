-- Accesos de Inicio: cada miembro edita solo los suyos, en el negocio activo.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000009', 'ajeno@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role, home_shortcuts) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', array['reportes']),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero', null),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero', array['vender']);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- El cajero guarda los suyos.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.set_home_shortcuts(array['vender', 'ventas', 'inventario']) $$,
  'un miembro guarda sus accesos'
);
select is(
  (select home_shortcuts from public.tenant_members
   where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  array['vender', 'ventas', 'inventario'],
  'quedan en su fila y en ese orden'
);
select is(
  (select home_shortcuts from public.tenant_members
   where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  array['reportes'],
  'la fila del dueño no cambia'
);
select is(
  (select home_shortcuts from public.tenant_members
   where tenant_id = 'bbbbbbbb-1111-1111-1111-111111111111' and user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  array['vender'],
  'ni la suya en otro negocio'
);

select throws_ok(
  $$ update public.tenant_members set home_shortcuts = array['x1']
     where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', null,
  'no se editan por update directo'
);

select throws_ok(
  $$ select public.set_home_shortcuts(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b3','b4']) $$,
  '23514', 'Máximo 12 accesos',
  'máximo 12'
);
select throws_ok(
  $$ select public.set_home_shortcuts(array['Vender; drop']) $$,
  '23514', 'Acceso no válido',
  'solo claves cortas en minúscula'
);
select throws_ok(
  $$ select public.set_home_shortcuts(array['vender', 'vender']) $$,
  '23514', 'Accesos repetidos',
  'sin repetidos'
);

select lives_ok($$ select public.set_home_shortcuts(null) $$, 'null vuelve a los de siempre');
select is(
  (select home_shortcuts from public.tenant_members
   where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null::text[],
  'quedan en null'
);

-- Alguien que no es miembro, aunque mande el header.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_home_shortcuts(array['vender']) $$,
  '42501', null,
  'un ajeno no guarda nada'
);

select * from finish();
rollback;
