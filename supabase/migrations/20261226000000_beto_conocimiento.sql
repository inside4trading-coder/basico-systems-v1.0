-- [B]eto conoce el sistema y lee más datos.
--
-- * beto_start agrega al contexto las capacidades de quien pregunta, los
--   módulos del plan y el estado de arranque del negocio (qué falta
--   configurar), para que [B]eto guíe el onboarding.
-- * Lecturas nuevas, todas con la guarda de su área: buscar producto (costo
--   solo con reportes), entradas recientes, devoluciones y anulaciones,
--   detalle de cuentas por pagar y por cobrar (sin contactos) y fichaje.

-- ---------------------------------------------------------------------------
-- Estado de arranque del negocio: qué falta configurar.
-- ---------------------------------------------------------------------------

create or replace function app.beto_setup(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'onboarding_steps', coalesce(t.onboarding_steps, '{}'::jsonb),
    'locations', (select count(*) from public.locations l where l.tenant_id = p_tenant and l.deleted_at is null and l.is_active),
    'registers', (select count(*) from public.registers r where r.tenant_id = p_tenant and r.is_active),
    'products', (select count(*) from public.products p where p.tenant_id = p_tenant and p.deleted_at is null),
    'products_with_stock', (select count(distinct v.product_id) from public.stocks s join public.variants v on v.id = s.variant_id
                            where s.tenant_id = p_tenant and s.on_hand > 0),
    'finance_accounts', (select count(*) from public.finance_accounts a where a.tenant_id = p_tenant and a.is_active),
    'payment_methods', (select count(*) from public.payment_methods m where m.tenant_id = p_tenant and m.is_active),
    'team_members', (select count(*) from public.tenant_members m where m.tenant_id = p_tenant),
    'sales', (select count(*) from public.sales s where s.tenant_id = p_tenant and s.status = 'completed')
  )
  from public.tenants t
  where t.id = p_tenant
$$;
revoke all on function app.beto_setup(uuid) from public, anon, authenticated;

create or replace function app.beto_setup_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  return app.beto_setup(v_tenant);
end;
$$;
revoke all on function app.beto_setup_status() from public;
grant execute on function app.beto_setup_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Buscar un producto: precio, PVP, PVP en moneda local y existencia por sede.
-- El costo solo para quien ve reportes.
-- ---------------------------------------------------------------------------

