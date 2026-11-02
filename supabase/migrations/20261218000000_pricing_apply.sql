-- La política de precios se aplica a todo el inventario.
--
--   * app.pricing_net: el precio sin IVA que da la política para un costo, con
--     la misma cuenta que la app (src/modules/inventory/pricing/pricing.ts):
--     traída, ganancia, reposición, comisiones, IVA, redondeo del PVP y el
--     precio sin IVA que da ese PVP exacto.
--   * apply_pricing_policy: calcula (y si se pide, aplica) el precio de la
--     política a todas las variantes con costo, salvo las de precio manual.
--   * variants.price_locked: precio manual; la política no lo toca.
--   * pricing_policies.auto_on_cost: si está encendida, cuando cambia el costo
--     de una variante su precio se recalcula con la política.

alter table public.variants add column price_locked boolean not null default false;
alter table public.pricing_policies add column auto_on_cost boolean not null default true;

-- ---------------------------------------------------------------------------
-- La cuenta
-- ---------------------------------------------------------------------------

-- PVP de un precio sin IVA: mismo redondeo que withTax en la app.
create or replace function app.pricing_with_tax(p_net numeric, p_rate numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$ select round(round(p_net, 2) + round(p_net * p_rate / 100, 2), 2) $$;

create or replace function app.pricing_net(p public.pricing_policies, p_cost numeric, p_tax numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_fees numeric;
  v_value numeric;
  v_pvp numeric;
  v_net numeric;
begin
  if p_cost is null or p_cost <= 0 then
    return null;
  end if;
  select coalesce(sum((c ->> 'pct')::numeric), 0) / 100 into v_fees
  from jsonb_array_elements(p.concepts) c
  where (c ->> 'active')::boolean;
  if v_fees >= 0.9 then
    return null;
  end if;
  v_value := p_cost * (1 + p.overhead_pct / 100) * (1 + p.target_margin / 100) * (1 + p.replacement_pct / 100) / (1 - v_fees);
  v_value := app.pricing_with_tax(round(v_value, 2), p_tax);
  -- Redondeo comercial hacia arriba.
  v_pvp := case p.rounding
    when '99' then ceil(v_value - 0.99) + 0.99
    when '90' then ceil(v_value - 0.90) + 0.90
    when 'int' then ceil(v_value)
    else v_value
  end;
  -- Precio sin IVA que con el IVA da exacto ese PVP.
  v_net := round(v_pvp / (1 + p_tax / 100), 2);
  while app.pricing_with_tax(v_net, p_tax) < v_pvp loop
    v_net := v_net + 0.01;
  end loop;
  while v_net > 0 and app.pricing_with_tax(v_net - 0.01, p_tax) >= v_pvp loop
    v_net := v_net - 0.01;
  end loop;
  return v_net;
end;
$$;
revoke all on function app.pricing_with_tax(numeric, numeric) from public, anon;
revoke all on function app.pricing_net(public.pricing_policies, numeric, numeric) from public, anon;

-- IVA de un producto: el suyo o el del negocio; 0 si no hay.
create or replace function app.product_tax_rate(p_tenant uuid, p_product uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select x.rate from public.products p join public.tax_rates x on x.tenant_id = p.tenant_id and x.id = p.tax_rate_id
      where p.tenant_id = p_tenant and p.id = p_product),
    (select x.rate from public.tax_rates x where x.tenant_id = p_tenant and x.is_default),
    0)
$$;
revoke all on function app.product_tax_rate(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Costo fijado y precio automático al cambiar el costo
-- ---------------------------------------------------------------------------

-- Reemplaza a la de 20261216000000_pricing_policy.sql. Además de guardar el
-- costo con que se fijó el precio:
--   * si la política tiene auto_on_cost y la variante no es de precio manual,
--     un costo nuevo (o una variante nueva con costo y sin precio) recibe el
--     precio de la política. Si en la misma operación se escribe el precio,
--     se respeta el que se escribe;
--   * fijar precio con set_variant_prices o apply_pricing_policy (marcan
--     app.price_reason) guarda el costo aunque el precio no cambie.
create or replace function app.variants_priced_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.pricing_policies;
  v_net numeric;
  v_fixing boolean := coalesce(current_setting('app.price_reason', true), '') <> '';
begin
  if not new.price_locked and new.cost > 0
     and (case when tg_op = 'INSERT' then new.regular_price is null
          else new.cost is distinct from old.cost and new.regular_price is not distinct from old.regular_price end) then
    select * into v_policy from public.pricing_policies where tenant_id = new.tenant_id and auto_on_cost;
    if found then
      v_net := app.pricing_net(v_policy, new.cost, app.product_tax_rate(new.tenant_id, new.product_id));
      if v_net is not null then
        if tg_op = 'INSERT' then
          new.price := coalesce(new.price, v_net);
        elsif new.price is not distinct from old.price then
          new.price := case when old.price is null or old.price = old.regular_price or old.price > v_net then v_net else old.price end;
        end if;
        new.regular_price := v_net;
        new.priced_cost := new.cost;
        return new;
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or new.regular_price is distinct from old.regular_price or v_fixing then
    new.priced_cost := case when new.regular_price is not null then new.cost end;
  else
    new.priced_cost := old.priced_cost;
  end if;
  return new;
end;
$$;
revoke all on function app.variants_priced_cost() from public, anon, authenticated;

-- El historial anota «Cambio de costo» siempre que cambió el costo, también
-- cuando el precio se movió con él (antes decía «Cambio de precio»).
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
      when new.cost is distinct from old.cost then 'Cambio de costo'
      when new.regular_price is not distinct from old.regular_price then 'Cambio de oferta'
      else 'Cambio de precio' end)
  );
  return null;
