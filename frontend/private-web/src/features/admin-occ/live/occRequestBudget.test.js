import { describe, expect, it } from 'vitest';
import { occMountedFiles, readSource } from '../../../styles/occSourceScan';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import { OCC_COALESCE_MS, OCC_OBSERVER_POLL_MS } from './occCadence';
import {
  OCC_DEMO_MINUTE, OCC_OBSERVER_SITES, OCC_REQUEST_BUDGET, OCC_REQUEST_PLAN, OCC_SCREEN_POLLS,
} from './occRequestPlan';
import { createRefreshScheduler } from './refreshScheduler';

// A replayed minute of one OCC tab (contracts 2.7). Everything mounts at t = 0; after a 60 s warm-up the next
// minute is counted, without the mount reads. The shell's reads run through the same refresh scheduler as
// useOccResource; the per-screen observers that remain re-read as their code does today, uncoalesced.

const WARM_UP_MS = 60_000;
const MINUTE_MS = 60_000;
// Long enough to exercise the in-flight joins, far below every cadence.
const READ_LATENCY_MS = 200;
const OBSERVER_FACTORY = 'src/services/accountChangeObserver.js';
const SCRIPT_FILE = /\.(?:js|jsx|mjs)$/;
const MODES = ['shell', 'screen', 'shared-page', 'outside-shell-fallback', 'disabled-in-occ', 'import-only'];
const SCREEN_IDS = ADMIN_OCC_NAVIGATION.map(item => item.id);
const SITES = Object.entries(OCC_OBSERVER_SITES);

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

// Every observer of the tab gets the hub's hint for every announcement and answers it with one cursor read.
function createHub() {
  const observers = [];
  const subscribers = [];
  return {
    observers,
    subscribe: (resources, callback) => subscribers.push({ resources, callback }),
    announce(resource) {
      observers.forEach(hint => hint());
      for (const subscriber of subscribers) if (subscriber.resources.includes(resource)) subscriber.callback();
    },
  };
}

