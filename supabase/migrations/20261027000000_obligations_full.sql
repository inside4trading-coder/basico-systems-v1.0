-- Obligaciones completas.
--
-- Completa lo portado en 20261026000000_finance.sql con lo que tenía la
-- administración de basicosystems@f551478b (admin_obligations,
-- admin_instances, admin_audit_log, MarkPaidDialog, EditInstanceSheet,
-- NewInstanceSheet, AdminObligationDetail):
--   * Obligación: importancia, responsable, método de pago habitual, si cuenta
--     como gasto fijo y estado (activa, pausada, cancelada) en vez de un sí/no.
--   * Cuota: pagos parciales (varias salidas del libro por cuota), "dar por
--     pagada", anular con motivo, editar monto o fecha, cuotas agregadas a mano
--     y comprobantes (imagen o PDF) en Storage.
--   * Bitácora de cambios por obligación y cuota, escrita por triggers.
-- El monto aplicado a una cuota va en la moneda de la cuota: si se paga desde
-- una cuenta en otra moneda, se indica cuánto cubre (obligation_amount).

-- ---------------------------------------------------------------------------
-- Obligación
-- ---------------------------------------------------------------------------

alter table public.obligations
  add column importance text not null default 'medium' check (importance in ('critical', 'high', 'medium', 'low')),
  add column responsible text,
  add column payment_method text,
  add column is_fixed_expense boolean not null default false,
  add column status text not null default 'active' check (status in ('active', 'paused', 'cancelled'));
update public.obligations set status = case when is_active then 'active' else 'paused' end;
alter table public.obligations drop column is_active;

-- ---------------------------------------------------------------------------
-- Cuotas y pagos
-- ---------------------------------------------------------------------------

alter table public.obligation_instances drop constraint obligation_instances_status_check;
alter table public.obligation_instances
  add constraint obligation_instances_status_check check (status in ('pending', 'partial', 'paid', 'skipped', 'void')),
  -- Suma de lo aplicado por pagos no anulados, en la moneda de la cuota.
  add column paid_amount numeric(16, 2) not null default 0,
  -- Pagada aunque lo aplicado no llegue al monto (descuento, redondeo).
  add column settled boolean not null default false,
  -- Editada o agregada a mano: la generación no le cambia monto ni fecha.
  add column custom boolean not null default false,
  add column proof_paths text[] not null default '{}',
  add column void_reason text;

alter table public.finance_movements add column obligation_amount numeric(16, 2) check (obligation_amount is null or obligation_amount > 0);

-- Pagos ya hechos: lo aplicado es el pago si la moneda coincide; si no, el monto de la cuota.
update public.finance_movements m
set obligation_amount = case when m.currency = i.currency then m.amount else coalesce(i.amount, m.amount) end
from public.obligation_instances i
where m.obligation_instance_id = i.id and m.kind = 'obligation';
update public.obligation_instances i
set paid_amount = coalesce((select sum(m.obligation_amount) from public.finance_movements m
                            where m.obligation_instance_id = i.id and m.voided_at is null), 0),
    settled = (i.status = 'paid');

