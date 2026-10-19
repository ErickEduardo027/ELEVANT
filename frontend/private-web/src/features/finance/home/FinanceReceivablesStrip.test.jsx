import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinanceReceivablesStrip from './FinanceReceivablesStrip';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { getFinanceReport, listContractApprovals } from '../../../services/financeBookService';

vi.mock('../../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  getFinanceReport: vi.fn(),
  listContractApprovals: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderStrip(codes, onNavigate = vi.fn()) {
  render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}>
    <FinanceReceivablesStrip stationId="st-1" onNavigate={onNavigate} revision={1} /></DepartmentAccessProvider>);
  return onNavigate;
}

describe('FinanceReceivablesStrip', () => {
  it('shows receivable and overdue balances from the server report and pending approvals', async () => {
    getFinanceReport.mockResolvedValue({ summary: [
      { label: 'Por cobrar USD', value: '1500.00', type: 'money', currencyCode: 'USD' },
      { label: 'Vencido USD', value: '200.00', type: 'money', currencyCode: 'USD' },
      { label: 'Facturas', value: '4', type: 'number' }] });
    listContractApprovals.mockResolvedValue([{ versionId: 'v-1' }, { versionId: 'v-2' }]);
    const onNavigate = renderStrip(DepartmentPermissionCodes.finance);
    expect(await screen.findByText('Por cobrar USD')).toBeInTheDocument();
    expect(screen.getByText('Vencido USD')).toBeInTheDocument();
    expect(screen.queryByText('Facturas')).not.toBeInTheDocument();
    const cutoff = new Date().toISOString().slice(0, 10);
    expect(getFinanceReport).toHaveBeenCalledWith('receivables', {
      stationId: 'st-1', from: cutoff, to: cutoff, currency: '',
    });
    await userEvent.click(await screen.findByRole('button', { name: /Contratos por aprobar/ }));
    expect(onNavigate).toHaveBeenCalledWith('finance-contract-approvals');
  });

  it('reads nothing the account is not allowed to see', () => {
    renderStrip(['finance.home.read']);
    expect(getFinanceReport).not.toHaveBeenCalled();
    expect(listContractApprovals).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Cuentas por cobrar')).not.toBeInTheDocument();
  });
});
