-- Importación de catálogo: altas, actualizaciones parciales, existencias como
-- conteo, idempotencia por archivo, todo o nada, permisos y aislamiento.

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
insert into public.locations (tenant_id, name, code) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'Almacén', 'AL');
insert into public.attribute_defs (tenant_id, key, label, type, multi) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'vehiculo', 'Vehículo compatible', 'list', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- Archivo 1: un producto con dos variantes y uno simple con código, campo propio y stock.
select results_eq(
  $$ select (r ->> 'products_created')::int, (r ->> 'variants_created')::int, (r ->> 'stock_rows_applied')::int
     from public.catalog_import('inventario.xlsx', repeat('a', 64), $j$[
       {"row_number": 2, "product_key": "franela", "sku": "FR-M",
        "product": {"name": "Franela básica", "category": "Ropa"},
        "variant": {"options": {"Talla": "M"}, "regular_price": 10}},
       {"row_number": 3, "product_key": "franela", "sku": "FR-L",
        "product": {"name": "Franela básica"},
        "variant": {"options": {"Talla": "L"}, "regular_price": 10}},
       {"row_number": 4, "product_key": "pastillas", "sku": "PF-001",
        "product": {"name": "Pastillas de freno", "brand": "Bosch"},
        "variant": {"regular_price": 30, "cost": 12},
        "codes": [{"kind": "oem", "code": "04465-0K290"}],
        "attributes": [{"key": "vehiculo", "value": "Hilux 2010"}, {"key": "vehiculo", "value": "Fortuner 2012"}],
        "stock": [{"location_code": "t1", "qty": 6}, {"location_code": "AL", "qty": 2.5}]}
     ]$j$::jsonb) r $$,
  $$ values (2, 3, 2) $$,
  'crea productos agrupando variantes por clave y deja existencias'
);
select results_eq(
  $$ select count(*)::int from public.variants v join public.products p on p.id = v.product_id where p.name = 'Franela básica' $$,
  $$ values (2) $$,
  'las dos tallas quedan bajo el mismo producto'
);
select results_eq(
  $$ select kind, qty_before, qty_after, unit_cost from public.inventory_movements order by qty_after $$,
  $$ values ('count'::text, 0::numeric, 2.5::numeric, 12::numeric), ('count'::text, 0::numeric, 6::numeric, 12::numeric) $$,
  'cada existencia importada queda como conteo en el kardex, con fracciones'
);
select results_eq(
  $$ select count(*)::int from public.product_attribute_values $$,
  $$ values (2) $$,
  'un campo de valores múltiples guarda todos'
);

-- Mismo archivo otra vez: no se aplica.
select is(
  (public.catalog_import('inventario.xlsx', repeat('a', 64), '[{"row_number": 2, "sku": "X", "product": {"name": "X"}}]'::jsonb) ->> 'already_applied')::boolean,
  true,
  'el mismo archivo no se aplica dos veces'
);
select results_eq($$ select count(*)::int from public.products $$, $$ values (2) $$, 'y no crea nada nuevo');

-- Archivo 2: actualización parcial por código; las celdas vacías conservan valores.
select results_eq(
  $$ select (r ->> 'variants_updated')::int, (r ->> 'stock_rows_applied')::int
     from public.catalog_import('precios.csv', repeat('b', 64), $j$[
       {"row_number": 2, "product": {}, "variant": {"price": 27},
        "codes": [{"kind": "oem", "code": "04465-0k290"}],
        "stock": [{"location_code": "T1", "qty": 6}]}
     ]$j$::jsonb) r $$,
  $$ values (1, 0) $$,
  'actualiza por código y no mueve stock si la cantidad no cambia'
);
select results_eq(
  $$ select regular_price, price, cost from public.variants where sku = 'PF-001' $$,
  $$ values (30::numeric, 27::numeric, 12::numeric) $$,
  'solo cambia lo que venía en el archivo'
);

-- Todo o nada: una fila mala detiene el archivo entero.
select throws_ok(
  $$ select public.catalog_import('malo.xlsx', repeat('c', 64), $j$[
       {"row_number": 2, "sku": "NUEVO-1", "product": {"name": "Nuevo"}, "variant": {"regular_price": 5}},
       {"row_number": 3, "sku": "NUEVO-2", "product": {"name": "Otro"}, "variant": {},
        "codes": [{"kind": "oem", "code": "04465-0K290"}]}
     ]$j$::jsonb) $$,
  '23505', null,
  'un código de otro producto detiene la importación'
);
select results_eq($$ select count(*)::int from public.variants where sku = 'NUEVO-1' $$, $$ values (0) $$, 'y no deja nada a medias');
select throws_ok(
  $$ select public.catalog_import('sede.xlsx', repeat('d', 64), $j$[
       {"row_number": 7, "sku": "PF-001", "stock": [{"location_code": "ZZ", "qty": 1}]}
     ]$j$::jsonb) $$,
  'P0002', 'Fila 7: la sede ZZ no existe',
  'el error dice la fila'
);
select throws_ok(
  $$ select public.catalog_import('campo.xlsx', repeat('e', 64), $j$[
       {"row_number": 2, "sku": "PF-001", "attributes": [{"key": "motor", "value": "2.7"}]}
     ]$j$::jsonb) $$,
  'P0002', null,
  'un campo propio que no existe detiene la importación'
);

-- Plantillas de mapeo
select lives_ok(
  $$ insert into public.import_templates (name, mapping) values ('Excel del proveedor', '{"Descripción": "name", "Ref": "sku"}') $$,
  'el owner guarda una plantilla de columnas'
);

-- Cajero
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.catalog_import('cajero.xlsx', repeat('f', 64), '[{"row_number": 2, "sku": "C", "product": {"name": "C"}}]'::jsonb) $$,
  '42501', null,
  'el cajero no importa'
);
select throws_ok(
  $$ insert into public.import_templates (name, mapping) values ('Del cajero', '{}') $$,
  '42501', null,
  'el cajero no guarda plantillas'
);

-- Otro tenant
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select is_empty($$ select 1 from public.import_jobs $$, 'B no ve las importaciones de A');
select is_empty($$ select 1 from public.import_templates $$, 'B no ve las plantillas de A');
select results_eq(
  $$ select (r ->> 'variants_created')::int from public.catalog_import('inventario.xlsx', repeat('a', 64),
       '[{"row_number": 2, "sku": "PF-001", "product": {"name": "Pastillas B"}}]'::jsonb) r $$,
  $$ values (1) $$,
  'la huella y el SKU son por tenant: B importa el mismo archivo y crea lo suyo'
);
select results_eq(
  $$ select count(*)::int from public.variants $$,
  $$ values (1) $$,
  'B solo ve su variante'
);

reset role;
select * from finish();
rollback;
