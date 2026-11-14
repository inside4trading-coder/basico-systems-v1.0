-- Beto, el asistente de IA (add-on "beto").
--
-- Beto responde preguntas del negocio en lenguaje natural con datos reales.
-- La edge function `beto` llama al modelo (OpenRouter) y el modelo solo puede
-- usar herramientas de lectura de firma fija que corren con la sesión de quien
-- pregunta: RLS, negocio activo y permisos se heredan (un cajero no ve
-- costos ni finanzas). Beto no escribe datos del negocio.
--
--   * beto_start: valida add-on, permiso beto.usar, cuota del mes y ritmo por
--     minuto; abre la conversación, guarda la pregunta y deja la respuesta
--     pendiente. Devuelve el contexto para el modelo.
--   * beto_finish: solo la edge function (service_role) guarda la respuesta,
--     las herramientas usadas, los tokens y el costo. Las fallidas no gastan
--     cuota.
--   * Cada conversación es personal: ni el dueño lee los chats de otro.
--   * Herramientas nuevas: proyección de ventas, flujo de caja proyectado,
--     plan de compra y mejores clientes (sin teléfono ni correo).

-- ---------------------------------------------------------------------------
-- Plan y permisos
-- ---------------------------------------------------------------------------

create or replace function app.entitlement_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'pos', true, 'inventario', true, 'administracion', true, 'reportes', true,
    'fichaje', false, 'estudio', false, 'cashea', false, 'beto', false,
    'can_export', true,
    'max_locations', 1, 'max_registers', 2, 'max_users', 5, 'estudio_images_per_month', 0,
    'beto_messages_per_month', 300
  )
$$;

create or replace function app.capability_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'admin', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', true, 'caja.supervisar', true, 'caja.cupones', true, 'caja.cajeros', true,
      'catalogo.editar', true, 'catalogo.campos', true, 'inventario.minimos', true, 'inventario.conteos', true,
      'inventario.mover', true, 'inventario.firmar', true, 'inventario.todas_sedes', true, 'inventario.etiquetas', true,
      'reportes.ver', true, 'finanzas.operar', true, 'finanzas.anular', true, 'finanzas.cuentas', true,
      'config.negocio', true, 'config.sedes', true, 'equipo.gestionar', true,
      'fichaje.gestionar', true, 'fichaje.enlace', true, 'estudio.usar', true, 'estudio.configurar', true,
      'beto.usar', true),
    'manager', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', true, 'caja.supervisar', true, 'caja.cupones', true, 'caja.cajeros', false,
      'catalogo.editar', true, 'catalogo.campos', false, 'inventario.minimos', true, 'inventario.conteos', true,
      'inventario.mover', true, 'inventario.firmar', false, 'inventario.todas_sedes', false, 'inventario.etiquetas', true,
      'reportes.ver', true, 'finanzas.operar', true, 'finanzas.anular', false, 'finanzas.cuentas', false,
      'config.negocio', false, 'config.sedes', false, 'equipo.gestionar', false,
      'fichaje.gestionar', true, 'fichaje.enlace', false, 'estudio.usar', true, 'estudio.configurar', false,
      'beto.usar', true),
    'cajero', jsonb_build_object(
      'pos.vender', true, 'ventas.corregir', false, 'caja.supervisar', false, 'caja.cupones', false, 'caja.cajeros', false,
      'catalogo.editar', false, 'catalogo.campos', false, 'inventario.minimos', false, 'inventario.conteos', false,
      'inventario.mover', false, 'inventario.firmar', false, 'inventario.todas_sedes', false, 'inventario.etiquetas', false,
      'reportes.ver', false, 'finanzas.operar', false, 'finanzas.anular', false, 'finanzas.cuentas', false,
      'config.negocio', false, 'config.sedes', false, 'equipo.gestionar', false,
      'fichaje.gestionar', false, 'fichaje.enlace', false, 'estudio.usar', false, 'estudio.configurar', false,
      'beto.usar', false)
  )
