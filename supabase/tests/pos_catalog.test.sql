-- Catálogo del POS: más vendidos primero, por categoría y solo de la sede.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '5');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1'),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Depósito', 'D1');
insert into public.products (id, tenant_id, name, category, tax_rate_id) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Bujía', 'Encendido', null),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro', 'Filtros', null),
  ('aaaaaaaa-4444-4444-4444-444444444443', 'aaaaaaaa-1111-1111-1111-111111111111', 'Aceite', 'Lubricantes',
   (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento')),
  ('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-1111-1111-1111-111111111111', 'Sin precio', 'Filtros', null);
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'BU', 5),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'FI', 9),
  ('aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444443', 'AC', 7),
  ('aaaaaaaa-5555-5555-5555-555555555554', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444444', 'SP', null);
-- El aceite está en la tienda pero agotado; el depósito no vende aquí.
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 20),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 8),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-2222-2222-2222-222222222221', 0),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555554', 'aaaaaaaa-2222-2222-2222-222222222221', 5),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-2222-2222-2222-222222222222', 30);
-- El filtro se vendió más esta semana.
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, note) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 'sale', 12, -4, 8, 'Venta V-1'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 'sale', 21, -1, 20, 'Venta V-2');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ select i ->> 'sku', (i ->> 'available')::numeric, (i ->> 'tax_rate')::numeric, (i ->> 'sold')::numeric
     from jsonb_array_elements(public.pos_catalog('aaaaaaaa-2222-2222-2222-222222222221') -> 'items') with ordinality t(i, n) order by n $$,
  $$ values ('FI'::text, 8::numeric, 16::numeric, 4::numeric), ('BU'::text, 20::numeric, 16::numeric, 1::numeric) $$,
  'el cajero ve lo que hay en su sede, lo más vendido primero; sin agotados ni productos sin precio'
);
select is(
  public.pos_catalog('aaaaaaaa-2222-2222-2222-222222222221') -> 'categories',
  '["Encendido", "Filtros"]'::jsonb,
  'las categorías son las de lo que se puede vender ahí'
);
select results_eq(
  $$ select i ->> 'sku' from jsonb_array_elements(public.pos_catalog('aaaaaaaa-2222-2222-2222-222222222221', 'Encendido') -> 'items') i $$,
  $$ values ('BU'::text) $$,
  'filtra por categoría'
);
select results_eq(
  $$ select i ->> 'sku', (i ->> 'tax_rate')::numeric from jsonb_array_elements(public.pos_catalog('aaaaaaaa-2222-2222-2222-222222222222') -> 'items') i $$,
  $$ values ('AC'::text, 0::numeric) $$,
  'otra sede tiene su propio catálogo, con el IVA de cada producto'
);

-- Otro negocio no ve la sede de A.
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.pos_catalog('aaaaaaaa-2222-2222-2222-222222222221') $$,
  'P0002', 'Sede no encontrada',
  'una sede de otro negocio no existe para B'
);

select * from finish();
rollback;
