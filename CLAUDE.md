# Basico Systems v1.0

SaaS multi-tenant de POS, inventario, administración y reportes para PyMEs en Venezuela
(bimoneda USD/VES con tasa BCV). El plan vivo está en `docs/PLAN.md`; el plan de arranque
original, en `docs/plan-original.md`.

## Reglas que no se rompen

- **Toda tabla de negocio lleva `tenant_id`** con la policy `tenant_isolation`, y el test de
  aislamiento (`supabase/tests`) tiene que pasar. Una tabla global se marca como tal a propósito.
- **Ningún rubro entra al código.** Lo que distingue a una tienda de repuestos de una de ropa es
  configuración del tenant (atributos, tipos de código, listas de precio, plantilla de rubro), nunca
  columnas ni pantallas propias. Lo que no cabe en configuración se evalúa como función para todos o
  no se hace.
- **Montos:** base en USD (REF) + moneda local; cada pago guarda `currency`, `amount`, `amount_base`
  y la tasa usada. Sin `_bs`/`_eur` en nombres de columna.
- **Cálculos sensibles en el servidor** (precios, tasas, totales, numeración): las RPC no confían en
  lo que manda el navegador.
- **Borrado lógico** (`deleted_at`) en tablas de negocio; nunca `DELETE` real.
- **Permisos de usuario ≠ entitlements del tenant.** Rol en `tenant_members`; módulos, funciones y
  cuotas en `tenant_entitlements` (defaults en código, la tabla guarda excepciones).
- Las cuotas numéricas se imponen con trigger `BEFORE INSERT`, no con RLS (service_role salta RLS).

## Código traído de `basicosystems`

Se porta por módulo desde `C:\Users\Windows\Basico System\basicosystems` (referencia `f551478b`).
Cada commit de port cita el origen: `port(pos): SublimePosApp desde basicosystems@f551478b`.
Orden: copiar → renombrar `sublime_*`/`_ref`/`_bs` a neutro → conectar a tenant y entitlements →
mover cálculos sensibles a RPC → test → commit. `basicosystems` no se modifica desde aquí.

## Verificación antes de commit

`npm run typecheck`, `npm run build`, `npm test`, y `npm run test:db` cuando haya Supabase local.

## Marca [B] SYSTEMS

- Lockup `[B] SYSTEMS` con `src/components/BrandMark.tsx`; bajo ~150px de ancho, solo el isotipo `[B]`.
  Espacio seguro: la altura del corchete por los cuatro lados.
- Tokens en `src/styles/tokens.css` (`--bsys-*`): azul `#0B37FF`, tinta `#0A0D12`, superficie `#FBFCFE`,
  niebla `#E2E8F0`. `#F0509B` solo para alertas. Máximo tres colores por pieza.
- Tipografía: Chakra Petch para display y texto, JetBrains Mono para datos y etiquetas (`.mono`,
  `.mono-cap`, `.num` para cifras tabulares).
- Radios 12px (controles) y 22px (superficies). Motion 240 / 160 / 400 ms con
  `cubic-bezier(.32,.72,0,1)`; respetar `prefers-reduced-motion`.
- Tono: directo, técnico, sin adornos. Español neutro venezolano (no es-ES).
