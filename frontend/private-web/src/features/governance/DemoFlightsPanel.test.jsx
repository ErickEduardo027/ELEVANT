import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoFlightsPanel from './DemoFlightsPanel';
import {
  cancelDemoFlight, createDemoFlight, DEMO_FLIGHT_MESSAGES, listDemoFlights, loadDemoFlightOptions,
} from '../../services/demoFlightsService';

vi.mock('../../services/demoFlightsService', async importOriginal => ({
  ...(await importOriginal()),
  loadDemoFlightOptions: vi.fn(), listDemoFlights: vi.fn(), createDemoFlight: vi.fn(), cancelDemoFlight: vi.fn(),
}));

const STATION = '20000000-0000-7000-8000-000000000003';
const OTHER_STATION = '20000000-0000-7000-8000-000000000004';
const AIRLINE = '30000000-0000-7000-8000-000000000001';
const A320 = '40000000-0000-7000-8000-000000000001';
const B77W = '40000000-0000-7000-8000-000000000002';
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SERVER_TITLE = 'The demo flight cannot be created or changed.';
const at = iso => Date.parse(iso);
const iso = ms => new Date(ms).toISOString();

const LIMITS = { minMinutesToOnBlock: 2, maxMinutesToOnBlock: 30, defaultMinutesToOnBlock: 8, minGroundMinutes: 20,
  maxGroundMinutes: 240, defaultGroundMinutes: 60, maxActive: 3, active: 0 };
