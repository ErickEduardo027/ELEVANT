# Guía para consumidores de la API

## URL y versión

La URL base llega desde configuración pública del cliente; no se codifican
hosts reales en fuente. La API versionada actual publica
`/api/v1/system/ping`, `POST`/`GET /api/v1/auth/session`,
`GET /api/v1/occ/planning` y
`GET /api/v1/occ/planning/options`, además de
`POST /api/v1/occ/planning/turnarounds/{turnaroundId}/assignment`. Las
operaciones nuevas se publican bajo
`/api/v1` o una versión nueva compatible. Development usa un Service Tailscale
privado; en ejemplos se emplea `<PRIVATE_API_ORIGIN>` para no versionar su
dominio.

La superficie remota incluye sesión, diagnóstico, lecturas de planificación OCC
y su primer comando de asignación. Tailscale limita quién alcanza el host; no
reemplaza la autorización aplicada por la API.

## Sesión

`POST /api/v1/auth/session` recibe email y contraseña y devuelve un Bearer corto
junto con el snapshot inicial del actor. El JWT está firmado con HS256 por un
secreto que solo entra desde el ambiente. Sus únicos datos de identidad son un
`sub` y un `jti`, ambos UUID únicos y obligatorios; roles, membresías y station
scopes no viajan como autoridad en el token.

`GET /api/v1/auth/session` exige ese Bearer y vuelve a resolver en SQL la cuenta,
roles, membresías activas y estaciones vigentes. El cliente debe reemplazar su
contexto local con esa respuesta y no inferir permisos desde el JWT. Aún no hay
refresh, logout, revocación por `jti` ni contrato de tenant completo. El corte
OCC sí aplica autorización fina en sus dos lecturas y en el comando de
asignación.

La respuesta describe el contexto efectivo observado durante esa solicitud; no
es una concesión de autorización reutilizable ni un snapshot transaccional. Cada
comando de negocio vuelve a comprobar en el servidor los permisos y scopes que
exige su propia operación.

## Planificación y asignación OCC

Las tres operaciones requieren Bearer y vuelven a resolver el actor. El acceso
se concede únicamente a una cuenta vigente con rol `ADMIN_OCC` en
`BackOffice`, membresía `InternalStaff` en una organización
`AviamOperator` activa y scope de estación. Un actor autenticado sin ese perfil
recibe `403`; una cuenta que ya no sea válida recibe `401`.

`GET /api/v1/occ/planning` acepta `stationId=<uuid>` y `date=YYYY-MM-DD` como
query parameters opcionales:

- omitir `stationId` solo es válido cuando el actor tiene exactamente una
  estación autorizada;
- una estación solicitada fuera del scope responde `404`, igual que una
  estación inexistente;
- al omitir `date`, el servidor abre el día de hoy en la zona IANA de la
  estación, nunca la última fecha con escalas;
- una fecha válida sin escalas devuelve `200` con `turnarounds: []`.

La respuesta contiene estación, fecha, escalas, vuelos de llegada/salida,
stand/terminal, operación y las asignaciones y servicios ya registrados. Es una
proyección; no modifica asignaciones por sí sola.

`GET /api/v1/occ/planning/options?turnaroundId=<uuid>` exige una escala. El
servidor deriva de ella la estación, terminal y hora de referencia: el cliente
no envía ni decide esos valores. La respuesta expone el contrato aplicable, su
catálogo predeterminado de servicios y los agentes candidatos ordenados con los
elegibles primero. Si no existe contrato aplicable, `contract` es `null` y
`services` queda vacío. Si coinciden varias versiones contractuales aplicables,
la API responde `409` para no elegir una tarifa de forma arbitraria.

La elegibilidad es explicativa, no una reserva ni una asignación. Puede devolver
estas razones estables: `agent_inactive`, `mobile_account_unavailable`,
`station_scope_missing`, `terminal_scope_missing`,
`operational_position_unavailable`, `qualification_not_current`,
`airport_id_not_current`, `ramp_driver_license_not_current`,
`shift_not_compatible`, `approved_absence`, `mentor_required` y
`assignment_conflict`. El cliente
muestra esas razones, pero no debe reconstruir ni reemplazar la política del
servidor. `assignment_conflict` significa que el agente ya lleva tres
operaciones simultáneas que lo ocupan (asignadas, en curso o devueltas para
corrección) en la ventana de la escala; las entregadas, aprobadas o canceladas
no cuentan. También falla cerrado: una operación que ocupa al agente con una
ventana horaria ausente o no positiva cuenta como simultánea, y el cliente nunca
debe interpretar un horario incompleto como disponibilidad. `approved_absence`
indica un día libre o una restricción aprobados en el día local de la operación
o en el día del turno que la cubre. `mentor_required` indica un agente con
menos de tres meses sin una cobertura con mentor a la hora de la escala.

