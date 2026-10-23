-- Enlace de alta con varios correos (hasta 5), cada uno con su rol.
--
--   * app.signup_invite_recipients: correos del enlace, rol dueño o
--     administrador, y quién ya entró. Reemplaza a signup_invites.email (los
--     enlaces viejos con correo pasan a un destinatario dueño).
--   * Mismo enlace para todos: un dueño de la lista crea el negocio; después,
--     el resto lo abre y entra directo al negocio con su rol.
--   * Sin correos, el enlace sigue abierto: cualquiera crea un negocio.
--   * Cupo de cuentas nuevas por enlace: tantas como correos (3 si no tiene).

create table app.signup_invite_recipients (
  invite_id uuid not null references app.signup_invites (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  role text not null check (role in ('owner', 'admin')),
  user_id uuid references auth.users (id) on delete set null,
  joined_at timestamptz,
  position integer not null default 1,
  primary key (invite_id, email)
);
revoke all on app.signup_invite_recipients from public, anon, authenticated;

insert into app.signup_invite_recipients (invite_id, email, role, user_id, joined_at)
select i.id, lower(i.email), 'owner', i.redeemed_by, i.redeemed_at
from app.signup_invites i
where i.email is not null;

alter table app.signup_invites
  drop constraint signup_invites_signups_check,
  add constraint signup_invites_signups_check check (signups between 0 and 5);

-- Estado: «unirse» = el negocio ya existe y quedan correos de la lista por entrar.
create or replace function app.signup_invite_state(i app.signup_invites)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when i.id is null then 'no_existe'
    when i.expires_at <= now() then 'vencido'
    when i.redeemed_at is null then 'valido'
    when exists (select 1 from app.signup_invite_recipients r where r.invite_id = i.id and r.joined_at is null) then 'unirse'
    else 'usado'
  end
$$;
revoke all on function app.signup_invite_state(app.signup_invites) from public;

-- Correos que pueden usar el enlace ahora: dueños para crear, pendientes para unirse.
create or replace function app.signup_invite_allowed(i app.signup_invites)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(r.email order by r.position, r.email), '{}')
  from app.signup_invite_recipients r
  where r.invite_id = i.id
    and case when i.redeemed_at is null then r.role = 'owner' else r.joined_at is null end
$$;
revoke all on function app.signup_invite_allowed(app.signup_invites) from public;

-- Lo que ve quien abre el enlace, sin listar los correos: solo el único
-- permitido, si hay uno (para llenarlo).
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
  v_allowed text[];
begin
  select * into i from app.signup_invites where code = lower(trim(p_code));
  v_state := app.signup_invite_state(i);
  if v_state not in ('valido', 'unirse') then
    return jsonb_build_object('valid', false, 'reason', v_state);
  end if;
  v_allowed := app.signup_invite_allowed(i);
  return jsonb_build_object(
    'valid', true,
    'label', i.label,
    'mode', case when v_state = 'unirse' then 'unirse' else 'crear' end,
    'tenant_name', case when v_state = 'unirse' then (select t.name from public.tenants t where t.id = i.tenant_id) end,
    'restricted', exists (select 1 from app.signup_invite_recipients r where r.invite_id = i.id),
    'email', case when cardinality(v_allowed) = 1 then v_allowed[1] end
  );
end;
$$;

