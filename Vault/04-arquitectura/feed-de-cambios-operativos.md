---
id: arquitectura-feed-cambios-operativos
title: "Feed de cambios operativos"
type: architecture
area: architecture
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-04"
verified_commit: "c2c66bca855778021e1b42aad86ecdad1ecf1c93"
sources:
  - database/DevelopmentDB/Elevant.Persistence/Realtime/AccountChangeOutboxWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/AirlineOperationChangeWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/EfOccPlanningCommandStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/OccPlanningChangeWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/RampOperationChangeWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/OperationMessageChangeWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/OperationalNotificationWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/EfOperationalCommunicationStore.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.Realtime.cs
  - docs/adr/0029-ramp-realtime-alerts-and-chat-read-state.md
  - frontend/private-web/src/features/shell/AppShell.jsx
  - frontend/private-web/src/features/chat/CanonicalChatRoute.jsx
  - frontend/private-web/src/features/admin-occ/useOccReviewQueue.js
  - frontend/private-web/src/features/admin-occ/shell/OccShellProvider.jsx
  - frontend/private-web/src/features/admin-occ/live/useOccResource.js
  - frontend/private-web/src/features/admin-occ/live/occRequestBudget.test.js
  - frontend/mobile-agent/src/app/chat.tsx
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeDispatcherStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20260926062846_AccountChangeFeed.cs
  - backend/Elevant.Api/Hubs/AccountChangeDispatchWorker.cs
  - backend/Elevant.Api/Controllers/AccountChangesController.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs
  - backend/tests/Elevant.IntegrationTests/Api/AccountChangesEndpointsTests.cs
  - packages/api-client/openapi/elevant-v1.json
  - packages/api-client/src/client.ts
  - frontend/private-web/src/services/accountChangeObserver.js
  - frontend/private-web/src/services/accountChangeObserver.test.js
  - frontend/private-web/src/features/admin-occ/CanonicalReadRoutes.test.jsx
  - frontend/private-web/src/features/flight-monitoring/FlightMonitoringRoute.jsx
  - frontend/private-web/src/features/positions-map/PositionsMapRoute.jsx
  - frontend/private-web/README.md
  - frontend/private-web/src/config/securityHeaders.mjs
  - frontend/private-web/Dockerfile
  - frontend/mobile-agent/src/services/mobile-change-observer.ts
  - frontend/mobile-agent/src/services/mobile-change-feed.ts
  - frontend/mobile-agent/tests/mobile-change-observer.test.js
  - frontend/mobile-agent/README.md
  - frontend/public-web/src/lib/airline-change-observer.ts
  - frontend/public-web/src/components/auth/AirlineSessionProvider.tsx
  - frontend/public-web/tests/unit/airline-change-observer.test.ts
  - frontend/public-web/README.md
  - frontend/public-web/next.config.ts
  - frontend/scripts/deployment/csp-tool.mjs
  - database/DevelopmentDB/Elevant.Persistence/Finance/FinanceApprovedServiceChangeWriter.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceInvoiceChanges.cs
  - frontend/private-web/src/features/finance/invoices/InvoicesPage.jsx
  - frontend/private-web/src/features/finance/invoicing/useToInvoiceData.js
tags:
  - arquitectura
  - tiempo-real
  - outbox
  - signalr
---

# Feed de cambios operativos

Esta capacidad está implementada en la rama de integración de Development,
pero **no está promocionada al VPS**. SQL Server sigue siendo la autoridad:
la escritura de un mensaje o una notificación operativa agrega una pista al
outbox en la misma transacción. Un distribuidor proyecta esas pistas en
`infra.account_changes` bajo un bloqueo SQL que serializa los commits. La
identidad del feed, no la del outbox original, determina el orden del cursor.
Los reintentos no duplican una pista para el mismo destinatario.

El aviso SignalR `ChangedV1` contiene solamente un `eventId`; no contiene
mensajes, datos personales ni identificadores internos. Un fallo de WebSocket
no revierte la proyección. El cliente recupera el estado con
`GET /api/v1/changes?after&limit`, usando un cursor firmado y ligado a su
cuenta, y después vuelve a consultar el recurso mediante su endpoint REST.

