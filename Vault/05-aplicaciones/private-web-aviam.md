---
id: aplicaciones-private-web-aviam
title: "Private Web / AVIAM"
type: architecture
area: private-web
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-25"
verified_commit: "c37a6028cdd5f4e269358cf0e97c5190ef89d5d5"
sources:
  - frontend/AGENTS.md
  - frontend/private-web/README.md
  - frontend/private-web/package.json
  - frontend/private-web/src/app/router.jsx
  - frontend/private-web/src/features/auth/authService.js
  - frontend/private-web/src/features/admin-occ/navigation.js
  - frontend/private-web/src/features/human-resources/navigation.js
  - frontend/private-web/src/config/elevantApiClient.js
  - frontend/private-web/src/features/contracts/shell/ContractsShell.jsx
  - frontend/private-web/src/features/finance/shell/FinanceShell.jsx
  - frontend/private-web/src/services/financeHomeService.js
  - frontend/private-web/src/features/finance/preinvoices/PreinvoicesPage.jsx
  - frontend/private-web/src/features/flight-monitoring/components/FlightMap.jsx
  - frontend/private-web/src/features/positions-map/components/PositionMap.jsx
  - frontend/private-web/nginx/security-headers.conf
tags:
  - aplicaciones
  - private-web
  - aviam
  - react
  - prototipo
---

# Private Web / AVIAM

Private Web es la aplicación interna de AVIAM para OCC, administración y departamentos operativos. Su acceso usa la sesión real de la API de Development y algunas rutas OCC consumen contratos canónicos. Las pantallas prototípicas, objetos locales y rutas heredadas restantes no son autoridad de permisos, persistencia ni contrato HTTP.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Audiencias | OCC/administración, Gestión Humana, Contratos, Finanzas y otros departamentos internos representados por esos módulos. |
| Responsabilidad UI | Presentar vistas internas, capturar intenciones y manejar estados de interacción. |
| Autoridad real | Debe residir en la API para identidad, roles, station scope, reglas y datos. |
| Persistencia del cliente | La sesión del prototipo usa almacenamiento del navegador; no es una frontera de autorización. |
| Integración externa | El navegador no conecta directamente a SQL Server, FlightAware ni proveedores de datos aeronáuticos. Como excepción visual verificable, los mapas cargan estilos y teselas cartográficas públicas de MapLibre/OpenFreeMap permitidas explícitamente por CSP. |
| Madurez | Preview técnico ejecutable con cobertura de UI amplia e integración de negocio incompleta. |

## Stack actual

- Vite 6 y JavaScript/JSX como aplicación SPA.
- React 18 y React DOM 18.
- React Router 6 para rutas principales seleccionadas por el rol de la sesión; la API impone la autorización real.
- Tailwind CSS 3 y tokens CSS para presentación.
- MapLibre GL para vistas cartográficas.
- `@elevant/api-client` como dependencia local del monorepo.
- Vitest, Testing Library y jsdom para pruebas; Node test runner para la certificación local de entrega.

Las versiones efectivas se fijan en [`package.json`](../../frontend/private-web/package.json) y `package-lock.json`; esta nota no sustituye esos manifests.

## Estructura útil para desarrollar

| Ruta | Responsabilidad observada |
| --- | --- |
| `src/app/router.jsx` | Router principal, redirects, guards de navegación y composición por rol. |
| `src/features/` | Interfaces y comportamiento por área: auth, OCC, planificación, monitoreo, posiciones, revisión, reportes, notificaciones, chat, contratos, finanzas y Gestión Humana. |
| `src/services/` | Adaptadores de datos heredados y snapshots de prueba; no deben dictar el contrato futuro. |
| `src/config/elevantApiClient.js` | Fábrica aislada para el cliente OpenAPI compartido. |
| `src/components/`, `src/hooks/`, `src/lib/`, `src/styles/` | UI reutilizable, comportamiento transversal, utilidades y tokens. |
| `tests/` y pruebas junto a features | Configuración transversal, smoke del cliente compartido y pruebas unitarias/de componentes. |
| `dashboard.html`, `contracts.html`, `finance.html` | Entradas históricas redirigidas a las rutas actuales. |

