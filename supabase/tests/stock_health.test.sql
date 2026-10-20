-- Salud de inventario: ABC por venta y cada segmento con datos fijos.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_entitlements (tenant_id, key, value) values ('aaaaaaaa-1111-1111-1111-111111111111', 'max_locations', '5');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero');
insert into public.locations (id, tenant_id, name, code, type) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1', 'store'),
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'Almacén', 'A1', 'warehouse');

-- Todo en Tienda, periodo 30 días, cubrir 15.
-- p1 Aceite  precio 10: 0 disponible, vendió 90 (3/día), quedó en cero hace 5 días → quiebre, pierde 3×10×5 = 150.
-- p2 Filtro  precio 20: 10 disponible, vendió 60 (2/día), cubre 5 días → por romper; faltan 20 → 400 en riesgo.
-- p3 Bujía   precio 5:  50 disponible, vendió 30 → cubre 50 días; sin segmento.
-- p4 Correa  precio 10, costo 6: 200 disponible, vendió 15 → cubre 400 días → sobrestock, 1200 a costo.
-- p5 Faro    precio 50, costo 30: 4 en existencia, sin ventas, llegó hace 100 días → sin rotación, 120.
-- p6 Tapa    precio 1:  1 disponible, vendió 3 → cubre 10 días; sin segmento.
-- p7 Bombillo precio 2: 50 disponible, vendió 150 (5/día) → cubre 10 días, cuartil más alto → alta rotación.
-- p8 Manguera precio 8: 2 disponible, mínimo 3, llegó hace 5 días, sin ventas → por romper por mínimo.
-- Venta: p2 1200, p1 900, p7 300, p3 150, p4 150, p6 3 (total 2703) → A: p2, p1, p7; B: p3, p4; C: p6 y lo que no vendió.
insert into public.products (id, tenant_id, name)
select ('aaaaaaaa-4444-4444-4444-44444444444' || i)::uuid, 'aaaaaaaa-1111-1111-1111-111111111111',
       (array['Aceite', 'Filtro', 'Bujía', 'Correa', 'Faro', 'Tapa', 'Bombillo', 'Manguera'])[i]
from generate_series(1, 8) i;
insert into public.variants (id, tenant_id, product_id, sku, price, cost)
select ('aaaaaaaa-5555-5555-5555-55555555555' || i)::uuid, 'aaaaaaaa-1111-1111-1111-111111111111',
       ('aaaaaaaa-4444-4444-4444-44444444444' || i)::uuid, 'S' || i,
       (array[10, 20, 5, 10, 50, 1, 2, 8])[i], (array[null, null, null, 6, 30, null, null, null])[i]
from generate_series(1, 8) i;
insert into public.stocks (tenant_id, variant_id, location_id, on_hand, min_qty)
select 'aaaaaaaa-1111-1111-1111-111111111111', ('aaaaaaaa-5555-5555-5555-55555555555' || i)::uuid,
       'aaaaaaaa-2222-2222-2222-222222222221', (array[0, 10, 50, 200, 4, 1, 50, 2])[i], (array[null, null, null, null, null, null, null, 3])[i]
from generate_series(1, 8) i;
-- Algo en Almacén para probar el filtro por sede.
insert into public.stocks (tenant_id, variant_id, location_id, on_hand)
values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555554', 'aaaaaaaa-2222-2222-2222-222222222222', 500);

-- p1: 25 ventas de 3,6 entre hace 29 y hace 5 días; la última lo deja en cero.
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, unit_price, created_at)
select 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 'sale',
       case when d = 5 then 3.6 else 13.6 end, -3.6, case when d = 5 then 0 else 10 end, 10, now() - make_interval(days => d)
from generate_series(5, 29) d;
-- p2, p3, p4, p6, p7: ventas diarias en los últimos 30 días.
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, unit_price, created_at)
select 'aaaaaaaa-1111-1111-1111-111111111111', x.variant_id, 'aaaaaaaa-2222-2222-2222-222222222221', 'sale',
       1000, -x.per_day, 1000 - x.per_day, x.price, now() - make_interval(days => d) + interval '1 hour'
from (values ('aaaaaaaa-5555-5555-5555-555555555552'::uuid, 2.0, 20),
             ('aaaaaaaa-5555-5555-5555-555555555553'::uuid, 1.0, 5),
             ('aaaaaaaa-5555-5555-5555-555555555554'::uuid, 0.5, 10),
             ('aaaaaaaa-5555-5555-5555-555555555556'::uuid, 0.1, 1),
             ('aaaaaaaa-5555-5555-5555-555555555557'::uuid, 5.0, 2)) x(variant_id, per_day, price)
