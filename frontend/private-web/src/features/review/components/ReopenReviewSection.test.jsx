import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';

const mocks = vi.hoisted(() => ({ reopen: vi.fn() }));
vi.mock('../../../services/occReviewService', () => ({ reopenOccReview: mocks.reopen }));

import ReopenReviewSection from './ReopenReviewSection';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operationId = '70000000-0000-0000-0000-000000000016';
const submissionId = '70000000-0000-0000-0000-000000000017';
const approved = { operationId, submissionId, status: 'Approved', reviewVersion: '"approved-token"' };
const reopener = { kind: 'Member', permissions: ['operations.review.read', 'operations.review.reopen'] };
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });

function renderSection({ detail = approved, access = reopener, onReopened = vi.fn(), onRefused = vi.fn() } = {}) {
  const view = render(<DepartmentAccessProvider initialAccess={access} observe={false}>
    <ReopenReviewSection detail={detail} disabled={false} onReopened={onReopened} onRefused={onRefused} />
  </DepartmentAccessProvider>);
  return { ...view, onReopened, onRefused };
}

beforeEach(() => vi.clearAllMocks());

describe('ReopenReviewSection (3-H)', () => {
  it('is offered only on an approved hand-off to an account with operations.review.reopen', () => {
    const { unmount } = renderSection({ detail: { ...approved, status: 'PendingReview' } });
    expect(screen.queryByRole('button', { name: 'Reabrir revisión' })).not.toBeInTheDocument();
    unmount();
    const second = renderSection({ access: { kind: 'Member', permissions: ['operations.review.decide'] } });
    expect(screen.queryByRole('button', { name: 'Reabrir revisión' })).not.toBeInTheDocument();
    second.unmount();
    renderSection();
    expect(screen.getByRole('button', { name: 'Reabrir revisión' })).toBeInTheDocument();
    expect(screen.getByText(/Finanzas deja de verla por facturar/)).toBeInTheDocument();
  });

  it('explains that an approval without a signed Service Order is not reopened (3-N02)', () => {
    renderSection({ detail: { ...approved, serviceOrderState: 'Unsigned' } });
    expect(screen.queryByRole('button', { name: 'Reabrir revisión' })).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'La Orden de Servicio de esta aprobación no está firmada: no se puede reabrir.');
  });

  it('reopens with a reason, the version OCC saw and the intent key', async () => {
    const user = userEvent.setup();
    mocks.reopen.mockResolvedValue({ operationId, submissionId: '70000000-0000-0000-0000-000000000021',
      revisionNumber: 3, status: 'PendingReview', reviewVersion: '"reopened-token"' });
    const { onReopened } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Reabrir revisión' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar reapertura' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo de la reapertura (8 a 2000 caracteres)'), ' La aerolínea disputó el GPU ');
    await user.click(confirm);
    await waitFor(() => expect(mocks.reopen).toHaveBeenCalledWith(operationId,
      { submissionId, reason: 'La aerolínea disputó el GPU' }, '"approved-token"', expect.stringMatching(UUID)));
    expect(onReopened).toHaveBeenCalledWith('Revisión reabierta como revisión 3: vuelve a Pendiente de revisión.');
  });

  it('reports a refusal of the server to the route, which re-reads (already invoiced, stale version)', async () => {
    const user = userEvent.setup();
    mocks.reopen.mockRejectedValueOnce(failure(409, 'already_invoiced',
      'Ya hay servicios facturados: corrija con una nota de crédito.'));
    const { onRefused } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Reabrir revisión' }));
    await user.type(screen.getByLabelText('Motivo de la reapertura (8 a 2000 caracteres)'), 'La aerolínea disputó el GPU');
    await user.click(screen.getByRole('button', { name: 'Confirmar reapertura' }));
    await waitFor(() => expect(onRefused).toHaveBeenCalledWith('Ya hay servicios facturados: corrija con una nota de crédito.'));
    expect(screen.queryByLabelText('Motivo de la reapertura (8 a 2000 caracteres)')).not.toBeInTheDocument();
  });

  it('keeps the form and the key after an answer that never arrived', async () => {
    const user = userEvent.setup();
    mocks.reopen.mockRejectedValueOnce(failure(null, 'unknown-outcome',
      'No fue posible confirmar la reapertura. Actualiza el detalle antes de intentarlo de nuevo.'))
      .mockResolvedValueOnce({ operationId, submissionId, revisionNumber: 2, status: 'PendingReview',
        reviewVersion: '"reopened-token"' });
    const { onReopened, onRefused } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Reabrir revisión' }));
    await user.type(screen.getByLabelText('Motivo de la reapertura (8 a 2000 caracteres)'), 'La aerolínea disputó el GPU');
    await user.click(screen.getByRole('button', { name: 'Confirmar reapertura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No fue posible confirmar la reapertura/);
    await user.click(screen.getByRole('button', { name: 'Confirmar reapertura' }));
    await waitFor(() => expect(onReopened).toHaveBeenCalled());
    expect(mocks.reopen.mock.calls[1][3]).toBe(mocks.reopen.mock.calls[0][3]);
    expect(onRefused).not.toHaveBeenCalled();
  });
});
