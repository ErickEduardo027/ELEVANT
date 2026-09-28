import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import FlightMonitoringRoute from './FlightMonitoringRoute';
import { useAuth } from '../auth/AuthContext';
import { useFlightMonitoringData } from './useFlightMonitoringData';

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
  vi.mocked(useAuth).mockReturnValue({ session: { accountId: 'occ-account',
    stationScopes: [{ stationId: firstId, stationCode: 'PUJ' },
      { stationId: secondId, stationCode: 'SDQ' }] } });
  vi.mocked(useFlightMonitoringData).mockImplementation(code => ({
    status: 'success', data: { station: { code }, flights: [] },
    error: null, connection: 'connected', lastUpdatedAt: null,
  }));
});

it('chooses an authorized station and moves the active read with the selector', () => {
  render(<MemoryRouter><FlightMonitoringRoute /></MemoryRouter>);
  expect(screen.getByLabelText('Estación de monitoreo')).toHaveValue(firstId);
  expect(useFlightMonitoringData).toHaveBeenCalledWith('PUJ', 0, false, 'occ-account');
  fireEvent.change(screen.getByLabelText('Estación de monitoreo'),
    { target: { value: secondId } });
  expect(screen.getByLabelText('Estación de monitoreo')).toHaveValue(secondId);
  expect(useFlightMonitoringData).toHaveBeenCalledWith('SDQ', 0, false, 'occ-account');
});
