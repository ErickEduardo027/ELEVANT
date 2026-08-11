import { getQualifications, getEquipmentCatalog } from './humanResourcesQualificationsService';
import { getPermits } from './humanResourcesPermitsService';
import { getUsers, getUserHistory } from './humanResourcesUsersService';
import { getShifts } from './humanResourcesSchedulesService';
import { mapQualifications, deriveEquipmentCoverage } from '../features/human-resources/certifications/mappers';
import { mapPermits } from '../features/human-resources/permits/mappers';

// Adaptador stub del módulo "Reportes de Gestión Humana": hoy combina los
// stores en memoria de Habilitaciones, Carnets, Usuarios y Horarios (cada
// uno ya expuesto por su propio servicio); mañana, cada función se conecta
// a su endpoint real sin que useReportsData/los componentes cambien — mismo
// contrato que reportsService.js (Admin/OCC).
//
// CONTRATO PROVISIONAL (ver ClaudeSkillsGH/plan-reportGH/skill.md):
//   GET  /api/hr/reports/expirations              (provisional)
//   GET  /api/hr/reports/account-movements         (provisional)
//   GET  /api/hr/reports/staff-distribution        (provisional)
//   GET  /api/hr/reports/qualification-coverage    (provisional)
//   POST /api/hr/reports/export                    (provisional)
//
// Ningún reporte inventa datos nuevos: cada uno reutiliza el store/mapper ya
// existente de su dominio (no se duplica la regla de "próxima a vencer" de
// Habilitaciones/Carnets, ni el cálculo de cobertura de Habilitaciones).

const EXPIRATION_KIND_META = {
  certification: { label: 'Habilitación', modulePath: '/human-resources/certifications' },
  permit: { label: 'Carnet / Licencia', modulePath: '/human-resources/permits' },
};

function toExpirationRow(item, kind) {
  const meta = EXPIRATION_KIND_META[kind];
  return {
    id: `${kind}-${item.id}`,
    agentName: item.agentName,
    documentLabel: kind === 'certification' ? item.equipmentName : item.typeLabel,
    kind,
    kindLabel: meta.label,
    terminals: item.terminals,
    dueDate: item.record.expiresAt,
    daysRemaining: item.daysRemaining,
    dueLabel: item.dueLabel,
    status: item.status,
    statusLabel: item.statusLabel,
    statusTone: item.statusTone,
    modulePath: meta.modulePath,
  };
}

/**
 * Reporte 1 — Vencimientos: consolida Habilitaciones y Carnets/Licencias.
 * `filters.documentKind` ('certification'|'permit'), `filters.status`
 * ('current'|'expiringSoon'|'expired') y `filters.terminal` ('A'|'B') son
 * opcionales. Orden por defecto: por urgencia (días restantes ascendente).
 */
export async function getExpirationReport(filters = {}) {
  const now = new Date();
  const [qualifications, permits] = await Promise.all([getQualifications(), getPermits()]);

  const rows = [
    ...mapQualifications(qualifications, now).map(item => toExpirationRow(item, 'certification')),
    ...mapPermits(permits, now).map(item => toExpirationRow(item, 'permit')),
  ]
    .filter(row => !filters.documentKind || row.kind === filters.documentKind)
    .filter(row => !filters.status || row.status === filters.status)
    .filter(row => !filters.terminal || row.terminals.includes(filters.terminal))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  return { rows };
}

const ACCOUNT_MOVEMENT_EVENT_META = {
  account_activated: { label: 'Alta / Activación', kind: 'alta' },
  account_reactivated: { label: 'Alta / Activación', kind: 'alta' },
  account_disabled: { label: 'Baja / Desactivación', kind: 'baja' },
};

function inDateRange(isoString, dateFrom, dateTo) {
  const dateKey = isoString.slice(0, 10);
  if (dateFrom && dateKey < dateFrom) return false;
  if (dateTo && dateKey > dateTo) return false;
  return true;
}

/**
 * Reporte 2 — Altas y bajas: cruza usuarios con su historial de cuenta.
 * `filters.dateFrom`/`filters.dateTo` (YYYY-MM-DD) filtran por la fecha del
 * movimiento; ambos opcionales. Orden por defecto: más reciente primero.
 */
export async function getAccountMovementsReport(filters = {}) {
  const users = await getUsers();
  const historiesByUser = await Promise.all(users.map(user => getUserHistory(user.identity.id)));

  const rows = users
    .flatMap((user, index) =>
      historiesByUser[index]
        .filter(event => ACCOUNT_MOVEMENT_EVENT_META[event.action])
        .filter(event => inDateRange(event.occurredAt, filters.dateFrom, filters.dateTo))
        .map(event => ({
          id: event.id,
          userName: `${user.identity.firstName} ${user.identity.lastName}`,
          movement: ACCOUNT_MOVEMENT_EVENT_META[event.action].label,
          movementKind: ACCOUNT_MOVEMENT_EVENT_META[event.action].kind,
          occurredAt: event.occurredAt,
          roleName: user.access.roleName,
          performedBy: event.actorName,
        }))
    )
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  return { rows };
}

/**
 * Reporte 3 — Personal por terminal y turno: una fila por turno asignado
 * (no por agente único) — así "cuántos turnos se cubrieron en Terminal B de
 * madrugada" es una métrica bien definida, sin inventar una regla de
 * deduplicación no pedida por el brief.
 */
export async function getStaffDistributionReport(filters = {}) {
  const shifts = await getShifts();

  const rows = shifts
    .filter(shift => !filters.terminal || shift.terminal === filters.terminal)
    .filter(shift => !filters.shiftBlock || shift.block === filters.shiftBlock)
    .map(shift => ({
      id: shift.id,
      agentName: shift.agentName,
      terminal: shift.terminal,
      block: shift.block,
      date: shift.date,
    }));

  return { rows };
}

/**
 * Simula la generación de un reporte en el backend (mismo mock de latencia
 * que exportReport de Admin/OCC).
 */
export async function exportReport({ reportId, format }) {
  await new Promise(resolve => setTimeout(resolve, 900));
  return {
    reportId,
    format,
    fileName: `${reportId}-${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : 'pdf'}`,
    generatedAt: new Date().toISOString(),
  };
}
