import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreinvoicesPage from './PreinvoicesPage';
import { getFinancePreinvoices, submitFinancePreinvoice, issueFinanceInvoice,
  getFinanceInvoiceByPreinvoice, getFinancePaymentByInvoice,
  getFinanceInvoiceDocument, getFinancePaymentReceipt,
  recordNonFiscalPayment, resolveFinancePreinvoiceDispute } from '../../../services/financePreinvoiceService';
import { getPreinvoiceDraft, getFinancePreinvoiceDisputes } from '../../../services/approvedServicesService';

vi.mock('../../../features/auth/authService', () => ({ readSession: () => ({
  accountId: 'finance-account', stationScopes: [
    { stationId: 'station-one', stationCode: 'PUJ' },
    { stationId: 'station-two', stationCode: 'SDQ' },
  ],
}) }));
vi.mock('../../../services/financePreinvoiceService', () => ({
  getFinancePreinvoices: vi.fn(), submitFinancePreinvoice: vi.fn(),
  issueFinanceInvoice: vi.fn(), getFinanceInvoiceByPreinvoice: vi.fn(),
  getFinancePaymentByInvoice: vi.fn(), recordNonFiscalPayment: vi.fn(),
  getFinanceInvoiceDocument: vi.fn(), getFinancePaymentReceipt: vi.fn(),
  resolveFinancePreinvoiceDispute: vi.fn(),
}));
vi.mock('../../../services/approvedServicesService', () => ({
  getPreinvoiceDraft: vi.fn(), getFinancePreinvoiceDisputes: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: async () => {}, stop: async () => {} }),
}));

const item = { id: 'preinvoice-one', airlineId: 'airline-one', airlineName: 'Synthetic Air',
  stationId: 'station-one', from: '2026-08-18', to: '2026-08-18', currencyCode: 'USD',
  total: 42.0001, status: 'Draft', lineCount: 1, createdAt: '2026-08-19T12:00:00Z' };

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => getFinancePreinvoiceDisputes.mockResolvedValue({ preinvoiceId: item.id, disputes: [] }));
beforeEach(() => getFinancePaymentByInvoice.mockResolvedValue({ invoiceId: 'invoice-one', payment: null }));

it('opens the station selected in the Finance summary', async () => {
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20,
    hasMore: false, preinvoices: [] });
  render(<PreinvoicesPage initialStationId="station-two" />);
  await waitFor(() => expect(getFinancePreinvoices).toHaveBeenCalledWith(
    { stationId: 'station-two', page: 1, limit: 20 }, expect.any(Object)));
  expect(screen.getByLabelText('Estación de prefacturas')).toHaveValue('station-two');
});

