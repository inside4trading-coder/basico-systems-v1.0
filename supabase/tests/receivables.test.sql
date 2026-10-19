-- Cuentas por cobrar: crédito, financiadoras, cuotas en cascada, coberturas,
-- comisiones, cuenta corriente, ventas del POS y carga del archivo.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'encargado-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'manager');
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
-- Crédito a un cliente
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_receivable('{"amount": 100}'::jsonb) $$,
  '23514', 'Indica el cliente',
  'el crédito pide cliente'
);
select throws_ok(
  $$ select public.create_receivable(jsonb_build_object('customer_name', 'Taller', 'amount', 100,
       'installments', jsonb_build_array(jsonb_build_object('due_date', current_date, 'amount', 60)))) $$,
  '23514', null,
  'las cuotas deben sumar el monto'
);
select set_config('test.cr', public.create_receivable(jsonb_build_object(
  'customer_name', 'Taller El Rápido', 'document', 'NE-10', 'issued_on', current_date - 40, 'amount', 300,
  'installments', jsonb_build_array(
    jsonb_build_object('due_date', current_date - 10, 'amount', 100),
    jsonb_build_object('due_date', current_date + 20, 'amount', 100),
    jsonb_build_object('due_date', current_date + 50, 'amount', 100))))::text, true);
select results_eq(
  format($$ select kind, currency, status from public.receivables where id = %L $$, current_setting('test.cr')),
  $$ values ('credit'::text, 'USD'::text, 'open'::text) $$,
  'crea un crédito en la moneda base'
);

select set_config('test.c1', public.collect_receivable(current_setting('test.cr')::uuid,
  'aaaaaaaa-6666-6666-6666-666666666661', 130, current_date, 'customer', null, 'R-1')::text, true);
select results_eq(
  format($$ select number, collected from public.receivable_installments where receivable_id = %L order by number $$, current_setting('test.cr')),
  $$ values (1, 100::numeric), (2, 30::numeric), (3, 0::numeric) $$,
  'el cobro se reparte en cascada desde la cuota más vieja'
);
select is(
  (select m.kind from public.finance_movements m join public.receivable_collections c on c.movement_id = m.id where c.id = current_setting('test.c1')::uuid),
  'receivable', 'y entra al libro'
);
select throws_ok(
  format($$ select public.collect_receivable(%L, 'aaaaaaaa-6666-6666-6666-666666666662', 5000, current_date) $$, current_setting('test.cr')),
  '23514', 'Indica cuánto cubre el cobro en USD',
  'cobrar en otra moneda pide cuánto cubre'
);
select lives_ok(
  format($$ select public.collect_receivable(%L, 'aaaaaaaa-6666-6666-6666-666666666662', 5000, current_date, 'customer', 50) $$, current_setting('test.cr')),
  'cobra en bolívares indicando lo que cubre en dólares'
);
select throws_ok(
  format($$ select public.collect_receivable(%L, 'aaaaaaaa-6666-6666-6666-666666666661', 200, current_date) $$, current_setting('test.cr')),
  '23514', null,
  'no se cobra más de lo que falta'
);

select public.void_finance_movement((select movement_id from public.receivable_collections where id = current_setting('test.c1')::uuid), 'Duplicado');
select results_eq(
  format($$ select collected, status from public.receivables where id = %L $$, current_setting('test.cr')),
  $$ values (50::numeric, 'open'::text) $$,
  'anular el movimiento en el libro deshace el cobro'
);
select lives_ok(
  format($$ select public.collect_receivable(%L, 'aaaaaaaa-6666-6666-6666-666666666661', 250, current_date) $$, current_setting('test.cr')),
  'cobra el resto'
);
select is((select status from public.receivables where id = current_setting('test.cr')::uuid), 'paid', 'y queda pagada');

-- ---------------------------------------------------------------------------
-- Financiadora: cobertura, comisión y cuenta corriente
-- ---------------------------------------------------------------------------

select set_config('test.fin', public.create_receivable(jsonb_build_object(
  'provider', 'Cashea', 'external_ref', '9001', 'customer_name', 'Ana', 'amount', 90, 'sale_total', 150, 'initial_amount', 60,
  'installments', jsonb_build_array(
    jsonb_build_object('due_date', current_date - 5, 'amount', 30),
    jsonb_build_object('due_date', current_date + 9, 'amount', 30),
    jsonb_build_object('due_date', current_date + 23, 'amount', 30))))::text, true);
