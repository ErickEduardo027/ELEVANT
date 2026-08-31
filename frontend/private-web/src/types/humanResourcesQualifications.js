// Documentación de forma (JSDoc) del dominio "Habilitaciones y
// certificaciones". El proyecto aún no usa TypeScript ni un contrato OpenAPI
// para este dominio; estos typedefs describen la respuesta/payload que se
// espera de un futuro backend (ver ClaudeSkillsGH/plan-certification/skill.md),
// para que el mock y el consumidor evolucionen sin ambigüedad.
//
// El campo clave para integración futura con el módulo de Asignaciones es la
// tripleta (agentId, equipmentId, status/expiresAt): otros módulos podrán
// consultar "¿este agente está habilitado para operar este equipo?" a partir
// de estos mismos campos, sin que este módulo implemente esa validación.

/**
 * @typedef {'A'|'B'} Terminal
 */

/**
 * @typedef {'current'|'expiringSoon'|'expired'} QualificationStatus
 */

/**
 * @typedef {Object} EquipmentType
 * @property {string} id
 * @property {string} name
 */

/**
 * Registro completo tal como lo devuelve (o devolverá) el backend. `status`
 * no se persiste aquí: se deriva en el frontend a partir de `expiresAt` y una
 * ventana configurable (ver statusMeta.js), porque la regla de "próxima a
 * vencer" podrá cambiar o ser provista por la API más adelante.
 * @typedef {Object} AgentQualification
 * @property {string} id
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} employeeNumber
 * @property {Terminal[]} terminals
 * @property {string} equipmentId
 * @property {string} equipmentName
 * @property {string} trainingDate - ISO 8601, fecha de entrenamiento
 * @property {string} obtainedAt - ISO 8601, fecha de obtención del ciclo vigente
 * @property {string} expiresAt - ISO 8601
 * @property {string} certifyingEntity - p. ej. "ALC" (valor por defecto configurable, no fijo en UI)
 * @property {string} instructor
 * @property {string} [notes]
 * @property {{name: string, url: string}|null} supportDocument
 * @property {string} updatedAt - ISO 8601
 */

/**
 * Fila aplanada por habilitación — derivada de AgentQualification por
 * mappers.js, no almacenada así en el backend.
 * @typedef {Object} QualificationListItem
 * @property {string} id
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} employeeNumber
 * @property {Terminal[]} terminals
 * @property {string} equipmentId
 * @property {string} equipmentName
 * @property {QualificationStatus} status
 * @property {string} statusLabel
 * @property {string} statusTone
 * @property {number} daysRemaining
 * @property {string} dueLabel
 * @property {AgentQualification} record
 */

/**
 * Resumen por agente — agregado en el frontend a partir de
 * QualificationListItem[] (mismo patrón que deriveUserKpis/mapUserToListItem
 * en el dominio de usuarios). No es una entidad que el backend necesite
 * persistir; cuando exista un endpoint de resumen, este shape debe
 * mantenerse para no romper la tabla "Por agente".
 * @typedef {Object} AgentQualificationSummary
 * @property {string} agentId
 * @property {string} agentName
 * @property {string} employeeNumber
 * @property {Terminal[]} terminals
 * @property {number} activeCount
 * @property {number} expiringSoonCount
 * @property {number} expiredCount
 * @property {string|null} nextExpirationAt - ISO 8601 de la próxima habilitación en vencer
 * @property {'current'|'attention'|'action_required'} overallStatus
 * @property {string} overallStatusLabel
 * @property {string} overallStatusTone
 * @property {string} updatedAt - ISO 8601, más reciente entre sus habilitaciones
 * @property {QualificationListItem[]} qualifications
 */

/**
 * Cobertura operativa por tipo de equipo — agregado en el frontend a partir
 * de QualificationListItem[] + EquipmentType[]. Cuando exista un endpoint de
 * cobertura real, debe seguir devolviendo este shape.
 * @typedef {Object} EquipmentCoverage
 * @property {string} equipmentId
 * @property {string} equipmentName
 * @property {Terminal[]} terminals
 * @property {number} totalAgents
 * @property {number} activeCount
 * @property {number} expiringSoonCount
 * @property {number} expiredCount
 * @property {number|null} coveragePercent - porcentaje de habilitaciones vigentes sobre el total, si hay datos
 * @property {boolean} limitedCoverage
 * @property {QualificationListItem[]} qualifications
 */

/**
 * @typedef {Object} QualificationHistoryEvent
 * @property {string} id
 * @property {string} qualificationId
 * @property {'created'|'training_completed'|'renewed'|'revalidated'} eventType
 * @property {string} description
 * @property {string} occurredAt - ISO 8601
 * @property {string} [performedBy] - usuario responsable, cuando la API lo provea
 */

/**
 * Payload de registro de una nueva habilitación (skill.md §4).
 * @typedef {Object} CreateQualificationPayload
 * @property {string} agentId
 * @property {string} equipmentId
 * @property {string} trainingDate - ISO 8601
 * @property {string} obtainedAt - ISO 8601
 * @property {string} expiresAt - ISO 8601
 * @property {string} certifyingEntity
 * @property {string} instructor
 * @property {string} [notes]
 * @property {{name: string, url: string}|null} [supportDocument]
 */

/**
 * Payload de renovación (skill.md §5). No borra el historial anterior: el
 * servicio agrega un evento nuevo y conserva los previos.
 * @typedef {Object} RenewQualificationPayload
 * @property {string} obtainedAt - ISO 8601, nueva fecha de obtención/renovación
 * @property {string} expiresAt - ISO 8601
 * @property {string} certifyingEntity
 * @property {string} instructor
 * @property {string} [notes]
 * @property {{name: string, url: string}|null} [supportDocument]
 */

/**
 * @typedef {Object} UpdateQualificationPayload
 * @property {string} [trainingDate]
 * @property {string} [certifyingEntity]
 * @property {string} [instructor]
 * @property {string} [notes]
 * @property {{name: string, url: string}|null} [supportDocument]
 */

export {};