## Rutas y recorridos observados

### Entrada y selección de área

- `/login` autentica contra la API de Development; las credenciales mock solo existen en pruebas automatizadas.
- El rol de la sesión redirige a `/admin-occ`, `/gestion-humana`, `/contratos` o `/finanzas`.
- Los guards del router organizan la navegación, pero no sustituyen la autorización del servidor.

### OCC / Administración

Bajo `/admin-occ` existen rutas para dashboard, planificación, monitoreo de vuelos, mapa de posiciones, revisión, reportes, notificaciones y chat. Las interfaces representan planificación y asignaciones, seguimiento de vuelos/turnarounds, contraste de ejecución, aprobación o devolución, cierre/reportes y coordinación interna.

En el worktree local de integración, el Dashboard OCC dejó de mostrar cifras sintéticas: consulta la planificación de la fecha UTC para una estación autorizada de la sesión, su cola de revisión y las notificaciones persistidas de la cuenta filtradas a esa estación. Expone conteos de las consultas acotadas, no totales históricos; al perder autorización o fallar una lectura, oculta los resultados previos. Revalida tras una señal durable de notificaciones, al recuperar foco o conexión y cada 25 segundos mientras la pestaña está visible. No implica una fuente aeronáutica externa ni acredita promoción al VPS. Fuentes: [adaptador del dashboard](../../frontend/private-web/src/services/dashboardService.js), [ruta](../../frontend/private-web/src/features/dashboard/DashboardRoute.jsx) y [vista](../../frontend/private-web/src/features/dashboard/DashboardPage.jsx).

Monitoreo OCC también selecciona una estación de la sesión. La lectura inicial y el refresco de 30 segundos consultan esa misma estación; el refresco reemplaza la lista completa y una falla retira los vuelos antiguos hasta recuperación o reintento. Las horas provienen de planificación; no se presentan coordenadas de aeronaves no verificadas. Solo PUJ tiene coordenadas cartográficas revisadas, por lo que otra estación no muestra un mapa de PUJ. Esto no acredita datos aeronáuticos en vivo ni promoción remota. Fuentes: [servicio de monitoreo](../../frontend/private-web/src/services/flightMonitoringService.js) y [ruta](../../frontend/private-web/src/features/flight-monitoring/FlightMonitoringRoute.jsx).

El Mapa de posiciones también usa la estación OCC seleccionada. En PUJ representa geometría local revisada y superpone únicamente asignaciones planificadas, sin inferir disponibilidad física. En otra estación muestra una lista de posiciones asignadas desde planificación, sin reutilizar coordenadas de PUJ; si no hay asignaciones, el vacío es explícito. Refresca el snapshot entero cada 30 segundos, oculta resultados previos ante fallos y conserva la estación al abrir un vuelo en Monitoreo. Faltan coordenadas y ocupación física verificadas de otras estaciones, así como prueba remota. Fuentes: [adaptador de posiciones](../../frontend/private-web/src/services/positionsMapService.js), [ruta](../../frontend/private-web/src/features/positions-map/PositionsMapRoute.jsx) y [vista](../../frontend/private-web/src/features/positions-map/PositionsMapPage.jsx).

En la rama de integración de Development, planificación incorpora el alta manual de una escala OCC. La pantalla obtiene de la API las aerolíneas con contrato vigente, aeropuertos y posiciones activas para una estación autorizada; envía llegada, salida, fecha, posición y un UUID de intención estable para un reintento ambiguo. La API vuelve a comprobar alcance, contrato, ruta y disponibilidad de posición. Crear una escala deja su operación planificada. OCC puede programar después un turno local para un agente cuyo único impedimento sea la cobertura; el panel refresca opciones y ETag antes de asignar. Ninguno de esos comandos factura ni demuestra por sí solo promoción o prueba de navegador contra el VPS.

