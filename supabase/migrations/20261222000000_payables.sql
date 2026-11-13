-- Cuentas por pagar: facturas de proveedores a crédito.
--
--   * suppliers: proveedores del negocio (nombre, RIF, contacto, días de
--     crédito). Se crean de entrada con los nombres usados en Recepción.
--   * payables: una factura (n.º, emisión, moneda, total, base e IVA
--     informativos, categoría). «Proveedores» es mercancía: al pagarla no es
--     gasto en el resultado (se cuenta como costo al vender); otra categoría sí.
--   * payable_installments: cuotas; sin indicarlas, una sola que vence a los
--     días de crédito del proveedor.
--   * payable_payments: pago en dinero (deja la salida en el libro, kind
--     'payable') o nota de crédito (baja la deuda sin mover dinero). Lo pagado
--     se reparte en cascada desde la cuota más vieja; anular recalcula.
--   * Si se paga desde una cuenta en otra moneda, se indica cuánto cubre de la
--     factura (como en Por cobrar y Obligaciones).
-- Lectura con finanzas; operar con finanzas.operar; anular con finanzas.anular.

alter table public.finance_movements drop constraint finance_movements_kind_check;
alter table public.finance_movements add constraint finance_movements_kind_check
  check (kind in ('manual', 'transfer', 'sale', 'cash_close', 'obligation', 'receivable', 'provider', 'refund', 'payable'));

-- ---------------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  tax_id text check (tax_id is null or length(tax_id) <= 30),
  phone text check (phone is null or length(phone) <= 40),
  contact text check (contact is null or length(contact) <= 120),
  -- Días de crédito habituales: vencimiento por defecto de sus facturas.
  credit_days integer not null default 0 check (credit_days between 0 and 365),
  notes text check (notes is null or length(notes) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index suppliers_name_uq on public.suppliers (tenant_id, lower(trim(name)));
create trigger suppliers_touch before update on public.suppliers
  for each row execute function app.touch_updated_at();

alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon;
revoke delete on public.suppliers from authenticated;
create policy tenant_read on public.suppliers for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_insert on public.suppliers for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));
create policy finance_update on public.suppliers for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id))
  with check (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));

-- Los proveedores que ya se escribieron en Recepción.
insert into public.suppliers (tenant_id, name)
select distinct on (m.tenant_id, lower(trim(m.supplier))) m.tenant_id, left(trim(m.supplier), 120)
from public.inventory_movements m
where m.supplier is not null and length(trim(m.supplier)) > 0
order by m.tenant_id, lower(trim(m.supplier)), m.created_at
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Facturas, cuotas y pagos
-- ---------------------------------------------------------------------------

create table public.payables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  supplier_id uuid not null,
  -- N.º de factura y de control del proveedor.
  document text check (document is null or length(document) <= 60),
  control_number text check (control_number is null or length(control_number) <= 60),
  issued_on date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Base e IVA de la factura (informativos); amount es lo que se debe.
  subtotal numeric(16, 2) check (subtotal is null or subtotal >= 0),
  tax_amount numeric(16, 2) check (tax_amount is null or tax_amount >= 0),
  amount numeric(16, 2) not null check (amount > 0),
  category text not null default 'Proveedores' check (length(trim(category)) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  paid numeric(16, 2) not null default 0,
  cancel_reason text,
  note text check (note is null or length(note) <= 1000),
  source text not null default 'manual' check (source in ('manual', 'reception')),
  proof_paths text[] not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id),
  check ((status = 'cancelled') = (cancel_reason is not null))
);
-- La misma factura de un proveedor no se carga dos veces (salvo anulada).
create unique index payables_document_uq on public.payables (tenant_id, supplier_id, lower(document))
  where document is not null and status <> 'cancelled';
create index payables_status_idx on public.payables (tenant_id, status, issued_on desc);
create index payables_supplier_idx on public.payables (tenant_id, supplier_id);
create trigger payables_touch before update on public.payables
  for each row execute function app.touch_updated_at();

