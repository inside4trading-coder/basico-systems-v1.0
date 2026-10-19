-- Negocio demo: solo se siembra si está marcado, se puede volver a sembrar y
-- no toca a otros negocios.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000001', 'demo-t@test.local', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'cajero-demo@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a'),
  ('eeeeeeee-1111-1111-1111-111111111111', 'Demo', 'demo-test');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('eeeeeeee-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000001', 'owner'),
  ('eeeeeeee-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000002', 'cajero');
insert into public.locations (tenant_id, name, code) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Sede A', 'A');

select throws_ok(
  $$ select app.seed_demo_tenant('aaaaaaaa-1111-1111-1111-111111111111') $$,
  '42501', 'Solo se siembra un negocio marcado como demo',
  'un negocio que no es demo no se siembra'
);
select throws_ok(
  $$ select app.seed_demo_tenant('eeeeeeee-1111-1111-1111-111111111111') $$,
  '42501', null,
  'tampoco el demo sin marcar'
);

update public.tenants set is_demo = true where id = 'eeeeeeee-1111-1111-1111-111111111111';
select set_config('test.first', app.seed_demo_tenant('eeeeeeee-1111-1111-1111-111111111111', 14)::text, true);
select ok((current_setting('test.first')::jsonb ->> 'products')::int > 50, 'siembra el catálogo de repuestos');
select ok((current_setting('test.first')::jsonb ->> 'sales')::int > 50, 'y ventas de los últimos días');
-- Con 14 días todavía no vence ninguna cuota de Cashea: queda solo la transferencia sin identificar.
select is((current_setting('test.first')::jsonb ->> 'pending_lines')::int, 1, 'deja líneas del banco por identificar');

select is(
  (select count(*)::int from public.sales s where s.tenant_id = 'eeeeeeee-1111-1111-1111-111111111111'
     and s.status = 'completed' and abs(s.paid_total - s.igtf_total - s.change_total - s.total) > 0.05), 0,
  'cada venta está cobrada completa'
);
select is(
  (select count(*)::int from public.sales where tenant_id = 'eeeeeeee-1111-1111-1111-111111111111'
     and (sold_at at time zone 'America/Caracas')::date < (now() at time zone 'America/Caracas')::date - 14), 0,
  'las ventas caen dentro del periodo pedido'
);
select is(
  (select count(*)::int from public.cash_sessions where tenant_id = 'eeeeeeee-1111-1111-1111-111111111111' and status = 'open'), 1,
  'deja la caja de hoy abierta'
);
select is(
  (select count(*)::int from public.sales where tenant_id = 'eeeeeeee-1111-1111-1111-111111111111' and status = 'voided'), 1,
  'con una venta anulada'
);
select ok(
  exists (select 1 from public.receivables where tenant_id = 'eeeeeeee-1111-1111-1111-111111111111' and provider = 'Cashea'),
  'hay ventas con Cashea'
);
select results_eq(
  $$ select count(*)::int from public.inventory_movements m join public.sales s on m.note = 'Venta ' || s.number and s.tenant_id = m.tenant_id
     where m.tenant_id = 'eeeeeeee-1111-1111-1111-111111111111' and m.created_at <> s.sold_at $$,
  $$ values (0) $$,
  'el kardex lleva la hora de cada venta'
);
select is(
  (select max(m.user_id::text) from public.tenant_members m where m.tenant_id = 'eeeeeeee-1111-1111-1111-111111111111' and m.role = 'cajero'),
  'eeeeeeee-0000-0000-0000-000000000002',
  'conserva al equipo'
);

select is(
  app.seed_demo_tenant('eeeeeeee-1111-1111-1111-111111111111', 14)::text, current_setting('test.first'),
  'volver a sembrar deja lo mismo'
);
select is(
  (select count(*)::int from public.locations where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111'), 1,
  'y no toca a otro negocio'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"eeeeeeee-1111-1111-1111-111111111111"}', true);
select throws_ok(
  $$ select app.seed_demo_tenant('eeeeeeee-1111-1111-1111-111111111111') $$,
  '42501', null,
  'un usuario no puede resembrar'
);
select throws_ok(
  $$ update public.tenants set is_demo = true where id = 'eeeeeeee-1111-1111-1111-111111111111' $$,
  '42501', null,
  'ni marcar su negocio como demo'
);

select * from finish();
rollback;
