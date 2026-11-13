-- Por pagar con Recepción (recepción a crédito) y con el banco (pagar desde una salida).

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
insert into public.tenant_entitlements (tenant_id, key, value)
values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '10'::jsonb)
on conflict do nothing;
insert into public.locations (id, tenant_id, name, code, type) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1', 'store'),
  ('aaaaaaaa-2222-2222-2222-222222222223', 'aaaaaaaa-1111-1111-1111-111111111111', 'Aliado X', 'ALX', 'external');
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Producto X');
insert into public.variants (id, tenant_id, product_id, sku, options, regular_price, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X1', '{"T":"1"}', 20, 20, 10),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X2', '{"T":"2"}', 30, 30, 12);
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.suppliers (id, name, credit_days) values ('aaaaaaaa-7777-7777-7777-777777777771', 'Proveedor X', 30);
insert into public.finance_accounts (id, name, kind, currency, institution, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', 'Banco X', current_date - 30);

-- ---------------------------------------------------------------------------
-- Recepción a crédito
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.receive_on_credit(jsonb_build_object(
       'location_id', 'aaaaaaaa-2222-2222-2222-222222222221', 'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771',
       'lines', jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 2)))) $$,
  '23514', 'A crédito, cada producto necesita su costo de compra', 'a crédito cada línea lleva costo'
);
select throws_ok(
  $$ select public.receive_on_credit(jsonb_build_object(
       'location_id', 'aaaaaaaa-2222-2222-2222-222222222223', 'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771',
       'lines', jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 2, 'unit_cost', 11)))) $$,
  '23514', 'La mercancía de un aliado no se compra a crédito', 'la sede de un aliado no recibe a crédito'
);

