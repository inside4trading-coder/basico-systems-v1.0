-- [B]eto: el nombre se escribe siempre con la B entre corchetes.
--
-- Solo cambian los textos de app.beto_start (módulo, permiso, cuota y
-- pregunta pendiente). La lógica es la misma de 20261224000000_beto.sql.

create or replace function app.beto_start(p_conversation_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_user uuid := auth.uid();
  t public.tenants;
  v_message text := trim(p_message);
  v_usage jsonb;
  v_conv uuid := p_conversation_id;
  v_id uuid;
  v_history jsonb;
  v_today date := (now() at time zone 'America/Caracas')::date;
begin
  if v_tenant is null or v_user is null then
    raise exception 'Sin negocio activo' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_module(v_tenant, 'beto', '[B]eto');
  if not app.has_capability(v_tenant, 'beto.usar') then
    raise exception 'Tu rol no tiene acceso a [B]eto' using errcode = 'insufficient_privilege';
  end if;
  if v_message is null or v_message = '' then
    raise exception 'Escribe tu pregunta' using errcode = 'check_violation';
  end if;
  if length(v_message) > 2000 then
    raise exception 'La pregunta es muy larga (máximo 2000 caracteres)' using errcode = 'check_violation';
  end if;

  if v_conv is not null and not exists (select 1 from public.beto_conversations c
                    where c.id = v_conv and c.tenant_id = v_tenant and c.user_id = v_user and c.deleted_at is null) then
    raise exception 'Conversación no encontrada' using errcode = 'no_data_found';
  end if;

  -- Una pregunta a la vez por negocio para que la cuota no se pase.
  perform pg_advisory_xact_lock(hashtext('beto:' || v_tenant::text));
  v_usage := app.beto_usage();
  if (v_usage ->> 'used')::integer >= (v_usage ->> 'limit')::integer then
    raise exception 'Ya usaste las % preguntas de [B]eto de este mes. Escríbenos para ampliarlo.', v_usage ->> 'limit'
      using errcode = 'check_violation';
  end if;
  if (select count(*) from public.beto_messages m
      where m.tenant_id = v_tenant and m.user_id = v_user and m.role = 'assistant'
        and m.created_at > now() - interval '1 minute') >= 6 then
    raise exception 'Vas muy rápido. Espera un minuto y vuelve a preguntar.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.beto_messages m
             where m.tenant_id = v_tenant and m.user_id = v_user and m.status = 'pendiente'
               and m.created_at > now() - interval '3 minutes') then
    raise exception '[B]eto todavía está respondiendo tu pregunta anterior' using errcode = 'check_violation';
  end if;

  if v_conv is null then
    insert into public.beto_conversations (tenant_id, user_id, title)
    values (v_tenant, v_user, left(regexp_replace(v_message, '\s+', ' ', 'g'), 80))
    returning id into v_conv;
  end if;

  -- Historial reciente (las respuestas fallidas o pendientes no van).
  select coalesce(jsonb_agg(jsonb_build_object('role', h.role, 'content', h.content) order by h.created_at), '[]'::jsonb)
  into v_history
  from (
    select m.role, m.content, m.created_at from public.beto_messages m
    where m.conversation_id = v_conv and m.status = 'listo'
    order by m.created_at desc
    limit 12
  ) h;

  -- clock_timestamp: la pregunta queda antes que su respuesta aunque sea la misma transacción.
  insert into public.beto_messages (tenant_id, conversation_id, user_id, role, content, created_at)
  values (v_tenant, v_conv, v_user, 'user', v_message, clock_timestamp());
  insert into public.beto_messages (tenant_id, conversation_id, user_id, role, status, created_at)
  values (v_tenant, v_conv, v_user, 'assistant', 'pendiente', clock_timestamp())
  returning id into v_id;
  update public.beto_conversations set updated_at = now() where id = v_conv;

  select * into t from public.tenants where id = v_tenant;
  return jsonb_build_object(
    'conversation_id', v_conv,
    'message_id', v_id,
    'history', v_history,
    'today', v_today,
    'tenant_name', t.name,
    'base_currency', t.base_currency,
    'local_currency', t.local_currency,
    'rate', app.rate_on_day(v_tenant, v_today),
    'role', (select tm.role from public.tenant_members tm where tm.tenant_id = v_tenant and tm.user_id = v_user),
    'can', jsonb_build_object(
      'reportes', app.has_capability(v_tenant, 'reportes.ver') and coalesce((app.entitled(v_tenant, 'reportes'))::boolean, false),
      'finanzas', app.has_capability(v_tenant, 'finanzas.operar')
    )
  );
end;
$$;
revoke all on function app.beto_start(uuid, text) from public;
grant execute on function app.beto_start(uuid, text) to authenticated;