select throws_ok(
  $$ select public.create_receivable(jsonb_build_object('provider', 'Cashea', 'external_ref', '9001', 'amount', 1)) $$,
  '23505', null,
  'no repite un n.º de orden de la misma financiadora'
);
select lives_ok(
  format($$ select public.cover_installment((select id from public.receivable_installments where receivable_id = %L and number = 1), 30, current_date, 'COB-1') $$,
         current_setting('test.fin')),
  'la financiadora cubre la cuota vencida'
);
select results_eq(
  format($$ select number, covered, collected from public.receivable_installments where receivable_id = %L order by number $$, current_setting('test.fin')),
  $$ values (1, 30::numeric, 0::numeric), (2, 0::numeric, 0::numeric), (3, 0::numeric, 0::numeric) $$,
  'la cobertura queda en su cuota'
);
select lives_ok(
  format($$ select public.register_receivable_commission(%L, 5, current_date) $$, current_setting('test.fin')),
  'registra la comisión'
);
select is(
  (select collected from public.receivable_installments where receivable_id = current_setting('test.fin')::uuid and number = 2), 5::numeric,
  'la comisión baja la siguiente cuota sin mover dinero'
);
select lives_ok($$ select public.add_provider_entry('Cashea', 'service_invoice', 12, current_date, 'USD', 'F-77') $$, 'registra una factura de servicios');
select is(
  (select (p ->> 'balance')::numeric from jsonb_array_elements(public.receivables_summary() -> 'providers') p where p ->> 'provider' = 'Cashea'),
  18::numeric,
  'cuenta corriente: cobertura 30 menos factura 12'
);
select lives_ok(
  $$ select public.settle_provider('Cashea', 'aaaaaaaa-6666-6666-6666-666666666661', 'in', 18, current_date, 'TRF-1') $$,
  'la financiadora liquida su saldo'
);
select is(
  (select (p ->> 'balance')::numeric from jsonb_array_elements(public.receivables_summary() -> 'providers') p where p ->> 'provider' = 'Cashea'),
  0::numeric,
  'y la cuenta corriente queda en cero'
);
select public.void_finance_movement((select movement_id from public.provider_ledger where kind = 'settlement'), 'Era otra transferencia');
select is(
  (select (p ->> 'balance')::numeric from jsonb_array_elements(public.receivables_summary() -> 'providers') p where p ->> 'provider' = 'Cashea'),
  18::numeric,
  'anular la liquidación en el libro la saca de la cuenta corriente'
);
select lives_ok(
  $$ select public.settle_provider('Cashea', 'aaaaaaaa-6666-6666-6666-666666666661', 'in', 18, current_date, 'TRF-2') $$,
  'se liquida de nuevo'
);
select lives_ok(
  format($$ select public.void_receivable_collection((select id from public.receivable_collections where receivable_id = %L and kind = 'provider_credit'), 'Error') $$,
         current_setting('test.fin')),
  'anula la cobertura'
);
select is(
  (select (p ->> 'balance')::numeric from jsonb_array_elements(public.receivables_summary() -> 'providers') p where p ->> 'provider' = 'Cashea'),
  -30::numeric,
  'y sale de la cuenta corriente'
);

select results_eq(
  $$ select (s ->> 'open')::int, (s ->> 'overdue_count')::int, (s ->> 'total')::numeric from (select public.receivables_summary() s) x $$,
  $$ values (1, 1, 85::numeric) $$,
  'resumen: una abierta, una cuota vencida y 85 por cobrar'
);

-- ---------------------------------------------------------------------------
-- Venta del POS con financiadora y carga del archivo
-- ---------------------------------------------------------------------------

reset role;
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja 1', 'C1');
insert into public.cash_sessions (id, tenant_id, register_id, location_id, number) values
  ('aaaaaaaa-4444-4444-4444-444444444444', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-3333-3333-3333-333333333333',
   'aaaaaaaa-2222-2222-2222-222222222222', 'C1-00001');
insert into public.sales (id, tenant_id, number, location_id, register_id, session_id, base_currency, prices_include_tax, subtotal, discount_total, tax_total,
                          total, paid_total, units, idempotency_key, customer_name)
values ('aaaaaaaa-8888-8888-8888-888888888881', 'aaaaaaaa-1111-1111-1111-111111111111', 'V-0001', 'aaaaaaaa-2222-2222-2222-222222222222',
        'aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-4444-4444-4444-444444444444', 'USD', false, 200, 0, 0, 200, 200, 1, 'rcv-test-1', 'Luis');
