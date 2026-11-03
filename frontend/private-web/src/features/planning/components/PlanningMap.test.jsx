import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PlanningMap from './PlanningMap';
import { loadOccPositions } from '../../../services/occPositionsService';

vi.mock('next/dynamic', () => ({ default: () => function MapStub({ positions, onSelectPosition }) {
  return <div data-testid="map">{positions.map(position => <button key={position.id} type="button"
    onClick={() => onSelectPosition(position.id)}>{`pin ${position.id}`}</button>)}</div>;
} }));
vi.mock('../../../services/occPositionsService', () => ({ loadOccPositions: vi.fn() }));

const stationId = '20000000-0000-7000-8000-000000000003';
const parked = { turnaroundId: 't1', operationCode: 'OP-1', airlineName: 'Arajet', aircraftRegistration: null,
  arrivalFlightNumber: 'DM161', departureFlightNumber: 'DM162', arrivalScheduledAt: '2026-11-03T14:00:00Z', arrivedAt: null,
  departureScheduledAt: '2026-11-03T15:00:00Z', assignedFrom: '2026-11-03T13:30:00Z', status: 'Planned' };
const waiting = { ...parked, turnaroundId: 't2', operationCode: 'OP-2', arrivalFlightNumber: 'DM300' };
const board = { stationId, stationCode: 'PUJ', operationDate: '2026-11-03', asOf: '2026-11-03T12:00:00Z', canAssign: true,
  positions: [{ standId: 's1', code: 'A01', terminalCode: 'A', standType: 'Contact', status: 'planned', turnarounds: [parked],
    latitude: 18.5674, longitude: -68.3634 }],
  unassigned: [waiting] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows the stands with flights and opens a flight in planning', async () => {
  loadOccPositions.mockResolvedValue(board);
  const onSelectFlight = vi.fn();
  render(<PlanningMap stationId={stationId} date="2026-11-03" flights={[{ id: 't1' }, { id: 't2' }]} onSelectFlight={onSelectFlight} />);
  expect(await screen.findByText(/1 de \d+ posiciones ubicadas por OCC/)).toBeInTheDocument();
  expect(loadOccPositions).toHaveBeenCalledWith(stationId, '2026-11-03', expect.anything());
  expect(screen.getByText('Posiciones con vuelos (1)')).toBeInTheDocument();
  expect(screen.getByText('Vuelos sin posición (1)')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'pin A1' }));
  expect(screen.getByText('Posición A1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /DM161/ }));
  expect(onSelectFlight).toHaveBeenCalledWith('t1');
  fireEvent.click(screen.getByRole('button', { name: /DM300/ }));
  expect(onSelectFlight).toHaveBeenLastCalledWith('t2');
});

it('reports a board error', async () => {
  loadOccPositions.mockRejectedValue(new Error('Tu acceso no permite registrar llegadas ni asignar posiciones.'));
  render(<PlanningMap stationId={stationId} date="2026-11-03" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no permite');
});