$$;

-- ---------------------------------------------------------------------------
-- Conversaciones
-- ---------------------------------------------------------------------------

create table public.beto_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  title text not null check (length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id)
);
create index beto_conversations_user_idx on public.beto_conversations (tenant_id, user_id, updated_at desc) where deleted_at is null;

create table public.beto_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  conversation_id uuid not null,
  user_id uuid not null default auth.uid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (length(content) <= 20000),
  blocks jsonb,
  tools text[] not null default '{}',
  status text not null default 'listo' check (status in ('pendiente', 'listo', 'fallido')),
  model text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10, 5),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.beto_conversations (tenant_id, id) on delete cascade
);
create index beto_messages_conversation_idx on public.beto_messages (conversation_id, created_at);
create index beto_messages_month_idx on public.beto_messages (tenant_id, created_at desc) where role = 'assistant';

alter table public.beto_conversations enable row level security;
alter table public.beto_messages enable row level security;
revoke all on public.beto_conversations from anon, authenticated;
revoke all on public.beto_messages from anon, authenticated;
grant select on public.beto_conversations to authenticated;
grant select on public.beto_messages to authenticated;
create policy tenant_read on public.beto_conversations for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()) and deleted_at is null);
create policy tenant_read on public.beto_messages for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = (select auth.uid()));

-- Respuestas usadas este mes (hora de Caracas) y el límite del plan.
create or replace function app.beto_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce((app.entitled(app.current_tenant_id(), 'beto'))::boolean, false),
    'used', (select count(*) from public.beto_messages m
             where m.tenant_id = app.current_tenant_id() and m.role = 'assistant' and m.status <> 'fallido'
               and m.created_at >= app.caracas_day_start(date_trunc('month', (now() at time zone 'America/Caracas'))::date)),
    'limit', coalesce((app.entitled(app.current_tenant_id(), 'beto_messages_per_month'))::integer, 0))
  where app.current_tenant_id() is not null
$$;
revoke all on function app.beto_usage() from public;
grant execute on function app.beto_usage() to authenticated;

