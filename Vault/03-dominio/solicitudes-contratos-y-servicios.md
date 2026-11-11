---
id: dominio-solicitudes-contratos-servicios
title: "Solicitudes, contratos y servicios"
type: capability
area: domain
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-26"
verified_commit: "83ce325f99fea54879649f92ae1a231637a1bc2d"
sources:
  - backend/Elevant.Application/Commercial/ContractVersionGovernance.cs
  - backend/Elevant.Application/Commercial/ContractLifecycle.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/GoverningContractVersions.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/ContractVersionSupersession.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/ContractVersionWithdrawal.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfContractLifecycleStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfContractDocumentStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfAirlinePermitStore.cs
  - docs/architecture/database-v1.md
  - backend/Elevant.Domain/Entities/Commercial/ServiceRequest.cs
  - backend/Elevant.Domain/Entities/Commercial/Contract.cs
  - backend/Elevant.Domain/Entities/Commercial/ContractVersion.cs
  - backend/Elevant.Domain/Entities/Commercial/Preinvoice.cs
  - backend/Elevant.Domain/Enumerations/PreinvoiceStatus.cs
  - backend/Elevant.Domain/Entities/Operations/OperationalServiceRequest.cs
  - backend/Elevant.Domain/Enumerations/WorkforceCommercialEnums.cs
  - backend/Elevant.Domain/Enumerations/OperationsEnums.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/WorkforceCommercialConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/PreinvoiceConfiguration.cs
  - backend/Elevant.Api/Controllers/AirlinePortalController.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfAirlinePortalReadStore.cs
  - backend/Elevant.Application/Commercial/ContractDraftRules.cs
  - backend/Elevant.Application/Commercial/ContractAmendment.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfCommercialWorkflowStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfContractDraftStore.Commands.cs
tags:
  - solicitudes
  - contratos
  - servicios
  - comercial
---

# Solicitudes, contratos y servicios

> [!NOTE]
> La revisión docente de octubre de 2026 cambió validaciones, permisos, notificaciones y otros comportamientos descritos aquí. El estado actual de cada punto está en [Correcciones de la revisión docente](../05-aplicaciones/correcciones-revision-docente-2026-10.md).

ELEVANT modela dos tipos de solicitud con propósitos distintos. La solicitud comercial inicia o amplía una relación de servicio; la solicitud operativa pide resolver una necesidad dentro de una estación y, opcionalmente, una escala concreta.

> El commit verificado del frontmatter describe la base anterior. Esta rama de
> integración agrega consultas tenant-scoped de solicitudes operativas; no está
> promocionada ni habilita nuevas transiciones. La lectura de prefacturas
> publicadas que también agregaba se retiró en la fase 4 (ver abajo).

## Dos procesos, dos identidades

| Dimensión | Solicitud comercial | Solicitud operativa |
| --- | --- | --- |
| Schema/entidad | `commercial.ServiceRequest` | `ops.OperationalServiceRequest` |
| Propósito | Afiliación o servicio adicional con impacto comercial | Necesidad de servicio durante la operación |
| Aerolínea | Opcional mientras se canoniza; conserva nombre/contacto | Obligatoria y ya canónica |
| Estación | Muchas mediante tabla puente | Una estación obligatoria |
| Turnaround | No se vincula directamente | Opcional |
| Servicio | Muchos ítems, cada uno con catálogo opcional y texto snapshot | Una definición opcional más nombre solicitado |
| Historia de estado | Tabla de eventos propia; tratarla como append-only es un diseño todavía pendiente de enforcement | Sólo estado actual en v1; auditoría transversal no equivale a historia dedicada |
| Actor | Contacto y cuenta revisora opcional | Cuenta solicitante obligatoria y resolutora opcional |

## Solicitud comercial y contrato

```mermaid
flowchart LR
    REQUEST[Solicitud comercial] --> STATIONS[Estaciones solicitadas]
    REQUEST --> ITEMS[Servicios y cantidades solicitadas]
    REQUEST --> HISTORY[Eventos de estado]
    REQUEST -.-> CONTRACT[Contrato originado]
    CONTRACT --> CHISTORY[Eventos del contrato]
    CONTRACT --> VERSION[Versión numerada]
    VERSION --> SCOPE[Estaciones cubiertas]
    VERSION --> RATES[Tarifas por servicio]
    RATES -.-> OPSERVICE[OperationService · FK opcional]
    OPSERVICE --> SNAPSHOT[Columnas snapshot]
```

