-- Comisiones bancarias por reglas de frases.
--
-- Portado de AdminBankFees / sublime_classify_bank_fees (basicosystems@f551478b).
-- Cada cuenta tiene frases que identifican sus comisiones en el estado de
-- cuenta ("COM. PAGO MOVIL", "MANTENIMIENTO"…), al inicio o en cualquier
-- parte de la descripción. Las salidas abiertas del banco que coinciden se
-- registran como egreso "Comisiones bancarias" ya conciliado. Se aplica al
-- cargar un estado de cuenta y a pedido. Desvincular una línea cuyo
-- movimiento se registró desde el banco anula ese movimiento.

create table public.bank_fee_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  account_id uuid not null,
  phrase text not null check (length(trim(phrase)) between 2 and 80),
  match text not null default 'starts' check (match in ('starts', 'contains')),
  -- Para qué es (se antepone a la descripción del egreso).
  fee_type text not null default 'Comisión' check (length(trim(fee_type)) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, account_id) references public.finance_accounts (tenant_id, id) on delete cascade
);
create unique index bank_fee_rules_phrase_uq on public.bank_fee_rules (tenant_id, account_id, lower(trim(phrase)));

alter table public.bank_fee_rules enable row level security;
revoke all on public.bank_fee_rules from anon;
create policy tenant_read on public.bank_fee_rules for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_insert on public.bank_fee_rules for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_update on public.bank_fee_rules for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id))
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_delete on public.bank_fee_rules for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
revoke update on public.bank_fee_rules from authenticated;
grant update (phrase, match, fee_type, is_active) on public.bank_fee_rules to authenticated;

