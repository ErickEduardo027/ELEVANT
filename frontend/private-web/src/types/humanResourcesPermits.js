// Documentación de forma (JSDoc) del dominio "Carnets y permisos
// aeroportuarios". El proyecto aún no usa TypeScript ni un contrato OpenAPI
// para este dominio; estos typedefs describen la respuesta/payload que se
// espera de un futuro backend (ver ClaudeSkillsGH/plan-carnets/skill.md),
// para que el mock y el consumidor evolucionen sin ambigüedad. Mismo patrón
// que humanResourcesQualifications.js.
//
// Por agente existen exactamente dos documentos administrados por este
// módulo: carnet aeroportuario y licencia de conducir en rampa (skill.md
// §OBJETIVO). No hay un catálogo variable como en Habilitaciones — por eso
// no existe un flujo de "alta" de documento, solo renovación.

/**
 * @typedef {'A'|'B'} Terminal
 */

/**
 * @typedef {'carnet'|'licencia'} PermitDocumentType
 */

/**
 * @typedef {'current'|'expiringSoon'|'expired'} PermitStatus
 */

/**
 * Registro completo de un documento tal como lo devuelve (o devolverá) el
 * backend. `status` no se persiste aquí: se deriva en el frontend a partir
 * de `expiresAt` y una ventana configurable (ver statusMeta.js).
 * @typedef {Object} AirportPermitRecord
 * @property {string} id
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} employeeNumber
 * @property {Terminal[]} terminals
 * @property {PermitDocumentType} type
 * @property {string} number
 * @property {string} issuedAt - ISO 8601
 * @property {string} expiresAt - ISO 8601
 * @property {{name: string, url: string}|null} supportDocument
 * @property {string} updatedAt - ISO 8601
 */

/**
 * Fila aplanada por documento — derivada de AirportPermitRecord por
 * mappers.js, no almacenada así en el backend.
 * @typedef {Object} PermitListItem
 * @property {string} id
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} employeeNumber
 * @property {Terminal[]} terminals
 * @property {PermitDocumentType} type
 * @property {string} typeLabel
 * @property {PermitStatus} status
 * @property {string} statusLabel
 * @property {string} statusTone
 * @property {number} daysRemaining
 * @property {string} dueLabel
 * @property {AirportPermitRecord} record
 */

/**
 * Resumen por agente — agregado en el frontend a partir de
 * PermitListItem[] (mismo patrón que AgentQualificationSummary). Siempre
 * expone exactamente `carnet` y `licencia`, aunque el backend real permita
 * que alguno no exista todavía para un agente (en ese caso llega `null`).
 * @typedef {Object} AgentPermitSummary
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} employeeNumber
 * @property {Terminal[]} terminals
 * @property {string} [identificationNumber]
 * @property {string} [hireDate] - ISO 8601
 * @property {PermitListItem|null} carnet
 * @property {PermitListItem|null} licencia
 * @property {'current'|'attention'|'action_required'} overallStatus
 * @property {string} overallStatusLabel
 * @property {string} overallStatusTone
 * @property {string|null} nextExpirationAt - ISO 8601 del próximo vencimiento entre ambos documentos
 * @property {string|null} updatedAt - ISO 8601, más reciente entre ambos documentos
 */

/**
 * @typedef {Object} PermitHistoryEvent
 * @property {string} id
 * @property {string} permitId
 * @property {PermitDocumentType} documentType
 * @property {'issued'|'renewed'|'revalidated'} eventType
 * @property {string} description
 * @property {string} occurredAt - ISO 8601
 * @property {string} [performedBy]
 */

/**
 * Payload de renovación (skill.md §"RENOVACIÓN"). No borra el historial
 * anterior: el servicio agrega un evento nuevo y conserva los previos.
 * @typedef {Object} RenewPermitPayload
 * @property {string} number
 * @property {string} issuedAt - ISO 8601
 * @property {string} expiresAt - ISO 8601
 * @property {{name: string, url: string}|null} [supportDocument]
 */

export {};
