import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MasterDataRoute from './MasterDataRoute';
import {
  createOccAircraftType, createOccStand, createOccTerminal, loadOccMasterData, updateOccStand, updateOccTerminal,
} from '../../services/occMasterDataService';

const stationId = '20000000-0000-7000-8000-000000000003';
const auth = vi.hoisted(() => ({ scopes: [] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: auth.scopes } }) }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../services/occMasterDataService', async importOriginal => ({
  ...(await importOriginal()),
  loadOccMasterData: vi.fn(), createOccTerminal: vi.fn(), updateOccTerminal: vi.fn(), createOccStand: vi.fn(),
  updateOccStand: vi.fn(), createOccAircraftType: vi.fn(), updateOccAircraftType: vi.fn(),
}));

const terminalA = { id: 't-a', code: 'A', name: 'Terminal A', isActive: true, hasHistory: true, version: 'v-ta' };
const terminalC = { id: 't-c', code: 'C', name: 'Terminal C', isActive: true, hasHistory: false, version: 'v-tc' };
const a01 = { id: 's-a01', terminalId: 't-a', code: 'A01', hasBoardingBridge: false, isRemote: false, maxAircraftSize: null,
  isActive: true, hasHistory: true, version: 'v-a01' };
const a320 = { id: 'at-a320', icaoCode: 'A320', iataCode: '320', manufacturer: 'Airbus', model: 'A320', sizeCategory: 'Narrowbody',
  isActive: true, version: 'v-a320' };
const data = (extra = {}) => ({ stationId, stationCode: 'PUJ', terminals: [terminalA, terminalC], stands: [a01],
  aircraftTypes: [a320], canCreate: true, canUpdate: true, ...extra });
const failure = (status, code) => Object.assign(new Error('The stand is in use.'), { status, code, title: 'The stand is in use.' });

afterEach(() => { cleanup(); vi.clearAllMocks(); auth.scopes = []; });

function signedIn() { auth.scopes = [{ stationId, stationCode: 'PUJ' }]; }

it('lists the station layout and creates a terminal, a stand and an aircraft type, each with its key', async () => {
  signedIn();
  loadOccMasterData.mockResolvedValue(data());
  createOccTerminal.mockResolvedValue({ ...terminalC, id: 't-d', code: 'D', name: 'Terminal D' });
  createOccStand.mockResolvedValue({ ...a01, id: 's-9a', code: '9A', terminalId: 't-c', hasHistory: false });
  createOccAircraftType.mockResolvedValue({ ...a320, id: 'at-b738', icaoCode: 'B738' });
  render(<MasterDataRoute />);

  const terminals = await screen.findByRole('region', { name: 'Terminales' });
  // A terminal with history keeps its code; one without can still be renamed.
  expect(within(terminals).getByLabelText('Código de la terminal A')).toBeDisabled();
  expect(within(terminals).getByLabelText('Código de la terminal C')).toBeEnabled();
  const terminalForm = within(terminals).getByRole('form', { name: 'Nueva terminal' });
  fireEvent.change(within(terminalForm).getByLabelText('Código'), { target: { value: 'd' } });
  fireEvent.change(within(terminalForm).getByLabelText('Nombre'), { target: { value: 'Terminal D' } });
  fireEvent.click(within(terminalForm).getByRole('button', { name: 'Crear terminal' }));
  expect(await screen.findByText('Terminal D creada.')).toBeInTheDocument();
  expect(createOccTerminal).toHaveBeenCalledWith({ stationId, code: 'D', name: 'Terminal D' }, expect.stringMatching(/^[0-9a-f-]{36}$/));

  const standForm = screen.getByRole('form', { name: 'Nueva posición' });
  fireEvent.change(within(standForm).getByLabelText('Terminal'), { target: { value: 't-c' } });
  fireEvent.change(within(standForm).getByLabelText('Código'), { target: { value: '9a' } });
  fireEvent.click(within(standForm).getByLabelText('Remota'));
  fireEvent.change(within(standForm).getByLabelText('Tamaño máximo'), { target: { value: 'Narrowbody' } });
  fireEvent.click(within(standForm).getByRole('button', { name: 'Crear posición' }));
  expect(await screen.findByText('Posición 9A creada.')).toBeInTheDocument();
  expect(createOccStand).toHaveBeenCalledWith({ stationId, terminalId: 't-c', code: '9A', hasBoardingBridge: false, isRemote: true,
    maxAircraftSize: 'Narrowbody' }, expect.any(String));

  const typeForm = screen.getByRole('form', { name: 'Nuevo tipo de avión' });
  fireEvent.change(within(typeForm).getByLabelText('OACI'), { target: { value: 'b738' } });
  fireEvent.change(within(typeForm).getByLabelText('Fabricante'), { target: { value: 'Boeing' } });
  fireEvent.change(within(typeForm).getByLabelText('Modelo'), { target: { value: '737-800' } });
  fireEvent.click(within(typeForm).getByRole('button', { name: 'Crear tipo de avión' }));
  expect(await screen.findByText('Tipo de avión B738 creado.')).toBeInTheDocument();
  expect(createOccAircraftType).toHaveBeenCalledWith({ icaoCode: 'B738', iataCode: null, manufacturer: 'Boeing', model: '737-800',
    sizeCategory: null }, expect.any(String));
  expect(loadOccMasterData).toHaveBeenCalledTimes(4);
});

