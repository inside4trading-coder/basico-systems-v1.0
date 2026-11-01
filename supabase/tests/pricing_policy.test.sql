-- Política de precios: se guarda con validación y permiso, el historial anota
-- cada cambio con su motivo y el costo fijado marca qué precios revisar.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Producto X'),
  ('bbbbbbbb-4444-4444-4444-444444444441', 'bbbbbbbb-1111-1111-1111-111111111111', 'Producto B');
insert into public.variants (id, tenant_id, product_id, sku, options, regular_price, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X1', '{"T":"1"}', 20, 20, 10),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X2', '{"T":"2"}', 30, 25, 12),
  ('aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X3', '{"T":"3"}', null, null, 5),
  ('bbbbbbbb-5555-5555-5555-555555555551', 'bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-4444-4444-4444-444444444441', 'B1', '{}', 9, 9, 4);

select is((select priced_cost from public.variants where sku = 'X1'), 10.0000::numeric, 'al crearla con precio guarda el costo fijado');
select is((select priced_cost from public.variants where sku = 'X3'), null, 'sin precio no hay costo fijado');
select is((select reason from public.price_history where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 'Alta del producto', 'el alta queda en el historial');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- El cajero no puede.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.save_pricing_policy('{"target_margin": 50}') $$, '42501', 'No autorizado', 'el cajero no guarda la política');
select throws_ok(
  $$ select public.set_variant_prices('[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","regular_price":25}]') $$,
  '42501', 'No autorizado', 'el cajero no fija precios'
);
select throws_ok($$ insert into public.pricing_policies (tenant_id) values ('aaaaaaaa-1111-1111-1111-111111111111') $$, '42501', null, 'ni escribe la tabla directo');

-- El dueño sí.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.save_pricing_policy('{"target_margin": 60, "overhead_pct": 5, "min_margin": 15, "rounding": "99",
       "concepts": [{"name": " Vendedor ", "pct": 3, "active": true}, {"name": "Otro", "pct": 0, "active": false}]}') $$,
  'el dueño guarda la política'
);
select is(
  (select row(target_margin, overhead_pct, rounding, concepts -> 0 ->> 'name')::text from public.pricing_policies),
  row(60.00::numeric, 5.00::numeric, '99'::text, 'Vendedor'::text)::text,
  'queda guardada y limpia'
);
select lives_ok($$ select public.save_pricing_policy('{"target_margin": 40, "rounding": "none", "concepts": []}') $$, 'guardar otra vez la reemplaza');
select is((select count(*)::int from public.pricing_policies), 1, 'una sola política por negocio');
select throws_ok(
  $$ select public.save_pricing_policy('{"concepts": [{"name": "A", "pct": 50, "active": true}, {"name": "B", "pct": 45, "active": true}]}') $$,
  '23514', null, 'las comisiones no pueden comerse todo el precio'
);
select throws_ok($$ select public.save_pricing_policy('{"concepts": [{"name": "", "pct": 3, "active": true}]}') $$, '23514', null, 'concepto sin nombre');
select throws_ok($$ select public.save_pricing_policy('{"rounding": "77"}') $$, '23514', null, 'redondeo desconocido');

-- Fijar precios en bloque.
select is(
  public.set_variant_prices('[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","regular_price":24.5},
                              {"variant_id":"aaaaaaaa-5555-5555-5555-555555555552","regular_price":32}]', 'Fijación de precios'),
  2, 'fija dos precios'
);
select is((select row(regular_price, price)::text from public.variants where sku = 'X1'), row(24.50::numeric, 24.50::numeric)::text, 'sin oferta, el vigente sigue al de lista');
select is((select row(regular_price, price)::text from public.variants where sku = 'X2'), row(32.00::numeric, 25.00::numeric)::text, 'con oferta, la oferta se respeta');
select is(
  (select row(prev_regular_price, regular_price, reason)::text from public.price_history
    where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and prev_regular_price is not null),
  row(20.00::numeric, 24.50::numeric, 'Fijación de precios'::text)::text, 'el historial guarda antes, después y motivo'
);
select throws_ok(
  $$ select public.set_variant_prices('[{"variant_id":"bbbbbbbb-5555-5555-5555-555555555551","regular_price":1}]') $$,
  'P0002', 'Producto no encontrado', 'no toca productos de otro negocio'
);
select throws_ok(
  $$ select public.set_variant_prices('[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","regular_price":-1}]') $$,
  '23514', 'Precio inválido', 'precio negativo'
);

-- Cambia el costo: el precio queda por revisar y el historial lo anota.
update public.variants set cost = 11 where sku = 'X1';
select is((select row(cost, priced_cost)::text from public.variants where sku = 'X1'), row(11.0000::numeric, 10.0000::numeric)::text,
  'el costo fijado no cambia solo: queda por revisar');
select is(
  (select reason from public.price_history where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and prev_cost = 10 and cost = 11),
  'Cambio de costo', 'el cambio de costo queda en el historial'
);
update public.variants set priced_cost = 1 where sku = 'X1';
select is((select priced_cost from public.variants where sku = 'X1'), 10.0000::numeric, 'el costo fijado no se edita a mano');
select lives_ok($$ select public.set_variant_prices('[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","regular_price":26}]') $$, 'se vuelve a fijar');
select is((select priced_cost from public.variants where sku = 'X1'), 11.0000::numeric, 'y toma el costo nuevo');
select is((select count(*)::int from public.price_history where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 4, 'cuatro cambios anotados');
update public.variants set sku = 'X1b' where sku = 'X1';
select is((select count(*)::int from public.price_history where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 4, 'cambiar el SKU no anota nada');

-- Otro negocio no ve la política ni el historial de A.
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.pricing_policies), 0, 'otro negocio no ve la política');
select is((select count(*)::int from public.price_history where tenant_id <> 'bbbbbbbb-1111-1111-1111-111111111111'), 0, 'ni el historial');

select * from finish();
rollback;
