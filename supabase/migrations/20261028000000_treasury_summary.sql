-- Resumen de tesorería y catálogos de Administración.
--
-- Portado de SublimeAdminSummary / useSublimeAdminSummary y del catálogo de
-- useSublimeAdminConfig (basicosystems@f551478b). Cambios de fondo:
--   * El resumen se calcula en el servidor (en Sublime, el navegador bajaba
--     todos los movimientos e históricos de tasa).
--   * Liquidez en la moneda base del negocio con la tasa vigente; ingresos y
--     egresos de un periodo con la tasa de cada día (una venta, con la tasa
--     que se cobró). Lo que no se puede convertir no se suma y se cuenta.
--   * Los traslados entre cuentas (y los cambios de moneda) no son ingreso
--     ni egreso.
--   * Categorías y contrapartes son un catálogo por negocio: sugerencias al
--     registrar y agrupación del resumen. Nada de rubro en el código: cada
--     negocio arranca con categorías genéricas y las cambia.

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create table public.finance_catalog_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('category', 'counterparty')),
  name text not null check (length(trim(name)) between 1 and 80),
  -- Solo categorías: de ingreso, de egreso o de ambos (null).
  direction text check (direction in ('in', 'out')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind = 'category' or direction is null)
);
create unique index finance_catalog_items_name_uq on public.finance_catalog_items (tenant_id, kind, lower(trim(name)));

alter table public.finance_catalog_items enable row level security;
revoke all on public.finance_catalog_items from anon;
revoke delete on public.finance_catalog_items from authenticated;
create policy tenant_read on public.finance_catalog_items for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_insert on public.finance_catalog_items for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_update on public.finance_catalog_items for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id))
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
revoke update on public.finance_catalog_items from authenticated;
grant update (name, direction, is_active) on public.finance_catalog_items to authenticated;

