import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import DashboardRoute from './DashboardRoute';
import { useAuth } from '../auth/AuthContext';
import { getDashboardSnapshot } from '../../services/dashboardService';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
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

it('reads the first authorized station and switches to the selected station', async () => {
  render(<MemoryRouter><DashboardRoute /></MemoryRouter>);
  await screen.findByText(/No hay escalas registradas/);
  expect(getDashboardSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ stationId: firstId, stationCode: 'PUJ' }),
    expect.anything());
  fireEvent.change(screen.getByLabelText('Estación OCC'),
    { target: { value: secondId } });
  await waitFor(() => expect(getDashboardSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ stationId: secondId, stationCode: 'SDQ' }),
    expect.anything()));
});
