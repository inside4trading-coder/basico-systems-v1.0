-- Recordatorio de cierre de caja.
--
-- Portado de closing_reminder_time (useSublimePosConfig, basicosystems@f551478b):
-- desde esa hora (Caracas) el POS avisa en rojo mientras la caja siga
-- abierta. Null = sin recordatorio. Lo cambian dueño o administrador.

alter table public.tenants add column closing_reminder_time time;

revoke update on public.tenants from authenticated;
grant update (name, base_currency, local_currency, rate_source, is_special_taxpayer, prices_include_tax, igtf_rate,
              legal_name, tax_id, address, phone, receipt_footer, closing_reminder_time)
  on public.tenants to authenticated;
