-- pg_net en el esquema extensions, no en public (aviso extension_in_public de
-- Supabase). pg_net no admite ALTER EXTENSION ... SET SCHEMA: se recrea. Sus
-- funciones siguen en el esquema net, así que app.request_rate_sync no cambia.
-- Se pierden solo las respuestas guardadas de peticiones anteriores.

drop extension if exists pg_net;
create extension pg_net with schema extensions;
