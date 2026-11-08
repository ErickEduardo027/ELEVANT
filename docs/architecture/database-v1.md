# Base de datos ELEVANT v1

## Validación aditiva de asistencia en la rama local

La migración `20261005164319_OperationAttendanceValidation`, posterior a la
clausura comercial de #128, añade
`ops.operation_attendance_validations`. Cada fila guarda la asignación, las dos
revisiones consultadas, los instantes elegidos por carril, el motivo cuando
corresponde, validador, UUID idempotente y hash del cuerpo. Los índices únicos
impiden dos decisiones para el mismo par de revisiones o reutilizar una
intención del actor; las FK son `NO ACTION` y no hay datos de negocio en la
migración. Un aporte posterior no reescribe la decisión: la lectura la presenta
como no vigente. El SQL de verificación exige las migraciones de #128 y G.H.;
la presencia del esquema local no prueba promoción al VPS.

Estado del esquema: implementado y versionado en `Development`; la cadena v1
fue aceptada mediante la operación controlada de Development. Esto no significa
que las capacidades de negocio representadas por todas sus tablas ya tengan
handlers o endpoints. Production permanece como frontera futura separada.

## Límite del producto

ELEVANT posee tres clientes y una sola fuente de verdad por ambiente. La última
columna expresa la **regla de diseño**, no permisos de aplicación ya efectivos:

| Cliente | Audiencia | Frontera de datos |
| --- | --- | --- |
| `frontend/private-web` | Equipos internos AVIAM | Acceso entre aerolíneas solo con rol y scope de estación explícitos |
| `frontend/public-web` | Clientes/aerolíneas | Tenant derivado por la API desde la membresía autenticada |
| `frontend/mobile-agent` | Agentes de rampa | Agente/estación derivados por la API; comandos offline idempotentes |

Ningún cliente se conecta a SQL Server. Cuando se habilite Production, su base,
VPS, credenciales y volúmenes serán independientes de Development; aplicará la
misma secuencia ordenada de migraciones, pero no recibirá fixtures sintéticos.

## Decisiones derivadas de los frontends

- `turnaround` representa una escala aeroportuaria. Puede tener como máximo un tramo de llegada y uno de salida, con STA/ETA/ATA y STD/ETD/ATD independientes.
- Aerolíneas, aeropuertos, estaciones, terminales, stands, servicios, equipos, aeronaves y posiciones son catálogos canónicos. Un texto de un mock nunca es foreign key.
- Persona, cuenta de acceso, membresía de organización y perfil laboral de agente son conceptos separados.
- Habilitaciones y permisos son ciclos históricos. `vigente`, `por vencer` y `vencido` son proyecciones calculadas desde fechas.
- Los contratos tienen versiones aprobables. Tarifas, moneda y vigencia pertenecen a una versión; un servicio ejecutado guarda su snapshot y no se revaloriza con la tarifa actual.
- Las asignaciones son relaciones normalizadas. Los arrays duplicados dentro de vuelos mock no se persisten.
- Estados operativos, respuestas de checklist, envíos a OCC y decisiones de revisión deben conservar historial append-only. Las tablas modelan ese historial; todavía faltan handlers y permisos que lo garanticen en todos los caminos de escritura.
- Cada futura escritura móvil debe usar una clave de idempotencia dentro del scope de un dispositivo registrado y almacenar su resultado/error para responder reintentos. La tabla e índice existen, pero no hay endpoint de comandos offline.
- KPIs, cobertura, conteos, alertas, no-leídos y elegibilidad son read models, no tablas autoritativas.

## Convenciones SQL Server

- SQL Server 2022, compatibility level `160`.
- Schemas: `infra`, `iam`, `ref`, `hr`, `commercial`, `ops`, `integration`, `audit`.
- Claves internas `bigint identity`; agregados expuestos usan `uniqueidentifier` público y único.
- Instantes en `datetimeoffset(3)` UTC; fechas civiles en `date`; estaciones con zona IANA.
- Dinero `decimal(19,4)`, cantidades `decimal(18,4)`, moneda ISO 4217 `char(3)`.
- Agregados mutables con `rowversion` para concurrencia optimista.
- Foreign keys `NO ACTION`; no hay borrado en cascada de historial operativo, contractual o de auditoría.
- Nombres físicos `snake_case`; clases de dominio en singular.

## Cadena de migraciones v1

> La tabla de diez migraciones que sigue es una fotografía histórica de v1,
> no un inventario completo de las migraciones posteriores del repositorio.
> Las afirmaciones de despliegue en esta sección corresponden a su momento
> original; la promoción de una migración nueva requiere evidencia propia.

