-- Fotos de productos: cada negocio sube solo a su carpeta y solo quien edita el catálogo.

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
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro');

select is((select public from storage.buckets where id = 'product-images'), true, 'las fotos se sirven sin firmar enlaces');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values
       ('product-images', 'aaaaaaaa-1111-1111-1111-111111111111/aaaaaaaa-4444-4444-4444-444444444441/a.webp', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'el dueño sube la foto a la carpeta de su negocio'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values
       ('product-images', 'bbbbbbbb-1111-1111-1111-111111111111/x/a.webp', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null,
  'no puede subir a la carpeta de otro negocio'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('product-images', 'sin-negocio/a.webp', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null,
  'ni fuera de una carpeta de negocio'
);
select lives_ok(
  $$ update public.products set image_url = 'https://x.supabase.co/storage/v1/object/public/product-images/a.webp'
     where id = 'aaaaaaaa-4444-4444-4444-444444444441' $$,
  'la ficha guarda el enlace'
);
select throws_ok(
  $$ update public.products set image_url = 'javascript:alert(1)' where id = 'aaaaaaaa-4444-4444-4444-444444444441' $$,
  '23514', null,
  'la foto solo es un enlace http(s)'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values
       ('product-images', 'aaaaaaaa-1111-1111-1111-111111111111/aaaaaaaa-4444-4444-4444-444444444441/b.webp', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  '42501', null,
  'el cajero no sube fotos'
);

select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'product-images'), 0,
  'otro negocio no ve los archivos de A'
);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'product-images'), 1,
  'el dueño ve su foto para reemplazarla o borrarla (el borrado pasa por la API de Storage con la misma regla)'
);

select * from finish();
rollback;
