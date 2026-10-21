-- Estudio de IA: add-on, cuota mensual, permisos y cierre solo por la plataforma.

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
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Filtro'),
  ('bbbbbbbb-4444-4444-4444-444444444441', 'bbbbbbbb-1111-1111-1111-111111111111', 'Bujía');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.studio_start('aaaaaaaa-4444-4444-4444-444444444441', 'catalogo', null, 'aaaaaaaa-1111-1111-1111-111111111111/p/a.webp') $$,
  '42501', 'Estudio de IA no está incluido en el plan de este negocio', 'sin el add-on no se genera'
);

reset role;
insert into public.tenant_entitlements (tenant_id, key, value) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'estudio', 'true'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'estudio_images_per_month', '2');
set local role authenticated;

select is(public.studio_usage(), '{"used": 0, "limit": 2}'::jsonb, 'el plan trae 2 fotos al mes');
select throws_ok(
  $$ select public.studio_start('aaaaaaaa-4444-4444-4444-444444444441', 'ambientado', ' ', 'aaaaaaaa-1111-1111-1111-111111111111/p/a.webp') $$,
  '23514', 'Describe el ambiente de la foto', 'el ambientado pide describir el ambiente'
);
select throws_ok(
  $$ select public.studio_start('aaaaaaaa-4444-4444-4444-444444444441', 'catalogo', null, 'bbbbbbbb-1111-1111-1111-111111111111/p/a.webp') $$,
  '23514', 'Foto de origen no válida', 'la foto de origen tiene que ser de la carpeta del negocio'
);
select throws_ok(
  $$ select public.studio_start('bbbbbbbb-4444-4444-4444-444444444441', 'catalogo', null, 'aaaaaaaa-1111-1111-1111-111111111111/p/a.webp') $$,
  'P0002', 'Producto no encontrado', 'no se genera para un producto de otro negocio'
);
select set_config('test.job1', public.studio_start('aaaaaaaa-4444-4444-4444-444444444441', 'catalogo', null, 'aaaaaaaa-1111-1111-1111-111111111111/p/a.webp')::text, true);
select set_config('test.job2', public.studio_start('aaaaaaaa-4444-4444-4444-444444444441', 'ambientado', 'Mesa de madera', 'aaaaaaaa-1111-1111-1111-111111111111/p/a.webp')::text, true);
select throws_ok(
  $$ select public.studio_start('aaaaaaaa-4444-4444-4444-444444444441', 'catalogo', null, 'aaaaaaaa-1111-1111-1111-111111111111/p/a.webp') $$,
  '23514', 'Ya usaste las 2 fotos del Estudio de este mes', 'al llegar a la cuota no se genera más'
);
select throws_ok(
  format($$ select public.studio_finish(%L, true, 'x.png', 'm', 0.04, null) $$, current_setting('test.job1')),
  '42501', null, 'la app no marca un trabajo como listo'
);

-- La plataforma (edge function con service_role) cierra los trabajos.
reset role;
set local role service_role;
select lives_ok(format($$ select public.studio_finish(%L, true, 'aaaaaaaa-1111-1111-1111-111111111111/p/r.png', 'google/gemini-2.5-flash-image', 0.039, null) $$, current_setting('test.job1')), 'la plataforma cierra el trabajo listo');
select lives_ok(format($$ select public.studio_finish(%L, false, null, 'google/gemini-2.5-flash-image', null, 'OpenRouter respondió 500') $$, current_setting('test.job2')), 'y el fallido');

reset role;
set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.studio_usage() ->> 'used', '1', 'los fallidos no gastan la cuota');
select results_eq(
  $$ select status, cost_usd from public.studio_jobs order by status desc $$,
  $$ values ('listo'::text, 0.03900::numeric), ('fallido'::text, null::numeric) $$,
  'el dueño ve sus trabajos con el costo'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.studio_jobs), 0, 'el cajero no ve los trabajos');
select throws_ok(
  $$ select public.studio_start('aaaaaaaa-4444-4444-4444-444444444441', 'catalogo', null, 'aaaaaaaa-1111-1111-1111-111111111111/p/a.webp') $$,
  '42501', null, 'ni genera'
);

select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.studio_jobs), 0, 'otro negocio no ve los trabajos de A');

select * from finish();
rollback;
