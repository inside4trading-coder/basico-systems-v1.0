-- Plantillas de etiqueta: tamaño (rollo o hoja), encabezado y qué campos lleva.
--
--   * Sirven para cualquier producto: el código puede ser de barras, QR o
--     ninguno, y cada campo se prende o apaga.
--   * Las edita quien puede editar el catálogo; todos las leen para imprimir.
--   * Un solo valor por defecto por negocio: marcar uno desmarca los demás.
--   * Sin plantillas guardadas, la app ofrece dos de fábrica (rollo 50 × 25 mm
--     y hoja carta 3 × 10).

create table public.label_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  media text not null default 'roll' check (media in ('roll', 'sheet')),
  width_mm numeric(6, 2) not null check (width_mm between 15 and 200),
  height_mm numeric(6, 2) not null check (height_mm between 10 and 200),
  page text not null default 'letter' check (page in ('letter', 'a4')),
  columns integer not null default 1 check (columns between 1 and 8),
  rows integer not null default 1 check (rows between 1 and 30),
  code_kind text not null default 'barcode' check (code_kind in ('barcode', 'qr', 'none')),
  show_header boolean not null default false,
  header_text text check (header_text is null or length(header_text) <= 60),
  show_tax_id boolean not null default false,
  show_name boolean not null default true,
  show_detail boolean not null default true,
  show_sku boolean not null default false,
  show_price boolean not null default true,
  show_price_local boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index label_templates_default_uq on public.label_templates (tenant_id) where is_default;
create index label_templates_tenant_idx on public.label_templates (tenant_id, name);

alter table public.label_templates enable row level security;
revoke all on public.label_templates from anon;
create policy tenant_read on public.label_templates for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy catalog_insert on public.label_templates for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.has_capability(tenant_id, 'catalogo.editar'));
create policy catalog_update on public.label_templates for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_capability(tenant_id, 'catalogo.editar'))
  with check (tenant_id = (select app.current_tenant_id()) and app.has_capability(tenant_id, 'catalogo.editar'));
create policy catalog_delete on public.label_templates for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_capability(tenant_id, 'catalogo.editar'));

-- Marcar una como predeterminada desmarca las demás del negocio.
create or replace function app.label_templates_single_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_default then
    update public.label_templates set is_default = false
    where tenant_id = new.tenant_id and id <> new.id and is_default;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.label_templates_single_default() from public;

create trigger label_templates_single_default
  before insert or update on public.label_templates
  for each row execute function app.label_templates_single_default();
