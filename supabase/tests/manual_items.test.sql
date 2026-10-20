-- Conceptos manuales en el POS: se cobran, no tocan inventario y se pueden anular y devolver.

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
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 5);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);
select set_config('test.exento', (select id::text from public.tax_rates where name = 'Exento'), true);

select set_config('test.sale', (public.register_sale('man-venta-01', current_setting('test.session')::uuid,
  jsonb_build_array(
    jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 1),
    jsonb_build_object('manual', true, 'kind', 'servicio', 'description', 'Mano de obra cambio de aceite', 'price', 15, 'qty', 1,
                       'tax_rate_id', current_setting('test.exento')),
    jsonb_build_object('manual', true, 'kind', 'producto', 'description', 'Tornillo suelto', 'price', 0.5, 'qty', 4)),
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 27))) ->> 'sale_id'), true);

select results_eq(
  $$ select line, manual_kind, description, unit_price, tax_rate, line_total, unit_cost is null from public.sale_items order by line $$,
  $$ values (1, null::text, 'Filtro'::text, 10.00::numeric, 16.00::numeric, 10.00::numeric, true),
            (2, 'servicio', 'Mano de obra cambio de aceite', 15.00, 0.00, 15.00, true),
            (3, 'producto', 'Tornillo suelto', 0.50, 16.00, 2.00, true) $$,
  'cobra los conceptos con su precio y el impuesto elegido o el del negocio'
);
select is((select total from public.sales where id = current_setting('test.sale')::uuid), 27.00::numeric, 'el total suma todo');
select is(
  (select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 4.000::numeric,
  'solo el producto del catálogo baja stock'
);
select is((select count(*)::int from public.inventory_movements where kind = 'sale'), 1, 'y deja un solo movimiento de inventario');

select throws_ok(
  format($$ select public.register_sale('man-venta-02', %L::uuid, '[{"manual":true,"price":5,"qty":1}]', %L::jsonb) $$,
         current_setting('test.session'), jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 5))),
  '23514', 'Línea 1: falta la descripción del concepto',
  'un concepto necesita descripción'
);
select throws_ok(
  format($$ select public.register_sale('man-venta-03', %L::uuid, '[{"manual":true,"description":"X","price":0,"qty":1}]', %L::jsonb) $$,
         current_setting('test.session'), jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 5))),
  '23514', 'Línea 1: precio inválido',
  'y un precio mayor que cero'
);

-- Devolver el servicio no repone inventario; anular la venta sí repone el filtro.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  format($$ select public.create_sale_return(%L::uuid, jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where line = 2), 'qty', 1)),
                                            'Servicio no realizado', true, %L, %L::uuid) $$,
         current_setting('test.sale'), current_setting('test.cash'), current_setting('test.session')),
  'se devuelve un concepto manual'
);
select is(
  (select on_hand from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'), 4.000::numeric,
  'sin tocar inventario'
);

select is(
  (select count(*)::int from jsonb_array_elements(public.report_sales(current_date, current_date) -> 'by_product') p where (p ->> 'manual')::boolean),
  2,
  'el reporte por producto muestra cada concepto aparte'
);

select * from finish();
rollback;
