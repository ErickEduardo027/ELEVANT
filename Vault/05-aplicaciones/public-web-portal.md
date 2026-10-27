---
id: aplicaciones-public-web-portal
title: "Public Web y portal de aerolíneas"
type: architecture
area: public-web
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-26"
verified_commit: "83ce325f99fea54879649f92ae1a231637a1bc2d"
sources:
  - AGENTS.md
  - frontend/AGENTS.md
  - frontend/public-web/AGENTS.md
  - frontend/public-web/README.md
  - frontend/public-web/package.json
  - frontend/public-web/src/components/auth/AirlineSessionProvider.tsx
  - frontend/public-web/src/components/auth/AuthExperience.tsx
  - frontend/public-web/src/components/portal/PortalGuard.tsx
  - frontend/public-web/src/components/portal/PortalShell.tsx
  - frontend/public-web/src/components/portal/AirlinePortalPage.tsx
  - frontend/public-web/src/components/portal/AirlineFinancePage.tsx
  - frontend/public-web/src/components/portal/AirlineDocumentsPage.tsx
  - frontend/public-web/src/components/portal/AirlineReportsPage.tsx
  - frontend/public-web/src/components/portal/AirlineContractPage.tsx
  - frontend/public-web/src/lib/elevant-api.ts
  - frontend/public-web/tests/e2e/auth.spec.ts
  - frontend/public-web/tests/e2e/portal.spec.ts
  - frontend/public-web/tests/unit/real-airline-contracts.test.tsx
  - frontend/public-web/tests/unit/airline-portal-page.test.tsx
  - backend/Elevant.Api/Controllers/AirlinePortalController.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfAirlinePortalReadStore.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs
  - packages/api-client/src/client.ts
  - packages/api-client/openapi/elevant-v1.json
tags:
  - aplicaciones
  - public-web
  - portal
  - nextjs
  - tenancy
---

# Public Web y portal de aerolíneas

> [!NOTE]
> La revisión docente de octubre de 2026 cambió validaciones, permisos, notificaciones y otros comportamientos descritos aquí. El estado actual de cada punto está en [Correcciones de la revisión docente](correcciones-revision-docente-2026-10.md).

> El commit de verificación del frontmatter corresponde a la base anterior.
> El historial, Finanzas y Documentos ya tienen código en la release #118;
> el snapshot de evidencia aprobada descrito más abajo pertenece a una rama
> posterior con pruebas locales. Ni esas pruebas ni esta nota demuestran su
> promoción al VPS o la aceptación del ciclo completo allí.
> La descarga financiera descrita abajo pertenece a otro tramo local posterior;
> tampoco se ha verificado en CI ni en el VPS.

Public Web combina la landing pública con el acceso de aerolíneas. En Development, la aerolínea entra desde `/login` y utiliza `/portal`; la antigua ruta separada `/dev-airline` fue retirada. El portal ya autentica y consulta un bootstrap real de la API, pero no es un portal operacional completo ni una capacidad de Production.

## Frontera y estado actual

| Parte | Comportamiento verificado en el repositorio |
| --- | --- |
| Identidad | `POST /api/v1/auth/session` emite la sesión; `GET /api/v1/auth/session` la revalida al recargar. El navegador comprueba el rol de aerolínea y la membresía correspondiente, pero la API sigue siendo la autoridad de autorización. |
| Contraseña temporal | El código permitido `password_change_required` conduce a `POST /api/v1/auth/password-change`; tras el cambio se requiere un inicio de sesión nuevo. |
| Tenant y estaciones | `GET /api/v1/airline/portal/bootstrap` deriva el tenant y la cobertura desde la sesión del servidor. El cliente no envía un ID de tenant elegido por el usuario. |
| Inicio, vuelos y perfil | Inicio y perfil muestran el contexto del bootstrap sin mezclar rotaciones EV del prototipo. Vuelos consulta `GET /api/v1/airline/portal/operations`, paginado y filtrado por aerolínea/contrato histórico en SQL. El detalle relee por ID una operación propia aunque no figure en el bootstrap. Esta rama posterior añade una lectura de servicios y tiempos de la entrega aprobada por OCC, sin notas internas ni identidades de agentes; aún no está promocionada. |
| Contratos | `GET /api/v1/airline/portal/contracts` deriva el tenant de la sesión y devuelve páginas de versiones publicadas (`Approved` o `Superseded`), estaciones y tarifas. El historial vencido continúa visible para la misma aerolínea; los borradores se consultan por una ruta separada con comentarios autorizados. Otros tenants no se exponen. |
| Solicitudes | En esta rama consulta `ops.OperationalServiceRequest` paginado y filtrado por aerolínea en la API; no confundir con la solicitud comercial pública. Crear/cancelar sigue deshabilitado. Aún no está promocionado. |
| Finanzas | En esta rama consulta prefacturas publicadas (`Submitted`, `Disputed`, `Accepted`, `Invoiced` o `Voided`) paginadas y filtradas por aerolínea en SQL. Puede releer por ID las líneas y montos snapshot de una prefactura propia; borradores y otros tenants no se exponen. Tras confirmación explícita puede aceptar una prefactura `Submitted` propia con un comando auditado e idempotente. Esta rama añade registro y consulta de disputas de líneas y de la resolución motivada por Finanzas. Una prefactura anulada queda visible solo como historial. Una prefactura `Invoiced` consulta su factura no fiscal congelada y, por otra ruta tenant-scoped, el estado persistido de un pago manual completo de prueba. Un aviso `airline_preinvoices` invalida la consulta; el sondeo de 25 segundos respalda la reconexión. No hay verificación bancaria ni documento fiscal; en el tramo local posterior, Documentos descarga un PDF no fiscal de factura y, si hay pago, de recibo. |
| Documentos y reportes | En el tramo local, Documentos consulta facturas propias ya emitidas y pagos registrados y descarga PDF privado por la API. Reportes muestra la primera página autorizada de operaciones y prefacturas publicadas, con conteos limitados a esas filas y enlaces al historial paginado; no calcula métricas globales. El PDF es no fiscal y no verifica fondos externos. Nada de este tramo está promocionado. |
| Solicitud de acceso | `/solicitar-acceso` usa catálogo y solicitud comerciales canónicos. No recoge contraseña ni crea cuenta; Contratos revisa y Superadministrador provisiona después. |

