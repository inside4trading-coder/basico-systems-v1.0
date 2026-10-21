-- Fichaje del personal (add-on "fichaje").
--
-- Portado de SublimeAdminFichaje, SublimeFichajePublico y las funciones
-- sublime-clock-event / sublime-pin-* (basicosystems@f551478b), sin edge
-- functions ni clave de servicio: todo en la base.
--   * El "personal de caja" pasa a ser el personal del negocio (cashiers):
--     cargo, si atiende el POS, horario, tolerancia y PIN de 6 dígitos
--     (pgcrypto crypt/bf, nunca legible desde la app).
--   * Cada sede puede tener ubicación y radio. Se ficha desde el teléfono en
--     /fichar/<clave del negocio> con el PIN: la base valida que esté dentro
--     del radio de su sede. Sin ubicación cargada en la sede, el fichaje queda
--     "por revisar".
--   * Intentos fallidos de PIN por negocio limitados (20 en 15 minutos).
--   * Dueño, administrador o encargado ven los fichajes, agregan uno a mano
--     y aprueban o rechazan los que quedaron por revisar.

-- ---------------------------------------------------------------------------
-- Personal
-- ---------------------------------------------------------------------------

alter table public.cashiers
  add column job_title text check (job_title is null or length(trim(job_title)) between 1 and 40),
  add column works_pos boolean not null default true,
  add column clock_enabled boolean not null default false,
  add column pin_hash text,
  add column pin_set_at timestamptz,
  add column work_days smallint[] not null default '{1,2,3,4,5,6}' check (work_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  add column entry_time time,
  add column exit_time time,
  add column break_minutes integer not null default 60 check (break_minutes between 0 and 240),
  add column late_tolerance integer not null default 10 check (late_tolerance between 0 and 120);

-- El hash del PIN no se lee desde la app.
revoke select on public.cashiers from authenticated;
grant select (id, tenant_id, name, location_id, is_active, created_at, job_title, works_pos, clock_enabled, pin_set_at,
              work_days, entry_time, exit_time, break_minutes, late_tolerance)
  on public.cashiers to authenticated;
grant update (job_title, works_pos, work_days, entry_time, exit_time, break_minutes, late_tolerance)
  on public.cashiers to authenticated;

-- ---------------------------------------------------------------------------
-- Sedes con ubicación y clave del negocio
-- ---------------------------------------------------------------------------

alter table public.locations
  add column latitude double precision check (latitude is null or latitude between -90 and 90),
  add column longitude double precision check (longitude is null or longitude between -180 and 180),
  add column clock_radius_m integer not null default 100 check (clock_radius_m between 20 and 2000),
  add constraint locations_coords_pair check ((latitude is null) = (longitude is null));

alter table public.tenants add column clock_key text unique
  default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_');
update public.tenants set clock_key = translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_') where clock_key is null;
alter table public.tenants alter column clock_key set not null;

-- ---------------------------------------------------------------------------
-- Fichajes
-- ---------------------------------------------------------------------------

create table public.clock_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  staff_id uuid not null,
  location_id uuid,
  kind text not null check (kind in ('entrada', 'salida', 'inicio_descanso', 'fin_descanso')),
  event_at timestamptz not null default now(),
  source text not null default 'telefono' check (source in ('telefono', 'admin')),
  latitude double precision,
  longitude double precision,
  accuracy_m numeric(10, 1),
  distance_m numeric(10, 1),
  late_minutes integer,
  status text not null default 'ok' check (status in ('ok', 'revisar', 'aprobado', 'rechazado')),
  note text check (note is null or length(note) <= 300),
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, staff_id) references public.cashiers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id)
);
create index clock_events_staff_idx on public.clock_events (tenant_id, staff_id, event_at desc);
create index clock_events_day_idx on public.clock_events (tenant_id, event_at desc);

alter table public.clock_events enable row level security;
revoke all on public.clock_events from anon, authenticated;
grant select on public.clock_events to authenticated;
create policy managers_read on public.clock_events for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

