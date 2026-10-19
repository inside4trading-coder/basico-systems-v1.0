-- Acceso por sede: un encargado o cajero puede quedar limitado a ciertas
-- sedes.
--
-- Portado de esp_user_location_access (basicosystems@f551478b). Reglas:
--   * Sin filas para un usuario: trabaja en todas las sedes (lo de siempre).
--     Con filas: solo en esas. Dueño y administrador, siempre en todas.
--   * Se hace cumplir donde se mueve stock o dinero de una sede: cada
--     movimiento de inventario (entradas, ajustes, traslados, ventas,
--     devoluciones) y la apertura de caja. Un traslado necesita acceso a las
--     dos sedes.
--   * Solo dueño y administrador asignan sedes.

create table public.member_locations (
  tenant_id uuid not null,
  user_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, location_id),
  foreign key (tenant_id, user_id) references public.tenant_members (tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade
);

alter table public.member_locations enable row level security;
revoke all on public.member_locations from anon;
revoke update on public.member_locations from authenticated;
create policy tenant_read on public.member_locations for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy team_insert on public.member_locations for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy team_delete on public.member_locations for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));

-- ¿El usuario de la sesión trabaja en esa sede? Sin sesión (procesos
-- internos) no se limita.
create or replace function app.can_use_location(p_tenant_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
      or app.has_tenant_role(p_tenant_id, array['owner', 'admin'])
      or not exists (select 1 from public.member_locations ml where ml.tenant_id = p_tenant_id and ml.user_id = auth.uid())
      or exists (select 1 from public.member_locations ml
                 where ml.tenant_id = p_tenant_id and ml.user_id = auth.uid() and ml.location_id = p_location_id)
$$;
revoke all on function app.can_use_location(uuid, uuid) from public;
grant execute on function app.can_use_location(uuid, uuid) to authenticated;

create or replace function app.enforce_location_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_use_location(new.tenant_id, new.location_id) then
    raise exception 'No tienes acceso a la sede %', coalesce((select name from public.locations where id = new.location_id), '')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_location_access() from public;

create trigger inventory_movements_location_access before insert on public.inventory_movements
  for each row execute function app.enforce_location_access();
create trigger cash_sessions_location_access before insert on public.cash_sessions
  for each row execute function app.enforce_location_access();
