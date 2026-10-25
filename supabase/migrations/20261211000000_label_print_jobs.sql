-- Historial de impresión de etiquetas y buscador de etiquetas por unidad.
--
--   * label_print_jobs: cada impresión (de precio o por unidad) con su
--     plantilla, cantidad, quién y cuándo. Una reimpresión de etiquetas por
--     unidad ya impresas lleva motivo.
--   * log_label_print(): registra la impresión y, si son etiquetas por unidad,
--     marca impresas las nuevas. Imprimir precios lo puede cualquiera del
--     negocio; las de unidad piden «inventario.etiquetas».
--   * search_item_labels(): por código, serial, SKU o nombre del producto, con
--     su entrada de origen y cuántas veces se imprimió.

create table public.label_print_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('price', 'unit')),
  template_id uuid references public.label_templates (id) on delete set null,
  template_name text not null check (length(template_name) between 1 and 80),
  quantity integer not null check (quantity between 1 and 500),
  label_ids uuid[] not null default '{}',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  is_reprint boolean not null default false,
  reason text check (reason is null or length(reason) <= 200),
  printed_by uuid default auth.uid(),
  printed_at timestamptz not null default now(),
  check (kind = 'price' or cardinality(label_ids) > 0)
);
create index label_print_jobs_tenant_idx on public.label_print_jobs (tenant_id, printed_at desc);
create index label_print_jobs_labels_idx on public.label_print_jobs using gin (label_ids);

alter table public.label_print_jobs enable row level security;
revoke all on public.label_print_jobs from anon;
revoke insert, update, delete on public.label_print_jobs from authenticated;
create policy tenant_read on public.label_print_jobs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