create or replace function app.beto_start(p_conversation_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_user uuid := auth.uid();
  t public.tenants;
  v_message text := trim(p_message);
  v_usage jsonb;
  v_conv uuid := p_conversation_id;
  v_id uuid;
  v_history jsonb;
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  if v_tenant is null or v_user is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'beto', 'Beto');
  if not app.has_capability(v_tenant, 'beto.usar') then
    raise exception 'Tu rol no tiene acceso a Beto' using errcode = 'insufficient_privilege';
  end if;
  if v_message is null or v_message = '' then
    raise exception 'Escribe tu pregunta' using errcode = 'check_violation';
  end if;
  if length(v_message) > 2000 then
    raise exception 'La pregunta es muy larga (máximo 2000 caracteres)' using errcode = 'check_violation';
  end if;

  if v_conv is not null and not exists (select 1 from public.beto_conversations c
                    where c.id = v_conv and c.tenant_id = v_tenant and c.user_id = v_user and c.deleted_at is null) then
    raise exception 'Conversación no encontrada' using errcode = 'no_data_found';
  end if;

  -- Una pregunta a la vez por negocio para que la cuota no se pase.
  perform pg_advisory_xact_lock(hashtext('beto:' || v_tenant::text));
  v_usage := app.beto_usage();
  if (v_usage ->> 'used')::integer >= (v_usage ->> 'limit')::integer then
    raise exception 'Ya usaste las % preguntas de Beto de este mes. Escríbenos para ampliarlo.', v_usage ->> 'limit'
      using errcode = 'check_violation';
  end if;
  if (select count(*) from public.beto_messages m
      where m.tenant_id = v_tenant and m.user_id = v_user and m.role = 'assistant'
        and m.created_at > now() - interval '1 minute') >= 6 then
    raise exception 'Vas muy rápido. Espera un minuto y vuelve a preguntar.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.beto_messages m
             where m.tenant_id = v_tenant and m.user_id = v_user and m.status = 'pendiente'
               and m.created_at > now() - interval '3 minutes') then
    raise exception 'Beto todavía está respondiendo tu pregunta anterior' using errcode = 'check_violation';
  end if;

  if v_conv is null then
    insert into public.beto_conversations (tenant_id, user_id, title)
    values (v_tenant, v_user, left(regexp_replace(v_message, '\s+', ' ', 'g'), 80))
    returning id into v_conv;
  end if;

  -- Historial reciente (las respuestas fallidas o pendientes no van).
  select coalesce(jsonb_agg(jsonb_build_object('role', h.role, 'content', h.content) order by h.created_at), '[]'::jsonb)
  into v_history
  from (
    select m.role, m.content, m.created_at from public.beto_messages m
    where m.conversation_id = v_conv and m.status = 'listo'
    order by m.created_at desc
    limit 12
  ) h;

  -- clock_timestamp: la pregunta queda antes que su respuesta aunque sea la misma transacción.
  insert into public.beto_messages (tenant_id, conversation_id, user_id, role, content, created_at)
  values (v_tenant, v_conv, v_user, 'user', v_message, clock_timestamp());
  insert into public.beto_messages (tenant_id, conversation_id, user_id, role, status, created_at)
  values (v_tenant, v_conv, v_user, 'assistant', 'pendiente', clock_timestamp())
  returning id into v_id;
  update public.beto_conversations set updated_at = now() where id = v_conv;

  select * into t from public.tenants where id = v_tenant;
  return jsonb_build_object(
    'conversation_id', v_conv,
    'message_id', v_id,
    'history', v_history,
    'today', v_today,
    'tenant_name', t.name,
    'base_currency', t.base_currency,
    'local_currency', t.local_currency,
    'rate', app.rate_on_day(v_tenant, v_today),
    'role', (select tm.role from public.tenant_members tm where tm.tenant_id = v_tenant and tm.user_id = v_user),
    'can', jsonb_build_object(
      'reportes', app.has_capability(v_tenant, 'reportes.ver') and coalesce((app.entitled(v_tenant, 'reportes'))::boolean, false),
      'finanzas', app.has_capability(v_tenant, 'finanzas.operar')
    )
  );
end;
$$;
revoke all on function app.beto_start(uuid, text) from public;
grant execute on function app.beto_start(uuid, text) to authenticated;

