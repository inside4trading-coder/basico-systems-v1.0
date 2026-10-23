# B Systems (Basico Systems v1.0)

Sistema en la nube para PyMEs de Venezuela: **punto de venta, inventario, administración y reportes**,
multi-tenant, con **bimoneda** (USD como base y bolívares a tasa BCV), que sigue vendiendo **sin conexión**.

Cada negocio (tenant) tiene sus datos aislados, sus sedes y cajas, su equipo con permisos por rol y los
módulos de su plan. Se da de alta con un enlace que genera la plataforma.

- Reglas del proyecto y de la marca: [`CLAUDE.md`](CLAUDE.md)
- Stack: Vite + React + TypeScript (strict) + Tailwind + shadcn/ui + TanStack Query + Supabase
  (Postgres con RLS, Auth y Edge Functions). Despliegue del front en Vercel.

## Qué incluye

| Área | Qué hace |
|---|---|
| **Punto de venta** | Cajas y sesiones, cajero por sesión, cuadrícula de más vendidos, escaneo con pistola o cámara, descuentos por línea y del carrito (monto o %), cupones, notas, conceptos manuales, carritos en espera, devoluciones, cierre de caja con conteo. Cobro mixto con varios métodos y monedas (Bs y REF), IGTF, vuelto, nota de entrega térmica (58/80 mm). Pantalla completa con «Salir del POS». |
| **Sin conexión** | La app abre sin red (service worker), el catálogo y la tasa se guardan localmente y las ventas se encolan con una clave de idempotencia: al volver la red se registran una sola vez. El carrito y el cobro a medias sobreviven a recargar o a un apagón. |
| **Inventario** | Catálogo con variantes, códigos, atributos propios y fotos; entradas, recepción, ajustes con firma, traslados, conteos físicos, mínimos y reposición, mermas; importar y exportar desde Excel o CSV con vista previa. |
| **Administración** | Cuentas, movimientos, transferencias, categorías, obligaciones y vencimientos, cuentas por cobrar, conciliación bancaria (importa estados de cuenta), comprobantes. |
| **Cashea** | Módulo de financiamiento: operaciones y cuotas, importar archivos de órdenes y de pagos, conciliación de lo que paga la financiadora. Se activa por negocio. |
| **Reportes** | Ventas, inventario (salud del stock con clasificación ABC), cierres de caja, IVA del periodo (débito fiscal por tasa, restando devoluciones) y resultado. |
| **Clientes** | Ficha de clientes que se llena desde el cobro. |
| **Fichaje** (complemento) | Marcas de entrada y salida desde el teléfono con PIN personal y ubicación opcional, horarios, incidencias y métricas. |
| **Estudio de IA** (complemento) | Fotos de producto generadas con IA, por sets, con cuota mensual. |
| **Equipo y permisos** | Roles dueño, administrador, encargado y cajero. Matriz de **permisos por rol** editable por el dueño; la base de datos la hace cumplir. |
| **Alta de negocios** | Enlaces de alta que crea la plataforma (módulos, cupos y días de prueba), asistente de primeros pasos y panel de **Plataforma** para suspender, reactivar y extender pruebas. |
| **Navegación** | Menú lateral de dos niveles (módulos y submódulos) y menú completo en el teléfono. |

## Arquitectura

```
src/
  core/        sesión, tenant activo, permisos (capabilities), planes (entitlements),
               dinero, offline, escáner
  components/  AppShell, menú lateral, marca, UI (shadcn)
  modules/     pos · inventory · finance · financing · reports · settings · clock ·
               studio · customers · home · onboarding
  pages/       Login, restablecer contraseña, alta, plataforma, equipo, términos y privacidad
supabase/
  migrations/  una migración por cambio, en orden cronológico
  functions/   Edge Functions (Deno)
  tests/       pgTAP: aislamiento entre tenants y la lógica de cada módulo
```

Ideas que recorren todo el código:

- **Aislamiento por tenant.** Toda tabla de negocio lleva `tenant_id` y RLS. El negocio activo viaja en el
  header `x-tenant-id` y la base lo valida contra la membresía (`app.current_tenant_id()`). Un negocio
  suspendido no tiene negocio activo: no lee ni escribe datos.
- **Lógica en la base.** Los cálculos sensibles (precios, tasas, totales, numeración, permisos) viven en
  funciones `app.*` (`SECURITY DEFINER`, `search_path=''`) y se exponen por funciones `public.*` delgadas. El
  navegador no decide montos.
- **Roles, permisos y planes son cosas distintas.** El rol está en `tenant_members`. Los permisos por rol
  están en `role_capabilities` (solo excepciones; los valores por defecto viven en
  `app.capability_defaults()` y en `src/core/capabilities.ts`, y un test compara ambos). Los módulos y cupos del
  plan están en `tenant_entitlements` (por defecto en código; la tabla guarda excepciones).
- **Dinero.** Base en USD (REF) más la moneda local; cada pago guarda su moneda, su monto, su monto en base y
  la tasa usada. La tasa BCV se sincroniza sola (Edge Function `exchange-rate-sync`) y el negocio puede fijar una propia.
- **Borrado lógico** (`deleted_at`) en tablas de negocio, y cuotas numéricas impuestas con triggers.
- **Ningún rubro en el código.** Lo específico de un tipo de negocio es configuración (atributos, códigos,
  plantillas), no pantallas ni columnas.

