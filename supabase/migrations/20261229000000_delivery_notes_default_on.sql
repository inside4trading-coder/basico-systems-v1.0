-- La venta con nota de entrega viene encendida en todos los negocios.
-- Cada negocio puede apagarla en Configuración → Impuestos.

alter table public.tenants alter column allow_delivery_notes set default true;
update public.tenants set allow_delivery_notes = true where not allow_delivery_notes;