end;
$$;
revoke all on function app.variants_price_history() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Aplicar la política a todo el inventario
-- ---------------------------------------------------------------------------

-- p_dry_run = true solo cuenta; false aplica. Devuelve
-- { changed, up, down, same, locked, no_cost }. No toca variantes de precio
-- manual ni sin costo. Las ofertas se respetan como en set_variant_prices.
create or replace function app.apply_pricing_policy(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_policy public.pricing_policies;
  v_default numeric;
  v_result jsonb;
  v_applied integer;
begin
  if v_tenant is null or not app.has_capability(v_tenant, 'catalogo.editar') then
    raise exception 'No autorizado' using errcode = 'insufficient_privilege';
  end if;
  select * into v_policy from public.pricing_policies where tenant_id = v_tenant;
  if not found then
    raise exception 'Primero guarda la política de precios' using errcode = 'no_data_found';
  end if;
  select x.rate into v_default from public.tax_rates x where x.tenant_id = v_tenant and x.is_default;

  create temp table _pricing_apply on commit drop as
  select v.id, v.regular_price, v.cost, v.priced_cost, v.price_locked,
         case when v.price_locked then null
              else app.pricing_net(v_policy, v.cost, coalesce(x.rate, v_default, 0)) end as net
  from public.variants v
  join public.products p on p.tenant_id = v.tenant_id and p.id = v.product_id
  left join public.tax_rates x on x.tenant_id = p.tenant_id and x.id = p.tax_rate_id
  where v.tenant_id = v_tenant and v.deleted_at is null and p.deleted_at is null;

  select jsonb_build_object(
    'changed', count(*) filter (where net is not null and net is distinct from regular_price),
    'up', count(*) filter (where net is not null and (regular_price is null or net > regular_price)),
    'down', count(*) filter (where net is not null and net < regular_price),
    'same', count(*) filter (where net is not null and net = regular_price),
    'locked', count(*) filter (where price_locked and cost > 0),
    'no_cost', count(*) filter (where not (coalesce(cost, 0) > 0))
  ) into v_result from _pricing_apply;

  if not p_dry_run then
    perform set_config('app.price_reason', 'Política de precios', true);
    update public.variants v
    set regular_price = a.net,
        price = case when v.price is null or v.price = v.regular_price or v.price > a.net then a.net else v.price end
    from _pricing_apply a
    where v.id = a.id and v.tenant_id = v_tenant and a.net is not null
      and (a.net is distinct from a.regular_price or a.priced_cost is distinct from a.cost);
    get diagnostics v_applied = row_count;
    perform set_config('app.price_reason', '', true);
    v_result := v_result || jsonb_build_object('applied', v_applied);
  end if;
  drop table _pricing_apply;
  return v_result;
end;
$$;
revoke all on function app.apply_pricing_policy(boolean) from public, anon;
grant execute on function app.apply_pricing_policy(boolean) to authenticated;

create function public.apply_pricing_policy(p_dry_run boolean default true)
returns jsonb language sql set search_path = '' as $$ select app.apply_pricing_policy(p_dry_run) $$;
revoke all on function public.apply_pricing_policy(boolean) from public, anon;
grant execute on function public.apply_pricing_policy(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Fijar precios: ahora también marca o quita el precio manual
-- ---------------------------------------------------------------------------

-- p_items: [{ "variant_id": uuid, "regular_price": número, "price_locked"?: bool }].
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
    if jsonb_typeof(it -> 'regular_price') <> 'number'
       or (it ? 'price_locked' and jsonb_typeof(it -> 'price_locked') <> 'boolean') then
      raise exception 'Precio inválido' using errcode = 'check_violation';
    end if;
    v_price := round((it ->> 'regular_price')::numeric, 2);
    if v_price < 0 then
      raise exception 'Precio inválido' using errcode = 'check_violation';
    end if;
    update public.variants v
    set regular_price = v_price,
        price = case when v.price is null or v.price = v.regular_price or v.price > v_price then v_price else v.price end,
        price_locked = coalesce((it ->> 'price_locked')::boolean, v.price_locked)
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

-- ---------------------------------------------------------------------------
-- Guardar la política: ahora con auto_on_cost
-- ---------------------------------------------------------------------------

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
  if p_policy ? 'auto_on_cost' and jsonb_typeof(p_policy -> 'auto_on_cost') <> 'boolean' then
    raise exception 'auto_on_cost debe ser sí o no' using errcode = 'check_violation';
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

  insert into public.pricing_policies as p
    (tenant_id, target_margin, overhead_pct, replacement_pct, concepts, min_margin, rounding, auto_on_cost, updated_by, updated_at)
  values (
    v_tenant,
    coalesce((p_policy ->> 'target_margin')::numeric, 30),
    coalesce((p_policy ->> 'overhead_pct')::numeric, 0),
    coalesce((p_policy ->> 'replacement_pct')::numeric, 0),
    (select coalesce(jsonb_agg(jsonb_build_object('name', trim(x ->> 'name'), 'pct', (x ->> 'pct')::numeric, 'active', (x ->> 'active')::boolean)), '[]'::jsonb)
       from jsonb_array_elements(v_concepts) x),
    coalesce((p_policy ->> 'min_margin')::numeric, 15),
    coalesce(p_policy ->> 'rounding', 'none'),
    coalesce((p_policy ->> 'auto_on_cost')::boolean, true),
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
    auto_on_cost = excluded.auto_on_cost,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;
