-- Conteo físico: se cuenta, se cierra y las diferencias quedan como ajustes.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero');
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.products (id, tenant_id, name, category) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro', 'Filtros'),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Batería', 'Eléctrico'),
  ('aaaaaaaa-4444-4444-4444-444444444443', 'aaaaaaaa-1111-1111-1111-111111111111', 'Correa', 'Correas');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'F1', 10),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'B1', 100),
  ('aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444443', 'C1', 20);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 10),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 3),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-2222-2222-2222-222222222221', 5);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.start_inventory_count('aaaaaaaa-2222-2222-2222-222222222221') $$,
  '42501', null,
  'el cajero no abre conteos'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.count', public.start_inventory_count('aaaaaaaa-2222-2222-2222-222222222221', null, true, 'Cierre de mes')::text, true);
select results_eq(
  $$ select number, (select count(*)::int from public.inventory_count_items) from public.inventory_counts $$,
  $$ values ('C-0001'::text, 3) $$,
  'abre el conteo con un renglón por producto de la sede'
);
select throws_ok(
  $$ select public.start_inventory_count('aaaaaaaa-2222-2222-2222-222222222221') $$,
  '23505', 'Ya hay un conteo abierto en esa sede',
  'un conteo abierto por sede'
);

-- El cajero cuenta: el filtro con lector (suma), la batería a mano.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.count_inventory_item(current_setting('test.count')::uuid, 'aaaaaaaa-5555-5555-5555-555555555551', 4, true);
select is(public.count_inventory_item(current_setting('test.count')::uuid, 'aaaaaaaa-5555-5555-5555-555555555551', 4, true), 8.000::numeric, 'el lector suma');
select is(public.count_inventory_item(current_setting('test.count')::uuid, 'aaaaaaaa-5555-5555-5555-555555555552', 5), 5.000::numeric, 'a mano fija la cantidad');
select is((select expected from public.inventory_count_items where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), null, 'mientras se cuenta no se guarda lo esperado');

select throws_ok(
  format($$ select public.close_inventory_count(%L) $$, current_setting('test.count')),
  '42501', null,
  'el cajero no cierra'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.close_inventory_count(current_setting('test.count')::uuid),
  '{"adjustments": 2, "plus": 2.000, "minus": 2.000, "counted": 2, "items": 3}'::jsonb,
  'al cerrar ajusta las dos diferencias (−2 filtros, +2 baterías)'
);
select results_eq(
  $$ select v.sku, s.on_hand from public.stocks s join public.variants v on v.id = s.variant_id order by v.sku $$,
  $$ values ('B1'::text, 5.000::numeric), ('C1', 5.000), ('F1', 8.000) $$,
  'el stock queda como se contó; la correa no contada no se toca'
);
select results_eq(
  $$ select kind, reason, signature_status, qty_delta from public.inventory_movements order by qty_delta $$,
  $$ values ('adjustment'::text, 'Conteo físico C-0001'::text, 'pending'::text, -2.000::numeric),
            ('adjustment', 'Conteo físico C-0001', 'pending', 2.000) $$,
  'como ajustes pendientes de firma'
);
select throws_ok(
  format($$ select public.count_inventory_item(%L, 'aaaaaaaa-5555-5555-5555-555555555553', 1) $$, current_setting('test.count')),
  '23514', 'El conteo ya está cerrado',
  'cerrado no se cuenta más'
);

-- Contar lo que falta como cero.
select set_config('test.count2', public.start_inventory_count('aaaaaaaa-2222-2222-2222-222222222221', 'filtros')::text, true);
select is((select count(*)::int from public.inventory_count_items where count_id = current_setting('test.count2')::uuid), 1, 'por categoría');
select is((public.close_inventory_count(current_setting('test.count2')::uuid, true) ->> 'adjustments')::int, 1, 'lo no contado como cero');
select is((select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 0.000::numeric, 'deja el filtro en cero');

select * from finish();
rollback;
