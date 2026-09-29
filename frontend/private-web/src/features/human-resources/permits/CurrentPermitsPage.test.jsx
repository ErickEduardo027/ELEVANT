import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CurrentPermitsPage from './CurrentPermitsPage';
import { getHumanResourcesPermits } from '../../../services/humanResourcesPermitsReadService';

vi.mock('../../../services/humanResourcesPermitsReadService', () => ({
  getHumanResourcesPermits: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

const permit = {
  id: '50000000-0000-7000-8000-000000000003',
  rampProfileId: '50000000-0000-7000-8000-000000000001',
  agentName: 'Riley Ramp', employeeNumber: 'DEV-RA-001',
  documentType: 'AirportId', cycleNumber: 1,
  documentNumber: 'DEV-AIRPORT-ID', issuedOn: '2026-01-01', expiresOn: '2099-12-31',
};
const fullPage = [permit, ...Array.from({ length: 19 }, (_, index) => ({
  ...permit, id: `50000000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
  rampProfileId: `50000000-0000-7000-8000-${String(index + 100).padStart(12, '0')}`,
  agentName: `Agent ${index + 1}`,
  employeeNumber: `DEV-RA-${String(index + 2).padStart(3, '0')}`,
}))];

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows authorized current permits without mock actions and pages through rows', async () => {
  getHumanResourcesPermits
    .mockResolvedValueOnce({ page: 1, limit: 20, hasMore: true, permits: fullPage })
    .mockResolvedValueOnce({ page: 2, limit: 20, hasMore: false,
      permits: [{ ...permit, id: '50000000-0000-7000-8000-000000000004',
        agentName: 'Ana Example', documentType: 'RampDriverLicense',
        issuedOn: '2019-01-01', expiresOn: '2020-01-01' }] });
  render(<CurrentPermitsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  expect(screen.getAllByText('Carnet aeroportuario')).toHaveLength(20);
  expect(screen.getAllByText('Vigente')).toHaveLength(20);
  expect(screen.queryByRole('button', { name: /Registrar|Renovar|Adjuntar/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
  expect(await screen.findByText('Ana Example')).toBeInTheDocument();
  expect(screen.getByText('Licencia de conducir en rampa')).toBeInTheDocument();
  expect(screen.getByText('Vencido')).toBeInTheDocument();
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

it('hides previous permits and internal errors after failed revalidation', async () => {
  getHumanResourcesPermits
    .mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false, permits: [permit] })
    .mockRejectedValueOnce(new Error('internal SQL trace'));
  render(<CurrentPermitsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar/);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(screen.queryByText(/internal SQL trace/)).not.toBeInTheDocument();
});

it('distinguishes an empty authorized page from a forbidden response', async () => {
  getHumanResourcesPermits.mockResolvedValueOnce({ page: 1, limit: 20,
    hasMore: false, permits: [] }).mockRejectedValueOnce({ status: 403 });
  render(<CurrentPermitsPage />);
  expect(await screen.findByText(/No hay permisos registrados/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar permisos' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No tienes acceso/));
  expect(screen.queryByText(/No hay permisos registrados/)).not.toBeInTheDocument();
});
