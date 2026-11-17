-- Por pagar: tipo de documento del proveedor.
--
--   * document_kind: 'invoice' (factura fiscal) o 'delivery_note' (nota de
--     entrega). Lo ya cargado queda como factura, que es como se registraba.
--   * Una nota de entrega no lleva IVA (no da crédito fiscal). El n.º de
--     control sigue siendo opcional en ambos.
--   * El mismo número puede existir como nota y como factura del mismo
--     proveedor: llevan numeraciones distintas.
--   * set_payable_document: corrige el tipo, el n.º, el control o el IVA de un
--     documento ya cargado (por ejemplo, cuando la nota se cambia por la
--     factura). No cambia lo que se debe ni las cuotas.
--   * beto_payables_detail devuelve el tipo de cada documento.

alter table public.payables
  add column document_kind text not null default 'invoice'
    check (document_kind in ('invoice', 'delivery_note'));
alter table public.payables
  add constraint payables_delivery_note_no_tax check (document_kind = 'invoice' or coalesce(tax_amount, 0) = 0);
comment on column public.payables.document_kind is 'invoice: factura fiscal · delivery_note: nota de entrega (sin IVA).';

drop index public.payables_document_uq;
create unique index payables_document_uq on public.payables (tenant_id, supplier_id, document_kind, lower(document))
  where document is not null and status <> 'cancelled';

