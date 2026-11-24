'use client';

import { useCallback, useMemo } from 'react';
import { BUSINESS_TIME_ZONE, businessToday } from '../../../services/businessDay';
import { loadOccPositions } from '../../../services/occPositionsService';
import { loadOccReviewQueue } from '../../../services/occReviewService';
import { getAssignmentReadiness, getPlanningSnapshot } from '../../../services/planningService';
import { serverClock } from '../../../services/serverClock';
import { useOccResource } from '../../admin-occ/live/useOccResource';
import { useOptionalOccShellNotices } from '../../admin-occ/shell/occShellContext';
import { OCC_STATION_CODE } from '../../admin-occ/useOccStation';
import { mapOccPlanningSnapshot } from '../../planning/planningMappers';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { RAMP_POSITIONS } from '../positionsData';
import { CONSOLE_READS } from './consoleReads';

// The data of the OCC console (contratos 2.5 and 2.7): one useOccResource per bay, each with its own five states, so a
// refused or failing read blanks only its panel, and each keeps its last data while it refreshes. The flights and the
// sky are not read here: the console reads them once through the maps lane's useMapSituation, the same flights the map
// draws. The components never choose the source: the route passes `services`, and the tests a counted stand-in.

/** The reads of the console, over the private web's adapters and the app's server clock. */
export const CONSOLE_SERVICES = Object.freeze({
  getPlanningSnapshot, getAssignmentReadiness, loadOccPositions, loadOccReviewQueue, clock: serverClock,
});

const IDLE_NOTICES = Object.freeze({
  status: 'idle', data: null, refreshing: false, refreshFailed: false, fetchedAt: null, hasMore: false,
  retry: () => {}, refresh: () => {}, markRead: async () => null,
});

const ANSWERED = new Set(['success', 'empty']);
const sameId = (left, right) => typeof left === 'string' && typeof right === 'string'
  && left.toLowerCase() === right.toLowerCase();
const isText = value => typeof value === 'string' && value.trim() !== '';
const hasNoTurnarounds = data => data.turnarounds.length === 0;
const hasNoOperations = data => data.operations.length === 0;

// An answer for another station is never shown: the read fails as a whole, with a fixed message.
const stationMismatch = () => new Error('La respuesta del panorama no coincide con la estación solicitada.');

/** The options of a read of CONSOLE_READS that useOccResource takes. */
function readOptions(entry) {
  const { key, permission, resources, pollMs, coalesceMs } = entry;
  return { key, permission, resources, pollMs, coalesceMs };
}

/**
 * The shell's notices of the station (useOptionalOccShellNotices(), read once for the whole frame), as a view of the console:
 * `{ status, data, refreshing, refreshFailed, fetchedAt, hasMore, retry, refresh, markRead }`, with `data` the notices
 * of `stationCode` once the shell has read them (null before), `empty` when the station has none. No request of its
 * own; «Recibido» is `markRead(id)`, the account's read receipt. Without the shell or the scope it is `idle`.
 */
function useStationNotices(stationCode, reading) {
  const notices = useOptionalOccShellNotices();
  return useMemo(() => {
    if (!reading || notices === null) return IDLE_NOTICES;
    const answered = ANSWERED.has(notices.status);
    const items = answered ? (notices.items ?? []).filter(item => item?.stationCode === stationCode) : null;
    return Object.freeze({
      status: answered ? (items.length > 0 ? 'success' : 'empty') : notices.status,
      data: items === null ? null : Object.freeze(items),
      refreshing: false, refreshFailed: notices.refreshFailed === true, fetchedAt: notices.fetchedAt ?? null,
      hasMore: notices.hasMore === true, retry: notices.retry, refresh: notices.refresh, markRead: notices.markRead,
    });
  }, [notices, reading, stationCode]);
}

/**
 * Whether the console may read: an account and the OCC's station (PUJ, the scope the session brings, useOccStation).
 * Without it nothing is read and every bay is `idle` (the route says why).
 */
export function isConsoleScope({ accountId, stationId, stationCode } = {}) {
  return isText(accountId) && isText(stationId) && stationCode === OCC_STATION_CODE;
}