cross join generate_series(1, 30) d;
-- p5 llegó hace 100 días; p8 hace 5.
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, created_at) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555555', 'aaaaaaaa-2222-2222-2222-222222222221', 'entry', 0, 4, 4, now() - interval '100 days'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555558', 'aaaaaaaa-2222-2222-2222-222222222221', 'entry', 0, 2, 2, now() - interval '5 days');
-- Una venta vieja no cuenta.
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, unit_price, created_at)
values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555555', 'aaaaaaaa-2222-2222-2222-222222222221', 'sale', 5, -1, 4, 50, now() - interval '90 days');

set local role authenticated;
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

create temp table r on commit drop as
select public.report_stock_health('aaaaaaaa-2222-2222-2222-222222222221', 30, 15) as j;

create temp view seg as
select key as segment, (value ->> 'count')::int as cnt, (value ->> 'amount')::numeric as amount
from r, jsonb_each(r.j -> 'summary');

create temp view rw as
select x ->> 'sku' as sku, x ->> 'abc_class' as abc, x ->> 'segment' as segment,
       array(select jsonb_array_elements_text(x -> 'segments')) as segments,
       (x ->> 'daily')::numeric as daily, (x ->> 'cover')::numeric as cover, (x ->> 'suggested')::numeric as suggested,
       (x ->> 'lost_sales')::numeric as lost_sales, (x ->> 'days_at_zero')::numeric as days_at_zero
from r, jsonb_array_elements(r.j -> 'rows') x;

-- Resumen por segmento.
select results_eq(
  $$ select segment, cnt, amount from seg order by segment $$,
  $$ values ('alta_rotacion_poco_stock', 2, 500.00), ('clase_a_en_riesgo', 2, 550.00), ('por_romper', 2, 400.00),
            ('quiebre', 1, 150.00), ('sin_rotacion', 1, 120.00), ('sobrestock', 1, 1200.00) $$,
  'cada segmento con su cantidad y monto'
);

-- ABC por venta.
select results_eq(
  $$ select sku, abc from rw where sku in ('S1', 'S2', 'S4', 'S5', 'S7') order by sku $$,
  $$ values ('S1', 'A'), ('S2', 'A'), ('S4', 'B'), ('S5', 'C'), ('S7', 'A') $$,
  'clase A hasta el 80 % de la venta, B hasta el 95 %, C el resto'
);

-- Filas por segmento.
select results_eq(
  $$ select segments from rw where sku = 'S1' $$,
  $$ values (array['quiebre', 'alta_rotacion_poco_stock', 'clase_a_en_riesgo']) $$,
  'Aceite: quiebre, alta rotación y clase A en riesgo'
);
select results_eq(
  $$ select daily, days_at_zero, lost_sales, suggested from rw where sku = 'S1' $$,
  $$ values (3.000, 5.0, 150.00, 45::numeric) $$,
  'quiebre: venta diaria, días en cero, venta perdida y sugerido'
);
select results_eq(
  $$ select segments, cover, suggested from rw where sku = 'S2' $$,
  $$ values (array['por_romper', 'clase_a_en_riesgo'], 5.0, 20::numeric) $$,
  'Filtro: por romper (cubre 5 días) y clase A en riesgo'
);
select results_eq($$ select segments from rw where sku = 'S7' $$, $$ values (array['alta_rotacion_poco_stock']) $$, 'Bombillo: alta rotación con poco stock');
select results_eq($$ select segments from rw where sku = 'S4' $$, $$ values (array['sobrestock']) $$, 'Correa: sobrestock');
select results_eq($$ select segments from rw where sku = 'S5' $$, $$ values (array['sin_rotacion']) $$, 'Faro: sin rotación');
select results_eq($$ select segments from rw where sku = 'S8' $$, $$ values (array['por_romper']) $$, 'Manguera: por romper por su mínimo');
select is_empty($$ select 1 from rw where sku in ('S3', 'S6') $$, 'lo sano no aparece');
select is((select (j -> 'rows' -> 0 ->> 'sku') from r), 'S1', 'la primera fila es el quiebre');

-- Sin sede: suma Almacén (Correa con 500 sin movimientos: sin rotación).
select is(
  (select count(*)::int from jsonb_array_elements(public.report_stock_health(null, 30, 15) -> 'rows') x
    where x ->> 'location_id' = 'aaaaaaaa-2222-2222-2222-222222222222'),
  1,
  'sin sede incluye las demás sedes'
);

select throws_ok($$ select public.report_stock_health(null, 3, 15) $$, '23514', 'Días de venta inválidos (7 a 365)', 'periodo inválido');
select throws_ok($$ select public.report_stock_health(null, 30, 0) $$, '23514', 'Días a cubrir inválidos (1 a 180)', 'cobertura inválida');

-- Solo dueño, administrador o encargado.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.report_stock_health() $$, '42501', null, 'el cajero no ve el reporte');

select * from finish();
rollback;
