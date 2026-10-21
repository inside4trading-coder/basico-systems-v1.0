-- El cajero se elige al abrir la caja.
--
-- Portado de la apertura con cajero del POS (basicosystems@9cb08cd):
--   * cash_sessions.cashier_id: quién atiende la sesión. Al abrir, es
--     obligatorio si la sede tiene personal activo que atiende el POS.
--   * change_session_cashier: relevo durante el día; queda registro de cada
--     cambio en cash_session_cashiers (quién entró, quién lo hizo y cuándo).
--   * Cada venta sin cajero explícito toma el de la sesión.
-- La apertura interna de tres argumentos (la usa el demo) no cambia.

alter table public.cash_sessions add column cashier_id uuid;
alter table public.cash_sessions add constraint cash_sessions_cashier_fk
  foreign key (tenant_id, cashier_id) references public.cashiers (tenant_id, id);
create index cash_sessions_cashier_idx on public.cash_sessions (tenant_id, cashier_id) where cashier_id is not null;

create table public.cash_session_cashiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  cashier_id uuid not null,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, session_id) references public.cash_sessions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, cashier_id) references public.cashiers (tenant_id, id)
);
create index cash_session_cashiers_session_idx on public.cash_session_cashiers (tenant_id, session_id, changed_at);

alter table public.cash_session_cashiers enable row level security;
revoke all on public.cash_session_cashiers from anon, authenticated;
grant select on public.cash_session_cashiers to authenticated;
create policy tenant_read on public.cash_session_cashiers for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Personal que puede atender una caja de la sede (o de todas las sedes).
create or replace function app.session_cashier_ok(p_tenant_id uuid, p_location_id uuid, p_cashier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cashiers c
    where c.id = p_cashier_id and c.tenant_id = p_tenant_id and c.is_active and c.works_pos
      and (c.location_id is null or c.location_id = p_location_id))
$$;
revoke all on function app.session_cashier_ok(uuid, uuid, uuid) from public;

create or replace function app.open_cash_session(p_register_id uuid, p_opening jsonb, p_note text, p_cashier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.registers;
  v_result jsonb;
  v_session uuid;
begin
  select * into r from public.registers where id = p_register_id;
  if not found or r.tenant_id not in (select app.auth_tenant_ids()) then
    raise exception 'Caja no encontrada' using errcode = 'no_data_found';
  end if;
  if p_cashier_id is null then
    if exists (select 1 from public.cashiers c
               where c.tenant_id = r.tenant_id and c.is_active and c.works_pos
                 and (c.location_id is null or c.location_id = r.location_id)) then
      raise exception 'Elige quién abre la caja' using errcode = 'check_violation';
    end if;
  elsif not app.session_cashier_ok(r.tenant_id, r.location_id, p_cashier_id) then
    raise exception 'Cajero no disponible en esta sede' using errcode = 'no_data_found';
  end if;

  v_result := app.open_cash_session(p_register_id, p_opening, p_note);
  v_session := (v_result ->> 'session_id')::uuid;
  if p_cashier_id is not null then
    update public.cash_sessions set cashier_id = p_cashier_id where id = v_session;
    insert into public.cash_session_cashiers (tenant_id, session_id, cashier_id) values (r.tenant_id, v_session, p_cashier_id);
  end if;
  return v_result || jsonb_build_object('cashier_id', p_cashier_id);
end;
$$;
revoke all on function app.open_cash_session(uuid, jsonb, text, uuid) from public;
grant execute on function app.open_cash_session(uuid, jsonb, text, uuid) to authenticated;

-- Relevo de cajero con la caja abierta.
create or replace function app.change_session_cashier(p_session_id uuid, p_cashier_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cash_sessions;
begin
  s := app.session_for_write(p_session_id);
  if p_cashier_id is null or not app.session_cashier_ok(s.tenant_id, s.location_id, p_cashier_id) then
    raise exception 'Cajero no disponible en esta sede' using errcode = 'no_data_found';
  end if;
  if s.cashier_id is not distinct from p_cashier_id then
    return;
  end if;
  update public.cash_sessions set cashier_id = p_cashier_id where id = s.id;
  insert into public.cash_session_cashiers (tenant_id, session_id, cashier_id) values (s.tenant_id, s.id, p_cashier_id);
end;
$$;
revoke all on function app.change_session_cashier(uuid, uuid) from public;
grant execute on function app.change_session_cashier(uuid, uuid) to authenticated;

-- Venta sin cajero: el de la sesión.
create or replace function app.sales_default_cashier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cashier_id is null and new.session_id is not null then
    select cashier_id into new.cashier_id from public.cash_sessions where id = new.session_id;
  end if;
  return new;
end;
$$;
revoke all on function app.sales_default_cashier() from public;
create trigger sales_default_cashier before insert on public.sales
  for each row execute function app.sales_default_cashier();

-- Wrappers: la apertura pública pasa a recibir el cajero.
drop function public.open_cash_session(uuid, jsonb, text);
create function public.open_cash_session(p_register_id uuid, p_opening jsonb default '[]', p_note text default null, p_cashier_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.open_cash_session(p_register_id, p_opening, p_note, p_cashier_id)
$$;
create function public.change_session_cashier(p_session_id uuid, p_cashier_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select app.change_session_cashier(p_session_id, p_cashier_id)
$$;
revoke all on function public.open_cash_session(uuid, jsonb, text, uuid) from public, anon;
revoke all on function public.change_session_cashier(uuid, uuid) from public, anon;
grant execute on function public.open_cash_session(uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.change_session_cashier(uuid, uuid) to authenticated;
