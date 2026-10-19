-- Carritos en espera: el cajero aparta una venta a medias (el cliente fue a
-- buscar algo) y atiende a otro; después la retoma desde esa u otra caja de
-- la misma sede.
--
-- Portado de sublime_suspend_cart (basicosystems@f551478b). El carrito se
-- guarda tal cual lo arma el POS; al cobrar, register_sale vuelve a tomar
-- precios, impuestos y stock del servidor, así que lo guardado no decide
-- nada. No aparta stock.

create table public.pos_held_carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  location_id uuid not null,
  label text not null check (length(trim(label)) between 1 and 60),
  -- Carrito del POS (líneas, descuento, cliente) como lo guarda el navegador.
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 200000),
  items integer not null default 0 check (items >= 0),
  total numeric(14, 2) not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade
);
create index pos_held_carts_location_idx on public.pos_held_carts (tenant_id, location_id, created_at desc);

alter table public.pos_held_carts enable row level security;
revoke all on public.pos_held_carts from anon;
revoke update on public.pos_held_carts from authenticated;
create policy tenant_read on public.pos_held_carts for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy member_insert on public.pos_held_carts for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and created_by = (select auth.uid()));
-- Cualquiera del negocio lo retoma (y al retomarlo se borra).
create policy member_delete on public.pos_held_carts for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()));
