import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommercialIntakePage from './CommercialIntakePage';
import {
  cancelCommercialRequest, confirmCommercialRepresentative, decideCommercialRequest, getCommercialRequestInbox,
  getCommercialStations, getPublishedAirlineProfiles, verifyCommercialRequestAirline,
} from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getCommercialRequestInbox: vi.fn(), getCommercialStations: vi.fn(), getPublishedAirlineProfiles: vi.fn(),
  verifyCommercialRequestAirline: vi.fn(), confirmCommercialRepresentative: vi.fn(),
  decideCommercialRequest: vi.fn(), cancelCommercialRequest: vi.fn(),
}));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

const station = { id: 'station-1', code: 'PUJ', name: 'Punta Cana' };
const base = {
  id: 'req-1', reference: '0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e', airline: 'Copa Airlines', airlineProfileId: 'profile-1',
  legalName: 'Compañía Panameña de Aviación, S.A.', countryCode: 'PA', iataCode: 'CM', icaoCode: 'CMP', logoUrl: null,
  airlineVerified: false, verificationSourceUrl: null, airlineWebsiteUrl: 'https://www.copaair.com/',
  representativeName: 'Ana Rivera', representativeTitle: 'Gerente comercial', representativeEmail: 'ana@copaair.com',
  representativePhone: '+18095550142', representativeNationalityCode: 'DO', representativeAddress: null,
  representativeCountry: 'República Dominicana', representativeProvince: 'Santo Domingo',
  representativeMunicipality: 'Boca Chica', representativeDistrict: 'La Caleta', representativeDocumentType: 'NationalId',
  representativeDocumentNumber: '001-1234567-3', authorityDeclared: true, status: 'Pending',
  submittedAt: '2026-11-05T12:00:00Z', reviewedAt: null, cancelledAt: null, decisionReason: null, contractId: null,
  representativeConfirmation: null, proposedAirline: null, existingCustomer: false,
  services: [{ serviceId: 'svc-1', name: 'Rampa', unit: 'operation' }], version: 'AAAAAAAAB9E=',
};
const counts = { pending: 1, inReview: 0, approved: 7, rejected: 2, cancelled: 1 };
const inboxOf = (requests, extra = {}) => ({ page: 1, limit: 25, total: requests.length, hasMore: false, counts, requests, ...extra });
const failure = (status, code) => Object.assign(new Error('Server title that must not be shown'), { status, code });

beforeEach(() => {
  getCommercialStations.mockResolvedValue([station]);
  getCommercialRequestInbox.mockResolvedValue(inboxOf([base]));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function open(request = base, props = {}) {
  getCommercialRequestInbox.mockResolvedValue(inboxOf([request]));
  render(<CommercialIntakePage canCancel {...props} />);
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(request.airline) }));
  return screen.getByRole('heading', { level: 2, name: request.airline }).closest('section');
}

it('reads the open requests on the server and labels the representative in Spanish', async () => {
  const review = await open();
  expect(getCommercialRequestInbox).toHaveBeenCalledWith({ status: 'Open', search: '', page: 1, limit: 25 });
  const counters = screen.getByRole('group', { name: 'Solicitudes por estado' });
  expect(within(counters).getByRole('button', { name: /Aprobadas\s*7/ })).toBeInTheDocument();
  expect(within(review).getByText('Cédula · 001-1234567-3')).toBeInTheDocument();
  // Nationality by its Spanish name (from «DO») and the country of the address.
  expect(within(review).getAllByText('República Dominicana', { selector: 'dd' })).toHaveLength(2);
  expect(within(review).getByText('La Caleta')).toBeInTheDocument();
  expect(within(review).queryByText(/NationalId/)).not.toBeInTheDocument();
  expect(within(review).getByText(/coincide con el sitio oficial de la aerolínea \(copaair\.com\)/)).toBeInTheDocument();
});

it('searches on the server and pages with the counters it returns', async () => {
  getCommercialRequestInbox.mockResolvedValue(inboxOf([base], { total: 30, hasMore: true }));
  render(<CommercialIntakePage />);
  await screen.findByRole('button', { name: /Copa Airlines/ });
  await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar solicitudes' }), 'ana@');
  await waitFor(() => expect(getCommercialRequestInbox).toHaveBeenLastCalledWith(
    { status: 'Open', search: 'ana@', page: 1, limit: 25 }));
  await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
  await waitFor(() => expect(getCommercialRequestInbox).toHaveBeenLastCalledWith(
    { status: 'Open', search: 'ana@', page: 2, limit: 25 }));
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Estado' }), 'Cancelled');
  await waitFor(() => expect(getCommercialRequestInbox).toHaveBeenLastCalledWith(
    { status: 'Cancelled', search: 'ana@', page: 1, limit: 25 }));
  // Choosing the filter already applied keeps the list instead of waiting for a load that never starts.
  await userEvent.click(await screen.findByRole('button', { name: /Canceladas\s*1/ }));
  expect(screen.queryByText('Cargando solicitudes…')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Copa Airlines/ })).toBeInTheDocument();
});

