-- POS: caja y venta. Precios, tasa, impuestos e IGTF los calcula el servidor.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'cajero2-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja 1', 'C1');
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Pastillas'),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');
update public.products set tax_rate_id = (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento')
where id = 'aaaaaaaa-4444-4444-4444-444444444442';
insert into public.variants (id, tenant_id, product_id, sku, regular_price, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'PF', 12, 10, 4),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'FA', 5, null, 2);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 5),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222222', 2);
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 880, current_date - 1);

-- Ids de métodos para usar como cajero.
select set_config('test.cash_usd', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'cash_base'), true);
select set_config('test.cash_ves', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'cash_local'), true);
select set_config('test.mobile', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'mobile_payment'), true);
select set_config('test.zelle', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'zelle'), true);

-- ---------------------------------------------------------------------------
-- Cajero abre caja
-- ---------------------------------------------------------------------------

-- Estos casos se escribieron con precios con IVA incluido (ventas anteriores a
-- 20261119000000_net_prices.sql); el cálculo sigue soportándolo.
update public.tenants set prices_include_tax = true;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select set_config('test.session',
  public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333', '[{"currency":"USD","amount":20},{"currency":"VES","amount":1000}]') ->> 'session_id', true);
select ok(current_setting('test.session') <> '', 'el cajero abre caja con fondo en dólares y bolívares');
select throws_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333') $$,
  '23505', null,
  'una caja no abre dos sesiones a la vez'
);

-- ---------------------------------------------------------------------------
-- Venta 1: dos pastillas (IVA 16 % incluido) + un filtro exento, en efectivo $
-- ---------------------------------------------------------------------------

select results_eq(
  format($$ select (r ->> 'number'), (r ->> 'total')::numeric from public.register_sale(
       'venta-0001-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2},{"variant_id":"aaaaaaaa-5555-5555-5555-555555555552","qty":1}]',
       %L::jsonb) r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 25))),
  $$ values ('V-000001'::text, 25::numeric) $$,
  'vende al precio de la base de datos y numera la venta'
);
select results_eq(
  $$ select subtotal, discount_total, tax_total, total, paid_total, rate from public.sales where number = 'V-000001' $$,
  $$ values (25::numeric, 0::numeric, 2.76::numeric, 25::numeric, 25::numeric, 880::numeric) $$,
  'el IVA incluido sale del precio (20 − 20/1,16) y el exento no paga'
);
select results_eq(
  $$ select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' $$,
  $$ values (3::numeric) $$,
  'la venta descuenta el stock'
);
select results_eq(
  $$ select kind, qty_delta, note from public.inventory_movements where kind = 'sale' order by qty_delta $$,
  $$ values ('sale'::text, -2::numeric, 'Venta V-000001'::text), ('sale'::text, -1::numeric, 'Venta V-000001'::text) $$,
  'y deja el movimiento en el kardex'
);

-- Mismo cobro reenviado (doble toque o reconexión).
select results_eq(
  format($$ select (r ->> 'duplicate')::boolean, r ->> 'number' from public.register_sale(
       'venta-0001-aaaa', %L::uuid, '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2}]', %L::jsonb) r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 20))),
  $$ values (true, 'V-000001'::text) $$,
  'reenviar el mismo cobro no duplica la venta'
);
select results_eq(
  $$ select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' $$,
  $$ values (3::numeric) $$,
  'ni descuenta stock otra vez'
);

-- ---------------------------------------------------------------------------
-- Venta 2: pago móvil en bolívares a la tasa de la base, con descuento de carrito
-- ---------------------------------------------------------------------------

