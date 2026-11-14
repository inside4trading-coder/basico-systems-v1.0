-- Cuentas por pagar: proveedores, facturas, cuotas en cascada, pagos en otra
-- moneda, notas de crédito, anulaciones, resumen, resultado y permisos.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'encargado-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'manager'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.finance_accounts (id, name, kind, currency, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Caja USD', 'cash', 'USD', current_date - 30),
  ('aaaaaaaa-6666-6666-6666-666666666662', 'Banco Bs', 'bank', 'VES', current_date - 30);

-- ---------------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------------

insert into public.suppliers (id, name, tax_id, credit_days) values
  ('aaaaaaaa-7777-7777-7777-777777777771', 'Proveedor X', 'J-12345678-9', 15),
  ('aaaaaaaa-7777-7777-7777-777777777772', 'Servicios Y', null, 0);
select throws_ok(
  $$ insert into public.suppliers (name) values ('  proveedor x ') $$,
  '23505', null, 'no se repite un proveedor (sin importar mayúsculas ni espacios)'
);
select lives_ok(
  $$ update public.suppliers set phone = '0414-0000000' where id = 'aaaaaaaa-7777-7777-7777-777777777771' $$,
  'el dueño edita un proveedor'
);

-- ---------------------------------------------------------------------------
-- Factura de mercancía con una cuota a los días de crédito
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.create_payable('{"amount": 100}'::jsonb) $$, '23514', 'Elige el proveedor', 'pide proveedor');
select throws_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'amount', 0)) $$,
  '23514', 'Monto inválido', 'pide monto'
);
select set_config('test.p1', public.create_payable(jsonb_build_object(
  'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document', 'F-100', 'issued_on', current_date - 20,
  'amount', 116, 'tax_amount', 16))::text, true);
select results_eq(
  format($$ select p.currency, p.category, p.subtotal, p.status, i.due_date, i.amount
            from public.payables p join public.payable_installments i on i.payable_id = p.id where p.id = %L $$, current_setting('test.p1')),
  $$ values ('USD'::text, 'Proveedores'::text, 100::numeric, 'open'::text, current_date - 5, 116::numeric) $$,
  'sin cuotas: una sola a los días de crédito del proveedor; base = total − IVA'
);
select throws_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document', 'f-100', 'amount', 5)) $$,
  '23505', 'Esa factura de este proveedor ya está cargada', 'la misma factura no se carga dos veces'
);
select throws_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'amount', 10, 'tax_amount', 11)) $$,
  '23514', null, 'el IVA no supera el total'
);

-- ---------------------------------------------------------------------------
-- Factura en cuotas, pagos en cascada y en otra moneda
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'amount', 300,
       'installments', jsonb_build_array(jsonb_build_object('due_date', current_date, 'amount', 100)))) $$,
  '23514', null, 'las cuotas deben sumar el total'
);
select set_config('test.p2', public.create_payable(jsonb_build_object(
  'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document', 'F-200', 'issued_on', current_date - 40, 'amount', 300,
  'installments', jsonb_build_array(
    jsonb_build_object('due_date', current_date - 10, 'amount', 100),
    jsonb_build_object('due_date', current_date + 3, 'amount', 100),
    jsonb_build_object('due_date', current_date + 40, 'amount', 100))))::text, true);

select set_config('test.pay1', public.pay_payable(current_setting('test.p2')::uuid,
  'aaaaaaaa-6666-6666-6666-666666666661', 130, current_date, null, 'TRF-1')::text, true);
