import { describe, expect, it, vi } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint } from '../airport/geo';
import { GROUND_TRAFFIC_3D_RADIUS_M, liveryInstanceColours } from '../aircraft/instancePlan';
import { LIVERIES } from '../aircraft/liveries';
import { mercatorFrame } from '../aircraft/instancePlan';
import { createKeyframes, writeKeyframes } from '../traffic/keyframes';
import {
  AIRCRAFT_3D_SLOT, DETAIL_MIN_ZOOM, GOVERNOR, GOVERNOR_PAUSED, MODE_3D_STORAGE_KEY, RETRY_LOAD_MS,
  createAircraft3dController, createGovernor, detailOf, parkedFromStands, parkedTrafficByStand, projected3d, readMode3d,
  translatePick, writeMode3d,
} from './aircraft3d';
import { GLOBE_MERCATOR_ZOOM } from '../style/occStyle';
import { OUTSIDE_FILTER_OPACITY } from '../traffic/trafficLayers';

// The 3D aircraft without three or a map (PR M7): the remembered choice, the stands' aircraft, the pick translation,
// the governor and the controller with a fake engine, a fake chunk and a stub layer. Synthetic aircraft around the ARP.
const ARP = MDPC_LAYOUT.meta.arp;
const near = (metres, bearing = 90) => destinationPoint(ARP, bearing, metres);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

const aviam = (id, extra = {}) => {
  const [lon, lat] = near(400);
  return { id, kind: 'aviam', flightKey: id.slice(2), lon, lat, onGround: true, gsMs: 8, trackDeg: 80, typeIcao: 'A320',
    ...extra };
};
const other = (hex, extra = {}) => {
  const [lon, lat] = near(1_500, 200);
  return { id: `h:${hex}`, kind: 'other', hex, lon, lat, onGround: false, altM: 300, trackDeg: 260, typeIcao: 'B738',
    ...extra };
};

function stand(code, { footprint = 'solid', type = 'A320', turnaroundId = `t-${code}`, heading = 170 } = {}) {
  const center = near(600, 30);
  return {
    id: code,
    code,
    geometry: { center, headingTrue: heading, polygon: [center, center, center, center] },
    display: { footprint, typeSpec: footprint ? { lengthM: 37 } : null, aircraftType: type, visit: { turnaroundId } },
  };
}

describe('the 2D/3D choice', () => {
  it('is 3D by default where the browser draws WebGL2 and 2D without it; a stored choice wins and is written back', () => {
    expect(readMode3d(memoryStorage(), { webgl: true })).toBe(true);
    expect(readMode3d(memoryStorage(), { webgl: false })).toBe(false);
    expect(readMode3d(null, { webgl: true })).toBe(true);
    expect(readMode3d(memoryStorage({ [MODE_3D_STORAGE_KEY]: '2d' }), { webgl: true })).toBe(false);
    expect(readMode3d(memoryStorage({ [MODE_3D_STORAGE_KEY]: '3d' }), { webgl: false })).toBe(true);
    expect(readMode3d(memoryStorage({ [MODE_3D_STORAGE_KEY]: 'tilted' }), { webgl: false })).toBe(false);
    const storage = memoryStorage();
    writeMode3d(storage, false);
    expect(storage.values.get(MODE_3D_STORAGE_KEY)).toBe('2d');
    writeMode3d(storage, true);
    expect(storage.values.get(MODE_3D_STORAGE_KEY)).toBe('3d');
    // A browser that refuses storage keeps the default and remembers nothing, without throwing.
    const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readMode3d(refusing, { webgl: true })).toBe(true);
    expect(() => writeMode3d(refusing, true)).not.toThrow();
  });
});

describe('parkedFromStands', () => {
  it('gives one aircraft per stand that shows one to scale, owned by the parked aircraft of its visit or by the stand', () => {
    const stands = [stand('A5'), stand('A6', { turnaroundId: 't-busy' }), stand('A7', { footprint: 'planned' }),
      stand('A8', { type: null }), stand('A5'), { ...stand('A9'), retired: true }];
    const parkedAircraft = aviam('f:parked', { turnaroundId: 't-busy', gsMs: 0 });
    const parked = parkedFromStands(stands, [parkedAircraft], new Set(['f:parked']));
    expect(parked.map(item => item.id)).toEqual(['s:A5', 'f:parked']);
    expect(parked[0]).toMatchObject({ lon: stands[0].geometry.center[0], lat: stands[0].geometry.center[1],
      headingDeg: 170, typeIcao: 'A320', kind: 'aviam' });
    // The aircraft of a visit that still moves is the traffic's: its stand draws none.
    expect(parkedFromStands(stands, [{ ...parkedAircraft, gsMs: 6 }], new Set()).map(item => item.id)).toEqual(['s:A5']);
    expect(parkedFromStands(null, null)).toEqual([]);
  });

  it("M9: carries what names the airline for its livery, the owner's callsign and codes, else the stand's flight", () => {
    const byStand = stand('B20');
    byStand.display.flightNumber = 'CM 893';
    const owned = stand('B21', { turnaroundId: 't-owned' });
    owned.display.flightNumber = 'XX 1';
    const owner = aviam('f:owner', { turnaroundId: 't-owned', gsMs: 0, callsign: 'JBU1234', airlineIcao: 'JBU',
      airlineIata: 'B6', flightNumber: 'B6 1234' });
    const [first, second] = parkedFromStands([byStand, owned], [owner], new Set(['f:owner']));
    expect(first).toMatchObject({ id: 's:B20', airlineIcao: null, airlineIata: null, callsign: null,
      flightNumber: 'CM 893' });
    expect(second).toMatchObject({ id: 'f:owner', airlineIcao: 'JBU', airlineIata: 'B6', callsign: 'JBU1234',
      flightNumber: 'B6 1234' });
  });

  it('carries the airline of the parked aircraft for its livery (PR M5), and null for an aircraft only the stand knows', () => {
    const stands = [stand('A5'), stand('A6', { turnaroundId: 't-busy' })];
    const parkedAircraft = aviam('f:parked', { turnaroundId: 't-busy', gsMs: 0, airlineIcao: 'CMP', airlineIata: 'CM',
      callsign: 'CMP123', flightNumber: 'CM 123' });
    const [byStand, owned] = parkedFromStands(stands, [parkedAircraft], new Set(['f:parked']));
    expect(owned).toMatchObject({ id: 'f:parked', airlineIcao: 'CMP', airlineIata: 'CM', callsign: 'CMP123',
      flightNumber: 'CM 123' });
    expect(byStand.id).toBe('s:A5');
    // Integration of M5 with M9: a stand without its aircraft names no airline (null), and its livery is the default.
    expect(byStand).toMatchObject({ airlineIcao: null, airlineIata: null, callsign: null });
    // Missing fields are null, never undefined.
    const [, bare] = parkedFromStands(stands, [aviam('f:parked', { turnaroundId: 't-busy', gsMs: 0 })], new Set(['f:parked']));
    expect(bare).toMatchObject({ airlineIcao: null, airlineIata: null, callsign: null });
    expect(bare.flightNumber === null || typeof bare.flightNumber === 'string').toBe(true);
  });
});

