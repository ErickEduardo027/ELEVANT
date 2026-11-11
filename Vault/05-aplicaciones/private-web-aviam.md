---
id: aplicaciones-private-web-aviam
title: "Private Web / AVIAM"
type: architecture
area: private-web
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-05"
verified_commit: "d6a65ac8a400f3f1f129d6978bcee0c8cf683e2b"
sources:
  - docs/adr/0035-direct-invoicing-simulated-ecf.md
  - docs/adr/0036-simulated-card-payment.md
  - frontend/AGENTS.md
  - frontend/private-web/README.md
  - frontend/private-web/package.json
  - frontend/private-web/app/layout.jsx
  - frontend/private-web/next.config.mjs
  - frontend/private-web/proxy.js
  - frontend/private-web/Dockerfile
  - frontend/private-web/src/features/auth/authService.js
  - frontend/private-web/src/features/admin-occ/navigation.js
  - frontend/private-web/src/features/human-resources/navigation.js
  - frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.jsx
  - frontend/private-web/src/config/elevantApiClient.js
  - packages/api-client/src/client.ts
  - backend/Elevant.Api/Controllers/HumanResourcesShiftsController.cs
  - database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesShiftReadStore.cs
  - frontend/private-web/src/features/contracts/shell/ContractsShell.jsx
  - frontend/private-web/src/features/finance/shell/FinanceShell.jsx
  - frontend/private-web/src/services/financeHomeService.js
  - frontend/private-web/src/features/flight-monitoring/components/FlightMap.jsx
  - frontend/private-web/src/features/positions-map/components/PositionMap.jsx
  - frontend/private-web/src/config/securityHeaders.mjs
tags:
  - aplicaciones
  - private-web
  - aviam
  - react
  - prototipo
---

# Private Web / AVIAM

> [!NOTE]
> La revisión docente de octubre de 2026 cambió validaciones, permisos, notificaciones y otros comportamientos descritos aquí. El estado actual de cada punto está en [Correcciones de la revisión docente](correcciones-revision-docente-2026-10.md).

## Revisión de asistencia en la rama local posterior

La ruta `/gestion-humana/attendance` consume el
[cliente OpenAPI](../../packages/api-client/src/client.ts) para comparar los
aportes de OCC y del agente por estación. La
[vista](../../frontend/private-web/src/features/human-resources/attendance/AttendanceReviewPage.jsx)
permite que G.H. elija los dos hitos y justifique discrepancias; solo la API
autoriza y guarda la decisión. Revalida por pistas durables, foco, reconexión y
sondeo visible; una lectura 401/403 retira el snapshot previo. La ruta y sus
pruebas locales no constituyen evidencia de despliegue en Development.

Private Web es la aplicación interna de AVIAM para OCC, administración y departamentos operativos. Su acceso usa la sesión real de la API de Development y algunas rutas OCC consumen contratos canónicos. Las pantallas prototípicas, objetos locales y rutas heredadas restantes no son autoridad de permisos, persistencia ni contrato HTTP.

## Layout responsive

Las áreas internas comparten [ShellFrame](../../frontend/private-web/src/features/shell/ShellFrame.jsx):
sidebar y topbar fijos, con desplazamiento solo en el contenido. Los
breakpoints viven en un único [módulo](../../frontend/private-web/src/config/breakpoints.js)
que usan tanto Tailwind como los hooks; incluye `3xl` (1920 px).

- Por debajo de 640 px la navegación es un drawer. De 640 a 1023 px hay un rail
  de iconos y desde 1024 px el rail completo. En teléfono, el topbar mueve los
  relojes al menú de usuario.
- Las tablas con la clase `table-stack` pasan a tarjetas etiquetadas cuando su
  contenedor mide menos de 40 rem
  ([CSS](../../frontend/private-web/src/styles/tokens.css),
  [etiquetado](../../frontend/private-web/src/components/StackedTable.jsx)).
- Los paneles laterales y los dashboards 3/2 se separan desde 1024 px. Para
  pantallas nuevas existen `PageHeader`, `SplitLayout` y `FilterBar` en
  `src/components`. Los modales son hojas inferiores en teléfono.
- El chat OCC funciona como lista/detalle por debajo de 1024 px.

La validación local se hizo con capturas a 360, 390, 768, 1024, 1280, 1440 y
1920 px contra la API Development. No acredita un despliegue en el VPS.

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

- Next.js 16 App Router y JavaScript/JSX con servidor Node `standalone`.
- React 19 y React DOM 19.
- Rutas de `app/` y guards por rol en el cliente; la API impone la autorización real.
- Tailwind CSS 3 y tokens CSS para presentación.
- MapLibre GL para vistas cartográficas.
- `@elevant/api-client` como dependencia local del monorepo.
- Vitest, Testing Library y jsdom para pruebas; Node test runner para la certificación local de entrega.

Las versiones efectivas se fijan en [`package.json`](../../frontend/private-web/package.json) y `package-lock.json`; esta nota no sustituye esos manifests.

## Estructura útil para desarrollar

| Ruta | Responsabilidad observada |
| --- | --- |
| `app/` | Rutas Next, layouts y composición por rol. |
| `proxy.js` | Cabeceras de seguridad y CSP con nonce por solicitud. |
| `src/features/` | Interfaces y comportamiento por área: auth, OCC, planificación, monitoreo, posiciones, revisión, reportes, notificaciones, chat, contratos, finanzas y Gestión Humana. |
| `src/services/` | Adaptadores de datos heredados y snapshots de prueba; no deben dictar el contrato futuro. |
| `src/config/elevantApiClient.js` | Fábrica aislada para el cliente OpenAPI compartido. |
| `src/components/`, `src/hooks/`, `src/lib/`, `src/styles/` | UI reutilizable, comportamiento transversal, utilidades y tokens. |
| `tests/` y pruebas junto a features | Configuración transversal, smoke del cliente compartido y pruebas unitarias/de componentes. |
| `index.html`, `dashboard.html`, `contracts.html`, `finance.html` | Entradas históricas redirigidas a las rutas actuales; `index.html` lleva al login. |

## Rutas y recorridos observados

### Entrada y selección de área

- `/login` autentica contra la API de Development; las credenciales mock solo existen en pruebas automatizadas.
- El rol de la sesión redirige a `/admin-occ`, `/gestion-humana`, `/contratos` o `/finanzas`.
- Los guards del router organizan la navegación, pero no sustituyen la autorización del servidor.

### OCC / Administración

Bajo `/admin-occ` existen rutas para dashboard, planificación, monitoreo de vuelos, mapa de posiciones, revisión, reportes, notificaciones y chat. Las interfaces representan planificación y asignaciones, seguimiento de vuelos/turnarounds, contraste de ejecución, aprobación o devolución, cierre/reportes y coordinación interna.

En la rama `feat/adminocc-redesign`, el espacio OCC tiene marco propio: un riel de navegación navy colapsable agrupado en Monitoreo, Operación, Comunicación y Administración, con la marca oficial completa, y una barra contextual con el módulo activo, la hora UTC del reloj del equipo, el idioma (español/inglés), el tema y los avisos. Los demás departamentos conservan su marco; el cambio es opcional por departamento (`ShellFrame` acepta componentes y `data-department`). Los destinos y permisos de navegación no cambian. Fuentes: [layout OCC](../../frontend/private-web/src/features/admin-occ/AdminOccLayout.jsx), [riel](../../frontend/private-web/src/features/admin-occ/shell/OccSidebar.jsx), [barra](../../frontend/private-web/src/features/admin-occ/shell/OccTopbar.jsx) y [tokens](../../frontend/private-web/src/styles/occ.css).

En el árbol local posterior al commit verificado, «Operación → Mis gastos» aparece en el riel OCC y abre `/admin-occ/expenses`, también desde el menú móvil. El enlace no concede permisos: la API determina los gastos y acciones disponibles para la cuenta. Fuentes: [navegación OCC](../../frontend/private-web/src/features/admin-occ/navigation.js), [riel OCC](../../frontend/private-web/src/features/admin-occ/shell/OccSidebar.jsx) y [ruta de gastos](../../frontend/private-web/app/admin-occ/expenses/page.jsx).

OCC opera solo Punta Cana: todas sus rutas toman el alcance `PUJ` que trae la sesión y ya no ofrecen selector de estación. Si la cuenta no tiene ese alcance, cada módulo muestra su estado sin estación autorizada y no consulta la API; la autorización sigue en el servidor. Fuente: [alcance PUJ](../../frontend/private-web/src/features/admin-occ/useOccStation.js).

