-- Alta por enlace: enlaces de la plataforma, canje, asistente inicial y permisos.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'plataforma@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cliente@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'otro@test.local', 'authenticated', 'authenticated');
insert into app.platform_admins (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tenants (id, name, slug) values ('bbbbbbbb-1111-1111-1111-111111111111', 'Ferretería El Sol', 'ferreteria-el-sol');

-- Tablas de plataforma fuera del alcance de los clientes.
select ok(not has_table_privilege('anon', 'app.signup_invites', 'SELECT'), 'anon no lee los enlaces');
select ok(not has_table_privilege('authenticated', 'app.signup_invites', 'SELECT'), 'authenticated no lee los enlaces');
select ok(not has_table_privilege('authenticated', 'app.platform_admins', 'SELECT'), 'authenticated no lee los admins');
select ok(not has_function_privilege('authenticated', 'public.signup_register_attempt(text, text)', 'EXECUTE'),
          'solo la función de alta registra intentos');

-- Un cliente no es plataforma.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.is_platform_admin(), false, 'un cliente no es admin de plataforma');
select throws_ok($$ select public.platform_create_invite('X', null, '{}', 30, 7) $$, '42501', 'Solo la plataforma puede hacer esto',
                 'un cliente no crea enlaces');
select throws_ok($$ select * from public.platform_tenants() $$, '42501', 'Solo la plataforma puede hacer esto',
                 'un cliente no ve los negocios');

-- La plataforma crea enlaces.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.is_platform_admin(), true, 'la plataforma se reconoce');
select throws_ok($$ select public.platform_create_invite('X', null, '{"inventado": true}', 30, 7) $$, '23514',
                 'No existe el módulo o cupo «inventado»', 'solo módulos que existen');
select throws_ok($$ select public.platform_create_invite('X', null, '{"max_users": true}', 30, 7) $$, '23514',
                 'Valor no válido para «max_users»', 'cada cupo con su tipo');
select lives_ok($$ select set_config('t.code', public.platform_create_invite('Ferretería', null, '{"fichaje": true, "max_users": 8}', 30, 7), true) $$,
                'la plataforma crea un enlace');
select lives_ok($$ select set_config('t.fijo', public.platform_create_invite('Con correo', 'Cliente@Test.local', '{}', null, 7), true) $$,
                'enlace con correo fijo');

-- Quien abre el enlace (sin cuenta) ve solo la etiqueta.
reset role;
set local role anon;
select is(public.signup_invite_info(current_setting('t.code')), '{"valid": true, "label": "Ferretería", "email": null}'::jsonb,
          'anon ve la etiqueta, no los módulos');
select is(public.signup_invite_info('noexiste'), '{"valid": false, "reason": "no_existe"}'::jsonb, 'código inexistente');
select throws_ok($$ select public.redeem_signup_invite('x', 'y') $$, '42501', null, 'anon no canjea');

-- Intentos de cuenta (los registra la función de alta con service_role).
reset role;
select is(app.signup_register_attempt(current_setting('t.fijo'), 'otro@test.local') ->> 'reason', 'otro_correo',
          'el enlace con correo fijo rechaza otro correo');
select is(app.signup_register_attempt(current_setting('t.code'), 'a@test.local') ->> 'ok', 'true', 'primer intento');
select is(app.signup_register_attempt(current_setting('t.code'), 'b@test.local') ->> 'ok', 'true', 'segundo intento');
select is(app.signup_register_attempt(current_setting('t.code'), 'c@test.local') ->> 'ok', 'true', 'tercer intento');
select is(app.signup_register_attempt(current_setting('t.code'), 'd@test.local') ->> 'reason', 'sin_cupo',
          'máximo 3 cuentas por enlace');

-- Canje.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format('select public.redeem_signup_invite(%L, %L)', current_setting('t.fijo'), 'Otro'), '42501',
                 'Este enlace es para otro correo', 'el correo fijo se respeta al canjear');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format('select public.redeem_signup_invite(%L, %L)', current_setting('t.code'), ' '), '23514',
                 'Escribe el nombre del negocio', 'pide nombre');
select lives_ok(format('select set_config(''t.tenant'', public.redeem_signup_invite(%L, %L)::text, true)',
                       current_setting('t.code'), 'Ferretería El Sol'), 'el cliente canjea el enlace');
select throws_ok(format('select public.redeem_signup_invite(%L, %L)', current_setting('t.code'), 'Otra'), '23514',
                 'Este enlace de alta ya se usó', 'un enlace crea un solo negocio');
