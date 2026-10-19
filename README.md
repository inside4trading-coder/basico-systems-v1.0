# Basico Systems v1.0

POS, inventario, administración y reportes para PyMEs en Venezuela, multi-tenant.

- Reglas del proyecto y de marca: [`CLAUDE.md`](CLAUDE.md)

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar con el proyecto Supabase de v1.0
npm run dev
```

Verificación: `npm run typecheck && npm run build && npm test`.

Base de datos local (requiere Docker):

```bash
npx supabase start      # Supabase local completo (auth, API, Studio en :54323)
npm run test:db         # tests pgTAP de supabase/tests
```

Para que `npm run dev` use el Supabase local y no el de producción, crea
`.env.development.local` (ignorado por git) con `VITE_SUPABASE_URL=http://127.0.0.1:54321`
y la `PUBLISHABLE_KEY` que imprime `npx supabase status`. Los enlaces de acceso locales
se leen en Mailpit (`http://127.0.0.1:54324`).

CI (`.github/workflows/ci.yml`) corre las dos cosas en cada PR; `main` exige que pasen.

Stack: Vite + React + TypeScript (strict) + Tailwind + shadcn/ui + Supabase + TanStack Query.
