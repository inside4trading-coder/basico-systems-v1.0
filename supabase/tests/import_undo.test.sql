-- Deshacer una importación: borra lo que creó, conserva lo que ya se usó,
-- no toca productos que ya existían, permite volver a subir el archivo,
-- permisos y aislamiento.

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
insert into public.locations (tenant_id, name, code) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1');

-- Un producto que ya existía antes de importar.
insert into public.products (id, tenant_id, name, created_at) values
  ('aaaaaaaa-6666-6666-6666-666666666660', 'aaaaaaaa-1111-1111-1111-111111111111', 'Producto viejo', now() - interval '2 days');
insert into public.variants (tenant_id, product_id, sku, regular_price, price, created_at) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-6666-6666-6666-666666666660', 'VIEJO-1', 5, 5, now() - interval '2 days');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select results_eq(
  $$ select (r ->> 'products_created')::int, (r ->> 'variants_updated')::int
     from public.catalog_import('inventario.xlsx', repeat('c', 64), $j$[
       {"row_number": 2, "sku": "P-00001", "product": {"name": "Bomba de agua"}, "variant": {"regular_price": 30},
        "stock": [{"location_code": "T1", "qty": 4}]},
       {"row_number": 3, "sku": "P-00002", "product": {"name": "Correa"}, "variant": {"regular_price": 12},
        "stock": [{"location_code": "T1", "qty": 2}]},
       {"row_number": 4, "sku": "P-00003", "product": {"name": "Fusible"}, "variant": {"regular_price": 1}},
       {"row_number": 5, "sku": "VIEJO-1", "variant": {"regular_price": 7}}
     ]$j$::jsonb) r $$,
  $$ values (3, 1) $$,
  'la importación crea 3 y actualiza el producto viejo'
);
select set_config('test.job', (select id::text from public.import_jobs where file_name = 'inventario.xlsx'), true);

-- En la prueba todo corre en una transacción: se lleva la importación al pasado
-- (como si hubiera sido antes) y luego se ajusta la correa.
reset role;
update public.import_jobs set created_at = created_at - interval '1 hour' where id = current_setting('test.job')::uuid;
update public.products set created_at = created_at - interval '1 hour' where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111' and name in ('Bomba de agua', 'Correa', 'Fusible');
update public.inventory_movements set created_at = created_at - interval '1 hour' where tenant_id = 'aaaaaaaa-1111-1111-1111-111111111111';
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, created_at)
select v.tenant_id, v.id, l.id, 'adjustment', 2, -1, 1, now() + interval '1 minute'
from public.variants v, public.locations l
where v.sku = 'P-00002' and l.code = 'T1' and l.tenant_id = v.tenant_id;
set local role authenticated;

-- Otra importación (la recarga del mismo inventario) cuenta de nuevo la bomba:
-- ese conteo no es «uso» y no debe impedir deshacer la primera.
select results_eq(
  $$ select (r ->> 'variants_updated')::int, (r ->> 'stock_rows_applied')::int
     from public.catalog_import('inventario-2.xlsx', repeat('d', 64),
       '[{"row_number": 2, "sku": "P-00001", "stock": [{"location_code": "T1", "qty": 5}]}]'::jsonb) r $$,
  $$ values (1, 1) $$,
  'una segunda importación vuelve a contar la bomba'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.undo_catalog_import(current_setting('test.job')::uuid) $$,
  '42501', null, 'sin permiso de catálogo no se puede deshacer'
);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select throws_ok(
  $$ select public.undo_catalog_import(current_setting('test.job')::uuid) $$,
  'P0002', null, 'otro negocio no puede deshacerla'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

select results_eq(
  $$ select (r ->> 'removed')::int, (r ->> 'kept')::int, r -> 'kept_names'
     from public.undo_catalog_import(current_setting('test.job')::uuid) r $$,
  $$ values (2, 1, '["Correa"]'::jsonb) $$,
  'borra lo creado (aunque otra importación lo haya contado) y conserva lo que ya se ajustó'
);
select results_eq(
  $$ select p.name, v.regular_price from public.products p join public.variants v on v.product_id = p.id order by p.name $$,
  $$ values ('Correa'::text, 12::numeric), ('Producto viejo', 7) $$,
  'quedan la correa y el producto viejo con su cambio'
);
select is(
  (select count(*)::int from public.stocks s join public.variants v on v.id = s.variant_id where v.sku = 'P-00001'),
  0, 'las existencias de lo borrado se van con él'
);
select ok(
  (select undone_at is not null and undo_result ->> 'removed' = '2' and file_hash <> repeat('c', 64)
   from public.import_jobs where id = current_setting('test.job')::uuid),
  'la importación queda marcada como deshecha'
);
select throws_ok(
  $$ select public.undo_catalog_import(current_setting('test.job')::uuid) $$,
  '23514', 'Esta importación ya se deshizo', 'no se deshace dos veces'
);
select results_eq(
  $$ select (r ->> 'already_applied')::boolean, (r ->> 'products_created')::int
     from public.catalog_import('inventario.xlsx', repeat('c', 64),
       '[{"row_number": 2, "sku": "P-00001", "product": {"name": "Bomba de agua"}}]'::jsonb) r $$,
  $$ values (false, 1) $$,
  'el mismo archivo se puede volver a importar'
);

reset role;
select * from finish();
rollback;
