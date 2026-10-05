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
verified_commit: "87cb3ec2df6d88796e56eb93d428e6bb316b55c7"
sources:
  - backend/Elevant.Api/Controllers/AccountChangesController.cs
  - backend/Elevant.Api/Controllers/AttendanceDraftController.cs
  - backend/Elevant.Application/Operations/AttendanceDraftPolicy.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/EfAttendanceDraftStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20261005133619_OperationAttendanceContributionRevisions.cs
  - frontend/mobile-agent/src/services/mobile-change-feed.ts
  - frontend/mobile-agent/src/services/ramp-attendance-draft.ts
  - frontend/mobile-agent/src/storage/attendance-draft.ts
  - frontend/mobile-agent/src/components/attendance-draft-card.tsx
  - frontend/mobile-agent/src/app/flight/[id].tsx
  - frontend/private-web/src/services/attendanceDraftService.js
  - frontend/private-web/src/features/planning/attendance/useAttendanceDraft.js
  - frontend/private-web/src/features/planning/components/OccAttendancePanel.jsx
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
descarta las pistas del agente si se revoca la instalación que consulta, aunque
otra tablet de la misma cuenta siga activa. Las interfaces de esta rama releen
el snapshot por REST; la pista no transporta observaciones ni reemplaza la
comprobación de autorización.

OCC muestra, por asignación, su formulario y el aporte del agente en solo
lectura. Mobile Agent ofrece una tarjeta en la operación asignada: permite
registrar manualmente inicio, fin y nota, y consultar el aporte OCC sin editarlo.
Ambos releen al recuperar foco o primer plano, ante la pista durable y mediante
sondeo visible de 25 segundos. Una edición local no se pisa con una relectura.
Un `409` mantiene el intento junto a la revisión actual y exige una decisión
explícita; una respuesta de escritura incierta conserva clave y cuerpo para un
reintento deliberado. La tablet vincula ese comando a sesión, cuenta, operación
y asignación, y lo elimina al salir de la sesión. No afirma captura biométrica.

La migración es aditiva y sin datos de negocio. Esta nota verifica código de
la rama en el commit indicado, no una promoción al VPS ni una prueba de
navegador/tablet. Firma dibujada, validación G.H.,
cálculo de horas extra y reglas de nómina continúan pendientes según la
[especificación operativa](../../docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md).