create or replace function app.log_label_print(
  p_kind text, p_template_id uuid, p_template_name text, p_quantity integer,
  p_label_ids uuid[] default '{}', p_items jsonb default '[]'::jsonb, p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_ids uuid[];
  v_reprint boolean := false;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_template uuid;
  v_id uuid;
begin
  if v_tenant is null then
    raise exception 'Elige un negocio' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('price', 'unit') then
    raise exception 'Tipo de impresión no válido' using errcode = 'check_violation';
  end if;
  if coalesce(p_quantity, 0) not between 1 and 500 then
    raise exception 'Entre 1 y 500 etiquetas por impresión' using errcode = 'check_violation';
  end if;
  if p_template_id is not null then
    select id into v_template from public.label_templates where id = p_template_id and tenant_id = v_tenant;
  end if;

  if p_kind = 'unit' then
    if not app.has_capability(v_tenant, 'inventario.etiquetas') then
      raise exception 'No tienes permiso para las etiquetas por unidad' using errcode = 'insufficient_privilege';
    end if;
    select array_agg(id) into v_ids
    from public.item_labels where tenant_id = v_tenant and id = any (p_label_ids) and status <> 'disabled';
    if v_ids is null then
      raise exception 'No hay etiquetas activas para imprimir' using errcode = 'check_violation';
    end if;
    -- Reimpresión: todas ya estaban impresas.
    v_reprint := not exists (select 1 from public.item_labels where id = any (v_ids) and status = 'generated');
    if v_reprint and v_reason is null then
      raise exception 'Escribe el motivo de la reimpresión' using errcode = 'check_violation';
    end if;
    update public.item_labels set status = 'printed', printed_at = coalesce(printed_at, now())
    where id = any (v_ids) and status = 'generated';
  end if;

  insert into public.label_print_jobs (tenant_id, kind, template_id, template_name, quantity, label_ids, items, is_reprint, reason)
  values (v_tenant, p_kind, v_template, left(coalesce(nullif(trim(p_template_name), ''), 'Plantilla'), 80),
          case when p_kind = 'unit' then cardinality(v_ids) else p_quantity end,
          coalesce(v_ids, '{}'), coalesce(p_items, '[]'::jsonb), v_reprint, left(v_reason, 200))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.log_label_print(text, uuid, text, integer, uuid[], jsonb, text) from public;
grant execute on function app.log_label_print(text, uuid, text, integer, uuid[], jsonb, text) to authenticated;

create function public.log_label_print(
  p_kind text, p_template_id uuid, p_template_name text, p_quantity integer,
  p_label_ids uuid[] default '{}', p_items jsonb default '[]'::jsonb, p_reason text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.log_label_print(p_kind, p_template_id, p_template_name, p_quantity, p_label_ids, p_items, p_reason)
$$;
revoke all on function public.log_label_print(text, uuid, text, integer, uuid[], jsonb, text) from public, anon;
grant execute on function public.log_label_print(text, uuid, text, integer, uuid[], jsonb, text) to authenticated;

-- Historial con quién imprimió.
create or replace function app.label_print_history(p_limit integer default 200)
returns table (
  id uuid, kind text, template_name text, quantity integer, is_reprint boolean, reason text,
  printed_at timestamptz, printed_by_email text, label_codes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.kind, j.template_name, j.quantity, j.is_reprint, j.reason, j.printed_at,
         (select m.email from public.tenant_members m where m.tenant_id = j.tenant_id and m.user_id = j.printed_by),
         (select array_agg(l.code order by l.code) from (
            select l.code from public.item_labels l where l.id = any (j.label_ids) order by l.code limit 6) l)
  from public.label_print_jobs j
  where j.tenant_id = app.current_tenant_id()
  order by j.printed_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;
revoke all on function app.label_print_history(integer) from public;
grant execute on function app.label_print_history(integer) to authenticated;

create function public.label_print_history(p_limit integer default 200)
returns table (
  id uuid, kind text, template_name text, quantity integer, is_reprint boolean, reason text,
  printed_at timestamptz, printed_by_email text, label_codes text[]
)
language sql security invoker set search_path = '' as $$ select * from app.label_print_history(p_limit) $$;
revoke all on function public.label_print_history(integer) from public, anon;
grant execute on function public.label_print_history(integer) to authenticated;

-- Buscador de etiquetas por unidad.
create or replace function app.search_item_labels(p_query text)
returns table (
  id uuid, code text, is_serial boolean, status text, origin text, disabled_reason text,
  created_at timestamptz, printed_at timestamptz, disabled_at timestamptz,
  variant_id uuid, sku text, options jsonb, product_id uuid, product_name text,
  entry_at timestamptz, entry_note text, entry_supplier text, times_printed bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as raw)
  select l.id, l.code, l.is_serial, l.status, l.origin, l.disabled_reason,
         l.created_at, l.printed_at, l.disabled_at,
         v.id, v.sku, v.options, p.id, p.name,
         m.created_at, m.note, m.supplier,
         (select count(*) from public.label_print_jobs j where j.tenant_id = l.tenant_id and l.id = any (j.label_ids))
  from q, public.item_labels l
  join public.variants v on v.id = l.variant_id
  join public.products p on p.id = v.product_id
  left join public.inventory_movements m on m.id = l.movement_id
  where l.tenant_id = app.current_tenant_id()
    and q.raw is not null and length(q.raw) >= 2
    and (upper(l.code) like '%' || upper(q.raw) || '%'
         or upper(coalesce(v.sku, '')) like '%' || upper(q.raw) || '%'
         or app.fold(p.name) like '%' || app.fold(q.raw) || '%')
  order by (upper(l.code) = upper(q.raw)) desc, p.name, l.unit_number nulls last, l.code
  limit 200
$$;
revoke all on function app.search_item_labels(text) from public;
grant execute on function app.search_item_labels(text) to authenticated;

create function public.search_item_labels(p_query text)
returns table (
  id uuid, code text, is_serial boolean, status text, origin text, disabled_reason text,
  created_at timestamptz, printed_at timestamptz, disabled_at timestamptz,
  variant_id uuid, sku text, options jsonb, product_id uuid, product_name text,
  entry_at timestamptz, entry_note text, entry_supplier text, times_printed bigint
)
language sql security invoker set search_path = '' as $$ select * from app.search_item_labels(p_query) $$;
revoke all on function public.search_item_labels(text) from public, anon;
grant execute on function public.search_item_labels(text) to authenticated;
