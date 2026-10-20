-- Búsqueda sin tildes: catálogo y clientes.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner');
insert into public.products (id, tenant_id, name, brand) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Bujía de iridio', 'NGK');
insert into public.variants (id, tenant_id, product_id, sku, price) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'B1', 10);
insert into public.customers (tenant_id, name, doc) values ('aaaaaaaa-1111-1111-1111-111111111111', 'José Peña', 'V-1234');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.catalog_lookup('bujia iridio')), 1, 'el catálogo encuentra "Bujía" escribiendo "bujia"');
select is((select count(*)::int from public.catalog_lookup('BUJÍA')), 1, 'y con mayúsculas y tilde');
select is(jsonb_array_length(public.customers_overview('jose pena')), 1, 'clientes: "jose pena" encuentra "José Peña"');

select * from finish();
rollback;
