-- Venta con factura (con IVA) o con nota de entrega (sin IVA).

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
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'FA', 10, 4);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 10);

select is(
  (select allow_delivery_notes from public.tenants where id = 'aaaaaaaa-1111-1111-1111-111111111111'), true,
  'la nota de entrega viene encendida'
);

-- Se apaga para probar el bloqueo.
update public.tenants set allow_delivery_notes = false where id = 'aaaaaaaa-1111-1111-1111-111111111111';

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333') ->> 'session_id', true);
select set_config('test.cash', (select id::text from public.payment_methods where code = 'cash_base'), true);

select throws_ok(
  $$ select public.register_sale('doc-venta-0000', current_setting('test.session')::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 10)),
       p_document_kind => 'delivery_note') $$,
  '23514', 'Este negocio no vende con nota de entrega',
  'sin habilitarla no se vende con nota'
);

-- El dueño la habilita.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.tenants set allow_delivery_notes = true where id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  'el dueño habilita la nota de entrega'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- Factura: 10 + 1,60 de IVA.
select set_config('test.invoice', (public.register_sale('doc-venta-0001', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 11.60))) ->> 'sale_id'), true);
select results_eq(
  format($$ select document_kind, tax_total, total from public.sales where id = %L $$, current_setting('test.invoice')),
  $$ values ('invoice'::text, 1.60::numeric, 11.60::numeric) $$,
  'sin elegir, la venta es factura con IVA'
);

-- Nota de entrega: el cliente paga 10, sin IVA.
select throws_ok(
  $$ select public.register_sale('doc-venta-0002', current_setting('test.session')::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 11.60)),
       p_document_kind => 'delivery_note') $$,
  '23514', null,
  'con nota no se cobra el IVA'
);
select set_config('test.note', (public.register_sale('doc-venta-0003', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 10)),
  p_document_kind => 'delivery_note') ->> 'sale_id'), true);
select results_eq(
  format($$ select document_kind, tax_total, total from public.sales where id = %L $$, current_setting('test.note')),
  $$ values ('delivery_note'::text, 0.00::numeric, 10.00::numeric) $$,
  'la nota de entrega queda sin IVA'
);
select results_eq(
  format($$ select tax_rate, tax_amount, line_total from public.sale_items where sale_id = %L $$, current_setting('test.note')),
  $$ values (16.00::numeric, 0.00::numeric, 10.00::numeric) $$,
  'la línea guarda la tasa del producto pero no cobra IVA'
);
select throws_ok(
  $$ select public.register_sale('doc-venta-0004', current_setting('test.session')::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       jsonb_build_array(jsonb_build_object('payment_method_id', current_setting('test.cash'), 'amount', 10)),
       p_document_kind => 'recibo') $$,
  '23514', 'Tipo de documento no válido',
  'solo factura o nota de entrega'
);

-- El reporte de IVA cuenta solo la factura; la nota va aparte.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.today', ((now() at time zone 'America/Caracas')::date)::text, true);
select results_eq(
  $$ select (r ->> 'rate')::numeric, (r ->> 'base')::numeric, (r ->> 'tax')::numeric
     from jsonb_array_elements(public.report_tax(current_setting('test.today')::date, current_setting('test.today')::date) -> 'sales') r $$,
  $$ values (16.00::numeric, 10.00::numeric, 1.60::numeric) $$,
  'el IVA del periodo sale solo de las facturas'
);
select results_eq(
  $$ select (x -> 'delivery_notes' ->> 'total')::numeric, (x -> 'delivery_notes' ->> 'tickets')::int, (x ->> 'tickets')::int
     from (select public.report_tax(current_setting('test.today')::date, current_setting('test.today')::date) as x) q $$,
  $$ values (10.00::numeric, 1, 1) $$,
  'las notas de entrega se ven aparte'
);

-- Devolver lo vendido con nota no resta IVA.
select lives_ok(
  format($$ select public.create_sale_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where sale_id = %L), 'qty', 1)), 'No era') $$,
         current_setting('test.note'), current_setting('test.note')),
  'se devuelve lo de la nota'
);
select is(
  (select jsonb_array_length(public.report_tax(current_setting('test.today')::date, current_setting('test.today')::date) -> 'returns')),
  0,
  'la devolución de una nota no toca el IVA'
);

select * from finish();
rollback;
