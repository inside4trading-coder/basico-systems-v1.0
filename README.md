# Basico Systems v1.0

POS, inventario, administración y reportes para PyMEs en Venezuela, multi-tenant.

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Reglas del proyecto y de marca: [`CLAUDE.md`](CLAUDE.md)

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar con el proyecto Supabase de v1.0
npm run dev
```

Verificación: `npm run typecheck && npm run build && npm test`.

Stack: Vite + React + TypeScript (strict) + Tailwind + shadcn/ui + Supabase + TanStack Query.
