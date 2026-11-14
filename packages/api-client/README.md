# Cliente API compartido

## Asistencia compartida OCC y agente

`getOperationAttendanceDraft(operationId, assignmentId, { installationId? })`
relee las dos contribuciones manuales de asistencia de la asignación: OCC y
agente de rampa. OCC y Gestión Humana solo leen con alcance interno y de
estación vigente; el agente asignado también debe presentar su instalación
activa. `saveOccAttendanceDraft` y `saveRampAttendanceDraft` anexan una nueva
revisión únicamente al carril del actor autenticado. Cada escritura exige
`expectedRevision` e `Idempotency-Key` UUID; la ruta móvil exige además la
instalación. Una revisión desactualizada o reutilizar la clave con otro
contenido devuelve 409: se debe releer antes de crear otra intención.

```ts
const draft = await api.getOperationAttendanceDraft(operationId, assignmentId);
const intentionId = crypto.randomUUID(); // conservar para reintentos de esta intención
const receipt = await api.saveOccAttendanceDraft(operationId, assignmentId, {
  expectedRevision: draft.occ?.revision ?? 0,
  observedStartAt: "2026-10-02T12:00:00.000Z",
  observedEndAt: null,
  incidentNote: null,
}, intentionId); // Idempotency-Key de esta intención
```

El backend persiste las dos observaciones con auditoría y pistas durables de
cambio. Esta incorporación del contrato **no** conecta todavía las pantallas
OCC, móvil o G.H., ni implementa firma, validación de G.H., nómina u horas
extra. Tampoco acredita promoción de esta rama al VPS.