create or replace function app.beto_finish(
  p_message_id uuid, p_ok boolean, p_content text, p_blocks jsonb, p_tools text[],
  p_model text, p_tokens_in integer, p_tokens_out integer, p_cost numeric, p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.beto_messages;
begin
  update public.beto_messages
  set status = case when p_ok then 'listo' else 'fallido' end,
      content = left(coalesce(p_content, ''), 20000),
      blocks = case when jsonb_typeof(p_blocks) = 'array' then p_blocks end,
      tools = coalesce(p_tools, '{}'),
      model = p_model, tokens_in = p_tokens_in, tokens_out = p_tokens_out, cost_usd = p_cost,
      error = left(p_error, 500), finished_at = now()
  where id = p_message_id and status = 'pendiente'
  returning * into m;
  -- Sin respuesta, la pregunta tampoco entra al historial del modelo.
  if found and not p_ok then
    update public.beto_messages q set status = 'fallido'
    where q.id = (select u.id from public.beto_messages u
                  where u.conversation_id = m.conversation_id and u.role = 'user' and u.created_at <= m.created_at
                  order by u.created_at desc limit 1);
  end if;
end;
$$;
revoke all on function app.beto_finish(uuid, boolean, text, jsonb, text[], text, integer, integer, numeric, text) from public, authenticated;
grant execute on function app.beto_finish(uuid, boolean, text, jsonb, text[], text, integer, integer, numeric, text) to service_role;

create or replace function app.beto_delete_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.beto_conversations
  set deleted_at = now()
  where id = p_conversation_id and tenant_id = app.current_tenant_id() and user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Conversación no encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.beto_delete_conversation(uuid) from public;
grant execute on function app.beto_delete_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Herramientas de lectura nuevas
-- ---------------------------------------------------------------------------

-- Ventas netas por día de las últimas 8 semanas (sin hoy), desde la primera venta.
create or replace function app.beto_sales_history(p_tenant uuid, p_today date)
returns table (day date, net numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with first_sale as (
    select (min(s.sold_at) at time zone 'America/Caracas')::date as d
    from public.sales s where s.tenant_id = p_tenant and s.status = 'completed'
  )
  select d.day::date, coalesce(x.net, 0)
  from first_sale f
  cross join generate_series(greatest(p_today - 56, f.d), p_today - 1, interval '1 day') as d(day)
  left join (
    select (s.sold_at at time zone 'America/Caracas')::date as day, sum(s.total) as net
    from public.sales s
    where s.tenant_id = p_tenant and s.status = 'completed'
      and s.sold_at >= app.caracas_day_start(p_today - 56) and s.sold_at < app.caracas_day_start(p_today)
    group by 1
  ) x on x.day = d.day::date
  where f.d is not null
$$;
revoke all on function app.beto_sales_history(uuid, date) from public;

-- Promedio por día de la semana (1 = lunes) sobre el historial; sin dato del
-- día, el promedio general.
create or replace function app.beto_weekday_avg(p_tenant uuid, p_today date)
returns table (dow integer, avg_net numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select * from app.beto_sales_history(p_tenant, p_today)),
       overall as (select coalesce(avg(net), 0) as a from h)
  select w.dow, coalesce((select avg(h.net) from h where extract(isodow from h.day)::int = w.dow), (select a from overall))
  from generate_series(1, 7) as w(dow)
$$;
revoke all on function app.beto_weekday_avg(uuid, date) from public;

-- Proyección de ventas: promedio por día de la semana de las últimas 8
-- semanas. Es una estimación; la confianza depende de los días de historia.
create or replace function app.beto_forecast(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_month_end date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  v_history integer;
  v_avg numeric;
  v_sd numeric;
  v_expected numeric;
  v_month_left numeric;
  v_mtd numeric;
  v_last30 numeric;
begin
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'Días a proyectar inválidos (1 a 90)' using errcode = 'check_violation';
  end if;
  select count(*), coalesce(avg(net), 0), coalesce(stddev_samp(net), 0)
  into v_history, v_avg, v_sd
  from app.beto_sales_history(v_tenant, v_today);

  select coalesce(sum(w.avg_net), 0) into v_expected
  from generate_series(v_today, v_today + p_days - 1, interval '1 day') as d(day)
  join app.beto_weekday_avg(v_tenant, v_today) w on w.dow = extract(isodow from d.day)::int;

  select coalesce(sum(w.avg_net), 0) into v_month_left
  from generate_series(v_today, v_month_end, interval '1 day') as d(day)
  join app.beto_weekday_avg(v_tenant, v_today) w on w.dow = extract(isodow from d.day)::int;

  select coalesce(sum(s.total), 0) into v_mtd
  from public.sales s
  where s.tenant_id = v_tenant and s.status = 'completed'
    and s.sold_at >= app.caracas_day_start(date_trunc('month', v_today)::date) and s.sold_at < app.caracas_day_start(v_today);

  select coalesce(sum(s.total), 0) into v_last30
  from public.sales s
  where s.tenant_id = v_tenant and s.status = 'completed'
    and s.sold_at >= app.caracas_day_start(v_today - 30) and s.sold_at < app.caracas_day_start(v_today);

  return jsonb_build_object(
    'today', v_today,
    'days', p_days,
    'history_days', v_history,
    'confidence', case when v_history >= 42 then 'alta' when v_history >= 14 then 'media' when v_history > 0 then 'baja' else 'sin_datos' end,
    'daily_avg', round(v_avg, 2),
    'expected', round(v_expected, 2),
    'low', round(greatest(v_expected - 1.28 * v_sd * sqrt(p_days::numeric), 0), 2),
    'high', round(v_expected + 1.28 * v_sd * sqrt(p_days::numeric), 2),
    'by_weekday', (select jsonb_agg(jsonb_build_object('dow', w.dow, 'avg', round(w.avg_net, 2)) order by w.dow)
                   from app.beto_weekday_avg(v_tenant, v_today) w),
    'last_30_days', round(v_last30, 2),
    'month_to_date', round(v_mtd, 2),
    'month_projection', round(v_mtd + v_month_left, 2),
    'method', 'Promedio por día de la semana de las últimas 8 semanas; hoy cuenta como día proyectado.'
  );
end;
$$;
revoke all on function app.beto_forecast(integer) from public;
grant execute on function app.beto_forecast(integer) to authenticated;

-- Flujo de caja proyectado por semana: dinero disponible hoy + ventas
-- proyectadas + cuotas por cobrar − cuotas por pagar (las vencidas, en la
-- primera semana). Montos en la moneda base con la tasa de hoy.
create or replace function app.beto_cashflow(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  t public.tenants;
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_rate numeric;
  v_start numeric;
  v_weeks jsonb;
begin
  perform app.report_tenant();
  if p_days is null or p_days not between 7 and 90 then
    raise exception 'Días a proyectar inválidos (7 a 90)' using errcode = 'check_violation';
  end if;
  select * into t from public.tenants where id = v_tenant;
  v_rate := app.rate_on_day(v_tenant, v_today);
  v_start := coalesce((public.treasury_summary(null, null) -> 'liquidity' ->> 'available')::numeric, 0);

  with weeks as (
    select g as n, v_today + g * 7 as w_from, least(v_today + g * 7 + 6, v_today + p_days - 1) as w_to
    from generate_series(0, (p_days - 1) / 7) as g
  ),
  sales_in as (
    select k.n, coalesce(sum(w.avg_net), 0) as amount
    from weeks k
    cross join lateral generate_series(k.w_from, k.w_to, interval '1 day') as d(day)
    join app.beto_weekday_avg(v_tenant, v_today) w on w.dow = extract(isodow from d.day)::int
    group by k.n
  ),
  collections as (
    select greatest(((i.due_date - v_today) / 7), 0) as n,
           sum(app.convert_amount(i.amount - i.collected - i.covered, r.currency, t.base_currency, t.base_currency, t.local_currency, v_rate)) as amount
    from public.receivable_installments i
    join public.receivables r on r.id = i.receivable_id
    where r.tenant_id = v_tenant and r.status = 'open' and i.amount - i.collected - i.covered > 0.005
      and i.due_date <= v_today + p_days - 1
    group by 1
  ),
  payments as (
    select greatest(((i.due_date - v_today) / 7), 0) as n,
           sum(app.convert_amount(i.amount - i.paid, p.currency, t.base_currency, t.base_currency, t.local_currency, v_rate)) as amount
    from public.payable_installments i
    join public.payables p on p.id = i.payable_id
    where p.tenant_id = v_tenant and p.status = 'open' and i.amount - i.paid > 0.005
      and i.due_date <= v_today + p_days - 1
    group by 1
  ),
  rows as (
    select k.n, k.w_from, k.w_to,
           round(coalesce(s.amount, 0), 2) as sales_in,
           round(coalesce(c.amount, 0), 2) as collections_in,
           round(coalesce(p.amount, 0), 2) as payments_out
    from weeks k
    left join sales_in s on s.n = k.n
    left join collections c on c.n = k.n
    left join payments p on p.n = k.n
  ),
  running as (
    select r.*, round(v_start + sum(r.sales_in + r.collections_in - r.payments_out) over (order by r.n), 2) as end_balance
    from rows r
  )
  select jsonb_agg(jsonb_build_object(
           'week', r.n + 1, 'from', r.w_from, 'to', r.w_to,
           'sales_in', r.sales_in, 'collections_in', r.collections_in, 'payments_out', r.payments_out,
           'end_balance', r.end_balance
         ) order by r.n)
  into v_weeks
  from running r;

  return jsonb_build_object(
    'today', v_today,
    'days', p_days,
    'currency', t.base_currency,
    'start_available', round(v_start, 2),
    'weeks', coalesce(v_weeks, '[]'::jsonb),
    'min_balance', (select min((w ->> 'end_balance')::numeric) from jsonb_array_elements(coalesce(v_weeks, '[]'::jsonb)) w),
    'overdue_payables', (select round(coalesce(sum(app.convert_amount(i.amount - i.paid, p.currency, t.base_currency, t.base_currency, t.local_currency, v_rate)), 0), 2)
                         from public.payable_installments i join public.payables p on p.id = i.payable_id
                         where p.tenant_id = v_tenant and p.status = 'open' and i.amount - i.paid > 0.005 and i.due_date < v_today),
    'method', 'Disponible hoy + ventas proyectadas (promedio por día de la semana) + cuotas por cobrar − cuotas por pagar. No incluye gastos fijos ni obligaciones.'
  );
end;
$$;
revoke all on function app.beto_cashflow(integer) from public;
grant execute on function app.beto_cashflow(integer) to authenticated;

-- Plan de compra: lo que sugiere Reposición, con el último proveedor y el
-- costo estimado; si quien pregunta ve finanzas, contra el dinero disponible.
create or replace function app.beto_purchase_plan(p_cover_days integer default 15, p_location_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
  v_result jsonb;
begin
  if p_cover_days is null or p_cover_days not between 1 and 180 then
    raise exception 'Días a cubrir inválidos (1 a 180)' using errcode = 'check_violation';
  end if;

  with plan as materialized (
    select r.name, r.sku, r.location_name, r.available, r.days_left, r.suggested, v.cost as unit_cost,
           case when v.cost is not null then round(r.suggested * v.cost, 2) end as est_cost,
           (select m.supplier from public.inventory_movements m
            where m.tenant_id = v_tenant and m.variant_id = r.variant_id and m.kind = 'entry' and nullif(trim(m.supplier), '') is not null
            order by m.created_at desc limit 1) as supplier
    from public.report_restock(p_location_id, 30, p_cover_days) r
    join public.variants v on v.id = r.variant_id
  )
  select jsonb_build_object(
    'cover_days', p_cover_days,
    'items_count', (select count(*) from plan),
    'est_total', (select round(coalesce(sum(est_cost), 0), 2) from plan),
    'items_without_cost', (select count(*) from plan where unit_cost is null),
    'by_supplier', (
      select coalesce(jsonb_agg(jsonb_build_object('supplier', s.supplier, 'items', s.items, 'units', s.units, 'est_cost', s.est_cost)
                                order by s.est_cost desc nulls last), '[]'::jsonb)
      from (
        select coalesce(supplier, 'Sin proveedor registrado') as supplier, count(*) as items, sum(suggested) as units,
               round(sum(est_cost), 2) as est_cost
        from plan group by 1
      ) s),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', p.name, 'sku', p.sku, 'location', p.location_name, 'available', p.available, 'days_left', p.days_left,
               'suggested', p.suggested, 'unit_cost', p.unit_cost, 'est_cost', p.est_cost, 'supplier', p.supplier)
               order by p.days_left nulls last, p.est_cost desc nulls last), '[]'::jsonb)
      from (select * from plan order by days_left nulls last, est_cost desc nulls last limit 40) p)
  ) into v_result;

  return v_result || jsonb_build_object(
    'available_money', case when app.has_capability(v_tenant, 'finanzas.operar')
                            then (public.treasury_summary(null, null) -> 'liquidity' ->> 'available')::numeric end,
    'method', 'Sugerido de Reposición (mínimos o 30 días de ventas para cubrir los días pedidos) × costo actual; proveedor de la última entrada.'
  );
end;
$$;
revoke all on function app.beto_purchase_plan(integer, uuid) from public;
grant execute on function app.beto_purchase_plan(integer, uuid) to authenticated;

-- Mejores clientes de un rango, sin teléfono ni correo.
create or replace function app.beto_top_customers(p_from date, p_to date, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo un año)' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'tickets', x.tickets, 'net', x.net, 'last_purchase', x.last_purchase) order by x.net desc)
      from (
        select c.name, count(*) as tickets, round(sum(s.total), 2) as net, max((s.sold_at at time zone 'America/Caracas')::date) as last_purchase
        from public.sales s
        join public.customers c on c.id = s.customer_id
        where s.tenant_id = v_tenant and s.status = 'completed'
          and s.sold_at >= app.caracas_day_start(p_from) and s.sold_at < app.caracas_day_start(p_to + 1)
        group by c.id, c.name
        order by sum(s.total) desc
        limit least(greatest(coalesce(p_limit, 10), 1), 50)
      ) x
    ), '[]'::jsonb),
    'without_customer', (
      select jsonb_build_object('tickets', count(*), 'net', round(coalesce(sum(s.total), 0), 2))
      from public.sales s
      where s.tenant_id = v_tenant and s.status = 'completed' and s.customer_id is null
        and s.sold_at >= app.caracas_day_start(p_from) and s.sold_at < app.caracas_day_start(p_to + 1)
    )
  );