describe('parkedTrafficByStand (M4)', () => {
  it('names the traffic aircraft parked on each stand as a click on it selects it, and no stand without one', () => {
    const stands = [stand('A5'), stand('A6', { turnaroundId: 't-busy' }), { ...stand('A7', { turnaroundId: 't-old' }),
      retired: true }, stand('A6', { turnaroundId: 't-busy' })];
    const parked = aviam('f:parked', { turnaroundId: 't-busy', gsMs: 0 });
    const retiredOwner = aviam('f:old', { turnaroundId: 't-old', gsMs: 0 });
    const targets = parkedTrafficByStand(stands, [parked, retiredOwner], new Set(['f:parked', 'f:old']));
    expect([...targets]).toEqual([['A6', { kind: 'flight', id: 'parked' }]]);
    expect(Object.isFrozen(targets.get('A6'))).toBe(true);
    // An aircraft of the visit that is not on its box (it still moves), or other traffic, is not the stand's.
    expect(parkedTrafficByStand(stands, [parked], new Set()).size).toBe(0);
    expect(parkedTrafficByStand(stands, [other('abc123', { turnaroundId: 't-busy' })], new Set(['h:abc123'])).size)
      .toBe(0);
    expect(parkedTrafficByStand(null, null).size).toBe(0);
  });
});

describe('translatePick', () => {
  it("names a flight by its key, other traffic by its address and a stand\'s aircraft by the stand", () => {
    const drawn = [aviam('f:k-1'), other('abc123'), { ...aviam('h:def456'), flightKey: null, hex: 'def456' }];
    expect(translatePick({ kind: 'aircraft', id: 'f:k-1' }, drawn)).toMatchObject({ kind: 'flight', id: 'k-1',
      feature: { source: 'occ-traffic', properties: { id: 'f:k-1' } } });
    expect(translatePick({ kind: 'aircraft', id: 'h:abc123' }, drawn)).toMatchObject({ kind: 'aircraft', id: 'abc123' });
    expect(translatePick({ kind: 'aircraft', id: 'h:def456' }, drawn)).toMatchObject({ kind: 'aircraft', id: 'def456' });
    expect(translatePick({ kind: 'aircraft', id: 's:A5' }, drawn)).toEqual({ kind: 'stand', id: 'A5', feature: null });
    // An id the last write no longer draws still reads by its prefix.
    expect(translatePick({ kind: 'aircraft', id: 'f:gone' }, [])).toMatchObject({ kind: 'flight', id: 'gone' });
    expect(translatePick(null, drawn)).toBeNull();
    expect(translatePick({ kind: 'aircraft', id: 'x' }, drawn)).toBeNull();
  });
});

describe('the governor', () => {
  // `count` frames of `dt` ms from `start`; answers the steps taken and the instant after the last frame.
  const run = (governor, { dt, count, start = 0 }) => {
    const steps = [];
    let at = start;
    for (let index = 0; index < count; index += 1) {
      at += dt;
      const step = governor.sample(dt, at);
      if (step !== 0) steps.push(step);
    }
    return { steps, at };
  };

  it('steps down after two seconds of slow frames, one step per window, down to the pause', () => {
    const governor = createGovernor();
    // A second of slow frames is not enough.
    expect(run(governor, { dt: 40, count: 25 }).steps).toEqual([]);
    let { steps, at } = run(governor, { dt: 40, count: 26, start: 1_000 });
    expect(steps).toEqual([-1]);
    expect(governor.level).toBe(1);
    ({ steps, at } = run(governor, { dt: 40, count: 3 * 51, start: at }));
    expect(steps).toEqual([-1, -1, -1]);
    expect(governor.level).toBe(GOVERNOR_PAUSED);
    // Paused, nothing more happens, and fast frames never bring it back: «Volver a 3D» does.
    expect(run(governor, { dt: 10, count: 4_000, start: at }).steps).toEqual([]);
  });

  it('never pauses while a flight is followed, and steps back up after thirty seconds of fast frames', () => {
    const governor = createGovernor({ following: true });
    const { at } = run(governor, { dt: 50, count: 400 });
    expect(governor.level).toBe(GOVERNOR_PAUSED - 1);
    const back = run(governor, { dt: 10, count: (GOVERNOR.stableMs + GOVERNOR.windowMs + 1_000) / 10, start: at });
    expect(back.steps).toEqual([1]);
    expect(governor.level).toBe(GOVERNOR_PAUSED - 2);
  });

  it('reads a gap as the map idling: slow frames on either side of it start a new window', () => {
    const governor = createGovernor();
    let { at } = run(governor, { dt: 40, count: 40 });
    expect(governor.sample(GOVERNOR.maxGapMs + 1, at + 300)).toBe(0);
    ({ at } = run(governor, { dt: 40, count: 40, start: at + 300 }));
    expect(governor.level).toBe(0);
    expect(run(governor, { dt: 40, count: 20, start: at }).steps).toEqual([-1]);
  });

  // PR M2: a still camera draws only the few renders each write of the traffic asks for, 4 to 15 writes a second (CN-18):
  // three renders on consecutive display frames, then nothing until the next write.
  const bursts = (governor, { hz, seconds, continuous }) => {
    const steps = [];
    const period = 1_000 / hz;
    for (let write = 0; write < seconds * hz; write += 1) {
      [0, 1_000 / 60, 2_000 / 60].forEach((offset, index) => {
        const at = write * period + offset;
        const dt = index === 0 ? period - 2_000 / 60 : 1_000 / 60;
        const step = governor.sample(dt, at, { continuous: continuous(index) });
        if (step !== 0) steps.push(step);
      });
    }
    return steps;
  };

  it('never reads the gaps between the writes of the traffic as slow frames, at 4 to 15 writes a second (PR M2)', () => {
    for (const hz of [4, 7, 10, 15]) {
      // As the controller hears them: no render of a burst follows a frame drawn while the map animated.
      const governor = createGovernor();
      expect(bursts(governor, { hz, seconds: 20, continuous: () => false })).toEqual([]);
      expect(governor.level).toBe(0);
      // The same draws read as continuous drawing were the misfire: the gaps averaged as slow frames.
      const misread = createGovernor();
      expect(bursts(misread, { hz, seconds: 20, continuous: () => true })[0]).toBe(-1);
    }
  });

  it('still steps down for frames that are slow while the map draws every frame (PR M2)', () => {
    const governor = createGovernor();
    let at = 0;
    const steps = [];
    for (let index = 0; index < 120; index += 1) {
      at += 40;
      const step = governor.sample(40, at, { continuous: true });
      if (step !== 0) steps.push(step);
    }
    expect(steps).toEqual([-1, -1]);
    // A frame that was not drawn continuously starts the window again.
    expect(governor.sample(40, at + 40, { continuous: false })).toBe(0);
    expect(governor.level).toBe(2);
  });
});

