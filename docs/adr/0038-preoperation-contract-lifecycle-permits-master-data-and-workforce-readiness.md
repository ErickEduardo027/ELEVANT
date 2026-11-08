# ADR-0038: Fase 2 «Pre-operación»: ciclo de vida del contrato, permisos, datos maestros y personal listo

## Estado

Accepted — 2026-11-07.

## Contexto

Fase 2 «Pre-operación» del ciclo operativo: desde el contrato que Finanzas aprobó hasta el primer vuelo que OCC puede planificar. Abarca la vigencia y las firmas, el permiso de operación, los datos maestros de la estación, el feed de vuelos, el personal de rampa y los accesos. El 5 de noviembre de 2026 la evaluación del ciclo revisó 45 huecos de esta fase y verificó 44. El hueco 2-E se descartó porque no tenía un escenario real, y ahora un paso E2E lo comprueba. Los más graves:
- Una renovación o una enmienda regía precios en cuanto Finanzas la aprobaba, antes de que nadie la firmara (2-C). La segunda firma de una renovación reescribía `Contract.SignedOn` (2-N05).
- Renovar un contrato suspendido o vencido creaba un borrador que bloqueaba toda renovación posterior (2-N01). La renovación perdía los recargos negociados, las exenciones y los paquetes (2-N03), y el contenido firmado omitía los recargos y paquetes que luego se facturan (2-N04).
- Terminar ignoraba el preaviso firmado, y un contrato terminado conservaba renovaciones vivas (2-N14, 2-N15). Una versión aprobada sin firmar no se podía retirar (2-N10).
- Un permiso JAC verificado no se podía revocar (2-N09). La aerolínea no recibía ningún correo cuando el contrato quedaba listo para firmar, ni por un rechazo, un vencimiento o una suspensión (2-N12, 2-N13).
- Estaciones, terminales, posiciones y tipos de avión solo existían por seed: Production no tendría ni PUJ (2-A). El feed no traía modelo de avión, posición ni charter, y no había un proveedor simulado (2-B).
- La baja, el traslado o una ausencia aprobada no liberaban la cobertura, las operaciones ni los turnos del agente (2-N06, 2-N08).
- La tablet quedaba ligada para siempre a la primera cuenta (2-N02), y cualquier usuario del portal podía firmar el contrato (2-N20).
- Los días de contratos, permisos y Gestión Humana se calculaban en UTC (2-F, 2-N31), y los PDF de Finanzas, Gestión Humana y OCC salían sin tildes (2-D).

Este ADR recoge cómo se cerraron, en cinco bloques: A (`54bd1fa4`, ciclo de vida del contrato), B (`6d0f1127`, documentos, permisos JAC y avisos), C (`efa0c43a`, datos maestros y feed de vuelos), D (`3167695b`, Gestión Humana) y E (`524614b2`, accesos, tablets y usuarios del portal). Describe el código de `50e7778f`, que integra los cinco bloques con Development; las correcciones de la revisión de cada bloque llegan en commits posteriores. Refina [ADR-0015](0015-department-user-governance.md), [ADR-0017](0017-employees-positions-and-access.md), [ADR-0018](0018-finance-commercial-platform-and-fiscal-simulation.md), [ADR-0019](0019-menu-option-permissions-and-department-notifications.md), [ADR-0022](0022-portal-email-verification.md), [ADR-0024](0024-airline-permits-and-contract-lifecycle.md), [ADR-0025](0025-contract-validity-and-drawn-signatures.md), [ADR-0026](0026-ramp-staff-readiness-and-hr-shifts.md), [ADR-0027](0027-occ-ready-contracts-and-stand-locations.md), [ADR-0028](0028-aerodatabox-flight-feed-with-unit-budget.md), [ADR-0030](0030-position-coverage-per-shift-and-combined-stands.md), [ADR-0033](0033-charter-flights-without-contract.md), [ADR-0034](0034-operational-close-occ-to-finance.md) y [ADR-0037](0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md), y sigue la convención de comandos de ADR-0037 (sección 1).

## Decisión

**1. Convenciones comunes.**
- **Comandos.** Siguen el patrón de ADR-0037. Hay dos tablas de recibos, ya existentes:
  - `CommercialCommandReceipts` (tabla `commercial.finance_pricing_commands`) guarda los recibos de los comandos web, también los de Identity, Operations e Integration;
  - los comandos móviles siguen en `integration.mobile_command_receipts`, ligados a la instalación.

  Cada comando corre en una transacción serializable y resuelve el replay antes que la versión. Guarda en la misma transacción el cambio, la auditoría, los avisos, los correos y el recibo, así que un replay nunca los repite.
- **Clave y versión esperada.** Los comandos nuevos exigen `Idempotency-Key` (UUID) y, cuando cambian un recurso que ya existe, la versión esperada. Los que ya existían y ganan la clave la aceptan como opcional mientras queden clientes antiguos (fase expand; lista en «Compatibilidad»). La versión esperada es el token `version` (la `rowversion` en base64) de la lectura, con tres excepciones:
  - los documentos del contrato usan la huella `expectedDocumentSha256`;
  - el ciclo de vida usa `expectedStatus` (ADR-0037);
  - las tablets usan un token opaco de vínculo en OCC, y la liberación desde la app (`POST mobile/device/release`) no lleva versión: su clave se limita a la instalación.
- **Problem Details.** Las fallas de validación, regla, estado, versión e idempotencia llevan `extensions.code` en snake_case y un título en español. Los estados son `400` validación, `403` permiso, `404` inexistente o fuera de alcance, `409` estado, versión o clave, `410` ruta retirada y `422` regla con `reasons`.
  - Varios `403` también llevan código: `forbidden` en los documentos del contrato, los comandos de permisos, las estaciones, los datos maestros, el feed, las tablets y los comandos de gobernanza, y `signer_required` y `representative_required` en el portal. Los de Gestión Humana, la aptitud de las asignaciones, el ciclo de vida y las listas de permisos responden `Forbid()` sin código, como explica ADR-0037.
  - El cliente compartido registra los grupos nuevos en `packages/api-client/src/errors.ts`: `CONTRACT_LIFECYCLE_CODES`, `AIRLINE_PERMIT_CODES`, `STATION_CODES`, `MASTER_DATA_CODES`, `FLIGHT_FEED_CODES`, `PLANNING_CODES`, `HUMAN_RESOURCES_CODES` y `ACCESS_CODES`. También registra las razones nuevas `stand_in_use`, `mentor_absent` y `mentor_permit_required`.
