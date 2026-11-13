import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isDemoStationLayout } from '@elevant/api-client';
import DemoFlightsPanel from './DemoFlightsPanel';
import {
  cancelDemoFlight, createDemoFlight, DEMO_FLIGHT_MESSAGES, DEMO_STATION_MESSAGES, listDemoFlights, loadDemoFlightOptions,
  prepareDemoStation,
} from '../../services/demoFlightsService';

vi.mock('../../services/demoFlightsService', async importOriginal => ({
  ...(await importOriginal()),
  loadDemoFlightOptions: vi.fn(), listDemoFlights: vi.fn(), createDemoFlight: vi.fn(), cancelDemoFlight: vi.fn(),
  prepareDemoStation: vi.fn(),
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
/**
 * A stand for the visit the options were read for (EfDemoFlightStore): by default located, free and covered at the
 * on-block instant by an agent who passes OCC's rule, so it is eligible.
 */
const stand = (standId, code, terminalCode, extra = {}) => ({ standId, code, terminalCode, located: true, free: true,
  coveredBy: ['Riley Ramp'], eligibleAgents: 1, eligible: true, reasons: [], ...extra });
const range = (prefix, first, last) => Array.from({ length: last - first + 1 }, (_, index) => `${prefix}${first + index}`);
/** The 41 stands of the Punta Cana catalogue (no B33). */
const CATALOGUE = [...range('A', 1, 11), ...range('AN', 1, 5), ...range('B', 20, 32), ...range('B', 34, 37),
  ...range('BN', 6, 13)];
/**
 * A station against the Punta Cana catalogue, as the options carry it: Punta Cana as the seed leaves it (A01 and A02
 * are the catalogue's A1 and A2, B01 and B02 are outside it), and any other station without a catalogue.
 */
const layoutOf = stationId => (stationId === STATION
  ? { stationId, stationCode: 'PUJ', supported: true, catalogTerminals: 3, terminals: 2, catalogStands: 41, stands: 2,
    activeStands: 4, locatedStands: 2, missingStands: CATALOGUE.slice(2), unmatchedStands: ['B01', 'B02'], complete: false }
  : { stationId, stationCode: 'SDQ', supported: false, catalogTerminals: 0, terminals: 0, catalogStands: 0, stands: 0,
    activeStands: 0, locatedStands: 0, missingStands: [], unmatchedStands: [], complete: false });
const options = (extra = {}) => {
  const data = { enabled: true, serverTime: '2026-11-12T14:00:00+00:00',
    stations: [{ id: STATION, code: 'PUJ', name: 'Punta Cana' }], stationId: STATION, operationDate: '2026-11-12',
    airlines: [{ id: AIRLINE, name: 'Demo Airlines', iataCode: 'ZZ', icaoCode: 'DZZ' }],
    // Bogotá comes first, but Miami is the default origin; the wide-body comes first, but a narrow-body is the default.
    airports: [{ iataCode: 'BOG', icaoCode: 'SKBO', name: 'El Dorado', city: 'Bogotá', countryCode: 'CO' },
      { iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International Airport', city: 'Miami', countryCode: 'US' }],
    aircraftTypes: [{ id: B77W, icaoCode: 'B77W', manufacturer: 'Boeing', model: '777-300ER', sizeCategory: 'Widebody' },
      { id: A320, icaoCode: 'A320', manufacturer: 'Airbus', model: 'A320', sizeCategory: 'Narrowbody' }],
    // A1 is taken during the visit; nobody covers B20 when the aircraft parks.
    stands: [stand('s-a10', 'A10', 'A'), stand('s-a2', 'A2', 'A'),
      stand('s-a1', 'A1', 'A', { free: false, eligible: false }),
      stand('s-b20', 'B20', 'B', { coveredBy: [], eligibleAgents: 0, eligible: false, reasons: ['stand_not_covered'] })],
    limits: LIMITS, warnings: [], ...extra };
  return { ...data, layout: Object.hasOwn(extra, 'layout') ? extra.layout : layoutOf(data.stationId) };
};
/** Punta Cana once «Cargar posiciones» created what it lacked: the seeded B01 and B02 stay outside the catalogue. */
const LOADED = { ...layoutOf(STATION), terminals: 3, stands: 41, activeStands: 43, locatedStands: 41, missingStands: [],
  complete: true };
/** Punta Cana loaded while OCC keeps the FBO terminal inactive: its eight stands cannot be created. */
const FBO_INACTIVE = { ...layoutOf(STATION), terminals: 2, stands: 33, activeStands: 35, locatedStands: 33,
  missingStands: range('BN', 6, 13) };
/** Every stand taken or uncovered when the aircraft parks: «Al azar» has nothing to draw. */
const nobodyEligible = (extra = {}) => options({
  stands: [stand('s-a2', 'A2', 'A', { coveredBy: [], eligibleAgents: 0, eligible: false, reasons: ['stand_not_covered'] }),
    stand('s-b20', 'B20', 'B', { eligibleAgents: 0, eligible: false, reasons: ['shift_not_compatible'] })],
  warnings: [{ code: 'no_eligible_stand', reasons: ['stand_not_covered', 'shift_not_compatible'] }], ...extra });
const NO_ELIGIBLE_WARNING =
  'Ninguna posición habilitada tiene un agente elegible a esa hora: nadie la cubre a esa hora y turno no compatible.';
const DISABLED_OPTIONS = { enabled: false, serverTime: '2026-11-12T14:00:00+00:00', stations: [], stationId: null,
  operationDate: null, airlines: [], airports: [], aircraftTypes: [], stands: [], limits: LIMITS, warnings: [],
  layout: null };
const MIDNIGHT_WARNING =
  'Falta poco para la medianoche en la estación: si el avión llega después, el vuelo queda en la planificación de mañana.';
/** The day of an instant in Punta Cana (America/Santo_Domingo, UTC−4 all year). */
const puntaCanaDay = ms => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
/**
 * The options as the server answers them at `ms` (EfDemoFlightStore.OptionsAsync): from 23:30 in Punta Cana the latest
 * arrival it allows parks after midnight, so it warns crosses_local_midnight.
 */
const optionsAt = ms => options({ serverTime: iso(ms), operationDate: puntaCanaDay(ms),
  warnings: puntaCanaDay(ms + LIMITS.maxMinutesToOnBlock * 60_000) === puntaCanaDay(ms) ? []
    : [{ code: 'crosses_local_midnight', reasons: [] }] });

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
/**
 * Polls and the re-read for the form's window far apart unless a test is about them, so the counts below are the
 * panel's own reads.
 */
const renderPanel = (props = {}) => render(<DemoFlightsPanel now={now} fastPollMs={600_000} slowPollMs={600_000}
  windowDelayMs={600_000} {...props} />);
const form = () => screen.getByRole('form', { name: 'Disparar vuelo demo' });
const flights = () => screen.getByRole('list', { name: 'Vuelos demo de hoy' });
const standsCard = () => screen.findByRole('region', { name: 'Posiciones de Punta Cana' });
const standField = () => within(form()).getByLabelText('Posición');
/** The options of the field «Posición»: their text and whether they can be chosen. */
const offered = () => within(standField()).getAllByRole('option').map(option => [option.textContent, !option.disabled]);
/** The tab goes to the background and comes back, as when OCC opens in another tab and the superadministrator returns. */
async function leaveAndReturn() {
  let visibility = 'hidden';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  visibility = 'visible';
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
}

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
    expect(standField()).toHaveDisplayValue('Al azar');
    expect(within(form()).getByLabelText('Llega a la posición en (minutos)')).toHaveValue(8);
    expect(within(form()).getByLabelText('Tiempo en tierra (minutos)')).toHaveValue(60);
    expect(within(form()).getByRole('button', { name: '8 min' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form()).getByText(/Solo aerolíneas con contrato vigente hoy en la estación/)).toBeInTheDocument();

    await userEvent.click(within(form()).getByRole('button', { name: 'Disparar vuelo demo' }));
    expect(createDemoFlight).toHaveBeenCalledWith({ stationId: STATION, airlineId: AIRLINE, originIata: 'MIA',
      destinationIata: null, aircraftTypeId: A320, standChoice: 'Random', standId: null, minutesToOnBlock: 8,
      groundMinutes: 60 }, expect.stringMatching(KEY));
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
      { code: 'crosses_local_midnight', reasons: [] }, { code: 'no_agents_on_shift', reasons: ['no_shift'] }] }));
    createDemoFlight.mockResolvedValue(flight());
    renderPanel();

    expect(await screen.findByText('Ninguna cuenta de OCC tiene esta estación en su alcance: nadie verá el vuelo.'))
      .toBeInTheDocument();
    expect(screen.getByText(
      'Falta poco para la medianoche en la estación: si el avión llega después, el vuelo queda en la planificación de mañana.'))
      .toBeInTheDocument();
    // The warnings never block, and a code this panel does not know yet is not shown raw.
    expect(screen.queryByText(/no_agents_on_shift|no_shift/)).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Disparar vuelo demo' });
    expect(trigger).toBeEnabled();
    await userEvent.click(trigger);
    const created = await within(form()).findByRole('status');
    expect(created).toHaveTextContent('Vuelo demo ZZ9001 / ZZ9002 creado. Llega a la posición a las 10:08.');
    expect(created).not.toHaveTextContent('OCC ya lo ve');
  });

  it('shows the Punta Cana card with its counts and loads the missing stands with its key', async () => {
    let answer;
    prepareDemoStation.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    renderPanel();
    // Punta Cana as the seed leaves it: terminals A and B, A01 and A02 in the catalogue, B01 and B02 outside it.
    const card = await standsCard();
    expect(card).toHaveTextContent('Terminales: 2 de 3 · Posiciones: 2 de 41 · Ubicadas en el mapa: 2 de 4');
    expect(card).toHaveTextContent(
      'Crea las terminales y las posiciones de Punta Cana que falten. No cambia ni borra lo que OCC ya configuró.');

    // No answer: the retry is the same intent, with the same key.
    await userEvent.click(within(card).getByRole('button', { name: 'Cargar posiciones' }));
    expect(await within(card).findByRole('alert'))
      .toHaveTextContent('No se pudo completar la acción. Revise la conexión e intente de nuevo.');
    await userEvent.click(within(card).getByRole('button', { name: 'Cargar posiciones' }));
    expect(within(card).getByRole('button', { name: 'Cargando posiciones…' })).toBeDisabled();
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
    const [uncertain, retried] = prepareDemoStation.mock.calls;
    expect(uncertain).toEqual([STATION, expect.stringMatching(KEY)]);
    expect(retried).toEqual(uncertain);

    loadDemoFlightOptions.mockResolvedValue(options({ layout: LOADED }));
    await act(async () => answer(LOADED));
    expect(await within(card).findByRole('status')).toHaveTextContent('Se cargaron las posiciones de Punta Cana.');
    expect(card).toHaveTextContent('Terminales: 3 de 3 · Posiciones: 41 de 41 · Ubicadas en el mapa: 41 de 43');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(prepareDemoStation).toHaveBeenCalledTimes(2);
  });

  it('says everything is loaded and offers no button when the layout is complete', async () => {
    expect(isDemoStationLayout(LOADED, STATION)).toBe(true);
    loadDemoFlightOptions.mockResolvedValue(options({ layout: LOADED }));
    renderPanel();
    const card = await standsCard();
    expect(card).toHaveTextContent('Terminales: 3 de 3 · Posiciones: 41 de 41 · Ubicadas en el mapa: 41 de 43');
    expect(card).toHaveTextContent('Las terminales y las 41 posiciones de Punta Cana ya están cargadas.');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent('Faltan');
  });

  it('says only Punta Cana has a reference plan at another station', async () => {
    loadDemoFlightOptions.mockResolvedValue(options({ stationId: OTHER_STATION,
      stations: [{ id: STATION, code: 'PUJ', name: 'Punta Cana' }, { id: OTHER_STATION, code: 'SDQ', name: 'Santo Domingo' }] }));
    renderPanel();
    const card = await standsCard();
    expect(card).toHaveTextContent('Solo Punta Cana (PUJ) tiene un plano de referencia.');
    expect(card).not.toHaveTextContent('Terminales:');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('lists the missing stands and the stands outside the plan in plain words', async () => {
    expect(isDemoStationLayout(FBO_INACTIVE, STATION)).toBe(true);
    prepareDemoStation.mockResolvedValueOnce(FBO_INACTIVE);
    renderPanel();
    const card = await standsCard();
    const outside = 'Posiciones fuera del plano de referencia: B01, B02. OCC puede desactivarlas en «Datos maestros».';
    expect(card).toHaveTextContent(outside);
    // Before a load the counts say what is missing, and the button creates it.
    expect(card).not.toHaveTextContent('Faltan');

    // OCC keeps the FBO terminal inactive: the load cannot create its stands, and the card names them.
    loadDemoFlightOptions.mockResolvedValue(options({ layout: FBO_INACTIVE }));
    await userEvent.click(within(card).getByRole('button', { name: 'Cargar posiciones' }));
    expect(await within(card).findByText('Faltan: BN6, BN7, BN8, BN9, BN10, BN11, BN12, BN13. Su terminal o la posición ' +
      'están desactivadas: OCC puede activarlas en «Datos maestros».')).toBeInTheDocument();
    expect(card).toHaveTextContent('Terminales: 2 de 3 · Posiciones: 33 de 41 · Ubicadas en el mapa: 33 de 35');
    expect(card).toHaveTextContent(outside);
    // Pressing it again would create nothing.
    expect(within(card).queryByRole('button', { name: 'Cargar posiciones' })).not.toBeInTheDocument();

    // OCC activates the terminal; back in sight the card offers the load again.
    loadDemoFlightOptions.mockResolvedValue(options({ layout: { ...FBO_INACTIVE, terminals: 3 } }));
    await leaveAndReturn();
    expect(await within(card).findByRole('button', { name: 'Cargar posiciones' })).toBeEnabled();
    expect(card).not.toHaveTextContent('Faltan');
  });

  it('explains a refused load by its code and never the server title', async () => {
    renderPanel();
    const card = await standsCard();
    const cases = [[409, 'demo_station_unsupported', true], [409, 'demo_flights_unavailable', true],
      [409, 'version_conflict', true], [404, 'station_unavailable', true], [403, 'forbidden', false]];
    for (const [status, code, rereads] of cases) {
      const reads = loadDemoFlightOptions.mock.calls.length;
      prepareDemoStation.mockRejectedValueOnce(problem(status, code));
      await userEvent.click(within(card).getByRole('button', { name: 'Cargar posiciones' }));
      await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent(DEMO_STATION_MESSAGES[code]));
      expect(within(card).getByRole('alert')).not.toHaveTextContent(SERVER_TITLE);
      // A 409 or a 404 reads the options again before the message shows; the list is not about the stands.
      expect([code, loadDemoFlightOptions.mock.calls.length > reads]).toEqual([code, rereads]);
    }
    expect(within(card).getByRole('alert')).toHaveTextContent('Solo el superadministrador carga las posiciones de Punta Cana.');
    expect(listDemoFlights).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SERVER_TITLE)).not.toBeInTheDocument();
  });

  it('reads the options again after loading the stands', async () => {
    prepareDemoStation.mockResolvedValueOnce(LOADED);
    renderPanel();
    const card = await standsCard();
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(1);
    expect(within(form()).queryByRole('option', { name: /^BN6/ })).not.toBeInTheDocument();

    // The stands the load created come with the next options, located and covered.
    loadDemoFlightOptions.mockResolvedValue(options({ layout: LOADED,
      stands: [...options().stands, stand('s-bn6', 'BN6', 'FBO', { coveredBy: ['Ida Pérez'] })] }));
    await userEvent.click(within(card).getByRole('button', { name: 'Cargar posiciones' }));
    await within(card).findByRole('status');
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    expect(loadDemoFlightOptions).toHaveBeenLastCalledWith(STATION, expect.anything());
    expect(within(form()).getByRole('option', { name: 'BN6 · Terminal FBO · Cubre Ida Pérez' })).toBeEnabled();
    expect(listDemoFlights).toHaveBeenCalledTimes(1);
  });

  it('shows the state the load answered even when the options cannot be read again', async () => {
    prepareDemoStation.mockResolvedValueOnce(LOADED);
    renderPanel();
    const card = await standsCard();
    loadDemoFlightOptions.mockRejectedValueOnce(Object.assign(new Error('Internal'), { status: 503 }));
    await userEvent.click(within(card).getByRole('button', { name: 'Cargar posiciones' }));
    expect(await within(card).findByRole('status')).toHaveTextContent('Se cargaron las posiciones de Punta Cana.');
    expect(card).toHaveTextContent('Las terminales y las 41 posiciones de Punta Cana ya están cargadas.');
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    expect(form()).toBeInTheDocument();
  });

  it('triggers «Al azar» by default', async () => {
    // The server draws A10 among the eligible stands: the list says it is the stand suggested to OCC.
    createDemoFlight.mockResolvedValue(flight({ suggestedStandCode: 'A10' }));
    listDemoFlights.mockResolvedValueOnce(list([])).mockResolvedValue(list([flight({ suggestedStandCode: 'A10' })]));
    renderPanel();
    await screen.findByRole('form', { name: 'Disparar vuelo demo' });
    expect(standField()).toHaveDisplayValue('Al azar');
    expect(standField()).toHaveAccessibleDescription(
      'Al azar: el servidor elige entre las posiciones con un agente elegible a esa hora. OCC puede asignar otra al importar.');

    await userEvent.click(within(form()).getByRole('button', { name: 'Disparar vuelo demo' }));
    expect(createDemoFlight).toHaveBeenCalledWith(expect.objectContaining({ standChoice: 'Random', standId: null }),
      expect.stringMatching(KEY));
    const row = await within(await screen.findByRole('list', { name: 'Vuelos demo de hoy' })).findByRole('listitem');
    expect(row).toHaveTextContent('OCC aún no lo importa · Posición sugerida A10');

    // «Sin posición» is still a choice of its own.
    await userEvent.selectOptions(standField(), 'Sin posición');
    await userEvent.click(within(form()).getByRole('button', { name: 'Disparar vuelo demo' }));
    expect(createDemoFlight).toHaveBeenLastCalledWith(expect.objectContaining({ standChoice: 'None', standId: null }),
      expect.stringMatching(KEY));
  });

  it('reads nothing for a station left while its stands were loading', async () => {
    const stations = [{ id: STATION, code: 'PUJ', name: 'Punta Cana' }, { id: OTHER_STATION, code: 'SDQ', name: 'Santo Domingo' }];
    loadDemoFlightOptions.mockImplementation(async station => options({ stations,
      ...(station === OTHER_STATION ? { stationId: OTHER_STATION } : {}) }));
    let answer;
    prepareDemoStation.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    renderPanel();
    await userEvent.click(within(await standsCard()).getByRole('button', { name: 'Cargar posiciones' }));
    await userEvent.selectOptions(screen.getByLabelText('Estación'), OTHER_STATION);
    expect(await within(await standsCard()).findByText('Solo Punta Cana (PUJ) tiene un plano de referencia.'))
      .toBeInTheDocument();
    const reads = loadDemoFlightOptions.mock.calls.length;

    // Punta Cana answers once Santo Domingo is on screen: its options are not read over the ones shown.
    await act(async () => answer(LOADED));
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(reads);
    expect(loadDemoFlightOptions).toHaveBeenLastCalledWith(OTHER_STATION, expect.anything());
    expect(screen.getByLabelText('Estación')).toHaveValue(OTHER_STATION);
    expect(screen.queryByText('Se cargaron las posiciones de Punta Cana.')).not.toBeInTheDocument();
  });

  it('lists every stand and disables those that are not eligible with their reason', async () => {
    loadDemoFlightOptions.mockResolvedValue(options({ stands: [...options().stands,
      stand('s-b21', 'B21', 'B', { eligibleAgents: 0, eligible: false, reasons: ['shift_not_compatible', 'mentor_required'] }),
      stand('s-b01', 'B01', 'B', { located: false, coveredBy: [], eligibleAgents: 0, eligible: false }),
      stand('s-bn6', 'BN6', 'FBO', { located: false, free: false, coveredBy: [], eligibleAgents: 0, eligible: false })] }));
    renderPanel();
    await screen.findByRole('form', { name: 'Disparar vuelo demo' });
    // In natural order; first what the flags say (not located, not free), then the rule's reasons.
    expect(offered()).toEqual([
      ['Al azar', true],
      ['Sin posición', true],
      ['A1 · Terminal A · No está libre para ese avión en ese horario', false],
      ['A2 · Terminal A · Cubre Riley Ramp', true],
      ['A10 · Terminal A · Cubre Riley Ramp', true],
      ['B01 · Terminal B · Sin ubicar en el mapa', false],
      ['B20 · Terminal B · Nadie la cubre a esa hora', false],
      ['B21 · Terminal B · Turno no compatible y menos de 3 meses: necesita un mentor en su cobertura', false],
      ['BN6 · Terminal FBO · Sin ubicar en el mapa y no está libre para ese avión en ese horario', false],
    ]);
    expect(standField()).toHaveDisplayValue('Al azar');
  });

  it('names who covers each eligible stand', async () => {
    loadDemoFlightOptions.mockResolvedValue(options({ stands: [stand('s-a1', 'A1', 'A'),
      stand('s-a2', 'A2', 'A', { coveredBy: ['Riley Ramp', 'Ida Pérez'], eligibleAgents: 2 }),
      stand('s-a3', 'A3', 'A', { coveredBy: ['Riley Ramp', 'Ida Pérez', 'Sam Lee'], eligibleAgents: 1 })] }));
    renderPanel();
    await screen.findByRole('form', { name: 'Disparar vuelo demo' });
    // Two names at most, and how many OCC may assign when not all of them pass the rule.
    expect(offered().slice(2)).toEqual([
      ['A1 · Terminal A · Cubre Riley Ramp', true],
      ['A2 · Terminal A · Cubren Riley Ramp e Ida Pérez', true],
      ['A3 · Terminal A · Cubren Riley Ramp, Ida Pérez y 1 más (1 elegible)', true],
    ]);
  });

  it('warns when no stand is located', async () => {
    loadDemoFlightOptions.mockResolvedValueOnce(options({ stands: [], warnings: [{ code: 'no_located_stands', reasons: [] },
      { code: 'no_eligible_stand', reasons: [] }] }));
    const puntaCana = renderPanel();
    expect(await screen.findByText(
      'Aún no hay posiciones ubicadas en el mapa. Use «Cargar posiciones» para que el avión tenga dónde estacionarse.'))
      .toBeInTheDocument();
    // Nothing to draw and no reason to give: the warning says so plainly. Neither warning blocks the trigger.
    expect(screen.getByText('Ninguna posición habilitada tiene un agente elegible a esa hora.')).toBeInTheDocument();
    expect(within(form()).getByRole('button', { name: 'Disparar vuelo demo' })).toBeEnabled();
    expect(offered()).toEqual([['Al azar', false], ['Sin posición', true]]);
    puntaCana.unmount();

    // A station without a reference plan has no «Cargar posiciones» to offer.
    loadDemoFlightOptions.mockResolvedValueOnce(options({ stationId: OTHER_STATION, stands: [],
      stations: [{ id: STATION, code: 'PUJ', name: 'Punta Cana' }, { id: OTHER_STATION, code: 'SDQ', name: 'Santo Domingo' }],
      warnings: [{ code: 'no_located_stands', reasons: [] }] }));
    renderPanel();
    expect(await screen.findByText('Aún no hay posiciones ubicadas en el mapa: el avión no tendrá dónde estacionarse.'))
      .toBeInTheDocument();
  });

  it('warns when no stand has an eligible agent and offers «Disparar sin posición» and «Crear cobertura»', async () => {
    loadDemoFlightOptions.mockResolvedValue(nobodyEligible());
    renderPanel();
    const warning = (await screen.findByText(NO_ELIGIBLE_WARNING)).closest('div');
    expect(within(warning).getByRole('button', { name: 'Disparar sin posición' })).toBeEnabled();
    const coverage = within(warning).getByRole('link', { name: 'Crear cobertura' });
    // OCC's «Cobertura de posiciones», in another tab.
    expect(coverage).toHaveAttribute('href', '/admin-occ/position-coverage');
    expect(existsSync(resolve(process.cwd(), 'app/admin-occ/position-coverage/page.jsx'))).toBe(true);
    expect(coverage).toHaveAttribute('target', '_blank');
    expect(coverage.getAttribute('rel')).toMatch(/\bnoopener\b/);
    expect(coverage).toHaveAccessibleDescription('Se abre en el OCC, en otra pestaña.');
    // «Al azar» has nothing to draw: the field says «Sin posición». The warning never blocks the trigger.
    expect(offered().slice(0, 2)).toEqual([['Al azar', false], ['Sin posición', true]]);
    expect(standField()).toHaveDisplayValue('Sin posición');
    expect(within(form()).getByRole('button', { name: 'Disparar vuelo demo' })).toBeEnabled();

    // OCC covers A2 in the other tab: back in sight the options are read again and «Al azar» can draw it.
    loadDemoFlightOptions.mockResolvedValue(options());
    await leaveAndReturn();
    await waitFor(() => expect(screen.queryByText(NO_ELIGIBLE_WARNING)).not.toBeInTheDocument());
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    expect(standField()).toHaveDisplayValue('Al azar');
    expect(screen.queryByRole('button', { name: 'Disparar sin posición' })).not.toBeInTheDocument();
  });

  it('«Disparar sin posición» sends standChoice None', async () => {
    loadDemoFlightOptions.mockResolvedValue(nobodyEligible());
    createDemoFlight.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(flight());
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Disparar sin posición' }));
    expect(createDemoFlight).toHaveBeenCalledWith({ stationId: STATION, airlineId: AIRLINE, originIata: 'MIA',
      destinationIata: null, aircraftTypeId: A320, standChoice: 'None', standId: null, minutesToOnBlock: 8,
      groundMinutes: 60 }, expect.stringMatching(KEY));
    expect(await within(form()).findByRole('alert'))
      .toHaveTextContent('No se pudo completar la acción. Revise la conexión e intente de nuevo.');

    // The answer never arrived: «Disparar vuelo demo», which sends «Sin posición» too, is the same intent with its key.
    await userEvent.click(within(form()).getByRole('button', { name: 'Disparar vuelo demo' }));
    await within(form()).findByText(/Vuelo demo ZZ9001 \/ ZZ9002 creado/);
    const [uncertain, retried] = createDemoFlight.mock.calls;
    expect(retried).toEqual(uncertain);
  });

  it('re-reads the options with the form values', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const advance = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    const field = label => within(form()).getByLabelText(label);
    const lastWindow = () => loadDemoFlightOptions.mock.lastCall[1].window;
    render(<DemoFlightsPanel now={now} fastPollMs={600_000} slowPollMs={600_000} />);
    await advance(0);
    // The first read takes the server's defaults.
    expect(loadDemoFlightOptions.mock.calls).toEqual([[null, { signal: expect.anything() }]]);

    // A destination and a stand are the draft's own: they survive every re-read.
    fireEvent.change(field('Destino de la salida'), { target: { value: 'BOG' } });
    fireEvent.change(field('Posición'), { target: { value: 's-a2' } });
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(1);
    fireEvent.click(within(form()).getByRole('button', { name: '15 min' }));
    await advance(499);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    expect(loadDemoFlightOptions).toHaveBeenLastCalledWith(STATION, expect.objectContaining({
      window: { aircraftTypeId: A320, minutesToOnBlock: 15, groundMinutes: 60 } }));

    // Changes in a row are read once, for the last values: the aircraft's size and the time on the ground count too.
    fireEvent.change(field('Tiempo en tierra (minutos)'), { target: { value: '90' } });
    await advance(200);
    fireEvent.change(field('Tipo de avión'), { target: { value: B77W } });
    await advance(500);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(3);
    expect(lastWindow()).toEqual({ aircraftTypeId: B77W, minutesToOnBlock: 15, groundMinutes: 90 });

    // A value the server would refuse reads nothing.
    fireEvent.change(field('Tiempo en tierra (minutos)'), { target: { value: '19' } });
    await advance(1000);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(3);
    expect(field('Destino de la salida')).toHaveValue('BOG');
    expect(field('Posición')).toHaveValue('s-a2');

    // Every later read keeps the last window in range: back in sight, the options are read for it.
    await leaveAndReturn();
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(4);
    expect(lastWindow()).toEqual({ aircraftTypeId: B77W, minutesToOnBlock: 15, groundMinutes: 90 });
  });

  it('explains no_eligible_stand and stand_not_eligible and reads the options again', async () => {
    renderPanel();
    const trigger = await screen.findByRole('button', { name: 'Disparar vuelo demo' });

    // OCC released A2's coverage while the form was open: the stand chosen by hand is no longer eligible.
    await userEvent.selectOptions(standField(), 's-a2');
    loadDemoFlightOptions.mockResolvedValue(options({ stands: [stand('s-a10', 'A10', 'A'),
      stand('s-a2', 'A2', 'A', { coveredBy: [], eligibleAgents: 0, eligible: false, reasons: ['stand_not_covered'] })] }));
    createDemoFlight.mockRejectedValueOnce(problem(409, 'stand_not_eligible'));
    await userEvent.click(trigger);
    expect(createDemoFlight).toHaveBeenLastCalledWith(expect.objectContaining({ standChoice: 'Specific', standId: 's-a2' }),
      expect.stringMatching(KEY));
    expect(await within(form()).findByRole('alert')).toHaveTextContent(DEMO_FLIGHT_MESSAGES.stand_not_eligible);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    expect(offered()).toContainEqual(['A2 · Terminal A · Nadie la cubre a esa hora', false]);
    expect(standField()).toHaveDisplayValue('Al azar');

    // Meanwhile A10 lost its agent too: «Al azar» has nothing to draw.
    loadDemoFlightOptions.mockResolvedValue(nobodyEligible());
    createDemoFlight.mockRejectedValueOnce(problem(409, 'no_eligible_stand'));
    await userEvent.click(trigger);
    expect(createDemoFlight).toHaveBeenLastCalledWith(expect.objectContaining({ standChoice: 'Random', standId: null }),
      expect.stringMatching(KEY));
    expect(await within(form()).findByText(DEMO_FLIGHT_MESSAGES.no_eligible_stand)).toBeInTheDocument();
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(3);
    expect(screen.getByText(NO_ELIGIBLE_WARNING)).toBeInTheDocument();
    expect(standField()).toHaveDisplayValue('Sin posición');
    expect(screen.queryByText(SERVER_TITLE)).not.toBeInTheDocument();
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

    // Parked: nothing moves, so the list is read every 20 s. The options, read at 10:01, are eight minutes old: they are
    // read again with it.
    clock = at('2026-11-12T14:09:00Z');
    await advance(1000);
    await advance(19_999);
    expect(listDemoFlights).toHaveBeenCalledTimes(3);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(listDemoFlights).toHaveBeenCalledTimes(4);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);

    // Hidden, nothing is read; back in sight, the options and the list are read at once and the polling resumes.
    visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(60_000);
    expect(listDemoFlights).toHaveBeenCalledTimes(4);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(listDemoFlights).toHaveBeenCalledTimes(5);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(3);
    await advance(20_000);
    expect(listDemoFlights).toHaveBeenCalledTimes(6);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(3);
  });

  it('reads the options again once they are five minutes old, so a warning that comes with the time shows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // Opened at 23:26 in Punta Cana: nothing to warn about yet. The server warns from 23:30.
    clock = at('2026-11-13T03:26:00Z');
    /** How far the server's clock is ahead of this browser's. */
    let skew = 0;
    loadDemoFlightOptions.mockImplementation(async () => optionsAt(clock + skew));
    listDemoFlights.mockImplementation(async () => list([], iso(clock + skew)));
    // The browser's clock moves with the timers, one slow poll at a time.
    const poll = () => act(async () => { clock += 20_000; await vi.advanceTimersByTimeAsync(20_000); });
    render(<DemoFlightsPanel now={now} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('form', { name: 'Disparar vuelo demo' })).toBeInTheDocument();
    expect(screen.queryByText(MIDNIGHT_WARNING)).not.toBeInTheDocument();

    // Nothing moves: the list is read every 20 s; the options are kept while they are under five minutes old, even
    // past 23:30.
    for (let read = 0; read < 14; read += 1) await poll();
    expect(listDemoFlights).toHaveBeenCalledTimes(15);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(MIDNIGHT_WARNING)).not.toBeInTheDocument();

    // 23:31: five minutes old, they are read with the list and the warning shows without reloading the panel. It never
    // blocks the trigger.
    await poll();
    expect(listDemoFlights).toHaveBeenCalledTimes(16);
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    expect(loadDemoFlightOptions).toHaveBeenLastCalledWith(STATION, expect.anything());
    expect(screen.getByText(MIDNIGHT_WARNING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disparar vuelo demo' })).toBeEnabled();
    await poll();
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);

    // This browser's clock is set back an hour while the server's goes on: the age is no longer known, so the options are
    // read again with the next poll.
    clock -= 3_600_000;
    skew += 3_600_000;
    await poll();
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(3);
    expect(screen.getByText(MIDNIGHT_WARNING)).toBeInTheDocument();
  });

  it('reads the options and the list at once when the tab is back in sight', async () => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    // Opened at 23:10 in Punta Cana and hidden; back at 23:45, when the server warns about midnight.
    clock = at('2026-11-13T03:10:00Z');
    loadDemoFlightOptions.mockImplementation(async () => optionsAt(clock));
    listDemoFlights.mockImplementation(async () => list([], iso(clock)));
    renderPanel();
    expect(await screen.findByRole('form', { name: 'Disparar vuelo demo' })).toBeInTheDocument();
    expect(screen.queryByText(MIDNIGHT_WARNING)).not.toBeInTheDocument();

    visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    clock = at('2026-11-13T03:45:00Z');
    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByText(MIDNIGHT_WARNING)).toBeInTheDocument();
    expect(loadDemoFlightOptions).toHaveBeenCalledTimes(2);
    expect(loadDemoFlightOptions).toHaveBeenLastCalledWith(STATION, expect.anything());
    expect(listDemoFlights).toHaveBeenCalledTimes(2);
  });
});
