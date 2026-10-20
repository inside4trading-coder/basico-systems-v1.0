-- Conteo físico de inventario.
--
-- En Sublime (SublimeInventarioConteos, basicosystems@f551478b) estaba en
-- diseño: "conteo ciego por ubicación con diferencias por variante y ajuste
-- auditado". Aquí:
--   * start_inventory_count: abre un conteo de una sede (todo o una
--     categoría) con un renglón por producto con fila de stock ahí. Ciego
--     (por defecto) no muestra lo que dice el sistema mientras se cuenta.
--   * count_inventory_item: anota lo contado (fija o suma, para lector de
--     códigos). Cualquier miembro del equipo cuenta.
--   * close_inventory_count: compara con lo que hay al cerrar y, por cada
--     diferencia, hace un ajuste normal (inventory_adjust) con motivo
--     "Conteo físico C-…": queda en Historial, Mermas y Firmas como cualquier
--     ajuste. Lo no contado no se toca, salvo que se pida contarlo como cero.
-- Abrir, cerrar y anular: dueño, administrador o encargado.

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  number text not null,
  location_id uuid not null,
  category text,
  blind boolean not null default true,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  adjustments integer,
  unique (tenant_id, number),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id)
);
create index inventory_counts_open_idx on public.inventory_counts (tenant_id, location_id) where status = 'open';

create table public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  count_id uuid not null,
  variant_id uuid not null,
  expected numeric(14, 3),
  counted numeric(14, 3) check (counted is null or counted >= 0),
  counted_by uuid,
  counted_at timestamptz,
  unique (count_id, variant_id),
  foreign key (tenant_id, count_id) references public.inventory_counts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id) on delete cascade
);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
revoke all on public.inventory_counts, public.inventory_count_items from anon;
revoke insert, update, delete on public.inventory_counts, public.inventory_count_items from authenticated;
create policy tenant_read on public.inventory_counts for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy tenant_read on public.inventory_count_items for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

