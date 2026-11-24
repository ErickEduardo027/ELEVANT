import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from '../../../tests/MemoryRouter.jsx';
import { beforeEach, expect, it, vi } from 'vitest';
import FlightMonitoringRoute from './FlightMonitoringRoute';
import { OCC_READ_TIMEOUT_MS, OCC_SAFETY_POLL_MS } from '../admin-occ/live/occCadence';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
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
const pageProps = vi.hoisted(() => ({ current: null }));
vi.mock('./FlightMonitoringPage', () => ({
  default: props => {
    pageProps.current = props;
    return <p>{props.data?.station.code}</p>;
  },
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

it('revalidates monitoring when the shell announces a planning change, with no observer of its own', async () => {
  vi.useFakeTimers();
  try {
    const shell = createOccShellValue();
    render(<MemoryRouter><OccShellTestProvider value={shell}><FlightMonitoringRoute /></OccShellTestProvider></MemoryRouter>);
    expect(useFlightMonitoringData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
    expect(observerFactory).not.toHaveBeenCalled();
    expect(shell.subscriptions()).toEqual(['occ_planning']);
    // The mount's read, which this stand-in never reports as running, counts until the read timeout.
    await act(async () => { await vi.advanceTimersByTimeAsync(OCC_READ_TIMEOUT_MS); });
    act(() => shell.announce(['notifications']));
    expect(useFlightMonitoringData).not.toHaveBeenCalledWith('PUJ', 1, false, 'occ-account');
    act(() => shell.announce(['occ_planning']));
    expect(useFlightMonitoringData).toHaveBeenCalledWith('PUJ', 1, false, 'occ-account');
    // No 25 s poll or focus re-read of its own: the next read without an announcement is the 60 s safety poll.
    const calls = () => vi.mocked(useFlightMonitoringData).mock.calls.filter(call => call[1] === 2).length;
    window.dispatchEvent(new Event('focus'));
    await act(async () => { await vi.advanceTimersByTimeAsync(OCC_READ_TIMEOUT_MS); });
    expect(calls()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(OCC_SAFETY_POLL_MS); });
    expect(calls()).toBeGreaterThan(0);
  } finally {
    vi.useRealTimers();
  }
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

it('hands the page the PUJ scope it reads, and lets the page read the flight of the URL itself', () => {
  render(<MemoryRouter initialEntries={[
    `/admin-occ/flight-monitoring?stationId=${firstId}&flightId=leg-one`,
  ]}><FlightMonitoringRoute /></MemoryRouter>);
  expect(pageProps.current).toMatchObject({ stationId: firstId, stationCode: 'PUJ', theme: 'light', forceState: 'default' });
  // The selection is the URL's (maps/core/useMapSelection.js): the route no longer hands a flight of its own.
  expect(pageProps.current).not.toHaveProperty('focusFlightId');
  // The route hears the frame's channel (OCC_SCREEN_REFRESH): it opens no observer of its own.
  expect(observerFactory).not.toHaveBeenCalled();
});

it('does not read monitoring without a PUJ scope', () => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: secondId, stationCode: 'SDQ' }] } });
  render(<MemoryRouter><FlightMonitoringRoute /></MemoryRouter>);
  expect(useFlightMonitoringData).toHaveBeenCalledWith('', 0, false, 'occ-account');
});
