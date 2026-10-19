-- Tasa de cambio, impuestos y métodos de pago: lo que el POS necesita antes
-- de registrar una venta.
--
-- Port de basicosystems@f551478b, generalizado:
--   * fondo_exchange_rates + sublime-bcv-rate → exchange_rates (global, la
--     escribe solo la función exchange-rate-sync) y tenant_rates (tasa propia
--     del negocio, solo dueño/admin; en Sublime cualquier usuario podía
--     fijarla). Cada tasa guarda su fecha valor.
--   * IVA fijo en 1.16 → tax_rates por negocio y tasa por producto.
--   * src/lib/posPaymentMethods.ts (lista fija) → payment_methods por negocio.
--   * IGTF configurable para contribuyentes especiales.

-- ---------------------------------------------------------------------------
-- Tasas de cambio
-- ---------------------------------------------------------------------------

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('bcv', 'dolarapi')),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(18, 6) not null check (rate > 0),
  -- Día desde el que rige la tasa (fecha valor del BCV).
  effective_date date not null,
  fetched_at timestamptz not null default now(),
  raw jsonb,
  unique (source, base_currency, quote_currency, effective_date)
);
comment on table public.exchange_rates is '@global Tasas oficiales públicas (BCV). Solo lectura para usuarios; las escribe exchange-rate-sync.';
create index exchange_rates_lookup_idx on public.exchange_rates (base_currency, quote_currency, effective_date desc);

create table public.tenant_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(18, 6) not null check (rate > 0),
  note text,
  set_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index tenant_rates_lookup_idx on public.tenant_rates (tenant_id, base_currency, quote_currency, created_at desc);

alter table public.exchange_rates enable row level security;
alter table public.tenant_rates enable row level security;
revoke all on public.exchange_rates, public.tenant_rates from anon;
revoke insert, update, delete on public.exchange_rates from authenticated;
-- La tasa propia es un historial: se agrega una nueva, nunca se edita.
revoke update, delete on public.tenant_rates from authenticated;

create policy signed_in_read on public.exchange_rates for select to authenticated
  using (auth.uid() is not null);

create policy tenant_read on public.tenant_rates for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy supervisor_insert on public.tenant_rates for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- Configuración fiscal del negocio
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column prices_include_tax boolean not null default true,
  add column igtf_rate numeric(5, 2) not null default 3 check (igtf_rate >= 0 and igtf_rate <= 100);

revoke update on public.tenants from authenticated;
grant update (name, base_currency, local_currency, rate_source, is_special_taxpayer, prices_include_tax, igtf_rate)
  on public.tenants to authenticated;

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  rate numeric(5, 2) not null check (rate >= 0 and rate <= 100),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);
create unique index tax_rates_one_default_idx on public.tax_rates (tenant_id) where is_default;

alter table public.products add column tax_rate_id uuid;
alter table public.products
  add constraint products_tax_rate_fk foreign key (tenant_id, tax_rate_id) references public.tax_rates (tenant_id, id);
create index products_tax_rate_idx on public.products (tenant_id, tax_rate_id) where tax_rate_id is not null;

create trigger tax_rates_touch before update on public.tax_rates
  for each row execute function app.touch_updated_at();

alter table public.tax_rates enable row level security;
revoke all on public.tax_rates from anon;
revoke delete on public.tax_rates from authenticated;