create or replace function app.payable_document_kind(p_kind text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(p_kind, '') is null then
    return 'invoice';
  end if;
  if p_kind not in ('invoice', 'delivery_note') then
    raise exception 'Tipo de documento inválido' using errcode = 'check_violation';
  end if;
  return p_kind;
end;
$$;
revoke all on function app.payable_document_kind(text) from public;

create or replace function app.payable_duplicate_message(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_kind = 'delivery_note' then 'Esa nota de entrega de este proveedor ya está cargada'
              else 'Esa factura de este proveedor ya está cargada' end
$$;
revoke all on function app.payable_duplicate_message(text) from public;

-- ---------------------------------------------------------------------------
-- Factura nueva (Por pagar)
-- ---------------------------------------------------------------------------

create or replace function app.create_payable(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  r public.payables;
  v_kind text := app.payable_document_kind(p ->> 'document_kind');
  v_amount numeric := round(nullif(p ->> 'amount', '')::numeric, 2);
  v_tax numeric := round(nullif(p ->> 'tax_amount', '')::numeric, 2);
  v_subtotal numeric := round(nullif(p ->> 'subtotal', '')::numeric, 2);
begin
  if v_amount is null or v_amount <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.suppliers where id = (p ->> 'supplier_id')::uuid and tenant_id = v_tenant) then
    raise exception 'Elige el proveedor' using errcode = 'check_violation';
  end if;
  if v_kind = 'delivery_note' and coalesce(v_tax, 0) > 0 then
    raise exception 'Una nota de entrega no lleva IVA' using errcode = 'check_violation';
  end if;
  if v_tax is not null and v_tax > v_amount then
    raise exception 'El IVA no puede superar el total' using errcode = 'check_violation';
  end if;
  if v_tax is not null and v_subtotal is null then
    v_subtotal := v_amount - v_tax;
  end if;
  insert into public.payables (
    tenant_id, supplier_id, document_kind, document, control_number, issued_on, currency, subtotal, tax_amount, amount, category, note, source
  ) values (
    v_tenant, (p ->> 'supplier_id')::uuid, v_kind, nullif(trim(p ->> 'document'), ''), nullif(trim(p ->> 'control_number'), ''),
    coalesce(nullif(p ->> 'issued_on', '')::date, (now() at time zone 'America/Caracas')::date),
    coalesce(nullif(p ->> 'currency', ''), (select base_currency from public.tenants where id = v_tenant)),
    v_subtotal, v_tax, v_amount, coalesce(nullif(trim(p ->> 'category'), ''), 'Proveedores'), nullif(trim(p ->> 'note'), ''), 'manual'
  ) returning * into r;
  perform app.payable_set_installments(r, p -> 'installments');
  return r.id;
exception when unique_violation then
  raise exception '%', app.payable_duplicate_message(v_kind) using errcode = 'unique_violation';
end;
$$;
revoke all on function app.create_payable(jsonb) from public;
grant execute on function app.create_payable(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Recepción a crédito
-- ---------------------------------------------------------------------------

-- p: {location_id, supplier_id, document_kind, document, control_number, issued_on,
--     tax_amount, note, installments, lines: [{variant_id, qty, unit_cost, expected_qty}]}
create or replace function app.receive_on_credit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  t public.tenants;
  s public.suppliers;
  l public.locations;
  r public.payables;
  x record;
  v_kind text := app.payable_document_kind(p ->> 'document_kind');
  v_subtotal numeric := 0;
  v_tax numeric := round(nullif(p ->> 'tax_amount', '')::numeric, 2);
  v_count integer := 0;
begin
  select * into t from public.tenants where id = v_tenant;
  select * into s from public.suppliers where id = (p ->> 'supplier_id')::uuid and tenant_id = v_tenant;
  if not found then
    raise exception 'Elige el proveedor' using errcode = 'check_violation';
  end if;
  select * into l from public.locations where id = (p ->> 'location_id')::uuid and tenant_id = v_tenant;
  if not found then
    raise exception 'Elige la sede' using errcode = 'check_violation';
  end if;
  if l.type = 'external' then
    raise exception 'La mercancía de un aliado no se compra a crédito' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'Agrega al menos un producto' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p -> 'lines') > 500 then
    raise exception 'Máximo 500 productos por recepción' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_to_recordset(p -> 'lines') as y(variant_id uuid, qty numeric, unit_cost numeric)
             where y.unit_cost is null or y.unit_cost <= 0) then
    raise exception 'A crédito, cada producto necesita su costo de compra' using errcode = 'check_violation';
  end if;
  if v_tax is not null and v_tax < 0 then
    raise exception 'IVA inválido' using errcode = 'check_violation';
  end if;
  if v_kind = 'delivery_note' and coalesce(v_tax, 0) > 0 then
    raise exception 'Una nota de entrega no lleva IVA' using errcode = 'check_violation';
  end if;

  for x in select * from jsonb_to_recordset(p -> 'lines') as y(variant_id uuid, qty numeric, unit_cost numeric, expected_qty numeric) loop
    perform app.inventory_entry(x.variant_id, l.id, x.qty, x.unit_cost, s.name,
                                coalesce(nullif(trim(p ->> 'note'), ''),
                                         case when v_kind = 'delivery_note' then 'Nota de entrega ' else 'Factura ' end
                                         || coalesce(nullif(trim(p ->> 'document'), ''), 's/n') || ' a crédito'),
                                x.expected_qty);
    v_subtotal := v_subtotal + round(x.qty * x.unit_cost, 2);
    v_count := v_count + 1;
  end loop;

  insert into public.payables (
    tenant_id, supplier_id, document_kind, document, control_number, issued_on, currency, subtotal, tax_amount, amount, category, note, source, location_id
  ) values (
    v_tenant, s.id, v_kind, nullif(trim(p ->> 'document'), ''), nullif(trim(p ->> 'control_number'), ''),
    coalesce(nullif(p ->> 'issued_on', '')::date, (now() at time zone 'America/Caracas')::date),
    t.base_currency, v_subtotal, v_tax, v_subtotal + coalesce(v_tax, 0), 'Proveedores', nullif(trim(p ->> 'note'), ''), 'reception', l.id
  ) returning * into r;
  perform app.payable_set_installments(r, p -> 'installments');
  return jsonb_build_object('payable_id', r.id, 'lines', v_count, 'amount', r.amount, 'currency', r.currency, 'document_kind', r.document_kind);
exception when unique_violation then
  raise exception '%', app.payable_duplicate_message(v_kind) using errcode = 'unique_violation';
end;
$$;
revoke all on function app.receive_on_credit(jsonb) from public;
grant execute on function app.receive_on_credit(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Corregir el documento (por ejemplo, la nota se cambia por la factura)
-- ---------------------------------------------------------------------------

create or replace function app.set_payable_document(
  p_payable_id uuid, p_kind text, p_document text default null, p_control_number text default null, p_tax_amount numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  r public.payables := app.payable_for_write(v_tenant, p_payable_id);
  v_kind text := app.payable_document_kind(p_kind);
  v_tax numeric := round(p_tax_amount, 2);
begin
  if r.status = 'cancelled' then
    raise exception 'La cuenta por pagar está anulada' using errcode = 'check_violation';
  end if;
  if v_tax is not null and v_tax < 0 then
    raise exception 'IVA inválido' using errcode = 'check_violation';
  end if;
  if v_kind = 'delivery_note' and coalesce(v_tax, 0) > 0 then
    raise exception 'Una nota de entrega no lleva IVA' using errcode = 'check_violation';
  end if;
  if v_tax is not null and v_tax > r.amount then
    raise exception 'El IVA no puede superar el total' using errcode = 'check_violation';
  end if;
  if v_kind = 'delivery_note' then
    v_tax := null;
  end if;
  update public.payables
  set document_kind = v_kind,
      document = nullif(trim(p_document), ''),
      control_number = nullif(trim(p_control_number), ''),
      tax_amount = v_tax,
      -- Lo que se debe no cambia: la base es el total menos el IVA.
      subtotal = case when v_tax is null and r.tax_amount is null then r.subtotal else r.amount - coalesce(v_tax, 0) end
  where id = r.id;
exception when unique_violation then
  raise exception '%', app.payable_duplicate_message(v_kind) using errcode = 'unique_violation';
end;
$$;
revoke all on function app.set_payable_document(uuid, text, text, text, numeric) from public;
grant execute on function app.set_payable_document(uuid, text, text, text, numeric) to authenticated;

create function public.set_payable_document(
  p_payable_id uuid, p_kind text, p_document text default null, p_control_number text default null, p_tax_amount numeric default null
)
returns void language sql security invoker set search_path = '' as $$
  select app.set_payable_document(p_payable_id, p_kind, p_document, p_control_number, p_tax_amount)
$$;
revoke all on function public.set_payable_document(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.set_payable_document(uuid, text, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Beto: a quién le debo, con el tipo de documento
-- ---------------------------------------------------------------------------

create or replace function app.beto_payables_detail(p_only_overdue boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  return jsonb_build_object(
    'today', v_today,
    'by_supplier', coalesce((
      select jsonb_agg(jsonb_build_object('supplier', x.supplier, 'currency', x.currency, 'invoices', x.invoices,
                                          'delivery_notes', x.delivery_notes,
                                          'balance', x.balance, 'overdue', x.overdue, 'next_due', x.next_due)
             order by x.balance desc)
      from (
        select coalesce(su.name, 'Sin proveedor') as supplier, p.currency,
               count(distinct p.id) filter (where p.document_kind = 'invoice') as invoices,
               count(distinct p.id) filter (where p.document_kind = 'delivery_note') as delivery_notes,
               round(sum(i.amount - i.paid), 2) as balance,
               round(sum(i.amount - i.paid) filter (where i.due_date < v_today), 2) as overdue,
               min(i.due_date) as next_due
        from public.payables p
        join public.payable_installments i on i.payable_id = p.id and i.amount > i.paid
        left join public.suppliers su on su.id = p.supplier_id
        where p.tenant_id = v_tenant and p.status = 'open'
        group by 1, 2
      ) x
      where not p_only_overdue or x.overdue > 0
    ), '[]'::jsonb),
    'installments', coalesce((
      select jsonb_agg(jsonb_build_object('supplier', y.supplier, 'document_kind', y.document_kind, 'document', y.document,
                                          'number', y.number, 'due_date', y.due_date,
                                          'pending', y.pending, 'currency', y.currency, 'days_overdue', greatest(v_today - y.due_date, 0))
             order by y.due_date)
      from (
        select coalesce(su.name, 'Sin proveedor') as supplier, p.document_kind, p.document, i.number, i.due_date,
               round(i.amount - i.paid, 2) as pending, p.currency
        from public.payables p
        join public.payable_installments i on i.payable_id = p.id and i.amount > i.paid
        left join public.suppliers su on su.id = p.supplier_id
        where p.tenant_id = v_tenant and p.status = 'open' and (not p_only_overdue or i.due_date < v_today)
        order by i.due_date
        limit 40
      ) y
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.beto_payables_detail(boolean) from public;
grant execute on function app.beto_payables_detail(boolean) to authenticated;
