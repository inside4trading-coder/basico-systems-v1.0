-- Precios sin IVA: la venta suma el IVA y el reporte de IVA lo acumula.

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
-- Un producto con el IVA del negocio (16 %) y otro exento.
insert into public.products (id, tenant_id, name, tax_rate_id) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro', null),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Pan',
   (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento'));
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'FA', 10, 4),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'PA', 2, 1);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 10),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222222', 10);
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;

select is(
  (select prices_include_tax from public.tenants where id = 'aaaaaaaa-1111-1111-1111-111111111111'), false,
  'un negocio nuevo escribe sus precios sin IVA'
);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ update public.tenants set prices_include_tax = true where id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  '42501', null,
  'el modo de precios ya no se cambia desde la app'
);

-- El cajero vende 2 filtros (10 + IVA) y 3 panes exentos.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);
select throws_ok(
  $$ select public.register_sale('iva-venta-0000', current_setting('test.session')::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2},{"variant_id":"aaaaaaaa-5555-5555-5555-555555555552","qty":3}]',
       jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 26))) $$,
  '23514', null,
  'cobrar solo el precio sin IVA no alcanza'
);
select set_config('test.sale', (public.register_sale('iva-venta-0001', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2},{"variant_id":"aaaaaaaa-5555-5555-5555-555555555552","qty":3}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 29.20))) ->> 'sale_id'), true);
select results_eq(
  format($$ select subtotal, tax_total, total from public.sales where id = %L $$, current_setting('test.sale')),
  $$ values (26.00::numeric, 3.20::numeric, 29.20::numeric) $$,
  'el IVA se suma al precio: 20 + 3,20 de IVA + 6 exento'
);
select results_eq(
  format($$ select unit_price, tax_amount, line_total from public.sale_items where sale_id = %L order by line $$, current_setting('test.sale')),
  $$ values (10.00::numeric, 3.20::numeric, 23.20::numeric), (2.00::numeric, 0.00::numeric, 6.00::numeric) $$,
  'cada línea guarda su base y su IVA'
);

-- El dueño ve el IVA del día y devuelve un filtro.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.today', ((now() at time zone 'America/Caracas')::date)::text, true);
select results_eq(
  $$ select (r ->> 'rate')::numeric, (r ->> 'base')::numeric, (r ->> 'tax')::numeric
     from jsonb_array_elements(public.report_tax(current_setting('test.today')::date, current_setting('test.today')::date) -> 'sales') r $$,
  $$ values (16.00::numeric, 20.00::numeric, 3.20::numeric), (0.00::numeric, 6.00::numeric, 0.00::numeric) $$,
  'el reporte de IVA separa la base gravada, su IVA y lo exento'
);
select lives_ok(
  format($$ select public.create_sale_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where sale_id = %L and line = 1), 'qty', 1)), 'El filtro no era') $$,
         current_setting('test.sale'), current_setting('test.sale')),
  'se devuelve un filtro'
);
select results_eq(
  $$ select (r ->> 'base')::numeric, (r ->> 'tax')::numeric
     from jsonb_array_elements(public.report_tax(current_setting('test.today')::date, current_setting('test.today')::date) -> 'returns') r $$,
  $$ values (10.00::numeric, 1.60::numeric) $$,
  'la devolución resta su base y su IVA'
);

select throws_ok(
  $$ select public.report_tax('2026-01-01', '2025-01-01') $$,
  '23514', 'Periodo inválido',
  'el periodo tiene que tener sentido'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.report_tax(current_date, current_date) $$,
  '42501', null,
  'el cajero no ve el reporte de IVA'
);

select * from finish();
rollback;