const options = (extra = {}) => ({ enabled: true, serverTime: '2026-11-12T14:00:00+00:00',
  stations: [{ id: STATION, code: 'PUJ', name: 'Punta Cana' }], stationId: STATION, operationDate: '2026-11-12',
  airlines: [{ id: AIRLINE, name: 'Demo Airlines', iataCode: 'ZZ', icaoCode: 'DZZ' }],
  // Bogotá comes first, but Miami is the default origin; the wide-body comes first, but a narrow-body is the default.
  airports: [{ iataCode: 'BOG', icaoCode: 'SKBO', name: 'El Dorado', city: 'Bogotá', countryCode: 'CO' },
    { iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International Airport', city: 'Miami', countryCode: 'US' }],
  aircraftTypes: [{ id: B77W, icaoCode: 'B77W', manufacturer: 'Boeing', model: '777-300ER', sizeCategory: 'Widebody' },
    { id: A320, icaoCode: 'A320', manufacturer: 'Airbus', model: 'A320', sizeCategory: 'Narrowbody' }],
  stands: [{ standId: 's-a10', code: 'A10', terminalCode: 'A', free: true }, { standId: 's-a2', code: 'A2', terminalCode: 'A', free: true },
    { standId: 's-a1', code: 'A1', terminalCode: 'A', free: false }, { standId: 's-b20', code: 'B20', terminalCode: 'B', free: true }],
  limits: LIMITS, warnings: [], ...extra });
const DISABLED_OPTIONS = { enabled: false, serverTime: '2026-11-12T14:00:00+00:00', stations: [], stationId: null,
  operationDate: null, airlines: [], airports: [], aircraftTypes: [], stands: [], limits: LIMITS, warnings: [] };

// Triggered at 10:00 in Punta Cana (14:00Z) to park in 8 minutes: the wheels touch the runway at 10:04:24.
const flight = (extra = {}) => ({ id: '70000000-0000-7000-8000-000000000001', stationId: STATION, stationCode: 'PUJ',
  airlineId: AIRLINE, airlineName: 'Demo Airlines', arrivalFlightNumber: 'ZZ9001', departureFlightNumber: 'ZZ9002',
  aircraftRegistration: 'HIDM01', aircraftModel: 'Airbus A320', originIata: 'MIA', destinationIata: 'MIA',
  suggestedStandCode: null, state: 'Active', phase: 'Approach', appearAt: '2026-11-12T14:00:00+00:00',
  touchdownAt: '2026-11-12T14:04:24+00:00', onBlockAt: '2026-11-12T14:08:00+00:00',
  scheduledOffBlockAt: '2026-11-12T15:08:00+00:00', offBlockAt: '2026-11-12T15:08:00+00:00',
  takeoffAt: '2026-11-12T15:13:00+00:00', vanishAt: '2026-11-12T15:23:00+00:00', imported: false, turnaroundId: null,
  operationCode: null, standCode: null, operationStatus: null, ...extra });
const imported = (extra = {}) => flight({ id: '70000000-0000-7000-8000-000000000002', arrivalFlightNumber: 'ZZ9003',
  departureFlightNumber: 'ZZ9004', imported: true, turnaroundId: '80000000-0000-7000-8000-000000000001',
  operationCode: 'PUJ-20261112-003', standCode: 'B22', operationStatus: 'Assigned', offBlockAt: null, takeoffAt: null,
  vanishAt: null, ...extra });
const list = (flights, serverTime = '2026-11-12T14:01:00+00:00') => ({ enabled: true, serverTime, stationId: STATION, flights });
const problem = (status, code) => Object.assign(new Error(SERVER_TITLE), { status, code, title: SERVER_TITLE });

/** The browser's clock, which the panel reads through `now`; it agrees with the server's unless a test moves it. */
let clock;
const now = () => clock;
/** Polls far apart unless a test is about them, so the counts below are the panel's own reads. */
const renderPanel = (props = {}) => render(<DemoFlightsPanel now={now} fastPollMs={600_000} slowPollMs={600_000} {...props} />);
const form = () => screen.getByRole('form', { name: 'Disparar vuelo demo' });
const flights = () => screen.getByRole('list', { name: 'Vuelos demo de hoy' });

beforeEach(() => {
  clock = at('2026-11-12T14:01:00Z');
  loadDemoFlightOptions.mockResolvedValue(options());
  listDemoFlights.mockResolvedValue(list([]));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  delete document.visibilityState;
});

describe('DemoFlightsPanel (ADR-0041)', () => {
  it('shows that demo flights are off in this environment and offers nothing', async () => {
    loadDemoFlightOptions.mockResolvedValue(DISABLED_OPTIONS);
    listDemoFlights.mockResolvedValue({ enabled: false, serverTime: '2026-11-12T14:00:00+00:00', stationId: null, flights: [] });
    renderPanel();

    expect(await screen.findByText('Los vuelos demo solo funcionan en el entorno de desarrollo. Aquí están apagados.'))
      .toBeInTheDocument();
    expect(screen.getByText('No disponible en este entorno')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Vuelos demo de hoy')).not.toBeInTheDocument();
  });

  it('triggers a demo flight with the defaults and its Idempotency-Key and says when it parks', async () => {
    createDemoFlight.mockResolvedValue(flight());
    renderPanel();

    expect(await screen.findByText('Disponible en este entorno')).toBeInTheDocument();
    expect(within(form()).getByLabelText('Origen')).toHaveValue('MIA');
    expect(within(form()).getByLabelText('Destino de la salida')).toHaveValue('');
    expect(within(form()).getByRole('option', { name: 'El mismo aeropuerto' })).toBeInTheDocument();
    expect(within(form()).getByLabelText('Tipo de avión')).toHaveValue(A320);
    expect(within(form()).getByLabelText('Posición')).toHaveValue('');
    expect(within(form()).getByLabelText('Llega a la posición en (minutos)')).toHaveValue(8);
    expect(within(form()).getByLabelText('Tiempo en tierra (minutos)')).toHaveValue(60);
    expect(within(form()).getByRole('button', { name: '8 min' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form()).getByText(/Solo aerolíneas con contrato vigente hoy en la estación/)).toBeInTheDocument();

    await userEvent.click(within(form()).getByRole('button', { name: 'Disparar vuelo demo' }));
    expect(createDemoFlight).toHaveBeenCalledWith({ stationId: STATION, airlineId: AIRLINE, originIata: 'MIA',
      destinationIata: null, aircraftTypeId: A320, standChoice: 'None', standId: null, minutesToOnBlock: 8, groundMinutes: 60 },
    expect.stringMatching(KEY));
    expect(await within(form()).findByRole('status')).toHaveTextContent(
      'Vuelo demo ZZ9001 / ZZ9002 creado. Llega a la posición a las 10:08. OCC ya lo ve en los vuelos propuestos.');
    // The new flight is read with the options it changed.
    await waitFor(() => expect(listDemoFlights).toHaveBeenCalledTimes(2));
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);

    // A quick choice, another destination and a stand are a new intent with a new key.
    await userEvent.click(within(form()).getByRole('button', { name: '3 min' }));
    await userEvent.selectOptions(within(form()).getByLabelText('Destino de la salida'), 'BOG');
    await userEvent.selectOptions(within(form()).getByLabelText('Posición'), 's-a2');
    await userEvent.click(within(form()).getByRole('button', { name: 'Disparar vuelo demo' }));
    expect(createDemoFlight).toHaveBeenLastCalledWith(expect.objectContaining({ destinationIata: 'BOG', standChoice: 'Specific',
      standId: 's-a2', minutesToOnBlock: 3 }), expect.stringMatching(KEY));
    const [first, second] = createDemoFlight.mock.calls;
    expect(second[1]).not.toBe(first[1]);
  });

  it('keeps the same key when the answer never arrived and sends a new one after a refusal', async () => {
    createDemoFlight.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(problem(409, 'contract_not_in_force'))
      .mockResolvedValueOnce(flight());
    renderPanel();
    const trigger = await screen.findByRole('button', { name: 'Disparar vuelo demo' });

    await userEvent.click(trigger);
    expect(await within(form()).findByRole('alert')).toHaveTextContent(
      'No se pudo completar la acción. Revise la conexión e intente de nuevo.');
    await userEvent.click(trigger);
    expect(await within(form()).findByText('La aerolínea no tiene contrato vigente hoy en la estación.')).toBeInTheDocument();
    await userEvent.click(trigger);
    await within(form()).findByText(/Vuelo demo ZZ9001 \/ ZZ9002 creado/);

    const [uncertain, retried, afterRefusal] = createDemoFlight.mock.calls;
    // The retry of an uncertain answer is the same intent: same body, same key; a refusal settled it.
    expect(retried).toEqual(uncertain);
    expect(afterRefusal[0]).toEqual(uncertain[0]);
    expect(afterRefusal[1]).not.toBe(uncertain[1]);
  });

  it('explains each refusal by its code and never shows the server title', async () => {
    renderPanel();
    const trigger = await screen.findByRole('button', { name: 'Disparar vuelo demo' });
    const cases = [[409, 'stand_unavailable', true], [409, 'demo_flight_limit_reached', true], [409, 'demo_origin_unknown', true],
      [404, 'station_unavailable', true], [403, 'forbidden', false], [400, 'invalid_demo_flight', false]];
    for (const [status, code, rereads] of cases) {
      const reads = [loadDemoFlightOptions.mock.calls.length, listDemoFlights.mock.calls.length];
      createDemoFlight.mockRejectedValueOnce(problem(status, code));
      await userEvent.click(trigger);
      await waitFor(() => expect(within(form()).getByRole('alert')).toHaveTextContent(DEMO_FLIGHT_MESSAGES[code]));
      expect(within(form()).getByRole('alert')).not.toHaveTextContent(SERVER_TITLE);
      // A 409 or a 404 reads the options and the list again before the message shows.
      expect([loadDemoFlightOptions.mock.calls.length > reads[0], listDemoFlights.mock.calls.length > reads[1]])
        .toEqual([rereads, rereads]);
    }
    expect(screen.queryByText(SERVER_TITLE)).not.toBeInTheDocument();
  });

  it('computes the phase locally and switches «Cancelar vuelo» to «Terminar demo» after touchdown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    clock = at('2026-11-12T14:04:00Z');
    listDemoFlights.mockResolvedValue(list([flight()], '2026-11-12T14:04:00+00:00'));
    renderPanel();

    const row = await within(await screen.findByRole('list', { name: 'Vuelos demo de hoy' })).findByRole('listitem');
    expect(row).toHaveTextContent('ZZ9001 / ZZ9002 · Demo Airlines · MIA → PUJ → MIA · HIDM01');
    expect(within(row).getByText('Demo')).toBeInTheDocument();
    expect(row).toHaveTextContent('En aproximación');
    expect(row).toHaveTextContent('Llega a la posición en 4 min');
    expect(row).toHaveTextContent('OCC aún no lo importa');
    expect(within(row).getByRole('button', { name: 'Cancelar vuelo' })).toBeInTheDocument();

    // No read in between: the browser follows the server's instants.
    clock = at('2026-11-12T14:04:30Z');
    act(() => vi.advanceTimersByTime(1000));
    expect(row).toHaveTextContent('Aterrizó, rueda a la posición');
    expect(row).toHaveTextContent('Llega a la posición en 3 min 30 s');
    expect(within(row).queryByRole('button', { name: 'Cancelar vuelo' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Terminar demo' })).toBeInTheDocument();
    clock = at('2026-11-12T14:09:00Z');
    act(() => vi.advanceTimersByTime(1000));
    expect(row).toHaveTextContent('En posición');
    expect(row).toHaveTextContent('En posición desde las 10:08 · Sale a las 11:08');
    clock = at('2026-11-12T15:09:00Z');
    act(() => vi.advanceTimersByTime(1000));
    expect(row).toHaveTextContent('Saliendo');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(listDemoFlights).toHaveBeenCalledTimes(1);
  });

  it('follows the server clock, not the browser one', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // This browser runs 2 minutes behind: for the server the aircraft already landed.
    clock = at('2026-11-12T14:03:00Z');
    listDemoFlights.mockResolvedValue(list([flight({ phase: 'TaxiIn' })], '2026-11-12T14:05:00+00:00'));
    renderPanel();
    const row = await within(await screen.findByRole('list', { name: 'Vuelos demo de hoy' })).findByRole('listitem');
    expect(row).toHaveTextContent('Aterrizó, rueda a la posición');
    expect(row).toHaveTextContent('Llega a la posición en 3 min');
  });

  it('confirms before cancelling or finishing and re-reads after a conflict', async () => {
    listDemoFlights.mockResolvedValue(list([flight(), imported({ touchdownAt: '2026-11-12T14:00:30+00:00',
      onBlockAt: '2026-11-12T14:00:50+00:00' })]));
    cancelDemoFlight.mockRejectedValueOnce(problem(409, 'version_conflict'))
      .mockResolvedValueOnce(imported({ offBlockAt: '2026-11-12T14:01:00+00:00', takeoffAt: '2026-11-12T14:06:00+00:00',
        vanishAt: '2026-11-12T14:16:00+00:00' }));
    renderPanel();
    const [approaching, parked] = within(await screen.findByRole('list', { name: 'Vuelos demo de hoy' })).getAllByRole('listitem');
    expect(parked).toHaveTextContent('Importado por OCC · PUJ-20261112-003 · Posición B22 · Operación asignada');

    // «Volver» keeps the flight as it is.
    await userEvent.click(within(approaching).getByRole('button', { name: 'Cancelar vuelo' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Cancelar vuelo demo' });
    expect(dialog).toHaveTextContent('El vuelo ZZ9001 saldrá de los vuelos propuestos de OCC.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cancelDemoFlight).not.toHaveBeenCalled();

    // The aircraft landed meanwhile: the server refuses the cancel, and the panel reads again before it explains.
    const reads = listDemoFlights.mock.calls.length;
    await userEvent.click(within(approaching).getByRole('button', { name: 'Cancelar vuelo' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar vuelo' }));
    expect(cancelDemoFlight).toHaveBeenCalledWith(flight().id, 'Cancel', expect.stringMatching(KEY));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El vuelo demo cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.');
    expect(alert).not.toHaveTextContent(SERVER_TITLE);
    expect(listDemoFlights.mock.calls.length).toBeGreaterThan(reads);

    await userEvent.click(within(parked).getByRole('button', { name: 'Terminar demo' }));
    dialog = screen.getByRole('alertdialog', { name: 'Terminar demo' });
    expect(dialog).toHaveTextContent('El avión saldrá ahora de la posición. La operación de OCC sigue su curso.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Terminar demo' }));
    expect(cancelDemoFlight).toHaveBeenLastCalledWith(imported().id, 'Finish', expect.stringMatching(KEY));
    expect(await screen.findByText('Demo ZZ9003 / ZZ9004 terminada: el avión sale de la posición.')).toBeInTheDocument();
    const [refused, finished] = cancelDemoFlight.mock.calls;
    expect(finished[2]).not.toBe(refused[2]);
  });

  it('says OCC already imported the flight before cancelling it', async () => {
    listDemoFlights.mockResolvedValue(list([imported()]));
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar vuelo' }));
    expect(screen.getByRole('alertdialog', { name: 'Cancelar vuelo demo' })).toHaveTextContent(
      'OCC ya importó este vuelo. Recibirá el aviso de vuelo cancelado por el proveedor y decidirá qué hacer con la escala.');
  });

  it('says a flight nobody imported still reaches its stand before «Terminar demo» sends it off', async () => {
    // At 14:01 the first aircraft taxies to its stand (on-block 14:08) and the second one has been parked since 14:00:50.
    listDemoFlights.mockResolvedValue(list([flight({ touchdownAt: '2026-11-12T14:00:30+00:00' }),
      flight({ id: '70000000-0000-7000-8000-000000000003', arrivalFlightNumber: 'ZZ9005', departureFlightNumber: 'ZZ9006',
        touchdownAt: '2026-11-12T14:00:20+00:00', onBlockAt: '2026-11-12T14:00:50+00:00' })]));
    renderPanel();
    const [taxiing, parked] = within(await screen.findByRole('list', { name: 'Vuelos demo de hoy' })).getAllByRole('listitem');
    expect(taxiing).toHaveTextContent('Aterrizó, rueda a la posición');
    expect(parked).toHaveTextContent('En posición desde las 10:00');

    await userEvent.click(within(taxiing).getByRole('button', { name: 'Terminar demo' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Terminar demo' });
    expect(dialog).toHaveTextContent(
      'El avión saldrá de la posición en cuanto llegue a ella. El vuelo ZZ9001 dejará los vuelos propuestos de OCC.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Volver' }));

    await userEvent.click(within(parked).getByRole('button', { name: 'Terminar demo' }));
    dialog = screen.getByRole('alertdialog', { name: 'Terminar demo' });
    expect(dialog).toHaveTextContent('El avión saldrá ahora de la posición. El vuelo ZZ9005 dejará los vuelos propuestos de OCC.');
    expect(cancelDemoFlight).not.toHaveBeenCalled();
  });

  it('shows the loading, empty, unauthorized and recoverable error states', async () => {
    let answer;
    loadDemoFlightOptions.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const view = renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando vuelos demo…');
    await act(async () => answer(options()));
    expect(await screen.findByText('Aún no hay vuelos demo hoy.')).toBeInTheDocument();
    view.unmount();

    loadDemoFlightOptions.mockRejectedValueOnce(problem(403, 'forbidden'));
    const forbidden = renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo el superadministrador dispara vuelos demo.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    forbidden.unmount();

    listDemoFlights.mockRejectedValueOnce(Object.assign(new Error('Internal'), { status: 503 }));
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la acción. Revise la conexión e intente de nuevo.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('form', { name: 'Disparar vuelo demo' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the trigger without an airline, without an aircraft type or at the limit', async () => {
    loadDemoFlightOptions.mockResolvedValueOnce(options({ airlines: [] }));
    const noAirline = renderPanel();
    expect(await screen.findByText(/Ninguna aerolínea tiene contrato vigente hoy en esta estación/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disparar vuelo demo' })).toBeDisabled();
    noAirline.unmount();

    loadDemoFlightOptions.mockResolvedValueOnce(options({ aircraftTypes: [] }));
    const noType = renderPanel();
    expect(await screen.findByText('No hay tipos de avión activos. OCC los crea en «Datos maestros».')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disparar vuelo demo' })).toBeDisabled();
    noType.unmount();

    const three = [flight(), flight({ id: '70000000-0000-7000-8000-000000000005' }),
      flight({ id: '70000000-0000-7000-8000-000000000006' })];
    loadDemoFlightOptions.mockResolvedValue(options({ limits: { ...LIMITS, active: 3 } }));
    listDemoFlights.mockResolvedValue(list(three));
    renderPanel();
    expect(await screen.findByText('Ya hay 3 vuelos demo activos en esta estación. Espere a que termine uno o cancélelo.'))
      .toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Disparar vuelo demo' });
    expect(trigger).toBeDisabled();
    fireEvent.submit(form());
    expect(createDemoFlight).not.toHaveBeenCalled();
  });

  it('warns when no OCC account is in scope or the arrival crosses local midnight', async () => {
    loadDemoFlightOptions.mockResolvedValue(options({ warnings: [{ code: 'no_occ_accounts', reasons: [] },
      { code: 'crosses_local_midnight', reasons: [] }, { code: 'no_eligible_stand', reasons: ['no_shift'] }] }));
    createDemoFlight.mockResolvedValue(flight());
    renderPanel();

    expect(await screen.findByText('Ninguna cuenta de OCC tiene esta estación en su alcance: nadie verá el vuelo.'))
      .toBeInTheDocument();
    expect(screen.getByText(
      'Falta poco para la medianoche en la estación: si el avión llega después, el vuelo queda en la planificación de mañana.'))
      .toBeInTheDocument();
    // The warnings never block, and a code this panel does not know yet is not shown raw.
    expect(screen.queryByText(/no_eligible_stand/)).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Disparar vuelo demo' });
    expect(trigger).toBeEnabled();
    await userEvent.click(trigger);
    const created = await within(form()).findByRole('status');
    expect(created).toHaveTextContent('Vuelo demo ZZ9001 / ZZ9002 creado. Llega a la posición a las 10:08.');
    expect(created).not.toHaveTextContent('OCC ya lo ve');
  });

  it('offers «Sin posición» and only free stands', async () => {
    renderPanel();
    const stand = await within(await screen.findByRole('form', { name: 'Disparar vuelo demo' })).findByLabelText('Posición');
    expect(within(stand).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Sin posición', 'A2 · Terminal A', 'A10 · Terminal A', 'B20 · Terminal B']);
  });

  it('reads the options and the list again for another station', async () => {
    loadDemoFlightOptions.mockImplementation(async station => options(station === OTHER_STATION
      ? { stationId: OTHER_STATION, stations: [{ id: STATION, code: 'PUJ', name: 'Punta Cana' },
        { id: OTHER_STATION, code: 'SDQ', name: 'Santo Domingo' }], airlines: [] }
      : { stations: [{ id: STATION, code: 'PUJ', name: 'Punta Cana' }, { id: OTHER_STATION, code: 'SDQ', name: 'Santo Domingo' }] }));
    renderPanel();
    await userEvent.selectOptions(await screen.findByLabelText('Estación'), OTHER_STATION);
    expect(await screen.findByText(/Ninguna aerolínea tiene contrato vigente hoy en esta estación/)).toBeInTheDocument();
    expect(loadDemoFlightOptions).toHaveBeenLastCalledWith(OTHER_STATION, expect.anything());
    expect(listDemoFlights).toHaveBeenLastCalledWith(OTHER_STATION, expect.anything());
    expect(screen.getByLabelText('Estación')).toHaveValue(OTHER_STATION);
  });

  it('polls every 5 s while an aircraft moves, every 20 s otherwise, and pauses while the tab is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    // Each read answers with the server time of the moment it is made: on approach until 10:04:24.
    loadDemoFlightOptions.mockResolvedValue(options({ limits: { ...LIMITS, active: 1 } }));
    listDemoFlights.mockImplementation(async () => list([flight()], iso(clock)));
    const advance = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    render(<DemoFlightsPanel now={now} />);
    await advance(0);
    expect(listDemoFlights).toHaveBeenCalledTimes(1);

    await advance(4999);
    expect(listDemoFlights).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(listDemoFlights).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(listDemoFlights).toHaveBeenCalledTimes(3);

    // Parked: nothing moves, so the list is read every 20 s.
    clock = at('2026-11-12T14:09:00Z');
    await advance(1000);
    await advance(19_999);
    expect(listDemoFlights).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(listDemoFlights).toHaveBeenCalledTimes(4);

    // Hidden, nothing is read; back in sight, the list is read at once and the polling resumes.
    visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(60_000);
    expect(listDemoFlights).toHaveBeenCalledTimes(4);
    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(listDemoFlights).toHaveBeenCalledTimes(5);
    await advance(20_000);
    expect(listDemoFlights).toHaveBeenCalledTimes(6);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(1);
  });
});