- **Día hábil (2-F, 2-N31).** `BusinessCalendar` (`backend/Elevant.Application/Common/BusinessCalendar.cs`) da el día, su inicio y su fin en la zona IANA de la estación cuando la regla tiene una; si no, en `America/Santo_Domingo`. El día UTC nunca es un día hábil: de 20:00 a 23:59 en República Dominicana ya es mañana en UTC.
  - Lo usan la vigencia, las firmas, la activación, los permisos, los barridos, la línea de tiempo, el bootstrap y el estado del portal, el borrador inicial y la baja de servicios.
  - En Gestión Humana lo usan la fecha de baja, los alcances de empleado y de agente, quitar turnos, carnets, habilitaciones y «¿Puede operar?».
  - Finanzas todavía no lo usa: sigue contando el día UTC (ver «Queda pendiente»).
  - Las webs proponen y limitan las fechas con `businessToday()` (`frontend/private-web/src/services/businessDay.js` y `frontend/public-web/src/lib/business-day.ts`).
- **Fuentes de los PDF (2-D).** `ElevantPdfFonts` (`backend/Elevant.Infrastructure/Finance/ElevantPdfFonts.cs`) incrusta la Noto Sans completa con codificación Unicode (Identity-H) en todos los renderers:
  - los documentos de Finanzas: factura no fiscal, factura e-CF, recibo, recibo de tarjeta y reportes;
  - los reportes de Gestión Humana y de OCC;
  - el contrato y los documentos de operación, que ya usaban esas opciones y no cambian su salida.

  Los PDF ya guardados no se regeneran.
- **Pantallas.** Cada área traduce el `code` con su mapa en español y nunca muestra el título del servidor. Una intención conserva su clave mientras se reintenta el mismo cuerpo (`commandKeys.js` en private-web y `command-key.ts` en public-web), y ante un `409` la pantalla relee. Las pantallas nuevas («Estaciones», «Datos maestros», «Tablets», «Usuarios del portal» y «Recargos y paquetes») separan carga, vacío, error recuperable con «Reintentar» y falta de permiso.

**2. Qué versión rige (2-C, 2-N04, 2-N05, 2-N28).**
- **La regla.** `ContractVersionGovernance` (Application) y `GoverningContractVersions` (Persistence) deciden qué versión rige precios, servicios, estaciones, recargos y paquetes:
  - una versión `Approved` firmada por ambas partes sobre la misma huella, desde su `ValidFrom`;
  - una versión `Superseded`, en las fechas que conservó;
  - como exención heredada, la primera versión aprobada de un contrato que ya salió de `Draft`. Ese contrato se activó antes de que existieran las firmas, o antes de que ambas tuvieran que ser sobre el mismo contenido.

  Una versión que Finanzas aprobó y nadie firmó no cubre nada.
- **La aprobación de Finanzas no reemplaza nada.** La versión en vigor sigue rigiendo, y facturándose, con su fin, hasta que la nueva recibe su segunda firma. La aprobación ya no marca `Superseded` ni recorta la versión anterior.
- **La segunda firma reemplaza** (`ContractVersionSupersession`):
  - las versiones aprobadas que empiezan antes pasan a `Superseded` con `ValidTo = mín(fin, inicio nuevo − 1)`, con auditoría `commercial.contract.version_superseded`;
  - los vuelos que esas versiones cubrían dentro de las fechas y estaciones de la nueva, `Scheduled` o `Confirmed` y con sus operaciones sin empezar, pasan a la versión firmada aunque sus líneas planificadas no coincidan posición por posición con las tarifas firmadas. Sus líneas se replanifican sobre esas tarifas en el orden en que OCC las materializa: se conservan las que mantienen su servicio, se retiran las demás con su evento y se crean las que faltan, con auditoría `occ.operation.services_replanned` y aviso a la tablet del agente asignado (corrección de la revisión del bloque A);
  - un servicio ya ejecutado conserva la tarifa con la que se capturó;
  - OCC relee la planificación de esas estaciones (`occ_planning`).
- **Quién lee la regla.** `ApplicableContracts` (Planificación, vuelos manuales, feed de vuelos y asignación de agentes), el barrido de vencimientos y avisos, la activación, la reactivación, la renovación, la enmienda y las estaciones del bootstrap del portal. También `FinancePackageValuation`, que toma la segunda firma como frontera; para una versión heredada sin firmas, su aprobación.
- **Firma y vigencia sin carreras (2-N28).**
  - `SignAsync` y `SetValidityAsync` corren en transacciones serializables, y cada firma toca la `rowversion` de la versión. Quien pierde la carrera recibe `409 content_changed`, o `contract_terminated` si el contrato terminó entretanto.
  - La vigencia solo se fija en una versión aprobada que nadie firmó (`already_signed`).
  - AVIAM solo contrafirma la huella que firmó la aerolínea; si no coincide, responde `airline_signed_other_content`, y la salida es retirar la versión.
  - `PUT contract-versions/{id}/validity` acepta ahora una `Idempotency-Key` opcional (acción `contract.version.confirm_validity`) y conserva la huella como token.
  - La vigencia de una renovación o una enmienda debe empezar después de la versión a la que sigue (`valid_from_not_after_current`).
- **Contenido firmado con recargos y paquetes (2-N04).**
  - La aprobación de Finanzas fija `PricingPolicyVersion = 2`. Confirmar la vigencia sube a 2 una versión sin firmas que ya tenía la política congelada; las anteriores a esa política conservan su semántica.
  - Con la política 2, los recargos que Finanzas congeló y los paquetes vinculados entran en la huella como sección opcional, y el PDF los imprime en las secciones 3.1 y 3.2. Las huellas ya firmadas no cambian.
  - `GET contract-versions/{id}/pricing-terms`, para los mismos lectores que el documento, devuelve los recargos y paquetes que aplican a la versión, con `inDocument` y `signed`. El portal los muestra en «Recargos y paquetes».