El idioma elegido en el login se comparte con OCC mediante un único store. Solo los espacios envueltos en `LanguageScope` (hoy OCC) lo aplican; fuera de él la interfaz sigue en español, por lo que los componentes compartidos con otros departamentos no quedan a medio traducir. Fuentes: [store](../../frontend/private-web/src/i18n/languageStore.js) y [scope](../../frontend/private-web/src/i18n/LanguageScope.jsx).

El Dashboard OCC es una consola de la fecha local de PUJ, calculada con la zona IANA de la cola de revisión:
- **Resumen**: escalas, en operación, sin recursos (escalas abiertas sin posición o sin agente), por revisar y completadas. Cada cifra muestra su definición.
- **Mapa de plataforma**: referencia cartográfica de PUJ con escalas planificadas. Varias escalas en la misma posición se conservan juntas, y el mapa se amplía en un diálogo accesible.
- **Escalas del día**: tabla con filtros derivados del estado y de los recursos.
- **Requiere atención**: solo entregas `PendingReview` o `InReview` y escalas sin recursos.
- **Avisos recientes**: con el vocabulario canónico de notificaciones.

Las cifras son conteos de consultas acotadas (cola de 100 y avisos recientes), no totales históricos, y se calculan en el cliente a partir de planificación, revisión y notificaciones. Una revalidación del mismo alcance conserva los datos visibles e indica si falló. Perder autorización o cambiar de cuenta los retira. Revalida tras `notifications` u `occ_planning`, al recuperar foco o conexión y cada 25 segundos con la pestaña visible. La consola distingue las fuentes de meteorología y telemetría del estado de pistas y la ocupación física, que carecen de fuente conectada. Fuentes: [adaptador del dashboard](../../frontend/private-web/src/services/dashboardService.js), [modelo](../../frontend/private-web/src/features/dashboard/dashboardModel.js), [ruta](../../frontend/private-web/src/features/dashboard/DashboardRoute.jsx) y [vista](../../frontend/private-web/src/features/dashboard/DashboardPage.jsx).

> [!NOTE]
> El rediseño descrito a continuación está en el árbol local, sin commit ni despliegue. La metadata de verificación superior sigue referida al commit histórico; sus nuevas fuentes no pueden agregarse al inventario verificado antes de un commit revisado.

En el rediseño local posterior, la consola usa una superficie NOC única: plataforma PUJ amplia, dos mapas auxiliares y franja operacional. El mapa principal integra pistas, rodajes y plataforma de OpenStreetMap. Las siluetas vectoriales indican **asignación planificada** y no confirman ocupación física. El modo nocturno inclina la cámara; los edificios se extruyen solo si la tesela aporta altura. Manrope se aloja mediante `next/font` y se aplica explícitamente al dashboard, mientras IBM Plex Mono se usa para horas y cifras. Ambas paletas tienen estilos cartográficos y etiquetas propios.

