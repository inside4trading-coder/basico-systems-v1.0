-- Número de factura en la venta.
--
-- Portado de sublime_update_sale_invoice (SublimeVentas, basicosystems@f551478b):
-- la app emite nota de entrega; si el negocio factura aparte (máquina fiscal
-- o imprenta digital), anota aquí el número de la factura para encontrarla.
-- Dueño, administrador o encargado; se puede corregir o borrar.

alter table public.sales add column invoice_number text check (invoice_number is null or length(trim(invoice_number)) between 1 and 40);
create index sales_invoice_idx on public.sales (tenant_id, invoice_number) where invoice_number is not null;

create or replace function app.set_sale_invoice(p_sale_id uuid, p_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']) then
    raise exception 'Solo dueño, administrador o encargado anotan la factura' using errcode = 'insufficient_privilege';
  end if;
  update public.sales set invoice_number = nullif(trim(p_number), '')
  where id = p_sale_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.set_sale_invoice(uuid, text) from public;
grant execute on function app.set_sale_invoice(uuid, text) to authenticated;

create function public.set_sale_invoice(p_sale_id uuid, p_number text)
returns void language sql security invoker set search_path = '' as $$ select app.set_sale_invoice(p_sale_id, p_number) $$;
revoke all on function public.set_sale_invoice(uuid, text) from public, anon;
grant execute on function public.set_sale_invoice(uuid, text) to authenticated;
