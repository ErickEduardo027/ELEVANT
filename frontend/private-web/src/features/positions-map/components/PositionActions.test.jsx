import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PositionActions from './PositionActions';
import PositionDetailDrawer from './PositionDetailDrawer';
import { assignOccStand, recordOccArrival, releaseOccStand } from '../../../services/occPositionsService';
import { getTurnaround } from '../../../services/planningService';
import { loadOccMasterData } from '../../../services/occMasterDataService';
import { assignCandidates } from '../PositionsMapPage';
import { mapOccupancyToRampPositions, mapStandCode } from '../positionsMapMappers';

vi.mock('../../../services/occPositionsService', () => ({
  assignOccStand: vi.fn(), recordOccArrival: vi.fn(), releaseOccStand: vi.fn(), locateOccStand: vi.fn(),
  isStalePosition: error => [409, 412, 428].includes(error?.status),
  positionVersionMessage: error => (error?.status === 403
    ? 'Tu acceso no permite consultar este vuelo: no puedes registrar su llegada ni cambiar su posición.'
    : 'No se pudo consultar la versión del vuelo. Revisa la conexión e intenta de nuevo.'),
}));
vi.mock('../../../services/planningService', () => ({ getTurnaround: vi.fn() }));
vi.mock('../../../services/occMasterDataService', () => ({ loadOccMasterData: vi.fn() }));

const waiting = { turnaroundId: 't-1', operationCode: 'DEV-TAT-0001', airlineName: 'Demo Airlines', aircraftRegistration: null,
  arrivalFlightNumber: 'ZZ101', departureFlightNumber: 'ZZ102', arrivalScheduledAt: '2026-08-18T16:00:00Z', arrivedAt: null,
  departureScheduledAt: '2026-08-18T18:00:00Z', assignedFrom: '2026-08-18T15:00:00Z', status: 'Confirmed' };
const other = { ...waiting, turnaroundId: 't-2', arrivalFlightNumber: 'ZZ303', operationCode: 'DEV-TAT-0003' };
const board = { stationCode: 'PUJ', asOf: '2026-08-18T15:30:00Z', canAssign: true, unassigned: [other], positions: [
  { standId: 's-1', code: 'A01', terminalCode: 'A', standType: 'Contact', status: 'planned', turnarounds: [waiting] },
  { standId: 's-2', code: 'A02', terminalCode: 'A', standType: 'Contact', status: 'available', turnarounds: [] }] };
const station = { id: 'st-1', code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' };
const detail = (id, allowedActions = ['reschedule', 'cancel', 'divert'], aircraft = null) => ({
  turnaround: { station, turnaround: { id, aircraft }, version: `v-${id}`, isCharter: false, allowedActions },
  etag: `"v-${id}"`,
});
const types = { aircraftTypes: [
  { id: 'type-1', icaoCode: 'A320', manufacturer: 'Airbus', model: 'A320-200', isActive: true },
  { id: 'type-2', icaoCode: 'A333', manufacturer: 'Airbus', model: 'A330-300', isActive: false },
  { id: 'type-3', icaoCode: 'B738', manufacturer: 'Boeing', model: '737-800', isActive: true }] };
const headers = id => ({ ifMatch: `"v-${id}"`, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });

beforeEach(() => {
  recordOccArrival.mockResolvedValue(board);
  assignOccStand.mockResolvedValue(board);
  releaseOccStand.mockResolvedValue(board);
  getTurnaround.mockImplementation(async id => detail(id));
  loadOccMasterData.mockResolvedValue(types);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it('places database stands on the map and keeps unknown map positions unverified', () => {
  expect(mapStandCode('A01')).toBe('A1');
  expect(mapStandCode('b032')).toBe('B32');
  const positions = mapOccupancyToRampPositions([{ id: 'A1', terminal: 'A', lat: 1, lon: 2 },
    { id: 'A2', terminal: 'A', lat: 1, lon: 2 }, { id: 'B21', terminal: 'B', lat: 1, lon: 2 }], board);
  expect(positions.map(item => [item.id, item.status, item.standId])).toEqual([['A1', 'planned', 's-1'],
    ['A2', 'available', 's-2'], ['B21', 'unverified', null]]);
  expect(positions[0].flightNumber).toBe('ZZ101');
});

it('labels a demo flight «Demo» in the drawer header, on the stand and among the flights to bring, and no other (ADR-0041)', async () => {
  const demoHere = { ...waiting, isDemo: true };
  const demoElsewhere = { ...other, turnaroundId: 't-4', arrivalFlightNumber: 'ZZ9003', operationCode: 'DEV-TAT-0004', isDemo: true };
  const demoBoard = { ...board, unassigned: [other, demoElsewhere],
    positions: [{ ...board.positions[0], turnarounds: [demoHere] }, board.positions[1]] };
  const [a1, a2] = mapOccupancyToRampPositions([{ id: 'A1', terminal: 'A', lat: 1, lon: 2 }, { id: 'A2', terminal: 'A', lat: 1, lon: 2 }],
    demoBoard);
  const candidates = assignCandidates({ ...demoBoard, stands: demoBoard.positions });
  const { rerender } = render(<PositionDetailDrawer position={a1} onClose={vi.fn()} onViewFlightInMonitoring={vi.fn()} canAssign
    candidates={candidates} onChanged={vi.fn()} />);

  expect(within(screen.getByText('A1').parentElement).getByText('Demo')).toBeInTheDocument();
  const actions = screen.getByRole('region', { name: 'Acciones de la posición' });
  expect(within(actions).getAllByText('Demo')).toHaveLength(1);
  expect(screen.getByRole('option', { name: /^ZZ9003 · Demo Airlines · Demo · \d/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /^ZZ303 · Demo Airlines · \d/ })).toBeInTheDocument();
  await waitFor(() => expect(getTurnaround).toHaveBeenCalledWith('t-1', expect.anything()));

  // A stand without a demo flight carries no label; the demo flight to bring keeps its own in the list.
  rerender(<PositionDetailDrawer position={a2} onClose={vi.fn()} onViewFlightInMonitoring={vi.fn()} canAssign
    candidates={candidates} onChanged={vi.fn()} />);
  expect(screen.queryByText('Demo')).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: /^ZZ9003 · Demo Airlines · Demo · \d/ })).toBeInTheDocument();
});