/**
 * The console's reads for an account and a station (contratos 2.7). Returns `{ planning, positions, reviewQueue,
 * readiness, notices }`, each a view `{ status, data, refreshing, refreshFailed, fetchedAt, retry, refresh }` of
 * useOccResource (its five states, plus `idle` while it may not read), keyed by account and station so another scope
 * never shows the previous data:
 * - `planning`: the station's day as the server decides it (no date is sent): `{ date, station, turnarounds, flights }`
 *   (`turnarounds` as the API sends them; `flights` mapped by planning/planningMappers.js). `empty` without turnarounds.
 * - `positions`: the positions board of the station's day on the server's clock, `{ board, stands }`, `stands` mapped
 *   over the reference list (positions-map/positionsMapMappers.js) for the stand display and the band.
 * - `reviewQueue`: the OCC queue of the station, as the API sends it; `empty` without operations.
 * - `readiness`: the unfit assignments (2-N25) of the planning's day; it reads only once that day is known.
 * - `notices`: the shell's notices of the station, with no request (useStationNotices).
 * Every answer must name the station asked for; one that does not fails the read. Each read waits for its permission
 * (CONSOLE_READS), re-reads on its own 60 s poll and never on `occ_planning`; the review queue also on `occ_review`.
 * Without an account or the PUJ scope (isConsoleScope) nothing is read.
 */
export function useConsoleData({ accountId, stationId, stationCode, services = CONSOLE_SERVICES } = {}) {
  const reading = isConsoleScope({ accountId, stationId, stationCode });
  const scopeKey = reading ? `${accountId}|${stationId}` : '';
  const clock = services.clock ?? serverClock;

  const loadPlanning = useCallback(async ({ signal }) => {
    const snapshot = await services.getPlanningSnapshot({ stationId, signal });
    if (!sameId(snapshot?.station?.id, stationId) || snapshot.station.code !== stationCode) throw stationMismatch();
    return Object.freeze({ date: snapshot.date, station: snapshot.station, turnarounds: snapshot.turnarounds,
      flights: mapOccPlanningSnapshot(snapshot).flights });
  }, [services, stationCode, stationId]);

  // The day at the station on the server's clock, never the browser's: from 20:00 in Punta Cana the UTC day is already
  // tomorrow, and the device's clock may be off.
  const loadPositions = useCallback(async ({ signal }) => {
    const day = businessToday(new Date(clock.now()), BUSINESS_TIME_ZONE);
    const board = await services.loadOccPositions(stationId, day, { signal });
    if (!sameId(board?.stationId, stationId) || board.stationCode !== stationCode) throw stationMismatch();
    return Object.freeze({ board, stands: Object.freeze(mapOccupancyToRampPositions(RAMP_POSITIONS, board)) });
  }, [clock, services, stationCode, stationId]);

  const loadReviewQueue = useCallback(async ({ signal }) => {
    const queue = await services.loadOccReviewQueue(stationId, { signal });
    if (!sameId(queue?.stationId, stationId) || queue.stationCode !== stationCode) throw stationMismatch();
    return queue;
  }, [services, stationCode, stationId]);

  const planning = useOccResource({ ...readOptions(CONSOLE_READS.planning), load: loadPlanning, scopeKey,
    enabled: reading, isEmpty: hasNoTurnarounds });
  const positions = useOccResource({ ...readOptions(CONSOLE_READS.positions), load: loadPositions, scopeKey,
    enabled: reading });
  const reviewQueue = useOccResource({ ...readOptions(CONSOLE_READS.reviewQueue), load: loadReviewQueue, scopeKey,
    enabled: reading, isEmpty: hasNoOperations });

  // The readiness marks belong to the planning's day: they wait for it, and a new day starts them again.
  const day = planning.data?.date ?? null;
  const loadReadiness = useCallback(({ signal }) => services.getAssignmentReadiness({ stationId, date: day, signal }),
    [day, services, stationId]);
  const readiness = useOccResource({ ...readOptions(CONSOLE_READS.readiness), load: loadReadiness,
    scopeKey: day === null ? scopeKey : `${scopeKey}|${day}`, enabled: reading && day !== null });

  const notices = useStationNotices(stationCode, reading);

  return useMemo(() => ({ planning, positions, reviewQueue, readiness, notices }),
    [notices, planning, positions, readiness, reviewQueue]);
}