select results_eq(
  format($$ select (r ->> 'total')::numeric from public.register_sale(
       'venta-0002-aaaa', %L::uuid, '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]', %L::jsonb, 1) r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.mobile'), 'amount', 7920, 'bank', 'Banesco', 'reference', '004512'))),
  $$ values (9::numeric) $$,
  '9 $ cobrados con 7.920 Bs a 880'
);
select results_eq(
  $$ select currency, amount, amount_base from public.sale_payments p join public.sales s on s.id = p.sale_id where s.number = 'V-000002' $$,
  $$ values ('VES'::text, 7920::numeric, 9::numeric) $$,
  'el pago guarda bolívares y su equivalente en dólares'
);
select throws_ok(
  format($$ select public.register_sale('venta-0003-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]', %L::jsonb) $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.mobile'), 'amount', 8800))),
  '23514', 'Faltan datos del pago con Pago móvil',
  'pago móvil sin banco ni referencia no pasa'
);

-- ---------------------------------------------------------------------------
-- Montos que no cuadran, stock y productos ajenos
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select public.register_sale('venta-0004-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]', %L::jsonb) $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 5))),
  '23514', 'Falta cobrar 5.00 USD',
  'no se registra una venta pagada a medias'
);
select throws_ok(
  format($$ select public.register_sale('venta-0005-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]', %L::jsonb) $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 20))),
  '23514', 'Se cobró 10.00 USD de más: registra el vuelto',
  'un pago de más exige registrar el vuelto'
);
select results_eq(
  format($$ select (r ->> 'total')::numeric from public.register_sale('venta-0006-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]', %L::jsonb, 0, '{"currency":"VES","amount":8800}') r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 20))),
  $$ values (10::numeric) $$,
  'paga con 20 $ y recibe el vuelto en bolívares'
);
select throws_ok(
  format($$ select public.register_sale('venta-0007-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555552","qty":5}]', %L::jsonb) $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 25))),
  '23514', null,
  'sin stock suficiente no se vende'
);
select results_eq(
  $$ select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555552' $$,
  $$ values (1::numeric) $$,
  'y el intento fallido no toca el stock'
);
select throws_ok(
  format($$ select public.register_sale('venta-0008-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1,"discount":50}]', %L::jsonb) $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 1))),
  '23514', null,
  'un descuento mayor que la línea no pasa'
);
select throws_ok(
  $$ insert into public.sales (tenant_id, number, location_id, register_id, session_id, base_currency, prices_include_tax,
       subtotal, discount_total, tax_total, total, paid_total, units, idempotency_key)
     values ('aaaaaaaa-1111-1111-1111-111111111111', 'X', 'aaaaaaaa-2222-2222-2222-222222222222',
       'aaaaaaaa-3333-3333-3333-333333333333', current_setting('test.session')::uuid, 'USD', true, 0, 0, 0, 0, 0, 0, 'hecha-a-mano') $$,
  '42501', null,
  'nadie inserta ventas directo: solo por register_sale'
);

-- ---------------------------------------------------------------------------
-- IGTF para contribuyente especial
-- ---------------------------------------------------------------------------

reset role;
update public.tenants set is_special_taxpayer = true where id = 'aaaaaaaa-1111-1111-1111-111111111111';
set local role authenticated;
select results_eq(
  format($$ select (r ->> 'total')::numeric, (r ->> 'igtf')::numeric from public.register_sale('venta-0009-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]', %L::jsonb) r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.zelle'), 'amount', 10.30, 'reference', 'ZL-1'))),
  $$ values (10::numeric, 0.30::numeric) $$,
  'pagar 10 $ en Zelle exige 10,30: 0,30 de IGTF'
);

-- ---------------------------------------------------------------------------
-- Cierre
-- ---------------------------------------------------------------------------

select results_eq(
  format($$ select x ->> 'currency', (x ->> 'expected')::numeric
     from jsonb_array_elements(public.cash_session_summary(%L::uuid) -> 'cash') x order by 1 $$, current_setting('test.session')),
  $$ values ('USD'::text, 65::numeric), ('VES'::text, -7800::numeric) $$,
  'la gaveta espera fondo + ventas en efectivo − vuelto, por moneda'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.close_cash_session(%L::uuid, '[{"currency":"USD","amount":65},{"currency":"VES","amount":0}]') $$, current_setting('test.session')),
  '42501', null,
  'otro cajero no cierra una caja ajena'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  format($$ select x ->> 'currency', (x ->> 'difference')::numeric
     from jsonb_array_elements(public.close_cash_session(%L::uuid, '[{"currency":"USD","amount":64},{"currency":"VES","amount":0}]') -> 'cash') x order by 1 $$,
     current_setting('test.session')),
  $$ values ('USD'::text, -1::numeric), ('VES'::text, 7800::numeric) $$,
  'al cerrar queda la diferencia entre contado y esperado'
);
select throws_ok(
  format($$ select public.register_sale('venta-0010-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]', %L::jsonb) $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 10))),
  '23514', null,
  'con la caja cerrada no se vende'
);

-- ---------------------------------------------------------------------------
-- Otro negocio
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is_empty($$ select 1 from public.sales $$, 'B no ve las ventas de A');
select is_empty($$ select 1 from public.cash_sessions $$, 'B no ve las cajas de A');
select is_empty($$ select 1 from public.cash_movements $$, 'B no ve el libro de caja de A');
select throws_ok(
  format($$ select public.cash_session_summary(%L::uuid) $$, current_setting('test.session')),
  'P0002', null,
  'B no lee el resumen de una caja de A'
);
select throws_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333') $$,
  'P0002', null,
  'B no abre una caja de A'
);

reset role;
select * from finish();
rollback;
