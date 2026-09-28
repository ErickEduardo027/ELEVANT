import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CurrentQualificationsPage from './CurrentQualificationsPage';
import { getHumanResourcesQualifications } from '../../../services/humanResourcesQualificationsReadService';

vi.mock('../../../services/humanResourcesQualificationsReadService', () => ({
  getHumanResourcesQualifications: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

const row = {
  id: '50000000-0000-7000-8000-000000000002',
  rampProfileId: '50000000-0000-7000-8000-000000000001',
  agentName: 'Riley Ramp', employeeNumber: 'DEV-RA-001',
  equipmentTypeId: '20000000-0000-7000-8000-000000000007',
  equipmentCode: 'GPU', equipmentName: 'Ground power unit', cycleNumber: 1,
  trainingDate: '2026-01-02', obtainedOn: '2026-01-03', expiresOn: '2099-12-31',
  certifyingEntity: 'Synthetic Training Center', instructorName: 'Development Instructor',
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows authorized current cycles without prototype actions and pages through real rows', async () => {
  getHumanResourcesQualifications
    .mockResolvedValueOnce({ page: 1, limit: 20, hasMore: true, qualifications: [row] })
    .mockResolvedValueOnce({ page: 2, limit: 20, hasMore: false,
      qualifications: [{ ...row, id: '50000000-0000-7000-8000-000000000003',
        agentName: 'Ana Example', trainingDate: '2019-01-01',
        obtainedOn: '2019-01-02', expiresOn: '2020-01-01' }] });
  render(<CurrentQualificationsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  expect(screen.getByText('Vigente')).toBeInTheDocument();
  expect(screen.getByText(/hasta 20 registros por página/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Registrar|Renovar|Nueva habilitación/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
  expect(await screen.findByText('Ana Example')).toBeInTheDocument();
  expect(screen.getByText('Vencida')).toBeInTheDocument();
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(getHumanResourcesQualifications).toHaveBeenCalledWith(
    { page: 2, limit: 20 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('hides the previous list and private exception after a failed revalidation', async () => {
  getHumanResourcesQualifications
    .mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false, qualifications: [row] })
    .mockRejectedValueOnce(new Error('internal SQL trace'));
  render(<CurrentQualificationsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar/);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(screen.queryByText(/internal SQL trace/)).not.toBeInTheDocument();
});

it('distinguishes an authorized empty page from a forbidden response', async () => {
  getHumanResourcesQualifications.mockResolvedValueOnce({ page: 1, limit: 20,
    hasMore: false, qualifications: [] }).mockRejectedValueOnce({ status: 403 });
  render(<CurrentQualificationsPage />);
  expect(await screen.findByText(/No hay habilitaciones registradas/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar habilitaciones' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No tienes acceso/));
  expect(screen.queryByText(/No hay habilitaciones registradas/)).not.toBeInTheDocument();
});