select results_eq(
  format($$ select array_agg(paid order by number) from public.payable_installments where payable_id = %L $$, current_setting('test.p2')),
  $$ values (array[100, 30, 0]::numeric[]) $$,
  'el pago se reparte desde la cuota más vieja'
);
select results_eq(
  format($$ select m.direction, m.kind, m.amount, m.category, m.counterparty from public.finance_movements m
            join public.payable_payments p on p.movement_id = m.id where p.id = %L $$, current_setting('test.pay1')),
  $$ values ('out'::text, 'payable'::text, 130::numeric, 'Proveedores'::text, 'Proveedor X'::text) $$,
  'el pago deja la salida en el libro'
);
select throws_ok(
  format($$ select public.pay_payable(%L, 'aaaaaaaa-6666-6666-6666-666666666662', 5000, current_date) $$, current_setting('test.p2')),
  '23514', 'Indica cuánto cubre el pago en USD', 'desde otra moneda pide cuánto cubre'
);
select lives_ok(
  format($$ select public.pay_payable(%L, 'aaaaaaaa-6666-6666-6666-666666666662', 5000, current_date, 50) $$, current_setting('test.p2')),
  'paga en bolívares lo que cubre 50 USD'
);
select results_eq(
  format($$ select m.amount, m.currency, p.amount from public.payable_payments p join public.finance_movements m on m.id = p.movement_id
            where p.payable_id = %L and m.currency = 'VES' $$, current_setting('test.p2')),
  $$ values (5000::numeric, 'VES'::text, 50::numeric) $$,
  'el libro guarda los bolívares; la factura baja 50 USD'
);
select throws_ok(
  format($$ select public.pay_payable(%L, 'aaaaaaaa-6666-6666-6666-666666666661', 200, current_date) $$, current_setting('test.p2')),
  '23514', null, 'no se paga más de lo que falta'
);
select set_config('test.cn', public.credit_payable(current_setting('test.p2')::uuid, 20, current_date, 'NC-1', 'Mercancía dañada')::text, true);
select results_eq(
  format($$ select paid, status from public.payables where id = %L $$, current_setting('test.p2')),
  $$ values (200::numeric, 'open'::text) $$,
  'la nota de crédito baja la deuda sin mover dinero'
);
select is(
  (select count(*)::int from public.finance_movements m join public.payable_payments p on p.movement_id = m.id
   where p.id = current_setting('test.cn')::uuid), 0,
  'la nota de crédito no está en el libro'
);

-- Resumen
select results_eq(
  $$ select (s ->> 'open')::int, (s ->> 'total')::numeric, (s ->> 'overdue_count')::int, (s ->> 'overdue_total')::numeric,
            (s ->> 'due_7_total')::numeric, (s -> 'aging' ->> 'd1_30')::numeric
     from public.payables_summary() s $$,
  $$ values (2, 216::numeric, 1, 116::numeric, 0::numeric, 116::numeric) $$,
  'resumen: lo abierto, lo vencido y la antigüedad'
);
select results_eq(
  $$ select s -> 'suppliers' -> 0 ->> 'name', (s -> 'suppliers' -> 0 ->> 'total')::numeric from public.payables_summary() s $$,
  $$ values ('Proveedor X'::text, 216::numeric) $$,
  'deuda por proveedor'
);

-- Termina de pagar
select lives_ok(
  format($$ select public.pay_payable(%L, 'aaaaaaaa-6666-6666-6666-666666666661', 100, current_date) $$, current_setting('test.p2')),
  'paga el resto'
);
select results_eq(
  format($$ select paid, status from public.payables where id = %L $$, current_setting('test.p2')),
  $$ values (300::numeric, 'paid'::text) $$,
  'pagada'
);
select throws_ok(
  format($$ select public.credit_payable(%L, 1, current_date) $$, current_setting('test.p2')),
  '23514', 'La cuenta por pagar no está abierta', 'una pagada no recibe más'
);

-- ---------------------------------------------------------------------------
-- Anulaciones
-- ---------------------------------------------------------------------------

