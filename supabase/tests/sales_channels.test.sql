-- Origen de la venta: se guarda en la venta, puede ser obligatorio y suma en el reporte.

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
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333331', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja', 'C1');
insert into public.products (id, tenant_id, name) values ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'F1', 10);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 50);

select is(
  (select array_agg(name order by position) from public.sales_channels where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111'),
  array['Tienda física', 'WhatsApp', 'Instagram', 'Cashea'],
  'un negocio nuevo trae cuatro orígenes'
);
select is(
  (select array_agg(name order by position) from public.sales_channels where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and requires_fulfillment),
  array['WhatsApp', 'Instagram', 'Cashea'],
  'los orígenes a distancia piden modalidad'
);

-- Estos casos se escribieron con precios con IVA incluido (ventas anteriores a
-- 20261119000000_net_prices.sql); el cálculo sigue soportándolo.
update public.tenants set prices_include_tax = true;

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);
select set_config('test.wa', (select id::text from public.sales_channels where name = 'WhatsApp'), true);

select set_config('test.store', (select id::text from public.sales_channels where name = 'Tienda física'), true);

create function pg_temp.sell(p_key text, p_channel uuid, p_fulfillment text default null, p_delivery jsonb default null)
returns jsonb language sql as $$
  select public.register_sale(p_key, current_setting('test.session')::uuid,
    '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
    jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 10)),
    0, null, null, null, null, p_channel, null, p_fulfillment, p_delivery)
$$;

create function pg_temp.envio(p_carrier text default 'MRW', p_drop text default null) returns jsonb language sql as $$
  select jsonb_build_object('first_name', 'Ana', 'last_name', 'Pérez', 'phone', '0414-1234567', 'doc', 'V-12345678',
    'address', 'Calle 5, casa 10', 'municipality', 'Iribarren', 'state', 'Lara', 'carrier', p_carrier, 'extra', 'x')
    - coalesce(p_drop, '')
$$;

select throws_ok($$ select pg_temp.sell('ch-modal-01', current_setting('test.wa')::uuid) $$, '23514',
  'Elige si la venta es para retirar o para enviar', 'WhatsApp sin modalidad no cobra');
select throws_ok($$ select pg_temp.sell('ch-modal-02', current_setting('test.wa')::uuid, 'domicilio') $$, '23514',
  'Modalidad de entrega no válida', 'solo retiro o envío');
select throws_ok($$ select pg_temp.sell('ch-modal-03', current_setting('test.store')::uuid, 'pickup') $$, '23514',
  'Este origen no lleva modalidad de entrega', 'la tienda física no lleva modalidad');
select throws_ok($$ select pg_temp.sell('ch-modal-04', current_setting('test.wa')::uuid, 'envio') $$, '23514',
  'Faltan datos del envío', 'envío sin datos no cobra');
select throws_ok($$ select pg_temp.sell('ch-modal-05', current_setting('test.wa')::uuid, 'envio', pg_temp.envio('MRW', 'state')) $$, '23514',
  'Faltan datos del envío', 'falta el estado');
select throws_ok($$ select pg_temp.sell('ch-modal-06', current_setting('test.wa')::uuid, 'envio', pg_temp.envio('Tealca')) $$, '23514',
  'Empresa de envío no válida', 'solo MRW, Zoom o Liberty');
select lives_ok($$ select pg_temp.sell('ch-modal-07', current_setting('test.wa')::uuid, 'envio', pg_temp.envio('Zoom')) $$, 'envío completo cobra');
select is((select fulfillment from public.sales where idempotency_key = 'ch-modal-07'), 'envio', 'guarda la modalidad');
select is((select delivery ->> 'carrier' from public.sales where idempotency_key = 'ch-modal-07'), 'Zoom', 'y la foto del envío');
select ok((select not (delivery ? 'extra') from public.sales where idempotency_key = 'ch-modal-07'), 'sin campos ajenos');
select lives_ok($$ select pg_temp.sell('ch-modal-08', current_setting('test.store')::uuid) $$, 'tienda física cobra sin modalidad');
select is((select fulfillment from public.sales where idempotency_key = 'ch-modal-08'), null, 'y sin modalidad');

select lives_ok($$ select pg_temp.sell('ch-venta-01', current_setting('test.wa')::uuid, 'pickup') $$, 'vende con origen');
select is((select ch.name from public.sales s join public.sales_channels ch on ch.id = s.channel_id where s.idempotency_key = 'ch-venta-01'), 'WhatsApp', 'y lo guarda');
select lives_ok($$ select pg_temp.sell('ch-venta-02', null) $$, 'sin obligación, el origen es opcional');

select throws_ok(
  $$ insert into public.sales_channels (name) values ('Feria') $$,
  '42501', null,
  'el cajero no crea orígenes'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.tenants set channel_required = true where id = 'aaaaaaaa-1111-1111-1111-111111111111';
update public.sales_channels set is_active = false where name = 'WhatsApp';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select pg_temp.sell('ch-venta-03', null) $$, '23514', 'Elige el origen de la venta', 'obligatorio: sin origen no cobra');
select throws_ok(
  $$ select pg_temp.sell('ch-venta-04', current_setting('test.wa')::uuid, 'pickup') $$,
  'P0002', 'Origen de venta no disponible',
  'un origen desactivado ya no se usa'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select c ->> 'channel', (c ->> 'tickets')::int from jsonb_array_elements(public.report_sales((now() at time zone 'America/Caracas')::date, (now() at time zone 'America/Caracas')::date) -> 'by_channel') c order by 1 $$,
  $$ values ('Sin origen'::text, 1), ('Tienda física', 1), ('WhatsApp', 2) $$,
  'el reporte suma por origen'
);

select * from finish();
rollback;
