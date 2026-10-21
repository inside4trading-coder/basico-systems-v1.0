-- Accesos de Inicio por miembro.
--
-- Cada usuario elige y ordena los accesos que ve en Inicio, por negocio y en
-- cualquier dispositivo. Null = los de siempre según rol y módulos (los
-- calcula la app). Las claves son del catálogo de la app; la base solo cuida
-- que sean cortas y pocas. El rol lo sigue gestionando owner/admin por
-- update directo; esta columna solo la toca el propio miembro por RPC.

alter table public.tenant_members add column home_shortcuts text[];

create or replace function app.set_home_shortcuts(p_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_keys text[];
begin
  if v_tenant is null or auth.uid() is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;

  if p_keys is not null then
    if cardinality(p_keys) > 12 then
      raise exception 'Máximo 12 accesos' using errcode = 'check_violation';
    end if;
    if exists (select 1 from unnest(p_keys) k where k is null or k !~ '^[a-z][a-z0-9_-]{1,39}$') then
      raise exception 'Acceso no válido' using errcode = 'check_violation';
    end if;
    if (select count(distinct k) from unnest(p_keys) k) <> cardinality(p_keys) then
      raise exception 'Accesos repetidos' using errcode = 'check_violation';
    end if;
    v_keys := p_keys;
  end if;

  update public.tenant_members set home_shortcuts = v_keys, updated_at = now()
  where tenant_id = v_tenant and user_id = auth.uid();
  if not found then
    raise exception 'No eres miembro de este negocio' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function app.set_home_shortcuts(text[]) from public;
grant execute on function app.set_home_shortcuts(text[]) to authenticated;

create function public.set_home_shortcuts(p_keys text[])
returns void language sql security invoker set search_path = '' as $$ select app.set_home_shortcuts(p_keys) $$;
revoke all on function public.set_home_shortcuts(text[]) from public, anon;
grant execute on function public.set_home_shortcuts(text[]) to authenticated;
