-- Fichaje como el ERP: PIN personal y revisión en lote.
--
-- Portado de SublimeFichajePublico y SublimeAdminFichaje (basicosystems@9cb08cd):
--   * El PIN que asigna el encargado es temporal: la primera vez que la persona
--     entra al enlace, crea su PIN personal (el encargado no lo conoce). Con el
--     PIN temporal no se ficha.
--   * Revisar varios fichajes a la vez (aprobar o rechazar con motivo). En el
--     ERP se borraban; aquí un rechazo deja el registro y no cuenta en las horas.

alter table public.cashiers add column pin_temporary boolean not null default false;
grant select (pin_temporary) on public.cashiers to authenticated;

-- Reglas de un PIN para una persona del negocio.
create or replace function app.check_staff_pin(p_tenant uuid, p_staff_id uuid, p_pin text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'El PIN son 6 números' using errcode = 'check_violation';
  end if;
  if p_pin ~ '^(.)\1{5}$' or p_pin in ('123456', '654321', '012345', '123123') then
    raise exception 'Ese PIN es muy fácil de adivinar' using errcode = 'check_violation';
  end if;
  -- El PIN identifica a la persona: no puede repetirse en el negocio.
  if exists (select 1 from public.cashiers c
             where c.tenant_id = p_tenant and c.id <> p_staff_id and c.pin_hash is not null
               and c.pin_hash = extensions.crypt(p_pin, c.pin_hash)) then
    raise exception 'Ese PIN ya lo usa otra persona del equipo' using errcode = 'unique_violation';
  end if;
end;
$$;
revoke all on function app.check_staff_pin(uuid, uuid, text) from public;

-- El PIN del encargado queda como temporal.
create or replace function app.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado asignan PIN' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'fichaje', 'Fichaje');
  if p_pin is null then
    update public.cashiers set pin_hash = null, pin_set_at = null, clock_enabled = false, pin_temporary = false
    where id = p_staff_id and tenant_id = v_tenant;
  else
    perform app.check_staff_pin(v_tenant, p_staff_id, p_pin);
    update public.cashiers
    set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_set_at = now(), clock_enabled = true, pin_temporary = true
    where id = p_staff_id and tenant_id = v_tenant;
  end if;
  if not found then
    raise exception 'Persona no encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Quién es (o por qué no). Con PIN temporal pide crear el personal.
create or replace function app.clock_identify(p_key text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_staff public.cashiers;
begin
  select * into t from public.tenants where clock_key = p_key;
  if not found or t.status <> 'active' or coalesce((app.entitled(t.id, 'fichaje'))::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Este enlace de fichaje no está activo. Pide el enlace nuevo a tu encargado.');
  end if;
  if (select count(*) from public.clock_pin_failures f where f.tenant_id = t.id and f.created_at > now() - interval '15 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Espera unos minutos.');
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{6}$' then
    select * into v_staff from public.cashiers c
    where c.tenant_id = t.id and c.is_active and c.clock_enabled and c.pin_hash is not null
      and c.pin_hash = extensions.crypt(p_pin, c.pin_hash)
    limit 1;
  end if;
  if v_staff.id is null then
    insert into public.clock_pin_failures (tenant_id) values (t.id);
    return jsonb_build_object('ok', false, 'error', 'PIN incorrecto');
  end if;
  if v_staff.pin_temporary then
    return jsonb_build_object('ok', false, 'needs_pin_setup', true, 'name', v_staff.name,
                              'error', 'Crea tu PIN personal para empezar a fichar');
  end if;
  return jsonb_build_object('ok', true, 'tenant_id', t.id, 'staff_id', v_staff.id);
end;
$$;

-- Primera entrada: con el PIN temporal, la persona crea el suyo.
create or replace function app.clock_set_personal_pin(p_key text, p_temp_pin text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_staff public.cashiers;
begin
  select * into t from public.tenants where clock_key = p_key;
  if not found or t.status <> 'active' or coalesce((app.entitled(t.id, 'fichaje'))::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Este enlace de fichaje no está activo. Pide el enlace nuevo a tu encargado.');
  end if;
  if (select count(*) from public.clock_pin_failures f where f.tenant_id = t.id and f.created_at > now() - interval '15 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Espera unos minutos.');
  end if;
  if p_temp_pin is not null and p_temp_pin ~ '^[0-9]{6}$' then
    select * into v_staff from public.cashiers c
    where c.tenant_id = t.id and c.is_active and c.clock_enabled and c.pin_temporary and c.pin_hash is not null
      and c.pin_hash = extensions.crypt(p_temp_pin, c.pin_hash)
    limit 1;
  end if;
  if v_staff.id is null then
    insert into public.clock_pin_failures (tenant_id) values (t.id);
    return jsonb_build_object('ok', false, 'error', 'PIN incorrecto');
  end if;
  if p_new_pin = p_temp_pin then
    return jsonb_build_object('ok', false, 'error', 'Elige un PIN distinto al que te dieron');
  end if;
  begin
    perform app.check_staff_pin(t.id, v_staff.id, p_new_pin);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  update public.cashiers
  set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)), pin_set_at = now(), pin_temporary = false
  where id = v_staff.id;
  return app.clock_lookup(p_key, p_new_pin);
end;
$$;
revoke all on function app.clock_set_personal_pin(text, text, text) from public;
grant execute on function app.clock_set_personal_pin(text, text, text) to anon, authenticated;

create function public.clock_set_personal_pin(p_key text, p_temp_pin text, p_new_pin text)
returns jsonb language sql security invoker set search_path = '' as $$ select app.clock_set_personal_pin(p_key, p_temp_pin, p_new_pin) $$;
revoke all on function public.clock_set_personal_pin(text, text, text) from public;
grant execute on function public.clock_set_personal_pin(text, text, text) to anon, authenticated;

-- Revisión en lote: aprobar o rechazar varios fichajes con un motivo.
create or replace function app.review_clock_events(p_event_ids uuid[], p_status text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_count integer;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado revisan fichajes' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('aprobado', 'rechazado') then
    raise exception 'Estado no válido' using errcode = 'check_violation';
  end if;
  if p_status = 'rechazado' and nullif(trim(p_note), '') is null then
    raise exception 'Indica por qué se rechazan' using errcode = 'check_violation';
  end if;
  if cardinality(p_event_ids) > 500 then
    raise exception 'Máximo 500 fichajes a la vez' using errcode = 'check_violation';
  end if;
  update public.clock_events
  set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
      note = coalesce(nullif(trim(p_note), ''), note)
  where tenant_id = v_tenant and id = any (p_event_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.review_clock_events(uuid[], text, text) from public;
grant execute on function app.review_clock_events(uuid[], text, text) to authenticated;

create function public.review_clock_events(p_event_ids uuid[], p_status text, p_note text default null)
returns integer language sql security invoker set search_path = '' as $$ select app.review_clock_events(p_event_ids, p_status, p_note) $$;
revoke all on function public.review_clock_events(uuid[], text, text) from public, anon;
grant execute on function public.review_clock_events(uuid[], text, text) to authenticated;
