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
verified_commit: "02dcb6b97290126b1248c2ab4c7de7e1446cfab4"
sources:
  - database/DevelopmentDB/Elevant.Persistence/Realtime/AccountChangeOutboxWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeDispatcherStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20260926062846_AccountChangeFeed.cs
  - backend/Elevant.Api/Hubs/AccountChangeDispatchWorker.cs
  - backend/Elevant.Api/Controllers/AccountChangesController.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs
  - backend/tests/Elevant.IntegrationTests/Api/AccountChangesEndpointsTests.cs
  - packages/api-client/openapi/elevant-v1.json
  - packages/api-client/src/client.ts
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
una estación revocada deja de mostrar pistas antiguas. Véanse el
[controlador](../../backend/Elevant.Api/Controllers/AccountChangesController.cs),
el [almacén de lectura](../../database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs)
y el [contrato OpenAPI](../../packages/api-client/openapi/elevant-v1.json).

Las [pruebas SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs)
cubren permisos del rol de aplicación, chat idempotente, orden de proyección,
deduplicación, evento malformado y revocación de estación. Esto **no** demuestra
todavía conexión de Private Web, Public Web o Mobile Agent, ni latencia p95,
sincronización al reanudar, entrega con la app cerrada o promoción remota.
El cliente TypeScript [expone](../../packages/api-client/src/client.ts)
`getAccountChanges`, pero las aplicaciones aún deben conectarlo y probar su
reconciliación en navegador y emulador.
