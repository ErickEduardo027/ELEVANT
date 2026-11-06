import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManagedDraftsPage from './ManagedDraftsPage';
import {
  activateManagedDraft, commercialApi, discardContractDraft, getContractDraftReadiness, getContractDraftScope,
  getManagedDrafts, replyContractDraft, setContractDraftScope, updateManagedDraft,
} from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getManagedDrafts: vi.fn(), updateManagedDraft: vi.fn(), activateManagedDraft: vi.fn(),
  getContractDraftReadiness: vi.fn(), getContractDraftScope: vi.fn(), setContractDraftScope: vi.fn(),
  discardContractDraft: vi.fn(), replyContractDraft: vi.fn(), commercialApi: vi.fn(),
}));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

const failure = (status, code) => Object.assign(new Error('Draft is not ready for activation.'), { status, code });
const draft = (patch = {}) => ({
  id: 'draft-1', contractId: 'contract-1', airline: 'Demo Airlines', contractCode: 'CTR-1', status: 'Draft',
  terms: 'Terms', validFrom: '2026-10-01', validTo: null, currencyCode: 'USD', stations: ['PUJ · Punta Cana'],
  comments: [], versionStatus: 'Draft', version: 'v1',
  rates: [{ id: 'rate-1', serviceName: 'Rampa', billingUnit: 'operation', unitPrice: 0, minimumQuantity: 1, isConfirmed: false }],
  ...patch,
});
const readiness = (issues = [], patch = {}) => ({ versionId: 'draft-1', version: 'v1', versionStatus: 'Draft',
  ready: issues.length === 0, portalAccount: 'Active', issues, ...patch });
const scope = (patch = {}) => ({ versionId: 'draft-1', version: 'v1', versionStatus: 'Draft',
  services: [
    { serviceId: 'svc-ramp', code: 'RAMP', name: 'Rampa', isActive: true, selected: true, rateId: 'rate-1', coveredByPackage: false },
    { serviceId: 'svc-tow', code: 'RAMP-TOW', name: 'Remolque', isActive: true, selected: false, rateId: null, coveredByPackage: false },
  ],
  stations: [{ stationId: 'st-puj', code: 'PUJ', name: 'Punta Cana', isActive: true, selected: true },
    { stationId: 'st-sdq', code: 'SDQ', name: 'Santo Domingo', isActive: true, selected: false }],
  ...patch });

beforeEach(() => {
  getManagedDrafts.mockResolvedValue([draft()]);
  getContractDraftReadiness.mockResolvedValue(readiness([{ code: 'rates_unconfirmed', subjects: [] }]));
  getContractDraftScope.mockResolvedValue(scope());
  commercialApi.mockResolvedValue([]);
  updateManagedDraft.mockResolvedValue({ id: 'draft-1' });
  activateManagedDraft.mockResolvedValue({ id: 'contract-1' });
  setContractDraftScope.mockResolvedValue({ id: 'draft-1' });
  discardContractDraft.mockResolvedValue({ id: 'draft-1' });
  replyContractDraft.mockResolvedValue({ id: 'comment-2' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function open(props = {}) {
  render(<ManagedDraftsPage {...props} />);
  await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
  await screen.findByRole('list', { name: 'Requisitos para enviar a Finanzas' });
}

it('requires explicit tariff confirmation before a draft can be activated', async () => {
  await open();
  expect(screen.getByRole('button', { name: 'Enviar a Finanzas' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: /Confirmar tarifa/i }));
  expect(screen.getByText('Guarde los cambios del borrador antes de enviarlo a Finanzas.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(updateManagedDraft).toHaveBeenCalledWith('draft-1', expect.objectContaining({
    expectedVersion: 'v1', rates: [expect.objectContaining({ isConfirmed: true, unitPrice: 0 })] }), expect.any(String)));
  expect(await screen.findByRole('status')).toHaveTextContent('Borrador actualizado');
  expect(activateManagedDraft).not.toHaveBeenCalled();
});

it('lists every readiness cause and submits only what the server reports ready', async () => {
  getContractDraftReadiness.mockResolvedValue(readiness([{ code: 'portal_account_missing', subjects: [] },
    { code: 'service_retired', subjects: ['RAMP-CARGO · Carga y descarga'] }], { portalAccount: 'Missing' }));
  await open();
  const checks = screen.getByRole('list', { name: 'Requisitos para enviar a Finanzas' });
  expect(within(checks).getByText(/La aerolínea todavía no tiene cuenta en el portal/)).toBeInTheDocument();
  expect(within(checks).getByText(/RAMP-CARGO · Carga y descarga/)).toBeInTheDocument();
  expect(screen.getByText(/Sin cuenta del portal: Superadministración debe crearla/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enviar a Finanzas' })).toBeDisabled();

  getContractDraftReadiness.mockResolvedValue(readiness());
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(getManagedDrafts).toHaveBeenCalledTimes(2));
  // The checklist re-reads with the draft; a new draft version would also trigger it.
  getManagedDrafts.mockResolvedValue([draft({ version: 'v2' })]);
  getContractDraftReadiness.mockResolvedValue(readiness([], { version: 'v2' }));
  getContractDraftScope.mockResolvedValue(scope({ version: 'v2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  const submit = screen.getByRole('button', { name: 'Enviar a Finanzas' });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Enviar' }));
  await waitFor(() => expect(activateManagedDraft).toHaveBeenCalledWith('draft-1', { expectedVersion: 'v2' }, expect.any(String)));
});

it('submits to Finance without promising an activation the approval does not do (1-F)', async () => {
  getContractDraftReadiness.mockResolvedValue(readiness());
  await open();
  const submit = screen.getByRole('button', { name: 'Enviar a Finanzas' });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/para aprobar los precios.*firman la aerolínea y AVIAM.*permiso de operación/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/se activará cuando Finanzas lo apruebe/i)).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText(/Contrato enviado a Finanzas para aprobar los precios/)).toBeInTheDocument();
});

