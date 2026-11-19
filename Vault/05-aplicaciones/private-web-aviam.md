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
  - frontend/private-web/src/features/review/CanonicalReviewRoute.jsx
  - frontend/private-web/src/features/review/components/OperationCloseSection.jsx
  - frontend/private-web/src/features/position-coverage/CoverageRoute.jsx
  - frontend/private-web/src/features/notifications/CanonicalNotificationsRoute.jsx
  - frontend/private-web/src/features/chat/CanonicalChatRoute.jsx
  - frontend/private-web/src/features/chat/PresencePeople.jsx
  - frontend/private-web/src/features/chat/presenceStatus.js
  - frontend/private-web/src/features/ready-contracts/ReadyContractsRoute.jsx
  - frontend/private-web/src/features/reports/CanonicalReportsRoute.jsx
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
- El chat OCC funciona como lista/detalle por debajo de 1024 px. Posterior al
  commit verificado, desde el PR U6, el corte es 1280 px
  ([Resto de pantallas del OCC (PR U6)](#resto-de-pantallas-del-occ-pr-u6)).

La validación local se hizo con capturas a 360, 390, 768, 1024, 1280, 1440 y
1920 px contra la API Development. No acredita un despliegue en el VPS.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Audiencias | OCC/administración, Gestión Humana, Contratos, Finanzas y otros departamentos internos representados por esos módulos. |
| Responsabilidad UI | Presentar vistas internas, capturar intenciones y manejar estados de interacción. |
| Autoridad real | Debe residir en la API para identidad, roles, station scope, reglas y datos. |
| Persistencia del cliente | La sesión del prototipo usa almacenamiento del navegador; no es una frontera de autorización. |
| Integración externa | El navegador no conecta directamente a SQL Server, FlightAware ni proveedores de datos aeronáuticos. Como excepción visual verificable, los mapas cargan estilos y teselas cartográficas públicas de MapLibre/OpenFreeMap permitidas explícitamente por CSP. *Posterior al commit verificado (PR M2):* los mapas del OCC llevan su propio estilo en el bundle y de OpenFreeMap solo piden teselas y glifos; los dos mapas auxiliares del dashboard conservan los estilos publicados hasta U3. Desde U3 solo los usa el mapa satelital del detalle de meteorología de Panorama, mientras ese detalle está abierto; el plan pasa el satélite a una capa del mapa único en M8. |
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

El espacio OCC tiene marco propio: un riel de navegación colapsable agrupado en En vivo, Planificar, Revisar y Estación, con la marca oficial completa, y una barra de estado con la estación, el módulo activo, el enlace en vivo, las fuentes, las alertas, la hora local y la UTC del reloj del equipo, el idioma (español/inglés), la leyenda y la cuenta. Lo introdujo la rama `feat/adminocc-redesign`, con el riel agrupado en Monitoreo, Operación, Comunicación y Administración y dibujado en azul marino, una barra contextual con los avisos y el cambio de tema. Desde el PR U1 el OCC es solo oscuro, con el riel en pizarra y sin botón de tema, y desde el PR U2, posterior al commit verificado, el riel sigue la jornada del controlador y la barra es de estado: ver [Sistema visual NOC del OCC (PR U1)](#sistema-visual-noc-del-occ-pr-u1) y [Marco del OCC (PR U2)](#marco-del-occ-pr-u2). Desde el PR U4, también posterior al commit verificado, la primera entrada al OCC de cada pestaña después de iniciar sesión pasa por una pantalla de arranque: ver [Pantalla de arranque del OCC (PR U4)](#pantalla-de-arranque-del-occ-pr-u4). Desde el PR U3, también posterior, Panorama es la consola del OCC, un mapa a pantalla completa con paneles que se pliegan, y solo ella llena el espacio del marco sin margen: ver [Consola del OCC (PR U3)](#consola-del-occ-pr-u3). Los demás departamentos conservan su marco; el cambio es opcional por departamento (`ShellFrame` acepta componentes y `data-department`). Los destinos y permisos de navegación no cambian. Fuentes: [layout OCC](../../frontend/private-web/src/features/admin-occ/AdminOccLayout.jsx), [riel](../../frontend/private-web/src/features/admin-occ/shell/OccSidebar.jsx), [barra](../../frontend/private-web/src/features/admin-occ/shell/OccTopbar.jsx) y [tokens](../../frontend/private-web/src/styles/occ.css).

En el árbol local posterior al commit verificado, «Estación → Mis gastos» aparece en el riel OCC y abre `/admin-occ/expenses`, también desde el menú móvil. El enlace no concede permisos: la API determina los gastos y acciones disponibles para la cuenta. Fuentes: [navegación OCC](../../frontend/private-web/src/features/admin-occ/navigation.js), [riel OCC](../../frontend/private-web/src/features/admin-occ/shell/OccSidebar.jsx) y [ruta de gastos](../../frontend/private-web/app/admin-occ/expenses/page.jsx).

Desde el PR U6, también posterior al commit verificado, Revisión, Cobertura de posiciones, Notificaciones, Chat interno, Datos maestros, Tablets, Contratos listos y Reportes se dibujan con las primitivas del OCC; Usuarios y Mis gastos, que comparten otros departamentos, siguen con el puente de estilos. Ver [Resto de pantallas del OCC (PR U6)](#resto-de-pantallas-del-occ-pr-u6).

OCC opera solo Punta Cana: todas sus rutas toman el alcance `PUJ` que trae la sesión y ya no ofrecen selector de estación. Si la cuenta no tiene ese alcance, cada módulo muestra su estado sin estación autorizada y no consulta la API; la autorización sigue en el servidor. Fuente: [alcance PUJ](../../frontend/private-web/src/features/admin-occ/useOccStation.js).

El idioma elegido en el login se comparte con OCC mediante un único store. Solo los espacios envueltos en `LanguageScope` (hoy OCC) lo aplican; fuera de él la interfaz sigue en español, por lo que los componentes compartidos con otros departamentos no quedan a medio traducir. Fuentes: [store](../../frontend/private-web/src/i18n/languageStore.js) y [scope](../../frontend/private-web/src/i18n/LanguageScope.jsx).

En el commit verificado, Panorama (`/admin-occ/dashboard`) era un tablero de la fecha local de PUJ: un resumen de cifras, el mapa de plataforma, la tabla de escalas del día, «Requiere atención» y los avisos recientes, armados con una sola lectura que se repetía con `notifications` u `occ_planning`, al recuperar el foco o la conexión y cada 25 segundos con la pestaña visible. *Posterior al commit verificado:* desde el PR U3, Panorama es la consola del OCC: el mapa único a pantalla completa, abierto en la vista Rampa, con los paneles «Tablero», «Cifras de la jornada», «Alertas», «Posiciones» e «Inspector» flotando encima, cada uno plegable; ver [Consola del OCC (PR U3)](#consola-del-occ-pr-u3). Nada de lo que mostraba se perdió: la tabla de escalas es la pestaña «Escalas» del tablero, con los mismos filtros; «Requiere atención» es «Pendientes de la jornada»; el resumen es «Cifras de la jornada», y los avisos recientes están en el cajón «Alertas y avisos» del marco.

Desde U3, las cifras siguen siendo conteos de consultas acotadas (la planificación del día, la cola de revisión, que trae hasta 100 operaciones, y los vuelos del mapa), no totales históricos. Se calculan en el cliente con las reglas de clasificación de escalas del [modelo del panorama](../../frontend/private-web/src/features/dashboard/dashboardModel.js); si la cola trae menos operaciones de las que hay, «Por revisar» se marca como mínimo. Cada panel tiene su propia lectura y su propio estado: una relectura del mismo alcance conserva los datos visibles e indica si falló, y perder la autorización o cambiar de cuenta los retira. La planificación, las posiciones, la cola de revisión y la disponibilidad de los agentes se releen con un sondeo de seguridad de 60 segundos y nunca con `occ_planning`; la cola, además, con `occ_review`. Los vuelos del mapa se releen con `occ_planning`, y los avisos son los que el marco lee una sola vez. Con la pestaña oculta, lo que vence espera y se lee una vez al volver. Fuentes: [ruta](../../frontend/private-web/src/features/dashboard/noc/ConsoleRoute.jsx), [vista](../../frontend/private-web/src/features/dashboard/noc/ConsolePage.jsx), [lecturas](../../frontend/private-web/src/features/dashboard/noc/useConsoleData.js) y [cifras](../../frontend/private-web/src/features/dashboard/noc/consoleModel.js).

El catálogo de referencia de las posiciones ([datos](../../frontend/private-web/src/features/dashboard/positionsData.js) y [catálogo](../../frontend/private-web/src/features/dashboard/dashboardPositions.js)) recupera las 42 ubicaciones internas originales: 41 se dibujan y B33 permanece como registro histórico fuera de la vista operativa. Incluye B34–B37 y conserva las 13 coordenadas internas de B20–B32. La [carta AIP de 2024](https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_03-24.pdf) y la [enmienda de 2026](https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_3-26/AMDT_AIRAC_03-26.pdf) sirven solo como referencias de conciliación. La enmienda retira B33; las coordenadas internas difieren de la documentación AIP, especialmente B20–B32, y **no se declaran oficiales ni verificadas**. No consta permiso de IDAC para procesar coordenadas AIP, de acuerdo con su [política de uso](https://aip.sna.gob.do/Aip/CircularSerA); el frontend ya no contiene la transcripción previa. Los códigos planificados sin coincidencia exacta en el catálogo activo, incluido B33, se listan sin ubicación. No hay alias automáticos entre A1 y 1 ni entre códigos parecidos.

**Meteorología MDPC.** Desde el PR U3 se abre desde la píldora del clima, bajo el mapa de Panorama; antes era uno de los dos mapas auxiliares del rediseño anterior, que se describe más abajo como registro. El METAR de Iowa Environmental Mesonet es una réplica no oficial. La interfaz separa la hora observada de la recepción local, avisa tras 75 minutos y conserva el aviso de un refresco fallido. Humedad relativa, sensación térmica y precipitación horaria procedentes de campos IEM se rotulan como derivados. GOES-East infrarrojo e [IMERG](https://gpm.nasa.gov/data/imerg) de NASA GIBS son capas seleccionables. La vista fija las teselas al tiempo reportado por GIBS; si solo hay fecha, muestra únicamente el día sin antigüedad horaria. IMERG estima precipitación y puede retrasarse varias horas; no es radar ni observación local. Se muestran atribución, unidad y opacidad de la capa. Fuentes: [píldora](../../frontend/private-web/src/features/dashboard/noc/WeatherPill.jsx), [palabras del METAR](../../frontend/private-web/src/features/dashboard/noc/weatherWords.js) y [teselas](../../frontend/private-web/src/services/satelliteService.js).

En esta rama local, la certificación de la imagen AVIAM compara la CSP generada con una lista cerrada que incluye la API certificada, su WebSocket, dos orígenes cartográficos, IEM y NASA GIBS. Rechaza fuentes adicionales o ausentes; la prueba usa la política que genera la aplicación para evitar otra divergencia. Fuentes: [validador](../../frontend/scripts/deployment/csp-tool.mjs), [pruebas](../../frontend/tests/deployment/test-csp-tool.mjs) y [política AVIAM](../../frontend/private-web/src/config/securityHeaders.mjs).

La CSP permite los orígenes GIBS e IEM; OpenSky solo se consulta desde el servidor. `GET /api/v1/occ/traffic/aircraft` exige personal AVIAM con `operations.planning.read` y alcance PUJ. El recuadro 17–21° N, 73–67° O es fijo, la caché por instancia impone 120 segundos entre consultas y permite hasta 10 minutos de copia desactualizada durante fallos. OAuth2 usa configuración privada, desactivada por defecto; no se han aportado credenciales ni se ha validado una conexión OpenSky real en esta rama. El acuerdo escrito para uso operacional y su alcance deben verificarse antes de activarla. La API sanitiza errores y no expone secretos. No cambia esquema ni permisos de negocio. Fuentes locales: [controlador](../../backend/Elevant.Api/Controllers/OccTrafficController.cs), [adaptador](../../backend/Elevant.Infrastructure/Integrations/OpenSky/OpenSkyAircraftTrafficSource.cs), [cliente](../../packages/api-client/src/client.ts) y [servicio](../../frontend/private-web/src/services/trafficService.js). *Posterior al commit verificado:* desde el PR U3 ninguna pantalla lee ese endpoint; su único consumidor era el mapa regional de Panorama, y el servicio queda sin uso hasta que un paso aparte retire el endpoint.

Fuentes de implementación: [vista](../../frontend/private-web/src/features/dashboard/noc/ConsolePage.jsx), [catálogo](../../frontend/private-web/src/features/dashboard/dashboardPositions.js), [meteorología](../../frontend/private-web/src/features/dashboard/noc/WeatherPill.jsx), [teselas](../../frontend/private-web/src/services/satelliteService.js), [capas de posiciones](../../frontend/private-web/src/features/maps/stands/standLayers.js) y [CSP](../../frontend/private-web/src/config/securityHeaders.mjs).

> [!NOTE]
> El párrafo siguiente describe la superficie NOC del rediseño local anterior al PR U3, que U3 retiró: ya no hay mapas auxiliares ni siluetas de asignación en Panorama, y ningún cliente dibuja el tráfico regional de OpenSky. Se conserva como registro.

En aquel rediseño, la consola usaba una superficie NOC única: plataforma PUJ amplia, dos mapas auxiliares ampliables (la meteorología de MDPC y la región de República Dominicana) y una franja operacional. El mapa principal integraba pistas, rodajes y plataforma de OpenStreetMap; las siluetas vectoriales indicaban **asignación planificada** y no confirmaban ocupación física. El modo nocturno inclinaba la cámara, y los edificios se extruían solo si la tesela aportaba altura. Manrope se aplicaba explícitamente al dashboard e IBM Plex Mono a horas y cifras. El mapa de la región, con cartografía OpenStreetMap/OpenFreeMap y referencia PUJ, dibujaba una marca por ICAO24 con posición OpenSky disponible; seleccionarla abría la ficha de telemetría, separada de los vuelos y stands de planificación, sin inferir aterrizaje, destino ni ocupación por callsign o proximidad. Su validación (27/27 pruebas enfocadas, test:delivery 22/22, lint, typecheck y build; navegador 375–1440 px) no acredita una conexión OpenSky real.

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

*Posterior al commit verificado (PR M5):* dentro del marco del OCC, el mapa de
Monitoreo dibuja los aviones de la imagen aérea de la API, con el crédito de su
red, y entre ellos los vuelos de la lista que la API reconoce; los vuelos que
lee el servicio de monitoreo siguen sin coordenadas. El aviso «Sin posición de
aeronaves en vivo…» ya no aparece: el estado del tráfico lo dice el propio
mapa. Ver [Tráfico real en el mapa (PR M5)](#tráfico-real-en-el-mapa-pr-m5).
Desde el PR M6, también posterior, ese mapa mueve los aviones con la hora del
servidor y dibuja estimados los vuelos de AVIAM sin señal y el vuelo demo, con
«Seguir» y «Pausar movimiento»: ver
[Cinemática y vuelo demo en el mapa (PR M6)](#cinemática-y-vuelo-demo-en-el-mapa-pr-m6).

En la rama de integración, Monitoreo y Mapa releen la estación autorizada
cuando reciben `occ_planning` tras una asignación OCC. También refrescan al
recuperar foco/conexión y cada 25 segundos con la pestaña visible; los sondeos
de snapshot existentes continúan. La señal no sustituye la lectura REST ni
acredita latencia o promoción remota.

El Mapa de posiciones también usa el alcance PUJ. Representa geometría local revisada y superpone únicamente asignaciones planificadas, sin inferir disponibilidad física. En otra estación muestra una lista de posiciones asignadas desde planificación, sin reutilizar coordenadas de PUJ; si no hay asignaciones, el vacío es explícito. Refresca el snapshot entero cada 30 segundos, oculta resultados previos ante fallos y conserva la estación al abrir un vuelo en Monitoreo. Faltan coordenadas y ocupación física verificadas de otras estaciones, así como prueba remota. Fuentes: [adaptador de posiciones](../../frontend/private-web/src/services/positionsMapService.js), [ruta](../../frontend/private-web/src/features/positions-map/PositionsMapRoute.jsx) y [vista](../../frontend/private-web/src/features/positions-map/PositionsMapPage.jsx). *Posterior al commit verificado (PR M6):* dentro del marco del OCC, el mapa dibuja también el tráfico, y sus posiciones leen los vuelos del mapa y dónde está cada avión, en vivo o estimado: ver [Cinemática y vuelo demo en el mapa (PR M6)](#cinemática-y-vuelo-demo-en-el-mapa-pr-m6).

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

*Posterior al commit verificado de esta nota
([ADR-0045](../../docs/adr/0045-configurable-permit-types-and-stand-required-permits.md), rama
`feat/rh-configuracion-carnets`, sin desplegar):* **Gestión Humana › Configuración**
(`human_resources.settings`) tiene dos pestañas.
- «Carnets y permisos» muestra los dos tipos del sistema, que no se editan, y los tipos que Gestión Humana agrega.
- «Equipos de habilitación» administra el catálogo de equipos de las habilitaciones. El puente de abordaje no cambia
  su código ni se desactiva.

En las dos pestañas hay una tabla y un formulario lateral para crear, editar y desactivar. Cada guardado lleva su
Idempotency-Key y la versión, y los errores se explican por código.

El formulario de carnets ofrece los tipos del sistema y los personalizados activos. La lista y el reporte de
vencimientos nombran los tipos personalizados con el catálogo. Sin acceso al catálogo, se quedan con los nombres del
sistema.

En OCC › Datos maestros, el panel «Carnets exigidos por posición» fija los carnets de una posición o los aplica a
varias a la vez. El detalle de la posición en los mapas dice «Exige: …». Cobertura y Planificación explican al agente
no elegible con «Le falta: {carnet}».

Fuentes: [Configuración](../../frontend/private-web/src/features/human-resources/settings/HumanResourcesSettingsPage.jsx)
y [carnets por posición](../../frontend/private-web/src/features/master-data/StandRequiredPermitsPanel.jsx).

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

*Posterior al commit verificado (hallazgo N28, 19 de noviembre de 2026):* el
diálogo escribe sus horas en 24 horas y en la zona de la estación, como la
consola del OCC: «10:05 → 19:53 · real 19:58», nunca «7:53 p. m.»
([`formatClock`](../../frontend/private-web/src/features/occ-ui/occTime.js)).
Lo mismo hacen la lista de vuelos de la vista «Mapa» de Planificación y las
acciones de una posición en Mapa de posiciones. La cuenta atrás de las tiras de
vuelo y de «Pendientes de la jornada» cuenta la diferencia entre los minutos que
muestran los relojes, no el desfase exacto redondeado, y el disparo programa el
vuelo demo desde el minuto entero siguiente
([ADR-0041](../../docs/adr/0041-demo-flights-and-punta-cana-stands.md)): a las
19:50, su llegada de las 19:53 dice «en 3 min» en la consola y en el mapa, cuya
cuenta regresiva no cambió.

*Posterior al commit verificado (hallazgo N22, 19 de noviembre de 2026):* el
diálogo nombra el estado que informa el proveedor de cada llegada con las
palabras con que el Tablero de la consola nombra su fase, nunca con las del
proveedor: «Aterrizó · HIDM01», no «Arrived · HIDM01». Lo hace en «Con
contrato», «Charter sin contrato» y «Descartadas». La hora de pista manda
primero: con ella, la llegada dice «Aterrizó», diga lo que diga el proveedor. Si
no la hay, la palabra se lee como la lee el servidor para el mapa
([`MapFlightPhases`](../../backend/Elevant.Application/Operations/MapFlights/MapFlightPhases.cs),
decisión 7 de [ADR-0042](../../docs/adr/0042-occ-air-picture-and-map-flights.md)),
sin distinguir mayúsculas ni espacios alrededor, y se agrupa como en el Tablero:
- Expected, Unknown, CheckIn, Boarding, GateClosed y Delayed dicen «Programado»;
- Departed y EnRoute, «En ruta»; Approaching, «En aproximación»;
- Arrived, «Aterrizó»: solo dice que tocó pista;
- Canceled, Cancelled y CanceledUncertain, «Cancelado»; Diverted, «Desviado»;
- cualquier otra palabra, «Sin estado».

Los matices del proveedor no se conservan: un retraso se ve en la hora revisada
([`providerArrivalStatusKey`](../../frontend/private-web/src/features/dashboard/noc/boardModel.js)).
El diálogo no tiene reloj, así que una llegada que el proveedor aún espera sigue
«Programado» después de su hora, cuando el mapa ya la da «En ruta».

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

Posterior al commit verificado, desde el PR U6, la presencia se dibuja por su
forma y sin color, con su leyenda: ver
[Resto de pantallas del OCC (PR U6)](#resto-de-pantallas-del-occ-pr-u6).

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

- **Solo oscuro, sin botón de tema** (revertido el 15 de noviembre de 2026:
  ver [Tema claro y oscuro del OCC](#tema-claro-y-oscuro-del-occ)). Bajo
  `/admin-occ` el tema era siempre oscuro desde el primer pintado.
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
  retira `signal`. No todos los tokens tienen clase: después de U1, U2 sumó
  las llaves `primary`, `primary-hover`, `on-primary` y `scrim`, y U6, `field`.
  `--occ-arriving-fill`, `--occ-on-accent`, `--occ-on-warn`, `--occ-on-danger`,
  `--occ-warn-fill` y `--occ-danger-fill` siguen existiendo solo como
  variables CSS hasta que un PR añada su llave, y una guarda falla si una clase
  de color `occ-*` nombra un color sin llave. Una clase `occ-*` nunca lleva
  modificador de opacidad: Tailwind no la genera.
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
U5. Desde el PR U3, posterior al commit verificado, ese tablero ya no existe:
la pestaña «Escalas» de la consola no pinta los estados. El contraste se
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
propio observador hasta U3, U5 o U6, y Usuarios y Mis gastos, el suyo (desde
U3, Panorama ya no: lee con el observador del marco). Quedan
aplazados el modo muro, la búsqueda, los atajos con su diálogo, el aviso de
desfase del reloj, la severidad de cada incidencia y el acuse compartido por
estación. Las pruebas cubren el marco en jsdom; nada de esto acredita un
despliegue ni una revisión visual en el VPS.

Desde el PR U6, posterior al commit verificado, Cobertura de posiciones, Datos
maestros, Tablets, Chat interno y Notificaciones ya se dibujan con las
primitivas del OCC, y U6 no cambió sus lecturas. Las cinco escuchan ya en el
observador del marco y no abren uno propio
([Resto de pantallas del OCC (PR U6)](#resto-de-pantallas-del-occ-pr-u6)).

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
  Panorama, cuando la consola está en pantalla y llegaron sus primeros datos,
  los vuelos del mapa
  ([ruta](../../frontend/private-web/src/features/dashboard/noc/ConsoleRoute.jsx)):
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
siempre, y si tarda más de 6 s se abre con su estado de carga. Posterior al
commit verificado, desde el PR M4 el motor de mapas también avisa
(`markReady('map')` en
[`OccMap.jsx`](../../frontend/private-web/src/features/maps/core/OccMap.jsx))
cuando su mapa queda listo o sin cartografía, así que las pantallas con mapa no
esperan los 6 s. La consola de U3 conserva el aviso de Panorama y no deja que
el de su propio mapa termine la espera: la pantalla da paso a una consola con
datos. La pantalla no
está en el HTML del servidor, así que el primer pintado sigue siendo
«Comprobando sesión…» sobre el azul marino de `body`, y en las entradas
siguientes no hay pantalla de arranque. Mientras espera, cubre la página y
recibe los clics. Nada de esto acredita un despliegue ni una revisión visual
en el VPS.

## Resto de pantallas del OCC (PR U6)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR U6 «Resto de pantallas del OCC» (`5eb212ac`, `fae769ea`, `1219657d`,
`87daab94` y `2be6c178`), que esa verificación no cubre. Las plantillas, lo que
queda en el puente y las diferencias con el diseño y con el plan están en la
nota del 14 de noviembre de 2026 sobre U6 de
[ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md). U6 cambia cómo se ven
y se recorren ocho pantallas del OCC; no cambia la API ni lo que leen o
escriben. Las ocho y las primitivas de `occ-ui` pintan solo con los tokens
`--occ-*`, así que se leen en los dos temas del OCC.

- **Dos plantillas.** Revisión, Cobertura de posiciones y Chat interno son una
  mesa de trabajo: una barra con el título y, desde 1280 px, la lista y el
  detalle lado a lado, cada uno con su propio desplazamiento. Notificaciones
  también, sin detalle. Datos maestros, Tablets, Contratos listos y Reportes
  son un registro: la barra, una tabla densa y, si los hay, sus diálogos. La
  [barra](../../frontend/private-web/src/features/occ-ui/OccToolbar.jsx) lleva
  el título de la página, sin subtítulo ni la insignia de la estación, que ya
  está en la barra de estado. Cada lectura muestra sus cinco estados, y sin
  permiso no ofrece «Reintentar».
- **Revisión**
  ([ruta](../../frontend/private-web/src/features/review/CanonicalReviewRoute.jsx)).
  La barra filtra «Todas» o «Por revisar», con su cuenta; debajo van las tres
  cifras y la cola «Entregas», una tabla con «Ver detalle» en cada fila. Si la
  API corta la cola en 100 entregas, una nota bajo la lista lo dice, también
  cuando el filtro no deja filas. Desde 1280 px el «Detalle de entrega» queda a
  la derecha, con la barra de decisión fija al pie; por debajo se apila bajo la
  cola. La decisión, la reapertura y los cambios de recargos se confirman en un
  [diálogo](../../frontend/private-web/src/features/occ-ui/OccDialog.jsx)
  dentro del detalle. «Cierre de la operación» muestra la tira completa de los
  hitos del Reporte de Vuelo, en la hora de la estación, con los datos que el
  detalle ya traía, y el exceso del paquete con el triángulo de atención
  ([cierre](../../frontend/private-web/src/features/review/components/OperationCloseSection.jsx)).
- **Cobertura de posiciones**
  ([ruta](../../frontend/private-web/src/features/position-coverage/CoverageRoute.jsx)).
  La barra lleva la fecha y «Terminal y vista». El tablero «Posiciones de la
  terminal» es una tabla, «Coberturas del día» es una lista y el formulario
  «Asignar posiciones» queda a la derecha desde 1280 px. Cada tablero lleva su
  leyenda en la cabecera, con la forma y la palabra de sus marcas: «Atributos y
  estado» (atributo y «Desactivada») y «Tipo de cobertura» («Refuerzo»)
  ([leyenda](../../frontend/private-web/src/features/occ-ui/OccStatusLegend.jsx)).
  En «Configuración», los atributos de las posiciones son filas editables. Sus
  textos ganan inglés
  ([mensajes](../../frontend/private-web/src/features/position-coverage/coverageMessages.js)).
  Las posiciones van en orden natural de su código normalizado (A1, A2… A10,
  A11, AN1, B20, BN6… BN13): la tabla, los botones del formulario, las
  combinadas y las posiciones de cada cobertura
  ([orden](../../frontend/private-web/src/features/position-coverage/coverageOrder.js),
  con el comparador compartido de
  [`standCodes.js`](../../frontend/private-web/src/services/standCodes.js), que
  también ordena Datos maestros, la «Lista de posiciones» del mapa y los
  selectores de posición de Planificación).
- **Notificaciones**
  ([ruta](../../frontend/private-web/src/features/notifications/CanonicalNotificationsRoute.jsx)).
  El «Historial de avisos» lleva la leyenda «Prioridad» en su cabecera y los
  filtros «Todo», «Sin leer» y «Alertas», con su cuenta. Cada aviso lleva el
  glifo de su prioridad; una alerta sin leer se enciende hasta que se marca
  como leída. La pestaña «Servicios» sigue siendo el panel de Contratos.
- **Chat interno**
  ([ruta](../../frontend/private-web/src/features/chat/CanonicalChatRoute.jsx)).
  «Conversaciones» y «Mensajes» van lado a lado desde 1280 px; por debajo se ve
  una vista a la vez, y el botón «Conversaciones» («Volver a las
  conversaciones» para los lectores de pantalla) devuelve la lista. La
  conversación abierta va en cian. La presencia ya no va en verde y rojo: cada
  estado es un glifo neutro que se distingue por su forma, junto a su palabra
  (lleno, disponible; con una barra, ocupado o no molestar; a medias, ausente o
  vuelvo enseguida; hueco, desconectado; a trazos, sin información), con la
  leyenda «Presencia» sobre la lista
  ([formas](../../frontend/private-web/src/features/chat/presenceStatus.js) y
  [glifo y leyenda](../../frontend/private-web/src/features/chat/PresencePeople.jsx)).
  Las hojas del chat pintan solo con los tokens del OCC, así que `occ.css` ya
  no las repara.
- **Datos maestros**
  ([ruta](../../frontend/private-web/src/features/master-data/MasterDataRoute.jsx)).
  «Terminales», «Posiciones» y «Tipos de avión» son tablas de filas editables,
  con su formulario de alta; las filas inactivas se atenúan. Cada posición
  tiene «Ver en el mapa», que abre Mapa de posiciones en ella
  (`/admin-occ/positions-map?stand=A1`, con el código normalizado) y no lee
  nada. Las posiciones van en orden natural (A01, A02, A3… A10). Sus textos
  ganan inglés.
- **Tablets**
  ([ruta](../../frontend/private-web/src/features/devices/DevicesRoute.jsx)).
  Una tabla con el estado de cada tablet («En uso», «Libre» o «Revocada»), y
  liberar y revocar en diálogos; el de revocar, que no se deshace, empieza en
  «Cancelar». Sus textos ganan inglés.
- **Contratos listos**
  ([ruta](../../frontend/private-web/src/features/ready-contracts/ReadyContractsRoute.jsx)).
  La cuenta del día junto al título, «Fecha de operación» y los contratos como
  lista; cada uno muestra sus servicios a la vista, que «Servicios contratados
  (n)» pliega y vuelve a abrir, y conserva «Planificar vuelos».
- **Reportes**
  ([ruta](../../frontend/private-web/src/features/reports/CanonicalReportsRoute.jsx)).
  La barra «Reporte y período» lleva «Generar»; mientras llega la lista de
  reportes, un esqueleto bajo la barra dice «Cargando reportes…». El resultado
  lleva «Exportar Excel», «Exportar PDF» y «Exportar CSV» en su cabecera, la
  tabla densa y las páginas al pie. El botón de exportar, que tenía carpeta
  propia, se borró.
- **Primitivas y guardas.** U6 suma a `src/features/occ-ui` la
  [tabla densa](../../frontend/private-web/src/features/occ-ui/OccDataTable.jsx),
  que se dibuja como tabla o como lista, con filas encendidas, filas
  desplegables y tarjetas apiladas en pantallas estrechas, donde la fila
  elegida sigue en cian; la barra; el
  [botón](../../frontend/private-web/src/features/occ-ui/OccButton.jsx), que
  conserva el foco mientras su comando está en camino; el
  [campo](../../frontend/private-web/src/features/occ-ui/OccField.jsx), que
  dibuja su propio mensaje de error y cuyo pozo es `--occ-field`, con la llave
  `field` nueva en
  [`tailwind.config.js`](../../frontend/private-web/tailwind.config.js); el
  diálogo; la
  [pastilla de estado](../../frontend/private-web/src/features/occ-ui/OccStatusPill.jsx),
  con los tonos de
  [`statusVocabulary.js`](../../frontend/private-web/src/features/occ-ui/statusVocabulary.js);
  y las [clases](../../frontend/private-web/src/features/occ-ui/classes.js) de
  los registros. Las carpetas de las siete pantallas que no comparte nadie
  entran en `MIGRATED_FOLDERS` del
  [manifiesto del puente](../../frontend/private-web/src/styles/occLegacyBridgeMap.js),
  y la ruta de Notificaciones, en `MIGRATED_FILES`, porque el resto de su
  carpeta lo dibujan otros departamentos. Las
  [guardas](../../frontend/private-web/src/styles/occStyleGuard.test.js)
  exigen que esas pantallas dibujen como `occ-ui` y que las hojas del chat usen
  solo tokens.
- **El observador del marco.** Cobertura de posiciones, Datos maestros,
  Tablets, Chat interno y Notificaciones ya no abren su propio observador de
  cambios: escuchan en el canal del marco `occ_planning` (las dos primeras),
  `mobile_devices`, `operation_messages` y `notifications`, y releen en el
  acto, como antes; Notificaciones conserva su sondeo de 20 s. El
  [plan de peticiones](../../frontend/private-web/src/features/admin-occ/live/occRequestPlan.js)
  las cuenta aparte de los observadores que quedan, entre los que ya no hay
  ninguno de U6, y la
  [prueba de presupuesto](../../frontend/private-web/src/features/admin-occ/live/occRequestBudget.test.js)
  falla si una vuelve a abrir el suyo.
- **Lo que sigue en el puente.** Usuarios, Mis gastos, el panel de servicios de
  Contratos, el panel de incidencias que Revisión comparte con Planificación y
  los componentes de avisos que usan Gestión Humana, Finanzas y Contratos no se
  editan para el OCC. Las correspondencias de clases del puente no cambian: del
  manifiesto cambian solo las listas `MIGRATED_FOLDERS` y `MIGRATED_FILES`.
- **Pruebas.** Vitest cubre cada primitiva nueva, la paridad de los mensajes y
  las ocho rutas. La suite visual suma una prueba en Chrome por pantalla, a
  1920×1080 y a 1440×900, con una API simulada cuyas respuestas sintéticas
  pasan los validadores estrictos del cliente compartido
  ([validación](../../frontend/private-web/tests/visualScreensFixtures.test.js));
  cómo corre está en
  [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#suite-visual-de-los-mapas-del-occ).

Límites: la pestaña de servicios de Notificaciones, que es de Contratos,
conserva su propio observador de cambios, con su sondeo, mientras está
abierta. Chat interno conserva el margen de las
demás pantallas y no llena el alto. La insignia de la estación
(`OccStationBadge`) queda sin uso, y los alias `--occ-ui-*` del chat,
definidos sin que nadie los lea, hasta su limpieza. Las capturas se revisaron
en local, con una API simulada; nada de esto acredita un despliegue ni una
revisión visual en el VPS.

## Mapas del OCC en un solo motor (PR M2)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR M2 «Motor único y estilo NOC» (`314c124b`, `323189b2`, `5d759557` y
`c0b20127`), que esa verificación no cubre. Las decisiones y lo que añadirán
los PR M3 a M8 están en
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md). Son las mismas
pantallas sobre un solo motor. En M2 las posiciones eran puntos; desde el PR M4
son polígonos con su estado (ver
[Posiciones en rampa (PR M4)](#posiciones-en-rampa-pr-m4)). En M2 no había
tráfico en vivo: lo dibuja el PR M5 y lo mueve el PR M6 (ver
[Tráfico real en el mapa (PR M5)](#tráfico-real-en-el-mapa-pr-m5) y
[Cinemática y vuelo demo en el mapa (PR M6)](#cinemática-y-vuelo-demo-en-el-mapa-pr-m6)).
Desde el PR M7 los aviones se ven en 3D en Aeródromo y Rampa (ver
[Aviones 3D en Rampa y Aeródromo (PR M7)](#aviones-3d-en-rampa-y-aeródromo-pr-m7)).

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
  respaldo: sus páginas no cambian. En M2 las posiciones eran puntos con el
  estado que ya traían, dibujado con el vocabulario de `statusVocabulary.js`, y
  se agrupaban al alejar el mapa; el PR M4 los cambió por polígonos con los
  siete estados, «Llegando» y «Por liberar» incluidos, y por una pastilla por
  terminal. Los vuelos que traen posición son siluetas sin un color por estado,
  y PUJ se marca con su punto de referencia. La ficha del vuelo de Monitoreo
  queda fija en una esquina del mapa y ya no sigue al avión.
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
  ya existe. En M2 las pantallas seguían pasando al mapa su propia selección;
  desde el PR M4, Mapa de posiciones y Planificación escriben en él la posición
  elegida (`stand=`), y Monitoreo de vuelos sigue con la suya hasta que U3 y U5
  lo adopten. Desde el PR U3, la consola de Panorama ya elige solo a través de
  ese almacén.
- **Leyenda.** Un mapa con posiciones o vuelos en pantalla muestra el botón
  «Leyenda»
  ([`MapLegend.jsx`](../../frontend/private-web/src/features/maps/ui/MapLegend.jsx)),
  que lista solo lo que hay en pantalla: el avión de los vuelos, que apunta
  según su rumbo; los estados de las posiciones; y «No oficial» cuando alguna
  está en su ubicación de referencia interna. En M2 explicaba también los
  grupos de posiciones; desde el PR M4 explica la pastilla de cada terminal,
  las señales y las marcas de las posiciones. En Mapa de posiciones,
  Planificación y Monitoreo de vuelos es la
  única leyenda del mapa: las páginas ya no muestran la suya, que explicaba con
  colores por estado lo que el mapa ya no dibuja así. La plataforma de la
  consola conserva su leyenda en línea hasta que U3 retire el dashboard actual.
  Desde el PR U3, la consola usa la leyenda del mapa, plegada al abrir, y la
  banda de «Posiciones» lleva la suya en su encabezado.
- **Relectura sin remontar el mapa.** Al releer la misma estación (por foco,
  sondeo u `occ_planning`), Mapa de posiciones y Monitoreo conservan sus datos
  en pantalla mientras llega la respuesta: la página no vuelve al esqueleto y
  el mapa no se crea de nuevo. Un cambio de estación o de cuenta sí empieza
  vacío.
- **Laboratorio y suite visual.** `/map-lab` existe solo en desarrollo: diez
  escenas fijas del mapa (la revisión del plano de MDPC llegó con el PR M3; con
  el PR M4, la de los estados de rampa reemplazó a la de los puntos y llegaron
  la pareja combinada elegida y la ubicación de una posición), sin sesión ni
  API. La ruta lo importa solo en la rama
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
retire el dashboard actual. Desde el PR U3 el mapa regional ya no existe, y
el de meteorología solo aparece dentro del detalle de la píldora del clima de
Panorama, mientras está abierto.

Límites: a 1440×900 el resumen de Mapa de posiciones tapa la escala, los
créditos y las posiciones A1 a A5, y todavía pinta sus colores de estado; lo
rehace U5. El
3D de M2 era la inclinación de cámara de siempre; los aviones 3D llegaron con M7.
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
En M3 las posiciones seguían siendo los puntos de M2; sus polígonos, sus
estados y su leyenda llegaron con el PR M4 (ver
[Posiciones en rampa (PR M4)](#posiciones-en-rampa-pr-m4)).

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
ubicación. En M3 ninguna pantalla usaba los aeropuertos de la región ni las
radioayudas que trajo el extracto de OurAirports; desde el PR M8 los dibujan los
mapas del OCC (ver
[Referencias y meteorología en el mapa (PR M8)](#referencias-y-meteorología-en-el-mapa-pr-m8)).
Las capturas se revisaron en
local, en el laboratorio; nada de esto acredita un despliegue ni una revisión
visual en el VPS.

## Imagen aérea y vuelos para el mapa (PR A3)

Posterior al commit verificado de esta nota: esta sección describe la API y el
cliente compartido del PR A3 «Imagen aérea y vuelos para el mapa» (código de
`77dff268` a `e098ccde`;
[ADR-0042](../../docs/adr/0042-occ-air-picture-and-map-flights.md)). Ese PR no
cambió ninguna pantalla. Desde el PR M5, también posterior a ese commit, los usa
el mapa de Monitoreo de vuelos dentro del marco del OCC (ver
[Tráfico real en el mapa (PR M5)](#tráfico-real-en-el-mapa-pr-m5)), y desde el
PR M6, también Mapa de posiciones y la vista «Mapa» de Planificación (ver
[Cinemática y vuelo demo en el mapa (PR M6)](#cinemática-y-vuelo-demo-en-el-mapa-pr-m6)),
y desde el PR U3, la consola de Panorama (ver
[Consola del OCC (PR U3)](#consola-del-occ-pr-u3)).

- **Lo que ya existe.** El cliente compartido ofrece `getOccAirPicture`,
  `getOccAircraftTrack` y `getOccMapFlights`, con validadores estrictos y el
  código `invalid_map_query`
  ([`occMap.ts`](../../packages/api-client/src/occMap.ts)). Los lee el personal
  interno con la estación en su alcance y un permiso de Panorama, Monitoreo de
  vuelos, Mapa de posiciones o Planificación; la imagen aérea solo existe para
  PUJ.
- **Desde M5: aviones y crédito.** El mapa de Monitoreo dibuja los aviones de
  `air-picture` con su estela, une cada uno a su fila de `flights` por
  `matchedFlightKey` (también por la clave vieja de una visita enlazada con
  3-N07, mediante `proposalId`) y muestra «Datos de aeronaves:
  {source.name}», con el enlace a la red y a su licencia, en su atribución y
  en una línea a la vista.
  El estado (`Live`, `Stale`, `Warming`, `Unavailable` o `Disabled`), los
  motivos y el crédito están en los mensajes del mapa, en español y en inglés,
  y nunca se muestra el título de un error.
- **Desde M5: ritmo.** La imagen se pide al ritmo de `refreshAfterSeconds`
  (10 segundos, 2 mientras calienta), con `trails=short` una vez y `none`
  después, y en pausa con la pestaña oculta; `flights`, con `occ_planning`
  (como mucho una vez cada 3 segundos) y un sondeo de seguridad de 60; la
  estela completa, al elegir un avión. El
  [plan de peticiones del marco](../../frontend/private-web/src/features/admin-occ/live/occRequestPlan.js)
  cuenta la imagen y los vuelos de la consola, y la prueba de presupuesto del
  mapa, los de Monitoreo.
- **Elegir un vuelo.** La selección `flightId` acepta una `flightKey`, una
  `visitKey`, una pierna o una escala, y la clave vieja de una visita que OCC
  enlazó a un vuelo planificado (3-N07) se resuelve por `proposalId`. Desde
  M6, «Seguir» no se suelta al importar, porque la clave de un vuelo no cambia
  con una importación normal.
- **Desde M6 y U3: hitos y vuelo demo.** La barra de avance de cada posición
  sale de `milestones`, y el avión demo se ajusta a los instantes del bloque
  `demo`, sin derivar los suyos. Desde U3, la tira de hitos del inspector de
  Panorama también sale de `milestones`, sin otra lectura.
- **El panel regional** del Panorama leía `GET occ/traffic/aircraft` (OpenSky,
  apagado sin credenciales) sin reconocer vuelos de ELEVANT. Desde el PR U3 ya
  no existe: el tráfico de la región es la imagen aérea del mapa único.

## Posiciones en rampa (PR M4)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR M4 «Posiciones en rampa» (`40597917`, `3ef22988` y `714dc4a3`), que esa
verificación no cubre. Las decisiones, lo que pasa a M5 y las diferencias con el
diseño están en la actualización del 13 de noviembre de 2026 sobre M4 de
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md), y la ubicación que
guarda OCC, en la nota de esa fecha de
[ADR-0027](../../docs/adr/0027-occ-ready-contracts-and-stand-locations.md).
Mapa de posiciones y la vista «Mapa» de Planificación dibujan cada posición
como un polígono con su estado, con las mismas lecturas de antes: la API no
cambia.

- **Siete estados que se leen sin color.**
  [`standModel.js`](../../frontend/private-web/src/features/maps/stands/standModel.js)
  decide cómo se lee cada posición, y
  [`standLayers.js`](../../frontend/private-web/src/features/maps/stands/standLayers.js)
  la dibuja con el vocabulario de `statusVocabulary.js`: «Libre» (contorno
  sólido de 1 px), «Planificada» (a trazos 4-3, de 1,5 px), «Llegando» (un
  velo, 2,5 px y la entrada resaltada), «Ocupada» (la losa, 2 px y un avión),
  «Por liberar» (además, un reloj), «Inhabilitada» (rayas y trazos 2-2) y «Sin
  verificar» (punteado 1-3). Lo normal no lleva tono: el cian marca lo elegido y
  lo que se está ubicando, y el ámbar y el rojo, las señales «Sin agente que la
  cubra», «Pasó su hora de salida» y «Otra aeronave llega a esta posición».
  Una posición sigue «Llegando» mientras el avión no esté en ella y queda libre
  al registrarse el `PUSHBACK`. Con lo que las pantallas leían en M4, el
  tablero de posiciones, «en la posición» era la hora de llegada del tablero:
  un vuelo demo importado pasaba a «Ocupada» al tocar pista, como antes. Desde
  el PR M6, dentro del marco del OCC, el mapa recibe también los vuelos con sus
  hitos, los instantes demo y dónde está cada avión (ver
  [Cinemática y vuelo demo en el mapa (PR M6)](#cinemática-y-vuelo-demo-en-el-mapa-pr-m6)).
  Los estados y las cuentas regresivas cambian al minuto
  ([`useStandDisplay.js`](../../frontend/private-web/src/features/maps/stands/useStandDisplay.js)
  con
  [`useMinuteClock.js`](../../frontend/private-web/src/features/maps/core/useMinuteClock.js)),
  sin ninguna petición nueva.
- **Según el zoom, nunca a un zoom fijo.** Entre Aproximación y Aeródromo, una
  pastilla por terminal: «A · 3/16» (las posiciones con un avión sobre las que
  se dibujan), con una flecha cuando llega un vuelo; un clic abre la vista de
  esa terminal, y los grupos de posiciones desaparecen. Desde poco antes de
  Aeródromo, los polígonos con su estado; desde poco antes de Rampa, los
  códigos, los vuelos y las entradas; y más cerca, el rótulo completo, con la
  hora, las iniciales de quien la cubre y el motivo de su señal. Cada umbral
  sale del encuadre real de las vistas.
  [`standFeatures.js`](../../frontend/private-web/src/features/maps/stands/standFeatures.js)
  arma los datos del mapa, y una relectura del tablero solo le manda las
  posiciones que cambiaron.
- **Ficha, selección y cobertura.** Al pasar el puntero, una ficha dice el
  código, el estado, el vuelo, quién la cubre y los motivos de sus señales, y se
  coloca debajo o encima de la caja; un anillo marca las demás posiciones que
  cubre el mismo agente
  ([`standInteractions.js`](../../frontend/private-web/src/features/maps/stands/standInteractions.js)).
  Un clic escribe `stand=` en la URL, en Mapa de posiciones y en Planificación,
  y abre el cajón, que suma «Estado en el mapa»: el estado, quién la cubre, las
  señales, la combinada que la anula, el límite de fuselaje estrecho y de dónde
  sale su ubicación
  ([`StandDetailFacts.jsx`](../../frontend/private-web/src/features/maps/ui/StandDetailFacts.jsx));
  Planificación lo muestra en el panel junto a su mapa. La escala de la
  posición
  ([`StandTurnaround.jsx`](../../frontend/private-web/src/features/maps/ui/StandTurnaround.jsx))
  solo da por «Real» una hora ya alcanzada en el reloj de las posiciones: los
  instantes de un vuelo demo son su plan, así que «aterrizó» y «Real» esperan a
  su toque. «Operación» dice el estado de la operación de tierra que traen los
  vuelos del mapa (Asignada, En curso, Devuelta…, con las palabras de
  Planificación) y, sin operación, el de la escala. «Tipo de aeronave» toma el
  de la escala cuando el tablero no lo trae. El cajón dice el estado
  una sola vez, con las palabras del mapa: su cabecera ya no muestra la del
  tablero, que podía contradecirla («Planificada» frente a «Llegando»). La
  cámara solo se mueve si la posición elegida queda fuera de la vista. Una `Esc`
  cierra el cajón y la siguiente limpia la selección.
- **Combinadas.** La posición que una combinada anula se dibuja «Inhabilitada»,
  con «Anulada por A9» y un enlace a trazos hasta la que la anula. «Solo
  fuselaje estrecho» suma una caja punteada de letra C dentro de una posición
  más ancha.
- **Ubicar con confirmación.** «Ubicar en el mapa» pide «Haz clic en el centro
  de la posición …» y muestra la caja de la posición, a tamaño real, siguiendo
  al puntero; a 15 m o menos de su centro en el plano se ajusta a su contorno.
  Un clic deja la ubicación pendiente, y solo «Guardar ubicación» la envía, con
  el mismo `PUT occ/stands/{standId}/location` de siempre; «Cancelar» o `Esc`
  la descartan
  ([`placing.js`](../../frontend/private-web/src/features/maps/stands/placing.js)).
  La ubicación guardada traslada sin deformarla la caja del plano si queda a
  80 m o menos de su centro; más lejos, o en una posición que el plano no
  conoce, el mapa dibuja una caja propia
  ([`standGeometry.js`](../../frontend/private-web/src/features/maps/airport/standGeometry.js)).
  Las posiciones del tablero que el mapa no dibuja salen en la lista como «Sin
  ubicar» y se ubican desde su cajón.
- **Leyenda.** Lista solo lo que hay en pantalla: los estados, como recortes
  del mapa y con las palabras del vocabulario; las señales, con su forma, una
  por posición: la más fuerte, la única que el mapa dibuja en ella; la pastilla
  de las terminales y, mientras se ve una con un vuelo que llega, su flecha;
  «No oficial»; el enlace de las combinadas; la caja de fuselaje estrecho; el
  anillo del mismo agente, mientras se dibuja, con la posición a la que sigue
  (la elegida o la que está bajo el puntero); y, al ubicar, la caja y la
  ubicación sin guardar.
- **Laboratorio y suite visual.** La escena `ramp-states`, con los siete
  estados, reemplaza a `ramp-points`, y llegan `ramp-combined-selected` y
  `ramp-placing-ghost`. La suite visual suma los
  [estados de rampa](../../frontend/private-web/tests/visual/lab/map-lab.ramp-states.spec.mjs)
  y las
  [interacciones de Mapa de posiciones](../../frontend/private-web/tests/visual/occ/positions-map.interactions.spec.mjs).

El 13 de noviembre de 2026 el dueño del producto decidió que su documento de
coordenadas manda sobre OpenStreetMap, que está desactualizado en el
aeropuerto: el mapa dibuja cada posición como la tiene el plano, centrada en el
punto de ese documento, ninguna se mueve ni se gira hacia OSM, y solo OCC mueve
una al ubicarla.

Límites: la plataforma de la consola recibe los polígonos con el estado que ya
traía, sin «Llegando», «Por liberar» ni señales, hasta que U3 la rehaga. Las
huellas de los aviones a escala, la barra de avance de los hitos, «El avión ya
está en la posición. Registra la llegada.» y el tipo de avión en el rótulo
llegaron con M6, no con M5, y solo dentro del marco del OCC; fuera de él, un
avión sigue marcando las posiciones ocupadas y las por liberar. El reloj del
servidor para los estados llegó con M6, solo dentro del marco del OCC; fuera
de él cambian con el minuto del navegador.
Desde M6, en Mapa de posiciones y en Planificación, elegir un vuelo marca su
posición; elegir una posición todavía no resalta su avión en el mapa. Pasar de
posición en posición con `[` y `]` y girar una posición al ubicarla quedan
aplazados. Las capturas se revisaron en local; nada de esto acredita un
despliegue ni una revisión visual en el VPS. *Posterior:* desde el PR U3, la
consola de Panorama dibuja las posiciones con sus siete estados y sus señales,
a partir del tablero de posiciones y de los vuelos del mapa, junto con el
tráfico; elegir una posición marca su vuelo en el tablero y lo muestra en el
inspector (ver [Consola del OCC (PR U3)](#consola-del-occ-pr-u3)).

## Tráfico real en el mapa (PR M5)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR M5 «Tráfico real en el mapa» (`48ae657e`, `585f07d3` y `03dda909`), que esa
verificación no cubre. Las decisiones están en la actualización del 13 de
noviembre de 2026 de [ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md).
En M5 solo Monitoreo de vuelos, dentro del marco del OCC, dibujaba el tráfico.
Desde el PR M6 lo dibujan también Mapa de posiciones y la vista «Mapa» de
Planificación (ver
[Cinemática y vuelo demo en el mapa (PR M6)](#cinemática-y-vuelo-demo-en-el-mapa-pr-m6)),
y desde el PR U3, la consola de Panorama (ver
[Consola del OCC (PR U3)](#consola-del-occ-pr-u3)).

- **De dónde salen los aviones.**
  [`useMapSituation.js`](../../frontend/private-web/src/features/maps/useMapSituation.js)
  pide las tres lecturas de A3 con el bucle del marco: la imagen aérea al ritmo
  que pide el servidor (10 segundos) y los vuelos de ELEVANT con `occ_planning`
  y cada 60 segundos, las dos en pausa con la pestaña oculta, y la estela
  completa de un avión al elegirlo. El
  [servicio del mapa](../../frontend/private-web/src/services/occMapService.js)
  explica los errores por su código, sin mostrar el título del servidor, y
  [`serverClock.js`](../../frontend/private-web/src/services/serverClock.js)
  cuenta el tiempo con la hora del servidor. Un avión que la API reconoce como
  vuelo de ELEVANT, por matrícula o por *callsign*, se dibuja como ese vuelo. En
  M5 un vuelo de ELEVANT sin señal en vivo no se dibujaba, y su bloque de datos
  decía «Sin posición todavía»; desde M6 se dibuja estimado cuando el
  proveedor dice que está en el aire, que aterrizó o que llegó a su posición, y
  esa frase queda para el que solo está programado.
- **Cómo se lee cada avión**, sin color para lo normal
  ([capas](../../frontend/private-web/src/features/maps/traffic/trafficLayers.js)):
  la llegada de AVIAM es una silueta llena y más grande, con su etiqueta
  siempre visible («ZZ161» y «B38M 026 150 → A5», con «GND» en tierra); la
  salida, una silueta hueca; el resto del tráfico, pequeño y tenue, con su
  etiqueta al pasar el puntero o al elegirlo. El tráfico ajeno en tierra no se
  dibuja dentro de una posición en la que ya está un avión de AVIAM o demo,
  desde que llega a ella hasta que la deja; en la posición de un vuelo que
  todavía no llega sí se dibuja, porque es el conflicto que OCC tiene que
  ver. Lo estimado lleva un anillo discontinuo y «est.»; lo que no se
  actualiza va atenuado y dice desde cuándo, con las palabras del vocabulario
  del OCC: «Sin actualizar desde las 10:59», la hora de Punta Cana de su
  última posición, que no cambia hasta que llega otra; y un vuelo demo, la
  placa «Demo» de rayas. Las siluetas son propias, una por categoría, y
  salen de una
  [tabla de dimensiones](../../frontend/private-web/src/features/maps/aircraft/types.js).
  Las estelas se desvanecen hacia la cola y nunca se unen a través de un hueco
  de datos.
- **Elegir un avión.** En Monitoreo, un clic en un vuelo de AVIAM elige ese
  vuelo de la lista, y uno en otro avión escribe su dirección ADS-B en la URL
  (`hex=`). Lo elegido va en cian, más grande y con su anillo. Su
  [bloque de datos](../../frontend/private-web/src/features/maps/ui/FlightDataBlock.jsx),
  fijo arriba a la izquierda del mapa, da el número, el tipo y la matrícula; el
  origen y el destino, con su hora y la cuenta atrás, sin hablar en futuro de
  lo que ya pasó («Debía llegar 10:55 · hace 5 min» si la hora prevista pasó,
  «Salió · hora prevista 10:45» si el proveedor dice que salió sin dar la
  hora); la altitud, la velocidad y el rumbo; la posición, con «Pista 08» en un
  vuelo demo; y de dónde sale la posición: «En vivo · hace 4 s», «Sin
  actualizar desde las 10:59» (lo mismo que su etiqueta en el mapa), la frase
  de lo estimado o «Sin posición todavía». Marca
  «Vuelo demo», «Sin importar» y «Cancelado por el proveedor (demo)», y enlaza
  «Ver escala», solo de un vuelo importado, y «Ver posición». En M5 su ruta era
  lo que voló, en línea sólida, y una recta discontinua hasta su siguiente punto
  (su posición, el aeropuerto o su destino); desde M6 sigue su trayectoria hasta
  la posición.
  Una selección que nombra una visita o una escala (sus dos tramos) muestra el
  tramo que vuela el avión dibujado: tras la escala, el de la salida.
- **Crédito y estado del tráfico.** Mientras hay aviones en pantalla, la
  atribución del mapa y una línea a la vista, abajo a la izquierda, dicen
  «Datos de aeronaves: {red}», con el enlace a la red y, si lo hay, a su
  licencia
  ([estado del tráfico](../../frontend/private-web/src/features/maps/ui/MapSourceStatus.jsx)).
  El mismo componente dice el estado del tráfico con palabras propias:
  «Cargando tráfico…», «No hay aviones en la zona», «No hay tráfico en vivo en
  este momento.» con su motivo y «Reintentar», «Tu acceso no incluye el
  tráfico en vivo.» o «Tráfico con retraso: último dato hace 4 min.». La lista
  de fuentes de la barra de estado recibe el estado del tráfico aéreo. Si la
  imagen aérea falla, el mapa conserva los vuelos de ELEVANT y ofrece
  «Reintentar»; en una estación sin tráfico en vivo dice que la fuente no está
  configurada, y la lista de fuentes, «Sin configurar», no «Sin permiso».
  Ese estado sale solo de la imagen aérea, como en la lista de fuentes: si no
  se pueden cargar los vuelos de AVIAM, el tráfico sigue en el mapa y un aviso
  aparte, bajo el del tráfico, dice «No se pudieron cargar los vuelos de
  AVIAM.», con «Reintentar»; si solo falla una relectura de los vuelos, el
  mapa conserva los anteriores sin avisar. La antigüedad de «Tráfico con
  retraso» avanza con el reloj del servidor, segundo a segundo, también entre
  dos lecturas que fallan.
- **Menú de capas.** El botón «Capas» del mapa, o la tecla `L`, abre el
  [menú](../../frontend/private-web/src/features/maps/ui/MapLayersMenu.jsx)
  con el grupo Tráfico: «Vuelos de AVIAM», siempre visible, «Otro tráfico»,
  «Etiquetas de todo el tráfico», «Estelas de todo el tráfico» y «Ruta del
  vuelo elegido». El navegador guarda solo lo que difiere de lo que trae cada
  vista (`elevant-occ-map-layers:v1`). Con el menú abierto, una `Esc` lo
  cierra sin soltar lo elegido.
- **Leyenda.** Suma, solo cuando están en pantalla, las clases de avión,
  «Demo», «est.», «Sin actualizar», las estelas y la ruta del vuelo elegido.
- **Monitoreo de vuelos.** La página pasa al mapa todos sus vuelos: uno que el
  mapa ya dibuja como tráfico no se dibuja dos veces. El bloque de datos
  reemplaza la ficha de la página para los vuelos que el mapa conoce; la ficha
  sigue para uno que el mapa no conoce y mientras el mapa no puede dibujar
  ([adaptador](../../frontend/private-web/src/features/flight-monitoring/components/FlightMap.jsx)).
- **Laboratorio.** Siete escenas nuevas con tráfico sintético: tráfico mixto en
  la región, una llegada demo, tráfico en tierra en la rampa, una imagen con
  retraso y un vuelo estimado, un vuelo elegido, otro avión elegido y el menú
  de capas abierto
  ([escenas](../../frontend/private-web/src/features/maps/lab/trafficScenes.js)).
  En el laboratorio la selección va en la URL (`flightId=` o `hex=`). En M5 lo
  estimado solo se veía ahí, con posiciones pasadas a mano; desde M6 las
  calcula el almacén de movimiento, en el laboratorio como en las pantallas.
  Las pruebas están en
  [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#tráfico-real-en-los-mapas-del-occ-pr-m5).

Límites: en M5, Mapa de posiciones, Planificación y la plataforma de la consola
no dibujaban tráfico, y no había cinemática, modo seguir, huellas a escala ni
barra de avance de los hitos; desde M6 los tienen Mapa de posiciones y la vista
«Mapa» de Planificación, y la consola, con U3. Los anillos de distancia,
los ejes de pista, los aeropuertos de la región, la FIR, las radioayudas, el
día y la noche, el satélite y el viento pasaron a M8, por eso en M5 el menú de
capas solo traía el grupo Tráfico; el PR M8 los trae, salvo la FIR (ver
[Referencias y meteorología en el mapa (PR M8)](#referencias-y-meteorología-en-el-mapa-pr-m8)).
Desde M5, con el tráfico encendido (como en
Development), abrir Monitoreo de vuelos en el OCC hace que la API lea la red de
tráfico mientras la pestaña se ve y hasta 15 minutos después. Las capturas se
revisaron en local, en el laboratorio; nada de esto acredita un despliegue ni
una revisión visual en el VPS. *Posterior:* desde el PR U3, la consola de
Panorama también dibuja el tráfico, y abrirla, que es la primera pantalla del
OCC al iniciar sesión, también hace que la API lea la red.

## Consola del OCC (PR U3)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR U3 «Consola del OCC con el mapa a pantalla completa» (`94e60144`, `de08535e`,
`582077b1` y `bc8bc5f5`), que esa verificación no cubre. Las decisiones, el
presupuesto de peticiones y las diferencias con el diseño están en la nota del
14 de noviembre de 2026 de
[ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md). U3 cambia solo
Panorama (`/admin-occ/dashboard`): la API no cambia, y las demás pantallas
tampoco.

- **Qué se ve.** El mapa único del OCC llena el espacio bajo la barra de
  estado y abre en la vista Rampa
  ([vista](../../frontend/private-web/src/features/dashboard/noc/ConsolePage.jsx)).
  Encima flotan «Tablero» (arriba a la izquierda), «Cifras de la jornada»
  (arriba al centro), «Alertas» (arriba a la derecha), el «Inspector» (debajo
  de «Alertas», cuando hay algo elegido) y «Posiciones» (abajo). Entre
  «Posiciones» y el mapa quedan «Capas», el selector de vistas y «Leyenda»,
  que son del mapa. Cada panel se pliega a una pastilla con su título, que es
  un botón, y el pliegue se recuerda en la pestaña
  ([panel flotante](../../frontend/private-web/src/features/occ-ui/OccFloatingPanel.jsx)).
  «Posiciones» abre plegada, «Cifras de la jornada» también por debajo de
  1600 px, y «Tablero» y «Alertas» por debajo de 1280 px. «Ocultar paneles»,
  bajo el mapa, deja solo el mapa (`focus=map`), y «Mostrar paneles» los
  devuelve. Los paneles son casi opacos y sin desenfoque. La consola los mide y
  el mapa encuadra sus vistas en lo que queda a la vista. Lo elegido no queda
  debajo de un panel: la cámara se mueve después de medir el inspector que se
  abre con la selección, y si después un panel se despliega o se pliega, o
  cambia la ventana, y eso tapa lo elegido que estaba a la vista, la consola lo
  trae al centro de lo que queda a la vista, con el mismo acercamiento
  ([cámara](../../frontend/private-web/src/features/dashboard/noc/consoleCamera.js)).
  Lo que la persona sacó de la vista se queda donde lo dejó.
- **Tablero.** «Llegadas» y «Salidas» son los vuelos del mapa como tiras de
  vuelo ordenadas por su mejor hora: la hora con «real», «est.» o «prog.», el
  vuelo, el aeropuerto, la posición, el estado y la cuenta atrás. Debajo, «Por
  importar» lista los vuelos que el proveedor propone y OCC no importó, cada
  uno con «Importar». «Escalas» es la tabla de escalas del día, con los
  filtros «Todas», «En operación», «Sin recursos» y «Completadas». Un vuelo
  demo lleva «Demo», y «est.» marca una tira solo cuando su avión está en una
  posición estimada. Una llegada sin posición dice «Llegada sin posición
  asignada», con el triángulo ámbar si llega en menos de 60 minutos. Una tira
  dice «En posición» con la regla de los estados de las posiciones: el instante
  de calzos del vuelo demo, el hito `BLOCK_ON` o la hora de calzos que escribe
  «Registrar llegada»; el «Arrived» del proveedor solo dice «Aterrizó»
  ([tablero](../../frontend/private-web/src/features/dashboard/noc/boardModel.js)).
  El encabezado del tablero lleva su leyenda, solo con lo que dibuja la pestaña
  a la vista: el triángulo de «Atención» y el octágono de «Urgente» con su
  palabra, y «Demo» y «est.» con lo que significan, con las palabras de
  «Leyenda» de la barra de estado.
- **Alertas.** Las alertas urgentes y de atención de la estación que la cuenta
  no recibió, cada una con «Recibido», el recibo de lectura por cuenta, y
  «Abrir»; plegado, el panel dice cuántas son. Debajo, «Pendientes de la
  jornada»: lo que sigue abierto del día (una llegada sin posición o sin
  agente, un agente asignado que no puede operar, un vuelo por importar, una
  entrega por revisar o una salida que pasó su hora), con la acción que lo
  cierra cuando la hay: «Elegir posición», «Asignar agente», «Revisar» o
  «Importar»
  ([pendientes](../../frontend/private-web/src/features/dashboard/noc/pendingModel.js)).
  Esos pendientes salen de cuatro lecturas (la planificación, la disponibilidad
  de los agentes, los vuelos del mapa y la cola de revisión), y cada una apaga
  solo lo suyo: la que no respondió, falló, fue rechazada o muestra datos
  viejos deja una línea que lo dice, con «Reintentar» si falló, encima de lo
  que trajeron las demás. «No hay pendientes.» solo aparece cuando respondieron
  todas, así que un día sin escalas sigue mostrando el vuelo demo por importar.
  Los avisos simples y las alertas ya recibidas siguen en el cajón «Alertas y
  avisos» del marco.
- **Cifras de la jornada.** Escalas, en operación, llegan en 60 min, sin
  recursos, por revisar y completadas, cada una con su definición. Una cifra
  cuya consulta no respondió muestra «—», nunca un cero; un día sin escalas
  sí respondió, y sus cifras son ceros contados. Un panel que la cuenta no
  puede leer dice «No tienes permiso para ver esta información.»; solo la
  planificación, que lee el día de la estación, dice «No hay una estación OCC
  autorizada para consultar este panorama.».
- **Posiciones.** Plegado, dice las escalas del día, las que están en operación
  y cuántas posiciones hay en cada estado. Abierto, la banda de las posiciones en
  el tiempo, una fila por posición con sus escalas bajo la línea «ahora», con
  «4 h», «8 h» o «Día», «Con vuelos» o «Todas» y su leyenda en el encabezado
  ([banda](../../frontend/private-web/src/features/dashboard/noc/standTimeline.js)).
- **Una sola selección.** Elegir una tira, una escala, un pendiente o una barra
  de la banda escribe la selección en la URL (`flightId=` o `stand=`) y la
  lleva al mapa; elegir en el mapa pone al frente la pestaña del vuelo y marca
  su tira. El «Inspector» muestra el bloque de datos del vuelo o del avión, o
  los datos de la posición con su vuelo actual o el siguiente, más la tira de
  hitos de su operación, que sale de los hitos que trae cada vuelo del mapa.
  Ofrece «Importar» o «Asignar agente» cuando corresponde, y deja quitar la
  selección.
- **Importar y asignar sobre el mapa.** «Importar vuelos» abre el diálogo de
  importación de Planificación sobre la consola, y «Asignar agente», el panel
  de asignación de Planificación, con sus mismas opciones y comandos: OCC no
  sale de Panorama. Después, la consola relee una vez su planificación, sus
  posiciones y la disponibilidad de los agentes, y el panel de asignación sus
  opciones; el sondeo de 60 s de la planificación no las relee, así que la
  lista de agentes no se vacía mientras OCC elige
  ([asignación](../../frontend/private-web/src/features/dashboard/noc/ConsoleAssignDrawer.jsx)).
- **Llegada nueva.** Cuando aparece en los vuelos del mapa una llegada demo
  nueva, una pastilla dice «Llegada nueva: {vuelo}» con la placa «Demo», «Ver
  y seguir» y «Cerrar». «Ver y seguir» elige el vuelo, escribe `follow=1` y la
  vista que lo sigue, y lleva la cámara a esa vista; cuando el mapa se asienta,
  centra el avión del vuelo si el mapa lo dibuja y nadie movió la cámara
  entretanto. El avión de un vuelo demo se dibuja desde M6, y que el mapa siga
  el vuelo también llega con M6. Al abrir la consola, recargarla o volver de
  otro módulo, la pastilla
  también anuncia la llegada demo que ya venía y todavía no está en su
  posición, porque Superadministración suele dispararla antes. «Cerrar» y «Ver
  y seguir» la cierran para la pestaña, y una pastilla cerrada no vuelve
  ([pastilla](../../frontend/private-web/src/features/dashboard/noc/NewArrivalPill.jsx)).
- **Procedencia y clima.** Bajo el mapa, una línea dice de dónde sale lo que
  muestra, solo lo que aplica: «Posiciones: referencia interna sin
  verificar.», «Aviones: {red}, hace N s.» (o «sin tráfico en vivo»), cuántas
  posiciones son estimadas e «Incluye un vuelo demo.»
  ([línea](../../frontend/private-web/src/features/dashboard/noc/ProvenanceLine.jsx)).
  A su derecha, la píldora del clima (viento, QNH, antigüedad y «No oficial»)
  abre el detalle de MDPC (ver [OCC / Administración](#occ--administración)).
- **Sin mapa.** Si el navegador no puede dibujar el mapa (sin WebGL2), queda la
  lista de posiciones del mapa y los mismos paneles se ordenan debajo, en una
  cuadrícula.
- **Lecturas y presupuesto.** Cada panel lee y falla por su cuenta, con sus
  cinco estados
  ([lecturas](../../frontend/private-web/src/features/dashboard/noc/useConsoleData.js)).
  La planificación, las posiciones, la cola de revisión y la disponibilidad de
  los agentes se releen cada 60 segundos, nunca con `occ_planning`; la cola,
  además, con `occ_review`. Los vuelos y los aviones son los del mapa, leídos
  una sola vez para el mapa y los paneles, y los avisos, los del marco. La
  posición de una escala que traen esos vuelos es la de ellos, que se releen
  con `occ_planning`: una posición asignada, cambiada o liberada en otra
  pantalla se ve enseguida igual en el tablero, en «Sin recursos» (el filtro y
  la cifra) y en «Pendientes de la jornada», y la banda dibuja cada escala una
  sola vez; la planificación pone los agentes.
  Panorama ya no abre su propio observador. Una consola en reposo hace 16
  peticiones por minuto, y 38 durante un minuto de vuelo demo, por debajo de
  40 y de 70; una
  [prueba](../../frontend/private-web/src/features/dashboard/noc/useConsoleData.budget.test.jsx)
  lo repite con los hooks reales.
- **Arranque.** La pantalla de arranque del OCC espera a que la consola esté en
  pantalla con sus primeros datos, los vuelos del mapa; sin el alcance PUJ,
  cede enseguida
  ([ruta](../../frontend/private-web/src/features/dashboard/noc/ConsoleRoute.jsx)).
- **Lo que se retiró.** El panorama anterior (su vista, su ruta, su lectura,
  el panel del tráfico regional de OpenSky con su mapa, su adaptador y sus
  textos) y el bloque de `occ.css` que lo disponía. La carpeta
  `dashboard/noc` entra en `MIGRATED_FOLDERS` del
  [manifiesto del puente](../../frontend/private-web/src/styles/occLegacyBridgeMap.js).
  Las pruebas están en
  [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#la-consola-del-occ-pr-u3).

Límites: el mapa todavía no sigue un vuelo ni dibuja los aviones estimados y
demo, la ruta del vuelo elegido hasta su posición o la barra de avance de las
posiciones, que llegan con M6, ni el 3D, que llega con M7. Lo elegido vuelve a
la vista cuando los paneles cambian el espacio, no cuando se mueve: un avión
elegido que vuela hasta quedar debajo de un panel sigue ahí hasta que la
persona mueva la cámara o el mapa lo siga (M6). Un avión de otro tráfico, sin
vuelo de ELEVANT, vuelve a la vista de un salto, sin animación. El clima sigue
leyendo el METAR de IEM desde el navegador, y el detalle monta un segundo mapa,
pequeño, para las imágenes satelitales mientras está abierto; el plan pasa el
satélite a una capa del mapa único en M8. «Importar» abre el diálogo con todo
el día, no en el vuelo de la tira. Los conteos de «Alertas» salen de los 100
avisos más recientes que lee el marco. El dibujo de las posiciones en el mapa
sale del tablero de posiciones, que se relee cada 60 segundos: una escala
movida o liberada en otra pantalla cambia en el mapa hasta un minuto después
que en los paneles, y una liberada sigue en su fila de la banda hasta entonces.
Las capturas se revisaron en local, con una API simulada; nada de esto acredita
un despliegue ni una revisión visual en el VPS.

## Cinemática y vuelo demo en el mapa (PR M6)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR M6 «Cinemática y vuelo demo en el mapa»: los módulos puros (`71b01804`,
`9b3cc9d5` y `ad9ac1fc`) y su cableado en los mapas (`73ec0387`, `b544d369` y
`763cf9ae`), que esa verificación no cubre. Las decisiones, la prueba de 25 kt,
los límites conocidos y las diferencias con el diseño están en la
actualización del 14 de noviembre de 2026 de
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md). Dentro del marco del
OCC, los aviones de Monitoreo de vuelos, de Mapa de posiciones y de la vista
«Mapa» de Planificación se mueven con la hora del servidor, con las mismas
lecturas de M5: la API no cambia.

- **Un bucle por mapa.**
  [`frameLoop.js`](../../frontend/private-web/src/features/maps/core/frameLoop.js)
  pide cuadros solo mientras algo se mueve, dibuja a la hora del servidor, se
  detiene con la pestaña oculta y, con movimiento reducido, mueve los aviones
  una vez por segundo. Escribe el tráfico en cada cuadro con menos de 30
  aviones a la vista y, con más, de 2 a 30 veces por segundo. React no
  renderiza por cuadro.
- **Qué se mueve y de dónde sale.**
  [`motionStore.js`](../../frontend/private-web/src/features/maps/traffic/motionStore.js)
  une cada lectura con la cinemática pura de `kinematics/`. Un avión en vivo
  sigue su señal. Sin señal, un vuelo de AVIAM sigue su ruta prevista, y su
  bloque dice «Sin señal desde hace 20 s» y, desde los 30 s, «Sin actualizar
  desde las 10:59»; al minuto (en tierra, a los 20 s) se dibuja estimado, con
  el anillo discontinuo y «est.». Un vuelo real solo se dibuja estimado si el
  proveedor dice que está en el aire, que aterrizó o que llegó a su posición, y
  una salida importada solo deja su posición con el `PUSHBACK` o con señal
  real que la muestre en movimiento: un avión parado en su posición se queda en
  ella aunque su señal envejezca. El vuelo demo siempre se dibuja. Los vuelos
  reales usan la pista de las llegadas en vivo vistas en final en la última
  media hora y, si no hay, la 08; el bloque dice «Pista 26 (por el tráfico)» o
  «Pista 08 (habitual)». El viento del METAR llega con M8.
- **El vuelo demo.** Sigue los instantes que manda el servidor, siempre por la
  08: aparece en aproximación tan lejos como piden las velocidades reales (5 NM
  como mínimo), aterriza, rueda y se parquea a sus horas, espera en su posición
  hasta que el servidor da su salida y se desvanece al final. Sin importar,
  espera en la plataforma de su terminal con «Esperando posición · sin
  importar»; importado, rueda a su posición sin saltar, también cuando después
  llega su salida o «Terminar demo»; cancelado, se desvanece donde está con
  «Cancelado por el proveedor (demo)», también cuando el servidor ya dejó de
  listarlo. Si una parte no cabe a
  velocidad real se acelera, y el bloque lo dice con su escala real: con 8
  minutos, «Demo acelerada ×1,01» en B36 y «Demo acelerada ×1,02» en B37,
  comprimidas menos del 2 %; con 10, los minutos de
  la guía de presentación, todas las posiciones van a velocidad real.
- **La ruta del vuelo elegido.** Tiene un solo constructor,
  [`flightRoute.js`](../../frontend/private-web/src/features/maps/kinematics/flightRoute.js),
  con [`routeFeatures.js`](../../frontend/private-web/src/features/maps/traffic/routeFeatures.js)
  como adaptador: lo volado observado, en línea sólida; el «Trayecto
  estimado», tenue, desde el aeropuerto de origen; y la «Ruta prevista», a
  trazos: la aproximación, la pista, la salida y el rodaje hasta su posición
  (o hasta la espera de plataforma, «Posición por asignar»), o, en una salida,
  el rodaje, la pista, el ascenso y el círculo máximo hasta su destino. El
  corte entre lo volado y lo que falta sigue al avión.
- **Seguir.** `follow=1`, la tecla `S`, el botón «Seguir» del mapa
  ([`MapFollowButton.jsx`](../../frontend/private-web/src/features/maps/ui/MapFollowButton.jsx))
  y el del bloque de datos son un solo interruptor: la cámara encuadra el avión
  con su próximo objetivo (el aeropuerto, el umbral o la posición) dentro del
  espacio que dejan los paneles. Arrastrar el mapa deja de seguir y lo dice:
  «Dejaste de seguir a ZZ9001. Pulsa Seguir para volver.». Sigue después de
  importar el vuelo.
- **Pausar movimiento.** El botón del mapa
  ([`MapMotionControl.jsx`](../../frontend/private-web/src/features/maps/ui/MapMotionControl.jsx))
  deja los aviones donde están mientras las lecturas siguen, y dice
  «Movimiento en pausa · datos de las 11:00». No tiene tecla.
- **Posiciones alimentadas por los vuelos.** Dentro del marco del OCC, Mapa de
  posiciones y la vista «Mapa» de Planificación leen la situación del mapa
  ([`MapSituationGate.jsx`](../../frontend/private-web/src/features/maps/MapSituationGate.jsx)),
  y sus posiciones leen los vuelos y dónde está cada avión
  ([`standInputs.js`](../../frontend/private-web/src/features/maps/traffic/standInputs.js)).
  Una posición dice «Llegando» hasta que su avión está en ella, y queda libre al
  registrarse el `PUSHBACK`. Cada posición dibuja su avión a escala
  ([`footprint.js`](../../frontend/private-web/src/features/maps/aircraft/footprint.js)):
  sólido en la posición y a trazos mientras llega, así se ve si cabe. De cerca
  muestra la barra de los hitos registrados, de 25, sin color de retraso. Si un
  avión está quieto en ella sin la llegada registrada, aparece el aviso sin
  color «El avión ya está en la posición. Registra la llegada.»; en Mapa de
  posiciones va en el cajón, junto al formulario «Registrar llegada» de
  siempre. Las dos pantallas dibujan el tráfico en vivo, estimado y demo con su
  bloque de datos, «Seguir» y la pausa, y comparten la selección de la URL
  (`stand=`, `flightId=` y `hex=`). Sus posiciones van con el reloj del mapa
  (el del servidor, pausado con el movimiento): una posición demo pasa a
  «Ocupada» o queda libre en el mismo segundo en que su avión se para o
  arranca. Un avión parado en su posición lo dibuja ella, pero si es estimado
  o demo conserva su anillo «est.» o su placa «Demo». Fuera del marco no leen
  nada nuevo.
- **Laboratorio y suite visual.** Diez escenas nuevas: el vuelo demo en final,
  rodando, esperando posición, cancelado y disparado con 2 minutos; un vuelo en
  vivo, otro sin señal y otro estimado; la ruta de una llegada y la de una
  salida; y seguir en final y en rodaje. La suite visual suma el
  [movimiento](../../frontend/private-web/tests/visual/lab/map-lab.motion.spec.mjs),
  la [ruta y el modo seguir](../../frontend/private-web/tests/visual/lab/map-lab.route-follow.spec.mjs)
  y [Planificación en su vista «Mapa»](../../frontend/private-web/tests/visual/occ/planning-map.spec.mjs),
  a 1440×900 y a 1920×1080. Las pruebas están en
  [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#cinemática-y-vuelo-demo-en-los-mapas-del-occ-pr-m6).

Límites: fuera del marco del OCC, los estados de las posiciones siguen
cambiando con el minuto del navegador, y las cuentas regresivas de los rótulos
también dentro de él; un vuelo demo importado tarde puede
llegar a su posición después de que esta diga «Ocupada»; elegir una posición
no resalta su avión en el mapa; y el presupuesto de cuadros del plan (60 por
segundo, con 4 ms de código propio) no se midió. La consola de U3 dibuja el
tráfico con el movimiento de M6 (ver «Consola en movimiento y mapa con más color»). Los aviones 3D y sus sombras llegaron con M7, y el
viento del METAR y las capas de referencia, con M8. Con el tráfico encendido
(como en Development), abrir Mapa de posiciones o la vista «Mapa» de
Planificación en el OCC también hace que la API lea la red de tráfico mientras
la pestaña se ve y hasta 15 minutos después. Las capturas se revisaron en
local, en el laboratorio y con la API simulada; nada de esto acredita un
despliegue ni una revisión visual en el VPS.

### Consola en movimiento y mapa con más color (PR M6, 15 de noviembre de 2026)

- La consola mueve el vuelo demo como Mapa de posiciones: se acerca, aterriza,
  rueda y estaciona entre lecturas. «Ver y seguir» lo sigue, y el dock suma
  «Pausar movimiento». No se añade ninguna lectura.
- Los colores nuevos de los mapas están en
  [`mapColors.js`](../../frontend/private-web/src/features/maps/style/mapColors.js),
  con una paleta oscura, la que se usa hoy, y una clara. El tráfico toma el
  color de su altitud, de naranja a 0 ft hasta violeta a 40 000 ft; en tierra
  es gris claro y el avión elegido sigue cian. La escala «ALTITUD (ft)» se
  puede plegar y va a la izquierda, por encima del dock.
- Al pasar el puntero sobre un avión se ve su tarjeta: callsign, dirección
  ADS-B, matrícula, tipo, aerolínea, ruta, altitud, velocidad y fuente.
- El mapa base oscuro tiene más color: mar azul marino, tierra gris azulada,
  fronteras y nombres visibles, y pistas y calles de rodaje con más contraste.
- Los 32 aeropuertos de la región se ven en Región y Aproximación, con su
  código OACI/IATA en amarillo y el color de su tipo. Están en el menú de
  capas, grupo «Referencias», y en la leyenda.
- Cada estado de posición tiene su propio relleno de color. Se siguen
  distinguiendo sin color por el trazo, el guion y las marcas.
- El cajón de la posición y el inspector de la consola muestran la terminal, el
  puente o si es remota, el avión máximo y la escala actual: vuelo, aerolínea,
  avión, origen y destino, horas, cuenta regresiva, agente, operación e hitos.
  También muestran la siguiente escala. Todo sale de lo ya leído; la API no
  cambia.

Con el tema claro (ver «Tema claro y oscuro del OCC»), estos colores también
tienen su versión clara: altitud un paso más oscura con halo oscuro, códigos de
aeropuerto en ámbar oscuro y rellenos de posición del tema. El crédito
«Datos de aeronaves» aparece una sola vez, en la línea de abajo a la izquierda;
la atribución del mapa guarda solo los créditos del mapa base.

Límites: aún no se muestra el turno del agente, y la tarjeta del avión no se
actualiza mientras él se mueve. Los detalles están en el
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md).

## Aviones 3D en Rampa y Aeródromo (PR M7)

Desde el PR M7 los mapas del OCC dibujan los aviones en 3D en Aeródromo y
Rampa, en el mismo lienzo y el mismo contexto WebGL. Las decisiones y las
diferencias con el diseño están en la nota del 16 de noviembre de 2026 del
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md).

- **2D o 3D.** El 3D (inclinación 55 y rumbo −17 en Rampa, 40 en Aeródromo)
  está encendido por defecto donde el navegador tiene WebGL2, y el navegador
  recuerda la elección. La cambian la tecla `D` y el botón «3D» junto
  al selector de vistas
  ([`Map3dToggle.jsx`](../../frontend/private-web/src/features/maps/ui/Map3dToggle.jsx)).
  Mapa de posiciones conserva su propio botón 2D/3D y Planificación queda en
  2D.
- **Los modelos.** Salen de la misma
  [tabla de dimensiones](../../frontend/private-web/src/features/maps/aircraft/types.js)
  que las siluetas 2D: 34 tipos y una planta genérica por categoría, armados en
  el navegador, sin archivos de modelo. three 0.187.0 viaja en su propio trozo
  asíncrono, que se carga la primera vez que la vista llega al umbral de las
  posiciones; el build falla si una carga inicial lleva su renderizador o si
  falta el trozo
  ([`verify-map-chunks.mjs`](../../frontend/private-web/scripts/verify-map-chunks.mjs)).
  Las medidas marcadas «unconfirmed» siguen sin cotejarse con los documentos
  de los fabricantes.
- **Qué se ve.** Los aviones de AVIAM y el otro tráfico en el aire a 6 NM o
  menos, con su sombra y, en el aire, una línea al suelo; los aviones de las
  posiciones ocupadas, a la escala de la posición. El elegido va en cian; lo
  normal, sin tono. La luz es la del sol a la hora del mapa, de día o de
  noche. Los aviones en movimiento nunca miden menos de 30 px. El otro tráfico
  en tierra sigue en 2D, y la etiqueta, el anillo «est.» y la placa «Demo»
  siguen sobre el modelo.
- **Un solo reloj.** El 3D se alimenta de las mismas escrituras del tráfico
  que el 2D, en el bucle de cuadros de M6: no añade ninguna lectura
  ([`aircraft3d.js`](../../frontend/private-web/src/features/maps/core/aircraft3d.js)).
  Un clic elige primero lo que hay en 3D bajo el puntero.
- **Fluidez y fallos.** Si los cuadros se vuelven lentos, el regulador quita
  sombras y líneas, baja la densidad de píxeles y, al final, pausa el 3D con
  «Pausamos la vista 3D para que el mapa siga fluido.» y «Volver a 3D»;
  mientras se sigue un vuelo nunca lo pausa. Si el 3D no puede dibujarse, los
  aviones vuelven al 2D con su aviso. Tras una pérdida del contexto WebGL los
  modelos vuelven solos.
- **Laboratorio.** Cuatro escenas 3D (`ramp-3d-parked`, `ramp-3d-selected`,
  `airfield-3d-final` y `ramp-3d-night`) y su especificación visual,
  `map-lab.aircraft3d.spec.mjs`.

Límites: no se midió el presupuesto de cuadros en una GPU integrada; las
capturas se revisaron en local, con WebGL por software y datos sintéticos.
Nada de esto acredita un despliegue ni una revisión visual en el VPS.

## AeroDataBox en la consola, Contratos y Superadministración (15 de noviembre de 2026)

*Posterior al commit verificado.* Los datos llegan siempre por la API (`occ/aviation/*` y
`contracts/airline-fleet`), nunca desde el navegador, a través de
`services/aviationReferenceService.js`. Las pantallas lo reciben por `AviationReferenceProvider`: sin proveedor no
se muestra ni se pide nada. Ese servicio guarda en la pestaña cada respuesta 15 minutos (demoras) o una hora (las
demás), y cada pantalla pide su dato solo cuando lo muestra.

- **Consola.**
  - La pastilla «Demoras PUJ: llegadas +12 min · salidas +8 min» va junto al clima, con su detalle. Hoy está oculta,
    igual que la fila de demoras del inspector: el plan Starter no incluye las demoras y la API responde `Disabled`.
  - La capa «Rutas desde Punta Cana» está en Región, con su clave en el menú de capas y la leyenda, en los dos temas.
  - Al elegir un vuelo, el inspector muestra los datos de la aeronave por matrícula y las demoras del aeropuerto
    contrario.
- **Mapa de posiciones.** Al elegir una posición, el cajón muestra la aeronave estacionada o que llega.
- **Diálogo de importación.** Muestra la aeronave a pedido, con «Ver la aeronave …».
- **Contratos.** La bandeja muestra «Flota según AeroDataBox: 87 aviones · A320, B738…» o el aviso «Sin flota
  registrada»; es un aviso y no cambia la aprobación.
- **Superadministración.** El catálogo de aerolíneas consulta la flota con un botón, para no gastar unidades por
  listar.
- **Estados.** Un tope alcanzado se dice en palabras («Límite diario alcanzado»), nunca como error.
- **Vuelos demo.** Nunca se consultan.

Ver la nota del 15 de noviembre de 2026 en el
[ADR-0028](../../docs/adr/0028-aerodatabox-flight-feed-with-unit-budget.md) y en el
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md).

## Referencias y meteorología en el mapa (PR M8)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR M8 (mapas) «Capas aeronáuticas y clima en el mapa» (`1c0f2482`, `32ecc0e5` y
`d5e35d68`), que esa verificación no cubre. Es la segunda parte del PR M8; la
primera, el PR M8 (API), trajo la lectura `GET occ/weather` (ver
[Integraciones externas](../04-arquitectura/integraciones-externas.md#clima-del-aeródromo-aviationweathergov)).
Las decisiones y las diferencias con el diseño están en la actualización del 14
de noviembre de 2026 sobre M8 (mapas) de
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md). La API no cambia.
Integrado sobre Development (nota del 16 de noviembre de 2026 del mismo ADR):
los aeropuertos de la región son una sola capa, la de M6 (puntos por tipo y
código «MDSD/SDQ»), con el realce de M8 para el origen o destino de un vuelo de
hoy y el crédito de OurAirports; «Referencias» reúne los aeropuertos, las rutas
desde Punta Cana y las referencias de M8, y todo se ve en el tema oscuro y en el
claro.

- **El clima, por la API.**
  [`weatherService.js`](../../frontend/private-web/src/services/weatherService.js)
  lee el clima del aeródromo con `getOccAerodromeWeather` del cliente
  compartido, que valida la respuesta, y explica sus errores por su código, sin
  mostrar el título del servidor.
  [`useMdpcWeather.js`](../../frontend/private-web/src/features/weather/useMdpcWeather.js)
  conserva su forma y su propio sondeo de 10 minutos con la pestaña a la vista,
  nunca con `occ_planning`, y suma el estado del servicio (`Live`, `Stale`,
  `Unavailable` o `Disabled`, un dato y no un error), el TAF, la hora en que el
  servicio respondió por última vez y el crédito. Lee solo con un permiso de
  mapa; tras un 401 o un 403 deja de leer, sondeo incluido, hasta que cambia
  el acceso del departamento o alguien vuelve a pedirlo, y entonces decide de
  nuevo el servidor. Un METAR está sin actualizar si la API lo marca `Stale` o
  si pasa de 90 minutos, el límite de la API para uno en vivo: la misma regla
  que sigue el viento del mapa. La barra de estado recibe la fuente «Clima
  MDPC» con la marca «No oficial». Lo leen Monitoreo de vuelos (dentro del
  marco del OCC), Mapa de posiciones, Planificación y el panel de meteorología
  de la consola actual. El navegador ya no pide el METAR actual a Iowa
  Environmental Mesonet: solo el historial de 6 horas de ese panel lo sigue
  leyendo, hasta que U3 lo retire.
- **El TAF.**
  [`taf.js`](../../frontend/private-web/src/features/weather/taf.js) une el
  texto en bruto y los periodos de la API, dice qué periodo rige y cuál viene, y
  escribe cada periodo en una línea, con la hora de Punta Cana. Ninguna
  pantalla lo muestra todavía; *planificado (U3):* lo usará la pastilla del
  clima de la consola.
- **Referencias.** Los mapas del OCC suman, en silencio y sin color
  ([datos](../../frontend/private-web/src/features/maps/traffic/referenceFeatures.js)
  y [capas](../../frontend/private-web/src/features/maps/style/referenceLayers.js)):
  - los anillos de distancia, de 50 a 250 NM en Región y de 5 a 40 NM en
    Aproximación, rotulados «20 NM»;
  - los ejes de pista extendidos, de 10 NM con una marca por milla, con la
    pista en uso más marcada y rotulada por su origen: «Pista 08 (según las
    llegadas)», «Pista 08 (estimada por el viento)» o «Pista 08 (habitual)».
    La deciden las llegadas en vivo recientes, después el viento de un METAR en
    vivo y, si no, es la 08; sin tráfico en el mapa, como en Mapa de posiciones
    y Planificación, la deciden el viento o la 08. Una llegada cuenta solo en
    final: a 1 NM o menos del eje prolongado de una cabecera, a 12 NM o menos
    del umbral, a 1000 m o menos y volando su rumbo. Un avión en el tramo de
    viento en cola o en un tramo base no cuenta. Su voto dura 10 minutos del
    reloj del servidor, así que la pista sigue «según las llegadas» después del
    aterrizaje y entre dos llegadas;
  - los aeropuertos de la región, con sus códigos OACI e IATA, y el origen o el
    destino de los vuelos de hoy resaltados por su forma;
  - las radioayudas PNA (VOR-DME 112,7) y PCA (NDB 425), en Aproximación;
  - el crédito «OurAirports», mientras se dibuja alguno de los ejes, los
    aeropuertos o las radioayudas, que salen de sus datos: en Región y en
    Aproximación con sus valores por omisión.
- **Día y noche.** En Región y Aproximación, la noche, pasado el crepúsculo
  civil, oscurece un poco el mapa, con la línea de su borde y la palabra
  «Noche»
  ([sombra](../../frontend/private-web/src/features/maps/traffic/nightShade.js),
  sobre el módulo solar de los aviones 3D). Cambia con el minuto del reloj del
  servidor, sin peticiones.
- **La FIR no está.** El límite aproximado de la FIR Santo Domingo no se dibuja
  ni está en el menú: el archivo del proyecto VATSpy del que se iba a extraer ya
  no estaba publicado, y un límite nunca se inventa
  ([README de los datos](../../frontend/private-web/src/features/maps/airport/data/README.md)).
- **Satélite.** Las nubes infrarrojas de GOES-East y la lluvia estimada de
  IMERG, de NASA GIBS, pasan al mismo lienzo: solo en Región y Aproximación,
  apagadas por omisión y visibles solo con sus teselas fijadas a la hora de su
  imagen
  ([capas](../../frontend/private-web/src/features/maps/traffic/weatherLayers.js)
  y [hora de las imágenes](../../frontend/private-web/src/features/maps/useSatelliteImagery.js)).
  Mientras se piden, la barra de estado recibe la fuente «Satélite», y mientras
  se dibujan, la atribución suma «NASA GIBS». Se dibujan en grises, sin los
  colores de las escalas de GIBS: lo normal no lleva tono, y el ámbar y el rojo
  significan «Atención» y «Urgente».
- **Viento en pista.** Junto al aeródromo, una flecha y «100° 13 kt R08»: la
  dirección, la velocidad, la ráfaga y la pista en uso. Un METAR sin actualizar
  se atenúa y dice «Sin actualizar desde las 08:00», y sin METAR no se dibuja.
  Su ficha, que un clic fija, dice «No oficial», la hora del METAR y el viento
  de frente o de cola y el de costado de cada cabecera. Mientras el viento está
  en pantalla, la atribución del mapa, plegada por omisión, suma «Clima: NOAA
  Aviation Weather Center», con su enlace.
- **Menú de capas y leyenda.** En Monitoreo de vuelos, el
  [menú](../../frontend/private-web/src/features/maps/core/layersMenu.js) suma
  los grupos «Referencias» (Anillos de distancia, Ejes de pista, Aeropuertos de
  la región, Radioayudas y Día y noche) y «Meteorología» (Nubes por satélite y
  Lluvia estimada, apagadas por omisión, y Viento en pista), cada clave con las
  vistas que la encienden por omisión. Una clave encendida que no muestra nada
  dice por qué: «Se ve en Región y Aproximación» o «No hay clima del aeródromo
  en este momento.». Mapa de posiciones y Planificación no tienen menú de capas:
  muestran lo que trae cada vista. La leyenda suma cada referencia, el viento
  con «No oficial» (y también «Sin actualizar» si su METAR está atrasado) y
  cada imagen con su hora, solo mientras están en pantalla.
- **Laboratorio.** Tres escenas de referencias y cuatro de clima, con clima
  sintético y la hora simulada de las imágenes
  ([escenas](../../frontend/private-web/src/features/maps/lab/scenes.js)). Las
  pruebas están en
  [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#referencias-y-meteorología-en-los-mapas-del-occ-pr-m8).

Lo que no cambia: la API, el OpenAPI, el cliente compartido y la CSP, que
sigue permitiendo NASA GIBS e Iowa Mesonet; el origen de Iowa Mesonet sale en
un cambio aparte cuando nada lo lea.

Límites: la plataforma de la consola actual no recibe el clima, y su panel de
meteorología todavía dice que su METAR viene de IEM, aunque ya llega de la API.
Ese panel tampoco muestra los estados vacío y sin permiso del hook: con el
clima `Unavailable` o `Disabled` (como en Production y en el arnés E2E), o sin
permiso, deja la franja del METAR en blanco, sin mensaje ni «Reintentar», donde
antes mostraba el METAR de IEM, y su aviso de METAR desactualizado mira solo la
edad, no el estado `Stale` de la API. El carril de mapas no edita ese panel,
así que es una dependencia con U3;
*planificado (U3):* la consola nueva lo reemplaza, con la pastilla del clima y
el TAF. La pista según las llegadas vuelve al viento o a la 08 cuando pasan 10
minutos sin una llegada en final. No hay SIGMET ni NOTAM.
Desde este PR, con el clima encendido (como en Development), abrir esas
pantallas hace que la API lea aviationweather.gov, como mucho dos veces cada 5
minutos por aeropuerto. Las capturas se revisaron en local, en el laboratorio;
nada de esto acredita un despliegue ni una revisión visual en el VPS.

## Pantallas de mapa del OCC (PR U5)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR U5 «Pantallas de mapa del OCC» (`10e0fb82`, `5d0e24ad` y `87fd5186`), que esa
verificación no cubre. Las plantillas, lo que se borró y las diferencias con el
diseño están en la nota del 16 de noviembre de 2026 sobre U5 de
[ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md). U5 cambia cómo se ven
y se recorren Monitoreo de vuelos, Mapa de posiciones y Planificación; no cambia
la API, ni lo que leen, ni sus comandos. Las tres pintan solo con tokens, así
que siguen el tema claro u oscuro del OCC. Los mapas siguen siendo los del
carril de mapas, con las mismas props.

- **Monitoreo de vuelos**
  ([vista](../../frontend/private-web/src/features/flight-monitoring/FlightMonitoringPage.jsx)).
  A la izquierda, «Tablero de vuelos»: una tira por vuelo, con «Llegadas»,
  «Salidas» y «Todos» con su cuenta y la búsqueda. Al elegir un vuelo, en el
  tablero o en el mapa, su inspector muestra sus horas, posición, avión,
  matrícula, agentes y servicios, con enlaces a Planificación y a Mapa de
  posiciones, y la tira de hitos de su operación, que sale de los vuelos que el
  mapa ya lee. Va bajo el tablero; desde 2200 px, a la derecha del mapa. Sin
  tarjeta de conexión: un fallo de lectura deja los vuelos bajo un aviso de
  datos sin actualizar. El bloque de datos del avión lo muestra el mapa.
- **Mapa de posiciones**
  ([vista](../../frontend/private-web/src/features/positions-map/PositionsMapPage.jsx)).
  «Lista de posiciones» abre una
  [tabla densa](../../frontend/private-web/src/features/positions-map/components/PositionsTable.jsx)
  a la izquierda: posición, terminal, estado con su forma y su palabra, vuelo y
  quién la cubre. La posición elegida se abre en un inspector a la derecha del
  mapa, sin tapar el mapa, con su estado, sus características, la escala con su
  tira de hitos y los comandos «Registrar llegada», «Asignar posición»,
  «Liberar posición» y «Ubicar en el mapa»; «Cerrar detalle» o Esc lo cierran.
  Bajo el mapa, la
  [banda de posiciones](../../frontend/private-web/src/features/positions-map/components/PositionsBand.jsx)
  cuenta las posiciones por estado y, abierta, dibuja sus escalas en el tiempo
  con la línea «ahora». Por debajo de 1536 px la lista se pliega mientras el
  inspector está abierto. Un enlace con `stand=` centra esa posición en el
  mapa. Los textos de los comandos tienen inglés.
- **Planificación**
  ([vista](../../frontend/private-web/src/features/planning/PlanningPage.jsx)).
  La barra lleva «Nuevo vuelo», «Importar vuelos» y «Actualizar»; debajo, los
  filtros y las cuatro cifras del día. Las vistas «Línea de tiempo»,
  «Posiciones», «Tabla» y «Mapa» son reales: «Posiciones» es la banda del día y
  «Tabla» una tabla ordenable de las escalas; ya no hay marcadores de vistas
  futuras. Las dos salen de la misma lectura de la planificación. El detalle de
  la escala y los diálogos no cambian.
- **Consola.** «Posiciones» de la consola ya no falla al abrir su banda cuando
  una posición tiene un avión sin llegada registrada.
- **Barra del mapa.** En un mapa estrecho, como el de Monitoreo en un portátil
  de 1440 px, la barra de vistas y herramientas quita las teclas y acorta
  «Aproximación» y «Aeródromo» para caber en una fila
  ([estilos del mapa](../../frontend/private-web/src/styles/occ-map.css)).

Las capturas se revisaron en local con la API simulada de la suite visual, en
oscuro y en claro; nada de esto acredita un despliegue ni una revisión visual en
el VPS.

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
- *posterior al commit verificado (PR M3):* las pruebas del plano de MDPC, que corren con `npm test`: el plano versionado tiene que ser idéntico a lo que genera el generador ([prueba de igualdad](../../frontend/private-web/src/features/maps/airport/mdpcLayout.generated.test.js)) y cumplir los criterios de aceptación ([criterios](../../frontend/private-web/src/features/maps/airport/airportLayout.test.js));
- *posterior al commit verificado (PR M4):* las pruebas de las posiciones en rampa, junto a cada módulo, entre ellas la que exige que cada par de estados se distinga por algo que no es el color ([capas de las posiciones](../../frontend/private-web/src/features/maps/stands/standLayers.test.js)).
- *posterior al commit verificado (PR M5):* la prueba de presupuesto del mapa, que repite un minuto demo y falla por encima de las 70 peticiones ([presupuesto](../../frontend/private-web/src/features/maps/useMapSituation.budget.test.jsx)), y el tráfico sintético que pasa los validadores estrictos del cliente compartido ([datos](../../frontend/private-web/src/features/maps/testing/trafficFixtures.js)); ver [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#tráfico-real-en-los-mapas-del-occ-pr-m5).
- *posterior al commit verificado (PR M8, mapas):* las pruebas del clima por la API, del TAF, de las referencias, de la noche y de la meteorología en el mapa, con un clima sintético que pasa el validador estricto del cliente compartido ([datos](../../frontend/private-web/src/features/maps/testing/weatherFixtures.js)), y dos specs visuales más; ver [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#referencias-y-meteorología-en-los-mapas-del-occ-pr-m8).
- *posterior al commit verificado (PR M6):* la prueba del contrato del vuelo demo, que con 8 minutos lleva a las 41 posiciones activas por la 08 con un rodaje ajustado de 25 kt o menos ([perfil demo](../../frontend/private-web/src/features/maps/kinematics/demoProfile.test.js)), la que exige que la cinemática no lea reloj, azar ni JSON ([pureza](../../frontend/private-web/src/features/maps/kinematics/purity.test.js)) y las del bucle por mapa ([bucle](../../frontend/private-web/src/features/maps/core/frameLoop.test.js)) y del almacén de movimiento ([almacén](../../frontend/private-web/src/features/maps/traffic/motionStore.test.js)); ver [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#cinemática-y-vuelo-demo-en-los-mapas-del-occ-pr-m6).
- *posterior al commit verificado (PR U3):* las pruebas de la consola de Panorama, junto a cada módulo de `dashboard/noc`, entre ellas la que repite con los hooks reales un minuto en reposo y uno de vuelo demo y falla por encima de 40 o de 70 peticiones ([presupuesto](../../frontend/private-web/src/features/dashboard/noc/useConsoleData.budget.test.jsx)), y las respuestas sintéticas de la consola en la suite visual, que pasan los validadores estrictos del cliente compartido ([datos](../../frontend/private-web/tests/visualConsoleFixtures.test.js)); ver [Pruebas, calidad y frontera con CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md#la-consola-del-occ-pr-u3).

La amplitud de pruebas de UI no prueba la existencia de endpoints .NET de negocio. Para un cambio que cruza HTTP también deben cambiar OpenAPI, el cliente generado y las pruebas de integración del backend.

## Tema claro y oscuro del OCC

Posterior al commit verificado de esta nota. Desde el 15 de noviembre de 2026, el
OCC vuelve a tener tema claro y sigue siendo oscuro por defecto. Revierte el
«solo oscuro» del PR U1; las decisiones están en la nota de esa fecha de
[ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md).

- **Un solo tema guardado.** El OCC lee y escribe `elevant-theme`, como los
  demás departamentos. Sin elección guardada, el OCC es oscuro y los demás
  siguen la preferencia del sistema. Solo se guarda lo que la cuenta elige. El
  script de arranque aplica el tema guardado (u oscuro) en las rutas del OCC
  antes del primer pintado.
- **Botón de tema.** Está en la barra de estado desde 1024 px y, por debajo, en
  el menú de la cuenta. Se llama «Cambiar a tema claro» o «Cambiar a tema
  oscuro».
- **Tokens.** [`occ.css`](../../frontend/private-web/src/styles/occ.css) tiene
  dos bloques: el oscuro sobre `[data-department='occ']` y el claro bajo
  `:root:not(.dark) [data-department='occ']`, cada uno con su
  `color-scheme`.
  [`occPalette.js`](../../frontend/private-web/src/features/occ-ui/occPalette.js)
  exporta `OCC_PALETTES = { dark, light }` y `occPaletteFor(theme)`. Los dos
  temas cumplen AA: texto a 4.5:1 o más sobre los paneles.
- **Mapa.** [`mapTheme.js`](../../frontend/private-web/src/features/maps/style/mapTheme.js)
  toma el mapa base claro de la paleta `light` de
  [`mapColors.js`](../../frontend/private-web/src/features/maps/style/mapColors.js)
  (tierra clara, mar azul claro), y `buildOccStyle({ theme })` pinta con el
  mapa base y la paleta del tema; el tráfico, los aeropuertos, los rellenos de
  posición y la leyenda también toman los colores del tema. Al
  cambiar el tema,
  [`OccMap`](../../frontend/private-web/src/features/maps/core/OccMap.jsx)
  vuelve a crear el mapa sin `setStyle`, en la misma cámara y con la misma
  selección (la de la URL). Lo hace en Mapa de posiciones, Monitoreo de vuelos
  y Planificación.
- **Límite.** Un navegador que ya guardó `elevant-theme=light` (antes, los
  demás departamentos guardaban el tema resuelto al montar) abre el OCC en
  claro. Basta un clic para volver a oscuro.

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
