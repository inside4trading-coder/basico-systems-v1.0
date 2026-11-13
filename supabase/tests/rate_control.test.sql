-- Tasa bajo control: tasa de emergencia, registro de consultas y estado.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenants (id, name, slug, rate_source) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b', 'manual');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

delete from public.exchange_rates;
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date, fetched_at) values
  ('bcv', 'USD', 'VES', 900, '2026-11-12', '2026-11-11 18:00-04'),
  ('bcv', 'USD', 'VES', 905, '2026-11-13', '2026-11-12 18:00-04'),
  ('bcv', 'USD', 'VES', 910, '2026-11-14', '2026-11-13 18:00-04');

-- Tasa de emergencia de A, puesta el 13 a las 10:00.
insert into public.tenant_rates (tenant_id, base_currency, quote_currency, rate, note, until_official, created_at) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'USD', 'VES', 950, 'El BCV no carga', true, '2026-11-13 10:00-04');

select results_eq(
  $$ select rate, source from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-11-13 09:00-04') $$,
  $$ values (905::numeric, 'bcv'::text) $$,
  'antes de la tasa de emergencia rige la oficial'
);
select results_eq(
  $$ select rate, source, effective_date from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-11-13 12:00-04') $$,
  $$ values (950::numeric, 'manual'::text, '2026-11-13'::date) $$,
  'la tasa de emergencia gana a la oficial que ya regía ese día'
);
select results_eq(
  $$ select rate, source from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-11-14 08:00-04') $$,
  $$ values (910::numeric, 'bcv'::text) $$,
  'cuando entra en vigor una oficial nueva, la emergencia vence sola'
);

-- Cancelada a mano antes de tiempo.
insert into public.tenant_rates (tenant_id, base_currency, quote_currency, rate, until_official, created_at, ended_at) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'USD', 'VES', 960, true, '2026-11-14 10:00-04', '2026-11-14 11:00-04');
select results_eq(
  $$ select rate from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-11-14 10:30-04') $$,
  $$ values (960::numeric) $$,
  'mientras no se cancela, rige'
);
select results_eq(
  $$ select rate, source from app.rate_at('aaaaaaaa-1111-1111-1111-111111111111', '2026-11-14 12:00-04') $$,
  $$ values (910::numeric, 'bcv'::text) $$,
  'cancelada, vuelve la oficial'
);

-- En modo «tasa propia» la emergencia no cuenta.
insert into public.tenant_rates (tenant_id, base_currency, quote_currency, rate, until_official, created_at) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'USD', 'VES', 800, false, '2026-11-13 09:00-04'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'USD', 'VES', 999, true, '2026-11-13 10:00-04');
select results_eq(
  $$ select rate, source from app.rate_at('bbbbbbbb-1111-1111-1111-111111111111', '2026-11-13 12:00-04') $$,
  $$ values (800::numeric, 'manual'::text) $$,
  'con tasa propia rige la propia, no la de emergencia'
);
-- Y una tasa propia vieja no se vuelve emergencia al pasar a BCV.
update public.tenants set rate_source = 'bcv' where id = 'bbbbbbbb-1111-1111-1111-111111111111';
delete from public.tenant_rates where tenant_id = 'bbbbbbbb-1111-1111-1111-111111111111' and until_official;
select results_eq(
  $$ select rate, source from app.rate_at('bbbbbbbb-1111-1111-1111-111111111111', '2026-11-13 12:00-04') $$,
  $$ values (905::numeric, 'bcv'::text) $$,
  'al volver al BCV, la tasa propia anterior no se cuela'
);

-- Registro de consultas
delete from public.rate_fetch_log;
insert into public.rate_fetch_log (created_at, mode, ok, source, rate, effective_date, error) values
  (now() - interval '3 hours', 'cron', true, 'bcv', 910, '2026-11-14', null),
  (now() - interval '2 hours', 'auto', true, 'dolarapi', 910, '2026-11-14', 'BCV HTTP 503'),
  (now() - interval '1 hour', 'cron', false, null, null, null, 'BCV HTTP 503; DolarAPI USD HTTP 500'),
  (now() - interval '10 minutes', 'test', true, 'bcv', 910, '2026-11-14', null);

