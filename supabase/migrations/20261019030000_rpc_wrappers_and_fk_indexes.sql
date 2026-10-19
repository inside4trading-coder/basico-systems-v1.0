-- 1. Las RPC de inventario pasan a `app` (fuera de la API) y en `public` queda
--    un envoltorio SECURITY INVOKER que las llama. La comprobación de rol y
--    tenant no cambia (vive en la función de `app`); así ninguna función
--    SECURITY DEFINER queda expuesta por /rest/v1/rpc, y el linter de
--    Supabase queda limpio.
-- 2. Índices que cubren las claves foráneas compuestas (tenant_id, …).

alter function public.inventory_entry(uuid, uuid, numeric, numeric, text, text, numeric) set schema app;
alter function public.inventory_adjust(uuid, uuid, numeric, text, text, uuid) set schema app;
alter function public.inventory_sign(uuid, text) set schema app;
alter function public.inventory_transfer(uuid, uuid, uuid, numeric, text) set schema app;
alter function public.catalog_lookup(text, integer) set schema app;

comment on function app.inventory_entry(uuid, uuid, numeric, numeric, text, text, numeric) is 'Entrada de mercancía. Rol owner/admin/manager en el tenant de la variante.';
comment on function app.inventory_adjust(uuid, uuid, numeric, text, text, uuid) is 'Ajuste manual pendiente de firma. Rol owner/admin/manager.';
comment on function app.inventory_sign(uuid, text) is 'Firma de ajuste. Owner/admin del tenant, distinto de quien ajustó.';
comment on function app.inventory_transfer(uuid, uuid, uuid, numeric, text) is 'Traslado entre sedes del mismo tenant. Rol owner/admin/manager.';
comment on function app.catalog_lookup(text, integer) is 'Buscador de catálogo del tenant activo (header x-tenant-id).';

create function public.inventory_entry(
  p_variant_id uuid, p_location_id uuid, p_qty numeric, p_unit_cost numeric default null,
  p_supplier text default null, p_note text default null, p_expected_qty numeric default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.inventory_entry(p_variant_id, p_location_id, p_qty, p_unit_cost, p_supplier, p_note, p_expected_qty)
$$;

create function public.inventory_adjust(
  p_variant_id uuid, p_location_id uuid, p_delta numeric, p_reason text,
  p_note text default null, p_corrects_id uuid default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.inventory_adjust(p_variant_id, p_location_id, p_delta, p_reason, p_note, p_corrects_id)
$$;

create function public.inventory_sign(p_movement_id uuid, p_note text default null)
returns void language sql security invoker set search_path = '' as $$
  select app.inventory_sign(p_movement_id, p_note)
$$;

create function public.inventory_transfer(
  p_variant_id uuid, p_from_location uuid, p_to_location uuid, p_qty numeric, p_note text default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.inventory_transfer(p_variant_id, p_from_location, p_to_location, p_qty, p_note)
$$;

create function public.catalog_lookup(p_query text, p_limit integer default 30)
returns table (
  variant_id uuid, product_id uuid, product_name text, options jsonb, brand text,
  sku text, price numeric, cost numeric, unit text, match_kind text
)
language sql stable security invoker set search_path = '' as $$
  select * from app.catalog_lookup(p_query, p_limit)
$$;

revoke all on function public.inventory_entry(uuid, uuid, numeric, numeric, text, text, numeric) from public, anon;
revoke all on function public.inventory_adjust(uuid, uuid, numeric, text, text, uuid) from public, anon;
revoke all on function public.inventory_sign(uuid, text) from public, anon;
revoke all on function public.inventory_transfer(uuid, uuid, uuid, numeric, text) from public, anon;
revoke all on function public.catalog_lookup(text, integer) from public, anon;
grant execute on function public.inventory_entry(uuid, uuid, numeric, numeric, text, text, numeric) to authenticated;
grant execute on function public.inventory_adjust(uuid, uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.inventory_sign(uuid, text) to authenticated;
grant execute on function public.inventory_transfer(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.catalog_lookup(text, integer) to authenticated;

-- Las funciones movidas conservan sus GRANT: authenticated las ejecuta a
-- través del envoltorio; `app` no es parte de la API REST.

create index inventory_movements_corrects_idx on public.inventory_movements (corrects_movement_id)
  where corrects_movement_id is not null;
create index inventory_movements_tenant_location_fk_idx on public.inventory_movements (tenant_id, location_id);
create index inventory_movements_tenant_variant_fk_idx on public.inventory_movements (tenant_id, variant_id);
create index product_attribute_values_attribute_fk_idx on public.product_attribute_values (tenant_id, attribute_id);
create index product_attribute_values_product_fk_idx on public.product_attribute_values (tenant_id, product_id);
create index product_codes_tenant_variant_fk_idx on public.product_codes (tenant_id, variant_id);
create index product_relations_product_fk_idx on public.product_relations (tenant_id, product_id);
create index product_relations_related_fk_idx on public.product_relations (tenant_id, related_product_id);
create index stocks_tenant_variant_fk_idx on public.stocks (tenant_id, variant_id);