`CommercialRequestType` sólo contiene `Affiliation` y `AdditionalService`. Sus estados persistibles son `Pending`, `InReview`, `Approved`, `Rejected` y `Cancelled`. Cada ítem puede expresar cantidad estimada, unidad y vigencia solicitadas; fechas invertidas y cantidades no positivas son rechazadas por constraints. Desde [ADR-0037](../../docs/adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md) los cinco estados se usan: la solicitud pasa a `InReview` cuando Contratos verifica la aerolínea o confirma al representante, y termina aprobada, rechazada o cancelada, siempre con evento de estado y auditoría.

El contrato guarda aerolínea, código y estado general (`Draft`, `Active`, `Suspended`, `Terminated`, `Expired`). Sus versiones tienen número positivo, vigencia, moneda, términos y estado (`Draft`, `PendingFinanceApproval`, `Approved`, `Superseded`, `Rejected`). `Rejected` marca la versión que Contratos descartó antes de la aprobación, la que quedó abierta en un contrato terminado o, desde la fase 2, la versión aprobada que Contratos retiró antes de que ambas partes la firmaran; Finanzas nunca rechaza: devuelve la versión a `Draft`. Tarifas y estaciones pertenecen a la versión, no al contrato mutable.

En la rama `feat/finance-refinement`, el borrador hereda precio y unidad de la tarifa base de Finanzas en su moneda (USD o DOP) y «activar» envía la versión a `PendingFinanceApproval`: solo la aprobación de Finanzas la deja `Approved`; una devolución exige motivo y la regresa a `Draft`. Ver [Finanzas: tarifarios, cargos y cobros](finanzas-tarifas-cargos-y-cobros.md).

La rama de integración añade una lectura interna paginada de acuerdos (`GET /api/v1/contracts/agreements`) para personal con permiso `commercial.requests.read`. Incluye únicamente versiones `Approved` o `Superseded` con sus estaciones y tarifas. Esta lectura no autoriza crear ni alterar un contrato, ni confiere acceso de aerolínea: la lectura del portal sigue derivando su tenant por separado.

El esquema permite enlazar un contrato a una solicitud mediante `OriginatingServiceRequestId`, pero no prueba que la solicitud estuviera aprobada ni que perteneciera a la misma aerolínea del contrato. Tampoco impide vigencias de versiones solapadas. En la aplicación, solo la aprobación de una solicitud crea un contrato desde ella, y una renovación o una enmienda debe empezar después de la última versión aprobada; el esquema, por sí solo, sigue sin impedirlo.

En la rama de integración de Development, el portal dispone de una lectura
tenant-scoped y paginada de contratos publicados (`Approved` y versiones luego
`Superseded`). El historial vencido de la propia aerolínea permanece consultable.
La aerolínea también ve sus borradores (`Draft` y `PendingFinanceApproval`) como
copia de revisión con marca de agua, puede comentarlos y firma la versión aprobada
desde el portal (ADR-0024).

## Reglas de la fase 1 del ciclo (ADR-0037)

