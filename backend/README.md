# Backend de ELEVANT

## Alertas preliminares de programación de G.H. (rama local)

`GET /api/v1/human-resources/schedule-warnings?stationId=&from=&to=&page=&limit=`
devuelve avisos de planificación para turnos confirmados de una estación
autorizada, no decisiones legales o de nómina. Exige sesión vigente con rol
`GESTION_HUMANA`, membresía AVIAM interna y concesión activa de la estación;
400/401/403/404 distinguen entrada, autenticación, rol y estación no
disponible. La ventana máxima es de 30 fechas inclusivas y la paginación es
estable. La regla versionada usa descanso menor de 12 horas y duración
programada superior a 48 horas en siete fechas locales; los horarios
ambiguos o inexistentes por DST quedan «no evaluables». Turnos de otra
estación pueden influir sin revelar identificadores, códigos ni tiempos de
estaciones no concedidas. Se proyecta `HasRestrictedEvidence` y se omite la
medición cuando el contexto está restringido. La respuesta es de solo
lectura, sin caché; no crea tablas ni modifica la asignación OCC.

## Reportes verificables de Gestión Humana (rama local)

`GET /api/v1/human-resources/reports/{kind}` consulta vigencias, movimientos de
cuenta con auditoría de estación verificable, distribución de turnos y cobertura
de habilitaciones. Requiere rol `GESTION_HUMANA`, membresía interna AVIAM y
concesión vigente de la estación; acepta hasta 30 fechas y páginas de 1 a 100.
Vigencias admite `documentKind=Qualification|Permit` y
`validity=Current|Expired`; la vigencia se evalúa con la fecha local de la
estación y la página devuelve los filtros efectivos.
`GET .../{kind}/export?format=pdf|xlsx` vuelve a autorizar, lee un snapshot
coherente de hasta 5 000 filas, registra auditoría sin filas privadas y sirve
un archivo con cabeceras `no-store` y `nosniff`. Un conjunto mayor devuelve
422 `report_too_large` sin archivo ni auditoría; una consulta inválida (también
la que falla en el binding) es 400 `invalid_report_query` y una estación fuera
de alcance o inactiva, 404 `station_unavailable`. Un rol rechazado sigue siendo
un 403 sin `code`. El PDF y el Excel titulan, filtran y fechan en español
(`HumanResourcesReportLabels`): «Habilitación»/«Permiso», «Carnet
aeroportuario», «Alta de cuenta», fechas `dd/MM/yyyy`, la hora de cada
movimiento («Fecha y hora local») y «Generado» en la hora local de la
estación; el PDF sin filas dice «No hay filas para estos filtros.». Las páginas
JSON conservan sus códigos. Las filas de la página no son un total global ni la
fuente de la exportación. No se atribuyen eventos de cuenta históricos sin estación
verificable. Desde este cambio, los comandos de gobierno etiquetan altas,
bajas y cambios de estado de cuentas de rampa con las estaciones verificadas
en el momento del evento; los eventos anteriores no se atribuyen de forma
retroactiva ni se reconstruyen desde concesiones actuales.
Para esa atribución, las fechas de vigencia del perfil de rampa se evalúan
con la fecha UTC del evento, la misma convención usada al crearlas. Esto
evita perder la estación entre la medianoche UTC y la local.
Código local: no acredita despliegue al VPS.

## Reportes OCC (rama local)

`GET /api/v1/occ/reports` lista los seis reportes calculados en el servidor y
`GET /api/v1/occ/reports/{key}` lee una página (1 a 100 filas) de hasta 366 días
de una estación del alcance del actor (`operations.reports.read`).
`GET .../{key}/export?format=csv|xlsx|pdf` exige además
`operations.reports.export` y exporta el período completo o nada: hasta 25 000
filas en CSV y Excel y 5 000 en PDF. Un período mayor responde 422
`report_too_large`, sin archivo ni auditoría; el encabezado «Filas» es el total
real. Los fallos llevan `code`: 400 `invalid_report_query` (también la estación
que falta o la fecha ilegible), 404 `report_not_found` o `station_unavailable`;
un permiso rechazado sigue siendo un 403 sin código.
«Productividad por agente» y la columna «Agentes» atribuyen cada operación a
quien trabajó cada tramo (`OperationWorkAttribution`): un agente liberado antes
del inicio (cambio de posición, liberación) no cuenta, en un relevo cada agente
suma los minutos de su parte y la aprobación no libera a nadie, así que la
asignación abierta conserva los minutos hasta el fin. «Servicios ejecutados por
aerolínea» cuenta solo los servicios facturables (`ServiceBillability`, con la
exclusión de OCC) de las operaciones aprobadas: el mismo conjunto que «Por
facturar». Estados, severidades y tipos de incidencia salen en español
(`OperationLabels`, «Seguridad (alta)»), la unidad con el nombre de
`ref.billing_units`, las cantidades sin ceros de escala y todas las horas,
también «Generado», en la hora local de la estación (`BusinessCalendar`). Las
cifras de productividad y de servicios cambian respecto de los reportes
anteriores: ya no duplican al agente liberado ni cuentan lo planificado o no
aprobado. El JSON conserva sus claves.
Código local: no acredita despliegue al VPS.

## Revisión de asistencia (rama local)

`GET /api/v1/human-resources/attendance` lista por estación autorizada, intervalo
local de hasta 30 días y página las asignaciones con las últimas revisiones de
OCC y agente. `PUT /api/v1/human-resources/attendance/{assignmentId}/validation`
elige el origen de inicio y fin (`Occ` o `RampAgent`) y exige las dos revisiones
esperadas y `Idempotency-Key` UUID. Si las horas difieren, exige justificación.
Solo G.H. con membresía interna y alcance vigente puede validar. Una decisión
es inmutable; un aporte posterior la marca como no vigente sin borrar el
historial. El servidor responde 409 ante revisión vencida o decisión concurrente,
y repite el resultado de un PUT idéntico con la misma clave. La transacción
guarda auditoría y aviso durable `attendance_validation`; el cliente relee por
REST. Este código no acredita todavía promoción al VPS.

Backend compartido por AVIAM Private Web, Public Web y Mobile Agent. La solución .NET 10 queda deliberadamente plana para que Visual Studio muestre directamente los proyectos productivos:

```text
Elevant.Api/             host HTTP y composition root
Elevant.Application/     casos de uso y puertos
Elevant.Contracts/       contratos públicos de la API
Elevant.Domain/          entidades y reglas sin dependencias de framework
Elevant.Infrastructure/  proveedores e infraestructura no persistente
tests/                    unitarias, arquitectura e integración
Elevant.sln              solución compartida con los proyectos de DevelopmentDB
```