function addObserver(sim, hub, label) {
  const read = () => sim.send(`${label}:cursor`);
  read();
  sim.every(OCC_OBSERVER_POLL_MS, read);
  hub.observers.push(read);
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

// Today's screens: each matching announcement and each tick of their poll re-reads at once.
function addScreenReads(sim, hub, label, { resources, pollMs, readsPerRefresh }) {
  const refresh = () => { for (let count = 0; count < readsPerRefresh; count += 1) sim.send(`${label}:read`); };
  refresh();
  hub.subscribe(resources, refresh);
  if (pollMs) sim.every(pollMs, refresh);
}

function simulate({ observers, shellReads, screenSites = [], screenPolls = [], script = [] }) {
  const sim = createSimulation();
  const hub = createHub();
  observers.forEach(label => addObserver(sim, hub, label));
  shellReads.forEach(read => addShellRead(sim, hub, read));
  screenSites.forEach(([label, site]) => addScreenReads(sim, hub, label, site));
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
const plannedConsole = script => simulate({ observers: ['shell'],
  shellReads: [...OCC_REQUEST_PLAN.frame, ...OCC_REQUEST_PLAN.console], script });

// A screen as it is today: the frame plus every observer of that screen (each of its tabs and drawers open).
function screenToday(screen, script) {
  const own = SITES.filter(([, site]) => site.screen === screen && ['screen', 'shared-page'].includes(site.mode));
  const riding = SITES.filter(([, site]) => site.screen === screen && site.mode === 'outside-shell-fallback');
  return simulate({
    observers: ['shell', ...own.map(([file]) => fileLabel(file))],
    shellReads: OCC_REQUEST_PLAN.frame,
    screenSites: [...own, ...riding].map(([file, site]) => [fileLabel(file), site]),
    screenPolls: OCC_SCREEN_POLLS.filter(poll => poll.screen === screen),
    script,
  });
}

const breakdown = result => `${result.total} requests: ${JSON.stringify(result.byKey)}`;
const digits = source => source.replace(/(\d)_(?=\d)/g, '$1');

describe('OCC request budget', () => {
  it('the frame opens one account-change observer per OCC tab', () => {
    const shells = SITES.filter(([, site]) => site.mode === 'shell').map(([file]) => file);
    expect(shells).toEqual(['src/features/admin-occ/shell/OccShellProvider.jsx']);
    expect(OCC_REQUEST_PLAN.observer.owner).toBe(shells[0]);
    expect(OCC_REQUEST_PLAN.observer.pollMs).toBe(OCC_OBSERVER_POLL_MS);

    // The frame's other observers are off where the OCC mounts them.
    expect(readSource('src/app/RoleLayout.jsx')).toMatch(/<DepartmentAccessProvider observe=\{role !== 'adminOcc'\}>/);
    const layout = readSource('src/features/admin-occ/AdminOccLayout.jsx');
    expect(layout).toMatch(/<OccShellProvider>/);
    expect(layout).toMatch(/notificationsEnabled=\{false\}/);
    expect(layout).not.toMatch(/notificationsSource=/);
    expect(readSource(OBSERVER_FACTORY)).toMatch(/pollMs = 25_000/);

    // On a screen without an observer of its own, every cursor read of the minute is the shell's.
    for (const script of [[], OCC_DEMO_MINUTE]) {
      const cursorReaders = Object.keys(screenToday('reports', script).byKey).filter(key => key.endsWith(':cursor'));
      expect(cursorReaders).toEqual(['shell:cursor']);
    }
  });

  it('names every per-screen observer that remains under /admin-occ and the PR that moves it', () => {
    const found = occMountedFiles().filter(file => SCRIPT_FILE.test(file) && file !== OBSERVER_FACTORY
      && /\bcreatePrivateWebAccountChangeObserver\b/.test(readSource(file)));
    const listed = Object.keys(OCC_OBSERVER_SITES);
    expect({
      notListed: found.filter(file => !listed.includes(file)),
      notFound: listed.filter(file => !found.includes(file)),
    }, 'every file mounted under /admin-occ that opens an account-change observer is listed in OCC_OBSERVER_SITES, '
      + 'and nothing else is').toEqual({ notListed: [], notFound: [] });

    expect(SITES.filter(([, site]) => site.mode === 'screen').map(([file, site]) => `${file} → ${site.movesIn}`)).toEqual([
      'src/features/dashboard/useDashboardData.js → U3',
      'src/features/flight-monitoring/FlightMonitoringRoute.jsx → U5',
      'src/features/positions-map/PositionsMapRoute.jsx → U5',
      'src/features/planning/PlanningRoute.jsx → U5',
      'src/features/planning/attendance/useAttendanceDraft.js → U5',
      'src/features/position-coverage/CoverageRoute.jsx → U6',
      'src/features/master-data/MasterDataRoute.jsx → U6',
      'src/features/devices/DevicesRoute.jsx → U6',
      'src/features/chat/CanonicalChatRoute.jsx → U6',
      'src/features/notifications/CanonicalNotificationsRoute.jsx → U6',
    ]);

    // The table describes the code: its modes and screens exist, and every resource and pace is in the file it names.
    for (const [file, site] of SITES) {
      expect(MODES, file).toContain(site.mode);
      if (site.screen !== null) expect(SCREEN_IDS, file).toContain(site.screen);
      const source = readSource(file);
      for (const resource of site.resources) expect(source, `${file}: ${resource}`).toContain(`'${resource}'`);
      if (site.pollMs) expect(digits(source), `${file}: ${site.pollMs} ms`).toMatch(new RegExp(`\\b${site.pollMs}\\b`));
      if (site.mode === 'disabled-in-occ' || site.mode === 'import-only') expect(site.offBy, file).toBeTruthy();
    }
    for (const poll of [...OCC_SCREEN_POLLS, ...OCC_REQUEST_PLAN.frame.filter(read => read.fixedRate)]) {
      const file = poll.file ?? poll.owner;
      expect(digits(readSource(file)), `${file}: ${poll.pollMs} ms`).toMatch(new RegExp(`\\b${poll.pollMs}\\b`));
    }
  });

  it('the planned console stays within 40 requests a minute at rest', () => {
    const rest = plannedConsole([]);
    expect(rest.total, breakdown(rest)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.rest);
    // What the minute holds: two cursor polls, the air picture every 10 s, every 60 s read once, the presence lease.
    expect(rest.byKey).toEqual({ 'shell:cursor': 2, airPicture: 6, mapFlights: 1, planning: 1, positions: 1,
      reviewQueue: 1, notices: 1, presence: 2 });
  });

  it('the planned console stays within 70 requests during a demo minute', () => {
    expect(OCC_DEMO_MINUTE.filter(item => item.resource === 'occ_planning').map(item => item.at))
      .toEqual([5, 12, 19, 26, 33, 40, 47, 54]);
    const demo = plannedConsole(OCC_DEMO_MINUTE);
    expect(demo.total, breakdown(demo)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.demo);
    // Eleven hints, eight flight re-reads, two notice re-reads and one queue re-read on top of the minute at rest.
    expect(demo.byKey).toEqual({ 'shell:cursor': 13, airPicture: 6, mapFlights: 9, planning: 1, positions: 1,
      reviewQueue: 2, notices: 3, presence: 2 });
    // The secondary reads never follow occ_planning.
    expect(demo.byKey.planning).toBe(plannedConsole([]).byKey.planning);
    expect(demo.byKey.positions).toBe(plannedConsole([]).byKey.positions);
  });

  describe('every OCC screen as it is today, with its remaining observer, stays within the budget', () => {
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
    // One read at the first tap, one trailing read for the other four.
    expect(extra).toEqual({ mapFlights: 2 });
    // Each tap is still one hint, so one cursor read, for the shell's observer.
    expect(tapped.byKey['shell:cursor'] - quiet.byKey['shell:cursor']).toBe(taps.length);

    const starts = tapped.requests.filter(request => request.key === 'mapFlights').map(request => request.at);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(OCC_COALESCE_MS);
    }
  });
});
