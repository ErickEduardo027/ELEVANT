import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TurnaroundChangeDialog from './TurnaroundChangeDialog';
import {
  changeTurnaroundStatus,
  getManualTurnaroundOptions,
  getTurnaround,
  rescheduleTurnaround,
} from '../../../services/planningService';

vi.mock('../../../services/planningService', () => ({
  getTurnaround: vi.fn(),
  rescheduleTurnaround: vi.fn(),
  changeTurnaroundStatus: vi.fn(),
  getManualTurnaroundOptions: vi.fn(),
}));

const turnaroundId = '70000000-0000-4000-8000-000000000001';
const stationId = '20000000-0000-7000-8000-000000000003';
const standB03 = { id: '20000000-0000-7000-8000-000000000006', code: 'B03', terminal: { id: 't-b', code: 'B', name: 'Terminal B' } };
const standA01 = { id: '20000000-0000-7000-8000-000000000005', code: 'A01', terminal: { id: 't-a', code: 'A', name: 'Terminal A' } };
const a320 = { id: '20000000-0000-7000-8000-000000000020', icaoCode: 'A320', iataCode: '320', manufacturer: 'Airbus', model: 'A320-200', sizeCategory: 'Narrowbody' };
const b738 = { id: '20000000-0000-7000-8000-000000000021', icaoCode: 'B738', iataCode: '73H', manufacturer: 'Boeing', model: '737-800', sizeCategory: 'Narrowbody' };
const MIA = { id: 'airport-mia', iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami' };
const PUJ = { id: 'airport-puj', iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana' };

function detail(version = 'v1', overrides = {}) {
  return {
    turnaround: {
      station: { id: stationId, code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
      turnaround: {
        id: turnaroundId, operationCode: 'PUJ-20261105-001', operationDate: '2026-11-05', status: 'Confirmed',
        airline: { id: 'airline', iataCode: 'EV', icaoCode: 'EVA', name: 'Elevant Demo' },
        aircraft: { ...a320, registration: null }, stand: standB03,
        arrival: { id: 'leg-a', flightNumber: 'EV311', origin: MIA, destination: PUJ, scheduledAt: '2026-11-05T17:00:00.000Z' },
        departure: { id: 'leg-d', flightNumber: 'EV312', origin: PUJ, destination: MIA, scheduledAt: '2026-11-05T18:30:00.000Z' },
        operation: null, agents: [], equipment: [], services: [],
      },
      version, isCharter: false, allowedActions: ['reschedule', 'cancel', 'divert'], ...overrides,
    },
    etag: `"${version}"`,
  };
}

const options = {
  station: { id: stationId, code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
  date: '2026-11-05', stationAirport: PUJ, airlines: [], charterAirlines: [], airports: [MIA, PUJ],
  stands: [standA01, standB03], aircraftTypes: [a320, b738],
};

const problem = (status, code, reasons = []) => Object.assign(new Error(code), { status, code, reasons });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTurnaround).mockResolvedValue(detail());
  vi.mocked(getManualTurnaroundOptions).mockResolvedValue(options);
  vi.mocked(rescheduleTurnaround).mockResolvedValue(detail('v2'));
  vi.mocked(changeTurnaroundStatus).mockResolvedValue(detail('v2', { allowedActions: [] }));
});

function renderDialog(mode) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(<TurnaroundChangeDialog turnaroundId={turnaroundId} mode={mode} onChanged={onChanged} onClose={onClose} />);
  return { onChanged, onClose };
}