it('shows the persisted station-scoped list and read-only detail', async () => {
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false, preinvoices: [item] });
  getPreinvoiceDraft.mockResolvedValue({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  render(<PreinvoicesPage />);
  expect(await screen.findByText('Synthetic Air')).toBeInTheDocument();
  expect(screen.getByText('USD 42.0001')).toBeInTheDocument();
  expect(getFinancePreinvoices).toHaveBeenCalledWith({ stationId: 'station-one', page: 1, limit: 20 }, expect.any(Object));
  expect(screen.queryByRole('button', { name: /aprobar|enviar|generar pre-factura/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(await screen.findByText(/Ground power/)).toBeInTheDocument();
  expect(getPreinvoiceDraft).toHaveBeenCalledWith('preinvoice-one', 'station-one');
});

it('shows the airline dispute and its selected priced lines to scoped Finance', async () => {
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [{ ...item, status: 'Disputed' }] });
  getPreinvoiceDraft.mockResolvedValue({ ...item, status: 'Disputed',
    lines: [{ id: 'line-one', operationCode: 'DEV-TAT-1', operationDate: '2026-08-18',
      serviceName: 'Ground power', amount: 42.0001 }],
    });
  getFinancePreinvoiceDisputes.mockResolvedValue({ preinvoiceId: item.id,
    disputes: [{ id: 'dispute-one', subject: 'Cantidad incorrecta',
      description: 'La cantidad de GPU no coincide.', lineIds: ['line-one'],
      createdAt: '2026-08-20T12:00:00Z' }] });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(await screen.findByText('Cantidad incorrecta')).toBeInTheDocument();
  expect(screen.getByText('La cantidad de GPU no coincide.')).toBeInTheDocument();
  expect(screen.getAllByText(/Ground power/)).toHaveLength(2);
});

it('requires a reason and explicit confirmation to maintain disputed charges', async () => {
  const disputed = { ...item, status: 'Disputed' };
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [disputed] }).mockResolvedValue({ page: 1, limit: 20,
    hasMore: false, preinvoices: [{ ...item, status: 'Submitted' }] });
  getPreinvoiceDraft.mockResolvedValue({ ...disputed, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', operationDate: '2026-08-18',
    serviceName: 'Ground power', amount: 42.0001 }] });
  getFinancePreinvoiceDisputes.mockResolvedValue({ preinvoiceId: item.id,
    disputes: [{ id: 'dispute-one', subject: 'Cantidad incorrecta',
      description: 'La cantidad de GPU no coincide.', lineIds: ['line-one'],
      createdAt: '2026-08-20T12:00:00Z', resolution: null }] });
  resolveFinancePreinvoiceDispute.mockResolvedValue({ id: 'resolution-one',
    preinvoiceId: item.id, status: 'Submitted', replayed: false });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText('Cantidad incorrecta');
  await userEvent.click(screen.getByRole('button', { name: 'Mantener cargos' }));
  expect(resolveFinancePreinvoiceDispute).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Continuar resolución' })).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Motivo de resolución' }),
    'Se verificó la evidencia aprobada.');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar resolución' }));
  expect(resolveFinancePreinvoiceDispute).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolución' }));
  await waitFor(() => expect(resolveFinancePreinvoiceDispute).toHaveBeenCalledExactlyOnceWith(
    item.id, expect.objectContaining({ decision: 'Maintain',
      reason: 'Se verificó la evidencia aprobada.', requestId: expect.any(String) })));
  expect(await screen.findByText('Cargos mantenidos. La aerolínea debe revisar de nuevo la prefactura.'))
    .toBeInTheDocument();
  expect(await screen.findByText('Enviada')).toBeInTheDocument();
});

it('retries an uncertain void decision with the same key and reason', async () => {
  const disputed = { ...item, status: 'Disputed' };
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [disputed] }).mockResolvedValue({ page: 1, limit: 20,
    hasMore: false, preinvoices: [{ ...item, status: 'Voided' }] });
  getPreinvoiceDraft.mockResolvedValue({ ...disputed, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', operationDate: '2026-08-18',
    serviceName: 'Ground power', amount: 42.0001 }] });
  getFinancePreinvoiceDisputes.mockResolvedValue({ preinvoiceId: item.id,
    disputes: [{ id: 'dispute-one', subject: 'Cantidad incorrecta',
      description: 'La cantidad de GPU no coincide.', lineIds: ['line-one'],
      createdAt: '2026-08-20T12:00:00Z', resolution: null }] });
  resolveFinancePreinvoiceDispute.mockRejectedValueOnce(new Error('private details'))
    .mockResolvedValueOnce({ id: 'resolution-one', preinvoiceId: item.id,
      status: 'Voided', replayed: true });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText('Cantidad incorrecta');
  await userEvent.click(screen.getByRole('button', { name: 'Anular prefactura' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Motivo de resolución' }),
    'No corresponde al servicio aprobado.');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar resolución' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolución' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('misma clave');
  expect(screen.queryByText('private details')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar resolución' }));
  await waitFor(() => expect(resolveFinancePreinvoiceDispute).toHaveBeenCalledTimes(2));
  expect(resolveFinancePreinvoiceDispute.mock.calls[0]).toEqual(
    resolveFinancePreinvoiceDispute.mock.calls[1]);
  expect(await screen.findByText('Prefactura anulada. Sus servicios pueden incluirse en una corrección.'))
    .toBeInTheDocument();
});

it('keeps a dispute resolution reason and retry key across focus refreshes', async () => {
  const disputed = { ...item, status: 'Disputed' };
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [disputed] });
  getPreinvoiceDraft.mockResolvedValue({ ...disputed, lines: [] });
  getFinancePreinvoiceDisputes.mockResolvedValue({ preinvoiceId: item.id,
    disputes: [{ id: 'dispute-one', subject: 'Cantidad incorrecta',
      description: 'La cantidad no coincide.', lineIds: [],
      createdAt: '2026-08-20T12:00:00Z' }] });
  resolveFinancePreinvoiceDispute.mockRejectedValueOnce(new Error('uncertain response'))
    .mockResolvedValueOnce({ id: 'resolution-one', preinvoiceId: item.id,
      status: 'Submitted', replayed: true });

  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText('Cantidad incorrecta');
  await userEvent.click(screen.getByRole('button', { name: 'Mantener cargos' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Motivo de resolución' }),
    'Revisamos el soporte aprobado.');
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByDisplayValue('Revisamos el soporte aprobado.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Continuar resolución' }));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('button', { name: 'Confirmar resolución' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolución' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('misma clave');
  await act(async () => window.dispatchEvent(new Event('focus')));
  await userEvent.click(await screen.findByRole('button', { name: 'Reintentar resolución' }));
  await waitFor(() => expect(resolveFinancePreinvoiceDispute).toHaveBeenCalledTimes(2));
  expect(resolveFinancePreinvoiceDispute.mock.calls[1])
    .toEqual(resolveFinancePreinvoiceDispute.mock.calls[0]);
});

it('paginates and renders honest empty, forbidden and retry states', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({ ...item,
    id: `preinvoice-${index}`, airlineName: index === 0 ? 'Synthetic Air' : `Airline ${index}` }));
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: true, preinvoices: firstPage })
    .mockResolvedValueOnce({ page: 2, limit: 20, hasMore: false, preinvoices: [] });
  const view = render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
  expect(await screen.findByText('No hay prefacturas en esta página.')).toBeInTheDocument();
  expect(getFinancePreinvoices).toHaveBeenLastCalledWith({ stationId: 'station-one', page: 2, limit: 20 }, expect.any(Object));
  view.unmount();

  getFinancePreinvoices.mockRejectedValueOnce({ status: 403 });
  const denied = render(<PreinvoicesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No tiene acceso');
  denied.unmount();

  getFinancePreinvoices.mockRejectedValueOnce(new Error('network'));
  render(<PreinvoicesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar');
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});