// The controller's world: an engine that records its custom layers, a chunk that resolves when told, a stub layer.
// `reports`: the stub layer says what its last frame drew (drawnNow, HOTFIX-3D), at first nothing.
function world({ fail = false, webgl = true, liveries = false, animate = false, reports = false } = {}) {
  let clock = 0;
  let frameT = 0;
  let resolveLoad;
  let rejectLoad;
  const engine = {
    // `moving`: whether the camera moves (the map draws every frame then).
    map: { triggerRepaint: vi.fn(), isMoving: () => engine.moving },
    moving: false,
    layers: [],
    ratio: 2,
    addCustomLayer: vi.fn((layer, slot) => engine.layers.push({ layer, slot })),
    removeCustomLayer: vi.fn(id => {
      engine.layers = engine.layers.filter(entry => entry.layer.id !== id);
    }),
    getPixelRatio: () => engine.ratio,
    setPixelRatio: vi.fn(ratio => {
      engine.ratio = ratio;
    }),
  };
  const made = [];
  const modules = {
    three: {},
    createAircraft3dLayer: vi.fn(options => {
      const layer = {
        id: 'occ-aircraft-3d', options, quality: { shadows: true, dropLines: true },
        render: vi.fn(),
        pick: vi.fn(() => ({ kind: 'aircraft', id: 'f:k-1' })),
        setQuality(next) {
          Object.assign(layer.quality, next);
          return { ...layer.quality };
        },
        stats: () => ({ meshes: 1, instances: 2, failed: false, lost: false }),
        drawn: { detail: null, keys: new Set(), animated: false },
      };
      if (reports) layer.drawnNow = () => layer.drawn;
      made.push(layer);
      return layer;
    }),
  };
  const load = vi.fn(() => new Promise((resolve, reject) => {
    resolveLoad = () => resolve(modules);
    rejectLoad = () => reject(new Error('chunk'));
  }));
  const onChange = vi.fn();
  const controller = createAircraft3dController({
    engine, originLngLat: ARP, fieldElevationM: 14, load, onChange, now: () => clock, getNow: () => Date.parse('2026-11-13T15:00:00Z'),
    webgl: () => webgl, liveries, animate, frameTime: () => frameT,
  });
  const settle = async () => {
    if (fail) rejectLoad();
    else resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    engine, modules, made, load, onChange, controller, settle,
    advance: ms => {
      clock += ms;
    },
    // The frame loop's instant the animation draws at (PR M2).
    at: ms => {
      frameT = ms;
    },
    frame: ms => {
      clock += ms;
      made.at(-1).render();
    },
  };
}

const AT_RAMP = { zoom: 16, minZoom: 15 };

