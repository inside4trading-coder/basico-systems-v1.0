-- Búsqueda de usuario por email para la función invite-member.
--
-- Solo la plataforma (service_role) la ejecuta: expuesta a authenticated
-- serviría para enumerar qué correos tienen cuenta.

create or replace function public.platform_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1
$$;

revoke all on function public.platform_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.platform_user_id_by_email(text) to service_role;

-- Correo del miembro, para mostrar el equipo sin abrir auth.users al cliente.
-- Lo pone siempre el trigger desde auth.users; lo que mande el cliente se ignora.
alter table public.tenant_members add column email text;

create or replace function app.fill_member_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select u.email into new.email from auth.users u where u.id = new.user_id;
  return new;
end;
$$;
revoke all on function app.fill_member_email() from public;

create trigger tenant_members_fill_email
  before insert on public.tenant_members
  for each row execute function app.fill_member_email();
