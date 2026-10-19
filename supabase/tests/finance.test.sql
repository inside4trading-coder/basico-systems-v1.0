-- Administración: cuentas, libro de movimientos, obligaciones y enlace con el POS.

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
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja 1', 'C1');
insert into public.products (id, tenant_id, name, tax_rate_id) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro',
     (select id from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Exento'));
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'FA', 10);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222222', 10);
-- Tasa del día fija (la tabla es global: puede haber otras filas de hoy).
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;

-- ---------------------------------------------------------------------------
-- Dueño de A: cuentas
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.finance_accounts (id, name, kind, currency, opening_balance, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banesco', 'bank', 'VES', 5000, current_date - 30),
  ('aaaaaaaa-6666-6666-6666-666666666662', 'Caja dólares', 'cash', 'USD', 100, current_date - 30),
  ('aaaaaaaa-6666-6666-6666-666666666663', 'Zelle', 'wallet', 'USD', 0, current_date - 30);
select is((select count(*)::int from public.finance_accounts), 3, 'el dueño crea cuentas del negocio activo');

select throws_ok(
  $$ update public.finance_accounts set currency = 'EUR' where name = 'Zelle' $$,
  '42501', null,
  'la moneda de una cuenta no cambia'
);

-- Movimientos a mano
select ok(public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'out', 30, current_date, 'Servicios', 'Corpoelec', null, 'Luz') is not null, 'registra una salida');
select ok(public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'in', 5.5, current_date) is not null, 'registra una entrada');
select throws_ok($$ select public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'out', 0, current_date) $$, '23514', null, 'monto cero no');
select throws_ok($$ select public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'out', 5, current_date + 10) $$, '23514', null, 'fecha futura no');

-- Transferencias
select ok(public.finance_transfer('aaaaaaaa-6666-6666-6666-666666666663', 'aaaaaaaa-6666-6666-6666-666666666662', 20, null, current_date, 'Retiro') is not null, 'transfiere entre cuentas de la misma moneda');
select throws_ok(
  $$ select public.finance_transfer('aaaaaaaa-6666-6666-6666-666666666663', 'aaaaaaaa-6666-6666-6666-666666666662', 20, 25, current_date) $$,
  '23514', 'Entre cuentas de la misma moneda entra lo mismo que sale',
  'misma moneda: sale y entra lo mismo'
);
select set_config('test.exchange',
  public.finance_transfer('aaaaaaaa-6666-6666-6666-666666666662', 'aaaaaaaa-6666-6666-6666-666666666661', 10, 1000, current_date, 'Cambio')::text, true);

select results_eq(
  $$ select e ->> 'name', (e ->> 'balance')::numeric from jsonb_array_elements(public.finance_summary() -> 'accounts') e order by 1 $$,
  $$ values ('Banesco'::text, 6000::numeric), ('Caja dólares'::text, 85.5::numeric), ('Zelle'::text, -20::numeric) $$,
  'saldo = inicial + entradas − salidas (100 − 30 + 5,5 + 20 − 10)'
);

-- Anular
select throws_ok($$ select public.void_finance_movement((select id from public.finance_movements where note = 'Luz'), '') $$, '23514', null, 'anular pide motivo');
select lives_ok(
  format($$ select public.void_finance_movement((select id from public.finance_movements where transfer_id = %L and direction = 'out'), 'Error de carga') $$, current_setting('test.exchange')),
  'anula un cambio de moneda'
);
select is(
  (select count(*)::int from public.finance_movements where transfer_id = current_setting('test.exchange')::uuid and voided_at is not null), 2,
  'anular una transferencia anula sus dos lados'
);
select results_eq(
  $$ select (e ->> 'balance')::numeric from jsonb_array_elements(public.finance_summary() -> 'accounts') e where e ->> 'name' = 'Banesco' $$,
  $$ values (5000::numeric) $$,
  'lo anulado no cuenta en el saldo'
);

-- ---------------------------------------------------------------------------
-- Enlace con el POS
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.payment_methods set account_id = 'aaaaaaaa-6666-6666-6666-666666666661' where code = 'cash_base' $$,
  '23514', null,
  'un método en dólares no entra a una cuenta en bolívares'
);
update public.payment_methods set account_id = 'aaaaaaaa-6666-6666-6666-666666666661' where code = 'mobile_payment';
update public.payment_methods set account_id = 'aaaaaaaa-6666-6666-6666-666666666662' where code = 'cash_base';

-- El cajero vende: pago móvil y efectivo.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.session', public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333333', '[{"currency":"USD","amount":20}]') ->> 'session_id', true);
select public.register_sale('fin-0001-aaaa', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', (select id from public.payment_methods where code = 'mobile_payment'), 'amount', 1000, 'bank', 'Banesco', 'reference', '7788')));
select public.register_sale('fin-0002-aaaa', current_setting('test.session')::uuid,
  '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":2}]',
  jsonb_build_array(jsonb_build_object('payment_method_id', (select id from public.payment_methods where code = 'cash_base'), 'amount', 20)));

-- El cajero no ve la administración.
select is((select count(*)::int from public.finance_accounts), 0, 'el cajero no ve las cuentas');
select is((select count(*)::int from public.finance_movements), 0, 'el cajero no ve el libro');
select throws_ok($$ select public.finance_summary() $$, '42501', null, 'el cajero no ve saldos');
select throws_ok($$ select public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'out', 5, current_date) $$, '42501', null, 'el cajero no registra movimientos');

