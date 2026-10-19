-- Planes y límites: los módulos y cuotas de cada negocio se hacen cumplir en
-- la base, no solo en la pantalla.
--
-- Los valores por defecto viven en src/core/entitlements.ts y aquí en
-- app.entitlement_defaults(); un test (entitlements.test.ts) compara ambos.
-- tenant_entitlements guarda solo las excepciones (un negocio con más sedes,
-- un complemento activado) y la escribe la plataforma, no el cliente.
--   * Cuotas: sedes activas, cajas activas y usuarios del equipo.
--   * Módulos: sin POS no se abre caja; sin Administración no se crean
--     cuentas; sin Reportes no se consultan reportes.

create or replace function app.entitlement_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'pos', true, 'inventario', true, 'administracion', true, 'reportes', true,
    'fichaje', false, 'estudio', false, 'cashea', false,
    'can_export', true,
    'max_locations', 1, 'max_registers', 2, 'max_users', 5, 'estudio_images_per_month', 0
  )
$$;

-- Valor vigente: la excepción del negocio o el default.
create or replace function app.entitled(p_tenant_id uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.tenant_entitlement(p_tenant_id, p_key, app.entitlement_defaults() -> p_key)
$$;
revoke all on function app.entitled(uuid, text) from public;
grant execute on function app.entitled(uuid, text) to authenticated;

create or replace function app.require_module(p_tenant_id uuid, p_key text, p_label text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((app.entitled(p_tenant_id, p_key))::boolean, false) is not true then
    raise exception '% no está incluido en el plan de este negocio', p_label using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function app.require_module(uuid, text, text) from public;
grant execute on function app.require_module(uuid, text, text) to authenticated;

create or replace function app.require_quota(p_tenant_id uuid, p_key text, p_used bigint, p_label text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := coalesce((app.entitled(p_tenant_id, p_key))::integer, 0);
begin
  if p_used >= v_limit then
    raise exception 'Tu plan incluye % %. Escríbenos para ampliarlo.', v_limit, p_label using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function app.require_quota(uuid, text, bigint, text) from public;

-- ---------------------------------------------------------------------------
-- Cuotas
-- ---------------------------------------------------------------------------

create or replace function app.enforce_location_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    perform app.require_quota(new.tenant_id, 'max_locations',
      (select count(*) from public.locations where tenant_id = new.tenant_id and deleted_at is null and id <> new.id),
      case when coalesce((app.entitled(new.tenant_id, 'max_locations'))::integer, 0) = 1 then 'sede' else 'sedes' end);
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_location_quota() from public;
create trigger locations_quota before insert or update of deleted_at on public.locations
  for each row execute function app.enforce_location_quota();

create or replace function app.enforce_register_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    perform app.require_quota(new.tenant_id, 'max_registers',
      (select count(*) from public.registers where tenant_id = new.tenant_id and is_active and id <> new.id),
      case when coalesce((app.entitled(new.tenant_id, 'max_registers'))::integer, 0) = 1 then 'caja activa' else 'cajas activas' end);
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_register_quota() from public;
create trigger registers_quota before insert or update of is_active on public.registers
  for each row execute function app.enforce_register_quota();

create or replace function app.enforce_member_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_quota(new.tenant_id, 'max_users',
    (select count(*) from public.tenant_members where tenant_id = new.tenant_id),
    case when coalesce((app.entitled(new.tenant_id, 'max_users'))::integer, 0) = 1 then 'usuario' else 'usuarios' end);
  return new;
end;
$$;
revoke all on function app.enforce_member_quota() from public;
create trigger tenant_members_quota before insert on public.tenant_members
  for each row execute function app.enforce_member_quota();

-- ---------------------------------------------------------------------------
-- Módulos
-- ---------------------------------------------------------------------------

create or replace function app.enforce_pos_module()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(new.tenant_id, 'pos', 'El punto de venta');
  return new;
end;
$$;
revoke all on function app.enforce_pos_module() from public;
create trigger cash_sessions_pos_module before insert on public.cash_sessions
  for each row execute function app.enforce_pos_module();

create or replace function app.enforce_finance_module()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(new.tenant_id, 'administracion', 'Administración');
  return new;
end;
$$;
revoke all on function app.enforce_finance_module() from public;
create trigger finance_accounts_module before insert on public.finance_accounts
  for each row execute function app.enforce_finance_module();

create or replace function app.report_tenant()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Los reportes son para dueños, administradores y encargados' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'reportes', 'Reportes');
  return v_tenant;
end;
$$;

-- Uso del plan para la pantalla (dueño y administrador).
create or replace function app.plan_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin']) then
    raise exception 'Solo dueño o administrador' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'locations', (select count(*) from public.locations where tenant_id = v_tenant and deleted_at is null),
    'registers', (select count(*) from public.registers where tenant_id = v_tenant and is_active),
    'users', (select count(*) from public.tenant_members where tenant_id = v_tenant)
  );
end;
$$;
revoke all on function app.plan_usage() from public;
grant execute on function app.plan_usage() to authenticated;

create function public.plan_usage()
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.plan_usage() $$;
revoke all on function public.plan_usage() from public, anon;
grant execute on function public.plan_usage() to authenticated;
