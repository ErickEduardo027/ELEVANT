# Cliente API compartido

El snapshot OpenAPI incluye `GetAffiliationOptions` como lectura anónima
acotada de estaciones activas y servicios publicados, sin precios. El flujo
público actual usa `GetPublicCommercialCatalog` y `SubmitCommercialRequest`
para solicitar servicios sin elegir contraseña. Contratos aprueba o rechaza y
el superadministrador crea las credenciales manualmente. Los endpoints de
gobernanza, catálogo administrado y borradores también están en el snapshot.
`GetManagedContractDraftOverview` ofrece a Contratos un resumen autorizado y
acotado de borradores sin comentarios ni tarifas; la lectura completa sigue
reservada para la pantalla de edición.
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

`getAirlineContracts({ page?, limit? })` consulta hasta 50 contratos por página
para la única aerolínea derivada en la API de la sesión. El cliente valida
estructura, paginación, versiones publicadas, estaciones y tarifas; no acepta
un ID de tenant ni habilita acciones comerciales.

`getManagedContracts({ page?, limit? })` consulta la lectura interna paginada
de acuerdos publicados, con aerolínea, estado de versión, estaciones y tarifas. La API exige el
permiso comercial correspondiente y el wrapper valida la forma recibida;
esta lectura no crea ni modifica contratos.

`getAirlinePreinvoices({ page?, limit? })` consulta prefacturas publicadas y
propias del tenant derivado por la API; no expone borradores de Finanzas. El
cliente rechaza parámetros fuera de rango, estados internos y campos ajenos al
contrato. `getAirlinePreinvoice(id)` relee las líneas y precios congelados de
una prefactura propia publicada; un ID ajeno o un borrador no revela detalle.
Factura, pago y recibo siguen fuera de este contrato de lectura.

`getFinanceApprovedServices({ stationId, from, to })` muestra evidencia
aprobada por OCC y la reserva de cada servicio. `createPreinvoiceDraft` envía
una clave UUID estable con 1–100 servicios y valida el ID guardado;
`getPreinvoiceDraft(id, expectedStationId)` reconsulta y valida el detalle
persistente y su estación. Solo Finanzas interna autorizada puede usar estos
contratos. El borrador aún no es factura, pago ni recibo.

`getFinancePreinvoices({ stationId, page?, limit? })` lista hasta 50 prefacturas
internas por página para la estación con grant vigente de Finanzas. El wrapper
valida estado, importes, fechas, conteo de líneas y que cada fila pertenece a
la estación pedida. La API no acepta un tenant suministrado por el cliente.

`getFinanceTariffs({ stationId, page?, limit? })` lista hasta 50 tarifas de
versiones contractuales publicadas que cubren la estación con grant vigente de
Finanzas. Rechaza parámetros fuera de rango, respuestas de otra estación,
precios negativos y versiones no publicadas. Es una lectura; no cambia tarifas
ni revaloriza snapshots operativos o financieros históricos.

`getFinanceReconciliation({ stationId, page?, limit? })` lista hasta 50
prefacturas aceptadas o facturadas por página, con su factura no fiscal y,
si existe, el pago manual registrado. La API exige rol Finanzas, membresía
interna y grant de la estación; el wrapper rechaza otra estación, paginación
incoherente y combinaciones inválidas de estado, factura y pago. Es una
proyección de seguimiento, no una confirmación de conciliación bancaria.

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

`getHumanResourcesPermits({ page?, limit? })` lee ciclos actuales de carnet
aeroportuario y licencia de rampa para Gestión Humana o Superadministración.
Valida tipos, fechas, identificadores y paginación antes de entregar datos al
cliente. La ruta restringida de Private Web los muestra en solo lectura; el
método no crea ni renueva documentos.

`getHumanResourcesShifts({ from, to, page?, limit? })` lee turnos registrados
en una ventana máxima de siete fechas locales, en páginas de hasta 100. El
wrapper valida fechas, identificadores, horarios, bloque y paginación antes de
entregar datos. La ruta restringida de Private Web presenta esta lectura por
semana y no ofrece programación ni disponibilidad calculada ficticia.

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
UUID y cuerpo devuelve la misma escala sin duplicarla. Editar escalas existentes
y reasignar siguen fuera de este cliente. `programOccShift` programa el turno
local de un agente para una escala autorizada: el cuerpo contiene solo agente
e intervalo, nunca estación, terminal o puesto. Tras programar, OCC debe
obtener nuevamente las opciones y su ETag antes de asignar; programar un turno
no constituye la asignación.
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

`getFinanceApprovedServices({ stationId, from, to })` exige una estación y un
intervalo inclusivo de hasta 31 días. El wrapper comprueba que el alcance
devuelto coincide con el solicitado, limita la página a 200 líneas y rechaza
importes listos sin precio/moneda congelados o filas con propiedades ajenas al
contrato. La API revalida el rol financiero y la estación; esta lectura no
emite facturas ni modifica revisiones.

Las cuatro descargas financieras (`getAirlineInvoiceDocument`,
`getAirlinePaymentReceipt`, `getFinanceInvoiceDocument` y
`getFinancePaymentReceipt`) usan rutas generadas desde OpenAPI y el Bearer
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
