-- Ajuste por reposición en la política de precios.
--
-- Un porcentaje fijo que el negocio suma al precio para cubrir lo que le
-- costará reponer la mercancía. Lo pone el negocio a mano: el sistema no lo
-- calcula con ninguna tasa de cambio, y la conversión a bolívares sigue siendo
-- a la tasa que el negocio elige en Configuración. En 0 por defecto.

alter table public.pricing_policies
  add column replacement_pct numeric(6, 2) not null default 0 check (replacement_pct >= 0 and replacement_pct <= 200);

create or replace function app.save_pricing_policy(p_policy jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_concepts jsonb := coalesce(p_policy -> 'concepts', '[]'::jsonb);
  c jsonb;
  v_sum numeric := 0;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'catalogo.editar') then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(v_concepts) <> 'array' or jsonb_array_length(v_concepts) > 20 then
    raise exception 'Conceptos inválidos' using errcode = 'check_violation';
  end if;
  for c in select * from jsonb_array_elements(v_concepts) loop
    if jsonb_typeof(c) <> 'object'
       or length(trim(coalesce(c ->> 'name', ''))) not between 1 and 40
       or jsonb_typeof(c -> 'pct') <> 'number'
       or (c ->> 'pct')::numeric < 0 or (c ->> 'pct')::numeric > 100
       or jsonb_typeof(c -> 'active') <> 'boolean' then
      raise exception 'Cada concepto necesita nombre, porcentaje entre 0 y 100 y si está activo' using errcode = 'check_violation';
    end if;
    if (c ->> 'active')::boolean then
      v_sum := v_sum + (c ->> 'pct')::numeric;
    end if;
  end loop;
  if v_sum >= 90 then
    raise exception 'Las comisiones activas suman % %%: deben sumar menos de 90 %%', v_sum using errcode = 'check_violation';
  end if;

  insert into public.pricing_policies as p (tenant_id, target_margin, overhead_pct, replacement_pct, concepts, min_margin, rounding, updated_by, updated_at)
  values (
    v_tenant,
    coalesce((p_policy ->> 'target_margin')::numeric, 30),
    coalesce((p_policy ->> 'overhead_pct')::numeric, 0),
    coalesce((p_policy ->> 'replacement_pct')::numeric, 0),
    (select coalesce(jsonb_agg(jsonb_build_object('name', trim(x ->> 'name'), 'pct', (x ->> 'pct')::numeric, 'active', (x ->> 'active')::boolean)), '[]'::jsonb)
       from jsonb_array_elements(v_concepts) x),
    coalesce((p_policy ->> 'min_margin')::numeric, 15),
    coalesce(p_policy ->> 'rounding', 'none'),
    auth.uid(),
    now()
  )
  on conflict (tenant_id) do update set
    target_margin = excluded.target_margin,
    overhead_pct = excluded.overhead_pct,
    replacement_pct = excluded.replacement_pct,
    concepts = excluded.concepts,
    min_margin = excluded.min_margin,
    rounding = excluded.rounding,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;
revoke all on function app.save_pricing_policy(jsonb) from public, anon;
grant execute on function app.save_pricing_policy(jsonb) to authenticated;