La persistencia está físicamente separada en `database/DevelopmentDB`: allí viven `Elevant.Persistence`, `Elevant.DatabaseTool`, las migraciones, Compose y las operaciones SQL. Sigue existiendo una sola API y una sola cadena de migraciones compartida por los clientes.

La solicitud pública, la provisión manual por Superadministrador y el borrador contractual se describen en [el flujo comercial](../docs/workflows/commercial-intake-and-governance.md). El catálogo es gobernado por Finanzas; Contratos conserva lectura compatible. La ampliación se documenta en [ADR-0018](../docs/adr/0018-finance-commercial-platform-and-fiscal-simulation.md). Los avisos internos usan el outbox y feed existente; el hub público solo invalida el catálogo. Ningún endpoint de esta rama envía correo.

Las cargas de fotos, videos y avatares usan `POST /api/v1/media` con Bearer,
multipart y permisos por propósito. SQL conserva metadatos y claves; los bytes
se guardan en un bucket S3 privado. `GET /api/v1/media/{id}` sirve únicamente
medios vinculados a un servicio o aerolínea publicada, o un avatar para
personal interno autorizado. El Compose de API exige cinco variables
`ELEVANT_MEDIA_*`; el almacén y su backup se preparan según el
[runbook de medios](../ops/dokploy/media-storage/README.md) antes de promover
esta versión. El código versionado no demuestra todavía instalación en el VPS.

Las descargas privadas de factura y recibo no fiscal conservan una respuesta
HTTP 503 genérica si no se puede verificar o publicar el PDF. La API emite el
evento de diagnóstico `FinancialDocumentUnavailable` (`1801`) con solo la
etapa estable (`Stage`) y el nombre del tipo de error interno (`Cause`). No
registra identificadores, claves de objeto, bytes, credenciales ni mensajes
del proveedor. Este evento clasifica el fallo; no demuestra que la descarga
remota funcione ni sustituye una prueba end-to-end después de promocionar.

## Validación

Desde la raíz del repositorio:

```powershell
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
dotnet ef migrations has-pending-model-changes `
  --project database/DevelopmentDB/Elevant.Persistence `
  --startup-project backend/Elevant.Api `
  --context ElevantDbContext `
  --configuration Release `
  --no-build
```

Las pruebas SQL usan `ELEVANT_TEST_SQLSERVER_MASTER`. Si no está definida, intentan LocalDB en Windows; CI usa SQL Server 2022 fijado por digest.

## Entrega remota de Development

`compose.development.api.yml` define únicamente la API compartida. Usa una
imagen GHCR inmutable, publica `127.0.0.1:18080`, se conecta a la red privada de
SQL y a una red de runtime separada, y ejecuta con usuario no-root, filesystem
read-only y límites de recursos. Sus valores sensibles se guardan en el
Environment root-only de Dokploy; no se copian al Compose ni al repositorio.

El Compose exige `ELEVANT_API_PRIVATE_WEB_ORIGIN` y
`ELEVANT_API_PUBLIC_WEB_ORIGIN` como orígenes HTTPS exactos, sin `/` final.
También conserva `http://localhost:5173` y `http://localhost:3000` para el
desarrollo local de ambas webs. `AllowedHosts` sigue describiendo únicamente el
host de la API; no debe contener los hosts de los clientes. Mobile Agent no usa
CORS porque es una aplicación nativa.

El Compose exige además `ELEVANT_API_AUTH_ISSUER`,
`ELEVANT_API_AUTH_AUDIENCE` y `ELEVANT_API_AUTH_SIGNING_KEY_BASE64`; la clave
debe ser material aleatorio de 32 a 128 bytes codificado en base64 y entrar
desde el almacén de secretos. El lifetime se
configura opcionalmente con `ELEVANT_API_AUTH_ACCESS_TOKEN_MINUTES`, admite de 1
a 60 minutos y usa 15 por defecto.

- `/health` comprueba solo que el proceso HTTP está vivo.
- `/health/ready` comprueba SQL, el catálogo exacto y el marcador inmutable de
  `ElevantDevelopmentDb`.
- `/health`, `/health/ready` y `/api/v1/system/ping` permiten acceso anónimo.
- `POST /api/v1/auth/session` valida credenciales y emite la sesión; `GET` sobre
  la misma ruta exige Bearer y vuelve a resolver en SQL el actor efectivo.
- Una credencial temporal válida recibe `409` con `code=password_change_required`,
  nunca un token. `POST /api/v1/auth/password-change` verifica la contraseña
  vigente, aplica la política de Identity, registra auditoría y exige volver a
  iniciar sesión; cambiarla invalida los JWT anteriores mediante la versión
  de seguridad comprobada en cada petición autenticada.
- `GET /api/v1/occ/planning` publica el snapshot OCC de una fecha y estación
  dentro del scope efectivo del actor. Si se omite la fecha, abre el día de hoy
  en la zona IANA de la estación (`BusinessCalendar`), nunca la última fecha
  con vuelos; la estación solo se puede omitir cuando el actor tiene
  exactamente un scope.
- `GET /api/v1/occ/planning/turnarounds/{turnaroundId}` devuelve una escala con
  su versión (repetida como `ETag` fuerte) y las acciones que su estado permite
  (`reschedule`, `cancel`, `divert`, `correctArrival`). Exige
  `operations.planning.read` u `operations.positions_map.assign`: el mapa de
  posiciones envía esa versión en cada comando. `PUT .../schedule`
  («Editar vuelo») y `POST .../status-changes` (`Cancelled` o `Diverted`, con
  motivo) exigen `operations.planning.update`, `Idempotency-Key` e `If-Match`:
  sin versión responden `428 expected_version_required` y con una vieja
  `412 version_conflict`. Solo valen antes de que la operación inicie
  (`operation_started`, `turnaround_closed`). Reprogramar revalida contrato,
  posición bloqueada y, si hay agente, su turno y el tope de tres operaciones
  simultáneas (`assigned_agent_unavailable` con `reasons`); no cambia la
  aerolínea, y un número o día nuevo que ya vuela otra escala abierta de la
  aerolínea responde `409 flight_already_planned`. Cancelar o desviar cierra la
  posición, libera a los agentes por la ruta única de liberación (aviso
  `assignment_released`) y avisa a Finanzas si el charter tenía prepago. Nada se
  borra.
- `POST /api/v1/occ/planning/charter-airlines` da de alta, con
  `Idempotency-Key` y `operations.planning.create`, la aerolínea mínima de un
  charter: organización `OCC-…`, OACI obligatorio e IATA opcional. Un código en
  uso responde `409 airline_code_in_use` con `airlineId`; la aprobación
  comercial de un perfil verificado con los mismos códigos la completa en vez de
  rechazarla.
