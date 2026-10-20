-- Conciliación bancaria: perfiles, cargas, duplicados y vínculos con el libro.

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

insert into public.finance_accounts (id, name, kind, currency, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', current_date - 30);

select set_config('test.m1', public.finance_movement('aaaaaaaa-6666-6666-6666-666666666661', 'in', 1500, current_date - 2, 'Ventas', null, '000123')::text, true);
select set_config('test.m2', public.finance_movement('aaaaaaaa-6666-6666-6666-666666666661', 'out', 200, current_date - 1, 'Comisiones bancarias')::text, true);

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.bank_import_profiles (id, account_id, name, col_date, col_reference, col_description, col_debit, col_credit)
     values ('aaaaaaaa-9999-9999-9999-999999999991', 'aaaaaaaa-6666-6666-6666-666666666661', 'Exportación web', 'A', 'B', 'C', 'D', 'E') $$,
  'el dueño crea un perfil de importación'
);
select throws_ok(
  $$ insert into public.bank_import_profiles (account_id, name, col_date)
     values ('aaaaaaaa-6666-6666-6666-666666666661', 'Sin monto', 'A') $$,
  '23514', null,
  'un perfil necesita monto o débito/crédito'
);

-- ---------------------------------------------------------------------------
-- Carga
-- ---------------------------------------------------------------------------

select set_config('test.rows', jsonb_build_array(
  jsonb_build_object('row', 2, 'date', current_date - 2, 'direction', 'in', 'amount', 1500, 'reference', '123', 'description', 'Pago móvil'),
  jsonb_build_object('row', 3, 'date', current_date - 1, 'direction', 'out', 'amount', 200, 'description', 'Comisión'),
  jsonb_build_object('row', 4, 'date', current_date, 'direction', 'in', 'amount', 999, 'reference', 'Z1', 'description', 'Depósito'),
  jsonb_build_object('row', 5, 'date', current_date, 'direction', 'in', 'amount', 50, 'reference', 'A', 'description', 'Transferencia'),
  jsonb_build_object('row', 6, 'date', current_date, 'direction', 'in', 'amount', 50, 'reference', 'A', 'description', 'Transferencia')
)::text, true);

select set_config('test.r1', public.import_bank_statement(
  'aaaaaaaa-6666-6666-6666-666666666661', 'aaaaaaaa-9999-9999-9999-999999999991', 'octubre.csv', 'h1',
  current_setting('test.rows')::jsonb, '[{"row": 7, "reason": "Fecha ilegible"}]'::jsonb)::text, true);
select results_eq(
  $$ select (r ->> 'inserted')::int, (r ->> 'duplicates')::int, (r ->> 'errors')::int,
            (r ->> 'auto_matched')::int, (r ->> 'possible')::int, (r ->> 'unmatched')::int
     from (select current_setting('test.r1')::jsonb r) x $$,
  $$ values (5, 0, 1, 1, 1, 3) $$,
  'carga: 5 nuevas, 1 conciliada por referencia, 1 posible y 3 sin identificar'
);
select is(
  (select movement_id from public.bank_statement_lines where row_number = 2), current_setting('test.m1')::uuid,
  'la referencia se compara sin ceros a la izquierda (000123 = 123)'
);
select is(
  (select count(*)::int from public.bank_statement_lines where amount = 50), 2,
  'dos líneas idénticas en el mismo archivo se respetan'
);

select set_config('test.r2', public.import_bank_statement(
  'aaaaaaaa-6666-6666-6666-666666666661', 'aaaaaaaa-9999-9999-9999-999999999991', 'octubre.csv', 'h1',
  current_setting('test.rows')::jsonb)::text, true);