-- Recalcula lo pagado y el estado de una cuota a partir del libro.
create or replace function app.obligation_recalc(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.obligation_instances;
  v_paid numeric;
  v_last date;
  v_last_mov uuid;
  v_status text;
begin
  select * into i from public.obligation_instances where id = p_instance_id for update;
  if not found or i.status in ('skipped', 'void') then
    return;
  end if;
  select coalesce(sum(m.obligation_amount), 0), max(m.occurred_on)
  into v_paid, v_last
  from public.finance_movements m
  where m.obligation_instance_id = i.id and m.voided_at is null;
  select m.id into v_last_mov from public.finance_movements m
  where m.obligation_instance_id = i.id and m.voided_at is null
  order by m.occurred_on desc, m.created_at desc limit 1;

  if v_paid <= 0 then
    v_status := 'pending';
  elsif i.settled or i.amount is null or v_paid >= i.amount - 0.005 then
    v_status := 'paid';
  else
    v_status := 'partial';
  end if;

  update public.obligation_instances
  set paid_amount = round(v_paid, 2),
      status = v_status,
      settled = case when v_paid <= 0 then false else settled end,
      paid_on = case when v_paid > 0 then v_last end,
      paid_by = case when v_paid > 0 then paid_by end,
      movement_id = v_last_mov
  where id = i.id;
end;
$$;
revoke all on function app.obligation_recalc(uuid) from public;

drop function public.pay_obligation(uuid, uuid, numeric, date, text, text);
drop function app.pay_obligation(uuid, uuid, numeric, date, text, text);

-- Pago total o parcial de una cuota. p_applied: cuánto cubre en la moneda de
-- la cuota cuando la cuenta está en otra moneda. p_settle: darla por pagada
-- aunque lo aplicado no alcance.
create or replace function app.pay_obligation(
  p_instance_id uuid, p_account_id uuid, p_amount numeric, p_paid_on date,
  p_reference text default null, p_note text default null, p_applied numeric default null, p_settle boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  i public.obligation_instances;
  o public.obligations;
  a public.finance_accounts;
  v_applied numeric;
  v_movement uuid;
begin
  select * into i from public.obligation_instances where id = p_instance_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Cuota no encontrada' using errcode = 'no_data_found';
  end if;
  if i.status not in ('pending', 'partial') then
    raise exception 'La cuota ya está %', case i.status when 'paid' then 'pagada' when 'void' then 'anulada' else 'omitida' end
      using errcode = 'check_violation';
  end if;
  select * into o from public.obligations where id = i.obligation_id;
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  if a.currency = i.currency then
    v_applied := round(p_amount, 2);
  elsif p_applied is null or round(p_applied, 2) <= 0 then
    raise exception 'Indica cuánto cubre el pago en %', i.currency using errcode = 'check_violation';
  else
    v_applied := round(p_applied, 2);
  end if;

  insert into public.finance_movements (
    tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note,
    obligation_instance_id, obligation_amount
  ) values (
    v_tenant, a.id, 'out', 'obligation', round(p_amount, 2), a.currency, coalesce(p_paid_on, (now() at time zone 'America/Caracas')::date),
    coalesce(o.category, 'Obligaciones'), coalesce(o.counterparty, o.name), nullif(trim(p_reference), ''),
    coalesce(nullif(trim(p_note), ''), o.name || ' · vence ' || to_char(i.due_date, 'DD/MM/YYYY')), i.id, v_applied
  ) returning id into v_movement;

  update public.obligation_instances
  set settled = settled or coalesce(p_settle, false), paid_by = auth.uid(),
      note = coalesce(nullif(trim(p_note), ''), note)
  where id = i.id;
  perform app.obligation_recalc(i.id);
  return v_movement;
end;
$$;
revoke all on function app.pay_obligation(uuid, uuid, numeric, date, text, text, numeric, boolean) from public;
grant execute on function app.pay_obligation(uuid, uuid, numeric, date, text, text, numeric, boolean) to authenticated;

create function public.pay_obligation(
  p_instance_id uuid, p_account_id uuid, p_amount numeric, p_paid_on date,
  p_reference text default null, p_note text default null, p_applied numeric default null, p_settle boolean default false
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.pay_obligation(p_instance_id, p_account_id, p_amount, p_paid_on, p_reference, p_note, p_applied, p_settle)
$$;
revoke all on function public.pay_obligation(uuid, uuid, numeric, date, text, text, numeric, boolean) from public, anon;
grant execute on function public.pay_obligation(uuid, uuid, numeric, date, text, text, numeric, boolean) to authenticated;

-- Anular un pago recalcula su cuota (puede volver a parcial o pendiente).
create or replace function app.void_finance_movement(p_movement_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant(array['owner', 'admin']);
  m public.finance_movements;
begin
  select * into m from public.finance_movements where id = p_movement_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Movimiento no encontrado' using errcode = 'no_data_found';
  end if;
  if m.voided_at is not null then
    raise exception 'Ya estaba anulado' using errcode = 'check_violation';
  end if;
  if m.kind in ('sale', 'cash_close') then
    raise exception 'Los cobros del POS se corrigen desde la venta o el cierre de caja' using errcode = 'check_violation';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  update public.finance_movements
  set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where tenant_id = v_tenant and (id = m.id or (m.transfer_id is not null and transfer_id = m.transfer_id));
  if m.obligation_instance_id is not null then
    update public.obligation_instances set settled = false where id = m.obligation_instance_id;
    perform app.obligation_recalc(m.obligation_instance_id);
  end if;
end;
$$;

-- Omitir: solo si no tiene pagos.
create or replace function app.skip_obligation(p_instance_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
begin
  if nullif(trim(p_note), '') is null then
    raise exception 'Indica por qué no se paga' using errcode = 'check_violation';
  end if;
  update public.obligation_instances set status = 'skipped', note = trim(p_note)
  where id = p_instance_id and tenant_id = v_tenant and status = 'pending' and paid_amount = 0;
  if not found then
    raise exception 'Solo se omite una cuota pendiente y sin pagos' using errcode = 'check_violation';
  end if;
end;
$$;

-- Anular una cuota que no corresponde (cargada por error, duplicada).
create or replace function app.void_obligation_instance(p_instance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  update public.obligation_instances set status = 'void', void_reason = trim(p_reason), custom = true
  where id = p_instance_id and tenant_id = v_tenant and status in ('pending', 'skipped') and paid_amount = 0;
  if not found then
    raise exception 'Solo se anula una cuota sin pagos; anula primero sus pagos' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function app.void_obligation_instance(uuid, text) from public;
grant execute on function app.void_obligation_instance(uuid, text) to authenticated;

-- Reabrir una cuota omitida o anulada.
create or replace function app.reopen_obligation_instance(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
begin
  update public.obligation_instances set status = 'pending', void_reason = null
  where id = p_instance_id and tenant_id = v_tenant and status in ('skipped', 'void');
  if not found then
    raise exception 'Solo se reabre una cuota omitida o anulada' using errcode = 'check_violation';
  end if;
  perform app.obligation_recalc(p_instance_id);
end;
$$;
revoke all on function app.reopen_obligation_instance(uuid) from public;
grant execute on function app.reopen_obligation_instance(uuid) to authenticated;

-- Cambiar monto, fecha o nota de una cuota abierta. Queda fija (custom).
create or replace function app.update_obligation_instance(p_instance_id uuid, p_amount numeric, p_due_date date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  i public.obligation_instances;
begin
  select * into i from public.obligation_instances where id = p_instance_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Cuota no encontrada' using errcode = 'no_data_found';
  end if;
  if i.status not in ('pending', 'partial') then
    raise exception 'Solo se edita una cuota abierta' using errcode = 'check_violation';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  if p_due_date is null then
    raise exception 'Indica la fecha' using errcode = 'check_violation';
  end if;
  update public.obligation_instances
  set amount = round(p_amount, 2), due_date = p_due_date, note = nullif(trim(p_note), ''), custom = true
  where id = i.id;
  perform app.obligation_recalc(i.id);
exception when unique_violation then
  raise exception 'Ya hay una cuota de esta obligación ese día' using errcode = 'unique_violation';
end;
$$;
revoke all on function app.update_obligation_instance(uuid, numeric, date, text) from public;
grant execute on function app.update_obligation_instance(uuid, numeric, date, text) to authenticated;

-- Cuota adicional a mano (un pago extra, un ajuste).
create or replace function app.add_obligation_instance(p_obligation_id uuid, p_due_date date, p_amount numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  o public.obligations;
  v_id uuid;
begin
  select * into o from public.obligations where id = p_obligation_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Obligación no encontrada' using errcode = 'no_data_found';
  end if;
  if o.status = 'cancelled' then
    raise exception 'La obligación está cancelada' using errcode = 'check_violation';
  end if;
  if p_due_date is null or (p_amount is not null and p_amount < 0) then
    raise exception 'Fecha o monto inválidos' using errcode = 'check_violation';
  end if;
  insert into public.obligation_instances (tenant_id, obligation_id, due_date, amount, currency, custom, note)
  values (v_tenant, o.id, p_due_date, round(p_amount, 2), o.currency, true, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ya hay una cuota de esta obligación ese día' using errcode = 'unique_violation';
end;
$$;
revoke all on function app.add_obligation_instance(uuid, date, numeric, text) from public;
grant execute on function app.add_obligation_instance(uuid, date, numeric, text) to authenticated;

-- Comprobantes: los archivos van a Storage (bucket finance-proofs, carpeta
-- <tenant>/<cuota>/); aquí se registra la ruta.
create or replace function app.attach_obligation_proofs(p_instance_id uuid, p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_prefix text := v_tenant::text || '/' || p_instance_id::text || '/';
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return;
  end if;
  if exists (select 1 from unnest(p_paths) p where left(p, length(v_prefix)) <> v_prefix or p ~ '\.\.') then
    raise exception 'Ruta de comprobante inválida' using errcode = 'check_violation';
  end if;
  update public.obligation_instances
  set proof_paths = (select array_agg(distinct p order by p) from unnest(proof_paths || p_paths) p)
  where id = p_instance_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Cuota no encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.attach_obligation_proofs(uuid, text[]) from public;
grant execute on function app.attach_obligation_proofs(uuid, text[]) to authenticated;

-- Generación de cuotas: hasta p_until (por defecto 120 días; máximo dos años)
-- para obligaciones activas. Las cuotas futuras sin pagos y no editadas de una
-- obligación pausada o cancelada se quitan; si se reactiva, vuelven.
drop function public.refresh_obligations();
drop function app.refresh_obligations();
create or replace function app.refresh_obligations(p_until date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_until date := least(greatest(coalesce(p_until, v_today + 120), v_today + 120), v_today + 730);
  v_count integer;
begin
  delete from public.obligation_instances i
  using public.obligations o
  where i.obligation_id = o.id and i.tenant_id = v_tenant and i.status = 'pending' and i.paid_amount = 0
    and i.due_date >= v_today
    -- Las editadas a mano se respetan, salvo las futuras de una obligación cancelada.
    and (not i.custom or (o.status = 'cancelled' and i.due_date > v_today))
    and (o.status <> 'active' or (o.end_date is not null and i.due_date > o.end_date)
         or i.due_date not in (select app.obligation_due_dates(o.frequency, o.start_date, o.end_date, i.due_date, i.due_date)));

  update public.obligation_instances i
  set amount = o.amount, currency = o.currency
  from public.obligations o
  where i.obligation_id = o.id and i.tenant_id = v_tenant and i.status = 'pending' and i.paid_amount = 0
    and not i.custom and i.due_date >= v_today
    and (i.amount is distinct from o.amount or i.currency <> o.currency);

  insert into public.obligation_instances (tenant_id, obligation_id, due_date, amount, currency)
  select o.tenant_id, o.id, d, o.amount, o.currency
  from public.obligations o,
       lateral app.obligation_due_dates(o.frequency, o.start_date, o.end_date, o.start_date, v_until) d
  where o.tenant_id = v_tenant and o.status = 'active'
  on conflict (obligation_id, due_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.refresh_obligations(date) from public;
grant execute on function app.refresh_obligations(date) to authenticated;

-- Resumen: las parciales también están por pagar (lo que falta).
create or replace function app.finance_summary()
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
    'accounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'kind', a.kind, 'currency', a.currency, 'is_active', a.is_active,
        'balance', a.opening_balance + coalesce((
          select sum(case m.direction when 'in' then m.amount else -m.amount end)
          from public.finance_movements m
          where m.account_id = a.id and m.voided_at is null and m.occurred_on >= a.opening_date), 0),
        'last_movement_on', (select max(m.occurred_on) from public.finance_movements m where m.account_id = a.id and m.voided_at is null)
      ) order by a.position, a.name), '[]'::jsonb)
      from public.finance_accounts a where a.tenant_id = v_tenant
    ),
    'overdue', (
      select jsonb_build_object('count', coalesce(sum(x.n), 0), 'by_currency', coalesce(jsonb_object_agg(x.currency, x.total), '{}'::jsonb))
      from (select i.currency, sum(greatest(coalesce(i.amount, 0) - i.paid_amount, 0)) total, count(*) n
            from public.obligation_instances i
            where i.tenant_id = v_tenant and i.status in ('pending', 'partial') and i.due_date < v_today
            group by i.currency) x
    ),
    'upcoming', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'obligation_id', o.id, 'name', o.name, 'due_date', i.due_date,
        'amount', case when i.amount is null then null else greatest(i.amount - i.paid_amount, 0) end,
        'currency', i.currency, 'importance', o.importance, 'status', i.status
      ) order by i.due_date, o.name), '[]'::jsonb)
      from public.obligation_instances i join public.obligations o on o.id = i.obligation_id
      where i.tenant_id = v_tenant and i.status in ('pending', 'partial') and i.due_date <= v_today + 7
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Bitácora
-- ---------------------------------------------------------------------------

create table public.obligation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  obligation_id uuid not null,
  instance_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, obligation_id) references public.obligations (tenant_id, id) on delete cascade
);
create index obligation_events_obligation_idx on public.obligation_events (tenant_id, obligation_id, created_at desc);

alter table public.obligation_events enable row level security;
revoke all on public.obligation_events from anon;
revoke insert, update, delete on public.obligation_events from authenticated;
create policy tenant_read on public.obligation_events for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));

create or replace function app.obligation_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'INSERT' then
    insert into public.obligation_events (tenant_id, obligation_id, action, detail)
    values (new.tenant_id, new.id, 'created', jsonb_build_object('name', new.name, 'amount', new.amount, 'currency', new.currency, 'frequency', new.frequency));
    return new;
  end if;
  for k in select key from jsonb_each(to_jsonb(new)) where key not in ('updated_at', 'created_at')
  loop
    if to_jsonb(old) -> k is distinct from to_jsonb(new) -> k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    insert into public.obligation_events (tenant_id, obligation_id, action, detail)
    values (new.tenant_id, new.id, case when v_changes ? 'status' then 'status_' || new.status else 'updated' end, v_changes);
  end if;
  return new;
end;
$$;
revoke all on function app.obligation_log() from public;
create trigger obligations_log after insert or update on public.obligations
  for each row execute function app.obligation_log();

create or replace function app.obligation_instance_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    if new.custom then
      insert into public.obligation_events (tenant_id, obligation_id, instance_id, action, detail)
      values (new.tenant_id, new.obligation_id, new.id, 'instance_added', jsonb_build_object('due_date', new.due_date, 'amount', new.amount));
    end if;
    return new;
  end if;
  if new.status is distinct from old.status or new.paid_amount is distinct from old.paid_amount then
    v_action := 'instance_' || new.status;
  elsif new.amount is distinct from old.amount or new.due_date is distinct from old.due_date then
    v_action := 'instance_edited';
  elsif new.proof_paths is distinct from old.proof_paths then
    v_action := 'instance_proof';
  else
    return new;
  end if;
  insert into public.obligation_events (tenant_id, obligation_id, instance_id, action, detail)
  values (new.tenant_id, new.obligation_id, new.id, v_action, jsonb_build_object(
    'due_date', new.due_date, 'amount', new.amount, 'paid_amount', new.paid_amount,
    'from', jsonb_build_object('status', old.status, 'amount', old.amount, 'due_date', old.due_date, 'paid_amount', old.paid_amount),
    'reason', coalesce(new.void_reason, new.note)));
  return new;
end;
$$;
revoke all on function app.obligation_instance_log() from public;
create trigger obligation_instances_log after insert or update on public.obligation_instances
  for each row execute function app.obligation_instance_log();

-- ---------------------------------------------------------------------------
-- Storage de comprobantes (privado; carpeta = negocio)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-proofs', 'finance-proofs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create or replace function app.finance_proof_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return app.finance_role(v_folder::uuid);
end;
$$;
revoke all on function app.finance_proof_allowed(text) from public;
grant execute on function app.finance_proof_allowed(text) to authenticated;

create policy finance_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'finance-proofs' and app.finance_proof_allowed(name));
create policy finance_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'finance-proofs' and app.finance_proof_allowed(name));

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create function public.refresh_obligations(p_until date default null)
returns integer language sql security invoker set search_path = '' as $$
  select app.refresh_obligations(p_until)
