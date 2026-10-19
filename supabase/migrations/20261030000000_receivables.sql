-- Cuentas por cobrar: crédito a clientes y ventas con financiadoras (Cashea
-- u otra), con cuotas, cobros y la cuenta corriente con cada financiadora.
--
-- Portado de sublime_cashea_operations / _installments / _recoveries /
-- _ledger / _service_invoices / _compensations y sublime_v_admin_receivables
-- (basicosystems@f551478b). Cambios de fondo:
--   * Genérico: una cuenta por cobrar es de un cliente (crédito) o de una
--     financiadora (provider, por ejemplo "Cashea"). Nada de una empresa en
--     el código: el nombre sale del método de pago o de la carga.
--   * Lo cobrado por cuota no se guarda a mano: se reparte en cascada desde
--     los cobros vigentes (primero la cuota más vieja). Anular un cobro
--     recalcula.
--   * Cobrar en dinero deja su entrada en el libro (kind 'receivable'); un
--     crédito de la financiadora (cuando cubre la cuota de un cliente
--     moroso) no mueve dinero: va a su cuenta corriente. La comisión baja
--     la deuda sin mover dinero.
--   * Una venta del POS cobrada con un método de financiadora (kind 'bnpl')
--     crea su cuenta por cobrar; la carga del archivo de la financiadora le
--     pone cuotas y estados.

alter table public.finance_movements drop constraint finance_movements_kind_check;
alter table public.finance_movements add constraint finance_movements_kind_check
  check (kind in ('manual', 'transfer', 'sale', 'cash_close', 'obligation', 'receivable', 'provider'));

-- Un método de financiadora no lleva a una cuenta: lo vendido queda por
-- cobrar (si no, contaría dos veces).
update public.payment_methods set account_id = null where kind = 'bnpl' and account_id is not null;
alter table public.payment_methods add constraint payment_methods_bnpl_no_account check (kind <> 'bnpl' or account_id is null);

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- credit: lo debe el cliente · financing: venta con una financiadora.
  kind text not null check (kind in ('credit', 'financing')),
  provider text check (provider is null or length(trim(provider)) between 1 and 60),
  customer_name text,
  customer_doc text,
  -- Número de venta o factura del negocio; external_ref: el de la financiadora (n.º de orden).
  document text,
  external_ref text,
  sale_id uuid,
  issued_on date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Venta completa y lo pagado de entrada (informativo); amount es lo que se cobra en cuotas.
  sale_total numeric(16, 2),
  initial_amount numeric(16, 2) not null default 0 check (initial_amount >= 0),
  amount numeric(16, 2) not null check (amount > 0),
  -- Comisión de la financiadora en % (informativa, para estimar).
  commission_rate numeric(6, 3) not null default 0 check (commission_rate between 0 and 100),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  collected numeric(16, 2) not null default 0,
  cancel_reason text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id),
  check ((kind = 'financing') = (provider is not null)),
  check ((status = 'cancelled') = (cancel_reason is not null))
);
create unique index receivables_external_uq on public.receivables (tenant_id, provider, external_ref) where external_ref is not null;
create index receivables_status_idx on public.receivables (tenant_id, status, issued_on desc);
create index receivables_sale_idx on public.receivables (tenant_id, sale_id) where sale_id is not null;
create trigger receivables_touch before update on public.receivables
  for each row execute function app.touch_updated_at();

create table public.receivable_installments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receivable_id uuid not null,
  number integer not null check (number between 1 and 60),
  due_date date not null,
  amount numeric(16, 2) not null check (amount >= 0),
  -- Repartido desde los cobros (cascada) y cubierto por la financiadora.
  collected numeric(16, 2) not null default 0,
  covered numeric(16, 2) not null default 0,
  -- Estado que informa la financiadora (DONE, DELAYED, GRACED…), tal cual.
  provider_status text,
  unique (receivable_id, number),
  unique (tenant_id, id),
  foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id) on delete cascade
);

