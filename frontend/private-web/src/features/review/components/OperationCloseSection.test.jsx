import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), exclusion: vi.fn() }));
vi.mock('../../../services/occReviewService', async importOriginal => ({
  ...(await importOriginal()),
  addOccReviewCharge: mocks.add,
  removeOccReviewCharge: mocks.remove,
  setOccReviewBillingExclusion: mocks.exclusion,
}));

import OperationCloseSection from './OperationCloseSection';

const serviceId = '72000000-0000-7000-8000-000000000001';
const chargeId = '73000000-0000-7000-8000-000000000001';
const markId = '74000000-0000-7000-8000-000000000001';
const gpuId = '72000000-0000-7000-8000-000000000002';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    // The panel keeps the region the cycle E2E and the guide look for.
    expect(screen.getByRole('region', { name: 'Cierre de la operación' })).toBeTruthy();
    // The overrun asks for attention with its triangle and its words, never with a colour alone.
    const overrun = screen.getByText('Paquete excedido por 16 min').closest('[data-occ-status]');
    expect(overrun).toHaveAttribute('data-tone', 'attention');
    expect(overrun.querySelector('[data-occ-glyph="attention"]')).not.toBeNull();
    expect(screen.getByText('avión estrecho')).toBeTruthy();
    expect(screen.getByText('Automático')).toBeTruthy();
    expect(screen.getByText('2 daño(s) marcados en el walk-around')).toBeTruthy();
  });

  it('shows the recorded milestones in the full milestone strip with their local time', () => {
    render(<OperationCloseSection detail={detail} onChanged={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Hitos del Reporte de Vuelo' })).toBeTruthy();
    const strip = screen.getByRole('list', { name: 'Hitos de la escala' });
    expect(strip).toHaveAttribute('data-occ-milestones', 'full');
    // 3-N22: the milestone shows the Flight Report label, never its code; 14:00 UTC is 10:00 in Santo Domingo.
    const blockOn = within(strip).getByText('Bloqueo').closest('li');
    expect(within(blockOn).getByText('10:00')).toHaveAttribute('datetime', '2026-11-05T14:00:00Z');
    expect(screen.queryByText(/BLOCK_ON/)).toBeNull();
    // Each phase counts against the flight report, and the rest of the 25 milestones wait as pending.
    expect(within(strip).getByText('1 de 6')).toBeTruthy();
    expect(within(strip).getAllByText('Pendiente')).toHaveLength(24);
  });

  it('keeps «Sin hitos registrados.» when the hand-off recorded no milestone', () => {
    render(<OperationCloseSection detail={{ ...detail, close: { ...detail.close, milestones: [] } }} onChanged={() => {}} />);
    expect(screen.getByText('Sin hitos registrados.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Hitos de la escala' })).toBeNull();
  });

  it('confirms each charge change in a dialog named after its confirm button, and closes it on Cancelar or Esc', async () => {
    const user = userEvent.setup();
    render(<OperationCloseSection detail={detail} onChanged={() => {}} />);
    const panel = screen.getByRole('region', { name: 'Cierre de la operación' });
    await user.click(within(panel).getByRole('button', { name: 'Quitar' }));
    // Drawn inside the panel, so the review's «Detalle de entrega» still holds its field and its buttons.
    const removing = within(panel).getByRole('dialog', { name: 'Quitar recargo' });
    expect(removing).toHaveAttribute('aria-modal', 'true');
    const reason = within(removing).getByLabelText('Motivo (8 a 500 caracteres)');
    expect(reason).toHaveFocus();
    await user.type(reason, 'Fue operación diurna');
    await user.click(within(removing).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Quitar' })).toHaveFocus();

    await user.click(within(panel).getByRole('button', { name: 'Agregar recargo' }));
    const adding = within(panel).getByRole('dialog', { name: 'Agregar' });
    expect(within(adding).getByLabelText('Servicio')).toHaveFocus();
    // A cancelled change leaves nothing behind: the reason starts empty again.
    expect(within(adding).getByLabelText('Motivo (8 a 500 caracteres)')).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
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
    // 3-H: each adjustment carries its intent's Idempotency-Key.
    expect(mocks.remove).toHaveBeenCalledWith(detail.operationId, markId,
      { submissionId: detail.submissionId, reason: 'Fue operación diurna' }, detail.reviewVersion,
      { idempotencyKey: expect.stringMatching(UUID) });
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

describe('OperationCloseSection billing of services in exception (3-N11) and corrections (3-N02)', () => {
  const exception = { id: gpuId, code: 'GPU', name: 'GPU', status: 'Exception', executedQuantity: 2,
    contractedQuantity: 3, unit: 'hour' };
  const withException = { ...detail, serviceOrderState: 'Signed', services: [...detail.services, exception] };

  it('excludes a service in exception from billing with a reason, its key and the review version', async () => {
    const onChanged = vi.fn();
    mocks.exclusion.mockResolvedValue({ reviewVersion: `"${'c'.repeat(64)}"` });
    render(<OperationCloseSection detail={withException} onChanged={onChanged} />);
    expect(screen.getByText('Se factura')).toBeTruthy();
    // Only the service in exception with a quantity is offered; the completed one is billed as executed.
    expect(screen.getAllByRole('button', { name: 'Excluir de la facturación' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Excluir de la facturación' }));
    // 3-N02: the Service Order was signed, so the change becomes OCC's correction of it.
    expect(screen.getByText('Se registrará como corrección de OCC en la Orden de Servicio.')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Excluir' });
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Motivo (8 a 500 caracteres)'), 'La GPU falló a la mitad');
    await userEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(
      'Servicio excluido de la facturación. La decisión usa ya la versión nueva.'));
    expect(mocks.exclusion).toHaveBeenCalledWith(detail.operationId, gpuId,
      { submissionId: detail.submissionId, excluded: true, reason: 'La GPU falló a la mitad' }, detail.reviewVersion,
      expect.stringMatching(UUID));
  });

  it('shows what OCC excluded and bills it again with a reason', async () => {
    const onChanged = vi.fn();
    mocks.exclusion.mockResolvedValue({ reviewVersion: `"${'d'.repeat(64)}"` });
    const excluded = { ...withException, serviceOrderState: 'Unsigned', close: { ...detail.close,
      billingExclusions: [{ serviceId: gpuId, reason: 'La GPU falló a la mitad', excludedAt: '2026-11-05T16:00:00Z' }] } };
    render(<OperationCloseSection detail={excluded} onChanged={onChanged} />);
    expect(screen.getByText('Excluido por OCC: La GPU falló a la mitad')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Volver a facturar' }));
    expect(screen.queryByText('Se registrará como corrección de OCC en la Orden de Servicio.')).toBeNull();
    await userEvent.type(screen.getByLabelText('Motivo (8 a 500 caracteres)'), 'La aerolínea aceptó las 2 horas');
    await userEvent.click(screen.getAllByRole('button', { name: 'Volver a facturar' }).at(-1));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(
      'El servicio vuelve a facturarse. La decisión usa ya la versión nueva.'));
    expect(mocks.exclusion.mock.calls[0][2]).toEqual({ submissionId: detail.submissionId, excluded: false,
      reason: 'La aerolínea aceptó las 2 horas' });
  });

  it('hands a refused adjustment to the review, which re-reads before a new intent (3-N29)', async () => {
    const onChanged = vi.fn();
    mocks.add.mockRejectedValue(Object.assign(new Error('El contrato de la aerolínea excluye este cargo.'),
      { status: 409, code: 'charge_excluded_by_contract' }));
    render(<OperationCloseSection detail={withException} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar recargo' }));
    await userEvent.selectOptions(screen.getByLabelText('Servicio'), serviceId);
    await userEvent.selectOptions(screen.getByLabelText('Recargo'), chargeId);
    await userEvent.type(screen.getByLabelText('Motivo (8 a 500 caracteres)'), 'Llegó con 40 minutos de demora');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('El contrato de la aerolínea excluye este cargo.', 'error'));
    expect(screen.queryByLabelText('Motivo (8 a 500 caracteres)')).toBeNull();
  });

  it('offers no exclusion once the review is decided', () => {
    render(<OperationCloseSection detail={{ ...withException, close: { ...detail.close, canAdjustCharges: false } }}
      onChanged={() => {}} />);
    expect(screen.getByText('Se factura')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Excluir de la facturación' })).toBeNull();
  });
});
