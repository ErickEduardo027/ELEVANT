import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractLifecyclePanel from './ContractLifecyclePanel';
import { applyContractLifecycle, getContractTimeline } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({ getContractTimeline: vi.fn(), applyContractLifecycle: vi.fn() }));

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
  expect(applyContractLifecycle).toHaveBeenCalledWith('v-1', { action: 'Suspend', reason: 'Auditoría de seguridad', expectedStatus: 'Active' });
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
