-- Número de factura en la venta: lo anota dueño, administrador o encargado.

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
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 5);

-- Estos casos se escribieron con precios con IVA incluido (ventas anteriores a
-- 20261119000000_net_prices.sql); el cálculo sigue soportándolo.
update public.tenants set prices_include_tax = true;

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select set_config('test.sale', (public.register_sale('inv-venta-01', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', (select id from public.payment_methods where code = 'cash_base'), 'amount', 10))) ->> 'sale_id'), true);

select throws_ok(
  format($$ select public.set_sale_invoice(%L, '00012345') $$, current_setting('test.sale')),
  '42501', null,
  'el cajero no anota facturas'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(format($$ select public.set_sale_invoice(%L, ' 00012345 ') $$, current_setting('test.sale')), 'el dueño la anota');
select is((select invoice_number from public.sales), '00012345', 'sin espacios');
select lives_ok(format($$ select public.set_sale_invoice(%L, '') $$, current_setting('test.sale')), 'y la puede quitar');
select is((select invoice_number from public.sales), null, 'vacía queda sin factura');
select throws_ok($$ select public.set_sale_invoice('bbbbbbbb-0000-0000-0000-000000000009', '1') $$, 'P0002', 'Venta no encontrada', 'venta ajena o inexistente');

select * from finish();
rollback;