La CSP de ambos clientes web permite únicamente el origen HTTPS de la API y
su equivalente exacto `wss://` para el hub. El certificador rechaza otros
hosts y comodines. Una prueba local de Public Web contra Development detectó
que la política anterior bloqueaba el WebSocket; después de corregirla, el
portal recargó sin ese error de consola. Esto no equivale a una medición de
latencia ni demuestra todavía la promoción de la nueva política al VPS.

Cada página revalida la cuenta, sus roles, membresías y estaciones vigentes;
una estación revocada deja de mostrar pistas antiguas. Para pistas de
operaciones de aerolínea, además exige un rol del portal y una membresía
vigente en la organización propietaria de la operación. Véanse el
[controlador](../../backend/Elevant.Api/Controllers/AccountChangesController.cs),
el [almacén de lectura](../../database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs)
y el [contrato OpenAPI](../../packages/api-client/openapi/elevant-v1.json).

Las [pruebas SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs)
cubren permisos del rol de aplicación, chat idempotente, orden de proyección,
deduplicación, evento malformado y revocación de estación. El cliente
TypeScript [expone](../../packages/api-client/src/client.ts) `getAccountChanges`.
En la rama, [AVIAM Web](../../frontend/private-web/src/services/accountChangeObserver.js)
conecta los hubs y reconcilia el cursor ante aviso, foco, conexión recuperada
y sondeo de 25 segundos. En el OCC, desde el PR U2, el marco abre un solo
observador por pestaña para lo que comparten todas las pantallas
([Un observador por pestaña del OCC](#un-observador-por-pestaña-del-occ-pr-u2)).
Chat y Notificaciones OCC vuelven a consultar el recurso por REST con su propio
observador, que U6 pasará al del marco; sus [pruebas de rutas](../../frontend/private-web/src/features/admin-occ/CanonicalReadRoutes.test.jsx)
y [pruebas del observador](../../frontend/private-web/src/services/accountChangeObserver.test.js)
cubren invalidación, replay, fallos y cierre de sesión. [Mobile Agent](../../frontend/mobile-agent/src/services/mobile-change-feed.ts)
reconcilia por REST al volver al primer plano y cada 25 segundos mientras
permanece activo. Su [observador](../../frontend/mobile-agent/src/services/mobile-change-observer.ts)
descarta respuestas de sesiones reemplazadas, reinicia el cursor al cambiar
de cuenta y no confirma una página fallida. Las [pruebas](../../frontend/mobile-agent/tests/mobile-change-observer.test.js)
incluyen esos casos y el bundle Android compila. Los cambios de asignación,
inicio, entrega y revisión de una operación generan también pistas para las
cuentas vigentes de su aerolínea. [Public Web](../../frontend/public-web/src/lib/airline-change-observer.ts)
escucha el hub de operaciones, reconcilia el feed por REST y vuelve a consultar
la sesión y el bootstrap; conserva sondeo de 25 segundos y recuperación al
recobrar foco o conectividad. La prueba SQL cubre la revocación de membresía
de aerolínea sin perder otra membresía activa. Esto **no** demuestra todavía
navegación real con VPS o emulador, latencia p95, entrega con la app cerrada,
historial completo de aerolínea ni promoción remota.

En esta rama, asignar un agente a una operación OCC agrega también una pista
`occ_planning` para las cuentas OCC activas de la estación, en el mismo commit
que la asignación. La pista contiene el UUID de la estación, no datos del
agente ni del vuelo. Planificación, Monitoreo y Mapa de posiciones vuelven a
leer sus snapshots autorizados al recibirla; foco, reconexión y sondeo visible
permiten recuperación. La prueba SQL exige el destinatario y alcance de esa
pista; las pruebas de rutas comprueban la invalidación en Monitoreo y Mapa.
La entrega efectiva y latencia entre navegadores en el VPS siguen pendientes.

## Fase 3, bloque 1: rampa, alertas y lectura del chat

En la rama de la fase 3 ([ADR-0029](../../docs/adr/0029-ramp-realtime-alerts-and-chat-read-state.md)),
[RampOperationChangeWriter](../../database/DevelopmentDB/Elevant.Persistence/Operations/RampOperationChangeWriter.cs)
reparte las pistas de cada escritura de rampa. Las escrituras son: asignación, inicio,
checklist, servicio, incidente, recargo, corrección, entrega, decisión de OCC y cambio de
posición. Las pistas son:

- `occ_planning` para OCC;
- `ramp_operations` para los agentes asignados;
- `occ_review` para la cola de Revisión.

Los turnos, permisos y habilitaciones avisan `ramp_schedule` al propio agente. Un mensaje de
chat avisa `operation_messages` a OCC y a los agentes asignados, no solo a quien lo envía.

**Notificaciones.** Las nuevas son:

- `operation_assigned` para el agente;
- `operation_started` para OCC;
- `incident_reported` para OCC, como alerta;
- `flight_changed` para el agente.

**Lectura del chat.** La tabla `ops.operation_message_reads` guarda un cursor de lectura por
cuenta y operación, y ese cursor solo avanza. Con él, las conversaciones devuelven
`unreadCount` y `othersReadUpTo`, que dan los no leídos y el «Visto».

**AVIAM Web.** Muestra las notificaciones nuevas como aviso emergente, las incidencias como
alerta. La cola de Revisión se recarga sola.

**Mobile Agent.** Se conecta a los hubs SignalR y reconcilia el cursor al recibir `ChangedV1`.
Desconecta los hubs en segundo plano y conserva el sondeo de respaldo.

**Pruebas.** La [prueba SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.Realtime.cs)
cubre el aviso a ambos lados, los no leídos, el «Visto» y que el cursor nunca retrocede. Esto
**no** demuestra todavía latencia en el VPS ni entrega con la app cerrada.

## Fase 2 del ciclo: pre-operación

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 2 del ciclo (`50e7778f`;
[ADR-0038](../../docs/adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)).
Las pistas siguen sin llevar datos: los clientes releen por REST.

**Pistas nuevas o ampliadas:**

- `mobile_devices` para las cuentas con `operations.devices.read`, cuando una
  tablet cambia de agente, se libera, se desvincula o se revoca
  ([vínculos de tablet](../../database/DevelopmentDB/Elevant.Persistence/Integration/MobileDeviceBindings.cs)).
  La pantalla «Tablets» de OCC relee con ella.
- `occ_planning` también para los cambios de estaciones y datos maestros, la
  liberación de un agente, la cancelación o el acortamiento de una ausencia y
  la segunda firma de una versión, que puede mover vuelos a la versión firmada
  ([reemplazo de versiones](../../database/DevelopmentDB/Elevant.Persistence/Commercial/ContractVersionSupersession.cs)).
- `airline_contracts` para las cuentas del portal de la aerolínea cuando cambia
  el ciclo de vida de su contrato o la revisión de sus permisos; el portal
  relee también su estado (`GET airline/portal/standing`).

**Notificaciones nuevas:**

- `agent_released` para OCC (solo `ADMIN_OCC`) por cada operación que perdió
  al agente, y `assignment_released` para la tablet del agente
  ([liberación](../../database/DevelopmentDB/Elevant.Persistence/Operations/RampAgentRelease.cs));
- `agent_document_not_current` para OCC, una vez por asignación, cuando un
  documento del agente vence o se corrige; nunca llega a la tablet;
- de departamento para Contratos, sobre la renovación automática bloqueada, la
  terminación programada, cancelada o cumplida y la versión retirada; y para
  Gestión Humana, sobre los carnets, licencias y habilitaciones por vencer. Los
  avisos de Contratos sobre la vigencia y la renovación automática iniciada ya
  existían; la fase 2 les dio título y destino.

Esto tampoco demuestra latencia en el VPS ni entrega con la aplicación cerrada.

## Fase 3 del ciclo: la operación

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 3 del ciclo (`f2d5c52c`) y la corrección de los hallazgos pendientes de
la revisión de su bloque A (`52141adb`), que esa verificación no cubre
([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).
Las pistas siguen sin llevar datos.

**Pistas ampliadas:**

- `occ_review` también para la evidencia que llega mientras OCC revisa, la
  reapertura de una aprobación, las incidencias de OCC, los ajustes de cargos y
  la exclusión de facturación
  ([evidencia tardía](../../database/DevelopmentDB/Elevant.Persistence/Operations/PendingSubmissionEvidenceRefresher.cs)).
  La cola de Revisión, el detalle y el panel de incidencias la escuchan y se
  releen sin pasar a «cargando»; antes el aviso llegaba, pero la pantalla no lo
  escuchaba.
- `hr_shifts`, `ramp_schedule` (la agenda del agente) y `occ_planning` cuando
  Gestión Humana u OCC ajustan un turno.
- `ramp_operations` cuando Finanzas reabre la cotización de un charter, para que
  la tablet vuelva a ofrecer «Agregar».

**Notificaciones nuevas o ampliadas:**

- para OCC (solo `ADMIN_OCC` con la estación en alcance), que abren
  Planificación: `flight_cancelled_by_provider` y `flight_diverted_by_provider`,
  una sola vez por escala y tipo cuando el proveedor cambia el estado de un
  vuelo importado, aunque informe los dos tramos en la misma lectura o en
  lecturas distintas (la fuente del aviso es la escala);
  `stand_change_unassigned`, cuando un cambio de posición deja la operación sin
  agente elegible; y `contract_not_in_force`, por cada operación sin iniciar
  cuyo contrato dejó de estar en vigor. Ninguna llega a la tablet;
- para la tablet, solo tipos que la APK desplegada ya conoce:
  `assignment_released` al cancelar, desviar, liberar, relevar o reasignar;
  `operation_assigned` al agente que recibe un relevo o una reasignación, y
  `flight_changed` también al corregir la llegada;
- de departamento para Finanzas: `charter_cancelled`, cuando OCC cancela o
  desvía un charter con prepago.

Tampoco esto demuestra latencia en el VPS ni entrega con la aplicación cerrada.

## Fase 4 del ciclo: facturación y cobro

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 4 del ciclo (`39a85a46`;
[ADR-0035](../../docs/adr/0035-direct-invoicing-simulated-ecf.md),
[ADR-0036](../../docs/adr/0036-simulated-card-payment.md) y
[ADR-0040](../../docs/adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md)).
Las pistas siguen sin llevar datos.

**Pistas nuevas o ampliadas:**

- `finance_invoices` cuando una factura de la estación se emite, se paga con
  tarjeta, recibe una aplicación, un reverso o una nota, o se le aplica un
  prepago confirmado tarde
  ([escritor](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinanceApprovedServiceChangeWriter.cs)).
  Llega a quien lee `finance.invoicing.read` o `finance.reconciliation.read`,
  y el lector comprueba que la factura sea de la estación de la pista.
  «Facturas» relee con ella y al recuperar el foco
  ([vista](../../frontend/private-web/src/features/finance/invoices/InvoicesPage.jsx)).
- `finance_approved_services` ahora exige `finance.invoicing.read` y se
  anuncia también por cada operación facturada o cerrada sin cargo; «Por
  facturar» e Inicio la escuchan
  ([datos de Por facturar](../../frontend/private-web/src/features/finance/invoicing/useToInvoiceData.js)).
- `airline_treasury` sigue anunciando cada cambio de la cartera de la
  aerolínea, también el pago con tarjeta y el prepago de un charter aplicado.
- `airline_preinvoices` la sigue escribiendo la emisión sobre su borrador
  interno; el portal ya no lee prefacturas y la trata solo como pista para
  releer Finanzas.
- `finance_preinvoices` y `finance_fiscal` quedan retiradas con sus
  pantallas: nada las escribe y las ya guardadas nunca se entregan.

**Notificaciones de departamento:** Finanzas recibe
`operation_ready_to_invoice` cuando OCC aprueba operaciones con servicios
facturables, una por aerolínea, estación y día hábil, si además abre «Por
facturar»; abre esa pantalla. `invoice_paid` llega a quien abre «Facturas».
Los correos de nota de crédito o débito y el aviso único de factura vencida
salen por el outbox de correo, no por el feed.

**Pruebas.** La [prueba SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceInvoiceChanges.cs)
cubre a quién llegan `finance_invoices` y `finance_approved_services` según
el permiso, y que la aerolínea recibe `airline_treasury` y nunca las pistas de
Finanzas. Tampoco esto
demuestra latencia en el VPS ni entrega con la aplicación cerrada.

## Un observador por pestaña del OCC (PR U2)

Posterior al commit verificado de esta nota: esta sección describe el código del
PR U2 «Marco del OCC» (`1afe6820`, `debecb1e`, `2d30d7fe` y `a7ef7a4f`), que esa
verificación no cubre
([ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md), nota del 13 de
noviembre de 2026). Las pistas no cambian: siguen sin datos, y el marco relee
por REST.

Bajo `/admin-occ`,
[`OccShellProvider`](../../frontend/private-web/src/features/admin-occ/shell/OccShellProvider.jsx)
abre el único observador de cambios del marco en cada pestaña y avisa a cada
suscriptor solo de los recursos que escucha. Antes, cada pantalla del OCC abría
al menos dos, el del acceso del departamento y el de la campana, además del
suyo si lo tenía, cada uno con sus dos hubs y su sondeo. Ahora escuchan en el
del marco:

- el acceso del departamento, con `department_users` y `access_requests`; en el
  OCC, `RoleLayout` apaga el observador propio de `DepartmentAccessProvider`;
- los avisos operativos, con `notifications`. Se leen una vez para la barra de
  estado, el riel, el cajón «Alertas y avisos» y los toasts, y `AppShell` ya no
  los lee en el OCC;
- el contador de Revisión, con `occ_review` (`useOccReviewChangeVersion`).

El observador conserva su sondeo de 25 segundos y su conciliación al recuperar
el foco, la conexión o la visibilidad. Ahora también informa, con `onStatus`,
del estado de los hubs y del resultado de cada conciliación: de ahí salen «En
vivo», «Reconectando», «Sin tiempo real» y «Sin conexión» en la barra de
estado. Las lecturas del marco pasan por
[`useOccResource`](../../frontend/private-web/src/features/admin-occ/live/useOccResource.js):
leen solo con su permiso, se repiten como mucho una vez cada 3 segundos, esperan
con la pestaña oculta, tienen un sondeo de seguridad de 60 segundos y se
detienen tras un 401, 403 o 404 hasta que cambia el acceso.

Las pantallas que todavía abren su propio observador lo conservan hasta el PR
que las rehace: Panorama (U3); Monitoreo de vuelos, Mapa de posiciones y
Planificación (U5); y Cobertura de posiciones, Datos maestros, Tablets, Chat
interno y Notificaciones (U6). Las páginas de otros departamentos que monta el
OCC (Usuarios, Mis gastos y la pestaña de servicios de Notificaciones)
conservan el suyo. La
[prueba de presupuesto](../../frontend/private-web/src/features/admin-occ/live/occRequestBudget.test.js)
repite un minuto en reposo y otro de vuelo demo, y falla si el plan de
peticiones de una pestaña pasa de 40 o de 70 por minuto. También falla si un
archivo montado bajo `/admin-occ` abre un observador que su inventario no
registra.

Un recibo de lectura no genera pista: otra pestaña de la misma cuenta lo ve en
su siguiente lectura de avisos, como mucho a los 60 segundos. En la misma
pestaña, la página de Notificaciones pide al marco que relea los avisos al
guardar un recibo, y el marco agrupa esa relectura como una pista: como mucho
una cada 3 segundos. Esto tampoco demuestra latencia en el VPS ni entrega entre
navegadores.
