import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDashboardSnapshot } from './dashboardService';
import { getPlanningSnapshot } from './planningService';
import { loadOccReviewQueue } from './occReviewService';
import { loadOperationalNotifications } from './operationalCommunicationService';

vi.mock('./planningService', () => ({ getPlanningSnapshot: vi.fn() }));
vi.mock('./occReviewService', () => ({ loadOccReviewQueue: vi.fn() }));
vi.mock('./operationalCommunicationService', () => ({
  loadOperationalNotifications: vi.fn(),
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const scope = { stationId, stationCode: 'PUJ', date: '2026-09-28' };
const planning = {
  station: { id: stationId, code: 'PUJ', name: 'Punta Cana',
    ianaTimeZone: 'America/Santo_Domingo' },
  date: scope.date,
  turnarounds: [{
    id: 'turnaround-one', operationCode: 'DEV-TAT-0001', status: 'Scheduled',
    airline: { name: 'Synthetic Air' },
    arrival: { flightNumber: 'EV 101' }, departure: { flightNumber: 'EV 102' },
    agents: [{ agentId: 'agent-one' }], services: [{ status: 'Completed' }],
  }],
};
const review = { stationId, stationCode: 'PUJ', stationName: 'Punta Cana',
  ianaTimeZone: 'America/Santo_Domingo', hasMore: false,
  operations: [{ operationId: 'operation-one', operationCode: 'DEV-TAT-0001',
    airlineName: 'Synthetic Air', agentName: 'Agente Uno',
    submittedAt: '2026-09-28T12:00:00Z' }] };
const notices = { hasMore: false, notifications: [
  { id: 'notice-one', operationId: 'operation-one', operationCode: 'DEV-TAT-0001',
    stationCode: 'PUJ', kind: 'operation_submitted', sourceId: 'source-one',
    occurredAt: '2026-09-28T12:00:00Z', readAt: null },
  { id: 'notice-other', operationId: 'operation-two', operationCode: 'DEV-TAT-0002',
    stationCode: 'SDQ', kind: 'operation_submitted', sourceId: 'source-two',
    occurredAt: '2026-09-28T12:05:00Z', readAt: null },
] };

beforeEach(() => {
  vi.mocked(getPlanningSnapshot).mockReset().mockResolvedValue(planning);
  vi.mocked(loadOccReviewQueue).mockReset().mockResolvedValue(review);
  vi.mocked(loadOperationalNotifications).mockReset().mockResolvedValue(notices);
});

afterEach(() => vi.useRealTimers());

it('uses the authorized station timezone when UTC has already rolled into tomorrow', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T02:00:00Z'));
  vi.mocked(getPlanningSnapshot).mockResolvedValue({ ...planning, date: '2026-10-01' });

  const result = await getDashboardSnapshot({ stationId, stationCode: 'PUJ' });

  expect(getPlanningSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ stationId, date: '2026-10-01' }));
  expect(result.date).toBe('2026-10-01');
});

it('combines actual scoped reads and never counts another station notification', async () => {
  const controller = new AbortController();
  const result = await getDashboardSnapshot(scope, { signal: controller.signal });
  expect(getPlanningSnapshot).toHaveBeenCalledWith(
    { stationId, date: scope.date, signal: controller.signal });
  expect(loadOccReviewQueue).toHaveBeenCalledWith(
    stationId, { signal: controller.signal });
  expect(loadOperationalNotifications).toHaveBeenCalledWith(
    { signal: controller.signal });
  expect(result).toEqual({
    ...scope, turnarounds: planning.turnarounds,
    reviews: review.operations, reviewHasMore: false,
    notifications: [notices.notifications[0]], notificationsHasMore: false,
  });
});

it('rejects missing or mismatched station responses instead of inventing a dashboard', async () => {
  await expect(getDashboardSnapshot({ ...scope, stationId: '' }))
    .rejects.toBeInstanceOf(TypeError);
  expect(getPlanningSnapshot).not.toHaveBeenCalled();
  vi.mocked(loadOccReviewQueue).mockResolvedValue({
    ...review, stationId: '20000000-0000-7000-8000-000000000004',
  });
  await expect(getDashboardSnapshot(scope))
    .rejects.toThrow('El panorama operativo no coincide con la estación solicitada.');
});