La respuesta de opciones incluye un `ETag` fuerte y opaco de la representación
asignable completa: operación, turnaround, stand, contrato, servicios y
elegibilidad observada. No es un `rowversion` SQL ni se decodifica. Para
asignar, el cliente envía exactamente `{ "agentId": "<uuid>" }` a
`POST /api/v1/occ/planning/turnarounds/{turnaroundId}/assignment` y copia ese
valor en `If-Match`. El servidor vuelve a comprobar autoridad, scope, estado,
contrato, servicios y elegibilidad con los datos vigentes; el cliente no elige
precios, cantidades, posición ni servicios. El éxito devuelve la asignación y
un nuevo `ETag` que versiona esa respuesta; para una operación posterior se
vuelven a leer sus opciones en vez de reutilizarlo como contexto. Una
precondición ausente responde `428`, una versión obsoleta
responde `412` y los conflictos operativos vigentes responden `409`; ante esos
casos, la UI vuelve a leer las opciones en lugar de simular éxito.

La creación de escalas (`POST /api/v1/occ/planning/turnarounds` y la
importación del feed), el relevo y la liberación del agente
(`POST …/assignment/handover` y `…/assignment/release`), la ejecución de
servicios en rampa y las escrituras offline de la tablet ya existen: se
describen en
[ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md),
que remite a los ADR anteriores, y en el
[flujo de Mobile Agent](../workflows/mobile-workflow.md). Esta sección solo
cubre la asignación inicial.

## Solicitudes

- JSON solo cuando el contrato lo indique.
- El cuerpo de `POST /api/v1/auth/session` admite como máximo 4096 bytes (4 KiB);
  un cuerpo mayor devuelve `413`. Su política por defecto admite 10 intentos por
  IP remota en una ventana fija de 60 segundos y devuelve `429` al agotarla; esos
  valores son configuración del host, no una cuota que el cliente deba consumir.
- El cuerpo del comando de asignación admite como máximo 1024 bytes y solo el
  campo `agentId`; propiedades adicionales se rechazan. Para orígenes web
  permitidos, el `413` conserva los headers CORS y puede tratarse como respuesta
  HTTP normal.
- Propagar cancelación al abandonar pantalla/flujo.
- No reintentar comandos salvo contrato idempotente.
- Mobile envía sus comandos con la instalación registrada
  (`X-Elevant-Installation-Id`) y una `Idempotency-Key` estable. El servidor
  guarda el recibo ligado a la instalación (`integration.mobile_command_receipts`):
  un reintento con la misma clave y el mismo cuerpo no repite el trabajo y
  devuelve el éxito o el mismo código de rechazo, y la misma clave con otro
  cuerpo responde `idempotency_conflict`. El chat y la observación de asistencia
  se deduplican por su propia clave, sin ese recibo, y la foto del walk-around
  viaja sin clave; la cola y sus reglas están en el
  [flujo de Mobile Agent](../workflows/mobile-workflow.md).
- No registrar bodies, tokens o URLs con parámetros sensibles.
- IDs de organización/estación/agente enviados por cliente no sustituyen el scope autenticado del servidor.
- No adjuntar el Bearer a ping, health ni otros endpoints anónimos; el cliente
  compartido solo lo solicita para operaciones autenticadas.
- Consumir el punto de entrada público de `@elevant/api-client`, nunca el código
  Orval bajo `generated` directamente. El wrapper solicita un token fresco,
  agrega `If-Match` y conserva el ETag opaco sin interpretarlo.

## Respuestas

Tratar los códigos publicados por cada operación de OpenAPI. El ping declara
`200`, `429` y `500`; el `POST` de sesión declara `200`, `400`, `401`, `413`,
`415`, `429`, `500` y `503`; el `GET` declara `200`, `401`, `429` y `500`. Los
errores usan Problem Details cuando el contrato lo indica. Mensajes de UI y correlation
ID de negocio siguen siendo pautas futuras. Nunca base lógica en el texto humano
de `detail`.

Las lecturas OCC declaran `200`, `400`, `401`, `403`, `404`, `429` y `500`;
la operación de opciones declara además `409` para configuración contractual
ambigua. El comando de asignación declara `200`, `400`, `401`, `403`, `404`,
`409`, `412`, `413`, `415`, `428`, `429` y `500`. Sus respuestas incluyen
`Cache-Control: no-store` y `Pragma: no-cache`.

`/api/v1/system/ping`, `/health` y `/health/ready` permiten acceso anónimo; los
controllers y hubs mapeados quedan bajo la política fallback autenticada salvo
que declaren otra excepción explícita. Los hubs SignalR exigen Bearer pero siguen
como shells vacíos, sin mensajes ni autorización fina de negocio. Cuando se
publiquen eventos, REST recuperará la verdad tras una reconexión.

Los clientes SignalR de navegador pueden transportar el Bearer como el parámetro
`access_token`; el host solo lo acepta bajo `/hubs/operations` y
`/hubs/notifications`. Esa URL es material sensible: clientes, proxies y
telemetría no deben registrarla con su query string.

## Compatibilidad

Regenerar el cliente al cambiar OpenAPI. Las aplicaciones consumen el wrapper
público y no importan la salida `generated` de Orval directamente. Consumidores
ignoran campos desconocidos. Un requerido nuevo/cambio semántico necesita
versión o estrategia compatible, porque API, dos webs y app nativa se liberan
de forma independiente.
