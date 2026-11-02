-- Recepción actualiza el costo del producto.
--
-- Una entrada de mercancía con costo unitario (lo que dice la factura del
-- proveedor o la liquidación de importación) pasa a ser el costo de la
-- variante: el costo de la última compra. Con eso:
--   * si la política tiene «Actualizar el precio cuando cambie el costo», el
--     precio se recalcula solo (trigger variants_priced_cost);
--   * si no, el producto queda en «Revisar».
-- Solo cuentan las sedes propias: lo que entra a la lista de un aliado tiene
-- su propio costo de encargo. Una entrada sin costo no cambia nada.

create or replace function app.entry_updates_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'entry' and new.unit_cost > 0 and exists (
    select 1 from public.locations l
    where l.tenant_id = new.tenant_id and l.id = new.location_id and l.type <> 'external'
  ) then
    update public.variants
    set cost = new.unit_cost
    where tenant_id = new.tenant_id and id = new.variant_id and cost is distinct from new.unit_cost;
  end if;
  return null;
end;
$$;
revoke all on function app.entry_updates_cost() from public, anon, authenticated;

create trigger inventory_movements_entry_cost after insert on public.inventory_movements
  for each row when (new.kind = 'entry' and new.unit_cost is not null)
  execute function app.entry_updates_cost();
