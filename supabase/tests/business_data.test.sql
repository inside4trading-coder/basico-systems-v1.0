-- Datos del negocio para la nota de entrega: solo dueño o administrador los cambian.

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
insert into public.locations (id, tenant_id, name, code) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

update public.tenants set legal_name = 'Tienda A, C.A.', tax_id = 'J-12345678-9', address = 'Av. Principal', phone = '0251-1234567',
  receipt_footer = 'Gracias por su compra' where id = 'aaaaaaaa-1111-1111-1111-111111111111';
select results_eq(
  $$ select legal_name, tax_id, receipt_footer from public.tenants $$,
  $$ values ('Tienda A, C.A.'::text, 'J-12345678-9'::text, 'Gracias por su compra'::text) $$,
  'el dueño carga los datos de la nota'
);
update public.locations set address = 'Calle 2, Cabudare', phone = '0251-7654321' where id = 'aaaaaaaa-2222-2222-2222-222222222221';
select is((select address from public.locations), 'Calle 2, Cabudare', 'y la dirección de la sede');
update public.tenants set closing_reminder_time = '17:30' where id = 'aaaaaaaa-1111-1111-1111-111111111111';
select is((select closing_reminder_time from public.tenants), '17:30'::time, 'y la hora del recordatorio de cierre');
select throws_ok(
  $$ update public.tenants set tax_id = 'x' where id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  '23514', null,
  'un RIF demasiado corto se rechaza'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
update public.tenants set legal_name = 'Otro' where id = 'aaaaaaaa-1111-1111-1111-111111111111';
select is((select legal_name from public.tenants), 'Tienda A, C.A.', 'el cajero no los cambia');
update public.tenants set closing_reminder_time = null where id = 'aaaaaaaa-1111-1111-1111-111111111111';
select is((select closing_reminder_time from public.tenants), '17:30'::time, 'ni apaga el recordatorio');
select is((select tax_id from public.tenants), 'J-12345678-9', 'pero los lee para imprimir');

select * from finish();
rollback;
