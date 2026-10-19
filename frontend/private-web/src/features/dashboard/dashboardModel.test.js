import { expect, it } from 'vitest';
import { awaitingDecision, buildDashboardModel, classifyTurnarounds, legTime, missingResources } from './dashboardModel';

const turnaround = (id, status, extra = {}) => ({ id, operationCode: id, status, agents: [{ displayName: 'A' }],
  stand: { code: 'A1' }, ...extra });

it('prefers actual, then estimated, then scheduled leg times', () => {
  expect(legTime({ scheduledAt: 's', estimatedAt: 'e', actualAt: 'a' })).toEqual({ at: 'a', kind: 'actual' });
  expect(legTime({ scheduledAt: 's', estimatedAt: 'e' })).toEqual({ at: 'e', kind: 'estimated' });
  expect(legTime({ scheduledAt: 's' })).toEqual({ at: 's', kind: 'scheduled' });
  expect(legTime(null)).toBeNull();
});

it('flags missing stand or agents only for open turnarounds', () => {
  expect(missingResources(turnaround('t1', 'Scheduled', { stand: null, agents: [] }))).toEqual(['stand', 'agents']);
  expect(missingResources(turnaround('t2', 'Completed', { stand: null, agents: [] }))).toEqual([]);
  expect(missingResources(turnaround('t3', 'Cancelled', { stand: null }))).toEqual([]);
  expect(missingResources(turnaround('t4', 'Diverted', { agents: [] }))).toEqual([]);
});

it('groups turnarounds and sorts them by their first known time', () => {
  const groups = classifyTurnarounds([
    turnaround('late', 'InProgress', { arrival: { scheduledAt: '2026-09-28T18:00:00Z' } }),
    turnaround('early', 'Completed', { arrival: { scheduledAt: '2026-09-28T08:00:00Z' } }),
    turnaround('unknown', 'Scheduled', { agents: [] }),
  ]);
  expect(groups.all.map(item => item.id)).toEqual(['early', 'late', 'unknown']);
  expect(groups.inProgress.map(item => item.id)).toEqual(['late']);
  expect(groups.completed.map(item => item.id)).toEqual(['early']);
  expect(groups.needsResources.map(item => item.id)).toEqual(['unknown']);
});

it('counts only queue items that still await an OCC decision', () => {
  const reviews = ['PendingReview', 'InReview', 'Approved', 'Returned'].map(status => ({ status }));
  expect(awaitingDecision(reviews).map(item => item.status)).toEqual(['PendingReview', 'InReview']);
  const model = buildDashboardModel({ turnarounds: [], reviews, reviewHasMore: true,
    notifications: [{ id: 'n', readAt: null }, { id: 'm', readAt: 'x' }] });
  expect(model.summary.pendingReviews).toBe(2);
  expect(model.pendingReviewsIsLowerBound).toBe(true);
  expect(model.unreadNotices).toHaveLength(1);
});