select lives_ok(
  format($$ select public.void_payable_payment(%L, 'Transferencia rechazada') $$, current_setting('test.pay1')),
  'anula un pago'
);
select results_eq(
  format($$ select p.paid, p.status, (select m.voided_at is not null from public.finance_movements m
            join public.payable_payments x on x.movement_id = m.id where x.id = %L)
            from public.payables p where p.id = %L $$, current_setting('test.pay1'), current_setting('test.p2')),
  $$ values (170::numeric, 'open'::text, true) $$,
  'anular el pago anula su salida y la factura vuelve a quedar abierta'
);
-- Anular desde el libro también lo deshace.
select lives_ok(
  format($$ select public.void_finance_movement(m.id, 'Duplicado') from public.payable_payments p
            join public.finance_movements m on m.id = p.movement_id
            where p.payable_id = %L and p.voided_at is null and m.currency = 'VES' $$, current_setting('test.p2')),
  'anula una salida desde Movimientos'
);
select results_eq(
  format($$ select paid from public.payables where id = %L $$, current_setting('test.p2')),
  $$ values (120::numeric) $$,
  'y la factura lo refleja'
);
select throws_ok(
  format($$ select public.cancel_payable(%L, 'Error') $$, current_setting('test.p2')),
  '23514', 'Anula primero sus pagos', 'no se anula una factura con pagos vigentes'
);
select lives_ok(format($$ select public.cancel_payable(%L, 'Cargada por error') $$, current_setting('test.p1')), 'anula una factura sin pagos');
select lives_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'document', 'F-100', 'amount', 116)) $$,
  'una factura anulada se puede volver a cargar'
);

-- ---------------------------------------------------------------------------
-- Resultado: la mercancía no es gasto; un servicio sí
-- ---------------------------------------------------------------------------

select set_config('test.p3', public.create_payable(jsonb_build_object(
  'supplier_id', 'aaaaaaaa-7777-7777-7777-777777777772', 'document', 'S-1', 'amount', 40, 'category', 'Servicios'))::text, true);
select lives_ok(
  format($$ select public.pay_payable(%L, 'aaaaaaaa-6666-6666-6666-666666666661', 40, current_date) $$, current_setting('test.p3')),
  'paga una factura de servicios'
);
select results_eq(
  $$ select e ->> 'category', (e ->> 'amount')::numeric
     -- El pago va con current_date (UTC) y el reporte agrupa en hora de Caracas: el rango cubre ambos.
     from jsonb_array_elements(public.report_income(current_date - 1, current_date) -> 'expenses') e $$,
  $$ values ('Servicios'::text, 40::numeric) $$,
  'en el resultado cuenta el servicio, no la mercancía'
);

-- Comprobantes
select throws_ok(
  format($$ select public.attach_payable_proofs(%L, array['otra/ruta.pdf']) $$, current_setting('test.p3')),
  '23514', null, 'la ruta del archivo debe ser de la factura'
);
select lives_ok(
  format($$ select public.attach_payable_proofs(%L, array['aaaaaaaa-1111-1111-1111-111111111111/' || %L || '/factura.pdf']) $$,
         current_setting('test.p3'), current_setting('test.p3')),
  'adjunta la factura'
);

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

-- Encargado: opera pero no anula.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777772', 'amount', 10)) $$,
  'el encargado carga facturas'
);
select throws_ok(
  format($$ select public.cancel_payable(%L, 'x') $$, current_setting('test.p3')),
  '42501', null, 'pero no anula'
);

-- Cajero: nada.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.payables), 0, 'el cajero no ve cuentas por pagar');
select is((select count(*)::int from public.suppliers), 0, 'ni proveedores');
select throws_ok($$ select public.payables_summary() $$, '42501', null, 'ni el resumen');
select throws_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777772', 'amount', 10)) $$,
  '42501', null, 'ni carga facturas'
);

-- Otro negocio: no ve ni usa los proveedores de A.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is((select count(*)::int from public.payables), 0, 'B no ve las facturas de A');
select is((select count(*)::int from public.suppliers), 0, 'ni sus proveedores');
select throws_ok(
  $$ select public.create_payable(jsonb_build_object('supplier_id', 'aaaaaaaa-7777-7777-7777-777777777771', 'amount', 10)) $$,
  '23514', 'Elige el proveedor', 'ni le carga facturas a un proveedor de A'
);
select throws_ok(
  format($$ select public.pay_payable(%L, 'aaaaaaaa-6666-6666-6666-666666666661', 1, current_date) $$, current_setting('test.p3')),
  'P0002', null, 'ni paga facturas de A'
);

reset role;
select * from finish();
rollback;
