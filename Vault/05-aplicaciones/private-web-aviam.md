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
  - frontend/private-web/src/features/admin-occ/AdminOccLayout.jsx
  - frontend/private-web/src/features/admin-occ/shell/OccTopbar.jsx
  - frontend/private-web/src/features/shell/ShellFrame.jsx
  - frontend/private-web/src/features/shell/useTheme.jsx
  - frontend/private-web/src/styles/occ.css
  - frontend/private-web/tailwind.config.js
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
| Integración externa | El navegador no conecta directamente a SQL Server, FlightAware ni proveedores de datos aeronáuticos. Como excepción visual verificable, los mapas cargan estilos y teselas cartográficas públicas de MapLibre/OpenFreeMap permitidas explícitamente por CSP. *Posterior al commit verificado (PR M2):* los mapas del OCC llevan su propio estilo en el bundle y de OpenFreeMap solo piden teselas y glifos; los dos mapas auxiliares del dashboard conservan los estilos publicados hasta U3. |
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

El espacio OCC tiene marco propio: un riel de navegación colapsable agrupado en En vivo, Planificar, Revisar y Estación, con la marca oficial completa, y una barra de estado con la estación, el módulo activo, el enlace en vivo, las fuentes, las alertas, la hora local y la UTC del reloj del equipo, el idioma (español/inglés), la leyenda y la cuenta. Lo introdujo la rama `feat/adminocc-redesign`, con el riel agrupado en Monitoreo, Operación, Comunicación y Administración y dibujado en azul marino, una barra contextual con los avisos y el cambio de tema. Desde el PR U1 el OCC es solo oscuro, con el riel en pizarra y sin botón de tema, y desde el PR U2, posterior al commit verificado, el riel sigue la jornada del controlador y la barra es de estado: ver [Sistema visual NOC del OCC (PR U1)](#sistema-visual-noc-del-occ-pr-u1) y [Marco del OCC (PR U2)](#marco-del-occ-pr-u2). Desde el PR U4, también posterior al commit verificado, la primera entrada al OCC de cada pestaña después de iniciar sesión pasa por una pantalla de arranque: ver [Pantalla de arranque del OCC (PR U4)](#pantalla-de-arranque-del-occ-pr-u4). Los demás departamentos conservan su marco; el cambio es opcional por departamento (`ShellFrame` acepta componentes y `data-department`). Los destinos y permisos de navegación no cambian. Fuentes: [layout OCC](../../frontend/private-web/src/features/admin-occ/AdminOccLayout.jsx), [riel](../../frontend/private-web/src/features/admin-occ/shell/OccSidebar.jsx), [barra](../../frontend/private-web/src/features/admin-occ/shell/OccTopbar.jsx) y [tokens](../../frontend/private-web/src/styles/occ.css).

En el árbol local posterior al commit verificado, «Estación → Mis gastos» aparece en el riel OCC y abre `/admin-occ/expenses`, también desde el menú móvil. El enlace no concede permisos: la API determina los gastos y acciones disponibles para la cuenta. Fuentes: [navegación OCC](../../frontend/private-web/src/features/admin-occ/navigation.js), [riel OCC](../../frontend/private-web/src/features/admin-occ/shell/OccSidebar.jsx) y [ruta de gastos](../../frontend/private-web/app/admin-occ/expenses/page.jsx).

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

Fuentes de implementación local: [vista](../../frontend/private-web/src/features/dashboard/DashboardPage.jsx), [catálogo](../../frontend/private-web/src/features/dashboard/dashboardPositions.js), [meteorología](../../frontend/private-web/src/features/dashboard/console/WeatherPanel.jsx), [teselas](../../frontend/private-web/src/services/satelliteService.js), [capas de posiciones](../../frontend/private-web/src/features/maps/stands/standLayers.js) y [CSP](../../frontend/private-web/src/config/securityHeaders.mjs).

La validación del rediseño anterior (27/27 pruebas enfocadas, test:delivery 22/22, lint, typecheck y build; navegador 375–1440 px) precede a esta integración. Sus resultados no acreditan las pruebas ni una conexión OpenSky real de esta rama. Los controles nuevos se registran en el handoff; la metadata de verificación superior conserva su commit histórico. Ninguno de estos cambios locales se ha desplegado.
Monitoreo OCC usa el alcance PUJ de la sesión e ignora un enlace a otra estación. La lectura inicial y el refresco de 30 segundos consultan esa misma estación; el refresco reemplaza la lista completa y una falla retira los vuelos antiguos hasta recuperación o reintento. Las horas provienen de planificación; no se presentan coordenadas de aeronaves no verificadas. Solo PUJ tiene coordenadas cartográficas revisadas, por lo que otra estación no muestra un mapa de PUJ. Esto no acredita datos aeronáuticos en vivo ni promoción remota. Fuentes: [servicio de monitoreo](../../frontend/private-web/src/services/flightMonitoringService.js) y [ruta](../../frontend/private-web/src/features/flight-monitoring/FlightMonitoringRoute.jsx).

En esta rama, las vistas de PUJ usan MapLibre. *Posterior al commit verificado:*
desde el PR M2 ya no existen las variantes de Google Maps ni su cargador, y los
mapas de PUJ comparten un solo motor (ver
[Mapas del OCC en un solo motor (PR M2)](#mapas-del-occ-en-un-solo-motor-pr-m2)).
El mapa base de Monitoreo se monta aunque ningún vuelo tenga
coordenadas verificadas, con un aviso que distingue cartografía de telemetría.
El worker y el módulo compartido del paquete se copian juntos desde la
dependencia fijada antes de desarrollo y build; la certificación comprueba que
la imagen sirve ambos archivos. Desde MapLibre 6.13 el worker es autocontenido
y el módulo compartido llega vacío; la verificación del build exige que todo
módulo que el worker importe esté entre los archivos copiados. Esta evidencia
es local y de CI; la disponibilidad remota requiere la promoción y comprobación
del operador. Fuentes: [vista de
Monitoreo](../../frontend/private-web/src/features/flight-monitoring/FlightMonitoringPage.jsx),
[mapa de posiciones](../../frontend/private-web/src/features/positions-map/components/PositionMap.jsx),
[script de copia](../../frontend/private-web/scripts/copy-maplibre-worker.mjs),
[verificación del build](../../frontend/private-web/scripts/verify-maplibre-worker.mjs) y
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
contrato para Contratos y los vencimientos de documentos para Gestión Humana.
En OCC, `agent_released` y `agent_document_not_current` abren Planificación;
desde el PR U2 no los muestra una campana, sino el cajón «Alertas y avisos» de
la barra de estado ([Marco del OCC](#marco-del-occ-pr-u2)). Fuentes:
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

En OCC, `flight_cancelled_by_provider`, `flight_diverted_by_provider`,
`stand_change_unassigned` y `contract_not_in_force` abren Planificación. Antes
los mostraba la campana; desde el PR U2, posterior al commit verificado, el
botón de alertas de la barra de estado los cuenta como «Atención» y abre el
cajón «Alertas y avisos», donde cada uno ofrece «Recibido» y «Abrir»
([Marco del OCC](#marco-del-occ-pr-u2)). Finanzas recibe `charter_cancelled`,
que abre Charters. Donde la respuesta no trae la zona de la
estación (por ejemplo, «Generado» de los reportes o la consulta de los reportes
de personal), la web usa el calendario de `America/Santo_Domingo`, porque la
sesión no trae la zona de cada estación. Fuentes:
[diálogo de cambios de la escala](../../frontend/private-web/src/features/planning/components/TurnaroundChangeDialog.jsx),
[detalle de la escala](../../frontend/private-web/src/features/planning/components/PlanningDrawer.jsx),
[acciones del mapa](../../frontend/private-web/src/features/positions-map/components/PositionActions.jsx),
[revisión](../../frontend/private-web/src/features/review/CanonicalReviewRoute.jsx),
[reportes](../../frontend/private-web/src/features/reports/CanonicalReportsRoute.jsx) y
[charters](../../frontend/private-web/src/features/finance/charters/ChartersPage.jsx).

## Vuelo demo (OCC a nivel NOC, PR A1)

Posterior al commit verificado de esta nota: esta sección describe el código de
`cba00f73`, que esa verificación no cubre
([ADR-0041](../../docs/adr/0041-demo-flights-and-punta-cana-stands.md)).

| Pantalla | Comportamiento |
| --- | --- |
| Superadministración → Configuración | El panel «Vuelo demo», encima de «Correo del sistema», dice si el entorno lo permite. «Disparar vuelo demo» pide estación, aerolínea con contrato vigente hoy, origen, destino («El mismo aeropuerto» por defecto), tipo de avión, «Sin posición» o una posición libre, «Llega a la posición en (minutos)» (de 2 a 30, con atajos de 3, 5, 8 y 15) y «Tiempo en tierra (minutos)» (de 20 a 240, 60 por defecto). «Vuelos demo de hoy» muestra cada vuelo con su fase («En aproximación», «Aterrizó, rueda a la posición», «En posición», «Saliendo», «Despegó», «Terminado» o «Cancelado») y su cuenta regresiva, calculadas en el navegador con el reloj del servidor; si OCC ya lo importó, con qué código y en qué posición, y «Cancelar vuelo» antes de tocar pista o «Terminar demo» después, con su confirmación y su `Idempotency-Key`. Se relee cada 5 segundos mientras un avión se mueve y cada 20 si no, nunca con la pestaña oculta. Las opciones del formulario cambian con la hora (el aviso `crosses_local_midnight`, las aerolíneas con contrato vigente hoy y las posiciones libres): se releen con la lista cuando tienen 5 minutos, y al volver a la pestaña o a su ventana (al recuperar el foco) el panel relee las opciones y la lista enseguida. Cada código se explica en español; apagado, el panel dice que los vuelos demo solo funcionan en el entorno de desarrollo. |
| OCC → Planificación → «Importar vuelos» | Los tramos de un vuelo demo llevan la etiqueta «Demo». El diálogo relee con `occ_planning` sin perder lo elegido; la posición cuyo código normalizado coincide con la puerta de la llegada demo viene preseleccionada («Posición (sugerida)»: `A01` es `A1`), y las posiciones van en orden natural (A1, A2, A10). Un vuelo demo no necesita «Actualizar ahora». |
| OCC → Planificación, Mapa de posiciones y Panorama | La tarjeta del vuelo, el cajón de la posición y la fila del tablero muestran «Demo» cuando la API marca la escala con `isDemo`: la palabra sobre rayas a 45°, sin color ([etiqueta](../../frontend/private-web/src/features/occ-ui/DemoTag.jsx)). |

En ese corte no existían la tarjeta «Posiciones de Punta Cana» ni la posición
«Al azar», que llegan con el PR A2 (abajo); el avión demo en los mapas sigue
pendiente. Fuentes:
[panel](../../frontend/private-web/src/features/governance/DemoFlightsPanel.jsx),
[estado del vuelo](../../frontend/private-web/src/features/governance/demoFlightStatus.js),
[servicio](../../frontend/private-web/src/services/demoFlightsService.js),
[códigos de posición](../../frontend/private-web/src/services/standCodes.js) y
[diálogo de importación](../../frontend/private-web/src/features/planning/components/ProviderFlightsDialog.jsx).

## Posiciones de Punta Cana y posición al azar (OCC a nivel NOC, PR A2)

Posterior al commit verificado de esta nota: esta sección describe el código
del PR A2 (`d6461fa1` a `ff066d47`), que esa verificación no cubre
([ADR-0041](../../docs/adr/0041-demo-flights-and-punta-cana-stands.md)).

| Pantalla | Comportamiento |
| --- | --- |
| Superadministración → Configuración | Encima del formulario, la tarjeta «Posiciones de Punta Cana» cuenta las terminales y las posiciones del catálogo que tiene la estación y cuántas de sus posiciones están ubicadas en el mapa («Terminales: 3 de 3 · Posiciones: 41 de 41 · Ubicadas en el mapa: …»). «Cargar posiciones» crea, con su `Idempotency-Key`, lo que falte, sin coordenadas y sin tocar lo que ya existe; con todo cargado, la tarjeta lo dice y no muestra el botón. Nombra las posiciones fuera del plano (B01 y B02 en la semilla) y, si una carga no pudo crear alguna porque su terminal o la posición están desactivadas, cuáles faltan. El aviso de la carga dice si se cargó todo o cuántas posiciones se cargaron; si la carga no creó nada, no da aviso de éxito. En otra estación dice que solo Punta Cana tiene un plano de referencia. En «Disparar vuelo demo», «Posición» ofrece «Al azar» por defecto (el servidor elige entre las posiciones con un agente elegible a esa hora), «Sin posición» y todas las posiciones: las elegibles dicen quién las cubre y las demás van deshabilitadas con su motivo. Al cambiar el tipo de avión o los minutos, el panel relee las posiciones para esa escala. Si ninguna tiene un agente elegible, avisa con los motivos y ofrece «Disparar sin posición» y la indicación «Crear cobertura»: lo hace OCC en «Cobertura de posiciones», con una cuenta de OCC (por ejemplo, en otro navegador o en una ventana privada); no es un enlace porque esa pantalla no se abre con la cuenta de superadministración. Si la estación no tiene ningún tipo de fuselaje estrecho, el panel relee las posiciones para el tipo de fuselaje ancho que envía por defecto. Cada código se explica en español. |
| OCC → Mapa de posiciones y mapa de Planificación | Leen el tablero de posiciones, que da libre una posición en cuanto la tablet registra el `PUSHBACK` de su vuelo: ya no lo lista en la posición ni entre los vuelos sin posición. Planificación, los documentos y la tablet siguen nombrando la posición del vuelo, y «Liberar» sigue cerrando la asignación a mano. |

La B33, retirada por la enmienda AIP de 2026, lleva `retired: true` en el
conjunto de datos del mapa. El mapa de rampa del Panorama, el Mapa de
posiciones y el mapa de Planificación la omiten por esa marca, no por su
código: de la referencia dibujan las 41 posiciones que crea la carga. Los dos
últimos leen el tablero de posiciones y dibujan además las que OCC colocó,
también una B33, donde OCC la puso. Fuentes:
[panel](../../frontend/private-web/src/features/governance/DemoFlightsPanel.jsx),
[motivos de una posición](../../frontend/private-web/src/features/governance/demoStandReasons.js),
[servicio](../../frontend/private-web/src/services/demoFlightsService.js),
[datos del mapa](../../frontend/private-web/src/features/dashboard/positionsData.js),
[posiciones del tablero](../../frontend/private-web/src/features/dashboard/dashboardPositions.js) y
[mapeadores del mapa](../../frontend/private-web/src/features/positions-map/positionsMapMappers.js).

## Sistema visual NOC del OCC (PR U1)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR U1 «Fundaciones visuales» (`9a4360fa`, `91cc9675` y `aca575ff`), que esa
verificación no cubre. Las decisiones, los valores de los tokens y lo que
añadirán los PR siguientes están en
[ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md). U1 no cambia la
estructura de ninguna pantalla: los textos, roles, nombres accesibles y
`data-testid` del OCC son los mismos, salvo el botón de tema, que desaparece.

- **Solo oscuro, sin botón de tema.** Bajo `/admin-occ` el tema es siempre
  oscuro desde el primer pintado.
  [`app/layout.jsx`](../../frontend/private-web/app/layout.jsx) pone en
  `<head>` un script con el nonce de la petición que añade la clase `dark` solo
  en rutas del OCC ([`occTheme.js`](../../frontend/private-web/src/features/shell/occTheme.js));
  la CSP no cambia. Dentro del OCC,
  [`ThemeProvider`](../../frontend/private-web/src/features/shell/useTheme.jsx)
  ignora el tema guardado, `toggleTheme` no hace nada y `elevant-theme` no se
  escribe. La [barra del OCC](../../frontend/private-web/src/features/admin-occ/shell/OccTopbar.jsx)
  y el panel de vista previa de desarrollo ya no tienen botón de tema, y el
  mapa de Planificación ya no se dibuja en claro. Los demás departamentos
  conservan el tema de la cuenta, que vuelve al salir del OCC.
- **Un solo juego de tokens.**
  [`occ.css`](../../frontend/private-web/src/styles/occ.css) define los
  valores `--occ-*` una sola vez sobre `[data-department='occ']`, sin bloque
  claro: pizarra neutra (fondo `#161E22`, paneles `#20282D`, riel `#0F161A`),
  texto `#E8EEF1`, cian `#6FD4F5` para lo elegido o accionable, ámbar `#FDC14F`
  para atención y rojo `#F5746D` para urgente; lo normal no lleva color.
  Manrope con peso 500, que antes solo se aplicaba al dashboard, cubre todo el
  OCC. Los seis nombres `--occ-ui-*` que el chat leía sin que nadie los
  definiera son ahora alias de los tokens: el chat vuelve a tener fondos y
  bordes. [`tailwind.config.js`](../../frontend/private-web/tailwind.config.js)
  suma `panel-raised`, `panel-float`, `faint`, `warn-soft` y `danger-soft`, y
  retira `signal`. No todos los tokens tienen clase: `--occ-field`,
  `--occ-primary`, `--occ-primary-hover`, los `--occ-on-*`, los `--occ-*-fill`
  y `--occ-scrim` solo existen como variables CSS hasta que un PR añada su
  llave, y una guarda falla si una clase de color `occ-*` nombra un color sin
  llave. Una clase `occ-*` nunca lleva modificador de opacidad: Tailwind no la
  genera.
- **Puente de estilos heredados.** La mayoría de las pantallas del OCC todavía
  usa clases heredadas (`bg-white`, `dark:bg-surface-dark-card`,
  `text-text-secondary-*`…). La hoja
  [`occ-legacy-bridge.css`](../../frontend/private-web/src/styles/occ-legacy-bridge.css),
  generada desde su [manifiesto](../../frontend/private-web/src/styles/occLegacyBridgeMap.js)
  por [`occLegacyBridge.js`](../../frontend/private-web/src/styles/occLegacyBridge.js),
  las repinta con los tokens oscuros, quita sombras y desenfoque y ajusta los
  radios, solo bajo `[data-department="occ"][data-occ-bridge]`.
  `AdminOccLayout` pone ese atributo con `rootAttributes` de
  [`ShellFrame`](../../frontend/private-web/src/features/shell/ShellFrame.jsx);
  quitarlo apaga el puente entero. Los estados normales quedan sin color: el
  ámbar solo pinta la atención, el rojo lo urgente y el cian lo elegido o
  accionable. La franja de estado que las tarjetas de Planificación y las filas
  de Monitoreo de vuelos y del mapa de posiciones pintan en línea pasa a junta,
  con la única regla `!important` del puente. Fuera del puente, `occ.css`
  repinta las tarjetas de
  las tablas apiladas (`table-stack`, que
  [`tokens.css`](../../frontend/private-web/src/styles/tokens.css) dibuja con
  `@apply`) y el foco y la selección del chat. Las
  [guardas](../../frontend/private-web/src/styles/occStyleGuard.test.js) fallan
  si la hoja se desvía del manifiesto, si un archivo montado bajo
  `/admin-occ` usa una clase de color heredada sin correspondencia o si una
  hoja global copia con `@apply` un color heredado que el OCC no repinta; hoy
  son 290 archivos, 106 de ellos con clases heredadas. Usuarios, Mis gastos y
  los componentes de `src/components` se quedan en el puente porque los
  comparten otros departamentos; fuera del OCC no cambian.
- **Vocabulario.**
  [`occPalette.js`](../../frontend/private-web/src/features/occ-ui/occPalette.js)
  da los mismos colores a quien no lee variables CSS (mapas, iconos dibujados
  en código), con una prueba de paridad contra `occ.css`.
  [`statusVocabulary.js`](../../frontend/private-web/src/features/occ-ui/statusVocabulary.js)
  fija los siete estados de posición (Libre, Planificada, Llegando, Ocupada,
  Por liberar, Inhabilitada y Sin verificar), las marcas «Demo», «est.», «No
  oficial» y «Sin actualizar desde las {hora}», las tres señales (Atención,
  Urgente y Aviso) y cuándo una visita está «En operación».
  [`occShortcuts.js`](../../frontend/private-web/src/features/occ-ui/occShortcuts.js)
  fija las ocho teclas de los mapas (`1` a `4`, `D`, `S`, `L` y `Esc`) y sus
  reglas. Ninguna pantalla los usa todavía.

Límites: hasta que monta el marco se ve el fondo azul marino de `body`
(`#0A1220`) y luego la pizarra del OCC; queda para la pantalla de arranque que
planifica el ADR. Desde el PR U4, posterior al commit verificado, esa pantalla
lo cubre solo en parte (ver
[Pantalla de arranque del OCC (PR U4)](#pantalla-de-arranque-del-occ-pr-u4)).
El texto menor de 12 px y los rótulos en mayúsculas de las pantallas heredadas
siguen hasta que cada una se migre. Las leyendas, el
resumen y los marcadores de Monitoreo de vuelos y del mapa de posiciones aún
pintan sus colores de estado en línea, y el tablero de escalas del dashboard
marca en cian los estados planificados; los rehacen el carril de mapas, U3 y
U5. El contraste se
comprobó por cálculo, con pruebas: el texto mide 12,8:1 sobre los paneles y el
mínimo, rojo sobre la losa, 4,6:1. Nada de esto acredita un despliegue ni una
revisión visual en el VPS.

## Marco del OCC (PR U2)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR U2 «Marco del OCC» (`1afe6820`, `debecb1e`, `2d30d7fe` y `a7ef7a4f`), que esa
verificación no cubre. Las decisiones, el presupuesto de peticiones y lo que
queda aplazado están en la nota del 13 de noviembre de 2026 de
[ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md). U2 cambia solo el
marco: no reestructura ninguna pantalla, y cada una pasa al proveedor en el PR
que la rehace (U3, U5 y U6).

- **Un proveedor por pestaña.**
  [`OccShellProvider`](../../frontend/private-web/src/features/admin-occ/shell/OccShellProvider.jsx)
  abre el único observador de cambios del marco y lee una sola vez los avisos
  operativos para la barra, el riel, el cajón y los toasts. En el OCC,
  [`RoleLayout`](../../frontend/private-web/src/app/RoleLayout.jsx) apaga el
  observador propio del acceso del departamento, que el marco relee con
  `department_users` y `access_requests`, y `AppShell` ya no lee avisos ni
  pinta toasts. Las lecturas del marco pasan por
  [`useOccResource`](../../frontend/private-web/src/features/admin-occ/live/useOccResource.js):
  solo leen con su permiso, se repiten como mucho una vez cada 3 s, esperan con
  la pestaña oculta, tienen un sondeo de seguridad de 60 s y se detienen tras un
  401, 403 o 404 hasta que cambia el acceso. La
  [prueba de presupuesto](../../frontend/private-web/src/features/admin-occ/live/occRequestBudget.test.js)
  falla si el plan de peticiones de una pestaña pasa de 40 por minuto en reposo
  o de 70 durante un minuto de vuelo demo, y exige que el
  [inventario](../../frontend/private-web/src/features/admin-occ/live/occRequestPlan.js)
  nombre cada observador que queda bajo `/admin-occ`, con el PR que lo mueve.
- **Barra de estado.** La
  [barra](../../frontend/private-web/src/features/admin-occ/shell/OccTopbar.jsx)
  mide 48 px en todas las pantallas del OCC. Muestra la placa «PUJ» (y «Punta
  Cana» desde 1280 px), el nombre del módulo, el enlace en vivo («En vivo»,
  «Reconectando», «Sin tiempo real» o «Sin conexión», cada uno con su forma y
  una frase que lo explica), las fuentes («Fuentes al día» o cuántas van con
  retraso, con su lista), las alertas, la hora local y la UTC del equipo, el
  idioma, «Leyenda» y la cuenta. Ya no muestra las claves `nav.master-data` ni
  `nav.devices`: dice «Datos maestros» y «Tablets». Por debajo de 1024 px, la
  leyenda y el idioma pasan al menú de la cuenta; por debajo de 640 px quedan el
  menú, la placa, los glifos del enlace y de las alertas (con su número), la
  hora local y la cuenta
  ([reglas de ancho](../../frontend/private-web/src/features/admin-occ/shell/status/statusBarLayout.js)).
  «Leyenda» lee los estados de posición, las señales y las marcas de
  [`statusVocabulary.js`](../../frontend/private-web/src/features/occ-ui/statusVocabulary.js).
  No hay botón de tema, modo muro ni búsqueda.
- **Alertas y avisos.** El
  [modelo de alertas](../../frontend/private-web/src/features/dashboard/noc/alertModel.js)
  da la prioridad: «Urgente», toda incidencia; «Atención», la desviación, el
  vuelo cancelado o desviado por el proveedor, el agente liberado, la operación
  sin agente elegible y el documento o el contrato no vigente; el resto,
  «Aviso». El botón de alertas cuenta las urgentes y las de atención sin recibir
  y abre el
  [cajón «Alertas y avisos»](../../frontend/private-web/src/features/admin-occ/shell/OccAlertsDrawer.jsx),
  con las alertas sin recibir primero, los avisos recientes y «Ver historial de
  avisos». Si la primera lectura de los avisos falla, el botón dice «Alertas:
  sin datos» con el triángulo ámbar; si falla una relectura, conserva el último
  número atenuado, con «, sin actualizar», y su descripción accesible da la
  hora de la última lectura buena. Por debajo de 1536 px, «: sin datos» y
  «, sin actualizar» quedan para los lectores de pantalla. En los dos casos el
  cajón ofrece «Reintentar».
  «Recibido» es el recibo de lectura por cuenta que ya existía
  (`PUT notifications/{id}/read`), así que el conteo es el mismo en todas las
  pantallas y después de recargar. Los
  [toasts](../../frontend/private-web/src/features/admin-occ/shell/occToastQueue.js)
  salen arriba a la derecha, bajo la barra: tres como mucho, 15 s los urgentes,
  10 s los de atención y 8 s los avisos. Con el cajón abierto no se dibujan: lo
  que llega se anuncia dentro del cajón (el urgente, como alerta), y al cerrarlo
  no reaparece. Solo parpadea el glifo de una alerta urgente sin recibir, y
  nunca con movimiento reducido.
- **Riel.** El
  [riel](../../frontend/private-web/src/features/admin-occ/shell/OccSidebar.jsx)
  agrupa los mismos 14 módulos en
  [En vivo, Planificar, Revisar y Estación](../../frontend/private-web/src/features/admin-occ/navigation.js),
  con las mismas rutas y permisos. Chat interno, Revisión y Notificaciones
  llevan una placa neutra con sus avisos sin leer. Con el riel plegado, cada
  módulo muestra su nombre al pasar el puntero o al recibir el foco. Ya no hay
  tarjeta de identidad: la estación está en la barra.
  [«Saltar al contenido»](../../frontend/private-web/src/features/admin-occ/shell/OccSkipLink.jsx)
  es el primer elemento enfocable del marco.
- **Primitivas y guardas.** U2 crea en `src/features/occ-ui` las primitivas que
  necesita el marco (glifo de señal, placa, muestra de estado, panel emergente,
  cajón, cola de alertas y pila de toasts), con sus textos en
  [`occUiMessages.js`](../../frontend/private-web/src/features/occ-ui/occUiMessages.js).
  [`ShellFrame`](../../frontend/private-web/src/features/shell/ShellFrame.jsx)
  acepta `mainVariant`: `'scroll'`, por defecto e igual que antes, o `'fill'`,
  que el OCC aún no usa.
  [`tailwind.config.js`](../../frontend/private-web/tailwind.config.js) suma las
  llaves `primary`, `primary-hover`, `on-primary` y `scrim`. Las carpetas
  `admin-occ/shell` y `admin-occ/live` entran en `MIGRATED_FOLDERS` del
  [manifiesto del puente](../../frontend/private-web/src/styles/occLegacyBridgeMap.js):
  allí no se admite ninguna clase de color heredada.

Límites: la lista de avisos trae los 100 más recientes, así que, si hay más,
los conteos son un mínimo. Un recibo no se anuncia por el feed. Lo que se marca
como leído o no leído en Notificaciones llega al marco enseguida, porque la
página le pide que relea los avisos, como mucho una vez cada 3 s. Lo que se
marca en otra pestaña llega con el siguiente aviso o, como mucho, a los 60 s.
Panorama, Monitoreo de vuelos, Mapa de posiciones, Planificación, Cobertura de
posiciones, Datos maestros, Tablets, Chat interno y Notificaciones conservan su
propio observador hasta U3, U5 o U6, y Usuarios y Mis gastos, el suyo. Quedan
aplazados el modo muro, la búsqueda, los atajos con su diálogo, el aviso de
desfase del reloj, la severidad de cada incidencia y el acuse compartido por
estación. Las pruebas cubren el marco en jsdom; nada de esto acredita un
despliegue ni una revisión visual en el VPS.

## Pantalla de arranque del OCC (PR U4)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR U4 «Pantalla de arranque del OCC» (`4eda1303` y `bcfd6fd7`), que esa
verificación no cubre. Lo que espera, quién avisa y las diferencias con el plan
y el diseño están en la nota del 13 de noviembre de 2026 sobre U4 de
[ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md). U4 no reestructura
ninguna pantalla: Panorama solo gana el aviso de que ya muestra sus datos.

- **Qué se ve.** Sobre el fondo oscuro del OCC, el isotipo de ELEVANT y el logo
  «ELEVANT · OCC» al centro, con una entrada corta, y debajo una línea de
  progreso fina. Detrás, ocho rutas aéreas finas, de muy bajo contraste, se
  trazan en arco alrededor del logo y se desvanecen. No hay listas, cifras ni
  datos. Al salir, la pantalla se desvanece en menos de 400 ms y deja a la
  vista la consola, que ya cargó debajo. Con «reducir movimiento», las rutas y
  el logo quedan quietos y solo avanza la línea
  ([pantalla](../../frontend/private-web/src/features/admin-occ/boot/OccBootScreen.jsx)
  y [estilos](../../frontend/private-web/src/features/admin-occ/boot/OccBootScreen.module.css)).
- **Cuándo aparece.** Solo en la primera entrada al OCC de cada pestaña
  después de iniciar sesión, sea cual sea el módulo. Una
  [marca](../../frontend/private-web/src/features/admin-occ/boot/occBootSession.js)
  en `sessionStorage` (`elevant-occ-boot-seen`, con el id de la cuenta) evita
  que vuelva al cambiar de módulo o al recargar, y
  [`authService`](../../frontend/private-web/src/features/auth/authService.js)
  la borra al iniciar y al cerrar sesión y cuando la sesión vence o recibe un
  401 que no se renueva. Como la marca es de la pestaña, una pestaña nueva con
  la sesión recordada la muestra una vez más. No aparece en el HTML del
  servidor, en otros departamentos ni con una sesión de otro rol.
- **Qué espera y cómo cede.**
  [`RoleLayout`](../../frontend/private-web/src/app/RoleLayout.jsx) monta el
  [proveedor](../../frontend/private-web/src/features/admin-occ/boot/OccBootProvider.jsx)
  solo para el OCC, por encima de la comprobación de la sesión y de los
  permisos: «Comprobando sesión…» y «Cargando permisos…» siguen debajo, con su
  `role="status"`. El
  [orquestador](../../frontend/private-web/src/features/admin-occ/boot/occBootMachine.js)
  espera el acceso del departamento sin límite de tiempo y, después, el primer
  aviso de una pantalla lista (`useOccBoot().markReady`) o 6 s, lo que llegue
  antes. Si el acceso falla, cede al instante a su error. Hoy solo avisa
  Panorama, cuando deja de cargar
  ([ruta](../../frontend/private-web/src/features/dashboard/DashboardRoute.jsx)):
  en los demás módulos la pantalla espera los 6 s. Desde que empieza a irse,
  deja pasar los clics.
- **Lectores de pantalla.** La pantalla está oculta para ellos y no añade un
  segundo `role="status"`. Un texto aparte, con `aria-live="polite"`, dice
  «Preparando el centro de operaciones…» y, al salir, «Listo.», en español o en
  inglés según el idioma guardado.
- **Pruebas.** Vitest cubre el orquestador, la marca, el proveedor, la
  pantalla, el montaje en `RoleLayout`, el aviso de Panorama y la limpieza de
  la marca. La carpeta `admin-occ/boot` entra en `MIGRATED_FOLDERS` del
  [manifiesto del puente](../../frontend/private-web/src/styles/occLegacyBridgeMap.js),
  y las [guardas](../../frontend/private-web/src/styles/occStyleGuard.test.js)
  exigen que su hoja pinte solo con los tokens del OCC. La suite visual suma
  una prueba en Chrome: ver
  [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#suite-visual-de-los-mapas-del-occ).

Límites: la pantalla no precarga datos. La consola lee los suyos debajo, como
siempre, y si tarda más de 6 s se abre con su estado de carga. Todavía no
existe el aviso del motor de mapas (`markReady('map')`): según el plan, lo
añadirá el PR M4, y la consola de U3 conservará el de Panorama. La pantalla no
está en el HTML del servidor, así que el primer pintado sigue siendo
«Comprobando sesión…» sobre el azul marino de `body`, y en las entradas
siguientes no hay pantalla de arranque. Mientras espera, cubre la página y
recibe los clics. Nada de esto acredita un despliegue ni una revisión visual
en el VPS.

## Mapas del OCC en un solo motor (PR M2)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR M2 «Motor único y estilo NOC» (`314c124b`, `323189b2`, `5d759557` y
`c0b20127`), que esa verificación no cubre. Las decisiones y lo que añadirán
los PR M3 a M8 están en
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md). Son las mismas
pantallas sobre un solo motor: las posiciones siguen siendo puntos, y todavía
no hay polígonos, tráfico en vivo ni aviones 3D.

- **Un motor y un componente.**
  [`mapEngine.js`](../../frontend/private-web/src/features/maps/core/mapEngine.js)
  es el único módulo que crea un mapa de MapLibre, y
  [`OccMap.jsx`](../../frontend/private-web/src/features/maps/core/OccMap.jsx),
  el único componente de mapa: un lienzo por página, en el que Región,
  Aproximación, Aeródromo y Rampa son posiciones de cámara del mismo mapa. El
  mapa está listo al cargar su estilo. Solo un mapa que no puede arrancar, como
  en un navegador sin WebGL2, o cuyo contexto WebGL vuelve sin WebGL2, deja en
  su lugar la lista de respaldo, y ese mapa ya no vuelve; si el mapa base no
  carga, un aviso dice «No se pudo cargar el mapa base. Los datos de ELEVANT
  siguen en el mapa.», y lo que dibuja cada pantalla (posiciones, vuelos y el
  punto de referencia de PUJ) sigue en el mapa.
  [`workerUrl.js`](../../frontend/private-web/src/features/maps/core/workerUrl.js)
  prepara una sola vez los workers de MapLibre (`prewarm`), que ya no se crean
  ni se terminan con cada mapa.
- **Adaptadores con las mismas props.**
  [`PositionMap.jsx`](../../frontend/private-web/src/features/positions-map/components/PositionMap.jsx)
  (Mapa de posiciones, Planificación y la plataforma de la consola) y
  [`FlightMap.jsx`](../../frontend/private-web/src/features/flight-monitoring/components/FlightMap.jsx)
  (Monitoreo de vuelos) son adaptadores finos de `OccMap`, con las mismas props,
  el mismo manejador imperativo, los mismos `data-testid`
  (`position-map-container` y `flight-map-container`) y los mismos textos de
  respaldo: sus páginas no cambian. Las posiciones son puntos con el estado que
  ya traían, dibujado con el vocabulario de `statusVocabulary.js` («Llegando» y
  «Por liberar» llegan con M4), y se agrupan al alejar el mapa; los vuelos que
  traen posición son siluetas sin un color por estado, y PUJ se marca con su
  punto de referencia. La ficha del vuelo de Monitoreo queda fija en una
  esquina del mapa y ya no sigue al avión.
- **Estilo NOC propio.**
  [`occStyle.js`](../../frontend/private-web/src/features/maps/style/occStyle.js)
  construye el estilo en código sobre las teselas vectoriales de OpenFreeMap,
  que pide por su TileJSON, y sus glifos Noto Sans, sin sprite: los íconos se
  dibujan como imágenes SDF. Hay una sola paleta oscura, en pizarra:
  [`mapTheme.js`](../../frontend/private-web/src/features/maps/style/mapTheme.js)
  guarda solo los colores del mapa base, los de estado salen de `occPalette.js`
  y lo elegido lleva el cian `--occ-accent`. El estilo nunca se cambia después
  de arrancar, y una prueba lo comprueba. Las cuatro variables
  `NEXT_PUBLIC_*_MAP_STYLE_*` se retiraron de
  [`.env.example`](../../frontend/private-web/.env.example) y del código.
- **Vistas, selección y teclas.** Cada vista se encuadra con el tamaño real del
  mapa, y de esos encuadres salen los zooms en los que aparecen las posiciones y
  sus códigos; el selector marca la vista que la cámara muestra de verdad. La vista elegida se escribe en la URL (`view=`), una URL con
  `view=ramp&terminal=A` (o `B`, o `FBO`) abre la rampa de esa terminal, y con
  el foco en el mapa las teclas `1` a `4` cambian de vista.
  `Esc` cierra primero el cajón o el diálogo abierto y después limpia la
  selección: el detalle de la posición, el diálogo de importación y
  `useEscapeToClose` marcan la tecla como atendida. El almacén de la selección
  en la URL
  ([`mapSelection.js`](../../frontend/private-web/src/features/maps/core/mapSelection.js))
  ya existe, pero las pantallas siguen pasando al mapa su propia selección
  hasta que U3 y U5 lo adopten.
- **Leyenda.** Un mapa con posiciones o vuelos en pantalla muestra el botón
  «Leyenda»
  ([`MapLegend.jsx`](../../frontend/private-web/src/features/maps/ui/MapLegend.jsx)),
  que lista solo lo que hay en pantalla: el avión de los vuelos, que apunta
  según su rumbo; los estados de las posiciones, también los de las que el mapa
  dibuja sueltas junto a sus grupos; «No oficial» cuando alguna está en su
  ubicación de referencia interna, y qué es un grupo cuando hay uno en
  pantalla. En Mapa de posiciones, Planificación y Monitoreo de vuelos es la
  única leyenda del mapa: las páginas ya no muestran la suya, que explicaba con
  colores por estado lo que el mapa ya no dibuja así. La plataforma de la
  consola conserva su leyenda en línea hasta que U3 retire el dashboard actual.
- **Relectura sin remontar el mapa.** Al releer la misma estación (por foco,
  sondeo u `occ_planning`), Mapa de posiciones y Monitoreo conservan sus datos
  en pantalla mientras llega la respuesta: la página no vuelve al esqueleto y
  el mapa no se crea de nuevo. Un cambio de estación o de cuenta sí empieza
  vacío.
- **Laboratorio y suite visual.** `/map-lab` existe solo en desarrollo: ocho
  escenas fijas del mapa (la octava, la revisión del plano de MDPC, llegó con
  el PR M3), sin sesión ni API. La ruta lo importa solo en la rama
  de desarrollo, y el build de producción comprueba que no lo incluye
  ([`verify-map-chunks.mjs`](../../frontend/private-web/scripts/verify-map-chunks.mjs)).
  La suite visual corre con Playwright en Chrome, fuera del CI: ver
  [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#suite-visual-de-los-mapas-del-occ).
- **Lo que se retiró:** las variantes de Google Maps (`GoogleFlightMap.jsx`,
  `GooglePositionMap.jsx` y su cargador) con la dependencia
  `@googlemaps/js-api-loader`; los huérfanos `AirfieldMap.jsx` y
  `AirfieldPanel.jsx`, con los mensajes `airfield.*` del dashboard; los
  marcadores DOM de Monitoreo (`AircraftMarker.js` y `AirportMarker.js`); y
  `positionMapLayers.js` y `positionMarkerIcons.js`, cuyo trabajo pasa a
  [`standLayers.js`](../../frontend/private-web/src/features/maps/stands/standLayers.js)
  y a los íconos del estilo.

Lo que no cambia: la CSP, porque la TileJSON, las teselas y los glifos siguen en
`tiles.openfreemap.org`, que ya estaba permitido; las ubicaciones de las
posiciones, que siguen siendo una referencia interna no oficial salvo las que
ubicó OCC; y los datos que leen las pantallas, sin endpoints nuevos ni cambios
en la API. Los dos mapas auxiliares del dashboard (región y meteorología)
conservan su ciclo de vida y los estilos publicados de OpenFreeMap hasta que U3
retire el dashboard actual.

Límites: a 1440×900 el resumen de Mapa de posiciones tapa la escala, los
créditos y las posiciones A1 a A5, y todavía pinta sus colores de estado; lo
rehace U5. El
3D de M2 es la inclinación de cámara de siempre: los aviones 3D llegan con M7.
En producción, `/map-lab` responde la página de no encontrada con el estado
200. Nada de esto acredita un despliegue ni una revisión visual en el VPS.

## Plano de MDPC y aeródromo (PR M3)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR M3 «Datos de MDPC y aeródromo» (`152eb092`, `28640235` y `c14baf17`), que
esa verificación no cubre. Las decisiones están en la actualización del 13 de
noviembre de 2026 de
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md), y las fuentes, las
licencias y cómo se regenera el plano, en el
[README de los datos](../../frontend/private-web/src/features/maps/airport/data/README.md).
Las posiciones siguen siendo los puntos de M2: sus polígonos, sus estados y su
leyenda llegan con M4.

- **Un plano propio del aeropuerto.**
  [`mdpc.layout.json`](../../frontend/private-web/src/features/maps/airport/data/mdpc.layout.json),
  que lee
  [`airportLayout.js`](../../frontend/private-web/src/features/maps/airport/airportLayout.js),
  guarda las dos pistas con sus umbrales, las calles de rodaje con su grafo,
  los puntos de espera, las plataformas, las terminales y las 42 posiciones (41
  activas y la B33 retirada), cada una con su caja, su rumbo y su entrada. Lo
  escribe un
  [generador](../../frontend/private-web/scripts/maps/build-mdpc-layout.mjs)
  sin red desde un extracto de OpenStreetMap (ODbL), las filas de OurAirports
  (dominio público), los puntos internos de `positionsData.js` y una tabla de
  correcciones, y una prueba exige que el archivo versionado sea idéntico a lo
  que genera. El centro de cada posición es su punto interno, que sigue sin ser
  oficial. El plano va en el bundle: el navegador no pide nada nuevo.
- **El aeródromo desde la vista Aeródromo.** Desde un umbral que sale del
  encuadre real de las vistas, a medio camino entre Aproximación y Aeródromo,
  Monitoreo de vuelos, Mapa de posiciones, Planificación y la plataforma de la
  consola dibujan el aeropuerto con ese plano
  ([capas](../../frontend/private-web/src/features/maps/style/airfieldLayers.js)):
  las pistas con su designador, sus barras de umbral y su eje a trazos; las
  calles de rodaje con su nombre tenue; las plataformas; las terminales; y los
  puntos de espera como barras. Lo normal no lleva tono. Por debajo de ese
  umbral, las teselas dibujan el aeródromo solo como contexto. Mientras se ve
  el aeródromo, los créditos dicen «© OpenStreetMap contributors (ODbL) ·
  OurAirports».
- **Ficha de pista y de calle.** Al pasar el puntero por una pista o una calle
  de rodaje aparece una ficha que no bloquea el mapa: «Pista 08/26 · 3100 m ×
  45 m», «Calle de rodaje A» o «Calle de rodaje sin nombre». Un clic la fija,
  y un clic en otra parte o un cambio de vista la cierra.
- **Leyenda.** Suma pista, calle de rodaje, punto de espera, plataforma y
  terminal, cada uno solo cuando está en pantalla, debajo de lo demás. Las
  entradas cortas van de dos en dos, para que la leyenda abierta no tape las
  posiciones.
- **Vistas encuadradas por el plano.** Aeródromo encuadra la caja del plano
  más 300 m; Rampa, el espacio de las posiciones activas según el plano, más
  120 m; y la vista de cada terminal, el de las suyas.
- **Escena de revisión.** `/map-lab?scene=layout-qa`, solo en desarrollo
  ([escena](../../frontend/private-web/src/features/maps/lab/LayoutQaScene.jsx)),
  dibuja cada caja con su código, una flecha hacia donde apunta la nariz y sus
  marcas, los puntos internos, las puertas y las líneas de posición de OSM y el
  grafo de rodaje, y mide la ruta por las calles de rodaje entre dos nodos. Una
  lista lateral muestra las 42 posiciones, primero las marcadas, y encuadra la
  que se elige. La suite visual guarda sus capturas para quien revisa el plano.

Revisión firmada: el dueño del producto aprobó el plano el 13 de noviembre de
2026 y decidió que su documento de coordenadas manda sobre OpenStreetMap, que
está desactualizado en el aeropuerto; las 42 posiciones quedan revisadas
(`provenance.qa: 'reviewed'`), con 14 marcas que se conservan como dato.
Límites: la tabla de alias está vacía, así que un código como «9A» sigue sin
ubicación. Ninguna pantalla usa todavía los aeropuertos de la región ni las
radioayudas que trajo el extracto de OurAirports. Las capturas se revisaron en
local, en el laboratorio; nada de esto acredita un despliegue ni una revisión
visual en el VPS.

## Imagen aérea y vuelos para el mapa (PR A3, lo que consumirá M5)

Posterior al commit verificado de esta nota: esta sección describe la API y el
cliente compartido del PR A3 «Imagen aérea y vuelos para el mapa» (código de
`77dff268` a `e098ccde`;
[ADR-0042](../../docs/adr/0042-occ-air-picture-and-map-flights.md)).
**Private Web todavía no los usa:** ninguna pantalla cambió con ese PR, y lo
que sigue sobre las pantallas es el plan de los PR M5, M6 y U3, no
comportamiento actual.

- **Lo que ya existe.** El cliente compartido ofrece `getOccAirPicture`,
  `getOccAircraftTrack` y `getOccMapFlights`, con validadores estrictos y el
  código `invalid_map_query`
  ([`occMap.ts`](../../packages/api-client/src/occMap.ts)). Los lee el personal
  interno con la estación en su alcance y un permiso de Panorama, Monitoreo de
  vuelos, Mapa de posiciones o Planificación; la imagen aérea solo existe para
  PUJ.
- **Planificado (M5): aviones y crédito.** El mapa dibujará los aviones de
  `air-picture` con su estela, unirá cada uno a su fila de `flights` por
  `matchedFlightKey` y mostrará en la atribución de cada mapa «Datos de
  aeronaves: {source.name}», con el enlace a la red y a su licencia. El estado
  (`Live`, `Stale`, `Warming`, `Unavailable` o `Disabled`), los motivos y el
  crédito se traducirán en los archivos de mensajes del OCC, en español y en
  inglés, sin mostrar nunca el título de un error.
- **Planificado: ritmo.** La imagen se pedirá al ritmo de
  `refreshAfterSeconds` (10 segundos, 2 mientras calienta), con
  `trails=short` una vez y `none` después, y en pausa con la pestaña oculta;
  `flights`, con `occ_planning` (como mucho una vez cada 3 segundos) y un
  sondeo de seguridad de 60; la estela completa, al elegir un avión. El
  [plan de peticiones del marco](../../frontend/private-web/src/features/admin-occ/live/occRequestPlan.js)
  ya cuenta la imagen y los vuelos de la consola en la prueba de presupuesto.
- **Planificado: seguir un vuelo.** La selección `flightId` aceptará una
  `flightKey` o una `visitKey`. La clave de un vuelo no cambia con una
  importación normal, así que «Seguir» no se suelta al importar; tras un
  enlace 3-N07, la clave vieja se resuelve por `proposalId`.
- **Planificado: hitos y vuelo demo (M5 y M6).** La barra de avance de cada
  posición y la tira de hitos saldrán de `milestones`, y el avión demo se
  ajustará a los instantes del bloque `demo`, sin derivar los suyos.
- **El panel regional actual** del Panorama sigue con
  `GET occ/traffic/aircraft` (OpenSky, apagado sin credenciales) y sin
  reconocer vuelos de ELEVANT hasta que U3 lo retire.

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
- prueba de entrega para validación de entorno, modelo Compose e invariantes de imagen/configuración;
- *posterior al commit verificado (PR M2):* la suite visual de los mapas del OCC, con Playwright en Chrome y fuera del CI ([Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#suite-visual-de-los-mapas-del-occ));
- *posterior al commit verificado (PR M3):* las pruebas del plano de MDPC, que corren con `npm test`: el plano versionado tiene que ser idéntico a lo que genera el generador ([prueba de igualdad](../../frontend/private-web/src/features/maps/airport/mdpcLayout.generated.test.js)) y cumplir los criterios de aceptación ([criterios](../../frontend/private-web/src/features/maps/airport/airportLayout.test.js)).

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
