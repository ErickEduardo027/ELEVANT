import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getDemoFlightOptions: vi.fn(), listDemoFlights: vi.fn(), createDemoFlight: vi.fn(),
  cancelDemoFlight: vi.fn(), prepareDemoStation: vi.fn() }));
const auth = vi.hoisted(() => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../features/auth/authService', () => auth);
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

const {
  cancelDemoFlight, createDemoFlight, DEMO_FLIGHT_MESSAGES, DEMO_STATION_MESSAGES, demoFlightMessage, demoStationMessage,
  listDemoFlights, loadDemoFlightOptions, prepareDemoStation,
} = await import('./demoFlightsService');

const SERVER_TITLE = 'The demo flight cannot be created.';
const failure = (status, code) => Object.assign(new Error(SERVER_TITLE), { status, code, title: SERVER_TITLE });
const key = 'a0000000-0000-7000-8000-000000000009';
const station = '20000000-0000-7000-8000-000000000003';
const a320 = '40000000-0000-7000-8000-000000000001';
const input = (extra = {}) => ({ stationId: station, airlineId: '30000000-0000-7000-8000-000000000001', originIata: 'MIA',
  destinationIata: null, aircraftTypeId: a320, standChoice: 'None', standId: null,
  minutesToOnBlock: 8, groundMinutes: 60, ...extra });
/** Punta Cana once its stands were loaded: complete, with the seeded B01 and B02 outside the catalogue. */
const layout = { stationId: station, stationCode: 'PUJ', supported: true, catalogTerminals: 3, terminals: 3,
  catalogStands: 41, stands: 41, activeStands: 43, locatedStands: 41, missingStands: [], unmatchedStands: ['B01', 'B02'],
  complete: true };
/** A stand for the form's visit: located, free and covered at the on-block instant by an agent who passes the rule. */
const stand = { standId: '50000000-0000-7000-8000-000000000001', code: 'A1', terminalCode: 'A', located: true, free: true,
  coveredBy: ['Riley Ramp'], eligibleAgents: 1, eligible: true, reasons: [] };

afterEach(() => vi.clearAllMocks());

describe('demo flights service (ADR-0041)', () => {
  it('explains each demo refusal by its code and never by the server title', () => {
    expect(demoFlightMessage(failure(409, 'demo_flights_unavailable'))).toBe('Los vuelos demo no están disponibles en este entorno.');
    expect(demoFlightMessage(failure(409, 'stand_unavailable')))
      .toBe('La posición ya no está libre para esa escala. Elija otra o «Sin posición».');
    expect(demoFlightMessage(failure(409, 'version_conflict')))
      .toBe('El vuelo demo cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.');
    expect(demoFlightMessage(failure(409, 'demo_flight_closed'))).toMatch(/ya terminó o se canceló/);
    expect(demoFlightMessage(failure(404, 'station_unavailable'))).toMatch(/La estación ya no está activa/);
    // A 403 without its code is the superadministrator's refusal too, and no answer is the connection.
    expect(demoFlightMessage(failure(403))).toBe('Solo el superadministrador dispara vuelos demo.');
    expect(demoFlightMessage(new TypeError('Failed to fetch'))).toMatch(/Revise la conexión/);
    // A stand chosen by hand that is not eligible, «Al azar» with nothing to draw and a station without a catalogue.
    expect(demoFlightMessage(failure(409, 'stand_not_eligible'))).toMatch(/no tiene un agente elegible a esa hora/);
    expect(demoFlightMessage(failure(409, 'no_eligible_stand'))).toMatch(/cree antes la cobertura/);
    expect(demoFlightMessage(failure(409, 'demo_station_unsupported')))
      .toBe('Solo Punta Cana (PUJ) tiene un plano de referencia.');
    for (const code of ['demo_flights_unavailable', 'invalid_demo_flight', 'station_unavailable', 'airline_inactive',
      'contract_not_in_force', 'contract_ambiguous', 'aircraft_type_unavailable', 'demo_origin_unknown', 'stand_unavailable',
      'stand_not_eligible', 'no_eligible_stand', 'demo_station_unsupported', 'demo_flight_limit_reached',
      'demo_flight_closed', 'version_conflict', 'not_found', 'forbidden']) {
      expect(DEMO_FLIGHT_MESSAGES[code], code).toBeTruthy();
      expect(demoFlightMessage(failure(409, code))).toBe(DEMO_FLIGHT_MESSAGES[code]);
      expect(demoFlightMessage(failure(409, code))).not.toContain(SERVER_TITLE);
    }
  });

  it('explains the stand and station refusals by their code', () => {
    // «Al azar» with nothing to draw, a stand chosen by hand that lost its eligible agent, and a stand taken meanwhile.
    expect(demoFlightMessage(failure(409, 'no_eligible_stand')))
      .toBe('Ninguna posición tiene un agente elegible a esa hora. Dispare sin posición o cree antes la cobertura.');
    expect(demoFlightMessage(failure(409, 'stand_not_eligible')))
      .toBe('Esa posición ya no tiene un agente elegible a esa hora. Elija otra, «Al azar» o «Sin posición».');
    expect(demoFlightMessage(failure(409, 'stand_unavailable')))
      .toBe('La posición ya no está libre para esa escala. Elija otra o «Sin posición».');
    expect(demoFlightMessage(failure(409, 'demo_station_unsupported'))).toBe('Solo Punta Cana (PUJ) tiene un plano de referencia.');

    // «Cargar posiciones» speaks of the station and its stands, never of a demo flight.
    expect(demoStationMessage(failure(409, 'demo_station_unsupported'))).toBe('Solo Punta Cana (PUJ) tiene un plano de referencia.');
    expect(demoStationMessage(failure(409, 'demo_flights_unavailable')))
      .toBe('Los vuelos demo no están disponibles en este entorno.');
    expect(demoStationMessage(failure(404, 'station_unavailable'))).toBe('La estación ya no está activa. Se actualizaron los datos.');
    expect(demoStationMessage(failure(404, 'not_found'))).toBe('La estación ya no existe. Se actualizaron los datos.');
    expect(demoStationMessage(failure(409, 'version_conflict')))
      .toBe('Las posiciones de la estación cambiaron mientras se cargaban. Se actualizaron los datos; intente de nuevo.');
    // A 403 without its code is the superadministrator's refusal too; a reused key and no answer keep the shared words.
    expect(demoStationMessage(failure(403))).toBe('Solo el superadministrador carga las posiciones de Punta Cana.');
    expect(demoStationMessage(failure(409, 'idempotency_conflict')))
      .toBe('Ese envío ya se usó con otros datos; actualice e intente de nuevo.');
    expect(demoStationMessage(new TypeError('Failed to fetch')))
      .toBe('No se pudo completar la acción. Revise la conexión e intente de nuevo.');
    for (const code of Object.keys(DEMO_STATION_MESSAGES)) {
      expect(demoStationMessage(failure(409, code)), code).toBe(DEMO_STATION_MESSAGES[code]);
      expect(demoStationMessage(failure(409, code)), code).not.toContain(SERVER_TITLE);
      expect(DEMO_STATION_MESSAGES[code], code).not.toMatch(/vuelo demo (?:cambió|ya no existe)/);
    }
  });

  it('refuses minutes out of range before sending, and sends a valid flight with its key', async () => {
    for (const bad of [input({ minutesToOnBlock: 1 }), input({ minutesToOnBlock: 31 }), input({ groundMinutes: 19 }),
      input({ groundMinutes: 241 }), input({ minutesToOnBlock: 7.5 }), input({ minutesToOnBlock: Number.NaN }),
      input({ standChoice: 'Specific', standId: null }), input({ standChoice: 'Random', standId: stand.standId })])
      await expect(createDemoFlight(bad, key)).rejects.toMatchObject({ status: 400, code: 'invalid_demo_flight' });
    expect(api.createDemoFlight).not.toHaveBeenCalled();
    expect(demoFlightMessage({ status: 400, code: 'invalid_demo_flight' })).toMatch(/de 2 a 30 minutos .* de 20 a 240/);

    api.createDemoFlight.mockResolvedValueOnce({ id: 'demo-1' });
    await expect(createDemoFlight(input(), key)).resolves.toEqual({ id: 'demo-1' });
    expect(api.createDemoFlight).toHaveBeenCalledWith(input(), key);
    // «Al azar» names no stand: the server draws it.
    api.createDemoFlight.mockResolvedValueOnce({ id: 'demo-2' });
    await expect(createDemoFlight(input({ standChoice: 'Random' }), key)).resolves.toEqual({ id: 'demo-2' });
    expect(api.createDemoFlight).toHaveBeenLastCalledWith(input({ standChoice: 'Random' }), key);
  });

  it('sends the cancel with its intent and key', async () => {
    api.cancelDemoFlight.mockResolvedValueOnce({ id: 'demo-1', state: 'Cancelled' });
    await expect(cancelDemoFlight('demo-1', 'Cancel', key)).resolves.toMatchObject({ state: 'Cancelled' });
    expect(api.cancelDemoFlight).toHaveBeenCalledWith('demo-1', 'Cancel', key);
    api.cancelDemoFlight.mockResolvedValueOnce({ id: 'demo-1', state: 'Active' });
    await cancelDemoFlight('demo-1', 'Finish', key);
    expect(api.cancelDemoFlight).toHaveBeenLastCalledWith('demo-1', 'Finish', key);
  });

  it('reads the options and the list of a station, or of the server default, without the cache', async () => {
    const signal = new AbortController().signal;
    api.getDemoFlightOptions.mockResolvedValue({ enabled: true });
    api.listDemoFlights.mockResolvedValue({ enabled: true, flights: [] });
    await loadDemoFlightOptions(station, { signal });
    await loadDemoFlightOptions(undefined);
    await listDemoFlights(station, { signal });
    await listDemoFlights(null);
    expect(api.getDemoFlightOptions.mock.calls).toEqual([[station, { signal, cache: 'no-store' }],
      [null, { signal: undefined, cache: 'no-store' }]]);
    expect(api.listDemoFlights.mock.calls).toEqual([[station, { signal, cache: 'no-store' }],
      [null, { signal: undefined, cache: 'no-store' }]]);
  });

  it('reads the options for the visit of the form and refuses a window out of range before sending', async () => {
    const signal = new AbortController().signal;
    const answer = { enabled: true, stationId: station, stands: [stand], layout };
    api.getDemoFlightOptions.mockResolvedValue(answer);
    // The stands come evaluated for the form's values: the aircraft type's size, the minutes to the stand and on the ground.
    await expect(loadDemoFlightOptions(station, { signal, window: { aircraftTypeId: a320, minutesToOnBlock: 15,
      groundMinutes: 90 } })).resolves.toBe(answer);
    await loadDemoFlightOptions(null, { window: { minutesToOnBlock: 3 } });
    expect(api.getDemoFlightOptions.mock.calls).toEqual([
      [{ stationId: station, aircraftTypeId: a320, minutesToOnBlock: 15, groundMinutes: 90 }, { signal, cache: 'no-store' }],
      [{ stationId: null, minutesToOnBlock: 3 }, { signal: undefined, cache: 'no-store' }],
    ]);

    // A window the server would refuse is explained as invalid data and never sent.
    for (const window of [{ minutesToOnBlock: 1 }, { minutesToOnBlock: 31 }, { groundMinutes: 19 }, { groundMinutes: 241 },
      { minutesToOnBlock: 7.5 }, { minutesToOnBlock: Number.NaN }, { aircraftTypeId: 'A320' }, { standId: stand.standId }])
      await expect(loadDemoFlightOptions(station, { window })).rejects.toMatchObject({ status: 400, code: 'invalid_demo_flight' });
    expect(api.getDemoFlightOptions).toHaveBeenCalledTimes(2);
  });

  it('loads the Punta Cana stands with the key of the intent and answers the state', async () => {
    api.prepareDemoStation.mockResolvedValueOnce(layout).mockRejectedValueOnce(failure(401))
      .mockRejectedValueOnce(failure(409, 'demo_station_unsupported'));
    await expect(prepareDemoStation(station, key)).resolves.toBe(layout);
    expect(api.prepareDemoStation).toHaveBeenCalledWith(station, key);
    // An expired session ends it; a refusal keeps its code for the message.
    await expect(prepareDemoStation(station, key)).rejects.toMatchObject({ status: 401 });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    await expect(prepareDemoStation(station, key)).rejects.toMatchObject({ status: 409, code: 'demo_station_unsupported' });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledTimes(1);
  });

  it('ends the session on a 401 and passes every other failure through', async () => {
    api.listDemoFlights.mockRejectedValueOnce(failure(401)).mockRejectedValueOnce(failure(403, 'forbidden'));
    await expect(listDemoFlights(station)).rejects.toMatchObject({ status: 401 });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    await expect(listDemoFlights(station)).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledTimes(1);
  });
});
