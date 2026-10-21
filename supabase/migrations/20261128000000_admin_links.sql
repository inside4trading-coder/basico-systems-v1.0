-- Administración: más categorías por defecto y enlazar un pago ya registrado
-- a una cuota de obligación.
--
-- Portado de LinkMovementDialog y del enlace de movimientos de la
-- administración (basicosystems@9cb08cd):
--   * Un egreso que ya está en el libro (cargado a mano o creado desde el
--     estado de cuenta) se asigna a una o varias cuotas, completo o en parte,
--     sin crear otra salida de dinero.
--   * amount_allocated va en la moneda del movimiento y nunca suma más que el
--     movimiento; amount_applied va en la moneda de la cuota.
--   * Lo pagado de una cuota suma sus pagos propios y sus enlaces. Anular el
--     movimiento quita sus enlaces y recalcula las cuotas.

-- ---------------------------------------------------------------------------
-- Categorías por defecto
-- ---------------------------------------------------------------------------

create or replace function app.seed_finance_catalog(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.finance_catalog_items (tenant_id, kind, name, direction)
  select p_tenant_id, 'category', c.name, c.direction
  from (values
    ('Ventas', 'in'), ('Cobros a clientes', 'in'), ('Aportes de socios', 'in'), ('Préstamos recibidos', 'in'), ('Otros ingresos', 'in'),
    ('Compras de mercancía', 'out'), ('Alquiler', 'out'), ('Servicios', 'out'), ('Nómina', 'out'), ('Impuestos', 'out'),
    ('Proveedores', 'out'), ('Transporte', 'out'), ('Mantenimiento', 'out'), ('Publicidad', 'out'), ('Honorarios', 'out'),
    ('Préstamos pagados', 'out'), ('Comisiones bancarias', 'out'), ('Otros gastos', 'out')
  ) as c(name, direction)
  -- Una categoría que el negocio desactivó o renombró no vuelve.
  on conflict do nothing;
end;
$$;
revoke all on function app.seed_finance_catalog(uuid) from public;

select app.seed_finance_catalog(id) from public.tenants;

-- ---------------------------------------------------------------------------
-- Enlaces de pagos a cuotas
-- ---------------------------------------------------------------------------

create table public.finance_movement_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  movement_id uuid not null,
  obligation_instance_id uuid not null,
  amount_allocated numeric(16, 2) not null check (amount_allocated > 0),
  amount_applied numeric(16, 2) not null check (amount_applied > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (movement_id, obligation_instance_id),
  foreign key (tenant_id, movement_id) references public.finance_movements (tenant_id, id) on delete cascade,
  foreign key (tenant_id, obligation_instance_id) references public.obligation_instances (tenant_id, id) on delete cascade
);
create index finance_movement_links_instance_idx on public.finance_movement_links (tenant_id, obligation_instance_id);

alter table public.finance_movement_links enable row level security;
revoke all on public.finance_movement_links from anon, authenticated;
grant select on public.finance_movement_links to authenticated;
create policy tenant_read on public.finance_movement_links for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.finance_role(tenant_id));

-- Lo pagado de una cuota: pagos propios más enlaces de movimientos vigentes.
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
  with pays as (
    select m.id, m.occurred_on, m.created_at, m.obligation_amount as applied
    from public.finance_movements m
    where m.obligation_instance_id = i.id and m.voided_at is null
    union all
    select m.id, m.occurred_on, m.created_at, l.amount_applied
    from public.finance_movement_links l
    join public.finance_movements m on m.id = l.movement_id
    where l.obligation_instance_id = i.id and m.voided_at is null
  )
  select coalesce(sum(applied), 0), max(occurred_on),
         (select p.id from pays p order by p.occurred_on desc, p.created_at desc limit 1)
  into v_paid, v_last, v_last_mov
  from pays;

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

-- Cuánto de un movimiento ya está asignado a cuotas.
create or replace function app.movement_allocated(p_movement_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_allocated), 0) from public.finance_movement_links where movement_id = p_movement_id
$$;
revoke all on function app.movement_allocated(uuid) from public;

