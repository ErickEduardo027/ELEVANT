import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';

const mocks = vi.hoisted(() => ({ list: vi.fn(), confirm: vi.fn(), reopen: vi.fn() }));
vi.mock('../../../services/financeChartersService', () => ({
  listFinanceCharters: mocks.list,
  confirmCharterPrepayment: mocks.confirm,
  reopenCharterPrepayment: mocks.reopen,
}));

import ChartersPage from './ChartersPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIRMED = {
  id: '74000000-0000-7000-8000-000000000001', operationId: '70000000-0000-7000-8000-000000000009',
  operationCode: 'PUJ-20261108-004', operationDate: '2026-11-08', stationCode: 'PUJ', airlineName: 'Charter Express',
  currencyCode: 'USD', servicesTotal: 150, requestSigned: true, prepaymentStatus: 'Confirmed', prepaymentAmount: 180,
  prepaymentReference: 'TRF-001', prepaymentConfirmedAt: '2026-11-08T12:00:00Z', version: 'AAAAAAAAB9E=',
};
const PENDING = { ...CONFIRMED, id: '74000000-0000-7000-8000-000000000002', operationCode: 'PUJ-20261108-005',
  prepaymentStatus: 'Pending', prepaymentAmount: null, prepaymentReference: null, prepaymentConfirmedAt: null };
const finance = { kind: 'Member', permissions: ['finance.charters.read', 'finance.charters.confirm'] };

function renderPage(access = finance) {
  return render(<DepartmentAccessProvider initialAccess={access} observe={false}><ChartersPage /></DepartmentAccessProvider>);
}

const failure = (status, code, message) => Object.assign(new Error(message), { status, code });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([CONFIRMED, PENDING]);
});

