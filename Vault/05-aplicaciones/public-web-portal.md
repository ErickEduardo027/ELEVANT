---
id: aplicaciones-public-web-portal
title: "Public Web y portal de aerolíneas"
type: architecture
area: public-web
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "29600f562e82092b4341ff4c1696171037b51593"
sources:
  - frontend/AGENTS.md
  - frontend/public-web/AGENTS.md
  - frontend/public-web/README.md
  - frontend/public-web/package.json
  - frontend/public-web/src/components/auth/MockSessionProvider.tsx
  - frontend/public-web/src/components/portal/PortalWorkspace.tsx
  - frontend/public-web/src/lib/prototype-requests.ts
  - frontend/public-web/src/lib/elevant-api.ts
tags:
  - aplicaciones
  - public-web
  - portal
  - nextjs
  - tenancy
---

# Public Web y portal de aerolíneas

Public Web reúne una landing pública y un portal para clientes/aerolíneas. La experiencia es ejecutable, pero su sesión, afiliación, autorización y la mayoría de los datos siguen siendo demostrativos. Ningún aislamiento implementado solo en el navegador debe interpretarse como seguridad multi-tenant.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Audiencias | Visitantes interesados en ELEVANT y usuarios de aerolíneas/clientes dentro del portal. |
| Responsabilidad UI | Marketing, solicitud de demo, acceso al portal, consulta tenant-scoped y acciones expresamente permitidas. |
| Autoridad real | La API debe derivar organización y estaciones desde la membresía autenticada. |
| Escrituras objetivo | Solicitudes de servicio y respuestas financieras autorizadas; no edición libre de historia operacional o tarifas. |
| Madurez | Landing y portal amplios, ejecutables sobre mocks/adaptadores prototípicos; integración segura pendiente. |

## Stack actual

- Next.js 16 con App Router y salida `standalone` prevista por la aplicación.
- React y React DOM 19.
- TypeScript 6.
- Three.js para la experiencia gráfica adaptable del marketing.
- `pdf-lib` para documentos de demostración generados en cliente.
- `@elevant/api-client` como dependencia local compartida.
- ESLint, Vitest/Testing Library/jsdom y Playwright/axe para calidad y E2E.

Las versiones exactas y el mínimo de Node viven en [`package.json`](../../frontend/public-web/package.json). Antes de modificar código Next, también es obligatorio leer el `AGENTS.md` local y la documentación instalada de esa versión.

## Estructura útil para desarrollar

| Ruta | Responsabilidad observada |
| --- | --- |
| `src/app/` | Rutas App Router, layouts, loading/error boundaries y health técnico. |
| `src/components/marketing/` | Landing, navegación, movimiento y formulario de demo. |
| `src/components/auth/` | Sesión y afiliación mock. |
| `src/components/portal/` | Shell, guard, workspace y vistas del portal. |
| `src/lib/portal/` | Tipos, fixtures, reglas/proyecciones de demostración y repositorio mock. |
| `src/lib/elevant-api.ts` | Fábrica aislada del cliente OpenAPI compartido. |
| `src/lib/prototype-requests.ts` | Adaptador temporal para solicitudes contra endpoints heredados. |
| `tests/unit/`, `tests/e2e/` | Pruebas unitarias y recorridos de navegador. |

## Rutas observadas

| Ruta | Experiencia actual |
| --- | --- |
| `/` | Landing, propuesta comercial y formulario de solicitud de demo. |
| `/login` | Inicio de sesión y solicitud de afiliación demostrativos. |
| `/portal` | Resumen, indicadores y actividad del portal mock. |
| `/portal/vuelos` | Búsqueda/filtrado de vuelos o rotaciones. |
| `/portal/vuelos/[operationId]` | Detalle, servicios, línea de tiempo, incidencias y documentos. |
| `/portal/solicitudes` | Crear, listar y cancelar solicitudes mediante el adaptador prototípico. |
| `/portal/contratos` | Consulta de contratos, vigencia, estaciones y tarifas. |
| `/portal/documentos` | Consulta/descarga de documentos demostrativos autorizados por el repositorio local. |
| `/portal/finanzas` | Prefacturas, facturas, conciliaciones, disputas y reclamos de demostración. |
| `/portal/reportes` | Indicadores y exportaciones. |
| `/portal/perfil` | Organización, estaciones, permisos y auditoría representados en el prototipo. |
| `/health` | Respuesta técnica propia de la web; no consulta API ni SQL. |

## Estado de los recorridos

### Landing

