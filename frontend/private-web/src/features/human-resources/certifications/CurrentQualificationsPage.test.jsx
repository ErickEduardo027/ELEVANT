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
vi.mock('./QualificationRecordForm', () => ({
  default: ({ initialQualification, onRecorded, onClose, onDenied }) =>
    <div role="dialog" aria-label="Formulario de habilitación">
      <span>{initialQualification?.id ?? 'primer ciclo'}</span>
      <button type="button" onClick={() => onRecorded({ id: 'new-id', cycleNumber: 2 })}>Guardar prueba</button>
      <button type="button" onClick={() => onDenied(403)}>Denegar prueba</button>
      <button type="button" onClick={onClose}>Cerrar prueba</button>
    </div>,
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
const fullPage = [row, ...Array.from({ length: 19 }, (_, index) => ({
  ...row, id: `50000000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
  rampProfileId: `50000000-0000-7000-8000-${String(index + 100).padStart(12, '0')}`,
  agentName: `Agent ${index + 1}`,
  employeeNumber: `DEV-RA-${String(index + 2).padStart(3, '0')}`,
}))];

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows authorized current cycles with real recording entry points and pages through rows', async () => {
  getHumanResourcesQualifications
    .mockResolvedValueOnce({ page: 1, limit: 20, hasMore: true, qualifications: fullPage })
    .mockResolvedValueOnce({ page: 2, limit: 20, hasMore: false,
      qualifications: [{ ...row, id: '50000000-0000-7000-8000-000000000003',
        agentName: 'Ana Example', trainingDate: '2019-01-01',
        obtainedOn: '2019-01-02', expiresOn: '2020-01-01' }] });
  render(<CurrentQualificationsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  expect(screen.getAllByText('Vigente')).toHaveLength(20);
  expect(screen.getByText(/hasta 20 registros por página/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Registrar habilitación' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Renovar' })).toHaveLength(20);
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
  expect(await screen.findByText('Ana Example')).toBeInTheDocument();
  expect(screen.getByText('Vencida')).toBeInTheDocument();
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(getHumanResourcesQualifications).toHaveBeenCalledWith(
    { page: 2, limit: 20 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('opens renewal for the selected cycle, refreshes after saving and hides rows on denial', async () => {
  getHumanResourcesQualifications.mockResolvedValue({ page: 1, limit: 20,
    hasMore: false, qualifications: [row] });
  const user = userEvent.setup();
  render(<CurrentQualificationsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Renovar' }));
  expect(screen.getByRole('dialog', { name: 'Formulario de habilitación' }))
    .toHaveTextContent(row.id);
  await user.click(screen.getByRole('button', { name: 'Guardar prueba' }));
  expect(await screen.findByText(/Habilitación guardada como ciclo 2/)).toBeInTheDocument();
  await waitFor(() => expect(getHumanResourcesQualifications).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole('button', { name: 'Registrar habilitación' }));
  expect(screen.getByRole('dialog', { name: 'Formulario de habilitación' }))
    .toHaveTextContent('primer ciclo');
  await user.click(screen.getByRole('button', { name: 'Denegar prueba' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No tienes acceso/);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

it('does not restore qualification rows when an in-flight refresh finishes after access is denied', async () => {
  let finishRefresh;
  getHumanResourcesQualifications
    .mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false, qualifications: [row] })
    .mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
  const user = userEvent.setup();
  render(<CurrentQualificationsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Renovar' }));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(getHumanResourcesQualifications).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole('button', { name: 'Denegar prueba' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/No tienes acceso/);
  await act(async () => finishRefresh({ page: 1, limit: 20, hasMore: false, qualifications: [row] }));
  expect(screen.getByRole('alert')).toHaveTextContent(/No tienes acceso/);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

it('hides the previous list and private exception after a failed revalidation', async () => {
  getHumanResourcesQualifications
    .mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false, qualifications: [row] })
    .mockRejectedValueOnce(new Error('internal SQL trace'));
  render(<CurrentQualificationsPage />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Renovar' }));
  expect(screen.getByRole('dialog', { name: 'Formulario de habilitación' })).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar/);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Formulario de habilitación' })).not.toBeInTheDocument();
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