describe('createAircraft3dController', () => {
  it('loads the chunk the first time the zoom reaches the threshold with 3D on, then draws and hides those ids in 2D', async () => {
    const { controller, load, engine, made, settle, onChange } = world();
    const aircraft = [aviam('f:k-1'), other('abc123')];
    // Off: nothing is planned or loaded.
    expect(controller.plan({ aircraft, ...AT_RAMP }).size).toBe(0);
    expect(load).not.toHaveBeenCalled();
    controller.setEnabled(true);
    expect(controller.state()).toMatchObject({ enabled: true, status: 'idle', notice: null });
    // Below the threshold nothing loads.
    controller.plan({ aircraft, zoom: 14, minZoom: 15 });
    expect(load).not.toHaveBeenCalled();
    expect(controller.plan({ aircraft, ...AT_RAMP }).size).toBe(0);
    expect(load).toHaveBeenCalledOnce();
    expect(controller.state().status).toBe('loading');
    controller.plan({ aircraft, ...AT_RAMP });
    expect(load).toHaveBeenCalledOnce();
    await settle();
    expect(controller.state()).toMatchObject({ status: 'ready', notice: null });
    expect(engine.layers).toEqual([{ layer: made[0], slot: AIRCRAFT_3D_SLOT }]);
    expect(onChange).toHaveBeenCalled();
    // The layer reads the plan of the last write, with a new revision each write.
    const ids = controller.plan({ aircraft, ...AT_RAMP, selectedId: 'f:k-1' });
    expect([...ids].sort()).toEqual(['f:k-1', 'h:abc123']);
    const first = made[0].options.getInstances();
    expect(first.plan.get('A320')).toMatchObject({ aircraftCount: 1, ids: ['f:k-1', null] });
    controller.plan({ aircraft, ...AT_RAMP });
    expect(made[0].options.getInstances().revision).toBe(first.revision + 1);
    expect(engine.map.triggerRepaint).toHaveBeenCalled();
    // The sun at the render clock's instant, at the ARP: noon of 2026-11-13 in Punta Cana is day.
    expect(made[0].options.getSun().elevationDeg).toBeGreaterThan(30);
    expect(controller.pick({ x: 1, y: 2 })).toEqual({ kind: 'aircraft', id: 'f:k-1' });
    // Back to 2D: the layer goes, nothing is hidden or picked, and 3D again adds the same layer without a new load.
    controller.setEnabled(false);
    expect(engine.layers).toEqual([]);
    expect(controller.plan({ aircraft, ...AT_RAMP }).size).toBe(0);
    expect(controller.pick({ x: 1, y: 2 })).toBeNull();
    controller.setEnabled(true);
    expect(engine.layers).toHaveLength(1);
    expect(load).toHaveBeenCalledOnce();
    expect(made).toHaveLength(1);
    controller.dispose();
    expect(engine.layers).toEqual([]);
  });

  it('keeps 2D with its notice when the chunk fails or the layer cannot draw, and tries again', async () => {
    const failing = world({ fail: true });
    failing.controller.setEnabled(true);
    failing.controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    await failing.settle();
    expect(failing.controller.state()).toMatchObject({ status: 'failed', notice: 'failed' });
    expect(failing.engine.layers).toEqual([]);
    // Not again at once; after RETRY_LOAD_MS it tries again.
    failing.controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    expect(failing.load).toHaveBeenCalledOnce();
    failing.advance(RETRY_LOAD_MS);
    failing.controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    expect(failing.load).toHaveBeenCalledTimes(2);

    // A browser without WebGL2 loads nothing and says so.
    const flat = world({ webgl: false });
    flat.controller.setEnabled(true);
    flat.controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    expect(flat.load).not.toHaveBeenCalled();
    expect(flat.controller.state()).toMatchObject({ status: 'failed', notice: 'failed' });

    // A layer that could not build its renderer (or lost it on a restored context) shows the 2D aircraft again.
    const { controller, made, settle } = world();
    controller.setEnabled(true);
    controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    await settle();
    made[0].options.onFailedChange(true);
    expect(controller.state()).toMatchObject({ status: 'failed', notice: 'failed' });
    expect(controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP }).size).toBe(0);
    expect(controller.pick({ x: 1, y: 2 })).toBeNull();
    made[0].options.onFailedChange(false);
    expect(controller.state()).toMatchObject({ status: 'ready', notice: null });
    expect([...controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP })]).toEqual(['f:k-1']);
  });

  it('the governor lightens the scene, lowers the pixel ratio and pauses the 3D, never while a flight is followed', async () => {
    const { controller, made, engine, settle, frame } = world();
    controller.setEnabled(true);
    controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    await settle();
    // The camera moves: the map draws every frame, and the time between two of them is what a frame costs.
    engine.moving = true;
    const slow = seconds => {
      for (let index = 0; index < (seconds * 1000) / 40; index += 1) frame(40);
    };
    slow(2.2);
    expect(made[0].quality).toEqual({ shadows: false, dropLines: false });
    expect(controller.state().level).toBe(1);
    slow(2.2);
    expect(engine.ratio).toBe(1.25);
    slow(2.2);
    expect(engine.ratio).toBe(1);
    slow(2.2);
    expect(controller.state()).toMatchObject({ status: 'paused', notice: 'paused', level: GOVERNOR_PAUSED });
    expect(engine.layers).toEqual([]);
    // The pixel ratio comes back with the 2D; «Volver a 3D» brings the layer back at full quality.
    expect(engine.ratio).toBe(2);
    controller.resume();
    expect(controller.state()).toMatchObject({ status: 'ready', notice: null, level: 0 });
    expect(engine.layers).toHaveLength(1);
    expect(made[0].quality).toEqual({ shadows: true, dropLines: true });

    // Followed, it goes down to the lowest quality and stays on.
    controller.setFollowing(true);
    slow(12);
    expect(controller.state()).toMatchObject({ status: 'ready', level: GOVERNOR_PAUSED - 1 });
    expect(engine.layers).toHaveLength(1);
    // The lab's pause, on demand.
    controller.pause();
    expect(controller.state().status).toBe('paused');
  });

  it("M9: with liveries it plans the airlines' colours and the ground traffic near the field, until the governor steps down", async () => {
    const { controller, made, settle, frame, onChange, engine } = world({ liveries: true });
    const [lon, lat] = near(1_200, 300);
    const taxiing = other('def456', { lon, lat, onGround: true, altM: null, callsign: 'AAL1234' });
    const copa = aviam('f:k-1', { callsign: 'CMP893' });
    controller.setEnabled(true);
    controller.plan({ aircraft: [copa, taxiing], ...AT_RAMP });
    await settle();
    const ids = controller.plan({ aircraft: [copa, taxiing], ...AT_RAMP });
    expect([...ids].sort()).toEqual(['f:k-1', 'h:def456']);
    const { plan } = made[0].options.getInstances();
    expect(Array.from(plan.get('A320').colors.slice(0, 3)))
      .toEqual(Array.from(Float32Array.from(liveryInstanceColours({ airlineIcao: 'CMP' }).fuselage)));
    expect(Array.from(plan.get('B738').zoneColors.tail.slice(0, 3)))
      .toEqual(Array.from(Float32Array.from(liveryInstanceColours({ airlineIcao: 'AAL' }).tail)));
    expect(GROUND_TRAFFIC_3D_RADIUS_M).toBeGreaterThan(1_200);

    // The governor's first step gives the ground traffic back to 2D, and asks the map to write its traffic again. Slow
    // frames count only while the map draws continuously (PR M2): here the camera moves.
    onChange.mockClear();
    engine.moving = true;
    for (let index = 0; index < 2_200 / 40; index += 1) frame(40);
    expect(controller.state().level).toBe(1);
    await Promise.resolve();
    expect(onChange).toHaveBeenCalled();
    expect([...controller.plan({ aircraft: [copa, taxiing], ...AT_RAMP })]).toEqual(['f:k-1']);
    // Its livery stays.
    expect(made[0].options.getInstances().plan.get('A320').zoneColors.tail.slice(0, 3))
      .toEqual(Float32Array.from(liveryInstanceColours({ airlineIcao: 'CMP' }).tail));
  });

  it('without liveries other traffic on the ground stays 2D and the aircraft keep their monochrome colours', async () => {
    const { controller, made, settle } = world();
    const [lon, lat] = near(1_200, 300);
    const taxiing = other('def456', { lon, lat, onGround: true, altM: null, callsign: 'AAL1234' });
    controller.setEnabled(true);
    controller.plan({ aircraft: [aviam('f:k-1', { callsign: 'CMP893' }), taxiing], ...AT_RAMP });
    await settle();
    expect([...controller.plan({ aircraft: [aviam('f:k-1', { callsign: 'CMP893' }), taxiing], ...AT_RAMP })])
      .toEqual(['f:k-1']);
    const entry = made[0].options.getInstances().plan.get('A320');
    expect(entry.zoneColors.tail.slice(0, 3)).toEqual(entry.colors.slice(0, 3));
  });

  it('a still camera whose renders follow the writes of the traffic keeps full quality on a fast GPU (PR M2)', async () => {
    const { controller, made, engine, settle, frame } = world();
    controller.setEnabled(true);
    controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    await settle();
    // Each write draws on three consecutive display frames, then nothing until the next one: 4 to 15 writes a second.
    for (const hz of [4, 10, 15]) {
      for (let write = 0; write < 20 * hz; write += 1) {
        frame(1_000 / hz - 2_000 / 60);
        frame(1_000 / 60);
        frame(1_000 / 60);
      }
    }
    expect(controller.state()).toMatchObject({ status: 'ready', level: 0 });
    expect(made[0].quality).toEqual({ shadows: true, dropLines: true });
    expect(engine.ratio).toBe(2);
    // The camera moves on the same GPU: fast frames, still full quality.
    engine.moving = true;
    for (let index = 0; index < 600; index += 1) frame(1_000 / 60);
    expect(controller.state().level).toBe(0);
  });

  it('without the governor (the map lab) slow frames change nothing', async () => {
    const engine = { map: {}, addCustomLayer: vi.fn(), removeCustomLayer: vi.fn() };
    let layer;
    let clock = 0;
    const controller = createAircraft3dController({
      engine, originLngLat: ARP, governor: false, now: () => clock, webgl: () => true,
      load: async () => ({ three: {}, createAircraft3dLayer: options => {
        layer = { id: 'occ-aircraft-3d', options, render: vi.fn(), setQuality: vi.fn(), stats: () => ({}) };
        return layer;
      } }),
    });
    controller.setEnabled(true);
    controller.plan({ aircraft: [aviam('f:k-1')], ...AT_RAMP });
    await Promise.resolve();
    await Promise.resolve();
    for (let index = 0; index < 500; index += 1) {
      clock += 60;
      layer.render();
    }
    expect(controller.state()).toMatchObject({ status: 'ready', level: 0 });
    expect(layer.setQuality).toHaveBeenCalledTimes(1);
  });

  it('CN-30: the followed aircraft draws in 3D with its detailed model even with the 3D off, and then the layer goes', async () => {
    const { controller, load, engine, made, settle } = world();
    const copa = aviam('f:k-9', { callsign: 'CMP893', registration: 'zz-cmp1', typeIcao: 'B738' });
    // 2D on the map, far below the 3D threshold: following loads the chunk for it alone.
    expect(controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15, followedId: 'f:k-9' }).size).toBe(0);
    expect(load).toHaveBeenCalledOnce();
    expect(controller.state()).toMatchObject({ enabled: false, status: 'off', follow: 'loading' });
    await settle();
    expect(engine.layers).toHaveLength(1);
    const ids = controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15, followedId: 'f:k-9' });
    expect([...ids]).toEqual(['f:k-9']);
    expect(controller.state().follow).toBe('ready');
    const { plan, detail } = made[0].options.getInstances();
    // Nothing else is planned; the followed one has its type, its airline's livery and its registration.
    expect(plan.size).toBe(0);
    expect(detail).toMatchObject({ id: 'f:k-9', code: 'B738', livery: LIVERIES.CMP, registration: 'ZZ-CMP1',
      key: 'B738|CMP|ZZ-CMP1', followed: true, onStand: false, heightM: 0, gearDown: true });
    // Posed again every frame from the camera's sample.
    const moved = { ...copa, lon: copa.lon + 0.0001 };
    expect(controller.poseFollowed(moved)).toBe(true);
    expect(controller.followedPose()).toMatchObject({ id: 'f:k-9', lon: moved.lon, heightM: 0, headingDeg: 80 });
    const posed = made[0].options.getInstances().detail;
    expect(posed.lon).toBe(moved.lon);
    expect(posed.revision).toBeGreaterThan(detail.revision);
    expect(controller.poseFollowed({ ...copa, id: 'f:other' })).toBe(false);
    // Followed no more: a map in 2D takes the layer off.
    controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15 });
    expect(engine.layers).toEqual([]);
    expect(controller.state().follow).toBe('off');
  });

  it('HOTFIX-3D: «Seguir en 3D» keeps the 2D symbol of the followed aircraft until the layer really drew its model', async () => {
    const { controller, made, settle, onChange } = world({ reports: true });
    const copa = aviam('f:k-9', { callsign: 'CMP893', registration: 'zz-cmp1', typeIcao: 'B738' });
    controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15, followedId: 'f:k-9' });
    await settle();
    // The layer was added and handed its detail in the same frame; its programs are still compiling, so it drew
    // nothing: the aircraft keeps its 2D symbol (it never vanishes from the map).
    expect(made[0].options.getInstances().detail.key).toBe('B738|CMP|ZZ-CMP1');
    expect(controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15, followedId: 'f:k-9' }).size).toBe(0);
    expect(controller.drawnIds().size).toBe(0);
    // A frame drew another detailed aircraft: still not this one.
    made[0].drawn = { detail: 'A320|UAL|N1', keys: new Set(), animated: false };
    expect(controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15, followedId: 'f:k-9' }).size).toBe(0);
    // Its programs ready, the layer drew it and says so: after that frame the map writes its traffic again, and the 2D
    // symbol gives way.
    made[0].drawn = { detail: 'B738|CMP|ZZ-CMP1', keys: new Set(), animated: false };
    onChange.mockClear();
    made[0].options.onDrawnChange();
    expect(onChange).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledOnce();
    expect([...controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15, followedId: 'f:k-9' })]).toEqual(['f:k-9']);
    // The context lost, the layer draws nothing: the 2D symbol comes back.
    made[0].drawn = { detail: null, keys: new Set(), animated: false };
    expect(controller.plan({ aircraft: [copa], zoom: 9, minZoom: 15, followedId: 'f:k-9' }).size).toBe(0);
  });

  it('HOTFIX-3D: the 2D symbols give way only to the types whose meshes the layer drew', async () => {
    const { controller, made, settle } = world({ reports: true });
    controller.setEnabled(true);
    const aircraft = [aviam('f:k-1'), aviam('f:k-2', { typeIcao: 'B738', lon: near(600)[0], lat: near(600)[1] })];
    controller.plan({ aircraft, ...AT_RAMP });
    await settle();
    expect(controller.plan({ aircraft, ...AT_RAMP }).size).toBe(0);
    const { plan } = made[0].options.getInstances();
    const keyOf = id => [...plan].find(([, entry]) => entry.ids.includes(id))[0];
    expect(keyOf('f:k-1')).not.toBe(keyOf('f:k-2'));
    made[0].drawn = { detail: null, keys: new Set([keyOf('f:k-1')]), animated: false };
    expect([...controller.plan({ aircraft, ...AT_RAMP })]).toEqual(['f:k-1']);
    made[0].drawn = { detail: null, keys: new Set([keyOf('f:k-1'), keyOf('f:k-2')]), animated: false };
    expect([...controller.plan({ aircraft, ...AT_RAMP })].sort()).toEqual(['f:k-1', 'f:k-2']);
  });

  it('CN-30: a pause of the governor keeps the followed aircraft in 3D; without WebGL its follow says failed', async () => {
    const { controller, made, engine, settle } = world();
    controller.setEnabled(true);
    const aircraft = [aviam('f:k-1'), aviam('f:k-2', { lon: near(600)[0], lat: near(600)[1] })];
    controller.plan({ aircraft, ...AT_RAMP });
    await settle();
    controller.pause();
    expect(engine.layers).toEqual([]);
    controller.plan({ aircraft, ...AT_RAMP, followedId: 'f:k-2' });
    expect(engine.layers).toHaveLength(1);
    const { plan, detail } = made[0].options.getInstances();
    expect(plan.size).toBe(0);
    expect(detail.id).toBe('f:k-2');
    expect(controller.state()).toMatchObject({ status: 'paused', follow: 'ready' });
    controller.plan({ aircraft, ...AT_RAMP });
    expect(engine.layers).toEqual([]);

    const flat = world({ webgl: false });
    flat.controller.plan({ aircraft, ...AT_RAMP, followedId: 'f:k-1' });
    expect(flat.controller.state().follow).toBe('failed');
    expect(flat.load).not.toHaveBeenCalled();
  });

  it('CN-30: the chosen aircraft gets the detailed model up close only; the others are pitched and banked', async () => {
    const { controller, made, settle } = world();
    controller.setEnabled(true);
    const climbing = aviam('f:k-3', { onGround: false, altM: 14 + 300, gsMs: 80, vrateMs: 10, trackDeg: 80 });
    const aircraft = [aviam('f:k-1'), climbing];
    controller.plan({ aircraft, ...AT_RAMP });
    await settle();
    controller.plan({ aircraft, zoom: DETAIL_MIN_ZOOM - 0.5, minZoom: 15, selectedId: 'f:k-1' });
    expect(made[0].options.getInstances().detail).toBeNull();
    const ids = controller.plan({ aircraft, zoom: DETAIL_MIN_ZOOM + 0.5, minZoom: 15, selectedId: 'f:k-1' });
    const { plan, detail } = made[0].options.getInstances();
    expect(detail).toMatchObject({ id: 'f:k-1', followed: false });
    expect(ids.has('f:k-1')).toBe(true);
    // Drawn in detail, it leaves the instanced plan; the climbing one stands 300 m up, nose up.
    expect(plan.get('A320').ids).toEqual(['f:k-3', null]);
    const matrix = plan.get('A320').matrices;
    expect(matrix[14]).toBeCloseTo(300, 0);
    // Rx(pitch) lifts the nose: the model's +y axis gains a z component (column 1, row 2).
    expect(matrix[6]).toBeGreaterThan(0.1);
  });

  it('CN-30: detailOf reads the stand an aircraft is parked on and an aircraft without its height', () => {
    const parked = detailOf({ item: { id: 's:A6', lon: 1, lat: 2, headingDeg: 175, typeIcao: 'A320' }, onStand: true },
      { heightM: 3, pitchDeg: 4, bankDeg: 5, gearDown: false, lights: { beacon: false } });
    expect(parked).toMatchObject({ heightM: 0, pitchDeg: 0, bankDeg: 0, gearDown: true, headingDeg: 175, onStand: true });
    expect(detailOf({ item: { id: 'x', lon: 1, lat: 2 }, onStand: false }, null)).toBeNull();
  });
});