### Gestión Humana

Bajo `/gestion-humana` existen dashboard, usuarios/cuentas, habilitaciones, permisos aeroportuarios, horarios/disponibilidad, reportes, auditoría y notificaciones. El código navega y prueba estas vistas, pero sus datos prototípicos no demuestran que la API ya gestione cuentas o permisos.

En el worktree local posterior a esta fotografía, el dashboard consulta los
perfiles de rampa autorizados de la API para contar agentes activos y perfiles
sin cuenta vinculada. Ya no presenta como hechos las cifras fijas del prototipo
para turnos, habilitaciones o cobertura. El modo restringido solo expone
dashboard, perfiles, habilitaciones, permisos y turnos de lectura; mantiene ocultas las rutas
profundas aún no integradas. Recibir una señal de cambio, recuperar
foco/conexión o cumplir 25 segundos provoca una nueva lectura. Esto no acredita
escritura de habilitaciones ni un despliegue al VPS. Fuentes:
[servicio](../../frontend/private-web/src/services/humanResourcesDashboardService.js),
[vista](../../frontend/private-web/src/features/human-resources/dashboard/DashboardPage.jsx)
y [perfiles autorizados](../../backend/Elevant.Api/Controllers/RampProfilesController.cs).

La lista activa de perfiles de rampa revalida el alcance autorizado mediante
señales durables, foco, reconexión y sondeo de 25 segundos. Si falla la lectura,
retira perfiles y formulario de edición anteriores sin exponer el error interno;
un guardado fallido conserva el formulario sin exponer trazas; las respuestas
tardías no pueden sobrescribir una consulta más reciente. Es un
cambio local de esta rama, no una prueba de despliegue remoto ni de los módulos
profundos de Gestión Humana. Fuente: [panel de perfiles](../../frontend/private-web/src/features/human-resources/users/RampProfilesPanel.jsx).

La API de esta rama agrega una lectura paginada de los ciclos actuales de
habilitación de rampa para Gestión Humana y Superadministración internas. La
ruta restringida de habilitaciones consulta esa API en páginas de 20, calcula
la vigencia por fechas y muestra un vacío o error sin reutilizar datos viejos;
no ofrece acciones prototípicas de alta o renovación. La vista heredada sigue
separada fuera del modo restringido. En este worktree el controlador ya expone
un `PUT` para registrar ciclos con identificador del ciclo actual esperado;
las garantías de persistencia se documentan en el README del backend. La pantalla sigue en solo lectura mientras
se conecta la captura; no se ha promocionado al VPS. Fuentes: [ruta de habilitaciones](../../frontend/private-web/src/features/human-resources/certifications/CurrentQualificationsPage.jsx), [lectura](../../frontend/private-web/src/services/humanResourcesQualificationsReadService.js) y [controlador](../../backend/Elevant.Api/Controllers/HumanResourcesQualificationsController.cs).

La API también ofrece ciclos actuales de carnet aeroportuario y licencia de
rampa, paginados y reservados a Gestión Humana o Superadministración internas.
La ruta restringida calcula vigencia a partir de fechas, revalida al volver a
foco/conexión y cada 25 segundos, y no permite renovaciones o archivos
simulados. El documento puede estar vencido aunque su ciclo siga marcado como
actual. Las escrituras y el historial de ciclos siguen pendientes. Fuentes:
[vista](../../frontend/private-web/src/features/human-resources/permits/CurrentPermitsPage.jsx),
[controlador](../../backend/Elevant.Api/Controllers/HumanResourcesPermitsController.cs)
y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesPermitReadStore.cs).

La ruta restringida de horarios lee turnos reales por semana local y páginas
de 20. Muestra agente, estación, terminal, posición y horas registradas, sin
inferir disponibilidad ni permitir programación desde Gestión Humana. Una
programación OCC emite la señal durable `hr_shifts`; la vista revalida también
por foco, reconexión y sondeo de 25 segundos, y oculta datos anteriores si
falla la lectura. Crear turnos y gestionar ausencias desde Gestión Humana aún
requiere contratos propios. Fuentes: [vista](../../frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.jsx), [controlador](../../backend/Elevant.Api/Controllers/HumanResourcesShiftsController.cs) y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesShiftReadStore.cs).

