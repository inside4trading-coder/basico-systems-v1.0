-- Suspensión en la base, no solo en la pantalla.
--
-- Un negocio suspendido (tenants.status = 'suspended', lo fija la plataforma)
-- deja de tener negocio activo: current_tenant_id() devuelve null, así que las
-- policies de todas las tablas de negocio no muestran nada y los inserts
-- fallan. Sus miembros siguen viendo el negocio y su estado en tenants y
-- tenant_members (lo necesita la pantalla de «cuenta suspendida»), y la
-- plataforma lo reactiva desde sus funciones, que no dependen de esto.

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
  if v_id in (select app.auth_tenant_ids())
     and exists (select 1 from public.tenants t where t.id = v_id and t.status = 'active') then
    return v_id;
  end if;
  return null;
end;
$$;
