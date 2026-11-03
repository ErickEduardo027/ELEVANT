import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from '../../../tests/MemoryRouter.jsx';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DashboardRoute from './DashboardRoute';
import { useAuth } from '../auth/AuthContext';
import { getDashboardSnapshot } from '../../services/dashboardService';
import { useOperationalNotificationCenter } from '../admin-occ/notifications/OperationalNotificationCenter';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../weather/useMdpcWeather', () => ({
  useMdpcWeather: () => ({ status: 'loading', data: null, refreshFailed: false, refresh: () => {} }),
}));
vi.mock('../shell/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('next/dynamic', () => ({ default: () => function MapStub() { return null; } }));
vi.mock('../../services/dashboardService', () => ({ getDashboardSnapshot: vi.fn() }));
vi.mock('../admin-occ/notifications/OperationalNotificationCenter', () => ({ useOperationalNotificationCenter: vi.fn(() => null) }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const firstId = '20000000-0000-7000-8000-000000000003';
const secondId = '20000000-0000-7000-8000-000000000004';

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: firstId, stationCode: 'PUJ' },
      { stationId: secondId, stationCode: 'SDQ' }] } });
  vi.mocked(getDashboardSnapshot).mockReset().mockImplementation(
    async ({ stationId, stationCode, date }) => ({
      stationId, stationCode, date, turnarounds: [], reviews: [],
      reviewHasMore: false, notifications: [], notificationsHasMore: false,
    }));
  vi.mocked(useOperationalNotificationCenter).mockReset().mockReturnValue(null);
  observerFactory.mockReset().mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => vi.useRealTimers());

it('delegates the current station day instead of sending the UTC browser date', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T02:00:00Z'));

  render(<MemoryRouter><DashboardRoute /></MemoryRouter>);

  await waitFor(() => expect(getDashboardSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ stationId: firstId, date: undefined }),
    expect.anything()));
});

it('always reads the PUJ scope even when it is not the first authorized station', async () => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: secondId, stationCode: 'SDQ' },
      { stationId: firstId, stationCode: 'PUJ' }] } });
  render(<MemoryRouter><DashboardRoute /></MemoryRouter>);
  await screen.findByText(/No hay escalas registradas/);
  expect(getDashboardSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ stationId: firstId, stationCode: 'PUJ' }),
    expect.anything());
  expect(getDashboardSnapshot).not.toHaveBeenCalledWith(
    expect.objectContaining({ stationCode: 'SDQ' }), expect.anything());
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('does not read any station when the account has no PUJ scope', async () => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: secondId, stationCode: 'SDQ' }] } });
  render(<MemoryRouter><DashboardRoute /></MemoryRouter>);
  expect(screen.getByRole('alert')).toHaveTextContent('estación PUJ');
  expect(getDashboardSnapshot).not.toHaveBeenCalled();
});

it('shows the shared notification feed in Avisos recientes, newest first and scoped to the station', async () => {
  const notice = (id, occurredAt, extra = {}) => ({ id, operationId: '30000000-0000-7000-8000-000000000001', operationCode: 'OP-' + id,
    stationCode: 'PUJ', kind: 'evidence_submitted', occurredAt, readAt: null, ...extra });
  vi.mocked(getDashboardSnapshot).mockImplementation(async ({ stationId, stationCode, date }) => ({
    stationId, stationCode, date, turnarounds: [], reviews: [], reviewHasMore: false,
    notifications: [notice('stale', '2026-10-01T10:00:00Z')], notificationsHasMore: false,
  }));
  vi.mocked(useOperationalNotificationCenter).mockReturnValue({ status: 'success', hasMore: false, items: [
    notice('older', '2026-10-02T10:00:00Z', { readAt: '2026-10-02T10:05:00Z' }),
    notice('newer', '2026-10-02T12:00:00Z'),
    notice('other-station', '2026-10-02T13:00:00Z', { stationCode: 'SDQ' }),
    notice('newer', '2026-10-02T12:00:00Z'),
  ] });
  render(<MemoryRouter><DashboardRoute /></MemoryRouter>);
  const codes = (await screen.findAllByText(/^OP-/)).map(node => node.textContent.split(' ·')[0]);
  expect(codes).toEqual(['OP-newer', 'OP-older']);
  expect(screen.queryByText('OP-stale')).not.toBeInTheDocument();
  expect(screen.getAllByText('Sin leer')).toHaveLength(1);
});
