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
y sondeo de 25 segundos. Chat y Notificaciones OCC vuelven a consultar el
recurso por REST; sus [pruebas de rutas](../../frontend/private-web/src/features/admin-occ/CanonicalReadRoutes.test.jsx)
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