El catálogo activo del dashboard recupera las 42 ubicaciones internas originales: 41 se dibujan y B33 permanece como registro histórico fuera de la vista operativa. Incluye B34–B37 y conserva las 13 coordenadas internas de B20–B32. La [carta AIP de 2024](https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_03-24.pdf) y la [enmienda de 2026](https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_3-26/AMDT_AIRAC_03-26.pdf) sirven solo como referencias de conciliación. La enmienda retira B33; las coordenadas internas difieren de la documentación AIP, especialmente B20–B32, y **no se declaran oficiales ni verificadas**. No consta permiso de IDAC para procesar coordenadas AIP, de acuerdo con su [política de uso](https://aip.sna.gob.do/Aip/CircularSerA); el frontend ya no contiene la transcripción previa. Los códigos planificados sin coincidencia exacta en el catálogo activo, incluido B33, se listan sin ubicación. No hay alias automáticos entre A1 y 1 ni entre códigos parecidos.

Los dos mapas auxiliares se amplían:
- **Meteorología MDPC:** el METAR de Iowa Environmental Mesonet es una réplica no oficial. La interfaz separa la hora observada de la recepción local, avisa tras 75 minutos y conserva el aviso de un refresco fallido. Humedad relativa, sensación térmica y precipitación horaria procedentes de campos IEM se rotulan como derivados. GOES-East infrarrojo e [IMERG](https://gpm.nasa.gov/data/imerg) de NASA GIBS son capas seleccionables. La vista fija las teselas al tiempo reportado por GIBS; si solo hay fecha, muestra únicamente el día sin antigüedad horaria. IMERG estima precipitación y puede retrasarse varias horas; no es radar ni observación local. Se muestran atribución, unidad y opacidad de la capa.
- **Región de República Dominicana:** cartografía OpenStreetMap/OpenFreeMap con referencia PUJ. La rama local consulta el nuevo endpoint OCC y dibuja una marca por ICAO24 con posición OpenSky disponible; rumbo y otros campos pueden ser nulos. Seleccionar una marca abre la ficha de telemetría, separada de los vuelos y stands de planificación. No se infiere aterrizaje, destino ni ocupación por callsign o proximidad.

En esta rama local, la certificación de la imagen AVIAM compara la CSP generada con una lista cerrada que incluye la API certificada, su WebSocket, dos orígenes cartográficos, IEM y NASA GIBS. Rechaza fuentes adicionales o ausentes; la prueba usa la política que genera la aplicación para evitar otra divergencia. Fuentes: [validador](../../frontend/scripts/deployment/csp-tool.mjs), [pruebas](../../frontend/tests/deployment/test-csp-tool.mjs) y [política AVIAM](../../frontend/private-web/src/config/securityHeaders.mjs).

La CSP permite los orígenes GIBS e IEM; OpenSky solo se consulta desde el servidor. `GET /api/v1/occ/traffic/aircraft` exige personal AVIAM con `operations.planning.read` y alcance PUJ. El recuadro 17–21° N, 73–67° O es fijo, la caché por instancia impone 120 segundos entre consultas y permite hasta 10 minutos de copia desactualizada durante fallos. OAuth2 usa configuración privada, desactivada por defecto; no se han aportado credenciales ni se ha validado una conexión OpenSky real en esta rama. El acuerdo escrito para uso operacional y su alcance deben verificarse antes de activarla. La API sanitiza errores y no expone secretos. No cambia esquema ni permisos de negocio. Fuentes locales: [controlador](../../backend/Elevant.Api/Controllers/OccTrafficController.cs), [adaptador](../../backend/Elevant.Infrastructure/Integrations/OpenSky/OpenSkyAircraftTrafficSource.cs), [cliente](../../packages/api-client/src/client.ts) y [panel](../../frontend/private-web/src/features/dashboard/console/RegionalTrafficPanel.jsx).

Fuentes de implementación local: [vista](../../frontend/private-web/src/features/dashboard/DashboardPage.jsx), [catálogo](../../frontend/private-web/src/features/dashboard/dashboardPositions.js), [meteorología](../../frontend/private-web/src/features/dashboard/console/WeatherPanel.jsx), [teselas](../../frontend/private-web/src/services/satelliteService.js), [capas de posiciones](../../frontend/private-web/src/features/positions-map/components/positionMapLayers.js) y [CSP](../../frontend/private-web/src/config/securityHeaders.mjs).

La validación del rediseño anterior (27/27 pruebas enfocadas, test:delivery 22/22, lint, typecheck y build; navegador 375–1440 px) precede a esta integración. Sus resultados no acreditan las pruebas ni una conexión OpenSky real de esta rama. Los controles nuevos se registran en el handoff; la metadata de verificación superior conserva su commit histórico. Ninguno de estos cambios locales se ha desplegado.
Monitoreo OCC usa el alcance PUJ de la sesión e ignora un enlace a otra estación. La lectura inicial y el refresco de 30 segundos consultan esa misma estación; el refresco reemplaza la lista completa y una falla retira los vuelos antiguos hasta recuperación o reintento. Las horas provienen de planificación; no se presentan coordenadas de aeronaves no verificadas. Solo PUJ tiene coordenadas cartográficas revisadas, por lo que otra estación no muestra un mapa de PUJ. Esto no acredita datos aeronáuticos en vivo ni promoción remota. Fuentes: [servicio de monitoreo](../../frontend/private-web/src/services/flightMonitoringService.js) y [ruta](../../frontend/private-web/src/features/flight-monitoring/FlightMonitoringRoute.jsx).

En esta rama, las vistas de PUJ usan MapLibre sin cambiar a Google por una
variable local. El mapa base de Monitoreo se monta aunque ningún vuelo tenga
coordenadas verificadas, con un aviso que distingue cartografía de telemetría.
El worker y su importación compartida se copian juntos desde la dependencia
fijada antes de desarrollo y build; la certificación comprueba que la imagen
sirve ambos módulos. Esta evidencia es local y de CI; la disponibilidad remota
requiere la promoción y comprobación del operador. Fuentes: [vista de
Monitoreo](../../frontend/private-web/src/features/flight-monitoring/FlightMonitoringPage.jsx),
[mapa de posiciones](../../frontend/private-web/src/features/positions-map/components/PositionMap.jsx),
[script de copia](../../frontend/private-web/scripts/copy-maplibre-worker.mjs) y
[certificación](../../frontend/private-web/scripts/certify-image.sh).

En la rama de integración, Monitoreo y Mapa releen la estación autorizada
cuando reciben `occ_planning` tras una asignación OCC. También refrescan al
recuperar foco/conexión y cada 25 segundos con la pestaña visible; los sondeos
de snapshot existentes continúan. La señal no sustituye la lectura REST ni
acredita latencia o promoción remota.

El Mapa de posiciones también usa el alcance PUJ. Representa geometría local revisada y superpone únicamente asignaciones planificadas, sin inferir disponibilidad física. En otra estación muestra una lista de posiciones asignadas desde planificación, sin reutilizar coordenadas de PUJ; si no hay asignaciones, el vacío es explícito. Refresca el snapshot entero cada 30 segundos, oculta resultados previos ante fallos y conserva la estación al abrir un vuelo en Monitoreo. Faltan coordenadas y ocupación física verificadas de otras estaciones, así como prueba remota. Fuentes: [adaptador de posiciones](../../frontend/private-web/src/services/positionsMapService.js), [ruta](../../frontend/private-web/src/features/positions-map/PositionsMapRoute.jsx) y [vista](../../frontend/private-web/src/features/positions-map/PositionsMapPage.jsx).

En la rama de integración de Development, planificación incorpora el alta manual de una escala OCC. La pantalla obtiene de la API las aerolíneas con contrato vigente, aeropuertos y posiciones activas para una estación autorizada; envía llegada, salida, fecha, posición y un UUID de intención estable para un reintento ambiguo. La API vuelve a comprobar alcance, contrato, ruta y disponibilidad de posición. Crear una escala deja su operación planificada. OCC puede programar después un turno local para un agente cuyo único impedimento sea la cobertura; el panel refresca opciones y ETag antes de asignar. Ninguno de esos comandos factura ni demuestra por sí solo promoción o prueba de navegador contra el VPS.

La incorporación incremental de horarios sugeridos editables para esa cobertura se explica en [Opciones OCC de turno por vuelo](occ-turnos-vuelo.md), con su alcance y evidencia propios.

En esta rama, una revalidación de planificación para la misma estación y fecha conserva el último snapshot hasta recibir la respuesta, evitando que se cierre transitoriamente el panel de una escala abierta. Cambiar estación o fecha, perder acceso o fallar la lectura retira los datos anteriores; una respuesta válida que ya no incluya la escala cierra el panel. Es comportamiento local verificado por pruebas del hook, no una confirmación de despliegue ni de una asignación real en el VPS. Fuente: [hook de planificación](../../frontend/private-web/src/features/planning/usePlanningData.js) y [pruebas](../../frontend/private-web/src/features/planning/usePlanningData.test.js).

### Gestión Humana

En esta rama local, el panel de [alertas de programación](../../frontend/private-web/src/features/human-resources/schedules/ScheduleWarningsPanel.jsx)
se añade a la vista de turnos. La [API versionada](../../backend/Elevant.Api/Controllers/HumanResourcesScheduleWarningsController.cs)
autoriza el rol y estación en cada lectura y calcula superposición, descanso
corto, carga de siete fechas locales y casos no evaluables. Es orientación
preliminar, no una conclusión laboral ni horas pagadas. Evidencia de estaciones
sin concesión se reduce a un indicador sin ID, código ni horario. La web
retira los resultados al cambiar sesión o estación y reconsulta tras cambios
durables de turnos, foco y reconexión. Código y pruebas locales no acreditan
una promoción al VPS.

Con la gobernanza por departamento (ADR-0015), el flujo anterior de acceso
móvil (G.H. pedía la cuenta y Superadministración la creaba) queda retirado de
la interfaz; sus endpoints siguen deprecados. El administrador del Centro de
Operaciones solicita el alta del agente con su perfil operativo completo desde
**Usuarios del departamento**, y Gestión Humana la valida en **Validaciones de
acceso** definiendo la contraseña temporal o la rechaza con motivo. **Agentes
de rampa** de Gestión Humana es una consulta; Operaciones mantiene los perfiles.
El superadministrador ve **Usuarios** con **Clientes** (usuarios del portal por
aerolínea) y **Usuarios internos** (recuentos globales y por departamento).
Cada shell muestra sólo los módulos que concede `GET governance/me/access`.
Con ADR-0017, Gestión Humana tiene **Empleados** (expedientes, traslados,
bajas y expedientes pendientes), **Puestos**, **Requisiciones** y una
**Auditoría** leída de la API; los administradores solicitan el acceso eligiendo
un empleado y cuentan con las pestañas **Puestos**, **Requisiciones** y
**Actividad**; las contraseñas temporales pueden generarse en el navegador.
Fuentes: [gobernanza por departamento](../03-dominio/gobernanza-por-departamento.md),
[usuarios del departamento](../../frontend/private-web/src/features/department-users/DepartmentUsersPage.jsx),
[validaciones](../../frontend/private-web/src/features/department-users/AccessValidationsPage.jsx)
y [vista de perfiles](../../frontend/private-web/src/features/human-resources/users/RampProfilesPanel.jsx).

Bajo `/gestion-humana` existen dashboard, usuarios/cuentas, habilitaciones, permisos aeroportuarios, horarios/disponibilidad, reportes, auditoría y notificaciones. El código navega y prueba estas vistas, pero sus datos prototípicos no demuestran que la API ya gestione cuentas o permisos.

**Habilitaciones, carnets y horarios usan siempre la API.** Antes, el
navegador leía `NEXT_PUBLIC_HR_DEMO_MODE` como `process.env` completo. Next no
lo incrusta así en el cliente, de modo que el flag valía `false` en el
navegador y se montaban las páginas del prototipo que llamaban a `/api/hr`
(«No fue posible cargar…»). Ahora `hrDemoMode.js` lee la expresión literal.
Las tres rutas montan siempre `Current*Page`, y se eliminaron las páginas,
hooks y servicios del prototipo de esas secciones.

En habilitaciones y carnets:
- totales por vigencia calculados por el servidor (`.../summary`); cada
  tarjeta filtra la lista;
- búsqueda y filtros por equipo o tipo de documento y por vigencia, evaluada en
  la fecha local del navegador; «por vencer» significa 30 días o menos;
- un panel de **historial** con todos los ciclos y quién registró cada uno,
  según la auditoría de escritura (los ciclos sembrados aparecen como «Carga
  inicial»).

Registrar y renovar solo aparecen con `human_resources.*.manage`. En horarios,
Gestión Humana consulta los turnos y alertas, y decide sobre la disponibilidad
(aprobar, rechazar o **cancelar con motivo** una solicitud pendiente) con
`human_resources.availability.decide`. Fuentes:
[habilitaciones](../../frontend/private-web/src/features/human-resources/certifications/CurrentQualificationsPage.jsx),
[carnets](../../frontend/private-web/src/features/human-resources/permits/CurrentPermitsPage.jsx),
[componentes compartidos](../../frontend/private-web/src/features/human-resources/documents/DocumentHistoryDrawer.jsx)
y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesQualificationReadStore.cs).

En el worktree local posterior a esta fotografía, el dashboard consulta los
perfiles de rampa autorizados de la API para contar agentes activos y perfiles
sin cuenta vinculada. Ya no presenta como hechos las cifras fijas del prototipo
para turnos, habilitaciones o cobertura. El modo restringido solo expone
dashboard, perfiles, habilitaciones, permisos y turnos conectados a la API; mantiene ocultas las rutas
profundas aún no integradas. Recibir una señal de cambio, recuperar
foco/conexión o cumplir 25 segundos provoca una nueva lectura. Esto no acredita
un despliegue al VPS. Las escrituras de habilitaciones y permisos se
describen más abajo y aún requieren validación de navegador y dispositivo. Fuentes:
[servicio](../../frontend/private-web/src/services/humanResourcesDashboardService.js),
[vista](../../frontend/private-web/src/features/human-resources/dashboard/DashboardPage.jsx)
y [perfiles autorizados](../../backend/Elevant.Api/Controllers/RampProfilesController.cs).

La lista activa de perfiles de rampa revalida el alcance autorizado mediante
señales durables, foco, reconexión y sondeo de 25 segundos. Si falla la lectura,
retira perfiles y formulario de edición anteriores sin exponer el error interno;
un guardado fallido conserva el formulario sin exponer trazas; las respuestas
tardías no pueden sobrescribir una consulta más reciente. Es un
cambio local de esta rama, no una prueba de despliegue remoto ni de los módulos
profundos de Gestión Humana. Guardar un perfil invalida la planificación OCC de
la unión de sus estaciones anteriores y solicitadas en el mismo commit SQL,
incluso si se desactiva y pierde todos los scopes efectivos. El aviso solo
incluye el UUID de estación, no la identidad del agente. Fuentes:
[panel de perfiles](../../frontend/private-web/src/features/human-resources/users/RampProfilesPanel.jsx)
y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfRampProfileStore.cs).