El JWT corto y su vencimiento se conservan en `sessionStorage` de la pestaña, no en `localStorage`. No existe opción «Recordarme». Al recargar, el cliente revalida identidad y bootstrap; al cerrar sesión, vencer el token o perder autorización, limpia el acceso. Un fallo transitorio permite reintentar sin presentar datos obsoletos como si fueran actuales. La comprobación del navegador no sustituye el enforcement del backend por tenant y estación.

> [!note] Rama `feat/finance-refinement`
> En Finanzas, los cargos aplicados por el agente y los ajustes de Finanzas aparecen como líneas propias bajo su servicio, con motivo, y se pueden disputar una a una. La factura muestra vencimiento, estado, saldo, pagos parciales y notas de crédito mediante `GET /api/v1/airline/portal/invoices/{id}/statement`. Sigue siendo no fiscal. Ver [Finanzas: tarifarios, cargos y cobros](../03-dominio/finanzas-tarifas-cargos-y-cobros.md).

## Recorrido y límites

```mermaid
flowchart LR
    L[Public Web /login] --> A[API: sesión y rol]
    A --> B[API: bootstrap de aerolínea]
    B --> R[Inicio y perfil reales]
    B --> H[API: historial de vuelos propios]
    H --> R
    B --> Q[API: solicitudes operativas propias]
    Q --> R
    B --> C[API: contratos publicados de su tenant]
    C --> R
    B --> F[API: prefacturas publicadas propias]
    F --> R
    B --> D[Documentos financieros propios por API]
    B --> P[Reportes acotados de operaciones y prefacturas propias]
```

Los antiguos componentes de `PortalWorkspace` siguen siendo fuentes de UX
prototípica; las rutas activas no montan ese repositorio mock ni
`PortalDemoPreview`. La rama de integración retira además el proveedor de
sesión mock del layout activo; `AirlineSessionProvider` queda como único
contexto de acceso. El login representa la verificación como pendiente antes
de autenticar, sin una ruta inventada ni un estado autenticado ficticio. Esto
es evidencia de código y pruebas locales, no de promoción al VPS. Fuentes:
[layout](../../frontend/public-web/src/app/layout.tsx),
[login](../../frontend/public-web/src/components/auth/AuthExperience.tsx) y
[prueba](../../frontend/public-web/tests/unit/real-airline-login.test.tsx).
Inicio muestra la ventana actual del bootstrap; Vuelos
carga el historial propio desde SQL, incluso después de vencer un contrato
que cubría la operación en su fecha, con vacío/error explícito. El detalle
se autoriza por tenant y operación exacta. La rama posterior consulta
`GET /api/v1/airline/portal/operations/{operationId}/approved-evidence`:
antes de aprobar muestra un vacío real; después muestra servicios y conteo
de incidencias congelados en la entrega aprobada, además de los tiempos
reales de la operación. El backend lee el snapshot de revisión para servicios
e incidencias, no las filas actuales que una corrección podría modificar.
No envía descripciones de incidentes, notas internas ni identidades de
agentes. Solicitudes carga la entidad operativa propia; un seed determinista
de Development la vincula a `DEV-TAT-0002`. Finanzas muestra prefacturas
publicadas propias y un vacío real si aún no existen; relee sus líneas
inmutables con autorización por tenant. Los borradores internos no se hacen
visibles hasta un envío auditado. El feed solo indica releer por HTTP, sin
importes ni líneas. Documentos relee facturas y pagos propios antes de
ofrecer PDF privado. Reportes comunica el límite de cobertura de sus
primeras páginas. Los comentarios de borrador de Contratos no activan
unilateralmente un contrato. Otras evidencias operativas y escrituras de
solicitudes siguen pendientes.