La ruta restringida de Reportes de personal combina las primeras 100
habilitaciones y permisos actuales con los primeros 100 turnos de la semana
local mediante las tres lecturas autorizadas. Es una muestra, no un total
histórico: permite abrir los módulos paginados, anuncia cuando una fuente tiene
más páginas, oculta la muestra anterior ante un error y no ofrece exportaciones
prototípicas. Revalida con señales durables, foco, reconexión y sondeo de 25
segundos. Es código del worktree local; aún faltan CI, navegador y promoción al
VPS. Fuentes: [vista de reportes](../../frontend/private-web/src/features/human-resources/reports/CurrentReportsPage.jsx)
y [router](../../frontend/private-web/src/app/router.jsx).

### Contratos y Finanzas

`/contratos` y `/finanzas` son shells protegidos que cambian módulos mediante estado interno, no rutas independientes para cada pestaña. Contratos presenta inicio, contratos, solicitudes, servicios pactados, reportes y comunicaciones. Finanzas presenta inicio, servicios aprobados, prefacturación, seguimiento, tarifas, reportes y comunicaciones. En el worktree local, Inicio de Finanzas combina lecturas autorizadas de servicios aprobados y prefacturas por estación: hasta 200 servicios de los últimos 30 días y la primera página de 50 prefacturas, no totales históricos. Reportes agrupa los estados de esa primera página por aerolínea y moneda, sin inventar importes ni exportaciones. Ambas vistas revalidan con cambio durable, foco y polling de 25 segundos. Tarifas consulta versiones contractuales publicadas y paginadas para una estación autorizada mediante `GET /api/v1/finance/tariffs`; conserva cuatro decimales y distingue versiones históricas. La activación de un contrato genera una pista durable `finance_tariffs` para Finanzas, con revalidación del alcance en el feed. Se retiró la acción local de «Programar cambio» que no persistía. Seguimiento consulta prefacturas aceptadas, facturas no fiscales y pagos manuales mediante `GET /api/v1/finance/reconciliation`, con revalidación por `finance_preinvoices`, foco y polling. No acredita conciliación bancaria y retiró la acción local «Conciliar». El buzón heredado está oculto para ambos roles, evitando `/api/notifications`. Nada de esto acredita despliegue al VPS. Fuentes: [servicio de inicio](../../frontend/private-web/src/services/financeHomeService.js), [servicio de reportes](../../frontend/private-web/src/services/financeReportsService.js), [vista de tarifas](../../frontend/private-web/src/features/finance/tariffs/TariffsPage.jsx), [vista de seguimiento](../../frontend/private-web/src/features/finance/reconciliation/ReconciliationPage.jsx), [controlador financiero](../../backend/Elevant.Api/Controllers/FinanceReconciliationController.cs) y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Finance/EfFinanceReconciliationReadStore.cs).

En esta rama, **Contratos**, **Servicios pactados** y **Reportes contractuales** comparten `GET /api/v1/contracts/agreements`, que lee versiones aprobadas y reemplazadas, estaciones y tarifas desde SQL con permiso comercial interno. La tabla diferencia los precios históricos y muestra cuatro decimales; los indicadores del reporte se limitan expresamente a la página consultada. Ya no se montan sus adaptadores `/api/contracts/*` ni botones de alta, edición y exportación auditada ficticia. La consulta no sustituye el flujo de borradores ni crea contratos; falta validación de navegador y promoción remota.

## Estado de integración