En esta rama local, el perfil admite terminales pertenecientes a sus
estaciones y un supervisor activo sin ciclos de supervisión mediante campos
aditivos de la API. La respuesta diferencia el estado de la cuenta IAM; este
no prueba por sí solo que la cuenta tenga acceso móvil efectivo. Una
edición del administrador de Operaciones sólo concede estaciones que él mismo tiene;
las altas nuevas pasan por la validación de Gestión Humana. El panel no afirma que haya enviado una invitación. La
ruta conservada es [el controlador de perfiles](../../backend/Elevant.Api/Controllers/RampProfilesController.cs)
y la selección se comprueba en [su prueba de interfaz](../../frontend/private-web/src/features/human-resources/users/RampProfilesPanel.test.jsx).

La API de esta rama agrega una lectura paginada de los ciclos actuales de
habilitación de rampa para Gestión Humana y Superadministración internas. La
ruta restringida consulta esa API en páginas de 20, calcula vigencia por
fechas y retira datos antiguos ante error o revocación. Puede registrar el
primer ciclo y renovar: obtiene agentes y equipos activos, consulta el par
exacto antes de guardar, envía el identificador del ciclo observado como
precondición y conserva el UUID de intención para un reintento incierto. Un
conflicto obliga a releer el ciclo. La API conserva historial, auditoría y
señal durable `hr_qualifications` y una invalidación OCC por estación en la
transacción. `GET .../qualifications/{id}/history` expone la línea de ciclos.
No hay archivos adjuntos ni promociones al VPS demostradas para esta rama. Fuentes: [ruta de habilitaciones](../../frontend/private-web/src/features/human-resources/certifications/CurrentQualificationsPage.jsx), [servicio](../../frontend/private-web/src/services/humanResourcesQualificationsReadService.js), [controlador](../../backend/Elevant.Api/Controllers/HumanResourcesQualificationsController.cs) y [README del backend](../../backend/README.md).

La API también ofrece ciclos actuales de carnet aeroportuario y licencia de
rampa, paginados y reservados a Gestión Humana o Superadministración internas.
La lectura admite filtros independientes por agente, tipo de documento,
búsqueda y vigencia. Con agente y tipo a la vez, devuelve el ciclo exacto sin
recorrer páginas globales. La API ya ofrece
`PUT /api/v1/human-resources/permits/{id}` para registrar el primer ciclo o
renovarlo con UUID de intención estable y `expectedCurrentId`. Conserva el
historial, audita y emite `hr_permits` y `occ_planning` de forma durable; el feed vuelve a
comprobar rol y membresía al leer esa pista.
La ruta restringida calcula vigencia a partir de fechas, revalida al volver a
foco/conexión y cada 25 segundos, y ya ofrece captura del primer ciclo y
renovación después de consultar el par exacto. Reutiliza el UUID ante una
respuesta incierta y relee el ciclo tras 409; no permite archivos. El documento
puede estar vencido aunque su ciclo siga marcado como
actual. La API conserva los ciclos anteriores y `GET .../permits/{id}/history`
los muestra en el panel de historial. Fuentes:
[vista](../../frontend/private-web/src/features/human-resources/permits/CurrentPermitsPage.jsx),
[formulario](../../frontend/private-web/src/features/human-resources/permits/PermitRecordForm.jsx),
[controlador](../../backend/Elevant.Api/Controllers/HumanResourcesPermitsController.cs)
y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesPermitWriteStore.cs).

La ruta restringida de horarios lee turnos reales por semana local, ventana
de 15 días o mes calendario, siempre en páginas de 20. No presenta una página
como total del período. Muestra agente, estación, terminal, posición y horas registradas, sin
inferir disponibilidad. Gestión Humana ya no ofrece
«Nuevo turno»: OCC es el único rol autorizado para registrar turnos, y el
catálogo ya no ofrece `human_resources.schedules.manage`. El
`PUT /api/v1/human-resources/shifts/{id}` sigue disponible de forma transitoria
para OCC, con UUID estable, jornada máxima de 16 horas, scopes de agente
vigentes en estación y terminal, auditoría y señales `hr_shifts` y
`occ_planning`. La vista GH revalida por pista durable, foco, reconexión y
sondeo de 25 segundos, y oculta datos anteriores si falla la lectura. El
calendario OCC y los patrones de turnos aún no están implementados. El código
del repositorio por sí solo no acredita promoción al VPS.
Las solicitudes de disponibilidad permanecen en la semana que contiene la
fecha seleccionada incluso cuando la lectura de turnos cubre 15 días o un mes;
la interfaz indica esa diferencia de alcance.
Las ausencias y restricciones aprobadas ya bloquean la elegibilidad OCC
para la fecha local consultada o el día de inicio de un turno nocturno. Las
solicitudes pendientes y de cambio de turno no son una ausencia. La API ya
permite a Gestión Humana y Superadministración registrar solicitudes pendientes
y aprobarlas o rechazarlas con auditoría y señal durable `hr_absences`. Una
ausencia aprobada no puede chocar con una operación aún asignada, incluso si
un turno nocturno cubre una operación del día siguiente. El feed
revalida el rol antes de entregar la pista. La ruta activa de turnos ahora
muestra solicitudes persistidas por ventana y página, registra una intención
`Pending` con UUID estable y permite aprobar o rechazar con relectura ante
409. El resultado incierto conserva la intención incluso durante una
revalidación; foco, reconexión, pista durable y sondeo de 25 segundos
revalidan sin conservar filas tras una denegación. La aprobación de `DayOff`
o `Restriction` emite además `occ_planning` para las estaciones vigentes del
agente, en la misma transacción. Solo cuentas OCC activas con membresía interna
y alcance de estación reciben la pista; el feed revalida rol y estación al
leerla. El payload contiene la estación, nunca el UUID ni el motivo de la
solicitud laboral. Planificación OCC invalida snapshot y opciones de asignación
ante esa pista, foco, reconexión o sondeo visible de 25 segundos. Una pista
perdida no reemplaza la comprobación final de elegibilidad y ETag en la API.
La misma pista de estación se confirma al registrar o renovar un carnet o una
habilitación, y al programar un turno desde OCC; ninguna pista
incluye datos personales del agente.
Fuentes:
[vista](../../frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.jsx),
[controlador](../../backend/Elevant.Api/Controllers/HumanResourcesShiftsController.cs)
y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesShiftWriteStore.cs).
[Solicitudes de disponibilidad](../../backend/Elevant.Api/Controllers/HumanResourcesAvailabilityRequestsController.cs)
usan [persistencia transaccional](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesAvailabilityWriteStore.cs).
Su [panel activo](../../frontend/private-web/src/features/human-resources/schedules/AvailabilityRequestsPanel.jsx)
usa el [cliente versionado](../../frontend/private-web/src/services/humanResourcesAvailabilityService.js).