- **Fecha de firma (2-N05).** `Contract.SignedOn` se fija una sola vez, con el día hábil de la primera activación; una renovación nunca lo mueve. El `signedOn` del documento y del PDF es el día hábil de la segunda firma de esa versión. La primera versión heredada sin firmas conserva la fecha del contrato.

**3. Renovación, enmienda, retirada y terminación (2-N01, 2-N03, 2-N10, 2-N14, 2-N15, 2-N27).**
- **Renovar** (`Renew` en `POST contract-versions/{id}/lifecycle`).
  - Se admite desde `Active`, `Suspended` y `Expired`.
  - Copia la versión en vigor (`ContractVersionCopy`): tarifas, términos, estaciones, recargos negociados y exenciones, y paquetes. No copia lo que Finanzas solo heredó de la tarifa base ni los recargos de definiciones retiradas.
  - Un paquete que ya no cabe en las fechas nuevas se copia igual, y el borrador lo marca con `package_not_eligible`.
  - Se rechaza con `termination_scheduled`, `draft_in_progress`, `version_awaiting_signatures` (una versión aprobada espera las firmas), `no_approved_version` o `renewal_dates_invalid`.
  - Un contrato vencido que renueva vuelve a `Active` cuando su renovación pasa por Finanzas, la vigencia y ambas firmas, y la aerolínea tiene un permiso de operación usable.
- **Enmendar** (`POST contracts/versions/{versionId}/amendments`). Parte ahora de la versión que rige, nunca de una que nadie firmó. Se rechaza con `version_awaiting_signatures` mientras otra versión aprobada espere sus firmas, y con `contract_terminated` o `termination_scheduled`.
- **Retirar una versión (2-N10).** `POST contract-versions/{id}/withdrawal` es nuevo:
  - lo usa Contratos con `contracts.agreements.lifecycle`, la `Idempotency-Key` obligatoria y un cuerpo con `reason` (5 a 500 caracteres) y `expectedDocumentSha256`; la acción del recibo es `contract.version.withdraw`;
  - solo retira una versión `Approved` que no rige: `not_approved`, `version_signed` (ya rige) o `content_changed` (la huella cambió);
  - la versión pasa a `Rejected` y conserva `ApprovedAt`. Una firma unilateral se anula en la auditoría (`commercial.contract.signature_voided`) y nunca se borra. `RenewalStartedAt` de la versión renovada no se reinicia;
  - una fila heredada que una aprobación antigua recortó recupera el fin que aceptaron sus dos firmas: la única fecha que reproduce su huella (`commercial.contract.version_end_restored`);
  - si el contrato nunca se activó y no le queda nada vivo, el mismo contenido vuelve como un borrador nuevo (`draftVersionId`);
  - Contratos recibe `contract_version_withdrawn`, y el detalle del contrato ofrece «Retirar versión».
- **Terminar con preaviso (2-N14).** `Terminate` acepta `effectiveOn` e `immediateCause`.
  - En `Active` y `Suspended` exige una fecha efectiva de al menos hoy más los `TerminationNoticeDays` de la versión en vigor (`termination_date_required`, `termination_notice_not_met`). La otra vía es una causa inmediata, `Breach` o `MutualAgreement` (`immediate_cause_invalid`), cuyo motivo es la nota; la historia nombra la causa.
  - En `Draft` («Descartar contrato») y en `Expired` la terminación es inmediata.
  - `TerminatedOn` es el primer día sin cobertura. Con una fecha futura, el contrato conserva su estado hasta esa fecha (auditoría `commercial.contract.termination_scheduled` y aviso `contract_termination_scheduled`). El barrido lo termina ese día (`contract_terminated`).
  - `CancelTermination` retira una terminación programada antes de su fecha (`termination_not_scheduled`, `contract_terminated`; aviso `contract_termination_cancelled`).
  - Una causa inmediata puede adelantar una terminación ya programada. Otra fecha exige cancelarla primero (`termination_scheduled`).
  - La línea de tiempo expone `terminatesOn` y `earliestTerminationOn`, y la pantalla ofrece la fecha mínima.
- **Lo que cierra una terminación (2-N15).** En la misma transacción, también cuando la ejecuta el barrido como sistema:
  - los borradores y las versiones pendientes de Finanzas pasan a `Rejected`;
  - las versiones aprobadas que todavía no rigen se retiran.

  Sobre un contrato terminado, o sobre una versión que empieza en la fecha de terminación o después, responden `contract_terminated` o `termination_scheduled`: la aprobación de Finanzas (solo aprobar; devolver sigue siendo posible), la vigencia, la firma, la enmienda y el envío del borrador a Finanzas.
- **Renovación automática bloqueada (2-N27).** Una renovación automática que no puede iniciarse no se marca como iniciada: el barrido la reintenta en cada pasada. Contratos recibe `contract_renewal_blocked` como máximo una vez por contrato y por día hábil. Solo una versión posterior que ya rige marca la renovación como iniciada.

**4. Permisos JAC, avisos y estado de la aerolínea (2-N09, 2-N12, 2-N13, 2-N26, 2-N29, 2-N30, 2-N32, 2-N35, 2-N37).**
- **Envío** (`POST airline/permits`).
  - Acepta una `Idempotency-Key` opcional (acción `commercial.permit.submit`): un reintento con la misma clave y el mismo cuerpo devuelve el mismo permiso.
  - Solo lo envía un representante o un firmante de la aerolínea (`signer_required`, sección 8).
  - Un documento subido hace más de seis días, la ventana de la limpieza de medios (`CommercialMediaLinkPolicy.LinkCutoff`), responde `document_expired` y se sube de nuevo. Uno que no es una subida de la cuenta responde `document_invalid`.
- **Revisión** (`POST contracts/permits/{id}/review`). Acepta la clave opcional. Solo revisa permisos `Submitted` (`review_closed`) y sigue exigiendo la versión esperada. La respuesta incluye los contratos que la verificación activó o reanudó, también en un replay.
- **Revocación.** `POST contracts/permits/{id}/revocation` es nuevo:
  - usa el permiso existente `contracts.permits.verify`, la clave obligatoria, `reason` (5 a 500 caracteres) y `expectedVersion`;
  - solo revoca un permiso `Verified` (`permit_not_verified`);
  - el permiso pasa al estado nuevo `Revoked` y conserva su verificación original. El motivo va a la auditoría (`commercial.permit.revoked`);
  - en la misma transacción se suspenden, con un evento del sistema, los contratos `Active` que se quedan sin un permiso de operación usable. Verificar un permiso nuevo los reanuda;
  - el barrido cuenta un permiso `Revoked` como un permiso que la aerolínea tuvo.
