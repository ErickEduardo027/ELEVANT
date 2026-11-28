import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { haversineM } from '../airport/geo';
import { CLOSE_UP_ZOOM, ORBIT, ORBIT_VIEWS, closeChaseZoom } from '../kinematics/orbitCamera';
import {
  createAirPicture, createDemoBlock, createDemoFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { createMotionStore } from '../traffic/motionStore';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import Follow3dPanel from '../ui/Follow3dPanel';
import { MODE_3D_STORAGE_KEY } from './aircraft3d';
import { createRenderClock } from './frameLoop';
import { occSky } from './mapSky';
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
function renderFollow3d({ appearS = 200, selection: initial = { kind: 'flight', id: KEY.demoArrival }, onSelect } = {}) {
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
      <OccMap defaultView="airfield" basemap={false} traffic={traffic} selection={selection} onSelect={onSelect}>
        <Follow3dProbe />
        <Follow3dPanel flights={flightsModel.flights} />
      </OccMap>
    </LanguageScope>
  );
  const view = render(element(initial));
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

  it('shows the sky while it follows on a 2D map and takes it away when it ends (M4)', () => {
    const { map, seconds, root } = renderFollow3d();
    const skyCalls = () => map.calls.filter(call => call.method === 'setSky');
    // A 2D map has no sky, and MapLibre is never told so.
    expect(skyCalls()).toEqual([]);
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    seconds(1);
    expect(map.getSky()).toEqual(occSky('dark'));
    fireEvent(root, createEvent.keyDown(root, { key: 'Escape' }));
    expect(map.getSky()).toBeUndefined();
    expect(skyCalls()).toHaveLength(2);
    expect(map.styleCalls).toEqual([]);
  });
});

