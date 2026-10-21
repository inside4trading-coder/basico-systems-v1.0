-- El cajero se elige al abrir la caja y se releva con registro.

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
insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '5');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1'),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Otra', 'T2'),
  ('bbbbbbbb-2222-2222-2222-222222222221', 'bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'T1');
insert into public.registers (id, tenant_id, location_id, name, code) values
  ('aaaaaaaa-3333-3333-3333-333333333331', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222221', 'Caja', 'C1'),
  ('aaaaaaaa-3333-3333-3333-333333333332', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-2222-2222-2222-222222222222', 'Caja otra', 'C2'),
  ('bbbbbbbb-3333-3333-3333-333333333331', 'bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222221', 'Caja B', 'C1');
insert into public.cashiers (id, tenant_id, name, location_id, works_pos) values
  ('aaaaaaaa-7777-7777-7777-777777777771', 'aaaaaaaa-1111-1111-1111-111111111111', 'Yolimar', 'aaaaaaaa-2222-2222-2222-222222222221', true),
  ('aaaaaaaa-7777-7777-7777-777777777772', 'aaaaaaaa-1111-1111-1111-111111111111', 'Luis', null, true),
  ('aaaaaaaa-7777-7777-7777-777777777773', 'aaaaaaaa-1111-1111-1111-111111111111', 'Pedro', 'aaaaaaaa-2222-2222-2222-222222222222', true),
  ('aaaaaaaa-7777-7777-7777-777777777774', 'aaaaaaaa-1111-1111-1111-111111111111', 'Ana (almacén)', 'aaaaaaaa-2222-2222-2222-222222222221', false),
  ('bbbbbbbb-7777-7777-7777-777777777771', 'bbbbbbbb-1111-1111-1111-111111111111', 'Cajero B', null, true);

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331') $$,
  '23514', 'Elige quién abre la caja',
  'con personal de caja en la sede, abrir sin cajero no se puede'
);
select throws_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331', '[]', null, 'aaaaaaaa-7777-7777-7777-777777777773') $$,
  'P0002', 'Cajero no disponible en esta sede',
  'no con personal de otra sede'
);
select throws_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331', '[]', null, 'aaaaaaaa-7777-7777-7777-777777777774') $$,
  'P0002', 'Cajero no disponible en esta sede',
  'ni con quien no atiende el POS'
);
select throws_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331', '[]', null, 'bbbbbbbb-7777-7777-7777-777777777771') $$,
  'P0002', 'Cajero no disponible en esta sede',
  'ni con personal de otro negocio'
);

select set_config('test.session',
  public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333331', '[]', null, 'aaaaaaaa-7777-7777-7777-777777777771') ->> 'session_id', true);
select is(
  (select cashier_id from public.cash_sessions where id = current_setting('test.session')::uuid),
  'aaaaaaaa-7777-7777-7777-777777777771'::uuid,
  'la sesión queda con quien la abrió'
);

select lives_ok(
  $$ select public.change_session_cashier(current_setting('test.session')::uuid, 'aaaaaaaa-7777-7777-7777-777777777772') $$,
  'relevo con personal de todas las sedes'
);
select throws_ok(
  $$ select public.change_session_cashier(current_setting('test.session')::uuid, 'aaaaaaaa-7777-7777-7777-777777777773') $$,
  'P0002', 'Cajero no disponible en esta sede',
  'el relevo también valida la sede'
);
select results_eq(
  $$ select c.name from public.cash_session_cashiers h join public.cashiers c on c.id = h.cashier_id
     where h.session_id = current_setting('test.session')::uuid order by h.changed_at, c.name $$,
  $$ values ('Yolimar'::text), ('Luis') $$,
  'queda el registro de quién abrió y de cada relevo'
);
select is(
  (select cashier_id from public.cash_sessions where id = current_setting('test.session')::uuid),
  'aaaaaaaa-7777-7777-7777-777777777772'::uuid,
  'la sesión pasa al nuevo cajero'
);

-- Una venta sin cajero explícito toma el de la sesión.
insert into public.products (id, tenant_id, name) values ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'F1', 10);
reset role;
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 50);
set local role authenticated;
select lives_ok(
  $$ select public.register_sale('sc-venta-01', current_setting('test.session')::uuid,
       '[{"variant_id":"aaaaaaaa-5555-5555-5555-555555555551","qty":1}]',
       jsonb_build_array(jsonb_build_object('payment_method_id', (select id from public.payment_methods where code = 'cash_base'), 'amount', 11.6))) $$,
  'vende sin elegir cajero'
);
select is(
  (select cashier_id from public.sales where idempotency_key = 'sc-venta-01'),
  'aaaaaaaa-7777-7777-7777-777777777772'::uuid,
  'la venta queda con el cajero de la sesión'
);

-- Una sede sin personal de caja abre como antes.
select lives_ok(
  $$ update public.cashiers set is_active = false where id = 'aaaaaaaa-7777-7777-7777-777777777773' $$,
  'sin personal activo en la otra sede'
);
select lives_ok(
  $$ select public.open_cash_session('aaaaaaaa-3333-3333-3333-333333333332', '[]', null, 'aaaaaaaa-7777-7777-7777-777777777772') $$,
  'con personal de todas las sedes, abre eligiéndolo'
);

-- Otro negocio no ve los relevos de A.
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty($$ select 1 from public.cash_session_cashiers $$, 'B no ve los relevos de A');
select throws_ok(
  $$ select public.change_session_cashier(current_setting('test.session')::uuid, 'bbbbbbbb-7777-7777-7777-777777777771') $$,
  'P0002', null,
  'B no releva el cajero de una caja de A'
);

select * from finish();
rollback;
