-- Venta por encargo: la existencia sale del aliado (sede externa), queda un
-- pendiente por pagarle el costo, y anular o devolver lo revierte.

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
insert into public.locations (id, tenant_id, name, code, type, sells_in_pos) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1', 'store', true),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Aliado X', 'ALX', 'external', false),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111', 'Aliado de B', 'ALB', 'external', false);
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333331', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja', 'C1');
insert into public.products (id, tenant_id, name, tax_rate_id) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Base motor',
   (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento'));
insert into public.variants (id, tenant_id, product_id, sku, regular_price, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'BM1', 10, 10, 6);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 3);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);

create function pg_temp.sell(p_key text, p_qty numeric, p_from text, p_amount numeric) returns uuid language sql as $$
  select (public.register_sale(p_key, current_setting('test.session')::uuid,
    jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', p_qty)
                      || case when p_from is null then '{}'::jsonb else jsonb_build_object('from_location_id', p_from) end),
    jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', p_amount))) ->> 'sale_id')::uuid
$$;

-- Vender 2 por encargo.
select set_config('test.s1', pg_temp.sell('encargo-01', 2, 'aaaaaaaa-2222-2222-2222-222222222222', 20)::text, true);
select is(
  (select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and location_id = 'aaaaaaaa-2222-2222-2222-222222222222'),
  1.000::numeric, 'el encargo descuenta la existencia del aliado'
);
select is(
  (select coalesce(sum(on_hand), 0) from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and location_id = 'aaaaaaaa-2222-2222-2222-222222222221'),
  0::numeric, 'y no toca la existencia de la tienda'
);
select results_eq(
  $$ select status, qty, unit_cost, amount, location_id from public.partner_payables $$,
  $$ values ('pending'::text, 2.000::numeric, 6.0000::numeric, 12.00::numeric, 'aaaaaaaa-2222-2222-2222-222222222222'::uuid) $$,
  'queda pendiente pagarle al aliado el costo'
);
select is(
  (select source_location_id from public.sale_items where sale_id = current_setting('test.s1')::uuid),
  'aaaaaaaa-2222-2222-2222-222222222222'::uuid, 'la línea recuerda de dónde salió'
);
select ok(
  (select note like '%encargo Aliado X%' from public.inventory_movements where kind = 'sale' and location_id = 'aaaaaaaa-2222-2222-2222-222222222222'),
  'el movimiento dice que fue por encargo'
);

select throws_ok(
  $$ select pg_temp.sell('encargo-02', 5, 'aaaaaaaa-2222-2222-2222-222222222222', 50) $$,
  '23514', null, 'no vende más de lo que tiene el aliado'
);
select throws_ok(
  $$ select pg_temp.sell('encargo-03', 1, 'aaaaaaaa-2222-2222-2222-222222222221', 10) $$,
  'P0002', 'Línea 1: aliado no disponible', 'una sede propia no es un aliado'
);
select throws_ok(
  $$ select pg_temp.sell('encargo-04', 1, 'bbbbbbbb-2222-2222-2222-222222222222', 10) $$,
  'P0002', 'Línea 1: aliado no disponible', 'ni el aliado de otro negocio'
);
select throws_ok(
  $$ select pg_temp.sell('encargo-05', 1, null, 10) $$,
  '23514', null, 'sin encargo vende de la tienda, que no tiene'
);
select throws_ok(
  $$ select public.partner_payables_mark_paid(array(select id from public.partner_payables)) $$,
  '42501', 'No autorizado', 'el cajero no marca pagos al aliado'
);

-- Anular devuelve la existencia al aliado y cancela el pendiente.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(format($$ select public.void_sale(%L::uuid, 'Error') $$, current_setting('test.s1')), 'se anula la venta');
select is(
  (select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and location_id = 'aaaaaaaa-2222-2222-2222-222222222222'),
  3.000::numeric, 'la existencia vuelve al aliado'
);
select is((select status from public.partner_payables where sale_id = current_setting('test.s1')::uuid), 'cancelled', 'y el pendiente se cancela');

-- Devolver una de dos reduce lo que se le debe.
select set_config('test.s2', pg_temp.sell('encargo-06', 2, 'aaaaaaaa-2222-2222-2222-222222222222', 20)::text, true);
select lives_ok(
  format($$ select public.create_sale_return(%L::uuid, jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where sale_id = %L::uuid), 'qty', 1)), 'No sirvió') $$,
         current_setting('test.s2'), current_setting('test.s2')),
  'se devuelve una unidad'
);
select results_eq(
  format($$ select status, qty, amount from public.partner_payables where sale_id = %L::uuid $$, current_setting('test.s2')),
  $$ values ('pending'::text, 1.000::numeric, 6.00::numeric) $$,
  'se le debe una sola al aliado'
);
select is(
  (select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and location_id = 'aaaaaaaa-2222-2222-2222-222222222222'),
  2.000::numeric, 'y esa unidad vuelve al aliado'
);

-- Pagar y costo editable.
select is(public.partner_payables_mark_paid(array(select id from public.partner_payables where status = 'pending')), 1, 'el dueño marca pagado');
select is((select status from public.partner_payables where sale_id = current_setting('test.s2')::uuid), 'paid', 'queda pagado');

reset role;
update public.variants set cost = null where id = 'aaaaaaaa-5555-5555-5555-555555555551';
set local role authenticated;
select set_config('test.s3', pg_temp.sell('encargo-07', 1, 'aaaaaaaa-2222-2222-2222-222222222222', 10)::text, true);
select is((select amount from public.partner_payables where sale_id = current_setting('test.s3')::uuid), null::numeric, 'sin costo queda por definir');
select throws_ok(
  format($$ select public.partner_payables_mark_paid(array(select id from public.partner_payables where sale_id = %L::uuid)) $$, current_setting('test.s3')),
  '23514', 'Hay encargos sin costo: complétalo antes de pagar', 'no se paga sin costo'
);
select lives_ok(
  format($$ select public.set_partner_payable_cost((select id from public.partner_payables where sale_id = %L::uuid), 7) $$, current_setting('test.s3')),
  'se completa el costo'
);
select is((select amount from public.partner_payables where sale_id = current_setting('test.s3')::uuid), 7.00::numeric, 'y el monto se calcula');

-- Otro negocio no ve los pendientes.
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.partner_payables), 0, 'otro negocio no ve los pendientes');

select * from finish();
rollback;
