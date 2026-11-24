import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONSOLE_READS } from '../../dashboard/noc/consoleReads';
import { airPictureDelayMs, MAP_SITUATION_READS } from '../../maps/useMapSituation';
import { occMountedFiles, readSource } from '../../../styles/occSourceScan';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import { OCC_COALESCE_MS, OCC_HINT_COALESCE_MS, OCC_OBSERVER_POLL_MS } from './occCadence';
import {
  OCC_DEMO_MINUTE, OCC_OBSERVER_SITES, OCC_REQUEST_BUDGET, OCC_REQUEST_PLAN, OCC_SCREEN_POLLS, OCC_SCREEN_REFRESH,
  OCC_SHELL_LISTENERS,
} from './occRequestPlan';
import { createRefreshScheduler } from './refreshScheduler';
import { createScreenRefresh } from './useOccScreenRefresh';

// A replayed minute of one OCC tab (contracts 2.7). Everything mounts at t = 0; after a 60 s warm-up the next
// minute is counted, without the mount reads. The shell's observer groups the hubs' hints as
// services/accountChangeObserver.js does (`hintCoalesceMs`) and delivers what changed once its cursor read answers; the
// shell's reads run through the same refresh scheduler as useOccResource, and the screens of OCC_SCREEN_REFRESH through
// useOccScreenRefresh's. The screens that listen on the shell's channel re-read on each delivery, uncoalesced, and an
// observer of a screen's own (none is left under /admin-occ) would read its cursor for every hint.

const WARM_UP_MS = 60_000;
const MINUTE_MS = 60_000;
// Long enough to exercise the in-flight joins, far below every cadence.
const READ_LATENCY_MS = 200;
const OBSERVER_FACTORY = 'src/services/accountChangeObserver.js';
const SCRIPT_FILE = /\.(?:js|jsx|mjs)$/;
const MODES = ['shell', 'screen', 'shared-page', 'outside-shell-fallback', 'disabled-in-occ', 'import-only'];
const SCREEN_IDS = ADMIN_OCC_NAVIGATION.map(item => item.id);
const SITES = Object.entries(OCC_OBSERVER_SITES);
const LISTENERS = Object.entries(OCC_SHELL_LISTENERS);
const REFRESHED = Object.entries(OCC_SCREEN_REFRESH);
const CONSOLE_SCREEN = 'dashboard';
const MAP_READS = Object.fromEntries(OCC_REQUEST_PLAN.console.map(read => [read.key, read]));

function createSimulation() {
  let now = 0;
  let order = 0;
  const timers = [];
  const requests = [];
  const schedule = (callback, ms) => {
    const timer = { at: now + ms, order: order++, callback, cancelled: false };
    timers.push(timer);
    return timer;
  };
  const cancel = timer => { if (timer) timer.cancelled = true; };
  const every = (ms, callback) => {
    const tick = () => { callback(); schedule(tick, ms); };
    schedule(tick, ms);
  };
  const runUntil = end => {
    for (;;) {
      let next = null;
      for (const timer of timers) {
        if (timer.cancelled || timer.at >= end) continue;
        if (!next || timer.at < next.at || (timer.at === next.at && timer.order < next.order)) next = timer;
      }
      if (!next) break;
      next.cancelled = true;
      now = next.at;
      next.callback();
    }
    now = end;
  };
  return { now: () => now, schedule, cancel, every, runUntil, requests, send: key => requests.push({ at: now, key }) };
}

// The hints of the hubs: the shell's observer hears every one and delivers what changed to the shell's channel after its
// cursor read; an observer of a screen's own reads its cursor at once for every hint and re-reads its resources.
function createHub() {
  const subscribers = [];
  const own = [];
  let shell = null;
  return {
    subscribe: (resources, callback) => subscribers.push({ resources, callback }),
    deliver(resources) {
      for (const subscriber of subscribers) {
        if (subscriber.resources.some(resource => resources.includes(resource))) subscriber.callback();
      }
    },
    setShell(observer) { shell = observer; },
    addOwn(observer) { own.push(observer); },
    announce(resource) {
      shell?.hint(resource);
      own.forEach(observer => observer.hint(resource));
    },
  };
}

