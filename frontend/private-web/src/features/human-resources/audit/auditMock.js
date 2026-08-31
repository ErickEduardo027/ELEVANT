import { USERS_MOCK } from '../users/usersMock';
import { AGENTS_MOCK, PERMITS_MOCK } from '../permits/permitsMock';
import { QUALIFICATIONS_MOCK } from '../certifications/certificationsMock';
import { CURRENT_USER_MOCK } from '../mockData';

function findUser(userId) {
  return USERS_MOCK.find(item => item.identity.id === userId);
}

function findAgent(agentId) {
  return AGENTS_MOCK.find(item => item.agentId === agentId);
}

function findPermit(permitId) {
  return PERMITS_MOCK.find(item => item.id === permitId);
}

function findQualification(qualificationId) {
  return QUALIFICATIONS_MOCK.find(item => item.id === qualificationId);
}

function isoDaysAgo(days, hours = 12, minutes = 0) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function buildEntry({
  id,
  occurredAt,
  actionType,
  actionLabel,
  category,
  affectedUserId,
  affectedUserName,
  executorName = CURRENT_USER_MOCK.name,
  detail,
  changes = [],
  ipAddress,
  device,
  critical = false,
  source,
}) {
  return {
    id,
    occurredAt,
    actionType,
    actionLabel,
    category,
    affectedUserId,
    affectedUserName,
    executorName,
    detail,
    changes,
    ...(ipAddress ? { ipAddress } : {}),
    ...(device ? { device } : {}),
    critical,
    source,
  };
}

const laura = findUser('u-1');
const miguel = findUser('u-2');
const daniela = findUser('u-8');
const marisol = findUser('u-10');
const kevin = findAgent('u-11');
const franklin = findAgent('u-13');
const yeimy = findAgent('u-14');
const maria = findAgent('u-18');
const luis = findAgent('u-19');
const juan = findAgent('u-20');

const licenciaKevin = findPermit('u-11-licencia');
const carnetFranklin = findPermit('u-13-carnet');
const qJuan = findQualification('q-14');

