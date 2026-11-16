import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import MasterDataRoute from './MasterDataRoute';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import {
  createOccAircraftType, createOccStand, createOccTerminal, loadOccMasterData, updateOccStand, updateOccTerminal,
} from '../../services/occMasterDataService';

const stationId = '20000000-0000-7000-8000-000000000003';
const auth = vi.hoisted(() => ({ scopes: [] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: auth.scopes } }) }));
// A spy: the page must not open an observer of its own (contratos 2.7).
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  })),
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

// Every case renders inside the OCC frame, whose shell channel brings the feed's announcements (contratos 2.7).
let shell;
beforeEach(() => { shell = createOccShellValue(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); auth.scopes = []; });

function InFrame({ children }) {
  return <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>;
}
const render = ui => renderView(ui, { wrapper: InFrame });

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
  const row = within(terminals).getByLabelText('Nombre de la terminal C').closest('tr');
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

it('links each stand to the positions map with stand=<code>', async () => {
  signedIn();
  const b21 = { ...a01, id: 's-b21', code: 'B21', hasHistory: false, version: 'v-b21' };
  loadOccMasterData.mockResolvedValue(data({ stands: [a01, b21] }));
  const access = administratorAccess('operations', DepartmentPermissionCodes.operations);
  const { unmount } = render(<DepartmentAccessProvider initialAccess={access} observe={false}><MasterDataRoute /></DepartmentAccessProvider>);
  const stands = await screen.findByRole('region', { name: 'Posiciones' });
  // The URL carries the code as the map's selection reads it (contratos 2.1): A01 is the stand A1.
  expect(within(stands).getByRole('link', { name: 'Ver A01 en el mapa' })).toHaveAttribute('href', '/admin-occ/positions-map?stand=A1');
  expect(within(stands).getByRole('link', { name: 'Ver B21 en el mapa' })).toHaveAttribute('href', '/admin-occ/positions-map?stand=B21');
  expect(within(stands).getAllByRole('link').map(link => link.textContent)).toEqual(['Ver en el mapa', 'Ver en el mapa']);
  // Each link sits on its stand's row, and only stands have one.
  expect(within(within(stands).getByLabelText('Código de la posición B21').closest('tr')).getByRole('link'))
    .toHaveAccessibleName('Ver B21 en el mapa');
  expect(within(screen.getByRole('region', { name: 'Terminales' })).queryByRole('link')).toBeNull();
  // Following one reads nothing: it is a link, not a command.
  expect(loadOccMasterData).toHaveBeenCalledTimes(1);
  unmount();

  // An account that cannot read the positions map gets no link.
  const withoutMap = { ...access, permissions: access.permissions.filter(code => code !== 'operations.positions_map.read') };
  render(<DepartmentAccessProvider initialAccess={withoutMap} observe={false}><MasterDataRoute /></DepartmentAccessProvider>);
  expect(within(await screen.findByRole('region', { name: 'Posiciones' })).queryByRole('link')).toBeNull();
});