create or replace function app.seed_finance_catalog(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.finance_catalog_items (tenant_id, kind, name, direction)
  select p_tenant_id, 'category', c.name, c.direction
  from (values
    ('Ventas', 'in'), ('Otros ingresos', 'in'),
    ('Alquiler', 'out'), ('Servicios', 'out'), ('Nómina', 'out'), ('Impuestos', 'out'),
    ('Proveedores', 'out'), ('Transporte', 'out'), ('Mantenimiento', 'out'),
    ('Comisiones bancarias', 'out'), ('Otros gastos', 'out')
  ) as c(name, direction)
  on conflict do nothing;
end;
$$;
revoke all on function app.seed_finance_catalog(uuid) from public;

create or replace function app.tenants_seed_finance_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_finance_catalog(new.id);
  return new;
end;
$$;
revoke all on function app.tenants_seed_finance_catalog() from public;
create trigger tenants_seed_finance_catalog after insert on public.tenants
  for each row execute function app.tenants_seed_finance_catalog();

select app.seed_finance_catalog(id) from public.tenants;

-- ---------------------------------------------------------------------------
-- Resumen
-- ---------------------------------------------------------------------------

-- Monto en la moneda base: la base tal cual, la local entre la tasa; otra
-- moneda o sin tasa, null.
create or replace function app.to_base(p_amount numeric, p_currency text, p_base text, p_local text, p_rate numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_currency = p_base then p_amount
    when p_currency = p_local and p_rate > 0 then round(p_amount / p_rate, 2)
  end
$$;
revoke all on function app.to_base(numeric, text, text, text, numeric) from public;

-- p_from null: desde siempre. p_to null: hoy (Caracas).
create or replace function app.treasury_summary(p_from date default null, p_to date default null)
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
  v_to date;
  v_rate record;
  v_result jsonb;
begin
  select * into t from public.tenants where id = v_tenant;
  v_to := coalesce(p_to, v_today);
  if p_from is not null and p_from > v_to then
    raise exception 'El periodo empieza después de terminar' using errcode = 'check_violation';
  end if;
  select r.rate, r.effective_date, r.source into v_rate from app.rate_at(v_tenant) r;

  with acc as (
    select a.id, a.name, a.kind, a.currency, a.is_active, a.position,
           a.opening_balance + coalesce(sum(case m.direction when 'in' then m.amount else -m.amount end)
             filter (where m.occurred_on >= a.opening_date), 0) as balance,
           coalesce(sum(m.amount) filter (where m.direction = 'in' and m.occurred_on between coalesce(p_from, '-infinity') and v_to), 0) as period_in,
           coalesce(sum(m.amount) filter (where m.direction = 'out' and m.occurred_on between coalesce(p_from, '-infinity') and v_to), 0) as period_out,
           max(m.occurred_on) as last_movement_on
    from public.finance_accounts a
    left join public.finance_movements m on m.account_id = a.id and m.voided_at is null
    where a.tenant_id = v_tenant
    group by a.id
  ),
  acc_base as (
    select acc.*, app.to_base(acc.balance, acc.currency, t.base_currency, t.local_currency, v_rate.rate) as balance_base
    from acc
  ),
  mv as (
    select m.*, sp.amount_base as sale_amount_base
    from public.finance_movements m
    left join public.sale_payments sp on sp.id = m.sale_payment_id
    where m.tenant_id = v_tenant and m.voided_at is null and m.kind <> 'transfer'
      and m.occurred_on between coalesce(p_from, '-infinity') and v_to
  ),
  day_rate as (
    select d.day, (select r.rate from app.rate_at(v_tenant, (d.day + time '12:00') at time zone 'America/Caracas') r) as rate
    from (select distinct occurred_on as day from mv where currency = t.local_currency) d
  ),
  mvb as (
    select mv.direction, mv.currency, mv.amount, coalesce(nullif(trim(mv.category), ''), 'Sin categoría') as category,
           case when mv.sale_amount_base is not null then mv.sale_amount_base
                else app.to_base(mv.amount, mv.currency, t.base_currency, t.local_currency, dr.rate) end as amount_base
    from mv left join day_rate dr on dr.day = mv.occurred_on
  ),
  -- Por pagar: lo vencido y lo que vence en 30 días (las cuotas se generan
  -- con meses de anticipación; sumarlas todas inflaría la cifra).
  open_inst as (
    select i.due_date, i.currency, case when i.amount is null then null else greatest(i.amount - i.paid_amount, 0) end as remaining
    from public.obligation_instances i
    where i.tenant_id = v_tenant and i.status in ('pending', 'partial') and i.due_date <= v_today + 30
  )
  select jsonb_build_object(
    'base_currency', t.base_currency,
    'local_currency', t.local_currency,
    'from', p_from,
    'to', v_to,
    'rate', case when v_rate.rate is null then null else jsonb_build_object(
      'rate', v_rate.rate, 'effective_date', v_rate.effective_date, 'source', v_rate.source) end,
    'accounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'kind', kind, 'currency', currency, 'is_active', is_active,
        'balance', balance, 'balance_base', balance_base, 'period_in', period_in, 'period_out', period_out,
        'last_movement_on', last_movement_on
      ) order by position, name), '[]'::jsonb) from acc_base
    ),
    'liquidity', (
      select jsonb_build_object(
        'total', coalesce(sum(balance_base), 0),
        'available', coalesce(sum(balance_base) filter (where is_active), 0),
        'unconverted', coalesce(jsonb_agg(distinct currency) filter (where balance_base is null and balance <> 0), '[]'::jsonb))
      from acc_base
    ),
    'period', (
      select jsonb_build_object(
        'income', coalesce(sum(amount_base) filter (where direction = 'in'), 0),
        'expense', coalesce(sum(amount_base) filter (where direction = 'out'), 0),
        'unconverted', count(*) filter (where amount_base is null),
        'movements', count(*),
        'by_currency', (
          select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'income', x.income, 'expense', x.expense) order by x.currency), '[]'::jsonb)
          from (select currency, sum(amount) filter (where direction = 'in') as income, sum(amount) filter (where direction = 'out') as expense
                from mvb group by currency) x
        ),
        'income_by_category', (
          select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'amount', x.total) order by x.total desc), '[]'::jsonb)
          from (select category, sum(amount_base) as total from mvb where direction = 'in' and amount_base is not null
                group by category order by 2 desc limit 6) x
        ),
        'expense_by_category', (
          select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'amount', x.total) order by x.total desc), '[]'::jsonb)
          from (select category, sum(amount_base) as total from mvb where direction = 'out' and amount_base is not null
                group by category order by 2 desc limit 6) x
        ))
      from mvb
    ),
    'payable', (
      select jsonb_build_object(
        'count', count(*),
        'total', coalesce(sum(app.to_base(remaining, currency, t.base_currency, t.local_currency, v_rate.rate)), 0),
        'variable', count(*) filter (where remaining is null),
        'overdue_count', count(*) filter (where due_date < v_today),
        'overdue_total', coalesce(sum(app.to_base(remaining, currency, t.base_currency, t.local_currency, v_rate.rate)) filter (where due_date < v_today), 0),
        'due_soon', count(*) filter (where due_date between v_today and v_today + 7))
      from open_inst
    ),
    'recent', (
      select coalesce(jsonb_agg(x.j order by x.occurred_on desc, x.created_at desc), '[]'::jsonb)
      from (select m.occurred_on, m.created_at, jsonb_build_object(
              'id', m.id, 'account_id', m.account_id, 'direction', m.direction, 'kind', m.kind, 'amount', m.amount,
              'currency', m.currency, 'occurred_on', m.occurred_on, 'category', m.category, 'counterparty', m.counterparty,
              'note', m.note) as j
            from public.finance_movements m
            where m.tenant_id = v_tenant and m.voided_at is null
            order by m.occurred_on desc, m.created_at desc
            limit 6) x
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function app.treasury_summary(date, date) from public;
grant execute on function app.treasury_summary(date, date) to authenticated;

create function public.treasury_summary(p_from date default null, p_to date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.treasury_summary(p_from, p_to)
$$;
revoke all on function public.treasury_summary(date, date) from public, anon;
grant execute on function public.treasury_summary(date, date) to authenticated;