export const AUDIT_ENTRIES_MOCK = [
  buildEntry({
    id: 'audit-01',
    occurredAt: isoDaysAgo(0, 8, 12),
    actionType: 'account_created',
    actionLabel: 'Creación de cuenta',
    category: 'accounts',
    affectedUserId: 'u-18',
    affectedUserName: `${maria.agentName}`,
    executorName: laura ? `${laura.identity.firstName} ${laura.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Alta de cuenta para el nuevo agente de rampa y activación de acceso inicial.',
    changes: [
      { field: 'Estado de cuenta', previousValue: 'Sin cuenta', nextValue: 'Pendiente de activación' },
      { field: 'Rol', previousValue: 'Sin rol', nextValue: 'Agente de Rampa' },
    ],
    ipAddress: '10.12.4.21',
    device: 'Chrome / Windows 11',
    critical: true,
    source: 'users',
  }),
  buildEntry({
    id: 'audit-02',
    occurredAt: isoDaysAgo(0, 10, 25),
    actionType: 'account_activated',
    actionLabel: 'Activación de cuenta',
    category: 'accounts',
    affectedUserId: 'u-9',
    affectedUserName: 'Andrés Felipe Ruiz',
    executorName: marisol ? `${marisol.identity.firstName} ${marisol.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'La cuenta pasó a estado activo luego de validar correo institucional.',
    changes: [
      { field: 'Estado de cuenta', previousValue: 'Pendiente de activación', nextValue: 'Activa' },
      { field: 'Último acceso', previousValue: 'Nunca', nextValue: 'Pendiente' },
    ],
    ipAddress: '10.12.4.44',
    device: 'Safari / iPadOS',
    source: 'users',
  }),
  buildEntry({
    id: 'audit-03',
    occurredAt: isoDaysAgo(1, 14, 5),
    actionType: 'role_changed',
    actionLabel: 'Cambio de rol',
    category: 'roles',
    affectedUserId: 'u-7',
    affectedUserName: 'Julio César Mena',
    executorName: daniela ? `${daniela.identity.firstName} ${daniela.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Se reasignó el rol para reflejar el nuevo alcance operativo de la cuenta.',
    changes: [
      { field: 'Rol', previousValue: 'Analista de Finanzas', nextValue: 'Generalista de Gestión Humana' },
      { field: 'Permisos', previousValue: 'Consultar, Editar, Exportar', nextValue: 'Consultar, Crear, Editar' },
    ],
    critical: true,
    source: 'users',
  }),
  buildEntry({
    id: 'audit-04',
    occurredAt: isoDaysAgo(1, 16, 40),
    actionType: 'permissions_changed',
    actionLabel: 'Ajuste de permisos',
    category: 'roles',
    affectedUserId: 'u-4',
    affectedUserName: 'Yolanda Peña',
    executorName: laura ? `${laura.identity.firstName} ${laura.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Se redujo el acceso de edición sobre módulos fuera de Contratos.',
    changes: [
      { field: 'Permisos', previousValue: 'Consultar, Crear, Editar, Exportar', nextValue: 'Consultar, Crear, Editar' },
    ],
    source: 'users',
  }),
  buildEntry({
    id: 'audit-05',
    occurredAt: isoDaysAgo(2, 9, 55),
    actionType: 'user_updated',
    actionLabel: 'Edición de datos',
    category: 'accounts',
    affectedUserId: 'u-11',
    affectedUserName: kevin ? kevin.agentName : 'Kevin Alexander Díaz',
    executorName: miguel ? `${miguel.identity.firstName} ${miguel.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Actualización de datos de contacto y supervisor asignado.',
    changes: [
      { field: 'Correo', previousValue: 'kevin.diaz@old-mail.com', nextValue: 'kevin.diaz@elevant.com' },
      { field: 'Supervisor', previousValue: 'Laura Fernández', nextValue: 'Miguel Ángel Torres' },
    ],
    ipAddress: '10.12.5.8',
    device: 'Edge / Windows 11',
    critical: true,
    source: 'users',
  }),
  buildEntry({
    id: 'audit-06',
    occurredAt: isoDaysAgo(2, 11, 20),
    actionType: 'agent_assigned',
    actionLabel: 'Asignación operativa',
    category: 'assignments',
    affectedUserId: 'u-19',
    affectedUserName: luis ? luis.agentName : 'Luis Tavárez',
    executorName: laura ? `${laura.identity.firstName} ${laura.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Se asignó al agente a cobertura operativa en Terminal A.',
    changes: [
      { field: 'Terminal', previousValue: 'Sin asignación', nextValue: 'Terminal A' },
      { field: 'Posición', previousValue: 'No asignada', nextValue: 'Carga y soporte' },
    ],
    source: 'schedules',
  }),
  buildEntry({
    id: 'audit-07',
    occurredAt: isoDaysAgo(3, 15, 0),
    actionType: 'agent_unassigned',
    actionLabel: 'Remoción operativa',
    category: 'assignments',
    affectedUserId: 'u-14',
    affectedUserName: yeimy ? yeimy.agentName : 'Yeimy Santana',
    executorName: daniela ? `${daniela.identity.firstName} ${daniela.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'El agente fue removido de la cobertura por cierre de ciclo operativo.',
    changes: [
      { field: 'Terminal', previousValue: 'Terminal A', nextValue: 'Sin asignación' },
      { field: 'Vigencia', previousValue: 'Activa', nextValue: 'Suspendida' },
    ],
    critical: true,
    source: 'schedules',
  }),
  buildEntry({
    id: 'audit-08',
    occurredAt: isoDaysAgo(4, 8, 45),
    actionType: 'permit_renewed',
    actionLabel: 'Renovación de carnet',
    category: 'documents',
    affectedUserId: 'u-13',
    affectedUserName: franklin ? franklin.agentName : 'Franklin Ortiz',
    executorName: laura ? `${laura.identity.firstName} ${laura.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Renovación del carnet aeroportuario con verificación documental completa.',
    changes: [
      { field: 'Carnet', previousValue: carnetFranklin?.number ?? 'Vencido', nextValue: 'CARN-2026-0113' },
      { field: 'Vencimiento', previousValue: carnetFranklin?.expiresAt?.slice(0, 10) ?? '2026-07-20', nextValue: '2027-07-20' },
    ],
    ipAddress: '10.12.6.11',
    device: 'Chrome / Windows 11',
    source: 'permits',
  }),
  buildEntry({
    id: 'audit-09',
    occurredAt: isoDaysAgo(5, 12, 18),
    actionType: 'permit_renewed',
    actionLabel: 'Renovación de licencia',
    category: 'documents',
    affectedUserId: 'u-11',
    affectedUserName: kevin ? kevin.agentName : 'Kevin Alexander Díaz',
    executorName: marisol ? `${marisol.identity.firstName} ${marisol.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Renovación aprobada para la licencia de conducir en rampa.',
    changes: [
      { field: 'Licencia', previousValue: licenciaKevin?.number ?? 'LIC-RAMP-0211', nextValue: 'LIC-RAMP-0311' },
      { field: 'Soporte', previousValue: 'Adjunto anterior', nextValue: 'Licencia actualizada' },
    ],
    source: 'permits',
  }),
  buildEntry({
    id: 'audit-10',
    occurredAt: isoDaysAgo(7, 17, 10),
    actionType: 'qualification_renewed',
    actionLabel: 'Renovación de habilitación',
    category: 'documents',
    affectedUserId: 'u-20',
    affectedUserName: juan ? juan.agentName : 'Juan Pérez',
    executorName: laura ? `${laura.identity.firstName} ${laura.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'Renovación de habilitación en Puente de abordaje y registro del nuevo ciclo.',
    changes: [
      { field: 'Habilitación', previousValue: qJuan?.equipmentName ?? 'Puente de abordaje', nextValue: 'Puente de abordaje' },
      { field: 'Vencimiento', previousValue: qJuan?.expiresAt?.slice(0, 10) ?? '2027-05-05', nextValue: '2028-05-05' },
    ],
    source: 'certifications',
  }),
  buildEntry({
    id: 'audit-11',
    occurredAt: isoDaysAgo(11, 13, 5),
    actionType: 'account_disabled',
    actionLabel: 'Desactivación de cuenta',
    category: 'accounts',
    affectedUserId: 'u-17',
    affectedUserName: 'Marco Antonio Silva',
    executorName: CURRENT_USER_MOCK.name,
    detail: 'Cierre de acceso por finalización de relación comercial con la aerolínea.',
    changes: [
      { field: 'Estado de cuenta', previousValue: 'Activa', nextValue: 'Desactivada' },
      { field: 'Acceso', previousValue: 'Habilitado', nextValue: 'Revocado' },
    ],
    critical: true,
    source: 'users',
  }),
  buildEntry({
    id: 'audit-12',
    occurredAt: isoDaysAgo(14, 9, 30),
    actionType: 'account_activated',
    actionLabel: 'Reactivación de cuenta',
    category: 'accounts',
    affectedUserId: 'u-3',
    affectedUserName: 'Ricardo Espinal',
    executorName: laura ? `${laura.identity.firstName} ${laura.identity.lastName}` : CURRENT_USER_MOCK.name,
    detail: 'La cuenta fue reactivada luego de validar el cambio de área.',
    changes: [
      { field: 'Estado de cuenta', previousValue: 'Desactivada', nextValue: 'Activa' },
    ],
    source: 'users',
  }),
];