- **Una afiliación por aerolínea.** Aprobar se rechaza si la aerolínea ya tiene
  un contrato `Draft`, `Active` o `Suspended`, otra solicitud aprobada cuyo
  contrato sigue vivo, cuentas activas del portal o un código que pertenece a
  otra aerolínea. Quien ya opera amplía su contrato con una enmienda o una
  renovación. Con contratos solo terminados o vencidos puede volver a afiliarse.
  *Posterior al commit verificado: desde la fase 3 del ciclo, un código que
  pertenece a la aerolínea mínima que OCC creó para un charter no rechaza la
  aprobación: la aprobación vincula esa aerolínea y la completa
  ([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).*
- **Representante confirmado.** Aprobar exige que Contratos haya registrado
  quién confirmó al representante, cuándo y cómo.
- **Aerolínea propuesta.** Si la aerolínea no está en el catálogo, la solicitud
  guarda la propuesta del solicitante (nombre, país, ICAO, IATA opcional y
  sitio). Contratos la vincula a una ficha existente o crea una ficha
  verificada al revisarla.
- **ICAO sin IATA.** El ICAO es obligatorio; `ref.airlines.iata_code` admite
  nulos con un índice único filtrado.
- **Unidad de cobro.** Solicitud, borrador, enmienda y tarifas guardan el
  código de `ref.billing_units`; un nombre heredado se traduce sin reescribir
  filas.
- **Borrador.** Contratos agrega o quita servicios activos y estaciones antes
  de enviarlo a Finanzas. Un servicio dado de baja se conserva marcado y
  bloquea el envío hasta que se quita. Descartar deja la versión `Rejected` y,
  si el contrato nunca se activó, lo termina. Nada se borra.
- **Lo que ve la aerolínea.** Comenta su borrador también mientras Finanzas lo
  revisa, pero no recibe la tarifa base, los valores base de los cargos ni el
  motivo interno de una devolución de Finanzas.
- **Enmienda.** Parte de la versión que rige de un contrato activo o
  suspendido, hereda su fin y empieza después de su inicio. Desde la fase 2,
  la que rige es la aprobada y firmada por ambas partes, o la heredada con la
  que el contrato se activó (ver abajo).

## Vigencia, firmas y código definitivo (ADR-0025)

Después de que Finanzas aprueba las tarifas, Contratos confirma la vigencia
(inicio, fin), la renovación (manual o automática, con plazo y días de aviso) y
el preaviso y las condiciones de terminación (`PUT contract-versions/{id}/validity`,
permiso «Fijar vigencia y renovación»). En ese momento un contrato con código
`DRAFT-…` recibe su código definitivo `CTR-{año}-{n}`, porque el código forma
parte del contenido firmado.

Solo entonces se habilitan las firmas, en orden: primero la aerolínea desde el
portal y después AVIAM desde Contratos, ambas dibujadas en un canvas. El PDF
imprime cada firma y la sección de renovación. Al activarse el contrato (o al
completarse la firma de una renovación de un contrato activo) se envía el PDF
firmado por correo a la aerolínea y a los firmantes de AVIAM.

La renovación automática crea sola la versión siguiente los días de aviso antes
del fin; esa versión vuelve a pasar por Finanzas, la vigencia y las firmas.
Nada se prorroga sin firmas. Fuentes:
[store de documentos](../../database/DevelopmentDB/Elevant.Persistence/Commercial/EfContractDocumentStore.cs),
[reglas de vigencia](../../backend/Elevant.Application/Commercial/ContractValidity.cs) y
[ADR-0025](../../docs/adr/0025-contract-validity-and-drawn-signatures.md).

## Reglas de la fase 2 del ciclo (ADR-0038)

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 2 del ciclo (`50e7778f`). La fase 2 «Pre-operación»
([ADR-0038](../../docs/adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md))
cambió qué versión rige y cómo termina un contrato:

- **Qué versión rige.** Rige una versión `Approved` firmada por ambas partes
  sobre la misma huella, desde su inicio. Una `Superseded` rige en las fechas
  que conservó, y la primera versión aprobada de un contrato que ya salió de
  `Draft` rige como exención heredada. La aprobación de Finanzas ya no
  reemplaza nada: la versión en vigor sigue rigiendo y facturándose hasta la
  segunda firma de la nueva. En esa firma, la anterior pasa a `Superseded` y
  termina, a más tardar, la víspera del nuevo inicio. Los vuelos aún no
  ejecutados pasan a la versión nueva y sus líneas se replanifican sobre las
  tarifas firmadas (se conservan las que mantienen su servicio, se retiran las
  demás y se crean las que faltan, con aviso a la tablet del agente), y
  un servicio ejecutado conserva su tarifa
  ([reglas](../../backend/Elevant.Application/Commercial/ContractVersionGovernance.cs),
  [consultas](../../database/DevelopmentDB/Elevant.Persistence/Commercial/GoverningContractVersions.cs)
  y [reemplazo](../../database/DevelopmentDB/Elevant.Persistence/Commercial/ContractVersionSupersession.cs)).
- **Firmas.** AVIAM solo contrafirma la huella que firmó la aerolínea, y la
  firma y la vigencia no se pisan: corren serializadas. Del lado de la
  aerolínea solo firman sus representantes y firmantes. El contenido firmado
  incluye los recargos congelados y los paquetes. `SignedOn` del contrato es el
  día hábil de su primera activación; cada versión cuenta como firmada el día
  de su segunda firma.
- **Renovar** parte de la versión en vigor, también desde un contrato vencido,
  y copia tarifas, términos, estaciones, recargos negociados, exenciones y
  paquetes. Ni la renovación ni la enmienda se crean mientras otra versión
  aprobada espera las firmas.
- **Retirar una versión.** Contratos retira con motivo una versión aprobada
  que no rige. Pasa a `Rejected`, conserva su aprobación y sus firmas
  unilaterales quedan anuladas solo en la auditoría
  ([retirada](../../database/DevelopmentDB/Elevant.Persistence/Commercial/ContractVersionWithdrawal.cs)).
- **Terminar.** Un contrato activo o suspendido termina en una fecha que
  respete el preaviso firmado, o de inmediato por incumplimiento o mutuo
  acuerdo. `TerminatedOn` es el primer día sin cobertura; con una fecha futura
  el contrato conserva su estado hasta ese día, la terminación se puede
  cancelar y el barrido la ejecuta. Terminar cierra los borradores, retira las
  versiones aprobadas que todavía no rigen, y nada empieza en la fecha de
  terminación o después
  ([ciclo de vida](../../database/DevelopmentDB/Elevant.Persistence/Commercial/EfContractLifecycleStore.cs)).
- **Permiso de operación.** Contratos revoca con motivo un permiso verificado.
  El permiso queda `Revoked` y los contratos activos que se quedan sin un
  permiso usable se suspenden en la misma transacción; verificar un permiso
  nuevo los reanuda
  ([permisos](../../database/DevelopmentDB/Elevant.Persistence/Commercial/EfAirlinePermitStore.cs)).
- **Días.** Vigencias, firmas, permisos, terminaciones y barridos cuentan días
  hábiles de AVIAM (`America/Santo_Domingo`, o la zona de la estación), nunca
  el día UTC.

## Solicitud operativa

```mermaid
flowchart LR
    ACTOR[Cuenta solicitante · FK] --> OREQ[Solicitud operativa]
    AIRLINE[Aerolínea · FK] --> OREQ
    STATION[Estación · FK] --> OREQ
    TURN[Turnaround opcional] --> OREQ
    SERVICE[Servicio canónico opcional] --> OREQ
    OREQ --> RESOLVE[Cuenta resolutora opcional · FK]
    AUTH[Autorización de solicitante y resolutor · pendiente] -.-> OREQ
    SCOPE[Scope y coherencia entre referencias · pendiente] -.-> OREQ
```

Sus estados persistibles son `Submitted`, `InReview`, `Accepted`, `Rejected`, `Completed` y `Cancelled`. El modelo registra cuándo se pidió, cuándo se necesita y cuándo se resolvió, pero sólo impide que `ResolvedAt` sea anterior a `RequestedAt`. Las flechas sólidas del diagrama son referencias persistidas; las punteadas son reglas futuras. Las FKs no garantizan que la cuenta solicitante tenga membresía activa de esa aerolínea, que posea scope de estación, que el turnaround pertenezca a la misma aerolínea y estación, que el servicio sea aplicable ni que la cuenta resolutora tenga permiso. Tampoco exigen `NeededAt >= RequestedAt` ni coherencia entre estado, resolutor, nota y fecha de resolución. En esta rama, `GET /api/v1/airline/portal/requests` filtra por la aerolínea del actor y descarta vínculos de turnaround incoherentes, sin afirmar que los registros históricos cumplan todas las invariantes pendientes. No existe todavía una matriz de transición, una historia específica de cambios ni endpoints que definan quién acepta, completa o cancela.

Las pruebas negativas deben intentar cada combinación fuera de scope o incoherente y comprobar un rechazo fail-closed sin crear ni resolver la solicitud.

## Servicio solicitado, contratado y ejecutado

```text
ServiceDefinition
  ├─ puede aparecer en un ítem de solicitud
  ├─ recibe tarifa dentro de ContractVersion
  └─ es FK obligatoria de una línea OperationService

ContractServiceRate
  └─ puede ser FK opcional de OperationService

OperationService
  └─ conserva unidad/precio/moneda en columnas snapshot
```

La definición de servicio es catálogo; la tarifa pertenece a una versión contractual; la ejecución pertenece a una operación. La FK opcional no garantiza que la tarifa sea la procedencia de los snapshots. Falta validar que precio y moneda sean all-or-none, que una línea contractualmente valorizada enlace una tarifa, que tarifa y línea compartan definición, que contrato y turnaround compartan aerolínea, que la versión esté aprobada, cubra la estación y sea vigente, y que unidad/precio/moneda se copien de forma consistente y permanezcan históricos.

### De la entrega aprobada a la factura

Posterior al commit verificado de esta nota: desde la fase 4 del ciclo (código
de `39a85a46`; [ADR-0035](../../docs/adr/0035-direct-invoicing-simulated-ecf.md) y
[ADR-0040](../../docs/adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md))
Finanzas factura directamente las operaciones aprobadas por OCC desde «Por
facturar» (`GET finance/invoicing/pending-operations` y
`POST finance/invoices/from-operations`). La prefactura es solo el borrador
interno de la emisión, dentro de una sola transacción serializable, y nunca
queda visible ni pendiente; ver [Finanzas](finanzas-tarifas-cargos-y-cobros.md).
Las entidades `Preinvoice` y `PreinvoiceStatus` y sus tablas se conservan.

**Historia (retirado del producto).** Antes de la fase 4:

- Finanzas leía las líneas de las operaciones aprobadas por estación
  («Servicios aprobados»), con las inconsistencias como líneas bloqueadas;
- armaba una prefactura interna no fiscal de una aerolínea, estación y moneda,
  que reservaba cada línea fuente una sola vez, y la publicaba con
  `POST finance/preinvoices/{draftId}/submit`;
- la aerolínea la aceptaba (`POST airline/portal/preinvoices/{preinvoiceId}/accept`)
  o disputaba sus líneas, y Finanzas resolvía la disputa;
- Finanzas emitía desde la prefactura aceptada una factura no fiscal `NF-…` sin
  impuestos con `POST finance/invoices`.

Las rutas de servicios aprobados, prefacturas, aceptación y disputa se
borraron y responden 404; `POST finance/invoices` responde
`410 legacy_finance_route_retired` sin escribir nada. El portal ya no lee
prefacturas: ve sus facturas e-CF simuladas, su estado de cuenta y paga con
tarjeta. No hay reclamos ni disputas en el sistema: una corrección es una nota
de crédito.

## Diferencias con Public Web

El prototipo del portal usa tipos como `SCHEDULE_CHANGE`, `SPECIAL_ASSISTANCE` y `OTHER`, además de una forma de solicitud ligada a vuelo y estados con nombres propios. También representa facturas, conciliaciones, disputas, documentos y notificaciones. Esos tipos orientan futuras conversaciones de producto, pero no son DTO OpenAPI ni amplían las entidades actuales. Posterior al commit verificado: facturas, documentos y notificaciones ya existen con sus propios contratos, y las disputas y la conciliación del prototipo no se implementan, por decisión de producto.

Hasta acordar el contrato:

- no mapear por semejanza de strings;
- no guardar objetos completos del portal como JSON de negocio;
- no tratar `APPROVED` de la interfaz como una transición autorizada del servidor;
- no derivar facturación final únicamente de los snapshots operativos.

## Relacionados

- [Índice de dominio](README.md)
- [Glosario canónico](glosario-canonico.md)
- [Turnaround y operación](turnaround-y-operacion.md)
- [Brechas y preguntas abiertas](brechas-y-preguntas-abiertas.md)

## Fuentes

- [Modelo de base v1](../../docs/architecture/database-v1.md)
- [Enums comerciales](../../backend/Elevant.Domain/Enumerations/WorkforceCommercialEnums.cs)
- [Solicitud operativa](../../backend/Elevant.Domain/Entities/Operations/OperationalServiceRequest.cs)
- [Restricciones comerciales EF](../../database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/WorkforceCommercialConfiguration.cs)
- Tipos del portal, sólo prototipo
