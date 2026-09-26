---
id: arquitectura-feed-cambios-operativos
title: "Feed de cambios operativos"
type: architecture
area: architecture
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-26"
verified_commit: "e047f7ac69c241d354fff9144f47747b98963719"
sources:
  - database/DevelopmentDB/Elevant.Persistence/Realtime/AccountChangeOutboxWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/AirlineOperationChangeWriter.cs
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
  - frontend/private-web/README.md
  - frontend/mobile-agent/src/services/mobile-change-observer.ts
  - frontend/mobile-agent/src/services/mobile-change-feed.ts
  - frontend/mobile-agent/tests/mobile-change-observer.test.js
  - frontend/mobile-agent/README.md
  - frontend/public-web/src/lib/airline-change-observer.ts
  - frontend/public-web/src/components/auth/AirlineSessionProvider.tsx
  - frontend/public-web/tests/unit/airline-change-observer.test.ts
  - frontend/public-web/README.md
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
permanece activo; no añade SignalR nativo. Su [observador](../../frontend/mobile-agent/src/services/mobile-change-observer.ts)
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
