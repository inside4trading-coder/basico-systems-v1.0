-- Resultado del periodo (estado de resultados simple).
--
-- Portado de SublimeFinanciero (basicosystems@f551478b). A diferencia del
-- resumen de tesorería (lo que entró y salió de las cuentas), mide si el
-- negocio ganó dinero:
--   ventas netas sin impuesto − devoluciones − costo de lo vendido
--   = utilidad bruta
--   − gastos (egresos del libro por categoría, a la tasa de su día)
--   + otros ingresos (ingresos manuales del libro)
--   = resultado
-- No son gasto las compras de mercancía (categoría Proveedores: pasan a
-- inventario y se cuentan al venderse como costo), las transferencias entre
-- cuentas, los cobros de cuentas por cobrar, las liquidaciones con
-- financiadoras ni los reintegros de devoluciones (ya restan como devolución).
-- El costo solo cuenta las líneas con costo conocido; se informa la cobertura.

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
      and m.kind in ('manual', 'obligation')
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

create function public.report_income(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.report_income(p_from, p_to) $$;
revoke all on function public.report_income(date, date) from public, anon;
grant execute on function public.report_income(date, date) to authenticated;
