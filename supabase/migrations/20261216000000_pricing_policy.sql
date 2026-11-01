-- Política de precios.
--
-- Cada negocio define cómo se forma su precio a partir del costo:
--   precio sin IVA = costo × (1 + gastos de traída) × (1 + ganancia objetivo)
--                    ÷ (1 − suma de comisiones sobre la venta)
-- y el PVP (precio + IVA del producto) con un redondeo comercial. El IVA no es
-- una comisión: se suma aparte, como en toda la app.
--   * pricing_policies: una fila por negocio; se guarda con save_pricing_policy.
--   * variants.priced_cost: el costo que tenía la variante cuando se le fijó el
--     precio. Si el costo cambia después, el precio queda "por revisar".
--   * price_history: cada cambio de costo, precio u oferta, con quién y por qué.
--   * set_variant_prices: fija precios en bloque con un motivo.
-- El cálculo del sugerido vive en la app; aquí solo se guarda lo que se fija.

create table public.pricing_policies (
  tenant_id uuid primary key default app.current_tenant_id() references public.tenants (id) on delete cascade,
  -- Ganancia sobre el costo total (%).
  target_margin numeric(7, 2) not null default 30 check (target_margin >= 0 and target_margin <= 1000),
  -- Envío, fletes y otros gastos de traer la mercancía, como % del costo.
  overhead_pct numeric(6, 2) not null default 0 check (overhead_pct >= 0 and overhead_pct <= 100),
  -- [{ "name": "Vendedor", "pct": 3, "active": true }]: se descuentan de cada venta.
  concepts jsonb not null default '[]'::jsonb check (jsonb_typeof(concepts) = 'array'),
  -- Ganancia mínima sobre el costo total (%) antes de avisar "margen bajo".
  min_margin numeric(7, 2) not null default 15 check (min_margin >= 0 and min_margin <= 1000),
  -- Terminación del PVP: sin redondeo, ,99, ,90 o entero.
  rounding text not null default 'none' check (rounding in ('none', '99', '90', 'int')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.pricing_policies enable row level security;
revoke all on public.pricing_policies from anon;
revoke insert, update, delete on public.pricing_policies from authenticated;
create policy tenant_read on public.pricing_policies for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

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

  insert into public.pricing_policies as p (tenant_id, target_margin, overhead_pct, concepts, min_margin, rounding, updated_by, updated_at)
  values (
    v_tenant,
    coalesce((p_policy ->> 'target_margin')::numeric, 30),
    coalesce((p_policy ->> 'overhead_pct')::numeric, 0),
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
    concepts = excluded.concepts,
    min_margin = excluded.min_margin,
    rounding = excluded.rounding,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;
revoke all on function app.save_pricing_policy(jsonb) from public, anon;
grant execute on function app.save_pricing_policy(jsonb) to authenticated;

create function public.save_pricing_policy(p_policy jsonb)
returns void language sql set search_path = '' as $$ select app.save_pricing_policy(p_policy) $$;
revoke all on function public.save_pricing_policy(jsonb) from public, anon;
grant execute on function public.save_pricing_policy(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Costo con el que se fijó el precio
-- ---------------------------------------------------------------------------

alter table public.variants add column priced_cost numeric(14, 4);
update public.variants set priced_cost = cost where regular_price is not null and cost is not null;

-- Al fijar o cambiar el precio de lista se guarda el costo de ese momento. No
-- se edita a mano.
create or replace function app.variants_priced_cost()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.priced_cost := case when new.regular_price is not null then new.cost end;
  elsif new.regular_price is distinct from old.regular_price then
    new.priced_cost := case when new.regular_price is not null then new.cost end;
  else
    new.priced_cost := old.priced_cost;
  end if;
  return new;
end;
$$;
create trigger variants_priced_cost before insert or update on public.variants
  for each row execute function app.variants_priced_cost();

-- ---------------------------------------------------------------------------
-- Historial de precios
-- ---------------------------------------------------------------------------

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  variant_id uuid not null,
  cost numeric(14, 4),
  regular_price numeric(14, 2),
  price numeric(14, 2),
  prev_cost numeric(14, 4),
  prev_regular_price numeric(14, 2),
  prev_price numeric(14, 2),
  reason text not null check (length(reason) between 1 and 120),
  changed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, variant_id) references public.variants (tenant_id, id) on delete cascade
);
create index price_history_variant_idx on public.price_history (tenant_id, variant_id, created_at desc);

alter table public.price_history enable row level security;
revoke all on public.price_history from anon;
revoke insert, update, delete on public.price_history from authenticated;
create policy tenant_read on public.price_history for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Motivo: el que fija set_variant_prices (u otra función) en app.price_reason;
-- si no, se deduce de lo que cambió.
create or replace function app.variants_price_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(current_setting('app.price_reason', true), '');
begin
  if tg_op = 'INSERT' then
    if new.cost is null and new.regular_price is null and new.price is null then
      return null;
    end if;
    insert into public.price_history (tenant_id, variant_id, cost, regular_price, price, reason)
    values (new.tenant_id, new.id, new.cost, new.regular_price, new.price, coalesce(v_reason, 'Alta del producto'));
    return null;
  end if;
  if new.cost is not distinct from old.cost
     and new.regular_price is not distinct from old.regular_price
     and new.price is not distinct from old.price then
    return null;
  end if;
  insert into public.price_history
    (tenant_id, variant_id, cost, regular_price, price, prev_cost, prev_regular_price, prev_price, reason)
  values (
    new.tenant_id, new.id, new.cost, new.regular_price, new.price, old.cost, old.regular_price, old.price,
    coalesce(v_reason, case
      when new.regular_price is not distinct from old.regular_price and new.price is not distinct from old.price then 'Cambio de costo'
      when new.regular_price is not distinct from old.regular_price then 'Cambio de oferta'
      else 'Cambio de precio' end)
  );
  return null;
end;
$$;
revoke all on function app.variants_price_history() from public, anon, authenticated;
create trigger variants_price_history after insert or update of cost, regular_price, price on public.variants
  for each row execute function app.variants_price_history();

-- ---------------------------------------------------------------------------
-- Fijar precios en bloque
-- ---------------------------------------------------------------------------

-- p_items: [{ "variant_id": uuid, "regular_price": número }]. Si la variante no
-- tenía oferta, el precio vigente sigue al de lista; si la tenía, se respeta.
create or replace function app.set_variant_prices(p_items jsonb, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  it jsonb;
  v_price numeric;
  v_count integer := 0;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'catalogo.editar') then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 2000 then
    raise exception 'Elige entre 1 y 2000 productos' using errcode = 'check_violation';
  end if;
  perform set_config('app.price_reason', left(coalesce(nullif(trim(p_reason), ''), 'Fijación de precios'), 120), true);
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it -> 'regular_price') <> 'number' then
      raise exception 'Precio inválido' using errcode = 'check_violation';
    end if;
    v_price := round((it ->> 'regular_price')::numeric, 2);
    if v_price < 0 then
      raise exception 'Precio inválido' using errcode = 'check_violation';
    end if;
    update public.variants v
    set regular_price = v_price,
        price = case when v.price is null or v.price = v.regular_price or v.price > v_price then v_price else v.price end
    where v.id = (it ->> 'variant_id')::uuid and v.tenant_id = v_tenant and v.deleted_at is null;
    if not found then
      raise exception 'Producto no encontrado' using errcode = 'no_data_found';
    end if;
    v_count := v_count + 1;
  end loop;
  perform set_config('app.price_reason', '', true);
  return v_count;
end;
$$;
revoke all on function app.set_variant_prices(jsonb, text) from public, anon;
grant execute on function app.set_variant_prices(jsonb, text) to authenticated;

create function public.set_variant_prices(p_items jsonb, p_reason text default null)
returns integer language sql set search_path = '' as $$ select app.set_variant_prices(p_items, p_reason) $$;
revoke all on function public.set_variant_prices(jsonb, text) from public, anon;
grant execute on function public.set_variant_prices(jsonb, text) to authenticated;
