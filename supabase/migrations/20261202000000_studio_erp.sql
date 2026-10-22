-- Estudio de IA como el ERP (Basico Studio, basicosystems@9cb08cd), sin rubro.
--
--   * Cada pedido es un set de 1 a 4 imágenes (set_id): cada imagen es un
--     trabajo y gasta una foto de la cuota.
--   * Formato de salida (1:1, 4:5, 9:16, 16:9), vistas extra del producto
--     (hasta 3 fotos más: espalda, detalle, tres cuartos) y notas que la IA
--     debe respetar.
--   * Tipo «persona»: el producto en uso con una persona generada. El negocio
--     lo activa en la configuración (no sirve para todos los productos).
--   * Configuración del negocio (studio_settings): prompt base propio por tipo
--     y colores de marca para las escenas. La editan dueño o administrador.

alter table public.studio_jobs drop constraint studio_jobs_kind_check;
alter table public.studio_jobs add constraint studio_jobs_kind_check check (kind in ('catalogo', 'transparente', 'ambientado', 'persona'));
alter table public.studio_jobs
  add column set_id uuid,
  add column format text not null default '1:1' check (format in ('1:1', '4:5', '9:16', '16:9')),
  add column extra_paths text[] not null default '{}' check (cardinality(extra_paths) <= 3),
  add column notes text check (notes is null or length(notes) <= 500);
create index studio_jobs_set_idx on public.studio_jobs (tenant_id, set_id) where set_id is not null;

create table public.studio_settings (
  tenant_id uuid primary key default app.current_tenant_id() references public.tenants (id) on delete cascade,
  -- {"catalogo": "...", "ambientado": "..."}: reemplaza la descripción base del tipo.
  prompts jsonb not null default '{}'::jsonb check (jsonb_typeof(prompts) = 'object'),
  brand_name text check (brand_name is null or length(brand_name) <= 60),
  brand_colors text[] not null default '{}' check (cardinality(brand_colors) <= 4),
  people_enabled boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (array_to_string(brand_colors, ',') ~ '^(#[0-9A-Fa-f]{6}(,#[0-9A-Fa-f]{6})*)?$')
);
alter table public.studio_settings enable row level security;
revoke all on public.studio_settings from anon;
revoke update, delete on public.studio_settings from authenticated;
create policy catalog_read on public.studio_settings for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));
create policy admin_insert on public.studio_settings for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy admin_update on public.studio_settings for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
grant update (tenant_id, prompts, brand_name, brand_colors, people_enabled, updated_by, updated_at) on public.studio_settings to authenticated;
create trigger studio_settings_touch before update on public.studio_settings
  for each row execute function app.touch_updated_at();

-- Nueva firma: el set, el formato, las vistas extra y las notas.
drop function public.studio_start(uuid, text, text, text);
drop function app.studio_start(uuid, text, text, text);

create or replace function app.studio_start(
  p_product_id uuid, p_kind text, p_scene text, p_source_path text,
  p_set_id uuid default null, p_format text default '1:1', p_extra_paths text[] default '{}', p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_usage jsonb;
  v_id uuid;
  v_path text;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado usan el Estudio' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'estudio', 'Estudio de IA');
  if p_kind not in ('catalogo', 'transparente', 'ambientado', 'persona') then
    raise exception 'Tipo de foto no válido' using errcode = 'check_violation';
  end if;
  if p_kind = 'persona' and not coalesce((select people_enabled from public.studio_settings where tenant_id = v_tenant), false) then
    raise exception 'Activa «Producto con persona» en la configuración del Estudio' using errcode = 'check_violation';
  end if;
  if p_kind = 'ambientado' and nullif(trim(p_scene), '') is null then
    raise exception 'Describe el ambiente de la foto' using errcode = 'check_violation';
  end if;
  if coalesce(p_format, '1:1') not in ('1:1', '4:5', '9:16', '16:9') then
    raise exception 'Formato no válido' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'Producto no encontrado' using errcode = 'no_data_found';
  end if;
  -- Las fotos de origen tienen que estar en la carpeta del negocio.
  if p_source_path is null or split_part(p_source_path, '/', 1) <> v_tenant::text then
    raise exception 'Foto de origen no válida' using errcode = 'check_violation';
  end if;
  if cardinality(coalesce(p_extra_paths, '{}')) > 3 then
    raise exception 'Máximo 3 fotos extra' using errcode = 'check_violation';
  end if;
  foreach v_path in array coalesce(p_extra_paths, '{}')
  loop
    if v_path is null or split_part(v_path, '/', 1) <> v_tenant::text then
      raise exception 'Foto extra no válida' using errcode = 'check_violation';
    end if;
  end loop;
  -- Un trabajo a la vez por negocio para que la cuota no se pase con clics seguidos.
  perform pg_advisory_xact_lock(hashtext('studio:' || v_tenant::text));
  v_usage := app.studio_usage();
  if (v_usage ->> 'used')::integer >= (v_usage ->> 'limit')::integer then
    raise exception 'Ya usaste las % fotos del Estudio de este mes', v_usage ->> 'limit' using errcode = 'check_violation';
  end if;
  insert into public.studio_jobs (tenant_id, product_id, kind, scene, source_path, set_id, format, extra_paths, notes)
  values (v_tenant, p_product_id, p_kind, nullif(trim(p_scene), ''), p_source_path, p_set_id, coalesce(p_format, '1:1'),
          coalesce(p_extra_paths, '{}'), nullif(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.studio_start(uuid, text, text, text, uuid, text, text[], text) from public;
grant execute on function app.studio_start(uuid, text, text, text, uuid, text, text[], text) to authenticated;

create function public.studio_start(
  p_product_id uuid, p_kind text, p_scene text, p_source_path text,
  p_set_id uuid default null, p_format text default '1:1', p_extra_paths text[] default '{}', p_notes text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.studio_start(p_product_id, p_kind, p_scene, p_source_path, p_set_id, p_format, p_extra_paths, p_notes)
$$;
revoke all on function public.studio_start(uuid, text, text, text, uuid, text, text[], text) from public, anon;
grant execute on function public.studio_start(uuid, text, text, text, uuid, text, text[], text) to authenticated;