// The shell's observer (services/accountChangeObserver.js): a pass reads the cursor and, once it answers, delivers the
// resources announced before it began; one asked for while a pass runs follows it. The first hint after a quiet window
// reads at once, and the next ones share one trailing pass `hintCoalesceMs` after the last pass began; the poll's
// passes count for that window too.
function addShellObserver(sim, hub, { pollMs = OCC_REQUEST_PLAN.observer.pollMs,
  hintCoalesceMs = OCC_REQUEST_PLAN.observer.hintCoalesceMs } = {}) {
  let pending = new Set();
  let lastPassAt = null;
  let timer = null;
  let active = false;
  let dirty = false;
  function pass() {
    lastPassAt = sim.now();
    sim.cancel(timer);
    timer = null;
    active = true;
    sim.send('shell:cursor');
    const batch = [...pending];
    pending = new Set();
    sim.schedule(() => {
      active = false;
      if (batch.length) hub.deliver(batch);
      if (dirty) {
        dirty = false;
        pass();
      }
    }, READ_LATENCY_MS);
  }
  const reconcile = () => { if (active) dirty = true; else pass(); };
  hub.setShell({
    hint(resource) {
      pending.add(resource);
      if (timer !== null) return;
      const wait = lastPassAt === null ? 0 : lastPassAt + hintCoalesceMs - sim.now();
      if (wait <= 0) reconcile();
      else timer = sim.schedule(() => { timer = null; reconcile(); }, wait);
    },
  });
  reconcile();
  sim.every(pollMs, reconcile);
}

// A useOccResource read: coalesced announcements, a safety poll chained from the last finished read.
function addShellRead(sim, hub, { key, resources, pollMs, coalesceMs, fixedRate }) {
  if (fixedRate) {
    sim.send(key);
    sim.every(pollMs, () => sim.send(key));
    return;
  }
  let inFlight = false;
  let poll = null;
  const scheduler = createRefreshScheduler({ coalesceMs, now: sim.now, schedule: sim.schedule, cancel: sim.cancel,
    isHidden: () => false, run: () => read() });
  function read() {
    sim.send(key);
    inFlight = true;
    sim.cancel(poll);
    scheduler.started();
    sim.schedule(() => {
      inFlight = false;
      poll = sim.schedule(() => { if (!inFlight) read(); }, pollMs);
      scheduler.settled();
    }, READ_LATENCY_MS);
  }
  if (resources.length) hub.subscribe(resources, () => scheduler.request());
  read();
}

// A screen with an observer of its own: a cursor read per hint and every 25 s, and each matching hint and each tick of
// its poll re-reads at once.
function addOwnSite(sim, hub, label, { resources, pollMs, readsPerRefresh }) {
  const cursor = () => sim.send(`${label}:cursor`);
  const refresh = () => { for (let count = 0; count < readsPerRefresh; count += 1) sim.send(`${label}:read`); };
  cursor();
  sim.every(OCC_OBSERVER_POLL_MS, cursor);
  refresh();
  hub.addOwn({ hint(resource) { cursor(); if (resources.includes(resource)) refresh(); } });
  if (pollMs) sim.every(pollMs, refresh);
}

// A screen on the shell's channel outside useOccResource: each delivery and each tick of its poll re-reads at once.
function addRidingSite(sim, hub, label, { resources, pollMs, readsPerRefresh }) {
  const refresh = () => { for (let count = 0; count < readsPerRefresh; count += 1) sim.send(`${label}:read`); };
  refresh();
  hub.subscribe(resources, refresh);
  if (pollMs) sim.every(pollMs, refresh);
}

