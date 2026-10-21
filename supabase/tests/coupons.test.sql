-- Cupones: los crea un encargado, se validan en el servidor y cuentan usos.

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
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333331', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja', 'C1');
insert into public.products (id, tenant_id, name) values ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'F1', 10);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 50);
-- Montos redondos: el IVA va incluido en el precio.
update public.tenants set prices_include_tax = true;

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.coupons (code, kind, value, min_purchase, max_uses) values
       ('DIEZ', 'percent', 10, 15, 1),
       ('CINCO', 'amount', 5, 0, null) $$,
  'el dueño crea cupones'
);
select throws_ok($$ insert into public.coupons (code, kind, value) values ('MAL', 'percent', 150) $$, '23514', null, 'un porcentaje no pasa de 100');
select throws_ok($$ insert into public.coupons (code, kind, value) values ('min', 'amount', 1) $$, '23514', null, 'el código va en mayúsculas');
insert into public.coupons (code, kind, value, ends_on) values ('VIEJO', 'amount', 1, current_date - 10);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ insert into public.coupons (code, kind, value) values ('CAJERO', 'amount', 1) $$, '42501', null, 'el cajero no crea cupones');

select is((public.validate_coupon(' diez ', 20) ->> 'discount')::numeric, 2.00, 'valida sin importar mayúsculas y espacios: 10 % de 20');
select is((public.validate_coupon('CINCO', 3) ->> 'discount')::numeric, 3.00, 'un monto no pasa de la compra');
select throws_ok($$ select public.validate_coupon('DIEZ', 10) $$, '23514', null, 'pide la compra mínima');
select throws_ok($$ select public.validate_coupon('VIEJO', 10) $$, '23514', 'El cupón está vencido', 'vencido');
select throws_ok($$ select public.validate_coupon('NOEXISTE', 10) $$, 'P0002', 'Cupón no válido', 'inexistente');

select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);

create function pg_temp.sell(p_key text, p_qty numeric, p_cart numeric, p_code text, p_coupon numeric, p_pay numeric) returns jsonb language sql as $$
  select public.register_sale_coupon(p_key, current_setting('test.session')::uuid,
    jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', p_qty)),
    jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', p_pay)),
    p_cart, p_code, p_coupon)
$$;

select throws_ok(
  $$ select pg_temp.sell('cupon-venta-01', 2, 5, 'DIEZ', 5, 15) $$,
  '23514', 'El descuento del cupón cambió; vuelve a aplicarlo',
  'el servidor recalcula el descuento: no acepta uno inventado'
);
select is((select count(*)::int from public.sales where idempotency_key = 'cupon-venta-01'), 0, 'y la venta no queda registrada');

select lives_ok($$ select pg_temp.sell('cupon-venta-02', 2, 2, 'DIEZ', 2, 18) $$, 'vende con el 10 %');
select results_eq(
  $$ select coupon_code, coupon_discount, total from public.sales where idempotency_key = 'cupon-venta-02' $$,
  $$ values ('DIEZ'::text, 2.00::numeric, 18.00::numeric) $$,
  'la venta guarda el cupón y su descuento'
);
select lives_ok($$ select pg_temp.sell('cupon-venta-02', 2, 2, 'DIEZ', 2, 18) $$, 'el reintento del mismo cobro no falla');
select is((select count(*)::int from public.sales where coupon_code = 'DIEZ'), 1, 'ni cuenta otro uso');
select throws_ok(
  $$ select pg_temp.sell('cupon-venta-03', 2, 2, 'DIEZ', 2, 18) $$,
  '23514', 'El cupón ya se usó todas las veces permitidas',
  'agotado tras su único uso'
);
select lives_ok($$ select pg_temp.sell('cupon-venta-04', 1, 6, 'CINCO', 5, 4) $$, 'cupón de monto más un descuento manual');
select is((select coupon_discount from public.sales where idempotency_key = 'cupon-venta-04'), 5.00::numeric, 'el cupón cuenta solo su parte');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  format($$ select public.void_sale(%L, 'Error') $$, (select id from public.sales where idempotency_key = 'cupon-venta-02')),
  'se anula la venta con el cupón'
);
select is((public.validate_coupon('DIEZ', 20) ->> 'discount')::numeric, 2.00, 'anular devuelve el uso');
select results_eq(
  $$ select c.code, u.uses from public.coupon_usage() u join public.coupons c on c.id = u.coupon_id order by 1 $$,
  $$ values ('CINCO'::text, 1) $$,
  'los usos vigentes por cupón'
);

-- Otro negocio no ve ni usa los cupones de A.
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty($$ select 1 from public.coupons $$, 'B no ve los cupones de A');
select throws_ok($$ select public.validate_coupon('CINCO', 20) $$, 'P0002', 'Cupón no válido', 'ni los valida');

select * from finish();
rollback;
