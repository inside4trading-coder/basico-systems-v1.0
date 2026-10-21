-- Ficha de clientes: se crea o se reconoce al vender.

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
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333331', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja', 'C1');
insert into public.products (id, tenant_id, name) values ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'F1', 10);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 50);

-- Estos casos se escribieron con precios con IVA incluido (ventas anteriores a
-- 20261119000000_net_prices.sql); el cálculo sigue soportándolo.
update public.tenants set prices_include_tax = true;

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);

create function pg_temp.sell(p_key text, p_customer jsonb) returns uuid language sql as $$
  select (public.register_sale(p_key, current_setting('test.session')::uuid,
    '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
    jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 10)),
    0, null, p_customer) ->> 'sale_id')::uuid
$$;

select pg_temp.sell('cli-venta-01', '{"name":"Taller El Rápido","doc":"J-40123456-7","phone":"0414-555.12.34"}');
select results_eq(
  $$ select name, doc, phone, doc_key, phone_key from public.customers $$,
  $$ values ('Taller El Rápido'::text, 'J-40123456-7'::text, '0414-555.12.34'::text, 'J401234567'::text, '4145551234'::text) $$,
  'el cajero crea la ficha al cobrar'
);
select is(
  (select count(*)::int from public.sales where customer_id is not null), 1,
  'y la venta queda vinculada'
);

select pg_temp.sell('cli-venta-02', '{"name":"Taller el rapido","doc":"j 40.123.456 7"}');
select is((select count(*)::int from public.customers), 1, 'el mismo RIF escrito distinto es el mismo cliente');
select pg_temp.sell('cli-venta-03', '{"name":"Otro nombre","phone":"+58 414 5551234"}');
select is((select count(*)::int from public.customers), 1, 'el mismo teléfono también');
select is(
  (select count(distinct customer_id)::int from public.sales), 1,
  'las tres ventas son del mismo cliente'
);

select pg_temp.sell('cli-venta-04', '{"name":"Señora del mostrador"}');
select is((select count(*)::int from public.customers), 1, 'solo con nombre no se crea ficha');
select is(
  (select customer_name from public.sales where idempotency_key = 'cli-venta-04'), 'Señora del mostrador',
  'pero el nombre queda en la venta'
);

select set_config('test.cid', (select id::text from public.customers limit 1), true);
select pg_temp.sell('cli-venta-05', jsonb_build_object('id', current_setting('test.cid')));
select results_eq(
  $$ select customer_name, customer_doc from public.sales where idempotency_key = 'cli-venta-05' $$,
  $$ values ('Taller El Rápido'::text, 'J-40123456-7'::text) $$,
  'elegido de la ficha, la venta copia nombre y documento'
);
select throws_ok(
  $$ select pg_temp.sell('cli-venta-06', '{"id":"bbbbbbbb-0000-0000-0000-000000000009"}') $$,
  'P0002', 'Cliente no encontrado',
  'no se vende a un cliente de otro negocio'
);

select results_eq(
  $$ select (c ->> 'purchases')::int, (c ->> 'total')::numeric from jsonb_array_elements(public.customers_overview('4145551234')) c $$,
  $$ values (4, 40::numeric) $$,
  'la búsqueda por teléfono trae compras y total'
);
select is(jsonb_array_length(public.customers_overview('j-401234567')), 1, 'y por RIF con otro formato');
select is(jsonb_array_length(public.customers_overview('rápido')), 1, 'y por nombre');

select lives_ok(
  format($$ update public.customers set email = 'taller@ejemplo.com', address = 'Cabudare' where id = %L $$, current_setting('test.cid')),
  'el cajero corrige datos de la ficha'
);
select throws_ok(
  format($$ delete from public.customers where id = %L $$, current_setting('test.cid')),
  '42501', null,
  'pero no la borra'
);
select throws_ok(
  $$ insert into public.customers (name, doc) values ('Duplicado', 'J40123456-7') $$,
  '23505', null,
  'no hay dos fichas con el mismo RIF'
);

select * from finish();
rollback;
