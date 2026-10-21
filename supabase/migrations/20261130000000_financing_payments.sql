-- Financiadora, paso 2: pagos recibidos.
--
-- Portado de CasheaPaymentsImport (basicosystems@9cb08cd), genérico para
-- cualquier financiadora. El archivo de pagos de la financiadora trae cada
-- pago de cuota que hizo un cliente (fecha, monto en Bs y en divisa,
-- referencia, cuota, orden y factura). Cada pago se cruza con:
--   * la cuenta por cobrar de esa financiadora (por n.º de orden o factura), y
--   * la línea de entrada del estado de cuenta del banco elegido: mismo monto,
--     fecha a ±3 días y referencia que coincide (al menos los últimos 6
--     dígitos). Con monto y fecha pero sin referencia queda como posible.
-- Primero se muestra el resultado sin tocar nada. Al confirmar, cada pago
-- conciliado registra el cobro desde la línea del banco (la deja conciliada y
-- sale de «Por identificar») una sola vez: el pago queda guardado y no se
-- vuelve a aplicar. No crea ventas ni otros ingresos.

create table public.financing_payment_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null,
  account_id uuid not null,
  file_name text not null,
  file_hash text,
  rows_total integer not null default 0,
  matched integer not null default 0,
  possible integer not null default 0,
  no_bank integer not null default 0,
  no_operation integer not null default 0,
  initial integer not null default 0,
  duplicated integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references public.finance_accounts (tenant_id, id)
);
create index financing_payment_imports_idx on public.financing_payment_imports (tenant_id, created_at desc);

create table public.financing_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  provider text not null,
  reference text not null,
  installment text not null,
  external_ref text,
  document text,
  paid_on date not null,
  amount_local numeric(16, 2) not null,
  amount_base numeric(16, 2),
  receivable_id uuid not null,
  line_id uuid not null,
  collection_id uuid not null,
  import_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, reference, installment),
  foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id),
  foreign key (tenant_id, collection_id) references public.receivable_collections (tenant_id, id),
  foreign key (tenant_id, import_id) references public.financing_payment_imports (tenant_id, id)
);

do $$
declare
  t text;
begin
  foreach t in array array['financing_payment_imports', 'financing_payments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy tenant_read on public.%I for select to authenticated
                      using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id))', t);
  end loop;
end;
$$;