create table public.receivable_collections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receivable_id uuid not null,
  -- cash: entra dinero a una cuenta (lo paga el cliente o la financiadora) ·
  -- provider_credit: la financiadora cubre una cuota (a su cuenta corriente) ·
  -- commission: comisión que descuenta la financiadora.
  kind text not null check (kind in ('cash', 'provider_credit', 'commission')),
  payer text not null default 'customer' check (payer in ('customer', 'provider')),
  installment_id uuid,
  amount numeric(16, 2) not null check (amount > 0),
  occurred_on date not null,
  movement_id uuid,
  reference text,
  note text,
  voided_at timestamptz,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id),
  foreign key (tenant_id, installment_id) references public.receivable_installments (tenant_id, id),
  foreign key (tenant_id, movement_id) references public.finance_movements (tenant_id, id),
  check ((voided_at is null) = (void_reason is null)),
  check ((kind = 'cash') = (movement_id is not null) or voided_at is not null),
  check (kind <> 'provider_credit' or installment_id is not null)
);
create index receivable_collections_receivable_idx on public.receivable_collections (tenant_id, receivable_id);

-- Cuenta corriente con cada financiadora: + a favor del negocio, − lo que
-- el negocio le debe (facturas de servicio).
create table public.provider_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null check (length(trim(provider)) between 1 and 60),
  entry_date date not null,
  kind text not null check (kind in ('coverage', 'service_invoice', 'settlement', 'adjustment')),
  amount numeric(16, 2) not null check (amount <> 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  document text,
  collection_id uuid,
  movement_id uuid,
  note text,
  voided_at timestamptz,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, collection_id) references public.receivable_collections (tenant_id, id),
  foreign key (tenant_id, movement_id) references public.finance_movements (tenant_id, id),
  check ((voided_at is null) = (void_reason is null))
);
create index provider_ledger_provider_idx on public.provider_ledger (tenant_id, provider, entry_date desc);

create table public.receivable_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null,
  file_name text not null,
  file_hash text,
  rows_total integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  linked_count integer not null default 0,
  issues jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['receivables', 'receivable_installments', 'receivable_collections', 'provider_ledger', 'receivable_imports']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create policy tenant_read on public.%I for select to authenticated
                    using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recalcular
-- ---------------------------------------------------------------------------

