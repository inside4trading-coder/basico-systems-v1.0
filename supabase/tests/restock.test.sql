-- Necesidad de reposición: por mínimo o por rotación, con de dónde sacarlo.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '5');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero');
insert into public.locations (id, tenant_id, name, code, type) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1', 'store'),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Almacén', 'A1', 'warehouse');
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro'),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Batería'),
  ('aaaaaaaa-4444-4444-4444-444444444443', 'aaaaaaaa-1111-1111-1111-111111111111', 'Correa');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'F1', 10),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'B1', 100),
  ('aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444443', 'C1', 20);
-- Filtro: 3 en tienda, vendió 60 en 30 días (2 por día) → para 15 días hacen falta 30.
-- Batería: 1 en tienda, sin ventas, mínimo 2 y objetivo 5 → reponer 4.
-- Correa: 50 en tienda, vendió 30 → alcanza; no aparece.
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 3),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 40),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 1),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-2222-2222-2222-222222222221', 50);
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, created_at)
select 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 'sale', 100, -2, 98, now() - make_interval(days => d)
from generate_series(1, 30) d;
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, created_at)
select 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-2222-2222-2222-222222222221', 'sale', 100, -1, 99, now() - make_interval(days => d)
from generate_series(1, 30) d;
-- Ventas viejas no cuentan.
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, created_at)
values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 'sale', 9, -8, 1, now() - interval '90 days');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select public.set_stock_levels('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 2, 5) $$,
  'el dueño fija mínimo y objetivo'
);
select throws_ok(
  $$ select public.set_stock_levels('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 5, 5) $$,
  '23514', 'El objetivo debe ser mayor que el mínimo',
  'el objetivo supera al mínimo'
);

select results_eq(
  $$ select name, location_name, available, daily, suggested, reason from public.report_restock() order by name $$,
  $$ values ('Batería'::text, 'Tienda'::text, 1.000::numeric, 0.000::numeric, 4::numeric, 'min'::text),
            ('Filtro', 'Tienda', 3.000, 2.000, 27, 'rotacion') $$,
  'repone por mínimo y por rotación; lo que alcanza no aparece'
);
select is(
  (select sources from public.report_restock() where name = 'Filtro'),
  jsonb_build_array(jsonb_build_object('location_id', 'aaaaaaaa-2222-2222-2222-222222222222'::uuid, 'name', 'Almacén', 'spare', 40.000)),
  'dice de qué sede sacarlo'
);
select is(
  (select count(*)::int from public.report_restock('aaaaaaaa-2222-2222-2222-222222222222')),
  0,
  'filtra por sede'
);
select lives_ok(
  $$ select public.set_stock_levels('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', null, null) $$,
  'quitar el mínimo'
);
select is((select count(*)::int from public.report_restock() where name = 'Batería'), 0, 'sin mínimo ni ventas, la batería ya no aparece');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_stock_levels('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 1, 3) $$,
  '42501', null,
  'el cajero no fija mínimos'
);
select throws_ok($$ select * from public.report_restock() $$, '42501', null, 'ni ve el reporte');

select * from finish();
rollback;
