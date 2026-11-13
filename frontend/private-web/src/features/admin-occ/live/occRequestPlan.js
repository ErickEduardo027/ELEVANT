import { OCC_COALESCE_MS, OCC_OBSERVER_POLL_MS, OCC_SAFETY_POLL_MS } from './occCadence';

// What one OCC tab asks the API for, and how often (contracts 2.7). occRequestBudget.test.js replays a minute of it
// with the same refresh scheduler the shell uses and fails above the budget. The API allows 600 requests a minute per
// address in Development and 100 elsewhere; the console, Superadmin and the tablet share one address in a presentation.

/** Requests a minute for one OCC tab. */
export const OCC_REQUEST_BUDGET = Object.freeze({ rest: 40, demo: 70 });

/**
 * One minute of a demo flight, in seconds (contracts 2.7): occ_planning for the worker's landing, the import, the
 * assignment and five tablet taps; two notices; one hand-off for review.
 */
export const OCC_DEMO_MINUTE = Object.freeze([
  ...[5, 12, 19, 26, 33, 40, 47, 54].map(at => ({ at, resource: 'occ_planning' })),
  { at: 20, resource: 'notifications' },
  { at: 45, resource: 'notifications' },
  { at: 50, resource: 'occ_review' },
].sort((left, right) => left.at - right.at));

/**
 * The reads of the plan. `resources` re-read through useOccResource (coalesced, one per `coalesceMs`); `pollMs` is
 * the safety poll, counted from the last finished read. `owner` is the file that issues the read.
 */
export const OCC_REQUEST_PLAN = Object.freeze({
  // The tab's one account-change observer: a cursor read per announcement and its own HTTP poll.
  observer: Object.freeze({ owner: 'src/features/admin-occ/shell/OccShellProvider.jsx', read: 'getAccountChanges',
    pollMs: OCC_OBSERVER_POLL_MS }),
  // The frame, on every OCC screen.
  frame: Object.freeze([
    Object.freeze({ key: 'notices', read: 'getOperationalNotifications', resources: Object.freeze(['notifications']),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS, owner: 'src/features/admin-occ/shell/OccShellProvider.jsx' }),
    // Not the shell's: the presence lease every OCC tab already keeps (ProtectedRole → useWebPresence), counted so
    // the budget covers what the tab really sends.
    Object.freeze({ key: 'presence', read: 'putOperationalPresence', resources: Object.freeze([]), pollMs: 30_000,
      coalesceMs: null, fixedRate: true, owner: '../../packages/api-client/src/presence.ts' }),
  ]),
  // The console that U3 builds on useOccResource; its alerts panel reads the frame's notices.
  console: Object.freeze([
    Object.freeze({ key: 'airPicture', read: 'getOccAirPicture', resources: Object.freeze([]), pollMs: 10_000,
      coalesceMs: OCC_COALESCE_MS, note: 'refreshAfterSeconds (10 s), paused while the tab is hidden' }),
    Object.freeze({ key: 'mapFlights', read: 'getOccMapFlights', resources: Object.freeze(['occ_planning']),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS }),
    Object.freeze({ key: 'planning', read: 'getOccPlanningSnapshot', resources: Object.freeze([]),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS }),
    Object.freeze({ key: 'positions', read: 'getOccPositions', resources: Object.freeze([]),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS }),
    Object.freeze({ key: 'reviewQueue', read: 'getOccReviewQueue', resources: Object.freeze(['occ_review']),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS }),
  ]),
});

const site = fields => Object.freeze({ mountedWhen: null, ...fields, resources: Object.freeze(fields.resources) });

/**
 * Every file mounted under /admin-occ that creates an account-change observer, keyed by path, with the cadences
 * read from that file. `screen` is the navigation id of the OCC screen that mounts it.
 * - `shell`: the tab's single observer.
 * - `screen`: a screen's own observer, kept until the PR that restyles the screen (`movesIn`) moves it onto
 *   useOccResource. Each one costs a cursor read per announcement and its own poll.
 * - `shared-page`: a page of another department that the OCC mounts (Usuarios, Mis gastos, the services tab of
 *   Notificaciones); it keeps its observer while mounted.
 * - `outside-shell-fallback`: uses the shell's observer inside the OCC frame and its own only outside it.
 * - `disabled-in-occ`: its observer is off in the OCC (`offBy`).
 * - `import-only`: the OCC imports another export of the file; the component with the observer never mounts there.
 * `resources` are what its listener re-reads on, `pollMs` its own data poll (null if none), `readsPerRefresh` the
 * requests one re-read sends, `mountedWhen` set when only a tab or a drawer mounts it.
 */
