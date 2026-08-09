// Documentación de forma (JSDoc) del dominio "Gestión de usuarios y
// cuentas". El proyecto aún no usa TypeScript ni un contrato OpenAPI para
// este dominio; estos typedefs describen la respuesta/payload que se espera
// de un futuro backend, siguiendo el modelo conceptual identidad/cuenta/
// acceso (ver ClaudeSkillsGH/plan-acounts_users/skill.md), para que el mock
// y el consumidor evolucionen sin ambigüedad.
//
// NINGÚN campo de este archivo representa una contraseña o secreto: el
// flujo de credenciales se resuelve por invitación/activación en backend
// (ver AccessCredentials más abajo).

/**
 * @typedef {'admin_occ'|'contracts'|'human_resources'|'finance'|'ramp_agent'|'airline_client'} UserType
 */

/**
 * @typedef {'back_office'|'ramp_mobile_app'|'airline_portal'} PortalId
 */

/**
 * @typedef {'active'|'pending_activation'|'invitation_sent'|'disabled'|'blocked'} AccountStatus
 */

/**
 * @typedef {'not_sent'|'sent'|'expired'|'accepted'} InvitationStatus
 */

/**
 * IDENTIDAD — quién es la persona. No incluye credenciales.
 * @typedef {Object} UserIdentity
 * @property {string} id
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} email
 * @property {string} phone
 * @property {string} identificationType - p. ej. "Cédula", "Pasaporte"
 * @property {string} identificationNumber
 * @property {string|null} avatarUrl
 */

/**
 * CUENTA — si posee acceso y en qué estado está.
 * @typedef {Object} UserAccount
 * @property {string} id
 * @property {string} userId
 * @property {AccountStatus} status
 * @property {string} createdAt - ISO 8601
 * @property {string|null} lastLoginAt - ISO 8601
 * @property {InvitationStatus} invitationStatus
 * @property {string|null} invitationSentAt - ISO 8601
 */

/**
 * ACCESO — a qué portal y con qué rol/permisos.
 * @typedef {Object} UserAccess
 * @property {PortalId} portal
 * @property {string} roleId
 * @property {string} roleName
 * @property {string[]} permissions - etiquetas heredadas del rol (RBAC), no editables una por una desde este frontend
 */

/**
 * @typedef {Object} BackOfficeProfile - Administrador/OCC, Contratos, Finanzas, Gestión Humana
 * @property {string} department
 * @property {string} position
 * @property {string} [accessLevel]
 */

/**
 * @typedef {Object} RampAgentProfile
 * @property {string} employeeNumber
 * @property {('A'|'B')[]} terminals
 * @property {string} category
 * @property {string} hireDate - ISO 8601
 * @property {string|null} supervisorName
 */

/**
 * @typedef {Object} AirlineClientProfile
 * @property {string} airlineId
 * @property {string} contactPosition
 */

/**
 * Catálogo PROVISIONAL de aerolíneas. Cuando exista el módulo/servicio de
 * Contratos, este catálogo debe reemplazarse por el suyo (no duplicar).
 * @typedef {Object} Airline
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} Role
 * @property {string} id
 * @property {string} name
 * @property {UserType} userType
 * @property {PortalId} portal
 * @property {string[]} permissions
 */

/**
 * Registro completo tal como lo devuelve (o devolverá) el backend.
 * @typedef {Object} UserRecord
 * @property {UserIdentity} identity
 * @property {UserAccount} account
 * @property {UserAccess} access
 * @property {UserType} userType
 * @property {BackOfficeProfile} [backOffice]
 * @property {RampAgentProfile} [rampAgent]
 * @property {AirlineClientProfile} [airlineClient]
 */

/**
 * Fila aplanada para la tabla — derivada de UserRecord por mappers.js, no
 * almacenada así en el backend.
 * @typedef {Object} UserListItem
 * @property {string} id
 * @property {string} fullName
 * @property {string} email
 * @property {string} identificationNumber
 * @property {UserType} userType
 * @property {string} userTypeLabel
 * @property {PortalId} portal
 * @property {string} portalLabel
 * @property {string} roleName
 * @property {string|null} stationOrDepartmentLabel - estación/departamento/aerolínea vinculada, según tipo
 * @property {AccountStatus} status
 * @property {string} statusLabel
 * @property {string} statusTone
 * @property {string} createdAt
 * @property {string|null} lastLoginAt
 * @property {UserRecord} record - registro completo, para abrir detalle/edición sin otra llamada
 */

/**
 * @typedef {Object} AccountHistoryEvent
 * @property {string} id
 * @property {'account_created'|'invitation_sent'|'account_activated'|'role_changed'|'portal_changed'|'account_disabled'|'account_reactivated'|'access_reset'} action
 * @property {string} actorName - usuario responsable de la acción
 * @property {string} occurredAt - ISO 8601
 * @property {string} [detail]
 */

/**
 * Payload de creación. `sendInvitation` es la única vía de credenciales
 * soportada desde este frontend — nunca se envía una contraseña.
 * @typedef {Object} CreateUserPayload
 * @property {UserType} userType
 * @property {Omit<UserIdentity, 'id'|'avatarUrl'>} identity
 * @property {{roleId: string}} access
 * @property {BackOfficeProfile} [backOffice]
 * @property {RampAgentProfile} [rampAgent]
 * @property {AirlineClientProfile} [airlineClient]
 * @property {true} sendInvitation
 */

/**
 * @typedef {Object} UpdateUserPayload
 * @property {Partial<Omit<UserIdentity, 'id'>>} [identity]
 * @property {{roleId?: string}} [access]
 * @property {BackOfficeProfile} [backOffice]
 * @property {RampAgentProfile} [rampAgent]
 * @property {AirlineClientProfile} [airlineClient]
 */

/**
 * @typedef {Object} DeactivateAccountPayload
 * @property {string} [reason]
 */

export {};
