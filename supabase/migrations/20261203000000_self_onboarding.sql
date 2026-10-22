-- Alta de negocios por enlace (self onboarding).
--
--   * La plataforma (admins en app.platform_admins) crea un enlace de alta:
--     etiqueta, correo opcional, módulos y cupos, días de prueba y caducidad.
--   * Quien abre el enlace crea su cuenta (función onboarding-signup, con
--     service_role) y con su sesión canjea el código: se crea el negocio con
--     él como owner, los datos por defecto (triggers de tenants), los módulos
--     del enlace y el fin de la prueba. Un enlace crea un solo negocio.
--   * El asistente inicial guarda su avance en tenants.onboarding_steps.
--
-- Las tablas de plataforma viven en el esquema app: no se exponen por la API
-- y solo las tocan funciones SECURITY DEFINER que comprueban el permiso.

-- ---------------------------------------------------------------------------
-- Plataforma
-- ---------------------------------------------------------------------------

create table app.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on app.platform_admins from public, anon, authenticated;

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (select 1 from app.platform_admins where user_id = auth.uid())
$$;
revoke all on function app.is_platform_admin() from public;
grant execute on function app.is_platform_admin() to authenticated;

create function public.is_platform_admin()
returns boolean language sql security invoker set search_path = '' as $$ select app.is_platform_admin() $$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function app.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Solo la plataforma puede hacer esto' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function app.require_platform_admin() from public;

