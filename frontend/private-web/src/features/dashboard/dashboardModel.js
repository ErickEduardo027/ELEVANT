// Derivaciones del panorama OCC calculadas en el cliente a partir de las
// respuestas reales de planning, review y notifications. No introduce
// umbrales, severidades ni SLA: solo agrupa y cuenta lo que la API devuelve.

const normalize = status => String(status ?? '').replace(/[\s_-]+/g, '').toLowerCase();

const IN_PROGRESS = new Set(['inprogress']);
const COMPLETED = new Set(['completed']);
// Escalas que ya no necesitan recursos: terminadas, canceladas o desviadas.
const CLOSED = new Set(['completed', 'cancelled', 'diverted']);
// Estados de la cola OCC que aún esperan una decisión.
const AWAITING_DECISION = new Set(['PendingReview', 'InReview']);

export const TURNAROUND_FILTERS = ['all', 'inProgress', 'needsResources', 'completed'];

export function legTime(leg) {
  if (!leg) return null;
  if (leg.actualAt) return { at: leg.actualAt, kind: 'actual' };
  if (leg.estimatedAt) return { at: leg.estimatedAt, kind: 'estimated' };
  if (leg.scheduledAt) return { at: leg.scheduledAt, kind: 'scheduled' };
  return null;
}

function sortKey(turnaround) {
  const time = legTime(turnaround.arrival) ?? legTime(turnaround.departure);
  const value = time ? Date.parse(time.at) : Number.NaN;
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

export function missingResources(turnaround) {
  if (CLOSED.has(normalize(turnaround.status))) return [];
  const missing = [];
  if (!turnaround.stand?.code) missing.push('stand');
  if (!turnaround.agents?.length) missing.push('agents');
  return missing;
}

export function isInProgress(turnaround) {
  return IN_PROGRESS.has(normalize(turnaround.status));
}

export function isCompleted(turnaround) {
  return COMPLETED.has(normalize(turnaround.status));
}

export function classifyTurnarounds(turnarounds = []) {
  const all = [...turnarounds].sort((left, right) => sortKey(left) - sortKey(right));
  return {
    all,
    inProgress: all.filter(isInProgress),
    needsResources: all.filter(item => missingResources(item).length > 0),
    completed: all.filter(isCompleted),
  };
}

export function awaitingDecision(reviews = []) {
  return reviews.filter(item => AWAITING_DECISION.has(item.status));
}

/** Station notices from the shared feed: one row per id, newest first. */
export function recentStationNotices(items = [], stationCode) {
  const unique = [...new Map(items.filter(item => item.stationCode === stationCode).map(item => [item.id, item])).values()];
  const time = item => { const value = Date.parse(item.occurredAt); return Number.isNaN(value) ? 0 : value; };
  return unique.sort((left, right) => time(right) - time(left));
}

export function buildDashboardModel(data) {
  const turnarounds = classifyTurnarounds(data?.turnarounds);
  const pendingReviews = awaitingDecision(data?.reviews);
  const unreadNotices = (data?.notifications ?? []).filter(item => item.readAt == null);
  return {
    turnarounds,
    pendingReviews,
    // La cola trae como máximo 100 operaciones; si hay más, el conteo es un mínimo.
    pendingReviewsIsLowerBound: Boolean(data?.reviewHasMore),
    unreadNotices,
    notices: data?.notifications ?? [],
    summary: {
      turnarounds: turnarounds.all.length,
      inProgress: turnarounds.inProgress.length,
      completed: turnarounds.completed.length,
      needsResources: turnarounds.needsResources.length,
      pendingReviews: pendingReviews.length,
    },
  };
}