select set_config('test.rec', public.receive_on_credit(jsonb_build_object(
  'location_id', 'aaaaaaaa-2222-2222-2222-222222222221', 'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771',
  'document', 'F-500', 'issued_on', current_date, 'tax_amount', 16,
  'lines', jsonb_build_array(
    jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 5, 'unit_cost', 11, 'expected_qty', 6),
    jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555552', 'qty', 3, 'unit_cost', 15))))::text, true);
select results_eq(
  $$ select (current_setting('test.rec')::jsonb ->> 'lines')::int, (current_setting('test.rec')::jsonb ->> 'amount')::numeric $$,
  $$ values (2, 116::numeric) $$,
  'registra las dos líneas y la factura por 5×11 + 3×15 + IVA 16'
);
select results_eq(
  format($$ select p.source, p.subtotal, p.tax_amount, p.currency, p.category, p.location_id, i.due_date
            from public.payables p join public.payable_installments i on i.payable_id = p.id
            where p.id = %L $$, current_setting('test.rec')::jsonb ->> 'payable_id'),
  $$ values ('reception'::text, 100::numeric, 16::numeric, 'USD'::text, 'Proveedores'::text,
            'aaaaaaaa-2222-2222-2222-222222222221'::uuid, current_date + 30) $$,
  'la factura nace de Recepción, en mercancía, y vence a los días de crédito'
);
select results_eq(
  $$ select s.on_hand, v.cost from public.stocks s join public.variants v on v.id = s.variant_id
     where s.location_id = 'aaaaaaaa-2222-2222-2222-222222222221' and v.sku = 'X1' $$,
  $$ values (5::numeric, 11::numeric) $$,
  'entra la mercancía y el costo de compra pasa al producto'
);
select results_eq(
  $$ select supplier, expected_qty, unit_cost from public.inventory_movements
     where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and kind = 'entry' $$,
  $$ values ('Proveedor X'::text, 6::numeric, 11::numeric) $$,
  'el movimiento guarda el proveedor, lo esperado y el costo'
);

-- Factura repetida: no queda ni la entrada ni la factura.
select throws_ok(
  $$ select public.receive_on_credit(jsonb_build_object(
       'location_id', 'aaaaaaaa-2222-2222-2222-222222222221', 'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document', 'f-500',
       'lines', jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 9, 'unit_cost', 11)))) $$,
  '23505', 'Esa factura de este proveedor ya está cargada', 'la misma factura no se recibe dos veces'
);
select is(
  (select on_hand from public.stocks where location_id = 'aaaaaaaa-2222-2222-2222-222222222221' and variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'),
  5::numeric, 'y la mercancía de ese intento no entró'
);

-- ---------------------------------------------------------------------------
-- Pagar desde una salida del banco
-- ---------------------------------------------------------------------------

select public.import_bank_statement('aaaaaaaa-6666-6666-6666-666666666661', null, 'nov.csv', 'h', jsonb_build_array(
  jsonb_build_object('row', 2, 'date', current_date, 'direction', 'out', 'amount', 11600, 'reference', '801', 'description', 'TRANSF PROVEEDOR X'),
  jsonb_build_object('row', 3, 'date', current_date, 'direction', 'out', 'amount', 777, 'reference', '802', 'description', 'PAGO'),
  jsonb_build_object('row', 4, 'date', current_date, 'direction', 'in', 'amount', 11600, 'reference', '803', 'description', 'ENTRADA')
));
create temp table line_ids on commit drop as select row_number, id from public.bank_statement_lines;
grant select on line_ids to authenticated;

select results_eq(
  $$ select c ->> 'supplier_name', c ->> 'document', (c ->> 'applied')::numeric, c ->> 'match'
     from jsonb_array_elements(public.bank_payable_candidates((select id from line_ids where row_number = 2)) -> 'items') c limit 1 $$,
  $$ values ('Proveedor X'::text, 'F-500'::text, 116::numeric, 'installment'::text) $$,
  'Bs 11.600 a tasa 100 coincide con la factura de 116 USD'
);
select is(
  (public.bank_payable_candidates((select id from line_ids where row_number = 3)) -> 'items' -> 0 ->> 'match'), null,
  'un monto que no coincide queda sin sugerencia'
);
select is(
  jsonb_array_length(public.bank_payable_candidates((select id from line_ids where row_number = 4)) -> 'items'), 0,
  'una entrada no es pago a proveedor'
);
select throws_ok(
  format($$ select public.pay_payable_from_bank_line(%L, %L) $$, (select id from line_ids where row_number = 4), current_setting('test.rec')::jsonb ->> 'payable_id'),
  '23514', 'Un pago a proveedor es una salida del banco', 'no paga con una entrada'
);
select lives_ok(
  format($$ select public.pay_payable_from_bank_line(%L, %L) $$, (select id from line_ids where row_number = 2), current_setting('test.rec')::jsonb ->> 'payable_id'),
  'paga la factura desde la línea'
);
select results_eq(
  $$ select l.status, l.match_kind, m.kind, m.direction, m.amount, m.reference, p.amount, py.status
     from public.bank_statement_lines l
     join public.finance_movements m on m.id = l.movement_id
     join public.payable_payments p on p.movement_id = m.id
     join public.payables py on py.id = p.payable_id
     where l.row_number = 2 $$,
  $$ values ('matched'::text, 'created'::text, 'payable'::text, 'out'::text, 11600.00::numeric, '801'::text, 116.00::numeric, 'paid'::text) $$,
  'la línea queda conciliada y la factura pagada'
);

select is(public.reopen_bank_line((select id from line_ids where row_number = 2)), 'unmatched', 'desvincular el pago');
select results_eq(
  format($$ select paid, status from public.payables where id = %L $$, current_setting('test.rec')::jsonb ->> 'payable_id'),
  $$ values (0.00::numeric, 'open'::text) $$,
  'anula el pago y la factura vuelve a quedar abierta'
);

-- Cajero: ni recibe a crédito ni concilia pagos.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.receive_on_credit(jsonb_build_object(
       'location_id', 'aaaaaaaa-2222-2222-2222-222222222221', 'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771',
       'lines', jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 1, 'unit_cost', 11)))) $$,
  '42501', null, 'el cajero no recibe a crédito'
);
select throws_ok(
  $$ select public.bank_payable_candidates((select id from line_ids where row_number = 2)) $$,
  '42501', null, 'ni ve pagos del banco'
);

reset role;
select * from finish();
rollback;
