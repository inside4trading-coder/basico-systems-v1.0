-- Reportes y cierres: cifras, permisos y negocio activo.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug, local_currency) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a', 'VES'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b', 'VES');
-- El dueño de A también es dueño de B: los reportes tienen que separar.
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner');

insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Centro', 'CEN'),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Este', 'EST'),
  ('bbbbbbbb-2222-2222-2222-222222222221', 'bbbbbbbb-1111-1111-1111-111111111111', 'Otra', 'OTR');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333331', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja Centro', 'C1'),
  ('aaaaaaaa-3333-3333-3333-333333333332', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja Este', 'C2'),
  ('bbbbbbbb-3333-3333-3333-333333333331', 'bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222221', 'Caja B', 'C1');

-- Productos exentos para que las cuentas sean redondas.
insert into public.products (id, tenant_id, name, tax_rate_id) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Pastillas',
     (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento')),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro',
     (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento')),
  ('aaaaaaaa-4444-4444-4444-444444444443', 'aaaaaaaa-1111-1111-1111-111111111111', 'Correa vieja',
     (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento')),
  ('bbbbbbbb-4444-4444-4444-444444444441', 'bbbbbbbb-1111-1111-1111-111111111111', 'Producto de B', null);
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'PF', 10, 4),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'FA', 5, null),
  ('aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444443', 'CV', 20, 12),
  ('bbbbbbbb-5555-5555-5555-555555555551', 'bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-4444-4444-4444-444444444441', 'BB', 99, 50);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 10),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 10),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 10),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-2222-2222-2222-222222222222', 3),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-5555-5555-5555-555555555551', 'bbbbbbbb-2222-2222-2222-222222222221', 5);
-- La correa llegó hace 200 días y nunca se vendió; el filtro llegó ayer.
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, created_at) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555553', 'aaaaaaaa-2222-2222-2222-222222222222', 'entry', 0, 3, 3, now() - interval '200 days'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-2222-2222-2222-222222222221', 'entry', 0, 10, 10, now() - interval '1 day'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 'entry', 0, 10, 10, now() - interval '200 days'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 'entry', 0, 10, 10, now() - interval '200 days');
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date - 30);

select set_config('test.cash_a', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'cash_base'), true);
select set_config('test.mobile_a', (select id::text from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and code = 'mobile_payment'), true);
select set_config('test.cash_b', (select id::text from public.payment_methods where tenant_id = 'bbbbbbbb-1111-1111-1111-111111111111' and code = 'cash_base'), true);
select set_config('test.today', ((now() at time zone 'America/Caracas')::date)::text, true);

