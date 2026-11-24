import type { FlightReportOutboxItem } from '../../synchronization/flight-report-outbox';

/** The flight report's last milestone (ADR-0031): the aircraft leaves the stand. */
export const PUSHBACK_MILESTONE = 'PUSHBACK';

/**
 * CN-24: what the Service Order's signature and the close say while the push-back is not recorded. Only a warning: the
 * Order signs as before, and recording the push-back afterwards makes its signatures stale (it sets the departure time).
 */
export const PUSHBACK_BEFORE_SIGNING =
  'Registra el push-back antes de firmar: al registrarlo cambia la hora de salida y habrá que firmar de nuevo.';

/**
 * Whether the operation's push-back is recorded: confirmed by ELEVANT (on the operation or in the last answer the
 * device kept) or waiting in the device's queue. A push-back ELEVANT refused is not recorded.
 */
export function isPushbackRecorded(input: Readonly<{
  milestones?: readonly Readonly<{ code: string }>[] | null;
  confirmed?: readonly Readonly<{ code: string }>[] | null;
  items: readonly FlightReportOutboxItem[];
  operationId: string;
}>) {
  if ((input.milestones ?? []).some(item => item.code === PUSHBACK_MILESTONE)) return true;
  if ((input.confirmed ?? []).some(item => item.code === PUSHBACK_MILESTONE)) return true;
  const id = input.operationId.toLowerCase();
  return input.items.some(item => item.state === 'pending' && item.command.kind === 'milestone' &&
    item.command.code === PUSHBACK_MILESTONE && item.command.operationId.toLowerCase() === id);
}
