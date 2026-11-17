-- [B]eto conoce el sistema: contexto de arranque y lecturas nuevas, con sus guardas.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'cajero-b@test.local', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'owner-c@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'Tienda B', 'tienda-b'),
  ('cccccccc-1111-1111-1111-111111111111', 'Tienda C', 'tienda-c');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000002', 'cajero'),
  ('cccccccc-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001', 'owner');
insert into public.tenant_entitlements (tenant_id, key, value) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'beto', 'true'),
  ('cccccccc-1111-1111-1111-111111111111', 'beto', 'true');
insert into public.locations (id, tenant_id, name, code, type) values
  ('bbbbbbbb-2222-2222-2222-222222222221', 'bbbbbbbb-1111-1111-1111-111111111111', 'Tienda', 'T1', 'store');
insert into public.products (id, tenant_id, name) values
  ('bbbbbbbb-4444-4444-4444-444444444441', 'bbbbbbbb-1111-1111-1111-111111111111', 'Rodamiento X'),
  ('cccccccc-4444-4444-4444-444444444441', 'cccccccc-1111-1111-1111-111111111111', 'Rodamiento X');
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('bbbbbbbb-5555-5555-5555-555555555551', 'bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-4444-4444-4444-444444444441', 'RX-1', 40, 25),
  ('cccccccc-5555-5555-5555-555555555551', 'cccccccc-1111-1111-1111-111111111111', 'cccccccc-4444-4444-4444-444444444441', 'RX-1', 99, 50);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-5555-5555-5555-555555555551', 'bbbbbbbb-2222-2222-2222-222222222221', 7);
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, unit_cost, supplier) values
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-5555-5555-5555-555555555551', 'bbbbbbbb-2222-2222-2222-222222222221', 'entry', 0, 7, 7, 25, 'Proveedor X');
insert into public.suppliers (id, tenant_id, name) values
  ('bbbbbbbb-7777-7777-7777-777777777771', 'bbbbbbbb-1111-1111-1111-111111111111', 'Proveedor X'),
  ('bbbbbbbb-7777-7777-7777-777777777772', 'bbbbbbbb-1111-1111-1111-111111111111', 'Proveedor Y');
with p as (
  insert into public.payables (tenant_id, supplier_id, issued_on, currency, amount, document)
  values ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-7777-7777-7777-777777777771', current_date - 20, 'USD', 300, 'F-1'),
         ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-7777-7777-7777-777777777772', current_date - 5, 'USD', 500, 'F-2')
  returning id, amount
)
insert into public.payable_installments (tenant_id, payable_id, number, due_date, amount)
select 'bbbbbbbb-1111-1111-1111-111111111111', p.id, 1,
       case when p.amount = 300 then (now() at time zone 'America/Caracas')::date - 3 else (now() at time zone 'America/Caracas')::date + 10 end,
       p.amount
from p;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"bbbbbbbb-1111-1111-1111-111111111111"}', true);

-- ---------------------------------------------------------------------------
-- Contexto de arranque en beto_start
-- ---------------------------------------------------------------------------

-- beto_start deja una respuesta pendiente: se llama una vez y se guarda.
create temp table ctx_owner as select public.beto_start(null, '¿Por dónde empiezo?') as c;
select is((select (c -> 'setup' ->> 'products')::int from ctx_owner), 1, 'el contexto cuenta los productos');
select is((public.beto_setup_status() ->> 'finance_accounts')::int, 0, 'sabe que falta crear una cuenta');
select ok((select (c -> 'capabilities') ? 'finanzas.operar' from ctx_owner), 'el dueño tiene finanzas.operar en su contexto');
select ok((select (c -> 'modules') ? 'inventario' from ctx_owner), 'el contexto lista los módulos del plan');
select is((select (c -> 'can' ->> 'inventario')::boolean from ctx_owner), true, 'can trae inventario');

-- ---------------------------------------------------------------------------
-- Lecturas nuevas como dueño
-- ---------------------------------------------------------------------------

