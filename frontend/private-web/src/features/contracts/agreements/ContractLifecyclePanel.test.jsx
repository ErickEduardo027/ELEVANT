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
  // The refusal is an alert, not a status that reads like a success.
  const refused = screen.getByRole('alert');
  expect(refused).toHaveTextContent('El contrato cambió de estado; se volvió a cargar.');
  expect(refused).toHaveClass('text-status-danger');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
  // An uncertain result stays inside the dialog as an alert, so the same intent is retried from there.
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/No se pudo completar la acción/);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  // The retry of the same intent keeps the date and the Idempotency-Key.
  expect(within(dialog).getByLabelText('Vigente desde')).toHaveValue('2026-09-01');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Crear enmienda' }));
  expect(await screen.findByText(/Se creó la enmienda como borrador/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/Se creó la enmienda como borrador/);
  const [first, second] = createContractAmendment.mock.calls;
  expect(first.slice(0, 2)).toEqual(['v-1', { expectedStatus: 'Active', validFrom: '2026-09-01' }]);
  expect(second[2]).toBe(first[2]);
  // The approved version is unchanged: the drawer is not reloaded, so the notice and the link stay.
  expect(onChanged).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Abrir Borradores' }));
  expect(onOpenDrafts).toHaveBeenCalled();
});

it.each([
  ['valid_from_not_after_current', 409, /debe empezar después del inicio de la versión aprobada vigente/],
  ['valid_from_after_current_end', 409, /no puede empezar después del fin de la versión aprobada vigente/],
  ['invalid_amendment', 400, /Indique la fecha de inicio de la enmienda/],
])('keeps the amendment dialog open with %s next to «Vigente desde» (1-C)', async (code, status, text) => {
  getContractTimeline.mockResolvedValue(timeline('Active'));
  createContractAmendment.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status, code }))
    .mockResolvedValueOnce({ id: 'v-2' });
  render(<ContractLifecyclePanel versionId="v-1" canAmend
    currentVersion={{ versionNumber: 1, validFrom: '2026-01-01', validTo: '2026-12-31' }} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Crear enmienda' }));
  const dialog = screen.getByRole('dialog', { name: 'Crear enmienda del contrato CT-001' });
  const start = within(dialog).getByLabelText('Vigente desde');
  // The browser bounds do not stop a typed date: the server refuses it.
  await userEvent.type(start, '2026-01-01');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Crear enmienda' }));
  const error = await within(dialog).findByRole('alert');
  expect(error).toHaveTextContent(text);
  expect(error).toHaveClass('text-status-danger');
  expect(start).toHaveAttribute('aria-invalid', 'true');
  expect(start).toHaveAccessibleDescription(text);
  // Nothing is announced behind the dialog as if it had worked.
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  // Correcting the date clears the error; the corrected date is a new intent with its own key.
  await userEvent.clear(start);
  await userEvent.type(start, '2026-09-01');
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  expect(start).not.toHaveAttribute('aria-invalid');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Crear enmienda' }));
  expect(await screen.findByText(/Se creó la enmienda como borrador/)).toBeInTheDocument();
  const [first, second] = createContractAmendment.mock.calls;
  expect(second[1]).toEqual({ expectedStatus: 'Active', validFrom: '2026-09-01' });
  expect(second[2]).not.toBe(first[2]);
});

it('explains why an amendment cannot start by its code and offers it only on active or suspended contracts', async () => {
  getContractTimeline.mockResolvedValue(timeline('Suspended'));
  createContractAmendment.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, code: 'draft_in_progress' }));
  const { unmount } = render(<ContractLifecyclePanel versionId="v-1" canAmend />);
  await userEvent.click(await screen.findByRole('button', { name: 'Crear enmienda' }));
  await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Vigente desde'), '2026-09-01');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crear enmienda' }));
  // The dialog cannot fix a draft in progress: it closes and the panel shows the refusal as an alert.
  const refused = await screen.findByRole('alert');
  expect(refused).toHaveTextContent(/ya tiene un borrador en curso/);
  expect(refused).toHaveClass('text-status-danger');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Abrir Borradores' })).not.toBeInTheDocument();
  expect(getContractTimeline).toHaveBeenCalledTimes(2);
  unmount();
  getContractTimeline.mockResolvedValue(timeline('Expired'));
  render(<ContractLifecyclePanel versionId="v-1" canAmend />);
  await screen.findByText('Contrato activo');
  expect(screen.queryByRole('button', { name: 'Crear enmienda' })).not.toBeInTheDocument();
});

