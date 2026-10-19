import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import { applyPreinvoiceTaxes, getPreinvoiceTaxes } from '../../../services/financeTaxService';
import PreinvoiceTaxesPanel from './PreinvoiceTaxesPanel';
vi.mock('../../../services/financeTaxService', async original => ({ ...(await original()),
    getPreinvoiceTaxes: vi.fn(), applyPreinvoiceTaxes: vi.fn(),
    createTaxCommand: () => async (_key, body, send) => send({ ...body, requestId: 'stable-request' }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('does not reopen an old preinvoice after its tax mutation completes in the background', async () => {
    let finish;
    getPreinvoiceTaxes.mockImplementation(async id => ({ id, version: 'v1', treatmentsConfigured: false, currencyCode: 'USD', lines: [], net: 0, discount: 0, tax: null, gross: 0 }));
    applyPreinvoiceTaxes.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onChanged = vi.fn();
    const view = id => <DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', ['finance.taxes.read','finance.taxes.manage'])}>
        <PreinvoiceTaxesPanel key={id} preinvoiceId={id} status="Draft" onChanged={onChanged} /></DepartmentAccessProvider>;
    const { rerender } = render(view('pre-a'));
    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar tratamientos pendientes' }));
    expect(applyPreinvoiceTaxes).toHaveBeenCalledWith('pre-a', expect.any(Object));
    rerender(view('pre-b'));
    await screen.findByRole('button', { name: 'Aplicar tratamientos pendientes' });
    await act(async () => finish({ id: 'pre-a' }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(getPreinvoiceTaxes.mock.calls.map(call => call[0])).toEqual(['pre-a', 'pre-b']);
});
