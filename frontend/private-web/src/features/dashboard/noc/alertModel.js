// The priority of an operational notice (contratos 2.4, owner's decision): «Urgente» is any incident; «Atención» is a
// deviation, a flight the provider cancelled or diverted, an agent released, an operation left without an eligible
// agent, or a document or contract not in force; every other notice is a plain «Aviso». A presentation mapping over
// the notices the shell already reads (OperationalNotificationResponse): the notice carries no severity, and an
// incident is urgent whatever the severity it was reported with.

/** From the most to the least pressing. */
export const ALERT_PRIORITIES = Object.freeze(['urgent', 'attention', 'notice']);

const URGENT_KINDS = new Set(['incident_reported']);
const ATTENTION_KINDS = new Set([
  'deviation_reported',
  'flight_cancelled_by_provider',
  'flight_diverted_by_provider',
  'agent_released',
  'stand_change_unassigned',
  'agent_document_not_current',
  'contract_not_in_force',
]);

/** `urgent`, `attention` or `notice` for a notice kind; a kind this file does not know is a notice. */
export function alertPriority(kind) {
  if (URGENT_KINDS.has(kind)) return 'urgent';
  return ATTENTION_KINDS.has(kind) ? 'attention' : 'notice';
}

/** «Recibido» is the account's read receipt on the server: a notice with `readAt` was received. */
export function isReceived(item) {
  return item?.readAt != null;
}

/**
 * What the status bar says about the notices: how many urgent and attention alerts the account has not received, and
 * the highest priority among them (`null` when there is none). Plain notices never count as alerts.
 */
export function alertSummary(items = []) {
  let unreceivedCount = 0;
  let highest = null;
  for (const item of items ?? []) {
    if (isReceived(item)) continue;
    const priority = alertPriority(item?.kind);
    if (priority === 'notice') continue;
    unreceivedCount += 1;
    if (priority === 'urgent' || highest === null) highest = priority;
  }
  return { unreceivedCount, highest };
}
