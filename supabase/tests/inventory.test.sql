-- Catálogo e inventario: aislamiento entre tenants, permisos por rol y motor
-- de movimientos (entrada, ajuste con firma, traslado, búsqueda).

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- Datos (como postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'admin-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');

insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
-- Plan con más sedes, cajas y usuarios que el básico (excepción de plataforma).
insert into public.tenant_entitlements (tenant_id, key, value)
select t.id, k, '10'::jsonb from public.tenants t, unnest(array['max_locations', 'max_registers', 'max_users']) k
on conflict do nothing;

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'admin'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

insert into public.locations (id, tenant_id, name, code) values
  ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111', 'Sede B', 'B1');

-- ---------------------------------------------------------------------------
-- Owner de A arma su catálogo desde el cliente (header x-tenant-id)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select lives_ok(
  $$ insert into public.locations (id, name, code) values
       ('aaaaaaaa-2222-2222-2222-222222222221', 'Tienda', 'T1'),
       ('aaaaaaaa-2222-2222-2222-222222222222', 'Almacén', 'AL') $$,
  'el owner crea sedes sin mandar tenant_id'
);
select results_eq(
  $$ select count(*)::int from public.locations where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  $$ values (2) $$,
  'las sedes quedan en su tenant'
);

select lives_ok(
  $$ insert into public.products (id, name, brand, category) values
       ('aaaaaaaa-3333-3333-3333-333333333333', 'Pastillas de freno', 'Bosch', 'Frenos');
     insert into public.variants (id, product_id, sku, regular_price, price, cost) values
       ('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-3333-3333-3333-333333333333', 'PF-001', 30, 25, 12);
     insert into public.product_codes (variant_id, kind, code) values
       ('aaaaaaaa-4444-4444-4444-444444444444', 'oem', '04465-0K290');
     insert into public.attribute_defs (id, key, label, type, multi) values
       ('aaaaaaaa-5555-5555-5555-555555555555', 'vehiculo', 'Vehículo compatible', 'list', true);
     insert into public.product_attribute_values (product_id, attribute_id, value) values
       ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-5555-5555-5555-555555555555', 'Hilux 2010') $$,
  'el owner crea producto, variante, código y atributo propio'
);
select is(
  (select discount_pct from public.variants where id = 'aaaaaaaa-4444-4444-4444-444444444444'),
  16.67::numeric,
  'el descuento se calcula solo'
);
select throws_ok(
  $$ insert into public.products (tenant_id, name)
     values ('bbbbbbbb-1111-1111-1111-111111111111', 'Intruso') $$,
  '42501', null,
  'A no puede crear productos en B aunque mande el tenant_id'
);
select throws_ok(
  $$ insert into public.variants (product_id, sku)
     values ('aaaaaaaa-3333-3333-3333-333333333333', 'pf-001') $$,
  '23505', null,
  'el SKU es único por tenant sin importar mayúsculas'
);
select throws_ok(
  $$ delete from public.products where id = 'aaaaaaaa-3333-3333-3333-333333333333' $$,
  '42501', null,
  'nadie borra productos: el borrado es lógico'
);
select throws_ok(
  $$ update public.stocks set on_hand = 999 $$,
  '42501', null,
  'el stock no se edita directo'
);
select throws_ok(
  $$ insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444444',
             'aaaaaaaa-2222-2222-2222-222222222221', 'entry', 0, 100, 100) $$,
  '42501', null,
  'los movimientos no se insertan directo'
);

-- Entradas y ajustes
select is(
  (public.inventory_entry('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-2222-2222-2222-222222222221', 5, null, 'Distribuidora X') ->> 'after')::numeric,
  5::numeric,
  'una entrada suma al stock'
);
select results_eq(
  $$ select kind, qty_before, qty_delta, qty_after, unit_cost, signature_status
     from public.inventory_movements where variant_id = 'aaaaaaaa-4444-4444-4444-444444444444' $$,
  $$ values ('entry'::text, 0::numeric, 5::numeric, 5::numeric, 12::numeric, 'n/a'::text) $$,
  'la entrada deja su movimiento con el costo de la variante'
);
select throws_ok(
  $$ select public.inventory_entry('aaaaaaaa-4444-4444-4444-444444444444', 'bbbbbbbb-2222-2222-2222-222222222222', 1) $$,
  'P0002', 'Sede no encontrada',
  'no se puede mover stock a una sede de otro tenant'
);
select throws_ok(
  $$ select public.inventory_adjust('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-2222-2222-2222-222222222221', -10, 'perdida') $$,
  '23514', null,
  'un ajuste no deja stock negativo'
);
select throws_ok(
  $$ select public.inventory_adjust('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-2222-2222-2222-222222222221', -1, '  ') $$,
  '23514', 'El motivo es obligatorio',
  'el ajuste exige motivo'
);
select is(
  (public.inventory_adjust('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-2222-2222-2222-222222222221', -2, 'dano') ->> 'after')::numeric,
  3::numeric,
  'el ajuste aplica al instante'
);
select throws_ok(
  $$ select public.inventory_sign((select id from public.inventory_movements where kind = 'adjustment')) $$,
  '23514', null,
  'quien ajusta no firma su propio ajuste'
);

