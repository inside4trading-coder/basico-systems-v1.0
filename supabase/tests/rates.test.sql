-- Tasa de cambio, impuestos y métodos de pago.

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
insert into public.tenants (id, name, slug, base_currency, local_currency) values
  ('cccccccc-1111-1111-1111-111111111111', 'Tienda C', 'tienda-c', 'COP', null);
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 870, '2026-10-16'),
  ('dolarapi', 'USD', 'VES', 875, '2026-10-17'),
  ('dolarapi', 'USD', 'VES', 879, '2026-10-19'),
  ('bcv', 'USD', 'VES', 881.0664, '2026-10-19'),
  ('bcv', 'USD', 'VES', 890, '2026-10-21');

-- Valores iniciales
select results_eq(
  $$ select name, rate, is_default from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' order by rate desc $$,
  $$ values ('IVA general'::text, 16::numeric, true), ('IVA reducido'::text, 8::numeric, false), ('Exento'::text, 0::numeric, false) $$,
  'un negocio nuevo nace con IVA general, reducido y exento'
);
select results_eq(
  $$ select code, currency, applies_igtf from public.payment_methods
     where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' order by position $$,
  $$ values ('cash_base'::text, 'USD'::text, true), ('zelle'::text, 'USD'::text, true),
            ('mobile_payment'::text, 'VES'::text, false), ('card'::text, 'VES'::text, false),
            ('transfer'::text, 'VES'::text, false), ('cash_local'::text, 'VES'::text, false),
            ('cashea'::text, 'USD'::text, false) $$,
  'y con los métodos de pago venezolanos; el IGTF marca los pagos en divisas'
);
select results_eq(
  $$ select array_agg(code order by position) from public.payment_methods where tenant_id = 'cccccccc-1111-1111-1111-111111111111' $$,
  $$ values (array['cash_base', 'mobile_payment', 'card', 'transfer', 'cashea']) $$,
  'un negocio de una sola moneda no recibe efectivo local duplicado ni Zelle fuera de dólares'
);

-- Tasa vigente según la fecha valor
select results_eq(
  $$ select rate, source from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-10-18 12:00-04') $$,
  $$ values (875::numeric, 'dolarapi'::text) $$,
  'rige la tasa con fecha valor más reciente que ya empezó'
);
select results_eq(
  $$ select rate, source from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-10-19 08:00-04') $$,
  $$ values (881.0664::numeric, 'bcv'::text) $$,
  'con la misma fecha valor, el BCV gana a la fuente de respaldo'
);
select results_eq(
  $$ select rate from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-10-20 23:59-04') $$,
  $$ values (881.0664::numeric) $$,
  'una tasa publicada para mañana no se usa hoy'
);
select is_empty(
  $$ select 1 from app.rate_at('cccccccc-1111-1111-1111-111111111111', now()) $$,
  'sin moneda local no hay tasa'
);

-- Owner de A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select results_eq(
  $$ select count(*)::int from public.exchange_rates $$,
  $$ values (5) $$,
  'cualquier usuario con sesión lee las tasas oficiales'
);
select throws_ok(
  $$ insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date)
     values ('bcv', 'USD', 'VES', 1, '2026-10-22') $$,
  '42501', null,
  'nadie fija la tasa oficial desde el cliente'
);
select lives_ok(
  $$ update public.tenants set rate_source = 'manual', prices_include_tax = false, igtf_rate = 3
     where id = 'aaaaaaaa-1111-1111-1111-111111111111';
     insert into public.tenant_rates (base_currency, quote_currency, rate, note) values ('USD', 'VES', 900, 'Tasa del día') $$,
  'el dueño cambia a tasa propia y la fija'
);
select results_eq(
  $$ select rate, source from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111') $$,
  $$ values (900::numeric, 'manual'::text) $$,
  'con tasa propia rige la del negocio'
);
select results_eq(
  $$ select rate, source from public.current_rate() $$,
  $$ values (900::numeric, 'manual'::text) $$,
  'current_rate devuelve la tasa del negocio activo'
);
select throws_ok(
  $$ update public.tenant_rates set rate = 1 $$,
  '42501', null,
  'la tasa propia es historial: no se edita'
);
select lives_ok(
  $$ insert into public.tax_rates (name, rate) values ('Impuesto municipal', 2);
     update public.payment_methods set banks = array['Banesco', 'BNC'] where code = 'mobile_payment' $$,
  'el dueño agrega impuestos y configura métodos'
);
select throws_ok(
  $$ insert into public.tax_rates (name, rate, is_default) values ('Otro general', 16, true) $$,
  '23505', null,
  'solo una tasa de impuesto por defecto'
);

-- Cajero de A
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$ select count(*)::int from public.payment_methods $$,
  $$ values (7) $$,
  'el cajero ve los métodos de pago'
);
select throws_ok(
  $$ insert into public.tenant_rates (base_currency, quote_currency, rate) values ('USD', 'VES', 1) $$,
  '42501', null,
  'el cajero no fija la tasa'
);
select results_eq(
  $$ with u as (update public.payment_methods set is_active = false returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'el cajero no cambia los métodos de pago'
);
select results_eq(
  $$ with u as (update public.tenants set igtf_rate = 0 returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'el cajero no cambia la configuración fiscal'
);

-- Owner de B (antes se anota un impuesto de A para intentar usarlo desde B)
select set_config('test.a_tax', (select id::text from public.tax_rates where is_default), true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is_empty($$ select 1 from public.tenant_rates $$, 'B no ve la tasa propia de A');
select is_empty($$ select 1 from public.tax_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve los impuestos de A');
select is_empty($$ select 1 from public.payment_methods where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$, 'B no ve los métodos de A');
select lives_ok(
  $$ insert into public.products (name, tax_rate_id)
     values ('Con su impuesto', (select id from public.tax_rates where is_default)) $$,
  'B usa su propio impuesto en un producto'
);
select throws_ok(
  $$ insert into public.products (name, tax_rate_id) values ('Con impuesto ajeno', current_setting('test.a_tax')::uuid) $$,
  '23503', null,
  'un producto no puede usar un impuesto de otro negocio'
);

reset role;
select * from finish();
rollback;
