import { createElevantApiClient } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { alertPriority } from '../src/features/dashboard/noc/alertModel';
import { describeReasons } from '../src/services/occCoverageService';
import { STATION } from './visual/occ/fixtures/occApi.mjs';
import {
  API_PATHS, COVERAGE_AGENTS, COVERAGE_REFUSAL, COVERAGE_TERMINALS, FORBIDDEN, REVIEW_IDS, SCREEN_SCENARIOS,
  SCREENS_ACCESS, SERVER_ERROR, STATION_TIME_ZONE, coverageBoard, createScreensApi, operationalNotices, reviewDetail,
  reviewDocuments, reviewHistory, reviewIncidents, reviewQueue,
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

  it('the coverage board and the notices pass the strict validators', async () => {
    const date = '2026-11-14';
    for (const scenario of ['data', 'empty']) {
      const board = coverageBoard(scenario, { date });
      await expect(clientAnswering(board).getOccCoverage(STATION.stationId, date), scenario).resolves.toEqual(board);
      const notices = operationalNotices(scenario);
      await expect(clientAnswering(notices).getOperationalNotifications(), scenario).resolves.toEqual(notices);
    }
    // Another station's board is refused, as the page would refuse it.
    await expect(clientAnswering(coverageBoard()).getOccCoverage('0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', date)).rejects.toThrow();

    // A new coverage is refused with the rules it breaks, which the page explains one by one in Spanish.
    const command = { stationId: STATION.stationId, date, agentId: COVERAGE_AGENTS.dos.agentId,
      terminalId: COVERAGE_TERMINALS.A.terminalId, standIds: coverageBoard().stands.slice(6, 9).map(stand => stand.standId),
      mentorAgentId: null, vehicleCode: null, isReinforcement: false };
    const refusal = clientAnswering(COVERAGE_REFUSAL, { status: 422 })
      .createOccCoverage(command, { idempotencyKey: '8f0e1d2c-3b4a-4596-8877-665544332211' });
    await expect(refusal).rejects.toMatchObject({ kind: 'http', status: 422, code: 'coverage_rejected',
      reasons: [...COVERAGE_REFUSAL.reasons] });
    expect(describeReasons(COVERAGE_REFUSAL.reasons)).toHaveLength(COVERAGE_REFUSAL.reasons.length);
    await expect(clientAnswering(FORBIDDEN, { status: 403 }).getOccCoverage(STATION.stationId, date))
      .rejects.toMatchObject({ kind: 'http', status: 403 });
  });

  it('the board shows every attribute and state in terminal A, and the notices every priority read and unread', () => {
    const board = coverageBoard();
    expect(board.terminals.map(terminal => terminal.code)).toEqual(['A', 'B', 'FBO']);
    expect(board.stands).toHaveLength(41);
    const terminalA = board.stands.filter(stand => stand.terminalId === COVERAGE_TERMINALS.A.terminalId);
    expect(terminalA.filter(stand => !stand.isActive).map(stand => stand.code)).toEqual(['A11']);
    expect(terminalA.filter(stand => stand.maxAircraftSize === 'Narrowbody').map(stand => stand.code)).toEqual(['AN4', 'AN5']);
    expect(board.stands.find(stand => stand.code === 'A1').coveredBy).toEqual(['Agente de prueba Uno', 'Agente de prueba Seis']);
    expect(board.coverages.map(item => [item.agentName, item.isReinforcement, item.mentorName, item.vehicleCode])).toEqual([
      ['Agente de prueba Uno', false, null, 'VH-07'], ['Agente de prueba Dos', false, 'Agente de prueba Seis', null],
      ['Agente de prueba Seis', true, null, null], ['Agente de prueba Tres', false, null, null],
    ]);
    expect(board.agents.find(agent => agent.agentId === COVERAGE_AGENTS.dos.agentId))
      .toMatchObject({ isJunior: true, hasDriverLicense: false, hasBridgeQualification: false });
    // Every priority, unread and read, newest first; three unread alerts for the frame's status bar.
    const { notifications } = operationalNotices();
    const seen = new Set(notifications.map(item => `${alertPriority(item.kind)}:${item.readAt === null ? 'unread' : 'read'}`));
    expect([...seen].sort()).toEqual(['attention:read', 'attention:unread', 'notice:read', 'notice:unread', 'urgent:read',
      'urgent:unread']);
    expect(notifications.filter(item => alertPriority(item.kind) !== 'notice' && item.readAt === null)).toHaveLength(3);
    const times = notifications.map(item => Date.parse(item.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('the stub answers each scenario, sends the detail with its ETag and counts what it serves', async () => {
    expect(SCREEN_SCENARIOS).toEqual(['data', 'empty', 'error', 'forbidden']);
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
    // It accepts no command: a new coverage is refused with its rules, and any other command has no answer.
    expect(data.handle({ method: () => 'POST' },
      new URL(`https://api.elevant.test/api/v1/occ/review/operations/${REVIEW_IDS.pending}/decision`))).toBeNull();
    expect(data.handle({ method: () => 'POST' }, new URL(`https://api.elevant.test${API_PATHS.coverage}`)))
      .toEqual({ status: 422, json: COVERAGE_REFUSAL });
    expect(data.commands).toEqual([API_PATHS.coverage]);

    expect((await answer(createScreensApi('empty'), queuePath)).json.operations).toEqual([]);
    expect(await answer(createScreensApi('error'), queuePath)).toEqual({ status: 500, json: SERVER_ERROR });
    expect(await answer(createScreensApi('forbidden'), queuePath)).toEqual({ status: 403, json: FORBIDDEN });

    // The coverage follows the scenario, and echoes the date the page asks for.
    const coveragePath = `${API_PATHS.coverage}?stationId=${STATION.stationId}&date=2026-11-14`;
    expect((await answer(data, coveragePath)).json).toEqual(coverageBoard('data', { date: '2026-11-14' }));
    expect((await answer(createScreensApi('empty'), coveragePath)).json.terminals).toEqual([]);
    expect(await answer(createScreensApi('forbidden'), coveragePath)).toEqual({ status: 403, json: FORBIDDEN });
    // The notices are the frame's empty list unless the spec is the notices' own; then they follow the scenario.
    expect((await answer(data, API_PATHS.notices)).json).toEqual({ notifications: [], hasMore: false });
    expect((await answer(createScreensApi('data', { notices: true }), API_PATHS.notices)).json).toEqual(operationalNotices());
    expect((await answer(createScreensApi('empty', { notices: true }), API_PATHS.notices)).json.notifications).toEqual([]);
    expect(await answer(createScreensApi('error', { notices: true }), API_PATHS.notices))
      .toEqual({ status: 500, json: SERVER_ERROR });
  });
});
