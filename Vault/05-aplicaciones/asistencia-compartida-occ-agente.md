---
id: aplicaciones-asistencia-compartida-occ-agente
title: "Asistencia compartida OCC y agente"
type: capability
area: applications
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-05"
verified_commit: "43d6f635bfdd35e5ec44dbe03bc3b1578a480aca"
sources:
  - backend/Elevant.Api/Controllers/AttendanceDraftController.cs
  - backend/Elevant.Application/Operations/AttendanceDraftPolicy.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/EfAttendanceDraftStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20261005133619_OperationAttendanceContributionRevisions.cs
  - packages/api-client/src/client.ts
tags:
  - aplicaciones
  - occ
  - agente-rampa
  - asistencia
---

# Asistencia compartida OCC y agente

El contrato API local permite consultar las observaciones manuales de una
asignación de operación y anexar revisiones separadas para OCC y el agente de
rampa asignado. Cada carril conserva su autor, momento de registro, instantes
observados y nota opcional; un actor no puede elegir el carril ni la cuenta
autora en el cuerpo de la solicitud. G.H. puede consultar con alcance vigente,
pero no escribir en ninguno de esos carriles.

La API exige revisión esperada e intención idempotente para cada escritura.
Revalida cuenta, rol, estación, asignación y, para el agente, instalación móvil
activa. El almacén SQL anexa revisión, auditoría y aviso durable en una
transacción. La pista de cambio solo identifica recurso y operación: el
destinatario debe releer mediante REST, con autorización vigente. El feed
descarta pistas si se revoca su acceso. Esto permite una futura convergencia
tras reconexión, pero **no** significa que las interfaces ya estén suscritas.

La migración es aditiva y sin datos de negocio. Esta nota verifica código de
la rama en el commit indicado, no una promoción al VPS ni una prueba de
navegador/tablet. Captura visual OCC/móvil, firma dibujada, validación G.H.,
cálculo de horas extra y reglas de nómina continúan pendientes según la
[especificación operativa](../../docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md).
