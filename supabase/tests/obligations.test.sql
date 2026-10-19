-- Obligaciones completas: estados, pagos parciales, cuotas a mano, comprobantes y bitácora.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.finance_accounts (id, name, kind, currency, opening_balance) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', 100000),
  ('aaaaaaaa-6666-6666-6666-666666666662', 'Caja USD', 'cash', 'USD', 1000);

insert into public.obligations (id, name, category, counterparty, amount, currency, frequency, start_date, importance, responsible, payment_method, is_fixed_expense)
values ('aaaaaaaa-7777-7777-7777-777777777771', 'Alquiler', 'Alquiler', 'Inmobiliaria', 300, 'USD', 'monthly',
        current_date - 10, 'critical', 'Ana', 'Zelle', true);
select public.refresh_obligations();
select set_config('test.inst', (select id::text from public.obligation_instances where due_date = current_date - 10), true);

select results_eq(
  $$ select importance, responsible, payment_method, is_fixed_expense, status from public.obligations $$,
  $$ values ('critical'::text, 'Ana'::text, 'Zelle'::text, true, 'active'::text) $$,
  'la obligación guarda importancia, responsable, método habitual, gasto fijo y estado'
);

-- ---------------------------------------------------------------------------
-- Pagos parciales
-- ---------------------------------------------------------------------------

select public.pay_obligation(current_setting('test.inst')::uuid, 'aaaaaaaa-6666-6666-6666-666666666662', 100, current_date, 'P1');
select results_eq(
  format($$ select status, paid_amount from public.obligation_instances where id = %L $$, current_setting('test.inst')),
  $$ values ('partial'::text, 100::numeric) $$,
  'un pago menor al monto deja la cuota parcial'
);
select throws_ok(
  format($$ select public.pay_obligation(%L, 'aaaaaaaa-6666-6666-6666-666666666661', 10000, current_date) $$, current_setting('test.inst')),
  '23514', 'Indica cuánto cubre el pago en USD',
  'pagar desde otra moneda pide cuánto cubre'
);
select public.pay_obligation(current_setting('test.inst')::uuid, 'aaaaaaaa-6666-6666-6666-666666666661', 20000, current_date, 'P2', null, 100);
select results_eq(
  format($$ select status, paid_amount from public.obligation_instances where id = %L $$, current_setting('test.inst')),
  $$ values ('partial'::text, 200::numeric) $$,
  'el pago en bolívares aplica lo indicado en dólares'
);
select is(
  (select count(*)::int from public.finance_movements where obligation_instance_id = current_setting('test.inst')::uuid),
  2, 'cada pago es una salida en el libro'
);
select public.pay_obligation(current_setting('test.inst')::uuid, 'aaaaaaaa-6666-6666-6666-666666666662', 95, current_date, 'P3', 'Descuento por pronto pago', null, true);
select results_eq(
  format($$ select status, paid_amount, settled from public.obligation_instances where id = %L $$, current_setting('test.inst')),
  $$ values ('paid'::text, 295::numeric, true) $$,
  'dar por pagada aunque falten 5'
);

-- Anular el último pago: vuelve a parcial.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.void_finance_movement((select id from public.finance_movements where reference = 'P3'), 'Error');
select results_eq(
  format($$ select status, paid_amount, settled from public.obligation_instances where id = %L $$, current_setting('test.inst')),
  $$ values ('partial'::text, 200::numeric, false) $$,
  'anular un pago recalcula la cuota'
);

-- ---------------------------------------------------------------------------
-- Editar, agregar, omitir, anular y reabrir cuotas
-- ---------------------------------------------------------------------------

select set_config('test.next', (select id::text from public.obligation_instances where status = 'pending' order by due_date limit 1), true);
select lives_ok(
  format($$ select public.update_obligation_instance(%L, 350, (select due_date + 2 from public.obligation_instances where id = %L), 'Aumento') $$,
         current_setting('test.next'), current_setting('test.next')),
  'edita monto y fecha de una cuota abierta'
);
select results_eq(
  format($$ select amount, custom from public.obligation_instances where id = %L $$, current_setting('test.next')),
  $$ values (350::numeric, true) $$,
  'la cuota editada queda fija'
);
select public.refresh_obligations();
select is(
  (select amount from public.obligation_instances where id = current_setting('test.next')::uuid), 350::numeric,
  'generar de nuevo no pisa una cuota editada'
);

select set_config('test.extra', public.add_obligation_instance('aaaaaaaa-7777-7777-7777-777777777771', current_date + 3, 40, 'Mantenimiento')::text, true);
select is((select custom from public.obligation_instances where id = current_setting('test.extra')::uuid), true, 'agrega una cuota a mano');
select throws_ok(
  $$ select public.add_obligation_instance('aaaaaaaa-7777-7777-7777-777777777771', current_date + 3, 40) $$,
  '23505', 'Ya hay una cuota de esta obligación ese día',
  'no dos cuotas el mismo día'
);
select throws_ok(
  format($$ select public.void_obligation_instance(%L, 'x') $$, current_setting('test.inst')),
  '23514', null,
  'no se anula una cuota con pagos'
);
select lives_ok(format($$ select public.void_obligation_instance(%L, 'Cargada por error') $$, current_setting('test.extra')), 'anula una cuota sin pagos');
select is((select status from public.obligation_instances where id = current_setting('test.extra')::uuid), 'void', 'queda anulada');
select lives_ok(format($$ select public.reopen_obligation_instance(%L) $$, current_setting('test.extra')), 'reabre la cuota anulada');
select is((select status from public.obligation_instances where id = current_setting('test.extra')::uuid), 'pending', 'vuelve a pendiente');

