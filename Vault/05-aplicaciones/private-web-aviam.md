---
id: aplicaciones-private-web-aviam
title: "Private Web / AVIAM"
type: architecture
area: private-web
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-13"
verified_commit: "0061b13b349f777e886889da28241e0e41efc589"
sources:
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
  - frontend/private-web/src/features/finance/preinvoices/PreinvoicesPage.jsx
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
VPS. Fuentes locales: [API](../../backend/Elevant.Api/Controllers/HumanResourcesReportsController.cs),
[consulta EF](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesReportStore.cs),
[cliente compartido](../../packages/api-client/src/client.ts),
[vista](../../frontend/private-web/src/features/human-resources/reports/CurrentReportsPage.jsx)
y [servicio de sesión](../../frontend/private-web/src/services/humanResourcesVerifiedReportsService.js).

### Contratos y Finanzas

> [!note] Rama `feat/finance-refinement`
> Finanzas agrupa en «Tarifarios» el tarifario de servicios (tarifa base versionada por moneda), el tarifario de cargos (catálogo CRUD e importes) y las tasas de cambio; añade «Aprobación de contratos» (precio contra base, aprobar o devolver con motivo) y sustituye «Seguimiento» por «Facturas y cobros» (saldo, vencimiento, pagos parciales y notas de crédito). Pre-facturación muestra cargos y ajustes bajo cada servicio y permite editarlos en borrador con motivo. Reportes lee ocho reportes del servidor y exporta CSV/PDF. Contratos envía a Finanzas en lugar de activar y ve precio base y diferencia. Cada módulo se muestra según los permisos `finance.*`. El texto siguiente describe el estado anterior. Ver [Finanzas: tarifarios, cargos y cobros](../03-dominio/finanzas-tarifas-cargos-y-cobros.md).

`/contratos` y `/finanzas` son shells protegidos que cambian módulos mediante estado interno, no rutas independientes para cada pestaña. Contratos presenta inicio, contratos, borradores, solicitudes, servicios, servicios pactados y reportes. Finanzas presenta inicio, servicios aprobados, prefacturación, seguimiento, tarifas y reportes. El chat departamental heredado está diferido: ambos shells ocultan «Comunicaciones» porque `/api/internal-chat/messages` no existe en la API canónica ni persiste en SQL; esto no afecta el chat operativo OCC–agente. En el worktree local, Inicio de Finanzas combina lecturas autorizadas de servicios aprobados y prefacturas por estación: hasta 200 servicios de los últimos 30 días y la primera página de 50 prefacturas, no totales históricos. Reportes agrupa los estados de esa primera página por aerolínea y moneda, sin inventar importes ni exportaciones. Ambas vistas revalidan con cambio durable, foco y polling de 25 segundos. Tarifas consulta versiones contractuales publicadas y paginadas para una estación autorizada mediante `GET /api/v1/finance/tariffs`; conserva cuatro decimales y distingue versiones históricas. La activación de un contrato genera una pista durable `finance_tariffs` para Finanzas, con revalidación del alcance en el feed. Se retiró la acción local de «Programar cambio» que no persistía. Seguimiento consulta prefacturas aceptadas, facturas no fiscales y pagos manuales mediante `GET /api/v1/finance/reconciliation`, con revalidación por `finance_preinvoices`, foco y polling. No acredita conciliación bancaria y retiró la acción local «Conciliar». El buzón heredado está oculto para ambos roles, evitando `/api/notifications`. Nada de esto acredita despliegue al VPS. Fuentes: [servicio de inicio](../../frontend/private-web/src/services/financeHomeService.js), [vista de reportes](../../frontend/private-web/src/features/finance/reports/FinanceReportsPage.jsx), [vista de tarifas](../../frontend/private-web/src/features/finance/tariffs/TariffsPage.jsx), [vista de facturas y cobros](../../frontend/private-web/src/features/finance/invoices/InvoicesPage.jsx), [controlador financiero](../../backend/Elevant.Api/Controllers/FinanceReconciliationController.cs) y [persistencia](../../database/DevelopmentDB/Elevant.Persistence/Finance/EfFinanceReconciliationReadStore.cs).

En esta rama, **Contratos**, **Servicios pactados** y **Reportes contractuales** comparten `GET /api/v1/contracts/agreements`, que lee versiones aprobadas y reemplazadas, estaciones y tarifas desde SQL con permiso comercial interno. La tabla diferencia los precios históricos y muestra cuatro decimales; los indicadores del reporte se limitan expresamente a la página consultada. Ya no se montan sus adaptadores `/api/contracts/*` ni botones de alta, edición y exportación auditada ficticia. La consulta no sustituye el flujo de borradores ni crea contratos; falta validación de navegador y promoción remota.

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

- **Brecha actual:** autenticación y autorización reales no existen en la API compartida.
- **Brecha actual:** las rutas de negocio usadas por servicios heredados no están en el OpenAPI vigente.
- **Brecha actual:** SignalR y el proveedor de vuelos están reservados, no entregan datos reales a estas vistas.
- **Brecha actual:** carga de evidencias requiere una capacidad de object storage todavía no diseñada.
- **Desconocido:** orden aprobado para migrar cada módulo desde el prototipo.
- **Desconocido:** roles, permisos y criterios finales de aceptación de cada recorrido; deben acordarse antes de convertirlos en contratos.

## Fuentes y relaciones

- [README del cliente](../../frontend/private-web/README.md)
- [Rutas Next actuales](../../frontend/private-web/app/layout.jsx)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)
