# Cliente API compartido

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
decisiones del servidor. Crear vuelos y reasignar siguen fuera de este cliente;
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

Los fallos HTTP y las respuestas malformadas producen `ElevantApiError`. El
error expone solo `status`, un `title` saneado y el `traceId` opcional. Su
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
