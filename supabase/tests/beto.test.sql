-- Beto: add-on, permiso, cuota, chat personal y herramientas de lectura nuevas.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'admin-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'admin');
insert into public.locations (id, tenant_id, name, code, type) values
  ('aaaaaaaa-2222-2222-2222-222222222221', 'aaaaaaaa-1111-1111-1111-111111111111', 'Tienda', 'T1', 'store');
insert into public.products (id, tenant_id, name) values
  ('aaaaaaaa-4444-4444-4444-444444444441', 'aaaaaaaa-1111-1111-1111-111111111111', 'Producto X');
insert into public.variants (id, tenant_id, product_id, sku, price, cost) values
  ('aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-4444-4444-4444-444444444441', 'X1', 20, 10);
insert into public.stocks (tenant_id, variant_id, location_id, on_hand, min_qty, target_qty) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 2, 5, 12);
insert into public.inventory_movements (tenant_id, variant_id, location_id, kind, qty_before, qty_delta, qty_after, unit_cost, supplier) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-5555-5555-5555-555555555551', 'aaaaaaaa-2222-2222-2222-222222222221', 'entry', 0, 2, 2, 10, 'Proveedor X');
insert into public.suppliers (id, tenant_id, name) values
  ('aaaaaaaa-7777-7777-7777-777777777771', 'aaaaaaaa-1111-1111-1111-111111111111', 'Proveedor X');
with p as (
  insert into public.payables (tenant_id, supplier_id, issued_on, currency, amount)
  values ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-7777-7777-7777-777777777771', current_date - 10, 'USD', 40)
  returning id
)
insert into public.payable_installments (tenant_id, payable_id, number, due_date, amount)
select 'aaaaaaaa-1111-1111-1111-111111111111', p.id, n, d, 20
from p, (values (1, (now() at time zone 'America/Caracas')::date - 2), (2, (now() at time zone 'America/Caracas')::date + 9)) as x(n, d);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

-- ---------------------------------------------------------------------------
-- Add-on, permiso y cuota
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.beto_start(null, '¿Cómo van mis ventas hoy?') $$,
  '42501', '[B]eto no está incluido en el plan de este negocio', 'sin el add-on no responde'
);
select is((public.beto_usage() ->> 'enabled')::boolean, false, 'el uso dice que el add-on está apagado');

reset role;
insert into public.tenant_entitlements (tenant_id, key, value) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'beto', 'true'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'beto_messages_per_month', '2');
set local role authenticated;

select throws_ok($$ select public.beto_start(null, '   ') $$, '23514', 'Escribe tu pregunta', 'la pregunta no puede ir vacía');
select throws_ok($$ select public.beto_start(null, repeat('a', 2001)) $$, '23514', null, 'la pregunta tiene un máximo');

select set_config('test.r1', public.beto_start(null, '¿Cómo van mis ventas hoy?')::text, true);
select results_eq(
  $$ select (current_setting('test.r1')::jsonb ->> 'base_currency'), (current_setting('test.r1')::jsonb -> 'can' ->> 'finanzas')::boolean,
            jsonb_array_length(current_setting('test.r1')::jsonb -> 'history') $$,
  $$ values ('USD'::text, true, 0) $$,
  'abre la conversación con el contexto del negocio y sin historial'
);
select results_eq(
  format($$ select title, (select count(*)::int from public.beto_messages m where m.conversation_id = c.id)
            from public.beto_conversations c where c.id = %L $$, current_setting('test.r1')::jsonb ->> 'conversation_id'),
  $$ values ('¿Cómo van mis ventas hoy?'::text, 2) $$,
  'guarda la pregunta y deja la respuesta pendiente'
);
select throws_ok(
  format($$ select public.beto_start(%L, 'Otra') $$, current_setting('test.r1')::jsonb ->> 'conversation_id'),
  '23514', '[B]eto todavía está respondiendo tu pregunta anterior', 'una pregunta a la vez'
);
select throws_ok(
  format($$ select public.beto_finish(%L, true, 'Hola', null, null, 'm', 1, 1, 0, null) $$, current_setting('test.r1')::jsonb ->> 'message_id'),
  '42501', null, 'quien pregunta no puede escribir la respuesta'
);

set local role service_role;
select public.beto_finish((current_setting('test.r1')::jsonb ->> 'message_id')::uuid, true, 'Vendiste 10 USD.',
  '[{"type":"kpi","label":"Ventas","value":"10 USD"}]'::jsonb, array['ventas'], 'modelo-x', 100, 20, 0.0004, null);
set local role authenticated;

select results_eq(
  format($$ select status, content, tools, blocks -> 0 ->> 'type' from public.beto_messages where id = %L $$, current_setting('test.r1')::jsonb ->> 'message_id'),
  $$ values ('listo'::text, 'Vendiste 10 USD.'::text, array['ventas']::text[], 'kpi'::text) $$,
  'la edge function guarda la respuesta, las herramientas y los bloques'
);

