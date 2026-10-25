-- Etiquetas por unidad: activar por producto, generar consecutivas o seriales,
-- marcar impresas, desactivar con motivo; el cajero no genera.

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
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Teléfono'),
  ('aaaaaaaa-4444-4444-4444-444444444442', 'aaaaaaaa-1111-1111-1111-111111111111', 'Queso'),
  ('bbbbbbbb-4444-4444-4444-444444444441', 'bbbbbbbb-1111-1111-1111-111111111111', 'Otro');
insert into public.variants (id, tenant_id, product_id, sku, price, unit) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'tel 1', 100, 'unidad'),
  ('aaaaaaaa-5555-5555-5555-555555555552', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444442', 'QS', 5, 'Kg'),
  ('bbbbbbbb-5555-5555-5555-555555555551', 'bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-4444-4444-4444-444444444441', 'OT', 5, 'unidad');

select ok(app.unit_is_measured('Kg') and app.unit_is_measured('litros') and not app.unit_is_measured('unidad')
          and not app.unit_is_measured('caja'), 'peso y medida se reconocen');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- El cajero no activa ni genera.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_product_track_units('aaaaaaaa-4444-4444-4444-444444444441', true) $$, '42501', null,
                 'el cajero no activa la etiqueta por unidad');
select throws_ok($$ insert into public.item_labels (variant_id, code) values ('aaaaaaaa-5555-5555-5555-555555555551', 'X') $$, '42501', null,
                 'nadie inserta directo');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', 2) $$, '23514',
                 'Activa la etiqueta por unidad en este producto', 'hay que activarla primero');
select throws_ok($$ select public.set_product_track_units('aaaaaaaa-4444-4444-4444-444444444442', true) $$, '23514',
                 'Este producto se vende por peso o medida: no lleva etiqueta por unidad', 'lo que va por peso no');
select lives_ok($$ select public.set_product_track_units('aaaaaaaa-4444-4444-4444-444444444441', true) $$, 'se activa');
select throws_ok($$ select public.set_product_track_units('bbbbbbbb-4444-4444-4444-444444444441', true) $$, 'P0002', null,
                 'no toca productos de otro negocio');

-- Consecutivas.
select throws_ok($$ select public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', 501) $$, '23514',
                 'Entre 1 y 500 etiquetas por vez', 'máximo 500');
select is((public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', 3) ->> 'created')::int, 3, 'genera 3');
select is((public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', 2) ->> 'from')::int, 4, 'la siguiente tanda sigue la numeración');
select results_eq($$ select code from public.item_labels where unit_number is not null order by unit_number $$,
                  $$ values ('TEL-1-00001'), ('TEL-1-00002'), ('TEL-1-00003'), ('TEL-1-00004'), ('TEL-1-00005') $$,
                  'código = SKU limpio + número');

-- Seriales.
select throws_ok($$ select public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', null, array['SN1', 'sn1']) $$, '23514',
                 'Hay seriales repetidos en la lista', 'sin seriales repetidos');
select is((public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', null, array[' SN-100 ', '', 'SN-101']) ->> 'created')::int, 2,
          'seriales: ignora vacíos');
select throws_ok($$ select public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', null, array['sn-100']) $$, '23505',
                 'Ya existe una etiqueta con el serial sn-100', 'un serial no se repite');
select is((select is_serial and unit_number is null from public.item_labels where code = 'SN-100'), true, 'el serial no lleva número');

-- Impresas y desactivadas.
select is(public.mark_item_labels_printed(array(select id from public.item_labels where unit_number <= 2)), 2, 'marca impresas');
select throws_ok(format('select public.disable_item_labels(array[%L]::uuid[], %L)', (select id from public.item_labels where unit_number = 1), ' '),
                 '23514', 'Escribe el motivo', 'desactivar pide motivo');
select is(public.disable_item_labels(array(select id from public.item_labels where unit_number = 1), 'Pieza dañada'), 1, 'desactiva');
select is(public.mark_item_labels_printed(array(select id from public.item_labels where unit_number = 1)), 0, 'una desactivada no vuelve a impresa');

select results_eq($$ select active_labels, to_print, disabled_labels from public.item_label_overview() $$,
                  $$ values (6::bigint, 5::bigint, 1::bigint) $$, 'resumen por variante');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.generate_item_labels('aaaaaaaa-5555-5555-5555-555555555551', 1) $$, '42501', null, 'el cajero no genera');
select is((select count(*)::int from public.item_labels), 7, 'pero las ve (para escanear)');

select * from finish();
rollback;
