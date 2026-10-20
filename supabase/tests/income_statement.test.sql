-- Resultado del periodo: ventas sin impuesto, costo, gastos del libro y otros ingresos.

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
-- Precio 116 con IVA 16 % incluido: 100 sin impuesto; costo 60.
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'F1', 116, 60);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 10);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select public.register_sale('inc-venta-01', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', (select id from public.payment_methods where code = 'cash_base'), 'amount', 232)));

reset role;
insert into public.finance_accounts (id, tenant_id, name, kind, currency, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'aaaaaaaa-1111-1111-1111-111111111111', 'Banco Bs', 'bank', 'VES', current_date - 30),
  ('aaaaaaaa-6666-6666-6666-666666666662', 'aaaaaaaa-1111-1111-1111-111111111111', 'Caja USD', 'cash', 'USD', current_date - 30);
insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-6666-6666-6666-666666666661', 'out', 'manual', 3000, 'VES', current_date, 'Servicios'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-6666-6666-6666-666666666662', 'out', 'manual', 50, 'USD', current_date, 'Alquiler'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-6666-6666-6666-666666666662', 'out', 'manual', 500, 'USD', current_date, 'Proveedores'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-6666-6666-6666-666666666662', 'in', 'manual', 20, 'USD', current_date, 'Otros ingresos');
set local role authenticated;

select results_eq(
  $$ select (r -> 'sales' ->> 'net')::numeric, (r -> 'sales' ->> 'cost')::numeric from public.report_income(current_date, current_date) r $$,
  $$ values (200.00::numeric, 120.00::numeric) $$,
  'ventas sin impuesto y su costo'
);
select is(
  (select public.report_income(current_date, current_date) -> 'expenses'),
  '[{"category": "Alquiler", "amount": 50.00}, {"category": "Servicios", "amount": 30.00}]'::jsonb,
  'gastos a la tasa del día, sin las compras de mercancía'
);
select is(
  (select public.report_income(current_date, current_date) -> 'other_income'),
  '[{"category": "Otros ingresos", "amount": 20.00}]'::jsonb,
  'y otros ingresos aparte de las ventas'
);
select throws_ok($$ select public.report_income(current_date, current_date - 1) $$, '23514', 'Periodo inválido', 'periodo al revés');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.report_income(current_date, current_date) $$, '42501', null, 'el cajero no ve el resultado');

select * from finish();
rollback;