- **Correos a la aerolínea.** Hay seis `EmailPurpose` nuevos:

  | Propósito | Cuándo |
  |---|---|
  | `ContractReadyToSign` | Contratos fija la vigencia, no cuando Finanzas aprueba |
  | `PermitRejected` | Contratos rechaza un permiso, con su nota |
  | `PermitRevoked` | Contratos revoca un permiso, con su motivo y los contratos suspendidos |
  | `PermitExpiring` | Un permiso verificado vence en 30 días o menos |
  | `ContractExpiring` | El contrato vence dentro de los `RenewalNoticeDays` que firmó su versión, o 30 si no tiene |
  | `ContractSuspended` | Suspensión manual (sin el motivo interno), por permiso vencido o por revocación |

  - Van a todas las cuentas activas del portal de la aerolínea que tienen correo, y se encolan en la transacción del comando o del barrido.
  - El aviso de vencimiento solo se reinicia cuando cambia el fin de la cobertura: en la segunda firma, o al fijar la vigencia de una versión que ya rige. No sale si una terminación programada llega antes.
  - El correo `ContractActivated` dice «entra en vigor el …» cuando la vigencia empieza más adelante (2-N30).
  - La bandeja del superadministrador refiere estos correos a la cuenta del portal.
- **Estado de la aerolínea (2-N32, 2-N35).** `GET airline/portal/standing` es nuevo, con el tenant resuelto en el servidor. Devuelve:
  - `status`: `Active`, `Pending`, `Suspended`, `Expired`, `Terminated` o `None`;
  - `readOnly`, cuando ningún contrato cubre una estación hoy, mientras el historial, las facturas y los pagos siguen disponibles;
  - las estaciones de sus contratos aprobados, con `current` en las que están en vigor;
  - cada contrato con `pendingReason` (`signatures` u `operating_permit`) y las versiones que esperan las firmas.

  El bootstrap no cambia. El portal muestra «Pendiente de firmas» o «Pendiente de permiso de operación», nunca «Borrador», y conserva las estaciones históricas en Inicio, Perfil y el filtro de tesorería.
- **Etiquetas (2-N26, 2-N29, 2-N30).**
  - Los estados del contrato salen de mapas compartidos: `contractStatus.js` en private-web y `contract-status.ts` en public-web. Los de la operación, de `operation-status.ts`.
  - Las notificaciones `contract_validity` y `contract_renewal_started` ganan título y destino. Los títulos de `contract_suspended` y `contract_expiring` dejan de prometer una causa o un plazo fijos.
  - La pantalla de permisos arma su aviso con los contratos que devuelve el servidor.
  - El diálogo del feed traduce el motivo de pausa del proveedor (sección 6).

**5. Estaciones y datos maestros (2-A, 2-N34).**
- **Estaciones**, solo para el superadministrador: `GET governance/stations`, `POST governance/stations` y `PUT governance/stations/{id}`, con la clave obligatoria y, en el `PUT`, la versión esperada.
  - El código es el IATA del aeropuerto. Un aeropuerto conocido se reutiliza; uno nuevo pide ICAO, nombre, ciudad y país.
  - El código no cambia. La zona horaria solo cambia mientras la estación no tiene historia (`time_zone_locked`), y una estación en uso no se desactiva (`station_in_use`).
  - Superadministración tiene la sección «Estaciones».
- **Datos maestros de OCC**: `GET occ/master-data?stationId`, y `POST` y `PUT` en `occ/terminals`, `occ/stands` y `occ/aircraft-types`.
  - Usan el módulo nuevo `operations.master_data` (`read`, `create` y `update`), que el administrador de OCC hereda.
  - Exigen la clave y, en el `PUT`, la versión esperada.
  - Un código usado no cambia (`terminal_code_locked`, `stand_code_locked`). Nada en uso se desactiva (`terminal_in_use`, `stand_in_use`, `aircraft_type_in_use`), tampoco por el `PUT occ/stands/{id}/attributes` anterior, que responde `422` con la razón `stand_in_use`. Una posición necesita una terminal activa (`terminal_inactive`).
  - Cada cambio se audita con sus campos y se anuncia por `occ_planning`; nada se borra.
  - OCC tiene la pantalla «Datos maestros» (`/admin-occ/master-data`).
- **Vuelo manual.** Acepta un `aircraftTypeId` opcional (`aircraft_type_unavailable`). Con él, un avión ancho en una posición limitada a estrecho responde `stand_unavailable`. Las reglas de posiciones combinadas siguen aplicándose al asignar en el mapa, como antes.
- **Mapa de posiciones (2-N34).** En vivo, el resumen y la leyenda cuentan también «Planificada» y «Sin ocupación verificada», así que las filas suman el total.

**6. Feed de vuelos (2-B, 2-N16, 2-N29, 2-N36).**
- **Ingesta.** Guarda los tramos de todas las aerolíneas activas registradas, sin coste extra, porque vienen en la misma respuesta. La cadencia y el conteo `ContractedLegs` siguen contando solo las contratadas. Solo las respuestas de AeroDataBox alimentan el registro observado de aerolíneas (ADR-0028).
- **Vistas** (`GET occ/flight-feed?view=`):
  - `Contracted`, la vista por defecto: aerolíneas con contrato en vigor ese día;
  - `Charter`: aerolíneas activas registradas sin un contrato en vigor ese día en la estación, candidatas a charter (ADR-0033);
  - `Dismissed`: las propuestas descartadas de esa fecha, que se restauran mientras su vuelo no haya pasado.

  Las aerolíneas con contrato `Suspended` o `Expired` en la estación, y sin otro en vigor, no aparecen en ninguna vista, y su importación responde `contract_not_in_force` (2-N16). La propuesta expone `version` y `suggestedAircraftTypeId`, que `AircraftModelMatcher` sugiere a partir del modelo del proveedor.
