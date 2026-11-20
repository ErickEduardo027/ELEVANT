import type { OperationDocumentKind } from '@elevant/api-client';
import type { FlightReportOutboxItem } from '../../synchronization/flight-report-outbox';
import { missingFlightData, orderFlightDataWarning, type FlightDataNumbers } from '../../utils/flight-data';

/**
 * The tablet's own reasons not to hand an operation off to OCC yet (3-N06, N1), as Problem Details style codes so the
 * screens explain them in Spanish: something the agent recorded is still on the device or was refused, the Service
 * Order is not signed on its current content by the airline and AVIAM, the checklist has not reached ELEVANT, or an
 * incident report is still on the device. The server does not refuse such a hand-off for the queue, the signatures or
 * the incidents (the deployed APK keeps working); this version simply never sends it.
 */
export const HANDOFF_PENDING_QUEUE = 'pending_queue';
export const HANDOFF_SERVICE_ORDER_UNSIGNED = 'service_order_unsigned';
export const HANDOFF_CHECKLIST_NOT_SUBMITTED = 'checklist_not_submitted';
export const HANDOFF_PENDING_INCIDENTS = 'pending_incidents';

const HANDOFF_HOLDS: ReadonlySet<string> = new Set([
  HANDOFF_PENDING_QUEUE,
  HANDOFF_SERVICE_ORDER_UNSIGNED,
  HANDOFF_CHECKLIST_NOT_SUBMITTED,
  HANDOFF_PENDING_INCIDENTS,
]);

/** Whether a refused hand-off names one of the tablet's own reasons to wait: the screen says «Entrega en espera». */
export function isHandoffHold(problemCode: string | undefined) {
  return problemCode !== undefined && HANDOFF_HOLDS.has(problemCode);
}

/** The one form whose signatures a new hand-off waits for (3-N06): the Service Order. */
export const HANDOFF_REQUIRED_FORM = 'ServiceOrder' satisfies OperationDocumentKind;

/**
 * Forms the hand-off does not wait for (N3, D-N3): the agent may still sign them, and OCC receives the operation
 * without them. The charter request is left as it is (D-N3), so it is not one of them.
 */
const OPTIONAL_FOR_HANDOFF: ReadonlySet<string> = new Set<OperationDocumentKind>(['FlightReport', 'BridgeChecklist']);

/** Whether a form's signatures do not condition the hand-off to OCC: the Flight Report and the bridge checklist. */
export function isOptionalForHandoff(kind: string) {
  return OPTIONAL_FOR_HANDOFF.has(kind);
}

type DocumentSignatures = Readonly<{
  kind: string;
  isFullySigned: boolean;
  staleRoles: readonly string[];
  /** The signatures on the current content. */
  signatures?: readonly unknown[];
  /** The flight data the form prints (S1); a form read without it is tolerated. */
  summary?: FlightDataNumbers | null;
}>;
type OperationForms = Readonly<{ documents: readonly DocumentSignatures[] }>;

/** Whether the operation's Service Order carries every signature it needs on its current content. */
export function isServiceOrderSigned(documents: OperationForms) {
  const order = documents.documents.find(item => item.kind === HANDOFF_REQUIRED_FORM);
  return Boolean(order && order.isFullySigned && order.staleRoles.length === 0);
}

/** The statuses a service ends in; ELEVANT takes the hand-off only once every service reached one. */
const FINISHED_SERVICE_STATUSES: ReadonlySet<string> = new Set(['Completed', 'NotPerformed', 'Exception']);

/** Whether a service ended: completed, not performed or in an exception. */
export function isServiceFinished(status: string) {
  return FINISHED_SERVICE_STATUSES.has(status);
}

/** Whether a submission of the operation's checklist waits in the device's queue (3-I). */
export function checklistQueuedFor(items: readonly FlightReportOutboxItem[], operationId: string) {
  return items.some(item => item.state === 'pending' && item.command.kind === 'checklistSubmit' &&
    item.command.operationId.toLowerCase() === operationId.toLowerCase());
}