La migración 11, `AccountChangeFeed`, se prepara en esta rama y no está
desplegada todavía. Agrega `infra.account_changes`: una pista sin contenido
por cuenta y evento del outbox. Su identidad `bigint` ordena los commits de
un solo distribuidor y sustenta el cursor opaco de lectura; no refleja el
orden de asignación de IDs originales del outbox. La pareja
`(outbox_public_id, recipient_account_id)` es única para evitar duplicados
en reintentos. La cuenta de la API recibe solo `SELECT/INSERT/UPDATE` sobre
`infra.outbox_messages` y `SELECT/INSERT` sobre `infra.account_changes`,
sin `DELETE` ni permisos amplios sobre el esquema `infra`.

| Orden | Migración | Módulos |
| --- | --- | --- |
| 1 | `V1_01_Platform` | schemas, outbox y convenciones base |
| 2 | `V1_02_IdentityReference` | Identity, personas, organizaciones, scopes y catálogos |
| 3 | `V1_03_WorkforceCommercial` | agentes, habilitaciones, turnos, solicitudes y contratos versionados |
| 4 | `V1_04_Operations` | turnarounds, vuelos, asignaciones, servicios, checklists, incidentes y revisión |
| 5 | `V1_05_MobileAudit` | dispositivos, idempotencia y auditoría detallada |
| 6 | `V1_06_DevelopmentAccountCredentialRotation` | correo normalizado único y rotación restringida de credenciales sintéticas Development |
| 7 | `V1_07_DevelopmentHumanResourcesAccount` | allowlist de rotación para la cuenta sintética de Gestión Humana |
| 8 | `V1_08_RampCorrectionRevisions` | revisiones históricas de correcciones de rampa |
| 9 | `V1_09_OperationalCommunication` | mensajes y notificaciones operativas persistentes |
| 10 | `V1_10_DevelopmentCredentialActivation` | marca de cambio obligatorio de contraseña y recuperación manual de Gestión Humana |

EF Core conserva un único historial en `infra.__EFMigrationsHistory`. `infra.database_instances` se crea antes de EF y se excluye de migraciones para que la herramienta pueda verificar el destino antes de modificar el esquema.

### Extensión aditiva de asistencia compartida

La migración posterior `20261005133619_OperationAttendanceContributionRevisions`
agrega `ops.operation_attendance_contribution_revisions` para una revisión
inmutable por asignación, carril (`Occ` o `RampAgent`) y número. Conserva autor,
instalación móvil cuando aplica, clave idempotente, hash de la intención,
instantes observados, nota de incidente y momento de registro. Tiene índices
únicos para `(assignment, lane, revision)` y `(author, idempotency_key)`, además
de restricciones de carril, revisión positiva y cronología. Sus claves foráneas
son `NO ACTION`; la migración no inserta datos de negocio.

El almacén SQL revalida el acceso vigente y serializa las escrituras por
asignación. En la misma transacción agrega revisión, auditoría y avisos de
outbox con recurso `attendance_draft`. El feed revalida el acceso al leerlos;
una pista no transporta la nota ni sustituye la relectura autorizada. Para
el agente, el filtro exige la instalación concreta de la consulta, incluso si
la misma cuenta tiene otra instalación activa. El esquema y su contrato están
probados localmente en esta rama: esta nota no
afirma su despliegue en Development ni que exista ya una interfaz de captura.

## Política de ambientes y datos

Una ejecución debe coincidir en tres niveles:

1. `ELEVANT_DATABASE_ENVIRONMENT=Development|Production`;
2. nombre exacto `ElevantDevelopmentDb` o `ElevantProductionDb`;
3. marcador singleton del mismo ambiente en `infra.database_instances`.

Production además exige `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb`. La migración de Production crea tablas/índices/constraints, pero no filas de negocio. El único registro previo permitido es el marcador técnico del ambiente; EF añade su historial técnico. No existe comando de seed de Production.

El seed de Development es un ejecutable separado, transaccional, determinista, idempotente y limitado por el marcador. Nunca hace reset, delete global o reemplazo de datos existentes. Todo fixture es sintético y usa identidades `.test`.

En esta rama local, `seed-development-scenario` es un segundo comando explícito
para preparar una fecha PUJ de prueba después del seed base: crea dos escalas
planificadas y turnos de cobertura con claves derivadas de la fecha, sin
asignar agentes ni marcar servicios ejecutados. Valida contrato, estación,
turno, stand y marcador Development dentro de una transacción serializable;
no forma parte del CD automático ni se ha ejecutado en el VPS.

