-- Plantillas de etiqueta: las edita quien edita el catálogo, una sola por defecto.

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

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- El cajero lee pero no crea plantillas.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ insert into public.label_templates (name, width_mm, height_mm) values ('Caja', 50, 25) $$, '42501', null,
                 'el cajero no crea plantillas');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ insert into public.label_templates (name, width_mm, height_mm) values ('Mini', 5, 25) $$, '23514', null,
                 'tamaño mínimo');
select throws_ok($$ insert into public.label_templates (name, width_mm, height_mm, code_kind) values ('X', 50, 25, 'rfid') $$, '23514', null,
                 'solo código de barras, QR o ninguno');
select lives_ok($$ insert into public.label_templates (name, width_mm, height_mm, is_default) values ('Rollo', 50, 25, true) $$,
                'el dueño crea una plantilla por defecto');
select lives_ok($$ insert into public.label_templates (name, media, width_mm, height_mm, columns, rows, code_kind, is_default)
                   values ('Hoja QR', 'sheet', 66.7, 25.4, 3, 10, 'qr', true) $$, 'otra por defecto');
select is((select array_agg(name order by name) from public.label_templates where is_default), array['Hoja QR'],
          'solo queda una por defecto');
select lives_ok($$ update public.label_templates set is_default = true where name = 'Rollo' $$, 'cambiar la predeterminada');
select is((select array_agg(name order by name) from public.label_templates where is_default), array['Rollo'], 'y desmarca la anterior');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.label_templates), 2, 'el cajero las ve para imprimir');
update public.label_templates set name = 'Cambiada';
select is((select count(*)::int from public.label_templates where name = 'Cambiada'), 0, 'el cajero no las edita');
delete from public.label_templates;
select is((select count(*)::int from public.label_templates), 2, 'ni las borra');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ delete from public.label_templates where name = 'Hoja QR' $$, 'el dueño borra');
select is((select count(*)::int from public.label_templates), 1, 'queda una');

select * from finish();
rollback;
