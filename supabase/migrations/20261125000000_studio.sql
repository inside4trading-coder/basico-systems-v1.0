-- Estudio de IA (add-on "estudio"): fotos de producto.
--
-- Portado de EstudioVisual y estudio-generate-image (basicosystems@f551478b),
-- sin rubro: de una foto del producto tomada con el teléfono se genera una
-- foto de catálogo (fondo blanco), con fondo transparente o ambientada. La
-- generación la hace la edge function studio-generate con OpenRouter; aquí
-- quedan el registro de cada trabajo, la cuota mensual y los permisos.
--   * studio_start: dueño, administrador o encargado, con el add-on y cuota
--     del mes (estudio_images_per_month; los fallidos no cuentan).
--   * studio_finish: solo la edge function (service_role) marca el resultado
--     y el costo.

create table public.studio_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null,
  kind text not null check (kind in ('catalogo', 'transparente', 'ambientado')),
  scene text check (scene is null or length(scene) <= 300),
  status text not null default 'pendiente' check (status in ('pendiente', 'listo', 'fallido')),
  source_path text not null,
  result_path text,
  model text,
  cost_usd numeric(10, 5),
  error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index studio_jobs_month_idx on public.studio_jobs (tenant_id, created_at desc);

alter table public.studio_jobs enable row level security;
revoke all on public.studio_jobs from anon, authenticated;
grant select on public.studio_jobs to authenticated;
create policy catalog_read on public.studio_jobs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

-- Generaciones usadas este mes (hora de Caracas) y el límite del plan.
create or replace function app.studio_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used', (select count(*) from public.studio_jobs j
             where j.tenant_id = app.current_tenant_id() and j.status <> 'fallido'
               and j.created_at >= app.caracas_day_start(date_trunc('month', (now() at time zone 'America/Caracas'))::date)),
    'limit', coalesce((app.entitled(app.current_tenant_id(), 'estudio_images_per_month'))::integer, 0))
  where app.has_tenant_role(app.current_tenant_id(), array['owner', 'admin', 'manager'])
$$;
revoke all on function app.studio_usage() from public;
grant execute on function app.studio_usage() to authenticated;

create or replace function app.studio_start(p_product_id uuid, p_kind text, p_scene text, p_source_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_usage jsonb;
  v_id uuid;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado usan el Estudio' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'estudio', 'Estudio de IA');
  if p_kind not in ('catalogo', 'transparente', 'ambientado') then
    raise exception 'Tipo de foto no válido' using errcode = 'check_violation';
  end if;
  if p_kind = 'ambientado' and nullif(trim(p_scene), '') is null then
    raise exception 'Describe el ambiente de la foto' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'Producto no encontrado' using errcode = 'no_data_found';
  end if;
  -- La foto de origen tiene que estar en la carpeta del negocio.
  if p_source_path is null or split_part(p_source_path, '/', 1) <> v_tenant::text then
    raise exception 'Foto de origen no válida' using errcode = 'check_violation';
  end if;
  -- Un trabajo a la vez por negocio para que la cuota no se pase con clics seguidos.
  perform pg_advisory_xact_lock(hashtext('studio:' || v_tenant::text));
  v_usage := app.studio_usage();
  if (v_usage ->> 'used')::integer >= (v_usage ->> 'limit')::integer then
    raise exception 'Ya usaste las % fotos del Estudio de este mes', v_usage ->> 'limit' using errcode = 'check_violation';
  end if;
  insert into public.studio_jobs (tenant_id, product_id, kind, scene, source_path)
  values (v_tenant, p_product_id, p_kind, nullif(trim(p_scene), ''), p_source_path)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.studio_start(uuid, text, text, text) from public;
grant execute on function app.studio_start(uuid, text, text, text) to authenticated;

create or replace function app.studio_finish(p_job_id uuid, p_ok boolean, p_result_path text, p_model text, p_cost numeric, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.studio_jobs
  set status = case when p_ok then 'listo' else 'fallido' end,
      result_path = p_result_path, model = p_model, cost_usd = p_cost, error = left(p_error, 500), finished_at = now()
  where id = p_job_id and status = 'pendiente';
end;
$$;
revoke all on function app.studio_finish(uuid, boolean, text, text, numeric, text) from public, authenticated;
grant execute on function app.studio_finish(uuid, boolean, text, text, numeric, text) to service_role;

create function public.studio_usage()
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.studio_usage() $$;
create function public.studio_start(p_product_id uuid, p_kind text, p_scene text, p_source_path text)
returns uuid language sql security invoker set search_path = '' as $$ select app.studio_start(p_product_id, p_kind, p_scene, p_source_path) $$;
revoke all on function public.studio_usage() from public, anon;
revoke all on function public.studio_start(uuid, text, text, text) from public, anon;
grant execute on function public.studio_usage() to authenticated;
grant execute on function public.studio_start(uuid, text, text, text) to authenticated;
-- La edge function cierra el trabajo con la clave de servicio (vive en Supabase, no en Vercel).
grant usage on schema app to service_role;
create function public.studio_finish(p_job_id uuid, p_ok boolean, p_result_path text, p_model text, p_cost numeric, p_error text)
returns void language sql security invoker set search_path = '' as $$ select app.studio_finish(p_job_id, p_ok, p_result_path, p_model, p_cost, p_error) $$;
revoke all on function public.studio_finish(uuid, boolean, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.studio_finish(uuid, boolean, text, text, numeric, text) to service_role;

-- Las fotos generadas llegan en PNG de alta resolución: el bucket admite
-- hasta 8 MB (las que sube la app siguen achicándose a 800 px en el equipo).
update storage.buckets set file_size_limit = 8388608 where id = 'product-images';
