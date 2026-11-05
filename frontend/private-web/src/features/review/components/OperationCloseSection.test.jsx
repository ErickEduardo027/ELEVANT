import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
vi.mock('../../../services/occReviewService', async importOriginal => ({
  ...(await importOriginal()),
  addOccReviewCharge: mocks.add,
  removeOccReviewCharge: mocks.remove,
}));

import OperationCloseSection from './OperationCloseSection';

const serviceId = '72000000-0000-7000-8000-000000000001';
const chargeId = '73000000-0000-7000-8000-000000000001';
const markId = '74000000-0000-7000-8000-000000000001';
const detail = {
  operationId: '70000000-0000-7000-8000-000000000005', submissionId: '71000000-0000-7000-8000-000000000001',
  reviewVersion: `"${'a'.repeat(64)}"`, ianaTimeZone: 'America/Santo_Domingo',
  services: [{ id: serviceId, code: 'BAGGAGE', name: 'Baggage handling' }],
  close: {
    milestones: [{ code: 'BLOCK_ON', actualAt: '2026-11-05T14:00:00Z' }],
    charges: [{ markId, serviceId, serviceCode: 'BAGGAGE', chargeId, code: 'NIGHT', name: 'Recargo nocturno',
      source: 'Automatic', appliedAt: '2026-11-05T15:00:00Z', reason: null }],
    chargeOptions: [{ chargeId, code: 'DELAY', name: 'Demora', appliesToAllServices: true, serviceIds: [serviceId] }],
    timing: { groundMinutes: 91, allowedGroundMinutes: 75, arrivalDelayMinutes: 12, aircraftCategory: 'Narrowbody' },
    canAdjustCharges: true,
    damageCount: 2,
  },
};

afterEach(() => vi.clearAllMocks());

describe('OperationCloseSection (ADR-0034)', () => {
  it('shows the ground time against the allowance and who marked each charge', () => {
    render(<OperationCloseSection detail={detail} onChanged={() => {}} />);
    expect(screen.getByText('Paquete excedido por 16 min')).toBeTruthy();
    expect(screen.getByText('avión estrecho')).toBeTruthy();
    expect(screen.getByText('Automático')).toBeTruthy();
    expect(screen.getByText('2 daño(s) marcados en el walk-around')).toBeTruthy();
  });

  it('removes a charge only with a reason, against the review version', async () => {
    const onChanged = vi.fn();
    mocks.remove.mockResolvedValue({ reviewVersion: `"${'b'.repeat(64)}"` });
    render(<OperationCloseSection detail={detail} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    const confirm = screen.getByRole('button', { name: 'Quitar recargo' });
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Motivo (8 a 500 caracteres)'), 'Fue operación diurna');
    await userEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Recargo quitado. La decisión usa ya la versión nueva.'));
    expect(mocks.remove).toHaveBeenCalledWith(detail.operationId, markId,
      { submissionId: detail.submissionId, reason: 'Fue operación diurna' }, detail.reviewVersion);
  });

  it('adds a charge to a chosen service and shows errors as text', async () => {
    mocks.add.mockRejectedValue(new Error('No fue posible ajustar el recargo.'));
    render(<OperationCloseSection detail={detail} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar recargo' }));
    await userEvent.selectOptions(screen.getByLabelText('Servicio'), serviceId);
    await userEvent.selectOptions(screen.getByLabelText('Recargo'), chargeId);
    await userEvent.type(screen.getByLabelText('Motivo (8 a 500 caracteres)'), 'Llegó con 40 minutos de demora');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No fue posible ajustar el recargo.');
  });

  it('keeps the charges read-only once decided', () => {
    render(<OperationCloseSection detail={{ ...detail, close: { ...detail.close, canAdjustCharges: false } }} onChanged={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull();
    expect(screen.getByText('Recargos tal como se aprobaron o entregaron.')).toBeTruthy();
  });
});