| Capa | Actual | Límite |
| --- | --- | --- |
| UI | Las rutas, componentes, filtros, formularios y estados son ejecutables. | Ejecutable no equivale a flujo de negocio integrado. |
| Autenticación | `authService.js` usa el cliente OpenAPI para crear y revalidar la sesión de Development; tests usan identidades sintéticas. | La sesión en el navegador no sustituye el enforcement del backend por rol y estación. |
| Datos de negocio | Planificación, revisión, chat y notificaciones operativas OCC usan contratos canónicos. Otros servicios combinan snapshots/fixtures y rutas heredadas. | Las formas mock no son OpenAPI vigente. |
| Cliente compartido | Existe una fábrica validada para `@elevant/api-client`. | Contratos y Finanzas todavía no migraron sus módulos profundos de forma general. |
| API real | El build de Development alinea ambas URLs públicas hacia el mismo origen de API. | Los módulos aún sintéticos no prueban endpoints financieros o contractuales; los adaptadores heredados pueden seguir fallando hasta su migración. |

En la rama de integración posterior al commit histórico de esta nota,
**Finanzas → Servicios aprobados** consume una nueva lectura canónica por
estación y período. Presenta importes de snapshots operativos y razones de
bloqueo, no cifras de fixtures; la antigua acción local «Marcar revisado» ya
no aparece. Revalida por feed durable, foco y polling acotado. El resto de
Finanzas puede crear y volver a consultar una prefactura interna no fiscal
desde los servicios elegibles. La selección se reconcilia cuando llega una
reserva de otro usuario y un reintento conserva su clave idempotente.
Conciliación externa sigue pendiente; el registro manual de pago se describe
abajo y no verifica una transferencia bancaria. No se ha
promovido esta rama al VPS.

**Finanzas → Pre-facturación** ahora lista por estación las prefacturas
persistidas mediante `GET /api/v1/finance/preinvoices` y abre su detalle
canónico. La lista exige el rol Finanzas, membresía interna y concesión de
estación vigente; revalida por feed, foco y polling. Ya no monta
`/api/finance/preinvoices` ni acciones locales de aprobar/enviar. En esta rama,
un borrador abierto ofrece confirmación explícita antes de enviarlo a la
aerolínea mediante el comando canónico. El identificador del borrador es la
clave estable de ese único envío, incluso si la respuesta de red es incierta;
la UI relee la lista autorizada sin exponer mensajes internos. Los badges
del shell no repiten cifras sintéticas. Inicio, Tarifas y Reportes ya tienen
lecturas acotadas de la API en esta rama; Seguimiento también consulta estados
financieros persistidos, pero no confirma conciliación bancaria.
No se ha promovido esta rama.

En la rama local, una prefactura `Accepted` presenta confirmación de emisión
no fiscal. La API congela la factura y Finanzas relee número, líneas y total
por una ruta de estación autorizada; la clave de intención se conserva para
un reintento ambiguo. Una disputa `Disputed` no habilita la acción. Esto no
representa un impuesto ni comprobante fiscal y aún no está promovido al VPS.

En el worktree de integración, Finanzas puede responder a una disputa con
motivo auditable: `Maintain` devuelve la prefactura a `Submitted` para una
nueva respuesta de la aerolínea; `Void` la anula y libera las reservas de
servicio sin borrar el snapshot. La UI exige confirmación y conserva el UUID
de intención al reintentar, incluso si el foco o una señal de cambio recargan
la lista durante la edición. El cliente solicita `includeResolutions=true`
para mostrar la respuesta; la forma v1 sin ese parámetro sigue intacta.
El estado se relee desde la API. Las pruebas
locales no equivalen a CI verde ni a despliegue remoto.

En esta rama, Finanzas puede registrar **un pago manual completo de prueba**
contra una factura no fiscal ya emitida. La API revalida la cuenta y el alcance
de estación, toma moneda e importe de la factura congelada y conserva UUID de
intención, referencia y actor para impedir un segundo registro. La vista
relee `GET /api/v1/finance/payments/by-invoice/{invoiceId}` y distingue
«Sin pago registrado» de un pago persistido. La operación no consulta al banco,
no concilia fondos ni emite un comprobante fiscal. Fuentes:
[controlador](../../backend/Elevant.Api/Controllers/FinancePaymentsController.cs),
[persistencia](../../database/DevelopmentDB/Elevant.Persistence/Finance/EfNonFiscalPaymentStore.cs)
y [vista](../../frontend/private-web/src/features/finance/preinvoices/PreinvoicesPage.jsx).

