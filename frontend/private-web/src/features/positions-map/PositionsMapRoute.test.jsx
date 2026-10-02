import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import PositionsMapRoute from './PositionsMapRoute';
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

it('revalidates positions when another OCC session changes planning', async () => {
  render(<MemoryRouter><PositionsMapRoute /></MemoryRouter>);
  expect(usePositionsMapData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
  expect(observerFactory).toHaveBeenCalledOnce();
  await act(async () => observerFactory.mock.calls[0][0](['occ_planning']));
  expect(usePositionsMapData).toHaveBeenCalledWith('PUJ', 1, false, 'occ-account');
});

it('uses the authorized station selection for the active positions read', () => {
  render(<MemoryRouter><PositionsMapRoute /></MemoryRouter>);
  expect(screen.getByLabelText('Estación de posiciones')).toHaveValue(firstId);
  expect(usePositionsMapData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
  fireEvent.change(screen.getByLabelText('Estación de posiciones'),
    { target: { value: secondId } });
  expect(screen.getByLabelText('Estación de posiciones')).toHaveValue(secondId);
  expect(usePositionsMapData).toHaveBeenCalledWith('SDQ', 0, false, 'occ-account');
});

it('carries the selected authorized station into the monitoring deep link', () => {
  render(<MemoryRouter><PositionsMapRoute /><LocationProbe /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Estación de posiciones'),
    { target: { value: secondId } });
  fireEvent.click(screen.getByRole('button', { name: 'Ver vuelo' }));
  expect(screen.getByTestId('route-location').textContent).toContain(`stationId=${secondId}`);
  expect(screen.getByTestId('route-location').textContent).toContain('flightId=leg-one');
});
