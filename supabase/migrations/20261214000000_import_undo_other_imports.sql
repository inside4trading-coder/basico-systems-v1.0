-- Deshacer importación: los movimientos de otra importación no cuentan como uso.
--
-- Si el mismo inventario se cargó dos veces, la segunda carga deja un conteo
-- en productos de la primera. Antes, ese conteo hacía que «Deshacer» de la
-- primera los conservara como si se hubieran usado. Ahora solo cuentan los
-- movimientos que no son de ninguna importación del negocio (ajustes, ventas,
-- traslados, recepciones…).

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
               or exists (
                 select 1 from public.inventory_movements m
                 where m.variant_id = v.id and m.created_at <> j.created_at
                   -- El conteo de otra importación (p. ej. una recarga) no es uso.
                   and not exists (select 1 from public.import_jobs o where o.tenant_id = j.tenant_id and o.created_at = m.created_at)
               )
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