select is(public.signup_invite_info(current_setting('t.code')) ->> 'reason', 'usado', 'el enlace queda usado');

reset role;
select is((select slug from public.tenants where id = current_setting('t.tenant')::uuid), 'ferreteria-el-sol-2',
          'el slug se deriva del nombre y no choca');
select is((select role from public.tenant_members where tenant_id = current_setting('t.tenant')::uuid
           and user_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'owner', 'quien canjea queda como dueño');
select is(app.entitled(current_setting('t.tenant')::uuid, 'fichaje'), 'true'::jsonb, 'los módulos del enlace quedan activos');
select is(app.entitled(current_setting('t.tenant')::uuid, 'max_users'), '8'::jsonb, 'los cupos del enlace quedan');
select ok((select trial_ends_at between now() + interval '29 days' and now() + interval '31 days'
           from public.tenants where id = current_setting('t.tenant')::uuid), 'la prueba termina en 30 días');
select ok((select count(*) > 0 from public.payment_methods where tenant_id = current_setting('t.tenant')::uuid),
          'el negocio nace con sus métodos de pago');
select is((select onboarding_completed_at from public.tenants where id = current_setting('t.tenant')::uuid), null,
          'el negocio nuevo pasa por el asistente');

-- Asistente: paso Negocio.
set local role authenticated;
select set_config('request.headers', format('{"x-tenant-id":"%s"}', current_setting('t.tenant')), true);
select throws_ok($$ select public.onboarding_setup_business('Ferretería El Sol', null, null, null, null, 'Principal', 'manual', null, false) $$,
                 '23514', 'Escribe la tasa del día', 'tasa manual pide la tasa');
select lives_ok($$ select public.onboarding_setup_business('Ferretería El Sol C.A.', 'Ferretería El Sol, C.A.', 'j-123', '0414-1234567', 'Centro',
                                                         'Tienda Centro', 'manual', 40.5, true) $$, 'paso Negocio');
select lives_ok($$ select public.onboarding_setup_business('Ferretería El Sol C.A.', null, 'J-123', null, null,
                                                         'Tienda Centro', 'bcv', null, false) $$, 'se puede repetir');
reset role;
select is((select count(*)::int from public.locations where tenant_id = current_setting('t.tenant')::uuid), 1, 'una sola sede');
select is((select code from public.locations where tenant_id = current_setting('t.tenant')::uuid), 'TIENDACENT', 'código de sede derivado');
select is((select count(*)::int from public.registers where tenant_id = current_setting('t.tenant')::uuid), 1, 'una sola caja');
select is((select rate from public.tenant_rates where tenant_id = current_setting('t.tenant')::uuid), 40.5::numeric(18, 6),
          'la tasa manual se guarda');
select is((select tax_id || '|' || rate_source || '|' || name from public.tenants where id = current_setting('t.tenant')::uuid),
          'J-123|bcv|Ferretería El Sol C.A.', 'datos del negocio actualizados');
select ok((select onboarding_steps ? 'negocio' from public.tenants where id = current_setting('t.tenant')::uuid), 'paso marcado');

set local role authenticated;
select throws_ok($$ select public.onboarding_mark('otro') $$, '23514', 'Paso no válido', 'solo pasos conocidos');
select lives_ok($$ select public.onboarding_mark('productos') $$, 'paso Productos');
select lives_ok($$ select public.onboarding_mark('listo') $$, 'cierra el asistente');
select isnt((select onboarding_completed_at from public.tenants where id = current_setting('t.tenant')::uuid), null, 'asistente completo');

-- Otro usuario no configura un negocio ajeno.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.onboarding_mark('equipo') $$, '42501', null, 'un extraño no toca el asistente');

-- Plataforma: lista, suspende y extiende.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select owner_email from public.platform_tenants() where id = current_setting('t.tenant')::uuid), 'cliente@test.local',
          'la plataforma ve al dueño');
select is((select state from public.platform_invites() where code = current_setting('t.code')), 'usado', 'la plataforma ve el estado');
select lives_ok(format('select public.platform_set_tenant_status(%L, %L)', current_setting('t.tenant'), 'suspended'), 'suspender');
select lives_ok(format('select public.platform_extend_trial(%L, 15)', current_setting('t.tenant')), 'extender la prueba');
reset role;
select is((select status from public.tenants where id = current_setting('t.tenant')::uuid), 'suspended', 'negocio suspendido');
select ok((select trial_ends_at between now() + interval '44 days' and now() + interval '46 days'
           from public.tenants where id = current_setting('t.tenant')::uuid), 'la prueba suma 15 días');

select * from finish();
rollback;
