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

-- La cuenta en SQL da lo mismo que la app (pricing.test.ts).
select is(app.pricing_net(jsonb_populate_record(null::public.pricing_policies,
  '{"target_margin":50,"overhead_pct":0,"replacement_pct":0,"rounding":"none","concepts":[{"name":"V","pct":3,"active":true},{"name":"P","pct":2,"active":true},{"name":"X","pct":40,"active":false}]}'), 10, 16),
  15.79, 'costo + ganancia cubriendo comisiones activas');
select is(app.pricing_net(jsonb_populate_record(null::public.pricing_policies,
  '{"target_margin":50,"overhead_pct":0,"replacement_pct":0,"rounding":"99","concepts":[{"name":"V","pct":3,"active":true},{"name":"P","pct":2,"active":true}]}'), 10, 16),
  16.37, 'redondeo a ,99 y precio sin IVA que da el PVP exacto');
select is(app.pricing_net(jsonb_populate_record(null::public.pricing_policies,
  '{"target_margin":50,"overhead_pct":10,"replacement_pct":0,"rounding":"none","concepts":[]}'), 10, 0), 16.50, 'gastos de traída');
select is(app.pricing_net(jsonb_populate_record(null::public.pricing_policies,
  '{"target_margin":50,"overhead_pct":0,"replacement_pct":10,"rounding":"none","concepts":[]}'), 10, 0), 16.50, 'ajuste por reposición');
select is(app.pricing_net(jsonb_populate_record(null::public.pricing_policies,
  '{"target_margin":50,"overhead_pct":0,"replacement_pct":0,"rounding":"int","concepts":[]}'), 10, 16), 15.52, 'redondeo a entero: 18 de PVP');
select is(app.pricing_net(jsonb_populate_record(null::public.pricing_policies,
  '{"target_margin":50,"overhead_pct":0,"replacement_pct":0,"rounding":"none","concepts":[]}'), null, 16), null, 'sin costo no hay precio');

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
select is((select replacement_pct from public.pricing_policies), 0.00::numeric, 'sin ajuste por reposición salvo que se pida');
select lives_ok($$ select public.save_pricing_policy('{"target_margin": 40, "replacement_pct": 12.5, "rounding": "none", "concepts": [], "auto_on_cost": false}') $$, 'guardar otra vez la reemplaza');
select is((select replacement_pct from public.pricing_policies), 12.50::numeric, 'guarda el ajuste por reposición');
select throws_ok($$ select public.save_pricing_policy('{"replacement_pct": 500}') $$, '23514', null, 'ajuste fuera de rango');
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

-- Aplicar la política a todo el inventario.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.apply_pricing_policy(false) $$, '42501', 'No autorizado', 'el cajero no aplica la política');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.save_pricing_policy('{"target_margin": 50, "rounding": "none", "concepts": []}') $$, 'política con precio automático (por defecto)');
select is((select auto_on_cost from public.pricing_policies), true, 'el precio automático viene encendido');

-- Costo nuevo: el precio se recalcula; la oferta más baja se respeta.
update public.variants set cost = 20 where sku = 'X2';
select is((select row(regular_price, price, priced_cost)::text from public.variants where sku = 'X2'),
  row(30.00::numeric, 25.00::numeric, 20.0000::numeric)::text, 'costo nuevo, precio de la política');
select is((select reason from public.price_history where variant_id = 'aaaaaaaa-5555-5555-5555-555555555552' and cost = 20),
  'Cambio de costo', 'el historial lo anota como cambio de costo');
-- Si se escribe el precio a la vez, gana lo escrito.
update public.variants set cost = 8, regular_price = 99, price = 99 where sku = 'X3';
select is((select regular_price from public.variants where sku = 'X3'), 99.00::numeric, 'precio escrito junto al costo se respeta');

-- Precio manual: la política no lo toca.
select lives_ok($$ select public.set_variant_prices('[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555553","regular_price":50,"price_locked":true}]', 'Fijación manual') $$, 'fija un precio manual');
update public.variants set cost = 9 where sku = 'X3';
select is((select row(regular_price, price_locked, priced_cost)::text from public.variants where sku = 'X3'),
  row(50.00::numeric, true, 8.0000::numeric)::text, 'con precio manual el costo nuevo no mueve el precio: queda por revisar');
select throws_ok(
  $$ select public.set_variant_prices('[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555553","regular_price":5,"price_locked":"si"}]') $$,
  '23514', 'Precio inválido', 'precio manual tiene que ser sí o no'
);

-- Vista previa: solo cuenta.
select is(public.apply_pricing_policy(true),
  '{"changed": 1, "up": 0, "down": 1, "same": 1, "locked": 1, "no_cost": 0}'::jsonb, 'la vista previa cuenta lo que cambiaría');
select is((select regular_price from public.variants where sku = 'X1b'), 26.00::numeric, 'y no cambia nada');
select is((public.apply_pricing_policy(false) ->> 'applied')::int, 1, 'aplicar cambia uno');
select is((select row(regular_price, price, priced_cost)::text from public.variants where sku = 'X1b'),
  row(16.50::numeric, 16.50::numeric, 11.0000::numeric)::text, 'con el precio de la política');
select is((select reason from public.price_history where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and regular_price = 16.5),
  'Política de precios', 'el historial dice que fue la política');
select is((select regular_price from public.variants where sku = 'X3'), 50.00::numeric, 'el precio manual sigue igual');

-- Quitar el precio manual lo devuelve a la política.
select lives_ok($$ select public.set_variant_prices('[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555553","regular_price":13.5,"price_locked":false}]', 'Volver a la política') $$, 'vuelve a la política');
select is((select row(price_locked, priced_cost)::text from public.variants where sku = 'X3'), row(false, 9.0000::numeric)::text, 'deja de ser manual y toma el costo');

-- Producto nuevo con costo y sin precio: nace con el de la política.
insert into public.variants (tenant_id, product_id, sku, options, cost)
values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X4', '{"T":"4"}', 4);
select is((select row(regular_price, price, priced_cost)::text from public.variants where sku = 'X4'),
  row(6.00::numeric, 6.00::numeric, 4.0000::numeric)::text, 'producto nuevo con costo nace con precio');

-- Con el precio automático apagado vuelve el «por revisar».
select lives_ok($$ select public.save_pricing_policy('{"target_margin": 50, "rounding": "none", "concepts": [], "auto_on_cost": false}') $$, 'apaga el precio automático');
update public.variants set cost = 22 where sku = 'X2';
select is((select row(regular_price, priced_cost)::text from public.variants where sku = 'X2'), row(30.00::numeric, 20.0000::numeric)::text, 'apagado, el precio no se mueve');

-- Otro negocio no ve la política ni el historial de A.
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.pricing_policies), 0, 'otro negocio no ve la política');
select is((select count(*)::int from public.price_history where tenant_id <> 'bbbbbbbb-1111-1111-1111-111111111111'), 0, 'ni el historial');

select throws_ok($$ select public.apply_pricing_policy(true) $$, 'P0002', 'Primero guarda la política de precios', 'sin política no hay qué aplicar');

select * from finish();
rollback;
