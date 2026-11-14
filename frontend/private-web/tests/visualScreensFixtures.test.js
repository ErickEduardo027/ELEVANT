import { createElevantApiClient } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { alertPriority } from '../src/features/dashboard/noc/alertModel';
import { describeReasons } from '../src/services/occCoverageService';
import { STATION } from './visual/occ/fixtures/occApi.mjs';
import {
  API_PATHS, CHAT_IDS, COVERAGE_AGENTS, COVERAGE_REFUSAL, COVERAGE_TERMINALS, DEVICE_IDS, FORBIDDEN, MASTER_TERMINALS,
  OWN_ACCOUNT_ID, OWN_PRESENCE, REPORT_CATALOG, REVIEW_IDS, SCREEN_SCENARIOS, SCREENS_ACCESS, SERVER_ERROR,
  STATION_TIME_ZONE, chatConversations, chatMessages, chatPresence, coverageBoard, createScreensApi, masterData,
  occDevices, operationalNotices, readyContracts, reportCatalog, reportPage, reviewDetail, reviewDocuments,
  reviewHistory, reviewIncidents, reviewQueue,
} from './visual/occ/fixtures/screensApi.mjs';
import { PRESENCE_SHAPES, resolvePresence } from '../src/features/chat/presenceStatus';

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

  it('chat, master data and tablets answers pass the strict validators', async () => {
    for (const scenario of ['data', 'empty']) {
      const conversations = chatConversations(scenario);
      await expect(clientAnswering(conversations).getOperationalConversations(STATION.stationId), scenario)
        .resolves.toEqual(conversations);
      const layout = masterData(scenario);
      await expect(clientAnswering(layout).getOccMasterData(STATION.stationId), scenario).resolves.toEqual(layout);
      const tablets = occDevices(scenario);
      await expect(clientAnswering(tablets).getOccMobileDevices(STATION.stationId), scenario).resolves.toEqual(tablets);
    }
    for (const operationId of Object.values(CHAT_IDS)) {
      const thread = chatMessages(operationId);
      await expect(clientAnswering(thread).getOperationalMessages(operationId), operationId).resolves.toEqual(thread);
    }
    // The presence answers only the operations asked for, as the validator demands.
    const ids = Object.values(CHAT_IDS);
    const presence = chatPresence(ids);
    await expect(clientAnswering(presence).getOperationalPresence(ids)).resolves.toEqual(presence);
    await expect(clientAnswering(chatPresence(ids)).getOperationalPresence([CHAT_IDS.open])).rejects.toThrow();
    expect(chatPresence([CHAT_IDS.open]).operations.map(item => item.operationId)).toEqual([CHAT_IDS.open]);
    await expect(clientAnswering(OWN_PRESENCE).getOwnOperationalPresence()).resolves.toEqual(OWN_PRESENCE);
    // Read-only, the same layout and tablets with nothing to change.
    const readOnly = masterData('data', { readOnly: true });
    await expect(clientAnswering(readOnly).getOccMasterData(STATION.stationId)).resolves.toMatchObject({ canCreate: false,
      canUpdate: false });
    await expect(clientAnswering(occDevices('data', { readOnly: true })).getOccMobileDevices(STATION.stationId))
      .resolves.toMatchObject({ canUnbind: false, canRevoke: false });
    // Another station's layout and tablets are refused, as the page would refuse them.
    const other = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
    await expect(clientAnswering(masterData()).getOccMasterData(other)).rejects.toThrow();
    await expect(clientAnswering(occDevices()).getOccMobileDevices(other)).rejects.toThrow();
    await expect(clientAnswering(SERVER_ERROR, { status: 500 }).getOperationalConversations(STATION.stationId))
      .rejects.toMatchObject({ kind: 'http', status: 500 });
    await expect(clientAnswering(FORBIDDEN, { status: 403 }).getOccMasterData(STATION.stationId))
      .rejects.toMatchObject({ kind: 'http', status: 403 });
  });

  it('the chat shows every presence shape, the register every state, and the tablets every holder', () => {
    // Every shape of the legend once, the OCC session among the participants (the page leaves it out).
    const presence = chatPresence(Object.values(CHAT_IDS));
    const shapes = presence.operations.flatMap(item => item.participants)
      .filter(person => person.accountId !== OWN_ACCOUNT_ID).map(person => PRESENCE_SHAPES[resolvePresence(person)]);
    expect([...new Set(shapes)].sort()).toEqual(['dashed', 'filled', 'filled-bar', 'half', 'hollow']);
    expect(presence.operations.flatMap(item => item.participants).some(person => person.accountId === OWN_ACCOUNT_ID)).toBe(true);
    // The open thread: own messages seen and one only sent; another conversation unread, one without messages.
    const thread = chatMessages(CHAT_IDS.open);
    const own = thread.messages.filter(message => message.senderAccountId === OWN_ACCOUNT_ID);
    expect(own.map(message => Date.parse(message.sentAt) <= Date.parse(thread.othersReadUpTo))).toEqual([true, true, false]);
    const { conversations } = chatConversations();
    expect(conversations.map(item => [item.unreadCount, item.lastMessage === null])).toEqual([[0, false], [3, false], [0, true],
      [0, false]]);
    expect(SCREENS_ACCESS.permissions).toContain('operations.chat.create');

    // The register: a terminal out of use, stands with and without history, a stand out of use, a type out of use.
    const layout = masterData();
    expect(layout.terminals.filter(item => !item.isActive).map(item => item.code)).toEqual(['C']);
    expect(layout.stands.filter(item => !item.isActive).map(item => item.code)).toEqual(['A11']);
    expect(layout.stands.some(item => item.hasHistory) && layout.stands.some(item => !item.hasHistory)).toBe(true);
    expect(layout.stands.every(item => Object.values(MASTER_TERMINALS).some(terminal => terminal.id === item.terminalId))).toBe(true);
    expect(layout.aircraftTypes.filter(item => !item.isActive).map(item => item.icaoCode)).toEqual(['B752']);

    // The tablets: one busy with an operation, one held, two free (one with no name and no agent) and one revoked.
    const { devices } = occDevices();
    expect(devices.map(item => [item.status, item.agentHasOperationInProgress])).toEqual([['Bound', true], ['Bound', false],
      ['Unbound', false], ['Unbound', false], ['Revoked', false]]);
    expect(devices.find(item => item.id === DEVICE_IDS.unnamed)).toMatchObject({ deviceName: null, agent: null, platform: 'Ios' });
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

    // The chat, Datos maestros and Tablets follow the scenario; the thread of an unknown operation has no answer.
    const stationQuery = `?stationId=${STATION.stationId}`;
    expect((await answer(data, `${API_PATHS.conversations}${stationQuery}`)).json).toEqual(chatConversations());
    expect((await answer(data, `${API_PATHS.conversations}/${CHAT_IDS.open}/messages`)).json).toEqual(chatMessages(CHAT_IDS.open));
    expect(await answer(data, `${API_PATHS.conversations}/${REVIEW_IDS.returned}/messages`)).toBeNull();
    expect((await answer(data, `${API_PATHS.presence}?operationIds=${CHAT_IDS.quiet}`)).json)
      .toEqual(chatPresence([CHAT_IDS.quiet]));
    expect(await answer(data, API_PATHS.ownPresence)).toEqual({ status: 200, json: OWN_PRESENCE });
    expect((await answer(data, `${API_PATHS.masterData}${stationQuery}`)).json).toEqual(masterData());
    expect((await answer(data, `${API_PATHS.devices}${stationQuery}`)).json).toEqual(occDevices());
    expect((await answer(createScreensApi('empty'), `${API_PATHS.conversations}${stationQuery}`)).json.conversations).toEqual([]);
    expect(await answer(createScreensApi('error'), `${API_PATHS.conversations}${stationQuery}`))
      .toEqual({ status: 500, json: SERVER_ERROR });
    expect(await answer(createScreensApi('forbidden'), `${API_PATHS.masterData}${stationQuery}`))
      .toEqual({ status: 403, json: FORBIDDEN });
    expect((await answer(createScreensApi('data', { readOnly: true }), `${API_PATHS.devices}${stationQuery}`)).json)
      .toEqual(occDevices('data', { readOnly: true }));
    // No command of these screens is answered: a message, a read receipt, a presence lease or a tablet's release.
    for (const [method, path] of [['POST', `${API_PATHS.conversations}/${CHAT_IDS.open}/messages`],
      ['PUT', `${API_PATHS.conversations}/${CHAT_IDS.open}/read`], ['PUT', API_PATHS.presence],
      ['PUT', `/api/v1/occ/stands/${masterData().stands[0].id}`], ['POST', `${API_PATHS.devices}/${DEVICE_IDS.held}/unbind`]]) {
      expect(data.handle({ method: () => method }, new URL(`https://api.elevant.test${path}`)), `${method} ${path}`).toBeNull();
    }
  });

  it('ready contracts and a report page pass the strict validators', async () => {
    const date = '2026-11-14';
    for (const scenario of ['data', 'empty']) {
      const contracts = readyContracts(scenario, { date });
      await expect(clientAnswering(contracts).listOccReadyContracts(STATION.stationId, date), scenario)
        .resolves.toEqual(contracts);
    }
    // The contracts of another date or station are refused, as the page would refuse them.
    await expect(clientAnswering(readyContracts('data', { date })).listOccReadyContracts(STATION.stationId, '2026-11-15'))
      .rejects.toThrow();
    await expect(clientAnswering(readyContracts('data', { date }))
      .listOccReadyContracts('0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', date)).rejects.toThrow();

    const catalog = reportCatalog();
    await expect(clientAnswering(catalog).listOccReports()).resolves.toEqual(catalog);
    const query = { stationId: STATION.stationId, from: '2026-11-01', to: date, limit: 25 };
    for (const key of REPORT_CATALOG.map(report => report.key)) {
      for (const [scenario, page] of [['data', 1], ['data', 2], ['empty', 1]]) {
        const body = reportPage(key, { ...query, page }, scenario);
        await expect(clientAnswering(body).getOccReport(key, { ...query, page }), `${key} ${scenario} ${page}`)
          .resolves.toEqual(body);
      }
    }
    // A page of another period, report or station is refused.
    const first = reportPage('turnaround-times', { ...query, page: 1 });
    await expect(clientAnswering(first).getOccReport('turnaround-times', { ...query, from: '2026-10-01', page: 1 }))
      .rejects.toThrow();
    await expect(clientAnswering(first).getOccReport('operations', { ...query, page: 1 })).rejects.toThrow();
    await expect(clientAnswering(first).getOccReport('turnaround-times',
      { ...query, stationId: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', page: 1 })).rejects.toThrow();
    await expect(clientAnswering(SERVER_ERROR, { status: 500 }).getOccReport('turnaround-times', { ...query, page: 1 }))
      .rejects.toMatchObject({ kind: 'http', status: 500 });
    await expect(clientAnswering(FORBIDDEN, { status: 403 }).listOccReadyContracts(STATION.stationId, date))
      .rejects.toMatchObject({ kind: 'http', status: 403 });
    expect(SCREENS_ACCESS.permissions).toEqual(expect.arrayContaining(['operations.planning.read', 'operations.reports.read',
      'operations.reports.export']));
  });

  it('the contracts show every case of the list, and the report its two pages and its placeholders', () => {
    // Open-ended and dated, manual and unset renewal, no services, no flights and no IATA code, each once at least.
    const { contracts } = readyContracts();
    expect(contracts.map(item => [item.validTo === null, item.renewalMode, item.services.length, item.flightsOnDate,
      item.airlineIataCode])).toEqual([[true, 'Automatic', 3, 3, 'ZZ'], [false, 'Manual', 2, 1, 'Z1'],
      [false, null, 0, 0, 'Z2'], [true, 'Automatic', 1, 2, null]]);
    expect(readyContracts('empty').contracts).toEqual([]);

    // The six reports of the API, each with its headers.
    expect(REPORT_CATALOG.map(report => report.key)).toEqual(['operations', 'turnaround-times', 'services-by-airline',
      'reviews', 'agent-productivity', 'daily-close']);
    // Turnaround times: 25 rows on the first page and 7 on the second, whose numbers sit in their own columns, with a
    // «—» placeholder in a column of numbers.
    const query = { from: '2026-11-01', to: '2026-11-14', limit: 25 };
    const first = reportPage('turnaround-times', { ...query, page: 1 });
    const second = reportPage('turnaround-times', { ...query, page: 2 });
    expect([first.rows.length, first.hasMore, second.rows.length, second.hasMore]).toEqual([25, true, 7, false]);
    expect(first.rows.every(row => row.length === first.columns.length)).toBe(true);
    const types = index => new Set(first.rows.map(row => row[index].type));
    expect([...types(4)]).toEqual(['number']);
    expect(first.rows.some(row => row[3].value === '—' && row[3].type === 'text')).toBe(true);
    expect([...types(1)]).toEqual(['text']);
    // The empty period has no rows and no next page.
    expect(reportPage('turnaround-times', { ...query, page: 1 }, 'empty')).toMatchObject({ rows: [], hasMore: false });
    expect(() => reportPage('sla', query)).toThrow(RangeError);
  });

  it('the stub answers the contracts and the reports in each scenario and echoes their query', async () => {
    const stationQuery = `stationId=${STATION.stationId}`;
    const contractsPath = `${API_PATHS.contracts}?${stationQuery}&date=2026-11-14`;
    const data = createScreensApi('data');
    expect((await answer(data, contractsPath)).json).toEqual(readyContracts('data', { date: '2026-11-14' }));
    expect((await answer(createScreensApi('empty'), contractsPath)).json.contracts).toEqual([]);
    expect(await answer(createScreensApi('error'), contractsPath)).toEqual({ status: 500, json: SERVER_ERROR });
    expect(await answer(createScreensApi('forbidden'), contractsPath)).toEqual({ status: 403, json: FORBIDDEN });

    // The list of reports is the API's in every scenario; the scenario applies to a report's page.
    for (const scenario of SCREEN_SCENARIOS) {
      expect(await answer(createScreensApi(scenario), API_PATHS.reports), scenario).toEqual({ status: 200, json: reportCatalog() });
    }
    const pagePath = page => `${API_PATHS.reports}/turnaround-times?${stationQuery}&from=2026-11-01&to=2026-11-14&page=${page}&limit=25`;
    const query = { stationId: STATION.stationId, from: '2026-11-01', to: '2026-11-14', limit: 25 };
    expect((await answer(data, pagePath(2))).json).toEqual(reportPage('turnaround-times', { ...query, page: 2 }));
    expect((await answer(createScreensApi('empty'), pagePath(1))).json.rows).toEqual([]);
    expect(await answer(createScreensApi('error'), pagePath(1))).toEqual({ status: 500, json: SERVER_ERROR });
    expect(data.readsOf(`${API_PATHS.reports}/turnaround-times`)).toBe(1);
    // An unknown report and an export have no answer: the isolation sends its Problem Details 404.
    expect(await answer(data, `${API_PATHS.reports}/sla?${stationQuery}&from=2026-11-01&to=2026-11-14`)).toBeNull();
    expect(await answer(data, `${API_PATHS.reports}/turnaround-times/export?${stationQuery}&from=2026-11-01&to=2026-11-14&format=csv`))
      .toBeNull();
  });
});