describe('OccMap double click on an aircraft (M4)', () => {
  const AT = { point: { x: 100, y: 100 }, lngLat: { lng: -68.36, lat: 18.57 } };
  const demoUnder = { layer: { id: 'occ-traffic-aviam' }, properties: { id: DEMO_ID, flightKey: KEY.demoArrival } };
  const under = (map, features) => fake.state.setRenderedFeatures(map,
    (_geometry, options) => features.filter(feature => options.layers.includes(feature.layer.id)));

  it('chooses the aircraft and starts «Seguir en 3D» without the zoom of MapLibre; on empty map it zooms as always', () => {
    const onSelect = vi.fn();
    const { map, rerender, seconds } = renderFollow3d({ selection: null, onSelect });
    // On empty map the double click is MapLibre's: one level in, nothing chosen, nothing followed.
    under(map, []);
    const zoom = map.getZoom();
    let prevented;
    act(() => { prevented = fake.state.doubleClick(map, AT); });
    expect(prevented).toBe(false);
    expect(map.getZoom()).toBeCloseTo(zoom + 1, 5);
    expect(onSelect).not.toHaveBeenCalled();
    expect(threeProbe().on).toBe(false);
    // On the aircraft: chosen through the page's onSelect, no zoom, and once the page chooses it, the orbit starts.
    under(map, [demoUnder]);
    const before = map.getZoom();
    act(() => { prevented = fake.state.doubleClick(map, AT); });
    expect(prevented).toBe(true);
    expect(map.getZoom()).toBe(before);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'flight', id: KEY.demoArrival });
    expect(threeProbe().on).toBe(false);
    act(() => rerender({ kind: 'flight', id: KEY.demoArrival }));
    expect(threeProbe()).toEqual({ on: true, view: 'close', following: true });
    expect(query().get('follow')).toBe('1');
    // Orbiting, MapLibre's double-click zoom is the orbit's; a double click on the followed aircraft changes nothing.
    seconds(1);
    expect(map.doubleClickZoom.isEnabled()).toBe(false);
    act(() => { prevented = fake.state.doubleClick(map, AT); });
    expect(threeProbe().on).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('on the aircraft already chosen (the first click of the double click chose it) it starts at once', () => {
    const onSelect = vi.fn();
    const { map } = renderFollow3d({ onSelect });
    under(map, [demoUnder]);
    const zoom = map.getZoom();
    let prevented;
    act(() => { prevented = fake.state.doubleClick(map, AT); });
    expect(prevented).toBe(true);
    expect(map.getZoom()).toBe(zoom);
    expect(onSelect).not.toHaveBeenCalled();
    expect(threeProbe()).toEqual({ on: true, view: 'close', following: true });
  });

  // Fix M4: the first click of the double click on another aircraft ends the 3D and starts the ease back; the 3D the
  // double click starts goes back to the view from before the first one, not to that ease partway.
  it('a double click on another aircraft while it follows keeps the view from before the first 3D to go back to', () => {
    const { map, seconds, root, rerender } = renderFollow3d();
    const before = { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch() };
    under(map, [demoUnder]);
    act(() => { fake.state.doubleClick(map, AT); });
    expect(threeProbe().on).toBe(true);
    seconds(2);
    // The first click chooses the other aircraft: the 3D ends and flies back; MapLibre's ease is partway, close in.
    act(() => rerender(null));
    expect(threeProbe().on).toBe(false);
    const partway = { center: [-68.3601, 18.5701], zoom: 19.5, pitch: 70 };
    act(() => { map.jumpTo(partway); });
    act(() => rerender({ kind: 'flight', id: KEY.demoArrival }));
    act(() => { fake.state.doubleClick(map, AT); });
    expect(threeProbe()).toEqual({ on: true, view: 'close', following: true });
    seconds(2);
    fireEvent(root, createEvent.keyDown(root, { key: 'Escape' }));
    const back = map.cameraCalls.filter(call => call.method === 'easeTo').at(-1).options;
    expect(haversineM(back.center, before.center)).toBeLessThan(1);
    expect(back.zoom).toBeCloseTo(before.zoom, 6);
    expect(back.pitch).toBeCloseTo(before.pitch, 6);
  });

  it('a 3D started once the ease back is over keeps the camera it starts from', () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { map, seconds, root, rerender } = renderFollow3d();
    under(map, [demoUnder]);
    act(() => { fake.state.doubleClick(map, AT); });
    seconds(1);
    act(() => rerender(null));
    now += 1_500;
    const later = { center: [-68.3601, 18.5701], zoom: 17.25, pitch: 30 };
    act(() => { map.jumpTo(later); });
    act(() => rerender({ kind: 'flight', id: KEY.demoArrival }));
    act(() => { fake.state.doubleClick(map, AT); });
    seconds(1);
    fireEvent(root, createEvent.keyDown(root, { key: 'Escape' }));
    const back = map.cameraCalls.filter(call => call.method === 'easeTo').at(-1).options;
    expect(haversineM(back.center, later.center)).toBeLessThan(1);
    expect(back.zoom).toBeCloseTo(later.zoom, 6);
  });

  it('another choice before the page chooses the aircraft forgets the waiting «Seguir en 3D»', () => {
    const onSelect = vi.fn();
    const { map, rerender } = renderFollow3d({ selection: null, onSelect });
    // Asked for the aircraft, then the page chose something else first: the waiting «Seguir en 3D» is forgotten.
    under(map, [demoUnder]);
    act(() => { fake.state.doubleClick(map, AT); });
    act(() => rerender({ kind: 'stand', id: 'A6' }));
    act(() => rerender({ kind: 'flight', id: KEY.demoArrival }));
    expect(threeProbe().on).toBe(false);
  });
});


