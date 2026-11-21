import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatementDownloads from './StatementDownloads';
import { exportFinanceStatement } from '../../../services/financeTreasuryService';
import { downloadFile } from '../../../utils/downloadFile';

vi.mock('../../../services/financeTreasuryService', () => ({
  exportFinanceStatement: vi.fn(), statementExportsAvailable: vi.fn(() => false),
  statementFileName: (filters, format) => `elevant-estado-de-cuenta-${filters.asOf}.${format}`,
  treasuryError: () => 'No tiene permiso para esta acción.',
}));
vi.mock('../../../utils/downloadFile', () => ({ downloadFile: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const filters = { asOf: '2026-11-21', stationId: 'st-1', airlineId: '' };

it('shows no button while the API cannot generate the statement', () => {
  const { container } = render(<StatementDownloads filters={filters} />);
  expect(container).toBeEmptyDOMElement();
});

it('downloads the statement on screen as PDF or Excel once the API can', async () => {
  exportFinanceStatement.mockResolvedValue(new Blob(['%PDF']));
  render(<StatementDownloads filters={filters} available />);
  const group = screen.getByRole('group', { name: 'Descargas del estado de cuenta' });
  expect(group).toHaveTextContent('Descargar PDFDescargar Excel');
  await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), 'elevant-estado-de-cuenta-2026-11-21.xlsx'));
  expect(exportFinanceStatement).toHaveBeenCalledWith(filters, 'xlsx');
  exportFinanceStatement.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }));
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo descargar el PDF: No tiene permiso para esta acción.');
});
