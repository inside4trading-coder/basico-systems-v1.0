-- Tasa de cambio bajo control.
--
--   * rate_fetch_log: cada consulta a las fuentes (automática, programada,
--     «Actualizar ahora» o «Probar conexión») queda registrada con su
--     resultado y su error. Así se ve si la tasa dejó de actualizarse y por qué.
--   * Tasa de emergencia: en modo BCV el negocio puede poner una tasa a mano
--     (tenant_rates.until_official) que rige hasta que entre en vigor una
--     tasa oficial nueva (fecha valor posterior al día en que se puso) o hasta
--     que el negocio vuelva a la oficial. El modo «tasa propia» no cambia.
--   * rate_status(): todo lo que la pantalla de la tasa necesita en una llamada.
--   * Consulta programada: pg_cron llama a exchange-rate-sync cada hora con
--     pg_net. La dirección del proyecto se lee del Vault (secreto
--     'project_url'); sin ese secreto (desarrollo local, CI) no hace nada.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Registro de consultas
-- ---------------------------------------------------------------------------

create table public.rate_fetch_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- auto: la app al abrirse; cron: la consulta programada; refresh: «Actualizar
  -- ahora»; test: «Probar conexión» (no guarda tasa).
  mode text not null check (mode in ('auto', 'cron', 'refresh', 'test')),
  ok boolean not null,
  source text check (source in ('bcv', 'dolarapi')),
  rate numeric(18, 6),
  effective_date date,
  error text check (length(error) <= 2000),
  requested_by uuid
);
comment on table public.rate_fetch_log is '@global Registro de consultas de la tasa oficial. Lo escribe exchange-rate-sync; se lee con rate_status().';
create index rate_fetch_log_created_idx on public.rate_fetch_log (created_at desc);
alter table public.rate_fetch_log enable row level security;
revoke all on public.rate_fetch_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tasa de emergencia
-- ---------------------------------------------------------------------------

alter table public.tenant_rates
  add column until_official boolean not null default false,
  add column ended_at timestamptz;
comment on column public.tenant_rates.until_official is
  'Tasa de emergencia en modo BCV: rige hasta que entre en vigor una tasa oficial nueva.';
comment on column public.tenant_rates.ended_at is
  'Cuándo el negocio volvió a la tasa oficial antes de tiempo.';

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
  o record;
  m record;
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
      and r.created_at <= p_at and not r.until_official
    order by r.created_at desc
    limit 1;
    return;
  end if;

  select e.rate, e.source, e.effective_date, e.fetched_at into o
  from public.exchange_rates e
  where e.base_currency = t.base_currency and e.quote_currency = t.local_currency
    and e.effective_date <= v_day
  order by e.effective_date desc, (e.source = 'bcv') desc, e.fetched_at desc
  limit 1;

  -- Tasa de emergencia vigente: puesta antes de p_at, no cancelada, y sin una
  -- tasa oficial que rija desde un día posterior al día en que se puso.
  select r.rate, (r.created_at at time zone 'America/Caracas')::date as day, r.created_at into m
  from public.tenant_rates r
  where r.tenant_id = t.id and r.base_currency = t.base_currency and r.quote_currency = t.local_currency
    and r.until_official and r.created_at <= p_at
    and (r.ended_at is null or r.ended_at > p_at)
  order by r.created_at desc
  limit 1;

  if m.rate is not null and (o.rate is null or o.effective_date <= m.day) then
    return query select m.rate, 'manual'::text, m.day, m.created_at;
    return;
  end if;

  if o.rate is not null then
    return query select o.rate, o.source, o.effective_date, o.fetched_at;
  end if;
end;
$$;
revoke all on function app.rate_at(uuid, timestamptz) from public;
grant execute on function app.rate_at(uuid, timestamptz) to authenticated;

-- Vuelve a la tasa oficial antes de que llegue una nueva.
create or replace function app.end_rate_override()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_count integer;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'config.negocio') then
    raise exception 'No tienes permiso para cambiar la tasa' using errcode = 'insufficient_privilege';
  end if;
  update public.tenant_rates set ended_at = now()
  where tenant_id = v_tenant and until_official and ended_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.end_rate_override() from public, anon;
