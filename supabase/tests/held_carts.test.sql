-- Carritos en espera del POS.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'cajero2-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select lives_ok(
  $$ insert into public.pos_held_carts (location_id, label, payload, items, total)
     values ('aaaaaaaa-2222-2222-2222-222222222222', 'Señor de la camioneta', '{"lines":[]}', 2, 41) $$,
  'el cajero pone un carrito en espera'
);
select throws_ok(
  $$ insert into public.pos_held_carts (location_id, label, payload, created_by)
     values ('aaaaaaaa-2222-2222-2222-222222222222', 'Otro', '{}', 'aaaaaaaa-0000-0000-0000-000000000003') $$,
  '42501', null,
  'no lo guarda a nombre de otro'
);
select throws_ok(
  $$ update public.pos_held_carts set label = 'x' $$,
  '42501', null,
  'no se edita: se retoma o se descarta'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.pos_held_carts), 1, 'otro cajero del negocio lo ve');
select lives_ok($$ delete from public.pos_held_carts where label = 'Señor de la camioneta' $$, 'y lo retoma');
select is((select count(*)::int from public.pos_held_carts), 0, 'al retomarlo sale de la espera');

select * from finish();
rollback;