El snapshot OpenAPI incluye `GetAffiliationOptions` como lectura anónima
acotada de estaciones activas y servicios publicados, sin precios. El flujo
público actual usa `GetPublicCommercialCatalog` y `SubmitCommercialRequest`
para solicitar servicios sin elegir contraseña. Contratos aprueba o rechaza y
el superadministrador crea las credenciales manualmente. La operación
`LookupCommercialRequestReceipt` permite recuperar por UUID y contenido un
comprobante ya guardado, sin crear otra solicitud cuando una respuesta se pierde.
Los endpoints de
gobernanza, catálogo administrado y borradores también están en el snapshot.
`GetManagedContractDraftOverview` ofrece a Contratos un resumen autorizado y
acotado de borradores sin comentarios ni tarifas; la lectura completa sigue
reservada para la pantalla de edición.
La rama de clausura comercial añade operaciones protegidas para listar,
solicitar, decidir y republicar servicios (`ListServiceClosures`,
`CreateServiceClosure`, `DecideServiceClosure`, `ReopenService`). Cada comando
exige versión o UUID según corresponda; los métodos Orval se generan del
snapshot local revisado. La [guía comercial](../../docs/workflows/commercial-intake-and-governance.md#clausura-comercial-solicitada-por-occ-rama-de-implementación)
precisa qué cambia para nuevas solicitudes públicas.
El cliente valida la forma y los identificadores únicos del catálogo, pero no
impone un máximo de filas ausente del contrato HTTP; la paginación del catálogo
deberá añadirse de forma coordinada si el volumen lo requiere.

`getAccountChanges({ after?, limit? })` consulta el feed recuperable por
cursor de la cuenta autenticada. El cursor es opaco: los clientes lo conservan
sin decodificarlo y vuelven a leerlo tras reconectar SignalR o al reanudar
la aplicación. `ChangedV1` solo anuncia un cambio; los datos se consultan
por REST con los permisos vigentes. El wrapper exige un cuerpo cerrado,
rechaza cursores/parámetros inválidos y no permite introducir una cuenta,
estación o tenant en la consulta. Esta capacidad se prepara en la rama de
integración y no demuestra todavía un despliegue remoto. El servidor filtra
las pistas de habilitaciones y turnos cuando la cuenta ya no conserva Gestión
Humana o Superadministración internas.

Para las pistas `attendance_draft` de un agente, Mobile Agent pasa
`getAccountChanges(parameters, { installationId })` con la instalación actual.
La API revalida el vínculo de **esa** instalación en cada página; una tablet
revocada no recibe esas pistas aunque la cuenta tenga otra tablet activa.

`getAirlineContracts({ page?, limit? })` consulta hasta 50 contratos por página
para la única aerolínea derivada en la API de la sesión. El cliente valida
estructura, paginación, versiones publicadas, estaciones y tarifas; no acepta
un ID de tenant ni habilita acciones comerciales.

`getManagedContracts({ page?, limit? })` consulta la lectura interna paginada
de acuerdos publicados, con aerolínea, estado de versión, estaciones y tarifas. La API exige el
permiso comercial correspondiente y el wrapper valida la forma recibida;
esta lectura no crea ni modifica contratos.

Desde la fase 4 (4-A, ADR-0035) la prefactura es solo el borrador interno de
la emisión: se retiraron sus wrappers de Finanzas y del portal (listar, leer,
crear, enviar, aceptar, disputar y resolver), los de servicios aprobados, la
conciliación y el pago no fiscal manual. «Por facturar» usa
`getFinancePendingOperations`, `issueInvoiceFromOperations` y
`closeOperationsWithoutCharge`. `getFinanceHome(stationId)` lee los indicadores
de «Inicio» de una estación al día hábil de Santo Domingo; su validador es
estricto y acepta `null` en cada sección que la plantilla de la cuenta no
incluye. Es una lectura solo web.

`getAirlineCardPaymentAvailability()` (4-N05) dice al portal si el entorno
acepta pagos con tarjeta y si la pasarela es la simulada; su validador solo
acepta `available` y `simulated`, y una simulación siempre está disponible.
Sin pasarela, `payAirlineInvoiceByCard` recibe 409
`card_payments_unavailable`. `confirmFinanceCharterPrepayment(charterId,
{ amount, reference, version, reason? }, idempotencyKey)` (4-N22) confirma
el prepago con la versión vista y la clave del intento; otro monto o
referencia lo corrige con un motivo de 5 a 500 caracteres mientras no se haya
aplicado.

Vuelos demo (ADR-0041, solo el superadministrador):
`getDemoFlightOptions(query?)` y `listDemoFlights(stationId?)` leen el
formulario y los vuelos de las últimas 24 horas con `enabled` y la hora del
servidor; donde `DemoFlights:Mode` está apagado responden `enabled: false`.
La consulta de las opciones es el id de una estación o la visita del
formulario (`{ stationId?, aircraftTypeId?, minutesToOnBlock?, groundMinutes? }`,
validada antes de enviar; lo que falta toma 8 y 60 minutos): cada posición
llega evaluada para esa visita (`located`, `free`, `coveredBy`,
`eligibleAgents`, `eligible` y `reasons`) y `layout` trae la estación frente
al catálogo de Punta Cana. `createDemoFlight(input, idempotencyKey)` valida
antes de enviar (de 2 a 30 minutos hasta la posición, de 20 a 240 en tierra,
`standChoice` `None`, `Specific` con su posición o `Random` sin ella, sin
claves desconocidas) y acepta 201 o 200 en la repetición.
`cancelDemoFlight(demoFlightId, "Cancel" | "Finish", idempotencyKey)` no
envía versión: el servidor contrasta la intención con la fase.
`prepareDemoStation(stationId, idempotencyKey)` («Cargar posiciones de Punta
Cana») crea lo que le falta a la estación y responde 200 con su estado, también
en la repetición; su validador exige el estado de la estación pedida. Los
códigos nuevos son `demo_flights_unavailable`, `invalid_demo_flight`,
`demo_origin_unknown`, `demo_flight_limit_reached`, `demo_flight_closed`,
`demo_station_unsupported`, `no_eligible_stand` y `stand_not_eligible`; los
dos últimos traen en `reasons` por qué la posición no es elegible. La
propuesta del feed, la escala de planificación y la del mapa de posiciones
traen `isDemo` solo cuando es `true`; sus validadores aceptan la clave ausente
o `true`. La app móvil no lee estas respuestas.

Mapa del OCC (ADR-0042, personal interno de AVIAM con la estación en su
alcance y permiso de dashboard, monitoreo de vuelos, mapa de posiciones o
planificación): `getOccAirPicture({ stationId, trails? })` lee de memoria los
aviones en vivo de la estación con tráfico (`AirTraffic:StationCode`, Punta
Cana). Su estado llega siempre en un 200 (`Live`, `Stale`, `Warming`,
`Unavailable` o `Disabled`, con `reason` cuando no está en vivo), junto con
`refreshAfterSeconds` (2 mientras calienta; si no, de 10 a 60: la pantalla
nunca pregunta antes) y el crédito de la red en `source`, que todo mapa
muestra. `trails` es `short` (por omisión, hasta ocho puntos de estela) o
`none`; cada avión trae `matchedFlightKey` y `matchedBy` cuando es un vuelo de
ELEVANT. `getOccAircraftTrack({ stationId, hex })` lee la estela en memoria de
un avión (seis dígitos hexadecimales; como mucho 600 puntos).
`getOccMapFlights({ stationId, hoursBack?, hoursAhead? })` lee los vuelos de
ELEVANT del mapa (de 0 a 24 horas atrás, 2 por omisión; de 1 a 36 adelante, 12
por omisión): una fila por pierna con `flightKey` y `visitKey` que no cambian al
importar, `phase`, `actualKind`, posición, hitos registrados (como mucho
`FLIGHT_REPORT_MILESTONES.length`) y el reloj demo. Las tres consultas se
validan antes de enviarse y los validadores (`isOccAirPicture`,
`isOccAircraftTrack`, `isOccMapFlights`) son estrictos en cada nivel: una clave
falta o viene en `null` solo donde el contrato dice `null`, y las coordenadas
se comprueban como posiciones de la Tierra, sin caja. El código nuevo es
`invalid_map_query`; una estación fuera de alcance o un avión que ninguna
lectura vio responden `not_found`. La app móvil no lee estas respuestas.

`getFinanceTariffs({ stationId, page?, limit? })` lista hasta 50 tarifas de
versiones contractuales publicadas que cubren la estación con grant vigente de
Finanzas. Rechaza parámetros fuera de rango, respuestas de otra estación,
precios negativos y versiones no publicadas. Es una lectura; no cambia tarifas
ni revaloriza snapshots operativos o financieros históricos.

`getHumanResourcesQualifications({ page?, limit?, rampProfileId?, equipmentTypeId? })` lee páginas de hasta
100 ciclos actuales de habilitación registrados para agentes de rampa. Solo
una sesión interna de Gestión Humana o Superadministración puede obtenerlos;
el wrapper comprueba identificadores, fechas y paginación. Una fecha vencida
no se presenta como vigente por el mero valor `is_current` de SQL. La ruta
restringida de habilitaciones de Private Web usa este método para la tabla
paginada y, con ambos IDs, para reconsultar el único ciclo actual antes de
registrar o renovar. El wrapper rechaza un filtro incompleto, IDs inválidos
o una respuesta que no pertenezca al par solicitado.

`getHumanResourcesQualificationEquipmentTypes()` lee el catálogo activo que
requiere habilitación. `recordHumanResourcesQualification(id, request)` usa un
UUID estable elegido por el cliente y `expectedCurrentId` para el ciclo
observado (o `null` para el primero). Valida campos, fechas, respuesta y
autorización fresca. El servidor conserva historial, audita y emite una pista
durable tras confirmar; un 409 exige reconsulta antes de intentar otro cambio.
La interfaz restringida conecta esa captura; ante una respuesta incierta
reintenta el mismo UUID y ante 409 relee el ciclo antes de permitir otro envío.

`getHumanResourcesPermits({ page?, limit?, rampProfileId?, documentType? })` lee ciclos actuales de carnet
aeroportuario y licencia de rampa para Gestión Humana o Superadministración.
Valida tipos, fechas, identificadores y paginación antes de entregar datos al
cliente. Los filtros de agente y tipo son inseparables; la respuesta exacta no
puede contener otro par ni otra página. `recordHumanResourcesPermit(id, request)`
exige UUID estable, tipo exacto, fechas y `expectedCurrentId` del ciclo observado
(o `null` para el primero). Valida la respuesta cerrada y permite repetir la
misma intención si la red no confirmó el resultado. Un 409 exige releer el par
antes de crear otra intención. La ruta restringida de Private Web ya ofrece
el formulario de alta y renovación, sin archivos adjuntos.

`getHumanResourcesShifts({ from, to, page?, limit? })` lee turnos registrados
en una ventana máxima de siete fechas locales, en páginas de hasta 100. El
wrapper valida fechas, identificadores, horarios, bloque y paginación antes de
entregar datos. La ruta restringida de Private Web presenta esta lectura por
semana y permite registrar un turno, sin calcular disponibilidad ficticia.
`recordHumanResourcesShift(id, request)` valida UUID, agente, estación,
terminal, fecha, horas locales y jornada máxima de 16 horas antes de enviar
una intención estable. El servidor conserva unicidad por agente/día, scopes
vigentes, auditoría y aviso durable; un 409 requiere reconsulta antes de un
nuevo intento. `getHumanResourcesShiftAssignmentOptions({ rampProfileId,
workDate })` valida el par exacto y entrega solamente estaciones y terminales
de alcance vigente, además de indicar si ese día ya tiene turno. El formulario
de Private Web ya utiliza esa consulta antes de enviar el comando.

`getHumanResourcesAvailabilityRequests({ from, to, page?, limit? })` lee
solicitudes con fechas solapadas en una ventana de hasta 31 días y valida
identidad, tipo, estado, fechas, paginación y respuesta. La API vuelve a
comprobar el rol interno vigente; esta lectura no registra ni aprueba
ausencias y aún no está conectada a una pantalla activa.

`@elevant/api-client` es el cliente TypeScript privado y sin dependencias de
ejecución que comparten Private Web, Public Web y Mobile Agent. El contrato se
genera con Orval `8.27.0` desde un snapshot OpenAPI revisado; los consumidores
importan TypeScript fuente y configuran una instancia por contexto o petición.

## Uso

```ts
import { createElevantApiClient } from "@elevant/api-client";

let accessToken: string | undefined;
const api = createElevantApiClient({
  baseUrl: "https://api.example.test",
  getAccessToken: async () => accessToken,
});

const session = await api.createSession({ email, password });
accessToken = session.accessToken;
const currentSession = await api.getCurrentSession();
const station = currentSession.actor.stationScopes[0];
if (!station) throw new Error("The OCC actor has no station scope.");
const planning = await api.getOccPlanningSnapshot({
  stationId: station.stationId,
  date: "2026-08-19",
});
const turnaround = planning.turnarounds[0];
if (!turnaround) throw new Error("No turnarounds are planned for that date.");
const { options, etag } = await api.getOccPlanningOptionsWithMetadata(
  turnaround.id,
);
const agent = options.agents.find((candidate) => candidate.eligible);
if (!agent) throw new Error("No eligible agent is available.");
const { assignment, etag: assignedEtag } =
  await api.assignOccPlanningOperationWithMetadata(
    turnaround.id,
    { agentId: agent.id },
    etag,
  );
const assignedRampWork = await api.getRampAssignedOperations();
const status = await api.getSystemPing({ signal: abortController.signal });
```

`baseUrl` debe ser un origen HTTP(S) absoluto sin ruta final. El callback de
token se ejecuta para cada petición autenticada; el cliente no persiste ni registra el
valor. `fetch` y `defaultHeaders` se pueden inyectar para SSR, Expo y pruebas.
Los encabezados `Authorization` duraderos se rechazan: use `getAccessToken`.
`createSession` y `getSystemPing` nunca adjuntan un Bearer previo; el consumidor
decide cómo mantener el token corto en memoria y debe evitar almacenamiento
persistente no protegido.

`getOccPlanningSnapshot` y `getOccPlanningOptions` son lecturas OCC autenticadas.
La primera acepta únicamente `stationId` UUID y `date` civil `YYYY-MM-DD`; la
segunda recibe el UUID del turnaround como argumento. El cliente construye la
query con los helpers generados, solicita un token fresco por llamada y valida
la proyección completa antes de entregarla al consumidor.
`getOccPlanningOptionsWithMetadata` conserva el mismo cuerpo y entrega además el
`ETag` fuerte. `assignOccPlanningOperation` acepta únicamente `agentId`, envía
ese valor exacto en `If-Match` y valida la proyección canónica devuelta. Los
consumidores que continuarán el flujo con la versión resultante usan
`assignOccPlanningOperationWithMetadata`, que entrega `{ assignment, etag }`.
Ambos ETags son valores fuertes y opacos: se conservan exactamente, sin
decodificarlos ni reconstruirlos. El de opciones versiona la representación
asignable completa; el de la respuesta de asignación no se reutiliza como
precondición de otro comando. Los servicios, cantidades, precios, contrato,
posición y scope son siempre
decisiones del servidor. `getManualTurnaroundOptions` consulta las aerolíneas
con contrato aprobado y vigente, aeropuertos y posiciones activas de la estación
OCC autorizada. `createManualTurnaround` envía un UUID de intención generado por
el cliente, los dos vuelos y la posición elegida; la API revalida scope, contrato,
fecha local, ruta y solapamiento de posición antes de escribir. Repetir el mismo
UUID y cuerpo devuelve la misma escala sin duplicarla. `getOccTurnaround`,
`rescheduleOccTurnaround` y `changeOccTurnaroundStatus` editan, cancelan o
desvían una escala con su ETag y la clave de la intención. `programOccShift`
programa el turno local de un agente para una escala autorizada: el cuerpo
contiene solo agente e intervalo, nunca estación, terminal o puesto; si el
agente ya tiene turno ese día responde `409 shift_day_taken`, y
`getOccAgentShift` lee ese turno con su `version` para ajustarlo con
`adjustHumanResourcesShift` (clave obligatoria). Tras programar o ajustar, OCC
debe obtener nuevamente las opciones y su ETag antes de asignar; un turno no
constituye la asignación. `releaseOccOperationAgent` acepta la asignación que
OCC ve (`expectedAssignmentId`) y la clave de la intención; una clave sin esa
asignación se rechaza antes de enviar. `getOccHandoverOptions` y
`handOverOccOperation` relevan una operación en curso o devuelta a otro agente
elegible con motivo, asignación esperada y clave obligatoria.
`getOccAttendanceAssignments` (solo web) lista las asignaciones cuya asistencia
registra OCC: las abiertas y las que un relevo cerró después del inicio, con su
`releasedAt`, que Planificación ya no muestra.
la ejecución posterior de servicios corresponde exclusivamente al agente
asignado y a su dispositivo registrado.
Las respuestas OCC también rechazan propiedades no declaradas porque sus
esquemas OpenAPI publican `additionalProperties: false`; cualquier ampliación
del contrato debe regenerar y revisar el cliente antes de desplegarse.

`getRampAssignedOperations` es la primera lectura de Mobile Agent. Ejecuta un
`GET` autenticado sin query ni body: el consumidor no puede suministrar agente,
estación ni tenant. La API los deriva de la sesión y devuelve solamente las
asignaciones activas propias. El wrapper valida recursivamente la proyección
cerrada antes de entregarla, acepta `operations: []` como cola válida y rechaza
identificadores, fechas o propiedades fuera del contrato. Iniciar una operación,
leer y enviar su checklist, y transicionar sus servicios son comandos
autenticados del mismo cliente. Los comandos exigen UUID canónicos en
`X-Elevant-Installation-Id` e `Idempotency-Key`; el wrapper sobrescribe esos
encabezados aunque el consumidor intente introducir otros valores, limita los
cuerpos al contrato y valida que la respuesta corresponda a los identificadores
de la ruta. La identidad, el agente, la estación, el tenant, los timestamps y
los recibos siguen siendo autoridad del servidor. Adjuntar evidencias permanece
fuera de este incremento.

`getAirlinePortalBootstrap` resuelve el tenant de aerolínea y sus estaciones
contratadas desde la sesión del servidor. No acepta IDs de tenant, estación
ni parámetros de búsqueda del navegador. El wrapper exige una respuesta
cerrada con UUID y campos de estación válidos antes de entregarla a Public
Web. Este bootstrap no convierte todavía los módulos de portal que usan
fixtures en datos persistentes.

Los fallos HTTP y las respuestas malformadas producen `ElevantApiError`. El
error expone solo `status`, un `title` saneado, el `traceId` opcional y el
`code` allowlisted `password_change_required` cuando la API exige reemplazar
una contraseña temporal. Ningún otro código remoto se propaga. Su
mensaje nunca incorpora el token, URL, cuerpo crudo ni `ProblemDetails.detail`.
Un `AbortError` conserva su identidad para que cada consumidor pueda cancelar.

`getOccReviewQueue(stationId)` consulta una estación incluida en el alcance
OCC; la API vuelve a validar ese alcance. `getOccReviewDetail(operationId)`
verifica la respuesta cerrada y exige que `reviewVersion` coincida con el
`ETag` fuerte de la cabecera. `decideOccReview(operationId, request, etag)`
envía un único resultado `Approved` o `Returned`, el UUID de la entrega exacta
y el motivo obligatorio al devolver. El cliente valida la respuesta y nunca
reconstruye, almacena como secreto ni reintenta automáticamente ese ETag.

`getRampIncidents` lee las incidencias de una operación asignada sin aceptar
identificadores de agente o estación. `reportRampIncident` envía solo tipo,
impacto, descripción y hora de ocurrencia con instalación y clave de
idempotencia en headers. La API deriva identidad, asignación, estado y recibo.

Las descargas financieras (`getAirlineInvoiceDocumentById`,
`getAirlinePaymentReceipt`, `getAirlineCardPaymentReceipt`,
`getFinanceInvoiceDocumentById`, `getFinancePaymentReceipt` y, desde la
fase 4 (4-N17), `getFinanceAdjustmentNoteDocument` y
`getAirlineAdjustmentNoteDocument` para el PDF de una nota de crédito o
débito con su e-NCF E34/E33) usan rutas
generadas desde OpenAPI y el Bearer
vigente. El transporte binario conserva errores HTTP tipados y rechaza HTML,
respuestas vacías, firmas ajenas a `%PDF-` y cuerpos mayores de 8 MiB. Devuelve
un `Blob` privado; la UI decide el nombre de descarga. No almacena el token ni
interpreta el PDF como comprobante fiscal.

## Contrato y generación

- `openapi/elevant-v1.json`: snapshot canónico certificado.
- `openapi/source.json`: descriptor cerrado del contrato con versión de
  esquema, huella SHA-256 canónica y ruta Swagger.
- `generated/elevant-api.ts`: salida determinista de Orval; no se edita a mano.
- `src`: fábrica y transporte compartido, sin dependencias de ejecución.

Las aplicaciones importan exclusivamente el punto de entrada público de
`@elevant/api-client`; no consumen `generated/elevant-api.ts` directamente. El
wrapper es quien agrega autenticación fresca, valida respuestas y adjunta el
`If-Match` exigido por el comando OCC. Los comandos móviles añaden
`X-Elevant-Installation-Id` e `Idempotency-Key` y validan el recibo, incluyendo
la entrega de operación a OCC.

La generación requiere Node.js 24 y npm:

```bash
npm ci
npm run generate
npm run check
```

Para comparar estructuralmente el snapshot con un archivo o una API local:

```bash
npm run check:openapi -- ./swagger.json
npm run check:openapi -- http://127.0.0.1:8080/swagger/v1/swagger.json
```

Para capturar el contrato de una API compilada localmente en modo Testing y
actualizar el descriptor de forma reproducible:

```bash
npm run refresh:openapi -- http://127.0.0.1:8080/swagger/v1/swagger.json
npm run generate
npm run check
```

La comparación ignora espacios y el orden de propiedades JSON, pero detecta
cualquier otra deriva. CI no usa Tailscale: compila el backend del commit, lo
inicia localmente en `Testing` y compara su documento. Un cambio incompatible
exige versionar el endpoint o coordinar la migración de los tres consumidores.

El descriptor `source.json` tiene exactamente esta forma:

```json
{
  "schemaVersion": 1,
  "openApiSha256": "sha256:64_HEX_MINUSCULAS",
  "swaggerPath": "/swagger/v1/swagger.json"
}
```

`openApiSha256` se calcula sobre JSON canónico: las claves de cada objeto se
ordenan recursivamente, el orden de los arrays se conserva y el resultado se
serializa sin espacios antes de aplicar SHA-256 sobre sus bytes UTF-8. Los
enteros deben estar dentro del rango seguro de JavaScript; un valor fuera de él
se rechaza para evitar que dos literales distintos pierdan precisión y compartan
huella. Los checks también rechazan claves adicionales, una versión desconocida
y cualquier huella que no coincida exactamente con `openapi/elevant-v1.json`.
El descriptor identifica el contrato compartido; la procedencia de una release
concreta se mantiene en sus manifiestos inmutables de entrega.

### Chat operativo paginado

Las lecturas `getOperationalConversations(stationId, { signal, offset })` y `getOperationalMessages(operationId, { signal, offset })` aceptan offset entero no negativo (cero predeterminado). Las llamadas existentes con signal conservan sus URLs y comportamiento. Los limites siguen siendo 100 conversaciones y 200 mensajes; hasMore y el orden del servidor se mantienen. Publicar primero la API compatible y despues los clientes. No hay cambios de esquema ni despliegues en esta tarea.


## Presencia operativa

`getOperationalPresence(operationIds, options)` consulta hasta 100 operaciones
por petición, preservando `signal`; `putOperationalPresence(heartbeat, options)`
envía el lease propio. Las respuestas se validan antes de exponerse al cliente.
`createPresenceLease` comparte el contador, coalescencia, pausa, reanudación y
cierre entre Web y Expo; no incorpora persistencia ni outbox.

El contrato compilado incluye los estados `active/away/offline/unknown`, nombres
reales por operación y actividad UTC opcional. El cliente no infiere presencia
desde el historial ni desde tener abierta una conversación. Los servidores
anteriores sin estas interfaces dejan la presencia no disponible y conservan
el chat existente. La publicación futura será API primero.
