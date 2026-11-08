import type { RampOperationStartResponse } from '@elevant/api-client';
import { serverNow } from '../synchronization/server-clock';
import { readOperationQueue, sendFlightReportCommand } from './flight-report';
import { MobileServiceError } from './mobile-service-error';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StartAssignedRampOperationOptions = Readonly<{
  /** Kept for the screens' request lifecycle; a start saved on the device is never cancelled by leaving the screen. */
  signal?: AbortSignal;
  /** The station's time zone, so «Sincronización» shows the tapped time as the station's local time. */
  timeZone?: string;
}>;

/**
 * What happened to «Iniciar» (3-I): ELEVANT confirmed it, or it is saved on the device with the tapped time and goes
 * out on its own when there is signal. A refusal is thrown with its Problem Details code.
 */
export type RampStartOutcome =
  | Readonly<{ state: 'confirmed'; response: RampOperationStartResponse }>
  | Readonly<{ state: 'queued'; startedAt: string | null; issue?: MobileServiceError }>;

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

/**
 * «Iniciar» an assigned operation. The tap is stamped with ELEVANT's clock (3-N18) and saved in the device's queue
 * before anything is sent (3-I), so a tablet without signal starts the operation and records its milestones and
 * services; the server keeps the tapped time. A start already waiting on the device is sent again with its key; one
 * ELEVANT refused is replaced, in its turn, by the new tap.
 */
export async function startAssignedRampOperation(
  operationId: string,
  options: StartAssignedRampOperationOptions = {},
): Promise<RampStartOutcome> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');

  const waiting = (await readOperationQueue(operationId)).start;
  const command = waiting?.state === 'pending' && waiting.command.kind === 'start'
    ? waiting.command
    : { kind: 'start' as const, operationId: operationId.toLowerCase(), occurredAt: serverNow().toISOString(),
      ...(options.timeZone ? { timeZone: options.timeZone } : {}) };
  const sent = await sendFlightReportCommand(command, waiting?.state === 'pending'
    ? { idempotencyKey: waiting.idempotencyKey }
    : waiting ? { replaces: waiting.idempotencyKey } : {});
  if (sent.state === 'sent') {
    const response = sent.result as RampOperationStartResponse;
    if (response.operation.id.toLowerCase() !== operationId.toLowerCase()) {
      throw new MobileServiceError('malformed_response');
    }
    return { state: 'confirmed', response };
  }
  return { state: 'queued', startedAt: command.occurredAt, ...(sent.issue ? { issue: sent.issue } : {}) };
}
