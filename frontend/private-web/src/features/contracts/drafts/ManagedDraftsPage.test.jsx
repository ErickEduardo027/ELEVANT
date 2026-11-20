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
  expect(screen.getByText('Guarda los cambios del borrador antes de enviarlo a Finanzas.')).toBeInTheDocument();
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

it.each([
  ['Active', /con la segunda firma esta versión reemplaza a la vigente desde el 1 de octubre de 2026\. El contrato ya está activo, así que no se activa de nuevo; hasta esas firmas se factura con la versión vigente/],
  ['Suspended', /con la segunda firma esta versión reemplaza a la vigente desde el 1 de octubre de 2026; el contrato sigue suspendido y los precios nuevos se aplican cuando se reactive/],
])('explains that the amendment of a %s contract replaces the version in force at its second signature (1-F, 2-C)', async (status, text) => {
  // An amendment (1-C) or a renewal of a contract in force: draft.status is the status of the contract.
  getManagedDrafts.mockResolvedValue([draft({ status })]);
  getContractDraftReadiness.mockResolvedValue(readiness());
  await open();
  const submit = screen.getByRole('button', { name: 'Enviar a Finanzas' });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(text)).toBeInTheDocument();
  // Nothing «activates» again: the contract is already in force and the new version governs at its second signature.
  expect(within(dialog).queryByText(/entonces el contrato se activa/)).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
  const notice = await screen.findByText(/Contrato enviado a Finanzas para aprobar los precios/);
  expect(notice).toHaveTextContent(text);
  // No activation step is pending: the operating permit is not verified again.
  expect(notice).not.toHaveTextContent(/permiso de operación/);
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
  expect(await screen.findByText('No se pudieron cargar los borradores. Revisa la conexión e intenta de nuevo.'))
    .toBeInTheDocument();
  expect(screen.queryByText('No hay borradores pendientes.')).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]);
  expect(await screen.findByText('No hay borradores pendientes.')).toBeInTheDocument();
  unmount();
  getManagedDrafts.mockRejectedValueOnce(failure(403));
  render(<ManagedDraftsPage />);
  expect(await screen.findByText(
    'No tienes permiso para ver los borradores de contrato. Pide acceso al administrador de Contratos.')).toBeInTheDocument();
});

it('marks a retired service and sets the scope with the version on screen', async () => {
  getContractDraftScope.mockResolvedValue(scope({ services: [
    { serviceId: 'svc-ramp', code: 'RAMP', name: 'Rampa', isActive: false, selected: true, rateId: 'rate-1', coveredByPackage: false },
    { serviceId: 'svc-tow', code: 'RAMP-TOW', name: 'Remolque', isActive: true, selected: false, rateId: null, coveredByPackage: false },
  ] }));
  await open();
  expect(await screen.findByText(/Servicio dado de baja del catálogo: quítalo del alcance/)).toBeInTheDocument();
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
  expect(within(scopeSection).getByText(/Para cambiar el alcance, guarda antes los cambios/)).toBeInTheDocument();
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
  // The field says why «Descartar» waits: the bounds and the characters still missing.
  const reason = within(dialog).getByLabelText('Motivo');
  await userEvent.type(reason, 'Dup');
  expect(confirm).toBeDisabled();
  expect(reason).toHaveAccessibleDescription(/Entre 5 y 500 caracteres\..*Faltan 2 caracteres\./);
  await userEvent.clear(reason);
  await userEvent.type(reason, 'La aerolínea desistió.');
  expect(reason).toHaveAccessibleDescription(/22 de 500\./);
  await userEvent.click(confirm);
  await waitFor(() => expect(discardContractDraft).toHaveBeenCalledWith('draft-1',
    { expectedVersion: 'v1', reason: 'La aerolínea desistió.' }, expect.any(String)));
  expect(await screen.findByRole('status')).toHaveTextContent('Borrador descartado');
});

