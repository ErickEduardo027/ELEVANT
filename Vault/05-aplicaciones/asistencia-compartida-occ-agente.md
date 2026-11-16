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
verified_commit: "d37e1cd90350a1310a6e5c2109919388cd1ccfb1"
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

## Decisión de G.H. en la rama local posterior

El [contrato de validación](../../backend/Elevant.Api/Controllers/HumanResourcesAttendanceController.cs)
añade una consulta paginada por estación y fecha local y una decisión inmutable
de G.H. para cada par de revisiones actuales. La
[política](../../backend/Elevant.Application/Operations/AttendanceValidationPolicy.cs)
elige inicio y fin únicamente de los aportes OCC/agente; si las horas difieren,
exige justificación. La
[persistencia](../../database/DevelopmentDB/Elevant.Persistence/Operations/EfAttendanceValidationStore.cs)
vuelve a comprobar cuenta, rol y estación dentro de una transacción serializable,
registra auditoría y emite `attendance_validation`. La
[pantalla de G.H.](../../frontend/private-web/src/features/human-resources/attendance/AttendanceReviewPage.jsx)
compara ambos carriles, evita duplicar una decisión vigente y reconsulta REST
ante aviso, foco, reconexión y sondeo visible. Un 409 exige releer y reconfirmar;
una respuesta incierta conserva UUID y cuerpo aunque la fila desaparezca durante
una relectura; mientras se resuelve, bloquea el cambio de filtros o página. Una
denegación de autorización retira la evidencia y descarta lecturas en vuelo;
una reconsulta posterior puede recuperarla solo tras otra respuesta autorizada.
Este tramo está probado en código
local, no acredita su promoción ni la aceptación de tres sesiones en el VPS.
Siguen fuera el cálculo/evidencia de horas extra, exportaciones, firmas y el
checklist de puente.

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
Si cambia la revisión del carril propio durante una edición, ambos clientes
conservan el intento y muestran horas y nota frente a la versión canónica.
Después de un `409` no permiten basar otra escritura en el snapshot anterior:
exigen una lectura exitosa y una decisión explícita. Respuestas tardías de una
sesión reemplazada no borran la sesión nueva ni mantienen visible el aporte
anterior; OCC además rechaza horas locales inexistentes por salto horario.

*Posterior al commit verificado de esta nota: desde la fase 3 del ciclo
([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)),
cerrar, vencer o revocar la sesión ya no elimina el aporte que la tablet no
pudo confirmar: queda ligado a la cuenta y, cuando esa misma cuenta vuelve a
entrar, pasa a la sesión nueva con su clave y su cuerpo para un reintento
deliberado; otra cuenta no lo ve. En una tablet compartida, esas observaciones
quedan en el dispositivo hasta entonces. Las horas que captura la tablet salen
del reloj de ELEVANT. Tras un relevo, OCC puede registrar la asistencia del
agente relevado después del inicio, aunque su asignación ya esté liberada: el
detalle de Planificación lee esa asignación de
`GET occ/planning/turnarounds/{id}/attendance-assignments` (solo web,
`operations.attendance.read`) y ofrece al agente en «Agente para asistencia»
como «{nombre} (relevado)», después del agente actual. Una asignación liberada
antes del inicio no recibe asistencia, y la tablet no escribe sobre una
asignación liberada.*

La migración es aditiva y sin datos de negocio. Esta nota verifica código de
la rama en el commit indicado, no una promoción al VPS ni una prueba de
navegador/tablet. La validación G.H. se documenta arriba como código local
posterior a este commit verificado; firma dibujada, cálculo de horas extra y
reglas de nómina continúan pendientes según la
[especificación operativa](../../docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md).