- **Importar** (`POST occ/flight-feed/turnarounds`). Acepta, todos opcionales:
  - el tipo de avión;
  - la posición, con las mismas reglas del mapa (`stand_unavailable` con `reasons`);
  - el modo charter sin contrato (`charter_required`, `charter_has_contract`), que crea el acuerdo charter con el prepago `Pending`.

  Acepta una `Idempotency-Key` opcional (fase expand); con ella exige las versiones de ambas propuestas.
- **Restaurar (2-N36).** `POST occ/flight-feed/proposals/{id}/restore`, con clave y `expectedVersion`, devuelve una propuesta descartada a `Proposed` mientras su vuelo no haya pasado. Si no, responde `flight_proposal_passed`, `flight_proposal_not_dismissed`, `version_conflict` o `contract_not_in_force`. El descarte y la restauración se auditan (`occ.flight_proposal.dismissed` y `occ.flight_proposal.restored`).
- **Mensajes.** Todo fallo del feed lleva código y título en español. El diálogo traduce el motivo de pausa (`quota_exceeded`, `unauthorized`, `rate_limited`, `failed_<estado>`) sin cambiar el servidor.
- **Proveedor simulado (2-B).** `SimulatedAirportFlightFeed` (Infrastructure) permite ejercitar el ciclo sin gastar unidades de AeroDataBox.
  - Se activa con `SimulatedFlightFeed:Enabled=true` (`SimulatedFlightFeed__Enabled`) y está apagado por defecto.
  - La API se niega a arrancar si se activa fuera de los entornos `Development` o `Test`, o con AeroDataBox activo a la vez.
  - Es determinista: en la zona horaria de la estación, arma un horario de las aerolíneas activas registradas (hasta 20), con modelos de avión, terminal y puerta.
  - Usa su propio nombre de proveedor, `Simulated`, así que su registro de uso, su candado y su presupuesto no se mezclan con AeroDataBox. Cuenta 2 unidades por llamada, como FIDS. Sus propuestas, y las escalas que OCC importa de ellas, guardan `Simulated` como proveedor externo.
  - No usa la red ni alimenta el registro de aerolíneas.
  - Solo lo activa el overlay del arnés E2E, `database/DevelopmentDB/compose.local.e2e.yml`, con `ELEVANT_E2E_SIMULATED_FLIGHT_FEED`, verdadero por defecto; con `false`, el overlay no lo activa.
  - La plantilla del VPS Development (`backend/compose.development.api.yml`) no lo define: allí el feed sigue siendo AeroDataBox, configurado con `ELEVANT_AERODATABOX_*`.

**7. Gestión Humana: liberar al agente, ausencias, turnos y documentos (2-N06, 2-N08, 2-N11, 2-N22, 2-N23, 2-N24, 2-N25, 2-N31).**
- **Una sola ruta de liberación.** `RampAgentRelease` corre dentro de la transacción del comando que la provoca:
  - `EndRampDutyAsync`: la baja, el traslado fuera de rampa, el paso a un puesto de oficina y la desactivación del perfil de rampa;
  - `ReleaseAbsenceAsync`: la aprobación de un día libre o una restricción, en la ventana local de la ausencia, incluido el turno nocturno del último día.

  Libera las coberturas abiertas del agente, como titular o como mentor, y las asignaciones de las operaciones que no empezó. Una operación asignada que se queda sin agentes vuelve a `Planned` con su evento de estado. También quita los turnos que no empezaron. Todo se audita como `hr.agent_release.*`.
  - OCC recibe `agent_released` por operación, solo `ADMIN_OCC`, y `occ_planning`. La tablet del agente recibe `assignment_released`.
  - Si hay una operación `InProgress` o `Returned` en la ventana, responde `409 agent_has_operation_in_progress` y no cambia nada.
  - La baja y el traslado aceptan una `Idempotency-Key` opcional.
  - Como defensa para datos heredados, el seguimiento de la posición y el solapamiento de coberturas ignoran a los agentes inactivos.
- **Ausencias (2-N08, 2-N22).**
  - Aprobar un día libre o una restricción ya no se rechaza por las asignaciones: las libera. La resolución (`POST human-resources/availability-requests/{id}/resolution`) acepta la clave y `expectedVersion` como opcionales (una clave exige la versión) y responde `404 not_found`.
  - `POST human-resources/availability-requests/{id}/amendment` es nuevo, con la clave, `expectedVersion` y un motivo de 5 a 1000 caracteres. `Cancel` anula una ausencia aprobada que no empezó (`absence_started`). `Shorten` fija un último día anterior al actual, no anterior a su inicio ni a ayer (`absence_end_invalid`). Una ausencia que ya terminó responde `absence_ended`, y una no aprobada, `absence_not_approved`.
  - Se audita como `hr.availability.approval_cancelled` o `hr.availability.shortened`. Lo que la aprobación liberó no vuelve, y OCC relee por `occ_planning`.
  - Gestión Humana tiene «Cancelar ausencia» y «Acortar ausencia».
- **Turnos (2-N11, 2-N24).**
  - `DELETE human-resources/shifts/{id}` acepta `?version=` y una clave opcional (una clave exige la versión), en una transacción serializable con el recibo `hr.shift.remove`.
  - Responde `shift_in_past` según el día de la estación, y `shift_in_use` si el agente tiene en la ventana del turno una cobertura (como titular o mentor) o una operación asignada no cancelada.
  - Registrar un turno sobre una ausencia aprobada responde `shift_on_approved_absence`.
  - La lista de turnos expone `version`. «Copiar semana anterior» omite las ausencias y a los agentes que ya salieron, y cuenta cada causa.
- **Mentor (2-N23).** La cobertura comprueba la ausencia aprobada y el carnet vigente del mentor (razones `mentor_absent` y `mentor_permit_required`).
- **¿Quién está apto? (2-N24, 2-N25).**
  - `GET human-resources/schedule-warnings?includeReadiness=true` suma los avisos `ApprovedAbsence` y `DocumentExpired`; sin el parámetro, la respuesta no cambia.
  - `GET occ/planning/assignment-readiness?stationId&date` es nuevo. Exige `operations.planning.read` y la estación en alcance. Es una proyección que marca `agent_inactive`, `approved_absence`, `airport_id_not_current` o `ramp_driver_license_not_current`, y no libera nada. El tablero de OCC muestra «Agente no apto».
