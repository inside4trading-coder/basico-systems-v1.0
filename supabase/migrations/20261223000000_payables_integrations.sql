-- Por pagar conectado con Recepción y con el banco.
--
--   * receive_on_credit: registra una recepción a crédito en una sola
--     transacción. Da entrada a cada línea con su costo de compra (que pasa a
--     ser el costo del producto) y crea la cuenta por pagar del proveedor por
--     la suma de las líneas más el IVA. Si algo falla (por ejemplo, la factura
--     ya estaba cargada), no queda ni la entrada ni la factura.
--   * bank_payable_candidates / pay_payable_from_bank_line: desde una salida
--     del estado de cuenta, las facturas abiertas cuya próxima cuota o saldo
--     coincide con el monto (convertido con la tasa del día); pagar deja el
--     pago con la fecha, el monto y la referencia del banco, y la línea
--     conciliada. Desvincular la línea anula el movimiento y con él el pago.

alter table public.payables add column location_id uuid;
alter table public.payables add constraint payables_location_fk
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id);
comment on column public.payables.location_id is 'Sede que recibió la mercancía (facturas creadas desde Recepción).';

-- ---------------------------------------------------------------------------
-- Recepción a crédito
-- ---------------------------------------------------------------------------

-- p: {location_id, supplier_id, document, control_number, issued_on, tax_amount,
--     note, installments, lines: [{variant_id, qty, unit_cost, expected_qty}]}
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

  for x in select * from jsonb_to_recordset(p -> 'lines') as y(variant_id uuid, qty numeric, unit_cost numeric, expected_qty numeric) loop
    perform app.inventory_entry(x.variant_id, l.id, x.qty, x.unit_cost, s.name,
                                coalesce(nullif(trim(p ->> 'note'), ''), 'Factura ' || coalesce(nullif(trim(p ->> 'document'), ''), 's/n') || ' a crédito'),
                                x.expected_qty);
    v_subtotal := v_subtotal + round(x.qty * x.unit_cost, 2);
    v_count := v_count + 1;
  end loop;

  insert into public.payables (
    tenant_id, supplier_id, document, control_number, issued_on, currency, subtotal, tax_amount, amount, category, note, source, location_id
  ) values (
    v_tenant, s.id, nullif(trim(p ->> 'document'), ''), nullif(trim(p ->> 'control_number'), ''),
    coalesce(nullif(p ->> 'issued_on', '')::date, (now() at time zone 'America/Caracas')::date),
    t.base_currency, v_subtotal, v_tax, v_subtotal + coalesce(v_tax, 0), 'Proveedores', nullif(trim(p ->> 'note'), ''), 'reception', l.id
  ) returning * into r;
  perform app.payable_set_installments(r, p -> 'installments');
  return jsonb_build_object('payable_id', r.id, 'lines', v_count, 'amount', r.amount, 'currency', r.currency);
exception when unique_violation then
  raise exception 'Esa factura de este proveedor ya está cargada' using errcode = 'unique_violation';
end;
$$;
revoke all on function app.receive_on_credit(jsonb) from public;
grant execute on function app.receive_on_credit(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Pagar desde el banco
-- ---------------------------------------------------------------------------

create or replace function app.bank_payable_candidates(p_line_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines;
  t public.tenants;
  v_rate numeric;
  v_items jsonb;
begin
  select * into l from public.bank_statement_lines where id = p_line_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Línea no encontrada' using errcode = 'no_data_found';
  end if;
  select * into t from public.tenants where id = v_tenant;
  v_rate := app.rate_on_day(v_tenant, l.line_date);

  with open_p as (
    select p.*, p.amount - p.paid as pending, sp.name as supplier_name,
           app.convert_amount(l.amount, l.currency, p.currency, t.base_currency, t.local_currency, v_rate) as line_amount
    from public.payables p join public.suppliers sp on sp.id = p.supplier_id
    where p.tenant_id = v_tenant and p.status = 'open' and l.direction = 'out'
  ),
  scored as (
    select o.*, nx.number as next_number, nx.due_date as next_due, nx.pending as next_pending,
           case
             when o.line_amount is null then null
             when nx.pending is not null and abs(o.line_amount - nx.pending) <= greatest(0.01, nx.pending * 0.01) then 'installment'
             when abs(o.line_amount - o.pending) <= greatest(0.01, o.pending * 0.01) then 'balance'
           end as match
    from open_p o
    left join lateral (
      select i.number, i.due_date, i.amount - i.paid as pending
      from public.payable_installments i
      where i.payable_id = o.id and i.amount - i.paid > 0.005
      order by i.number
      limit 1
    ) nx on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'payable_id', s.id, 'supplier_name', s.supplier_name, 'document', s.document, 'currency', s.currency,
           'pending', s.pending, 'next_number', s.next_number, 'next_due', s.next_due, 'next_pending', s.next_pending,
           'installments', (select count(*) from public.payable_installments i where i.payable_id = s.id),
           'applied', app.applied_within(s.line_amount, s.pending),
           'match', s.match)
         order by (s.match is null), s.next_due nulls last, abs(coalesce(s.line_amount, 0) - coalesce(s.next_pending, s.pending))), '[]'::jsonb)
  into v_items
  from (select * from scored order by (match is null), next_due nulls last limit 30) s;

  return jsonb_build_object('rate', v_rate, 'items', v_items);
end;
$$;
revoke all on function app.bank_payable_candidates(uuid) from public;
grant execute on function app.bank_payable_candidates(uuid) to authenticated;

create or replace function app.pay_payable_from_bank_line(p_line_id uuid, p_payable_id uuid, p_applied numeric default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines := app.bank_line_for_write(v_tenant, p_line_id);
  r public.payables := app.payable_for_write(v_tenant, p_payable_id);
  t public.tenants;
  v_applied numeric := p_applied;
  v_id uuid;
begin
  if l.status not in ('unmatched', 'possible') then
    raise exception 'La línea ya está conciliada o ignorada' using errcode = 'check_violation';
  end if;
  if l.direction <> 'out' then
    raise exception 'Un pago a proveedor es una salida del banco' using errcode = 'check_violation';
  end if;
  if v_applied is null and l.currency <> r.currency then
    select * into t from public.tenants where id = v_tenant;
    v_applied := app.applied_within(
      app.convert_amount(l.amount, l.currency, r.currency, t.base_currency, t.local_currency, app.rate_on_day(v_tenant, l.line_date)),
      r.amount - r.paid);
  end if;
  v_id := app.pay_payable(r.id, l.account_id, l.amount, l.line_date, v_applied, coalesce(l.reference, l.operation_number), null);
  update public.bank_statement_lines
  set status = 'matched', movement_id = (select movement_id from public.payable_payments where id = v_id),
      match_kind = 'created', matched_by = auth.uid(), matched_at = now()
  where id = l.id;
  return v_id;
end;
$$;
revoke all on function app.pay_payable_from_bank_line(uuid, uuid, numeric) from public;
grant execute on function app.pay_payable_from_bank_line(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create function public.receive_on_credit(p jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select app.receive_on_credit(p) $$;
create function public.bank_payable_candidates(p_line_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.bank_payable_candidates(p_line_id) $$;
create function public.pay_payable_from_bank_line(p_line_id uuid, p_payable_id uuid, p_applied numeric default null)
returns uuid language sql security invoker set search_path = '' as $$ select app.pay_payable_from_bank_line(p_line_id, p_payable_id, p_applied) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'receive_on_credit(jsonb)',
    'bank_payable_candidates(uuid)',
    'pay_payable_from_bank_line(uuid, uuid, numeric)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