it('shows a record out of use dimmed, with its muted pill, and still lets it be reactivated', async () => {
  signedIn();
  const a11 = { ...a01, id: 's-a11', code: 'A11', isActive: false, hasHistory: false, version: 'v-a11' };
  loadOccMasterData.mockResolvedValue(data({ stands: [a01, a11] }));
  updateOccStand.mockResolvedValue({ ...a11, isActive: true, version: 'v-a11b' });
  render(<MasterDataRoute />);
  const stands = await screen.findByRole('region', { name: 'Posiciones' });
  const row = within(stands).getByLabelText('Código de la posición A11').closest('tr');
  const pill = within(row).getByText('Inactiva').closest('[data-occ-status]');
  expect(pill).toHaveAttribute('data-tone', 'muted');
  // The row's controls are dimmed; the pill keeps its full contrast.
  expect(within(row).getByLabelText('Código de la posición A11').closest('.opacity-70')).not.toBeNull();
  expect(pill.closest('.opacity-70')).toBeNull();
  const active = within(stands).getByLabelText('Código de la posición A01').closest('tr');
  expect(within(active).queryByText('Inactiva')).toBeNull();
  expect(active.querySelector('.opacity-70')).toBeNull();
  // A stand with history says so beside its code, and the note under the table says what it means.
  expect(within(active).getByText('Con historial')).toBeInTheDocument();
  expect(within(stands).getByLabelText('Código de la posición A01'))
    .toHaveAccessibleDescription('Con historial: el código y la terminal no cambian.');
  fireEvent.click(within(row).getByLabelText('Activa'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('Posición A11 reactivada.')).toBeInTheDocument();
  expect(updateOccStand).toHaveBeenCalledWith('s-a11', expect.objectContaining({ isActive: true, expectedVersion: 'v-a11' }),
    expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('reads the layout again when the frame announces occ_planning, without an observer of its own', async () => {
  signedIn();
  const terminalD = { ...terminalC, id: 't-d', code: 'D', name: 'Terminal D', version: 'v-td' };
  // The first read, then the layout with the terminal another seat added.
  loadOccMasterData.mockResolvedValue(data({ terminals: [terminalA, terminalC, terminalD] })).mockResolvedValueOnce(data());
  const view = render(<MasterDataRoute />);
  const terminals = await screen.findByRole('region', { name: 'Terminales' });
  // It listens on the shell's channel, to occ_planning only: the tab's one observer stays the frame's (contratos 2.7).
  expect(shell.subscriptions()).toEqual(['occ_planning']);
  expect(createPrivateWebAccountChangeObserver).not.toHaveBeenCalled();

  // What other modules announce reads nothing here.
  act(() => shell.announce(['mobile_devices', 'operation_messages']));
  expect(loadOccMasterData).toHaveBeenCalledTimes(1);

  // Another OCC seat added a terminal: the page reads the station's layout again and shows it.
  act(() => shell.announce(['occ_planning']));
  expect(await within(terminals).findByLabelText('Nombre de la terminal D')).toHaveValue('Terminal D');
  expect(loadOccMasterData.mock.calls.map(([id]) => id)).toEqual([stationId, stationId]);

  // Leaving the page stops listening.
  view.unmount();
  expect(shell.subscriptions()).toEqual([]);
});

describe('MasterDataRoute in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('renders the master data in English inside the OCC scope', async () => {
    act(() => resetLanguageForTests('en'));
    signedIn();
    const a11 = { ...a01, id: 's-a11', code: 'A11', isActive: false, hasHistory: false, version: 'v-a11' };
    loadOccMasterData.mockResolvedValue(data({ stands: [a01, a11] }));
    createOccTerminal.mockResolvedValue({ ...terminalC, id: 't-d', code: 'D', name: 'Terminal D' });
    render(<LanguageScope><MasterDataRoute /></LanguageScope>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the master data…');
    expect(await screen.findByRole('heading', { level: 1, name: 'Master data' })).toBeInTheDocument();

    const terminals = screen.getByRole('region', { name: 'Terminals' });
    expect(within(terminals).getByText('Nothing is deleted: what is no longer used is deactivated.')).toBeInTheDocument();
    expect(within(within(terminals).getByRole('table', { name: 'Terminals' })).getAllByRole('columnheader')
      .map(header => header.textContent)).toEqual(['Code', 'Name', 'Status', '']);
    expect(within(terminals).getByLabelText('Code of terminal A')).toBeDisabled();
    expect(within(terminals).getByText('With history: the code does not change.')).toBeInTheDocument();

    const stands = screen.getByRole('region', { name: 'Stands' });
    expect(within(within(stands).getByRole('table', { name: 'Stands' })).getAllByRole('columnheader')
      .map(header => header.textContent)).toEqual(['Code', 'Terminal', 'Attributes', 'Maximum size', 'Status', '']);
    const a11Row = within(stands).getByLabelText('Code of stand A11').closest('tr');
    expect(within(a11Row).getByText('Inactive')).toBeInTheDocument();
    expect(within(a11Row).getByLabelText('Bridge')).not.toBeChecked();
    expect(within(stands).getByRole('combobox', { name: 'Maximum size of stand A01' })).toHaveDisplayValue('Any size');
    expect(within(stands).getByRole('form', { name: 'New stand' })).toBeInTheDocument();

    const types = screen.getByRole('region', { name: 'Aircraft types' });
    expect(within(types).getByRole('combobox', { name: 'Size of A320' })).toHaveDisplayValue('Narrow-body');
    expect(within(types).getByRole('form', { name: 'New aircraft type' })).toBeInTheDocument();

    const form = within(terminals).getByRole('form', { name: 'New terminal' });
    fireEvent.change(within(form).getByLabelText('Code'), { target: { value: 'd' } });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Terminal D' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create terminal' }));
    expect(await screen.findByText('Terminal D created.')).toBeInTheDocument();
    expect(screen.queryByText(/Datos maestros|Terminales|Posiciones|Tipos de avión|Guardar|Crear/)).toBeNull();
  });
});

it('lists the stands in natural order of their codes', async () => {
  signedIn();
  const codes = ['A10', 'BN10', 'A02', 'BN6', 'A3', 'A01', 'BN13', 'A11'];
  loadOccMasterData.mockResolvedValue(data({ stands: codes.map(code => ({ ...a01, id: `s-${code}`, code, version: `v-${code}` })) }));
  render(<MasterDataRoute />);
  const stands = await screen.findByRole('region', { name: 'Posiciones' });
  const shown = within(stands).getAllByLabelText(/^Código de la posición /).map(input => input.value);
  expect(shown).toEqual(['A01', 'A02', 'A3', 'A10', 'A11', 'BN6', 'BN10', 'BN13']);
});
