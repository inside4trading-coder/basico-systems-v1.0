-- Fichaje: PIN, enlace del negocio, radio de la sede, orden de marcas y revisión.

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
insert into public.tenant_entitlements (tenant_id, key, value) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'fichaje', 'true'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '5');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
-- Tienda con ubicación (radio 100 m) y depósito sin ubicación.
insert into public.locations (id, tenant_id, name, code, latitude, longitude, clock_radius_m) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1', 10.0500, -69.3000, 100);
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Depósito', 'D1');
insert into public.cashiers (id, tenant_id, name, location_id, work_days, entry_time, late_tolerance) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'aaaaaaaa-1111-1111-1111-111111111111', 'Ana', 'aaaaaaaa-2222-2222-2222-222222222221',
   '{0,1,2,3,4,5,6}', ((now() at time zone 'America/Caracas') - interval '30 minutes')::time, 10),
  ('aaaaaaaa-6666-6666-6666-666666666662', 'aaaaaaaa-1111-1111-1111-111111111111', 'Beto', 'aaaaaaaa-2222-2222-2222-222222222222', '{0,1,2,3,4,5,6}', null, 10),
  ('aaaaaaaa-6666-6666-6666-666666666663', 'aaaaaaaa-1111-1111-1111-111111111111', 'Carla', null, '{0,1,2,3,4,5,6}', null, 10);
select set_config('test.key', (select clock_key from public.tenants where id = 'aaaaaaaa-1111-1111-1111-111111111111'), true);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- PIN
select throws_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666661', '1234') $$, '23514', 'El PIN son 6 números', 'el PIN son 6 números');
select throws_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666661', '111111') $$, '23514', 'Ese PIN es muy fácil de adivinar', 'no acepta PIN obvios');
select lives_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666661', '482913') $$, 'el dueño asigna el PIN de Ana');
select lives_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666662', '730164') $$, 'y el de Beto');
select lives_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666663', '905127') $$, 'y el de Carla');
select throws_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666663', '482913') $$, '23505', null, 'dos personas no comparten PIN');
select throws_ok($$ select pin_hash from public.cashiers limit 1 $$, '42501', null, 'el hash del PIN no se lee desde la app');
select is((select clock_enabled from public.cashiers where id = 'aaaaaaaa-6666-6666-6666-666666666661'), true, 'con PIN queda habilitada para fichar');
select is(public.clock_key(), current_setting('test.key'), 'el encargado ve el enlace de fichaje');

-- Desde el teléfono, sin sesión.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.headers', '{}', true);

select is(public.clock_lookup('clave-inventada', '482913') ->> 'ok', 'false', 'una clave inventada no sirve');
select is(public.clock_lookup(current_setting('test.key'), '000001') ->> 'error', 'PIN incorrecto', 'PIN equivocado');
select results_eq(
  $$ select r ->> 'name', (r -> 'today' -> 'allowed')::text, (r ->> 'needs_location')::boolean from (select public.clock_lookup(current_setting('test.key'), '482913') r) x $$,
  $$ values ('Ana'::text, '["entrada"]'::text, true) $$,
  'con su PIN, Ana ve que le toca la entrada y que pide ubicación'
);
select is(public.clock_punch(current_setting('test.key'), '482913', 'salida', 10.0500, -69.3000, 10) ->> 'error', 'Esa marca no corresponde ahora', 'no se marca salida sin entrada');
select is(public.clock_punch(current_setting('test.key'), '482913', 'entrada') ->> 'error', 'Activa la ubicación del teléfono para fichar', 'sin ubicación no ficha en una sede con ubicación');
select matches(public.clock_punch(current_setting('test.key'), '482913', 'entrada', 10.0600, -69.3000, 10) ->> 'error', '^Estás a 1112 m de Tienda', 'a un kilómetro no ficha');
select results_eq(
  $$ select r ->> 'ok', r ->> 'status', (r -> 'today' -> 'allowed')::text from (select public.clock_punch(current_setting('test.key'), '482913', 'entrada', 10.0503, -69.3002, 15) r) x $$,
  $$ values ('true'::text, 'ok'::text, '["inicio_descanso", "salida"]'::text) $$,
  'a 40 m de la tienda ficha la entrada'
);
select is(public.clock_punch(current_setting('test.key'), '482913', 'entrada', 10.0503, -69.3002, 15) ->> 'duplicate', 'true', 'el doble toque no duplica');
select ok(
  public.clock_punch(current_setting('test.key'), '482913', 'inicio_descanso', 10.0503, -69.3002, 15) ->> 'ok' = 'true'
  and public.clock_punch(current_setting('test.key'), '482913', 'fin_descanso', 10.0503, -69.3002, 15) ->> 'ok' = 'true'
  and public.clock_punch(current_setting('test.key'), '482913', 'salida', 10.0503, -69.3002, 15) ->> 'ok' = 'true',
  'descanso y salida en orden'
);
select is(public.clock_punch(current_setting('test.key'), '730164', 'entrada') ->> 'status', 'revisar', 'en una sede sin ubicación ficha, pero queda por revisar');
select is(public.clock_punch(current_setting('test.key'), '905127', 'entrada', 10.0501, -69.3001, 5) ->> 'location', 'Tienda', 'quien trabaja en todas las sedes ficha en la más cercana con ubicación');