describe('projected3d (M8)', () => {
  it('leaves Mercator as it is and holds the 3D back on the globe below the zoom where it is Mercator again', () => {
    const limits = { globeMercatorZoom: GLOBE_MERCATOR_ZOOM };
    expect(projected3d({ ...limits, zoom: 5, minZoom: 13.4, followedId: 'f:1' }))
      .toEqual({ minZoom: 13.4, followedId: 'f:1', animates: true });
    expect(projected3d({ ...limits, projection: 'mercator', zoom: 3, minZoom: 9, followedId: 'f:1' }))
      .toEqual({ minZoom: 9, followedId: 'f:1', animates: true });
    // On the globe: the threshold is at least 12, and the followed aircraft keeps its 2D symbol below 12; the animated
    // traffic (integration with M2) waits for 12 too, so the GeoJSON icons draw the world view.
    expect(projected3d({ ...limits, projection: 'globe', zoom: 5, minZoom: 13.4, followedId: 'f:1' }))
      .toEqual({ minZoom: 13.4, followedId: null, animates: false });
    expect(projected3d({ ...limits, projection: 'globe', zoom: 11.99, minZoom: 9, followedId: 'f:1' }))
      .toEqual({ minZoom: 12, followedId: null, animates: false });
    expect(projected3d({ ...limits, projection: 'globe', zoom: 12, minZoom: 9, followedId: 'f:1' }))
      .toEqual({ minZoom: 12, followedId: 'f:1', animates: true });
    expect(projected3d({ ...limits, projection: 'globe', zoom: undefined, minZoom: undefined, followedId: 'f:1' }))
      .toEqual({ minZoom: undefined, followedId: null, animates: false });
  });
});

