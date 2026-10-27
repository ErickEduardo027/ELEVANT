import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PositionActions from './PositionActions';
import { assignOccStand, recordOccArrival, releaseOccStand } from '../../../services/occPositionsService';
import { assignCandidates } from '../PositionsMapPage';
import { mapOccupancyToRampPositions, mapStandCode } from '../positionsMapMappers';

vi.mock('../../../services/occPositionsService', () => ({
  assignOccStand: vi.fn(), recordOccArrival: vi.fn(), releaseOccStand: vi.fn(),
}));

const waiting = { turnaroundId: 't-1', operationCode: 'DEV-TAT-0001', airlineName: 'Demo Airlines', aircraftRegistration: null,
  arrivalFlightNumber: 'ZZ101', departureFlightNumber: 'ZZ102', arrivalScheduledAt: '2026-08-18T16:00:00Z', arrivedAt: null,
  departureScheduledAt: '2026-08-18T18:00:00Z', assignedFrom: '2026-08-18T15:00:00Z', status: 'Confirmed' };
const other = { ...waiting, turnaroundId: 't-2', arrivalFlightNumber: 'ZZ303', operationCode: 'DEV-TAT-0003' };
const board = { stationCode: 'PUJ', asOf: '2026-08-18T15:30:00Z', canAssign: true, unassigned: [other], positions: [
  { standId: 's-1', code: 'A01', terminalCode: 'A', standType: 'Contact', status: 'planned', turnarounds: [waiting] },
  { standId: 's-2', code: 'A02', terminalCode: 'A', standType: 'Contact', status: 'available', turnarounds: [] }] };

beforeEach(() => {
  recordOccArrival.mockResolvedValue(board);
  assignOccStand.mockResolvedValue(board);
  releaseOccStand.mockResolvedValue(board);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('places database stands on the map and keeps unknown map positions unverified', () => {
  expect(mapStandCode('A01')).toBe('A1');
  expect(mapStandCode('b032')).toBe('B32');
  const positions = mapOccupancyToRampPositions([{ id: 'A1', terminal: 'A', lat: 1, lon: 2 },
    { id: 'A2', terminal: 'A', lat: 1, lon: 2 }, { id: 'B21', terminal: 'B', lat: 1, lon: 2 }], board);
  expect(positions.map(item => [item.id, item.status, item.standId])).toEqual([['A1', 'planned', 's-1'],
    ['A2', 'available', 's-2'], ['B21', 'unverified', null]]);
  expect(positions[0].flightNumber).toBe('ZZ101');
});

it('registers the arrival, releases the stand and brings another flight to a free stand', async () => {
  const onChanged = vi.fn();
  const [a1, a2] = mapOccupancyToRampPositions([{ id: 'A1', terminal: 'A', lat: 1, lon: 2 }, { id: 'A2', terminal: 'A', lat: 1, lon: 2 }], board);
  const candidates = assignCandidates({ ...board, stands: board.positions });
  const view = render(<PositionActions position={a1} candidates={candidates} onChanged={onChanged} />);

  await userEvent.type(screen.getByLabelText('Matrícula'), 'hi1055');
  await userEvent.click(screen.getByRole('button', { name: 'Registrar llegada' }));
  expect(recordOccArrival).toHaveBeenCalledWith('t-1', 'hi1055');
  expect(await screen.findByRole('status')).toHaveTextContent('Llegada registrada: HI1055 en A1.');
  await userEvent.click(screen.getByRole('button', { name: 'Liberar posición' }));
  expect(releaseOccStand).toHaveBeenCalledWith('t-1');
  expect(onChanged).toHaveBeenCalledTimes(2);

  view.unmount();
  render(<PositionActions position={a2} candidates={candidates} onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('button', { name: 'Asignar posición' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Elige el vuelo');
  expect(screen.getByRole('option', { name: /ZZ101 · Demo Airlines .*\(ahora en A01\)/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox'), 't-2');
  assignOccStand.mockRejectedValueOnce(new Error('La posición está ocupada o reservada en ese horario.'));
  await userEvent.click(screen.getByRole('button', { name: 'Asignar posición' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('ocupada o reservada');
  await userEvent.click(screen.getByRole('button', { name: 'Asignar posición' }));
  expect(assignOccStand).toHaveBeenLastCalledWith('t-2', 's-2');
});
