-- Centro de conciliación: guías de cada fuente de archivos.
--
-- Portado de SublimeAdminImportCenter y EditableGuide (basicosystems@9cb08cd).
-- En el ERP los pasos de «¿Dónde obtengo este archivo?» se guardaban en el
-- navegador; aquí quedan en el negocio para que el dueño o el administrador los
-- escriba una vez y todo el equipo de administración los vea.
--   source_key: 'account:<id de la cuenta>' para un estado de cuenta, o
--   'financing:orders' / 'financing:payments' para los archivos de la financiadora.

create table public.import_guides (
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  source_key text not null check (source_key ~ '^(account:[0-9a-f-]{36}|financing:(orders|payments))$'),
  steps text not null check (length(trim(steps)) between 1 and 2000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, source_key)
);

alter table public.import_guides enable row level security;
revoke all on public.import_guides from anon;
revoke update, delete on public.import_guides from authenticated;
create policy tenant_read on public.import_guides for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy admin_insert on public.import_guides for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy admin_update on public.import_guides for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy admin_delete on public.import_guides for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_tenant_role(tenant_id, array['owner', 'admin']));
-- El upsert reescribe la clave con el mismo valor.
grant update (source_key, steps, updated_by, updated_at) on public.import_guides to authenticated;
grant delete on public.import_guides to authenticated;
create trigger import_guides_touch before update on public.import_guides
  for each row execute function app.touch_updated_at();