## Disputas de prefactura en la rama de integración

La migración aditiva `PreinvoiceDisputes`, posterior a `PersonAvatarMedia`,
conserva el motivo y las líneas cuestionadas de cada respuesta de aerolínea.
Una transacción serializable cambia `Submitted` a `Disputed` y guarda la
objeción, auditoría y pistas de cambio sin alterar los importes congelados.
`ResolvePreinvoiceDisputes` añade una decisión única por disputa, con clave
idempotente, actor, motivo y auditoría. `Maintain` devuelve `Disputed` a
`Submitted` para respuesta nueva de la aerolínea; `Void` pasa a `Voided` y
marca las líneas como liberadas sin borrar sus snapshots. El índice único de
servicio se filtra por reservas no liberadas, permitiendo refacturar después
solo mediante un borrador nuevo. El portal conserva visibilidad de una anulada
únicamente si existe la resolución `Void` de una disputa publicada; anulaciones
internas no publicadas siguen ocultas. No hay ajuste parcial ni repricing.
El rollback de `ResolvePreinvoiceDisputes` se detiene si hay resoluciones o
líneas liberadas: esos hechos son historial, no datos descartables. La columna
`released_at` conserva precisión UTC de milisegundos (`datetimeoffset(3)`).
Conciliación y recibo continúan pendientes; esta rama no está desplegada.

## Factura no fiscal en la rama de integración

`NonFiscalInvoices` agrega `commercial.non_fiscal_invoices` y
`commercial.non_fiscal_invoice_lines` sin alterar el contrato v1 de prefactura.
Solo una prefactura `Accepted` se puede emitir: la transacción serializable
revalida el alcance de Finanzas, conserva moneda, total y cada línea aceptada
como snapshot, cambia el estado a `Invoiced` y escribe auditoría e invalidaciones
durables. Los índices únicos de prefactura, clave y línea fuente impiden duplicar
la emisión. La aerolínea relee su propia factura mediante una ruta tenant-scoped;
no se infiere un documento tributario ni un pago. La migración es aditiva,
sin DML de negocio y aún no está desplegada.

## Revisión comercial y aerolíneas sin IATA

`20261106020045_AddCommercialRequestReviewAndIcaoOnlyAirlines`, posterior a
`AddSimulatedCardPayments`, es la única migración de la fase 1 del ciclo
([ADR-0037](../adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md)).
Es aditiva y no lleva DML de negocio.

- `commercial.service_requests` gana siete columnas opcionales: la confirmación
  del representante (fecha, cuenta con FK `NO ACTION` indexada y nota) y la
  aerolínea que propuso el solicitante (país, IATA, ICAO y sitio). La propuesta
  vive en la solicitud, no en el catálogo de aerolíneas.
- `ref.airlines.iata_code` pasa a `char(2) NULL`: el ICAO identifica a un
  operador sin designador IATA. El índice único de IATA se filtra por
  `iata_code IS NOT NULL`, y `ck_airline_iata` no cambia.
- El `Down` se detiene (`THROW 52370`) si ya hay confirmaciones, propuestas o
  aerolíneas sin IATA, porque esa historia comercial no se descarta.

Los estados que el ciclo comercial empieza a usar se guardan como texto en
columnas que ya existían: la solicitud en revisión o cancelada, la versión de
contrato descartada (`Rejected`), el paquete descartado o retirado y el correo
descartado. Los recibos de idempotencia de esos comandos reutilizan
`commercial.finance_pricing_commands`.

## Pre-operación sin migración

La fase 2 del ciclo
([ADR-0038](../adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md))
no añade migración: `has-pending-model-changes` no reporta cambios, y ningún
bloque toca el seed ni `verify-development.sql`. Todo lo nuevo cabe en columnas,
índices y tablas que ya existían:

- El permiso de aerolínea gana el estado `Revoked`, que cabe en la columna de
  revisión (hasta 16 caracteres). Los siete propósitos de correo nuevos caben en
  la columna de propósito (hasta 24; el más largo, `ContractReadyToSign`, tiene
  19).
- Una versión de contrato retirada pasa a `Rejected` y conserva `approved_at`.
  Una terminación programada guarda en `terminated_on` su primer día sin
  cobertura, y `ck_contract_dates` se sigue cumpliendo con una fecha futura. La
  política de precios firmada usa la columna `pricing_policy_version`, con el
  valor 2.