-- Emergencia vigente hoy para probar la RPC.
insert into public.exchange_rates (source, base_currency, quote_currency, rate, effective_date) values
  ('bcv', 'USD', 'VES', 920, (now() at time zone 'America/Caracas')::date - 1)
on conflict (source, base_currency, quote_currency, effective_date) do update set rate = excluded.rate;
delete from public.exchange_rates where effective_date >= (now() at time zone 'America/Caracas')::date;

-- Owner de A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select throws_ok($$ select * from public.rate_fetch_log $$, '42501', null, 'el registro no se lee directo');
select lives_ok(
  $$ insert into public.tenant_rates (base_currency, quote_currency, rate, note, until_official) values ('USD', 'VES', 975, 'Prueba', true) $$,
  'el owner pone una tasa de emergencia'
);
select results_eq(
  $$ select (s -> 'current' ->> 'rate')::numeric, s -> 'current' ->> 'source', (s -> 'override' ->> 'active')::boolean,
            (s -> 'override' ->> 'rate')::numeric
     from public.rate_status() s $$,
  $$ values (975::numeric, 'manual'::text, true, 975::numeric) $$,
  'el estado muestra la tasa de emergencia activa'
);
select results_eq(
  $$ select (s ->> 'failing')::boolean, s -> 'last_check' ->> 'mode', s -> 'last_check' ->> 'error',
            s -> 'last_error' ->> 'error'
     from public.rate_status() s $$,
  $$ values (true, 'cron'::text, 'BCV HTTP 503; DolarAPI USD HTTP 500'::text, 'BCV HTTP 503; DolarAPI USD HTTP 500'::text) $$,
  'la última consulta falló: la prueba de conexión no tapa el fallo'
);
select ok(
  (select (s ->> 'last_ok_at')::timestamptz between now() - interval '2 hours 1 minute' and now() - interval '1 hour 59 minutes' from public.rate_status() s),
  'última consulta buena: la automática de hace 2 horas'
);
select ok(
  (select jsonb_array_length(s -> 'history') between 1 and 15
      and (s -> 'history' -> 0 ->> 'source') = 'override'
   from public.rate_status() s),
  'el historial mezcla oficiales y propias, la más reciente primero'
);

-- Cajero: no cambia la tasa.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.tenant_rates (base_currency, quote_currency, rate, until_official) values ('USD', 'VES', 1, true) $$,
  '42501', null, 'el cajero no pone tasa de emergencia'
);
select throws_ok($$ select public.end_rate_override() $$, '42501', null, 'ni la cancela');
select lives_ok($$ select public.rate_status() $$, 'pero ve el estado');

-- Owner vuelve a la oficial.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.end_rate_override(), 2, 'cancela las emergencias no canceladas (la vigente y la ya vencida)');
select results_eq(
  $$ select (s -> 'current' ->> 'rate')::numeric, s -> 'current' ->> 'source', jsonb_typeof(s -> 'override') from public.rate_status() s $$,
  $$ values (920::numeric, 'bcv'::text, 'null'::text) $$,
  'y vuelve la oficial'
);

-- B no ve el registro de A ni toca su tasa.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is(public.end_rate_override(), 0, 'B no cancela la tasa de A');
select is(
  (select count(*)::int from public.tenant_rates where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111'), 0,
  'ni la lee'
);

reset role;
set local role anon;
select throws_ok($$ select public.rate_status() $$, '42501', null, 'sin sesión no hay estado');
reset role;

-- La consulta programada sin dirección del proyecto no hace nada.
select lives_ok($$ select app.request_rate_sync() $$, 'sin project_url en el Vault, la consulta programada no falla');
select ok(exists (select 1 from cron.job where jobname = 'exchange-rate-sync'), 'la consulta programada está agendada');

select * from finish();
rollback;