end;
$$;
revoke all on function app.beto_top_customers(date, date, integer) from public;
grant execute on function app.beto_top_customers(date, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create function public.beto_usage()
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_usage() $$;
create function public.beto_start(p_conversation_id uuid, p_message text)
returns jsonb language sql security invoker set search_path = '' as $$ select app.beto_start(p_conversation_id, p_message) $$;
create function public.beto_delete_conversation(p_conversation_id uuid)
returns void language sql security invoker set search_path = '' as $$ select app.beto_delete_conversation(p_conversation_id) $$;
create function public.beto_forecast(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_forecast(p_days) $$;
create function public.beto_cashflow(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_cashflow(p_days) $$;
create function public.beto_purchase_plan(p_cover_days integer default 15, p_location_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$ select app.beto_purchase_plan(p_cover_days, p_location_id) $$;
create function public.beto_top_customers(p_from date, p_to date, p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_top_customers(p_from, p_to, p_limit) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'beto_usage()',
    'beto_start(uuid, text)',
    'beto_delete_conversation(uuid)',
    'beto_forecast(integer)',
    'beto_cashflow(integer)',
    'beto_purchase_plan(integer, uuid)',
    'beto_top_customers(date, date, integer)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- La edge function cierra la respuesta con la clave de servicio (vive en Supabase, no en Vercel).
create function public.beto_finish(
  p_message_id uuid, p_ok boolean, p_content text, p_blocks jsonb, p_tools text[],
  p_model text, p_tokens_in integer, p_tokens_out integer, p_cost numeric, p_error text
)
returns void language sql security invoker set search_path = '' as $$
  select app.beto_finish(p_message_id, p_ok, p_content, p_blocks, p_tools, p_model, p_tokens_in, p_tokens_out, p_cost, p_error)
$$;
revoke all on function public.beto_finish(uuid, boolean, text, jsonb, text[], text, integer, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.beto_finish(uuid, boolean, text, jsonb, text[], text, integer, integer, numeric, text) to service_role;
