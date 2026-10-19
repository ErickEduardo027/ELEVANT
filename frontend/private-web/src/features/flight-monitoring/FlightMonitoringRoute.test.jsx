import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from '../../../tests/MemoryRouter.jsx';
import { beforeEach, expect, it, vi } from 'vitest';
import FlightMonitoringRoute from './FlightMonitoringRoute';
import { useAuth } from '../auth/AuthContext';
import { useFlightMonitoringData } from './useFlightMonitoringData';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./useFlightMonitoringData', () => ({ useFlightMonitoringData: vi.fn() }));
vi.mock('../admin-occ/AdminOccPreviewContext', () => ({
  useAdminOccPreview: () => ({ forceState: 'default' }),
}));
vi.mock('../shell/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('./FlightMonitoringPage', () => ({
  default: ({ data }) => <p>{data?.station.code}</p>,
}));

const firstId = '20000000-0000-7000-8000-000000000003';
const secondId = '20000000-0000-7000-8000-000000000004';

beforeEach(() => {
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: firstId, stationCode: 'PUJ' },
      { stationId: secondId, stationCode: 'SDQ' }] } });
  vi.mocked(useFlightMonitoringData).mockImplementation(code => ({
    status: 'success', data: { station: { code }, flights: [] },
    error: null, connection: 'connected', lastUpdatedAt: null,
  }));
});

it('revalidates monitoring when another OCC session changes planning', async () => {
  render(<MemoryRouter><FlightMonitoringRoute /></MemoryRouter>);
  expect(useFlightMonitoringData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
  expect(observerFactory).toHaveBeenCalledOnce();
  await act(async () => observerFactory.mock.calls[0][0](['occ_planning']));
  expect(useFlightMonitoringData).toHaveBeenCalledWith('PUJ', 1, false, 'occ-account');
});

it('reads PUJ even when it is not the first authorized scope and offers no selector', () => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: secondId, stationCode: 'SDQ' },
      { stationId: firstId, stationCode: 'PUJ' }] } });
  render(<MemoryRouter><FlightMonitoringRoute /></MemoryRouter>);
  expect(useFlightMonitoringData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
  expect(useFlightMonitoringData).not.toHaveBeenCalledWith('SDQ', expect.anything(), expect.anything(), expect.anything());
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('ignores a deep link to another station and keeps the PUJ scope', () => {
  render(<MemoryRouter initialEntries={[
    `/admin-occ/flight-monitoring?stationId=${secondId}&flightId=leg-one`,
  ]}><FlightMonitoringRoute /></MemoryRouter>);
  expect(useFlightMonitoringData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
  expect(useFlightMonitoringData).not.toHaveBeenCalledWith('SDQ', expect.anything(), expect.anything(), expect.anything());
});

it('does not read monitoring without a PUJ scope', () => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: secondId, stationCode: 'SDQ' }] } });
  render(<MemoryRouter><FlightMonitoringRoute /></MemoryRouter>);
  expect(useFlightMonitoringData).toHaveBeenCalledWith('', 0, false, 'occ-account');
});