it('names a new contract «Borrador» and the start of its id, and a signed one by its code (N35)', async () => {
  const code = 'DRAFT-1cc18541e2a94f3b8c7d6e5f4a3b2c1d';
  getManagedDrafts.mockResolvedValue([draft({ contractCode: code })]);
  getContractDraftReadiness.mockResolvedValue(readiness());
  await open({ canDiscard: true });
  const item = screen.getByRole('button', { name: /Demo Airlines/ });
  expect(within(item).getByText(/^Borrador 1cc18541… · Borrador · /)).toHaveAttribute('title', code);
  expect(screen.getByText('Borrador 1cc18541…', { selector: 'p' })).toHaveAttribute('title', code);
  const submit = screen.getByRole('button', { name: 'Enviar a Finanzas' });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  expect(within(screen.getByRole('alertdialog'))
    .getByText(/^¿Enviar el borrador 1cc18541… a Finanzas para aprobar los precios\?/)).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Descartar borrador' }));
  expect(screen.getByRole('alertdialog', { name: 'Descartar el borrador 1cc18541…' })).toBeInTheDocument();
  expect(screen.queryByText(/DRAFT-/)).not.toBeInTheDocument();
  cleanup();

  // An amendment or a renewal keeps the code its contract was signed with.
  getManagedDrafts.mockResolvedValue([draft({ contractCode: 'CTR-2026-0007' })]);
  await open({ canDiscard: true });
  expect(within(screen.getByRole('button', { name: /Demo Airlines/ })).getByText(/^CTR-2026-0007 · Borrador · /))
    .not.toHaveAttribute('title');
  await userEvent.click(screen.getByRole('button', { name: 'Descartar borrador' }));
  expect(screen.getByRole('alertdialog', { name: 'Descartar el borrador de CTR-2026-0007' })).toBeInTheDocument();
});

it('counts the services and observations of each draft in the singular only for one (N33)', async () => {
  const comment = id => ({ id, author: 'Casey Airline', body: '¿Incluye la noche?', at: '2026-11-05T12:00:00Z', isAirline: true });
  const rate = draft().rates[0];
  getManagedDrafts.mockResolvedValue([draft(), { ...draft({ comments: [comment('comment-1')] }), id: 'draft-2' },
    { ...draft({ rates: [rate, { ...rate, id: 'rate-2', serviceName: 'Remolque' }],
      comments: [comment('comment-1'), comment('comment-2')] }), id: 'draft-3' }]);
  render(<ManagedDraftsPage />);
  await screen.findAllByRole('button', { name: /Demo Airlines/ });
  const lines = screen.getAllByRole('button', { name: /Demo Airlines/ }).map(item => item.querySelector('span').textContent);
  expect(lines).toEqual(['CTR-1 · Borrador · 1 servicio · 0 observaciones', 'CTR-1 · Borrador · 1 servicio · 1 observación',
    'CTR-1 · Borrador · 2 servicios · 2 observaciones']);
});

it('keeps the edits and blocks the submission when a rule refuses the save', async () => {
  getContractDraftReadiness.mockResolvedValue(readiness());
  updateManagedDraft.mockRejectedValueOnce(failure(409, 'package_not_eligible'));
  await open();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar a Finanzas' })).toBeEnabled());
  await userEvent.selectOptions(screen.getByLabelText('Moneda'), 'DOP');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  expect(await screen.findByText(/Un paquete vinculado no corresponde a la moneda/)).toBeInTheDocument();
  await waitFor(() => expect(getManagedDrafts).toHaveBeenCalledTimes(2));
  // The draft did not change: the unsaved currency stays on screen and the server version is not sent to Finance.
  expect(screen.getByLabelText('Moneda')).toHaveValue('DOP');
  expect(screen.getByText('Guarda los cambios del borrador antes de enviarlo a Finanzas.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enviar a Finanzas' })).toBeDisabled();
});

