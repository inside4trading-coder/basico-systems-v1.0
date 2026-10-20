-- Datos del negocio en la nota de entrega.
--
-- Portado de useSublimeReceiptSettings (basicosystems@f551478b): razón
-- social, RIF, dirección, teléfono y pie de página del comprobante. Los del
-- negocio van en tenants (dueño o administrador los cambian) y cada sede puede
-- tener su propia dirección y teléfono, que se imprimen bajo su nombre.

alter table public.tenants
  add column legal_name text check (legal_name is null or length(trim(legal_name)) between 1 and 160),
  add column tax_id text check (tax_id is null or length(trim(tax_id)) between 3 and 30),
  add column address text check (address is null or length(trim(address)) between 1 and 240),
  add column phone text check (phone is null or length(trim(phone)) between 7 and 40),
  add column receipt_footer text check (receipt_footer is null or length(trim(receipt_footer)) between 1 and 300);

revoke update on public.tenants from authenticated;
grant update (name, base_currency, local_currency, rate_source, is_special_taxpayer, prices_include_tax, igtf_rate,
              legal_name, tax_id, address, phone, receipt_footer)
  on public.tenants to authenticated;

alter table public.locations
  add column address text check (address is null or length(trim(address)) between 1 and 240),
  add column phone text check (phone is null or length(trim(phone)) between 7 and 40);