En la rama de integración, una invalidación financiera conserva la selección de la
prefactura en Finanzas y el panel expandido en Documentos, incluso tras
volver de una página posterior a la primera, mientras relee factura y pago
por las rutas autorizadas. Si la relectura falla, la vista
retira el detalle anterior y presenta un error recuperable. Esto evita que
un sondeo periódico cierre la confirmación o el panel de descarga; una
descarga iniciada durante la revalidación puede requerir reintento. Tampoco
demuestra por sí solo la disponibilidad del objeto PDF en el VPS. Fuentes:
[vista financiera](../../frontend/public-web/src/components/portal/AirlineFinancePage.tsx),
[Documentos](../../frontend/public-web/src/components/portal/AirlineDocumentsPage.tsx)
y [prueba de regresión](../../frontend/public-web/tests/unit/airline-portal-page.test.tsx).

En la rama de integración aún no promocionada, la aerolínea también puede
registrar una disputa persistente e idempotente de líneas de una prefactura
`Submitted` propia. Un endpoint **nuevo** de lectura por tenant devuelve el
historial de objeciones, y Finanzas tiene otro endpoint de lectura por cuenta y
estación. Los detalles v1 existentes conservan su forma para permitir una
promoción API-primero con clientes antiguos. Las pruebas locales de API, SQL y
clientes respaldan este cambio de rama, pero no demuestran CI, merge ni VPS.
La rama local incorpora la resolución de Finanzas: mantener devuelve la
prefactura a `Submitted` y anular conserva un historial consultable sin
habilitar nuevas acciones sobre ese documento. El cliente nuevo solicita
`includeVoided=true` para ese historial y `includeResolutions=true` para leer
decisión y motivo; la respuesta por defecto preserva los estados y campos que
aceptan los clientes ya desplegados. La aerolínea no escoge el resultado.
El PDF de recibo de este tramo local se ofrece únicamente cuando existe un
pago manual persistido. La API revalida la cuenta después de leer el objeto
privado; un objeto faltante o alterado produce error recuperable, no datos de
otro tenant. Es un recibo **no fiscal** del registro manual, no una prueba de
transferencia bancaria. La migración y rutas aún no están en Development remoto.
Esta rama ya permite
consultar un pago manual existente por la factura propia; el endpoint devuelve
un vacío real cuando no hay registro y no verifica fondos externos. Fuentes:
[controlador de aerolínea](../../backend/Elevant.Api/Controllers/AirlinePortalController.cs),
[persistencia de disputas](../../database/DevelopmentDB/Elevant.Persistence/Commercial/EfAirlinePreinvoiceDisputeStore.cs)
y [cliente compartido](../../packages/api-client/src/client.ts).

## Layout responsive

La escala de breakpoints es mobile-first en rem (40, 48, 64, 80 y 90 rem) y
ahora también la usa `/solicitar-acceso`, que en tablet se presenta en una sola
columna. El contenido del portal es un contenedor CSS (`container: portal`): las
métricas, las líneas de tarifa y prefactura y los encabezados responden al
ancho disponible junto al sidebar, no al del viewport
([estilos](../../frontend/public-web/src/components/portal/AirlinePortalPage.module.css)).
La navegación inferior del portal se mantiene hasta 64 rem. El héroe 3D elige
la calidad LITE en teléfonos, tablets y equipos o redes limitados.

Playwright añade proyectos de 360, 1024 y 1920 px que repiten las
comprobaciones de desbordamiento con un
[detector de elementos fuera del viewport](../../frontend/public-web/tests/e2e/layout.ts).
Las specs del portal dependen de un stub de API incompleto y ya fallaban antes
de este cambio; CI no ejecuta e2e.

## Desarrollo y evidencia

`NEXT_PUBLIC_ELEVANT_API_URL` configura el cliente compartido en el bundle y nunca puede contener secretos. Los orígenes locales deben estar admitidos por CORS en Development; Tailscale limita alcance de red pero no sustituye autenticación. El navegador no accede a SQL Server ni a proveedores externos directamente.

Las pruebas del cliente API validan el código de error permitido sin exponer cuerpos crudos. Public Web prueba sesión, caducidad, roles, contrato consultable, historial de vuelos, vistas previas inactivas y 404 de `/dev-airline` con Vitest y Playwright en escritorio, tablet y móvil. Las pruebas SQL verifican paginación, contratos y operaciones propios tras vencimiento, exclusión de otra aerolínea y de borradores. La evidencia de navegador usa respuestas simuladas; por sí sola **no demuestra** promoción ni funcionamiento de las seis cuentas reales en el VPS. El historial descrito aquí pertenece a la rama de integración y requiere CI, merge y promoción antes de ser estado remoto.

Fuentes principales: [README de Public Web](../../frontend/public-web/README.md), [proveedor de sesión](../../frontend/public-web/src/components/auth/AirlineSessionProvider.tsx), [vista del portal](../../frontend/public-web/src/components/portal/AirlinePortalPage.tsx), [cliente API](../../packages/api-client/src/client.ts) y [contrato OpenAPI](../../packages/api-client/openapi/elevant-v1.json).
