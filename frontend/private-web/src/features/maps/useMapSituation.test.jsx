import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatedOccMapAdapter } from '../../services/occMapService';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { sampleTrajectory } from './kinematics/estimator';
import {
  createAirPicture, createMapFlights, createTrafficScenario, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX,
  TRAFFIC_NOON, TRAFFIC_STATION_ID,
} from './testing/trafficFixtures';
import { MAP_PERMISSIONS, PING_MIN_INTERVAL_MS, useMapSituation } from './useMapSituation';

const NOON = Date.parse(TRAFFIC_NOON);
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const member = permissions => ({ ...ACCESS, kind: 'Member', canManageDepartmentUsers: false, permissions });
const WITHOUT_MAP = member(ACCESS.permissions.filter(code => !MAP_PERMISSIONS.includes(code)));
const refused = (status, code) => Object.assign(new Error('refused'), { status, code });

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

// Moves the fake clock and lets every answer and render that falls due settle.
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function setup(props = {}, { access = ACCESS, shell = createOccShellValue(), scenario = createTrafficScenario(),
  service } = {}) {
  const adapter = service ?? createSimulatedOccMapAdapter({ scenario });
  const wrapper = ({ children }) => (
    <DepartmentAccessProvider initialAccess={access} load={vi.fn().mockResolvedValue(access)} observe={false}>
      <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>
    </DepartmentAccessProvider>
  );
  const hook = renderHook(current => useMapSituation(current),
    { wrapper, initialProps: { stationId: TRAFFIC_STATION_ID, service: adapter, ...props } });
  return { ...hook, adapter, shell };
}

