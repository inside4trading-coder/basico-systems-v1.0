-- Lectura por negocio activo.
--
-- Hasta aquí las policies de lectura de las tablas de negocio usaban
-- `tenant_id in (select app.auth_tenant_ids())`: un usuario miembro de dos
-- negocios veía filas de ambos en cada pantalla, aunque el cliente manda el
-- negocio activo en x-tenant-id y no repite el filtro en las queries.
--
-- Ahora leen solo el negocio activo: `tenant_id = (select app.current_tenant_id())`.
-- current_tenant_id() ya valida la membresía, así que sin header (o con uno
-- ajeno) no se lee nada.
--
-- Fuera de este cambio, a propósito:
--   * tenants y tenant_members siguen con auth_tenant_ids(): el selector de
--     negocio necesita ver todas las membresías del usuario.
--   * exchange_rates es @global.
--   * Las RPC SECURITY DEFINER, las edge functions con service_role y los
--     triggers no pasan por estas policies.

drop policy tenant_entitlements_select on public.tenant_entitlements;
create policy tenant_entitlements_select on public.tenant_entitlements
  for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Inventario
drop policy tenant_read on public.locations;
create policy tenant_read on public.locations for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.products;
create policy tenant_read on public.products for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.variants;
create policy tenant_read on public.variants for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.product_codes;
create policy tenant_read on public.product_codes for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.attribute_defs;
create policy tenant_read on public.attribute_defs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.product_attribute_values;
create policy tenant_read on public.product_attribute_values for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.product_relations;
create policy tenant_read on public.product_relations for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.stocks;
create policy tenant_read on public.stocks for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.inventory_movements;
create policy tenant_read on public.inventory_movements for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Importador
drop policy tenant_read on public.import_templates;
create policy tenant_read on public.import_templates for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.import_jobs;
create policy tenant_read on public.import_jobs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- Tasas, impuestos y métodos de pago
drop policy tenant_read on public.tenant_rates;
create policy tenant_read on public.tenant_rates for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.tax_rates;
create policy tenant_read on public.tax_rates for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.payment_methods;
create policy tenant_read on public.payment_methods for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

-- POS: cajas, sesiones y ventas
drop policy tenant_read on public.registers;
create policy tenant_read on public.registers for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.cash_sessions;
create policy tenant_read on public.cash_sessions for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.cash_counts;
create policy tenant_read on public.cash_counts for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.sales;
create policy tenant_read on public.sales for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.sale_items;
create policy tenant_read on public.sale_items for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.sale_payments;
create policy tenant_read on public.sale_payments for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.cash_movements;
create policy tenant_read on public.cash_movements for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
drop policy tenant_read on public.tenant_counters;
create policy tenant_read on public.tenant_counters for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
