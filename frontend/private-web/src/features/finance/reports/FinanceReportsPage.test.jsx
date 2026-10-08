import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinanceReportsPage, { formatCell } from './FinanceReportsPage';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { downloadFinanceReport, getFinanceReport } from '../../../services/financeBookService';

vi.mock('../../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  getFinanceReport: vi.fn(),
  downloadFinanceReport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 'st-1', stationCode: 'PUJ' }] }) }));

const revenue = {
  key: 'revenue', title: 'Ingresos por período', description: 'Facturado por mes.', from: '2026-10-01', to: '2026-10-08',
  consolidationCurrency: 'USD', summary: [{ label: 'Consolidado USD', value: '1500.00', type: 'money', currencyCode: 'USD' }],
  columns: [{ key: 'month', label: 'Mes', type: 'text' }, { key: 'currency', label: 'Moneda', type: 'text' },
    { key: 'total', label: 'Total', type: 'money' }, { key: 'usd', label: 'Total USD', type: 'money' }],
  rows: [['2026-10', 'DOP', '58500.00', '1000.00']], notes: ['Nota de prueba.'],
};

function renderPage(codes = DepartmentPermissionCodes.finance) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}>
    <FinanceReportsPage initialStationId="st-1" /></DepartmentAccessProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('FinanceReportsPage', () => {
  it('formats money with the row currency and consolidated columns in USD', () => {
    expect(formatCell('58500.00', revenue.columns[2], revenue.rows[0], revenue.columns)).toMatch(/^DOP 58[.,]500/);
    expect(formatCell('1000.00', revenue.columns[3], revenue.rows[0], revenue.columns)).toMatch(/^USD 1[.,]000/);
    expect(formatCell(null, revenue.columns[2], revenue.rows[0], revenue.columns)).toBe('—');
  });

  it('reads the selected server report with the filters and exports it', async () => {
    getFinanceReport.mockResolvedValue(revenue);
    renderPage();
    expect(await screen.findByText('Nota de prueba.')).toBeInTheDocument();
    expect(getFinanceReport).toHaveBeenCalledWith('revenue', expect.objectContaining({ stationId: 'st-1' }));
    expect(within(screen.getByRole('table')).getByText('2026-10')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
    expect(downloadFinanceReport).toHaveBeenCalledWith('revenue', 'pdf', expect.objectContaining({ stationId: 'st-1' }));
    getFinanceReport.mockResolvedValue({ ...revenue, key: 'receivables', rows: [], notes: [] });
    await userEvent.click(screen.getByRole('tab', { name: 'Cuentas por cobrar' }));
    expect(await screen.findByText('Sin datos')).toBeInTheDocument();
    expect(getFinanceReport).toHaveBeenLastCalledWith('receivables', expect.any(Object));
  });

  it('hides export without the export permission and explains a forbidden read', async () => {
    getFinanceReport.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    renderPage(['finance.reports.read']);
    expect(await screen.findByRole('alert')).toHaveTextContent(/No tiene acceso/);
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
  });
});
