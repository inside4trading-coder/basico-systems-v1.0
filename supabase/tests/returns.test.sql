-- Anular ventas y devoluciones: stock, caja, libro y reportes.

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
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja 1', 'C1');
insert into public.products (id, tenant_id, name, tax_rate_id) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro',
   (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento'));
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'FA', 10, 4);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 10);
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;

select set_config('test.cash', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'cash_base'), true);
select set_config('test.mobile', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'mobile_payment'), true);

-- Dueño: cuenta en Bs para el pago móvil.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
insert into public.finance_accounts (id, name, kind, currency, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', current_date - 30);
update public.payment_methods set account_id = 'aaaaaaaa-6666-6666-6666-666666666661' where id = current_setting('test.mobile')::uuid;

-- Cajero vende.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333', '[{"currency":"USD","amount":20}]') ->> 'session_id', true);
select set_config('test.s1', (public.register_sale('ret-venta-0001', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 25)),
  0, '{"currency":"USD","amount":5}') ->> 'sale_id'), true);
select set_config('test.s2', (public.register_sale('ret-venta-0002', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.mobile'), 'amount', 1000, 'bank', 'Banesco', 'reference', 'PM-1'))) ->> 'sale_id'), true);

select throws_ok(
  format($$ select public.void_sale(%L, 'Error') $$, current_setting('test.s1')),
  '42501', null,
  'el cajero no anula'
);

-- ---------------------------------------------------------------------------
-- Anular
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format($$ select public.void_sale(%L, ' ') $$, current_setting('test.s1')), '23514', 'Indica por qué se anula', 'anular pide motivo');
select lives_ok(format($$ select public.void_sale(%L, 'Cobrada dos veces') $$, current_setting('test.s1')), 'el dueño anula la venta');
select results_eq(
  format($$ select status, void_reason from public.sales where id = %L $$, current_setting('test.s1')),
  $$ values ('voided'::text, 'Cobrada dos veces'::text) $$,
  'la venta queda anulada con su motivo'
);
select is(
  (select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 9::numeric,
  'el stock vuelve (10 − 2 − 1 + 2)'
);
select is(
  (select (c ->> 'expected')::numeric from jsonb_array_elements(public.cash_session_summary(current_setting('test.session')::uuid) -> 'cash') c where c ->> 'currency' = 'USD'),
  20::numeric,
  'sale de la gaveta lo cobrado y vuelve el vuelto: queda el fondo'
);
select throws_ok(format($$ select public.void_sale(%L, 'Otra vez') $$, current_setting('test.s1')), '23514', null, 'no se anula dos veces');

select lives_ok(format($$ select public.void_sale(%L, 'Cliente desistió') $$, current_setting('test.s2')), 'anula la venta por pago móvil');
select is(
  (select count(*)::int from public.finance_movements where kind = 'sale' and voided_at is null), 0,
  'y su entrada en el libro queda anulada'
);
select results_eq(
  format($$ select (s -> 'voided' ->> 'count')::int, (s -> 'sales' ->> 'count')::int from (select public.cash_session_summary(%L) s) x $$, current_setting('test.session')),
  $$ values (2, 0) $$,
  'el cierre muestra las anuladas aparte'
);

-- ---------------------------------------------------------------------------
-- Devolver después del cierre
-- ---------------------------------------------------------------------------

select set_config('test.s3', (public.register_sale('ret-venta-0003', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":3}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 30))) ->> 'sale_id'), true);
select set_config('test.item3', (select id::text from public.sale_items where sale_id = current_setting('test.s3')::uuid), true);
select public.close_cash_session(current_setting('test.session')::uuid, '[{"currency":"USD","amount":50},{"currency":"VES","amount":0}]');

select throws_ok(format($$ select public.void_sale(%L, 'x') $$, current_setting('test.s3')), '23514', null, 'con la caja cerrada no se anula');
select results_eq(
  format($$ select (r ->> 'number'), (r ->> 'total')::numeric from public.create_sale_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'qty', 1)), 'Pieza equivocada') r $$,
         current_setting('test.s3'), current_setting('test.item3')),
  $$ values ('D-000001'::text, 10::numeric) $$,
  'devuelve una unidad sin reintegro'
);
select is((select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 8::numeric, 'y repone el stock (10 − 3 + 1)');
select throws_ok(
  format($$ select public.create_sale_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'qty', 3)), 'Todo') $$, current_setting('test.s3'), current_setting('test.item3')),
  '23514', null,
  'no se devuelve más de lo vendido menos lo ya devuelto'
);
select throws_ok(
  format($$ select public.create_sale_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'qty', 1)), 'x', true, %L) $$,
         current_setting('test.s3'), current_setting('test.item3'), current_setting('test.cash')),
  '23514', 'Para reintegrar en efectivo abre una caja',
  'reintegrar en efectivo pide una caja abierta'
);

select set_config('test.session2', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333', '[{"currency":"USD","amount":50}]') ->> 'session_id', true);
select results_eq(
  format($$ select (r ->> 'refund_amount')::numeric, (r ->> 'refund_currency') from public.create_sale_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'qty', 1)),
         'Dañada', false, %L, %L) r $$,
         current_setting('test.s3'), current_setting('test.item3'), current_setting('test.cash'), current_setting('test.session2')),
  $$ values (10::numeric, 'USD'::text) $$,
  'devuelve con reintegro en efectivo'
);
select is((select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 8::numeric, 'sin reponer lo dañado');
select is(
  (select (c ->> 'expected')::numeric from jsonb_array_elements(public.cash_session_summary(current_setting('test.session2')::uuid) -> 'cash') c where c ->> 'currency' = 'USD'),
  40::numeric,
  'el reintegro sale de la gaveta abierta'
);
select results_eq(
  format($$ select (r ->> 'refund_amount')::numeric, (r ->> 'refund_currency') from public.create_sale_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'qty', 1)),
         'Otra', true, %L) r $$,
         current_setting('test.s3'), current_setting('test.item3'), current_setting('test.mobile')),
  $$ values (1000::numeric, 'VES'::text) $$,
  'reintegra por pago móvil en bolívares a la tasa vigente'
);
select is(
  (select amount from public.finance_movements where kind = 'refund' and direction = 'out'), 1000::numeric,
  'y sale de la cuenta del método en el libro'
);
select is(
  (select (app.sales_kpis('aaaaaaaa-1111-1111-1111-111111111111', now() - interval '1 day', now() + interval '1 day', null) ->> 'returns_total')::numeric),
  30::numeric,
  'los reportes suman las devoluciones'
);

select * from finish();
rollback;
