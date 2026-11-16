import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRemoteAviationReferenceService, createSimulatedAviationReferenceService, isDemoRegistration,
} from '../../services/aviationReferenceService';
import AircraftRegistryFacts from './AircraftRegistryFacts';
import AirlineFleetFacts from './AirlineFleetFacts';
import { AirportDelaysLine, AirportDelaysPill, AIRPORT_DELAYS_POLL_MS } from './AirportDelays';
import { AviationReferenceProvider } from './AviationReferenceContext';
import {
  aircraftRows, delayMinutes, delaysSummary, delayTone, fleetSummary, hasNoFleet, statusWords, worstDelayIndex,
} from './aviationReferenceFormat';
import { aviationReferenceMessages } from './aviationReferenceMessages';
import { createTranslator } from '../../i18n/languageStore';

// ADR-0028 (note of 15 November 2026): the AeroDataBox reference reads of the private web over a simulated adapter with
// invented answers; nothing reaches the API or AeroDataBox.

const STATION = '20000000-0000-7000-8000-000000000003';
const NOW = '2026-11-15T14:00:00Z';
const t = createTranslator(aviationReferenceMessages, 'es');
const en = createTranslator(aviationReferenceMessages, 'en');

const aircraft = {
  registration: 'HI1055', active: true, model: 'Boeing 737 MAX 8', typeName: 'Boeing 737', icaoType: 'B38M',
  iataType: '7M8', operator: 'Demo Airlines', serial: '99999', modeS: '0C2ABC', seats: 189, engines: 2, engineType: 'Jet',
  ageYears: 4.2, firstFlight: '2022-03-01', delivered: null, registered: null, isFreighter: false,
};
const aircraftAnswer = (status = 'Available', value = aircraft) => ({ stationId: STATION, registration: 'HI1055', status,
  serverTime: NOW, retrievedAt: value ? '2026-11-15T13:55:00Z' : null, source: 'AeroDataBox', aircraft: value });
const batch = (median, index, total = 12) => ({ total, qualified: total, cancelled: 0, medianDelayMinutes: median, delayIndex: index });
const delaysAnswer = (status = 'Available', delays = { airportIcao: 'MDPC', from: '2026-11-15T12:00:00Z',
  to: '2026-11-15T14:00:00Z', arrivals: batch(12, 1.6), departures: batch(8, 0.9) }) =>
  ({ stationId: STATION, airport: 'MDPC', status, serverTime: NOW, retrievedAt: delays ? NOW : null,
    source: 'AeroDataBox', delays });
const fleetAnswer = (changes = {}) => ({ airlineCode: 'ZZA', status: 'Available', serverTime: NOW, retrievedAt: NOW,
  source: 'AeroDataBox', totalAircraft: 87, sampledAircraft: 25,
  types: [{ icaoType: 'A320', model: 'Airbus A320', count: 12 }, { icaoType: 'B738', model: 'Boeing 737-800', count: 8 },
    { icaoType: 'A321', model: 'Airbus A321', count: 3 }, { icaoType: null, model: 'ATR 72', count: 2 }], ...changes });