describe('TurnaroundChangeDialog (3-A, 3-N19)', () => {
  it('prefills «Editar vuelo» in the station local time and sends the change in UTC with its ETag', async () => {
    const { onChanged } = renderDialog('reschedule');

    const arrival = await screen.findByLabelText('Llegada programada (hora local de PUJ)');
    expect(arrival).toHaveValue('2026-11-05T13:00');
    expect(screen.getByLabelText('Salida programada (hora local de PUJ)')).toHaveValue('2026-11-05T14:30');
    await screen.findByRole('option', { name: /A01/ });
    expect(screen.getByRole('option', { name: 'Mantener la posición actual (B03)' })).toBeInTheDocument();

    fireEvent.change(arrival, { target: { value: '2026-11-05T14:00' } });
    fireEvent.change(screen.getByLabelText('Salida programada (hora local de PUJ)'), { target: { value: '2026-11-05T15:30' } });
    await userEvent.selectOptions(screen.getByLabelText('Posición'), standA01.id);
    await userEvent.selectOptions(screen.getByLabelText('Tipo de avión'), b738.id);
    await userEvent.type(screen.getByLabelText('Motivo'), 'La aerolínea retrasó el vuelo una hora.');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(rescheduleTurnaround).toHaveBeenCalledTimes(1));
    expect(rescheduleTurnaround).toHaveBeenCalledWith(turnaroundId, {
      arrivalFlightNumber: 'EV311', arrivalOriginIata: 'MIA', arrivalScheduledAt: '2026-11-05T18:00:00.000Z',
      departureFlightNumber: 'EV312', departureDestinationIata: 'MIA', departureScheduledAt: '2026-11-05T19:30:00.000Z',
      standId: standA01.id, aircraftTypeId: b738.id, reason: 'La aerolínea retrasó el vuelo una hora.',
    }, { ifMatch: '"v1"', idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(onChanged).toHaveBeenCalledWith('reschedule', 'PUJ-20261105-001');
  });

  it('keeps the stand and the type when they are not changed, and refuses a departure before the arrival', async () => {
    renderDialog('reschedule');
    const departure = await screen.findByLabelText('Salida programada (hora local de PUJ)');
    await userEvent.type(screen.getByLabelText('Motivo'), 'Corrección del horario publicado.');

    fireEvent.change(departure, { target: { value: '2026-11-05T12:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('la salida va después de la llegada');
    expect(rescheduleTurnaround).not.toHaveBeenCalled();

    fireEvent.change(departure, { target: { value: '2026-11-05T16:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(rescheduleTurnaround).toHaveBeenCalledTimes(1));
    expect(rescheduleTurnaround.mock.calls[0][1]).toMatchObject({ standId: null, aircraftTypeId: null,
      departureScheduledAt: '2026-11-05T20:00:00.000Z' });
  });

  it('cancels with the reason it requires', async () => {
    const { onChanged } = renderDialog('cancel');
    const reason = await screen.findByLabelText('Motivo');

    await userEvent.type(reason, 'No');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 5 y 500 caracteres');
    expect(changeTurnaroundStatus).not.toHaveBeenCalled();

    await userEvent.clear(reason);
    await userEvent.type(reason, 'La aerolínea canceló el vuelo.');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    await waitFor(() => expect(changeTurnaroundStatus).toHaveBeenCalledWith(turnaroundId,
      { outcome: 'Cancelled', reason: 'La aerolínea canceló el vuelo.' },
      { ifMatch: '"v1"', idempotencyKey: expect.any(String) }));
    expect(onChanged).toHaveBeenCalledWith('cancel', 'PUJ-20261105-001');
    expect(getManualTurnaroundOptions).not.toHaveBeenCalled();
  });

  it('marks the flight diverted', async () => {
    const { onChanged } = renderDialog('divert');
    await userEvent.type(await screen.findByLabelText('Motivo'), 'El vuelo se desvió a Santo Domingo.');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar desvío' }));

    await waitFor(() => expect(changeTurnaroundStatus.mock.calls[0][1]).toEqual(
      { outcome: 'Diverted', reason: 'El vuelo se desvió a Santo Domingo.' }));
    expect(onChanged).toHaveBeenCalledWith('divert', 'PUJ-20261105-001');
  });

  it('explains a flight whose operation started and offers nothing to send', async () => {
    vi.mocked(getTurnaround).mockResolvedValue(detail('v1', { allowedActions: ['correctArrival'] }));
    renderDialog('cancel');

    expect(await screen.findByText(/su operación inició o el vuelo está cerrado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar cancelación' })).toBeDisabled();
  });

  it('explains the stand and the agent rules the new schedule breaks', async () => {
    vi.mocked(rescheduleTurnaround)
      .mockRejectedValueOnce(problem(409, 'stand_unavailable', ['stand_taken']))
      .mockRejectedValueOnce(problem(409, 'assigned_agent_unavailable', ['shift_not_covering']));
    renderDialog('reschedule');
    await screen.findByLabelText('Llegada programada (hora local de PUJ)');
    await userEvent.type(screen.getByLabelText('Motivo'), 'La aerolínea retrasó el vuelo.');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La posición no está disponible para ese horario. (Otro vuelo ocupa esa posición en ese horario.)');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('su turno no cubre el nuevo horario'));
  });

  it('re-reads the flight after a stale version and sends the next attempt with the new ETag', async () => {
    vi.mocked(getTurnaround).mockResolvedValueOnce(detail('v1')).mockResolvedValueOnce(detail('v2'));
    vi.mocked(changeTurnaroundStatus)
      .mockRejectedValueOnce(problem(412, 'version_conflict'))
      .mockResolvedValueOnce(detail('v3', { allowedActions: [] }));
    renderDialog('divert');
    await userEvent.type(await screen.findByLabelText('Motivo'), 'El vuelo se desvió a Santo Domingo.');

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar desvío' }));
    expect(await screen.findByText(/Se actualizó la versión del vuelo/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('El vuelo cambió mientras lo revisaba');
    await waitFor(() => expect(getTurnaround).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desvío' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar desvío' }));
    await waitFor(() => expect(changeTurnaroundStatus).toHaveBeenCalledTimes(2));
    expect(changeTurnaroundStatus.mock.calls[1][2].ifMatch).toBe('"v2"');
  });

  it('offers to read the flight again when it could not be read, and explains a missing permission', async () => {
    vi.mocked(getTurnaround).mockRejectedValueOnce(problem(503, undefined)).mockResolvedValueOnce(detail());
    const { unmount } = render(<TurnaroundChangeDialog turnaroundId={turnaroundId} mode="cancel" onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible consultar el vuelo.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Motivo')).toBeInTheDocument();
    unmount();

    vi.mocked(getTurnaround).mockRejectedValueOnce(problem(403, 'forbidden'));
    renderDialog('cancel');
    expect(await screen.findByRole('alert')).toHaveTextContent('Su acceso no permite cambiar este vuelo.');
    expect(screen.queryByLabelText('Motivo')).not.toBeInTheDocument();
  });

  it('closes with Escape', async () => {
    const { onClose } = renderDialog('cancel');
    await screen.findByLabelText('Motivo');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
