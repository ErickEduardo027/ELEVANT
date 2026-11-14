import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import OccMap from '../core/OccMap';
import { useOccMap } from '../core/OccMapContext';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX, TRAFFIC_NOON,
  TRAFFIC_STATION_ID, trafficInstant,
} from '../testing/trafficFixtures';
import { buildSituation, selectionTarget, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import { createTelemetryStore } from '../traffic/telemetryStore';
import FlightDataBlock, { dataBlockLinks } from './FlightDataBlock';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const NOON = Date.parse(TRAFFIC_NOON);
const STATION = Object.freeze({ iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana International', latitude: 18.5674,
  longitude: -68.3634 });

/** The noon situation, with each row of the map flights changed by `change(row)` (an API row). */
function noonSituation(change = () => null) {
  const raw = createMapFlights();
  const flights = toFlightsModel({ ...raw, flights: raw.flights.map(row => change(row) ?? row) });
  return buildSituation({ picture: toPictureModel(createAirPicture()), flights, nowMs: NOON, estimates: createEstimates() });
}

function storeOf(situation) {
  const store = createTelemetryStore({ clock: { now: () => Date.now() } });
  store.set(situation);
  return store;
}

function renderBlock(selection, { situation = noonSituation(), onClose = vi.fn(), stationId = TRAFFIC_STATION_ID } = {}) {
  const target = selectionTarget(selection, situation);
  const view = render(<FlightDataBlock target={target} telemetry={storeOf(situation)} station={STATION} stationId={stationId}
    onClose={onClose} style={{ top: 12, left: 12 }} />);
  return { ...view, target, onClose };
}

const block = () => screen.getByTestId('flight-data-block');
const sourceLine = () => block().querySelector('[data-source-line]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOON);
  fake.state.reset();
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('FlightDataBlock', () => {
  it('states the source of the position: live, no recent signal, estimated, no position yet', () => {
    // ZZ161 on final, its fix 4 s old.
    renderBlock({ kind: 'flight', id: KEY.arrival });
    expect(block()).toHaveAttribute('data-source', 'live');
    expect(sourceLine()).toHaveTextContent('En vivo · hace 4 s');
    // Who it is, where it goes and when, and what the aircraft does, in the words and units of the screen.
    expect(within(block()).getByRole('heading', { name: 'ZZ161' })).toBeInTheDocument();
    expect(within(block()).getByText('B38M')).toBeInTheDocument();
    expect(within(block()).getByText('ZZ-TST1')).toBeInTheDocument();
    expect(within(block()).getByText('MIA')).toBeInTheDocument();
    expect(within(block()).getByText('PUJ')).toBeInTheDocument();
    expect(block()).toHaveTextContent('Llega 11:10 · en 10 min');
    const values = Object.fromEntries(within(block()).getAllByRole('term')
      .map(term => [term.textContent, term.nextElementSibling.textContent]));
    expect(values).toEqual({ Altitud: '2,600 ftbajando', Velocidad: '150 kt', Rumbo: '074°' });
    expect(block()).toHaveTextContent('Posición A5');
    expect(block()).not.toHaveTextContent('Pista');
    cleanup();

    // Another airline's aircraft whose last position is 45 s old: no recent signal.
    renderBlock({ kind: 'aircraft', id: HEX.stale });
    expect(block()).toHaveAttribute('data-source', 'stale');
    expect(sourceLine()).toHaveTextContent('Sin señal desde hace 45 s');
    cleanup();

    // The demo arrival drawn where its schedule puts it: estimated, in the vocabulary's words.
    renderBlock({ kind: 'flight', id: KEY.demoArrival });
    expect(block()).toHaveAttribute('data-source', 'estimated');
    expect(sourceLine()).toHaveTextContent(TAGS.estimated.description.es);
    expect(TAGS.estimated.description.es).toBe('Posición estimada: calculada con el horario, no con señal del avión.');
    cleanup();

    // ZZ500, en route with no live fix: no position yet, and no telemetry to show.
    renderBlock({ kind: 'flight', id: KEY.noFix });
    expect(block()).toHaveAttribute('data-source', 'none');
    expect(sourceLine()).toHaveTextContent('Sin posición todavía');
    expect(within(block()).queryByRole('term')).not.toBeInTheDocument();
    expect(block()).toHaveTextContent('Llega 11:48 · en 48 min');
    cleanup();

    // ZZ700 left A3 eight minutes ago: its time is when it left, and the stand is where it left from.
    renderBlock({ kind: 'flight', id: KEY.departed });
    expect(within(block()).getByText('YYZ')).toBeInTheDocument();
    expect(block()).toHaveTextContent('Salió 10:52 · hace 8 min');
    expect(block()).toHaveTextContent('Salió de la posición A3');
  });

  it('never speaks in the future of what happened, nor of a time gone by', () => {
    const changed = (key, fields) => noonSituation(row => (row.flightKey === key ? { ...row, ...fields } : null));
    // ZZ500 was due five minutes ago and has not landed: overdue, never «Llega … hace».
    renderBlock({ kind: 'flight', id: KEY.noFix }, { situation: changed(KEY.noFix, { estimatedAt: trafficInstant(-300) }) });
    expect(block()).toHaveTextContent('Debía llegar 10:55 · hace 5 min');
    expect(block()).not.toHaveTextContent('Llega');
    cleanup();
    // Within half a minute of its time it is due now, not overdue yet.
    renderBlock({ kind: 'flight', id: KEY.noFix }, { situation: changed(KEY.noFix, { estimatedAt: trafficInstant(-20) }) });
    expect(block()).toHaveTextContent('Llega 10:59 · ahora');
    cleanup();
    // The provider says it arrived before it gives a runway time: landed, at a time named as the planned one, uncounted.
    renderBlock({ kind: 'flight', id: KEY.noFix },
      { situation: changed(KEY.noFix, { phase: 'arrived', estimatedAt: trafficInstant(-180) }) });
    expect(block()).toHaveTextContent('Aterrizó · hora prevista 10:57');
    expect(block()).not.toHaveTextContent('hace');
    cleanup();
    // ZZ300's arrival has no time of its own, but its BLOCK_ON is recorded: on its stand since then.
    renderBlock({ kind: 'flight', id: KEY.parkedArrival },
      { situation: changed(KEY.parkedArrival, { actualAt: null, actualKind: null, phase: 'enroute' }) });
    expect(block()).toHaveTextContent('En posición 10:38 · hace 22 min');
    cleanup();

    // ZZ700 departed by the provider's word before its runway time: the past tense, as its stand line says.
    renderBlock({ kind: 'flight', id: KEY.departed },
      { situation: changed(KEY.departed, { actualAt: null, actualKind: null }) });
    expect(block()).toHaveTextContent('Salió · hora prevista 10:45');
    expect(block()).toHaveTextContent('Salió de la posición A3');
    expect(block()).not.toHaveTextContent('Sale');
    expect(block()).not.toHaveTextContent('hace');
    cleanup();
    // So does one that left before its planned time.
    renderBlock({ kind: 'flight', id: KEY.departure }, { situation: changed(KEY.departure, { phase: 'departed' }) });
    expect(block()).toHaveTextContent('Salió · hora prevista 12:15');
    expect(block()).toHaveTextContent('Salió de la posición A5');
    cleanup();
    // ZZ301 was due to leave ten minutes ago and is still on A2.
    renderBlock({ kind: 'flight', id: KEY.parkedDeparture },
      { situation: changed(KEY.parkedDeparture, { scheduledAt: trafficInstant(-600) }) });
    expect(block()).toHaveTextContent('Debía salir 10:50 · hace 10 min');
    expect(block()).toHaveTextContent('Posición A2');
    cleanup();

    // In English.
    act(() => resetLanguageForTests('en'));
    for (const [key, fields, words] of [
      [KEY.noFix, { estimatedAt: trafficInstant(-300) }, 'Was due to arrive 10:55 · 5 min ago'],
      [KEY.noFix, { phase: 'arrived', estimatedAt: trafficInstant(-180) }, 'Landed · planned time 10:57'],
      [KEY.departed, { actualAt: null, actualKind: null }, 'Departed · planned time 10:45'],
      [KEY.parkedDeparture, { scheduledAt: trafficInstant(-600) }, 'Was due to depart 10:50 · 10 min ago'],
    ]) {
      const situation = changed(key, fields);
      render(<LanguageScope><FlightDataBlock target={selectionTarget({ kind: 'flight', id: key }, situation)}
        telemetry={storeOf(situation)} station={STATION} /></LanguageScope>);
      expect(block(), words).toHaveTextContent(words);
      cleanup();
    }
  });

  it('speaks of the leg the chosen aircraft flies when a visit or a turnaround names both', () => {
    // After the stop-over the picture gives ZZ161's aircraft to its departure: it took off a minute ago as ZZZ162.
    const raw = createAirPicture();
    const picture = toPictureModel({ ...raw, aircraft: raw.aircraft.map(item => (item.hex === HEX.arrival
      ? { ...item, callsign: 'ZZZ162', matchedFlightKey: KEY.departure, matchedBy: 'Callsign', altitudeFeet: 3_400,
        verticalRateFeetPerMinute: 1_800 }
      : item)) });
    const legs = createMapFlights();
    const flights = toFlightsModel({ ...legs, flights: legs.flights.map(row => {
      if (row.flightKey === KEY.arrival) return { ...row, actualAt: trafficInstant(-3_600), actualKind: 'Runway', phase: 'landed' };
      if (row.flightKey === KEY.departure) return { ...row, actualAt: trafficInstant(-60), actualKind: 'Runway', phase: 'departed' };
      return row;
    }) });
    const situation = buildSituation({ picture, flights, nowMs: NOON });
    renderBlock({ kind: 'flight', id: flights.byKey.get(KEY.arrival).turnaroundId }, { situation });
    // The departure's number, route and time, with the telemetry of the aircraft that flies it.
    const dialog = screen.getByRole('dialog', { name: 'Vuelo ZZ162' });
    expect(dialog).toHaveTextContent('Salió 10:59 · hace 1 min');
    expect(dialog).toHaveTextContent('Salió de la posición A5');
    expect(within(dialog).getAllByText(/^(PUJ|MIA)$/).map(plate => plate.textContent)).toEqual(['PUJ', 'MIA']);
    expect(within(dialog).getByText('subiendo')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('Aterrizó');
  });

  it('says Vuelo demo and Sin importar when they apply', () => {
    // The demo pair, not imported yet: both marks, the suggested stand and runway 08; nothing to see in Planificación yet.
    renderBlock({ kind: 'flight', id: KEY.demoArrival });
    expect(within(block()).getByText('Vuelo demo')).toBeInTheDocument();
    expect(within(block()).getByText('Sin importar')).toBeInTheDocument();
    expect(block()).toHaveTextContent('Posición sugerida B21 · Pista 08');
    expect(within(block()).getByRole('button', { name: 'Ver escala' })).toBeDisabled();
    expect(within(block()).getByRole('link', { name: 'Ver posición' }))
      .toHaveAttribute('href', `/admin-occ/positions-map?stationId=${TRAFFIC_STATION_ID}&stand=B21`);
    cleanup();

    // An imported flight of AVIAM: neither mark, and both pages a link away.
    const { target } = renderBlock({ kind: 'flight', id: KEY.arrival });
    expect(within(block()).queryByText('Vuelo demo')).not.toBeInTheDocument();
    expect(within(block()).queryByText('Sin importar')).not.toBeInTheDocument();
    expect(within(block()).getByRole('link', { name: 'Ver escala' }))
      .toHaveAttribute('href', `/admin-occ/planning?stationId=${TRAFFIC_STATION_ID}&flightId=${target.flight.legId}`);
    expect(within(block()).getByRole('link', { name: 'Ver posición' }))
      .toHaveAttribute('href', `/admin-occ/positions-map?stationId=${TRAFFIC_STATION_ID}&stand=A5`);
    cleanup();

    // A demo flight the provider cancelled says so.
    renderBlock({ kind: 'flight', id: KEY.demoArrival }, { situation: noonSituation(row => (row.flightKey === KEY.demoArrival
      ? { ...row, phase: 'cancelled', providerStatus: 'Canceled', demo: { ...row.demo, state: 'Cancelled', phase: 'Gone' } }
      : null)) });
    expect(block()).toHaveTextContent('Cancelado por el proveedor (demo)');
    cleanup();

    // Other traffic is not a flight of ELEVANT: it says so, with no route, stand or action.
    renderBlock({ kind: 'aircraft', id: HEX.overflight });
    expect(within(block()).getByText('Otro tráfico')).toBeInTheDocument();
    expect(within(block()).queryByText('Vuelo demo')).not.toBeInTheDocument();
    expect(within(block()).queryByRole('link')).not.toBeInTheDocument();
    expect(within(block()).queryByRole('button', { name: 'Ver escala' })).not.toBeInTheDocument();
    expect(block()).not.toHaveTextContent('Posición');
    // A planning leg id names the turnaround; a proposal without a leg keeps its key; no flight, no link.
    expect(dataBlockLinks({ flightKey: 'l:leg-9', legId: null, imported: true, stand: null })).toEqual({
      turnaround: '/admin-occ/planning?flightId=l%3Aleg-9', stand: null });
    expect(dataBlockLinks(null)).toEqual({ turnaround: null, stand: null });
  });

  it('is a dialog named with the flight number and closes with its button', () => {
    const { onClose } = renderBlock({ kind: 'flight', id: KEY.arrival });
    const dialog = screen.getByRole('dialog', { name: 'Vuelo ZZ161' });
    expect(dialog).toBe(block());
    // Docked where the page puts it, and not modal: the map keeps its keys.
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog).toHaveStyle({ top: '12px', left: '12px' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    // Without a flight number, the callsign; without a callsign, the address.
    renderBlock({ kind: 'aircraft', id: HEX.overflight });
    expect(screen.getByRole('dialog', { name: 'Vuelo ZZZ804' })).toBeInTheDocument();
    cleanup();
    const situation = noonSituation();
    const overflight = situation.byId.get(`h:${HEX.overflight}`);
    render(<FlightDataBlock target={{ kind: 'aircraft', flight: null, aircraft: { ...overflight, callsign: null } }}
      telemetry={storeOf(situation)} />);
    expect(screen.getByRole('dialog', { name: `Vuelo ${HEX.overflight.toUpperCase()}` })).toBeInTheDocument();
    cleanup();
    // No target, no card.
    const { container } = render(<FlightDataBlock target={null} telemetry={storeOf(situation)} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();

    // In English.
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><FlightDataBlock target={selectionTarget({ kind: 'flight', id: KEY.arrival }, situation)}
      telemetry={storeOf(situation)} station={STATION} /></LanguageScope>);
    const english = screen.getByRole('dialog', { name: 'Flight ZZ161' });
    expect(within(english).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(english).toHaveTextContent('Arrives 11:10 · in 10 min');
    expect(english.querySelector('[data-source-line]')).toHaveTextContent('Live · 4 s ago');
  });

  it('updates the age without re-rendering the map', () => {
    const situation = noonSituation();
    const telemetry = storeOf(situation);
    const target = selectionTarget({ kind: 'flight', id: KEY.arrival }, situation);
    let mapRenders = 0;
    // A part of the map that renders whenever the map shares something new.
    function MapProbe() {
      useOccMap();
      mapRenders += 1;
      return null;
    }
    let pageRenders = 0;
    function Page() {
      pageRenders += 1;
      return (
        <OccMap defaultView="region" traffic={{ aircraft: situation.aircraft, trails: null, route: null, source: null }}
          selection={{ kind: 'flight', id: KEY.arrival }}>
          <MapProbe />
          <FlightDataBlock target={target} telemetry={telemetry} station={STATION} style={{ top: 12, left: 12 }} />
        </OccMap>
      );
    }
    render(<Page />);
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    expect(sourceLine()).toHaveTextContent('En vivo · hace 4 s');
    const before = { mapRenders, pageRenders, calls: map.calls.length };

    // The store ticks at 4 Hz: the card counts the seconds up on its own.
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(sourceLine()).toHaveTextContent('En vivo · hace 5 s');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(sourceLine()).toHaveTextContent('En vivo · hace 8 s');
    // Neither the page, nor the map and what it shares, nor the engine heard of it.
    expect({ mapRenders, pageRenders, calls: map.calls.length }).toEqual(before);
  });
});