-- Intentos de PIN fallidos (solo para limitar). Nadie la lee desde la app.
create table public.clock_pin_failures (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index clock_pin_failures_idx on public.clock_pin_failures (tenant_id, created_at desc);
alter table public.clock_pin_failures enable row level security;
revoke all on public.clock_pin_failures from anon, authenticated;

-- ---------------------------------------------------------------------------
-- PIN y clave
-- ---------------------------------------------------------------------------

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
    update public.cashiers set pin_hash = null, pin_set_at = null, clock_enabled = false
    where id = p_staff_id and tenant_id = v_tenant;
  else
    if p_pin !~ '^[0-9]{6}$' then
      raise exception 'El PIN son 6 números' using errcode = 'check_violation';
    end if;
    if p_pin ~ '^(.)\1{5}$' or p_pin in ('123456', '654321', '012345', '123123') then
      raise exception 'Ese PIN es muy fácil de adivinar' using errcode = 'check_violation';
    end if;
    -- El PIN identifica a la persona: no puede repetirse en el negocio.
    if exists (select 1 from public.cashiers c
               where c.tenant_id = v_tenant and c.id <> p_staff_id and c.pin_hash is not null
                 and c.pin_hash = extensions.crypt(p_pin, c.pin_hash)) then
      raise exception 'Ese PIN ya lo usa otra persona del equipo' using errcode = 'unique_violation';
    end if;
    update public.cashiers set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_set_at = now(), clock_enabled = true
    where id = p_staff_id and tenant_id = v_tenant;
  end if;
  if not found then
    raise exception 'Persona no encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.set_staff_pin(uuid, text) from public;
grant execute on function app.set_staff_pin(uuid, text) to authenticated;

create or replace function app.regenerate_clock_key()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_key text;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin']) then
    raise exception 'Solo dueño o administrador cambian el enlace de fichaje' using errcode = 'insufficient_privilege';
  end if;
  v_key := translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_');
  update public.tenants set clock_key = v_key where id = v_tenant;
  return v_key;
end;
$$;
revoke all on function app.regenerate_clock_key() from public;
grant execute on function app.regenerate_clock_key() to authenticated;

create or replace function app.clock_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.clock_key from public.tenants t
  where t.id = app.current_tenant_id() and app.has_tenant_role(t.id, array['owner', 'admin', 'manager'])
$$;
revoke all on function app.clock_key() from public;
grant execute on function app.clock_key() to authenticated;

-- ---------------------------------------------------------------------------
-- Fichar desde el teléfono (sin sesión): clave del negocio + PIN.
-- ---------------------------------------------------------------------------

-- Distancia en metros entre dos puntos (haversine).
create or replace function app.distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;
revoke all on function app.distance_m(double precision, double precision, double precision, double precision) from public;

-- Quién es (o por qué no). Devuelve el error en vez de lanzarlo para que el
-- intento fallido quede registrado.
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
  return jsonb_build_object('ok', true, 'tenant_id', t.id, 'staff_id', v_staff.id);
end;
$$;
revoke all on function app.clock_identify(text, text) from public;

-- Fichajes de hoy (hora de Caracas) y lo que toca ahora.
create or replace function app.clock_today(p_tenant uuid, p_staff uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    select e.kind, e.event_at, e.status
    from public.clock_events e
    where e.tenant_id = p_tenant and e.staff_id = p_staff and e.status <> 'rechazado'
      and e.event_at >= app.caracas_day_start((now() at time zone 'America/Caracas')::date)
    order by e.event_at
  ),
  last_ev as (select kind from ev order by event_at desc limit 1)
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'at', event_at, 'status', status) order by event_at) from ev), '[]'::jsonb),
    'allowed', case (select kind from last_ev)
      when 'entrada' then '["inicio_descanso", "salida"]'::jsonb
      when 'inicio_descanso' then '["fin_descanso"]'::jsonb
      when 'fin_descanso' then '["inicio_descanso", "salida"]'::jsonb
      else '["entrada"]'::jsonb
    end)
$$;
revoke all on function app.clock_today(uuid, uuid) from public;

