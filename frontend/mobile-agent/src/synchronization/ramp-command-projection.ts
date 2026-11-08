import type { RampAssignedOperationResponse } from '@elevant/api-client';
import { pendingFor, type FlightReportOutboxItem } from './flight-report-outbox';

/**
 * An operation as the agent left it on the device (3-I): ELEVANT's view (from the network or the saved copy) with the
 * commands still waiting in the queue applied on top. The start in the queue shows the operation in progress from the
 * tapped time; each queued service transition shows its target status. A command ELEVANT refused is not applied: the
 * operation keeps ELEVANT's state and the refusal is reported so the screen explains it.
 */
export type ProjectedRampOperation = Readonly<{
  view: RampAssignedOperationResponse;
  /** The start waits on the device. */
  startOnDevice: boolean;
  /** The start ELEVANT refused, with its message, until the agent taps «Iniciar» again or discards it. */
  startRefused?: FlightReportOutboxItem;
  /** Services whose last transition waits on the device. */
  servicesOnDevice: ReadonlySet<string>;
  /** Services with a transition ELEVANT refused. */
  servicesRefused: ReadonlyMap<string, FlightReportOutboxItem>;
  /** Everything of the operation still on the device, and what ELEVANT refused (3-N06 blocks the hand-off). */
  pending: number;
  blocked: number;
}>;

export function projectRampOperation(
  view: RampAssignedOperationResponse,
  items: readonly FlightReportOutboxItem[],
): ProjectedRampOperation {
  const queue = pendingFor(items, view.operation.id);
  const start = queue.start;
  const startOnDevice = start?.state === 'pending' && view.operation.status === 'Assigned';
  const operation = startOnDevice && start.command.kind === 'start'
    ? { ...view.operation, status: 'InProgress', actualStartAt: start.command.occurredAt ?? start.createdAt }
    : view.operation;
  const servicesOnDevice = new Set<string>();
  const servicesRefused = new Map<string, FlightReportOutboxItem>();
  const services = view.services.map(service => {
    let projected = service;
    for (const item of queue.services.get(service.id.toLowerCase()) ?? []) {
      if (item.command.kind !== 'serviceTransition') continue;
      if (item.state === 'blocked') {
        servicesRefused.set(service.id, item);
        continue;
      }
      servicesOnDevice.add(service.id);
      projected = {
        ...projected,
        status: item.command.targetStatus,
        ...(item.command.executedQuantity === null ? {} : { executedQuantity: item.command.executedQuantity }),
      };
    }
    return projected;
  });
  return {
    view: { ...view, operation, services },
    startOnDevice,
    ...(start?.state === 'blocked' ? { startRefused: start } : {}),
    servicesOnDevice,
    servicesRefused,
    pending: queue.pending,
    blocked: queue.blocked,
  };
}
