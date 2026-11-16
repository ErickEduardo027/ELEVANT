import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import AdjustmentNotesPanel from './AdjustmentNotesPanel';
import * as api from '../../../services/financeTreasuryService';
vi.mock('../../../services/financeTreasuryService', async original => ({ ...(await original()),
    getTreasuryAdjustments: vi.fn(), issueTreasuryAdjustment: vi.fn(), downloadAdjustmentNoteDocument: vi.fn(),
}));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 's-1', stationCode: 'PUJ' }] }) }));

const line = { invoiceLineId: 'l-1', lineNumber: 1, quantity: 1, amount: 118, creditQuantityRemaining: 1, creditAmountRemaining: 118,
    debitQuantityRemaining: 1, debitAmountRemaining: 118 };
const note = (id, number, kind = 'Credit', amount = 18) => ({ id, number, invoiceId: 'i-1', relatedNoteId: null, kind,
    currencyCode: 'USD', amount, effectiveOn: '2026-11-09', reason: 'Servicio parcial', recordedAt: '2026-11-09T15:00:00Z', lines: [] });
const adjustments = notes => ({ invoiceId: 'i-1', version: 'i-v1', legacyCredited: 0, lines: [line], notes });
function view() {
    return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance',
        ['finance.adjustments.read', 'finance.adjustments.create'])}>
        <AdjustmentNotesPanel invoiceId="i-1" invoiceNumber="E310000000001" currencyCode="USD" />
    </DepartmentAccessProvider>);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { vi.mocked(api.downloadAdjustmentNoteDocument).mockResolvedValue(undefined); });

it('names a note on an E31 invoice by its e-NCF and downloads its PDF (4-N17)', async () => {
    vi.mocked(api.getTreasuryAdjustments).mockResolvedValue(adjustments([note('n-34', 'E340000000001'),
        note('n-33', 'E330000000001', 'Debit', 5), note('n-tc', 'TC-QA')]));
    const user = userEvent.setup(); view();
    expect(await screen.findByText(/Nota de crédito electrónica E340000000001 · USD/)).toBeInTheDocument();
    expect(screen.getByText(/Nota de débito electrónica E330000000001 · USD/)).toBeInTheDocument();
    // A note of an invoice without e-NCF keeps its internal number.
    expect(screen.getByText(/^Nota de crédito TC-QA · USD/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Descargar PDF de Nota de crédito electrónica E340000000001' }));
    expect(api.downloadAdjustmentNoteDocument).toHaveBeenCalledWith('n-34', 'nota-E340000000001.pdf');
});

it('explains by its code a note PDF that could not be downloaded and tries it again (4-N17)', async () => {
    vi.mocked(api.getTreasuryAdjustments).mockResolvedValue(adjustments([note('n-34', 'E340000000001')]));
    vi.mocked(api.downloadAdjustmentNoteDocument).mockRejectedValueOnce({ status: 404, code: 'not_found', title: 'Not Found' });
    const user = userEvent.setup(); view();
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF de Nota de crédito electrónica E340000000001' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El documento no está disponible en su estación o aerolínea.');
    expect(alert).not.toHaveTextContent('Not Found');
    // The list stays on screen.
    expect(screen.getByText(/Nota de crédito electrónica E340000000001/)).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(api.downloadAdjustmentNoteDocument).toHaveBeenCalledTimes(2);
});

it('names the issued note by its e-NCF in the notice (4-N17)', async () => {
    vi.mocked(api.getTreasuryAdjustments).mockResolvedValueOnce(adjustments([]))
        .mockResolvedValueOnce(adjustments([note('n-1', 'E340000000002')]));
    vi.mocked(api.issueTreasuryAdjustment).mockResolvedValue({ id: 'n-1', version: 'i-v2', replayed: false });
    const user = userEvent.setup(); view();
    await user.click(await screen.findByRole('button', { name: 'Emitir nota' }));
    const dialog = screen.getByRole('dialog', { name: 'Emitir nota de ajuste' });
    await user.type(within(dialog).getByLabelText(/Cantidad línea 1/), '1');
    await user.type(within(dialog).getByLabelText(/Importe línea 1/), '18');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Servicio parcial');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar nota' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
        'Nota de crédito electrónica E340000000002 emitida. Los cobros y las devoluciones se gestionan por separado.');
    expect(screen.getByRole('button', { name: 'Descargar PDF de Nota de crédito electrónica E340000000002' })).toBeInTheDocument();
});