it('terminates an active contract on an effective date that respects the signed notice (2-N14)', async () => {
  getContractTimeline.mockResolvedValueOnce({ ...timeline('Active'), terminatesOn: null, earliestTerminationOn: '2026-12-05' })
    .mockResolvedValueOnce({ ...timeline('Active'), terminatesOn: '2026-12-10', earliestTerminationOn: null });
  applyContractLifecycle.mockResolvedValue({ status: 'Active', draftVersionId: null });
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Terminar' }));
  const dialog = screen.getByRole('dialog', { name: 'Terminar contrato CT-001' });
  const effective = within(dialog).getByLabelText(/Fecha efectiva/);
  // The earliest date the server allows is the default and the lower limit.
  expect(effective).toHaveAttribute('min', '2026-12-05');
  expect(effective).toHaveValue('2026-12-05');
  await userEvent.clear(effective);
  await userEvent.type(effective, '2026-12-10');
  await userEvent.type(within(dialog).getByLabelText('Motivo'), 'Fin de la relación comercial.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  expect(applyContractLifecycle).toHaveBeenCalledWith('v-1', { action: 'Terminate', reason: 'Fin de la relación comercial.',
    expectedStatus: 'Active', effectiveOn: '2026-12-10' }, expect.any(String));
  expect(await screen.findByText(/Se programó la terminación: el contrato cubre operaciones hasta el/)).toBeInTheDocument();
  // Once scheduled, the panel offers its cancellation and no renewal.
  expect(await screen.findByRole('button', { name: 'Cancelar terminación' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Renovar' })).not.toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('Terminación programada');
});

it('ends an active contract at once only with an explicit cause and its note', async () => {
  getContractTimeline.mockResolvedValue({ ...timeline('Suspended'), terminatesOn: null, earliestTerminationOn: '2026-12-05' });
  applyContractLifecycle.mockResolvedValue({ status: 'Terminated', draftVersionId: null });
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Terminar' }));
  const dialog = screen.getByRole('dialog', { name: 'Terminar contrato CT-001' });
  await userEvent.click(within(dialog).getByLabelText(/Inmediata, por una causa explícita/));
  await userEvent.type(within(dialog).getByLabelText('Motivo (nota de la causa)'), 'Impago reiterado de tres facturas.');
  expect(within(dialog).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await userEvent.selectOptions(within(dialog).getByLabelText('Causa inmediata'), 'Breach');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  expect(applyContractLifecycle).toHaveBeenCalledWith('v-1', { action: 'Terminate', reason: 'Impago reiterado de tres facturas.',
    expectedStatus: 'Suspended', immediateCause: 'Breach' }, expect.any(String));
  expect(await screen.findByText('Contrato terminado.')).toBeInTheDocument();
});

it('cancels a scheduled termination and explains a date before the notice by its code', async () => {
  getContractTimeline.mockResolvedValue({ ...timeline('Active'), terminatesOn: '2026-12-10', earliestTerminationOn: null });
  applyContractLifecycle.mockResolvedValueOnce({ status: 'Active', draftVersionId: null });
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Cancelar terminación' }));
  const dialog = screen.getByRole('dialog', { name: 'Cancelar la terminación del contrato CT-001' });
  await userEvent.type(within(dialog).getByLabelText('Motivo'), 'La aerolínea renovó su interés.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  expect(applyContractLifecycle).toHaveBeenCalledWith('v-1', { action: 'CancelTermination',
    reason: 'La aerolínea renovó su interés.', expectedStatus: 'Active' }, expect.any(String));
  expect(await screen.findByText(/Se canceló la terminación programada/)).toBeInTheDocument();
  cleanup();
  getContractTimeline.mockResolvedValue({ ...timeline('Active'), terminatesOn: null, earliestTerminationOn: '2026-12-05' });
  applyContractLifecycle.mockRejectedValueOnce(Object.assign(new Error('Invalid'), { status: 400, code: 'termination_notice_not_met' }));
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Terminar' }));
  await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Motivo'), 'Fin de la relación comercial.');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText(/debe respetar el preaviso firmado/)).toBeInTheDocument();
});

it('shows the unauthorized state when the history is forbidden', async () => {
  getContractTimeline.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  render(<ContractLifecyclePanel versionId="v-1" canManage />);
  expect(await screen.findByText('Tu acceso no permite consultar el ciclo de este contrato.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});
