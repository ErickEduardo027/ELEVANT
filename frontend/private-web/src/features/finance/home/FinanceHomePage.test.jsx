import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FinanceHomePage from './FinanceHomePage';

const stationId = '10000000-0000-7000-8000-000000000001';
const stations = [{ stationId, stationCode: 'PUJ' }];
const data = {
  businessDate: '2026-10-31',
  toInvoice: { operations: 3, airlines: 2, oldestOperationDate: '2026-10-02' },
  invoicedThisMonth: [{ currencyCode: 'USD', count: 2, amount: 236 }],
  receivables: [{ currencyCode: 'USD', openInvoices: 2, open: 236, overdueInvoices: 1, overdue: 118 }],
  cardCollectionsThisMonth: [{ currencyCode: 'DOP', count: 1, amount: 5900 }],
  pendingContractApprovals: 1,
  chartersAwaitingPrepayment: 0,
};

function page(props = {}) {
  return <FinanceHomePage status="success" data={data} stations={stations}
    stationId={stationId} onStationChange={() => {}} onNavigate={() => {}} {...props} />;
}

it('shows the server indicators of «Inicio» without any preinvoice figure (4-A, 4-N02)', () => {
  render(page());
  expect(screen.getByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
  expect(screen.getByText(/al 31 oct de 2026/)).toBeInTheDocument();
  const toInvoice = screen.getByRole('article', { name: 'Operaciones por facturar' });
  expect(toInvoice).toHaveTextContent('3');
  expect(toInvoice).toHaveTextContent('2 aerolíneas · la más antigua del 02 oct de 2026');
  expect(screen.getByRole('article', { name: 'Facturado este mes' })).toHaveTextContent(/US\$236\.00.*2 facturas/);
  expect(screen.getByRole('article', { name: 'Por cobrar' })).toHaveTextContent(/US\$236\.00.*2 facturas abiertas/);
  expect(screen.getByRole('article', { name: 'Vencido' })).toHaveTextContent(/US\$118\.00.*1 factura vencida/);
  expect(screen.getByRole('article', { name: 'Cobrado con tarjeta este mes' })).toHaveTextContent(/5,900\.00.*1 pago/);
  expect(screen.getByRole('article', { name: 'Contratos por aprobar' })).toHaveTextContent('1');
  expect(screen.getByRole('article', { name: 'Charters con prepago pendiente' })).toHaveTextContent('0');
  expect(screen.queryByText(/prefactura/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/muestra hasta/i)).not.toBeInTheDocument();
});

it('hides the card of a module the template does not include', () => {
  render(page({ data: { ...data, receivables: null, cardCollectionsThisMonth: null, pendingContractApprovals: null,
    chartersAwaitingPrepayment: null } }));
  expect(screen.getByRole('article', { name: 'Operaciones por facturar' })).toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Facturado este mes' })).toBeInTheDocument();
  for (const label of ['Por cobrar', 'Vencido', 'Cobrado con tarjeta este mes', 'Contratos por aprobar',
    'Charters con prepago pendiente'])
    expect(screen.queryByRole('article', { name: label })).not.toBeInTheDocument();
});

it('opens the module of each card only when the account may open it', () => {
  const onNavigate = vi.fn();
  render(page({ onNavigate, canOpen: moduleId => moduleId !== 'finance-reconciliation' }));
  fireEvent.click(within(screen.getByRole('article', { name: 'Operaciones por facturar' }))
    .getByRole('button', { name: 'Ver por facturar' }));
  expect(onNavigate).toHaveBeenCalledWith('finance-to-invoice');
  fireEvent.click(within(screen.getByRole('article', { name: 'Contratos por aprobar' }))
    .getByRole('button', { name: 'Ver aprobaciones' }));
  expect(onNavigate).toHaveBeenLastCalledWith('finance-contract-approvals');
  fireEvent.click(within(screen.getByRole('article', { name: 'Charters con prepago pendiente' }))
    .getByRole('button', { name: 'Ver charters' }));
  expect(onNavigate).toHaveBeenLastCalledWith('finance-charters');
  expect(within(screen.getByRole('article', { name: 'Por cobrar' })).queryByRole('button')).not.toBeInTheDocument();
});

it('names an empty month and a station with nothing pending', () => {
  render(page({ data: { ...data, toInvoice: { operations: 0, airlines: 0, oldestOperationDate: null },
    invoicedThisMonth: [], receivables: [], cardCollectionsThisMonth: [] } }));
  expect(screen.getByRole('article', { name: 'Operaciones por facturar' }))
    .toHaveTextContent('No hay operaciones aprobadas pendientes de factura.');
  expect(screen.getByRole('article', { name: 'Facturado este mes' })).toHaveTextContent('Sin facturas este mes.');
  expect(screen.getByRole('article', { name: 'Por cobrar' })).toHaveTextContent('No hay saldos pendientes.');
  expect(screen.getByRole('article', { name: 'Vencido' })).toHaveTextContent('Nada vencido.');
});

it('selects another granted station', () => {
  const onStationChange = vi.fn();
  render(page({ stations: [...stations, { stationId: 'station-two', stationCode: 'SDQ' }], onStationChange }));
  fireEvent.change(screen.getByLabelText('Estación financiera'), { target: { value: 'station-two' } });
  expect(onStationChange).toHaveBeenCalledWith('station-two');
});

it('tells apart no station, no permission, a recoverable error, loading and an empty template', () => {
  const onRetry = vi.fn();
  const { rerender } = render(page({ status: 'error', data: null, error: 'Revise la conexión e intente de nuevo.', onRetry }));
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el resumen financiero.');
  expect(screen.getByRole('alert')).toHaveTextContent('Revise la conexión e intente de nuevo.');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(onRetry).toHaveBeenCalledOnce();

  rerender(page({ status: 'no-station', data: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('No hay una estación financiera autorizada');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();

  rerender(page({ status: 'forbidden', data: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('No tiene permiso para ver el resumen de Finanzas');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();

  rerender(page({ status: 'loading', data: null }));
  expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
  expect(screen.queryByRole('article')).not.toBeInTheDocument();

  rerender(page({ status: 'empty', data: { ...data, toInvoice: null, invoicedThisMonth: null, receivables: null,
    cardCollectionsThisMonth: null, pendingContractApprovals: null, chartersAwaitingPrepayment: null } }));
  expect(screen.getByText('Su plantilla no incluye indicadores de Finanzas.', { exact: false })).toBeInTheDocument();
});

it('keeps the indicators on screen while it revalidates and when a revalidation fails', () => {
  const onRetry = vi.fn();
  const { rerender } = render(page({ refreshing: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Actualizando…');
  expect(screen.getByRole('article', { name: 'Operaciones por facturar' })).toBeInTheDocument();
  rerender(page({ error: 'Revise la conexión e intente de nuevo.', onRetry }));
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo actualizar el resumen');
  expect(screen.getByRole('article', { name: 'Operaciones por facturar' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(onRetry).toHaveBeenCalledOnce();
});