it('shows a recoverable error instead of an empty inbox, and the unauthorized state on 403', async () => {
  getCommercialRequestInbox.mockRejectedValueOnce(failure(503));
  render(<CommercialIntakePage />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('No se pudieron cargar las solicitudes. Revise la conexión e intente de nuevo.');
  expect(alert).not.toHaveTextContent('Server title');
  expect(screen.queryByText('No hay solicitudes con este filtro.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('button', { name: /Copa Airlines/ })).toBeInTheDocument();
  cleanup();

  getCommercialRequestInbox.mockRejectedValueOnce(failure(403));
  render(<CommercialIntakePage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No tiene permiso para ver las solicitudes comerciales.');
  cleanup();

  getCommercialRequestInbox.mockResolvedValueOnce(inboxOf([]));
  render(<CommercialIntakePage />);
  expect(await screen.findByText('No hay solicitudes con este filtro.')).toBeInTheDocument();
});

it('records the representative confirmation and retries an uncertain answer with the same key', async () => {
  confirmCommercialRepresentative.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ id: 'req-1' });
  const review = await open();
  const approve = within(review).getByRole('button', { name: 'Aprobar y crear borrador' });
  expect(approve).toBeDisabled();
  await userEvent.type(within(review).getByRole('textbox', { name: 'Cómo se confirmó' }), 'Llamada a la central de Copa.');
  await userEvent.click(within(review).getByRole('button', { name: 'Registrar confirmación' }));
  expect(await within(review).findByRole('alert')).toHaveTextContent('Revise la conexión e intente de nuevo.');
  await userEvent.click(within(review).getByRole('button', { name: 'Registrar confirmación' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Confirmación del representante registrada.');
  const [first, second] = confirmCommercialRepresentative.mock.calls;
  expect(first[1]).toEqual({ expectedVersion: 'AAAAAAAAB9E=', note: 'Llamada a la central de Copa.' });
  expect(second[2]).toBe(first[2]);
  expect(first[2]).toMatch(/^[0-9a-f-]{36}$/);
});

it('approves with the version on screen and explains a second affiliation in Spanish', async () => {
  const ready = { ...base, status: 'InReview', airlineVerified: true, verificationSourceUrl: 'https://registry.example.test',
    representativeConfirmation: { confirmedAt: '2026-11-05T13:00:00Z', confirmedBy: 'Carla Contratos', note: 'Llamada.' } };
  decideCommercialRequest.mockRejectedValueOnce(failure(409, 'airline_already_contracted'));
  const review = await open(ready);
  expect(within(review).getByText(/Representante confirmado por Carla Contratos/)).toBeInTheDocument();
  await userEvent.click(within(review).getByRole('checkbox', { name: /PUJ/ }));
  await userEvent.click(within(review).getByRole('button', { name: 'Aprobar y crear borrador' }));
  expect(await within(review).findByRole('alert')).toHaveTextContent('enmienda o una renovación');
  expect(decideCommercialRequest).toHaveBeenCalledWith('req-1',
    { approve: true, stationIds: ['station-1'], expectedVersion: 'AAAAAAAAB9E=' }, expect.stringMatching(/^[0-9a-f-]{36}$/));
  // The conflict re-reads the inbox before a new attempt.
  await waitFor(() => expect(getCommercialRequestInbox.mock.calls.length).toBeGreaterThan(1));
});

it('warns that the airline already operates and keeps the approval closed', async () => {
  const review = await open({ ...base, existingCustomer: true, airlineVerified: true,
    representativeConfirmation: { confirmedAt: '2026-11-05T13:00:00Z', confirmedBy: 'Carla', note: 'Llamada.' } });
  expect(within(review).getByRole('note')).toHaveTextContent('No admite una segunda afiliación');
  await userEvent.click(within(review).getByRole('checkbox', { name: /PUJ/ }));
  expect(within(review).getByRole('button', { name: 'Aprobar y crear borrador' })).toBeDisabled();
});

it('cancels with a reason only for those allowed to', async () => {
  cancelCommercialRequest.mockResolvedValue({ id: 'req-1' });
  const review = await open();
  await userEvent.type(within(review).getByRole('textbox', { name: 'Motivo de cancelación' }), 'Solicitud duplicada.');
  await userEvent.click(within(review).getByRole('button', { name: 'Cancelar solicitud' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Solicitud cancelada.');
  expect(cancelCommercialRequest).toHaveBeenCalledWith('req-1',
    { expectedVersion: 'AAAAAAAAB9E=', reason: 'Solicitud duplicada.' }, expect.any(String));
  cleanup();

  const readOnly = await open(base, { canCancel: false });
  expect(within(readOnly).queryByRole('button', { name: 'Cancelar solicitud' })).not.toBeInTheDocument();
});

it('links a proposed airline to a verified profile without asking for its identity again', async () => {
  const proposal = { ...base, airline: 'Caribe Cargo Express', airlineProfileId: null, legalName: null, countryCode: 'DO',
    iataCode: null, icaoCode: 'CCX', airlineWebsiteUrl: 'https://www.aviamltd.com/nosotros/',
    representativeEmail: 'ops@gmail.com',
    proposedAirline: { name: 'Caribe Cargo Express', countryCode: 'DO', iataCode: null, icaoCode: 'CCX', websiteUrl: null } };
  getPublishedAirlineProfiles.mockResolvedValue([{ id: 'profile-9', name: 'CARIBE CARGO', region: 'Caribe',
    icaoCode: 'CCX', isVerified: true }]);
  verifyCommercialRequestAirline.mockResolvedValue({ id: 'req-1' });
  const review = await open(proposal);
  expect(within(review).getByText('Aerolínea propuesta por el solicitante')).toBeInTheDocument();
  expect(within(review).getByText('Sin IATA')).toBeInTheDocument();
  // AVIAM's client list is not the airline's site: there is nothing to compare the domain with.
  expect(within(review).getByText(/No hay un sitio oficial de la aerolínea/)).toBeInTheDocument();
  await userEvent.click(within(review).getByRole('radio', { name: 'Vincular a una ficha existente' }));
  await userEvent.selectOptions(await within(review).findByRole('combobox', { name: 'Ficha del catálogo' }), 'profile-9');
  expect(within(review).queryByRole('textbox', { name: 'Razón social' })).not.toBeInTheDocument();
  await userEvent.click(within(review).getByRole('button', { name: 'Vincular y verificar' }));
  expect(await screen.findByRole('status')).toHaveTextContent('vinculada a la ficha del catálogo');
  expect(verifyCommercialRequestAirline).toHaveBeenCalledWith('req-1',
    { expectedVersion: 'AAAAAAAAB9E=', linkProfileId: 'profile-9' }, expect.any(String));
});

it('creates the verified profile of a proposed airline without IATA and flags a foreign email domain', async () => {
  const proposal = { ...base, airline: 'Caribe Cargo Express', airlineProfileId: null, legalName: null, countryCode: 'DO',
    iataCode: null, icaoCode: 'CCX', airlineWebsiteUrl: 'https://caribecargo.example.com', representativeEmail: 'ops@gmail.com',
    proposedAirline: { name: 'Caribe Cargo Express', countryCode: 'DO', iataCode: null, icaoCode: 'CCX',
      websiteUrl: 'https://caribecargo.example.com' } };
  verifyCommercialRequestAirline.mockResolvedValue({ id: 'req-1' });
  const review = await open(proposal);
  expect(within(review).getByRole('note')).toHaveTextContent('gmail.com');
  await userEvent.type(within(review).getByRole('textbox', { name: 'Razón social' }), 'Caribe Cargo Express S.R.L.');
  await userEvent.type(within(review).getByRole('textbox', { name: 'Fuente HTTPS' }), 'https://aoc.example.gob.do/ccx');
  await userEvent.click(within(review).getByRole('button', { name: 'Guardar verificación' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Aerolínea verificada');
  expect(verifyCommercialRequestAirline).toHaveBeenCalledWith('req-1', { expectedVersion: 'AAAAAAAAB9E=',
    legalName: 'Caribe Cargo Express S.R.L.', countryCode: 'DO', iataCode: '', icaoCode: 'CCX',
    verificationSourceUrl: 'https://aoc.example.gob.do/ccx' }, expect.any(String));
});

it('keeps the open review on screen while a new search loads', async () => {
  const review = await open();
  let resolve;
  getCommercialRequestInbox.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar solicitudes' }), 'copa');
  expect(await screen.findByText('Cargando solicitudes…')).toBeInTheDocument();
  expect(within(review).getByRole('heading', { level: 2, name: 'Copa Airlines' })).toBeInTheDocument();
  resolve(inboxOf([base]));
  await waitFor(() => expect(screen.queryByText('Cargando solicitudes…')).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 2, name: 'Copa Airlines' })).toBeInTheDocument();
});