it('registers the arrival at the local time with the flight ETag, releases the stand and brings another flight', async () => {
  const onChanged = vi.fn();
  const [a1, a2] = mapOccupancyToRampPositions([{ id: 'A1', terminal: 'A', lat: 1, lon: 2 }, { id: 'A2', terminal: 'A', lat: 1, lon: 2 }], board);
  const candidates = assignCandidates({ ...board, stands: board.positions });
  const view = render(<PositionActions position={a1} candidates={candidates} onChanged={onChanged} />);

  // The station's local time (UTC−4): 12:05 in Punta Cana travels as 16:05Z.
  const time = await screen.findByLabelText('Hora real de llegada (hora local de PUJ)');
  fireEvent.change(time, { target: { value: '2026-08-18T12:05' } });
  await userEvent.type(screen.getByLabelText('Matrícula'), 'hi1055');
  // Only the active types of the station are offered.
  const type = await screen.findByLabelText('Tipo de avión (opcional)');
  expect(screen.queryByRole('option', { name: /A330-300/ })).not.toBeInTheDocument();
  await userEvent.selectOptions(type, 'type-3');
  await userEvent.click(screen.getByRole('button', { name: 'Registrar llegada' }));
  expect(recordOccArrival).toHaveBeenCalledWith('t-1', { aircraftRegistration: 'HI1055', arrivedAt: '2026-08-18T16:05:00.000Z',
    aircraftTypeId: 'type-3', reason: null }, headers('t-1'));
  expect(await screen.findByText('Llegada registrada: HI1055 en A1.')).toBeInTheDocument();
  // The arrival changed the flight: the release waits for its new version.
  const release = screen.getByRole('button', { name: 'Liberar posición' });
  await waitFor(() => expect(release).toBeEnabled());
  await userEvent.click(release);
  expect(releaseOccStand).toHaveBeenCalledWith('t-1', headers('t-1'));
  expect(onChanged).toHaveBeenCalledTimes(2);

  view.unmount();
  render(<PositionActions position={a2} candidates={candidates} onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('button', { name: 'Asignar posición' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Elige el vuelo');
  expect(screen.getByRole('option', { name: /ZZ101 · Demo Airlines .*\(ahora en A01\)/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox'), 't-2');
  await waitFor(() => expect(getTurnaround).toHaveBeenCalledWith('t-2', expect.anything()));
  const assign = screen.getByRole('button', { name: 'Asignar posición' });
  await waitFor(() => expect(assign).toBeEnabled());
  assignOccStand.mockRejectedValueOnce(Object.assign(new Error('Otro vuelo ocupa esa posición en ese horario.'),
    { status: 409, code: 'stand_unavailable', reasons: ['stand_taken'] }));
  await userEvent.click(assign);
  expect(await screen.findByRole('alert')).toHaveTextContent('Otro vuelo ocupa esa posición');
  // The stand was taken meanwhile: the flight and the board are read again before a new intent.
  expect(onChanged).toHaveBeenCalledTimes(3);
  await waitFor(() => expect(assign).toBeEnabled());
  await userEvent.click(assign);
  expect(assignOccStand).toHaveBeenLastCalledWith('t-2', 's-2', null, headers('t-2'));
});

it('waits for the flight version before any command, then sends the key with its ETag', async () => {
  // 3-N10: a command pinned before the version arrived would travel, and be retried, without key nor version.
  const pending = {};
  getTurnaround.mockImplementation(id => new Promise(resolve => { pending[id] = () => resolve(detail(id)); }));
  const answer = () => act(async () => { for (const resolve of Object.values(pending)) resolve(); });
  const position = { id: 'A1', standId: 's-1', turnarounds: [waiting] };
  render(<PositionActions position={position} candidates={[waiting, other]} onChanged={vi.fn()} />);

  expect(screen.getByRole('status')).toHaveTextContent('Consultando la versión del vuelo…');
  expect(screen.queryByRole('button', { name: 'Registrar llegada' })).not.toBeInTheDocument();
  const release = screen.getByRole('button', { name: 'Liberar posición' });
  expect(release).toBeDisabled();
  fireEvent.click(release);
  await userEvent.selectOptions(screen.getByRole('combobox'), 't-2');
  const assign = screen.getByRole('button', { name: 'Asignar posición' });
  expect(assign).toBeDisabled();
  expect(screen.getAllByRole('status')).toHaveLength(2);
  fireEvent.submit(assign.closest('form'));
  expect(releaseOccStand).not.toHaveBeenCalled();
  expect(assignOccStand).not.toHaveBeenCalled();

  await answer();
  await waitFor(() => expect(release).toBeEnabled());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await userEvent.click(release);
  expect(releaseOccStand).toHaveBeenCalledWith('t-1', headers('t-1'));
  // The release changed the flights: the next command waits for their new versions.
  await waitFor(() => expect(assign).toBeDisabled());
  await answer();
  await waitFor(() => expect(assign).toBeEnabled());
  await userEvent.click(assign);
  expect(assignOccStand).toHaveBeenCalledWith('t-2', 's-1', null, headers('t-2'));
});

it('corrects a recorded arrival only with its reason, and reads the flight again when it moved', async () => {
  const arrived = { ...waiting, aircraftRegistration: 'HI1055', arrivedAt: '2026-08-18T16:05:00Z', status: 'InProgress' };
  getTurnaround.mockImplementation(async id => detail(id, ['correctArrival'], { id: 'type-1', icaoCode: 'A320' }));
  const position = { id: 'A1', standId: 's-1', turnarounds: [arrived] };
  render(<PositionActions position={position} onChanged={vi.fn()} />);

  // A recorded arrival is no longer recorded again: it is corrected.
  await userEvent.click(await screen.findByRole('button', { name: 'Corregir llegada' }));
  expect(screen.getByLabelText('Hora real de llegada (hora local de PUJ)')).toHaveValue('2026-08-18T12:05');
  expect(screen.getByRole('option', { name: 'Mantener el actual (A320)' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Indica el motivo');
  expect(recordOccArrival).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Hora real de llegada (hora local de PUJ)'), { target: { value: '2026-08-18T11:50' } });
  await userEvent.type(screen.getByLabelText('Motivo de la corrección'), 'El bloqueo real fue antes');
  recordOccArrival.mockRejectedValueOnce(Object.assign(new Error('El vuelo cambió mientras lo revisabas.'),
    { status: 412, code: 'version_conflict' }));
  const reads = getTurnaround.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }));
  expect(recordOccArrival).toHaveBeenCalledWith('t-1', { aircraftRegistration: 'HI1055', arrivedAt: '2026-08-18T15:50:00.000Z',
    aircraftTypeId: null, reason: 'El bloqueo real fue antes' }, headers('t-1'));
  expect(await screen.findByRole('alert')).toHaveTextContent('El vuelo cambió');
  await waitFor(() => expect(getTurnaround.mock.calls.length).toBeGreaterThan(reads));
});

it('keeps the time the provider reported as it is, and replaces it only with its reason', async () => {
  // 3-N08: the time on the flight before OCC records it came from the flight feed.
  const reported = { ...waiting, arrivedAt: '2026-08-18T16:02:00Z' };
  const position = { id: 'A1', standId: 's-1', turnarounds: [reported] };
  const view = render(<PositionActions position={position} onChanged={vi.fn()} />);
  expect(await screen.findByLabelText('Hora real de llegada (hora local de PUJ)')).toHaveValue('2026-08-18T12:02');
  expect(screen.getByText(/^Ya hay una hora de llegada informada .*Si registras otra, indica el motivo\.$/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Motivo del cambio de hora')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Matrícula'), 'HI1055');
  await userEvent.click(screen.getByRole('button', { name: 'Registrar llegada' }));
  expect(recordOccArrival).toHaveBeenLastCalledWith('t-1', { aircraftRegistration: 'HI1055', arrivedAt: '2026-08-18T16:02:00Z',
    aircraftTypeId: null, reason: null }, headers('t-1'));
  view.unmount();

  render(<PositionActions position={position} onChanged={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('Hora real de llegada (hora local de PUJ)'), { target: { value: '2026-08-18T12:08' } });
  await userEvent.type(screen.getByLabelText('Matrícula'), 'HI1055');
  await userEvent.click(screen.getByRole('button', { name: 'Registrar llegada' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Indica el motivo del cambio de hora');
  expect(recordOccArrival).toHaveBeenCalledTimes(1);
  await userEvent.type(screen.getByLabelText('Motivo del cambio de hora'), 'Hora de calzos, no la de pista');
  await userEvent.click(screen.getByRole('button', { name: 'Registrar llegada' }));
  expect(recordOccArrival).toHaveBeenLastCalledWith('t-1', { aircraftRegistration: 'HI1055', arrivedAt: '2026-08-18T16:08:00.000Z',
    aircraftTypeId: null, reason: 'Hora de calzos, no la de pista' }, headers('t-1'));
});

it('records the moment it is saved when OCC leaves the arrival time untouched', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-08-18T16:00:00Z'));
  const position = { id: 'A1', standId: 's-1', turnarounds: [waiting] };
  render(<PositionActions position={position} onChanged={vi.fn()} />);

  const time = await screen.findByLabelText('Hora real de llegada (hora local de PUJ)');
  expect(time).toHaveValue('2026-08-18T12:00');
  expect(screen.getByText('Si no la cambias, se registra la hora en que guardes.')).toBeInTheDocument();
  // The panel stays open until the aircraft blocks: the untouched time follows the clock and travels empty.
  await act(async () => vi.advanceTimersByTimeAsync(30 * 60_000));
  expect(time).toHaveValue('2026-08-18T12:30');
  await userEvent.type(screen.getByLabelText('Matrícula'), 'HI1055');
  await userEvent.click(screen.getByRole('button', { name: 'Registrar llegada' }));
  expect(recordOccArrival).toHaveBeenCalledWith('t-1', { aircraftRegistration: 'HI1055', arrivedAt: null,
    aircraftTypeId: null, reason: null }, headers('t-1'));
});

it('offers no command while the flight version cannot be read: it retries a failure and explains a 403', async () => {
  getTurnaround.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }));
  const position = { id: 'A1', standId: 's-1', turnarounds: [waiting] };
  const view = render(<PositionActions position={position} onChanged={vi.fn()} />);

  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar la versión del vuelo.');
  expect(screen.queryByRole('button', { name: 'Registrar llegada' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Liberar posición' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await userEvent.type(await screen.findByLabelText('Matrícula'), 'HI2042');
  await userEvent.click(screen.getByRole('button', { name: 'Registrar llegada' }));
  expect(recordOccArrival).toHaveBeenCalledWith('t-1', expect.objectContaining({ aircraftRegistration: 'HI2042' }),
    headers('t-1'));
  view.unmount();

  // An account that may not read the flight is told why, and is offered nothing to send.
  getTurnaround.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
  render(<PositionActions position={position} onChanged={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite consultar este vuelo');
  expect(screen.queryByLabelText('Matrícula')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Liberar posición' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  expect(recordOccArrival).toHaveBeenCalledTimes(1);
  expect(releaseOccStand).not.toHaveBeenCalled();
});
