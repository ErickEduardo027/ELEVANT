import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from '../../../tests/MemoryRouter.jsx';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DashboardRoute from './DashboardRoute';
import { OccBootContext } from '../admin-occ/boot/occBootContext';
import { useAuth } from '../auth/AuthContext';
import { getDashboardSnapshot } from '../../services/dashboardService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../weather/useMdpcWeather', () => ({
  useMdpcWeather: () => ({ status: 'loading', data: null, refreshFailed: false, refresh: () => {} }),
}));
vi.mock('../shell/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('next/dynamic', () => ({ default: () => function MapStub() { return null; } }));
vi.mock('../../services/dashboardService', () => ({ getDashboardSnapshot: vi.fn() }));
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

it('tells the boot screen the console is ready once its first data is on screen', async () => {
  const pending = [];
  vi.mocked(getDashboardSnapshot).mockImplementation(({ stationId, stationCode, date }) => new Promise(resolve => {
    pending.push(() => resolve({ stationId, stationCode, date, turnarounds: [], reviews: [],
      reviewHasMore: false, notifications: [], notificationsHasMore: false }));
  }));
  const markReady = vi.fn();
  render(<MemoryRouter><OccBootContext.Provider value={{ markReady }}>
    <DashboardRoute />
  </OccBootContext.Provider></MemoryRouter>);

  // While the first read is on its way the console has nothing to show: the boot screen keeps waiting.
  await waitFor(() => expect(getDashboardSnapshot).toHaveBeenCalled());
  expect(markReady).not.toHaveBeenCalled();

  await act(async () => { pending.forEach(resolve => resolve()); });
  await screen.findByText(/No hay escalas registradas/);
  expect(markReady).toHaveBeenCalledTimes(1);
  expect(markReady).toHaveBeenCalledWith('console');
});

it('does not keep the boot screen over a console that cannot read its station', () => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: secondId, stationCode: 'SDQ' }] } });
  const markReady = vi.fn();
  render(<MemoryRouter><OccBootContext.Provider value={{ markReady }}>
    <DashboardRoute />
  </OccBootContext.Provider></MemoryRouter>);
  // The notice that needs the user is on screen at once, so the boot screen leaves instead of covering it for 6 s.
  expect(screen.getByRole('alert')).toHaveTextContent('estación PUJ');
  expect(markReady).toHaveBeenCalledTimes(1);
  expect(markReady).toHaveBeenCalledWith('console');
});
