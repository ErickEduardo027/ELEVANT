// Documentación de forma (JSDoc) del dominio "Horarios y disponibilidad". El
// proyecto aún no usa TypeScript ni un contrato OpenAPI para este dominio;
// estos typedefs describen la respuesta/payload que se espera de un futuro
// backend (ver ClaudeSkillsGH/plan-horario/skill.md), para que el mock y el
// consumidor evolucionen sin ambigüedad. Mismo patrón que
// humanResourcesPermits.js / humanResourcesQualifications.js.
//
// Modelo operativo: turnos rotativos de 8 horas, un agente por posición
// (skill.md §CONTEXTO OPERATIVO). Un agente tiene como máximo un turno por
// día — no hay medios turnos ni turnos superpuestos para el mismo agente.

/**
 * @typedef {'A'|'B'} Terminal
 */

/**
 * Bloque de 8 horas del modelo rotativo (skill.md §OBJETIVO). El horario
 * exacto (`startTime`/`endTime`) vive en ShiftAssignment; este catálogo solo
 * fija los tres bloques posibles para agrupar cobertura y KPIs (p. ej.
 * "agentes en turno de madrugada" = bloque `night`).
 * @typedef {'morning'|'afternoon'|'night'} ShiftBlockId
 */

/**
 * Posición operativa de rampa. Cuando `requiresQualification` es true, la
 * asignación exige que el agente tenga una habilitación vigente para
 * `id` (mismo espacio de equipmentId que Habilitaciones y certificaciones,
 * ver skill.md §"ASIGNACIÓN DE TURNO": "habilitación necesaria para la
 * posición, cuando corresponda").
 * @typedef {Object} Position
 * @property {string} id
 * @property {string} name
 * @property {boolean} requiresQualification
 */

/**
 * Registro completo de un turno tal como lo devuelve (o devolverá) el
 * backend. Un agente tiene a lo sumo un ShiftAssignment por día — la unicidad
 * de (agentId, date) es una regla de negocio, no un artefacto del mock.
 * @typedef {Object} ShiftAssignment
 * @property {string} id
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} date - ISO 8601, solo fecha (YYYY-MM-DD)
 * @property {string} startTime - HH:mm
 * @property {string} endTime - HH:mm
 * @property {ShiftBlockId} block
 * @property {Terminal} terminal
 * @property {string|null} positionId
 * @property {string} createdAt - ISO 8601
 * @property {string} updatedAt - ISO 8601
 */

/**
 * Payload para crear/editar un turno (skill.md §"ASIGNACIÓN DE TURNO").
 * @typedef {Object} ShiftAssignmentPayload
 * @property {string} agentId
 * @property {string} date - ISO 8601, solo fecha (YYYY-MM-DD)
 * @property {string} startTime - HH:mm
 * @property {string} endTime - HH:mm
 * @property {Terminal} terminal
 * @property {string|null} positionId
 */

/**
 * @typedef {'pending'|'approved'|'rejected'} AvailabilityRequestStatus
 */

/**
 * @typedef {'day_off'|'shift_change'|'restriction'} AvailabilityRequestType
 */

/**
 * Solicitud de cambio/restricción de disponibilidad de un agente (skill.md
 * §"SOLICITUDES DE DISPONIBILIDAD"). Una solicitud `approved` de tipo
 * `day_off`/`restriction` es lo que useSchedulesData consulta para bloquear
 * la asignación de turno ese día (ver validateShiftAssignment en
 * mappers.js).
 * @typedef {Object} AvailabilityRequest
 * @property {string} id
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} date - ISO 8601, solo fecha (YYYY-MM-DD)
 * @property {AvailabilityRequestType} type
 * @property {string} reason
 * @property {AvailabilityRequestStatus} status
 * @property {string} requestedAt - ISO 8601
 * @property {string} [resolvedAt] - ISO 8601
 * @property {string} [resolvedBy]
 */

/**
 * Requisito de cobertura: cuántos agentes se necesitan en `positionId`, por
 * terminal y bloque de turno. Catálogo de planificación (skill.md
 * §CONTEXTO OPERATIVO: "la demanda cambia durante el día"), no un dato
 * derivado de los turnos ya asignados.
 * @typedef {Object} CoverageRequirement
 * @property {string} positionId
 * @property {Terminal} terminal
 * @property {ShiftBlockId} block
 * @property {number} requiredCount
 */

/**
 * Severidad de un conflicto de asignación (skill.md §"ASIGNACIÓN DE TURNO":
 * "mostrar advertencia o impedir la asignación según la gravedad").
 * `block` impide guardar; `warning` permite guardar mostrando el aviso.
 * @typedef {'block'|'warning'} ConflictSeverity
 */

/**
 * @typedef {Object} AssignmentConflict
 * @property {ConflictSeverity} severity
 * @property {string} message
 */

export {};