/**
 * Whether flight data the agent saved waits in the device's queue (S1): the Service Order shows it once it reaches
 * ELEVANT. Data ELEVANT refused is not on its way; the card asks to correct it.
 */
export function flightDataQueuedFor(items: readonly FlightReportOutboxItem[], operationId: string) {
  return items.some(item => item.state === 'pending' && item.command.kind === 'flightData' &&
    item.command.operationId.toLowerCase() === operationId.toLowerCase());
}

/** The last read of the operation's checklist: from ELEVANT, or the copy the device saved when it had no signal. */
export type HandoffChecklistRead = Readonly<{ status: string; fromCache: boolean }>;

/**
 * Where the checklist stands for the hand-off (N1): sent to ELEVANT, its submission saved on the device, not sent, or
 * not known (not read, or a saved copy that says it is not sent: it may have reached ELEVANT since).
 */
export type ChecklistStanding = 'submitted' | 'queued' | 'not-submitted' | 'unknown';

export function checklistStanding(read: HandoffChecklistRead | null, queued: boolean): ChecklistStanding {
  // ELEVANT never takes a sent checklist back, so a saved copy that says it was sent is still right.
  if (read?.status === 'Submitted') return 'submitted';
  if (queued) return 'queued';
  if (!read || read.fromCache) return 'unknown';
  return 'not-submitted';
}

export type HandoffRequirementKind = 'services' | 'checklist' | 'incidents' | 'flightData' | 'serviceOrder' | 'queue';

/**
 * - `ok`: met.
 * - `missing`: not met yet.
 * - `unknown`: the tablet cannot tell now (not read, no signal, or still on its way); the service checks it again right
 *   before sending the hand-off.
 * - `warning`: met enough to hand off, but worth a look.
 */
export type HandoffRequirementState = 'ok' | 'missing' | 'unknown' | 'warning';

export type HandoffRequirement = Readonly<{
  kind: HandoffRequirementKind;
  /** What the hand-off needs, as the list names it: «Servicios terminados». */
  label: string;
  state: HandoffRequirementState;
  /** Whether it holds the hand-off now. Only a requirement the tablet knows is missing does. */
  blocking: boolean;
  /** Where it stands, in words the agent can act on; null when it is met. */
  detail: string | null;
  /** The local Problem Details code the service refuses the hand-off with for it, when it has one. */
  problemCode?: string;
}>;

export type HandoffRequirementsInput = Readonly<{
  /** The services as the agent left them on the device (3-I): a transition still in the queue counts as done. */
  services: readonly Readonly<{ status: string }>[];
  checklist: ChecklistStanding;
  /** The operation's incident reports still on the device, waiting or refused; null when they could not be read. */
  unsentIncidents: number | null;
  /** The last forms read for the operation; undefined before they are read. */
  documents: OperationForms | undefined;
  /** Flight data the agent saved still waits in the device's queue (`flightDataQueuedFor`). */
  flightDataQueued?: boolean;
  /** What of the operation is still in the device's queue, waiting or refused. */
  waitingRecords: number;
}>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Everything a new hand-off to OCC needs, in the order the close lists it (N1): the services, the checklist, the
 * incident reports, the flight data on the Service Order (S1), the signed Service Order and the records still in the
 * device's queue. A submission of the checklist that waits in the queue is covered by the queue's requirement, and
 * nothing the tablet cannot tell holds the hand-off. Missing flight data only warns (D-S1): it never holds.
 */