create or replace function app.start_inventory_count(p_location_id uuid, p_category text default null, p_blind boolean default true, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado abren un conteo' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'Sede no encontrada' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.inventory_counts where tenant_id = v_tenant and location_id = p_location_id and status = 'open') then
    raise exception 'Ya hay un conteo abierto en esa sede' using errcode = 'unique_violation';
  end if;
  insert into public.inventory_counts (tenant_id, number, location_id, category, blind, note)
  values (v_tenant, 'C-' || lpad(app.next_number(v_tenant, 'inventory_count')::text, 4, '0'), p_location_id,
          nullif(trim(p_category), ''), coalesce(p_blind, true), nullif(trim(p_note), ''))
  returning id into v_id;
  insert into public.inventory_count_items (tenant_id, count_id, variant_id)
  select v_tenant, v_id, st.variant_id
  from public.stocks st
  join public.variants v on v.id = st.variant_id and v.deleted_at is null and v.is_active
  join public.products p on p.id = v.product_id and p.deleted_at is null
  where st.tenant_id = v_tenant and st.location_id = p_location_id
    and (nullif(trim(p_category), '') is null or lower(p.category) = lower(trim(p_category)));
  return v_id;
end;
$$;
revoke all on function app.start_inventory_count(uuid, text, boolean, text) from public;
grant execute on function app.start_inventory_count(uuid, text, boolean, text) to authenticated;

-- p_add: suma a lo contado (lector de códigos); si no, fija la cantidad.
-- Un producto que no estaba en el conteo se agrega.
create or replace function app.count_inventory_item(p_count_id uuid, p_variant_id uuid, p_qty numeric, p_add boolean default false)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  c public.inventory_counts;
  v_qty numeric;
begin
  select * into c from public.inventory_counts where id = p_count_id and tenant_id = v_tenant;
  if not found or v_tenant not in (select app.auth_tenant_ids()) then
    raise exception 'Conteo no encontrado' using errcode = 'no_data_found';
  end if;
  if c.status <> 'open' then
    raise exception 'El conteo ya está cerrado' using errcode = 'check_violation';
  end if;
  if p_qty is null or (not coalesce(p_add, false) and p_qty < 0) then
    raise exception 'Cantidad inválida' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.variants where id = p_variant_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'Producto no encontrado' using errcode = 'no_data_found';
  end if;
  insert into public.inventory_count_items (tenant_id, count_id, variant_id, counted, counted_by, counted_at)
  values (v_tenant, c.id, p_variant_id, greatest(p_qty, 0), auth.uid(), now())
  on conflict (count_id, variant_id) do update
    set counted = greatest(case when coalesce(p_add, false) then coalesce(public.inventory_count_items.counted, 0) + p_qty else p_qty end, 0),
        counted_by = auth.uid(), counted_at = now()
  returning counted into v_qty;
  return v_qty;
end;
$$;
revoke all on function app.count_inventory_item(uuid, uuid, numeric, boolean) from public;
grant execute on function app.count_inventory_item(uuid, uuid, numeric, boolean) to authenticated;

create or replace function app.close_inventory_count(p_count_id uuid, p_missing_as_zero boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  c public.inventory_counts;
  x record;
  v_adjusted integer := 0;
  v_plus numeric := 0;
  v_minus numeric := 0;
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado cierran un conteo' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.inventory_counts where id = p_count_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Conteo no encontrado' using errcode = 'no_data_found';
  end if;
  if c.status <> 'open' then
    raise exception 'El conteo ya está cerrado' using errcode = 'check_violation';
  end if;

  -- Lo que dice el sistema al cerrar queda guardado junto a lo contado.
  update public.inventory_count_items i
  set expected = coalesce((select st.on_hand from public.stocks st where st.variant_id = i.variant_id and st.location_id = c.location_id), 0),
      counted = case when i.counted is null and coalesce(p_missing_as_zero, false) then 0 else i.counted end
  where i.count_id = c.id;

  for x in
    select i.variant_id, i.counted - i.expected as delta
    from public.inventory_count_items i
    where i.count_id = c.id and i.counted is not null and i.counted <> i.expected
  loop
    perform app.inventory_adjust(x.variant_id, c.location_id, x.delta, 'Conteo físico ' || c.number, c.note, null);
    v_adjusted := v_adjusted + 1;
    if x.delta > 0 then v_plus := v_plus + x.delta; else v_minus := v_minus - x.delta; end if;
  end loop;

  update public.inventory_counts
  set status = 'closed', closed_by = auth.uid(), closed_at = now(), adjustments = v_adjusted
  where id = c.id;
  return jsonb_build_object('adjustments', v_adjusted, 'plus', v_plus, 'minus', v_minus,
    'counted', (select count(*) from public.inventory_count_items where count_id = c.id and counted is not null),
    'items', (select count(*) from public.inventory_count_items where count_id = c.id));
end;
$$;
revoke all on function app.close_inventory_count(uuid, boolean) from public;
grant execute on function app.close_inventory_count(uuid, boolean) to authenticated;

create or replace function app.cancel_inventory_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado anulan un conteo' using errcode = 'insufficient_privilege';
  end if;
  update public.inventory_counts set status = 'cancelled', closed_by = auth.uid(), closed_at = now()
  where id = p_count_id and tenant_id = v_tenant and status = 'open';
  if not found then
    raise exception 'Conteo no encontrado o ya cerrado' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.cancel_inventory_count(uuid) from public;
grant execute on function app.cancel_inventory_count(uuid) to authenticated;

create function public.start_inventory_count(p_location_id uuid, p_category text default null, p_blind boolean default true, p_note text default null)
returns uuid language sql security invoker set search_path = '' as $$ select app.start_inventory_count(p_location_id, p_category, p_blind, p_note) $$;
create function public.count_inventory_item(p_count_id uuid, p_variant_id uuid, p_qty numeric, p_add boolean default false)
returns numeric language sql security invoker set search_path = '' as $$ select app.count_inventory_item(p_count_id, p_variant_id, p_qty, p_add) $$;
create function public.close_inventory_count(p_count_id uuid, p_missing_as_zero boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$ select app.close_inventory_count(p_count_id, p_missing_as_zero) $$;
create function public.cancel_inventory_count(p_count_id uuid)
returns void language sql security invoker set search_path = '' as $$ select app.cancel_inventory_count(p_count_id) $$;
revoke all on function public.start_inventory_count(uuid, text, boolean, text) from public, anon;
revoke all on function public.count_inventory_item(uuid, uuid, numeric, boolean) from public, anon;
revoke all on function public.close_inventory_count(uuid, boolean) from public, anon;
revoke all on function public.cancel_inventory_count(uuid) from public, anon;
grant execute on function public.start_inventory_count(uuid, text, boolean, text) to authenticated;
grant execute on function public.count_inventory_item(uuid, uuid, numeric, boolean) to authenticated;
grant execute on function public.close_inventory_count(uuid, boolean) to authenticated;
grant execute on function public.cancel_inventory_count(uuid) to authenticated;