insert into public.sale_payments (tenant_id, sale_id, payment_method_id, method_code, method_name, currency, amount, amount_base, reference)
select 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-8888-8888-8888-888888888881', pm.id, pm.code, pm.name, 'USD', 80, 80, null
from public.payment_methods pm where pm.tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and pm.code = 'cash_base';
insert into public.sale_payments (tenant_id, sale_id, payment_method_id, method_code, method_name, currency, amount, amount_base, reference)
select 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-8888-8888-8888-888888888881', pm.id, pm.code, pm.name, 'USD', 120, 120, null
from public.payment_methods pm where pm.tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and pm.kind = 'bnpl';
set local role authenticated;

select results_eq(
  $$ select kind, provider, document, amount, initial_amount, external_ref from public.receivables where sale_id = 'aaaaaaaa-8888-8888-8888-888888888881' $$,
  $$ values ('financing'::text, 'Cashea'::text, 'V-0001'::text, 120::numeric, 80::numeric, null::text) $$,
  'una venta cobrada con la financiadora crea su cuenta por cobrar'
);

select set_config('test.imp', public.import_financing('Cashea', 'cashea-octubre.xlsx', 'h1', jsonb_build_array(
  jsonb_build_object('external_ref', '7777', 'document', 'V-0001', 'customer_name', 'Luis', 'issued_on', current_date,
    'sale_total', 200, 'initial_amount', 80, 'installments', jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date + 14, 'amount', 40, 'status', 'done'),
      jsonb_build_object('number', 2, 'due_date', current_date + 28, 'amount', 40, 'status', 'pending'),
      jsonb_build_object('number', 3, 'due_date', current_date + 42, 'amount', 40, 'status', 'pending'))),
  jsonb_build_object('external_ref', '8888', 'customer_name', 'Marta', 'sale_total', 100, 'initial_amount', 40,
    'installments', jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date + 14, 'amount', 30),
      jsonb_build_object('number', 2, 'due_date', current_date + 28, 'amount', 30))),
  jsonb_build_object('customer_name', 'Sin datos')
))::text, true);
select results_eq(
  $$ select (r ->> 'rows')::int, (r ->> 'created')::int, (r ->> 'updated')::int, (r ->> 'linked')::int, jsonb_array_length(r -> 'issues')
     from (select current_setting('test.imp')::jsonb r) x $$,
  $$ values (3, 1, 1, 1, 1) $$,
  'carga: vincula la venta del POS por número, crea la que falta y avisa la fila sin datos'
);
select results_eq(
  $$ select external_ref, (select count(*)::int from public.receivable_installments i where i.receivable_id = r.id),
            (select provider_status from public.receivable_installments i where i.receivable_id = r.id and number = 1)
     from public.receivables r where sale_id = 'aaaaaaaa-8888-8888-8888-888888888881' $$,
  $$ values ('7777'::text, 3, 'DONE'::text) $$,
  'la venta toma el n.º de orden, las cuotas y el estado de la financiadora'
);
select set_config('test.imp2', public.import_financing('Cashea', 'cashea-octubre.xlsx', 'h1', jsonb_build_array(
  jsonb_build_object('external_ref', '8888', 'installments', jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date + 14, 'amount', 30, 'status', 'DELAYED'),
      jsonb_build_object('number', 2, 'due_date', current_date + 28, 'amount', 30))))
)::text, true);
select results_eq(
  $$ select (r ->> 'created')::int, (r ->> 'updated')::int from (select current_setting('test.imp2')::jsonb r) x $$,
  $$ values (0, 1) $$,
  'volver a cargar actualiza, no duplica'
);

reset role;
update public.sales set status = 'voided', voided_at = now(), void_reason = 'Prueba' where id = 'aaaaaaaa-8888-8888-8888-888888888881';
set local role authenticated;
select is(
  (select status from public.receivables where sale_id = 'aaaaaaaa-8888-8888-8888-888888888881'), 'cancelled',
  'anular la venta cancela su cuenta por cobrar sin cobros'
);

select throws_ok(
  $$ update public.payment_methods set account_id = 'aaaaaaaa-6666-6666-6666-666666666661' where kind = 'bnpl' $$,
  '23514', null,
  'el método de una financiadora no se enlaza a una cuenta (contaría dos veces)'
);

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.void_receivable_collection((select id from public.receivable_collections where receivable_id = %L limit 1), 'x') $$, current_setting('test.cr')),
  '42501', null,
  'el encargado no anula cobros'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.receivables_summary() $$, '42501', null, 'el cajero no ve las cuentas por cobrar');
select is((select count(*)::int from public.receivables), 0, 'ni las lee');

select * from finish();
rollback;
