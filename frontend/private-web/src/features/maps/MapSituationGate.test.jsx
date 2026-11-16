import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatedOccMapAdapter } from '../../services/occMapService';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { MDPC_LAYOUT } from './airport/airportLayout';
import MapSituationGate, { MapSituationOverlays, trafficSelectionOf } from './MapSituationGate';
import {
  createTrafficScenario, TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX, TRAFFIC_NOON, TRAFFIC_STATION_ID,
} from './testing/trafficFixtures';

// The session of the OCC frame: the station of the traffic fixtures (synthetic).
const auth = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => {
    auth.calls += 1;
    return { session: { stationScopes: [{ stationId: '5a000000-0000-4000-8000-000000000001', stationCode: 'PUJ' }] } };
  },
}));

const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
// A service whose every read is a spy: outside the frame none may be called.
const spyService = () => ({
  clock: createSimulatedOccMapAdapter().clock,
  getAirPicture: vi.fn(), getMapFlights: vi.fn(), getAircraftTrack: vi.fn(), ping: vi.fn(),
});
const flush = (ms = 0) => act(async () => {
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(ms);
});

function Probe({ live }) {
  return (
    <pre data-testid="live">
      {JSON.stringify(live === null ? null : {
        status: live.status, stationId: live.stationId, layout: live.layout === MDPC_LAYOUT,
        aircraft: live.traffic.aircraft.map(item => item.id).sort(), target: live.target?.flight?.flightKey ?? null,
        motion: typeof live.traffic.motion?.sample === 'function',
      })}
    </pre>
  );
}
const probe = () => JSON.parse(screen.getByTestId('live').textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse(TRAFFIC_NOON));
  auth.calls = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('MapSituationGate', () => {
  it('outside the OCC frame gives nothing and reads nothing', async () => {
    const service = spyService();
    const children = vi.fn(live => <Probe live={live} />);
    render(<MapSituationGate selection={{ kind: 'flight', id: TRAFFIC_FLIGHT_KEY.arrival }} service={service}>{children}</MapSituationGate>);
    // At once, without a fallback: the screen renders as it did before the live traffic.
    expect(probe()).toBeNull();
    await flush(60_000);
    expect(children).toHaveBeenCalled();
    expect(children.mock.calls.every(([live]) => live === null)).toBe(true);
    for (const read of ['getAirPicture', 'getMapFlights', 'getAircraftTrack', 'ping']) expect(service[read], read).not.toHaveBeenCalled();
    // Not even the session is read: an isolated screen has none.
    expect(auth.calls).toBe(0);
  });

  it('inside the frame reads the station of the session and gives the live situation, after its fallback', async () => {
    const service = createSimulatedOccMapAdapter({ scenario: createTrafficScenario() });
    render(
      <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
        <OccShellTestProvider>
          <MapSituationGate selection={{ kind: 'flight', id: TRAFFIC_FLIGHT_KEY.arrival }} service={service}
            fallback={<p role="status">Cargando el mapa…</p>}>
            {live => <Probe live={live} />}
          </MapSituationGate>
        </OccShellTestProvider>
      </DepartmentAccessProvider>,
    );
    // The live chunk loads first: the screen's own loading state meanwhile, never a map without its traffic.
    expect(screen.getByRole('status')).toHaveTextContent('Cargando el mapa…');
    await flush();
    await flush();
    expect(probe()).toMatchObject({
      status: 'success', stationId: TRAFFIC_STATION_ID, layout: true, motion: true, target: TRAFFIC_FLIGHT_KEY.arrival,
    });
    // The aircraft of the picture and the ELEVANT flights the map draws.
    expect(probe().aircraft).toEqual(expect.arrayContaining([`f:${TRAFFIC_FLIGHT_KEY.arrival}`, `h:${TRAFFIC_HEX.overflight}`]));
    // The reads of the station of the session, and the chosen flight's track.
    const reads = service.calls.map(call => call.read);
    expect(reads).toEqual(expect.arrayContaining(['airPicture', 'mapFlights', 'aircraftTrack', 'ping']));
    expect(service.calls.filter(call => call.read !== 'ping').every(call => call.stationId === TRAFFIC_STATION_ID)).toBe(true);
    expect(service.calls.find(call => call.read === 'aircraftTrack')).toMatchObject({ hex: TRAFFIC_HEX.arrival });
  });

  it('passes on only a flight or an aircraft of the URL selection', () => {
    expect(trafficSelectionOf({ kind: 'flight', id: 'p:x' })).toEqual({ kind: 'flight', id: 'p:x' });
    expect(trafficSelectionOf({ kind: 'aircraft', id: 'f0a002' })).toEqual({ kind: 'aircraft', id: 'f0a002' });
    for (const selection of [{ kind: 'stand', id: 'A5' }, null, undefined]) expect(trafficSelectionOf(selection)).toBeNull();
  });

  it('MapSituationOverlays shows the traffic state and the docked data block of the chosen flight, nothing without live', async () => {
    const service = createSimulatedOccMapAdapter({ scenario: createTrafficScenario() });
    const onClose = vi.fn();
    const { rerender, container } = render(<MapSituationOverlays live={null} onClose={onClose} />);
    expect(container).toBeEmptyDOMElement();
    const frame = blockStyle => (
      <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
        <OccShellTestProvider>
          <MapSituationGate selection={{ kind: 'flight', id: TRAFFIC_FLIGHT_KEY.arrival }} service={service}>
            {live => <MapSituationOverlays live={live} onClose={onClose} blockStyle={blockStyle} />}
          </MapSituationGate>
        </OccShellTestProvider>
      </DepartmentAccessProvider>
    );
    rerender(frame(undefined));
    await flush();
    await flush();
    // Docked at the top left by default, named with the flight number. The traffic is live and no map draws it here, so
    // its state has nothing to say and no credit to give (inside an OccMap the credit shows: FlightMap.test.jsx).
    const block = screen.getByRole('dialog', { name: 'Vuelo ZZ161' });
    expect(block).toHaveStyle({ top: '12px', left: '12px' });
    expect(screen.queryByRole('status', { name: 'Estado del tráfico' })).not.toBeInTheDocument();
    // Outside an OccMap nothing can be followed: no «Seguir».
    expect(within(block).queryByRole('button', { name: 'Seguir' })).not.toBeInTheDocument();
    // Its «Cerrar» is the screen's.
    act(() => within(block).getByRole('button', { name: 'Cerrar' }).click());
    expect(onClose).toHaveBeenCalledOnce();
    // A screen that keeps the corner for its tools docks it elsewhere.
    rerender(frame({ top: 12, left: 56 }));
    expect(screen.getByRole('dialog', { name: 'Vuelo ZZ161' })).toHaveStyle({ left: '56px' });
  });
});