En el tramo local posterior, esa vista descarga PDF privado de la factura no
fiscal y, cuando el pago manual existe, su recibo. La API comprueba el rol y
la estación al abrirlos y de nuevo después de leer bytes; no delega la
autorización al navegador ni sirve objetos S3 directamente. No acredita un
cobro bancario. Las pruebas locales de la UI y SQL no demuestran promoción
remota. Fuentes: [controlador financiero](../../backend/Elevant.Api/Controllers/FinanceFinancialDocumentsController.cs),
[persistencia documental](../../database/DevelopmentDB/Elevant.Persistence/Finance/EfFinancialDocumentStore.cs)
y [vista](../../frontend/private-web/src/features/finance/preinvoices/PreinvoicesPage.jsx).

## Desarrollo local

Desde `frontend/private-web`:

```powershell
npm ci
npm test
npm run test:delivery
$env:VITE_ELEVANT_API_URL = "https://api.elevant.test"
$env:VITE_PROTOTYPE_API_URL = $env:VITE_ELEVANT_API_URL
npm run dev
npm run build
```

`npm run preview` permite revisar el build local. Vite usa el puerto local documentado por el README del cliente; verifica allí cualquier cambio vigente en vez de copiar comandos antiguos del monorepo.

## Pruebas que posee

- pruebas Vitest de páginas, componentes, hooks, mappers y servicios;
- pruebas del router, autenticación y manejo de sesión expirada;
- smoke de creación del cliente OpenAPI compartido;
- prueba de entrega para validación de entorno, modelo Compose e invariantes de imagen/configuración.

La amplitud de pruebas de UI no prueba la existencia de endpoints .NET de negocio. Para un cambio que cruza HTTP también deben cambiar OpenAPI, el cliente generado y las pruebas de integración del backend.

## Configuración segura

- `VITE_ELEVANT_API_URL` configura el cliente OpenAPI compartido.
- `VITE_PROTOTYPE_API_URL` conserva temporalmente adaptadores heredados.
- Todo `VITE_*` es público y queda en el bundle: nunca contiene token, contraseña, connection string ni secreto de proveedor.
- La configuración certificada exige orígenes HTTPS válidos y que ambas variables representen el mismo origen.
- Un filtro, rol en memoria, ruta protegida o menú oculto nunca reemplaza la autorización de la API.

Usa [`.env.example`](../../frontend/private-web/.env.example) como forma, no como archivo para credenciales reales.

## Objetivo de integración

Cada feature debe consumir un endpoint versionado a través de un adaptador remoto separado de los componentes, representar carga/éxito/vacío/error/no autorizado y dejar que la API derive identidad y scopes. Los cambios incompatibles requieren una secuencia coordinada API-first; la web no debe inferir DTOs a partir de un fixture.

## Brechas y desconocidos

- **Brecha actual:** autenticación y autorización reales no existen en la API compartida.
- **Brecha actual:** las rutas de negocio usadas por servicios heredados no están en el OpenAPI vigente.
- **Brecha actual:** SignalR y el proveedor de vuelos están reservados, no entregan datos reales a estas vistas.
- **Brecha actual:** carga de evidencias requiere una capacidad de object storage todavía no diseñada.
- **Desconocido:** orden aprobado para migrar cada módulo desde el prototipo.
- **Desconocido:** roles, permisos y criterios finales de aceptación de cada recorrido; deben acordarse antes de convertirlos en contratos.

## Fuentes y relaciones

- [README del cliente](../../frontend/private-web/README.md)
- [Router actual](../../frontend/private-web/src/app/router.jsx)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)