## Edge Functions

| Función | Para qué |
|---|---|
| `exchange-rate-sync` | Consulta la tasa del BCV (con respaldo) y la guarda. |
| `invite-member` | Invita a una persona al equipo por correo; comprueba el permiso con la sesión de quien llama. |
| `onboarding-signup` | Crea la cuenta de quien abre un enlace de alta válido (sin sesión; verify_jwt desactivado). |
| `studio-generate` | Genera imágenes del Estudio de IA con OpenRouter. |

Secretos (se cargan en Supabase → Edge Functions → Secrets, nunca en el repo ni en Vercel):

| Secreto | Uso |
|---|---|
| `APP_URL` | Dirección de la app a la que vuelven los correos de invitación. |
| `OPENROUTER_API_KEY` | Estudio de IA. Sin ella, la generación responde que no está configurada. |
| `STUDIO_IMAGE_MODEL` | Opcional: modelo de imágenes. |

## Desarrollo

Requisitos: Node 22 y, para la base local, Docker.

```bash
npm install
cp .env.example .env.local   # URL y clave publicable del proyecto Supabase
npm run dev -- --port 8092   # http://localhost:8092
```

Solo se usan claves publicables en el front. Nunca pongas claves secretas ni de servicio en variables `VITE_*`
ni en Vercel.

### Base de datos local

```bash
npx supabase start       # Supabase local completo (auth, API, Studio en :54323)
npx supabase db reset    # aplica todas las migraciones desde cero
npm run test:db          # tests pgTAP de supabase/tests
```

Para que `npm run dev` use el Supabase local, crea `.env.development.local` (ignorado por git) con
`VITE_SUPABASE_URL=http://127.0.0.1:54321` y la `PUBLISHABLE_KEY` que imprime `npx supabase status`.
Los correos locales (restablecer contraseña, invitaciones) se leen en Mailpit: `http://127.0.0.1:54324`.

Con el registro abierto cerrado (`enable_signup = false`), una cuenta nueva se crea de tres maneras: invitando
desde Equipo, con un enlace de alta (`/plataforma` → «Enlaces de alta», que necesita un usuario en
`app.platform_admins`) o directamente por la API de administración de Auth.

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (puerto 8080 por defecto; usa `-- --port 8092` para que coincida con las redirecciones de Auth local). |
| `npm run typecheck` | TypeScript estricto. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest (lógica de carrito, dinero, permisos, menú, importación…). |
| `npm run build` | Build de producción. |
| `npm run test:db` | pgTAP contra el Supabase local. |

Antes de abrir un PR: `npm run typecheck && npm run lint && npm test && npm run build`, y `npm run test:db`
si tocas la base.

## Pruebas y CI

`.github/workflows/ci.yml` corre en cada PR dos trabajos y `main` exige que ambos pasen:

- **app:** typecheck, lint, build y vitest.
- **db:** aplica `supabase/migrations` desde cero y corre pgTAP. El test de aislamiento comprueba que toda
  tabla pública tiene RLS y `tenant_id`, que `anon` no tiene acceso a datos de negocio y que un negocio no
  ve ni escribe en otro. Cada tabla nueva se siembra en `supabase/tests/tenant_isolation.test.sql`.

## Migraciones y despliegue

- Una migración por cambio en `supabase/migrations/` (`AAAAMMDDHHMMSS_nombre.sql`). Se prueban con
  `supabase db reset` y se aplican a producción con la CLI o el MCP de Supabase con el contenido exacto del
  repo; después se revisan los avisos de Supabase (`get_advisors`) y se comparan las funciones contra local.
- Las Edge Functions se despliegan por separado (`supabase functions deploy`). `onboarding-signup` va con
  `verify_jwt = false`; el resto, con verificación.
- El front se despliega en Vercel desde `main` (`vercel.json` reescribe a `index.html` y añade cabeceras de
  seguridad). Variables públicas: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Alta de un negocio nuevo

1. Un administrador de plataforma abre **Plataforma** y crea un **enlace de alta**: etiqueta, hasta 5 correos con su
   rol (dueño o administrador, opcional), complementos, cupos, días de prueba y validez.
2. Un dueño de la lista abre `/alta/<código>`, acepta los términos y la privacidad y crea su cuenta y su negocio. Los
   demás correos abren el mismo enlace después y entran al negocio con su rol.
3. El **asistente de primeros pasos** (`/bienvenida`) guía los datos del negocio y la tasa, los productos y el equipo.
4. Desde Plataforma se ve el estado de cada negocio, y se puede suspender, reactivar o extender la prueba.

Cada enlace crea un solo negocio. Con correos, solo sirve para los de su lista; sin correos, cualquiera lo usa una vez.

## Alcance fiscal

El sistema emite **notas de entrega**, no facturas fiscales: no sustituye a una máquina fiscal ni a una imprenta
digital autorizada. El reporte de IVA es una ayuda para el contador. Los textos legales están en `/terminos`
y `/privacidad`.

## Contribuir

- Un PR por bloque de trabajo; CI en verde antes de fusionar.
- Commits y PRs no incluyen datos de clientes, estrategia ni credenciales (el repo es público).
- Lee [`CLAUDE.md`](CLAUDE.md) para las reglas del proyecto y la guía de marca.
