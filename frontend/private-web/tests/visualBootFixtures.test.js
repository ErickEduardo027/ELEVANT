import { createElevantApiClient } from '@elevant/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardSnapshot } from '../src/services/dashboardService';
import {
  ACCESS_PATH, NOTICES_PATH, PLANNING_PATH, REVIEW_QUEUE_PATH, STATION_TIME_ZONE, createBootApi, notices,
  planningSnapshot, reviewQueue,
} from './visual/occ/fixtures/bootApi.mjs';
import { OCC_ACCESS, STATION } from './visual/occ/fixtures/occApi.mjs';

// The synthetic API of the OCC boot screen's visual spec (tests/visual/occ/boot-screen.spec.mjs) must be answers the
// app accepts: the shared client validates them strictly, and Panorama checks the station and the date, so a fixture
// that drifted from the contract would leave the console in its error state behind the boot screen.

const DATE = '2026-11-13';

function clientAnswering(body) {
  return createElevantApiClient({
    baseUrl: 'https://api.elevant.test',
    getAccessToken: () => 'visual-suite-token',
    fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
}

// What the stub answers for a GET of `path`, as the isolation of the visual suite would ask it.
const answer = (api, path) => api.handle({ method: () => 'GET' }, new URL(`https://api.elevant.test${path}`));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('visual suite boot screen fixtures', () => {
  it('Panorama\'s three reads pass the strict validators of the shared client for the station', async () => {
    await expect(clientAnswering(reviewQueue()).getOccReviewQueue(STATION.stationId)).resolves.toEqual(reviewQueue());
    await expect(clientAnswering(notices()).getOperationalNotifications()).resolves.toEqual(notices());
    const planning = planningSnapshot({ date: DATE });
    await expect(clientAnswering(planning).getOccPlanningSnapshot({ stationId: STATION.stationId, date: DATE }))
      .resolves.toEqual(planning);
    // Another station's queue is refused, as the page would refuse it.
    await expect(clientAnswering(reviewQueue()).getOccReviewQueue('0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e')).rejects.toThrow();
  });

  it('Panorama accepts them as the station\'s day, in the station\'s time zone', async () => {
    vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.elevant.test');
    const api = createBootApi();
    vi.stubGlobal('fetch', async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const { json } = await api.handle({ method: () => 'GET' }, url);
      return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const snapshot = await getDashboardSnapshot({ stationId: STATION.stationId, stationCode: STATION.stationCode });
    expect(snapshot).toMatchObject({
      stationId: STATION.stationId, stationCode: 'PUJ', station: { ianaTimeZone: STATION_TIME_ZONE },
      turnarounds: [], reviews: [], notifications: [],
    });
    expect(snapshot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(api.consoleReads).toBe(3);
  });

  it('the stub answers the access and Panorama after their pauses, and leaves the rest to occApi.mjs', async () => {
    vi.useFakeTimers();
    const api = createBootApi({ accessDelayMs: 1_500, consoleDelayMs: 1_000 });
    let access = null;
    void answer(api, ACCESS_PATH).then(value => { access = value; });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(access).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(access).toEqual({ status: 200, json: OCC_ACCESS });
    expect(api.accesses).toBe(1);

    const reads = [
      `${REVIEW_QUEUE_PATH}?stationId=${STATION.stationId}`, NOTICES_PATH,
      `${PLANNING_PATH}?stationId=${STATION.stationId}&date=${DATE}`,
    ].map(path => answer(api, path));
    await vi.advanceTimersByTimeAsync(1_000);
    const [queue, list, planning] = await Promise.all(reads);
    expect(queue).toEqual({ status: 200, json: reviewQueue() });
    expect(list).toEqual({ status: 200, json: notices() });
    expect(planning).toEqual({ status: 200, json: planningSnapshot({ date: DATE }) });
    expect(api.consoleReads).toBe(3);

    // The positions board is occApi.mjs's, any other path is the isolation's 404, and nothing is written.
    expect((await answer(api, `/api/v1/occ/positions?stationId=${STATION.stationId}&date=${DATE}`)).status).toBe(200);
    expect(await answer(api, '/api/v1/occ/traffic/aircraft')).toBeNull();
    expect(await api.handle({ method: () => 'POST' }, new URL(`https://api.elevant.test${NOTICES_PATH}`))).toBeNull();
  });
});