-- Egresos que se pueden enlazar a una cuota: hechos a mano o desde el estado
-- de cuenta, vigentes, sin pago de obligación propio y con saldo por asignar.
create or replace function app.obligation_link_candidates(p_instance_id uuid, p_from date, p_to date)
returns table (
  id uuid, occurred_on date, account_id uuid, account_name text, amount numeric, currency text,
  category text, counterparty text, reference text, note text, allocated numeric, linked_here boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
begin
  if not exists (select 1 from public.obligation_instances oi where oi.id = p_instance_id and oi.tenant_id = v_tenant) then
    raise exception 'Cuota no encontrada' using errcode = 'no_data_found';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Rango de fechas inválido' using errcode = 'check_violation';
  end if;
  return query
  select m.id, m.occurred_on, m.account_id, a.name, m.amount, m.currency,
         m.category, m.counterparty, m.reference, m.note,
         app.movement_allocated(m.id),
         exists (select 1 from public.finance_movement_links fl where fl.movement_id = m.id and fl.obligation_instance_id = p_instance_id)
  from public.finance_movements m
  join public.finance_accounts a on a.id = m.account_id
  where m.tenant_id = v_tenant and m.direction = 'out' and m.kind = 'manual'
    and m.voided_at is null and m.obligation_instance_id is null
    and m.occurred_on between p_from and p_to
  order by m.occurred_on desc, m.created_at desc
  limit 500;
end;
$$;
revoke all on function app.obligation_link_candidates(uuid, date, date) from public;
grant execute on function app.obligation_link_candidates(uuid, date, date) to authenticated;

-- Asigna un egreso (o parte) a una cuota. p_amount: cuánto del movimiento,
-- en su moneda (vacío = todo lo que queda). p_applied: cuánto cubre de la
-- cuota cuando las monedas difieren.
create or replace function app.link_movement(p_instance_id uuid, p_movement_id uuid, p_amount numeric default null, p_applied numeric default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  i public.obligation_instances;
  m public.finance_movements;
  v_free numeric;
  v_amount numeric;
  v_applied numeric;
  v_id uuid;
begin
  select * into i from public.obligation_instances where id = p_instance_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Cuota no encontrada' using errcode = 'no_data_found';
  end if;
  if i.status in ('skipped', 'void') then
    raise exception 'La cuota está omitida o anulada' using errcode = 'check_violation';
  end if;
  -- El bloqueo ordena dos enlaces del mismo movimiento a la vez.
  select * into m from public.finance_movements where id = p_movement_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Movimiento no encontrado' using errcode = 'no_data_found';
  end if;
  if m.direction <> 'out' or m.kind <> 'manual' or m.voided_at is not null or m.obligation_instance_id is not null then
    raise exception 'Solo se enlazan egresos vigentes registrados a mano o desde el estado de cuenta' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.finance_movement_links where movement_id = m.id and obligation_instance_id = i.id) then
    raise exception 'Este movimiento ya está enlazado a la cuota' using errcode = 'unique_violation';
  end if;

  v_free := m.amount - app.movement_allocated(m.id);
  v_amount := round(coalesce(p_amount, v_free), 2);
  if v_amount <= 0 or v_amount > v_free + 0.005 then
    raise exception 'El movimiento solo tiene % % por asignar', to_char(v_free, 'FM999G999G990D00'), m.currency using errcode = 'check_violation';
  end if;
  if m.currency = i.currency then
    v_applied := v_amount;
  else
    v_applied := round(p_applied, 2);
    if v_applied is null or v_applied <= 0 then
      raise exception 'Indica cuánto cubre de la cuota en %', i.currency using errcode = 'check_violation';
    end if;
  end if;

  insert into public.finance_movement_links (tenant_id, movement_id, obligation_instance_id, amount_allocated, amount_applied)
  values (v_tenant, m.id, i.id, v_amount, v_applied)
  returning id into v_id;
  perform app.obligation_recalc(i.id);
  return v_id;
end;
$$;
revoke all on function app.link_movement(uuid, uuid, numeric, numeric) from public;
grant execute on function app.link_movement(uuid, uuid, numeric, numeric) to authenticated;

create or replace function app.unlink_movement(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_tenant();
  l public.finance_movement_links;
begin
  delete from public.finance_movement_links where id = p_link_id and tenant_id = v_tenant returning * into l;
  if not found then
    raise exception 'Enlace no encontrado' using errcode = 'no_data_found';
  end if;
  perform app.obligation_recalc(l.obligation_instance_id);
end;
$$;
revoke all on function app.unlink_movement(uuid) from public;
grant execute on function app.unlink_movement(uuid) to authenticated;

-- Anular un movimiento enlazado: se quitan sus enlaces y las cuotas se recalculan.
create or replace function app.release_movement_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance uuid;
begin
  if new.voided_at is not null and old.voided_at is null then
    for v_instance in delete from public.finance_movement_links where movement_id = new.id returning obligation_instance_id
    loop
      perform app.obligation_recalc(v_instance);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function app.release_movement_links() from public;
create trigger finance_movements_release_links after update of voided_at on public.finance_movements
  for each row execute function app.release_movement_links();

-- Wrappers
create function public.obligation_link_candidates(p_instance_id uuid, p_from date, p_to date)
returns table (
  id uuid, occurred_on date, account_id uuid, account_name text, amount numeric, currency text,
  category text, counterparty text, reference text, note text, allocated numeric, linked_here boolean
)
language sql stable security invoker set search_path = '' as $$
  select * from app.obligation_link_candidates(p_instance_id, p_from, p_to)
$$;
create function public.link_movement(p_instance_id uuid, p_movement_id uuid, p_amount numeric default null, p_applied numeric default null)
returns uuid language sql security invoker set search_path = '' as $$
  select app.link_movement(p_instance_id, p_movement_id, p_amount, p_applied)
$$;
create function public.unlink_movement(p_link_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select app.unlink_movement(p_link_id)
$$;
revoke all on function public.obligation_link_candidates(uuid, date, date) from public, anon;
revoke all on function public.link_movement(uuid, uuid, numeric, numeric) from public, anon;
revoke all on function public.unlink_movement(uuid) from public, anon;
grant execute on function public.obligation_link_candidates(uuid, date, date) to authenticated;
grant execute on function public.link_movement(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.unlink_movement(uuid) to authenticated;