select is(jsonb_array_length(public.beto_find_product('rodamiento') -> 'products'), 1, 'busca el producto solo en su negocio');
select is((public.beto_find_product('RX-1') -> 'products' -> 0 ->> 'pvp')::numeric, 46.40, 'PVP = 40 + 16 % de IVA');
select is((public.beto_find_product('RX-1') -> 'products' -> 0 ->> 'cost')::numeric, 25.00, 'el dueño ve el costo');
select is((public.beto_find_product('RX-1') -> 'products' -> 0 ->> 'stock_total')::numeric, 7.000, 'trae la existencia');
select throws_ok($$ select public.beto_find_product('  ') $$, '23514', 'Escribe qué producto buscar', 'búsqueda vacía');

select is(jsonb_array_length(public.beto_recent_entries(7, null) -> 'entries'), 1, 'lista la entrada reciente');
select is(public.beto_recent_entries(7, null) -> 'by_supplier' -> 0 ->> 'supplier', 'Proveedor X', 'agrupa por proveedor');

select is(jsonb_array_length(public.beto_payables_detail(false) -> 'by_supplier'), 2, 'deuda por proveedor');
select is((public.beto_payables_detail(false) -> 'by_supplier' -> 0 ->> 'balance')::numeric, 500.00, 'ordena por saldo');
select is(jsonb_array_length(public.beto_payables_detail(true) -> 'by_supplier'), 1, 'solo vencidas: un proveedor');
select is(public.beto_payables_detail(false) -> 'installments' -> 0 ->> 'document', 'F-1', 'primero lo que vence antes');
select is(jsonb_array_length(public.beto_receivables_detail(false) -> 'by_debtor'), 0, 'sin cuentas por cobrar');
select is(jsonb_array_length(public.beto_returns(current_date - 30, current_date) -> 'returns'), 0, 'devoluciones del rango');

select throws_ok($$ select public.beto_clock_summary(current_date - 7, current_date) $$, '42501', null, 'sin el módulo de fichaje no responde');

-- ---------------------------------------------------------------------------
-- Cajero: sin costos, sin finanzas
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.beto_find_product('RX-1') -> 'products' -> 0 -> 'cost', 'null'::jsonb, 'el cajero no ve el costo');
select is(public.beto_recent_entries(7, null) -> 'entries' -> 0 -> 'unit_cost', 'null'::jsonb, 'ni el costo de las entradas');
select throws_ok($$ select public.beto_payables_detail(false) $$, '42501', null, 'el cajero no ve cuentas por pagar');
select throws_ok($$ select public.beto_receivables_detail(false) $$, '42501', null, 'ni por cobrar');
select throws_ok($$ select public.beto_returns(current_date - 7, current_date) $$, '42501', null, 'ni devoluciones');
reset role;
insert into public.role_capabilities (tenant_id, role, capability, allowed)
values ('bbbbbbbb-1111-1111-1111-111111111111', 'cajero', 'beto.usar', true);
set local role authenticated;
create temp table ctx_cajero as select public.beto_start(null, 'Hola') as c;
select is((select (c -> 'can' ->> 'finanzas')::boolean from ctx_cajero), false, 'su contexto no tiene finanzas');
select ok((select not ((c -> 'capabilities') ? 'finanzas.operar') from ctx_cajero), 'ni la capacidad');

-- ---------------------------------------------------------------------------
-- Aislamiento: el dueño de C no ve lo de B
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"cccccccc-1111-1111-1111-111111111111"}', true);
select is((public.beto_find_product('RX-1') -> 'products' -> 0 ->> 'price')::numeric, 99.00, 'C ve solo su producto');
select is(jsonb_array_length(public.beto_recent_entries(7, null) -> 'entries'), 0, 'C no ve las entradas de B');
select is(jsonb_array_length(public.beto_payables_detail(false) -> 'by_supplier'), 0, 'C no ve las deudas de B');

select * from finish();
rollback;