create or replace function app.beto_find_product(p_query text, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_rate numeric;
  v_costs boolean;
  t public.tenants;
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'inventario', 'Inventario');
  if trim(coalesce(p_query, '')) = '' then
    raise exception 'Escribe qué producto buscar' using errcode = 'check_violation';
  end if;
  select * into t from public.tenants where id = v_tenant;
  v_rate := case when t.local_currency is not null then app.rate_on_day(v_tenant, v_today) end;
  v_costs := app.has_capability(v_tenant, 'reportes.ver');

  return jsonb_build_object(
    'base_currency', t.base_currency,
    'local_currency', t.local_currency,
    'rate', v_rate,
    'prices_include_tax', t.prices_include_tax,
    'products', coalesce((
      select jsonb_agg(x.item order by x.ord)
      from (
        select row_number() over () as ord,
          jsonb_build_object(
            'name', c.product_name,
            'brand', c.brand,
            'sku', c.sku,
            'options', c.options,
            'price', c.price,
            'tax_rate', tr.rate,
            'pvp', pv.pvp,
            'pvp_local', case when v_rate is not null and pv.pvp is not null then round(pv.pvp * v_rate, 2) end,
            'cost', case when v_costs then c.cost end,
            'stock', (select coalesce(jsonb_agg(jsonb_build_object('location', l.name, 'available', s.available, 'on_hand', s.on_hand) order by l.name), '[]'::jsonb)
                      from public.stocks s join public.locations l on l.id = s.location_id
                      where s.tenant_id = v_tenant and s.variant_id = c.variant_id and l.deleted_at is null),
            'stock_total', (select coalesce(sum(s.on_hand), 0) from public.stocks s where s.tenant_id = v_tenant and s.variant_id = c.variant_id)
          ) as item
        from app.catalog_lookup(p_query, least(greatest(coalesce(p_limit, 8), 1), 20)) c
        join public.products p on p.id = c.product_id
        left join lateral (
          select coalesce(
            (select r.rate from public.tax_rates r where r.id = p.tax_rate_id),
            (select r.rate from public.tax_rates r where r.tenant_id = v_tenant and r.is_default),
            0) as rate
        ) tr on true
        left join lateral (
          select case when c.price is null then null
                      when t.prices_include_tax then round(c.price, 2)
                      else round(round(c.price, 2) + round(c.price * tr.rate / 100, 2), 2) end as pvp
        ) pv on true
      ) x
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.beto_find_product(text, integer) from public;
grant execute on function app.beto_find_product(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Entradas de mercancía recientes (entrada rápida y recepciones).
-- ---------------------------------------------------------------------------

create or replace function app.beto_recent_entries(p_days integer default 7, p_location_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_costs boolean;
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'inventario', 'Inventario');
  v_costs := app.has_capability(v_tenant, 'reportes.ver');

  return jsonb_build_object(
    'days', v_days,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', (m.created_at at time zone 'America/Caracas')::date,
               'product', m.product_name, 'sku', m.sku, 'location', m.location_name,
               'qty', m.qty_delta, 'supplier', nullif(trim(m.supplier), ''),
               'unit_cost', case when v_costs then m.unit_cost end,
               'by', m.performed_by_email)
             order by m.created_at desc)
      from (
        select * from public.inventory_control_v m
        where m.tenant_id = v_tenant and m.kind = 'entry'
          and m.created_at >= now() - make_interval(days => v_days)
          and (p_location_id is null or m.location_id = p_location_id)
        order by m.created_at desc
        limit 60
      ) m
    ), '[]'::jsonb),
    'by_supplier', coalesce((
      select jsonb_agg(jsonb_build_object('supplier', s.supplier, 'lines', s.lines, 'units', s.units,
                                          'total_cost', case when v_costs then s.total_cost end)
             order by s.lines desc)
      from (
        select coalesce(nullif(trim(m.supplier), ''), 'Sin proveedor') as supplier, count(*) as lines, sum(m.qty_delta) as units,
               round(sum(m.qty_delta * m.unit_cost), 2) as total_cost
        from public.inventory_control_v m
        where m.tenant_id = v_tenant and m.kind = 'entry'
          and m.created_at >= now() - make_interval(days => v_days)
          and (p_location_id is null or m.location_id = p_location_id)
        group by 1
      ) s
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.beto_recent_entries(integer, uuid) from public;
grant execute on function app.beto_recent_entries(integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Devoluciones y anulaciones de un rango.
-- ---------------------------------------------------------------------------

create or replace function app.beto_returns(p_from date, p_to date)
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
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', (r.created_at at time zone 'America/Caracas')::date, 'number', r.number, 'sale', s.number,
               'total', r.total, 'reason', r.reason, 'restock', r.restock,
               'refund', r.refund_method_name, 'refund_amount', r.refund_amount, 'refund_currency', r.refund_currency)
             order by r.created_at desc)
      from (select * from public.sale_returns r
            where r.tenant_id = v_tenant and r.created_at >= app.caracas_day_start(p_from) and r.created_at < app.caracas_day_start(p_to + 1)
            order by r.created_at desc limit 40) r
      join public.sales s on s.id = r.sale_id
    ), '[]'::jsonb),
    'returns_total', (select round(coalesce(sum(r.total), 0), 2) from public.sale_returns r
                      where r.tenant_id = v_tenant and r.created_at >= app.caracas_day_start(p_from) and r.created_at < app.caracas_day_start(p_to + 1)),
    'voided', coalesce((
      select jsonb_agg(jsonb_build_object('date', (s.voided_at at time zone 'America/Caracas')::date, 'number', s.number,
                                          'total', s.total, 'reason', s.void_reason) order by s.voided_at desc)
      from (select * from public.sales s
            where s.tenant_id = v_tenant and s.status = 'voided'
              and s.voided_at >= app.caracas_day_start(p_from) and s.voided_at < app.caracas_day_start(p_to + 1)
            order by s.voided_at desc limit 40) s
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.beto_returns(date, date) from public;
grant execute on function app.beto_returns(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Cuentas por pagar: a quién se le debe, cuánto y qué vence primero.
-- ---------------------------------------------------------------------------

create or replace function app.beto_payables_detail(p_only_overdue boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  return jsonb_build_object(
    'today', v_today,
    'by_supplier', coalesce((
      select jsonb_agg(jsonb_build_object('supplier', x.supplier, 'currency', x.currency, 'invoices', x.invoices,
                                          'balance', x.balance, 'overdue', x.overdue, 'next_due', x.next_due)
             order by x.balance desc)
      from (
        select coalesce(su.name, 'Sin proveedor') as supplier, p.currency, count(distinct p.id) as invoices,
               round(sum(i.amount - i.paid), 2) as balance,
               round(sum(i.amount - i.paid) filter (where i.due_date < v_today), 2) as overdue,
               min(i.due_date) as next_due
        from public.payables p
        join public.payable_installments i on i.payable_id = p.id and i.amount > i.paid
        left join public.suppliers su on su.id = p.supplier_id
        where p.tenant_id = v_tenant and p.status = 'open'
        group by 1, 2
      ) x
      where not p_only_overdue or x.overdue > 0
    ), '[]'::jsonb),
    'installments', coalesce((
      select jsonb_agg(jsonb_build_object('supplier', y.supplier, 'document', y.document, 'number', y.number, 'due_date', y.due_date,
                                          'pending', y.pending, 'currency', y.currency, 'days_overdue', greatest(v_today - y.due_date, 0))
             order by y.due_date)
      from (
        select coalesce(su.name, 'Sin proveedor') as supplier, p.document, i.number, i.due_date, round(i.amount - i.paid, 2) as pending, p.currency
        from public.payables p
        join public.payable_installments i on i.payable_id = p.id and i.amount > i.paid
        left join public.suppliers su on su.id = p.supplier_id
        where p.tenant_id = v_tenant and p.status = 'open' and (not p_only_overdue or i.due_date < v_today)
        order by i.due_date
        limit 40
      ) y
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.beto_payables_detail(boolean) from public;
grant execute on function app.beto_payables_detail(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Cuentas por cobrar: quién debe, cuánto y qué está vencido (sin contactos).
-- ---------------------------------------------------------------------------

create or replace function app.beto_receivables_detail(p_only_overdue boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  return jsonb_build_object(
    'today', v_today,
    'by_debtor', coalesce((
      select jsonb_agg(jsonb_build_object('debtor', x.debtor, 'kind', x.kind, 'currency', x.currency, 'credits', x.credits,
                                          'balance', x.balance, 'overdue', x.overdue, 'next_due', x.next_due)
             order by x.balance desc)
      from (
        select case when r.kind = 'financing' then coalesce(r.provider, 'Financiadora') else coalesce(r.customer_name, 'Sin nombre') end as debtor,
               r.kind, r.currency, count(distinct r.id) as credits,
               round(sum(i.amount - i.collected), 2) as balance,
               round(sum(i.amount - i.collected) filter (where i.due_date < v_today), 2) as overdue,
               min(i.due_date) as next_due
        from public.receivables r
        join public.receivable_installments i on i.receivable_id = r.id and i.amount > i.collected
        where r.tenant_id = v_tenant and r.status = 'open'
        group by 1, 2, 3
      ) x
      where not p_only_overdue or x.overdue > 0
      limit 40
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.beto_receivables_detail(boolean) from public;
grant execute on function app.beto_receivables_detail(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Fichaje: marcas, retrasos e incidencias por persona.
-- ---------------------------------------------------------------------------

create or replace function app.beto_clock_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'fichaje', 'Fichaje');
  if not app.has_capability(v_tenant, 'fichaje.gestionar') then
    raise exception 'Tu rol no gestiona el fichaje' using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Rango de fechas inválido (máximo 3 meses)' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'job', x.job_title, 'days_worked', x.days, 'late_count', x.late_count,
                                          'late_minutes', x.late_minutes, 'to_review', x.to_review) order by x.name)
      from (
        select c.name, c.job_title,
               count(distinct (e.event_at at time zone 'America/Caracas')::date) filter (where e.kind = 'entrada') as days,
               count(*) filter (where e.kind = 'entrada' and coalesce(e.late_minutes, 0) > 0) as late_count,
               coalesce(sum(e.late_minutes) filter (where e.kind = 'entrada'), 0) as late_minutes,
               count(*) filter (where e.status = 'revisar') as to_review
        from public.cashiers c
        left join public.clock_events e on e.staff_id = c.id and e.tenant_id = v_tenant
          and e.event_at >= app.caracas_day_start(p_from) and e.event_at < app.caracas_day_start(p_to + 1)
        where c.tenant_id = v_tenant and c.clock_enabled
        group by c.id, c.name, c.job_title
      ) x
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.beto_clock_summary(date, date) from public;
grant execute on function app.beto_clock_summary(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create or replace function public.beto_setup_status()
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_setup_status() $$;
create or replace function public.beto_find_product(p_query text, p_limit integer default 8)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_find_product(p_query, p_limit) $$;
create or replace function public.beto_recent_entries(p_days integer default 7, p_location_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_recent_entries(p_days, p_location_id) $$;
create or replace function public.beto_returns(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_returns(p_from, p_to) $$;
create or replace function public.beto_payables_detail(p_only_overdue boolean default false)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_payables_detail(p_only_overdue) $$;
create or replace function public.beto_receivables_detail(p_only_overdue boolean default false)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_receivables_detail(p_only_overdue) $$;
create or replace function public.beto_clock_summary(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.beto_clock_summary(p_from, p_to) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'beto_setup_status()',
    'beto_find_product(text, integer)',
    'beto_recent_entries(integer, uuid)',
    'beto_returns(date, date)',
    'beto_payables_detail(boolean)',
    'beto_receivables_detail(boolean)',
    'beto_clock_summary(date, date)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- beto_start: mismo cuerpo de 20261225000000_beto_marca.sql con el contexto nuevo.
-- ---------------------------------------------------------------------------

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
  perform app.require_module(v_tenant, 'beto', '[B]eto');
  if not app.has_capability(v_tenant, 'beto.usar') then
    raise exception 'Tu rol no tiene acceso a [B]eto' using errcode = 'insufficient_privilege';
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
    raise exception 'Ya usaste las % preguntas de [B]eto de este mes. Escríbenos para ampliarlo.', v_usage ->> 'limit'
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
    raise exception '[B]eto todavía está respondiendo tu pregunta anterior' using errcode = 'check_violation';
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
      'finanzas', app.has_capability(v_tenant, 'finanzas.operar') and coalesce((app.entitled(v_tenant, 'administracion'))::boolean, false),
      'inventario', coalesce((app.entitled(v_tenant, 'inventario'))::boolean, false),
      'fichaje', app.has_capability(v_tenant, 'fichaje.gestionar') and coalesce((app.entitled(v_tenant, 'fichaje'))::boolean, false)
    ),
    -- Qué puede hacer quien pregunta y qué módulos tiene el plan: [B]eto guía
    -- solo por lo que la persona puede usar.
    'capabilities', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                     from jsonb_object_keys(app.capability_defaults() -> 'admin') k
                     where app.has_capability(v_tenant, k)),
    'modules', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                from jsonb_each(app.entitlement_defaults()) e(k, v)
                where jsonb_typeof(v) = 'boolean' and coalesce((app.entitled(v_tenant, k))::boolean, false)),
    'setup', app.beto_setup(v_tenant)
  );
end;
$$;
revoke all on function app.beto_start(uuid, text) from public;
grant execute on function app.beto_start(uuid, text) to authenticated;
