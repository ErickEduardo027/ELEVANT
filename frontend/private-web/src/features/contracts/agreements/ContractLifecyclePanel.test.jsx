import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractLifecyclePanel from './ContractLifecyclePanel';
import { applyContractLifecycle, createContractAmendment, getContractTimeline } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({ getContractTimeline: vi.fn(), applyContractLifecycle: vi.fn(),
  createContractAmendment: vi.fn() }));

const timeline = status => ({ contractId: 'c-1', contractCode: 'CT-001', status, entries: [
  { at: '2026-10-01T12:00:00Z', kind: 'request', title: 'Solicitud recibida', detail: 'REQ-1', actor: 'Ana' },
  { at: '2026-10-20T12:00:00Z', kind: 'signature', title: 'Firma de la aerolínea', detail: 'Luis · Director', actor: null },
  { at: '2026-10-21T12:00:00Z', kind: 'status', title: 'Contrato activo', detail: 'Aprobado por Finanzas…', actor: 'Sistema' },
] });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows the chronological history and only the actions the current state allows', async () => {
  getContractTimeline.mockResolvedValue(timeline('Active'));
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  const items = within(await screen.findByRole('list')).getAllByRole('listitem');
  expect(items.map(item => item.querySelector('p.font-semibold').textContent))
    .toEqual(['Solicitud recibida', 'Firma de la aerolínea', 'Contrato activo']);
  expect(screen.getByRole('button', { name: 'Suspender' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument();
});

it('suspends with a reason and the status the user saw', async () => {
  getContractTimeline.mockResolvedValueOnce(timeline('Active')).mockResolvedValueOnce(timeline('Suspended'));
  applyContractLifecycle.mockResolvedValue({ status: 'Suspended', draftVersionId: null });
  const onChanged = vi.fn();
  render(<ContractLifecyclePanel versionId="v-1" canManage onChanged={onChanged} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Suspender' }));
  const confirm = screen.getByRole('button', { name: 'Confirmar' });
  expect(confirm).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Motivo'), 'Auditoría de seguridad');
  await userEvent.click(confirm);
  expect(applyContractLifecycle).toHaveBeenCalledWith('v-1', { action: 'Suspend', reason: 'Auditoría de seguridad', expectedStatus: 'Active' },
    expect.any(String));
  expect(await screen.findByRole('button', { name: 'Reactivar' })).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
});

it('explains why a reactivation was refused', async () => {
  getContractTimeline.mockResolvedValue(timeline('Suspended'));
  applyContractLifecycle.mockRejectedValue(Object.assign(new Error('Invalid'), { status: 400, code: 'permit_required' }));
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Reactivar' }));
  await userEvent.type(screen.getByLabelText('Motivo'), 'Reanudar servicio');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText(/no tiene un permiso de operación verificado/)).toBeInTheDocument();
});

it('hides the actions without the lifecycle permission', async () => {
  getContractTimeline.mockResolvedValue(timeline('Active'));
  render(<ContractLifecyclePanel versionId="v-1" />);
  await screen.findByText('Contrato activo');
  expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
});

it('discards a contract that never activated with its own wording and keeps the key of an uncertain retry', async () => {
  getContractTimeline.mockResolvedValue(timeline('Draft'));
  applyContractLifecycle.mockRejectedValueOnce(new TypeError('Network down'))
    .mockResolvedValueOnce({ status: 'Terminated', draftVersionId: null });
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Descartar contrato' }));
  expect(screen.queryByRole('button', { name: 'Terminar' })).not.toBeInTheDocument();
  expect(screen.getByText(/El contrato nunca se activó/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Motivo'), 'La aerolínea desistió.');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText(/No se pudo completar la acción/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText(/Contrato descartado/)).toBeInTheDocument();
  const [first, second] = applyContractLifecycle.mock.calls;
  expect(first[1]).toEqual({ action: 'Terminate', reason: 'La aerolínea desistió.', expectedStatus: 'Draft' });
  expect(second[2]).toBe(first[2]);
});

it('explains a conflict by its code and re-reads the contract', async () => {
  getContractTimeline.mockResolvedValue(timeline('Active'));
  applyContractLifecycle.mockRejectedValue(Object.assign(new Error('The contract changed; reload and retry.'),
    { status: 409, code: 'status_changed' }));
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Suspender' }));
  await userEvent.type(screen.getByLabelText('Motivo'), 'Auditoría de seguridad');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText('El contrato cambió de estado; se volvió a cargar.')).toBeInTheDocument();
  expect(screen.queryByText(/reload and retry/)).not.toBeInTheDocument();
  expect(getContractTimeline).toHaveBeenCalledTimes(2);
});

it('shows a refused action inside its dialog and closes it once the contract moved on', async () => {
  getContractTimeline.mockResolvedValueOnce(timeline('Draft')).mockResolvedValue(timeline('Active'));
  applyContractLifecycle.mockRejectedValueOnce(Object.assign(new Error('Invalid'), { status: 400, code: 'reason_required' }))
    .mockRejectedValueOnce(Object.assign(new Error('The contract changed.'), { status: 409, code: 'status_changed' }));
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Descartar contrato' }));
  const dialog = screen.getByRole('dialog', { name: 'Descartar el contrato CT-001' });
  // The reason says its bounds and what is missing while «Confirmar» waits.
  const reason = within(dialog).getByLabelText('Motivo');
  await userEvent.type(reason, 'Dup');
  expect(within(dialog).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  expect(reason).toHaveAccessibleDescription(/Entre 5 y 500 caracteres\..*Faltan 2 caracteres\./);
  await userEvent.type(reason, 'licado');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  // A refusal shows inside the dialog, not behind it.
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Escribe el motivo (5 a 500 caracteres).');
  // The contract activated meanwhile: discarding no longer applies, so the dialog closes and the panel explains it.
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('El contrato cambió de estado; se volvió a cargar.');
  expect(screen.getByRole('button', { name: 'Terminar' })).toBeInTheDocument();
  expect(screen.queryByText('The contract changed.')).not.toBeInTheDocument();
});

it('creates an amendment from «Vigente desde» with the status on screen and opens Borradores (1-C)', async () => {
  getContractTimeline.mockResolvedValue(timeline('Active'));
  createContractAmendment.mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce({ id: 'v-2' });
  const onOpenDrafts = vi.fn();
  const onChanged = vi.fn();
  render(<ContractLifecyclePanel versionId="v-1" canAmend onOpenDrafts={onOpenDrafts} onChanged={onChanged}
    currentVersion={{ versionNumber: 1, validFrom: '2026-01-01', validTo: '2026-12-31' }} />);
  // Contratos amends without the lifecycle permission: the action needs contracts.drafts.update only.
  expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Crear enmienda' }));
  const dialog = screen.getByRole('dialog', { name: 'Crear enmienda del contrato CT-001' });
  expect(within(dialog).getByText(/versión 1, del/)).toBeInTheDocument();
  const start = within(dialog).getByLabelText('Vigente desde');
  expect(start).toHaveAttribute('min', '2026-01-02');
  expect(start).toHaveAttribute('max', '2026-12-31');
  expect(within(dialog).getByRole('button', { name: 'Crear enmienda' })).toBeDisabled();
  await userEvent.type(start, '2026-09-01');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Crear enmienda' }));
  expect(await screen.findByText(/No se pudo completar la acción/)).toBeInTheDocument();
  // The retry of the same intent keeps the date and the Idempotency-Key.
  await userEvent.click(screen.getByRole('button', { name: 'Crear enmienda' }));
  expect(within(screen.getByRole('dialog')).getByLabelText('Vigente desde')).toHaveValue('2026-09-01');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crear enmienda' }));
  expect(await screen.findByText(/Se creó la enmienda como borrador/)).toBeInTheDocument();
  const [first, second] = createContractAmendment.mock.calls;
  expect(first.slice(0, 2)).toEqual(['v-1', { expectedStatus: 'Active', validFrom: '2026-09-01' }]);
  expect(second[2]).toBe(first[2]);
  // The approved version is unchanged: the drawer is not reloaded, so the notice and the link stay.
  expect(onChanged).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Abrir Borradores' }));
  expect(onOpenDrafts).toHaveBeenCalled();
});

it('explains why an amendment cannot start by its code and offers it only on active or suspended contracts', async () => {
  getContractTimeline.mockResolvedValue(timeline('Suspended'));
  createContractAmendment.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, code: 'draft_in_progress' }));
  const { unmount } = render(<ContractLifecyclePanel versionId="v-1" canAmend />);
  await userEvent.click(await screen.findByRole('button', { name: 'Crear enmienda' }));
  await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Vigente desde'), '2026-09-01');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crear enmienda' }));
  expect(await screen.findByText(/ya tiene un borrador en curso/)).toBeInTheDocument();
  expect(getContractTimeline).toHaveBeenCalledTimes(2);
  unmount();
  getContractTimeline.mockResolvedValue(timeline('Expired'));
  render(<ContractLifecyclePanel versionId="v-1" canAmend />);
  await screen.findByText('Contrato activo');
  expect(screen.queryByRole('button', { name: 'Crear enmienda' })).not.toBeInTheDocument();
});