it('does not show stale detail after switching stations', async () => {
  let finishDetail;
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [item] });
  getPreinvoiceDraft.mockReturnValue(new Promise(resolve => { finishDetail = resolve; }));
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await userEvent.selectOptions(screen.getByLabelText('Estación de prefacturas'), 'station-two');
  await waitFor(() => expect(getFinancePreinvoices).toHaveBeenLastCalledWith(
    { stationId: 'station-two', page: 1, limit: 20 }, expect.any(Object)));
  await act(async () => finishDetail({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] }));
  expect(screen.queryByText(/Ground power/)).not.toBeInTheDocument();
});

it('hides open detail when a fresh authorization check denies access', async () => {
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [item] }).mockRejectedValueOnce({ status: 403 });
  getPreinvoiceDraft.mockResolvedValue({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(await screen.findByText(/Ground power/)).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tiene acceso');
  expect(screen.queryByText(/Ground power/)).not.toBeInTheDocument();
});

it('requires confirmation before sending a persisted draft and refreshes the authoritative list', async () => {
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [item] }).mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [{ ...item, status: 'Submitted' }] });
  getPreinvoiceDraft.mockResolvedValue({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  submitFinancePreinvoice.mockResolvedValue({ id: item.id, status: 'Submitted', replayed: false });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText(/Ground power/);
  await userEvent.click(screen.getByRole('button', { name: 'Enviar a aerolínea' }));
  expect(submitFinancePreinvoice).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar envío' }));
  await waitFor(() => expect(submitFinancePreinvoice).toHaveBeenCalledExactlyOnceWith(item.id));
  expect(await screen.findByText('Prefactura enviada a revisión de la aerolínea.')).toBeInTheDocument();
  expect(await screen.findByText('Enviada')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enviar a aerolínea' })).not.toBeInTheDocument();
});

it('offers a safe retry after an uncertain network response without exposing server text', async () => {
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [item] });
  getPreinvoiceDraft.mockResolvedValue({ ...item, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  submitFinancePreinvoice.mockRejectedValueOnce(new Error('internal connection details'));
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText(/Ground power/);
  await userEvent.click(screen.getByRole('button', { name: 'Enviar a aerolínea' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar envío' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar el envío');
  expect(screen.queryByText(/internal connection details/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reintentar envío' })).toBeInTheDocument();
});

it('confirms invoice issuance once for an accepted preinvoice and refreshes the list', async () => {
  const accepted = { ...item, status: 'Accepted' };
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [accepted] }).mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [{ ...accepted, status: 'Invoiced' }] });
  getPreinvoiceDraft.mockResolvedValue({ ...accepted, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  issueFinanceInvoice.mockResolvedValue({ id: 'invoice-one', preinvoiceId: item.id,
    number: 'NF-123', kind: 'NonFiscal', replayed: false });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText(/Ground power/);
  await userEvent.click(screen.getByRole('button', { name: 'Emitir factura no fiscal' }));
  expect(issueFinanceInvoice).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar emisión' }));
  await waitFor(() => expect(issueFinanceInvoice).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ preinvoiceId: item.id, requestId: expect.any(String) })));
  expect(await screen.findByText(/NF-123/)).toBeInTheDocument();
  expect(await screen.findByText('Facturada')).toBeInTheDocument();
});

