import { isInOperation } from '../../occ-ui/statusVocabulary';
import { awaitingDecision, classifyTurnarounds } from '../dashboardModel';
import { bestTime, filterVisits, hasMilestone } from './boardModel';

// The six figures of the day (contratos 2.5, design D.1): «Escalas», «En operación», «Llegan en 60 min», «Sin
// recursos», «Por revisar» and «Completadas». Pure, and no thresholds of its own: they only group and count what the
// reads answered. A figure whose read has not answered is `null`, which the tile shows as «—», never a zero nobody
// counted. `nowMs` is the server's time in milliseconds.

/** «Llegan en 60 min» counts the arrivals whose best time falls in this window from now. */
export const ARRIVING_WINDOW_MS = 60 * 60_000;

const NOT_COMING = new Set(['landed', 'arrived', 'cancelled', 'diverted']);
const normalize = value => String(value ?? '').toLowerCase();

// An arrival still to land whose best time falls in [now, now + 60 min].
function arrivesWithin(flight, nowMs) {
  if (flight?.direction !== 'Arrival' || NOT_COMING.has(normalize(flight.phase)) || flight.actualAt != null
    || hasMilestone(flight, 'BLOCK_ON')) return false;
  const time = bestTime(flight);
  return time !== null && time.at >= nowMs && time.at <= nowMs + ARRIVING_WINDOW_MS;
}

/**
 * The figures from the console's reads: `planning` (useConsoleData's `planning.data`, its `turnarounds` as the API
 * sends them), `reviewQueue` (its `operations` and `hasMore`), `flights` (the map flights' rows, or their model with
 * `flights`) and `visits` (the board's «Escalas», boardModel.js: buildBoard over the same planning snapshot, once the
 * map flights answered). Returns `{ turnarounds, inOperation, arriving60, needsResources, toReview, toReviewIsLowerBound,
 * completed }`:
 * - `turnarounds`, `needsResources` (open turnarounds without a stand or an agent) and `completed` from the planning
 *   snapshot, through the old dashboard's classifyTurnarounds; with `visits`, `needsResources` counts the visits that
 *   «Escalas» files under «Sin recursos» (filterVisits), whose stand is the one the map flights give a visit they hold,
 *   so the figure and the filter say the same while the snapshot waits for its next read;
 * - `inOperation` counts the turnarounds isInOperation reads as in operation: the turnaround InProgress, or its
 *   operation InProgress or Returned (a demo flight's turnaround stays Confirmed while the agent works);
 * - `arriving60`: the map's arrivals not landed yet whose best time is in the next 60 minutes, a time window;
 * - `toReview`: the queue's operations awaiting a decision, with `toReviewIsLowerBound` when the queue has more than it
 *   answered (at most 100 operations).
 */
export function buildFigures({ planning = null, reviewQueue = null, flights = null, visits = null, nowMs } = {}) {
  const turnarounds = Array.isArray(planning?.turnarounds) ? planning.turnarounds : null;
  const groups = turnarounds === null ? null : classifyTurnarounds(turnarounds);
  const operations = Array.isArray(reviewQueue?.operations) ? reviewQueue.operations : null;
  let rows = null;
  if (Array.isArray(flights)) rows = flights;
  else if (Array.isArray(flights?.flights)) rows = flights.flights;
  let needsResources = null;
  if (groups !== null) {
    needsResources = Array.isArray(visits) ? filterVisits(visits, 'needsResources').length : groups.needsResources.length;
  }
  return Object.freeze({
    turnarounds: groups === null ? null : groups.all.length,
    inOperation: turnarounds === null ? null : turnarounds.filter(item => isInOperation(item)).length,
    arriving60: rows === null || !Number.isFinite(nowMs) ? null : rows.filter(item => arrivesWithin(item, nowMs)).length,
    needsResources,
    toReview: operations === null ? null : awaitingDecision(operations).length,
    toReviewIsLowerBound: operations !== null && reviewQueue.hasMore === true,
    completed: groups === null ? null : groups.completed.length,
  });
}