-- p_apply false: solo dice qué coincide. true: registra y concilia.
create or replace function app.apply_bank_fee_rules(p_account_id uuid, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  a public.finance_accounts;
  x record;
  v_items jsonb := '[]'::jsonb;
  v_applied integer := 0;
begin
  select * into a from public.finance_accounts where id = p_account_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Cuenta no encontrada' using errcode = 'no_data_found';
  end if;
  for x in
    select l.id, l.line_date, l.amount, l.description, r.fee_type, r.phrase
    from public.bank_statement_lines l
    cross join lateral (
      select fr.fee_type, fr.phrase from public.bank_fee_rules fr
      where fr.tenant_id = v_tenant and fr.account_id = a.id and fr.is_active
        and case fr.match
              when 'contains' then position(lower(trim(fr.phrase)) in lower(coalesce(l.description, ''))) > 0
              else left(lower(trim(coalesce(l.description, ''))), length(trim(fr.phrase))) = lower(trim(fr.phrase))
            end
      order by length(fr.phrase) desc
      limit 1
    ) r
    where l.tenant_id = v_tenant and l.account_id = a.id and l.direction = 'out' and l.status in ('unmatched', 'possible')
    order by l.line_date, l.row_number
  loop
    v_items := v_items || jsonb_build_object('line_id', x.id, 'date', x.line_date, 'amount', x.amount,
                                             'description', x.description, 'fee_type', x.fee_type, 'phrase', x.phrase);
    if p_apply then
      perform app.create_movement_from_bank_line(x.id, 'Comisiones bancarias', coalesce(a.institution, a.name),
                                                 trim(x.fee_type) || ': ' || coalesce(x.description, ''));
      v_applied := v_applied + 1;
    end if;
  end loop;
  return jsonb_build_object('items', v_items, 'applied', v_applied);
end;
$$;
revoke all on function app.apply_bank_fee_rules(uuid, boolean) from public;
grant execute on function app.apply_bank_fee_rules(uuid, boolean) to authenticated;

create or replace function app.import_bank_statement(
  p_account_id uuid, p_profile_id uuid, p_file_name text, p_file_hash text, p_rows jsonb, p_issues jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  a public.finance_accounts;
  v_batch uuid;
  v_total integer;
  v_new integer;
  v_issues jsonb := coalesce(p_issues, '[]'::jsonb);
  v_auto jsonb;
  v_fees jsonb;
begin
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if p_profile_id is not null and not exists (
    select 1 from public.bank_import_profiles where id = p_profile_id and tenant_id = v_tenant and account_id = a.id
  ) then
    raise exception 'El perfil no es de esta cuenta' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_typeof(v_issues) <> 'array' then
    raise exception 'Formato de carga inválido' using errcode = 'check_violation';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 5000 then
    raise exception 'Máximo 5.000 líneas por carga' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r("date" date, direction text, amount numeric)
    where r."date" is null or r.direction not in ('in', 'out') or r.direction is null or r.amount is null or round(r.amount, 2) <= 0
  ) then
    raise exception 'Hay líneas sin fecha, dirección o monto válido' using errcode = 'check_violation';
  end if;

  insert into public.bank_import_batches (tenant_id, account_id, profile_id, file_name, file_hash, rows_read, rows_error)
  values (v_tenant, a.id, p_profile_id, left(coalesce(nullif(trim(p_file_name), ''), 'Estado de cuenta'), 200), p_file_hash,
          v_total + jsonb_array_length(v_issues), jsonb_array_length(v_issues))
  returning id into v_batch;

  with src as (
    select r.*, app.bank_identity(r."date", r.direction, r.amount, r.reference, r.operation, r.description) as identity_key
    from jsonb_to_recordset(p_rows) as r(
      "row" integer, "date" date, "time" text, direction text, amount numeric, reference text, operation text,
      description text, balance numeric, raw jsonb)
  ),
  numbered as (
    select src.*, row_number() over (partition by identity_key order by "row") as occurrence from src
  ),
  ins as (
    insert into public.bank_statement_lines (
      tenant_id, account_id, batch_id, row_number, line_date, line_time, direction, amount, currency,
      reference, operation_number, description, balance, raw, identity_key, occurrence
    )
    select v_tenant, a.id, v_batch, n."row", n."date", nullif(n."time", '')::time, n.direction, round(n.amount, 2), a.currency,
           nullif(trim(n.reference), ''), nullif(trim(n.operation), ''), nullif(trim(n.description), ''), n.balance,
           coalesce(n.raw, '{}'::jsonb), n.identity_key, n.occurrence
    from numbered n
    on conflict (tenant_id, account_id, identity_key, occurrence) do nothing
    returning bank_statement_lines.row_number as inserted_row
  ),
  dup as (
    select n."row" from numbered n where not exists (select 1 from ins where ins.inserted_row = n."row")
  )
  select (select count(*) from ins),
         v_issues || coalesce((select jsonb_agg(jsonb_build_object('row', "row", 'reason', 'Ya estaba cargada') order by "row") from dup), '[]'::jsonb)
  into v_new, v_issues;

  update public.bank_import_batches
  set rows_new = v_new, rows_duplicate = v_total - v_new, issues = v_issues
  where id = v_batch;

  v_auto := app.bank_autoreconcile(a.id, 3);
  -- Lo que sigue abierto y coincide con una frase de comisión se registra solo.
  v_fees := app.apply_bank_fee_rules(a.id, true);
  return jsonb_build_object('batch_id', v_batch, 'inserted', v_new, 'duplicates', v_total - v_new,
                            'errors', jsonb_array_length(coalesce(p_issues, '[]'::jsonb)),
                            'fees', coalesce((v_fees ->> 'applied')::int, 0)) || v_auto;
end;
$$;

create or replace function app.reopen_bank_line(p_line_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.bank_statement_lines := app.bank_line_for_write(v_tenant, p_line_id);
begin
  if l.status not in ('matched', 'ignored') then
    raise exception 'La línea ya está abierta' using errcode = 'check_violation';
  end if;
  update public.bank_statement_lines
  set status = 'unmatched', movement_id = null, match_kind = null, matched_by = null, matched_at = null, ignore_reason = null
  where id = l.id;
  -- Si el movimiento se registró desde esta línea (por ejemplo, una comisión),
  -- deshacer lo anula: no quedan egresos sueltos.
  if l.match_kind = 'created' then
    update public.finance_movements set voided_at = now(), voided_by = auth.uid(), void_reason = 'Se desvinculó del banco'
    where id = l.movement_id and voided_at is null;
  end if;
  return app.bank_classify_line(l.id, 3, false);
end;
$$;

create function public.apply_bank_fee_rules(p_account_id uuid, p_apply boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$ select app.apply_bank_fee_rules(p_account_id, p_apply) $$;
revoke all on function public.apply_bank_fee_rules(uuid, boolean) from public, anon;
grant execute on function public.apply_bank_fee_rules(uuid, boolean) to authenticated;