create policy tenant_read on public.tax_rates for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy supervisor_insert on public.tax_rates for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy supervisor_update on public.tax_rates for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- Métodos de pago
-- ---------------------------------------------------------------------------

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{0,30}$'),
  name text not null check (length(trim(name)) > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  kind text not null check (kind in ('cash', 'card', 'mobile_payment', 'transfer', 'zelle', 'bnpl', 'other')),
  -- Datos que pide el cobro: referencia, banco, terminal, titular, cuotas.
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  -- Bancos donde el negocio recibe este método (pago móvil, punto…).
  banks text[] not null default '{}',
  -- Pago en divisas sujeto a IGTF cuando el negocio es contribuyente especial.
  applies_igtf boolean not null default false,
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create trigger payment_methods_touch before update on public.payment_methods
  for each row execute function app.touch_updated_at();

alter table public.payment_methods enable row level security;
revoke all on public.payment_methods from anon;
revoke delete on public.payment_methods from authenticated;

create policy tenant_read on public.payment_methods for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));
create policy supervisor_insert on public.payment_methods for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy supervisor_update on public.payment_methods for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app.has_tenant_role(tenant_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- Valores iniciales de cada negocio nuevo (y de los que ya existen)
-- ---------------------------------------------------------------------------

create or replace function app.seed_tenant_defaults(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local text;
  v_base text;
begin
  select local_currency, base_currency into v_local, v_base from public.tenants where id = p_tenant_id;

  insert into public.tax_rates (tenant_id, name, rate, is_default) values
    (p_tenant_id, 'IVA general', 16, true),
    (p_tenant_id, 'IVA reducido', 8, false),
    (p_tenant_id, 'Exento', 0, false)
  on conflict (tenant_id, name) do nothing;

  insert into public.payment_methods (tenant_id, code, name, currency, kind, fields, applies_igtf, position)
  select p_tenant_id, m.code, m.name, m.currency, m.kind, m.fields, m.applies_igtf, m.position
  from (values
    ('cash_base', 'Efectivo ' || v_base, v_base, 'cash', '[]'::jsonb, true, 1),
    ('zelle', 'Zelle', 'USD', 'zelle',
      '[{"id":"holder","label":"Titular"},{"id":"reference","label":"Referencia","required":true}]'::jsonb, true, 2),
    ('mobile_payment', 'Pago móvil', coalesce(v_local, v_base), 'mobile_payment',
      '[{"id":"bank","label":"Banco","required":true,"type":"bank"},{"id":"reference","label":"Referencia","required":true}]'::jsonb, false, 3),
    ('card', 'Punto de venta', coalesce(v_local, v_base), 'card',
      '[{"id":"terminal","label":"Terminal"},{"id":"reference","label":"Referencia"}]'::jsonb, false, 4),
    ('transfer', 'Transferencia', coalesce(v_local, v_base), 'transfer',
      '[{"id":"bank","label":"Banco","required":true,"type":"bank"},{"id":"reference","label":"Referencia","required":true}]'::jsonb, false, 5),
    ('cash_local', 'Efectivo ' || coalesce(v_local, v_base), coalesce(v_local, v_base), 'cash', '[]'::jsonb, false, 6),
    ('cashea', 'Cashea', 'USD', 'bnpl', '[{"id":"reference","label":"N.º de orden"}]'::jsonb, false, 7)
  ) as m(code, name, currency, kind, fields, applies_igtf, position)
  -- Sin moneda local, el efectivo local sería el mismo que el de la base.
  where not (m.code = 'cash_local' and v_local is null)
    and not (m.code = 'zelle' and v_base <> 'USD')
  on conflict (tenant_id, code) do nothing;
end;
$$;
revoke all on function app.seed_tenant_defaults(uuid) from public;

create or replace function app.tenants_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_tenant_defaults(new.id);
  return new;
end;
$$;
revoke all on function app.tenants_after_insert() from public;

create trigger tenants_seed_defaults after insert on public.tenants
  for each row execute function app.tenants_after_insert();

select app.seed_tenant_defaults(id) from public.tenants;

-- ---------------------------------------------------------------------------
-- Tasa vigente
-- ---------------------------------------------------------------------------

-- Tasa base→local que rige para el tenant en un momento. Con rate_source
-- 'manual', la última tasa propia; con 'bcv', la oficial cuya fecha valor ya
-- empezó (hora de Caracas), prefiriendo la del BCV sobre la de respaldo.
create or replace function app.rate_at(p_tenant_id uuid, p_at timestamptz default now())
returns table (rate numeric, source text, effective_date date, fetched_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_day date := (p_at at time zone 'America/Caracas')::date;
begin
  select * into t from public.tenants where id = p_tenant_id;
  if not found or t.local_currency is null then
    return;
  end if;

  if t.rate_source = 'manual' then
    return query
    select r.rate, 'manual'::text, (r.created_at at time zone 'America/Caracas')::date, r.created_at
    from public.tenant_rates r
    where r.tenant_id = t.id and r.base_currency = t.base_currency and r.quote_currency = t.local_currency
      and r.created_at <= p_at
    order by r.created_at desc
    limit 1;
    return;
  end if;

  return query
  select e.rate, e.source, e.effective_date, e.fetched_at
  from public.exchange_rates e
  where e.base_currency = t.base_currency and e.quote_currency = t.local_currency
    and e.effective_date <= v_day
  order by e.effective_date desc, (e.source = 'bcv') desc, e.fetched_at desc
  limit 1;
end;
$$;
revoke all on function app.rate_at(uuid, timestamptz) from public;
grant execute on function app.rate_at(uuid, timestamptz) to authenticated;

-- Para el cliente: tasa vigente del negocio activo y si está vieja (más de un
-- día hábil sin publicación nueva).
create or replace function app.current_rate()
returns table (rate numeric, source text, effective_date date, fetched_at timestamptz, stale boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  return query
  select r.rate, r.source, r.effective_date, r.fetched_at,
         -- Lunes a viernes el BCV publica cada día; un fin de semana no deja la tasa vieja.
         (v_today - r.effective_date) > case extract(isodow from v_today) when 1 then 3 when 7 then 2 else 1 end
  from app.rate_at(v_tenant) r;
end;
$$;
revoke all on function app.current_rate() from public;
grant execute on function app.current_rate() to authenticated;

create function public.current_rate()
returns table (rate numeric, source text, effective_date date, fetched_at timestamptz, stale boolean)
language sql stable security invoker set search_path = '' as $$
  select * from app.current_rate()
$$;
revoke all on function public.current_rate() from public, anon;
grant execute on function public.current_rate() to authenticated;