select set_config('test.r2', public.beto_start((current_setting('test.r1')::jsonb ->> 'conversation_id')::uuid, '¿Y ayer?')::text, true);
select is(jsonb_array_length(current_setting('test.r2')::jsonb -> 'history'), 2, 'la segunda pregunta lleva el historial');
set local role service_role;
select public.beto_finish((current_setting('test.r2')::jsonb ->> 'message_id')::uuid, false, '', null, null, 'modelo-x', null, null, null, 'OpenRouter 500');
set local role authenticated;
select is((public.beto_usage() ->> 'used')::int, 1, 'las fallidas no gastan cuota');
select is(
  (select count(*)::int from public.beto_messages where status = 'fallido'), 2,
  'la pregunta sin respuesta queda fallida y no vuelve al historial'
);

select set_config('test.r3', public.beto_start((current_setting('test.r1')::jsonb ->> 'conversation_id')::uuid, '¿Y ayer?')::text, true);
select is(jsonb_array_length(current_setting('test.r3')::jsonb -> 'history'), 2, 'el reintento no repite la pregunta fallida');
set local role service_role;
select public.beto_finish((current_setting('test.r3')::jsonb ->> 'message_id')::uuid, true, 'Ayer 5 USD.', null, null, 'modelo-x', 1, 1, 0, null);
set local role authenticated;
select throws_ok(
  $$ select public.beto_start(null, 'Otra pregunta') $$,
  '23514', 'Ya usaste las 2 preguntas de [B]eto de este mes. Escríbenos para ampliarlo.', 'respeta la cuota del mes'
);

-- ---------------------------------------------------------------------------
-- Chat personal y permisos
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.beto_conversations), 0, 'otro usuario del negocio no ve la conversación');
select is((select count(*)::int from public.beto_messages), 0, 'ni sus mensajes');
select throws_ok(
  format($$ select public.beto_start(%L, 'Hola') $$, current_setting('test.r1')::jsonb ->> 'conversation_id'),
  'P0002', 'Conversación no encontrada', 'ni puede seguirla'
);
select throws_ok(
  format($$ select public.beto_delete_conversation(%L) $$, current_setting('test.r1')::jsonb ->> 'conversation_id'),
  'P0002', 'Conversación no encontrada', 'ni borrarla'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.beto_start(null, 'Hola') $$, '42501', 'Tu rol no tiene acceso a [B]eto', 'el cajero no usa Beto por defecto');
select throws_ok($$ select public.beto_forecast(30) $$, '42501', null, 'ni ve la proyección de ventas');
select throws_ok($$ select public.beto_cashflow(30) $$, '42501', null, 'ni el flujo de caja');
select throws_ok($$ select public.beto_purchase_plan(15) $$, '42501', null, 'ni el plan de compra');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  format($$ select public.beto_delete_conversation(%L) $$, current_setting('test.r1')::jsonb ->> 'conversation_id'),
  'el dueño de la conversación la borra'
);
select is((select count(*)::int from public.beto_conversations), 0, 'y deja de verla');

-- ---------------------------------------------------------------------------
-- Herramientas
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select public.beto_forecast(30) ->> 'confidence', (public.beto_forecast(30) ->> 'expected')::numeric $$,
  $$ values ('sin_datos'::text, 0::numeric) $$,
  'sin ventas, la proyección dice que no hay datos'
);
select throws_ok($$ select public.beto_forecast(91) $$, '23514', 'Días a proyectar inválidos (1 a 90)', 'la proyección tiene tope');

select results_eq(
  $$ select (p ->> 'est_total')::numeric, p -> 'by_supplier' -> 0 ->> 'supplier', (p -> 'items' -> 0 ->> 'suggested')::numeric
     from public.beto_purchase_plan(15) p $$,
  $$ values (100::numeric, 'Proveedor X'::text, 10::numeric) $$,
  'el plan de compra lleva al objetivo, con el último proveedor y el costo'
);

select results_eq(
  $$ select (c ->> 'overdue_payables')::numeric, (c -> 'weeks' -> 0 ->> 'payments_out')::numeric, (c -> 'weeks' -> 1 ->> 'payments_out')::numeric
     from public.beto_cashflow(28) c $$,
  $$ values (20::numeric, 20::numeric, 20::numeric) $$,
  'el flujo de caja pone lo vencido en la primera semana y cada cuota en su semana'
);

select is(jsonb_array_length(public.beto_top_customers(current_date - 30, current_date) -> 'customers'), 0, 'sin ventas no hay mejores clientes');

reset role;
select * from finish();
rollback;
