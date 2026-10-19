-- POS en contingencia: ventas cobradas sin conexión y catálogo local.

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
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja 1', 'C1');
insert into public.products (id, tenant_id, name, brand) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Pastillas', 'Bosch'),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro', 'Toyota');
update public.products set tax_rate_id = (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento')
where id = 'aaaaaaaa-4444-4444-4444-444444444442';
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'PF', 10, 4),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'FA', 5, 2);
insert into public.product_codes (tenant_id, variant_id, kind, code) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'oem', '90915-YZZD2');
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 5);

-- Tasa de hace días y tasa de hoy (días de Caracas, como rate_at).
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 800, (now() at time zone 'America/Caracas')::date - 3),
  ('bcv', 'USD', 'VES', 900, (now() at time zone 'America/Caracas')::date);

select set_config('test.mobile', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'mobile_payment'), true);
select set_config('test.cash_usd', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'cash_base'), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333') ->> 'session_id', true);

-- La caja se abrió hace dos días (dentro de la transacción now() no avanza).
reset role;
update public.cash_sessions set opened_at = now() - interval '2 days' where id = current_setting('test.session')::uuid;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo para buscar sin conexión
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select sku, price, tax_rate, available, codes from public.pos_catalog_snapshot('aaaaaaaa-2222-2222-2222-222222222222') order by sku $$,
  $$ values ('FA'::text, 5::numeric, 0::numeric, 0::numeric, array['90915-YZZD2']::text[]),
            ('PF'::text, 10::numeric, 16::numeric, 5::numeric, '{}'::text[]) $$,
  'el catálogo local trae precio, impuesto, disponible en la sede y códigos'
);
select ok(
  (select search from public.pos_catalog_snapshot('aaaaaaaa-2222-2222-2222-222222222222') where sku = 'PF') like '%pastillas%bosch%',
  'el texto buscable incluye nombre y marca en minúsculas'
);

-- ---------------------------------------------------------------------------
-- Venta cobrada sin conexión, sincronizada después
-- ---------------------------------------------------------------------------

select results_eq(
  format($$ select (r ->> 'rate')::numeric, (r ->> 'duplicate')::boolean from public.register_sale(
       'offline-0001-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       %L::jsonb, 0, null, null, null, now() - interval '36 hours') r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.mobile'), 'amount', 8000, 'bank', 'Banesco', 'reference', '0001'))),
  $$ values (800::numeric, false) $$,
  'la venta sin conexión usa la tasa de la hora en que se cobró'
);
select results_eq(
  $$ select captured_offline, sold_at = now() - interval '36 hours' from public.sales where idempotency_key = 'offline-0001-aaaa' $$,
  $$ values (true, true) $$,
  'queda marcada como de contingencia con la hora del cobro'
);
select results_eq(
  format($$ select (r ->> 'duplicate')::boolean from public.register_sale(
       'offline-0001-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       %L::jsonb, 0, null, null, null, now() - interval '36 hours') r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.mobile'), 'amount', 8000, 'bank', 'Banesco', 'reference', '0001'))),
  $$ values (true) $$,
  'reintentar la sincronización no duplica la venta'
);
select is((select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 4.000, 'el stock baja una sola vez');

select results_eq(
  format($$ select (r ->> 'rate')::numeric from public.register_sale(
       'online-0001-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       %L::jsonb) r $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 10))),
  $$ values (900::numeric) $$,
  'la venta en línea usa la tasa de ahora'
);
select is((select captured_offline from public.sales where idempotency_key = 'online-0001-aaaa'), false, 'la venta en línea no queda marcada');

select throws_ok(
  format($$ select public.register_sale('offline-0002-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       %L::jsonb, 0, null, null, null, now() + interval '1 hour') $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 10))),
  '23514', 'La hora de la venta está en el futuro',
  'no acepta ventas con hora futura'
);
select throws_ok(
  format($$ select public.register_sale('offline-0003-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       %L::jsonb, 0, null, null, null, now() - interval '3 days') $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 10))),
  '23514', 'La venta es anterior a la apertura de la caja',
  'no acepta ventas anteriores a la apertura de la sesión'
);
select throws_ok(
  format($$ select public.register_sale('offline-0004-aaaa', %L::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":9}]',
       %L::jsonb, 0, null, null, null, now() - interval '1 hour') $$,
     current_setting('test.session'),
     jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_usd'), 'amount', 90))),
  '23514', null,
  'sin conexión tampoco deja el stock en negativo: se rechaza al sincronizar'
);

-- ---------------------------------------------------------------------------
-- Aislamiento
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is(
  (select count(*)::int from public.pos_catalog_snapshot('aaaaaaaa-2222-2222-2222-222222222222')),
  0,
  'otro negocio no ve el catálogo ajeno aunque pase la sede'
);

set local role anon;
select throws_ok(
  $$ select * from public.pos_catalog_snapshot('aaaaaaaa-2222-2222-2222-222222222222') $$,
  '42501', null,
  'anon no puede pedir el catálogo'
);

select * from finish();
rollback;