-- Antes de crear la cuenta (onboarding-signup): enlace vigente, correo de la
-- lista y cupo de cuentas.
create or replace function app.signup_register_attempt(p_code text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i app.signup_invites;
  v_state text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_count integer;
begin
  select * into i from app.signup_invites where code = lower(trim(p_code)) for update;
  v_state := app.signup_invite_state(i);
  if v_state not in ('valido', 'unirse') then
    return jsonb_build_object('ok', false, 'reason', v_state);
  end if;
  select count(*) into v_count from app.signup_invite_recipients r where r.invite_id = i.id;
  if v_count > 0 and not v_email = any (app.signup_invite_allowed(i)) then
    return jsonb_build_object('ok', false, 'reason', 'otro_correo');
  end if;
  if i.signups >= coalesce(nullif(v_count, 0), 3) then
    return jsonb_build_object('ok', false, 'reason', 'sin_cupo');
  end if;
  update app.signup_invites set signups = signups + 1 where id = i.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Canje: sin negocio, un dueño de la lista lo crea; con negocio, los
-- pendientes de la lista entran con su rol.
create or replace function app.redeem_signup_invite(p_code text, p_business_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i app.signup_invites;
  r app.signup_invite_recipients;
  v_user uuid := auth.uid();
  v_email text;
  v_name text := trim(coalesce(p_business_name, ''));
  v_state text;
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_tenant uuid;
  v_key text;
  v_restricted boolean;
begin
  if v_user is null then
    raise exception 'Inicia sesión para crear tu negocio' using errcode = 'insufficient_privilege';
  end if;
  select * into i from app.signup_invites where code = lower(trim(p_code)) for update;
  v_state := app.signup_invite_state(i);
  case v_state
    when 'no_existe' then raise exception 'Este enlace de alta no existe' using errcode = 'no_data_found';
    when 'usado' then raise exception 'Este enlace de alta ya se usó' using errcode = 'check_violation';
    when 'vencido' then raise exception 'Este enlace de alta venció. Pide uno nuevo.' using errcode = 'check_violation';
    else null;
  end case;
  select lower(email) into v_email from auth.users where id = v_user;
  select * into r from app.signup_invite_recipients x where x.invite_id = i.id and x.email = v_email;
  -- Ya entró antes (doble clic, volvió a abrir el enlace): mismo negocio.
  if r.joined_at is not null and i.tenant_id is not null then
    return i.tenant_id;
  end if;
  select exists (select 1 from app.signup_invite_recipients x where x.invite_id = i.id) into v_restricted;
  if v_restricted and not v_email = any (app.signup_invite_allowed(i)) then
    raise exception 'Este enlace es para otro correo' using errcode = 'insufficient_privilege';
  end if;

  -- Unirse al negocio que ya se creó con este enlace.
  if v_state = 'unirse' then
    insert into public.tenant_members (tenant_id, user_id, role)
    values (i.tenant_id, v_user, r.role)
    on conflict do nothing;
    update app.signup_invite_recipients set user_id = v_user, joined_at = now()
    where invite_id = i.id and email = v_email;
    return i.tenant_id;
  end if;

  if length(v_name) not between 2 and 80 then
    raise exception 'Escribe el nombre del negocio' using errcode = 'check_violation';
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
  update app.signup_invite_recipients set user_id = v_user, joined_at = now() where invite_id = i.id and email = v_email;
  return v_tenant;
end;
$$;

-- Plataforma: el enlace se crea con su lista de correos.
drop function public.platform_create_invite(text, text, jsonb, integer, integer);
drop function app.platform_create_invite(text, text, jsonb, integer, integer);

create function app.platform_create_invite(
  p_label text, p_recipients jsonb, p_entitlements jsonb, p_trial_days integer, p_valid_days integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_defaults jsonb := app.entitlement_defaults();
  v_key text;
  v_id uuid;
  v_code text;
  v_list jsonb := coalesce(p_recipients, '[]'::jsonb);
  v_item jsonb;
  v_email text;
  v_role text;
  v_pos integer := 0;
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
  if jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) > 5 then
    raise exception 'Hasta 5 correos por enlace' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_list) > 0
     and not exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'role' = 'owner') then
    raise exception 'Al menos un correo tiene que ser de un dueño' using errcode = 'check_violation';
  end if;

  insert into app.signup_invites (label, entitlements, trial_days, expires_at)
  values (trim(p_label), coalesce(p_entitlements, '{}'::jsonb), p_trial_days, now() + make_interval(days => p_valid_days))
  returning id, code into v_id, v_code;

  for v_item in select * from jsonb_array_elements(v_list) loop
    v_pos := v_pos + 1;
    v_email := lower(trim(coalesce(v_item ->> 'email', '')));
    v_role := v_item ->> 'role';
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254 then
      raise exception 'Correo no válido: %', v_email using errcode = 'check_violation';
    end if;
    if v_role is null or v_role not in ('owner', 'admin') then
      raise exception 'Rol no válido para %', v_email using errcode = 'check_violation';
    end if;
    if exists (select 1 from app.signup_invite_recipients r where r.invite_id = v_id and r.email = v_email) then
      raise exception 'Correo repetido: %', v_email using errcode = 'check_violation';
    end if;
    insert into app.signup_invite_recipients (invite_id, email, role, position) values (v_id, v_email, v_role, v_pos);
  end loop;
  return v_code;
end;
$$;
revoke all on function app.platform_create_invite(text, jsonb, jsonb, integer, integer) from public;
grant execute on function app.platform_create_invite(text, jsonb, jsonb, integer, integer) to authenticated;

create function public.platform_create_invite(
  p_label text, p_recipients jsonb, p_entitlements jsonb, p_trial_days integer, p_valid_days integer
)
returns text language sql security invoker set search_path = '' as $$
  select app.platform_create_invite(p_label, p_recipients, p_entitlements, p_trial_days, p_valid_days)
$$;
revoke all on function public.platform_create_invite(text, jsonb, jsonb, integer, integer) from public, anon;
grant execute on function public.platform_create_invite(text, jsonb, jsonb, integer, integer) to authenticated;

-- Lista de enlaces con sus correos y quién ya entró.
drop function public.platform_invites();
drop function app.platform_invites();

create function app.platform_invites()
returns table (
  id uuid, code text, label text, recipients jsonb, entitlements jsonb, trial_days integer,
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
  select i.id, i.code, i.label,
         coalesce((select jsonb_agg(jsonb_build_object('email', r.email, 'role', r.role, 'joined_at', r.joined_at) order by r.position, r.email)
                   from app.signup_invite_recipients r where r.invite_id = i.id), '[]'::jsonb),
         i.entitlements, i.trial_days, i.expires_at, i.signups,
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
  id uuid, code text, label text, recipients jsonb, entitlements jsonb, trial_days integer,
  expires_at timestamptz, signups integer, state text, tenant_id uuid, tenant_name text,
  redeemed_at timestamptz, created_at timestamptz
)
language sql security invoker set search_path = '' as $$ select * from app.platform_invites() $$;
revoke all on function public.platform_invites() from public, anon;
grant execute on function public.platform_invites() to authenticated;

alter table app.signup_invites drop column email;