// A screen of OCC_SCREEN_REFRESH (useOccScreenRefresh): its data hooks send `readsPerRefresh` requests per token and say
// they are busy until they answer.
function addScreenRefresh(sim, hub, label, { resources, coalesceMs, pollMs, readsPerRefresh }) {
  let engine = null;
  const readAll = () => {
    for (let count = 0; count < readsPerRefresh; count += 1) sim.send(`${label}:read`);
    engine.busy(true);
    sim.schedule(() => engine.busy(false), READ_LATENCY_MS);
  };
  engine = createScreenRefresh({ coalesceMs, pollMs, schedule: sim.schedule, cancel: sim.cancel, now: sim.now,
    hidden: () => false, onRead: readAll });
  engine.start();
  readAll();
  hub.subscribe(resources, () => engine.announce());
}

function simulate({ shellReads, ownSites = [], ridingSites = [], refreshed = [], screenPolls = [], script = [],
  observer = {} }) {
  const sim = createSimulation();
  const hub = createHub();
  addShellObserver(sim, hub, observer);
  shellReads.forEach(read => addShellRead(sim, hub, read));
  ownSites.forEach(([label, site]) => addOwnSite(sim, hub, label, site));
  ridingSites.forEach(([label, site]) => addRidingSite(sim, hub, label, site));
  refreshed.forEach(([label, site]) => addScreenRefresh(sim, hub, label, site));
  screenPolls.forEach(({ key, pollMs }) => { sim.send(key); sim.every(pollMs, () => sim.send(key)); });
  script.forEach(({ at, resource }) => sim.schedule(() => hub.announce(resource), WARM_UP_MS + at * 1_000));
  sim.runUntil(WARM_UP_MS + MINUTE_MS);
  const counted = sim.requests.filter(request => request.at >= WARM_UP_MS && request.at < WARM_UP_MS + MINUTE_MS);
  const byKey = {};
  for (const { key } of counted) byKey[key] = (byKey[key] ?? 0) + 1;
  return { total: counted.length, byKey, requests: counted };
}

const fileLabel = file => file.split('/').at(-1).replace(SCRIPT_FILE, '');

// The planned console: the shell's observer, the frame's reads and the console's.
const plannedConsole = (script, observer) => simulate({
  shellReads: [...OCC_REQUEST_PLAN.frame, ...OCC_REQUEST_PLAN.console], script, observer });

// A screen as it is today: the frame plus every observer of that screen (each of its tabs and drawers open), what
// re-reads on the shell's deliveries without one of its own, its useOccScreenRefresh and the map reads it mounts when
// it opens. Panorama is the planned console.
function screenToday(screen, script) {
  const own = SITES.filter(([, site]) => site.screen === screen && ['screen', 'shared-page'].includes(site.mode));
  const riding = [...SITES.filter(([, site]) => site.screen === screen && site.mode === 'outside-shell-fallback'),
    ...LISTENERS.filter(([, listener]) => listener.screen === screen)];
  const refreshed = REFRESHED.filter(([, site]) => site.screen === screen);
  const maps = refreshed.flatMap(([, site]) => site.map.map(key => MAP_READS[key]));
  return simulate({
    shellReads: [...OCC_REQUEST_PLAN.frame, ...(screen === CONSOLE_SCREEN ? OCC_REQUEST_PLAN.console : maps)],
    ownSites: own.map(([file, site]) => [fileLabel(file), site]),
    ridingSites: riding.map(([file, site]) => [fileLabel(file), site]),
    refreshed: refreshed.map(([file, site]) => [fileLabel(file), site]),
    screenPolls: OCC_SCREEN_POLLS.filter(poll => poll.screen === screen),
    script,
  });
}

const breakdown = result => `${result.total} requests: ${JSON.stringify(result.byKey)}`;
const digits = source => source.replace(/(\d)_(?=\d)/g, '$1');
const occPlanningAt = minute => minute.filter(item => item.resource === 'occ_planning').map(item => item.at);