// PR M2: the traffic animated by the layer, every frame, from the keyframes of the writes.
describe('the animated traffic (PR M2)', () => {
  const frame = mercatorFrame(ARP);
  // The aircraft written at t = 0 and drawn 120 m further north-east at the next write, 500 ms later.
  function writeOf(aircraft, { t0 = 0, t1 = 500, metres = 120 } = {}) {
    const keyframes = createKeyframes();
    const ahead = aircraft.map(item => {
      const [lon, lat] = destinationPoint([item.lon, item.lat], 45, metres);
      return { ...item, lon, lat };
    });
    writeKeyframes(keyframes, { t0Ms: t0, t1Ms: t1, from: aircraft, ahead });
    return { keyframes, ahead };
  }
  const xyOf = (sprites, id) => {
    const index = sprites.ids.indexOf(id);
    return [sprites.matrices[16 * index + 12], sprites.matrices[16 * index + 13]];
  };

  it('HOTFIX-3D: keeps the GeoJSON icons until the layer drew a whole animated frame', async () => {
    const { controller, made, settle } = world({ animate: true, reports: true });
    const aircraft = [aviam('f:k-1'), other('abc123')];
    const { keyframes } = writeOf(aircraft);
    controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } });
    await settle();
    // Animated, but its sprites' programs are still compiling: no icon gives way.
    expect(controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } }).size).toBe(0);
    expect(controller.animating()).toBe(true);
    made[0].drawn = { detail: null, keys: new Set(), animated: true };
    const ids = controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } });
    expect([...ids].sort()).toEqual(['f:k-1', 'h:abc123']);
  });

  it('in 2D loads the layer for the animation and draws every aircraft as a sprite where each frame puts it', async () => {
    const { controller, load, engine, made, settle, at } = world({ animate: true });
    const aircraft = [aviam('f:k-1'), other('abc123')];
    const { keyframes, ahead } = writeOf(aircraft);
    // The 3D is off and the zoom far below its threshold: the animation alone loads the chunk; the icons stay meanwhile.
    expect(controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } }).size).toBe(0);
    expect(load).toHaveBeenCalledOnce();
    expect(controller.animating()).toBe(false);
    // Not animated: no frame position (the map falls back to the write's).
    expect(controller.framePosition('f:k-1')).toBeNull();
    expect(controller.framedCount()).toBe(0);
    await settle();
    expect(engine.layers).toHaveLength(1);
    expect(controller.state()).toMatchObject({ enabled: false, status: 'off', notice: null });
    const ids = controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } });
    expect([...ids].sort()).toEqual(['f:k-1', 'h:abc123']);
    expect(controller.animating()).toBe(true);
    expect(controller.drawnIds()).toBe(ids);

    // At the write, halfway and at the next write: the sprites stand where the keyframes put them.
    const { getInstances } = made[0].options;
    at(0);
    const first = getInstances();
    expect(first.plan.size).toBe(0);
    expect(xyOf(first.sprites, 'f:k-1')).toEqual(frame.toLocal([aircraft[0].lon, aircraft[0].lat])
      .map(value => expect.closeTo(value, 1)));
    at(250);
    const middle = getInstances();
    expect(middle.revision).toBeGreaterThan(first.revision);
    const [x0, y0] = xyOf(first.sprites, 'f:k-1');
    const [x1, y1] = xyOf(middle.sprites, 'f:k-1');
    // PR M2: the frame position is where this frame drew it, not the write's.
    expect(frame.toLocal(controller.framePosition('f:k-1'))).toEqual([x1, y1].map(value => expect.closeTo(value, 1)));
    expect(controller.framePosition('f:k-1')).not.toEqual([aircraft[0].lon, aircraft[0].lat]);
    expect(controller.framedCount()).toBe(2);
    expect(controller.framePosition('h:nobody')).toBeNull();
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeGreaterThan(40);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(80);
    at(500);
    expect(xyOf(getInstances().sprites, 'h:abc123')).toEqual(frame.toLocal([ahead[1].lon, ahead[1].lat])
      .map(value => expect.closeTo(value, 1)));
    // Moving until the pair ends (and its frame of grace); then the frames rest on the same answer.
    expect(controller.animationMoving(250)).toBe(true);
    expect(controller.animationMoving(600)).toBe(false);
    at(600);
    const resting = getInstances();
    at(700);
    expect(getInstances()).toBe(resting);
    // A pick reaches the layer while it animates, also in 2D.
    made[0].pick = vi.fn(() => ({ kind: 'aircraft', id: 'h:abc123' }));
    expect(controller.pick({ x: 1, y: 2 })).toEqual({ kind: 'aircraft', id: 'h:abc123' });
  });

  it('in 3D draws the models of every aircraft in sight at the positions of the frame, at any distance', async () => {
    const { controller, made, settle, at } = world({ animate: true });
    controller.setEnabled(true);
    const [farLon, farLat] = near(30 * 1_852, 120);
    const aircraft = [aviam('f:k-1'), other('abc123', { lon: farLon, lat: farLat, altM: 3_000 }),
      other('def456', { onGround: true, altM: 0 })];
    const { keyframes, ahead } = writeOf(aircraft);
    controller.plan({ aircraft, ...AT_RAMP, animation: { keyframes } });
    await settle();
    controller.plan({ aircraft, ...AT_RAMP, animation: { keyframes } });
    at(500);
    const { plan, sprites } = made[0].options.getInstances();
    // The B738 30 NM out is a model too (no 6 NM circle); other traffic on the ground stays a sprite (contracts 2.4).
    expect(plan.get('B738').ids).toEqual(['h:abc123', null]);
    expect(plan.get('A320').ids).toEqual(['f:k-1', null]);
    expect([...sprites.ids]).toEqual(['h:def456']);
    const [x, y] = frame.toLocal([ahead[1].lon, ahead[1].lat]);
    expect(plan.get('B738').matrices[12]).toBeCloseTo(x, 0);
    expect(plan.get('B738').matrices[13]).toBeCloseTo(y, 0);
    // Paused by the governor, the 3D gives way to the sprites of every aircraft.
    controller.pause();
    expect(controller.animating()).toBe(true);
    controller.plan({ aircraft, ...AT_RAMP, animation: { keyframes } });
    const paused = made[0].options.getInstances();
    expect(paused.plan.size).toBe(0);
    expect([...paused.sprites.ids].sort()).toEqual(['f:k-1', 'h:abc123', 'h:def456']);
  });

  it('the governor measures the frames the animation draws: slow ones step down, fast ones keep full quality', async () => {
    const slowGpu = world({ animate: true });
    slowGpu.controller.setEnabled(true);
    const aircraft = [aviam('f:k-1')];
    // One pair that moves for a minute: the frame loop repaints the map every frame meanwhile.
    const { keyframes } = writeOf(aircraft, { t1: 60_000, metres: 5_000 });
    slowGpu.controller.plan({ aircraft, ...AT_RAMP, animation: { keyframes } });
    await slowGpu.settle();
    slowGpu.controller.plan({ aircraft, ...AT_RAMP, animation: { keyframes } });
    expect(slowGpu.controller.animationMoving(0)).toBe(true);
    for (let index = 0; index < 110; index += 1) slowGpu.frame(40);
    expect(slowGpu.controller.state().level).toBe(2);
    expect(slowGpu.made[0].quality).toEqual({ shadows: false, dropLines: false });

    const fastGpu = world({ animate: true });
    fastGpu.controller.setEnabled(true);
    fastGpu.controller.plan({ aircraft, ...AT_RAMP, animation: { keyframes } });
    await fastGpu.settle();
    fastGpu.controller.plan({ aircraft, ...AT_RAMP, animation: { keyframes } });
    for (let index = 0; index < 1_200; index += 1) fastGpu.frame(1_000 / 60);
    expect(fastGpu.controller.state()).toMatchObject({ status: 'ready', level: 0 });
    // Once the pair has ended nothing moves: the renders that follow are not measured.
    fastGpu.at(61_000);
    for (let index = 0; index < 400; index += 1) fastGpu.frame(60);
    expect(fastGpu.controller.state().level).toBe(0);
  });

  it('keeps the GeoJSON icons without WebGL2, without keyframes and once the sprites cannot be built', async () => {
    const aircraft = [aviam('f:k-1')];
    const { keyframes } = writeOf(aircraft);
    const flat = world({ animate: true, webgl: false });
    expect(flat.controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } }).size).toBe(0);
    expect(flat.load).not.toHaveBeenCalled();
    expect(flat.controller.animating()).toBe(false);

    const still = world({ animate: true });
    still.controller.plan({ aircraft, zoom: 9, minZoom: 15 });
    expect(still.load).not.toHaveBeenCalled();

    const { controller, engine, made, settle, onChange } = world({ animate: true });
    controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } });
    await settle();
    expect(controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } }).size).toBe(1);
    onChange.mockClear();
    made[0].options.onSpritesFailedChange(true);
    await Promise.resolve();
    expect(onChange).toHaveBeenCalled();
    expect(engine.layers).toEqual([]);
    expect(controller.animating()).toBe(false);
    expect(controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } }).size).toBe(0);
  });

  it('hands the layer the tags and the chosen ring of each frame, and leaves out what the layers menu hides', async () => {
    const { controller, engine, made, settle, at } = world({ animate: true });
    let zoom = 14;
    engine.getCamera = () => ({ zoom, bearing: 0 });
    const ground = other('def456', { onGround: true, altM: 0, callsign: 'GND1' });
    const aircraft = [aviam('f:k-1', { flightNumber: 'DM101', onGround: false, altM: 600 }), other('abc123'), ground];
    const { keyframes, ahead } = writeOf(aircraft);
    const plan = extra => controller.plan({ aircraft, zoom: 14, minZoom: 15, animation: { keyframes }, language: 'es',
      otherGroundMinZoom: 14.5, otherTagsMinZoom: 14.5, ...extra });
    plan();
    await settle();
    plan({ selectedId: 'f:k-1', focusId: 'h:abc123' });
    const { getInstances } = made[0].options;
    at(500);
    const { labels, sprites } = getInstances();
    // Other traffic on the ground waits for its threshold, as its GeoJSON layer does.
    expect([...sprites.ids].sort()).toEqual(['f:k-1', 'h:abc123']);
    const tags = new Map(labels.tags.map(tag => [tag.id, tag]));
    expect([...tags.keys()].sort()).toEqual(['f:k-1', 'h:abc123']);
    expect(tags.get('f:k-1')).toMatchObject({ priority: 0, always: true });
    expect(tags.get('f:k-1').tag).toMatchObject({ aviam: true, tag1: 'DM101' });
    // The tag and the ring stand where the frame draws the aircraft.
    const [x, y] = frame.toLocal([ahead[0].lon, ahead[0].lat]);
    expect(tags.get('f:k-1').x).toBeCloseTo(x, 0);
    expect(labels.ring.x).toBeCloseTo(x, 0);
    expect(labels.ring.y).toBeCloseTo(y, 0);
    // From the threshold up the ground traffic is drawn too; with all the tags on, its tag may show.
    zoom = 15;
    plan({ labelsOn: true });
    const closer = getInstances();
    expect([...closer.sprites.ids].sort()).toEqual(['f:k-1', 'h:abc123', 'h:def456']);
    expect(closer.labels.tags.find(tag => tag.id === 'h:def456')).toMatchObject({ priority: 3, always: false });
    expect(closer.labels.ring).toBeNull();
    // A group the layers menu hides is not drawn, its tags neither; the chosen aircraft still is.
    plan({ shown: { aviam: true, other: false }, selectedId: 'h:abc123' });
    const hidden = getInstances();
    expect([...hidden.sprites.ids].sort()).toEqual(['f:k-1', 'h:abc123']);
    plan({ shown: { aviam: false, other: true } });
    expect([...getInstances().sprites.ids].sort()).toEqual(['h:abc123', 'h:def456']);
    expect(getInstances().labels.tags.map(tag => tag.id)).toEqual([]);
  });
});

