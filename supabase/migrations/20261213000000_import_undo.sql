-- Deshacer una importación de catálogo.
--
-- catalog_import corre en una sola transacción y now() es constante en ella:
-- los productos, variantes, movimientos y el import_job que crea comparten el
-- mismo created_at. Así, lo que creó un job es lo de su negocio con
-- created_at = job.created_at, sin columnas de enlace.
--
--   * Se borran los productos que creó la importación (las llaves en cascada
--     se llevan variantes, códigos, existencias, movimientos del import y
--     campos propios).
--   * Se conservan los que ya se usaron después: vendidos, con etiqueta por
--     unidad, en un conteo, con imágenes de Studio o con cualquier movimiento
--     posterior (ajuste, traslado, recepción…).
--   * Los cambios a productos que ya existían (precio, existencia) no se
--     revierten.
--   * El job queda marcado y su huella cambia, para poder volver a subir el
--     mismo archivo.

alter table public.import_jobs
  add column undone_at timestamptz,
  add column undone_by uuid references auth.users (id) on delete set null,
  add column undo_result jsonb;

create or replace function app.undo_catalog_import(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.import_jobs;
  v_remove uuid[];
  v_keep uuid[];
  v_result jsonb;
begin
  select * into j from public.import_jobs
  where id = p_job_id and tenant_id = app.current_tenant_id()
  for update;
  if not found then
    raise exception 'Importación no encontrada' using errcode = 'no_data_found';
  end if;
  if not app.has_capability(j.tenant_id, 'catalogo.editar') then
    raise exception 'No tienes permiso para editar el catálogo' using errcode = 'insufficient_privilege';
  end if;
  if j.undone_at is not null then
    raise exception 'Esta importación ya se deshizo' using errcode = 'check_violation';
  end if;

  with created as (
    select p.id,
           exists (
             select 1 from public.variants v
             where v.product_id = p.id and (
               exists (select 1 from public.sale_items si where si.variant_id = v.id)
               or exists (select 1 from public.item_labels l where l.variant_id = v.id)
               or exists (select 1 from public.inventory_count_items ci where ci.variant_id = v.id)
               or exists (select 1 from public.inventory_movements m where m.variant_id = v.id and m.created_at <> j.created_at)
             )
           )
           or exists (select 1 from public.studio_jobs s where s.product_id = p.id) as used
    from public.products p
    where p.tenant_id = j.tenant_id and p.created_at = j.created_at
  )
  select coalesce(array_agg(id) filter (where not used), '{}'), coalesce(array_agg(id) filter (where used), '{}')
  into v_remove, v_keep
  from created;

  begin
    delete from public.products where id = any (v_remove);
  exception when foreign_key_violation then
    raise exception 'Hay productos de esta importación en uso; no se deshizo nada' using errcode = 'foreign_key_violation';
  end;

  v_result := jsonb_build_object(
    'removed', cardinality(v_remove),
    'kept', cardinality(v_keep),
    'kept_names', coalesce((
      select jsonb_agg(x.name order by x.name)
      from (select p.name from public.products p where p.id = any (v_keep) order by p.name limit 10) x
    ), '[]'::jsonb)
  );

  update public.import_jobs set
    undone_at = now(),
    undone_by = auth.uid(),
    undo_result = v_result,
    file_hash = encode(extensions.digest(file_hash || id::text, 'sha256'), 'hex')
  where id = j.id;

  return v_result;
end;
$$;
revoke all on function app.undo_catalog_import(uuid) from public;
grant execute on function app.undo_catalog_import(uuid) to authenticated;

create function public.undo_catalog_import(p_job_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select app.undo_catalog_import(p_job_id) $$;
revoke all on function public.undo_catalog_import(uuid) from public, anon;
grant execute on function public.undo_catalog_import(uuid) to authenticated;