-- ---------------------------------------------------------------------------
-- Ventas: el cajero vende en las dos sedes de A; el dueño vende en B
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select set_config('test.s1', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331', '[{"currency":"USD","amount":20}]') ->> 'session_id', true);
select set_config('test.s2', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333332') ->> 'session_id', true);

-- Centro: 2 pastillas (con costo) + 1 filtro (sin costo) en efectivo = 25.
select public.register_sale('rep-0001-aaaa', current_setting('test.s1')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2},{"variant_id":"aaaaaaaa-5555-5555-5555-555555555552","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_a'), 'amount', 25)));
-- Este: 1 pastilla por pago móvil = 10 (1000 Bs.).
select public.register_sale('rep-0002-aaaa', current_setting('test.s2')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.mobile_a'), 'amount', 1000, 'bank', 'Banesco', 'reference', '0001')));

-- Cierre del Centro con 1 $ de menos (esperado 45, contado 44).
select public.close_cash_session(current_setting('test.s1')::uuid, '[{"currency":"USD","amount":44},{"currency":"VES","amount":0}]');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('test.sb', public.open_cash_session('bbbbbbbb-3333-3333-3333-333333333331') ->> 'session_id', true);
select public.register_sale('rep-0003-bbbb', current_setting('test.sb')::uuid,
  '[{"variant_id":"bbbbbbbb-5555-5555-5555-555555555551","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash_b'), 'amount', 99)));

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select throws_ok($$ select public.report_sales(current_date, current_date) $$, '42501', null, 'el cajero no ve reportes (costos y márgenes)');
select throws_ok($$ select public.report_stock_value() $$, '42501', null, 'el cajero no ve el stock valorizado');
select throws_ok($$ select * from public.report_cash_sessions(current_date, current_date) $$, '42501', null, 'el cajero no ve los cierres');

-- ---------------------------------------------------------------------------
-- Dueño, con el negocio A activo
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('test.report', public.report_sales(current_setting('test.today')::date, current_setting('test.today')::date)::text, true);

select results_eq(
  $$ select (r -> 'summary' ->> 'tickets')::int, (r -> 'summary' ->> 'net')::numeric, (r -> 'summary' ->> 'units')::numeric
     from (select current_setting('test.report')::jsonb r) x $$,
  $$ values (2, 35::numeric, 4::numeric) $$,
  'resumen del día: solo el negocio activo (la venta de B no entra)'
);
select results_eq(
  $$ select (r -> 'summary' ->> 'lines')::int, (r -> 'summary' ->> 'lines_costed')::int,
            (r -> 'summary' ->> 'net_costed')::numeric, (r -> 'summary' ->> 'cost')::numeric
     from (select current_setting('test.report')::jsonb r) x $$,
  $$ values (3, 2, 30::numeric, 12::numeric) $$,
  'el margen solo cuenta líneas con costo'
);
select results_eq(
  $$ select e ->> 'name', (e ->> 'tickets')::int, (e ->> 'net')::numeric
     from (select current_setting('test.report')::jsonb r) x, jsonb_array_elements(r -> 'by_location') e $$,
  $$ values ('Centro'::text, 1, 25::numeric), ('Este'::text, 1, 10::numeric) $$,
  'ventas por sede, de mayor a menor'
);
select results_eq(
  $$ select e ->> 'sku', (e ->> 'qty')::numeric, (e ->> 'net')::numeric, (e ->> 'profit')::numeric, (e ->> 'costed')::boolean
     from (select current_setting('test.report')::jsonb r) x, jsonb_array_elements(r -> 'by_product') e $$,
  $$ values ('PF'::text, 3::numeric, 30::numeric, 18::numeric, true), ('FA'::text, 1::numeric, 5::numeric, null::numeric, false) $$,
  'ventas por producto con utilidad cuando hay costo'
);
select results_eq(
  $$ select e ->> 'method', (e ->> 'amount')::numeric, (e ->> 'amount_base')::numeric
     from (select current_setting('test.report')::jsonb r) x, jsonb_array_elements(r -> 'by_method') e $$,
  $$ values ('Efectivo USD'::text, 25::numeric, 25::numeric), ('Pago móvil'::text, 1000::numeric, 10::numeric) $$,
  'cobrado por método, en su moneda y en la base'
);
select is(
  (select e ->> 'seller' from jsonb_array_elements(current_setting('test.report')::jsonb -> 'by_seller') e),
  'cajero-a@test.local',
  'ventas por cajero'
);
select is(
  (select sum((e ->> 'net')::numeric) from jsonb_array_elements(current_setting('test.report')::jsonb -> 'by_day') e),
  35::numeric,
  'la serie por día suma lo mismo que el resumen'
);
select is(
  (current_setting('test.report')::jsonb -> 'previous' ->> 'tickets')::int, 0,
  'el periodo anterior se calcula aparte'
);
select is(
  (public.report_sales(current_setting('test.today')::date, current_setting('test.today')::date, 'aaaaaaaa-2222-2222-2222-222222222222') -> 'summary' ->> 'net')::numeric,
  10::numeric,
  'filtro por sede'
);
select throws_ok($$ select public.report_sales(current_date, current_date - 1) $$, '23514', null, 'rango invertido');

-- Stock valorizado: Centro 8 PF × 4 = 32 (el filtro no tiene costo); Este 9 PF × 4 + 3 CV × 12 = 72.
select results_eq(
  $$ select e ->> 'name', (e ->> 'units')::numeric, (e ->> 'cost_value')::numeric, (e ->> 'retail_value')::numeric, (e ->> 'missing_cost')::int
     from jsonb_array_elements(public.report_stock_value() -> 'by_location') e $$,
  $$ values ('Este'::text, 12::numeric, 72::numeric, 150::numeric, 0), ('Centro'::text, 17::numeric, 32::numeric, 125::numeric, 1) $$,
  'stock valorizado por sede a costo y a precio, avisando lo que no tiene costo'
);

-- Sin rotación en 60 días: solo la correa (las pastillas se vendieron, el filtro es nuevo).
select results_eq(
  $$ select sku, location_name, on_hand, cost_value from public.report_slow_movers(60) $$,
  $$ values ('CV'::text, 'Este'::text, 3::numeric, 36::numeric) $$,
  'sin rotación: con existencia vieja y sin ventas en el periodo'
);

-- Cierres
select results_eq(
  $$ select number, status, register_name, opened_by, sales_count, sales_total, has_difference
     from public.report_cash_sessions(current_setting('test.today')::date, current_setting('test.today')::date)
     order by number $$,
  $$ values ('C1-00001'::text, 'closed'::text, 'Caja Centro'::text, 'cajero-a@test.local'::text, 1::bigint, 25::numeric, true),
            ('C2-00002'::text, 'open'::text, 'Caja Este'::text, 'cajero-a@test.local'::text, 1::bigint, 10::numeric, false) $$,
  'cierres del día con quién abrió, ventas y si hubo diferencia'
);
select results_eq(
  $$ select (c ->> 'expected')::numeric, (c ->> 'counted')::numeric, (c ->> 'difference')::numeric
     from public.report_cash_sessions(current_setting('test.today')::date, current_setting('test.today')::date) r,
          jsonb_array_elements(r.counts) c
     where r.number = 'C1-00001' and c ->> 'currency' = 'USD' $$,
  $$ values (45::numeric, 44::numeric, -1::numeric) $$,
  'el cierre muestra esperado, contado y diferencia por moneda'
);

-- El catálogo sin conexión no mezcla negocios del mismo usuario.
select is(
  (select array_agg(sku order by sku) from public.pos_catalog_snapshot('aaaaaaaa-2222-2222-2222-222222222221')),
  array['CV', 'FA', 'PF']::text[],
  'el catálogo local trae solo productos del negocio activo'
);

select * from finish();
rollback;
