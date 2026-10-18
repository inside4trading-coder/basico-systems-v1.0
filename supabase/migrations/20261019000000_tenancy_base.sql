-- Base de tenancy de Basico Systems v1.0.
--
-- Modelo: esquema compartido. Toda tabla de negocio lleva tenant_id y la
-- policy de aislamiento; lo único global se marca a propósito con
-- COMMENT ON TABLE ... IS '@global ...' (o '@tenant-root' para tenants).
-- supabase/tests/tenant_isolation.test.sql falla si alguna tabla pública no
-- cumple una de las dos cosas.
--
-- Las funciones de apoyo viven en el esquema `app`, que no expone la API REST:
-- se pueden usar en policies y defaults, pero no se llaman como RPC.

create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  -- Moneda de referencia en la que se guardan los totales (REF).
  base_currency text not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  -- Moneda local en la que también se cobra; null si el tenant opera en una sola.
  local_currency text default 'VES' check (local_currency is null or local_currency ~ '^[A-Z]{3}$'),
  rate_source text not null default 'bcv' check (rate_source in ('bcv', 'manual')),
  -- Sujeto pasivo especial: es agente de percepción del IGTF.
  is_special_taxpayer boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.tenants is '@tenant-root Cuenta de cliente del SaaS.';

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'cajero')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

-- Módulos, funciones y cuotas por tenant. Los defaults viven en código
-- (src/core/entitlements.ts); aquí solo se guardan las excepciones.
-- Los permisos de usuario NO van aquí: van en tenant_members.role.
create table public.tenant_entitlements (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value jsonb not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- ---------------------------------------------------------------------------
-- Funciones de apoyo
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenants_touch before update on public.tenants
  for each row execute function app.touch_updated_at();
create trigger tenant_members_touch before update on public.tenant_members
  for each row execute function app.touch_updated_at();
create trigger tenant_entitlements_touch before update on public.tenant_entitlements
  for each row execute function app.touch_updated_at();

-- Tenants activos del usuario actual. SECURITY DEFINER para que las policies
-- de tenant_members no se consulten a sí mismas en bucle.
create or replace function app.auth_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
    and t.deleted_at is null
$$;

create or replace function app.has_tenant_role(p_tenant_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
      and t.deleted_at is null
  )
$$;

-- Tenant activo de la request. El front lo manda en el header x-tenant-id
-- (src/core/supabase.ts). El header solo elige entre los tenants del usuario:
-- si no es un uuid o el usuario no es miembro, devuelve null y cualquier
-- insert con tenant_id NOT NULL falla.
create or replace function app.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_id uuid;
begin
  begin
    v_raw := current_setting('request.headers', true)::json ->> 'x-tenant-id';
  exception when others then
    return null;
  end;

  if v_raw is null
     or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  v_id := v_raw::uuid;
  if v_id in (select app.auth_tenant_ids()) then
    return v_id;
  end if;
  return null;
end;
$$;

-- Valor efectivo de un entitlement: la excepción vigente del tenant o el
-- default que pasa quien llama (los defaults viven en código).
create or replace function app.tenant_entitlement(p_tenant_id uuid, p_key text, p_default jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.value
     from public.tenant_entitlements e
     where e.tenant_id = p_tenant_id
       and e.key = p_key
       and (e.expires_at is null or e.expires_at > now())),
    p_default
  )
$$;

revoke all on function app.auth_tenant_ids() from public;
revoke all on function app.has_tenant_role(uuid, text[]) from public;
revoke all on function app.current_tenant_id() from public;
revoke all on function app.tenant_entitlement(uuid, text, jsonb) from public;
revoke all on function app.touch_updated_at() from public;
grant execute on function app.auth_tenant_ids() to authenticated;
grant execute on function app.has_tenant_role(uuid, text[]) to authenticated;
grant execute on function app.current_tenant_id() to authenticated;
grant execute on function app.tenant_entitlement(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.tenant_entitlements enable row level security;

-- Nada de esto es público para anon.
revoke all on public.tenants, public.tenant_members, public.tenant_entitlements from anon;

-- tenants: el miembro ve su cuenta; owner/admin la editan. Alta y baja de
-- tenants solo desde la plataforma (service_role), nunca desde el cliente.
create policy tenants_select on public.tenants
  for select to authenticated
  using (id in (select app.auth_tenant_ids()));

create policy tenants_update on public.tenants
  for update to authenticated
  using (app.has_tenant_role(id, array['owner', 'admin']))
  with check (app.has_tenant_role(id, array['owner', 'admin']));

-- status y deleted_at los maneja la plataforma (cobro, suspensión), no el cliente.
revoke update on public.tenants from authenticated;
grant update (name, base_currency, local_currency, rate_source, is_special_taxpayer)
  on public.tenants to authenticated;

-- tenant_members: los miembros ven al equipo; owner/admin lo gestionan, y
-- solo un owner puede dar, quitar o tocar el rol owner.
create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));

create policy tenant_members_insert on public.tenant_members
  for insert to authenticated
  with check (
    app.has_tenant_role(tenant_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_tenant_role(tenant_id, array['owner']))
  );

create policy tenant_members_update on public.tenant_members
  for update to authenticated
  using (
    app.has_tenant_role(tenant_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_tenant_role(tenant_id, array['owner']))
  )
  with check (
    app.has_tenant_role(tenant_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_tenant_role(tenant_id, array['owner']))
  );

create policy tenant_members_delete on public.tenant_members
  for delete to authenticated
  using (
    app.has_tenant_role(tenant_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_tenant_role(tenant_id, array['owner']))
  );

-- Mover a alguien de un tenant a otro no se hace por update: se borra y se invita.
revoke update on public.tenant_members from authenticated;
grant update (role) on public.tenant_members to authenticated;

-- Un tenant nunca se queda sin owner.
create or replace function app.keep_one_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.tenant_members m
       where m.tenant_id = old.tenant_id
         and m.role = 'owner'
         and m.user_id <> old.user_id
     )
     and exists (select 1 from public.tenants t where t.id = old.tenant_id)
  then
    raise exception 'El tenant % se quedaría sin owner', old.tenant_id
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function app.keep_one_owner() from public;

create trigger tenant_members_keep_owner
  before update or delete on public.tenant_members
  for each row execute function app.keep_one_owner();

-- tenant_entitlements: el miembro los lee (para mostrar módulos y cuotas);
-- solo la plataforma los escribe.
create policy tenant_entitlements_select on public.tenant_entitlements
  for select to authenticated
  using (tenant_id in (select app.auth_tenant_ids()));

revoke insert, update, delete on public.tenant_entitlements from authenticated;

-- ---------------------------------------------------------------------------
-- Patrón para cada tabla de negocio nueva (copiar en su migración):
--
--   tenant_id uuid not null default app.current_tenant_id()
--     references public.tenants (id) on delete cascade,
--   ...
--   create index <tabla>_tenant_idx on public.<tabla> (tenant_id, ...);
--   alter table public.<tabla> enable row level security;
--   revoke all on public.<tabla> from anon;
--   create policy tenant_isolation on public.<tabla> for all to authenticated
--     using (tenant_id in (select app.auth_tenant_ids()))
--     with check (tenant_id in (select app.auth_tenant_ids()));
-- ---------------------------------------------------------------------------