-- Referencias del banco y de la financiadora: iguales, o con los mismos
-- últimos 6 dígitos (los bancos recortan o rellenan con ceros).
create or replace function app.reference_matches(p_a text, p_b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(regexp_replace(coalesce(p_a, ''), '\D', '', 'g'), '') is null
      or nullif(regexp_replace(coalesce(p_b, ''), '\D', '', 'g'), '') is null then false
    when length(regexp_replace(p_a, '\D', '', 'g')) < 6 or length(regexp_replace(p_b, '\D', '', 'g')) < 6
      then ltrim(regexp_replace(p_a, '\D', '', 'g'), '0') = ltrim(regexp_replace(p_b, '\D', '', 'g'), '0')
    else right(regexp_replace(p_a, '\D', '', 'g'), 6) = right(regexp_replace(p_b, '\D', '', 'g'), 6)
  end
$$;
revoke all on function app.reference_matches(text, text) from public;

-- p_rows: [{row, date, amount_local, amount_base, reference, installment, order, invoice}]
create or replace function app.import_financing_payments(
  p_provider text, p_account_id uuid, p_rows jsonb, p_dry_run boolean default true,
  p_file_name text default null, p_file_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_provider text := nullif(trim(p_provider), '');
  a public.finance_accounts;
  x jsonb;
  r public.receivables;
  l public.bank_statement_lines;
  v_used uuid[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_status text;
  v_detail text;
  v_date date;
  v_amount numeric;
  v_base numeric;
  v_ref text;
  v_inst text;
  v_import uuid;
  v_collection uuid;
  v_counts jsonb := '{"conciliado":0,"posible":0,"sin_banco":0,"sin_operacion":0,"pago_inicial":0,"duplicado":0}'::jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_candidates integer;
begin
  perform app.require_module(v_tenant, 'cashea', 'Financiadoras');
  if v_provider is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Faltan la financiadora o las filas' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'El archivo tiene demasiadas filas (máximo 5000)' using errcode = 'check_violation';
  end if;
  select * into a from public.finance_accounts where id = p_account_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Cuenta no encontrada' using errcode = 'no_data_found';
  end if;

  for x in select * from jsonb_array_elements(p_rows)
  loop
    v_date := nullif(x ->> 'date', '')::date;
    v_amount := round(coalesce((x ->> 'amount_local')::numeric, 0), 2);
    v_base := round((x ->> 'amount_base')::numeric, 2);
    v_ref := nullif(trim(x ->> 'reference'), '');
    v_inst := coalesce(nullif(trim(x ->> 'installment'), ''), '?');
    v_detail := null;
    r := null;
    l := null;

    if v_inst in ('0', 'Inicial', 'inicial') then
      v_status := 'pago_inicial';
      v_detail := 'El pago inicial se cobra en la caja, no por la financiadora';
    elsif v_ref is not null and exists (select 1 from public.financing_payments
                                        where tenant_id = v_tenant and provider = v_provider and reference = v_ref and installment = v_inst) then
      v_status := 'duplicado';
    else
      select * into r from public.receivables
      where tenant_id = v_tenant and kind = 'financing' and provider = v_provider and status <> 'cancelled'
        and ((nullif(trim(x ->> 'order'), '') is not null and external_ref = trim(x ->> 'order'))
          or (nullif(trim(x ->> 'invoice'), '') is not null and document = trim(x ->> 'invoice')))
      order by (external_ref = trim(x ->> 'order')) desc nulls last
      limit 1;
      if r.id is null then
        v_status := 'sin_operacion';
        v_detail := format('No hay una venta con %s con la orden %s ni la factura %s; carga primero el reporte de órdenes',
                           v_provider, coalesce(nullif(x ->> 'order', ''), '—'), coalesce(nullif(x ->> 'invoice', ''), '—'));
      elsif v_date is null or v_amount <= 0 then
        v_status := 'sin_banco';
        v_detail := 'Fila sin fecha o sin monto';
      else
        -- Referencia y monto: conciliado.
        select * into l from public.bank_statement_lines b
        where b.tenant_id = v_tenant and b.account_id = a.id and b.direction = 'in'
          and b.status in ('unmatched', 'possible') and not (b.id = any (v_used))
          and abs(b.amount - case when b.currency = a.currency then v_amount else coalesce(v_base, v_amount) end) < 0.01
          and b.line_date between v_date - 3 and v_date + 3
          and (app.reference_matches(b.reference, v_ref) or app.reference_matches(b.operation_number, v_ref))
        order by abs(b.line_date - v_date), b.row_number
        limit 1;
        if l.id is not null then
          v_status := 'conciliado';
          v_detail := format('%s · %s', r.customer_name, coalesce(l.description, 'línea del banco'));
        else
          select count(*) into v_candidates from public.bank_statement_lines b
          where b.tenant_id = v_tenant and b.account_id = a.id and b.direction = 'in'
            and b.status in ('unmatched', 'possible') and not (b.id = any (v_used))
            and abs(b.amount - v_amount) < 0.01 and b.line_date between v_date - 3 and v_date + 3;
          if v_candidates > 0 then
            v_status := 'posible';
            v_detail := format('%s %s con el mismo monto y fecha, pero la referencia no coincide: revísalo en Por identificar',
                               v_candidates, case when v_candidates = 1 then 'línea del banco' else 'líneas del banco' end);
          else
            v_status := 'sin_banco';
            v_detail := format('No hay una entrada de Bs. %s en %s entre el %s y el %s',
                               to_char(v_amount, 'FM999G999G990D00'), a.name, to_char(v_date - 3, 'DD/MM'), to_char(v_date + 3, 'DD/MM'));
          end if;
        end if;
      end if;
    end if;

    if v_status = 'conciliado' then
      v_used := v_used || l.id;
      v_pending := v_pending || jsonb_build_object('row', x, 'receivable_id', r.id, 'line_id', l.id, 'line_currency', l.currency);
    end if;
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb((v_counts ->> v_status)::int + 1));
    v_out := v_out || jsonb_build_object(
      'row', x ->> 'row', 'status', v_status, 'detail', v_detail, 'date', x ->> 'date', 'amount_local', v_amount,
      'reference', v_ref, 'installment', v_inst, 'order', x ->> 'order', 'invoice', x ->> 'invoice', 'customer', r.customer_name);
  end loop;

  if not p_dry_run then
    insert into public.financing_payment_imports (tenant_id, provider, account_id, file_name, file_hash, rows_total,
                                                  matched, possible, no_bank, no_operation, initial, duplicated)
    values (v_tenant, v_provider, a.id, left(coalesce(nullif(trim(p_file_name), ''), 'Archivo'), 200), p_file_hash, jsonb_array_length(p_rows),
            (v_counts ->> 'conciliado')::int, (v_counts ->> 'posible')::int, (v_counts ->> 'sin_banco')::int,
            (v_counts ->> 'sin_operacion')::int, (v_counts ->> 'pago_inicial')::int, (v_counts ->> 'duplicado')::int)
    returning id into v_import;

    for x in select * from jsonb_array_elements(v_pending)
    loop
      select * into r from public.receivables where id = (x ->> 'receivable_id')::uuid;
      -- El cobro cubre en la moneda de la cuenta por cobrar: si el banco está
      -- en otra moneda, vale el monto en divisa que informa la financiadora.
      v_base := round((x -> 'row' ->> 'amount_base')::numeric, 2);
      v_collection := app.collect_receivable_from_bank_line(
        (x ->> 'line_id')::uuid, r.id,
        case when x ->> 'line_currency' <> r.currency and v_base > 0 then least(v_base, r.amount - r.collected) end,
        'customer');
      insert into public.financing_payments (tenant_id, provider, reference, installment, external_ref, document, paid_on,
                                             amount_local, amount_base, receivable_id, line_id, collection_id, import_id)
      values (v_tenant, v_provider, coalesce(nullif(trim(x -> 'row' ->> 'reference'), ''), (x ->> 'line_id')),
              coalesce(nullif(trim(x -> 'row' ->> 'installment'), ''), '?'),
              nullif(trim(x -> 'row' ->> 'order'), ''), nullif(trim(x -> 'row' ->> 'invoice'), ''),
              (x -> 'row' ->> 'date')::date, round((x -> 'row' ->> 'amount_local')::numeric, 2), v_base,
              r.id, (x ->> 'line_id')::uuid, v_collection, v_import);
    end loop;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'import_id', v_import,
    'matched', (v_counts ->> 'conciliado')::int, 'possible', (v_counts ->> 'posible')::int,
    'no_bank', (v_counts ->> 'sin_banco')::int, 'no_operation', (v_counts ->> 'sin_operacion')::int,
    'initial', (v_counts ->> 'pago_inicial')::int, 'duplicated', (v_counts ->> 'duplicado')::int,
    'rows', v_out);
end;
$$;
revoke all on function app.import_financing_payments(text, uuid, jsonb, boolean, text, text) from public;
grant execute on function app.import_financing_payments(text, uuid, jsonb, boolean, text, text) to authenticated;

create function public.import_financing_payments(
  p_provider text, p_account_id uuid, p_rows jsonb, p_dry_run boolean default true,
  p_file_name text default null, p_file_hash text default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.import_financing_payments(p_provider, p_account_id, p_rows, p_dry_run, p_file_name, p_file_hash)
$$;
revoke all on function public.import_financing_payments(text, uuid, jsonb, boolean, text, text) from public, anon;
grant execute on function public.import_financing_payments(text, uuid, jsonb, boolean, text, text) to authenticated;