export function handoffRequirements(input: HandoffRequirementsInput): HandoffRequirement[] {
  const unfinished = input.services.filter(service => !isServiceFinished(service.status)).length;
  const services: HandoffRequirement = input.services.length === 0
    ? missing('services', 'Servicios terminados', 'La operación no tiene servicios; avisa a OCC.')
    : unfinished > 0
      ? missing('services', 'Servicios terminados', `Falta terminar ${plural(unfinished, 'servicio', 'servicios')}.`)
      : met('services', 'Servicios terminados');

  const checklistLabel = 'Checklist enviado';
  const checklist: HandoffRequirement = input.checklist === 'submitted'
    ? met('checklist', checklistLabel)
    : input.checklist === 'not-submitted'
      ? missing('checklist', checklistLabel, 'Sin enviar: ábrelo, complétalo y envíalo.', HANDOFF_CHECKLIST_NOT_SUBMITTED)
      : unknown('checklist', checklistLabel, input.checklist === 'queued'
        ? 'Envío guardado en el dispositivo: sale a ELEVANT con los registros por enviar.'
        : 'La tablet no pudo leerlo ahora; lo comprueba al entregar.');

  const incidentsLabel = 'Incidencias enviadas';
  const incidents: HandoffRequirement = input.unsentIncidents === null
    ? unknown('incidents', incidentsLabel, 'La tablet no pudo leerlas ahora; las comprueba al entregar.')
    : input.unsentIncidents > 0
      ? missing('incidents', incidentsLabel,
        `${plural(input.unsentIncidents, 'incidencia', 'incidencias')} sin enviar a ELEVANT: abre Incidencias.`,
        HANDOFF_PENDING_INCIDENTS)
      : met('incidents', incidentsLabel);

  // S1 (D-S1): what the Service Order prints of the flight data, as ELEVANT has it. A warning at most: the Order is
  // signed and handed off without the data when that is what the flight has, and the server has no rule for it.
  const flightDataLabel = 'Datos del vuelo completos';
  const order = input.documents?.documents.find(item => item.kind === HANDOFF_REQUIRED_FORM);
  const missingData = missingFlightData(order?.summary);
  const flightWarning = order && missingData ? orderFlightDataWarning(missingData, {
    signed: order.isFullySigned || (order.signatures?.length ?? 0) > 0,
    queued: input.flightDataQueued ?? false,
    // The close lists it only while the operation is in progress, when the card can still save the data.
    editable: true,
    handoff: true,
  }) : null;
  const flightData: HandoffRequirement = missingData === null
    ? unknown('flightData', flightDataLabel, 'La tablet aún no leyó los datos de la Orden de Servicio.')
    : flightWarning
      ? warning('flightData', flightDataLabel, flightWarning)
      : met('flightData', flightDataLabel);

  const orderLabel = 'Orden de Servicio firmada';
  const serviceOrder: HandoffRequirement = !input.documents
    ? unknown('serviceOrder', orderLabel, 'La tablet aún no leyó los formularios; la comprueba al entregar.')
    : isServiceOrderSigned(input.documents)
      ? met('serviceOrder', orderLabel)
      : missing('serviceOrder', orderLabel, 'Falta firmar la Orden de Servicio (aerolínea y AVIAM).',
        HANDOFF_SERVICE_ORDER_UNSIGNED);

  const waiting = input.waitingRecords;
  const queue: HandoffRequirement = waiting > 0
    ? missing('queue', 'Registros enviados a ELEVANT',
      `${waiting === 1 ? 'Falta' : 'Faltan'} ${plural(waiting, 'registro', 'registros')} por enviar a ELEVANT: abre ` +
      'Sincronización.', HANDOFF_PENDING_QUEUE)
    : met('queue', 'Registros enviados a ELEVANT');

  return [services, checklist, incidents, flightData, serviceOrder, queue];
}

/** What holds a new hand-off now, in the order the close lists it. */
export function handoffHoldsFor(requirements: readonly HandoffRequirement[]) {
  return requirements.filter(requirement => requirement.blocking);
}

function met(kind: HandoffRequirementKind, label: string): HandoffRequirement {
  return { kind, label, state: 'ok', blocking: false, detail: null };
}

function missing(kind: HandoffRequirementKind, label: string, detail: string, problemCode?: string): HandoffRequirement {
  return { kind, label, state: 'missing', blocking: true, detail, ...(problemCode ? { problemCode } : {}) };
}

function unknown(kind: HandoffRequirementKind, label: string, detail: string): HandoffRequirement {
  return { kind, label, state: 'unknown', blocking: false, detail };
}

function warning(kind: HandoffRequirementKind, label: string, detail: string): HandoffRequirement {
  return { kind, label, state: 'warning', blocking: false, detail };
}
