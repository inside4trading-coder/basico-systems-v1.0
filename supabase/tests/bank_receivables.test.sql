-- Cobranza contra el banco: cuotas de clientes y liquidaciones con la financiadora.

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

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.finance_accounts (id, name, kind, currency, institution, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', 'Banesco', current_date - 30);

select set_config('test.fin', public.create_receivable(jsonb_build_object(
  'provider', 'Cashea', 'external_ref', '9001', 'customer_name', 'Ana', 'amount', 90, 'sale_total', 150, 'initial_amount', 60,
  'installments', jsonb_build_array(
    jsonb_build_object('due_date', current_date - 5, 'amount', 30),
    jsonb_build_object('due_date', current_date + 9, 'amount', 30),
    jsonb_build_object('due_date', current_date + 23, 'amount', 30))))::text, true);
select set_config('test.cr', public.create_receivable(jsonb_build_object(
  'customer_name', 'Taller El Rápido', 'amount', 300,
  'installments', jsonb_build_array(
    jsonb_build_object('due_date', current_date + 10, 'amount', 100),
    jsonb_build_object('due_date', current_date + 40, 'amount', 200))))::text, true);

select public.import_bank_statement('aaaaaaaa-6666-6666-6666-666666666661', null, 'oct.csv', 'h', jsonb_build_array(
  jsonb_build_object('row', 2, 'date', current_date, 'direction', 'in', 'amount', 3000, 'reference', '701', 'description', 'PAGO MOVIL ANA'),
  jsonb_build_object('row', 3, 'date', current_date, 'direction', 'in', 'amount', 9000, 'reference', '702', 'description', 'TRANSF'),
  jsonb_build_object('row', 4, 'date', current_date, 'direction', 'in', 'amount', 1234, 'reference', '703', 'description', 'PAGO'),
  jsonb_build_object('row', 5, 'date', current_date, 'direction', 'out', 'amount', 500, 'reference', '704', 'description', 'CASHEA SERVICIOS')
));
create temp table line_ids on commit drop as select row_number, id from public.bank_statement_lines;
grant select on line_ids to authenticated;

select is(
  ((public.bank_receivable_candidates((select id from line_ids where row_number = 2)) -> 'items' -> 0)
     - array['provider', 'kind', 'customer_name', 'document', 'external_ref', 'currency', 'next_due', 'pending']),
  jsonb_build_object('receivable_id', current_setting('test.fin')::uuid, 'next_number', 1, 'next_pending', 30.00, 'applied', 30.00, 'match', 'installment'),
  'Bs 3.000 a tasa 100 coincide con la cuota 1 de Cashea'
);
select is(
  (public.bank_receivable_candidates((select id from line_ids where row_number = 3)) -> 'items' -> 0 ->> 'match'), 'balance',
  'Bs 9.000 coincide con el saldo completo'
);
select is(
  (public.bank_receivable_candidates((select id from line_ids where row_number = 4)) -> 'items' -> 0 ->> 'match'), null,
  'un monto que no coincide queda sin sugerencia'
);
select is(
  jsonb_array_length(public.bank_receivable_candidates((select id from line_ids where row_number = 5)) -> 'items'), 0,
  'una salida no es cobro'
);

select lives_ok(
  format($$ select public.collect_receivable_from_bank_line(%L, %L) $$, (select id from line_ids where row_number = 2), current_setting('test.fin')),
  'cobra la cuota desde la línea'
);
select results_eq(
  $$ select l.status, l.match_kind, m.kind, m.amount, m.reference, c.amount
     from public.bank_statement_lines l
     join public.finance_movements m on m.id = l.movement_id
     join public.receivable_collections c on c.movement_id = m.id
     where l.row_number = 2 $$,
  $$ values ('matched'::text, 'created'::text, 'receivable'::text, 3000.00::numeric, '701'::text, 30.00::numeric) $$,
  'la línea queda conciliada con el cobro de 30 USD'
);
select results_eq(
  format($$ select r.collected, i.collected from public.receivables r join public.receivable_installments i on i.receivable_id = r.id and i.number = 1 where r.id = %L $$, current_setting('test.fin')),
  $$ values (30.00::numeric, 30.00::numeric) $$,
  'y baja la cuota del cliente'
);
select throws_ok(
  format($$ select public.collect_receivable_from_bank_line(%L, %L) $$, (select id from line_ids where row_number = 2), current_setting('test.fin')),
  '23514', 'La línea ya está conciliada o ignorada',
  'no se cobra dos veces la misma línea'
);
select throws_ok(
  format($$ select public.collect_receivable_from_bank_line(%L, %L) $$, (select id from line_ids where row_number = 5), current_setting('test.cr')),
  '23514', 'Un cobro es una entrada del banco',
  'una salida no se cobra'
);
select throws_ok(
  format($$ select public.collect_receivable_from_bank_line(%L, %L) $$, (select id from line_ids where row_number = 3), current_setting('test.fin')),
  '23514', null,
  'no cobra más de lo que falta'
);

select lives_ok(
  $$ select public.settle_provider_from_bank_line((select id from line_ids where row_number = 5), 'Cashea') $$,
  'el pago a Cashea se liquida desde la línea'
);
select results_eq(
  $$ select l.status, p.provider, p.kind, p.amount, p.document
     from public.bank_statement_lines l join public.provider_ledger p on p.movement_id = l.movement_id
     where l.row_number = 5 $$,
  $$ values ('matched'::text, 'Cashea'::text, 'settlement'::text, 500.00::numeric, '704'::text) $$,
  'queda en la cuenta corriente con la referencia del banco'
);

select is(
  public.reopen_bank_line((select id from line_ids where row_number = 2)), 'unmatched',
  'desvincular el cobro'
);
select results_eq(
  format($$ select r.collected, (select count(*)::int from public.receivable_collections c where c.receivable_id = r.id and c.voided_at is null)
            from public.receivables r where r.id = %L $$, current_setting('test.fin')),
  $$ values (0.00::numeric, 0) $$,
  'anula el cobro y la cuota vuelve a quedar pendiente'
);
select public.reopen_bank_line((select id from line_ids where row_number = 5));
select is(
  (select count(*)::int from public.provider_ledger where voided_at is null and kind = 'settlement'), 0,
  'y desvincular la liquidación la anula'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.bank_receivable_candidates((select id from line_ids where row_number = 2)) $$,
  '42501', null,
  'el cajero no concilia cobranza'
);

select * from finish();
rollback;