-- Cierre: contó 40 con 20 de fondo → entran 20 a la caja en dólares.
select public.close_cash_session(current_setting('test.session')::uuid, '[{"currency":"USD","amount":40},{"currency":"VES","amount":0}]');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$ select kind, direction, amount, currency from public.finance_movements where kind in ('sale', 'cash_close') order by kind $$,
  $$ values ('cash_close'::text, 'in'::text, 20::numeric, 'USD'::text), ('sale'::text, 'in'::text, 1000::numeric, 'VES'::text) $$,
  'el pago móvil entra al banco al vender; el efectivo, al cerrar la caja (contado − fondo)'
);
select throws_ok(
  $$ select public.void_finance_movement((select id from public.finance_movements where kind = 'manual' and voided_at is null limit 1), 'x') $$,
  '42501', null,
  'el encargado no anula movimientos'
);

-- ---------------------------------------------------------------------------
-- Obligaciones
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select d from app.obligation_due_dates('monthly', '2026-01-31', null, '2026-01-01', '2026-04-30') d $$,
  $$ values ('2026-01-31'::date), ('2026-02-28'::date), ('2026-03-31'::date), ('2026-04-30'::date) $$,
  'mensual el 31: fin de mes cuando no hay 31, y vuelve al 31'
);
select results_eq(
  $$ select d from app.obligation_due_dates('biweekly', '2026-01-01', '2026-01-31', '2026-01-01', '2026-12-31') d $$,
  $$ values ('2026-01-01'::date), ('2026-01-15'::date), ('2026-01-29'::date) $$,
  'quincenal hasta la fecha de fin'
);
select is((select count(*)::int from app.obligation_due_dates('once', '2026-03-10', null, '2026-01-01', '2026-12-31')), 1, 'una sola vez');

insert into public.obligations (id, name, category, counterparty, amount, currency, frequency, start_date, account_id) values
  ('aaaaaaaa-7777-7777-7777-777777777771', 'Alquiler local', 'Alquiler', 'Inmobiliaria', 300, 'USD', 'monthly', current_date - 40, 'aaaaaaaa-6666-6666-6666-666666666662');
select ok(public.refresh_obligations() >= 5, 'genera las cuotas hasta 120 días adelante');
select is(public.refresh_obligations(), 0, 'volver a generar no duplica');

select set_config('test.overdue', (select id::text from public.obligation_instances where due_date = current_date - 40), true);
select is((public.finance_summary() -> 'overdue' ->> 'count')::int, 2, 'cuotas vencidas sin pagar');

select ok(public.pay_obligation(current_setting('test.overdue')::uuid, 'aaaaaaaa-6666-6666-6666-666666666662', 300, current_date, 'T-1') is not null, 'paga una cuota');
select results_eq(
  format($$ select status, movement_id is not null from public.obligation_instances where id = %L $$, current_setting('test.overdue')),
  $$ values ('paid'::text, true) $$,
  'la cuota queda pagada con su salida en el libro'
);
select throws_ok(
  format($$ select public.pay_obligation(%L, 'aaaaaaaa-6666-6666-6666-666666666662', 300, current_date) $$, current_setting('test.overdue')),
  '23514', null,
  'no se paga dos veces'
);
select throws_ok(
  $$ select public.skip_obligation((select id from public.obligation_instances where status = 'pending' order by due_date limit 1), ' ') $$,
  '23514', null,
  'omitir una cuota pide motivo'
);

-- Subir el alquiler actualiza las cuotas futuras pendientes, no las pagadas.
update public.obligations set amount = 350 where id = 'aaaaaaaa-7777-7777-7777-777777777771';
select public.refresh_obligations();
select results_eq(
  $$ select min(amount), max(amount) from public.obligation_instances where status = 'pending' and due_date >= current_date $$,
  $$ values (350::numeric, 350::numeric) $$,
  'las cuotas futuras toman el monto nuevo'
);
select is((select amount from public.obligation_instances where id = current_setting('test.overdue')::uuid), 300::numeric, 'la pagada conserva su monto');

-- Desactivar quita las cuotas futuras pendientes.
update public.obligations set is_active = false where id = 'aaaaaaaa-7777-7777-7777-777777777771';
select public.refresh_obligations();
select is((select count(*)::int from public.obligation_instances where status = 'pending' and due_date >= current_date), 0, 'sin cuotas futuras al desactivarla');

-- El dueño anula el pago: la cuota vuelve a pendiente.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.void_finance_movement((select movement_id from public.obligation_instances where id = current_setting('test.overdue')::uuid), 'Pago duplicado en el banco');
select is((select status from public.obligation_instances where id = current_setting('test.overdue')::uuid), 'pending', 'anular el pago reabre la cuota');

-- ---------------------------------------------------------------------------
-- Aislamiento
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is((select count(*)::int from public.finance_accounts), 0, 'B no ve las cuentas de A');
select is((select count(*)::int from public.finance_movements), 0, 'B no ve el libro de A');
select is((select count(*)::int from public.obligations), 0, 'B no ve las obligaciones de A');
select is(jsonb_array_length(public.finance_summary() -> 'accounts'), 0, 'el resumen de B está vacío');
select throws_ok(
  $$ select public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'in', 5, current_date) $$,
  'P0002', 'Cuenta no encontrada',
  'B no registra en una cuenta de A'
);
select throws_ok(
  $$ insert into public.obligations (tenant_id, name, currency, frequency, start_date) values ('aaaaaaaa-1111-1111-1111-111111111111', 'x', 'USD', 'once', current_date) $$,
  '42501', null,
  'B no crea obligaciones en A'
);

select * from finish();
rollback;