create table public.payable_installments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payable_id uuid not null,
  number integer not null check (number between 1 and 60),
  due_date date not null,
  amount numeric(16, 2) not null check (amount >= 0),
  -- Repartido desde los pagos vigentes (cascada).
  paid numeric(16, 2) not null default 0,
  unique (payable_id, number),
  unique (tenant_id, id),
  foreign key (tenant_id, payable_id) references public.payables (tenant_id, id) on delete cascade
);
create index payable_installments_due_idx on public.payable_installments (tenant_id, due_date);

create table public.payable_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payable_id uuid not null,
  -- cash: sale dinero de una cuenta · credit_note: nota de crédito o descuento del proveedor.
  kind text not null check (kind in ('cash', 'credit_note')),
  -- Lo que baja de la deuda, en la moneda de la factura.
  amount numeric(16, 2) not null check (amount > 0),
  occurred_on date not null,
  movement_id uuid,
  reference text check (reference is null or length(reference) <= 120),
  note text check (note is null or length(note) <= 500),
  voided_at timestamptz,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, payable_id) references public.payables (tenant_id, id),
  foreign key (tenant_id, movement_id) references public.finance_movements (tenant_id, id),
  check ((voided_at is null) = (void_reason is null)),
  check ((kind = 'cash') = (movement_id is not null))
);
create index payable_payments_payable_idx on public.payable_payments (tenant_id, payable_id);
create index payable_payments_movement_idx on public.payable_payments (movement_id) where movement_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['payables', 'payable_installments', 'payable_payments']
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

