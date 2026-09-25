# Backend de ELEVANT

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
- `GET /api/v1/occ/planning` publica el snapshot OCC de una fecha y estación
  dentro del scope efectivo del actor. Si se omite la fecha, selecciona la más
  reciente con operaciones; la estación solo se puede omitir cuando el actor
  tiene exactamente un scope.
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
  Los tres endpoints OCC exigen `ADMIN_OCC`, portal BackOffice, membresía
  interna AVIAM vigente y scope de estación.
- `GET /api/v1/ramp/operations` entrega al agente de rampa autenticado sus
  asignaciones activas, el contexto operativo y los servicios planificados.
  No acepta `agentId` ni `stationId`: vuelve a resolver en SQL la cuenta, el
  perfil activo y los scopes, filtra por agente y estación antes de proyectar
  y limita la respuesta a 100 operaciones ordenadas. Exige `RAMP_AGENT`, portal
  `RampMobileApp` y membresía interna AVIAM; una cuenta sin perfil compatible
  falla cerrada con `403` y una cola legítimamente vacía responde `200`.
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
  incidencias y decisión registrada. Su `ETag` fuerte se repite en
  `reviewVersion` y representa la versión de operación y entrega observada.
- `POST /api/v1/occ/review/operations/{operationId}/decision` aprueba o
  devuelve una sola entrega pendiente. Exige `If-Match` con ese ETag,
  `submissionId` exacto y un motivo de 8 a 2000 caracteres al devolver.
  Revalida rol OCC, membresía AVIAM y estación en SQL dentro de una
  transacción serializable; cambia operación y entrega, crea una decisión,
  evento y auditoría atómicos. `409`/`412` obligan a releer el detalle; el
  cliente nunca reintenta automáticamente una decisión de resultado incierto.
  Esta versión no implementa todavía la corrección y nueva entrega por parte
  del agente tras una devolución, ni adjuntos de evidencia.
- El `POST` de sesión limita el cuerpo a 4096 bytes (4 KiB) y, por defecto, a
  10 intentos por IP remota en 60 segundos; responde `413` o `429`,
  respectivamente, cuando se excede cada límite.
- `/swagger/v1/swagger.json` publica el contrato HTTP en Development.

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