-- Límite de intentos: 20 fallos en 15 minutos bloquean el enlace.
select ok(
  (select bool_and(public.clock_lookup(current_setting('test.key'), lpad(g::text, 6, '0')) ->> 'error' = 'PIN incorrecto') from generate_series(100, 118) g),
  'los intentos fallidos se cuentan'
);
select is(public.clock_lookup(current_setting('test.key'), '482913') ->> 'error', 'Demasiados intentos. Espera unos minutos.', 'después de 20 fallos se bloquea un rato, aun con el PIN correcto');
select throws_ok($$ select count(*) from public.clock_events $$, '42501', null, 'sin sesión no se leen los fichajes');

-- Encargados
reset role;
set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select kind, status, (late_minutes between 29 and 31) or (now() at time zone 'America/Caracas')::time < '00:31'
     from public.clock_events where staff_id = 'aaaaaaaa-6666-6666-6666-666666666661' and kind = 'entrada' $$,
  $$ values ('entrada'::text, 'ok'::text, true) $$,
  'la entrada guarda los minutos de atraso pasada la tolerancia'
);
select is((select count(*)::int from public.clock_events), 6, 'el dueño ve todos los fichajes del negocio');
select lives_ok(
  format($$ select public.review_clock_event(%L, 'aprobado', 'Estaba en el depósito') $$,
         (select id from public.clock_events where staff_id = 'aaaaaaaa-6666-6666-6666-666666666662')),
  'aprueba el fichaje por revisar'
);
select throws_ok(
  $$ select public.add_clock_event('aaaaaaaa-6666-6666-6666-666666666662', 'salida', now(), ' ') $$,
  '23514', 'Indica por qué se registra a mano', 'el fichaje a mano pide motivo'
);
select lives_ok(
  $$ select public.add_clock_event('aaaaaaaa-6666-6666-6666-666666666662', 'salida', now(), 'Se le descargó el teléfono') $$,
  'registra la salida a mano'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.clock_events), 0, 'el cajero no ve los fichajes');
select throws_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666662', '518274') $$, '42501', null, 'ni asigna PIN');

select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.clock_events), 0, 'otro negocio no ve los fichajes de A');
select throws_ok($$ select public.set_staff_pin('aaaaaaaa-6666-6666-6666-666666666661', '518274') $$, '42501', 'Fichaje no está incluido en el plan de este negocio', 'sin el add-on no se asignan PIN');

-- Sin el add-on, el enlace deja de servir.
reset role;
delete from public.tenant_entitlements where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and key = 'fichaje';
delete from public.clock_pin_failures;
select matches(public.clock_lookup(current_setting('test.key'), '482913') ->> 'error', '^Este enlace de fichaje no está activo', 'sin el add-on, el enlace no está activo');

select * from finish();
rollback;