- **Vencimientos de documentos (2-N25).** `HumanResourcesDocumentWorker` corre cada hora y no envía correo:
  - Gestión Humana recibe `agent_document_expiring` o `agent_qualification_expiring` una vez por ciclo de cada documento, `HumanResources:DocumentExpiryNoticeDays` días antes (30 por defecto en `appsettings.json`, de 1 a 365);
  - OCC recibe `agent_document_not_current` una vez por asignación afectada cuando un documento vence o se corrige;
  - nada se libera automáticamente: OCC decide.

**8. Accesos: tablets, usuarios del portal y gobernanza (2-N02, 2-N07, 2-N17, 2-N18, 2-N19, 2-N20, 2-N21, 2-N33, 2-N38, 2-N39).**
- **Tablets compartidas (2-N02).**
  - El registro (`PUT mobile/device`) pasa la tablet al agente que inicia sesión, y cierra y audita el vínculo anterior (`mobile_device.binding_taken_over`). Si quien la tiene trabaja una operación `InProgress`, responde `409 device_in_use_by_active_agent`. Una tablet revocada responde `device_revoked`. La respuesta de éxito no cambia.
  - `POST mobile/device/release` es nuevo. Su clave se limita a la instalación (`integration.mobile_command_receipts`), y solo libera quien tiene la tablet (`device_not_bound`). La app lo llama al cerrar sesión, con un tiempo límite: sin conexión, la sesión se cierra igual.
  - OCC tiene `GET occ/devices?stationId`, `POST occ/devices/{id}/unbinding` y `POST occ/devices/{id}/revocation`, con el módulo nuevo `operations.devices` (`read`, `unbind`, `revoke`). Los comandos llevan la clave y el token de vínculo como versión esperada. Revocar rota el sello de seguridad de la cuenta, así que también cierra sus sesiones.
  - `EndRampDutyAsync` cierra las tablets del agente que deja la rampa.
  - OCC relee las tablets por el recurso de cambios `mobile_devices` y tiene la pantalla «Tablets» (`/admin-occ/devices`).
- **Representantes y firmantes del portal (2-N20).**
  - Los roles viven en `iam.account_permission_grants` (`airline_portal.representative` y `airline_portal.signer`), fuera del catálogo de departamentos.
  - El representante es la cuenta aprovisionada para la solicitud aprobada de la aerolínea, de forma implícita hasta la primera designación, o quien designe el superadministrador. Después de una designación, solo cuentan las designaciones.
  - Solo los representantes y los firmantes firman contratos y envían el permiso JAC (`403 signer_required`).
  - La aerolínea gestiona sus usuarios con `GET` y `POST airline/portal/users`, y `POST airline/portal/users/{userId}/status` y `/signer`, con la clave y, para un usuario existente, su versión. Todos sus usuarios leen la lista. El representante invita por correo, desactiva, reactiva y marca firmantes (si no es representante: `representative_required`). Nunca se modifica a sí mismo ni a otro representante (`portal_user_protected`).
  - El superadministrador designa con `POST governance/clients/{organizationId}/users/{id}/portal-role` (clave y versión), y nunca puede quitar el rol al último representante activo (`last_representative`).
  - Cada cambio encola el correo nuevo `PortalUserChanged` a los demás representantes.
  - El portal tiene «Usuarios del portal» en «Perfil». La firma del contrato y el envío de permisos le dicen a quien no firma a quién pedírselo.
- **Traslados y solicitudes de acceso (2-N07, 2-N17, 2-N18, 2-N33).**
  - El traslado retira con auditoría los roles del departamento de origen y deja inerte su asignación. Cambiar el estado del empleado o editarlo desde ese departamento responde `409 employee_transferred`. Solo la solicitud del nuevo departamento, validada por Gestión Humana, le devuelve el acceso, con la misma cuenta.
  - El traslado y la baja, que suspenden el acceso de la cuenta, cancelan con auditoría las solicitudes pendientes que esa cuenta había pedido. Validar una solicitud cuyo solicitante ya no está activo o ya no administra el departamento responde `requester_no_longer_administrator`.
  - La limpieza de medios conserva la foto de una solicitud pendiente. La leen quien valida, el superadministrador y quien la pidió, y si al aprobar ya no existe, la cuenta se emite sin foto.
  - Gestión Humana recibe el aviso `access_request` en el flujo por empleado.
- **Edición de miembros (2-N19, 2-N21).** Un miembro con un rol heredado `CUSTOM_*` conserva su acceso y, al editarlo, pasa a `CONTRATOS`. Sus estaciones deben salir del expediente del empleado (`stations_outside_employee`), también para el superadministrador.
- **Gobernanza heredada (2-N38).** `POST` y `PUT` en `governance/roles` y en `governance/users` responden `410 legacy_governance_retired` sin leer el cuerpo. Con eso, una solicitud móvil heredada (`ramp-mobile-access-requests`) ya solo se puede rechazar. Las rutas heredadas que siguen vivas (los `DELETE` y el restablecimiento de contraseña) responden con código y título en español.
- **Idempotencia de la gobernanza (2-N39).** Aceptan una `Idempotency-Key` opcional: el alta de administradores y de usuarios internos, la edición y el estado de los usuarios del departamento, las plantillas (crear, editar y desactivar), los usuarios del portal en Clientes y su estado, y la conversión de roles heredados, que con clave exige la versión del rol. El hash excluye la contraseña temporal, que se comprueba aparte en un replay.

**9. Arnés E2E del ciclo completo.**
- En `frontend/public-web/tests/e2e-cycle/fase2-preoperacion.spec.ts`, los pasos `hueco …` de la fase son pruebas reales, sin `test.fixme`: 2-A, 2-B, 2-C, 2-D, 2-E, 2-F, 2-N20, y 2-N38 con 2-N02.
- El 7 de noviembre de 2026 la corrida de las fases 1 y 2 contra el stack local reconstruido con la rama completa (bloques, correcciones de revisión e integración con Development) pasó entera: 32 de 32 pasos, 14 de la fase 1 y 18 de la fase 2, incluidos 2-N20 y 2-N38 con 2-N02.
- El arnés solo corre entre las 08:30 y las 22:30 de la hora local, porque la plantilla de turno del agente tiene que cubrir el vuelo de la corrida.
- El paso 2-B se salta si el feed de la API no es el proveedor simulado, para no gastar nunca unidades de AeroDataBox. Importa una llegada con tipo de avión y posición, descarta y restaura otra, e importa un charter. Si no hay ninguna aerolínea activa sin contrato, comprueba el estado vacío de «Charter sin contrato» y lo anota.
- El overlay `compose.local.e2e.yml` suma el feed simulado. Ningún workflow de CI ejecuta el arnés, y una corrida local no prueba un despliegue (ADR-0037).

