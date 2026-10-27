import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { commercialApi } from '../../../services/commercialGovernanceApi';
import FiscalDocumentsPage from './FiscalDocumentsPage';
vi.mock('../../../services/commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 'station', stationCode: 'PUJ' }] }), handleUnauthorizedResponse: vi.fn() }));
const permissions = ['finance.fiscal.read', 'finance.fiscal.create', 'finance.fiscal.simulate', 'finance.reconciliation.read'];
const invoice = { id: 'invoice', number: 'NF-2026-001', preinvoiceId: 'preinvoice', airlineId: 'airline', airline: 'Aerolínea del Caribe',
  stationId: 'station', stationCode: 'PUJ', currencyCode: 'USD', total: 1250, paid: 0, credited: 0, balance: 1250,
  issuedAt: '2026-10-18T00:00:00Z', dueDate: '2026-11-18', status: 'Pending', daysOverdue: 0 };
const otherInvoice = { ...invoice, id: 'other-invoice', number: 'NF-2026-002', airline: 'Vuelos del Norte', currencyCode: 'DOP', total: 60000, balance: 60000 };
const document = { id: 'doc', invoiceId: 'invoice', stationId: 'station', mode: 'LocalSimulation', environment: 'Development',
  state: 'Unknown', artifactCompletion: 'Failed', snapshotHash: 'abc', canonicalSnapshot: '{}', total: 100, currencyCode: 'USD',
  providerDocumentId: 'SIM-doc', dgiiResponseId: null, encf: null, version: 'AAAAAAAAAAE=', createdAt: '2026-10-18T00:00:00Z',
  artifacts: [{ id: 'artifact', kind: 'CanonicalJson', fileName: 'canonical.json', sha256: 'abc', length: 2 }],
  history: [{ id: 'event', kind: 'SimulationCompleted', state: 'Unknown', applied: true, detail: 'Timeout', occurredAt: '2026-10-18T00:00:00Z' }] };
let mode, current, error;
function mount(grants = permissions, props = {}) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'finance', permissions: grants,
    stations: [{ stationId: 'station', stationCode: 'PUJ' }, { stationId: 'other-station', stationCode: 'SDQ' }] }}><FiscalDocumentsPage {...props} /></DepartmentAccessProvider>);
}
const ledgerPage = (invoices, page = 1, hasMore = false) => ({ page, limit: 25, hasMore, invoices });
function http(path, options) {
  if (error) throw error;
  if (path.endsWith('/status')) return { mode, environment: 'Development', canSimulate: mode === 'LocalSimulation', officialXsdValidation: 'NotPerformed' };
  if (options?.method) return { documentId: 'doc', version: 'AAAAAAAAAAI=', replayed: false };
  if (path.startsWith('/finance/invoices?')) return ledgerPage([invoice]);
  if (path === '/finance/invoices/invoice') return { summary: invoice, lines: [], payments: [], creditNotes: [] };
  if (path === '/finance/fiscal-documents/doc') return current;
  return [current];
}
async function openCreation() {
  await userEvent.click(await screen.findByRole('button', { name: 'Nueva simulación' }));
}
beforeEach(() => {
  mode = 'LocalSimulation'; current = { ...document }; error = null;
  commercialApi.mockImplementation(async (path, options) => http(path, options));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('Fiscal documents', () => {
  it('shows unknown state, incomplete archive and history with refresh only', async () => {
    mount(); await userEvent.click(await screen.findByRole('button', { name: /Factura invoice/ }));
    expect(screen.getByText('SIMULACIÓN SIN VALIDEZ FISCAL')).toBeInTheDocument();
    expect(screen.getByText(/Archivo incompleto/)).toBeInTheDocument();
    expect(screen.getByText(/No reenvíe/)).toBeInTheDocument();
    expect(screen.getByText('Timeout')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar canonical.json' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ejecutar simulación local' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }));
    await waitFor(() => expect(commercialApi).toHaveBeenCalledWith('/finance/fiscal-documents/doc'));
    expect(commercialApi.mock.calls.some(([, options]) => options?.method)).toBe(false);
  });
  it('Off hides creation and dispatch while retaining document visibility', async () => {
    mode = 'Off'; mount();
    await screen.findByText(/Modo: Off/);
    expect(screen.queryByRole('button', { name: 'Nueva simulación' })).not.toBeInTheDocument();
  });
  it('readers cannot create or dispatch', async () => {
    current = { ...document, state: 'AwaitingArchive' };
    mount(['finance.fiscal.read']);
    await userEvent.click(await screen.findByRole('button', { name: /Factura invoice/ }));
    expect(screen.queryByRole('button', { name: 'Nueva simulación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ejecutar simulación local' })).not.toBeInTheDocument();
  });
  it('retries archiving only before dispatch and sends the persisted version', async () => {
    current = { ...document, state: 'ArchiveBlocked' }; mount();
    await userEvent.click(await screen.findByRole('button', { name: /Factura invoice/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar archivo y simular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar simulación' }));
    await waitFor(() => expect(commercialApi.mock.calls.some(([path, options]) => path.endsWith('/simulate') && options?.method === 'POST')).toBe(true));
    const call = commercialApi.mock.calls.find(([path, options]) => path.endsWith('/simulate') && options?.method);
    expect(JSON.parse(call[1].body)).toMatchObject({ expectedVersion: 'AAAAAAAAAAE=', requestId: expect.any(String) });
  });
  it('keeps a dispatch failure visible after refreshing and never blindly retries unknown', async () => {
    current = { ...document, state: 'AwaitingArchive' }; mount();
    await userEvent.click(await screen.findByRole('button', { name: /Factura invoice/ }));
    commercialApi.mockImplementation(async (path, options) => {
      if (options?.method) { current = { ...document, state: 'Unknown' }; throw new Error('Private lost-response detail'); }
      if (path.endsWith('/status')) return { mode: 'LocalSimulation', environment: 'Development', canSimulate: true };
      if (path.endsWith('/doc')) return current;
      return [current];
    });
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar simulación local' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar simulación' }));
    expect(await screen.findByText(/No reenvíe/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('Private lost-response detail');
    expect(screen.queryByRole('button', { name: 'Ejecutar simulación local' })).not.toBeInTheDocument();
    expect(commercialApi.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
  });
  it('does not request data without fiscal read permission', () => {
    mount([]); expect(screen.getByRole('alert')).toHaveTextContent('permiso');
    expect(commercialApi).not.toHaveBeenCalled();
  });
  it('renders a safe recoverable server error', async () => {
    error = Object.assign(new Error('SQL private detail'), { status: 403 }); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('permiso');
    expect(screen.queryByText('SQL private detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar carga' })).toBeInTheDocument();
  });

  it('creates from an issued invoice identified by number, airline and amount without entering a UUID', async () => {
    mount(); await openCreation();
    expect(screen.queryByLabelText('Identificador de factura')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeDisabled();
    const choice = await screen.findByRole('radio', { name: /NF-2026-001.*Aerolínea del Caribe.*USD.*1[,.]250/ });
    await userEvent.click(choice);
    await userEvent.selectOptions(screen.getByLabelText('Resultado a simular'), 'Rejected');
    await userEvent.click(screen.getByRole('button', { name: 'Crear simulación' }));
    expect(await screen.findByText(/Documento canónico creado/)).toBeInTheDocument();
    const sent = commercialApi.mock.calls.find(([path, options]) => path === '/finance/fiscal-documents' && options?.method === 'POST');
    expect(JSON.parse(sent[1].body)).toEqual({ invoiceId: 'invoice', outcome: 'Rejected', requestId: expect.any(String) });
  });

  it('browses ledger pages and searches invoices beyond the first page', async () => {
    commercialApi.mockImplementation(async (path, options) => {
      if (path.startsWith('/finance/invoices?')) {
        return new URL(path, 'https://elevant.test').searchParams.get('page') === '2'
          ? ledgerPage([otherInvoice], 2) : ledgerPage([invoice], 1, true);
      }
      return http(path, options);
    });
    mount(); await openCreation(); await screen.findByRole('radio', { name: /NF-2026-001/ });
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente página de facturas' }));
    expect(await screen.findByRole('radio', { name: /NF-2026-002.*Vuelos del Norte.*DOP/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Página anterior de facturas' }));
    await screen.findByRole('radio', { name: /NF-2026-001/ });
    await userEvent.type(screen.getByLabelText('Buscar facturas'), 'Vuelos del Norte');
    expect(await screen.findByRole('radio', { name: /NF-2026-002/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /NF-2026-001/ })).not.toBeInTheDocument();
  });

  it('resolves an initial invoice outside the current ledger page with its financial context', async () => {
    commercialApi.mockImplementation(async (path, options) => path === '/finance/invoices/other-invoice'
      ? { summary: otherInvoice, lines: [], payments: [], creditNotes: [] } : http(path, options));
    mount(permissions, { initialInvoiceId: 'other-invoice' }); await openCreation();
    expect(await screen.findByText(/Factura seleccionada: NF-2026-002/)).toHaveTextContent('DOP');
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Crear simulación' }));
    await screen.findByText(/Documento canónico creado/);
    const sent = commercialApi.mock.calls.find(([path, options]) => path === '/finance/fiscal-documents' && options?.method === 'POST');
    expect(JSON.parse(sent[1].body).invoiceId).toBe('other-invoice');
  });

  it('scopes ledger requests to the selected station and ignores a previous picker response', async () => {
    let resolveOld;
    const old = new Promise(resolve => { resolveOld = resolve; });
    commercialApi.mockImplementation(async (path, options) => {
      if (path.startsWith('/finance/invoices?')) {
        const station = new URL(path, 'https://elevant.test').searchParams.get('stationId');
        return station === 'other-station' ? ledgerPage([{ ...otherInvoice, stationId: 'other-station', stationCode: 'SDQ' }]) : old;
      }
      return http(path, options);
    });
    mount(); await userEvent.selectOptions(await screen.findByLabelText('Estación'), 'station'); await openCreation();
    await waitFor(() => expect(commercialApi.mock.calls.some(([path]) => path.includes('/finance/invoices?') && path.includes('stationId=station'))).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText('Estación'), 'other-station');
    await openCreation(); await screen.findByRole('radio', { name: /NF-2026-002/ });
    await act(async () => { resolveOld(ledgerPage([invoice])); await old; });
    expect(screen.queryByRole('radio', { name: /NF-2026-001/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /NF-2026-002/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeDisabled();
  });

  it('keeps an explicit user selection when an initial invoice resolves late', async () => {
    let resolveInitial;
    const initial = new Promise(resolve => { resolveInitial = resolve; });
    commercialApi.mockImplementation(async (path, options) => path === '/finance/invoices/other-invoice' ? initial : http(path, options));
    mount(permissions, { initialInvoiceId: 'other-invoice' }); await openCreation();
    await userEvent.click(await screen.findByRole('radio', { name: /NF-2026-001/ }));
    await act(async () => { resolveInitial({ summary: otherInvoice, lines: [], payments: [], creditNotes: [] }); await initial; });
    expect(screen.getByText(/Factura seleccionada: NF-2026-001/)).toBeInTheDocument();
    expect(screen.queryByText(/Factura seleccionada: NF-2026-002/)).not.toBeInTheDocument();
  });

  it('ignores a slow previous search after a newer search finishes', async () => {
    let phase = 'browse'; let resolveOld; let oldStarted = false;
    const old = new Promise(resolve => { resolveOld = resolve; });
    commercialApi.mockImplementation(async (path, options) => {
      if (path.startsWith('/finance/invoices?')) {
        if (phase === 'old') { oldStarted = true; return old; }
        return ledgerPage(phase === 'new' ? [otherInvoice] : [invoice]);
      }
      return http(path, options);
    });
    mount(); await openCreation(); await screen.findByRole('radio', { name: /NF-2026-001/ });
    phase = 'old'; await userEvent.type(screen.getByLabelText('Buscar facturas'), 'Caribe');
    await waitFor(() => expect(oldStarted).toBe(true));
    phase = 'new'; await userEvent.clear(screen.getByLabelText('Buscar facturas'));
    await userEvent.type(screen.getByLabelText('Buscar facturas'), 'Norte');
    await screen.findByRole('radio', { name: /NF-2026-002/ });
    await act(async () => { resolveOld(ledgerPage([invoice])); await old; });
    expect(screen.getByRole('radio', { name: /NF-2026-002/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /NF-2026-001/ })).not.toBeInTheDocument();
  });

  it('allows choosing another invoice when the initial invoice is no longer available', async () => {
    commercialApi.mockImplementation(async (path, options) => {
      if (path === '/finance/invoices/other-invoice') throw Object.assign(new Error('Private detail'), { status: 404 });
      return http(path, options);
    });
    mount(permissions, { initialInvoiceId: 'other-invoice' }); await openCreation();
    expect(await screen.findByText('La factura no está disponible en sus estaciones.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeDisabled();
    await userEvent.click(await screen.findByRole('radio', { name: /NF-2026-001/ }));
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeEnabled();
    expect(screen.queryByText('Private detail')).not.toBeInTheDocument();
  });

  it('shows safe invoice errors with retry and an empty result state', async () => {
    let failed = true;
    commercialApi.mockImplementation(async (path, options) => {
      if (path.startsWith('/finance/invoices?')) {
        if (failed) throw Object.assign(new Error('Private SQL detail'), { status: 403 });
        return ledgerPage([]);
      }
      return http(path, options);
    });
    mount(); await openCreation();
    expect(await screen.findByText(/No tiene permiso para consultar las facturas emitidas/)).toBeInTheDocument();
    expect(screen.queryByText('Private SQL detail')).not.toBeInTheDocument();
    failed = false; await userEvent.click(screen.getByRole('button', { name: 'Reintentar facturas' }));
    expect(await screen.findByText(/No hay facturas emitidas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeDisabled();
  });

  it('does not query the ledger or enable creation without ledger read permission', async () => {
    mount(permissions.filter(p => p !== 'finance.reconciliation.read')); await openCreation();
    expect(screen.getByText(/No tiene permiso para consultar las facturas emitidas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeDisabled();
    expect(commercialApi.mock.calls.some(([path]) => path.startsWith('/finance/invoices'))).toBe(false);
  });

  it('does not create a simulation when Enter is pressed in invoice search', async () => {
    mount(); await openCreation();
    await userEvent.click(await screen.findByRole('radio', { name: /NF-2026-001/ }));
    await userEvent.type(screen.getByLabelText('Buscar facturas'), 'Caribe{Enter}');
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeInTheDocument();
    expect(commercialApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('rejects an initial invoice outside the chosen station', async () => {
    commercialApi.mockImplementation(async (path, options) => path === '/finance/invoices/other-invoice'
      ? { summary: { ...otherInvoice, stationId: 'other-station' }, lines: [], payments: [], creditNotes: [] } : http(path, options));
    mount(permissions, { initialInvoiceId: 'other-invoice' });
    await userEvent.selectOptions(await screen.findByLabelText('Estación'), 'station'); await openCreation();
    expect(await screen.findByText(/La factura inicial no está disponible en la estación seleccionada/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeDisabled();
    await userEvent.click(await screen.findByRole('radio', { name: /NF-2026-001/ }));
    expect(screen.getByRole('button', { name: 'Crear simulación' })).toBeEnabled();
  });

  it('retries creation with the same request ID and chosen invoice after a lost response', async () => {
    let failed = true;
    commercialApi.mockImplementation(async (path, options) => {
      if (path === '/finance/fiscal-documents' && options?.method === 'POST' && failed) throw new Error('Private transport detail');
      return http(path, options);
    });
    mount(); await openCreation();
    await userEvent.click(await screen.findByRole('radio', { name: /NF-2026-001/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear simulación' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('Private transport detail');
    expect(screen.getByText(/Factura seleccionada: NF-2026-001/)).toBeInTheDocument();
    failed = false; await userEvent.click(screen.getByRole('button', { name: 'Crear simulación' }));
    await screen.findByText(/Documento canónico creado/);
    const writes = commercialApi.mock.calls.filter(([path, options]) => path === '/finance/fiscal-documents' && options?.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[1][1].body).toBe(writes[0][1].body);
  });
});