-- Traslados
select is(
  (public.inventory_transfer('aaaaaaaa-4444-4444-4444-444444444444',
     'aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-2222-2222-2222-222222222222', 2) ->> 'to_after')::numeric,
  2::numeric,
  'el traslado suma en destino'
);
select results_eq(
  $$ select location_id, on_hand from public.stocks
     where variant_id = 'aaaaaaaa-4444-4444-4444-444444444444' order by location_id $$,
  $$ values ('aaaaaaaa-2222-2222-2222-222222222221'::uuid, 1::numeric),
            ('aaaaaaaa-2222-2222-2222-222222222222'::uuid, 2::numeric) $$,
  'y resta en origen'
);
select results_eq(
  $$ select count(distinct transfer_id)::int, count(*)::int from public.inventory_movements
     where kind in ('transfer_out', 'transfer_in') $$,
  $$ values (1, 2) $$,
  'el traslado deja dos movimientos enlazados'
);
select throws_ok(
  $$ select public.inventory_transfer('aaaaaaaa-4444-4444-4444-444444444444',
       'aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-2222-2222-2222-222222222222', 5) $$,
  '23514', null,
  'no se traslada más de lo disponible'
);

-- Búsqueda
select results_eq(
  $$ select match_kind from public.catalog_lookup('pf-001') $$,
  $$ values ('sku'::text) $$,
  'encuentra por SKU'
);
select results_eq(
  $$ select match_kind from public.catalog_lookup('04465-0k290') $$,
  $$ values ('oem'::text) $$,
  'encuentra por cualquier código, con su tipo'
);
select results_eq(
  $$ select product_name from public.catalog_lookup('hilux pastillas') $$,
  $$ values ('Pastillas de freno'::text) $$,
  'encuentra por texto, incluidos los atributos buscables'
);

-- ---------------------------------------------------------------------------
-- Cajero de A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ select count(*)::int from public.variants $$,
  $$ values (1) $$,
  'el cajero ve el catálogo'
);
select throws_ok(
  $$ insert into public.products (name) values ('Del cajero') $$,
  '42501', null,
  'el cajero no crea productos'
);
select results_eq(
  $$ with u as (update public.variants set price = 1 returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'el cajero no cambia precios'
);
select throws_ok(
  $$ select public.inventory_entry('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-2222-2222-2222-222222222221', 1) $$,
  '42501', null,
  'el cajero no registra entradas'
);

-- ---------------------------------------------------------------------------
-- Admin de A firma
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);

select lives_ok(
  $$ select public.inventory_sign((select id from public.inventory_movements where kind = 'adjustment'), 'Revisado') $$,
  'otra persona con rol admin firma el ajuste'
);
select results_eq(
  $$ select signature_status, signed_by_email from public.inventory_control_v where kind = 'adjustment' $$,
  $$ values ('signed'::text, 'admin-a@test.local'::text) $$,
  'el historial muestra quién firmó'
);

-- ---------------------------------------------------------------------------
-- Owner de B no ve ni toca nada de A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);

select is_empty($$ select 1 from public.products where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve productos de A');
select is_empty($$ select 1 from public.variants where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve variantes de A');
select is_empty($$ select 1 from public.product_codes where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve códigos de A');
select is_empty($$ select 1 from public.attribute_defs where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve atributos de A');
select is_empty($$ select 1 from public.product_attribute_values where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve valores de atributos de A');
select is_empty($$ select 1 from public.locations where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve sedes de A');
select is_empty($$ select 1 from public.stocks where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve stock de A');
select is_empty($$ select 1 from public.inventory_movements where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve movimientos de A');
select is_empty($$ select 1 from public.inventory_control_v where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve el historial de A');
select is_empty($$ select 1 from public.catalog_lookup('pf-001') $$, 'el buscador de B no encuentra productos de A');
select throws_ok(
  $$ select public.inventory_entry('aaaaaaaa-4444-4444-4444-444444444444', 'bbbbbbbb-2222-2222-2222-222222222222', 1) $$,
  '42501', null,
  'B no mueve stock de variantes de A'
);
select throws_ok(
  $$ insert into public.variants (product_id, sku) values ('aaaaaaaa-3333-3333-3333-333333333333', 'COLGADO') $$,
  '23503', null,
  'B no puede colgar una variante de un producto de A'
);
select results_eq(
  $$ with u as (update public.variants set price = 0 where id = 'aaaaaaaa-4444-4444-4444-444444444444' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'B no cambia precios de A'
);

reset role;
select * from finish();
rollback;