it('drops the edits and re-reads the draft when it changed meanwhile', async () => {
  updateManagedDraft.mockRejectedValueOnce(failure(409, 'version_conflict'));
  await open();
  await userEvent.type(screen.getByLabelText('Condiciones del contrato'), ' revisadas');
  getManagedDrafts.mockResolvedValue([draft({ version: 'v2', terms: 'Terms de otro usuario' })]);
  await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  expect(await screen.findByText(/El borrador cambió mientras lo editabas\./)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Condiciones del contrato')).toHaveValue('Terms de otro usuario'));
  expect(screen.queryByText('Guarda los cambios del borrador antes de enviarlo a Finanzas.')).not.toBeInTheDocument();
});

it('warns which negotiated charges go back to the Finance base when the currency changes (1-N07)', async () => {
  getManagedDrafts.mockResolvedValue([draft({ charges: [
    { chargeId: 'ch-fee', code: 'ADMIN-FEE', name: 'Cargo administrativo', method: 'FixedAmount', baseValue: 15, isExcluded: false, value: 50 },
    { chargeId: 'ch-night', code: 'NIGHT', name: 'Recargo nocturno', method: 'PercentOfService', baseValue: 15, isExcluded: false, value: 20 },
    { chargeId: 'ch-delay', code: 'DELAY', name: 'Espera', method: 'PerHour', baseValue: 40, isExcluded: true, value: null },
  ] })]);
  await open();
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Moneda'), 'DOP');
  const note = screen.getByRole('note');
  expect(note).toHaveTextContent('Al cambiar la moneda todas las tarifas quedarán sin confirmar: revísalas y confírmalas de nuevo.');
  expect(note).toHaveTextContent('Los cargos con importe negociado (ADMIN-FEE) volverán a la tarifa base de Finanzas en DOP: '
    + 'negócialos de nuevo después de guardar.');
  expect(note).toHaveTextContent('Las exclusiones y los porcentajes negociados se conservan.');
  expect(screen.getAllByText('Vuelve a la tarifa base en DOP al guardar.')).toHaveLength(1);
});

it('writes the Finance base of each rate and charge in the currency the draft has saved, names first (N34)', async () => {
  getManagedDrafts.mockResolvedValue([draft({
    rates: [{ id: 'rate-1', serviceName: 'Rampa', billingUnit: 'operation', unitPrice: 104, minimumQuantity: 1,
      isConfirmed: false, basePrice: 130, baseMinimum: 1 }],
    charges: [
      { chargeId: 'ch-fee', code: 'ADMIN-FEE', name: 'Cargo administrativo', method: 'FixedAmount', baseValue: 15, isExcluded: false, value: null },
      { chargeId: 'ch-delay', code: 'DELAY', name: 'Espera', method: 'PerHour', baseValue: 40, isExcluded: true, value: null },
      { chargeId: 'ch-night', code: 'NIGHT', name: 'Recargo nocturno', method: 'PercentOfService', baseValue: 15, isExcluded: false, value: 20 },
      { chargeId: 'ch-tow', code: 'TOW-WAIT', name: 'Espera del remolque', method: 'PerMinute', baseValue: null, isExcluded: false, value: null },
    ] })]);
  const facts = region => Object.fromEntries(within(region).getAllByRole('term')
    .map(term => [term.textContent, term.nextElementSibling.textContent]));
  const rateBase = () => facts(screen.getByText('Rampa', { selector: 'strong' }).parentElement);
  const charge = name => {
    const title = screen.getByText(name, { selector: 'strong' }).parentElement;
    return { title: title.textContent, ...facts(title.parentElement) };
  };
  const bases = () => ({ rate: rateBase(), charges: ['Cargo administrativo', 'Espera', 'Recargo nocturno', 'Espera del remolque']
    .map(charge) });
  await open();
  const saved = {
    rate: { 'Tarifa base': 'USD 130.00 · -20 %' },
    charges: [
      { title: 'Cargo administrativo ADMIN-FEE', 'Tarifa base': 'USD 15.00' },
      { title: 'Espera DELAY', 'Tarifa base': 'Por hora: USD 40.00' },
      { title: 'Recargo nocturno NIGHT', 'Tarifa base': '15 %' },
      { title: 'Espera del remolque TOW-WAIT', 'Tarifa base': 'Sin importe' },
    ],
  };
  expect(bases()).toEqual(saved);
  // An unsaved change of currency does not relabel Finance's base: it stays in the currency the draft has saved.
  await userEvent.selectOptions(screen.getByLabelText('Moneda'), 'DOP');
  expect(bases()).toEqual(saved);
  expect(screen.getByText(/Parten de la tarifa base de Finanzas en USD/)).toBeInTheDocument();
});

it('shows why a discard failed inside its dialog and keeps the message once the draft left the list', async () => {
  discardContractDraft.mockRejectedValueOnce(failure(409, 'version_conflict')).mockRejectedValueOnce(failure(409, 'draft_closed'));
  await open({ canDiscard: true });
  await userEvent.click(screen.getByRole('button', { name: 'Descartar borrador' }));
  await userEvent.type(within(screen.getByRole('alertdialog')).getByLabelText('Motivo'), 'La aerolínea desistió.');
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }));
  expect(await within(screen.getByRole('alertdialog')).findByRole('alert'))
    .toHaveTextContent('El borrador cambió mientras lo editabas.');
  // Someone else closed it meanwhile: the dialog closes with the draft and the page says why.
  getManagedDrafts.mockResolvedValue([]);
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByRole('alert')).toHaveTextContent('El borrador ya no está en curso');
  expect(screen.getByText('Selecciona un borrador para revisarlo.')).toBeInTheDocument();
  expect(discardContractDraft).toHaveBeenCalledTimes(2);
});

