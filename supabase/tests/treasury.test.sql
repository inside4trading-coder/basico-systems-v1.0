-- Resumen de tesorería y catálogo de Administración.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero');
-- Tasas fijas (la tabla es global: puede haber otras filas esos días).
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 100, (now() at time zone 'America/Caracas')::date),
  ('bcv', 'USD', 'VES', 50, (now() at time zone 'America/Caracas')::date - 5)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.finance_catalog_items where kind = 'category'), 11,
  'un negocio nuevo arranca con categorías genéricas'
);
select lives_ok(
  $$ insert into public.finance_catalog_items (kind, name) values ('counterparty', 'Corpoelec') $$,
  'el dueño agrega una contraparte'
);
select throws_ok(
  $$ insert into public.finance_catalog_items (kind, name) values ('counterparty', '  corpoelec ') $$,
  '23505', null,
  'no repite un nombre (sin importar mayúsculas ni espacios)'
);
select throws_ok(
  $$ insert into public.finance_catalog_items (kind, name, direction) values ('counterparty', 'Banco', 'in') $$,
  '23514', null,
  'solo las categorías son de ingreso o egreso'
);
select lives_ok(
  $$ update public.finance_catalog_items set is_active = false where name = 'Transporte' $$,
  'desactiva una categoría'
);
select throws_ok(
  $$ delete from public.finance_catalog_items where name = 'Transporte' $$,
  '42501', null,
  'no se borra: se desactiva'
);

-- ---------------------------------------------------------------------------
-- Resumen
-- ---------------------------------------------------------------------------

insert into public.finance_accounts (id, name, kind, currency, opening_balance, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', 10000, current_date - 30),
  ('aaaaaaaa-6666-6666-6666-666666666662', 'Caja USD', 'cash', 'USD', 100, current_date - 30);

select public.finance_movement('aaaaaaaa-6666-6666-6666-666666666661', 'out', 1000, (now() at time zone 'America/Caracas')::date - 5, 'Servicios', 'Corpoelec');
select public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'in', 50, (now() at time zone 'America/Caracas')::date, 'Otros ingresos');
select public.finance_transfer('aaaaaaaa-6666-6666-6666-666666666662', 'aaaaaaaa-6666-6666-6666-666666666661', 10, 1000, (now() at time zone 'America/Caracas')::date);

select set_config('test.s', public.treasury_summary()::text, true);
select is((current_setting('test.s')::jsonb ->> 'base_currency'), 'USD', 'informa la moneda base');
select is((current_setting('test.s')::jsonb -> 'rate' ->> 'rate')::numeric, 100::numeric, 'y la tasa vigente');
select is(
  (current_setting('test.s')::jsonb -> 'liquidity' ->> 'total')::numeric, 240::numeric,
  'liquidez: 140 USD más 10.000 Bs a 100'
);
select is(
  (current_setting('test.s')::jsonb -> 'period' ->> 'income')::numeric, 50::numeric,
  'ingresos sin contar el traslado'
);
select is(
  (current_setting('test.s')::jsonb -> 'period' ->> 'expense')::numeric, 20::numeric,
  'egresos con la tasa del día del movimiento (1.000 Bs a 50)'
);
select is(
  (current_setting('test.s')::jsonb -> 'period' -> 'expense_by_category' -> 0 ->> 'category'), 'Servicios',
  'egresos por categoría'
);
select is(
  (select (a ->> 'balance')::numeric from jsonb_array_elements(current_setting('test.s')::jsonb -> 'accounts') a where a ->> 'name' = 'Banco Bs'),
  10000::numeric,
  'saldo de la cuenta en su moneda'
);
select is(
  (select (a ->> 'balance_base')::numeric from jsonb_array_elements(current_setting('test.s')::jsonb -> 'accounts') a where a ->> 'name' = 'Banco Bs'),
  100::numeric,
  'y en la moneda base'
);
select is(jsonb_array_length(current_setting('test.s')::jsonb -> 'recent'), 4, 'últimos movimientos, traslado incluido');

select is(
  (public.treasury_summary((now() at time zone 'America/Caracas')::date - 2) -> 'period' ->> 'expense')::numeric, 0::numeric,
  'el periodo deja fuera lo anterior'
);
select throws_ok(
  $$ select public.treasury_summary(current_date, current_date - 1) $$,
  '23514', 'El periodo empieza después de terminar',
  'periodo al revés'
);

-- Moneda sin tasa: no se suma y se avisa.
insert into public.finance_accounts (name, kind, currency, opening_balance) values ('Euros', 'cash', 'EUR', 50);
select is(
  (public.treasury_summary() -> 'liquidity' ->> 'total')::numeric, 240::numeric,
  'una cuenta en otra moneda no se suma'
);
select is(
  (public.treasury_summary() -> 'liquidity' -> 'unconverted'), '["EUR"]'::jsonb,
  'y queda indicada'
);

-- Por pagar
insert into public.obligations (name, amount, currency, frequency, start_date)
values ('Patente', 30, 'USD', 'once', current_date - 3), ('Seguro anual', 500, 'USD', 'once', current_date + 60);
select public.refresh_obligations();
select results_eq(
  $$ select (p ->> 'count')::int, (p ->> 'total')::numeric, (p ->> 'overdue_count')::int
     from (select public.treasury_summary() -> 'payable' p) x $$,
  $$ values (1, 30::numeric, 1) $$,
  'por pagar: vencidas y próximos 30 días, no las lejanas'
);

-- ---------------------------------------------------------------------------
-- Cajero
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.treasury_summary() $$, '42501', null, 'el cajero no ve la tesorería');
select is((select count(*)::int from public.finance_catalog_items), 0, 'ni el catálogo');

select * from finish();
rollback;
