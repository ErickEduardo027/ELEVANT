/**
 * The tablet's own reasons not to hand an operation off to OCC yet (3-N06), as Problem Details style codes so the
 * screens explain them in Spanish: something the agent recorded is still on the device or was refused, or the Service
 * Order is not signed on its current content by the airline and AVIAM. The server does not refuse such a hand-off (the
 * deployed APK keeps working); this version simply never sends it.
 */
export const HANDOFF_PENDING_QUEUE = 'pending_queue';
export const HANDOFF_SERVICE_ORDER_UNSIGNED = 'service_order_unsigned';

type DocumentSignatures = Readonly<{ kind: string; isFullySigned: boolean; staleRoles: readonly string[] }>;

/** Whether the operation's Service Order carries every signature it needs on its current content. */
export function isServiceOrderSigned(documents: Readonly<{ documents: readonly DocumentSignatures[] }>) {
  const order = documents.documents.find(item => item.kind === 'ServiceOrder');
  return Boolean(order && order.isFullySigned && order.staleRoles.length === 0);
}
