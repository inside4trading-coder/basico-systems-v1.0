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
  array['Tienda', 'WhatsApp', 'Instagram', 'Delivery'],
  'un negocio nuevo trae cuatro orígenes'
);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);
select set_config('test.wa', (select id::text from public.sales_channels where name = 'WhatsApp'), true);

create function pg_temp.sell(p_key text, p_channel uuid) returns jsonb language sql as $$
  select public.register_sale(p_key, current_setting('test.session')::uuid,
    '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
    jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 10)),
    0, null, null, null, null, p_channel)
$$;

select lives_ok($$ select pg_temp.sell('ch-venta-01', current_setting('test.wa')::uuid) $$, 'vende con origen');
select is((select ch.name from public.sales s join public.sales_channels ch on ch.id = s.channel_id), 'WhatsApp', 'y lo guarda');
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
  $$ select pg_temp.sell('ch-venta-04', current_setting('test.wa')::uuid) $$,
  'P0002', 'Origen de venta no disponible',
  'un origen desactivado ya no se usa'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select c ->> 'channel', (c ->> 'tickets')::int from jsonb_array_elements(public.report_sales(current_date, current_date) -> 'by_channel') c order by 1 $$,
  $$ values ('Sin origen'::text, 1), ('WhatsApp', 1) $$,
  'el reporte suma por origen'
);

select * from finish();
rollback;
