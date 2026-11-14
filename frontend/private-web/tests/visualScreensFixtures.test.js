import { createElevantApiClient } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { STATION } from './visual/occ/fixtures/occApi.mjs';
import {
  API_PATHS, REVIEW_IDS, SCREEN_SCENARIOS, SCREENS_ACCESS, SERVER_ERROR, STATION_TIME_ZONE, createScreensApi,
  reviewDetail, reviewDocuments, reviewHistory, reviewIncidents, reviewQueue,
} from './visual/occ/fixtures/screensApi.mjs';

// The synthetic API of the OCC work screens of the visual suite (tests/visual/occ/fixtures/screensApi.mjs) must be
// answers the app accepts: the shared client validates them strictly, so a fixture that drifted from the contract would
// leave the screen in its error state instead of drawing what the screenshots are for.

function clientAnswering(body, { status = 200, headers = {} } = {}) {
  return createElevantApiClient({
    baseUrl: 'https://api.elevant.test',
    getAccessToken: () => 'visual-suite-token',
    fetch: async () => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
    }),
  });
}

// What the stub answers for a GET of `path`, as the isolation of the visual suite would ask it.
const answer = (api, path) => api.handle({ method: () => 'GET' }, new URL(`https://api.elevant.test${path}`));

describe('visual suite screens fixtures', () => {
  it('the review answers pass the strict validators of the shared client', async () => {
    for (const scenario of ['data', 'empty']) {
      const queue = reviewQueue(scenario);
      await expect(clientAnswering(queue).getOccReviewQueue(STATION.stationId), scenario).resolves.toEqual(queue);
    }
    // Another station's queue is refused, as the page would refuse it.
    await expect(clientAnswering(reviewQueue()).getOccReviewQueue('0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e')).rejects.toThrow();

    const detail = reviewDetail();
    await expect(clientAnswering(detail, { headers: { ETag: detail.reviewVersion } }).getOccReviewDetail(REVIEW_IDS.pending))
      .resolves.toEqual(detail);
    // The detail is accepted only with its ETag, which the stub sends.
    await expect(clientAnswering(detail).getOccReviewDetail(REVIEW_IDS.pending)).rejects.toThrow();
    const history = reviewHistory();
    await expect(clientAnswering(history).getOccReviewSubmissionHistory(REVIEW_IDS.pending)).resolves.toEqual(history);
    const documents = reviewDocuments();
    await expect(clientAnswering(documents).getOccOperationDocuments(REVIEW_IDS.pending)).resolves.toEqual(documents);
    const incidents = reviewIncidents();
    await expect(clientAnswering(incidents).getOccOperationIncidents(REVIEW_IDS.pending)).resolves.toEqual(incidents);

    // The frame's own reads, empty.
    const notices = { notifications: [], hasMore: false };
    await expect(clientAnswering(notices).getOperationalNotifications()).resolves.toEqual(notices);
    const changes = { changes: [], nextCursor: null, hasMore: false };
    await expect(clientAnswering(changes).getAccountChanges({ limit: 100 })).resolves.toEqual(changes);

    // The `error` scenario's queue is a Problem Details 500, which the client rejects with its status (it keeps only the
    // codes it knows, so the screen explains the failure with its own words).
    await expect(clientAnswering(SERVER_ERROR, { status: 500 }).getOccReviewQueue(STATION.stationId))
      .rejects.toMatchObject({ kind: 'http', status: 500 });
  });

  it('the review queue holds every state the filter and the pills show, and a hand-off sent after midnight', () => {
    const { operations, ianaTimeZone } = reviewQueue();
    expect(ianaTimeZone).toBe(STATION_TIME_ZONE);
    expect(operations.map(item => item.status)).toEqual(['PendingReview', 'PendingReview', 'Approved', 'Returned']);
    expect(operations[0].operationId).toBe(REVIEW_IDS.pending);
    // Sent at 00:05 in Santo Domingo, the day after its operation date: the queue writes its day in front of the time.
    const late = operations.at(-1);
    expect([late.operationDate, late.submittedAt]).toEqual(['2026-11-12', '2026-11-13T04:05:00Z']);
    // The close the spec draws: eight recorded milestones and a ground time over its allowance.
    const close = reviewDetail().close;
    expect(close.milestones).toHaveLength(8);
    expect(close.timing.groundMinutes - close.timing.allowedGroundMinutes).toBe(4);
    expect(SCREENS_ACCESS.permissions).toEqual(expect.arrayContaining(['operations.review.read', 'operations.incidents.read']));
  });

  it('the stub answers each scenario, sends the detail with its ETag and counts what it serves', async () => {
    expect(SCREEN_SCENARIOS).toEqual(['data', 'empty', 'error']);
    expect(() => createScreensApi('broken')).toThrow(RangeError);
    const queuePath = `${API_PATHS.reviewQueue}?stationId=${STATION.stationId}`;

    const data = createScreensApi('data');
    expect(await answer(data, API_PATHS.access)).toEqual({ status: 200, json: SCREENS_ACCESS });
    expect((await answer(data, queuePath)).json.operations).toHaveLength(4);
    const detail = await answer(data, `/api/v1/occ/review/operations/${REVIEW_IDS.pending}`);
    expect(detail).toMatchObject({ status: 200, headers: { etag: detail.json.reviewVersion } });
    expect((await answer(data, `/api/v1/occ/operations/${REVIEW_IDS.pending}/documents`)).json).toEqual(reviewDocuments());
    // Another hand-off has no answer: the isolation sends its Problem Details 404.
    expect(await answer(data, `/api/v1/occ/review/operations/${REVIEW_IDS.approved}`)).toBeNull();
    expect(data.readsOf(API_PATHS.reviewQueue)).toBe(1);
    // It answers no command.
    expect(data.handle({ method: () => 'POST' },
      new URL(`https://api.elevant.test/api/v1/occ/review/operations/${REVIEW_IDS.pending}/decision`))).toBeNull();

    expect((await answer(createScreensApi('empty'), queuePath)).json.operations).toEqual([]);
    expect(await answer(createScreensApi('error'), queuePath)).toEqual({ status: 500, json: SERVER_ERROR });
  });
});
