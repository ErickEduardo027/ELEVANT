import {
  OCC_COALESCE_MS, OCC_HINT_COALESCE_MS, OCC_OBSERVER_POLL_MS, OCC_SAFETY_POLL_MS,
} from './occCadence';

// What one OCC tab asks the API for, and how often (contracts 2.7). occRequestBudget.test.js replays a minute of it
// with the same refresh scheduler the shell uses and fails above the budget. The API allows 600 requests a minute per
// address in Development and 100 elsewhere; the console, Superadmin and the tablet share one address in a presentation.

/** Requests a minute for one OCC tab, at rest and during a demo minute alike (CN-18/19). */
export const OCC_REQUEST_BUDGET = Object.freeze({ rest: 40, demo: 40 });

/**
 * One minute of a demo flight, in seconds (contracts 2.7), as the VPS showed it during a live demo (CN-18/19): the
 * demo worker writes occ_planning on each of its passes, every 5 s, while the flight lands, taxis and parks
 * (DemoFlightProgressWorker.cs); five tablet taps in two bursts; two notices; one hand-off for review. Replayed with the
 * code before CN-18/19 it gives Panorama about the 52 requests a minute measured then.
 */
export const OCC_DEMO_MINUTE = Object.freeze([
  ...[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(at => ({ at, resource: 'occ_planning' })),
  ...[21, 22, 23, 37, 38].map(at => ({ at, resource: 'occ_planning' })),
  { at: 20, resource: 'notifications' },
  { at: 45, resource: 'notifications' },
  { at: 50, resource: 'occ_review' },
].sort((left, right) => left.at - right.at));

/**
 * The reads of the plan. `resources` re-read through useOccResource (coalesced, one per `coalesceMs`); `pollMs` is
 * the safety poll, counted from the last finished read. `owner` is the file that issues the read.
 */
export const OCC_REQUEST_PLAN = Object.freeze({
  // The tab's one account-change observer: its own HTTP poll, and a cursor read for the hints, at once after a quiet
  // window and at most once more in each `hintCoalesceMs` (services/accountChangeObserver.js).
  observer: Object.freeze({ owner: 'src/features/admin-occ/shell/OccShellProvider.jsx', read: 'getAccountChanges',
    pollMs: OCC_OBSERVER_POLL_MS, hintCoalesceMs: OCC_HINT_COALESCE_MS }),
  // The frame, on every OCC screen.
  frame: Object.freeze([
    Object.freeze({ key: 'notices', read: 'getOperationalNotifications', resources: Object.freeze(['notifications']),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS, owner: 'src/features/admin-occ/shell/OccShellProvider.jsx' }),
    // Not the shell's: the presence lease every OCC tab already keeps (ProtectedRole → useWebPresence), counted so
    // the budget covers what the tab really sends.
    Object.freeze({ key: 'presence', read: 'putOperationalPresence', resources: Object.freeze([]), pollMs: 30_000,
      coalesceMs: null, fixedRate: true, owner: '../../packages/api-client/src/presence.ts' }),
  ]),
  // The console of U3 on useOccResource: the map's two reads (maps/useMapSituation.js, MAP_SITUATION_READS) and the
  // console's own four (dashboard/noc/consoleReads.js, CONSOLE_READS); its alerts panel reads the frame's notices.
  console: Object.freeze([
    Object.freeze({ key: 'airPicture', read: 'getOccAirPicture', resources: Object.freeze([]), pollMs: 10_000,
      coalesceMs: OCC_COALESCE_MS, note: 'refreshAfterSeconds (10 s), paused while the tab is hidden',
      owner: 'src/features/maps/useMapSituation.js' }),
    Object.freeze({ key: 'mapFlights', read: 'getOccMapFlights', resources: Object.freeze(['occ_planning']),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS, owner: 'src/features/maps/useMapSituation.js' }),
    Object.freeze({ key: 'planning', read: 'getOccPlanningSnapshot', resources: Object.freeze([]),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS, owner: 'src/features/dashboard/noc/useConsoleData.js' }),
    Object.freeze({ key: 'positions', read: 'getOccPositions', resources: Object.freeze([]),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS, owner: 'src/features/dashboard/noc/useConsoleData.js' }),
    Object.freeze({ key: 'reviewQueue', read: 'getOccReviewQueue', resources: Object.freeze(['occ_review']),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS, owner: 'src/features/dashboard/noc/useConsoleData.js' }),
    // The assigned agents who cannot operate, once the planning's day is known.
    Object.freeze({ key: 'readiness', read: 'getOccAssignmentReadiness', resources: Object.freeze([]),
      pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS, owner: 'src/features/dashboard/noc/useConsoleData.js' }),
  ]),
  // The regional weather of Panorama (lane M7, features/weather/useRegionWeather.js: REGION_WEATHER_READS): the stations,
  // the SIGMETs and the wind grid every ten minutes and the radar index every five, each on its own poll from its last
  // answer, paused while the tab is hidden and never on an announcement. A minute at rest holds none of them.
  weather: Object.freeze([
    Object.freeze({ key: 'regionWeather', read: 'getOccRegionWeather', resources: Object.freeze([]), pollMs: 600_000,
      coalesceMs: OCC_COALESCE_MS, owner: 'src/features/weather/useRegionWeather.js' }),
    Object.freeze({ key: 'sigmets', read: 'getOccSigmets', resources: Object.freeze([]), pollMs: 600_000,
      coalesceMs: OCC_COALESCE_MS, owner: 'src/features/weather/useRegionWeather.js' }),
    Object.freeze({ key: 'windGrid', read: 'getOccWindGrid', resources: Object.freeze([]), pollMs: 600_000,
      coalesceMs: OCC_COALESCE_MS, owner: 'src/features/weather/useRegionWeather.js' }),
    Object.freeze({ key: 'radarFrames', read: 'getOccRadarFrames', resources: Object.freeze([]), pollMs: 300_000,
      coalesceMs: OCC_COALESCE_MS, owner: 'src/features/weather/useRegionWeather.js' }),
  ]),
  // The console's AeroDataBox reference reads (ADR-0028, note of 15 November 2026), on their own visible-tab timers: the
  // delays pill every 15 minutes and the routes every hour. The aircraft and an origin's delays are read only when a
  // flight or a stand is chosen, so they have no pace. The API keeps every answer, so they spend units at most hourly.
  // The delays are not in the Starter plan (`offOnStarter`): their first answer is Disabled and the pill stops polling.
  references: Object.freeze([
    Object.freeze({ key: 'airportDelays', read: 'getOccAirportDelays', resources: Object.freeze([]), pollMs: 900_000,
      coalesceMs: null, fixedRate: true, offOnStarter: true, owner: 'src/features/aviation-reference/AirportDelays.jsx' }),
    Object.freeze({ key: 'airportRoutes', read: 'getOccAirportRoutes', resources: Object.freeze([]), pollMs: 3_600_000,
      coalesceMs: null, fixedRate: true, owner: 'src/features/aviation-reference/useAirportRoutes.js' }),
  ]),
});

const site = fields => Object.freeze({ mountedWhen: null, ...fields, resources: Object.freeze(fields.resources) });

/**
 * Every file mounted under /admin-occ that creates an account-change observer, keyed by path, with the cadences
 * read from that file. `screen` is the navigation id of the OCC screen that mounts it.
 * - `shell`: the tab's single observer.
 * - `screen`: a screen's own observer, kept until the PR that restyles the screen (`movesIn`) moves it onto the
 *   frame's: useOccResource, or the shell's channel (OCC_SHELL_LISTENERS). Each one costs a cursor read per
 *   announcement and its own poll.
 * - `shared-page`: a page of another department that the OCC mounts (Usuarios, the services tab of
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
  // Inside the OCC frame it hears the shell's channel (CN-18/19), with its own 25 s poll while the panel is open.
  'src/features/planning/attendance/useAttendanceDraft.js': site({ mode: 'outside-shell-fallback', screen: 'planning',
    movesIn: null, resources: ['attendance_draft'], pollMs: 25_000, readsPerRefresh: 1,
    mountedWhen: 'the attendance panel of an operation is open' }),
  // The closures and the published services.
  'src/features/contracts/catalog/ServiceClosurePanel.jsx': site({ mode: 'outside-shell-fallback', screen: 'notifications',
    movesIn: null, resources: ['service_closures', 'commercial_catalog'], pollMs: null, readsPerRefresh: 2,
    mountedWhen: 'the services tab of Notificaciones' }),
  // The summary, the users, the access profiles and the access requests.
  'src/features/department-users/useDepartmentGovernance.js': site({ mode: 'outside-shell-fallback', screen: 'users',
    movesIn: null, resources: ['department_users', 'access_requests'], pollMs: null, readsPerRefresh: 4 }),
  'src/features/human-resources/users/RampProfilesPanel.jsx': site({ mode: 'outside-shell-fallback', screen: 'users',
    movesIn: null, resources: ['ramp_profiles', 'department_users'], pollMs: 25_000, readsPerRefresh: 1,
    mountedWhen: 'the ramp profiles tab of Usuarios' }),
});

/**
 * Other periodic reads the OCC screens send today, outside any observer (file and pace read from the code). The 30 s
 * snapshot timers of Monitoreo de vuelos and Mapa de posiciones (flightMonitoringService.js, positionsMapService.js)
 * are gone since CN-18/19: those screens re-read on OCC_SCREEN_REFRESH.
 */
export const OCC_SCREEN_POLLS = Object.freeze([
  Object.freeze({ screen: 'chat', key: 'conversations', pollMs: 20_000, file: 'src/features/chat/useChatPages.js' }),
  Object.freeze({ screen: 'chat', key: 'messages', pollMs: 10_000, file: 'src/features/chat/CanonicalChatRoute.jsx' }),
  Object.freeze({ screen: 'chat', key: 'operationPresence', pollMs: 15_000, file: 'src/features/chat/useOperationPresence.js' }),
  Object.freeze({ screen: 'chat', key: 'ownPresence', pollMs: 30_000, file: 'src/features/chat/useOwnPresence.js' }),
]);

/**
 * The screens whose data hooks re-read on a token of useOccScreenRefresh (admin-occ/live/useOccScreenRefresh.js,
 * CN-18/19), keyed by the route that drives it: the shell's announcements of `resources`, coalesced to one re-read every
 * `coalesceMs`, joined with a read in flight, plus a safety poll `pollMs` after the last one. Each re-read sends
 * `readsPerRefresh` requests. `map` names the map reads (OCC_REQUEST_PLAN.console, useMapSituation) the screen mounts
 * when it opens: Monitoreo and Mapa de posiciones draw the live map at once, Planificación only on its Mapa tab.
 */
export const OCC_SCREEN_REFRESH = Object.freeze({
  'src/features/flight-monitoring/FlightMonitoringRoute.jsx': site({ screen: 'flight-monitoring',
    resources: ['occ_planning'], coalesceMs: OCC_COALESCE_MS, pollMs: OCC_SAFETY_POLL_MS, readsPerRefresh: 1,
    map: Object.freeze(['airPicture', 'mapFlights']) }),
  'src/features/positions-map/PositionsMapRoute.jsx': site({ screen: 'positions-map', resources: ['occ_planning'],
    coalesceMs: OCC_COALESCE_MS, pollMs: OCC_SAFETY_POLL_MS, readsPerRefresh: 1,
    map: Object.freeze(['airPicture', 'mapFlights']) }),
  // The planning snapshot and the assignment readiness marks (PlanningPage.jsx re-reads them on `dataRevision`).
  'src/features/planning/PlanningRoute.jsx': site({ screen: 'planning', resources: ['occ_planning'],
    coalesceMs: OCC_COALESCE_MS, pollMs: OCC_SAFETY_POLL_MS, readsPerRefresh: 2, map: Object.freeze([]) }),
});

/**
 * The screens that hear the feed on the shell's channel themselves (`useOccShellChannel().subscribe`), outside
 * useOccResource, keyed by path. Each matching announcement re-reads at once, uncoalesced, as the screen's own observer
 * did until the PR that restyled it (`movedIn`) put it on the frame's: it opens no observer and sends no cursor read,
 * but its re-reads still count. `resources`, `pollMs` and `readsPerRefresh` as in OCC_OBSERVER_SITES.
 */
export const OCC_SHELL_LISTENERS = Object.freeze({
  'src/features/position-coverage/CoverageRoute.jsx': site({ screen: 'coverage', movedIn: 'U6',
    resources: ['occ_planning'], pollMs: null, readsPerRefresh: 1 }),
  'src/features/master-data/MasterDataRoute.jsx': site({ screen: 'master-data', movedIn: 'U6',
    resources: ['occ_planning'], pollMs: null, readsPerRefresh: 1 }),
  'src/features/devices/DevicesRoute.jsx': site({ screen: 'devices', movedIn: 'U6',
    resources: ['mobile_devices'], pollMs: null, readsPerRefresh: 1 }),
  // The conversations and the open conversation's messages.
  'src/features/chat/CanonicalChatRoute.jsx': site({ screen: 'chat', movedIn: 'U6',
    resources: ['operation_messages'], pollMs: null, readsPerRefresh: 2 }),
  // The history of notices, with its own poll; the services tab (ServiceClosurePanel) keeps its observer.
  'src/features/notifications/CanonicalNotificationsRoute.jsx': site({ screen: 'notifications', movedIn: 'U6',
    resources: ['notifications'], pollMs: 20_000, readsPerRefresh: 1 }),
});