-- ---------------------------------------------------------------------------
-- Pausar, cancelar y reactivar
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) from public.obligation_instances where status = 'pending' and not custom and due_date >= current_date) > 0,
  'hay cuotas futuras generadas'
);
update public.obligations set status = 'paused' where id = 'aaaaaaaa-7777-7777-7777-777777777771';
select public.refresh_obligations();
select is(
  (select count(*)::int from public.obligation_instances where status = 'pending' and not custom and due_date >= current_date), 0,
  'pausada: sin cuotas futuras generadas'
);
select is(
  (select count(*)::int from public.obligation_instances where custom and status = 'pending'), 2,
  'las cuotas editadas o agregadas a mano se conservan'
);
update public.obligations set status = 'active' where id = 'aaaaaaaa-7777-7777-7777-777777777771';
select ok(public.refresh_obligations() > 0, 'reactivada: vuelven las cuotas');
select public.refresh_obligations(current_date + 400);
select ok(
  (select max(due_date) from public.obligation_instances) > current_date + 300,
  'genera más adelante al pedir un mes lejano'
);
update public.obligations set status = 'cancelled' where id = 'aaaaaaaa-7777-7777-7777-777777777771';
select public.refresh_obligations();
select is(
  (select count(*)::int from public.obligation_instances
   where obligation_id = 'aaaaaaaa-7777-7777-7777-777777777771' and status = 'pending' and paid_amount = 0 and due_date > current_date), 0,
  'cancelada: se quitan las futuras sin pagos, también las editadas a mano'
);
update public.obligations set status = 'active' where id = 'aaaaaaaa-7777-7777-7777-777777777771';
select public.refresh_obligations();

-- ---------------------------------------------------------------------------
-- Comprobantes
-- ---------------------------------------------------------------------------

select lives_ok(
  format($$ select public.attach_obligation_proofs(%L, array[%L]) $$, current_setting('test.inst'),
         'aaaaaaaa-1111-1111-1111-111111111111/' || current_setting('test.inst') || '/recibo.pdf'),
  'registra un comprobante en la carpeta de la cuota'
);
select throws_ok(
  format($$ select public.attach_obligation_proofs(%L, array['bbbbbbbb-1111-1111-1111-111111111111/x/recibo.pdf']) $$, current_setting('test.inst')),
  '23514', 'Ruta de comprobante inválida',
  'no acepta rutas de otro negocio u otra cuota'
);
select is(
  (select cardinality(proof_paths) from public.obligation_instances where id = current_setting('test.inst')::uuid), 1,
  'el comprobante queda en la cuota'
);
select ok(app.finance_proof_allowed('aaaaaaaa-1111-1111-1111-111111111111/abc/x.pdf'), 'el dueño puede subir a la carpeta de su negocio');
select ok(not app.finance_proof_allowed('bbbbbbbb-1111-1111-1111-111111111111/abc/x.pdf'), 'no a la de otro negocio');
select ok(not app.finance_proof_allowed('../x.pdf'), 'ni a rutas raras');

-- ---------------------------------------------------------------------------
-- Bitácora
-- ---------------------------------------------------------------------------

select ok(
  (select array_agg(distinct action) from public.obligation_events) @>
    array['created', 'status_paused', 'status_active', 'instance_partial', 'instance_paid', 'instance_edited', 'instance_added', 'instance_void', 'instance_proof'],
  'la bitácora registra creación, estados, pagos, ediciones, anulaciones y comprobantes'
);
select ok(
  (select detail ? 'status' from public.obligation_events where action = 'status_paused' limit 1),
  'guarda qué cambió'
);
select is(
  (select actor from public.obligation_events where action = 'status_paused' limit 1),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'y quién'
);

-- ---------------------------------------------------------------------------
-- Permisos y aislamiento
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.obligation_events), 0, 'el cajero no ve la bitácora');
select throws_ok($$ select public.add_obligation_instance('aaaaaaaa-7777-7777-7777-777777777771', current_date + 20, 1) $$, '42501', null, 'el cajero no agrega cuotas');
select ok(not app.finance_proof_allowed('aaaaaaaa-1111-1111-1111-111111111111/abc/x.pdf'), 'el cajero no sube comprobantes');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is((select count(*)::int from public.obligation_events), 0, 'B no ve la bitácora de A');
select throws_ok(
  format($$ select public.update_obligation_instance(%L, 1, current_date) $$, current_setting('test.next')),
  'P0002', 'Cuota no encontrada',
  'B no edita cuotas de A'
);

select * from finish();
rollback;
