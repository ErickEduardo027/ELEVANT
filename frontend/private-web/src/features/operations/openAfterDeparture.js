/**
 * An operation still open after its aircraft left (finding N30, decision D-N30): OCC is told once the departure is more
 * than this long ago. Until then the agent may still hand the operation off on the tablet; after it, the agent hands
 * it off or OCC hands it over to another agent. There is no sweep on the server: the screens read it from what they
 * already have.
 */
export const OPEN_AFTER_DEPARTURE_MARGIN_MS = 60 * 60_000;

/**
 * The states of a ground operation still on the agent's side: assigned, in progress, or returned to correct. One
 * handed off (PendingReview, InReview), approved, cancelled or never assigned (Planned) is not open there.
 */
export const OPEN_OPERATION_STATUSES = Object.freeze(['Assigned', 'InProgress', 'Returned']);

const normalize = value => String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
const OPEN = new Set(OPEN_OPERATION_STATUSES.map(normalize));

/**
 * Whether an operation in `status` (the API's enum name, in any case or spacing) is still open more than
 * OPEN_AFTER_DEPARTURE_MARGIN_MS after its aircraft left its stand at `departedAt` (milliseconds); `nowMs` is the
 * server's time. Without a departure, or with one still ahead, nothing is open after it.
 */
export function isOpenAfterDeparture(status, departedAt, nowMs) {
  return OPEN.has(normalize(status)) && Number.isFinite(departedAt) && Number.isFinite(nowMs)
    && nowMs - departedAt > OPEN_AFTER_DEPARTURE_MARGIN_MS;
}