describe('ChartersPage confirmation and correction of a prepayment (4-N22)', () => {
  it('confirms a pending prepayment with the version and the intent key, then re-reads', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue({ ...PENDING, prepaymentStatus: 'Confirmed' });
    renderPage();
    const row = (await screen.findByText('PUJ-20261108-005')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Confirmar prepago' }));
    const form = within(row).getByRole('form', { name: 'Confirmar prepago de PUJ-20261108-005' });
    await user.type(within(form).getByLabelText('Referencia'), ' TRF-002 ');
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(PENDING.id,
      { amount: 150, reference: 'TRF-002', version: PENDING.version }, expect.stringMatching(UUID)));
    expect(await screen.findByText(
      'Prepago confirmado para PUJ-20261108-005. Si el charter ya estaba facturado, se aplicó a su factura.'))
      .toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it('corrects a confirmed prepayment with a reason and the version it saw', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue({ ...CONFIRMED, prepaymentAmount: 18 });
    renderPage();
    const row = (await screen.findByText('PUJ-20261108-004')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Corregir prepago' }));
    const form = within(row).getByRole('form', { name: 'Corregir prepago de PUJ-20261108-004' });
    const amount = within(form).getByLabelText('Monto corregido (USD)');
    expect(amount).toHaveValue(180);
    expect(within(form).getByLabelText('Referencia corregida')).toHaveValue('TRF-001');
    const submit = within(form).getByRole('button', { name: 'Corregir' });
    expect(submit).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '18');
    await user.type(within(form).getByLabelText('Motivo de la corrección (5 a 500 caracteres)'), ' Se capturó 180 ');
    await user.click(submit);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(CONFIRMED.id,
      { amount: 18, reference: 'TRF-001', version: CONFIRMED.version, reason: 'Se capturó 180' },
      expect.stringMatching(UUID)));
    expect(await screen.findByText('Prepago corregido para PUJ-20261108-004.')).toBeInTheDocument();
  });

  it('explains an applied prepayment, closes the form and re-reads; a lost answer keeps its key', async () => {
    const user = userEvent.setup();
    mocks.confirm
      .mockRejectedValueOnce(failure(null, null, 'No se pudo confirmar la corrección del prepago. Actualice la lista antes de intentarlo de nuevo.'))
      .mockRejectedValueOnce(failure(409, 'charter_prepayment_applied',
        'El prepago ya se aplicó a la factura del charter. Revierta el cobro en «Cobros» y reabra el prepago para corregirlo.'));
    renderPage();
    const row = (await screen.findByText('PUJ-20261108-004')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Corregir prepago' }));
    await user.type(within(row).getByLabelText('Motivo de la corrección (5 a 500 caracteres)'), 'Monto mal capturado');
    await user.click(within(row).getByRole('button', { name: 'Corregir' }));
    expect(await screen.findByText(/No se pudo confirmar la corrección del prepago/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Corregir' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.confirm.mock.calls[1][2]).toBe(mocks.confirm.mock.calls[0][2]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Revierta el cobro en «Cobros»');
    expect(within(row).queryByRole('form')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
  });
});

describe('ChartersPage reopening of a confirmed prepayment (3-N24)', () => {
  it('reopens a confirmed prepayment with a reason, the version and the intent key, then re-reads', async () => {
    const user = userEvent.setup();
    mocks.reopen.mockResolvedValue({ ...CONFIRMED, prepaymentStatus: 'Pending' });
    renderPage();
    const row = (await screen.findByText('PUJ-20261108-004')).closest('tr');
    expect(within(screen.getByText('PUJ-20261108-005').closest('tr')).queryByRole('button', { name: 'Reabrir cotización' }))
      .not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Reabrir cotización' }));
    const form = within(row).getByRole('form', { name: 'Reabrir cotización de PUJ-20261108-004' });
    expect(form).toHaveTextContent(/Prepago anterior: .*180.* · TRF-001/);
    const submit = within(form).getByRole('button', { name: 'Reabrir' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Motivo de la reapertura (8 a 500 caracteres)'), '  Pidió otro remolque ');
    await user.click(submit);
    await waitFor(() => expect(mocks.reopen).toHaveBeenCalledWith(CONFIRMED.id,
      { reason: 'Pidió otro remolque', version: CONFIRMED.version }, expect.stringMatching(UUID)));
    expect(await screen.findByText('Cotización reabierta para PUJ-20261108-004: el prepago vuelve a Pendiente.'))
      .toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it('explains a refusal by its message, closes the form on a conflict and re-reads', async () => {
    const user = userEvent.setup();
    mocks.reopen.mockRejectedValueOnce(failure(409, 'version_conflict',
      'El charter cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.'));
    renderPage();
    const row = (await screen.findByText('PUJ-20261108-004')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Reabrir cotización' }));
    await user.type(within(row).getByLabelText('Motivo de la reapertura (8 a 500 caracteres)'), 'Pidió otro remolque');
    await user.click(within(row).getByRole('button', { name: 'Reabrir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El charter cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.');
    expect(within(row).queryByRole('form')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it('keeps the key of a reopening whose answer was lost', async () => {
    const user = userEvent.setup();
    mocks.reopen
      .mockRejectedValueOnce(failure(null, null, 'No se pudo confirmar la reapertura. Actualice la lista antes de intentarlo de nuevo.'))
      .mockResolvedValueOnce({ ...CONFIRMED, prepaymentStatus: 'Pending' });
    renderPage();
    const row = (await screen.findByText('PUJ-20261108-004')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Reabrir cotización' }));
    await user.type(within(row).getByLabelText('Motivo de la reapertura (8 a 500 caracteres)'), 'Pidió otro remolque');
    await user.click(within(row).getByRole('button', { name: 'Reabrir' }));
    expect(await screen.findByText(/No se pudo confirmar la reapertura/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Reabrir' }));
    await waitFor(() => expect(mocks.reopen).toHaveBeenCalledTimes(2));
    expect(mocks.reopen.mock.calls[1][2]).toBe(mocks.reopen.mock.calls[0][2]);
  });

  it('offers no reopening without the confirm permission or without the version of an older server', async () => {
    const { unmount } = renderPage({ kind: 'Member', permissions: ['finance.charters.read'] });
    expect(await screen.findByText('PUJ-20261108-004')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir cotización' })).not.toBeInTheDocument();
    unmount();
    mocks.list.mockResolvedValueOnce([{ ...CONFIRMED, version: null }]);
    renderPage();
    expect(await screen.findByText('PUJ-20261108-004')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir cotización' })).not.toBeInTheDocument();
  });

  it('keeps the empty, recoverable error and unauthorized states', async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValueOnce([]);
    const { unmount } = renderPage();
    expect(await screen.findByText('Sin charters')).toBeInTheDocument();
    unmount();
    mocks.list.mockRejectedValueOnce(failure(500, null, 'No se pudieron cargar los charters. Intente nuevamente.'));
    const second = renderPage();
    expect(await screen.findByText('No se pudieron cargar los charters. Intente nuevamente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('PUJ-20261108-004')).toBeInTheDocument();
    second.unmount();
    mocks.list.mockRejectedValueOnce(failure(403, null, 'Su acceso no incluye los charters de Finanzas.'));
    renderPage();
    expect(await screen.findByText('Su acceso no incluye los charters de Finanzas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });
});