create or replace function app.clock_lookup(p_key text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_who jsonb := app.clock_identify(p_key, p_pin);
  v_staff public.cashiers;
begin
  if not (v_who ->> 'ok')::boolean then
    return v_who;
  end if;
  select * into v_staff from public.cashiers where id = (v_who ->> 'staff_id')::uuid;
  return jsonb_build_object(
    'ok', true,
    'name', v_staff.name,
    'business', (select name from public.tenants where id = v_staff.tenant_id),
    'location', (select name from public.locations where id = v_staff.location_id),
    'needs_location', exists (
      select 1 from public.locations l
      where l.tenant_id = v_staff.tenant_id and l.is_active and l.deleted_at is null and l.latitude is not null
        and (v_staff.location_id is null or l.id = v_staff.location_id)),
    'today', app.clock_today(v_staff.tenant_id, v_staff.id));
end;
$$;
revoke all on function app.clock_lookup(text, text) from public;
grant execute on function app.clock_lookup(text, text) to anon, authenticated;

create or replace function app.clock_punch(
  p_key text, p_pin text, p_kind text,
  p_latitude double precision default null, p_longitude double precision default null, p_accuracy numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_who jsonb := app.clock_identify(p_key, p_pin);
  v_staff public.cashiers;
  v_loc public.locations;
  v_today jsonb;
  v_last public.clock_events;
  v_distance double precision;
  v_status text := 'ok';
  v_late integer;
  v_local timestamp := now() at time zone 'America/Caracas';
  v_id uuid;
begin
  if not (v_who ->> 'ok')::boolean then
    return v_who;
  end if;
  select * into v_staff from public.cashiers where id = (v_who ->> 'staff_id')::uuid;
  if p_kind is null or p_kind not in ('entrada', 'salida', 'inicio_descanso', 'fin_descanso') then
    return jsonb_build_object('ok', false, 'error', 'Marca no válida');
  end if;

  -- Doble toque: la misma marca hace menos de 2 minutos no se repite.
  select * into v_last from public.clock_events e
  where e.tenant_id = v_staff.tenant_id and e.staff_id = v_staff.id and e.status <> 'rechazado'
  order by e.event_at desc limit 1;
  if v_last.id is not null and v_last.kind = p_kind and v_last.event_at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'today', app.clock_today(v_staff.tenant_id, v_staff.id));
  end if;

  v_today := app.clock_today(v_staff.tenant_id, v_staff.id);
  if not (v_today -> 'allowed') ? p_kind then
    return jsonb_build_object('ok', false, 'error', 'Esa marca no corresponde ahora', 'today', v_today);
  end if;

  -- Sede: la suya, o la más cercana con ubicación si trabaja en todas.
  if v_staff.location_id is not null then
    select * into v_loc from public.locations where id = v_staff.location_id;
  elsif p_latitude is not null and p_longitude is not null then
    select * into v_loc from public.locations l
    where l.tenant_id = v_staff.tenant_id and l.is_active and l.deleted_at is null and l.latitude is not null
    order by app.distance_m(p_latitude, p_longitude, l.latitude, l.longitude)
    limit 1;
  end if;

  if v_loc.latitude is not null then
    if p_latitude is null or p_longitude is null then
      return jsonb_build_object('ok', false, 'error', 'Activa la ubicación del teléfono para fichar');
    end if;
    v_distance := app.distance_m(p_latitude, p_longitude, v_loc.latitude, v_loc.longitude);
    -- Se descuenta parte del margen de error del GPS (hasta 50 m).
    if v_distance - least(coalesce(p_accuracy, 0), 50) > v_loc.clock_radius_m then
      return jsonb_build_object('ok', false,
        'error', format('Estás a %s m de %s: acércate para fichar', round(v_distance), v_loc.name));
    end if;
  else
    -- La sede no tiene ubicación cargada: queda para que el encargado lo revise.
    v_status := 'revisar';
  end if;

  if p_kind = 'entrada' and v_staff.entry_time is not null
     and extract(dow from v_local)::smallint = any (v_staff.work_days) then
    v_late := greatest(0, floor(extract(epoch from (v_local::time - v_staff.entry_time)) / 60)::integer);
    if v_late <= v_staff.late_tolerance then
      v_late := 0;
    end if;
  end if;

  insert into public.clock_events (tenant_id, staff_id, location_id, kind, source, latitude, longitude, accuracy_m, distance_m, late_minutes, status)
  values (v_staff.tenant_id, v_staff.id, v_loc.id, p_kind, 'telefono', p_latitude, p_longitude, p_accuracy, round(v_distance::numeric, 1), v_late, v_status)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'status', v_status, 'late_minutes', v_late,
    'location', v_loc.name, 'today', app.clock_today(v_staff.tenant_id, v_staff.id));