export const OCC_OBSERVER_SITES = Object.freeze({
  'src/features/admin-occ/shell/OccShellProvider.jsx': site({ mode: 'shell', screen: null, movesIn: null,
    resources: [], pollMs: null, readsPerRefresh: 0 }),
  'src/features/access/DepartmentAccessContext.jsx': site({ mode: 'disabled-in-occ', screen: null, movesIn: 'U2',
    resources: ['department_users', 'access_requests'], pollMs: null, readsPerRefresh: 1,
    offBy: "src/app/RoleLayout.jsx passes observe={role !== 'adminOcc'}; the shell refreshes access instead" }),
  'src/features/notifications/useNotificationBadge.js': site({ mode: 'disabled-in-occ', screen: null, movesIn: 'U2',
    resources: ['notifications'], pollMs: 15_000, readsPerRefresh: 1,
    offBy: 'AdminOccLayout passes notificationsEnabled={false}; the shell reads the notices' }),
  'src/features/notifications/useDepartmentNotifications.js': site({ mode: 'disabled-in-occ', screen: null,
    movesIn: null, resources: ['notifications'], pollMs: 60_000, readsPerRefresh: 1,
    offBy: "AppShell reads it only for notificationsSource 'department', which the OCC never passes" }),
  'src/features/admin-occ/useOccReviewQueue.js': site({ mode: 'outside-shell-fallback', screen: 'approvals',
    movesIn: 'U2', resources: ['occ_review'], pollMs: null,
    // The review route re-reads its queue, and the open operation's detail and incidents.
    readsPerRefresh: 3 }),
  'src/features/dashboard/useDashboardData.js': site({ mode: 'screen', screen: 'dashboard', movesIn: 'U3',
    resources: ['notifications', 'occ_planning'], pollMs: 25_000, readsPerRefresh: 3 }),
  'src/features/flight-monitoring/FlightMonitoringRoute.jsx': site({ mode: 'screen', screen: 'flight-monitoring',
    movesIn: 'U5', resources: ['occ_planning'], pollMs: 25_000, readsPerRefresh: 1 }),
  'src/features/positions-map/PositionsMapRoute.jsx': site({ mode: 'screen', screen: 'positions-map', movesIn: 'U5',
    resources: ['occ_planning'], pollMs: 25_000, readsPerRefresh: 1 }),
  // The planning snapshot and the assignment readiness marks.
  'src/features/planning/PlanningRoute.jsx': site({ mode: 'screen', screen: 'planning', movesIn: 'U5',
    resources: ['occ_planning'], pollMs: 25_000, readsPerRefresh: 2 }),
  'src/features/planning/attendance/useAttendanceDraft.js': site({ mode: 'screen', screen: 'planning', movesIn: 'U5',
    resources: ['attendance_draft'], pollMs: 25_000, readsPerRefresh: 1,
    mountedWhen: 'the attendance panel of an operation is open' }),
  'src/features/position-coverage/CoverageRoute.jsx': site({ mode: 'screen', screen: 'coverage', movesIn: 'U6',
    resources: ['occ_planning'], pollMs: null, readsPerRefresh: 1 }),
  'src/features/master-data/MasterDataRoute.jsx': site({ mode: 'screen', screen: 'master-data', movesIn: 'U6',
    resources: ['occ_planning'], pollMs: null, readsPerRefresh: 1 }),
  'src/features/devices/DevicesRoute.jsx': site({ mode: 'screen', screen: 'devices', movesIn: 'U6',
    resources: ['mobile_devices'], pollMs: null, readsPerRefresh: 1 }),
  // The conversations and the open conversation's messages.
  'src/features/chat/CanonicalChatRoute.jsx': site({ mode: 'screen', screen: 'chat', movesIn: 'U6',
    resources: ['operation_messages'], pollMs: null, readsPerRefresh: 2 }),
  'src/features/notifications/CanonicalNotificationsRoute.jsx': site({ mode: 'screen', screen: 'notifications',
    movesIn: 'U6', resources: ['notifications'], pollMs: 20_000, readsPerRefresh: 1 }),
  // The closures and the published services.
  'src/features/contracts/catalog/ServiceClosurePanel.jsx': site({ mode: 'shared-page', screen: 'notifications',
    movesIn: null, resources: ['service_closures', 'commercial_catalog'], pollMs: null, readsPerRefresh: 2,
    mountedWhen: 'the services tab of Notificaciones' }),
  // The summary, the users, the access profiles and the access requests.
  'src/features/department-users/useDepartmentGovernance.js': site({ mode: 'shared-page', screen: 'users',
    movesIn: null, resources: ['department_users', 'access_requests'], pollMs: null, readsPerRefresh: 4 }),
  'src/features/human-resources/users/RampProfilesPanel.jsx': site({ mode: 'shared-page', screen: 'users',
    movesIn: null, resources: ['ramp_profiles', 'department_users'], pollMs: 25_000, readsPerRefresh: 1,
    mountedWhen: 'the ramp profiles tab of Usuarios' }),
  // It only marks the list as changed; the user reloads it.
  'src/features/finance/payables/usePayablesWorkspace.js': site({ mode: 'shared-page', screen: 'expenses',
    movesIn: null, resources: ['finance_expenses', 'finance_receipts'], pollMs: null, readsPerRefresh: 0 }),
  'src/features/employees/RequisitionsPage.jsx': site({ mode: 'import-only', screen: 'users', movesIn: null,
    resources: ['requisitions'], pollMs: null, readsPerRefresh: 1,
    offBy: 'the OCC mounts only its RequisitionCard export, inside the requisitions tab of Usuarios' }),
});

/** Other periodic reads the OCC screens send today, outside any observer (file and pace read from the code). */
export const OCC_SCREEN_POLLS = Object.freeze([
  Object.freeze({ screen: 'dashboard', key: 'regionalTraffic', pollMs: 120_000, file: 'src/features/dashboard/useRegionalTraffic.js' }),
  Object.freeze({ screen: 'flight-monitoring', key: 'flightSnapshot', pollMs: 30_000, file: 'src/services/flightMonitoringService.js' }),
  Object.freeze({ screen: 'positions-map', key: 'positionsSnapshot', pollMs: 30_000, file: 'src/services/positionsMapService.js' }),
  Object.freeze({ screen: 'chat', key: 'conversations', pollMs: 20_000, file: 'src/features/chat/useChatPages.js' }),
  Object.freeze({ screen: 'chat', key: 'messages', pollMs: 10_000, file: 'src/features/chat/CanonicalChatRoute.jsx' }),
  Object.freeze({ screen: 'chat', key: 'operationPresence', pollMs: 15_000, file: 'src/features/chat/useOperationPresence.js' }),
  Object.freeze({ screen: 'chat', key: 'ownPresence', pollMs: 30_000, file: 'src/features/chat/useOwnPresence.js' }),
]);