function withService(answers) {
  const service = createSimulatedAviationReferenceService({ answers });
  const wrap = node => <AviationReferenceProvider service={service}>{node}</AviationReferenceProvider>;
  return { service, wrap };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('reference wording', () => {
  it('says the delays, the fleet and the states in words', () => {
    expect(delayMinutes(t, 12)).toBe('+12 min');
    expect(delayMinutes(t, -4)).toBe('−4 min');
    expect(delayMinutes(t, 0)).toBe('sin demora');
    expect(delaysSummary(t, delaysAnswer().delays)).toBe('llegadas +12 min · salidas +8 min');
    expect(delaysSummary(en, { arrivals: batch(null, null, 0), departures: batch(3, 0.2) }))
      .toBe('arrivals no flights · departures +3 min');
    expect(worstDelayIndex(delaysAnswer().delays)).toBe(1.6);
    expect([delayTone(null), delayTone(0.4), delayTone(2), delayTone(3.5)]).toEqual(['none', 'ok', 'watch', 'high']);
    expect(fleetSummary(t, fleetAnswer())).toBe('Flota según AeroDataBox: 87 aviones · A320, B738, A321…');
    expect(fleetSummary(t, fleetAnswer({ totalAircraft: null, sampledAircraft: 0, types: [] }))).toBeNull();
    expect(hasNoFleet(fleetAnswer({ status: 'NotFound', totalAircraft: null, sampledAircraft: 0, types: [] }))).toBe(true);
    expect(hasNoFleet(fleetAnswer())).toBe(false);
    expect(statusWords(t, { status: 'success', data: { status: 'DailyLimitReached' } }, true))
      .toBe('Límite diario alcanzado. Se muestra el último dato guardado.');
    expect(statusWords(t, { status: 'success', data: { status: 'Available' } }, true)).toBeNull();
    expect(aircraftRows(t, aircraft).map(row => [row.id, row.value])).toEqual([
      ['model', 'Boeing 737 MAX 8'], ['type', 'B38M / 7M8'], ['operator', 'Demo Airlines'], ['age', '4,2 años'],
      ['firstFlight', '2022'], ['seats', '189'], ['engines', '2 · reactor'], ['serial', '99999'], ['modeS', '0C2ABC']]);
  });

  it('knows a demo registration', () => {
    expect(['HIDM01', 'hi-dm07', 'HIDM99'].every(isDemoRegistration)).toBe(true);
    expect(['HIDM00', 'HI1055', 'N12345', null].some(isDemoRegistration)).toBe(false);
  });
});

describe('the remote adapter', () => {
  it('asks once per subject while its answer is fresh, and never for a demo registration', async () => {
    let now = Date.parse(NOW);
    const api = { getOccAircraftReference: vi.fn().mockResolvedValue(aircraftAnswer()),
      getOccAirportDelays: vi.fn().mockResolvedValue(delaysAnswer()) };
    const service = createRemoteAviationReferenceService({ client: api, now: () => now });

    await Promise.all([service.getAircraft({ stationId: STATION, registration: 'hi-1055' }),
      service.getAircraft({ stationId: STATION, registration: 'HI1055' })]);
    await service.getAircraft({ stationId: STATION, registration: 'HI1055' });
    expect(api.getOccAircraftReference).toHaveBeenCalledTimes(1);
    expect(api.getOccAircraftReference.mock.calls[0][0]).toEqual({ stationId: STATION, registration: 'HI1055' });

    await expect(service.getAircraft({ stationId: STATION, registration: 'HIDM03' }))
      .resolves.toMatchObject({ status: 'NotApplicable', aircraft: null });
    expect(api.getOccAircraftReference).toHaveBeenCalledTimes(1);

    await service.getDelays({ stationId: STATION });
    now += AIRPORT_DELAYS_POLL_MS;
    await service.getDelays({ stationId: STATION });
    expect(api.getOccAirportDelays).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed read so the next one asks again', async () => {
    const api = { getOccAirportRoutes: vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
      .mockResolvedValue({ routes: [] }) };
    const service = createRemoteAviationReferenceService({ client: api });
    await expect(service.getRoutes({ stationId: STATION })).rejects.toThrow();
    await expect(service.getRoutes({ stationId: STATION })).resolves.toEqual({ routes: [] });
  });
});

describe('the aircraft facts', () => {
  it('show what AeroDataBox knows of the registration', async () => {
    const { service, wrap } = withService({ aircraft: aircraftAnswer() });
    render(wrap(<AircraftRegistryFacts stationId={STATION} registration="hi-1055" />));
    expect(await screen.findByText('Boeing 737 MAX 8')).toBeTruthy();
    expect(screen.getByText('Aeronave HI1055')).toBeTruthy();
    expect(screen.getByText('Matrícula activa')).toBeTruthy();
    expect(service.calls.map(call => [call.read, call.registration])).toEqual([['aircraft', 'HI1055']]);
  });

  it('say the cap in words and keep the last value', async () => {
    const { wrap } = withService({ aircraft: aircraftAnswer('DailyLimitReached') });
    render(wrap(<AircraftRegistryFacts stationId={STATION} registration="HI1055" />));
    expect(await screen.findByText('Límite diario alcanzado. Se muestra el último dato guardado.')).toBeTruthy();
    expect(screen.getByText('Demo Airlines')).toBeTruthy();
  });

  it('never ask for a demo flight, and render nothing without a provider', () => {
    const { service, wrap } = withService({ aircraft: aircraftAnswer() });
    render(wrap(<AircraftRegistryFacts stationId={STATION} registration="HIDM04" />));
    expect(screen.getByText('Vuelo demo: sin consulta a AeroDataBox')).toBeTruthy();
    render(wrap(<AircraftRegistryFacts stationId={STATION} registration="HI1055" isDemo />));
    expect(service.calls).toEqual([]);
    const { container } = render(<AircraftRegistryFacts stationId={STATION} registration="HI1055" />);
    expect(container.innerHTML).toBe('');
  });

  it('say when the registration is not in AeroDataBox', async () => {
    const { wrap } = withService({ aircraft: aircraftAnswer('NotFound', null) });
    render(wrap(<AircraftRegistryFacts stationId={STATION} registration="N0NE1" />));
    expect(await screen.findByText('La matrícula N0NE1 no figura en AeroDataBox')).toBeTruthy();
  });
});

describe('the airline fleet', () => {
  it('reads at once in the intake and says the fleet in one line', async () => {
    const { service, wrap } = withService({ fleet: fleetAnswer() });
    render(wrap(<AirlineFleetFacts icaoCode="zza" auto />));
    expect(await screen.findByText('Flota según AeroDataBox: 87 aviones · A320, B738, A321…')).toBeTruthy();
    expect(service.calls.map(call => call.airlineCode)).toEqual(['ZZA']);
  });

  it('warns without blocking when no fleet is registered, and in the catalog waits for the button', async () => {
    const { service, wrap } = withService({ fleet: fleetAnswer({ status: 'NotFound', totalAircraft: null,
      sampledAircraft: 0, types: [], retrievedAt: null }) });
    render(wrap(<AirlineFleetFacts icaoCode={null} iataCode="Z9" />));
    expect(service.calls).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Consultar flota' }));
    expect(await screen.findByText('Sin flota registrada en AeroDataBox')).toBeTruthy();
    expect(service.calls.map(call => call.airlineCode)).toEqual(['Z9']);
  });
});

describe('the airport delays', () => {
  it('the pill says the delays of the station and refreshes every 15 minutes while visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { service, wrap } = withService({ delays: delaysAnswer() });
    render(wrap(<AirportDelaysPill stationId={STATION} label="PUJ" />));
    expect(await screen.findByText('Demoras PUJ: llegadas +12 min · salidas +8 min')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(AIRPORT_DELAYS_POLL_MS); });
    await waitFor(() => expect(service.calls).toHaveLength(2));
    expect(service.calls.every(call => call.airport === null)).toBe(true);
  });

  it('the pill says a reached cap instead of an error', async () => {
    const { wrap } = withService({ delays: delaysAnswer('MonthlyLimitReached', null) });
    render(wrap(<AirportDelaysPill stationId={STATION} label="PUJ" />));
    expect(await screen.findByText('Demoras PUJ: Límite mensual alcanzado')).toBeTruthy();
  });

  it('draws nothing and stops polling when the plan has no delays (Disabled)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { service, wrap } = withService({ delays: delaysAnswer('Disabled', null) });
    const { container } = render(wrap(<><AirportDelaysPill stationId={STATION} label="PUJ" />
      <AirportDelaysLine stationId={STATION} airport="SDQ" /></>));
    await waitFor(() => expect(service.calls).toHaveLength(2));
    await waitFor(() => expect(container.querySelector('[data-airport-delays-pill]')).toBeNull());
    expect(container.querySelector('[data-airport-delays-line]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(AIRPORT_DELAYS_POLL_MS * 3); });
    expect(service.calls).toHaveLength(2);
  });

  it('the inspector reads the origin of the flight', async () => {
    const { service, wrap } = withService({ delays: query => ({ ...delaysAnswer(), airport: query.airport }) });
    render(wrap(<AirportDelaysLine stationId={STATION} airport="sdq" role="origin" />));
    expect(await screen.findByText('Demoras en el origen SDQ')).toBeTruthy();
    expect(await screen.findByText('llegadas +12 min · salidas +8 min')).toBeTruthy();
    expect(service.calls.map(call => call.airport)).toEqual(['SDQ']);
  });
});
