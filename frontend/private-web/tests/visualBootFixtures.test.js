import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlanningSnapshot } from '../src/services/planningService';
import { loadOccReviewQueue } from '../src/services/occReviewService';
import { ACCESS_PATH, CONSOLE_READ_PATHS, createBootApi } from './visual/occ/fixtures/bootApi.mjs';
import { CONSOLE_PATHS, STATION_TIME_ZONE, stationDay } from './visual/occ/fixtures/consoleApi.mjs';
import { OCC_ACCESS, STATION } from './visual/occ/fixtures/occApi.mjs';

// The synthetic API of the OCC boot screen's visual spec (tests/visual/occ/boot-screen.spec.mjs) must be answers the
// app accepts, through the console's own adapters: the shared client validates them strictly and the console checks
// the station and its day, so a fixture that drifted from the contract would leave the console in its error state
// behind the boot screen. The reads themselves are consoleApi.mjs's (tests/visualConsoleFixtures.test.js).

// What the stub answers for a GET of `path`, as the isolation of the visual suite would ask it.
const answer = (api, path) => api.handle({ method: () => 'GET' }, new URL(`https://api.elevant.test${path}`));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('visual suite boot screen fixtures', () => {
  it('the console accepts them as the station\'s day, in the station\'s time zone, through its adapters', async () => {
    vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.elevant.test');
    const api = createBootApi();
    vi.stubGlobal('fetch', async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const { json } = await api.handle({ method: () => 'GET' }, url);
      return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const snapshot = await getPlanningSnapshot({ stationId: STATION.stationId });
    expect(snapshot).toMatchObject({ station: { id: STATION.stationId, code: 'PUJ', ianaTimeZone: STATION_TIME_ZONE } });
    expect(snapshot.date).toBe(stationDay());
    const queue = await loadOccReviewQueue(STATION.stationId);
    expect(queue).toMatchObject({ stationId: STATION.stationId, stationCode: 'PUJ' });
    expect(api.consoleReads).toBe(2);
  });

  it('the stub answers the access and the console after their pauses, and leaves the rest to consoleApi.mjs', async () => {
    vi.useFakeTimers();
    const api = createBootApi({ accessDelayMs: 1_500, consoleDelayMs: 1_000 });
    let access = null;
    void answer(api, ACCESS_PATH).then(value => { access = value; });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(access).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(access).toEqual({ status: 200, json: OCC_ACCESS });
    expect(api.accesses).toBe(1);

    // The console's reads all wait the same pause, side by side: its first data arrive with them.
    const reads = CONSOLE_READ_PATHS.map(path => answer(api, `${path}?stationId=${STATION.stationId}&date=${stationDay()}`));
    let settled = 0;
    reads.forEach(read => read.then(() => { settled += 1; }));
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const answers = await Promise.all(reads);
    expect(answers.every(item => item.status === 200)).toBe(true);
    expect(api.consoleReads).toBe(CONSOLE_READ_PATHS.length);
    expect(CONSOLE_READ_PATHS).toContain(CONSOLE_PATHS.mapFlights);

    // The ping and the change feed answer at once; any other path is the isolation's 404, and nothing is written.
    expect((await answer(api, CONSOLE_PATHS.ping)).status).toBe(200);
    expect(await answer(api, '/api/v1/occ/traffic/aircraft')).toBeNull();
    expect(await api.handle({ method: () => 'POST' }, new URL(`https://api.elevant.test${CONSOLE_PATHS.notices}`)))
      .toBeNull();
  });
});
