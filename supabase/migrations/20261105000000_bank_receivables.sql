-- Conciliación de cobranza (Cashea y crédito) contra el banco.
--
-- Portado de CasheaBankRecoveryDrawer (AdminCashea.tsx, basicosystems@f551478b).
-- Los clientes pagan sus cuotas por pago móvil o transferencia. Desde una
-- línea abierta (entrada) del estado de cuenta:
--   * bank_receivable_candidates: cuentas por cobrar abiertas cuya próxima
--     cuota (o el saldo) coincide con el monto, convertido con la tasa del día
--     de la línea.
--   * collect_receivable_from_bank_line: registra el cobro con la fecha, el
--     monto y la referencia del banco, y deja la línea conciliada.
-- Desvincular la línea anula el movimiento, y con él el cobro (triggers
-- existentes).

-- Monto en otra moneda del negocio con la tasa dada (base <-> local).
create or replace function app.convert_amount(p_amount numeric, p_from text, p_to text, p_base text, p_local text, p_rate numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = p_to then p_amount
    when p_from = p_local and p_to = p_base and p_rate > 0 then round(p_amount / p_rate, 2)
    when p_from = p_base and p_to = p_local and p_rate > 0 then round(p_amount * p_rate, 2)
  end
$$;
revoke all on function app.convert_amount(numeric, text, text, text, text, numeric) from public;

-- Lo que cubre un pago convertido: si pasa del saldo por redondeo de la tasa
-- (1 % o un céntimo), cubre el saldo; si pasa por más, se deja el monto y el
-- cobro se rechaza por exceder lo que falta.
create or replace function app.applied_within(p_amount numeric, p_pending numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_amount > p_pending and p_amount <= p_pending + greatest(0.01, p_pending * 0.01) then p_pending else p_amount end
$$;
revoke all on function app.applied_within(numeric, numeric) from public;

-- Tasa vigente al cierre del día de la línea.
create or replace function app.rate_on_day(p_tenant_id uuid, p_day date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.rate from app.rate_at(p_tenant_id, ((p_day + 1)::timestamp at time zone 'America/Caracas') - interval '1 second') r
$$;
revoke all on function app.rate_on_day(uuid, date) from public;

create or replace function app.bank_receivable_candidates(p_line_id uuid)
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

  with open_r as (
    select r.*, r.amount - r.collected as pending,
           app.convert_amount(l.amount, l.currency, r.currency, t.base_currency, t.local_currency, v_rate) as line_amount
    from public.receivables r
    where r.tenant_id = v_tenant and r.status = 'open' and l.direction = 'in'
  ),
  scored as (
    select o.*, nx.number as next_number, nx.due_date as next_due, nx.pending as next_pending,
           case
             when o.line_amount is null then null
             when nx.pending is not null and abs(o.line_amount - nx.pending) <= greatest(0.01, nx.pending * 0.01) then 'installment'
             when abs(o.line_amount - o.pending) <= greatest(0.01, o.pending * 0.01) then 'balance'
           end as match
    from open_r o
    left join lateral (
      select i.number, i.due_date, i.amount - i.collected - i.covered as pending
      from public.receivable_installments i
      where i.receivable_id = o.id and i.amount - i.collected - i.covered > 0.005
      order by i.number
      limit 1
    ) nx on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'receivable_id', s.id, 'kind', s.kind, 'provider', s.provider, 'customer_name', s.customer_name,
           'document', s.document, 'external_ref', s.external_ref, 'currency', s.currency, 'pending', s.pending,
           'next_number', s.next_number, 'next_due', s.next_due, 'next_pending', s.next_pending,
           'applied', app.applied_within(s.line_amount, s.pending),
           'match', s.match)
         order by (s.match is null), abs(coalesce(s.line_amount, 0) - coalesce(s.next_pending, s.pending)), s.next_due nulls last), '[]'::jsonb)
  into v_items
  from (select * from scored order by (match is null), abs(coalesce(line_amount, 0) - coalesce(next_pending, pending)) limit 30) s;

  return jsonb_build_object('rate', v_rate, 'items', v_items);
end;
$$;
revoke all on function app.bank_receivable_candidates(uuid) from public;
grant execute on function app.bank_receivable_candidates(uuid) to authenticated;

create or replace function app.collect_receivable_from_bank_line(
  p_line_id uuid, p_receivable_id uuid, p_applied numeric default null, p_payer text default 'customer'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines := app.bank_line_for_write(v_tenant, p_line_id);
  r public.receivables := app.receivable_for_write(v_tenant, p_receivable_id);
  t public.tenants;
  v_applied numeric := p_applied;
  v_id uuid;
begin
  if l.status not in ('unmatched', 'possible') then
    raise exception 'La línea ya está conciliada o ignorada' using errcode = 'check_violation';
  end if;
  if l.direction <> 'in' then
    raise exception 'Un cobro es una entrada del banco' using errcode = 'check_violation';
  end if;
  if v_applied is null and l.currency <> r.currency then
    select * into t from public.tenants where id = v_tenant;
    v_applied := app.applied_within(
      app.convert_amount(l.amount, l.currency, r.currency, t.base_currency, t.local_currency, app.rate_on_day(v_tenant, l.line_date)),
      r.amount - r.collected);
  end if;
  v_id := app.collect_receivable(r.id, l.account_id, l.amount, l.line_date, p_payer, v_applied,
                                 coalesce(l.reference, l.operation_number), null);
  update public.bank_statement_lines
  set status = 'matched', movement_id = (select movement_id from public.receivable_collections where id = v_id),
      match_kind = 'created', matched_by = auth.uid(), matched_at = now()
  where id = l.id;
  return v_id;
end;
$$;
revoke all on function app.collect_receivable_from_bank_line(uuid, uuid, numeric, text) from public;
grant execute on function app.collect_receivable_from_bank_line(uuid, uuid, numeric, text) to authenticated;

create function public.bank_receivable_candidates(p_line_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.bank_receivable_candidates(p_line_id) $$;
revoke all on function public.bank_receivable_candidates(uuid) from public, anon;
grant execute on function public.bank_receivable_candidates(uuid) to authenticated;

create function public.collect_receivable_from_bank_line(p_line_id uuid, p_receivable_id uuid, p_applied numeric default null, p_payer text default 'customer')
returns uuid language sql security invoker set search_path = '' as $$ select app.collect_receivable_from_bank_line(p_line_id, p_receivable_id, p_applied, p_payer) $$;
revoke all on function public.collect_receivable_from_bank_line(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.collect_receivable_from_bank_line(uuid, uuid, numeric, text) to authenticated;
