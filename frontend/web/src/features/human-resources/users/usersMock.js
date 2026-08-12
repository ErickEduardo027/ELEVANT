// Datos mock del dominio "Gestión de usuarios y cuentas", consumidos
// EXCLUSIVAMENTE a través de humanResourcesUsersService (ver ese archivo
// para el detalle de qué endpoint provisional sustituye a cada función).
// Ningún componente debe importar este archivo directamente.
//
// Cada registro respeta el modelo conceptual identidad/cuenta/acceso del
// skill.md: `identity` (quién es), `account` (estado de la cuenta) y
// `access` (portal/rol/permisos), más el bloque específico de su tipo de
// usuario (backOffice | rampAgent | airlineClient).

export const ROLES_MOCK = [
  { id: 'role-admin-occ', name: 'Administrador OCC', userType: 'admin_occ', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar', 'Aprobar', 'Exportar', 'Administrar'] },
  { id: 'role-analista-occ', name: 'Analista OCC', userType: 'admin_occ', portal: 'back_office', permissions: ['Consultar', 'Editar', 'Exportar'] },
  { id: 'role-contratos', name: 'Gestor de Contratos', userType: 'contracts', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar', 'Exportar'] },
  { id: 'role-finanzas', name: 'Analista de Finanzas', userType: 'finance', portal: 'back_office', permissions: ['Consultar', 'Editar', 'Exportar'] },
  { id: 'role-rrhh-admin', name: 'Administrador de Gestión Humana', userType: 'human_resources', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar', 'Administrar'] },
  { id: 'role-rrhh-generalista', name: 'Generalista de Gestión Humana', userType: 'human_resources', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar'] },
  { id: 'role-agente-rampa', name: 'Agente de Rampa', userType: 'ramp_agent', portal: 'ramp_mobile_app', permissions: ['Consultar', 'Crear'] },
  { id: 'role-usuario-aerolinea', name: 'Usuario de Aerolínea', userType: 'airline_client', portal: 'airline_portal', permissions: ['Consultar', 'Exportar'] },
];

// PROVISIONAL: catálogo mínimo de aerolíneas para poblar el selector del
// formulario de "Cliente / Aerolínea". Cuando exista el servicio real del
// módulo Contratos, `getAirlines()` en humanResourcesUsersService debe
// consumir ese catálogo compartido en lugar de este arreglo — no duplicar
// aerolíneas entre módulos.
export const AIRLINES_MOCK = [
  { id: 'al-1', name: 'American Airlines' },
  { id: 'al-2', name: 'Copa Airlines' },
  { id: 'al-3', name: 'LATAM Airlines' },
  { id: 'al-4', name: 'Arajet' },
  { id: 'al-5', name: 'JetBlue' },
];

function roleFor(roleId) {
  const role = ROLES_MOCK.find(item => item.id === roleId);
  return { portal: role.portal, roleId: role.id, roleName: role.name, permissions: role.permissions };
}

export const USERS_MOCK = [
  {
    identity: { id: 'u-1', firstName: 'Laura', lastName: 'Fernández', email: 'laura.fernandez@elevant.com', phone: '+1 809-555-0110', identificationType: 'Cédula', identificationNumber: '001-1234567-1', avatarUrl: null },
    account: { id: 'acc-1', userId: 'u-1', status: 'active', createdAt: '2025-11-04T09:00:00.000Z', lastLoginAt: '2026-08-08T14:20:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-11-04T09:05:00.000Z' },
    access: roleFor('role-admin-occ'),
    userType: 'admin_occ',
    backOffice: { department: 'Operaciones OCC', position: 'Supervisora OCC', accessLevel: 'Avanzado' },
  },
  {
    identity: { id: 'u-2', firstName: 'Miguel Ángel', lastName: 'Torres', email: 'miguel.torres@elevant.com', phone: '+1 809-555-0111', identificationType: 'Cédula', identificationNumber: '001-1234567-2', avatarUrl: null },
    account: { id: 'acc-2', userId: 'u-2', status: 'active', createdAt: '2025-12-10T09:00:00.000Z', lastLoginAt: '2026-08-07T08:05:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-12-10T09:05:00.000Z' },
    access: roleFor('role-analista-occ'),
    userType: 'admin_occ',
    backOffice: { department: 'Operaciones OCC', position: 'Analista OCC', accessLevel: 'Estándar' },
  },
  {
    identity: { id: 'u-3', firstName: 'Ricardo', lastName: 'Espinal', email: 'ricardo.espinal@elevant.com', phone: '+1 809-555-0112', identificationType: 'Cédula', identificationNumber: '001-1234567-3', avatarUrl: null },
    account: { id: 'acc-3', userId: 'u-3', status: 'disabled', createdAt: '2025-06-02T09:00:00.000Z', lastLoginAt: '2026-05-14T11:40:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-06-02T09:05:00.000Z' },
    access: roleFor('role-analista-occ'),
    userType: 'admin_occ',
    backOffice: { department: 'Operaciones OCC', position: 'Analista OCC', accessLevel: 'Estándar' },
  },
  {
    identity: { id: 'u-4', firstName: 'Yolanda', lastName: 'Peña', email: 'yolanda.pena@elevant.com', phone: '+1 809-555-0113', identificationType: 'Cédula', identificationNumber: '001-1234567-4', avatarUrl: null },
    account: { id: 'acc-4', userId: 'u-4', status: 'active', createdAt: '2026-01-20T09:00:00.000Z', lastLoginAt: '2026-08-06T16:00:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2026-01-20T09:05:00.000Z' },
    access: roleFor('role-contratos'),
    userType: 'contracts',
    backOffice: { department: 'Contratos', position: 'Analista de Contratos' },
  },
  {
    identity: { id: 'u-5', firstName: 'Esteban', lastName: 'Vargas', email: 'esteban.vargas@elevant.com', phone: '+1 809-555-0114', identificationType: 'Cédula', identificationNumber: '001-1234567-5', avatarUrl: null },
    account: { id: 'acc-5', userId: 'u-5', status: 'active', createdAt: '2025-09-15T09:00:00.000Z', lastLoginAt: '2026-08-05T09:30:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-09-15T09:05:00.000Z' },
    access: roleFor('role-contratos'),
    userType: 'contracts',
    backOffice: { department: 'Contratos', position: 'Coordinador de Contratos' },
  },
  {
    identity: { id: 'u-6', firstName: 'Patricia', lastName: 'Gómez', email: 'patricia.gomez@elevant.com', phone: '+1 809-555-0115', identificationType: 'Cédula', identificationNumber: '001-1234567-6', avatarUrl: null },
    account: { id: 'acc-6', userId: 'u-6', status: 'active', createdAt: '2025-08-11T09:00:00.000Z', lastLoginAt: '2026-08-08T07:50:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-08-11T09:05:00.000Z' },
    access: roleFor('role-finanzas'),
    userType: 'finance',
    backOffice: { department: 'Finanzas', position: 'Analista Financiera' },
  },
  {
    identity: { id: 'u-7', firstName: 'Julio César', lastName: 'Mena', email: 'julio.mena@elevant.com', phone: '+1 809-555-0116', identificationType: 'Cédula', identificationNumber: '001-1234567-7', avatarUrl: null },
    account: { id: 'acc-7', userId: 'u-7', status: 'pending_activation', createdAt: '2026-08-04T09:00:00.000Z', lastLoginAt: null, invitationStatus: 'sent', invitationSentAt: '2026-08-04T09:10:00.000Z' },
    access: roleFor('role-finanzas'),
    userType: 'finance',
    backOffice: { department: 'Finanzas', position: 'Contador' },
  },
  {
    identity: { id: 'u-8', firstName: 'Daniela', lastName: 'Castillo', email: 'daniela.castillo@elevant.com', phone: '+1 809-555-0117', identificationType: 'Cédula', identificationNumber: '001-1234567-8', avatarUrl: null },
    account: { id: 'acc-8', userId: 'u-8', status: 'active', createdAt: '2025-05-19T09:00:00.000Z', lastLoginAt: '2026-08-08T10:15:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-05-19T09:05:00.000Z' },
    access: roleFor('role-rrhh-generalista'),
    userType: 'human_resources',
    backOffice: { department: 'Gestión Humana', position: 'Generalista de RRHH' },
  },
  {
    identity: { id: 'u-9', firstName: 'Andrés Felipe', lastName: 'Ruiz', email: 'andres.ruiz@elevant.com', phone: '+1 809-555-0118', identificationType: 'Cédula', identificationNumber: '001-1234567-9', avatarUrl: null },
    account: { id: 'acc-9', userId: 'u-9', status: 'invitation_sent', createdAt: '2026-08-07T13:00:00.000Z', lastLoginAt: null, invitationStatus: 'sent', invitationSentAt: '2026-08-07T13:05:00.000Z' },
    access: roleFor('role-rrhh-generalista'),
    userType: 'human_resources',
    backOffice: { department: 'Gestión Humana', position: 'Reclutador' },
  },
  {
    identity: { id: 'u-10', firstName: 'Marisol', lastName: 'Jiménez', email: 'marisol.jimenez@elevant.com', phone: '+1 809-555-0119', identificationType: 'Cédula', identificationNumber: '001-1234567-10', avatarUrl: null },
    account: { id: 'acc-10', userId: 'u-10', status: 'active', createdAt: '2025-03-03T09:00:00.000Z', lastLoginAt: '2026-08-07T15:45:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-03-03T09:05:00.000Z' },
    access: roleFor('role-rrhh-admin'),
    userType: 'human_resources',
    backOffice: { department: 'Gestión Humana', position: 'Coordinadora de Nómina', accessLevel: 'Avanzado' },
  },
  {
    identity: { id: 'u-11', firstName: 'Kevin Alexander', lastName: 'Díaz', email: 'kevin.diaz@elevant.com', phone: '+1 809-555-0120', identificationType: 'Cédula', identificationNumber: '001-1234567-11', avatarUrl: null },
    account: { id: 'acc-11', userId: 'u-11', status: 'active', createdAt: '2024-10-01T09:00:00.000Z', lastLoginAt: '2026-08-09T05:30:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2024-10-01T09:05:00.000Z' },
    access: roleFor('role-agente-rampa'),
    userType: 'ramp_agent',
    rampAgent: { employeeNumber: 'RA-1042', terminals: ['A'], category: 'Rampero Senior', hireDate: '2024-09-16T00:00:00.000Z', supervisorName: 'Laura Fernández' },
  },
  {
    identity: { id: 'u-12', firstName: 'Rosa Elena', lastName: 'Guzmán', email: 'rosa.guzman@elevant.com', phone: '+1 809-555-0121', identificationType: 'Cédula', identificationNumber: '001-1234567-12', avatarUrl: null },
    account: { id: 'acc-12', userId: 'u-12', status: 'active', createdAt: '2025-02-18T09:00:00.000Z', lastLoginAt: '2026-08-09T06:10:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-02-18T09:05:00.000Z' },
    access: roleFor('role-agente-rampa'),
    userType: 'ramp_agent',
    rampAgent: { employeeNumber: 'RA-1077', terminals: ['B'], category: 'Rampero', hireDate: '2025-02-03T00:00:00.000Z', supervisorName: 'Laura Fernández' },
  },
  {
    identity: { id: 'u-13', firstName: 'Franklin', lastName: 'Ortiz', email: 'franklin.ortiz@elevant.com', phone: '+1 809-555-0122', identificationType: 'Cédula', identificationNumber: '001-1234567-13', avatarUrl: null },
    account: { id: 'acc-13', userId: 'u-13', status: 'pending_activation', createdAt: '2026-08-01T09:00:00.000Z', lastLoginAt: null, invitationStatus: 'sent', invitationSentAt: '2026-08-01T09:05:00.000Z' },
    access: roleFor('role-agente-rampa'),
    userType: 'ramp_agent',
    rampAgent: { employeeNumber: 'RA-1103', terminals: ['A', 'B'], category: 'Rampero', hireDate: '2026-07-28T00:00:00.000Z', supervisorName: 'Miguel Ángel Torres' },
  },
  {
    identity: { id: 'u-14', firstName: 'Yeimy', lastName: 'Santana', email: 'yeimy.santana@elevant.com', phone: '+1 809-555-0123', identificationType: 'Cédula', identificationNumber: '001-1234567-14', avatarUrl: null },
    account: { id: 'acc-14', userId: 'u-14', status: 'blocked', createdAt: '2025-01-12T09:00:00.000Z', lastLoginAt: '2026-07-02T18:22:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-01-12T09:05:00.000Z' },
    access: roleFor('role-agente-rampa'),
    userType: 'ramp_agent',
    rampAgent: { employeeNumber: 'RA-0991', terminals: ['A'], category: 'Rampero', hireDate: '2024-12-30T00:00:00.000Z', supervisorName: 'Laura Fernández' },
  },
  {
    identity: { id: 'u-15', firstName: 'Robert', lastName: 'Johnson', email: 'robert.johnson@aa.com', phone: '+1 305-555-0210', identificationType: 'Pasaporte', identificationNumber: 'P-88213456', avatarUrl: null },
    account: { id: 'acc-15', userId: 'u-15', status: 'active', createdAt: '2025-07-22T09:00:00.000Z', lastLoginAt: '2026-08-04T12:00:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-07-22T09:05:00.000Z' },
    access: roleFor('role-usuario-aerolinea'),
    userType: 'airline_client',
    airlineClient: { airlineId: 'al-1', contactPosition: 'Estación Manager' },
  },
  {
    identity: { id: 'u-16', firstName: 'Claudia', lastName: 'Beltrán', email: 'claudia.beltran@copaair.com', phone: '+507 555-0311', identificationType: 'Pasaporte', identificationNumber: 'P-77104521', avatarUrl: null },
    account: { id: 'acc-16', userId: 'u-16', status: 'active', createdAt: '2026-02-09T09:00:00.000Z', lastLoginAt: '2026-08-08T17:35:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2026-02-09T09:05:00.000Z' },
    access: roleFor('role-usuario-aerolinea'),
    userType: 'airline_client',
    airlineClient: { airlineId: 'al-2', contactPosition: 'Coordinadora de Operaciones' },
  },
  {
    identity: { id: 'u-17', firstName: 'Marco Antonio', lastName: 'Silva', email: 'marco.silva@latam.com', phone: '+56 555-0412', identificationType: 'Pasaporte', identificationNumber: 'P-65302198', avatarUrl: null },
    account: { id: 'acc-17', userId: 'u-17', status: 'disabled', createdAt: '2025-04-14T09:00:00.000Z', lastLoginAt: '2026-06-20T09:00:00.000Z', invitationStatus: 'accepted', invitationSentAt: '2025-04-14T09:05:00.000Z' },
    access: roleFor('role-usuario-aerolinea'),
    userType: 'airline_client',
    airlineClient: { airlineId: 'al-3', contactPosition: 'Supervisor de Rampa' },
  },
];

// Historial de auditoría por cuenta. Cada entrada respeta AccountHistoryEvent
// (ver src/types/humanResourcesUsers.js). Sirve tanto para el detalle de un
// usuario como base para el futuro módulo de "Trazabilidad / Auditoría".
export const ACCOUNT_HISTORY_MOCK = {
  'u-1': [
    { id: 'h-1-1', action: 'account_created', actorName: 'Camila Reyes', occurredAt: '2025-11-04T09:00:00.000Z' },
    { id: 'h-1-2', action: 'invitation_sent', actorName: 'Camila Reyes', occurredAt: '2025-11-04T09:05:00.000Z' },
    { id: 'h-1-3', action: 'account_activated', actorName: 'Laura Fernández', occurredAt: '2025-11-05T10:12:00.000Z' },
  ],
  'u-3': [
    { id: 'h-3-1', action: 'account_created', actorName: 'Camila Reyes', occurredAt: '2025-06-02T09:00:00.000Z' },
    { id: 'h-3-2', action: 'account_activated', actorName: 'Ricardo Espinal', occurredAt: '2025-06-03T08:40:00.000Z' },
    { id: 'h-3-3', action: 'account_disabled', actorName: 'Camila Reyes', occurredAt: '2026-05-20T11:10:00.000Z', detail: 'Cambio de área — pendiente de reasignación' },
  ],
  'u-7': [
    { id: 'h-7-1', action: 'account_created', actorName: 'Camila Reyes', occurredAt: '2026-08-04T09:00:00.000Z' },
    { id: 'h-7-2', action: 'invitation_sent', actorName: 'Camila Reyes', occurredAt: '2026-08-04T09:10:00.000Z' },
  ],
  'u-9': [
    { id: 'h-9-1', action: 'account_created', actorName: 'Camila Reyes', occurredAt: '2026-08-07T13:00:00.000Z' },
    { id: 'h-9-2', action: 'invitation_sent', actorName: 'Camila Reyes', occurredAt: '2026-08-07T13:05:00.000Z' },
  ],
  'u-13': [
    { id: 'h-13-1', action: 'account_created', actorName: 'Daniela Castillo', occurredAt: '2026-08-01T09:00:00.000Z' },
    { id: 'h-13-2', action: 'invitation_sent', actorName: 'Daniela Castillo', occurredAt: '2026-08-01T09:05:00.000Z' },
  ],
  'u-14': [
    { id: 'h-14-1', action: 'account_created', actorName: 'Camila Reyes', occurredAt: '2025-01-12T09:00:00.000Z' },
    { id: 'h-14-2', action: 'account_activated', actorName: 'Yeimy Santana', occurredAt: '2025-01-13T08:00:00.000Z' },
    { id: 'h-14-3', action: 'role_changed', actorName: 'Laura Fernández', occurredAt: '2025-09-02T14:30:00.000Z', detail: 'Rampero → Rampero (renovación de categoría)' },
    { id: 'h-14-4', action: 'account_disabled', actorName: 'Camila Reyes', occurredAt: '2026-07-03T09:15:00.000Z', detail: 'Bloqueo por incidente de seguridad en checkpoint' },
  ],
  'u-17': [
    { id: 'h-17-1', action: 'account_created', actorName: 'Camila Reyes', occurredAt: '2025-04-14T09:00:00.000Z' },
    { id: 'h-17-2', action: 'account_activated', actorName: 'Marco Antonio Silva', occurredAt: '2025-04-15T10:00:00.000Z' },
    { id: 'h-17-3', action: 'account_disabled', actorName: 'Camila Reyes', occurredAt: '2026-06-21T09:30:00.000Z', detail: 'Fin de contrato con la aerolínea' },
  ],
};

function defaultHistoryFor(record) {
  return [
    { id: `h-${record.identity.id}-created`, action: 'account_created', actorName: 'Camila Reyes', occurredAt: record.account.createdAt },
    { id: `h-${record.identity.id}-activated`, action: 'account_activated', actorName: record.identity.firstName, occurredAt: record.account.createdAt },
  ];
}

export function getAccountHistory(userId) {
  const record = USERS_MOCK.find(item => item.identity.id === userId);
  return ACCOUNT_HISTORY_MOCK[userId] ?? (record ? defaultHistoryFor(record) : []);
}