const readsOf = (adapter, read) => adapter.calls.filter(call => call.read === read);
const countOf = (adapter, read) => readsOf(adapter, read).length;
const airTraffic = shell => shell.sourceStore.getSnapshot().find(item => item.id === 'airTraffic') ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOON);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  cleanup();
  delete document.visibilityState;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useMapSituation (contracts 1.3 and 2.7)', () => {
  it('asks the air picture with trails=short once, then none, every refreshAfterSeconds', async () => {
    const { adapter, result, rerender } = setup();
    await flush();
    expect(readsOf(adapter, 'airPicture').map(call => call.trails)).toEqual(['short']);
    expect(result.current.status).toBe('success');
    // The short trail drew the ELEVANT arrival's trail at once.
    expect(result.current.trails.features.map(feature => feature.properties.hex)).toEqual([HEX.arrival]);

    await flush(30_000);
    const pictures = readsOf(adapter, 'airPicture');
    expect(pictures.map(call => call.trails)).toEqual(['short', 'none', 'none', 'none']);
    expect(pictures.map(call => call.at - NOON)).toEqual([0, 10_000, 20_000, 30_000]);
    expect(pictures.every(call => call.stationId === TRAFFIC_STATION_ID)).toBe(true);
    expect(result.current.picture).toMatchObject({ status: 'Live', refreshAfterSeconds: 10 });

    // Another station asks its own short trail first, and starts its trails again.
    const other = '5a000000-0000-4000-8000-000000000002';
    rerender({ stationId: other, service: adapter });
    await flush(10_000);
    expect(readsOf(adapter, 'airPicture').filter(call => call.stationId === other).map(call => call.trails))
      .toEqual(['short', 'none']);
    expect(result.current.picture.stationId).toBe(other);
  });

  it('never asks faster than refreshAfterSeconds', async () => {
    const slow = setup({}, { scenario: createTrafficScenario({ picture: createAirPicture({ refreshAfterSeconds: 30 }) }) });
    await flush(95_000);
    expect(readsOf(slow.adapter, 'airPicture').map(call => call.at - NOON)).toEqual([0, 30_000, 60_000, 90_000]);
    cleanup();

    // While the server warms up it asks again in 2 s, and the hook follows it.
    const warmingStart = Date.now();
    const warming = setup({}, { scenario: createTrafficScenario({ picture: createAirPicture({ status: 'Warming' }) }) });
    await flush(5_000);
    expect(readsOf(warming.adapter, 'airPicture').map(call => call.at - warmingStart)).toEqual([0, 2_000, 4_000]);
    cleanup();

    // Failed reads wait longer each time: 20 s, 40 s, then a minute at most.
    const simulated = createSimulatedOccMapAdapter({ scenario: createTrafficScenario() });
    const asked = [];
    const failing = { ...simulated, getAirPicture: vi.fn(async () => {
      asked.push(Date.now());
      throw refused(503);
    }) };
    const failingStart = Date.now();
    const down = setup({}, { service: failing });
    await flush(185_000);
    expect(asked.map(at => at - failingStart)).toEqual([0, 20_000, 60_000, 120_000, 180_000]);
    // The flights answered all along: the map keeps them, and only the source says that the traffic is offline.
    expect(down.result.current).toMatchObject({ status: 'success', picture: null, sourceState: 'offline' });
    expect(down.result.current.situation.flights).toHaveLength(8);
  });

  it('pauses both reads while the tab is hidden and reads once when it shows again', async () => {
    const { adapter, shell } = setup();
    await flush();
    const counts = () => ({ airPicture: countOf(adapter, 'airPicture'), mapFlights: countOf(adapter, 'mapFlights'),
      ping: countOf(adapter, 'ping') });
    expect(counts()).toEqual({ airPicture: 1, mapFlights: 1, ping: 1 });

    setVisibility('hidden');
    await flush(120_000);
    act(() => shell.announce(['occ_planning']));
    await flush(5_000);
    expect(counts()).toEqual({ airPicture: 1, mapFlights: 1, ping: 1 });

    setVisibility('visible');
    await flush();
    // One picture, one flights read for the poll and the announcement it missed, and the clock asked again.
    expect(counts()).toEqual({ airPicture: 2, mapFlights: 2, ping: 2 });
    await flush(9_000);
    expect(counts()).toEqual({ airPicture: 2, mapFlights: 2, ping: 2 });

    // Back after a short absence the clock is not asked again.
    setVisibility('hidden');
    await flush(PING_MIN_INTERVAL_MS - 20_000);
    setVisibility('visible');
    await flush();
    expect(counts().ping).toBe(2);
  });

  it('re-reads the flights on occ_planning at most once every 3 s and every 60 s otherwise', async () => {
    const { adapter, shell } = setup();
    await flush(10_000);
    expect(countOf(adapter, 'mapFlights')).toBe(1);

    for (const wait of [0, 200, 200, 200, 200]) {
      await flush(wait);
      act(() => shell.announce(['occ_planning']));
    }
    // One read at once, one trailing read for the other four.
    expect(countOf(adapter, 'mapFlights')).toBe(2);
    await flush(3_000);
    expect(readsOf(adapter, 'mapFlights').map(call => call.at - NOON)).toEqual([0, 10_000, 13_000]);
    // Other resources are not the map's business.
    act(() => shell.announce(['notifications', 'occ_review']));
    await flush(56_000);
    expect(countOf(adapter, 'mapFlights')).toBe(3);
    // The safety poll, a minute after the last read.
    await flush(4_000);
    expect(readsOf(adapter, 'mapFlights').map(call => call.at - NOON)).toEqual([0, 10_000, 13_000, 73_000]);
    // The air picture keeps its own pace.
    expect(readsOf(adapter, 'airPicture').map(call => call.at - NOON).slice(0, 3)).toEqual([0, 10_000, 20_000]);
  });

  it('carries Disabled, Unavailable, Stale and Warming as data, never as an error', async () => {
    // Without live traffic the AVIAM flights F-1 draws are estimated from the schedule (PR M6): ZZ161 approaching,
    // ZZ300 parked, ZZ500 en route, ZZ700 leaving and the demo flight. A Stale picture still draws its six fixes, ZZ161
    // among them.
    const cases = [
      ['Disabled', 'not_configured', 'unconfigured', 0, 5],
      ['Unavailable', 'provider_error', 'offline', 0, 5],
      ['Stale', 'provider_error', 'delayed', 6, 4],
      ['Warming', null, 'idle', 0, 5],
    ];
    for (const [status, reason, source, fixes, estimated] of cases) {
      const shell = createOccShellValue();
      const { result } = setup({}, { shell, scenario: createTrafficScenario({ picture: createAirPicture({ status }) }) });
      await flush();
      expect(result.current.status, status).toBe('success');
      expect(result.current.picture, status).toMatchObject({ status, reason });
      expect(result.current.situation, status).toMatchObject({ status, reason });
      const { aircraft } = result.current.situation;
      expect(aircraft.filter(item => item.hex !== null), status).toHaveLength(fixes);
      expect(aircraft.filter(item => item.quality === 'estimated'), status).toHaveLength(estimated);
      expect(aircraft, status).toHaveLength(fixes + estimated);
      if (status === 'Stale') expect(aircraft.filter(item => item.hex !== null).every(item => item.quality === 'stale')).toBe(true);
      expect(airTraffic(shell), status).toMatchObject({ state: source, detail: reason });
      cleanup();
      expect(airTraffic(shell), `${status} after unmount`).toBeNull();
    }

    // Live: the source is current, from the instant the network described, and its tags say that the map also draws
    // estimated positions and a demo flight (contracts 2.5).
    const shell = createOccShellValue();
    setup({}, { shell });
    await flush();
    expect(airTraffic(shell)).toMatchObject({ state: 'ok', at: NOON - 2_000, detail: null, tags: ['demo', 'estimated'] });
  });

  it('reports loading, success, empty, recoverable error with retry, and unauthorized without a request', async () => {
    // Loading until both reads answered, then success.
    const slow = createSimulatedOccMapAdapter({ scenario: createTrafficScenario(), latencyMs: 500 });
    const loading = setup({}, { service: slow });
    expect(loading.result.current).toMatchObject({ status: 'loading', picture: null, flights: null });
    await flush(500);
    expect(loading.result.current.status).toBe('success');
    expect(loading.result.current.situation.byId.get(`f:${KEY.arrival}`).hex).toBe(HEX.arrival);
    cleanup();

    // Nothing in the sky and no flight: empty.
    const quiet = setup({}, { scenario: createTrafficScenario({ picture: createAirPicture({ aircraft: [] }),
      flights: createMapFlights({ flights: [] }) }) });
    await flush();
    expect(quiet.result.current.status).toBe('empty');
    cleanup();

    // A failed first read is a recoverable error; retry() reads both again.
    const simulated = createSimulatedOccMapAdapter({ scenario: createTrafficScenario() });
    const flaky = { ...simulated,
      getMapFlights: vi.fn().mockRejectedValueOnce(refused(503)).mockImplementation(simulated.getMapFlights) };
    const broken = setup({}, { service: flaky });
    await flush();
    expect(broken.result.current.status).toBe('error');
    act(() => broken.result.current.retry());
    await flush();
    expect(broken.result.current.status).toBe('success');
    expect(flaky.getMapFlights).toHaveBeenCalledTimes(2);
    expect(countOf(simulated, 'airPicture')).toBe(2);
    cleanup();

    // Each read fails alone: an air picture that fails (a 503) while the flights answer leaves the map with its
    // flights and no live aircraft (only the estimated AVIAM flights); the source list says that the traffic is
    // offline, and retry() asks for it again.
    const offlineShell = createOccShellValue();
    const noPicture = { ...simulated,
      getAirPicture: vi.fn().mockRejectedValueOnce(refused(503)).mockImplementation(simulated.getAirPicture) };
    const unavailable = setup({}, { service: noPicture, shell: offlineShell });
    await flush();
    expect(unavailable.result.current).toMatchObject({ status: 'success', picture: null, sourceState: 'offline' });
    expect(unavailable.result.current.situation.flights).toHaveLength(8);
    expect(unavailable.result.current.situation.aircraft.every(item => item.quality === 'estimated' && item.hex === null))
      .toBe(true);
    expect(unavailable.result.current.situation.aircraft).toHaveLength(5);
    expect(airTraffic(offlineShell)).toMatchObject({ state: 'offline' });
    act(() => unavailable.result.current.retry());
    await flush();
    expect(unavailable.result.current)
      .toMatchObject({ status: 'success', sourceState: 'ok', picture: { status: 'Live' } });
    expect(noPicture.getAirPicture).toHaveBeenCalledTimes(2);
    cleanup();

    // Without a map permission: unauthorized, and nothing is asked, not even the clock.
    const shell = createOccShellValue();
    const denied = setup({}, { access: WITHOUT_MAP, shell });
    await flush(60_000);
    expect(denied.result.current.status).toBe('unauthorized');
    expect(denied.adapter.calls).toEqual([]);
    expect(airTraffic(shell)).toMatchObject({ state: 'forbidden' });
    cleanup();

    // Any one of the four permissions opens the map.
    const monitoring = setup({}, { access: member(['operations.flight_monitoring.read']) });
    await flush();
    expect(monitoring.result.current.status).toBe('success');
    cleanup();

    // A 401 on the flights is unauthorized; a station without an air picture (404) keeps its flights.
    const expired = setup({}, { service: { ...simulated, getMapFlights: vi.fn().mockRejectedValue(refused(401)) } });
    await flush();
    expect(expired.result.current.status).toBe('unauthorized');
    cleanup();
    // While the flights are on their way the refusal is not judged; once they answer, the source list says that the
    // environment does not provide live traffic at this station, never that the account may not read it, and the
    // refused picture is not asked again.
    const notFound = () => vi.fn().mockRejectedValue(refused(404, 'not_found'));
    const pending = () => new Promise(() => {});
    const waiting = setup({}, { service: { ...simulated, getAirPicture: notFound(), getMapFlights: pending } });
    await flush();
    expect(waiting.result.current).toMatchObject({ status: 'loading', sourceState: 'idle' });
    cleanup();
    const elsewhereShell = createOccShellValue();
    const noTraffic = { ...simulated, getAirPicture: notFound() };
    const elsewhere = setup({}, { service: noTraffic, shell: elsewhereShell });
    await flush();
    expect(elsewhere.result.current).toMatchObject({ status: 'success', picture: null, sourceState: 'unconfigured' });
    expect(elsewhere.result.current.situation.aircraft.filter(item => item.quality !== 'estimated')).toEqual([]);
    expect(airTraffic(elsewhereShell)).toMatchObject({ state: 'unconfigured' });
    await flush(60_000);
    expect(noTraffic.getAirPicture).toHaveBeenCalledTimes(1);
    cleanup();

    // No station: nothing is read.
    const idle = setup({ stationId: null });
    await flush(10_000);
    expect(idle.result.current.status).toBe('idle');
    expect(idle.adapter.calls).toEqual([]);
  });

  it('feeds the server clock from serverTime and the ping', async () => {
    // The simulated server runs five minutes ahead of this browser.
    const ahead = () => createSimulatedOccMapAdapter({ scenario: createTrafficScenario(), now: () => Date.now() + 300_000 });
    const adapter = ahead();
    const { result } = setup({}, { service: adapter });
    await flush();
    expect(result.current.clock).toBe(adapter.clock);
    expect(adapter.clock.offsetMs()).toBe(300_000);
    expect(result.current.clock.now()).toBe(Date.now() + 300_000);
    expect(countOf(adapter, 'ping')).toBe(1);
    // The situation is drawn at the server's time: the arrival's fix is 4 s old there.
    expect(result.current.situation.byId.get(`f:${KEY.arrival}`).ageS).toBe(4);
    cleanup();

    // While the map reads have not answered, the ping alone sets the clock.
    const pinged = ahead();
    const pending = () => new Promise(() => {});
    setup({}, { service: { ...pinged, getAirPicture: pending, getMapFlights: pending } });
    await flush();
    expect(pinged.clock.isSynced()).toBe(true);
    expect(pinged.clock.offsetMs()).toBe(300_000);
  });

  it('reads the track once when an aircraft is chosen', async () => {
    const { adapter, result, rerender } = setup();
    await flush();
    expect(countOf(adapter, 'aircraftTrack')).toBe(0);
    expect(result.current.track).toBeNull();

    rerender({ stationId: TRAFFIC_STATION_ID, service: adapter, selectedHex: HEX.overflight.toUpperCase() });
    await flush();
    expect(readsOf(adapter, 'aircraftTrack').map(call => call.hex)).toEqual([HEX.overflight]);
    expect(result.current.track).toMatchObject({ hex: HEX.overflight });
    expect(result.current.track.points).toHaveLength(30);
    // The chosen aircraft's trail is drawn whole, from the track.
    const drawn = result.current.trails.features.filter(feature => feature.properties.hex === HEX.overflight);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].properties).toMatchObject({ kind: 'other', selected: true });
    expect(drawn[0].geometry.coordinates.length).toBeGreaterThanOrEqual(30);

    // The same choice, and the picture's polls, read nothing more.
    rerender({ stationId: TRAFFIC_STATION_ID, service: adapter, selectedHex: HEX.overflight });
    await flush(30_000);
    expect(countOf(adapter, 'aircraftTrack')).toBe(1);

    // Another aircraft is read once; no choice reads nothing and shows no track.
    rerender({ stationId: TRAFFIC_STATION_ID, service: adapter, selectedHex: HEX.arrival });
    await flush();
    expect(readsOf(adapter, 'aircraftTrack').map(call => call.hex)).toEqual([HEX.overflight, HEX.arrival]);
    expect(result.current.track.hex).toBe(HEX.arrival);
    rerender({ stationId: TRAFFIC_STATION_ID, service: adapter, selectedHex: null });
    await flush();
    expect(result.current.track).toBeNull();
    expect(countOf(adapter, 'aircraftTrack')).toBe(2);

    // An aircraft the server no longer remembers (404) leaves the trail as the pictures drew it.
    rerender({ stationId: TRAFFIC_STATION_ID, service: adapter, selectedHex: 'abcdef' });
    await flush();
    expect(result.current.track).toBeNull();
    expect(result.current.status).toBe('success');
  });

  it('names what the selection chooses, reads its aircraft track once and gives its route and telemetry', async () => {
    const props = selection => ({ stationId: TRAFFIC_STATION_ID, service: adapter, selection });
    const { adapter, result, rerender } = setup({ selection: { kind: 'flight', id: KEY.arrival } });
    await flush();
    expect(result.current.target).toMatchObject({ kind: 'flight', flight: { flightKey: KEY.arrival },
      aircraft: { id: `f:${KEY.arrival}`, hex: HEX.arrival } });
    // The flight's aircraft is the chosen one: its track is read once, and the route draws what it flew (the trail with
    // the track) and the straight line to its stand.
    expect(readsOf(adapter, 'aircraftTrack').map(call => call.hex)).toEqual([HEX.arrival]);
    expect(result.current.track).toMatchObject({ hex: HEX.arrival });
    const [flown, next] = result.current.route.features;
    expect(result.current.route.features.map(feature => feature.properties.part)).toEqual(['flown', 'next']);
    expect(flown.geometry.coordinates.length).toBeGreaterThanOrEqual(30);
    expect(next.properties).toMatchObject({ hex: HEX.arrival, to: 'stand' });
    // The telemetry store holds the situation's aircraft for the data block, where the map draws it (PR M6): the fix is
    // 4 s old at noon, so 768 ft/min down from 2 600 ft it reads 2 549 ft.
    expect(result.current.telemetry.telemetryOf(`f:${KEY.arrival}`)).toMatchObject({ altFt: 2_549, gsKt: 150, quality: 'live',
      mode: 'live' });
    await flush(30_000);
    expect(countOf(adapter, 'aircraftTrack')).toBe(1);

    // Other traffic by its address: its own track, its route without a next point.
    rerender(props({ kind: 'aircraft', id: HEX.overflight }));
    await flush();
    expect(result.current.target).toMatchObject({ kind: 'aircraft', flight: null, aircraft: { hex: HEX.overflight } });
    expect(readsOf(adapter, 'aircraftTrack').map(call => call.hex)).toEqual([HEX.arrival, HEX.overflight]);
    expect(result.current.route.features.map(feature => feature.properties.part)).toEqual(['flown']);

    // A flight without a position (ZZ162 waits for its push-back: F-1 draws no estimate of it): no aircraft, no route
    // and no read; nothing chosen, nothing named.
    rerender(props({ kind: 'flight', id: KEY.departure }));
    await flush();
    expect(result.current.target).toMatchObject({ kind: 'flight', aircraft: null });
    expect(result.current.route.features).toEqual([]);
    expect(result.current.track).toBeNull();
    rerender(props(null));
    await flush();
    expect(result.current.target).toBeNull();
    expect(countOf(adapter, 'aircraftTrack')).toBe(2);
  });

  it('estimates the demo flight from its trajectory', async () => {
    const { result } = setup();
    await flush();
    const { situation, motion } = result.current;
    // ZZ9001 appeared 3 minutes ago for its stand in 8: on the 08 final, drawn where its fitted trajectory has it.
    const demo = situation.byId.get(`f:${KEY.demoArrival}`);
    expect(demo).toMatchObject({ kind: 'aviam', isDemo: true, quality: 'estimated', hex: null, onGround: false,
      mode: 'estimate', statusKey: null, timeScale: 1, opacity: 1 });
    const trajectory = motion.trajectoryOf(KEY.demoArrival);
    expect(trajectory.meta).toMatchObject({ runwayIdent: '08', departureRunwayIdent: '08', standCode: null, apronHoldId: 'ah-b' });
    const sample = sampleTrajectory(trajectory, NOON);
    expect([demo.lon, demo.lat]).toEqual([sample.lon, sample.lat]);
    // Its data block reads it where the map draws it, on the render clock.
    expect(result.current.telemetry.telemetryOf(demo.id)).toMatchObject({ quality: 'estimated', mode: 'estimate',
      runwayIdent: '08', runwaySource: 'demo', onGround: false });
    // ZZ161 has its fix: drawn live, never estimated; the situation's next change is the motion store's next instant.
    expect(situation.byId.get(`f:${KEY.arrival}`)).toMatchObject({ quality: 'live', mode: null });
    expect(situation.changesAt).toBe(Math.min(motion.nextChangeAt(NOON), NOON - 8_000 + 30_001));
  });

  it('returns the traffic with its motion', async () => {
    const { result, rerender, adapter } = setup();
    await flush();
    const { traffic, motion, renderClock, situation, trails, route } = result.current;
    expect(traffic).toEqual({ aircraft: situation.aircraft, trails, route, source: situation.source, motion });
    expect(Object.isFrozen(traffic)).toBe(true);
    // The motion draws on the render clock, which follows the clock the reads feed.
    expect(motion.clock).toBe(renderClock);
    expect(renderClock.now()).toBe(result.current.clock.now());
    expect(motion.dataAt()).toBe(NOON);
    // A render that changes nothing keeps the same objects; the same motion for the hook's whole life.
    rerender({ stationId: TRAFFIC_STATION_ID, service: adapter });
    expect(result.current.traffic).toBe(traffic);
    await flush(10_000);
    expect(result.current.motion).toBe(motion);
    expect(result.current.traffic.motion).toBe(motion);
    expect(result.current.traffic).not.toBe(traffic);
  });

  it('pausing the render clock keeps reading', async () => {
    const { result, adapter } = setup();
    await flush();
    const { renderClock, telemetry } = result.current;
    const demoId = `f:${KEY.demoArrival}`;
    telemetry.subscribe(() => {});
    act(() => renderClock.pause());
    expect(renderClock.isPaused()).toBe(true);
    expect(renderClock.pausedAt()).toBe(NOON);
    const frozen = telemetry.telemetryOf(demoId);
    // Thirty seconds on, the reads go on at their pace and the situation follows the server's time...
    await flush(30_000);
    expect(countOf(adapter, 'airPicture')).toBe(4);
    expect(result.current.picture.serverTime).toBe(NOON + 30_000);
    expect(result.current.situation.byId.get(`f:${KEY.arrival}`).ageS).toBe(4);
    // ...while the map draws the paused instant: the telemetry the data block reads stays where it was.
    expect(renderClock.now()).toBe(NOON);
    expect(telemetry.getSnapshot().nowMs).toBe(NOON);
    expect(telemetry.telemetryOf(demoId)).toMatchObject({ altFt: frozen.altFt, gsKt: frozen.gsKt });
    // Resumed, it draws the server's time again.
    act(() => renderClock.resume());
    expect(renderClock.now()).toBe(NOON + 30_000);
  });
});
