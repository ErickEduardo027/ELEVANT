import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { haversineM } from '../airport/geo';
import { ORBIT, ORBIT_VIEWS } from '../kinematics/orbitCamera';
import {
  createAirPicture, createDemoBlock, createDemoFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { createMotionStore } from '../traffic/motionStore';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import Follow3dPanel from '../ui/Follow3dPanel';
import { MODE_3D_STORAGE_KEY } from './aircraft3d';
import { createRenderClock } from './frameLoop';
import OccMap from './OccMap';
import { useOccMap } from './OccMapContext';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

// «Seguir en 3D» (CN-30) on the fake MapLibre: the camera orbits the demo flight as its pivot every frame, the person's
// gestures and the panel's buttons turn, tilt and zoom it without ending follow mode, and «Dejar de seguir», Esc or
// another choice end it and fly the camera back.

const fake = sharedFakeMapLibre();
const PAGE = '/admin-occ/dashboard?stationId=s-1';
const DEMO_ID = `f:${KEY.demoArrival}`;
const query = () => new URLSearchParams(window.location.search);
const angle = (a, b) => Math.abs(((b - a + 540) % 360) - 180);

function controlledFrames() {
  const frames = new Map();
  let next = 1;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    const handle = next++;
    frames.set(handle, callback);
    return handle;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(handle => { frames.delete(handle); });
  return {
    run: () => {
      const due = [...frames.values()];
      frames.clear();
      act(() => due.forEach(callback => callback(0)));
      return due.length;
    },
  };
}

function Follow3dProbe() {
  const { follow } = useOccMap();
  const three = follow.three;
  return (
    <>
      <pre data-testid="three-probe">{JSON.stringify({ on: three?.on ?? false, view: three?.view ?? null,
        following: follow.following })}</pre>
      <button type="button" onClick={() => three.start()}>start</button>
    </>
  );
}
const threeProbe = () => JSON.parse(screen.getByTestId('three-probe').textContent);

// The demo flight on its approach, chosen, on a map whose frames and server time the test moves.
function renderFollow3d({ appearS = 200 } = {}) {
  const frames = controlledFrames();
  const block = createDemoBlock({ appearAt: Date.parse(TRAFFIC_NOON) - appearS * 1_000, imported: true });
  const response = createDemoFlights(block, { imported: true, standCode: 'A6' });
  const flights = { ...response, flights: response.flights.filter(row => row.isDemo) };
  const server = { at: Date.parse(TRAFFIC_NOON), now() { return this.at; } };
  const clock = createRenderClock({ clock: server });
  const motion = createMotionStore({ clock });
  const pictureModel = toPictureModel(createAirPicture({ status: 'Disabled' }));
  const flightsModel = toFlightsModel(flights);
  motion.ingest({ picture: pictureModel, flights: flightsModel });
  const situation = buildSituation({ picture: pictureModel, flights: flightsModel, nowMs: server.now(),
    estimates: motion.estimatesAt(server.now()), estimatesChangeAt: motion.nextChangeAt(server.now()) });
  const traffic = { aircraft: situation.aircraft, trails: { type: 'FeatureCollection', features: [] }, route: null,
    source: null, motion };
  const element = selection => (
    <LanguageScope>
      <OccMap defaultView="airfield" basemap={false} traffic={traffic} selection={selection}>
        <Follow3dProbe />
        <Follow3dPanel flights={flightsModel.flights} />
      </OccMap>
    </LanguageScope>
  );
  const view = render(element({ kind: 'flight', id: KEY.demoArrival }));
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  frames.run();
  return {
    map, frames, server, motion, view, root: screen.getByTestId('occ-map'),
    rerender: selection => view.rerender(element(selection)),
    aircraftAt: () => map.getSource('occ-traffic').data.features.find(feature => feature.properties.id === DEMO_ID),
    seconds: (count, step = 100) => {
      for (let ms = 0; ms < count * 1_000; ms += step) {
        server.at += step;
        frames.run();
      }
    },
  };
}

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(MODE_3D_STORAGE_KEY);
  resetLanguageForTests('es');
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OccMap «Seguir en 3D» (CN-30)', () => {
  it('orbits the followed aircraft as its pivot, behind it on its track, and hands MapLibre\'s gestures to the orbit', () => {
    const { map, seconds, aircraftAt } = renderFollow3d();
    const before = map.getCenter().toArray();
    expect(map.dragPan.isEnabled()).toBe(true);
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    expect(threeProbe()).toEqual({ on: true, view: 'chase', following: true });
    expect(query().get('follow')).toBe('1');
    expect(map.dragPan.isEnabled()).toBe(false);
    expect(map.scrollZoom.isEnabled()).toBe(false);
    expect(map.getMaxPitch()).toBe(85);
    expect(map.getCenterClampedToGround()).toBe(false);
    // The fly-in, then every frame on the aircraft where the frame drew it, its height as the centre's elevation.
    seconds(2);
    const feature = aircraftAt();
    const drawn = feature.geometry.coordinates;
    expect(haversineM(map.getCenter().toArray(), drawn)).toBeLessThan(0.5);
    expect(haversineM(map.getCenter().toArray(), before)).toBeGreaterThan(10);
    expect(angle(map.getBearing(), feature.properties.trk)).toBeLessThan(3);
    expect(map.getPitch()).toBeCloseTo(ORBIT_VIEWS.chase.pitch, 0);
    expect(map.getZoom()).toBeCloseTo(ORBIT_VIEWS.chase.zoom, 1);
    expect(map.getCenterElevation()).toBeGreaterThan(0);
    // The panel: the flight, its instruments and the camera.
    expect(screen.getByTestId('follow-3d-panel')).toHaveAttribute('data-follow-view', 'chase');
    expect(screen.getByRole('radio', { name: 'Persecución' })).toHaveAttribute('aria-checked', 'true');
    // The aircraft moves on: the camera stays on it, every frame.
    const jumps = map.cameraCalls.filter(call => call.method === 'jumpTo').length;
    seconds(1);
    expect(map.cameraCalls.filter(call => call.method === 'jumpTo').length - jumps).toBeGreaterThanOrEqual(9);
    expect(haversineM(map.getCenter().toArray(), aircraftAt().geometry.coordinates)).toBeLessThan(0.5);
  });

  it('turns, tilts and zooms from the panel and by a drag without ending follow mode', () => {
    const { map, seconds } = renderFollow3d();
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    seconds(2);
    const bearing = map.getBearing();
    // A keyboard press of «Girar a la derecha» steps 15°.
    const right = screen.getByRole('button', { name: 'Girar a la derecha' });
    act(() => { fireEvent.click(right, { detail: 0 }); });
    seconds(2);
    expect(angle(map.getBearing(), bearing + ORBIT.rotateStepDeg)).toBeLessThan(2);
    // A drag on the map turns the camera round the aircraft and tilts it; follow mode goes on.
    const element = map.getContainer();
    act(() => {
      fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: 500, clientY: 400, pointerType: 'mouse' });
      fireEvent.pointerMove(element, { pointerId: 1, clientX: 400, clientY: 300, pointerType: 'mouse' });
      fireEvent.pointerUp(element, { pointerId: 1, clientX: 400, clientY: 300, pointerType: 'mouse' });
    });
    seconds(2);
    expect(threeProbe().on).toBe(true);
    expect(angle(map.getBearing(), bearing + ORBIT.rotateStepDeg + 100 * ORBIT.dragDegPerPx)).toBeLessThan(2);
    // The views: «Desde arriba» looks straight down.
    act(() => { screen.getByRole('radio', { name: 'Desde arriba' }).click(); });
    seconds(2);
    expect(map.getPitch()).toBeLessThan(1);
    expect(threeProbe().view).toBe('top');
  });

  it('Esc stops following and flies the camera back; the gestures come back to MapLibre', () => {
    const { map, seconds, root } = renderFollow3d();
    const before = { center: map.getCenter().toArray(), zoom: map.getZoom() };
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    seconds(2);
    fireEvent(root, createEvent.keyDown(root, { key: 'Escape' }));
    expect(threeProbe()).toEqual({ on: false, view: null, following: false });
    expect(query().get('follow')).toBeNull();
    expect(screen.queryByTestId('follow-3d-panel')).not.toBeInTheDocument();
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.getMaxPitch()).toBe(65);
    const back = map.cameraCalls.filter(call => call.method === 'easeTo').at(-1).options;
    expect(haversineM(back.center, before.center)).toBeLessThan(1);
    expect(back.zoom).toBeCloseTo(before.zoom, 6);
  });

  it('another choice ends it, and «Dejar de seguir» does too', () => {
    const { seconds, rerender } = renderFollow3d();
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    seconds(1);
    rerender({ kind: 'stand', id: 'A6' });
    expect(threeProbe().on).toBe(false);
    expect(query().get('follow')).toBeNull();
    rerender({ kind: 'flight', id: KEY.demoArrival });
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    expect(threeProbe().on).toBe(true);
    act(() => { screen.getByRole('button', { name: 'Dejar de seguir' }).click(); });
    expect(threeProbe().on).toBe(false);
  });
});