it('retries an uncertain answer with its first key and version even if the draft moved on', async () => {
  replyContractDraft.mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce({ id: 'comment-2' });
  await open();
  await userEvent.type(screen.getByLabelText('Responder a la aerolínea'), 'Sí, incluye la noche.');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
  expect(await screen.findByText(/No se pudo completar la acción/)).toBeInTheDocument();
  // A colleague saved the draft meanwhile: the list now carries a newer version.
  getManagedDrafts.mockResolvedValue([draft({ version: 'v2' })]);
  getContractDraftReadiness.mockResolvedValue(readiness([{ code: 'rates_unconfirmed', subjects: [] }], { version: 'v2' }));
  getContractDraftScope.mockResolvedValue(scope({ version: 'v2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(getManagedDrafts).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Respuesta enviada');
  const [first, second] = replyContractDraft.mock.calls;
  expect(first[1]).toEqual({ expectedVersion: 'v1', body: 'Sí, incluye la noche.' });
  expect(second).toEqual(first);
});

it('addresses Contratos as tú in the list, the editor and its checks (N36)', async () => {
  getContractDraftReadiness.mockResolvedValue(readiness([{ code: 'portal_account_missing', subjects: [] }],
    { portalAccount: 'Missing' }));
  await open();
  expect(screen.getByText('Revisa las observaciones de la aerolínea, configura alcance, condiciones y tarifas y envía el '
    + 'contrato a Finanzas para su aprobación.')).toBeInTheDocument();
  expect(screen.getByText('Sin cuenta del portal: Superadministración debe crearla. Recibirás un aviso cuando esté lista.'))
    .toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Alcance del contrato' }))
    .getByText(/^Agrega servicios activos del catálogo o quítalos, y fija las estaciones\./)).toBeInTheDocument();
  cleanup();

  // Checks that cannot be read say so as tú too.
  getContractDraftReadiness.mockRejectedValue(new TypeError('offline'));
  getContractDraftScope.mockRejectedValue(failure(403));
  render(<ManagedDraftsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
  expect(await screen.findByText('No se pudo comprobar si el borrador está listo. Revisa la conexión e intenta de nuevo.'))
    .toBeInTheDocument();
  expect(await screen.findByText('No tienes permiso para ver el alcance del borrador.')).toBeInTheDocument();
  cleanup();

  getContractDraftReadiness.mockRejectedValue(failure(403));
  getContractDraftScope.mockRejectedValue(new TypeError('offline'));
  render(<ManagedDraftsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
  expect(await screen.findByText('No tienes permiso para comprobar si el borrador está listo.')).toBeInTheDocument();
  expect(await screen.findByText('No se pudo cargar el alcance del borrador. Revisa la conexión e intenta de nuevo.'))
    .toBeInTheDocument();
  cleanup();

  // A draft read without its version asks to refresh it before its packages.
  getManagedDrafts.mockResolvedValue([draft({ version: '' })]);
  getContractDraftReadiness.mockResolvedValue(readiness());
  getContractDraftScope.mockResolvedValue(scope());
  await open();
  expect(screen.getByText('Actualiza el borrador para consultar sus paquetes y obtener su versión vigente.')).toBeInTheDocument();
  cleanup();

  getManagedDrafts.mockResolvedValue([draft({ versionStatus: 'PendingFinanceApproval' })]);
  getContractDraftReadiness.mockResolvedValue(readiness([], { versionStatus: 'PendingFinanceApproval', ready: false }));
  getContractDraftScope.mockResolvedValue(scope());
  render(<ManagedDraftsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
  expect(await screen.findByText('En revisión por Finanzas. Si lo devuelve, podrás editarlo de nuevo.')).toBeInTheDocument();
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