create table app.signup_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  label text not null check (length(trim(label)) between 1 and 80),
  email text check (email is null or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  entitlements jsonb not null default '{}'::jsonb check (jsonb_typeof(entitlements) = 'object'),
  trial_days integer check (trial_days is null or trial_days between 1 and 365),
  expires_at timestamptz not null,
  signups integer not null default 0 check (signups between 0 and 3),
  tenant_id uuid references public.tenants (id) on delete set null,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
revoke all on app.signup_invites from public, anon, authenticated;

alter table public.tenants
  add column trial_ends_at timestamptz,
  add column onboarding_completed_at timestamptz,
  add column onboarding_steps jsonb not null default '{}'::jsonb check (jsonb_typeof(onboarding_steps) = 'object');
comment on column public.tenants.trial_ends_at is 'Fin de la prueba gratis; la plataforma suspende a mano.';
comment on column public.tenants.onboarding_steps is 'Pasos del asistente inicial ya hechos: negocio, productos, equipo.';

-- Estado del enlace sin mostrar lo que trae (módulos, cupos).
create or replace function app.signup_invite_state(i app.signup_invites)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when i.id is null then 'no_existe'
    when i.redeemed_at is not null then 'usado'
    when i.expires_at <= now() then 'vencido'
    else 'valido'
  end
$$;
revoke all on function app.signup_invite_state(app.signup_invites) from public;

-- Lo que ve quien abre el enlace, aún sin cuenta.
create or replace function app.signup_invite_info(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i app.signup_invites;
  v_state text;
begin
  select * into i from app.signup_invites where code = lower(trim(p_code));
  v_state := app.signup_invite_state(i);
  if v_state <> 'valido' then
    return jsonb_build_object('valid', false, 'reason', v_state);
  end if;
  return jsonb_build_object('valid', true, 'label', i.label, 'email', i.email);
end;
$$;
revoke all on function app.signup_invite_info(text) from public;
grant execute on function app.signup_invite_info(text) to anon, authenticated;

create function public.signup_invite_info(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$ select app.signup_invite_info(p_code) $$;
revoke all on function public.signup_invite_info(text) from public;
grant execute on function public.signup_invite_info(text) to anon, authenticated;

-- La llama la función onboarding-signup (service_role) antes de crear la
-- cuenta: valida el enlace y el correo, y cuenta el intento (máximo 3).
create or replace function app.signup_register_attempt(p_code text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i app.signup_invites;
  v_state text;
begin
  select * into i from app.signup_invites where code = lower(trim(p_code)) for update;
  v_state := app.signup_invite_state(i);
  if v_state <> 'valido' then
    return jsonb_build_object('ok', false, 'reason', v_state);
  end if;
  if i.email is not null and lower(i.email) <> lower(trim(p_email)) then
    return jsonb_build_object('ok', false, 'reason', 'otro_correo');
  end if;
  if i.signups >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'sin_cupo');
  end if;
  update app.signup_invites set signups = signups + 1 where id = i.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function app.signup_register_attempt(text, text) from public, anon, authenticated;
grant execute on function app.signup_register_attempt(text, text) to service_role;

create function public.signup_register_attempt(p_code text, p_email text)
returns jsonb language sql security invoker set search_path = '' as $$ select app.signup_register_attempt(p_code, p_email) $$;
revoke all on function public.signup_register_attempt(text, text) from public, anon, authenticated;
grant execute on function public.signup_register_attempt(text, text) to service_role;

-- Identificador para la URL a partir del nombre: «Ferretería El Sol» → ferreteria-el-sol.
create or replace function app.slugify(p text, p_max integer default 40)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(trim(both '-' from left(regexp_replace(app.fold(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), p_max)), ''), 'negocio')
$$;
revoke all on function app.slugify(text, integer) from public;

-- Canje: crea el negocio con quien llama como owner. Un enlace, un negocio.
create or replace function app.redeem_signup_invite(p_code text, p_business_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i app.signup_invites;
  v_user uuid := auth.uid();
  v_email text;
  v_name text := trim(coalesce(p_business_name, ''));
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_tenant uuid;
  v_key text;
begin
  if v_user is null then
    raise exception 'Inicia sesión para crear tu negocio' using errcode = 'insufficient_privilege';
  end if;
  if length(v_name) not between 2 and 80 then
    raise exception 'Escribe el nombre del negocio' using errcode = 'check_violation';
  end if;
  select * into i from app.signup_invites where code = lower(trim(p_code)) for update;
  case app.signup_invite_state(i)
    when 'no_existe' then raise exception 'Este enlace de alta no existe' using errcode = 'no_data_found';
    when 'usado' then raise exception 'Este enlace de alta ya se usó' using errcode = 'check_violation';
    when 'vencido' then raise exception 'Este enlace de alta venció. Pide uno nuevo.' using errcode = 'check_violation';
    else null;
  end case;
  select email into v_email from auth.users where id = v_user;
  if i.email is not null and lower(i.email) <> lower(v_email) then
    raise exception 'Este enlace es para otro correo' using errcode = 'insufficient_privilege';
  end if;

  v_base := app.slugify(v_name);
  v_slug := v_base;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := left(v_base, 36) || '-' || v_n;
  end loop;

  insert into public.tenants (name, slug, trial_ends_at)
  values (v_name, v_slug, case when i.trial_days is null then null else now() + make_interval(days => i.trial_days) end)
  returning id into v_tenant;
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
  for v_key in select jsonb_object_keys(i.entitlements) loop
    insert into public.tenant_entitlements (tenant_id, key, value) values (v_tenant, v_key, i.entitlements -> v_key);
  end loop;
  update app.signup_invites set tenant_id = v_tenant, redeemed_by = v_user, redeemed_at = now() where id = i.id;
  return v_tenant;
end;
$$;
revoke all on function app.redeem_signup_invite(text, text) from public;
grant execute on function app.redeem_signup_invite(text, text) to authenticated;

create function public.redeem_signup_invite(p_code text, p_business_name text)
returns uuid language sql security invoker set search_path = '' as $$ select app.redeem_signup_invite(p_code, p_business_name) $$;
revoke all on function public.redeem_signup_invite(text, text) from public, anon;
grant execute on function public.redeem_signup_invite(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Asistente inicial
-- ---------------------------------------------------------------------------

-- Paso «Negocio»: datos fiscales, tasa y la sede principal con su caja.
-- Se puede repetir: no crea una segunda sede ni una segunda caja.
create or replace function app.onboarding_setup_business(
  p_name text, p_legal_name text, p_tax_id text, p_phone text, p_address text,
  p_location_name text, p_rate_source text, p_manual_rate numeric, p_special_taxpayer boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  t public.tenants;
  v_location uuid;
  v_code text;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin']) then
    raise exception 'Solo dueño o administrador configuran el negocio' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Escribe el nombre del negocio' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_location_name, ''))) = 0 then
    raise exception 'Escribe el nombre de la sede' using errcode = 'check_violation';
  end if;
  if p_rate_source not in ('bcv', 'manual') then
    raise exception 'Fuente de tasa no válida' using errcode = 'check_violation';
  end if;
  select * into t from public.tenants where id = v_tenant;
  if p_rate_source = 'manual' and (p_manual_rate is null or p_manual_rate <= 0) and t.local_currency is not null then
    raise exception 'Escribe la tasa del día' using errcode = 'check_violation';
  end if;

  update public.tenants
  set name = trim(p_name),
      legal_name = nullif(trim(p_legal_name), ''),
      tax_id = nullif(upper(trim(p_tax_id)), ''),
      phone = nullif(trim(p_phone), ''),
      address = nullif(trim(p_address), ''),
      rate_source = p_rate_source,
      is_special_taxpayer = coalesce(p_special_taxpayer, false),
      onboarding_steps = onboarding_steps || jsonb_build_object('negocio', now())
  where id = v_tenant;

  if p_rate_source = 'manual' and p_manual_rate > 0 and t.local_currency is not null then
    insert into public.tenant_rates (tenant_id, base_currency, quote_currency, rate, note)
    values (v_tenant, t.base_currency, t.local_currency, p_manual_rate, 'Asistente inicial');
  end if;

  select id into v_location from public.locations
  where tenant_id = v_tenant and deleted_at is null order by created_at limit 1;
  if v_location is null then
    v_code := left(regexp_replace(upper(app.fold(p_location_name)), '[^A-Z0-9]+', '', 'g'), 10);
    if v_code = '' then v_code := 'PRINCIPAL'; end if;
    insert into public.locations (tenant_id, name, code) values (v_tenant, trim(p_location_name), v_code)
    returning id into v_location;
  end if;
  if not exists (select 1 from public.registers where tenant_id = v_tenant and is_active) then
    insert into public.registers (tenant_id, location_id, name, code)
    values (v_tenant, v_location, 'Caja 1',
            case when exists (select 1 from public.registers where tenant_id = v_tenant and code = 'CAJA-1')
                 then 'CAJA-' || (select count(*) + 1 from public.registers where tenant_id = v_tenant)
                 else 'CAJA-1' end);
  end if;
end;
$$;
revoke all on function app.onboarding_setup_business(text, text, text, text, text, text, text, numeric, boolean) from public;
grant execute on function app.onboarding_setup_business(text, text, text, text, text, text, text, numeric, boolean) to authenticated;

create function public.onboarding_setup_business(
  p_name text, p_legal_name text, p_tax_id text, p_phone text, p_address text,
  p_location_name text, p_rate_source text, p_manual_rate numeric, p_special_taxpayer boolean
)
returns void language sql security invoker set search_path = '' as $$
  select app.onboarding_setup_business(p_name, p_legal_name, p_tax_id, p_phone, p_address,
                                       p_location_name, p_rate_source, p_manual_rate, p_special_taxpayer)
$$;
revoke all on function public.onboarding_setup_business(text, text, text, text, text, text, text, numeric, boolean) from public, anon;
grant execute on function public.onboarding_setup_business(text, text, text, text, text, text, text, numeric, boolean) to authenticated;

-- Pasos «productos» y «equipo» (hechos o saltados) y «listo» (cierra el asistente).
create or replace function app.onboarding_mark(p_step text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin']) then
    raise exception 'Solo dueño o administrador configuran el negocio' using errcode = 'insufficient_privilege';
  end if;
  if p_step not in ('productos', 'equipo', 'listo') then
    raise exception 'Paso no válido' using errcode = 'check_violation';
  end if;
  update public.tenants
  set onboarding_steps = onboarding_steps || jsonb_build_object(p_step, now()),
      onboarding_completed_at = case when p_step = 'listo' then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end
  where id = v_tenant;
end;
$$;
revoke all on function app.onboarding_mark(text) from public;
grant execute on function app.onboarding_mark(text) to authenticated;

create function public.onboarding_mark(p_step text)
returns void language sql security invoker set search_path = '' as $$ select app.onboarding_mark(p_step) $$;
revoke all on function public.onboarding_mark(text) from public, anon;
grant execute on function public.onboarding_mark(text) to authenticated;

-- Los negocios que ya existen no pasan por el asistente.
update public.tenants set onboarding_completed_at = now() where onboarding_completed_at is null;

-- ---------------------------------------------------------------------------
-- Panel de plataforma
-- ---------------------------------------------------------------------------

-- Nuevo enlace de alta. Las keys tienen que existir en el plan y respetar su tipo.
create or replace function app.platform_create_invite(
  p_label text, p_email text, p_entitlements jsonb, p_trial_days integer, p_valid_days integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_defaults jsonb := app.entitlement_defaults();
  v_key text;
  v_code text;
begin
  perform app.require_platform_admin();
  if jsonb_typeof(coalesce(p_entitlements, '{}'::jsonb)) <> 'object' then
    raise exception 'Módulos no válidos' using errcode = 'check_violation';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_entitlements, '{}'::jsonb)) loop
    if not v_defaults ? v_key then
      raise exception 'No existe el módulo o cupo «%»', v_key using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_entitlements -> v_key) <> jsonb_typeof(v_defaults -> v_key)
       or (jsonb_typeof(p_entitlements -> v_key) = 'number' and (p_entitlements ->> v_key)::numeric < 0) then
      raise exception 'Valor no válido para «%»', v_key using errcode = 'check_violation';
    end if;
  end loop;
  if coalesce(p_valid_days, 0) not between 1 and 90 then
    raise exception 'El enlace vale entre 1 y 90 días' using errcode = 'check_violation';
  end if;
  insert into app.signup_invites (label, email, entitlements, trial_days, expires_at)
  values (trim(p_label), nullif(lower(trim(p_email)), ''), coalesce(p_entitlements, '{}'::jsonb), p_trial_days,
          now() + make_interval(days => p_valid_days))
  returning code into v_code;
  return v_code;
end;
$$;
revoke all on function app.platform_create_invite(text, text, jsonb, integer, integer) from public;
grant execute on function app.platform_create_invite(text, text, jsonb, integer, integer) to authenticated;

create function public.platform_create_invite(
  p_label text, p_email text, p_entitlements jsonb, p_trial_days integer, p_valid_days integer
)
returns text language sql security invoker set search_path = '' as $$
  select app.platform_create_invite(p_label, p_email, p_entitlements, p_trial_days, p_valid_days)
$$;
revoke all on function public.platform_create_invite(text, text, jsonb, integer, integer) from public, anon;
grant execute on function public.platform_create_invite(text, text, jsonb, integer, integer) to authenticated;

create or replace function app.platform_invites()
returns table (
  id uuid, code text, label text, email text, entitlements jsonb, trial_days integer,
  expires_at timestamptz, signups integer, state text, tenant_id uuid, tenant_name text,
  redeemed_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return query
  select i.id, i.code, i.label, i.email, i.entitlements, i.trial_days, i.expires_at, i.signups,
         app.signup_invite_state(i), i.tenant_id, t.name, i.redeemed_at, i.created_at
  from app.signup_invites i
  left join public.tenants t on t.id = i.tenant_id
  order by i.created_at desc
  limit 200;
end;
$$;
revoke all on function app.platform_invites() from public;
grant execute on function app.platform_invites() to authenticated;

create function public.platform_invites()
returns table (
  id uuid, code text, label text, email text, entitlements jsonb, trial_days integer,
  expires_at timestamptz, signups integer, state text, tenant_id uuid, tenant_name text,
  redeemed_at timestamptz, created_at timestamptz
)
language sql security invoker set search_path = '' as $$ select * from app.platform_invites() $$;
revoke all on function public.platform_invites() from public, anon;
grant execute on function public.platform_invites() to authenticated;

create or replace function app.platform_tenants()
returns table (
  id uuid, name text, slug text, status text, is_demo boolean, owner_email text, members bigint,
  locations bigint, last_sale_at timestamptz, trial_ends_at timestamptz,
  onboarding_completed_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return query
  select t.id, t.name, t.slug, t.status, t.is_demo,
         (select u.email::text from public.tenant_members m join auth.users u on u.id = m.user_id
          where m.tenant_id = t.id and m.role = 'owner' order by m.created_at limit 1),
         (select count(*) from public.tenant_members m where m.tenant_id = t.id),
         (select count(*) from public.locations l where l.tenant_id = t.id and l.deleted_at is null),
         (select max(s.sold_at) from public.sales s where s.tenant_id = t.id),
         t.trial_ends_at, t.onboarding_completed_at, t.created_at
  from public.tenants t
  where t.deleted_at is null
  order by t.created_at desc;
end;
$$;
revoke all on function app.platform_tenants() from public;
grant execute on function app.platform_tenants() to authenticated;

create function public.platform_tenants()
returns table (
  id uuid, name text, slug text, status text, is_demo boolean, owner_email text, members bigint,
  locations bigint, last_sale_at timestamptz, trial_ends_at timestamptz,
  onboarding_completed_at timestamptz, created_at timestamptz
)
language sql security invoker set search_path = '' as $$ select * from app.platform_tenants() $$;
revoke all on function public.platform_tenants() from public, anon;
grant execute on function public.platform_tenants() to authenticated;

create or replace function app.platform_set_tenant_status(p_tenant uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  if p_status not in ('active', 'suspended') then
    raise exception 'Estado no válido' using errcode = 'check_violation';
  end if;
  update public.tenants set status = p_status where id = p_tenant and deleted_at is null;
  if not found then
    raise exception 'Negocio no encontrado' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.platform_set_tenant_status(uuid, text) from public;
grant execute on function app.platform_set_tenant_status(uuid, text) to authenticated;

create function public.platform_set_tenant_status(p_tenant uuid, p_status text)
returns void language sql security invoker set search_path = '' as $$ select app.platform_set_tenant_status(p_tenant, p_status) $$;
revoke all on function public.platform_set_tenant_status(uuid, text) from public, anon;
grant execute on function public.platform_set_tenant_status(uuid, text) to authenticated;

-- Suma días a la prueba desde hoy o desde su fin, lo que sea más tarde.
create or replace function app.platform_extend_trial(p_tenant uuid, p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end timestamptz;
begin
  perform app.require_platform_admin();
  if coalesce(p_days, 0) not between 1 and 365 then
    raise exception 'Entre 1 y 365 días' using errcode = 'check_violation';
  end if;
  update public.tenants
  set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days)
  where id = p_tenant and deleted_at is null
  returning trial_ends_at into v_end;
  if v_end is null then
    raise exception 'Negocio no encontrado' using errcode = 'no_data_found';
  end if;
  return v_end;
end;
$$;
revoke all on function app.platform_extend_trial(uuid, integer) from public;
grant execute on function app.platform_extend_trial(uuid, integer) to authenticated;

create function public.platform_extend_trial(p_tenant uuid, p_days integer)
returns timestamptz language sql security invoker set search_path = '' as $$ select app.platform_extend_trial(p_tenant, p_days) $$;
revoke all on function public.platform_extend_trial(uuid, integer) from public, anon;
grant execute on function public.platform_extend_trial(uuid, integer) to authenticated;