select results_eq(
  $$ select (r ->> 'inserted')::int, (r ->> 'duplicates')::int from (select current_setting('test.r2')::jsonb r) x $$,
  $$ values (0, 5) $$,
  'cargar el mismo archivo otra vez no duplica'
);
select is(
  (select jsonb_array_length(issues) from public.bank_import_batches where id = (current_setting('test.r2')::jsonb ->> 'batch_id')::uuid), 5,
  'la carga deja registradas las filas repetidas'
);
select throws_ok(
  $$ select public.import_bank_statement('aaaaaaaa-6666-6666-6666-666666666661', null, 'x.csv', null,
       '[{"row": 2, "date": null, "direction": "in", "amount": 1}]'::jsonb) $$,
  '23514', 'Hay líneas sin fecha, dirección o monto válido',
  'rechaza líneas incompletas'
);

-- ---------------------------------------------------------------------------
-- Vincular, crear, ignorar y reabrir
-- ---------------------------------------------------------------------------

select lives_ok(
  format($$ select public.match_bank_line((select id from public.bank_statement_lines where row_number = 3), %L) $$, current_setting('test.m2')),
  'vincula a mano la comisión con su movimiento'
);
select throws_ok(
  format($$ select public.match_bank_line((select id from public.bank_statement_lines where row_number = 4), %L) $$, current_setting('test.m1')),
  '23514', null,
  'no vincula con otro monto'
);
select set_config('test.created', public.create_movement_from_bank_line(
  (select id from public.bank_statement_lines where row_number = 4), 'Otros ingresos', 'Cliente', null)::text, true);
select results_eq(
  format($$ select amount, reference, note, category from public.finance_movements where id = %L $$, current_setting('test.created')),
  $$ values (999::numeric, 'Z1', 'Depósito', 'Otros ingresos') $$,
  'crea en el libro lo que mostró el banco'
);
select is(
  (select match_kind from public.bank_statement_lines where row_number = 4), 'created',
  'y la deja conciliada'
);
select throws_ok(
  $$ select public.ignore_bank_line((select id from public.bank_statement_lines where row_number = 5 and occurrence = 1), ' ') $$,
  '23514', 'Indica por qué se ignora',
  'ignorar pide motivo'
);
select lives_ok(
  $$ select public.ignore_bank_line((select id from public.bank_statement_lines where row_number = 5 and occurrence = 1), 'Duplicado del banco') $$,
  'ignora una línea'
);
select is(
  public.reopen_bank_line((select id from public.bank_statement_lines where row_number = 5 and occurrence = 1)), 'unmatched',
  'reabre la ignorada'
);
select is(
  public.reopen_bank_line((select id from public.bank_statement_lines where row_number = 2)), 'possible',
  'desvincular no vuelve a conciliarla sola con el mismo movimiento'
);

select public.void_finance_movement(current_setting('test.created')::uuid, 'Era de otra cuenta');
select results_eq(
  $$ select status, movement_id from public.bank_statement_lines where row_number = 4 $$,
  $$ values ('unmatched'::text, null::uuid) $$,
  'anular el movimiento libera la línea'
);

select results_eq(
  $$ select (p ->> 'unmatched')::int, (p ->> 'possible')::int from (select public.bank_pending() p) x $$,
  $$ values (3, 1) $$,
  'pendientes del banco para el resumen'
);

select set_config('test.r3', public.bank_autoreconcile('aaaaaaaa-6666-6666-6666-666666666661')::text, true);
select is((current_setting('test.r3')::jsonb ->> 'auto_matched')::int, 1, 'conciliar de nuevo vuelve a encontrar la referencia');

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_bank_statement('aaaaaaaa-6666-6666-6666-666666666661', null, 'x.csv', null, '[]'::jsonb) $$,
  '42501', null,
  'el cajero no carga estados de cuenta'
);
select is((select count(*)::int from public.bank_statement_lines), 0, 'ni ve las líneas del banco');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
reset role;
select set_config('test.lineA', (select id::text from public.bank_statement_lines where row_number = 4 and tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111'), true);
set local role authenticated;
select throws_ok(
  format($$ select public.ignore_bank_line(%L, 'x') $$, current_setting('test.lineA')),
  'P0002', null,
  'otro negocio no toca las líneas de A'
);

select * from finish();
rollback;