describe('OccMap «Muy cerca» and the ultra zoom (M4)', () => {
  const AT = { point: { x: 100, y: 100 }, lngLat: { lng: -68.36, lat: 18.57 } };
  const demoUnder = { layer: { id: 'occ-traffic-aviam' }, properties: { id: DEMO_ID, flightKey: KEY.demoArrival } };
  const marked = (map, key) => map.layers.filter(layer => layer.metadata?.[key] !== undefined).map(layer => layer.id);
  const shown = (map, id) => map.getLayer(id).layout?.visibility ?? 'visible';
  // What the layers menu gives a marked layer: as the unmarked layers of its group (the rings, centrelines and night).
  const asGroup = (map, id) => {
    const group = map.getLayer(id).metadata['occ:group'];
    const sibling = map.layers.find(layer => layer.metadata?.['occ:group'] === group && !layer.metadata['occ:closeUp']
      && !layer.id.startsWith('slot-'));
    return sibling ? shown(map, sibling.id) : null;
  };

  it('the double click flies in close behind the tail past zoom 19.5, hides the crowding labels and gives all back', () => {
    const { map, seconds, root } = renderFollow3d();
    const hidden = marked(map, 'occ:closeUp');
    const narrowed = marked(map, 'occ:closeUpFilter');
    // The other traffic's tags, the stand designators and the references' words; the ELEVANT tags keep the chosen one.
    expect(hidden).toEqual(expect.arrayContaining(['occ-traffic-tags-other', 'occ-reference-arp']));
    expect(narrowed).toHaveLength(1);
    const own = map.getFilter(narrowed[0]);
    const before = Object.fromEntries(hidden.map(id => [id, shown(map, id)]));
    fake.state.setRenderedFeatures(map, (_geometry, options) => [demoUnder]
      .filter(feature => options.layers.includes(feature.layer.id)));
    act(() => { fake.state.doubleClick(map, AT); });
    expect(threeProbe()).toEqual({ on: true, view: 'close', following: true });
    expect(screen.getByRole('radio', { name: 'Muy cerca' })).toHaveAttribute('aria-checked', 'true');
    expect(map.getMaxZoom()).toBe(ORBIT.maxZoom);
    seconds(3);
    expect(map.getZoom()).toBeGreaterThan(CLOSE_UP_ZOOM);
    expect(map.getPitch()).toBeCloseTo(ORBIT_VIEWS.close.pitch, 0);
    for (const id of hidden) expect(shown(map, id), id).toBe('none');
    expect(map.getFilter(narrowed[0])).toEqual(['all', own, ['==', ['get', 'selected'], true]]);
    // «Persecución» goes back under 19.5: the labels come back while it still follows.
    act(() => { screen.getByRole('radio', { name: 'Persecución' }).click(); });
    seconds(3);
    expect(map.getZoom()).toBeLessThan(CLOSE_UP_ZOOM);
    const grouped = hidden.filter(id => asGroup(map, id) !== null);
    expect(grouped).toEqual(expect.arrayContaining(['occ-night-label', 'occ-reference-centreline-label']));
    for (const id of grouped) expect(shown(map, id), id).toBe(asGroup(map, id));
    expect(map.getFilter(narrowed[0])).toEqual(own);
    // Close again, then Esc: the labels and the map's own zoom limit come back.
    act(() => { screen.getByRole('radio', { name: 'Muy cerca' }).click(); });
    seconds(3);
    expect(shown(map, hidden[0])).toBe('none');
    fireEvent(root, createEvent.keyDown(root, { key: 'Escape' }));
    expect(threeProbe().on).toBe(false);
    for (const id of hidden) expect(shown(map, id), id).toBe(before[id]);
    expect(map.getFilter(narrowed[0])).toEqual(own);
    expect(map.getMaxZoom()).toBe(19.5);
  });

  it('zoomed in all the way, the camera stops short of the model, under 22 on this map, and backs off at once', () => {
    const { map, seconds } = renderFollow3d();
    fake.state.setRenderedFeatures(map, (_geometry, options) => [demoUnder]
      .filter(feature => options.layers.includes(feature.layer.id)));
    act(() => { fake.state.doubleClick(map, AT); });
    seconds(3);
    const close = map.getZoom();
    const camera = within(screen.getByRole('region', { name: 'Cámara' }));
    for (let step = 0; step < 12; step += 1) act(() => { camera.getByRole('button', { name: 'Acercar' }).click(); });
    seconds(3);
    // The demo airliner on a map 900 px high: MapLibre's camera would stand some 24 m from its middle at 22.
    const closest = map.getZoom();
    expect(closest).toBeGreaterThan(close);
    expect(closest).toBeLessThan(ORBIT.maxZoom);
    expect(closest).toBeGreaterThan(closeChaseZoom({ lengthM: 38, latDeg: 18.57, viewportHeightPx: 900 }));
    act(() => { camera.getByRole('button', { name: 'Alejar' }).click(); });
    seconds(3);
    expect(map.getZoom()).toBeCloseTo(closest - ORBIT.zoomStep, 2);
  });
});