### Migración

Ninguna. `dotnet ef migrations has-pending-model-changes` no reporta cambios:
- los estados nuevos se guardan como texto en columnas que ya existían: `Revoked` del permiso cabe en la columna de revisión (hasta 16), y los siete propósitos de correo nuevos (`ContractReadyToSign`, el más largo, tiene 19 caracteres) caben en la de propósito (hasta 24);
- la retirada reutiliza `Rejected` y `ApprovedAt`; la terminación programada, `TerminatedOn`, y la política firmada, la columna `PricingPolicyVersion`;
- las tablets usan `revoked_at` y `unbound_at`, que ya existían;
- los representantes y firmantes son filas de `iam.account_permission_grants`, sin FK sobre el código;
- los permisos nuevos viven en `DepartmentPermissionCatalog`, y los recibos, en las tablas de recibos ya existentes.

Ningún bloque toca el seed ni `verify-development.sql`. Las únicas claves de configuración nuevas son `HumanResources:DocumentExpiryNoticeDays` (30 en `appsettings.json`) y `SimulatedFlightFeed:Enabled` (apagada salvo en el overlay del arnés).

### Compatibilidad y orden de despliegue

- **La API, private-web y public-web salen juntas.**
  - El portal desplegado valida los permisos con una lista fija de estados: en cuanto se revoque el primer permiso, deja de poder listarlos.
  - Los validadores estrictos de la versión anterior del cliente compartido rechazarían respuestas que crecieron y que solo leen las webs: la propuesta del feed (`version`, `suggestedAircraftTypeId`), las opciones del vuelo manual (`aircraftTypes`) y la lista de turnos (`version`). La línea de tiempo también ganó `terminatesOn` y `earliestTerminationOn`, y su validador pasó a ser estricto en este cambio.
- **El APK desplegado sigue funcionando.** Ninguna respuesta que lee gana claves. No libera la tablet al cerrar sesión, pero el siguiente agente que inicia sesión la toma igual. El APK nuevo, que la libera y explica los códigos de la tablet, puede salir después.
- **Database Release no cambia**: no hay migración ni cambios del seed.
- **Fase expand.** Aceptan todavía llamadas sin `Idempotency-Key`:
  - la vigencia, que ya exigía la huella;
  - el envío del permiso, que crea el permiso y no tiene versión;
  - la revisión del permiso, que ya exigía la versión;
  - la importación del feed, que con clave exige las versiones de ambas propuestas;
  - la resolución de solicitudes de disponibilidad y quitar un turno, donde una clave exige la versión;
  - la baja y el traslado de empleados;
  - los comandos de gobernanza de la sección 8.

  Los comandos nuevos de la fase la exigen.
- **Configuración del VPS.** No hace falta ningún cambio: `HumanResources:DocumentExpiryNoticeDays` vale 30 por defecto, y ni `backend/compose.development.api.yml` ni las plantillas de `ops/dokploy` lo definen. Tampoco definen el proveedor simulado.
- **Datos heredados que ninguna migración arregla:**
  - Algunas versiones quedaron `Superseded` y recortadas por aprobaciones antiguas frente a renovaciones sin firmar. Retirar esa renovación restaura el fin solo si la versión anterior está firmada por ambas partes. Los contratos cuyo `SignedOn` reescribió una contrafirma anterior conservan esa fecha posterior, y los días anteriores a ella siguen sin cobertura.
  - Los agentes dados de baja antes de este cambio pueden conservar coberturas, asignaciones o turnos abiertos. El seguimiento de la posición y el solapamiento ya los ignoran, y el editor semanal muestra sus turnos para quitarlos; el tablero de coberturas los sigue mostrando para que OCC los libere a mano.
  - Una aerolínea cuyas cuentas del portal creó solo el superadministrador, sin aprovisionamiento, no tiene representante hasta que el superadministrador designe uno. Mientras tanto, sus usuarios no pueden firmar contratos ni enviar permisos (`signer_required`).

## Consecuencias

- Nada cambia de precio sin firmas: la versión en vigor sigue rigiendo y facturándose hasta que ambas partes firman la siguiente, y un servicio ya ejecutado conserva su tarifa.
- Un contrato termina en la fecha que permite su preaviso, o antes por una causa explícita, y no deja renovaciones vivas.
- La aerolínea se entera por correo de lo que tiene que hacer o de lo que cambió en su contrato y sus permisos, y el portal le dice qué espera cada contrato.
- Una base sin seed puede tener estaciones, terminales, posiciones y tipos de avión; nada en uso se desactiva y nada se borra.
- El ciclo se recorre en local con un feed simulado, sin gastar la cuota de AeroDataBox.
- Un agente que sale de la rampa, o que se ausenta, deja de recibir trabajo, y OCC se entera de lo que tiene que reasignar.
- Las tablets pasan entre agentes, y OCC libera o revoca una perdida.
- Durante la fase expand conviven dos formas de llamar a los comandos que ya existían.

