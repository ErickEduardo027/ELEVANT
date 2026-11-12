import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getDemoFlightOptions: vi.fn(), listDemoFlights: vi.fn(), createDemoFlight: vi.fn(),
  cancelDemoFlight: vi.fn() }));
const auth = vi.hoisted(() => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../features/auth/authService', () => auth);
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

const { cancelDemoFlight, createDemoFlight, DEMO_FLIGHT_MESSAGES, demoFlightMessage, listDemoFlights, loadDemoFlightOptions } =
  await import('./demoFlightsService');

const SERVER_TITLE = 'The demo flight cannot be created.';
const failure = (status, code) => Object.assign(new Error(SERVER_TITLE), { status, code, title: SERVER_TITLE });
const key = 'a0000000-0000-7000-8000-000000000009';
const station = '20000000-0000-7000-8000-000000000003';
const input = (extra = {}) => ({ stationId: station, airlineId: '30000000-0000-7000-8000-000000000001', originIata: 'MIA',
  destinationIata: null, aircraftTypeId: '40000000-0000-7000-8000-000000000001', standChoice: 'None', standId: null,
  minutesToOnBlock: 8, groundMinutes: 60, ...extra });

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
    for (const code of ['demo_flights_unavailable', 'invalid_demo_flight', 'station_unavailable', 'airline_inactive',
      'contract_not_in_force', 'contract_ambiguous', 'aircraft_type_unavailable', 'demo_origin_unknown', 'stand_unavailable',
      'demo_flight_limit_reached', 'demo_flight_closed', 'version_conflict', 'not_found', 'forbidden']) {
      expect(DEMO_FLIGHT_MESSAGES[code], code).toBeTruthy();
      expect(demoFlightMessage(failure(409, code))).toBe(DEMO_FLIGHT_MESSAGES[code]);
      expect(demoFlightMessage(failure(409, code))).not.toContain(SERVER_TITLE);
    }
  });

  it('refuses minutes out of range before sending, and sends a valid flight with its key', async () => {
    for (const bad of [input({ minutesToOnBlock: 1 }), input({ minutesToOnBlock: 31 }), input({ groundMinutes: 19 }),
      input({ groundMinutes: 241 }), input({ minutesToOnBlock: 7.5 }), input({ minutesToOnBlock: Number.NaN }),
      input({ standChoice: 'Specific', standId: null })])
      await expect(createDemoFlight(bad, key)).rejects.toMatchObject({ status: 400, code: 'invalid_demo_flight' });
    expect(api.createDemoFlight).not.toHaveBeenCalled();
    expect(demoFlightMessage({ status: 400, code: 'invalid_demo_flight' })).toMatch(/de 2 a 30 minutos .* de 20 a 240/);

    api.createDemoFlight.mockResolvedValueOnce({ id: 'demo-1' });
    await expect(createDemoFlight(input(), key)).resolves.toEqual({ id: 'demo-1' });
    expect(api.createDemoFlight).toHaveBeenCalledWith(input(), key);
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

  it('ends the session on a 401 and passes every other failure through', async () => {
    api.listDemoFlights.mockRejectedValueOnce(failure(401)).mockRejectedValueOnce(failure(403, 'forbidden'));
    await expect(listDemoFlights(station)).rejects.toMatchObject({ status: 401 });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    await expect(listDemoFlights(station)).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledTimes(1);
  });
});
