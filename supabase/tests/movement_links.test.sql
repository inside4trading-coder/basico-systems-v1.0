-- Enlazar un egreso ya registrado a cuotas de obligaciones, y categorías por defecto.

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
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');

select ok(
  (select count(*) from public.finance_catalog_items
   where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and kind = 'category' and direction = 'in') >= 5,
  'un negocio nuevo trae categorías de ingreso por defecto'
);
select ok(
  exists (select 1 from public.finance_catalog_items
          where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name = 'Compras de mercancía' and direction = 'out'),
  'y de egreso, como compras de mercancía'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.finance_accounts (id, name, kind, currency, opening_balance) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', 100000),
  ('aaaaaaaa-6666-6666-6666-666666666662', 'Caja USD', 'cash', 'USD', 1000);
insert into public.obligations (id, name, amount, currency, frequency, start_date) values
  ('aaaaaaaa-7777-7777-7777-777777777771', 'Internet', 45, 'USD', 'monthly', current_date - 5),
  ('aaaaaaaa-7777-7777-7777-777777777772', 'Agua', 10, 'USD', 'monthly', current_date - 5);
select public.refresh_obligations();
select set_config('test.internet', (select id::text from public.obligation_instances where obligation_id = 'aaaaaaaa-7777-7777-7777-777777777771' and due_date = current_date - 5), true);
select set_config('test.agua', (select id::text from public.obligation_instances where obligation_id = 'aaaaaaaa-7777-7777-7777-777777777772' and due_date = current_date - 5), true);

-- Un egreso de 50 USD ya registrado a mano, y uno en bolívares.
select set_config('test.mov', public.finance_movement('aaaaaaaa-6666-6666-6666-666666666662', 'out', 50, current_date - 2, 'Servicios', 'Proveedor', 'Z-1', null)::text, true);
select set_config('test.movbs', public.finance_movement('aaaaaaaa-6666-6666-6666-666666666661', 'out', 9000, current_date - 1, 'Servicios', null, 'PM-9', null)::text, true);

select is(
  (select count(*)::int from public.obligation_link_candidates(current_setting('test.internet')::uuid, current_date - 15, current_date + 15)),
  2, 'los egresos a mano del rango son candidatos'
);

select lives_ok(
  format($$ select public.link_movement(%L, %L, 45) $$, current_setting('test.internet'), current_setting('test.mov')),
  'enlaza 45 de los 50 a Internet'
);
select results_eq(
  format($$ select status, paid_amount, movement_id from public.obligation_instances where id = %L $$, current_setting('test.internet')),
  format($$ values ('paid'::text, 45::numeric, %L::uuid) $$, current_setting('test.mov')),
  'la cuota queda pagada con el movimiento enlazado'
);
select is(
  (select count(*)::int from public.finance_movements where obligation_instance_id is not null),
  0, 'sin crear otra salida de dinero'
);
select throws_ok(
  format($$ select public.link_movement(%L, %L, 10) $$, current_setting('test.agua'), current_setting('test.mov')),
  '23514', null,
  'no se asigna más de lo que queda del movimiento'
);
select lives_ok(
  format($$ select public.link_movement(%L, %L) $$, current_setting('test.agua'), current_setting('test.mov')),
  'sin monto toma lo que queda (5)'
);
select results_eq(
  format($$ select status, paid_amount from public.obligation_instances where id = %L $$, current_setting('test.agua')),
  $$ values ('partial'::text, 5::numeric) $$,
  'con 5 de 10, el agua queda parcial'
);
select throws_ok(
  format($$ select public.link_movement(%L, %L) $$, current_setting('test.agua'), current_setting('test.movbs')),
  '23514', 'Indica cuánto cubre de la cuota en USD',
  'otra moneda pide cuánto cubre'
);
select lives_ok(
  format($$ select public.link_movement(%L, %L, null, 5) $$, current_setting('test.agua'), current_setting('test.movbs')),
  'el pago en bolívares cubre 5 USD'
);
select results_eq(
  format($$ select status, paid_amount from public.obligation_instances where id = %L $$, current_setting('test.agua')),
  $$ values ('paid'::text, 10::numeric) $$,
  'y completa el agua'
);

-- Quitar un enlace recalcula.
select lives_ok(
  format($$ select public.unlink_movement((select id from public.finance_movement_links where movement_id = %L)) $$, current_setting('test.movbs')),
  'quita el enlace del pago en bolívares'
);
select results_eq(
  format($$ select status, paid_amount from public.obligation_instances where id = %L $$, current_setting('test.agua')),
  $$ values ('partial'::text, 5::numeric) $$,
  'el agua vuelve a parcial'
);

-- Anular el movimiento libera sus enlaces.
select lives_ok(
  format($$ select public.void_finance_movement(%L, 'Cargado dos veces') $$, current_setting('test.mov')),
  'se anula el egreso enlazado'
);
select is((select count(*)::int from public.finance_movement_links), 0, 'sus enlaces se quitan');
select results_eq(
  format($$ select status, paid_amount from public.obligation_instances where id in (%L, %L) order by paid_amount $$, current_setting('test.internet'), current_setting('test.agua')),
  $$ values ('pending'::text, 0::numeric), ('pending'::text, 0::numeric) $$,
  'y las cuotas vuelven a pendiente'
);
select throws_ok(
  format($$ select public.link_movement(%L, %L) $$, current_setting('test.internet'), current_setting('test.mov')),
  '23514', null,
  'un movimiento anulado no se enlaza'
);

-- Permisos y aislamiento.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.link_movement(%L, %L) $$, current_setting('test.internet'), current_setting('test.movbs')),
  '42501', null,
  'el cajero no enlaza pagos'
);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select throws_ok(
  format($$ select public.link_movement(%L, %L) $$, current_setting('test.internet'), current_setting('test.movbs')),
  'P0002', 'Cuota no encontrada',
  'otro negocio no enlaza en A'
);
select throws_ok(
  format($$ select * from public.obligation_link_candidates(%L, current_date - 15, current_date) $$, current_setting('test.internet')),
  'P0002', null,
  'ni ve sus candidatos'
);

select * from finish();
rollback;