**Queda pendiente**
- **Paso «contract».** Continúa el de ADR-0037. Cuando no queden clientes antiguos, hará obligatoria la `Idempotency-Key` en los comandos de la lista «Fase expand», y la versión esperada donde hoy acompaña a la clave (la resolución de disponibilidad y quitar un turno).
- **PDF de una renovación de un contrato suspendido.** Su renovación firmada no encola el PDF firmado: solo lo hacen los contratos activos o recién activados.
- **Contratos → Contratos.** El listado muestra como «Aprobada» una versión aprobada que espera las firmas; el portal ya la marca «Pendiente de firmas».
- **Bandeja de correos.** Los seis correos nuevos a la aerolínea aparecen referidos a la cuenta del portal, no al contrato ni al permiso. Referirlos al documento exige cambiar el worker de envío, que hoy trata cualquier referencia como un adjunto.
- **Facturas y recibos anteriores** a `ElevantPdfFonts` siguen sin tildes: son instantáneas inmutables con hash, y regenerarlos necesita una decisión explícita.
- **Horas y unidades.** El portal sigue mostrando en UTC las horas reales y de aprobación, y las pantallas bilingües de OCC muestran el código de la unidad (ADR-0037). *Cerrado el 8 de noviembre de 2026: el portal muestra esas horas y las firmas en la hora local de la estación, y Revisión y Planificación muestran la unidad con su nombre ([ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).*
- **Día UTC en Finanzas.** Finanzas no usa el día hábil: la emisión y el vencimiento de las facturas, las fechas de sus PDF, los reportes, la tesorería, las cuentas por pagar, la conciliación y la validación de la tarjeta siguen contando el día UTC. Es el hueco 4-N10 de la fase 4.
- **Suspensión por revocación.** Se registra como evento del sistema, para poder reanudarla al verificar otro permiso; en la línea de tiempo aparece como «Sistema», y quién revocó se ve en la entrada del permiso.
- **Versiones del feed.** Cada lectura del feed renueva la `rowversion` de las propuestas, porque actualiza `LastSeenAt`. Una importación con la versión vieja responde `version_conflict` y la pantalla relee.
- **Reglas del vuelo manual.** Solo aplica la regla de tamaño; unificarlo con las reglas de posiciones combinadas cambiaría un comportamiento existente y requiere una decisión de producto.
- **Avisos duplicados.** Desactivar un perfil de rampa con trabajo deja dos avisos `occ_planning` idénticos en la misma transacción. Es inofensivo.
- **Clientes de Gestión Humana.** Empleados y perfiles de rampa siguen llamando a la API por `commercialApi`, no por el cliente compartido.
- **Restablecimiento de contraseña de los usuarios internos.** Sigue fallando sin proveedores de tokens de Identity (ADR-0037).

## Trazabilidad de huecos

El código y las pruebas citan estos identificadores.

| Hueco | Qué faltaba | Sección |
|---|---|---|
| 2-A | Estaciones, terminales, posiciones y tipos de avión fuera del seed | 5 |
| 2-B | Modelo de avión, posición, charter y proveedor simulado en el feed | 5 y 6 |
| 2-C | Una renovación o enmienda regía precios al aprobarla Finanzas, antes de firmarse | 2 |
| 2-D | PDF de Finanzas, Gestión Humana y OCC sin tildes | 1 |
| 2-E | Descartado: OCC y Gestión Humana ya mostraban el usuario de la sesión; el paso E2E lo comprueba | 9 |
| 2-F | Días de contratos, permisos y vencimientos en UTC | 1 |
| 2-N01 | Renovar un contrato suspendido o vencido bloqueaba las renovaciones siguientes | 3 |
| 2-N02 | Tablet ligada para siempre a la primera cuenta | 8 |
| 2-N03 | La renovación perdía recargos negociados, exenciones y paquetes | 3 |
| 2-N04 | El contenido firmado omitía recargos y paquetes | 2 |
| 2-N05 | La segunda firma de una renovación reescribía `SignedOn` | 2 |
| 2-N06 | Baja o traslado sin liberar coberturas, operaciones ni turnos | 7 |
| 2-N07 | El departamento anterior reactivaba a un empleado trasladado | 8 |
| 2-N08 | Una ausencia aprobada no liberaba las coberturas | 7 |
| 2-N09 | Permiso JAC sin idempotencia ni revocación | 4 |
| 2-N10 | Una versión aprobada sin firmar no se podía retirar | 3 |
| 2-N11 | Se quitaba el turno de hoy aunque el agente tuviera trabajo | 7 |
| 2-N12 | Avisos de vencimiento que no llegaban y `RenewalNoticeDays` ignorado | 4 |
| 2-N13 | Ningún correo al quedar listo para firmar ni al rechazar el permiso | 4 |
| 2-N14 | Terminar ignoraba el preaviso firmado | 3 |
| 2-N15 | Un contrato terminado conservaba renovaciones vivas | 3 |
| 2-N16 | El feed proponía vuelos de aerolíneas suspendidas o vencidas | 6 |
| 2-N17 | La limpieza borraba la foto de una solicitud pendiente | 8 |
| 2-N18 | Gestión Humana no recibía la alerta de solicitud de acceso | 8 |
| 2-N19 | Editar a un miembro `CUSTOM_*` le quitaba el acceso | 8 |
| 2-N20 | La aerolínea no gestionaba sus usuarios y cualquiera firmaba | 8 |
| 2-N21 | Estaciones fuera del expediente al editar a un miembro | 8 |
| 2-N22 | Una ausencia aprobada no se podía cancelar ni acortar | 7 |
| 2-N23 | La cobertura no comprobaba la ausencia ni el carnet del mentor | 7 |
| 2-N24 | Turnos sobre ausencias aprobadas sin aviso | 7 |
| 2-N25 | Sin avisos de vencimiento de documentos ni reevaluación de lo asignado | 7 |
| 2-N26 | Estados y unidades en código crudo en Contratos y el portal | 4 |
| 2-N27 | La renovación automática fallida quedaba como iniciada | 3 |
| 2-N28 | Carrera entre la vigencia y la firma de la aerolínea | 2 |
| 2-N29 | Pausa del feed y avisos de contrato sin texto | 4 y 6 |
| 2-N30 | «Ya quedó activo» y «en vigor» antes de tiempo | 4 |
| 2-N31 | Gestión Humana calculaba el día en UTC | 1 y 7 |
| 2-N32 | Portal sin estaciones con el contrato suspendido o vencido | 4 |
| 2-N33 | Solicitudes de un administrador que se fue seguían pendientes | 8 |
| 2-N34 | El resumen del mapa en vivo omitía las posiciones sin verificar | 5 |
| 2-N35 | El portal presentaba como «Borrador» un contrato que espera firmas | 4 |
| 2-N36 | Descartar una propuesta del feed era irreversible | 6 |
| 2-N37 | El documento del permiso se enlazaba fuera de la ventana de limpieza | 4 |
| 2-N38 | Rutas heredadas de gobernanza que creaban roles y cuentas sin expediente | 8 |
| 2-N39 | Altas de gobernanza sin idempotencia | 8 |