$$;
create function public.void_obligation_instance(p_instance_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  select app.void_obligation_instance(p_instance_id, p_reason)
$$;
create function public.reopen_obligation_instance(p_instance_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select app.reopen_obligation_instance(p_instance_id)
$$;
create function public.update_obligation_instance(p_instance_id uuid, p_amount numeric, p_due_date date, p_note text default null)
returns void language sql security invoker set search_path = '' as $$
  select app.update_obligation_instance(p_instance_id, p_amount, p_due_date, p_note)
$$;
create function public.add_obligation_instance(p_obligation_id uuid, p_due_date date, p_amount numeric, p_note text default null)
returns uuid language sql security invoker set search_path = '' as $$
  select app.add_obligation_instance(p_obligation_id, p_due_date, p_amount, p_note)
$$;
create function public.attach_obligation_proofs(p_instance_id uuid, p_paths text[])
returns void language sql security invoker set search_path = '' as $$
  select app.attach_obligation_proofs(p_instance_id, p_paths)
$$;

revoke all on function public.refresh_obligations(date) from public, anon;
revoke all on function public.void_obligation_instance(uuid, text) from public, anon;
revoke all on function public.reopen_obligation_instance(uuid) from public, anon;
revoke all on function public.update_obligation_instance(uuid, numeric, date, text) from public, anon;
revoke all on function public.add_obligation_instance(uuid, date, numeric, text) from public, anon;
revoke all on function public.attach_obligation_proofs(uuid, text[]) from public, anon;
grant execute on function public.refresh_obligations(date) to authenticated;
grant execute on function public.void_obligation_instance(uuid, text) to authenticated;
grant execute on function public.reopen_obligation_instance(uuid) to authenticated;
grant execute on function public.update_obligation_instance(uuid, numeric, date, text) to authenticated;
grant execute on function public.add_obligation_instance(uuid, date, numeric, text) to authenticated;
grant execute on function public.attach_obligation_proofs(uuid, text[]) to authenticated;