- Liberar una tablet cierra su vínculo con `unbound_at`, y revocarla marca la
  instalación con `revoked_at`; ambas cumplen `ck_device_binding_dates` y
  `ck_mobile_device_revoked`.
- Los representantes y firmantes del portal son filas de
  `iam.account_permission_grants` (`airline_portal.representative` y
  `airline_portal.signer`); la tabla no tiene FK sobre el código.
- Estaciones, terminales, posiciones y tipos de avión se crean y desactivan con
  `is_active`, `row_version` y los índices únicos existentes; nada se borra.
- Los recibos de idempotencia siguen en `commercial.finance_pricing_commands` y,
  para los comandos móviles, en `integration.mobile_command_receipts`.

Dos casos de datos heredados no se corrigen con una migración: las versiones
que una aprobación anterior dejó `Superseded` y recortadas frente a una
renovación sin firmar, y los agentes dados de baja antes del cambio que
conservan coberturas, asignaciones o turnos abiertos. ADR-0038 explica cómo se
tratan.

## La operación: incidencias, reaperturas y correcciones

`20261108043225_AddOccIncidentsReviewReopenAndServiceOrderCorrections`, posterior
a `AddCommercialRequestReviewAndIcaoOnlyAirlines`, es la única migración de la
fase 3 del ciclo
([ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).
Es aditiva, sin `HasData` ni DML de negocio, y todas sus claves foráneas son
`NO ACTION`:

- `ops.incidents`: `reported_by_ramp_agent_id` admite nulos y se suma
  `reported_by_account_id` (FK a la cuenta, con índice), porque OCC también
  reporta incidencias. `ck_incident_reporter` exige al menos un reportante.
- `ops.incident_status_events`, tabla nueva: la historia de cada incidencia, con
  el estado anterior y el nuevo (`nvarchar(16)`), la nota (`nvarchar(2000)`),
  `occurred_at` (`datetimeoffset(3)`) y la cuenta que actuó, opcional; índice
  `(incident_id, occurred_at)`.
- `ops.operation_submissions`: la reapertura de una aprobación crea una revisión
  nueva enlazada a la anterior (`reopened_from_submission_id`, FK a la misma
  tabla con un índice único filtrado), con quién la reabrió y el motivo
  (`nvarchar(2000)`). `ck_operation_submission_reopening` exige las tres
  columnas o ninguna.
- `ops.operation_document_versions`: una Orden de Servicio que OCC corrige
  después de la firma guarda la versión que corrige (`corrects_version_id`, FK a
  la misma tabla), el motivo (`nvarchar(500)`), la cuenta y la hora.
  `ck_operation_document_version_correction` exige todas o ninguna.
- `ops.operation_services`: la exclusión de facturación de OCC guarda la hora,
  la cuenta y el motivo (`nvarchar(500)`).
  `ck_operation_service_billing_exclusion` exige las tres o ninguna.

El `Down` se detiene (`THROW 52380` a `52383`) si ya hay incidencias de OCC o
historial de incidencias, revisiones reabiertas, Órdenes corregidas o servicios
excluidos: es historia operativa y de facturación que no se descarta. La
migración está registrada en `scripts/diagnostics/verify-development.sql`, y
`has-pending-model-changes` no reporta cambios.

El resto de la fase cabe en columnas que ya existían: `Cancelled` y `Diverted`
de la escala, `aircraft_type_id`, `source` del tramo, el código de operación
legible dentro del índice único actual, `row_version`, `released_at` y
`assigned_to` de turnos, coberturas y asignaciones, `actual_start_at`,
`operation_service_status_events.occurred_at`,
`mobile_command_receipts.error_code` y `removed_at` de los recargos. Ningún
bloque toca el seed. El modelo anterior a esta migración declara obligatorio el
agente que reporta una incidencia: si la API vuelve a esa versión después de que
OCC reporte una, falla donde carga esa incidencia completa.

## Diferido explícitamente

- emisión fiscal, documentos PDF, recibos y ledger de conciliación;
  la rama local ya modela prefactura, factura no fiscal y anotación manual
  de pago de Development con snapshots
  independientes, pero no las ha promovido al VPS;
- notificaciones y chat;
- documentos y evidencia binaria;
- proyecciones analíticas materializadas.

Los mocks actuales tienen reglas incompletas o contradictorias para esas capacidades. Los binarios usarán almacenamiento S3-compatible; SQL conservará metadatos y object keys cuando se diseñe el módulo. Hasta entonces no se improvisan carpetas persistentes en el VPS ni columnas blob.
