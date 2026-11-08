---
id: aplicaciones-occ-turnos-vuelo
title: "Opciones OCC de turno por vuelo"
type: capability
area: private-web
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-05"
verified_commit: "f791bcdbb7449d0b5a73835407a10ab19319726c"
sources:
  - frontend/AGENTS.md
  - frontend/private-web/README.md
  - frontend/private-web/src/features/planning/components/OccShiftPanel.jsx
  - frontend/private-web/src/features/planning/components/OccShiftPanel.test.jsx
  - frontend/private-web/src/features/planning/components/occShiftPresets.js
  - frontend/private-web/src/features/planning/components/occShiftPresets.test.js
  - backend/Elevant.Application/Operations/OccShiftCoveragePolicy.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/EfOccShiftProgrammingStore.cs
tags:
  - aplicaciones
  - private-web
  - occ
  - turnos
---

# Opciones OCC de turno por vuelo

En la rama de implementación, el panel OCC de cobertura de una escala manual planificada ofrece seis intervalos locales precargados: 07:00–16:00, 08:00–17:00, 11:00–20:00, 12:00–21:00, 15:00–00:00 y 23:00–08:00. Elegir uno copia las horas a campos editables; una edición manual vuelve la selección a «Personalizado». El panel señala cuando el fin cae al día siguiente y limpia la selección al abrir otro vuelo. Su [catálogo](../../frontend/private-web/src/features/planning/components/occShiftPresets.js) y [formulario](../../frontend/private-web/src/features/planning/components/OccShiftPanel.jsx) tienen pruebas específicas.

La interfaz no guarda plantillas globales ni crea un calendario OCC general. Solo aparece cuando un agente cumple las demás condiciones pero necesita turno compatible. Al confirmar, usa el comando de turno existente; el servidor vuelve a validar rol, estación, terminal, cobertura completa, duración máxima y conflictos antes de persistir. El horario sugerido no sustituye esas reglas.

*Posterior al commit verificado de esta nota: desde la fase 3 del ciclo ([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)), programar un segundo turno el mismo día responde `409 shift_day_taken`. El panel lee entonces el turno que el agente ya tiene (`GET occ/planning/turnarounds/{id}/agents/{agentId}/shift`) y pasa a «Ajustar turno del día»: propone ampliarlo hasta cubrir el vuelo, pide motivo y lo ajusta con `PATCH human-resources/shifts/{id}`, el mismo comando de Gestión Humana, con la versión leída y una clave de intención. El servidor rechaza un horario que deje sin cubrir las coberturas u operaciones del agente (`shift_uncovers_work`). Si el turno de ese día es de otra estación, el panel no lo encuentra (`shift_not_found`) y no ofrece el ajuste.*

Esta nota verifica código del commit indicado, **no** una promoción ni una prueba de navegador en el VPS. El resto del diseño de turnos, asistencia compartida y documentación operativa continúa en la [especificación aprobada](../../docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md).
