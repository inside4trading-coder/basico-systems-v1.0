-- Financiadora, paso 2: el archivo de pagos se cruza con el banco y cobra cada cuota una sola vez.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.finance_accounts (id, name, kind, currency, institution, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', 'Banco', current_date - 30);

select set_config('test.fin', public.create_receivable(jsonb_build_object(
  'provider', 'Cashea', 'external_ref', '9001', 'document', 'V-000100', 'customer_name', 'Ana', 'amount', 90, 'sale_total', 150, 'initial_amount', 60,
  'installments', jsonb_build_array(
    jsonb_build_object('due_date', current_date - 5, 'amount', 30),
    jsonb_build_object('due_date', current_date + 9, 'amount', 30),
    jsonb_build_object('due_date', current_date + 23, 'amount', 30))))::text, true);

select public.import_bank_statement('aaaaaaaa-6666-6666-6666-666666666661', null, 'oct.csv', 'h', jsonb_build_array(
  jsonb_build_object('row', 2, 'date', current_date - 1, 'direction', 'in', 'amount', 3000, 'reference', '0000927842011', 'description', 'PAGO MOVIL'),
  jsonb_build_object('row', 3, 'date', current_date, 'direction', 'in', 'amount', 3000, 'reference', '555111', 'description', 'TRANSF'),
  jsonb_build_object('row', 4, 'date', current_date, 'direction', 'in', 'amount', 2500, 'reference', '777888', 'description', 'OTRO')
));
create temp table line_ids on commit drop as select row_number, id from public.bank_statement_lines;
grant select on line_ids to authenticated;

create function pg_temp.rows() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('row', 2, 'date', current_date, 'amount_local', 3000, 'amount_base', 30, 'reference', '927842011', 'installment', '1', 'order', '9001', 'invoice', ''),
    jsonb_build_object('row', 3, 'date', current_date, 'amount_local', 3000, 'amount_base', 30, 'reference', '123999', 'installment', '2', 'order', '', 'invoice', 'V-000100'),
    jsonb_build_object('row', 4, 'date', current_date, 'amount_local', 4000, 'amount_base', 40, 'reference', '444', 'installment', '3', 'order', '9001', 'invoice', ''),
    jsonb_build_object('row', 5, 'date', current_date, 'amount_local', 6000, 'amount_base', 60, 'reference', '1', 'installment', '0', 'order', '9001', 'invoice', ''),
    jsonb_build_object('row', 6, 'date', current_date, 'amount_local', 3000, 'amount_base', 30, 'reference', '3333', 'installment', '1', 'order', '7777', 'invoice', ''))
$$;

select throws_ok(
  $$ select public.import_financing_payments('Cashea', 'aaaaaaaa-6666-6666-6666-666666666661', pg_temp.rows()) $$,
  '42501', null,
  'sin el módulo de financiadoras no se cargan pagos'
);
reset role;
insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'cashea', 'true');
set local role authenticated;

select results_eq(
  $$ select r ->> 'row', r ->> 'status' from jsonb_array_elements(
       public.import_financing_payments('Cashea', 'aaaaaaaa-6666-6666-6666-666666666661', pg_temp.rows()) -> 'rows') r $$,
  $$ values ('2', 'conciliado'), ('3', 'posible'), ('4', 'sin_banco'), ('5', 'pago_inicial'), ('6', 'sin_operacion') $$,
  'vista previa: referencia+monto concilia; solo monto es posible; sin línea, sin banco; cuota 0 es el inicial; orden desconocida, sin operación'
);
select is(
  (select count(*)::int from public.receivable_collections),
  0, 'la vista previa no registra nada'
);

select is(
  (public.import_financing_payments('Cashea', 'aaaaaaaa-6666-6666-6666-666666666661', pg_temp.rows(), false, 'pagos.xlsx', 'hash') ->> 'matched')::int,
  1, 'al confirmar se aplica el pago conciliado'
);
select results_eq(
  $$ select l.status, c.amount, r.collected from public.bank_statement_lines l
     join public.receivable_collections c on c.movement_id = l.movement_id
     join public.receivables r on r.id = c.receivable_id
     where l.row_number = 2 $$,
  $$ values ('matched'::text, 30.00::numeric, 30.00::numeric) $$,
  'la línea del banco queda conciliada y la cuota cobrada (30 USD)'
);
select is(
  (select status from public.bank_statement_lines where row_number = 3), 'unmatched',
  'el posible queda para revisar en Por identificar'
);

select results_eq(
  $$ select r ->> 'row', r ->> 'status' from jsonb_array_elements(
       public.import_financing_payments('Cashea', 'aaaaaaaa-6666-6666-6666-666666666661', pg_temp.rows(), false, 'pagos.xlsx', 'hash') -> 'rows') r
     where r ->> 'row' = '2' $$,
  $$ values ('2', 'duplicado') $$,
  'cargar el mismo archivo otra vez no cobra dos veces'
);
select is((select collected from public.receivables where id = current_setting('test.fin')::uuid), 30.00::numeric, 'lo cobrado no cambia');
select is((select count(*)::int from public.financing_payment_imports), 2, 'cada carga queda en el historial');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is_empty($$ select 1 from public.financing_payments $$, 'otro negocio no ve los pagos de A');
select throws_ok(
  $$ select public.import_financing_payments('Cashea', 'aaaaaaaa-6666-6666-6666-666666666661', '[]') $$,
  '42501', null,
  'ni carga pagos (sin el módulo)'
);

select * from finish();
rollback;