-- Reparte los cobros vigentes en cascada (cuota más vieja primero), después
-- de lo cubierto por la financiadora en cada cuota.
create or replace function app.receivable_recalc(p_receivable_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.receivables;
  i record;
  v_pool numeric;
  v_covered numeric;
  v_take numeric;
  v_total numeric;
begin
  select * into r from public.receivables where id = p_receivable_id for update;
  if not found then
    return;
  end if;
  select coalesce(sum(amount), 0) into v_pool
  from public.receivable_collections
  where receivable_id = r.id and voided_at is null and kind in ('cash', 'commission');

  for i in select * from public.receivable_installments where receivable_id = r.id order by number loop
    select coalesce(sum(amount), 0) into v_covered
    from public.receivable_collections
    where installment_id = i.id and voided_at is null and kind = 'provider_credit';
    v_take := least(greatest(i.amount - v_covered, 0), v_pool);
    v_pool := v_pool - v_take;
    update public.receivable_installments set collected = v_take, covered = v_covered where id = i.id;
  end loop;

  select coalesce(sum(amount), 0) into v_total
  from public.receivable_collections where receivable_id = r.id and voided_at is null;
  update public.receivables
  set collected = v_total,
      status = case when status = 'cancelled' then 'cancelled' when v_total >= amount - 0.005 then 'paid' else 'open' end
  where id = r.id;
end;
$$;
revoke all on function app.receivable_recalc(uuid) from public;

create or replace function app.receivable_for_write(p_tenant uuid, p_receivable_id uuid)
returns public.receivables
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.receivables;
begin
  select * into r from public.receivables where id = p_receivable_id and tenant_id = p_tenant for update;
  if not found then
    raise exception 'Cuenta por cobrar no encontrada' using errcode = 'no_data_found';
  end if;
  return r;
end;
$$;
revoke all on function app.receivable_for_write(uuid, uuid) from public;

-- Cuotas: [{due_date, amount}] que suman el monto; sin cuotas, una sola a 30 días.
create or replace function app.receivable_set_installments(p_receivable public.receivables, p_installments jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum numeric;
begin
  if p_installments is null or jsonb_typeof(p_installments) <> 'array' or jsonb_array_length(p_installments) = 0 then
    insert into public.receivable_installments (tenant_id, receivable_id, number, due_date, amount)
    values (p_receivable.tenant_id, p_receivable.id, 1, p_receivable.issued_on + 30, p_receivable.amount);
    return;
  end if;
  if jsonb_array_length(p_installments) > 60 then
    raise exception 'Máximo 60 cuotas' using errcode = 'check_violation';
  end if;
  select sum(round(x.amount, 2)) into v_sum from jsonb_to_recordset(p_installments) as x(due_date date, amount numeric);
  if exists (select 1 from jsonb_to_recordset(p_installments) as x(due_date date, amount numeric) where x.due_date is null or x.amount is null or x.amount < 0)
     or abs(v_sum - p_receivable.amount) > 0.01 then
    raise exception 'Las cuotas deben tener fecha y sumar %', p_receivable.amount using errcode = 'check_violation';
  end if;
  insert into public.receivable_installments (tenant_id, receivable_id, number, due_date, amount)
  select p_receivable.tenant_id, p_receivable.id, x.n, (x.e ->> 'due_date')::date, round((x.e ->> 'amount')::numeric, 2)
  from jsonb_array_elements(p_installments) with ordinality as x(e, n);
end;
$$;
revoke all on function app.receivable_set_installments(public.receivables, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Operaciones
-- ---------------------------------------------------------------------------

create or replace function app.create_receivable(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  r public.receivables;
  v_provider text := nullif(trim(p ->> 'provider'), '');
begin
  if coalesce((p ->> 'amount')::numeric, 0) <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  insert into public.receivables (
    tenant_id, kind, provider, customer_name, customer_doc, document, external_ref, issued_on, currency,
    sale_total, initial_amount, amount, commission_rate, note
  ) values (
    v_tenant, case when v_provider is null then 'credit' else 'financing' end, v_provider,
    nullif(trim(p ->> 'customer_name'), ''), nullif(trim(p ->> 'customer_doc'), ''), nullif(trim(p ->> 'document'), ''),
    nullif(trim(p ->> 'external_ref'), ''), coalesce((p ->> 'issued_on')::date, (now() at time zone 'America/Caracas')::date),
    coalesce(nullif(p ->> 'currency', ''), (select base_currency from public.tenants where id = v_tenant)),
    nullif(p ->> 'sale_total', '')::numeric, coalesce(nullif(p ->> 'initial_amount', '')::numeric, 0),
    round((p ->> 'amount')::numeric, 2), coalesce(nullif(p ->> 'commission_rate', '')::numeric, 0), nullif(trim(p ->> 'note'), '')
  ) returning * into r;
  if r.kind = 'credit' and r.customer_name is null then
    raise exception 'Indica el cliente' using errcode = 'check_violation';
  end if;
  perform app.receivable_set_installments(r, p -> 'installments');
  return r.id;
exception when unique_violation then
  raise exception 'Ya hay una venta de % con ese número de orden', v_provider using errcode = 'unique_violation';
end;
$$;
revoke all on function app.create_receivable(jsonb) from public;
grant execute on function app.create_receivable(jsonb) to authenticated;

-- Cobro en dinero a una cuenta. p_applied: cuánto baja la deuda (en su
-- moneda) cuando la cuenta está en otra moneda.
create or replace function app.collect_receivable(
  p_receivable_id uuid, p_account_id uuid, p_amount numeric, p_occurred_on date,
  p_payer text default 'customer', p_applied numeric default null, p_reference text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  r public.receivables := app.receivable_for_write(v_tenant, p_receivable_id);
  a public.finance_accounts;
  v_applied numeric;
  v_movement uuid;
  v_id uuid;
begin
  if r.status <> 'open' then
    raise exception 'La cuenta por cobrar no está abierta' using errcode = 'check_violation';
  end if;
  if p_payer not in ('customer', 'provider') or (p_payer = 'provider' and r.kind <> 'financing') then
    raise exception 'Quién paga no es válido' using errcode = 'check_violation';
  end if;
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  if a.currency = r.currency then
    v_applied := round(p_amount, 2);
  elsif p_applied is null or round(p_applied, 2) <= 0 then
    raise exception 'Indica cuánto cubre el cobro en %', r.currency using errcode = 'check_violation';
  else
    v_applied := round(p_applied, 2);
  end if;
  if v_applied > r.amount - r.collected + 0.005 then
    raise exception 'El cobro supera lo que falta (% %)', r.amount - r.collected, r.currency using errcode = 'check_violation';
  end if;

  insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note)
  values (v_tenant, a.id, 'in', 'receivable', round(p_amount, 2), a.currency, coalesce(p_occurred_on, (now() at time zone 'America/Caracas')::date),
          'Cobranzas', case when p_payer = 'provider' then r.provider else coalesce(r.customer_name, r.provider) end,
          nullif(trim(p_reference), ''),
          coalesce(nullif(trim(p_note), ''), 'Cobro ' || coalesce(r.document, r.external_ref, r.customer_name, '')))
  returning id into v_movement;
  insert into public.receivable_collections (tenant_id, receivable_id, kind, payer, amount, occurred_on, movement_id, reference, note)
  values (v_tenant, r.id, 'cash', p_payer, v_applied, coalesce(p_occurred_on, (now() at time zone 'America/Caracas')::date), v_movement,
          nullif(trim(p_reference), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  perform app.receivable_recalc(r.id);
  return v_id;
end;
$$;
revoke all on function app.collect_receivable(uuid, uuid, numeric, date, text, numeric, text, text) from public;
grant execute on function app.collect_receivable(uuid, uuid, numeric, date, text, numeric, text, text) to authenticated;

-- La financiadora cubre (total o en parte) la cuota de un cliente moroso:
-- baja la deuda y queda a favor en su cuenta corriente.
create or replace function app.cover_installment(p_installment_id uuid, p_amount numeric, p_occurred_on date, p_document text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  i public.receivable_installments;
  r public.receivables;
  v_id uuid;
begin
  select * into i from public.receivable_installments where id = p_installment_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Cuota no encontrada' using errcode = 'no_data_found';
  end if;
  r := app.receivable_for_write(v_tenant, i.receivable_id);
  if r.kind <> 'financing' or r.status <> 'open' then
    raise exception 'Solo se cubre una cuota abierta de una venta con financiadora' using errcode = 'check_violation';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 or round(p_amount, 2) > i.amount - i.covered - i.collected + 0.005 then
    raise exception 'Monto inválido para la cuota' using errcode = 'check_violation';
  end if;
  insert into public.receivable_collections (tenant_id, receivable_id, kind, payer, installment_id, amount, occurred_on, reference)
  values (v_tenant, r.id, 'provider_credit', 'provider', i.id, round(p_amount, 2), coalesce(p_occurred_on, (now() at time zone 'America/Caracas')::date),
          nullif(trim(p_document), ''))
  returning id into v_id;
  insert into public.provider_ledger (tenant_id, provider, entry_date, kind, amount, currency, document, collection_id, note)
  values (v_tenant, r.provider, coalesce(p_occurred_on, (now() at time zone 'America/Caracas')::date), 'coverage', round(p_amount, 2), r.currency,
          nullif(trim(p_document), ''), v_id, 'Cuota ' || i.number || ' de ' || coalesce(r.external_ref, r.document, ''));
  perform app.receivable_recalc(r.id);
  return v_id;
end;
$$;
revoke all on function app.cover_installment(uuid, numeric, date, text) from public;
grant execute on function app.cover_installment(uuid, numeric, date, text) to authenticated;

-- Comisión que la financiadora descuenta: baja la deuda sin mover dinero.
create or replace function app.register_receivable_commission(p_receivable_id uuid, p_amount numeric, p_occurred_on date, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  r public.receivables := app.receivable_for_write(v_tenant, p_receivable_id);
  v_id uuid;
begin
  if r.kind <> 'financing' or r.status <> 'open' then
    raise exception 'Solo una venta abierta con financiadora tiene comisión' using errcode = 'check_violation';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 or round(p_amount, 2) > r.amount - r.collected + 0.005 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  insert into public.receivable_collections (tenant_id, receivable_id, kind, payer, amount, occurred_on, note)
  values (v_tenant, r.id, 'commission', 'provider', round(p_amount, 2), coalesce(p_occurred_on, (now() at time zone 'America/Caracas')::date), nullif(trim(p_note), ''))
  returning id into v_id;
  perform app.receivable_recalc(r.id);
  return v_id;
end;
$$;
revoke all on function app.register_receivable_commission(uuid, numeric, date, text) from public;
grant execute on function app.register_receivable_commission(uuid, numeric, date, text) to authenticated;

-- Anular un cobro: anula su entrada del libro y su crédito en la cuenta
-- corriente, y recalcula.
create or replace function app.void_receivable_collection(p_collection_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant(array['owner', 'admin']);
  c public.receivable_collections;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  select * into c from public.receivable_collections where id = p_collection_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Cobro no encontrado' using errcode = 'no_data_found';
  end if;
  if c.voided_at is not null then
    raise exception 'Ya estaba anulado' using errcode = 'check_violation';
  end if;
  update public.receivable_collections set voided_at = now(), void_reason = trim(p_reason) where id = c.id;
  if c.movement_id is not null then
    update public.finance_movements set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
    where id = c.movement_id and voided_at is null;
  end if;
  update public.provider_ledger set voided_at = now(), void_reason = trim(p_reason) where collection_id = c.id and voided_at is null;
  perform app.receivable_recalc(c.receivable_id);
end;
$$;
revoke all on function app.void_receivable_collection(uuid, text) from public;
grant execute on function app.void_receivable_collection(uuid, text) to authenticated;

-- Anular un cobro o una liquidación desde el libro (Movimientos) los deshace.
create or replace function app.receivable_release_voided_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.receivable_collections;
begin
  if new.voided_at is not null and old.voided_at is null then
    for c in select * from public.receivable_collections where movement_id = new.id and voided_at is null loop
      update public.receivable_collections set voided_at = new.voided_at, void_reason = new.void_reason where id = c.id;
      perform app.receivable_recalc(c.receivable_id);
    end loop;
    update public.provider_ledger set voided_at = new.voided_at, void_reason = new.void_reason
    where movement_id = new.id and voided_at is null;
  end if;
  return new;
end;
$$;
revoke all on function app.receivable_release_voided_movement() from public;
create trigger finance_movements_receivable_release after update of voided_at on public.finance_movements
  for each row execute function app.receivable_release_voided_movement();

create or replace function app.cancel_receivable(p_receivable_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant(array['owner', 'admin']);
  r public.receivables := app.receivable_for_write(v_tenant, p_receivable_id);
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.receivable_collections where receivable_id = r.id and voided_at is null) then
    raise exception 'Anula primero sus cobros' using errcode = 'check_violation';
  end if;
  update public.receivables set status = 'cancelled', cancel_reason = trim(p_reason) where id = r.id;
end;
$$;
revoke all on function app.cancel_receivable(uuid, text) from public;
grant execute on function app.cancel_receivable(uuid, text) to authenticated;

-- Cuenta corriente: factura de servicios (lo que el negocio le debe) o ajuste.
create or replace function app.add_provider_entry(
  p_provider text, p_kind text, p_amount numeric, p_entry_date date, p_currency text default null, p_document text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_id uuid;
begin
  if nullif(trim(p_provider), '') is null or p_kind not in ('service_invoice', 'adjustment') then
    raise exception 'Datos inválidos' using errcode = 'check_violation';
  end if;
  if p_amount is null or round(p_amount, 2) = 0 or (p_kind = 'service_invoice' and p_amount < 0) then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  insert into public.provider_ledger (tenant_id, provider, entry_date, kind, amount, currency, document, note)
  values (v_tenant, trim(p_provider), coalesce(p_entry_date, (now() at time zone 'America/Caracas')::date), p_kind,
          case when p_kind = 'service_invoice' then -round(p_amount, 2) else round(p_amount, 2) end,
          coalesce(nullif(p_currency, ''), (select base_currency from public.tenants where id = v_tenant)),
          nullif(trim(p_document), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.add_provider_entry(text, text, numeric, date, text, text, text) from public;
grant execute on function app.add_provider_entry(text, text, numeric, date, text, text, text) to authenticated;

-- Liquidar el saldo con dinero: 'in' la financiadora le paga al negocio,
-- 'out' el negocio le paga. Deja el movimiento en el libro.
create or replace function app.settle_provider(
  p_provider text, p_account_id uuid, p_direction text, p_amount numeric, p_entry_date date, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  a public.finance_accounts;
  v_movement uuid;
  v_id uuid;
begin
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if nullif(trim(p_provider), '') is null or p_direction not in ('in', 'out') or p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Datos inválidos' using errcode = 'check_violation';
  end if;
  insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note)
  values (v_tenant, a.id, p_direction, 'provider', round(p_amount, 2), a.currency, coalesce(p_entry_date, (now() at time zone 'America/Caracas')::date),
          'Financiadoras', trim(p_provider), nullif(trim(p_reference), ''), 'Liquidación con ' || trim(p_provider))
  returning id into v_movement;
  insert into public.provider_ledger (tenant_id, provider, entry_date, kind, amount, currency, document, movement_id)
  values (v_tenant, trim(p_provider), coalesce(p_entry_date, (now() at time zone 'America/Caracas')::date), 'settlement',
          case when p_direction = 'in' then -round(p_amount, 2) else round(p_amount, 2) end, a.currency, nullif(trim(p_reference), ''), v_movement)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.settle_provider(text, uuid, text, numeric, date, text) from public;
grant execute on function app.settle_provider(text, uuid, text, numeric, date, text) to authenticated;

create or replace function app.void_provider_entry(p_entry_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant(array['owner', 'admin']);
  e public.provider_ledger;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  select * into e from public.provider_ledger where id = p_entry_id and tenant_id = v_tenant for update;
  if not found or e.voided_at is not null then
    raise exception 'Movimiento no encontrado o ya anulado' using errcode = 'no_data_found';
  end if;
  if e.kind = 'coverage' then
    raise exception 'Una cobertura se anula desde su cuota' using errcode = 'check_violation';
  end if;
  update public.provider_ledger set voided_at = now(), void_reason = trim(p_reason) where id = e.id;
  if e.movement_id is not null then
    update public.finance_movements set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
    where id = e.movement_id and voided_at is null;
  end if;
end;
$$;
revoke all on function app.void_provider_entry(uuid, text) from public;
grant execute on function app.void_provider_entry(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Venta del POS con financiadora
-- ---------------------------------------------------------------------------

create or replace function app.receivable_from_sale_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.payment_methods;
  s public.sales;
  r public.receivables;
  v_initial numeric;
begin
  select * into m from public.payment_methods where id = new.payment_method_id;
  if not found or m.kind <> 'bnpl' then
    return new;
  end if;
  select * into s from public.sales where id = new.sale_id;
  -- Lo que no financia la financiadora se pagó de entrada (sin depender del orden de los pagos).
  v_initial := greatest(s.total - new.amount_base, 0);
  insert into public.receivables (
    tenant_id, kind, provider, customer_name, customer_doc, document, external_ref, sale_id, issued_on, currency,
    sale_total, initial_amount, amount
  ) values (
    new.tenant_id, 'financing', m.name, s.customer_name, s.customer_doc, s.number, nullif(trim(new.reference), ''), s.id,
    (s.sold_at at time zone 'America/Caracas')::date, new.currency, s.total, v_initial, new.amount
  )
  on conflict (tenant_id, provider, external_ref) where external_ref is not null do nothing
  returning * into r;
  if r.id is not null then
    perform app.receivable_set_installments(r, null);
  end if;
  return new;
end;
$$;
revoke all on function app.receivable_from_sale_payment() from public;
create trigger sale_payments_receivable after insert on public.sale_payments
  for each row execute function app.receivable_from_sale_payment();

-- Venta anulada: su cuenta por cobrar sin cobros se cancela.
create or replace function app.receivable_cancel_voided_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'voided' and old.status is distinct from 'voided' then
    update public.receivables r set status = 'cancelled', cancel_reason = 'Venta ' || new.number || ' anulada'
    where r.sale_id = new.id and r.status = 'open'
      and not exists (select 1 from public.receivable_collections c where c.receivable_id = r.id and c.voided_at is null);
  end if;
  return new;
end;
$$;
revoke all on function app.receivable_cancel_voided_sale() from public;
create trigger sales_receivable_cancel after update of status on public.sales
  for each row execute function app.receivable_cancel_voided_sale();

-- ---------------------------------------------------------------------------
-- Carga del archivo de la financiadora
-- ---------------------------------------------------------------------------

-- p_rows: [{external_ref, document, customer_name, issued_on, sale_total,
-- initial_amount, currency, installments: [{number, due_date, amount, status}]}].
-- Busca la cuenta por n.º de orden; si no, la venta del POS por número o por
-- la referencia del pago; si no, la crea. Las cuotas se reemplazan mientras
-- no haya cobros; con cobros solo se actualiza el estado que informa.
create or replace function app.import_financing(p_provider text, p_file_name text, p_file_hash text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_provider text := nullif(trim(p_provider), '');
  v_base text := (select base_currency from public.tenants where id = v_tenant);
  x record;
  r public.receivables;
  v_sale public.sales;
  v_amount numeric;
  v_created integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_issues jsonb := '[]'::jsonb;
  v_row integer := 0;
begin
  if v_provider is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Datos inválidos' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Máximo 5.000 filas por carga' using errcode = 'check_violation';
  end if;

  for x in select * from jsonb_to_recordset(p_rows) as t(
    external_ref text, document text, customer_name text, issued_on date, sale_total numeric,
    initial_amount numeric, currency text, installments jsonb)
  loop
    v_row := v_row + 1;
    if nullif(trim(x.external_ref), '') is null and nullif(trim(x.document), '') is null then
      v_issues := v_issues || jsonb_build_object('row', v_row, 'reason', 'Sin número de orden ni factura');
      continue;
    end if;
    v_amount := coalesce((select sum(round((e ->> 'amount')::numeric, 2)) from jsonb_array_elements(coalesce(x.installments, '[]'::jsonb)) e), 0);
    if v_amount <= 0 then
      v_amount := round(coalesce(x.sale_total, 0) - coalesce(x.initial_amount, 0), 2);
    end if;

    r := null;
    select * into r from public.receivables
    where tenant_id = v_tenant and provider = v_provider and external_ref = nullif(trim(x.external_ref), '') for update;
    if r.id is null then
      select s.* into v_sale from public.sales s
      where s.tenant_id = v_tenant and s.status = 'completed'
        and (s.number = nullif(trim(x.document), '')
             or exists (select 1 from public.sale_payments p join public.payment_methods pm on pm.id = p.payment_method_id
                        where p.sale_id = s.id and pm.kind = 'bnpl' and app.bank_ref(p.reference) <> ''
                          and app.bank_ref(p.reference) = app.bank_ref(x.external_ref)))
      order by s.sold_at desc limit 1;
      if v_sale.id is not null then
        select * into r from public.receivables
        where tenant_id = v_tenant and sale_id = v_sale.id and provider = v_provider for update;
        if r.id is not null then
          update public.receivables set external_ref = coalesce(nullif(trim(x.external_ref), ''), external_ref) where id = r.id;
          v_linked := v_linked + 1;
        end if;
      end if;
    end if;

    if r.id is null then
      if v_amount <= 0 then
        v_issues := v_issues || jsonb_build_object('row', v_row, 'reason', 'Sin monto financiado');
        continue;
      end if;
      insert into public.receivables (
        tenant_id, kind, provider, customer_name, document, external_ref, sale_id, issued_on, currency, sale_total, initial_amount, amount
      ) values (
        v_tenant, 'financing', v_provider, nullif(trim(x.customer_name), ''), nullif(trim(x.document), ''), nullif(trim(x.external_ref), ''),
        v_sale.id, coalesce(x.issued_on, (now() at time zone 'America/Caracas')::date), coalesce(nullif(x.currency, ''), v_base),
        x.sale_total, coalesce(x.initial_amount, 0), v_amount
      ) returning * into r;
      v_created := v_created + 1;
    else
      v_updated := v_updated + 1;
    end if;

    if jsonb_array_length(coalesce(x.installments, '[]'::jsonb)) > 0 then
      if not exists (select 1 from public.receivable_collections where receivable_id = r.id and voided_at is null)
         and abs(v_amount - r.amount) <= 0.01 then
        delete from public.receivable_installments where receivable_id = r.id;
        insert into public.receivable_installments (tenant_id, receivable_id, number, due_date, amount, provider_status)
        select v_tenant, r.id, (e ->> 'number')::integer, coalesce((e ->> 'due_date')::date, r.issued_on + 14 * (e ->> 'number')::integer),
               round((e ->> 'amount')::numeric, 2), nullif(upper(trim(e ->> 'status')), '')
        from jsonb_array_elements(x.installments) e;
      else
        update public.receivable_installments i set provider_status = nullif(upper(trim(e ->> 'status')), '')
        from jsonb_array_elements(x.installments) e
        where i.receivable_id = r.id and i.number = (e ->> 'number')::integer;
        if abs(v_amount - r.amount) > 0.01 then
          v_issues := v_issues || jsonb_build_object('row', v_row, 'reason',
            format('Orden %s: el archivo dice %s y aquí %s; se actualizaron solo los estados', coalesce(x.external_ref, x.document), v_amount, r.amount));
        end if;
      end if;
    elsif not exists (select 1 from public.receivable_installments where receivable_id = r.id) then
      perform app.receivable_set_installments(r, null);
    end if;
    perform app.receivable_recalc(r.id);
  end loop;

  insert into public.receivable_imports (tenant_id, provider, file_name, file_hash, rows_total, created_count, updated_count, linked_count, issues)
  values (v_tenant, v_provider, left(coalesce(nullif(trim(p_file_name), ''), 'Archivo'), 200), p_file_hash, v_row, v_created, v_updated, v_linked, v_issues);
  return jsonb_build_object('rows', v_row, 'created', v_created, 'updated', v_updated, 'linked', v_linked, 'issues', v_issues);
end;
$$;
revoke all on function app.import_financing(text, text, text, jsonb) from public;
grant execute on function app.import_financing(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Resumen: por cobrar
-- ---------------------------------------------------------------------------

create or replace function app.receivables_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  t public.tenants;
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_rate numeric;
begin
  select * into t from public.tenants where id = v_tenant;
  select r.rate into v_rate from app.rate_at(v_tenant) r;
  return (
    with inst as (
      select i.due_date, r.currency, r.kind, r.provider, greatest(i.amount - i.collected - i.covered, 0) as remaining
      from public.receivable_installments i join public.receivables r on r.id = i.receivable_id
      where r.tenant_id = v_tenant and r.status = 'open'
    )
    select jsonb_build_object(
      'open', (select count(*) from public.receivables where tenant_id = v_tenant and status = 'open'),
      'total', coalesce(sum(app.to_base(remaining, currency, t.base_currency, t.local_currency, v_rate)), 0),
      'overdue_count', count(*) filter (where due_date < v_today and remaining > 0.005),
      'overdue_total', coalesce(sum(app.to_base(remaining, currency, t.base_currency, t.local_currency, v_rate)) filter (where due_date < v_today), 0),
      'credit_total', coalesce(sum(app.to_base(remaining, currency, t.base_currency, t.local_currency, v_rate)) filter (where kind = 'credit'), 0),
      'financing_total', coalesce(sum(app.to_base(remaining, currency, t.base_currency, t.local_currency, v_rate)) filter (where kind = 'financing'), 0),
      'providers', (
        select coalesce(jsonb_agg(jsonb_build_object('provider', p.provider, 'currency', p.currency, 'balance', p.balance) order by p.provider), '[]'::jsonb)
        from (select provider, currency, sum(amount) as balance from public.provider_ledger
              where tenant_id = v_tenant and voided_at is null group by provider, currency) p
      ))
    from inst
  );
end;
$$;
revoke all on function app.receivables_summary() from public;
grant execute on function app.receivables_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create function public.create_receivable(p jsonb)
returns uuid language sql security invoker set search_path = '' as $$ select app.create_receivable(p) $$;
create function public.collect_receivable(
  p_receivable_id uuid, p_account_id uuid, p_amount numeric, p_occurred_on date,
  p_payer text default 'customer', p_applied numeric default null, p_reference text default null, p_note text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.collect_receivable(p_receivable_id, p_account_id, p_amount, p_occurred_on, p_payer, p_applied, p_reference, p_note)
$$;
create function public.cover_installment(p_installment_id uuid, p_amount numeric, p_occurred_on date, p_document text default null)
returns uuid language sql security invoker set search_path = '' as $$
  select app.cover_installment(p_installment_id, p_amount, p_occurred_on, p_document)
$$;
create function public.register_receivable_commission(p_receivable_id uuid, p_amount numeric, p_occurred_on date, p_note text default null)
returns uuid language sql security invoker set search_path = '' as $$
  select app.register_receivable_commission(p_receivable_id, p_amount, p_occurred_on, p_note)
$$;
create function public.void_receivable_collection(p_collection_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select app.void_receivable_collection(p_collection_id, p_reason) $$;
create function public.cancel_receivable(p_receivable_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select app.cancel_receivable(p_receivable_id, p_reason) $$;
create function public.add_provider_entry(
  p_provider text, p_kind text, p_amount numeric, p_entry_date date, p_currency text default null, p_document text default null, p_note text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.add_provider_entry(p_provider, p_kind, p_amount, p_entry_date, p_currency, p_document, p_note)
$$;
create function public.settle_provider(p_provider text, p_account_id uuid, p_direction text, p_amount numeric, p_entry_date date, p_reference text default null)
returns uuid language sql security invoker set search_path = '' as $$
  select app.settle_provider(p_provider, p_account_id, p_direction, p_amount, p_entry_date, p_reference)
$$;
create function public.void_provider_entry(p_entry_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select app.void_provider_entry(p_entry_id, p_reason) $$;
create function public.import_financing(p_provider text, p_file_name text, p_file_hash text, p_rows jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select app.import_financing(p_provider, p_file_name, p_file_hash, p_rows) $$;
create function public.receivables_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.receivables_summary() $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_receivable(jsonb)',
    'collect_receivable(uuid, uuid, numeric, date, text, numeric, text, text)',
    'cover_installment(uuid, numeric, date, text)',
    'register_receivable_commission(uuid, numeric, date, text)',
    'void_receivable_collection(uuid, text)',
    'cancel_receivable(uuid, text)',
    'add_provider_entry(text, text, numeric, date, text, text, text)',
    'settle_provider(text, uuid, text, numeric, date, text)',
    'void_provider_entry(uuid, text)',
    'import_financing(text, text, text, jsonb)',
    'receivables_summary()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