- `GET /api/v1/occ/planning/options?turnaroundId=...` deriva estación, terminal
  y hora desde el turnaround y devuelve el catálogo contractual junto con la
  elegibilidad explicable de agentes. Su `ETag` fuerte representa toda la
  proyección asignable que OCC está observando: operación, stand, contrato,
  servicios y elegibilidad.
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/assignment` exige ese
  `ETag` en `If-Match` y acepta únicamente `agentId`. El servidor revalida actor,
  scope, estado, agente, posición, turno, permisos y contrato dentro de una
  transacción serializable; crea la asignación primaria, materializa todos los
  servicios contractuales y registra transición y auditoría de forma atómica.
- Una sola regla de ocupación (`OperationOccupancyRules`): un agente lleva hasta
  tres operaciones simultáneas asignadas, en curso o devueltas (una operación
  sin ventana válida cuenta, falla cerrada); la cuarta es `assignment_conflict`
  en la asignación, la reasignación por cambio de posición y el relevo, y
  `simultaneous_limit` en la reprogramación. Un agente con menos de tres meses sin cobertura con mentor a
  esa hora es `mentor_required`. Al aprobar, la operación deja de ocupar al
  agente y la posición por su estado (también la escala `Completed`, cancelada o
  desviada): la asignación y la posición quedan como registro y el tablero y la
  agenda del agente reciben el anuncio.
- `POST /api/v1/occ/coverage` y `POST /api/v1/occ/coverage/{coverageId}/release`
  aceptan `Idempotency-Key` opcional durante el expand: la misma clave y cuerpo
  devuelven el tablero sin repetir la cobertura, y otro cuerpo responde
  `409 idempotency_conflict`. La cobertura exige el alcance del agente en la
  terminal (`terminal_scope_missing`) y documentos vigentes hasta el día local en
  que termina. Todo Problem Details lleva `code`.
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/assignment/release`
  acepta `?expectedAssignmentId=` e `Idempotency-Key` opcionales; con clave, la
  asignación esperada es obligatoria (`400 expected_version_required`). Otra
  asignación responde `409 assignment_changed` y una operación iniciada
  `409 operation_started`. `GET .../assignment/handover-options` y
  `POST .../assignment/handover` (relevo) pasan una operación en curso o
  devuelta a otro agente elegible con `Idempotency-Key` obligatorio,
  `expectedAssignmentId` y motivo de 5 a 500 caracteres
  (`handover_not_allowed`, `assignment_changed`, `same_agent`,
  `agent_not_eligible`). La operación conserva su estado y su evidencia, y los
  dos agentes reciben `assignment_released` y `operation_assigned`. Cuando OCC
  cambia la posición, el vuelo sigue al agente que la cubre solo si es elegible;
  si nadie lo es y el agente anterior tampoco, la operación vuelve a `Planned` y
  OCC recibe `stand_change_unassigned`.
- `GET /api/v1/occ/planning/manual-options` y `POST /api/v1/occ/planning/turnarounds`
  permiten crear una escala manual con contrato vigente, ruta completa y posición
  sin solapamiento. El UUID de intención conserva la idempotencia del alta. El
  mismo vuelo de la aerolínea en el mismo día local se planifica una sola vez
  (`409 flight_already_planned`), y la importación del feed lo vincula a la escala
  existente (`linked=true`). Las escalas nuevas, manuales o importadas, reciben el
  código legible `{ESTACIÓN}-{AAAAMMDD}-{NNN}`; los códigos `MAN-` y `EXT-` ya
  emitidos se conservan.
- `POST /api/v1/occ/turnarounds/{turnaroundId}/arrival`, `.../stand` y
  `.../stand/release` (mapa de posiciones) aceptan `Idempotency-Key` e `If-Match`
  opcionales durante el expand; con clave, la versión es obligatoria. Los tres
  corren en una transacción serializable con la fila de la posición bloqueada
  (UPDLOCK, HOLDLOCK), así que dos vuelos nunca toman la misma posición, y
  responden Problem Details con `code`. La llegada acepta `arrivedAt` explícito
  (sin él, la hora del servidor), `aircraftTypeId` y `reason`: reemplazar una
  hora que el tramo ya tiene, la que registró OCC o una distinta de la que
  informó el feed, exige motivo (`reason_required`). Registrar o corregir la
  llegada solo vale antes de la primera entrega, la haya escrito OCC o el feed y
  aunque el tramo no tenga hora (`arrival_locked`), y el tramo pasa a `Manual`,
  de modo que el feed ya no lo pisa.
