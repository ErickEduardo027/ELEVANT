import { FLIGHT_REPORT_MILESTONES } from '@elevant/api-client';
import { billingUnitLabel } from '../../services/billingUnits';

/**
 * Spanish labels of the codes OCC reads in Revisión and Planificación (3-N22). The API sends every state as its enum
 * name (`PendingReview`, `NotOk`, `Safety`, `BLOCK_ON`…); the screens translate it here and nowhere else. A code this
 * module does not know is shown as «Otro (código)», never as a raw English word. The backend labels of the reports
 * (phase 3, block E) copy these same texts.
 *
 * Outside the English scope every label is Spanish; in English the known codes are spelled out from their name.
 */

/** State of a ground operation (`GroundOperationStatus`). */
export const OPERATION_STATUS_LABELS = Object.freeze({
  Planned: 'Planificada',
  Assigned: 'Asignada',
  InProgress: 'En curso',
  PendingReview: 'Pendiente de revisión',
  InReview: 'En revisión',
  Approved: 'Aprobada',
  Returned: 'Devuelta',
  Cancelled: 'Cancelada',
});

/** State of a hand-off to OCC and outcome of its decision (`SubmissionStatus`, `ReviewOutcome`). */
export const SUBMISSION_STATUS_LABELS = Object.freeze({
  PendingReview: 'Pendiente',
  InReview: 'En revisión',
  Approved: 'Aprobada',
  Returned: 'Devuelta',
});

/** State of an executed service (`ServiceExecutionStatus`). */
export const SERVICE_STATUS_LABELS = Object.freeze({
  Planned: 'Planificado',
  InProgress: 'En curso',
  Completed: 'Completado',
  NotPerformed: 'No realizado',
  Exception: 'Con excepción',
});

/** State of the operation's checklist (`ChecklistStatus`). */
export const CHECKLIST_STATUS_LABELS = Object.freeze({
  NotStarted: 'Sin iniciar',
  InProgress: 'En curso',
  Submitted: 'Enviado',
});

/** Answer to a checklist item (`ChecklistAnswerValue`). */
export const CHECKLIST_ANSWER_LABELS = Object.freeze({
  Ok: 'Conforme',
  NotOk: 'No conforme',
  NotApplicable: 'No aplica',
});

/** Type of an incident, with the texts of the tablet (ADR-0031: a deviation carries its IATA delay code). */
export const INCIDENT_TYPE_LABELS = Object.freeze({
  Operational: 'Operativa',
  Safety: 'Seguridad',
  Equipment: 'Equipo',
  Documentation: 'Documentación',
  Deviation: 'Desviación',
});

export const INCIDENT_SEVERITY_LABELS = Object.freeze({
  Low: 'Baja',
  Medium: 'Media',
  High: 'Alta',
  Critical: 'Crítica',
});

export const INCIDENT_STATUS_LABELS = Object.freeze({
  Open: 'Abierta',
  InReview: 'En revisión',
  Resolved: 'Resuelta',
  Closed: 'Cerrada',
});

/** Who marked a charge on a service (ADR-0034). */
export const CHARGE_SOURCE_LABELS = Object.freeze({
  Agent: 'Agente',
  Automatic: 'Automático',
  Occ: 'OCC',
});

/** State of a ground equipment asset as the planning board lists it. */
export const EQUIPMENT_STATUS_LABELS = Object.freeze({
  Available: 'Disponible',
  Assigned: 'Asignado',
  InUse: 'En uso',
  Maintenance: 'En mantenimiento',
  OutOfService: 'Fuera de servicio',
  Inactive: 'Inactivo',
});

/** State of the Service Order OCC approves (3-N02). */
export const SERVICE_ORDER_STATE_LABELS = Object.freeze({
  Signed: 'Firmada',
  Corrected: 'Corregida por OCC',
  Stale: 'Firma desactualizada',
  Unsigned: 'Sin firmar',
});

const MILESTONE_LABELS = Object.freeze(Object.fromEntries(FLIGHT_REPORT_MILESTONES.map(item => [item.code, item.label])));

const text = value => (typeof value === 'string' ? value.trim() : '');

/** «PendingReview» → «Pending review», «BLOCK_ON» → «Block on». */
function spelledOut(code) {
  const words = code.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The label of `code` in `labels`: «Otro (código)» when it is unknown, an empty text when there is no code.
 * @param {Readonly<Record<string, string>>} labels
 * @param {unknown} code
 * @param {string} [language]
 */
export function labelOf(labels, code, language = 'es') {
  const value = text(code);
  if (!value) return '';
  if (!Object.hasOwn(labels, value)) return language === 'en' ? `Other (${value})` : `Otro (${value})`;
  return language === 'en' ? spelledOut(value) : labels[value];
}

export const operationStatusLabel = (code, language) => labelOf(OPERATION_STATUS_LABELS, code, language);
export const submissionStatusLabel = (code, language) => labelOf(SUBMISSION_STATUS_LABELS, code, language);
export const serviceStatusLabel = (code, language) => labelOf(SERVICE_STATUS_LABELS, code, language);
export const checklistStatusLabel = (code, language) => labelOf(CHECKLIST_STATUS_LABELS, code, language);
export const checklistAnswerLabel = (code, language) => labelOf(CHECKLIST_ANSWER_LABELS, code, language);
export const incidentTypeLabel = (code, language) => labelOf(INCIDENT_TYPE_LABELS, code, language);
export const incidentSeverityLabel = (code, language) => labelOf(INCIDENT_SEVERITY_LABELS, code, language);
export const incidentStatusLabel = (code, language) => labelOf(INCIDENT_STATUS_LABELS, code, language);
export const chargeSourceLabel = (code, language) => labelOf(CHARGE_SOURCE_LABELS, code, language);
export const equipmentStatusLabel = (code, language) => labelOf(EQUIPMENT_STATUS_LABELS, code, language);
export const serviceOrderStateLabel = (code, language) => labelOf(SERVICE_ORDER_STATE_LABELS, code, language);

/** A Flight Report milestone (`BLOCK_ON` → «Bloqueo»), with the label of the tablet's catalog. */
export const milestoneLabel = (code, language) => labelOf(MILESTONE_LABELS, code, language);

/**
 * The billing unit of a service, as Finance names it («operación», «hora»…); a unit Finance created and this screen
 * does not list is shown as it is.
 * @param {unknown} unit
 * @param {Array<{ code: string, name: string }>} [units]
 */
export function unitLabel(unit, units = []) {
  return billingUnitLabel(text(unit), units);
}