El formulario de demo valida y normaliza el borrador, pero el modo actual no lo transmite ni lo persiste. Esta decisión evita convertir datos introducidos en un canal no configurado. La solicitud de afiliación sí intenta un endpoint heredado después de guardar su modelo mock local; si no existe, informa que el endpoint de Development aún no está disponible.

### Sesión

`MockSessionProvider` utiliza `MockAuthGateway` y storage del navegador. Es una experiencia de UX, no autenticación de la API. La separación local por aerolínea en el repositorio mock ayuda a probar la interfaz, pero no prueba aislamiento entre tenants.

### Portal

`PortalWorkspace` crea un `MockPortalRepository` con fixtures deterministas y ejecuta allí consultas y mutaciones demostrativas. Vuelos, contratos, documentos, finanzas, notificaciones y auditoría mostrados por esa capa no son respuestas del backend .NET. Solicitudes usa un adaptador remoto prototípico separado, cuyas rutas todavía no forman parte de OpenAPI.

## Integración con API

| Capa | Actual | Objetivo |
| --- | --- | --- |
| Cliente generado | Existe `createPublicWebApiClient` sobre `@elevant/api-client`. | Usarlo desde adaptadores remotos por request/contexto, con token suministrado de forma segura. |
| Contrato disponible | El snapshot compartido solo contiene `system/ping`. | Agregar endpoints versionados y tenant-scoped antes de migrar cada módulo. |
| Autenticación | Mock en navegador. | Sesión emitida/validada por servidor y autorización en cada caso de uso. |
| Datos del portal | Repositorio local con fixtures; solicitudes tienen llamadas heredadas. | REST como estado canónico y errores Problem Details saneados. |

## Desarrollo local

Desde `frontend/public-web`:

```powershell
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Para E2E, instala los navegadores de Playwright según la versión incluida y ejecuta:

```powershell
npm run test:e2e
```

## Pruebas que posee

- unitarias de sesión/afiliación mock, dominio/repositorio del portal, documentos, gráficos, formulario demo y cliente API;
- validaciones del entorno de Development y configuración de seguridad de Next;
- prueba de la ruta `/health`;
- E2E de marketing, autenticación, portal, accesibilidad y calidad.

Estas pruebas certifican la experiencia implementada y sus límites mock; no sustituyen pruebas de autorización multi-tenant en la API.

## Configuración segura

- `NEXT_PUBLIC_SITE_URL` identifica el origen público del sitio.
- `NEXT_PUBLIC_ELEVANT_API_URL` configura el cliente OpenAPI.
- `NEXT_PUBLIC_PROTOTYPE_API_URL` mantiene el adaptador heredado durante la migración.
- `NEXT_PUBLIC_DEMO_FORM_MODE` controla el modo no transmisor documentado.
- Todo `NEXT_PUBLIC_*` se incorpora al bundle y nunca contiene secretos.
- En Development certificado, las dos URLs de API deben representar el mismo origen HTTPS; no hay fallback a `localhost` para el navegador desplegado.

Usa [`.env.example`](../../frontend/public-web/.env.example) con dominios de prueba/autorizados. Nunca copies valores privados al Vault.

## Límites obligatorios

- El cliente no elige un tenant confiable: la API deriva organización desde membresía y valida estación.
- El portal no modifica vuelos, ejecución histórica, tarifas contractuales ni auditoría.
- Ocultar controles, separar claves de storage o comprobar un permiso mock no autoriza una operación.
- El navegador no se conecta a SQL Server, proveedores externos ni secretos del servidor.
- Tipos y fixtures de `src/lib/portal` no son DTOs públicos ni modelo EF.

## Brechas y desconocidos

- **Brecha actual:** falta autenticación real y enforcement de tenant/estación en endpoints de negocio.
- **Brecha actual:** casi todos los módulos dependen de fixtures; solicitudes usa rutas heredadas no incluidas en OpenAPI.
- **Brecha actual:** el formulario comercial no tiene canal de backend aprobado.
- **Brecha actual:** documentos reales requieren almacenamiento, autorización y retención todavía no implementados.
- **Desconocido:** proveedor de identidad, proceso final de afiliación y permisos exactos por tipo de usuario.
- **Desconocido:** qué subconjunto de reportes/exportaciones será contractual en la primera versión integrada.

## Fuentes y relaciones

- [README del cliente](../../frontend/public-web/README.md)
- [Workspace mock](../../frontend/public-web/src/components/portal/PortalWorkspace.tsx)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)