describe('OCC request budget', () => {
  // It reads every file mounted under /admin-occ: slow on a loaded machine.
  it('the frame opens one account-change observer per OCC tab, which groups the hints of its hubs', { timeout: 30_000 }, () => {
    const shells = SITES.filter(([, site]) => site.mode === 'shell').map(([file]) => file);
    expect(shells).toEqual(['src/features/admin-occ/shell/OccShellProvider.jsx']);
    expect(OCC_REQUEST_PLAN.observer.owner).toBe(shells[0]);
    expect(OCC_REQUEST_PLAN.observer.pollMs).toBe(OCC_OBSERVER_POLL_MS);
    expect(OCC_REQUEST_PLAN.observer.hintCoalesceMs).toBe(OCC_HINT_COALESCE_MS);
    expect(readSource(shells[0])).toMatch(/hintCoalesceMs: OCC_HINT_COALESCE_MS/);
    expect(readSource(OBSERVER_FACTORY)).toMatch(/hub\.on\('ChangedV1', onHint\)/);

    // The frame's other observers are off where the OCC mounts them.
    expect(readSource('src/app/RoleLayout.jsx')).toMatch(/<DepartmentAccessProvider observe=\{role !== 'adminOcc'\}>/);
    const layout = readSource('src/features/admin-occ/AdminOccLayout.jsx');
    expect(layout).toMatch(/<OccShellProvider>/);
    expect(layout).toMatch(/notificationsEnabled=\{false\}/);
    expect(layout).not.toMatch(/notificationsSource=/);
    expect(readSource(OBSERVER_FACTORY)).toMatch(/pollMs = 25_000/);

    // On every screen, every cursor read of the minute is the shell's: no screen keeps an observer of its own.
    for (const screen of SCREEN_IDS) {
      for (const script of [[], OCC_DEMO_MINUTE]) {
        const cursorReaders = Object.keys(screenToday(screen, script).byKey).filter(key => key.endsWith(':cursor'));
        expect(cursorReaders, screen).toEqual(['shell:cursor']);
      }
    }
  });

  // It reads every file mounted under /admin-occ: slow on a loaded machine.
  it('names every account-change observer that remains under /admin-occ, each off or on the shell inside it', { timeout: 30_000 }, () => {
    const found = occMountedFiles().filter(file => SCRIPT_FILE.test(file) && file !== OBSERVER_FACTORY
      && /\bcreatePrivateWebAccountChangeObserver\b/.test(readSource(file)));
    const listed = Object.keys(OCC_OBSERVER_SITES);
    expect({
      notListed: found.filter(file => !listed.includes(file)),
      notFound: listed.filter(file => !found.includes(file)),
    }, 'every file mounted under /admin-occ that opens an account-change observer is listed in OCC_OBSERVER_SITES, '
      + 'and nothing else is').toEqual({ notListed: [], notFound: [] });

    // No screen of the OCC opens an observer of its own any more (CN-18/19).
    expect(SITES.filter(([, site]) => ['screen', 'shared-page'].includes(site.mode)).map(([file]) => file)).toEqual([]);

    // The table describes the code: its modes and screens exist, and every resource and pace is in the file it names.
    for (const [file, site] of SITES) {
      expect(MODES, file).toContain(site.mode);
      if (site.screen !== null) expect(SCREEN_IDS, file).toContain(site.screen);
      const source = readSource(file);
      for (const resource of site.resources) expect(source, `${file}: ${resource}`).toContain(`'${resource}'`);
      if (site.pollMs) expect(digits(source), `${file}: ${site.pollMs} ms`).toMatch(new RegExp(`\\b${site.pollMs}\\b`));
      if (site.mode === 'disabled-in-occ' || site.mode === 'import-only') expect(site.offBy, file).toBeTruthy();
      // A fallback hears the shell's channel when the frame is there.
      if (site.mode === 'outside-shell-fallback') expect(source, file).toMatch(/\buseOptionalOccShellChannel\(\)/);
    }
    for (const poll of [...OCC_SCREEN_POLLS, ...OCC_REQUEST_PLAN.frame.filter(read => read.fixedRate)]) {
      const file = poll.file ?? poll.owner;
      expect(digits(readSource(file)), `${file}: ${poll.pollMs} ms`).toMatch(new RegExp(`\\b${poll.pollMs}\\b`));
    }
  });

  // It reads every file mounted under /admin-occ: slow on a loaded machine.
  it('the screens with reads of their own re-read on useOccScreenRefresh, with no observer, poll or timer of theirs', { timeout: 30_000 }, () => {
    expect(REFRESHED.map(([file, site]) => `${file} → ${site.screen}`)).toEqual([
      'src/features/flight-monitoring/FlightMonitoringRoute.jsx → flight-monitoring',
      'src/features/positions-map/PositionsMapRoute.jsx → positions-map',
      'src/features/planning/PlanningRoute.jsx → planning',
    ]);
    const mounted = occMountedFiles();
    for (const [file, site] of REFRESHED) {
      expect(mounted, file).toContain(file);
      expect(SCREEN_IDS, file).toContain(site.screen);
      const source = readSource(file);
      expect(source, file).toMatch(/\buseOccScreenRefresh\(/);
      expect(source, file).not.toMatch(/\bcreatePrivateWebAccountChangeObserver\b/);
      expect(source, file).not.toMatch(/\bsetInterval\(/);
      expect(source, file).not.toMatch(/addEventListener\('focus'/);
      for (const resource of site.resources) expect(source, `${file}: ${resource}`).toContain(`'${resource}'`);
      for (const key of site.map) expect(MAP_READS, `${file}: ${key}`).toHaveProperty([key]);
    }
    // Their snapshot services keep no timer of their own outside the tests.
    for (const file of ['src/services/flightMonitoringService.js', 'src/services/positionsMapService.js']) {
      expect(readSource(file), file).not.toMatch(/\}, 30000\)/);
    }
  });

  // It reads every file mounted under /admin-occ: slow on a loaded machine.
  it('counts the screens that listen on the shell channel: no observer of their own, their re-reads in the budget', { timeout: 30_000 }, () => {
    // The five screens of U6 that had an observer of their own (contratos 2.7): none is left among the observers.
    expect(LISTENERS.map(([file, listener]) => `${file} → ${listener.movedIn}`)).toEqual([
      'src/features/position-coverage/CoverageRoute.jsx → U6',
      'src/features/master-data/MasterDataRoute.jsx → U6',
      'src/features/devices/DevicesRoute.jsx → U6',
      'src/features/chat/CanonicalChatRoute.jsx → U6',
      'src/features/notifications/CanonicalNotificationsRoute.jsx → U6',
    ]);
    expect(SITES.filter(([, site]) => site.movesIn === 'U6')).toEqual([]);
    const mounted = occMountedFiles();
    for (const [file, listener] of LISTENERS) {
      // The table describes the code: a screen of /admin-occ that takes the frame's channel and listens there to its
      // resources, with no observer of its own and no entry among the observers, and polls at the pace it names.
      expect(mounted, file).toContain(file);
      expect(SCREEN_IDS, file).toContain(listener.screen);
      expect(OCC_OBSERVER_SITES, file).not.toHaveProperty([file]);
      const source = readSource(file);
      expect(source, file).toMatch(/\buseOccShellChannel\(\)/);
      expect(source, file).not.toMatch(/\bcreatePrivateWebAccountChangeObserver\b/);
      for (const resource of listener.resources) expect(source, `${file}: ${resource}`).toContain(`'${resource}'`);
      if (listener.pollMs) expect(digits(source), `${file}: ${listener.pollMs} ms`).toMatch(new RegExp(`\\b${listener.pollMs}\\b`));

      // A minute with one announcement of each of its resources: the screen reads no cursor (only the shell's observer
      // does), and its re-reads are counted on top of its own poll.
      const label = `${fileLabel(file)}:read`;
      const quiet = screenToday(listener.screen, []);
      const minute = screenToday(listener.screen, listener.resources.map(resource => ({ at: 10, resource })));
      expect(Object.keys(minute.byKey).filter(key => key.endsWith(':cursor')), file).toEqual(['shell:cursor']);
      expect((minute.byKey[label] ?? 0) - (quiet.byKey[label] ?? 0), file).toBe(listener.readsPerRefresh);
    }
  });

  it('the denser demo minute is what the VPS showed: the code before CN-18/19 sent Panorama 52 requests in it', () => {
    // A demo pass every 5 s, five tablet taps, two notices and one hand-off.
    expect(occPlanningAt(OCC_DEMO_MINUTE)).toEqual([0, 5, 10, 15, 20, 21, 22, 23, 25, 30, 35, 37, 38, 40, 45, 50, 55]);
    expect(OCC_DEMO_MINUTE).toHaveLength(20);
    // Every hint read the cursor at once before CN-18/19 (no `hintCoalesceMs`).
    const before = plannedConsole(OCC_DEMO_MINUTE, { hintCoalesceMs: 0 });
    expect(before.total, breakdown(before)).toBeGreaterThanOrEqual(50);
    expect(before.total, breakdown(before)).toBeLessThanOrEqual(55);
    expect(before.byKey['shell:cursor']).toBe(22);
  });

  it('the planned console stays within 40 requests a minute at rest', () => {
    const rest = plannedConsole([]);
    expect(rest.total, breakdown(rest)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.rest);
    // What the minute holds: two cursor polls, the air picture every 10 s, every 60 s read once, the presence lease.
    expect(rest.byKey).toEqual({ 'shell:cursor': 2, airPicture: 6, mapFlights: 1, planning: 1, positions: 1,
      reviewQueue: 1, readiness: 1, notices: 1, presence: 2 });
    expect(rest.total).toBe(16);
  });

  it('the planned console stays within 40 requests during the demo minute', () => {
    const demo = plannedConsole(OCC_DEMO_MINUTE);
    expect(demo.total, breakdown(demo)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.demo);
    // The twenty hints share a cursor read every 10 s at most, and the flights follow those reads.
    expect(demo.byKey['shell:cursor']).toBeLessThanOrEqual(2 + Math.ceil(MINUTE_MS / OCC_HINT_COALESCE_MS));
    // (the observer's two polls deliver too).
    expect(demo.byKey.mapFlights).toBeLessThanOrEqual(3 + Math.ceil(MINUTE_MS / OCC_HINT_COALESCE_MS));
    // The secondary reads never follow occ_planning.
    for (const key of ['planning', 'positions', 'readiness']) {
      expect(demo.byKey[key], key).toBe(plannedConsole([]).byKey[key]);
    }
  });

  it('the AeroDataBox reference reads fit the budget: none in a minute at rest, two when the console opens', () => {
    const withReferences = script => simulate({
      shellReads: [...OCC_REQUEST_PLAN.frame, ...OCC_REQUEST_PLAN.console, ...OCC_REQUEST_PLAN.references], script });
    // Their paces are a quarter of an hour and an hour: the counted minute holds none of them.
    expect(withReferences([]).byKey).toEqual(plannedConsole([]).byKey);
    expect(withReferences(OCC_DEMO_MINUTE).total).toBe(plannedConsole(OCC_DEMO_MINUTE).total);
    // The minute the console opens: every read once, the two references included, still within the budget.
    const sim = createSimulation();
    const hub = createHub();
    addShellObserver(sim, hub);
    [...OCC_REQUEST_PLAN.frame, ...OCC_REQUEST_PLAN.console, ...OCC_REQUEST_PLAN.references]
      .forEach(read => addShellRead(sim, hub, read));
    sim.runUntil(MINUTE_MS);
    const opening = sim.requests.filter(request => request.at < MINUTE_MS);
    expect(opening.filter(request => ['airportDelays', 'airportRoutes'].includes(request.key))).toHaveLength(2);
    expect(opening.length).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.rest);
    // On the Starter plan the delays answer Disabled once and are never polled again (AirportDelays.jsx, tested in
    // aviationReference.test.jsx): the opening minute then holds one delays read and no later one.
    expect(OCC_REQUEST_PLAN.references.filter(read => read.offOnStarter).map(read => read.key)).toEqual(['airportDelays']);
    expect(readSource('src/features/aviation-reference/AirportDelays.jsx')).toContain('!off ? pollMs : null');
    // Each pace is the one its file uses, and the reads are the shared client's.
    for (const read of OCC_REQUEST_PLAN.references) {
      expect(existsSync(read.owner), read.owner).toBe(true);
      expect(digits(readSource(read.owner)), `${read.owner}: ${read.pollMs} ms`).toMatch(new RegExp(`\\b${read.pollMs}\\b`));
      expect(readSource('src/services/aviationReferenceService.js')).toContain(`api.${read.read}(`);
    }
  });

  it('the planned console is what useConsoleData and useMapSituation read', () => {
    const reads = { ...MAP_SITUATION_READS, ...CONSOLE_READS };
    // One plan entry per read of the two hooks, and nothing else.
    expect(OCC_REQUEST_PLAN.console.map(entry => entry.key).sort()).toEqual(Object.keys(reads).sort());
    for (const entry of OCC_REQUEST_PLAN.console) {
      const own = reads[entry.key];
      expect(entry.read, entry.key).toBe(own.read);
      expect(entry.resources, entry.key).toEqual(own.resources);
      expect(entry.coalesceMs, entry.key).toBe(own.coalesceMs);
      // The air picture keeps the pace the server asks for: 10 s before its first answer and after each one of 10 s.
      if (typeof own.pollMs === 'function') {
        expect(own.pollMs(null), entry.key).toBe(entry.pollMs);
        expect(own.pollMs({ refreshAfterSeconds: 10 }), entry.key).toBe(entry.pollMs);
      } else {
        expect(entry.pollMs, entry.key).toBe(own.pollMs);
      }
      // The file that issues the read is the hook that holds its table.
      expect(existsSync(entry.owner), entry.owner).toBe(true);
      const table = Object.hasOwn(CONSOLE_READS, entry.key) ? 'CONSOLE_READS' : 'MAP_SITUATION_READS';
      expect(readSource(entry.owner), `${entry.owner}: ${table}`).toContain(`${table}.${entry.key}`);
    }
    expect(MAP_SITUATION_READS.airPicture.pollMs).toBe(airPictureDelayMs);
    // Only the review queue follows an announcement among the console's own reads, and none follows occ_planning.
    expect(Object.entries(CONSOLE_READS).filter(([, read]) => read.resources.length > 0).map(([key]) => key))
      .toEqual(['reviewQueue']);
    for (const read of Object.values(CONSOLE_READS)) expect(read.resources).not.toContain('occ_planning');
  });

  describe('every OCC screen as it is today stays within 40 requests a minute, at rest and in the demo minute', () => {
    // Replayed while the cases are collected, so each name carries its total.
    const cases = SCREEN_IDS.flatMap(screen => ['rest', 'demo'].map(minute => {
      const result = screenToday(screen, minute === 'demo' ? OCC_DEMO_MINUTE : []);
      return [screen, minute, result.total, result];
    }));
    it.each(cases)('%s at %s: %i requests', (screen, minute, total, result) => {
      expect(total, `${screen} (${minute}): ${breakdown(result)}`).toBeLessThanOrEqual(OCC_REQUEST_BUDGET[minute]);
    });
  });

  it('a tablet tap re-reads only what listens to occ_planning, at most once every 3 s', () => {
    // Five taps in two seconds, ten seconds into the measured minute.
    const taps = [10, 10.5, 11, 11.5, 12].map(at => ({ at, resource: 'occ_planning' }));
    const tapped = plannedConsole(taps);
    const quiet = plannedConsole([]);
    const dataReads = result => Object.fromEntries(Object.entries(result.byKey).filter(([key]) => !key.endsWith(':cursor')));
    const extra = Object.fromEntries(Object.entries(dataReads(tapped))
      .map(([key, count]) => [key, count - (dataReads(quiet)[key] ?? 0)]).filter(([, count]) => count !== 0));
    // One read after the first tap's cursor read, one after the trailing one that takes the other four.
    expect(extra).toEqual({ mapFlights: 2 });
    // The five hints cost at most two cursor reads: one at the first tap, one at the end of the observer's window (here
    // the observer's own poll, 5 s later, takes the other four).
    expect(tapped.byKey['shell:cursor'] - quiet.byKey['shell:cursor']).toBeLessThanOrEqual(2);

    const starts = tapped.requests.filter(request => request.key === 'mapFlights').map(request => request.at);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(OCC_COALESCE_MS);
    }
  });
});