En este worktree posterior a la fotografía verificada de la nota, la ruta
restringida de **Reportes de personal** consulta cuatro informes de API por
estación: vigencias, movimientos de cuenta atribuibles por auditoría,
distribución de turnos y cobertura de habilitaciones. Una página de hasta 20
filas no se presenta como total global. Vigencias filtra habilitaciones o
permisos y vigencia evaluada por fecha local de la estación; el mismo filtro
se usa en la descarga. PDF y XLSX los genera la API a partir
de un snapshot completo limitado a 5 000 filas; cada exportación vuelve a
comprobar el rol G.H. y la concesión de estación y deja auditoría sin filas
privadas. Los movimientos sin estación verificable no se atribuyen
retroactivamente; los comandos de gobierno nuevos etiquetan altas, bajas y
cambios de estado de cuentas de rampa con las estaciones verificadas al
ejecutarlos. La vigencia de esos alcances para atribuir auditoría usa la fecha
UTC del evento, coherente con la fecha UTC de alta del perfil; los intervalos
de los informes siguen usando la fecha local de la estación. La vista retira
la información anterior si se pierde acceso,
y relee por señal durable, foco, reconexión y sondeo visible de 25 segundos.
No hay todavía evidencia de CI, navegador ni promoción de estos reportes al
VPS. Desde la fase 3 del ciclo, los archivos y la tabla hablan español y
muestran las horas locales, y el rechazo de un conjunto mayor lleva su código
(`report_too_large`): ver [La operación (fase 3)](#la-operación-fase-3). Fuentes locales: [API](../../backend/Elevant.Api/Controllers/HumanResourcesReportsController.cs),
[consulta EF](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesReportStore.cs),
[cliente compartido](../../packages/api-client/src/client.ts),
[vista](../../frontend/private-web/src/features/human-resources/reports/CurrentReportsPage.jsx)
y [servicio de sesión](../../frontend/private-web/src/services/humanResourcesVerifiedReportsService.js).

### Contratos y Finanzas

> [!NOTE] Finanzas en la fase 4
> Posterior al commit verificado de esta nota: este bloque describe el código
> de la fase 4 del ciclo (`39a85a46`;
> [ADR-0035](../../docs/adr/0035-direct-invoicing-simulated-ecf.md),
> [ADR-0036](../../docs/adr/0036-simulated-card-payment.md) y
> [ADR-0040](../../docs/adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md),
> que recoge las decisiones de la fase). Las reglas y los permisos están en
> [Finanzas](../03-dominio/finanzas-tarifas-cargos-y-cobros.md).

`/contratos` y `/finanzas` son shells protegidos que cambian módulos mediante
estado interno, no rutas independientes para cada pestaña, y solo muestran los
módulos que permite `GET governance/me/access`. Contratos presenta inicio,
contratos, borradores, solicitudes, servicios, servicios pactados y reportes.
El chat departamental heredado está diferido: ambos shells ocultan
«Comunicaciones» porque `/api/internal-chat/messages` no existe en la API
canónica ni persiste en SQL; esto no afecta el chat operativo OCC–agente.

El [menú de Finanzas](../../frontend/private-web/src/features/finance/shell/modules.js)
es Inicio · Facturación · Cuentas por pagar · Reportes · Configuración ·
Usuarios del departamento:

| Pantalla | Comportamiento |
| --- | --- |
| Inicio | Indicadores de la estación que calcula el servidor (`GET finance/home`); cada sección se muestra según el permiso de su módulo. |
| Facturación → Por facturar | Operaciones aprobadas por OCC todavía sin factura, de la más antigua a la más reciente, con atajos de semana (domingo a sábado) y de mes, «Toda la aerolínea del período», «Cargar más» y «Mostrando N de M»; cada operación explica en español todos sus motivos de bloqueo. Emite una factura e-CF simulada para una o varias operaciones de la misma aerolínea y, si el total es 0, ofrece «Cerrar sin cargo» con motivo. |
| Facturación → Facturas | Páginas de 25 con una búsqueda por e-NCF, número o aerolínea; saldo, estado (también «Anulada») y PDF, y las pestañas «Cobros» y «Estados de cuenta» según los permisos. El detalle muestra los pagos con tarjeta de la aerolínea (marca •••• últimos 4, autorización o motivo de rechazo), las notas de crédito `E34` o de débito `E33` con su PDF y el estado de los correos. Un cobro con tarjeta no ofrece revertir ni devolver: se corrige con una nota de crédito. |
| Facturación → Charters | Confirma o corrige con motivo el prepago y reabre la cotización. |
| Cuentas por pagar | Facturas de proveedores con corrección, anulación y reverso de pagos bajo segregación de funciones; proveedores con retiro; gastos de empleados con revisión por escalamiento, y «Mis gastos», que no exige un permiso de Finanzas. |
| Reportes | Los seis reportes del servidor; sus PDF llevan el marco «Simulación — sin validez fiscal». |
| Configuración | Tarifarios de servicios y de cargos, paquetes, reglas de cierre, aprobación de contratos, tasas de cambio y unidades de cobro. |

Cada error se muestra por su `code` de Problem Details traducido al español
([mensajes](../../frontend/private-web/src/services/financeErrors.js)), y cada
comando reutiliza su clave solo después de una respuesta incierta
([claves](../../frontend/private-web/src/services/commandKeys.js)). Por
facturar, Cobros, Charters e Inicio usan el cliente compartido; la lista de
Facturas, los Reportes y Cuentas por pagar llaman directamente a las rutas
`/api/v1` de la misma API, sin los validadores del cliente. La campana avisa
`operation_ready_to_invoice`, que abre «Por facturar», `invoice_paid`, que abre
«Facturas», y `charter_cancelled`, que abre Charters
([avisos](../../frontend/private-web/src/features/notifications/departmentNotifications.js)).
Fuentes: [Por facturar](../../frontend/private-web/src/features/finance/invoicing/ToInvoicePage.jsx),
[Facturas](../../frontend/private-web/src/features/finance/invoices/InvoicesPage.jsx),
[Cobros](../../frontend/private-web/src/features/finance/treasury/TreasuryPage.jsx) y
[adaptador de facturación](../../frontend/private-web/src/services/invoicingService.js).
Lo que Finanzas tenía antes está en la
[historia de Finanzas](#historia-finanzas-antes-de-la-fase-4-retirado-del-producto).

En esta rama, **Contratos**, **Servicios pactados** y **Reportes contractuales** comparten `GET /api/v1/contracts/agreements`, que lee versiones aprobadas y reemplazadas, estaciones y tarifas desde SQL con permiso comercial interno. La tabla diferencia los precios históricos y muestra cuatro decimales; los indicadores del reporte se limitan expresamente a la página consultada. Ya no se montan sus adaptadores `/api/contracts/*` ni botones de alta, edición y exportación auditada ficticia. La consulta no sustituye el flujo de borradores ni crea contratos; falta validación de navegador y promoción remota.

## Personal listo: turnos de Gestión Humana y «¿Puede operar?»

Gestión Humana programa la semana de cada agente de rampa desde «Horarios y
disponibilidad» con el permiso «Programar turnos»: una fila por agente, una celda
por día, las plantillas horarias de OCC y «Copiar semana anterior», que solo llena
días libres y futuros. Los turnos de hoy en adelante se pueden quitar; los pasados
quedan como historial. OCC conserva la creación del turno que necesite un vuelo.

«Agentes de rampa» muestra «¿Puede operar?»: por agente, cuenta de la tablet, rol,
membresía, estación compartida con la cuenta, terminal, carnet, licencia de rampa y
habilitaciones, con lo que falta; los vencimientos en 30 días avisan sin bloquear.
Son las mismas reglas que OCC aplica al asignar. El menú ya no muestra contadores
fijos de ejemplo. Fuentes: [editor](../../frontend/private-web/src/features/human-resources/schedules/WeeklyShiftEditor.jsx),
[panel](../../frontend/private-web/src/features/human-resources/users/RampReadinessPanel.jsx) y
[ADR-0026](../../docs/adr/0026-ramp-staff-readiness-and-hr-shifts.md).
La fase 2 del ciclo cambió quitar turnos, copiar la semana y las ausencias: ver
[Pre-operación (fase 2)](#pre-operación-fase-2). La fase 3 sumó «Ajustar
horario»: ver [La operación (fase 3)](#la-operación-fase-3).

## OCC listo: contratos listos, posiciones ubicadas y mapa en Planificación

Admin OCC suma «Contratos listos»: por fecha, las aerolíneas con contrato activo y
firmado cuya versión aprobada cubre esa fecha en PUJ, con código, versión, vigencia,
renovación, servicios (sin precios) y vuelos planificados ese día. Es la misma regla
que usan Planificación, los vuelos manuales y la asignación de agentes. Desde la
fase 2 esa versión debe estar firmada por ambas partes: ver
[Pre-operación (fase 2)](#pre-operación-fase-2).

En el Mapa de posiciones, OCC ubica cada posición con «Ubicar en el mapa» y un clic
en el punto real, o la quita. Las coordenadas guardadas en `ref.stands` reemplazan a
la referencia interna; las demás siguen marcadas como referencia sin verificar.
Planificación tiene la vista «Mapa» (MapLibre) con las posiciones, los vuelos del día y
los vuelos sin posición; un clic abre el vuelo en el panel de asignación. Fuentes:
[contratos listos](../../frontend/private-web/src/features/ready-contracts/ReadyContractsRoute.jsx),
[mapa de Planificación](../../frontend/private-web/src/features/planning/components/PlanningMap.jsx) y
[ADR-0027](../../docs/adr/0027-occ-ready-contracts-and-stand-locations.md).

## Importar vuelos del proveedor en Planificación

«Importar vuelos» de Planificación abre los vuelos que AeroDataBox informó para las
aerolíneas con contrato en la fecha. Muestra:
- cada llegada con su salida sugerida (misma aerolínea y matrícula o la siguiente salida);
- las horas revisadas y reales, la terminal y la puerta;
- las unidades gastadas hoy y en el mes.

Con «Crear escalas», OCC importa la escala o descarta un tramo. «Actualizar ahora» pide una
lectura al servidor, que decide si se permite: como mucho cada 10 minutos, reutiliza una
lectura reciente y respeta el presupuesto. Abrir el diálogo nunca gasta unidades. Sin clave
configurada, el diálogo lo dice y no hay llamadas. Fuentes:
[diálogo](../../frontend/private-web/src/features/planning/components/ProviderFlightsDialog.jsx) y
[ADR-0028](../../docs/adr/0028-aerodatabox-flight-feed-with-unit-budget.md).
La fase 2 sumó las vistas «Charter sin contrato» y «Descartadas», el tipo de
avión, la posición y la restauración: ver
[Pre-operación (fase 2)](#pre-operación-fase-2). Desde la fase 3, importar un
vuelo que ya está planificado lo vincula a esa escala en lugar de duplicarla:
ver [La operación (fase 3)](#la-operación-fase-3).

## Chat con presencia y cierre de sesión confirmado

El PR #156 se fusionó y luego se revirtió su rediseño visual de Admin/OCC: el
marco vuelve a ser el riel `OccSidebar` con la barra `OccTopbar`, y las
pantallas OCC (Panorama, Planificación, Monitoreo, Mapa de posiciones,
Revisión, Reportes, Notificaciones, Usuarios y Mis gastos) conservan la
presentación anterior, incluidos sus mapas. Del #156 se mantienen:

- **Chat por operación con presencia:** el selector de estado propio y las
  personas de cada operación salen de `chat/presence` en la API
  (`OperationalPresenceController`); la web y Mobile Agent envían latidos y la
  API no infiere disponibilidad de una conversación abierta. Las conversaciones
  y los mensajes se paginan con `offset`. Fuentes:
  [chat](../../frontend/private-web/src/features/chat/CanonicalChatRoute.jsx) y
  [latido web](../../frontend/private-web/src/features/chat/useWebPresence.js).
- **Cierre de sesión confirmado:** pide confirmación, comprueba que la sesión
  se borró de ambos almacenes y luego revoca la cadena de refresco en el
  servidor (ADR-0021). Fuente:
  [authService](../../frontend/private-web/src/features/auth/authService.js).
- **Desarrollo con Webpack:** `npm run dev` usa `--webpack` para evitar un
  bloqueo de Turbopack en Windows; el build no cambia.

La presencia vive en memoria de un solo proceso de la API: se pierde al
reiniciar y no se comparte entre réplicas.

## Ciclo comercial: Contratos, Finanzas y Superadministración (fase 1)

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 1 del ciclo (`8a79fe70`), que esa verificación no cubre.

La fase 1 del ciclo operativo ([ADR-0037](../../docs/adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md))
rehízo las pantallas comerciales sobre una convención común:

- **Errores.** [`problemMessages.js`](../../frontend/private-web/src/services/problemMessages.js)
  traduce el `code` de Problem Details por área y nunca muestra el `title` del
  servidor. Cada área publica su mapa: Solicitudes y Superadministración,
  Borradores, Finanzas y Servicios.
- **Claves.** [`commandKeys.js`](../../frontend/private-web/src/services/commandKeys.js)
  conserva la `Idempotency-Key` de una intención mientras se reintenta el mismo
  cuerpo tras un resultado incierto y la descarta tras cualquier `2xx` o `4xx`.
  Las pantallas envían la versión que muestran y releen ante un `409`.
- **Estados.** Las vistas tocadas separan cargando, vacío, error recuperable con
  reintento y falta de permiso; un error no se presenta como lista vacía.

| Pantalla | Comportamiento |
| --- | --- |
| Contratos → Solicitudes | Bandeja paginada con contadores, filtro por estado y búsqueda en el servidor. La revisión verifica la aerolínea (o vincula la propuesta a una ficha), registra la confirmación del representante, aprueba o rechaza, y cancela con motivo si la cuenta tiene el permiso. Avisa cuando la aerolínea ya es cliente y muestra documento, nacionalidad y distrito en español. Inicio toma sus indicadores de los contadores. |
| Contratos → Borradores | Muestra la lista de requisitos que devuelve el servidor y el estado de la cuenta del portal, y solo habilita «Enviar a Finanzas» cuando no falta ninguno. Edita servicios y estaciones, marca los servicios dados de baja o cubiertos por un paquete, responde a la aerolínea y descarta con motivo. |
| Contratos → Contratos | El detalle descarta un contrato que nunca se activó y crea una enmienda de un contrato activo o suspendido, con acceso directo a Borradores. |
| Contratos → Servicios | Separa ocultar del catálogo, dar de baja con motivo y reactivar; si un contrato impide la baja, ofrece ocultar. Las clausuras solo ofrecen republicar un servicio activo y explican cada código en español y en inglés. |
| Finanzas | La aprobación de contratos aprueba precios, explica lo que falta para la activación y avisa que la aerolínea no verá el motivo de una devolución. Paquetes descarta borradores y retira versiones publicadas con motivo. Tarifarios, cargos, unidades y tasas muestran errores por código y unidades en español. Una factura emitida muestra el estado de sus correos. |
| Superadministración | El aprovisionamiento invita por correo por defecto y ofrece vincular una cuenta del portal que ya existe. Clientes asigna una contraseña temporal que cierra una invitación pendiente. Aerolíneas bloquea la identidad de una aerolínea que ya opera. Configuración muestra la bandeja de correos con estado, motivo y referencia. |

Contratos recibe además notificaciones cuando la cuenta del portal queda lista
y cuando Finanzas devuelve o aprueba un borrador. Fuentes:
[Solicitudes](../../frontend/private-web/src/features/contracts/requests/CommercialIntakePage.jsx),
[Borradores](../../frontend/private-web/src/features/contracts/drafts/ManagedDraftsPage.jsx),
[ciclo de vida](../../frontend/private-web/src/features/contracts/agreements/ContractLifecyclePanel.jsx),
[Servicios](../../frontend/private-web/src/features/contracts/catalog/CommercialCatalogPage.jsx),
[Paquetes](../../frontend/private-web/src/features/finance/packages/PackagesPage.jsx),
[bandeja de correos](../../frontend/private-web/src/features/governance/EmailOutboxPanel.jsx) y
[adaptadores](../../frontend/private-web/src/services/README.md).

## Pre-operación (fase 2)

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 2 del ciclo (`50e7778f`), que esa verificación no cubre.

La fase 2 del ciclo operativo
([ADR-0038](../../docs/adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md))
sigue la misma convención de errores, claves y estados de la fase 1. Las fechas
se proponen y se limitan con `businessToday()`
([día hábil](../../frontend/private-web/src/services/businessDay.js)), nunca con
el día UTC del navegador.

| Pantalla | Comportamiento |
| --- | --- |
| Contratos → Contratos | El ciclo de vida termina con la fecha que permite el preaviso firmado o con una causa inmediata, cancela una terminación programada y avisa cuando hay una. El detalle ofrece «Retirar versión» para una versión aprobada que no firmaron ambas partes. La vigencia se envía con su clave, y los estados del contrato salen de un mapa compartido ([estados](../../frontend/private-web/src/features/contracts/contractStatus.js)). El listado todavía muestra «Aprobada» para una versión que espera las firmas. |
| Contratos → Permisos de aerolíneas | «Revocar verificación» con motivo, filtro «Revocados» y un aviso que se arma con los contratos que el servidor activó, reanudó o suspendió. |
| Superadministración | «Estaciones» crea, renombra y desactiva estaciones, y cambia su zona horaria mientras no tienen historia ([panel](../../frontend/private-web/src/features/governance/StationsPanel.jsx)). «Clientes» designa representantes y firmantes de cada aerolínea. Las altas y ediciones de gobernanza envían una clave por intención y explican cada código. |
| OCC → Datos maestros | `/admin-occ/master-data`, con `operations.master_data.read`: terminales y posiciones de la estación, y los tipos de avión compartidos por todas, con alta, edición y desactivación ([pantalla](../../frontend/private-web/src/features/master-data/MasterDataRoute.jsx)). |
| OCC → Cobertura de posiciones | Explica `stand_in_use` cuando se intenta desactivar una posición en uso y enlaza a Datos maestros. El selector de mentor marca y deshabilita a quien tiene una ausencia aprobada o no tiene carnet vigente. |
| OCC → Tablets | `/admin-occ/devices`, con `operations.devices.read`: quién tiene cada tablet compartida, y los botones para liberarla o revocar una perdida ([pantalla](../../frontend/private-web/src/features/devices/DevicesRoute.jsx)). |
| OCC → Planificación | «Importar vuelos» tiene las vistas «Con contrato», «Charter sin contrato» y «Descartadas». Al importar se elige el tipo de avión (con el sugerido preseleccionado) y la posición, o se importa como charter; una propuesta descartada se restaura. El motivo de pausa del proveedor sale en español. «Nuevo vuelo» permite elegir el tipo de avión, que es opcional. El tablero marca «Agente no apto» con sus razones. |
| OCC → Mapa de posiciones | En vivo, el resumen y la leyenda cuentan también «Planificada» y «Sin ocupación verificada». |
| Gestión Humana → Horarios | El editor semanal envía la versión y una clave al quitar un turno, marca los días de ausencia y no ofrece «+» en ellos. «Copiar semana anterior» omite ausencias y agentes que ya salieron y cuenta cada causa. Las solicitudes aprobadas se cancelan o se acortan con motivo («Cancelar ausencia» y «Acortar ausencia»). Las alertas piden `includeReadiness` y explican la ausencia aprobada y el documento vencido. |
| Gestión Humana → Empleados y perfiles de rampa | La baja y el traslado envían una clave y explican qué se libera; un agente con una operación en curso o devuelta no se da de baja ni sale de la rampa (`agent_has_operation_in_progress`). |

La campana muestra los avisos nuevos con su título y destino: los del ciclo del
contrato para Contratos, los vencimientos de documentos para Gestión Humana, y
`agent_released` y `agent_document_not_current` para OCC, que abren
Planificación. Fuentes:
[ciclo de vida](../../frontend/private-web/src/features/contracts/agreements/ContractLifecyclePanel.jsx),
[permisos](../../frontend/private-web/src/features/contracts/permits/AirlinePermitsPage.jsx),
[feed](../../frontend/private-web/src/features/planning/components/ProviderFlightsDialog.jsx),
[editor semanal](../../frontend/private-web/src/features/human-resources/schedules/WeeklyShiftEditor.jsx),
[ausencias](../../frontend/private-web/src/features/human-resources/schedules/AvailabilityRequestsPanel.jsx),
[avisos de departamento](../../frontend/private-web/src/features/notifications/departmentNotifications.js) y
[avisos de OCC](../../frontend/private-web/src/features/notifications/notificationKinds.js).

## La operación (fase 3)

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 3 del ciclo (`f2d5c52c`) y las correcciones de la revisión de sus
bloques A, B y C (`34e90aad`) y D (`3b749a94`), que esa verificación no cubre.

La fase 3 del ciclo operativo
([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md))
sigue la convención de errores, claves y estados de las fases anteriores. Las
etiquetas de estados, servicios, checklist, incidencias, hitos y unidades salen
de un solo
[mapa](../../frontend/private-web/src/features/operations/operationLabels.js), y
las horas locales, de
[`businessDay.js`](../../frontend/private-web/src/services/businessDay.js).

| Pantalla | Comportamiento |
| --- | --- |
| OCC → Planificación | Sin fecha abre el día de hoy de la estación. El detalle de la escala ofrece «Editar vuelo», «Cancelar vuelo» y «Marcar desviado» con `operations.planning.update` y según las acciones que permite el servidor; las horas se escriben en la hora local de la estación. «Nuevo vuelo» y «Editar vuelo» explican el mismo vuelo planificado dos veces («Ese vuelo ya está planificado ese día.»), y «Nuevo vuelo» da de alta la aerolínea mínima de un charter. «Liberar agente» envía la asignación que OCC ve, y «Relevar agente» pasa una operación en curso o devuelta a otro agente elegible, con motivo. Tras el relevo vuelve a leer sus opciones y muestra al agente actual nuevo; «Asistencia compartida» incluye a los agentes relevados después del inicio, como «{nombre} (relevado)», para registrar su asistencia. Si el agente ya tiene turno ese día, «Ajustar turno del día» lo amplía hasta cubrir el vuelo. La elegibilidad explica «Ya tiene 3 operaciones simultáneas» y «necesita un mentor», y el detalle muestra las incidencias de la operación. Ya no ofrece «Crear Work Order» ni «Exportar». |
| OCC → Mapa de posiciones | Los comandos de cada vuelo esperan su versión («Consultando la versión del vuelo…»); si no se puede leer, el vuelo ofrece «Reintentar» o explica el permiso que falta, y la llegada, la asignación y la liberación viajan siempre con su `Idempotency-Key` e `If-Match`. Registra la llegada con la hora local y el tipo de avión: sin tocar la hora, un vuelo que aún no la tiene registra la del servidor al guardar, y cambiar una hora ya informada pide «Motivo del cambio de hora». «Corregir llegada» pide motivo y aparece con `operations.positions_map.assign` aunque la cuenta no tenga Planificación. Desde la primera entrega la llegada ya no se registra ni se corrige. |
| OCC → Revisión | La cola, el detalle y las incidencias se releen solos con `occ_review`. «Aprobar» solo se habilita con la Orden de Servicio firmada o corregida por OCC, y la etiqueta dice su estado. «Excluir de la facturación» y «Volver a facturar» piden motivo para un servicio en excepción con cantidad. Con `operations.review.reopen`, «Reabrir revisión» reabre una aprobación que no se facturó, y esa revisión ya no ofrece «Devolver». El panel «Incidencias de la operación» (`operations.incidents.*`) cambia estados con nota y reporta las de OCC en hora local, también mientras la operación sigue en rampa. Con la operación aprobada o cancelada solo ofrece resolver o cerrar, y un rechazo `operation_closed` explica que sus incidencias quedan como historia y relee la lista. Las marcas del walk-around ofrecen «Ver foto». |
| OCC → Reportes | Exporta el período completo o nada: hasta 25 000 filas en Excel y CSV y 5 000 en PDF. Un período mayor se explica con `report_too_large` y, desde el PDF, sugiere Excel o CSV. «Generado» se muestra en hora local. |
| Gestión Humana → Horarios | «Ajustar horario» cambia con motivo las horas de un turno de hoy o de un día futuro; el servidor rechaza un horario que deje sin cubrir el trabajo del agente. |
| Gestión Humana → Reportes de personal | Clases, documentos y movimientos en español, fechas dd/mm/aaaa y la hora de cada movimiento y de la consulta en hora local. Un conjunto de más de 5 000 filas se rechaza con `report_too_large`, nunca se recorta. |
| Finanzas → Charters | «Reabrir cotización», con motivo, para un charter con el prepago confirmado. |
| Finanzas → Por facturar | Explica el servicio que OCC excluyó en la revisión y el que lleva un cargo que su contrato excluye. Un servicio en excepción facturable que no está listo bloquea su operación, y al emitir la e-CF el rechazo por esos dos motivos se explica en español. «Servicios aprobados», que también lo explicaba, se retiró en la fase 4. |

La campana de OCC muestra `flight_cancelled_by_provider`,
`flight_diverted_by_provider`, `stand_change_unassigned` y
`contract_not_in_force`, que abren Planificación, y Finanzas recibe
`charter_cancelled`, que abre Charters. Donde la respuesta no trae la zona de la
estación (por ejemplo, «Generado» de los reportes o la consulta de los reportes
de personal), la web usa el calendario de `America/Santo_Domingo`, porque la
sesión no trae la zona de cada estación. Fuentes:
[diálogo de cambios de la escala](../../frontend/private-web/src/features/planning/components/TurnaroundChangeDialog.jsx),
[detalle de la escala](../../frontend/private-web/src/features/planning/components/PlanningDrawer.jsx),
[acciones del mapa](../../frontend/private-web/src/features/positions-map/components/PositionActions.jsx),
[revisión](../../frontend/private-web/src/features/review/CanonicalReviewRoute.jsx),
[reportes](../../frontend/private-web/src/features/reports/CanonicalReportsRoute.jsx) y
[charters](../../frontend/private-web/src/features/finance/charters/ChartersPage.jsx).

## Estado de integración

| Capa | Actual | Límite |
| --- | --- | --- |
| UI | Las rutas, componentes, filtros, formularios y estados son ejecutables. | Ejecutable no equivale a flujo de negocio integrado. |
| Autenticación | `authService.js` usa el cliente OpenAPI para crear y revalidar la sesión de Development; tests usan identidades sintéticas. | La sesión en el navegador no sustituye el enforcement del backend por rol y estación. |
| Datos de negocio | Planificación, revisión, chat y notificaciones operativas OCC usan contratos canónicos. Otros servicios combinan snapshots/fixtures y rutas heredadas. Posterior al commit verificado (fase 4, `39a85a46`), Finanzas también usa solo contratos canónicos. | Las formas mock no son OpenAPI vigente. |
| Cliente compartido | Existe una fábrica validada para `@elevant/api-client`. Posterior al commit verificado (fase 1, `8a79fe70`): los comandos de Solicitudes, Borradores, la enmienda, Servicios, clausuras, Paquetes, Aprovisionamiento y Clientes, y la bandeja de correos, usan sus envoltorios validados. Posterior también (fase 4, `39a85a46`): Por facturar, Cobros, Charters e Inicio de Finanzas usan el cliente compartido. | El resto de Contratos y de Finanzas (lista de Facturas, Reportes y Cuentas por pagar) llama a las rutas `/api/v1` de la API sin los validadores del cliente. |
| API real | El build de Development alinea ambas URLs públicas hacia el mismo origen de API. | Posterior al commit verificado (fase 4, `39a85a46`), los módulos de Finanzas usan endpoints reales de la API. Los adaptadores heredados que quedan pueden seguir fallando hasta su migración. |

### Historia: Finanzas antes de la fase 4 (retirado del producto)

Estos párrafos resumen lo que la nota describía antes de la fase 4; nada de
esto existe hoy en la interfaz ni en la API. Finanzas presentaba inicio,
servicios aprobados, prefacturación, seguimiento, tarifas y reportes:

- **Servicios aprobados** leía por estación las líneas de las operaciones
  aprobadas por OCC, con las inconsistencias como líneas bloqueadas, y armaba
  una prefactura interna no fiscal que reservaba cada línea una sola vez.
- **Pre-facturación** listaba las prefacturas, las enviaba a la aerolínea, que
  las aceptaba o las disputaba, respondía cada disputa (mantener o anular) y
  emitía desde una prefactura aceptada una factura no fiscal `NF-…` sin
  impuestos.
- **Seguimiento** consultaba prefacturas aceptadas, facturas no fiscales y
  pagos, y Finanzas podía registrar un pago manual completo de prueba con su
  recibo PDF no fiscal.

La fase 4 retiró esas pantallas, sus servicios, sus permisos (que quedan como
alias en el catálogo) y sus endpoints. Las escrituras que un cliente viejo
todavía puede llamar responden `410 legacy_finance_route_retired`, y el pago
heredado se sigue leyendo por la factura
([controlador de pagos](../../backend/Elevant.Api/Controllers/FinancePaymentsController.cs)).
Las tablas y las migraciones se conservan; ver
[Finanzas](../03-dominio/finanzas-tarifas-cargos-y-cobros.md).

## Desarrollo local

Desde `frontend/private-web`:

```powershell
npm ci
npm test
npm run test:delivery
$env:NEXT_PUBLIC_ELEVANT_API_URL = "https://api.elevant.test"
$env:NEXT_PUBLIC_PROTOTYPE_API_URL = $env:NEXT_PUBLIC_ELEVANT_API_URL
$env:NEXT_PUBLIC_HR_DEMO_MODE = "dashboard-read-only"
npm run dev
npm run build
```

`npm run preview` permite revisar el build local en el puerto `3000`. El runtime de Development usa el servidor standalone en `8080`, detrás de Tailscale y del Compose revisado.

## Pruebas que posee

- pruebas Vitest de páginas, componentes, hooks, mappers y servicios;
- pruebas de rutas Next, autenticación y manejo de sesión expirada;
- smoke de creación del cliente OpenAPI compartido;
- prueba de entrega para validación de entorno, modelo Compose e invariantes de imagen/configuración.

La amplitud de pruebas de UI no prueba la existencia de endpoints .NET de negocio. Para un cambio que cruza HTTP también deben cambiar OpenAPI, el cliente generado y las pruebas de integración del backend.

## Configuración segura

- `NEXT_PUBLIC_ELEVANT_API_URL` configura el cliente OpenAPI compartido.
- `NEXT_PUBLIC_PROTOTYPE_API_URL` conserva temporalmente adaptadores heredados.
- Todo `NEXT_PUBLIC_*` es público y queda en el bundle: nunca contiene token, contraseña, connection string ni secreto de proveedor.
- La configuración certificada exige orígenes HTTPS válidos y que ambas variables representen el mismo origen.
- Un filtro, rol en memoria, ruta protegida o menú oculto nunca reemplaza la autorización de la API.

Usa [`.env.example`](../../frontend/private-web/.env.example) como forma, no como archivo para credenciales reales.

## Objetivo de integración

Cada feature debe consumir un endpoint versionado a través de un adaptador remoto separado de los componentes, representar carga/éxito/vacío/error/no autorizado y dejar que la API derive identidad y scopes. Los cambios incompatibles requieren una secuencia coordinada API-first; la web no debe inferir DTOs a partir de un fixture.

## Brechas y desconocidos

- **Brecha cerrada:** posterior al commit verificado de esta nota (código de `39a85a46`), la API autentica con JWT y refresh rotativo ([ADR-0021](../../docs/adr/0021-rotating-refresh-tokens.md)) y autoriza en el servidor cada caso de uso con los permisos del departamento ([ADR-0015](../../docs/adr/0015-department-user-governance.md)) y el alcance de estaciones de la cuenta; los shells solo muestran los módulos que permite `GET governance/me/access`.
- **Brecha cerrada:** posterior al commit verificado de esta nota (código de `39a85a46`), las rutas de negocio que usan estas vistas están en el [snapshot OpenAPI](../../packages/api-client/openapi/elevant-v1.json), que publica 400 operaciones. Solo dos adaptadores heredados conservan rutas del prototipo fuera de él: la fuente `legacy` del contador de notificaciones y `reportsService`; ninguna vista montada los usa.
- **Brecha cerrada:** posterior al commit verificado de esta nota (código de `39a85a46`), los hubs de operaciones y de notificaciones anuncian `ChangedV1` cuando el despachador está encendido (`true` en `appsettings.Development.json`), y la web lee el cursor de `getAccountChanges` y relee por REST lo que cambió ([feed de cambios](../04-arquitectura/feed-de-cambios-operativos.md)). Planificación importa los vuelos del feed AeroDataBox de la API, apagado por defecto y con presupuesto de unidades ([ADR-0028](../../docs/adr/0028-aerodatabox-flight-feed-with-unit-budget.md)).
- **Brecha cerrada:** posterior al commit verificado de esta nota (código de `39a85a46`), la API guarda en un bucket S3 privado, con metadatos y SHA-256 en SQL, los archivos que suben estas vistas (fotos y videos de servicios, logos de aerolíneas, fotos de perfil y comprobantes de Cuentas por pagar) y las fotos del walk-around que OCC abre en los documentos de la operación ([medios privados](../04-arquitectura/medios-comerciales-privados.md)). La retención y el antivirus siguen abiertos ([brechas del dominio](../03-dominio/brechas-y-preguntas-abiertas.md)).
- **Desconocido:** orden aprobado para migrar cada módulo desde el prototipo.
- **Desconocido:** roles, permisos y criterios finales de aceptación de cada recorrido; deben acordarse antes de convertirlos en contratos.

## Fuentes y relaciones

- [README del cliente](../../frontend/private-web/README.md)
- [Rutas Next actuales](../../frontend/private-web/app/layout.jsx)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)
