-- Personal de caja: se elige en el POS, queda en la venta y nombra el reporte por cajero.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '5');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero');
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1'),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Otra', 'T2');
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
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.cashiers (id, name, location_id) values
       ('aaaaaaaa-7777-7777-7777-777777777771', 'Yolimar', 'aaaaaaaa-2222-2222-2222-222222222221'),
       ('aaaaaaaa-7777-7777-7777-777777777772', 'Luis', null),
       ('aaaaaaaa-7777-7777-7777-777777777773', 'Pedro', 'aaaaaaaa-2222-2222-2222-222222222222') $$,
  'el dueño registra al personal de caja'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ insert into public.cashiers (name) values ('Otro') $$, '42501', null, 'el cajero no registra personal');
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331', '[]', null, 'aaaaaaaa-7777-7777-7777-777777777771') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);

create function pg_temp.sell(p_key text, p_cashier uuid) returns jsonb language sql as $$
  select public.register_sale(p_key, current_setting('test.session')::uuid,
    '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
    jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 10)),
    0, null, null, null, null, null, p_cashier)
$$;

select lives_ok($$ select pg_temp.sell('ca-venta-01', 'aaaaaaaa-7777-7777-7777-777777777771') $$, 'vende con el cajero de la sede');
select lives_ok($$ select pg_temp.sell('ca-venta-02', 'aaaaaaaa-7777-7777-7777-777777777772') $$, 'o con uno de todas las sedes');
select lives_ok($$ select pg_temp.sell('ca-venta-03', null) $$, 'o sin cajero explícito (toma el de la sesión)');
select throws_ok(
  $$ select pg_temp.sell('ca-venta-04', 'aaaaaaaa-7777-7777-7777-777777777773') $$,
  'P0002', 'Cajero no disponible en esta sede',
  'no con el de otra sede'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.cashiers set is_active = false where name = 'Luis';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select pg_temp.sell('ca-venta-05', 'aaaaaaaa-7777-7777-7777-777777777772') $$,
  'P0002', null,
  'ni con uno desactivado'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select c ->> 'seller', (c ->> 'tickets')::int from jsonb_array_elements(public.report_sales((now() at time zone 'America/Caracas')::date, (now() at time zone 'America/Caracas')::date) -> 'by_seller') c order by 1 $$,
  $$ values ('Luis'::text, 1), ('Yolimar', 2) $$,
  'por cajero: el personal por su nombre; la venta sin cajero explícito queda con el de la sesión'
);

select * from finish();
rollback;