-- Reparte los pagos vigentes en cascada (cuota más vieja primero).
create or replace function app.payable_recalc(p_payable_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payables;
  i record;
  v_pool numeric;
  v_total numeric;
  v_take numeric;
begin
  select * into p from public.payables where id = p_payable_id for update;
  if not found then
    return;
  end if;
  select coalesce(sum(amount), 0) into v_total
  from public.payable_payments where payable_id = p.id and voided_at is null;
  v_pool := v_total;
  for i in select * from public.payable_installments where payable_id = p.id order by number loop
    v_take := least(i.amount, v_pool);
    v_pool := v_pool - v_take;
    update public.payable_installments set paid = v_take where id = i.id;
  end loop;
  update public.payables
  set paid = v_total,
      status = case when status = 'cancelled' then 'cancelled' when v_total >= amount - 0.005 then 'paid' else 'open' end
  where id = p.id;
end;
$$;
revoke all on function app.payable_recalc(uuid) from public;

create or replace function app.payable_for_write(p_tenant uuid, p_payable_id uuid)
returns public.payables
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payables;
begin
  select * into p from public.payables where id = p_payable_id and tenant_id = p_tenant for update;
  if not found then
    raise exception 'Cuenta por pagar no encontrada' using errcode = 'no_data_found';
  end if;
  return p;
end;
$$;
revoke all on function app.payable_for_write(uuid, uuid) from public;

-- Cuotas: [{due_date, amount}] que suman el total; sin cuotas, una sola a los días de crédito del proveedor.
create or replace function app.payable_set_installments(p_payable public.payables, p_installments jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum numeric;
  v_days integer;
begin
  if p_installments is null or jsonb_typeof(p_installments) <> 'array' or jsonb_array_length(p_installments) = 0 then
    select credit_days into v_days from public.suppliers where id = p_payable.supplier_id;
    insert into public.payable_installments (tenant_id, payable_id, number, due_date, amount)
    values (p_payable.tenant_id, p_payable.id, 1, p_payable.issued_on + coalesce(v_days, 0), p_payable.amount);
    return;
  end if;
  if jsonb_array_length(p_installments) > 60 then
    raise exception 'Máximo 60 cuotas' using errcode = 'check_violation';
  end if;
  select sum(round(x.amount, 2)) into v_sum from jsonb_to_recordset(p_installments) as x(due_date date, amount numeric);
  if exists (select 1 from jsonb_to_recordset(p_installments) as x(due_date date, amount numeric)
             where x.due_date is null or x.amount is null or x.amount < 0 or x.due_date < p_payable.issued_on)
     or abs(v_sum - p_payable.amount) > 0.01 then
    raise exception 'Las cuotas deben vencer desde la emisión y sumar %', p_payable.amount using errcode = 'check_violation';
  end if;
  insert into public.payable_installments (tenant_id, payable_id, number, due_date, amount)
  select p_payable.tenant_id, p_payable.id, x.n, (x.e ->> 'due_date')::date, round((x.e ->> 'amount')::numeric, 2)
  from jsonb_array_elements(p_installments) with ordinality as x(e, n);
end;
$$;
revoke all on function app.payable_set_installments(public.payables, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Operaciones
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
  if v_tax is not null and v_tax > v_amount then
    raise exception 'El IVA no puede superar el total' using errcode = 'check_violation';
  end if;
  if v_tax is not null and v_subtotal is null then
    v_subtotal := v_amount - v_tax;
  end if;
  insert into public.payables (
    tenant_id, supplier_id, document, control_number, issued_on, currency, subtotal, tax_amount, amount, category, note, source
  ) values (
    v_tenant, (p ->> 'supplier_id')::uuid, nullif(trim(p ->> 'document'), ''), nullif(trim(p ->> 'control_number'), ''),
    coalesce(nullif(p ->> 'issued_on', '')::date, (now() at time zone 'America/Caracas')::date),
    coalesce(nullif(p ->> 'currency', ''), (select base_currency from public.tenants where id = v_tenant)),
    v_subtotal, v_tax, v_amount, coalesce(nullif(trim(p ->> 'category'), ''), 'Proveedores'), nullif(trim(p ->> 'note'), ''), 'manual'
  ) returning * into r;
  perform app.payable_set_installments(r, p -> 'installments');
  return r.id;
exception when unique_violation then
  raise exception 'Esa factura de este proveedor ya está cargada' using errcode = 'unique_violation';
end;
$$;
revoke all on function app.create_payable(jsonb) from public;
grant execute on function app.create_payable(jsonb) to authenticated;

-- Pago en dinero desde una cuenta. p_applied: cuánto baja la deuda (en la
-- moneda de la factura) cuando la cuenta está en otra moneda.
create or replace function app.pay_payable(
  p_payable_id uuid, p_account_id uuid, p_amount numeric, p_occurred_on date,
  p_applied numeric default null, p_reference text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  r public.payables := app.payable_for_write(v_tenant, p_payable_id);
  a public.finance_accounts;
  v_supplier text;
  v_applied numeric;
  v_day date := coalesce(p_occurred_on, (now() at time zone 'America/Caracas')::date);
  v_movement uuid;
  v_id uuid;
begin
  if r.status <> 'open' then
    raise exception 'La cuenta por pagar no está abierta' using errcode = 'check_violation';
  end if;
  a := app.finance_account_for_write(v_tenant, p_account_id);
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Monto inválido' using errcode = 'check_violation';
  end if;
  if a.currency = r.currency then
    v_applied := round(p_amount, 2);
  elsif p_applied is null or round(p_applied, 2) <= 0 then
    raise exception 'Indica cuánto cubre el pago en %', r.currency using errcode = 'check_violation';
  else
    v_applied := round(p_applied, 2);
  end if;
  if v_applied > r.amount - r.paid + 0.005 then
    raise exception 'El pago supera lo que falta (% %)', r.amount - r.paid, r.currency using errcode = 'check_violation';
  end if;
  select name into v_supplier from public.suppliers where id = r.supplier_id;

  insert into public.finance_movements (tenant_id, account_id, direction, kind, amount, currency, occurred_on, category, counterparty, reference, note)
  values (v_tenant, a.id, 'out', 'payable', round(p_amount, 2), a.currency, v_day, r.category, v_supplier,
          nullif(trim(p_reference), ''),
          coalesce(nullif(trim(p_note), ''), 'Pago factura ' || coalesce(r.document, 's/n') || ' de ' || v_supplier))
  returning id into v_movement;
  insert into public.payable_payments (tenant_id, payable_id, kind, amount, occurred_on, movement_id, reference, note)
  values (v_tenant, r.id, 'cash', v_applied, v_day, v_movement, nullif(trim(p_reference), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  perform app.payable_recalc(r.id);
  return v_id;
end;
$$;
revoke all on function app.pay_payable(uuid, uuid, numeric, date, numeric, text, text) from public;
grant execute on function app.pay_payable(uuid, uuid, numeric, date, numeric, text, text) to authenticated;

-- Nota de crédito o descuento del proveedor: baja la deuda sin mover dinero.
create or replace function app.credit_payable(p_payable_id uuid, p_amount numeric, p_occurred_on date, p_reference text default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  r public.payables := app.payable_for_write(v_tenant, p_payable_id);
  v_id uuid;
begin
  if r.status <> 'open' then
    raise exception 'La cuenta por pagar no está abierta' using errcode = 'check_violation';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 or round(p_amount, 2) > r.amount - r.paid + 0.005 then
    raise exception 'La nota de crédito debe ser mayor que cero y no superar lo que falta (% %)', r.amount - r.paid, r.currency
      using errcode = 'check_violation';
  end if;
  insert into public.payable_payments (tenant_id, payable_id, kind, amount, occurred_on, reference, note)
  values (v_tenant, r.id, 'credit_note', round(p_amount, 2), coalesce(p_occurred_on, (now() at time zone 'America/Caracas')::date),
          nullif(trim(p_reference), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  perform app.payable_recalc(r.id);
  return v_id;
end;
$$;
revoke all on function app.credit_payable(uuid, numeric, date, text, text) from public;
grant execute on function app.credit_payable(uuid, numeric, date, text, text) to authenticated;

create or replace function app.void_payable_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant(array['owner', 'admin']);
  c public.payable_payments;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  select * into c from public.payable_payments where id = p_payment_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Pago no encontrado' using errcode = 'no_data_found';
  end if;
  if c.voided_at is not null then
    raise exception 'Ya estaba anulado' using errcode = 'check_violation';
  end if;
  update public.payable_payments set voided_at = now(), void_reason = trim(p_reason) where id = c.id;
  if c.movement_id is not null then
    update public.finance_movements set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
    where id = c.movement_id and voided_at is null;
  end if;
  perform app.payable_recalc(c.payable_id);
end;
$$;
revoke all on function app.void_payable_payment(uuid, text) from public;
grant execute on function app.void_payable_payment(uuid, text) to authenticated;

-- Anular el pago desde el libro (Movimientos) también lo deshace aquí.
create or replace function app.payable_release_voided_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.payable_payments;
begin
  if new.voided_at is not null and old.voided_at is null and new.kind = 'payable' then
    for c in select * from public.payable_payments where movement_id = new.id and voided_at is null loop
      update public.payable_payments set voided_at = new.voided_at, void_reason = new.void_reason where id = c.id;
      perform app.payable_recalc(c.payable_id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function app.payable_release_voided_movement() from public;
create trigger finance_movements_payable_release after update of voided_at on public.finance_movements
  for each row execute function app.payable_release_voided_movement();

create or replace function app.cancel_payable(p_payable_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant(array['owner', 'admin']);
  r public.payables := app.payable_for_write(v_tenant, p_payable_id);
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Indica el motivo' using errcode = 'check_violation';
  end if;
  if r.status = 'cancelled' then
    raise exception 'Ya estaba anulada' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.payable_payments where payable_id = r.id and voided_at is null) then
    raise exception 'Anula primero sus pagos' using errcode = 'check_violation';
  end if;
  update public.payables set status = 'cancelled', cancel_reason = trim(p_reason) where id = r.id;
end;
$$;
revoke all on function app.cancel_payable(uuid, text) from public;
grant execute on function app.cancel_payable(uuid, text) to authenticated;

-- Facturas o comprobantes: los archivos van a Storage (bucket finance-proofs,
-- carpeta <negocio>/<cuenta por pagar>/); aquí se registra la ruta.
create or replace function app.attach_payable_proofs(p_payable_id uuid, p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  v_prefix text := v_tenant::text || '/' || p_payable_id::text || '/';
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return;
  end if;
  if exists (select 1 from unnest(p_paths) p where left(p, length(v_prefix)) <> v_prefix or p ~ '\.\.') then
    raise exception 'Ruta de archivo inválida' using errcode = 'check_violation';
  end if;
  update public.payables
  set proof_paths = (select array_agg(distinct x order by x) from unnest(proof_paths || p_paths) x)
  where id = p_payable_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Cuenta por pagar no encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function app.attach_payable_proofs(uuid, text[]) from public;
grant execute on function app.attach_payable_proofs(uuid, text[]) to authenticated;

-- Resumen en la moneda base a la tasa de hoy: abierto, vencido, por vencer,
-- antigüedad de lo vencido y deuda por proveedor.
create or replace function app.payables_summary()
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
      select p.supplier_id, i.due_date,
             app.to_base(greatest(i.amount - i.paid, 0), p.currency, t.base_currency, t.local_currency, v_rate) as left_base,
             greatest(i.amount - i.paid, 0) as left_amount
      from public.payable_installments i join public.payables p on p.id = i.payable_id
      where p.tenant_id = v_tenant and p.status = 'open'
    ),
    open_inst as (select * from inst where left_amount > 0.005)
    select jsonb_build_object(
      'open', (select count(*) from public.payables where tenant_id = v_tenant and status = 'open'),
      'total', coalesce((select sum(left_base) from open_inst), 0),
      'overdue_count', (select count(*) from open_inst where due_date < v_today),
      'overdue_total', coalesce((select sum(left_base) from open_inst where due_date < v_today), 0),
      'due_7_total', coalesce((select sum(left_base) from open_inst where due_date between v_today and v_today + 7), 0),
      'due_30_total', coalesce((select sum(left_base) from open_inst where due_date between v_today and v_today + 30), 0),
      'unconverted', (select count(*) from open_inst where left_base is null),
      'aging', jsonb_build_object(
        'current', coalesce((select sum(left_base) from open_inst where due_date >= v_today), 0),
        'd1_30', coalesce((select sum(left_base) from open_inst where v_today - due_date between 1 and 30), 0),
        'd31_60', coalesce((select sum(left_base) from open_inst where v_today - due_date between 31 and 60), 0),
        'd61_90', coalesce((select sum(left_base) from open_inst where v_today - due_date between 61 and 90), 0),
        'd90_plus', coalesce((select sum(left_base) from open_inst where v_today - due_date > 90), 0)),
      'suppliers', coalesce((
        select jsonb_agg(jsonb_build_object('supplier_id', s.supplier_id, 'name', sp.name, 'total', s.total, 'overdue', s.overdue)
                         order by s.total desc)
        from (select supplier_id, round(sum(left_base), 2) as total,
                     round(coalesce(sum(left_base) filter (where due_date < v_today), 0), 2) as overdue
              from open_inst group by supplier_id) s
        join public.suppliers sp on sp.id = s.supplier_id), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function app.payables_summary() from public;
grant execute on function app.payables_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Resultado del periodo: los pagos de facturas de gastos cuentan como gasto;
-- los de mercancía (Proveedores) no, se cuentan como costo al vender.
-- ---------------------------------------------------------------------------

create or replace function app.report_income(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.report_tenant();
  t public.tenants;
  v_start timestamptz;
  v_end timestamptz;
  v_sales jsonb;
  v_expenses jsonb;
  v_other jsonb;
  v_unconverted integer;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'Periodo inválido' using errcode = 'check_violation';
  end if;
  if not app.finance_role(v_tenant) then
    raise exception 'El resultado es para dueños, administradores y encargados' using errcode = 'insufficient_privilege';
  end if;
  select * into t from public.tenants where id = v_tenant;
  v_start := app.caracas_day_start(p_from);
  v_end := app.caracas_day_start(p_to + 1);

  select jsonb_build_object(
           'net', coalesce(round(sum(i.line_total - i.tax_amount), 2), 0),
           'cost', coalesce(round(sum(i.qty * i.unit_cost) filter (where i.unit_cost is not null), 2), 0),
           'lines', count(i.id),
           'lines_costed', count(i.id) filter (where i.unit_cost is not null or i.manual_kind = 'servicio'))
  into v_sales
  from public.sales s
  join public.sale_items i on i.sale_id = s.id
  where s.tenant_id = v_tenant and s.status = 'completed' and s.sold_at >= v_start and s.sold_at < v_end;

  -- Devoluciones a precio sin impuesto (proporcional a la línea) y su costo, que vuelve al inventario.
  v_sales := v_sales || coalesce((
    select jsonb_build_object(
             'returns', round(sum(ri.amount * (i.line_total - i.tax_amount) / nullif(i.line_total, 0)), 2),
             'returns_cost', round(sum(ri.qty * i.unit_cost) filter (where i.unit_cost is not null), 2))
    from public.sale_returns r
    join public.sale_return_items ri on ri.return_id = r.id
    join public.sale_items i on i.id = ri.sale_item_id
    where r.tenant_id = v_tenant and r.created_at >= v_start and r.created_at < v_end), '{}'::jsonb);

  with mv as (
    select m.direction, m.kind, coalesce(nullif(trim(m.category), ''), 'Sin categoría') as category,
           app.to_base(m.amount, m.currency, t.base_currency, t.local_currency, app.rate_on_day(v_tenant, m.occurred_on)) as amount_base
    from public.finance_movements m
    where m.tenant_id = v_tenant and m.voided_at is null and m.occurred_on between p_from and p_to
      and m.kind in ('manual', 'obligation', 'payable')
      and not (m.direction = 'out' and m.category = 'Proveedores')
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb)
     from (select category, round(sum(amount_base), 2) amount from mv where direction = 'out' and amount_base is not null group by category) e),
    (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb)
     from (select category, round(sum(amount_base), 2) amount from mv where direction = 'in' and amount_base is not null and category <> 'Ventas' group by category) o),
    (select count(*)::int from mv where amount_base is null)
  into v_expenses, v_other, v_unconverted;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'base_currency', t.base_currency,
    'sales', v_sales, 'expenses', v_expenses, 'other_income', v_other, 'unconverted', v_unconverted);
end;
$$;
revoke all on function app.report_income(date, date) from public;
grant execute on function app.report_income(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Envoltorios públicos
-- ---------------------------------------------------------------------------

create function public.create_payable(p jsonb)
returns uuid language sql security invoker set search_path = '' as $$ select app.create_payable(p) $$;
create function public.pay_payable(
  p_payable_id uuid, p_account_id uuid, p_amount numeric, p_occurred_on date,
  p_applied numeric default null, p_reference text default null, p_note text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.pay_payable(p_payable_id, p_account_id, p_amount, p_occurred_on, p_applied, p_reference, p_note)
$$;
create function public.credit_payable(p_payable_id uuid, p_amount numeric, p_occurred_on date, p_reference text default null, p_note text default null)
returns uuid language sql security invoker set search_path = '' as $$
  select app.credit_payable(p_payable_id, p_amount, p_occurred_on, p_reference, p_note)
$$;
create function public.void_payable_payment(p_payment_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select app.void_payable_payment(p_payment_id, p_reason) $$;
create function public.cancel_payable(p_payable_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select app.cancel_payable(p_payable_id, p_reason) $$;
create function public.attach_payable_proofs(p_payable_id uuid, p_paths text[])
returns void language sql security invoker set search_path = '' as $$ select app.attach_payable_proofs(p_payable_id, p_paths) $$;
create function public.payables_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.payables_summary() $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_payable(jsonb)',
    'pay_payable(uuid, uuid, numeric, date, numeric, text, text)',
    'credit_payable(uuid, numeric, date, text, text)',
    'void_payable_payment(uuid, text)',
    'cancel_payable(uuid, text)',
    'attach_payable_proofs(uuid, text[])',
    'payables_summary()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