- `GET /api/v1/ramp/aircraft-types` entrega a la tablet los tipos de avión
  activos. `PUT /api/v1/ramp/operations/{operationId}/flight-data` acepta
  `aircraftTypeId` opcional: sin él conserva el tipo actual y el hash del recibo
  de la versión anterior. Un tipo inactivo o un cambio después de la primera
  entrega responden `409` con `aircraft_type_unavailable` o
  `aircraft_type_locked`.
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/shift` programa un turno
  local de un agente sin asignarlo automáticamente: deriva estación, terminal y
  posición, exige cobertura de la escala y aptitud vigente, y rechaza otro turno
  para ese día (`409 shift_day_taken`). `GET .../turnarounds/{turnaroundId}/agents/{agentId}/shift`
  devuelve el turno que el agente ya tiene ese día, con su `version`, para
  ajustarlo con `PATCH /api/v1/human-resources/shifts/{id}`; sin turno responde
  `404 shift_not_found`. Todos estos endpoints OCC exigen `ADMIN_OCC`, portal
  BackOffice, membresía interna AVIAM vigente y scope de estación.
- `GET /api/v1/human-resources/qualifications?page=&limit=` lista páginas de
  hasta 100 ciclos de habilitación marcados como vigentes, con agente y equipo
  reales. Exige rol interno `GESTION_HUMANA` o `SUPERADMIN` y membresía AVIAM
  vigente. Devuelve fechas documentadas, no inventa estado de cobertura; una
  habilitación marcada como ciclo actual puede estar vencida por fecha. Los
  filtros opcionales `rampProfileId` y `equipmentTypeId` se exigen juntos;
  SQL aplica el par antes de paginar para localizar el único ciclo actual
  sin recorrer una lista global. Un par incompleto devuelve 400.
- `GET /api/v1/human-resources/qualifications/equipment-types` devuelve los
  equipos activos que requieren habilitación para el mismo rol interno.
  `PUT /api/v1/human-resources/qualifications/{id}` registra el primer ciclo o
  una renovación con UUID de intención estable y `expectedCurrentId` como
  precondición. Una transacción serializable conserva el ciclo anterior,
  auditoría y pista durable `hr_qualifications`; un reintento idéntico devuelve
  el mismo ciclo y una versión anterior devuelve 409. No admite fechas de
  obtención futuras ni archivos adjuntos. La pantalla restringida ofrece
  captura y renovación de esos ciclos, consulta el par exacto antes de guardar
  y conserva el mismo UUID de intención cuando la respuesta es incierta.
  El feed vuelve a comprobar el rol y la membresía interna antes de entregar
  pistas `hr_qualifications` o `hr_shifts`, incluso si la cuenta recibió la
  pista antes de que se le revocara Gestión Humana.
- `GET /api/v1/human-resources/permits?page=&limit=` lista hasta 100 ciclos
  actuales de carnet aeroportuario o licencia de rampa, con agente, número y
  fechas persistidos. Exige la misma membresía y rol interno vigentes que la
  lectura de habilitaciones. `is_current` indica el ciclo registrado, no que
  el documento no haya vencido. Los filtros opcionales `rampProfileId` y
  `documentType` (`AirportId` o `RampDriverLicense`) deben enviarse juntos;
  SQL los aplica antes de paginar para localizar el ciclo actual exacto. Un
  filtro incompleto devuelve 400. `PUT /api/v1/human-resources/permits/{id}`
  registra el primer ciclo o una renovación con UUID de intención estable y
  `expectedCurrentId` como precondición (`null` para el primero). Conserva el
  ciclo anterior, audita y emite la pista durable `hr_permits` en una transacción
  serializable; un reintento idéntico devuelve el mismo ciclo y una versión
  anterior devuelve 409. No admite fecha de emisión futura ni archivos.
  El feed comprueba de nuevo rol y membresía interna antes de entregar esa pista.
- `GET /api/v1/human-resources/ramp-profiles` entrega perfiles y catálogos de
  estaciones y terminales activas. `POST` y `PUT` guardan perfil, terminales
  de sus estaciones y supervisor activo (sin autorreferencia ni ciclos). Omitir
  `terminalIds` o `supervisor` en una actualización conserva el valor anterior;
  enviar `[]` o `{ "id": null }` lo limpia respectivamente. La respuesta distingue
  perfil sin cuenta, cuenta activa, pendiente o deshabilitada. Gestión Humana
  puede retirar alcances de una cuenta ya vinculada, pero no conceder nuevos
  grants de estación: la aprobación y vinculación siguen siendo exclusivas de
  Superadministración. No se envía correo de invitación desde este endpoint.
- `GET /api/v1/human-resources/ramp-profiles/access-requests` y
  `POST /api/v1/human-resources/ramp-profiles/{id}/access-requests` permiten a
  Gestión Humana consultar y solicitar acceso móvil con UUID de intención. La
  API exige perfil activo, sin cuenta y con estación vigente; un reintento
  idéntico no duplica la solicitud. `GET /api/v1/governance/ramp-mobile-access-requests`
  y `POST /api/v1/governance/ramp-mobile-access-requests/{id}/reject` son de
  Superadministración. El rechazo requiere `expectedVersion`; la creación de
  `RAMP_AGENT` acepta `accessRequestId`, `accessRequestVersion`,
  `expectedRampProfileVersion` y `expectedStationCodes`. Cuando se usa una
  solicitud, una versión o alcance obsoleto devuelve 409 y cuenta, grants,
  decisión y auditoría se confirman en una transacción. Repetir exactamente la
  aprobación devuelve la misma cuenta mientras la contraseña temporal y los
  datos de cuenta no hayan cambiado; después se consulta la solicitud
  `Fulfilled` en vez de repetir el POST. Cambiar correo o contraseña en el
  reintento no los reemplaza. Una solicitud pendiente impide saltar a la creación
  genérica de cuenta de rampa. No se devuelve ni almacena la contraseña en la
  solicitud, y tampoco se envía invitación automática.
- `GET /api/v1/human-resources/shifts?from=&to=&page=&limit=` lista turnos
  registrados de rampa en una ventana de hasta 31 fechas locales inclusivas, con
  agente, estación, terminal, posición y horario. Exige Gestión Humana o
  Superadministración interna vigente y no calcula disponibilidad.
  `GET /api/v1/human-resources/shifts/options?rampProfileId=&workDate=` entrega
  únicamente las estaciones y terminales activas dentro de los scopes
  vigentes de ese agente en esa fecha, junto con `hasShift`; una selección
  ofrecida no sustituye la revalidación del comando.
  `PUT /api/v1/human-resources/shifts/{id}` registra un turno por agente y día con
  UUID de intención estable. Durante la transición al calendario OCC, solo
  `ADMIN_OCC` con membresía interna y concesión vigente de la estación puede usar este `PUT`; Gestión Humana y
  Superadministración conservan la lectura, pero no la escritura. El comando
  exige agente, estación y terminal activos y scopes
  vigentes en esa fecha, asigna la posición `RAMP-AGENT`, limita la jornada
  local a 16 horas y rechaza otra programación del mismo día. La transacción
  serializable guarda turno, auditoría y pista durable `hr_shifts`; reintentos
  idénticos del mismo actor no duplican registros. La programación OCC también
  emite `hr_shifts`. La lectura OCC ya excluye de la elegibilidad a un agente
  con un día libre o restricción `Approved` que cubra la fecha local consultada
  o el inicio de su turno nocturno; `Pending`, `Rejected`, `Cancelled` y
  `ShiftChange` no son ausencias.
  `PATCH /api/v1/human-resources/shifts/{id}` ajusta la hora de inicio y de fin
  de un turno de hoy o de un día futuro en el calendario de su estación, para
  Gestión Humana y OCC con el mismo permiso y alcance que al registrarlo. Exige
  `Idempotency-Key`, `expectedVersion` (`409 version_conflict` si cambió) y un
  motivo de 5 a 500 caracteres. El turno debe seguir cubriendo las coberturas y
  las operaciones del agente (`409 shift_uncovers_work`) y se rechaza un turno
  pasado (`shift_in_past`) o con asistencia validada (`attendance_validated`).
  Audita `hr.shift.adjusted` y emite `hr_shifts`, la agenda del agente y
  `occ_planning`.
- `GET /api/v1/human-resources/availability-requests?from=&to=&page=&limit=`
  devuelve solicitudes de disponibilidad que se solapan con una ventana de
  hasta 31 fechas locales, paginadas de forma estable. Exige Gestión Humana o
  Superadministración internas vigentes; OCC no puede leer motivos laborales.
  `PUT /api/v1/human-resources/availability-requests/{id}` registra una
  solicitud `Pending` con UUID de intención estable, perfil activo, tipo
  `DayOff`, `Restriction` o `ShiftChange`, motivo y hasta 31 fechas locales.
  Rechaza otra solicitud `Pending`/`Approved` del mismo tipo con fechas
  solapadas para el agente. `POST /{id}/resolution` decide `Approve` o
  `Reject` sobre una solicitud pendiente; aprobar una ausencia/restricción
  exige que no haya una operación todavía asignada al agente en esas fechas,
  incluida una operación del día siguiente cubierta por un turno nocturno que
  comenzó durante la ausencia.
  Ambas transiciones son serializables, auditadas, reintentables sólo con la
  misma intención/actor y emiten `hr_absences` en el outbox. El feed vuelve a
  verificar rol y membresía antes de entregar el aviso. La UI de solicitudes
  y la invalidación OCC en vivo aún no están conectadas.
- `GET /api/v1/ramp/operations` entrega al agente de rampa autenticado sus
  asignaciones activas, el contexto operativo y los servicios planificados.
  No acepta `agentId` ni `stationId`: vuelve a resolver en SQL la cuenta, el
  perfil activo y los scopes, filtra por agente y estación antes de proyectar
  y limita la respuesta a 100 operaciones ordenadas. La cola trae las
  operaciones asignadas, en curso, entregadas (pendientes o en revisión) y
  devueltas, más las aprobadas de las últimas 48 horas, con las activas
  primero. Una operación ya iniciada sigue en el alcance de su agente aunque la
  posición se desactive o el vuelo pase a una terminal fuera de su alcance.
  Exige `RAMP_AGENT`, portal `RampMobileApp` y membresía interna AVIAM; una
  cuenta sin perfil compatible falla cerrada con `403` y una cola legítimamente
  vacía responde `200`. `POST /api/v1/ramp/operations/{operationId}/start`
  responde `409 contract_not_in_force` si la aerolínea ya no tiene un contrato
  vigente en la fecha de la operación (salvo un charter); el recibo del
  dispositivo repite el mismo rechazo y lo que ya está en curso termina con
  normalidad. Cuando un contrato se suspende, termina o vence, OCC recibe
  `contract_not_in_force` por cada operación que aún no inició.
- Horas de la evidencia de la tablet (fase 3, bloque C; regla única en
  `RampEvidenceTimePolicy`). `POST .../start` acepta un cuerpo opcional
  `{ "startedAt" }` (sin cuerpo sigue siendo válido, como lo envía la APK
  desplegada) y `POST .../services/{serviceId}/transition` un `occurredAt`
  opcional: se guarda la hora del toque recortada al reloj del servidor, y el
  recibo conserva la hora de llegada. El inicio no puede ser anterior a la
  asignación ni de hace más de 24 h; una transición nunca es anterior a la
  última del servicio (`service_time_out_of_order`). Hitos, daños e
  incidencias caen entre el inicio o la llegada registrada, lo que ocurrió
  primero, y el cierre (ahora; la entrega mientras OCC revisa; la primera
  entrega en una ronda de corrección), con 2 minutos de tolerancia
  (`time_outside_operation_window`), y el bloqueo nunca es posterior al
  push-back (`milestone_out_of_order`). Sin esas horas el hash del recibo es el
  de la versión anterior. Mientras OCC revisa se aceptan los hitos, daños y
  datos del vuelo capturados antes de la entrega: se recalculan los recargos
  automáticos y la evidencia congelada, y cambia el `ETag` de la revisión. El
  reenvío de una corrección mide el tiempo en tierra hasta la primera entrega y
  retira los recargos automáticos que ya no se detectan, nunca los de OCC.
  Los `400`, `404` y `409` del inicio, los servicios, los hitos y datos del
  vuelo, los documentos y las incidencias llevan `code` (`invalid_ramp_command`,
  `not_found`, `ramp_operation_state_conflict`, `idempotency_conflict` o el de
  la regla) y el recibo del dispositivo repite el mismo código.
- `GET /api/v1/airline/portal/bootstrap` obtiene la aerolínea de la única
  membresía `AIRLINE_CLIENT` vigente del actor autenticado y proyecta solo
  estaciones cubiertas por una versión aprobada de contrato activo en la
  fecha UTC. No acepta un identificador de aerolínea o estación desde el
  navegador; exige Bearer y responde sin caché. La ausencia de estaciones
  contratadas es una lista vacía, no autorización para ver otra aerolínea.
- `GET /api/v1/ramp/operations/{operationId}/incidents` y `POST` en la misma
  ruta leen y reportan incidencias de una operación asignada. El servidor
  comprueba rol, membresía, estación, terminal, asignación y vínculo del
  dispositivo; solo admite un reporte de una operación en curso. El `POST`
  exige identificadores UUID de instalación e idempotencia y acepta únicamente
  tipo, severidad, descripción y hora. El recibo no devuelve la descripción,
  y la auditoría tampoco la guarda en metadatos.
- `POST /api/v1/ramp/operations/{operationId}/submit` entrega una operación
  ejecutada a OCC. Exige cuenta de rampa, dispositivo vinculado, asignación y
  scope vigentes, checklist `TURNAROUND-BASE` enviado y todos los servicios en
  estado terminal. En una transacción serializable cierra la ejecución,
  registra la primera revisión `PendingReview`, recibo idempotente, transición
  y auditoría sin copiar la nota del agente a los metadatos. Un reintento con
  la misma instalación, clave y payload devuelve el mismo recibo; una clave
  reutilizada con otro contenido responde `409`.
- `GET /api/v1/occ/review/queue?stationId=...` entrega las últimas revisiones
  de una estación autorizada, primero las pendientes, con límite de 100 y
  `hasMore` explícito. `GET /api/v1/occ/review/operations/{operationId}`
  devuelve el detalle canónico de la última entrega: checklist, servicios,
  incidencias y decisión registrada, el estado de la Orden de Servicio
  (`serviceOrderState`: `Signed`, `Corrected`, `Stale` o `Unsigned`), la
  reapertura que dio origen a la revisión (`reopening`) y, en el cierre, los
  servicios excluidos de la facturación (`billingExclusions`). Su `ETag` fuerte
  se repite en `reviewVersion` y representa la versión de operación y entrega
  observada.
- `POST /api/v1/occ/review/operations/{operationId}/decision` aprueba o
  devuelve una sola entrega pendiente. Exige `If-Match` con ese ETag
  (`428 expected_version_required`, `412 version_conflict`), `submissionId`
  exacto y un motivo de 8 a 2000 caracteres al devolver; acepta
  `Idempotency-Key` opcional mientras existan clientes anteriores. Revalida rol
  OCC, membresía AVIAM y estación en SQL dentro de una transacción serializable;
  cambia operación y entrega, crea una decisión, evento y auditoría atómicos.
  Aprobar exige la Orden de Servicio firmada o corregida por OCC
  (`409 service_order_unsigned` o `service_order_stale`); una revisión reabierta
  no se devuelve a rampa (`409 reopened_review_cannot_return`). Los rechazos
  llevan `code` (`review_closed`, `review_already_decided`…). `409`/`412`
  obligan a releer el detalle; un reintento de resultado incierto reutiliza la
  misma clave.
- Los ajustes de cargos de la revisión (`POST .../charges` y
  `POST .../charges/{markId}/removal`) aceptan la misma `Idempotency-Key`
  opcional, no ofrecen ni aceptan un cargo que el contrato excluye
  (`charge_excluded_by_contract`) y, con la Orden ya firmada, guardan la
  versión corregida por OCC con su motivo. `POST
  .../services/{serviceId}/billing-exclusion` excluye de la facturación, o
  vuelve a incluir, un servicio en excepción con cantidad ejecutada
  (`billing_exclusion_not_allowed` en otro caso), con `Idempotency-Key`,
  `If-Match` y motivo de 8 a 500 caracteres.
- `POST /api/v1/occ/review/operations/{operationId}/reopening` reabre, con
  `operations.review.reopen`, `Idempotency-Key`, `If-Match` y motivo, una
  aprobación de la que nada se facturó: crea la revisión siguiente
  `PendingReview` con la misma evidencia, hora y agente. No toca la escala, los
  agentes, la posición ni las incidencias. Una línea de prefactura sobre la
  operación responde `409 already_invoiced` (la corrección es una nota de
  crédito) y una Orden que ya no está firmada, `service_order_unsigned` o
  `service_order_stale`.
- `GET /api/v1/occ/operations/{operationId}/incidents` lista las incidencias
  vivas de una operación de las estaciones del actor, con quién las reportó,
  su versión e historial (`operations.incidents.read`). `POST` en la misma ruta
  reporta una incidencia de OCC con `Idempotency-Key` (`201`, o `200` al
  repetir) y `POST /api/v1/occ/incidents/{incidentId}/status` la pasa a
  revisión, la resuelve, la cierra o la reabre con nota, `Idempotency-Key` e
  `If-Match` (`operations.incidents.update`). Al aprobar, solo las incidencias
  que OCC no gestionó se resuelven con la nota fija.
- En un charter sin contrato, el total del prepago no cuenta los servicios no
  realizados y la Orden los imprime en 0. Con el prepago confirmado, la tablet
  no agrega servicios (`409 charter_prepayment_confirmed`, guardado en el
  recibo) hasta que Finanzas reabra la cotización con
  `POST /api/v1/finance/charters/{charterId}/prepayment/reopening`
  (`finance.charters.confirm`, `Idempotency-Key`, motivo y la `version` leída;
  una vieja responde `409 version_conflict` y un prepago no confirmado,
  `charter_prepayment_not_confirmed`).
- El `POST` de sesión limita el cuerpo a 4096 bytes (4 KiB) y, por defecto, a
  10 intentos por IP remota en 60 segundos; responde `413` o `429`,
  respectivamente, cuando se excede cada límite.
- `/swagger/v1/swagger.json` publica el contrato HTTP en Development.
- `GET /api/v1/commercial/affiliation-options` conserva una lectura acotada
  de estaciones activas y servicios publicados para consumidores anteriores.
  El nuevo recorrido usa `GET /api/v1/public/commercial-catalog` y
  `POST /api/v1/public/commercial-requests`; la solicitud no crea credenciales.

La lectura `GET /api/v1/airline/portal/contracts?page&limit` deriva una sola
aerolínea de la membresía vigente de la cuenta, sin aceptar un identificador
de tenant del navegador. Devuelve páginas de hasta 50 contratos con versiones
aprobadas, estaciones y tarifas. Conserva las versiones aprobadas aunque el
contrato venza, pero nunca expone borradores; el portal las consulta en modo
solo lectura. No crea ni aprueba contratos.

En esta rama posterior a #118,
`GET /api/v1/airline/portal/operations/{operationId}/approved-evidence`
revalida la membresía de aerolínea y la cobertura contractual histórica de
la estación en la fecha operativa. Una operación ajena devuelve `404`; una
propia sin aprobación devuelve `200` con `available=false`. Tras la aprobación
proyecta servicios e incidencias desde la última entrega inmutable aprobada
por OCC, pero solo expone el conteo de incidencias, sin descripciones, notas
ni identidades internas. También muestra los tiempos reales de la operación.
Es una lectura aditiva sin migración y requiere promoción API-primero antes
del cliente Public Web que la consume.

En la rama de integración de Development, la asignación OCC, el inicio y la
entrega del agente, y la decisión OCC escriben una invalidación
`airline_operations` por miembro vigente del portal de esa aerolínea en la
misma transacción del cambio. El destinatario se deriva en SQL de su rol y
membresía, no de un identificador enviado por el navegador. La pista no
contiene contenido operativo ni usa un scope de estación del cliente: el
portal vuelve a consultar el `bootstrap` tenant-scoped y la API revalida la
autorización al leer el feed. Los replays idempotentes no crean otra pista.
Esto aún no cubre servicios, facturación, documentos ni historial completo.

## Finanzas comercial y simulación fiscal (rama de integración)

El [plan aprobado](../docs/superpowers/plans/2026-10-18-finance-platform.md) amplía
[ADR-0016](../docs/adr/0016-finance-tariffs-charges-and-receivables.md) mediante
[ADR-0018](../docs/adr/0018-finance-commercial-platform-and-fiscal-simulation.md).
Este apartado describe código local; no acredita promoción al VPS ni emisión
tributaria real. Los contratos compilados/OpenAPI y las pruebas son la fuente
de detalle de las peticiones.

### Precios, prefacturas y facturas

Finanzas gobierna catálogo, tarifas, cargos y paquetes; Contratos negocia
versiones y enmiendas, Finanzas aprueba el contrato y OCC aprueba la ejecución.
El agente marca cargos sin recibir precios. Cantidad, evidencia, precio,
moneda y cálculo se congelan; falta de datos/FX o ambigüedad bloquea.

Las rutas de `finance/approved-services`, `finance/preinvoices`,
`finance/tariffs`, tarifarios y catálogo conservan las lecturas autorizadas.
Se agregan `finance/packages`, paquetes del borrador contractual y enmiendas.
El consumo se reserva con la prefactura bajo transacción serializable, por
turnaround, tramo o período; un ámbito con otra prefactura activa sin emitir
bloquea con `package_scope_has_unissued_preinvoice`. Anular libera reservas
sin borrar historia. Los mínimos generan un complemento trazable solo para
versiones modernas `PricingPolicyVersion > 0`; no se reinterpretan versiones
heredadas ni se añade el mínimo de servicio a cobertura de paquete.

En Draft, Finanzas ajusta/excluye con motivo, versión y cálculo original.
El recálculo es explícito. Una disputa impide emitir; su resolución conserva
historial. La aerolínea acepta/disputa únicamente su tenant. La emisión
desde una prefactura Accepted congela factura, líneas, jerarquía, identidad
comercial y vencimiento. No se revalora después con tarifas actuales.

`finance/tax-policies` y `finance/preinvoices/{id}/taxes` administran
tratamientos explícitos por aerolínea, estación, moneda, concepto y vigencia.
Las líneas congelan política, tasa/fundamento, neto, descuento, impuesto y
bruto. `Unconfigured` conserva impuesto desconocido, no cero. El legado
comercial sigue legible sin inferir tratamiento; una preparación fiscal sin
snapshot emitido configurado se bloquea. El modelo aún no aporta registros
tributarios revisados: `issuerTaxRegistration` y
`customerTaxRegistration` quedan explícitamente null, nunca datos inventados.

### Cartera y tesorería

Las rutas bajo `api/v1/finance` incluyen:

| Recurso | Operaciones principales |
| --- | --- |
| `receipts` | Listar, detalle y registrar recibo independiente |
| `receipts/{id}/applications` | Aplicación parcial a varias facturas, con remanente |
| `receipts/{id}/reversals`, `refunds` | Movimientos vinculados, sin borrar el recibo |
| `invoices/{id}/adjustment-notes` | Notas de crédito/débito con líneas de origen |
| `statements` | Estado de cuenta y aging a fecha de corte |

Cobro, aplicación y devolución son hechos distintos. Una nota de crédito no
devuelve efectivo. Saldo y disponibilidad se validan bajo concurrencia,
moneda/FX explícitos y versiones. Los pagos/notas legacy siguen aportando una
vez al saldo, sin copiarse como nuevos recibos. Las rutas previas de factura,
pago y estado de cuenta conservan compatibilidad; el portal usa rutas propias
con tenant derivado por el servidor. Ningún registro confirma fondos bancarios.

### Proveedores, CxP y gastos propios

- `api/v1/finance/suppliers`: alta, detalle, filtros/opciones, edición y retiro
  lógico con motivo y versión.
- `api/v1/finance/payables`: facturas de proveedor Draft → Submitted →
  Approved/Rejected, referencia normalizada única por proveedor, líneas
  congeladas al presentar y rechazo con motivo.
- `api/v1/finance/payable-payments`: pago separado de sus applications;
  varias facturas, pagos parciales, saldo y remanente, sin sobreaplicación.
- `api/v1/finance/expenses`: Employee activo vinculado a la cuenta, soporte
  privado, presentación, decisión departamental, decisión final de Finanzas y
  reimbursements separados.

Una cuenta interna AVIAM con Employee activo puede crear/presentar/leer su
propio gasto sin un código de Finanzas. La API impide seleccionar otro
empleado; sus opciones devuelven capacidades para la UI. El administrador
efectivo revisa su departamento, nunca su propio gasto. Finanzas aprueba
después y registra reembolsos con sus permisos, sin autoaprobación/pago
propio ni una misma persona en ambas revisiones. Listas y filtros no amplían
el ámbito. El componente reutilizable DepartmentExpensesPage sirve el
recorrido «Mis gastos» fuera del área de Finanzas.

Las dimensiones opcionales estación, aerolínea, turnaround y servicio se
validan entre sí y frente al scope. Los soportes usan almacenamiento privado
existente y metadatos/hash; el cliente no elige una clave de objeto o URL.
Los PDFs comerciales de factura/recibo conservan descargas autorizadas de
bytes privados, sin URL pública ni regeneración silenciosa de originales
alterados. El portal no recibe soportes de empleados ni su PII.

### Fiscal local y preflight XML

`api/v1/finance/fiscal-documents` ofrece status, lista/detalle, creación,
simulate y descargas de artefactos. Los estados comercial, de cartera y
fiscal son independientes.

- `FinanceFiscal:Mode` predetermina Off. LocalSimulation solo ejecuta en
  Development/Test. ProviderSandbox está bloqueado: no hay proveedor seleccionado.
- El ambiente se resuelve de DOTNET_ENVIRONMENT, luego
  ASPNETCORE_ENVIRONMENT, por defecto Production.
- Se persiste intención, se archivan JSON canónico/XML neutral/manifest,
  se verifican bytes y después se reclama un único intento. Archivo previo
  fallido bloquea; timeout/desconocido no permite reenvío ciego.
- `FinanceFiscal:ArchiveMode` predetermina PrivateObjectStore (S3 privado).
  LocalDirectory exige ArchiveDirectory privado/persistente y se rechaza al
  arrancar fuera de Development/Test. Permite QA fiscal sin S3; no reemplaza
  almacenamiento de soportes de gastos ni PDFs comerciales.
- El simulador no usa red fiscal, certificados, firma ni numeración oficial.
  Lleva SIMULATION WITHOUT FISCAL VALIDITY y mantiene e-NCF/respuesta DGII null.
  El autenticador de callbacks registrado rechaza todos por defecto.

`POST api/v1/finance/fiscal-xml/validate` es un preflight offline independiente
para E31/E32/E33/E34 con XSD oficiales fijados. No despacha ni almacena el XML.
XSD, presencia de firma, criptografía, reglas de negocio y aceptación son
capas separadas: criptografía y aceptación permanecen NotPerformed.
El XML neutral FiscalSimulation no es un e-CF. Fuentes y límites:
[referencia DGII](../docs/reference/dgii-ecf-schema-sources.md).

### Acceso, reportes y recuperación

JWT identifica cuenta; el servidor deriva membresía AVIAM, departamento,
estaciones y permisos. Las mutaciones usan intención/hash, expectedVersion
cuando corresponde, auditoría y pistas de cambio con revalidación de acceso.

Además de tarifas/cargos, contratos y prefacturas, el catálogo ofrece
`finance.catalog.read/manage`, `finance.packages.read/manage`,
`finance.taxes.read/manage`, `finance.receipts.read/manage/apply/reverse/refund`,
`finance.adjustments.read/issue`, `finance.suppliers.read/manage`,
`finance.payables.read/manage/approve/pay`,
`finance.expenses.read/manage/approve/pay` y
`finance.fiscal.read/manage/simulate`. La excepción de gasto propio no
concede gestión o aprobación financiera general.

Los reportes añaden tesorería, notas de débito, proveedores/CxP, gastos,
paquetes y fiscal/simulación separados; conservan filtros de servidor,
exportación CSV/XLSX/PDF con permiso y auditoría. Conciliación documental no es bancaria.
Dinero usa decimal(19,4), cantidades decimal(18,4) y USD/DOP requieren FX explícito.

El [runbook fiscal](../docs/runbooks/finance-fiscal-activation.md) detalla
archivo, recuperación de SQL **y** bytes, validación y gates pendientes de
conectividad real. La [matriz Odoo](../docs/reference/odoo-finance-adaptation.md)
documenta referencia fijada y licencias: implementación C#/React propia y
UI ELEVANT, sin copiar apariencia ni código Odoo. No hay emisión fiscal real,
cobro electrónico, libro mayor ni conciliación bancaria en esta etapa.

GitHub Actions construye y certifica la imagen una sola vez. El controlador
privado de [`ops/dokploy/api-cd`](../ops/dokploy/api-cd/README.md) solo promueve
su digest después de que el controlador de base haya aceptado una versión
compatible. El bootstrap inicial del VPS sigue siendo manual y verificable.
La autenticación actual es un slice acotado de sesión. OCC Planning y la lectura
de trabajo asignado del agente son los primeros límites de autorización fina;
los demás módulos todavía deben implementar la suya.
El host aplica una política fallback autenticada a controllers
y hubs que no declaren acceso anónimo; los dos hubs SignalR exigen Bearer, aunque
siguen sin métodos ni mensajes de negocio. El JWT es corto (15 minutos por
defecto), está firmado con HS256 mediante `Authentication__SigningKeyBase64` inyectada
desde el ambiente y solo transporta un `sub` y un `jti`, ambos UUID únicos y
obligatorios, como datos de identidad, además de los claims temporales y de
emisor/audiencia. Roles, membresías y estaciones no
se confían al token: `GET /api/v1/auth/session` los vuelve a consultar en SQL.

Los clientes SignalR de navegador pueden enviar el JWT en el parámetro
`access_token`; el middleware solo lo acepta bajo `/hubs/operations` y
`/hubs/notifications`. Development eleva el log de
`Microsoft.AspNetCore.Hosting.Diagnostics` a `Warning` para no registrar esa
query en el inicio estándar de solicitud. Proxies y observabilidad también deben
redactarla. Los hubs no deben transportar eventos reales hasta implementar
revalidación de actor, autorización por scope y cierre/renovación al expirar o
revocarse el token.

No existen aún refresh, logout ni revocación por `jti`. Fuera de los cortes OCC
y de lectura de asignaciones de rampa implementados tampoco existe todavía
autorización fina por rol, tenant o estación.
Development debe permanecer dentro
del tailnet; el secreto real de firma se guarda junto con los demás valores
root-only del ambiente y nunca en Git.

## Telemetría regional OCC (rama local)

`GET /api/v1/occ/traffic/aircraft?stationId=<uuid>` devuelve aeronaves con posición en el recuadro fijo 17–21° N y 73–67° O. Exige sesión interna AVIAM, `operations.planning.read` y alcance exacto de PUJ; otros alcances no consultan el proveedor. No acepta URL ni límites del cliente. La respuesta informa fuente, hora del proveedor, hora de consulta, estado desactualizado y solo los campos OpenSky presentes. No relaciona callsign, vuelos, aterrizajes ni stands de AVIAM.

La integración está desactivada por defecto. El operador debe aportar por configuración privada `OpenSky__Enabled=true`, `OpenSky__ClientId` y `OpenSky__ClientSecret` solo después de verificar que el acuerdo escrito cubre el uso operacional. Nunca se agregan al cliente ni a Git. El servidor obtiene un token OAuth2 y lo renueva antes del vencimiento; reintenta una vez tras 401. Comparte una consulta entre solicitudes concurrentes y no vuelve a consultar `/states/all` antes de 120 segundos por instancia, incluso tras un fallo ordinario. Respeta `X-Rate-Limit-Retry-After-Seconds` o `Retry-After` tras 429 y conserva la última lectura como desactualizada durante hasta 10 minutos. Un 403 impone cinco minutos de espera; respuestas 503 no incluyen secretos ni cuerpo del proveedor. Cada instancia consume su propio presupuesto de consultas: varias réplicas no comparten caché ni cuota. Sin credenciales o con el proveedor inaccesible la API devuelve 503. Esta rama no altera esquema ni permisos de negocio y no ha sido desplegada.

## Entorno local completo

```powershell
Copy-Item database/DevelopmentDB/.env.example database/DevelopmentDB/.env
# Sustituya todos los placeholders y mantenga .env fuera de Git.
docker compose --env-file database/DevelopmentDB/.env `
  -f database/DevelopmentDB/compose.local.yml up --build
```

