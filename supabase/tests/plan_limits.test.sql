-- Planes y límites: cuotas y módulos se cumplen en la base.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role)
select ('aaaaaaaa-0000-0000-0000-00000000000' || n)::uuid, 'u' || n || '@test.local', 'authenticated', 'authenticated'
from generate_series(1, 7) n;
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero');

-- Sedes: el plan básico incluye 1.
select lives_ok(
  $$ insert into public.locations (id, tenant_id, name, code) values
       ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Cabudare', 'CAB') $$,
  'la primera sede entra'
);
select throws_ok(
  $$ insert into public.locations (tenant_id, name, code) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Barquisimeto', 'BQT') $$,
  '23514', 'Tu plan incluye 1 sede. Escríbenos para ampliarlo.',
  'la segunda sede no cabe en el plan'
);
update public.locations set deleted_at = now() where id = 'aaaaaaaa-2222-2222-2222-222222222221';
select lives_ok(
  $$ insert into public.locations (id, tenant_id, name, code) values
       ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Barquisimeto', 'BQT') $$,
  'una sede eliminada libera el cupo'
);
select throws_ok(
  $$ update public.locations set deleted_at = null where id = 'aaaaaaaa-2222-2222-2222-222222222221' $$,
  '23514', null,
  'restaurarla no se salta el límite'
);
insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '3');
select lives_ok(
  $$ update public.locations set deleted_at = null where id = 'aaaaaaaa-2222-2222-2222-222222222221' $$,
  'con la excepción de plataforma entra'
);

-- Cajas activas: 2.
insert into public.registers (tenant_id, location_id, name, code) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja 1', 'C1'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja 2', 'C2');
select throws_ok(
  $$ insert into public.registers (tenant_id, location_id, name, code) values
       ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja 3', 'C3') $$,
  '23514', 'Tu plan incluye 2 cajas activas. Escríbenos para ampliarlo.',
  'la tercera caja activa no cabe'
);
select lives_ok(
  $$ insert into public.registers (id, tenant_id, location_id, name, code, is_active) values
       ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja 3', 'C3', false) $$,
  'una caja inactiva sí'
);
select throws_ok(
  $$ update public.registers set is_active = true where id = 'aaaaaaaa-3333-3333-3333-333333333333' $$,
  '23514', null,
  'activarla no se salta el límite'
);

-- Usuarios: 5.
insert into public.tenant_members (tenant_id, user_id, role)
select 'aaaaaaaa-1111-1111-1111-111111111111', ('aaaaaaaa-0000-0000-0000-00000000000' || n)::uuid, 'cajero'
from generate_series(3, 5) n;
select throws_ok(
  $$ insert into public.tenant_members (tenant_id, user_id, role) values
       ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000006', 'cajero') $$,
  '23514', 'Tu plan incluye 5 usuarios. Escríbenos para ampliarlo.',
  'el sexto usuario no cabe'
);

-- Uso del plan.
set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.plan_usage(), '{"locations": 2, "registers": 2, "users": 5}'::jsonb, 'el dueño ve su uso');
select is(
  (select jsonb_object_agg(key, value) from public.tenant_entitlements), '{"max_locations": 3}'::jsonb,
  'y lee sus excepciones'
);
select throws_ok(
  $$ insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_users', '99') $$,
  '42501', null,
  'pero no se las escribe'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.plan_usage() $$, '42501', null, 'el cajero no ve el uso del plan');

-- Módulos apagados.
reset role;
insert into public.tenant_entitlements (tenant_id, key, value) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'pos', 'false'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'administracion', 'false'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'reportes', 'false');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.open_cash_session((select id from public.registers where code = 'C1')) $$,
  '42501', 'El punto de venta no está incluido en el plan de este negocio',
  'sin POS no se abre caja'
);
select throws_ok(
  $$ insert into public.finance_accounts (name, kind, currency) values ('Banco', 'bank', 'VES') $$,
  '42501', 'Administración no está incluido en el plan de este negocio',
  'sin Administración no se crean cuentas'
);
select throws_ok(
  $$ select public.report_sales((now() at time zone 'America/Caracas')::date, (now() at time zone 'America/Caracas')::date) $$,
  '42501', 'Reportes no está incluido en el plan de este negocio',
  'sin Reportes no hay reportes'
);

select * from finish();
rollback;
