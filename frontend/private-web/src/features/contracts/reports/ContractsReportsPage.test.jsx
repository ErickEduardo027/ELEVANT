import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import ContractsReportsPage, { contractMetrics } from './ContractsReportsPage';
import { contractReportsAvailable, getContractsReportIndicators } from '../../../services/contractsReportsService';

vi.mock('../../../services/contractsReportsService', () => ({ EXPIRING_DAYS: 30, getContractsReportIndicators: vi.fn(),
  contractReportsAvailable: vi.fn(), createContractReportSource: vi.fn() }));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));

const data = { today: '2026-11-21', limit: '2026-12-21', complete: true, contracts: 50, active: 8, drafts: 2,
  requests: { pending: 3, approved: 5, total: 12 },
  expiring: [{ id: 'c', code: 'AVM-2026-001', airline: 'Arajet', validTo: '2026-11-22', daysLeft: 1 }] };

beforeEach(() => {
  getContractsReportIndicators.mockResolvedValue(data);
  contractReportsAvailable.mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('gives each figure its context: never a cold number (G3)', () => {
  expect(contractMetrics(data)).toEqual([
    { label: 'Contratos activos', value: '8', context: 'de 50 contratos registrados (16.0 %)' },
    { label: 'Por vencer en 30 días', value: '1', context: 'de 8 activos, hasta el 21/12/2026' },
    { label: 'Borradores por activar', value: '2', context: 'versiones en revisión antes de la firma' },
    { label: 'Solicitudes pendientes', value: '3', context: 'de 12 solicitudes (5 aprobadas)' },
  ]);
});

it('shows the indicators with real totals and the contracts that end soon, without dead downloads', async () => {
  render(<ContractsReportsPage />);
  expect(screen.getByRole('heading', { level: 1, name: 'Reportes contractuales' })).toBeInTheDocument();
  const section = await screen.findByRole('region', { name: 'Indicadores contractuales' });
  expect(within(section).getByLabelText('Resumen del reporte')).toHaveTextContent('de 50 contratos registrados (16.0 %)');
  const table = within(section).getByRole('table', { name: 'Contratos por vencer' });
  expect(within(table).getByText('Arajet')).toBeInTheDocument();
  expect(within(table).getByText('22/11/2026')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Descargar/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/esta página/)).not.toBeInTheDocument();
});

it('explains a refusal without retry', async () => {
  getContractsReportIndicators.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }));
  render(<ContractsReportsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});