it('explains a stand in use in Spanish, reads the layout again and keeps the key of an uncertain retry', async () => {
  signedIn();
  loadOccMasterData.mockResolvedValue(data());
  updateOccStand.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(failure(409, 'stand_in_use'));
  render(<MasterDataRoute />);
  const stands = await screen.findByRole('region', { name: 'Posiciones' });
  expect(within(stands).getByLabelText('Código de la posición A01')).toBeDisabled();
  fireEvent.click(within(stands).getByLabelText('Activa'));
  fireEvent.click(within(stands).getByRole('button', { name: 'Guardar' }));
  // No answer: the connection is explained and the retry keeps the intent's key.
  expect(await within(stands).findByRole('alert')).toHaveTextContent('Revisa la conexión e intenta de nuevo.');
  fireEvent.click(within(stands).getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText(/La posición tiene vuelos sin terminar o coberturas abiertas/)).toBeInTheDocument();
  expect(screen.queryByText('The stand is in use.')).not.toBeInTheDocument();
  const [first, second] = updateOccStand.mock.calls;
  expect(first[1]).toEqual({ terminalId: 't-a', code: 'A01', hasBoardingBridge: false, isRemote: false, maxAircraftSize: null,
    isActive: false, expectedVersion: 'v-a01' });
  expect(second[2]).toBe(first[2]);
  await waitFor(() => expect(loadOccMasterData).toHaveBeenCalledTimes(2));
});

it('deactivates a terminal with the version on screen', async () => {
  signedIn();
  loadOccMasterData.mockResolvedValue(data());
  updateOccTerminal.mockResolvedValue({ ...terminalC, isActive: false, version: 'v-tc2' });
  render(<MasterDataRoute />);
  const terminals = await screen.findByRole('region', { name: 'Terminales' });
  const row = within(terminals).getByLabelText('Nombre de la terminal C').closest('li');
  fireEvent.click(within(row).getByLabelText('Activa'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('Terminal C desactivada.')).toBeInTheDocument();
  expect(updateOccTerminal).toHaveBeenCalledWith('t-c', { code: 'C', name: 'Terminal C', isActive: false, expectedVersion: 'v-tc' },
    expect.any(String));
});

it('shows the empty, read-only, unauthorized, error and no-station states', async () => {
  render(<MasterDataRoute />);
  expect(screen.getByRole('alert')).toHaveTextContent('Tu cuenta no tiene una estación OCC autorizada.');
  expect(loadOccMasterData).not.toHaveBeenCalled();
  cleanup();

  signedIn();
  loadOccMasterData.mockResolvedValueOnce(data({ terminals: [], stands: [], aircraftTypes: [] }));
  render(<MasterDataRoute />);
  expect(screen.getByRole('status')).toHaveTextContent('Cargando los datos maestros…');
  expect(await screen.findByText(/La estación aún no tiene terminales/)).toBeInTheDocument();
  expect(screen.getByText('Crea o reactiva una terminal para registrar sus posiciones.')).toBeInTheDocument();
  expect(screen.getByText('Aún no hay tipos de avión.')).toBeInTheDocument();
  cleanup();

  loadOccMasterData.mockResolvedValueOnce(data({ canCreate: false, canUpdate: false }));
  render(<MasterDataRoute />);
  expect(await screen.findByText(/permite consultar los datos maestros, no modificarlos/)).toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Nueva terminal' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Nombre de la terminal C')).toBeDisabled();
  cleanup();

  loadOccMasterData.mockRejectedValueOnce(failure(403, 'forbidden'));
  render(<MasterDataRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite ver los datos maestros de esta estación.');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  cleanup();

  loadOccMasterData.mockRejectedValueOnce(Object.assign(new Error('Gateway'), { status: 503 })).mockResolvedValueOnce(data());
  render(<MasterDataRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible completar la acción');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('region', { name: 'Terminales' })).toBeInTheDocument();
});
