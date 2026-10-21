-- Guías de «¿Dónde obtengo este archivo?»: las escribe dueño o administrador, las lee administración.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'encargado-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'manager'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.import_guides (source_key, steps) values ('financing:orders', E'Entra al portal\nDescarga Órdenes') $$,
  'el dueño escribe los pasos'
);
select lives_ok(
  $$ insert into public.import_guides (source_key, steps) values ('financing:orders', 'Otro texto')
     on conflict (tenant_id, source_key) do update set steps = excluded.steps $$,
  'y los reescribe'
);
select is((select steps from public.import_guides where source_key = 'financing:orders'), 'Otro texto', 'queda el último texto');
select throws_ok(
  $$ insert into public.import_guides (source_key, steps) values ('cualquier-cosa', 'x') $$,
  '23514', null,
  'la clave sigue el formato de las fuentes'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.import_guides), 1, 'el encargado lee los pasos');
select throws_ok(
  $$ insert into public.import_guides (source_key, steps) values ('financing:payments', 'x') $$,
  '42501', null,
  'pero no los escribe'
);

select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty($$ select 1 from public.import_guides $$, 'otro negocio no ve los pasos de A');

select * from finish();
rollback;