El flujo local es `SQL -> provisioner -> migrator -> seeder-development -> API`. La API no ejecuta migraciones ni seeds al arrancar.

Los siguientes endpoints de negocio deben conservar el patrón de vertical slices
y publicarse mediante OpenAPI. Ningún frontend debe consumir entidades EF
directamente.

La rama de clausura comercial agrega `GET/POST /api/v1/service-closures`, decisión
por solicitud y republicación por servicio. La API exige membresía AVIAM
interna y grants separados; `IServiceClosureStore` concentra la transacción
que conserva expediente, auditoría, pistas internas y visibilidad pública. La
respuesta del hub público es una invalidación posterior al commit. El
[recorrido comercial](../docs/workflows/commercial-intake-and-governance.md#clausura-comercial-solicitada-por-occ-rama-de-implementación)
detalla el efecto sobre nuevas solicitudes, sin atribuirle un despliegue.

### Paginacion del Chat operativo

Los dos GET de `/api/v1/chat/conversations` y `/api/v1/chat/conversations/{operationId}/messages` aceptan `offset` opcional, entero no negativo y predeterminado en cero. Los limites siguen siendo 100/200 y las respuestas conservan `hasMore` y su orden. La consulta aplica permisos/estacion/asignacion antes de paginar; no hay cambios de modelo, entidades ni migraciones. Desplegar la API compatible antes que sus consumidores; esta tarea no despliega.


## Presencia operativa: implementación local

El chat conserva los hilos por operación. La presencia añade
`PUT /api/v1/chat/presence` y `GET /api/v1/chat/presence?operationIds=...`.
La identidad emisora se obtiene del JWT; la lectura filtra primero las operaciones
autorizadas y devuelve agentes asignados y autores reales de mensajes.

El PUT recibe `clientId`, `sequence` (entero seguro de JavaScript),
`mode` (`foreground`, `background`, `closed`) y `activityObserved`.
Cada cliente tiene una secuencia creciente; los paquetes anteriores y las
reaperturas de un cliente cerrado no restauran presencia.

El registro es transitorio y presupone una instancia API, sin nuevas entidades,
migraciones ni infraestructura. Heartbeat: 30 s; actividad reciente: 5 min;
expiración: 90 s; retención observable: 24 h. Varias sesiones se combinan por
cuenta. Un reinicio o la falta de información produce `unknown`, no `offline`.
Los estados describen actividad en la aplicación, no disponibilidad operativa.
Una futura publicación requiere API antes que los clientes. No se desplegó nada.
