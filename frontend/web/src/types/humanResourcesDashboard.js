// Documentación de forma (JSDoc) del snapshot del Dashboard de Gestión
// Humana. El proyecto aún no usa TypeScript ni un contrato OpenAPI para
// este dominio; estos typedefs describen la respuesta que se espera de un
// futuro endpoint REST, para que el mock y el consumidor evolucionen sin
// ambigüedad.

/**
 * @typedef {Object} HRStaffBreakdown
 * @property {number} terminalA
 * @property {number} terminalB
 * @property {number} fbo
 * @property {number} unassigned
 */

/**
 * @typedef {Object} HRExpiration
 * @property {string} id
 * @property {string} agentName
 * @property {'certification'|'permit'} kind
 * @property {string} itemLabel - p. ej. "Belt Loader", "Carnet aeroportuario"
 * @property {string} dueDate - ISO 8601
 */

/**
 * @typedef {Object} HRPendingAccount
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} registeredAt - ISO 8601
 */

/**
 * @typedef {Object} HRActivityEvent
 * @property {string} id
 * @property {'account_activated'|'certification_registered'|'permit_updated'|'account_disabled'|'shift_changed'|'certification_renewed'} type
 * @property {string} description
 * @property {string} responsible
 * @property {string} occurredAt - ISO 8601
 */

/**
 * @typedef {Object} HRAvailabilityBreakdown
 * @property {number} available
 * @property {number} onShift
 * @property {number} absent
 * @property {number} unavailable
 * @property {number} unassigned
 */

/**
 * @typedef {Object} HRTerminalCoverage
 * @property {string} terminal
 * @property {number} coveragePercent
 */

/**
 * @typedef {Object} HumanResourcesDashboardSnapshot
 * @property {number} activeStaffTotal
 * @property {HRStaffBreakdown} activeStaffByTerminal
 * @property {{morning:number, afternoon:number, night:number}} staffByShift
 * @property {HRExpiration[]} expirations
 * @property {HRPendingAccount[]} pendingAccounts
 * @property {HRActivityEvent[]} activity
 * @property {{overallCoveragePercent:number, breakdown:HRAvailabilityBreakdown, byTerminal:HRTerminalCoverage[]}} availability
 */

export {};