grant execute on function app.end_rate_override() to authenticated;

create function public.end_rate_override()
returns integer
language sql security invoker set search_path = '' as $$ select app.end_rate_override() $$;
revoke all on function public.end_rate_override() from public, anon;
grant execute on function public.end_rate_override() to authenticated;

-- ---------------------------------------------------------------------------
-- Estado para la pantalla
-- ---------------------------------------------------------------------------

create or replace function app.rate_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  t public.tenants;
  v_current jsonb;
  v_override jsonb;
  v_last jsonb;
  v_last_ok timestamptz;
  v_last_error jsonb;
  v_history jsonb;
begin
  if v_tenant is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  select * into t from public.tenants where id = v_tenant;

  select to_jsonb(c) into v_current from app.current_rate() c;

  -- Tasa de emergencia guardada y no cancelada (puede estar ya vencida por una oficial nueva).
  select jsonb_build_object('rate', r.rate, 'note', r.note, 'created_at', r.created_at,
                            'active', coalesce(v_current ->> 'source', '') = 'manual' and t.rate_source = 'bcv')
  into v_override
  from public.tenant_rates r
  where r.tenant_id = v_tenant and r.until_official and r.ended_at is null
  order by r.created_at desc
  limit 1;

  -- Las pruebas de conexión no cuentan para saber si la tasa se está actualizando.
  select jsonb_build_object('at', l.created_at, 'ok', l.ok, 'mode', l.mode, 'source', l.source, 'error', l.error)
  into v_last
  from public.rate_fetch_log l where l.mode <> 'test'
  order by l.created_at desc limit 1;

  select max(l.created_at) into v_last_ok from public.rate_fetch_log l where l.ok and l.mode <> 'test';

  select jsonb_build_object('at', l.created_at, 'error', l.error, 'mode', l.mode)
  into v_last_error
  from public.rate_fetch_log l where not l.ok or l.error is not null
  order by l.created_at desc limit 1;

  select coalesce(jsonb_agg(h order by h.at desc), '[]'::jsonb) into v_history
  from (
    select * from (
      select e.rate, e.source, e.effective_date, e.fetched_at as at, null::text as note
      from public.exchange_rates e
      where e.base_currency = t.base_currency and e.quote_currency = t.local_currency
      order by e.effective_date desc, e.fetched_at desc
      limit 15
    ) o
    union all
    select * from (
      select r.rate, case when r.until_official then 'override' else 'manual' end,
             (r.created_at at time zone 'America/Caracas')::date, r.created_at, r.note
      from public.tenant_rates r
      where r.tenant_id = v_tenant and r.base_currency = t.base_currency and r.quote_currency = t.local_currency
      order by r.created_at desc
      limit 15
    ) m
    order by at desc
    limit 15
  ) h;

  return jsonb_build_object(
    'rate_source', t.rate_source,
    'current', v_current,
    'override', v_override,
    'last_check', v_last,
    'last_ok_at', v_last_ok,
    'last_error', v_last_error,
    'failing', coalesce((v_last ->> 'ok')::boolean = false, false),
    'history', v_history
  );
end;
$$;
revoke all on function app.rate_status() from public, anon;
grant execute on function app.rate_status() to authenticated;

create function public.rate_status()
returns jsonb
language sql stable security invoker set search_path = '' as $$ select app.rate_status() $$;
revoke all on function public.rate_status() from public, anon;
grant execute on function public.rate_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Consulta programada
-- ---------------------------------------------------------------------------

create or replace function app.request_rate_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'project_url';
  if v_url is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/exchange-rate-sync',
    body := '{"mode": "cron"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function app.request_rate_sync() from public, anon, authenticated;

select cron.schedule('exchange-rate-sync', '7 * * * *', $$ select app.request_rate_sync() $$);
select cron.schedule('rate-fetch-log-prune', '40 4 * * *',
  $$ delete from public.rate_fetch_log where created_at < now() - interval '90 days' $$);