// Integration of M2 with M4, M8 and M9: the animated frames keep the liveries, the ground traffic near the field and the
// contact shadows of the models, hide the followed aircraft's marks close up and dim what the board's filter leaves out.
describe('the animated traffic with the liveries, the close-up view and the board filter', () => {
  function writeOf(aircraft, { t0 = 0, t1 = 500, metres = 60 } = {}) {
    const keyframes = createKeyframes();
    const ahead = aircraft.map(item => {
      const [lon, lat] = destinationPoint([item.lon, item.lat], 45, metres);
      return { ...item, lon, lat };
    });
    writeKeyframes(keyframes, { t0Ms: t0, t1Ms: t1, from: aircraft, ahead });
    return { keyframes };
  }
  const opacityOf = (sprites, id) => sprites.opacities[sprites.ids.indexOf(id)];

  it("M9: each animated frame plans the parked and nearby aircraft in their airlines' colours, with contact shadows (M4)", async () => {
    const { controller, made, settle, at } = world({ animate: true, liveries: true });
    controller.setEnabled(true);
    const [lon, lat] = near(1_200, 300);
    const taxiing = other('def456', { lon, lat, onGround: true, altM: 0, callsign: 'AAL1234' });
    const jetblue = aviam('f:k-1', { callsign: 'JBU1234' });
    const [standLon, standLat] = near(600, 30);
    const parked = [{ id: 's:B20', lon: standLon, lat: standLat, headingDeg: 200, typeIcao: 'A320', model: 'A320',
      kind: 'aviam', flightNumber: 'CM 893' }];
    const aircraft = [jetblue, taxiing];
    const { keyframes } = writeOf(aircraft);
    controller.plan({ aircraft, parked, ...AT_RAMP, animation: { keyframes } });
    await settle();
    controller.plan({ aircraft, parked, ...AT_RAMP, animation: { keyframes } });
    expect(controller.animating()).toBe(true);
    at(250);
    const { plan, sprites } = made[0].options.getInstances();
    const a320 = plan.get('A320');
    expect(a320.ids.slice(0, a320.aircraftCount)).toEqual(['f:k-1', 's:B20']);
    expect(Array.from(a320.zoneColors.tail.slice(0, 3)))
      .toEqual(Array.from(Float32Array.from(liveryInstanceColours({ airlineIcao: 'JBU' }).tail)));
    expect(Array.from(a320.zoneColors.tail.slice(3, 6)))
      .toEqual(Array.from(Float32Array.from(liveryInstanceColours({ airlineIcao: 'CMP' }).tail)));
    // The other traffic on the ground near the field is a model in its livery, not a sprite.
    expect(plan.get('B738').ids).toEqual(['h:def456', null]);
    expect(Array.from(plan.get('B738').zoneColors.tail.slice(0, 3)))
      .toEqual(Array.from(Float32Array.from(liveryInstanceColours({ airlineIcao: 'AAL' }).tail)));
    expect(sprites.ids).not.toContain('h:def456');
    // The soft contact shadows under them, planned with every frame.
    expect(Array.from(a320.contactStrengths)).toEqual([1, 1]);
    expect(plan.get('B738').contactStrengths[0]).toBe(1);
  });

  it('M4: close up the followed aircraft has no estimated ring or «Demo» plate, and no tag or ring shows', async () => {
    const { controller, engine, made, settle, at } = world({ animate: true });
    let closeUp = false;
    engine.isCloseUp = () => closeUp;
    const followed = aviam('f:k-1', { quality: 'estimated', isDemo: true, flightNumber: 'DM1' });
    const otherDemo = aviam('f:k-2', { isDemo: true, flightNumber: 'DM2', lon: near(900, 120)[0], lat: near(900, 120)[1] });
    const aircraft = [followed, otherDemo];
    const { keyframes } = writeOf(aircraft);
    const plan = () => controller.plan({ aircraft, zoom: 9, minZoom: 15, selectedId: 'f:k-1', animation: { keyframes } });
    plan();
    await settle();
    plan();
    const { getInstances } = made[0].options;
    at(100);
    const far = getInstances();
    // Two plates and the estimated ring (marks have no id), the tags and the chosen ring.
    expect(far.sprites.ids.filter(id => id === null)).toHaveLength(3);
    expect(far.labels.tags.map(tag => tag.id).sort()).toEqual(['f:k-1', 'f:k-2']);
    expect(far.labels.ring).not.toBeNull();
    closeUp = true;
    at(200);
    const close = getInstances();
    // Only the other demo flight's plate stays; its silhouette and the followed one's too.
    expect(close.sprites.ids.filter(id => id === null)).toHaveLength(1);
    expect([...close.sprites.ids].filter(Boolean).sort()).toEqual(['f:k-1', 'f:k-2']);
    expect(close.labels.tags).toEqual([]);
    expect(close.labels.ring).toBeNull();
    // Back from close up, at rest too (the frame cache knows the view changed).
    closeUp = false;
    at(800);
    at(900);
    expect(getInstances().labels.ring).not.toBeNull();
  });

  it('M8: the aircraft the board filter leaves out are dimmed in the animated frames, at rest too', async () => {
    const { controller, engine, made, settle, at } = world({ animate: true });
    const kept = aviam('f:k-1', { flightNumber: 'DM1', isDemo: true });
    const left = aviam('f:k-2', { flightNumber: 'DM2', lon: near(900, 120)[0], lat: near(900, 120)[1] });
    const aircraft = [kept, left];
    const { keyframes } = writeOf(aircraft);
    controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } });
    await settle();
    controller.plan({ aircraft, zoom: 9, minZoom: 15, animation: { keyframes } });
    const { getInstances } = made[0].options;
    at(800);
    const before = getInstances();
    expect(opacityOf(before.sprites, 'f:k-2')).toBe(1);
    engine.map.triggerRepaint.mockClear();
    controller.setOutside(new Set(['f:k-2']));
    expect(engine.map.triggerRepaint).toHaveBeenCalled();
    at(900);
    const dimmed = getInstances();
    expect(dimmed).not.toBe(before);
    expect(opacityOf(dimmed.sprites, 'f:k-2')).toBeCloseTo(OUTSIDE_FILTER_OPACITY, 6);
    expect(opacityOf(dimmed.sprites, 'f:k-1')).toBe(1);
    expect(dimmed.labels.tags.find(tag => tag.id === 'f:k-2').opacity).toBeCloseTo(OUTSIDE_FILTER_OPACITY, 6);
    // The same filter again changes nothing; none gives the full opacity back.
    engine.map.triggerRepaint.mockClear();
    controller.setOutside(new Set(['f:k-2']));
    expect(engine.map.triggerRepaint).not.toHaveBeenCalled();
    controller.setOutside(null);
    at(1_000);
    expect(opacityOf(getInstances().sprites, 'f:k-2')).toBe(1);
  });
});
