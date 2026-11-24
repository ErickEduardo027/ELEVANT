import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from '../../../tests/MemoryRouter.jsx';
import { beforeEach, expect, it, vi } from 'vitest';
import PositionsMapRoute from './PositionsMapRoute';
import { OCC_READ_TIMEOUT_MS, OCC_SAFETY_POLL_MS } from '../admin-occ/live/occCadence';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { useAuth } from '../auth/AuthContext';
import { usePositionsMapData } from './usePositionsMapData';

const observerFactory = vi.hoisted(() => vi.fn());
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./usePositionsMapData', () => ({ usePositionsMapData: vi.fn() }));
vi.mock('../admin-occ/AdminOccPreviewContext', () => ({
  useAdminOccPreview: () => ({ forceState: 'default' }),
}));
vi.mock('../shell/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('./PositionsMapPage', () => ({ default: ({ data, onNavigateToResource }) => <>
  <p>{data?.station.code}</p>
  <button onClick={() => onNavigateToResource('flight-monitoring', 'leg-one')}>Ver vuelo</button>
</> }));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="route-location">{location.pathname}{location.search}</span>;
}

const firstId = '20000000-0000-7000-8000-000000000003';
const secondId = '20000000-0000-7000-8000-000000000004';

beforeEach(() => {
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: firstId, stationCode: 'PUJ' },
      { stationId: secondId, stationCode: 'SDQ' }] } });
  vi.mocked(usePositionsMapData).mockImplementation(code => ({
    status: 'success', data: { station: { code }, positions: [] },
    error: null, connection: 'connected', lastUpdatedAt: null,
  }));
});

it('revalidates positions when the shell announces a planning change, with no observer of its own', async () => {
  vi.useFakeTimers();
  try {
    const shell = createOccShellValue();
    render(<MemoryRouter><OccShellTestProvider value={shell}><PositionsMapRoute /></OccShellTestProvider></MemoryRouter>);
    expect(usePositionsMapData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
    expect(observerFactory).not.toHaveBeenCalled();
    expect(shell.subscriptions()).toEqual(['occ_planning']);
    await act(async () => { await vi.advanceTimersByTimeAsync(OCC_READ_TIMEOUT_MS); });
    act(() => shell.announce(['occ_planning']));
    expect(usePositionsMapData).toHaveBeenCalledWith('PUJ', 1, false, 'occ-account');
  } finally {
    vi.useRealTimers();
  }
});

it('reads PUJ even when it is not the first authorized scope and offers no selector', () => {
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: secondId, stationCode: 'SDQ' },
      { stationId: firstId, stationCode: 'PUJ' }] } });
  render(<MemoryRouter><PositionsMapRoute /></MemoryRouter>);
  expect(usePositionsMapData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
  expect(usePositionsMapData).not.toHaveBeenCalledWith('SDQ', expect.anything(), expect.anything(), expect.anything());
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('carries the PUJ station into the monitoring deep link', () => {
  render(<MemoryRouter><PositionsMapRoute /><LocationProbe /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Ver vuelo' }));
  expect(screen.getByTestId('route-location').textContent).toContain(`stationId=${firstId}`);
  expect(screen.getByTestId('route-location').textContent).toContain('flightId=leg-one');
});