it('offers the active units Finance maintains, saves the unit code and lists a retired package (1-E, 1-N27)', async () => {
  commercialApi.mockImplementation(async path => (path === '/finance/billing-units'
    ? [{ code: 'operation', name: 'Operación', isActive: true }, { code: 'hour', name: 'Hora', isActive: true },
      { code: 'old', name: 'Antigua', isActive: false }] : []));
  getContractDraftReadiness.mockResolvedValue(readiness([{ code: 'package_retired', subjects: ['PKG-TURN v3'] }]));
  await open();
  const unit = screen.getByLabelText('Unidad');
  await waitFor(() => expect(within(unit).getAllByRole('option').map(option => option.textContent))
    .toEqual(['Operación', 'Hora']));
  expect(unit).toHaveValue('operation');
  const checks = screen.getByRole('list', { name: 'Requisitos para enviar a Finanzas' });
  expect(within(checks).getByText(/Finanzas retiró un paquete vinculado/)).toHaveTextContent('PKG-TURN v3');
  await userEvent.selectOptions(unit, 'hour');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(updateManagedDraft).toHaveBeenCalled());
  expect(updateManagedDraft.mock.calls[0][1].rates).toEqual([expect.objectContaining({ id: 'rate-1', billingUnit: 'hour' })]);
});

it('keeps a unit that is no longer active visible until Contratos picks another one', async () => {
  commercialApi.mockImplementation(async path => (path === '/finance/billing-units'
    ? [{ code: 'hour', name: 'Hora', isActive: true }] : []));
  getManagedDrafts.mockResolvedValue([draft({ rates: [{ id: 'rate-1', serviceName: 'Rampa', billingUnit: 'turno', unitPrice: 0,
    minimumQuantity: 1, isConfirmed: false }] })]);
  await open();
  const unit = screen.getByLabelText('Unidad');
  await waitFor(() => expect(within(unit).getByRole('option', { name: 'turno (no activa)' })).toBeInTheDocument());
  expect(unit).toHaveValue('turno');
});

it('retries an uncertain submission with the same key and re-reads the draft after a conflict', async () => {
  getContractDraftReadiness.mockResolvedValue(readiness());
  activateManagedDraft.mockRejectedValueOnce(new TypeError('Network down'))
    .mockRejectedValueOnce(failure(409, 'finance_reviewer_missing'));
  await open();
  const send = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar a Finanzas' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Enviar a Finanzas' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Enviar' }));
  };
  await send();
  expect(await screen.findByText(/No se pudo completar la acción/)).toBeInTheDocument();
  await send();
  expect(await screen.findByText(/Nadie en Finanzas cubre todas las estaciones/)).toBeInTheDocument();
  expect(screen.queryByText('Draft is not ready for activation.')).not.toBeInTheDocument();
  const [first, second] = activateManagedDraft.mock.calls;
  expect(second[2]).toBe(first[2]);
  await waitFor(() => expect(getManagedDrafts).toHaveBeenCalledTimes(2));
});

it('distinguishes loading, a recoverable error, no permission and an empty list', async () => {
  getManagedDrafts.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce([]);
  const { unmount } = render(<ManagedDraftsPage />);
  expect(screen.getByText('Cargando…')).toBeInTheDocument();
  expect(await screen.findByText(/No se pudieron cargar los borradores/)).toBeInTheDocument();
  expect(screen.queryByText('No hay borradores pendientes.')).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]);
  expect(await screen.findByText('No hay borradores pendientes.')).toBeInTheDocument();
  unmount();
  getManagedDrafts.mockRejectedValueOnce(failure(403));
  render(<ManagedDraftsPage />);
  expect(await screen.findByText(/No tiene permiso para ver los borradores/)).toBeInTheDocument();
});

