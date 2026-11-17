-- Por pagar: tipo de documento del proveedor (factura fiscal o nota de entrega).

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
insert into public.locations (id, tenant_id, name, code, type) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1', 'store');
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Producto X');
insert into public.variants (id, tenant_id, product_id, sku, options, regular_price, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X1', '{"T":"1"}', 20, 20, 10);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.suppliers (id, name, credit_days) values ('aaaaaaaa-7777-7777-7777-777777777771', 'Proveedor X', 15);

-- ---------------------------------------------------------------------------
-- Nueva cuenta por pagar
-- ---------------------------------------------------------------------------

select set_config('test.inv', public.create_payable(jsonb_build_object(
  'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document', '100', 'amount', 116, 'tax_amount', 16))::text, true);
select is(
  (select document_kind from public.payables where id = current_setting('test.inv')::uuid), 'invoice',
  'sin indicar el tipo queda como factura'
);

select throws_ok(
  $$ select public.create_payable(jsonb_build_object(
       'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document_kind', 'delivery_note', 'document', '7', 'amount', 50, 'tax_amount', 8)) $$,
  '23514', 'Una nota de entrega no lleva IVA', 'una nota con IVA se rechaza'
);
select throws_ok(
  $$ select public.create_payable(jsonb_build_object(
       'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document_kind', 'recibo', 'amount', 50)) $$,
  '23514', 'Tipo de documento inválido', 'un tipo desconocido se rechaza'
);

-- El mismo número como nota y como factura: numeraciones distintas.
select set_config('test.note', public.create_payable(jsonb_build_object(
  'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document_kind', 'delivery_note', 'document', '100', 'amount', 50))::text, true);
select results_eq(
  format($$ select document_kind, tax_amount from public.payables where id = %L $$, current_setting('test.note')),
  $$ values ('delivery_note'::text, null::numeric) $$,
  'una nota sin IVA se registra, aunque comparta número con una factura'
);
select throws_ok(
  $$ select public.create_payable(jsonb_build_object(
       'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document', '100', 'amount', 10)) $$,
  '23505', 'Esa factura de este proveedor ya está cargada', 'la misma factura no se carga dos veces'
);
select throws_ok(
  $$ select public.create_payable(jsonb_build_object(
       'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document_kind', 'delivery_note', 'document', '100', 'amount', 10)) $$,
  '23505', 'Esa nota de entrega de este proveedor ya está cargada', 'la misma nota no se carga dos veces'
);

-- ---------------------------------------------------------------------------
-- Recepción a crédito con nota de entrega
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.receive_on_credit(jsonb_build_object(
       'location_id', 'aaaaaaaa-2222-2222-2222-222222222221', 'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771',
       'document_kind', 'delivery_note', 'document', 'NE-1', 'tax_amount', 5,
       'lines', jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 2, 'unit_cost', 10)))) $$,
  '23514', 'Una nota de entrega no lleva IVA', 'la recepción con nota rechaza el IVA'
);
select is(
  (select coalesce(sum(on_hand), 0) from public.stocks where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551'),
  0::numeric, 'y no entra la mercancía de ese intento'
);
select set_config('test.rec', public.receive_on_credit(jsonb_build_object(
  'location_id', 'aaaaaaaa-2222-2222-2222-222222222221', 'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771',
  'document_kind', 'delivery_note', 'document', 'NE-1',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', 'aaaaaaaa-5555-5555-5555-555555555551', 'qty', 2, 'unit_cost', 10))))::text, true);
select results_eq(
  format($$ select document_kind, amount, tax_amount, source from public.payables where id = %L $$,
         current_setting('test.rec')::jsonb ->> 'payable_id'),
  $$ values ('delivery_note'::text, 20::numeric, null::numeric, 'reception'::text) $$,
  'la recepción a crédito crea la nota de entrega por las líneas'
);
select is(
  (select note from public.inventory_movements where variant_id = 'aaaaaaaa-5555-5555-5555-555555555551' and kind = 'entry'),
  'Nota de entrega NE-1 a crédito', 'el movimiento dice que fue con nota de entrega'
);

-- ---------------------------------------------------------------------------
-- Cambiar la nota por la factura
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select public.set_payable_document(%L, 'delivery_note', 'NE-1', null, 3) $$, current_setting('test.rec')::jsonb ->> 'payable_id'),
  '23514', 'Una nota de entrega no lleva IVA', 'corregir no permite IVA en una nota'
);
select throws_ok(
  format($$ select public.set_payable_document(%L, 'invoice', 'F-9', 'C-9', 25) $$, current_setting('test.rec')::jsonb ->> 'payable_id'),
  '23514', 'El IVA no puede superar el total', 'el IVA no supera lo que se debe'
);
select lives_ok(
  format($$ select public.set_payable_document(%L, 'invoice', 'F-9', 'C-9', 2.76) $$, current_setting('test.rec')::jsonb ->> 'payable_id'),
  'la nota pasa a factura con su n.º, control e IVA'
);
select results_eq(
  format($$ select p.document_kind, p.document, p.control_number, p.tax_amount, p.subtotal, p.amount, sum(i.amount)
            from public.payables p join public.payable_installments i on i.payable_id = p.id
            where p.id = %L group by p.id $$, current_setting('test.rec')::jsonb ->> 'payable_id'),
  $$ values ('invoice'::text, 'F-9'::text, 'C-9'::text, 2.76::numeric, 17.24::numeric, 20::numeric, 20::numeric) $$,
  'lo que se debe y las cuotas no cambian'
);
select throws_ok(
  format($$ select public.set_payable_document(%L, 'invoice', '100', null, null) $$, current_setting('test.rec')::jsonb ->> 'payable_id'),
  '23505', 'Esa factura de este proveedor ya está cargada', 'no choca con otra factura del mismo proveedor'
);

select public.cancel_payable(current_setting('test.note')::uuid, 'Error');
select throws_ok(
  format($$ select public.set_payable_document(%L, 'invoice', 'F-10', null, null) $$, current_setting('test.note')),
  '23514', 'La cuenta por pagar está anulada', 'no se corrige lo anulado'
);

-- ---------------------------------------------------------------------------
-- Beto y permisos
-- ---------------------------------------------------------------------------

select set_config('test.note2', public.create_payable(jsonb_build_object(
  'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document_kind', 'delivery_note', 'document', 'NE-2', 'amount', 30))::text, true);
select results_eq(
  $$ select (s ->> 'invoices')::int, (s ->> 'delivery_notes')::int from jsonb_array_elements(public.beto_payables_detail() -> 'by_supplier') s $$,
  $$ values (2, 1) $$,
  'Beto ve cuántas facturas y notas se deben por proveedor'
);
select ok(
  exists (select 1 from jsonb_array_elements(public.beto_payables_detail() -> 'installments') c
          where c ->> 'document' = 'NE-2' and c ->> 'document_kind' = 'delivery_note'),
  'Beto ve el tipo de cada documento'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.set_payable_document(%L, 'invoice', 'F-11', null, null) $$, current_setting('test.note2')),
  '42501', null, 'sin finanzas no se corrige el documento'
);

select * from finish();
rollback;