it('reads the frozen invoice for an already invoiced preinvoice without issuing again', async () => {
  const invoiced = { ...item, status: 'Invoiced' };
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [invoiced] });
  getPreinvoiceDraft.mockResolvedValue({ ...invoiced, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  getFinanceInvoiceByPreinvoice.mockResolvedValue({ number: 'NF-123', kind: 'NonFiscal',
    currencyCode: 'USD', total: 42.0001, lines: [{ id: 'invoice-line', lineNumber: 1,
      operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(await screen.findByText(/NF-123/)).toBeInTheDocument();
  expect(getFinanceInvoiceByPreinvoice).toHaveBeenCalledWith(item.id);
  expect(issueFinanceInvoice).not.toHaveBeenCalled();
});

it('lets Finance download the frozen invoice and registered receipt', async () => {
  const invoiced = { ...item, status: 'Invoiced' };
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [invoiced] });
  getPreinvoiceDraft.mockResolvedValue({ ...invoiced, lines: [] });
  getFinanceInvoiceByPreinvoice.mockResolvedValue({ id: 'invoice-one',
    number: 'NF-123', currencyCode: 'USD', total: 42.0001, lines: [] });
  getFinancePaymentByInvoice.mockResolvedValue({ invoiceId: 'invoice-one',
    payment: { id: 'payment-one', reference: 'BANK-TEST-123', amount: 42.0001,
      currencyCode: 'USD' } });
  getFinanceInvoiceDocument.mockResolvedValue(new Blob(['%PDF-1.7']));
  getFinancePaymentReceipt.mockResolvedValue(new Blob(['%PDF-1.7']));
  const createObjectURL = vi.fn(() => 'blob:finance-test');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    render(<PreinvoicesPage />);
    await screen.findByText('Synthetic Air');
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    await screen.findByText(/NF-123/);
    await userEvent.click(screen.getByRole('button', { name: 'Descargar factura PDF' }));
    await waitFor(() => expect(getFinanceInvoiceDocument).toHaveBeenCalledWith(item.id));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar recibo PDF' }));
    await waitFor(() => expect(getFinancePaymentReceipt).toHaveBeenCalledWith('invoice-one'));
    expect(click).toHaveBeenCalledTimes(2);
  } finally {
    click.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
});

it('records a manual non-fiscal payment only after confirmation and rereads it', async () => {
  const invoiced = { ...item, status: 'Invoiced' };
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [invoiced] });
  getPreinvoiceDraft.mockResolvedValue({ ...invoiced, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  getFinanceInvoiceByPreinvoice.mockResolvedValue({ id: 'invoice-one',
    number: 'NF-123', kind: 'NonFiscal', currencyCode: 'USD', total: 42.0001,
    lines: [{ id: 'invoice-line', lineNumber: 1, operationCode: 'DEV-TAT-1',
      serviceName: 'Ground power', amount: 42.0001 }] });
  getFinancePaymentByInvoice.mockResolvedValueOnce({ invoiceId: 'invoice-one', payment: null })
    .mockResolvedValueOnce({ invoiceId: 'invoice-one', payment: { id: 'payment-one',
      reference: 'BANK-TEST-123', currencyCode: 'USD', amount: 42.0001 } });
  recordNonFiscalPayment.mockResolvedValue({ id: 'payment-one' });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  expect(await screen.findByText(/NF-123/)).toBeInTheDocument();
  expect(screen.getByText(/Sin pago registrado/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Registrar pago manual' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Referencia de pago' }), 'BANK-TEST-123');
  expect(recordNonFiscalPayment).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago manual' }));
  await waitFor(() => expect(recordNonFiscalPayment).toHaveBeenCalledWith(expect.objectContaining({
    invoiceId: 'invoice-one', reference: 'BANK-TEST-123',
  })));
  expect(await screen.findByText(/BANK-TEST-123/)).toBeInTheDocument();
  expect(getFinancePaymentByInvoice.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(getFinancePaymentByInvoice).toHaveBeenLastCalledWith('invoice-one');
});

it('retries an uncertain manual payment with the same key and reference', async () => {
  const invoiced = { ...item, status: 'Invoiced' };
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [invoiced] });
  getPreinvoiceDraft.mockResolvedValue({ ...invoiced, lines: [] });
  getFinanceInvoiceByPreinvoice.mockResolvedValue({ id: 'invoice-one',
    number: 'NF-123', currencyCode: 'USD', total: 42.0001, lines: [] });
  getFinancePaymentByInvoice.mockResolvedValueOnce({ invoiceId: 'invoice-one', payment: null })
    .mockResolvedValue({ invoiceId: 'invoice-one', payment: {
      id: 'payment-one', reference: 'BANK-TEST-123', amount: 42.0001,
      currencyCode: 'USD' } });
  recordNonFiscalPayment.mockRejectedValueOnce(new Error('private network detail'))
    .mockResolvedValueOnce({ id: 'payment-one', replayed: true });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText(/Sin pago registrado/);
  await userEvent.click(screen.getByRole('button', { name: 'Registrar pago manual' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Referencia de pago' }), 'BANK-TEST-123');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar pago manual' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('misma referencia y clave');
  expect(screen.queryByText(/private network detail/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar pago manual' }));
  await waitFor(() => expect(recordNonFiscalPayment).toHaveBeenCalledTimes(2));
  expect(recordNonFiscalPayment.mock.calls[0][0]).toEqual(recordNonFiscalPayment.mock.calls[1][0]);
});

it('revalidates an open invoice when the durable finance feed changes', async () => {
  const invoiced = { ...item, status: 'Invoiced' };
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [invoiced] });
  getPreinvoiceDraft.mockResolvedValue({ ...invoiced, lines: [] });
  getFinanceInvoiceByPreinvoice.mockResolvedValue({ id: 'invoice-one',
    number: 'NF-123', currencyCode: 'USD', total: 42.0001, lines: [] });
  getFinancePaymentByInvoice.mockResolvedValueOnce({ invoiceId: 'invoice-one', payment: null })
    .mockResolvedValue({ invoiceId: 'invoice-one', payment: {
      id: 'payment-one', reference: 'BANK-TEST-123', amount: 42.0001,
      currencyCode: 'USD' } });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText(/Sin pago registrado/);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText(/BANK-TEST-123/)).toBeInTheDocument();
  expect(getFinancePaymentByInvoice.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('retries an uncertain invoice response with the same idempotency key', async () => {
  const accepted = { ...item, status: 'Accepted' };
  getFinancePreinvoices.mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [accepted] });
  getPreinvoiceDraft.mockResolvedValue({ ...accepted, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  issueFinanceInvoice.mockRejectedValueOnce(new Error('network details'))
    .mockResolvedValueOnce({ id: 'invoice-one', preinvoiceId: item.id,
      number: 'NF-123', kind: 'NonFiscal', replayed: true });
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText(/Ground power/);
  await userEvent.click(screen.getByRole('button', { name: 'Emitir factura no fiscal' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar emisión' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reintente con la misma clave');
  expect(screen.queryByText(/network details/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar emisión' }));
  await waitFor(() => expect(issueFinanceInvoice).toHaveBeenCalledTimes(2));
  expect(issueFinanceInvoice.mock.calls[0][0]).toEqual(issueFinanceInvoice.mock.calls[1][0]);
});

it('keeps the confirmed invoice result when a durable refresh arrives before HTTP completion', async () => {
  const accepted = { ...item, status: 'Accepted' };
  getFinancePreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [accepted] }).mockResolvedValue({ page: 1, limit: 20, hasMore: false,
    preinvoices: [{ ...accepted, status: 'Invoiced' }] });
  getPreinvoiceDraft.mockResolvedValue({ ...accepted, lines: [{ id: 'line-one',
    operationCode: 'DEV-TAT-1', serviceName: 'Ground power', amount: 42.0001 }] });
  let finishIssue;
  issueFinanceInvoice.mockReturnValue(new Promise(resolve => { finishIssue = resolve; }));
  render(<PreinvoicesPage />);
  await screen.findByText('Synthetic Air');
  await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  await screen.findByText(/Ground power/);
  await userEvent.click(screen.getByRole('button', { name: 'Emitir factura no fiscal' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar emisión' }));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await screen.findByText('Facturada');
  await act(async () => finishIssue({ number: 'NF-123' }));
  expect(await screen.findByText(/NF-123/)).toBeInTheDocument();
});