it('marks a retired service and sets the scope with the version on screen', async () => {
  getContractDraftScope.mockResolvedValue(scope({ services: [
    { serviceId: 'svc-ramp', code: 'RAMP', name: 'Rampa', isActive: false, selected: true, rateId: 'rate-1', coveredByPackage: false },
    { serviceId: 'svc-tow', code: 'RAMP-TOW', name: 'Remolque', isActive: true, selected: false, rateId: null, coveredByPackage: false },
  ] }));
  await open();
  expect(await screen.findByText(/Servicio dado de baja del catálogo: quítelo del alcance/)).toBeInTheDocument();
  const scopeSection = screen.getByRole('region', { name: 'Alcance del contrato' });
  expect(within(scopeSection).getByText('Retirado')).toBeInTheDocument();
  const save = within(scopeSection).getByRole('button', { name: 'Guardar alcance' });
  expect(save).toBeDisabled();
  await userEvent.click(within(scopeSection).getByRole('checkbox', { name: /RAMP · Rampa/ }));
  await userEvent.click(within(scopeSection).getByRole('checkbox', { name: /RAMP-TOW · Remolque/ }));
  await userEvent.click(within(scopeSection).getByRole('checkbox', { name: /SDQ · Santo Domingo/ }));
  await userEvent.click(save);
  await waitFor(() => expect(setContractDraftScope).toHaveBeenCalledWith('draft-1',
    { expectedVersion: 'v1', serviceIds: ['svc-tow'], stationIds: ['st-puj', 'st-sdq'] }, expect.any(String)));
  expect(await screen.findByRole('status')).toHaveTextContent('Alcance actualizado');
});

it('keeps a service covered by a linked package and locks the scope while the form has changes', async () => {
  getContractDraftScope.mockResolvedValue(scope({ services: [
    { serviceId: 'svc-ramp', code: 'RAMP', name: 'Rampa', isActive: true, selected: true, rateId: 'rate-1', coveredByPackage: true },
  ] }));
  await open();
  const scopeSection = screen.getByRole('region', { name: 'Alcance del contrato' });
  expect(within(scopeSection).getByRole('checkbox', { name: /RAMP · Rampa/ })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Condiciones del contrato'), ' revisadas');
  expect(within(scopeSection).getByRole('checkbox', { name: /PUJ · Punta Cana/ })).toBeDisabled();
  expect(within(scopeSection).getByText(/Para cambiar el alcance, guarde antes los cambios/)).toBeInTheDocument();
});

it('answers the airline and discards the draft with a reason', async () => {
  getManagedDrafts.mockResolvedValue([draft({ comments: [{ id: 'comment-1', author: 'Casey Airline',
    body: '¿Incluye la noche?', at: '2026-11-05T12:00:00Z', isAirline: true }] })]);
  await open({ canDiscard: true });
  await userEvent.type(screen.getByLabelText('Responder a la aerolínea'), 'No: el recargo nocturno se cobra aparte.');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
  await waitFor(() => expect(replyContractDraft).toHaveBeenCalledWith('draft-1',
    { expectedVersion: 'v1', body: 'No: el recargo nocturno se cobra aparte.' }, expect.any(String)));
  expect(await screen.findByRole('status')).toHaveTextContent('Respuesta enviada');

  await userEvent.click(screen.getByRole('button', { name: 'Descartar borrador' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/también quedará terminado/)).toBeInTheDocument();
  const confirm = within(dialog).getByRole('button', { name: 'Descartar' });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText('Motivo'), 'La aerolínea desistió.');
  await userEvent.click(confirm);
  await waitFor(() => expect(discardContractDraft).toHaveBeenCalledWith('draft-1',
    { expectedVersion: 'v1', reason: 'La aerolínea desistió.' }, expect.any(String)));
  expect(await screen.findByRole('status')).toHaveTextContent('Borrador descartado');
});

it('hides the discard without its permission and the submission while Finance reviews', async () => {
  getManagedDrafts.mockResolvedValue([draft({ versionStatus: 'PendingFinanceApproval' })]);
  getContractDraftReadiness.mockResolvedValue(readiness([], { versionStatus: 'PendingFinanceApproval', ready: false }));
  render(<ManagedDraftsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
  expect(await screen.findByText(/En revisión por Finanzas/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enviar a Finanzas' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Descartar borrador' })).not.toBeInTheDocument();
  // Contratos still answers while Finance reviews.
  expect(screen.getByLabelText('Responder a la aerolínea')).toBeEnabled();
});
