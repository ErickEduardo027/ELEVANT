import type { OperationDocumentKind } from '@elevant/api-client';

/**
 * The tablet's own reasons not to hand an operation off to OCC yet (3-N06), as Problem Details style codes so the
 * screens explain them in Spanish: something the agent recorded is still on the device or was refused, or the Service
 * Order is not signed on its current content by the airline and AVIAM. The server does not refuse such a hand-off (the
 * deployed APK keeps working); this version simply never sends it.
 */
export const HANDOFF_PENDING_QUEUE = 'pending_queue';
export const HANDOFF_SERVICE_ORDER_UNSIGNED = 'service_order_unsigned';

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

type DocumentSignatures = Readonly<{ kind: string; isFullySigned: boolean; staleRoles: readonly string[] }>;

/** Whether the operation's Service Order carries every signature it needs on its current content. */
export function isServiceOrderSigned(documents: Readonly<{ documents: readonly DocumentSignatures[] }>) {
  const order = documents.documents.find(item => item.kind === HANDOFF_REQUIRED_FORM);
  return Boolean(order && order.isFullySigned && order.staleRoles.length === 0);
}