end;
$$;
revoke all on function app.clock_punch(text, text, text, double precision, double precision, numeric) from public;
grant execute on function app.clock_punch(text, text, text, double precision, double precision, numeric) to anon, authenticated;

-- Lo único que anon puede llamar del esquema app son estas dos funciones
-- (lo vigila tenant_isolation.test.sql).
grant usage on schema app to anon;
create function public.clock_lookup(p_key text, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$ select app.clock_lookup(p_key, p_pin) $$;
create function public.clock_punch(
  p_key text, p_pin text, p_kind text,
  p_latitude double precision default null, p_longitude double precision default null, p_accuracy numeric default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.clock_punch(p_key, p_pin, p_kind, p_latitude, p_longitude, p_accuracy)
$$;
revoke all on function public.clock_lookup(text, text) from public;
revoke all on function public.clock_punch(text, text, text, double precision, double precision, numeric) from public;
grant execute on function public.clock_lookup(text, text) to anon, authenticated;
grant execute on function public.clock_punch(text, text, text, double precision, double precision, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Encargados: fichaje a mano y revisión
-- ---------------------------------------------------------------------------

create or replace function app.add_clock_event(p_staff_id uuid, p_kind text, p_at timestamptz, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_staff public.cashiers;
  v_id uuid;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado registran fichajes' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'fichaje', 'Fichaje');
  select * into v_staff from public.cashiers where id = p_staff_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Persona no encontrada' using errcode = 'no_data_found';
  end if;
  if p_kind not in ('entrada', 'salida', 'inicio_descanso', 'fin_descanso') then
    raise exception 'Marca no válida' using errcode = 'check_violation';
  end if;
  if p_at is null or p_at > now() + interval '5 minutes' or p_at < now() - interval '62 days' then
    raise exception 'La hora debe ser de los últimos 2 meses' using errcode = 'check_violation';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'Indica por qué se registra a mano' using errcode = 'check_violation';
  end if;
  insert into public.clock_events (tenant_id, staff_id, location_id, kind, event_at, source, status, note, created_by)
  values (v_tenant, v_staff.id, v_staff.location_id, p_kind, p_at, 'admin', 'ok', trim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.add_clock_event(uuid, text, timestamptz, text) from public;
grant execute on function app.add_clock_event(uuid, text, timestamptz, text) to authenticated;

create or replace function app.review_clock_event(p_event_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado revisan fichajes' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('aprobado', 'rechazado') then
    raise exception 'Estado no válido' using errcode = 'check_violation';
  end if;
  update public.clock_events
  set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
      note = coalesce(nullif(trim(p_note), ''), note)
  where id = p_event_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Fichaje no encontrado' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.review_clock_event(uuid, text, text) from public;
grant execute on function app.review_clock_event(uuid, text, text) to authenticated;

create function public.set_staff_pin(p_staff_id uuid, p_pin text)
returns void language sql security invoker set search_path = '' as $$ select app.set_staff_pin(p_staff_id, p_pin) $$;
create function public.regenerate_clock_key()
returns text language sql security invoker set search_path = '' as $$ select app.regenerate_clock_key() $$;
create function public.clock_key()
returns text language sql stable security invoker set search_path = '' as $$ select app.clock_key() $$;
create function public.add_clock_event(p_staff_id uuid, p_kind text, p_at timestamptz, p_note text)
returns uuid language sql security invoker set search_path = '' as $$ select app.add_clock_event(p_staff_id, p_kind, p_at, p_note) $$;
create function public.review_clock_event(p_event_id uuid, p_status text, p_note text default null)
returns void language sql security invoker set search_path = '' as $$ select app.review_clock_event(p_event_id, p_status, p_note) $$;
revoke all on function public.set_staff_pin(uuid, text) from public, anon;
revoke all on function public.regenerate_clock_key() from public, anon;
revoke all on function public.clock_key() from public, anon;
revoke all on function public.add_clock_event(uuid, text, timestamptz, text) from public, anon;
revoke all on function public.review_clock_event(uuid, text, text) from public, anon;
grant execute on function public.set_staff_pin(uuid, text) to authenticated;
grant execute on function public.regenerate_clock_key() to authenticated;
grant execute on function public.clock_key() to authenticated;
grant execute on function public.add_clock_event(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.review_clock_event(uuid, text, text) to authenticated;
