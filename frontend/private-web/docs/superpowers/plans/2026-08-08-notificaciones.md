# Módulo de Notificaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, same session — file interdependencies are tight enough that a single implementer should carry the whole feature). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Notificaciones" module described in `Claude-skills/plan-notification/skill.md` — the historical, manageable, filterable/searchable version of the Dashboard's `AlertsFeed` — reusing every existing pattern (StatusBadge/statusMeta, Review's drawer/filter/selection/toast conventions, the service+mock-store convention) instead of inventing parallel systems, and wiring it into `AppShell`, `Sidebar` (already has a `notifications` module entry) and `Topbar` (already has a bell + badge, currently fed by `dashboard.alerts.length`).

**Architecture:** A standalone feature under `src/features/notifications/`, following exactly the shape of `src/features/review/`: `NotificationsPage` composed from small presentational components, fed by `useNotificationsData` over `src/services/notificationsService.js` (mock adapter mirroring `reviewService.js`'s in-memory store pattern). Filtering lives in `useNotificationFilters` (mirrors `useReviewFilters`). Selection reuses `useReviewSelection` directly (generic, no review-specific naming — cross-feature import, same precedent as `ReportsPage` importing `useReviewToasts`/`ReviewToastStack` from `../review/`). Toasts reuse `ReviewToastStack` + `useReviewToasts` verbatim — no new toast system. Severity reuses `StatusBadge` via a new `notification` domain added to `statusMeta.js` — no new badge/color system. `AppShell` gains a `useNotificationsData` call (same shape as its `review`/`monitoring` wiring), replaces the `ModulePlaceholder` fallback for `MODULE_IDS.NOTIFICATIONS`, and becomes the single source of the unread count fed to both `Sidebar`'s badge and `Topbar`'s bell badge (replacing today's `data?.alerts?.length` proxy).

**Tech Stack:** React 18, Vite 6, Tailwind CSS 3 (existing tokens only), Vitest + React Testing Library + jsdom (already configured). No new dependencies, no router (module switch is `activeModuleId` state in `AppShell`, exactly like every other module).

## Global Constraints

- Spec of record: `Claude-skills/plan-notification/skill.md` — follow it for copy, structure, and the 26-item deliverable checklist. This plan resolves every "reuse vs. create" ambiguity it leaves open; where this plan and the spec conflict, this plan wins (it reflects the real codebase, inspected file-by-file).
- Reuse, do not duplicate: `StatusBadge` + `STATUS_COLORS`/`getStatusMeta` (`src/features/dashboard/statusMeta.js`, `.../StatusBadge.jsx`), `formatClockTime` (`src/features/dashboard/mappers.js`), `useReviewSelection` (`src/features/review/useReviewSelection.js`), `useReviewToasts` + `ReviewToastStack` (`src/features/review/useReviewToasts.js`, `.../components/ReviewToast.jsx`), `SearchIcon` (`src/features/planning/components/icons.jsx`), `ShieldCheckIcon`/`BellIcon`/`AlertTriangleIcon`/`ChecklistIcon` (`src/features/dashboard/components/icons/index.jsx`), `XIcon`/`CheckCircleIcon` (`src/features/review/components/icons.jsx`). Cross-feature imports of this kind are an established pattern (`ReportsPage.jsx` already imports review's toast stack).
- Only create new icons for what doesn't exist yet, in `src/features/notifications/components/icons.jsx` (same hand-drawn style: `viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth="1.7"`, `aria-hidden="true"`, local `Icon` wrapper — copy the wrapper, every feature has its own): `PlugIcon` (Sistema/Integración), `IdCardIcon` (Personal), `SettingsIcon` (gear, header config button), `CheckCheckIcon` (marcar todas como leídas), `ArrowRightIcon` (acción "Ver X").
- Color tokens (exact hex, no new colors): `ink-900` `#0B1F3F`, `accent-600` `#145DC4`, `signal-500` `#F2661E`; light bg `#F7F9FB` / card `#FFFFFF` / text primary `#0B1F3F` / secondary `#6B7684`; dark bg `#0A1220` / card `rgba(11,31,63,0.55)` / text primary `#F4F6F9` / secondary `#94A3B8`; status info `#145DC4`, active `#F2661E`, success `#1E9E6B`, warning `#D9A441`, danger `#C4453C`. Severity → status-color mapping: informativa→info, atención→warning, crítica→danger, positiva→success.
- Typography: Inter (default `font-sans`) for all UI text; `font-mono` for flight numbers/timestamps, matching Review/Reports.
- Dark mode via existing Tailwind `class` strategy — every new component needs `dark:` variants matching sibling components exactly (copy classnames from `Review*` components, don't invent new ones).
- All UI text in Spanish, zero emojis, zero decorative icons — outline icons only.
- No router: module switch is `activeModuleId` in `AppShell`. No real backend/WebSocket — `src/services/notificationsService.js` is an in-memory mock adapter (comment the conceptual REST endpoints at the top, exactly like `reviewService.js` does), and `useNotificationsData` exposes a `refresh()` that a future WebSocket/polling handler can call — do not implement actual polling/WebSocket wiring, just leave the seam (this satisfies spec §12/§17 "preparar", not "implementar").
- Time-based logic takes `nowIso` as an explicit parameter — never call `Date.now()`/`new Date()` inside a pure mapper function (breaks deterministic tests). `NotificationsPage` seeds its own `now` via `useState(() => new Date().toISOString())` ticked by `setInterval`, exactly like `ReviewPage`/`FlightMonitoringPage` already do.
- Notification ids are strings (`'NOT-2001'` style, mirrors Review's `'REV-1001'`), timestamps are ISO 8601 with the `-04:00` station offset, matching `reviewService.js`'s `isoAt()` helper (copy that helper into `notificationsService.js`, same `STATION_UTC_OFFSET_MS` convention as `reviewService.js`/`reportsMappers.js`).
- Because `AppShell` renders `<main key={activeModule.id}>`, switching modules always fully remounts the target page. This means deep-linking "seleccionar automáticamente ese vuelo/operación" needs **no token/effect machinery** — just an optional `focusFlightId`/`focusOperationId` prop consumed once in the target page's `useState` initializer. `AppShell.handleSelectModule` (manual sidebar clicks) must reset this focus state to `null` so a stale focus doesn't leak into a later manual visit.
- Do not touch `AlertsFeed.jsx`, `DashboardPage.jsx`, `useDashboardData.js`, or `dashboardService.js` — the Dashboard's own alert feed is out of scope per spec §21/restricciones absolutas. Only `Topbar.jsx` and `AppShell.jsx` (shell-level wiring) and `statusMeta.js` (additive) are touched outside the new feature folder.

---

## Task 1: `statusMeta.js` — notification severity domain

**Files:**
- Modify: `src/features/dashboard/statusMeta.js`
- Modify: `src/features/dashboard/statusMeta.test.js`

**Interfaces:**
- Produces: `NOTIFICATION_SEVERITY_META` exported, and `getStatusMeta('notification', <severity>)` resolves `info|warning|critical|success` to `{ label, color }`.

- [ ] Add `export const NOTIFICATION_SEVERITY_META = { info: { label: 'Informativa', color: 'info' }, warning: { label: 'Atención', color: 'warning' }, critical: { label: 'Crítica', color: 'danger' }, success: { label: 'Positiva', color: 'success' } };` and register `notification: NOTIFICATION_SEVERITY_META` in `STATUS_TABLES_BY_DOMAIN`.
- [ ] Test: `getStatusMeta('notification', 'critical')` → `{ label: 'Crítica', color: 'danger' }`, and the three other severities.
- [ ] Run `npm test -- statusMeta`, confirm pass, commit.

## Task 2: `src/services/notificationsService.js` — mock store

**Files:**
- Create: `src/services/notificationsService.js`
- Create: `src/services/notificationsService.test.js`

**Interfaces:**
- Produces:
  - `Notification` shape: `{ id, category, severity, title, description, read, createdAt, flightNumber, airline, position, operationId, relatedModule, relatedRoute, source, metadata }` — `category` ∈ `operational|review|system|personal|general`; `severity` ∈ `info|warning|critical|success`; `relatedModule` ∈ `'flight-monitoring'|'approvals'|'reports'|null`; `relatedRoute` is an opaque id consumed by the target page (`flightId` for flight-monitoring, `operationId` for approvals), `null` when `relatedModule` is `null`.
  - `getNotifications(stationCode = 'PUJ')` → `Promise<{ station, notifications: Notification[] }>`.
  - `getNotification(id)` → `Promise<Notification>`.
  - `markNotificationAsRead(id)` / `markNotificationAsUnread(id)` → `Promise<Notification>` (mutates the in-memory store, returns the updated record).
  - `markNotificationsAsRead(ids)` / `markNotificationsAsUnread(ids)` → `Promise<Notification[]>`.
  - `markAllNotificationsAsRead()` → `Promise<Notification[]>` (full updated list).
  - `getNotificationPreferences()` → `Promise<Record<category, 'show'|'mute'>>`; `updateNotificationPreferences(prefs)` → `Promise<Record<category,'show'|'mute'>>` (in-memory only, per spec §11 "no es necesario implementar persistencia real").
  - `__resetNotificationsStoreForTests()` for test isolation (mirrors `reviewService.js`).
- Mock data must cover, per spec §16: all 5 categories, all 4 severities, a mix of read/unread, at least one critical (`FlyAware desconectado`, unread, category `system`) and one positive (`FlyAware reconectado` or `Operación aprobada`, category `system`/`review`), at least 2 with `relatedModule` set (one `flight-monitoring` flight DM161 "fuera de tiempo estimado", one `approvals` operation referencing `REV-1002`/AA123-style id) and at least 2 with `relatedModule: null` (e.g. "Posición A10 inhabilitada", "Habilitación próxima a vencer"). Include ≥12 records spanning today/yesterday/this-week/older `createdAt` timestamps so date-grouping (Task 4) has real data to group.

- [ ] Write `notificationsService.test.js` covering: shape of `getNotifications()` result, `markNotificationAsRead` flips `read` and is idempotent, `markAllNotificationsAsRead` leaves zero unread, `markNotificationsAsRead(ids)` only touches the given ids, `updateNotificationPreferences` round-trips through `getNotificationPreferences`, `__resetNotificationsStoreForTests` restores the original read/unread state.
- [ ] Implement the service (copy `reviewService.js`'s `isoAt`/`pad`/`STATION_UTC_OFFSET_MS`/`structuredCloneOperation`-style `structuredCloneNotification` helpers, and its `let store = ...` + `findX OrThrow` pattern).
- [ ] Run `npm test -- notificationsService`, confirm pass, commit.

## Task 3: `src/features/notifications/notificationsMappers.js` — pure helpers

**Files:**
- Create: `src/features/notifications/notificationsMappers.js`
- Create: `src/features/notifications/notificationsMappers.test.js`

**Interfaces:**
- Produces:
  - `NOTIFICATION_CATEGORIES = [{ id: 'operational', label: 'Operativas' }, { id: 'review', label: 'Revisión' }, { id: 'system', label: 'Sistema' }, { id: 'personal', label: 'Personal' }, { id: 'general', label: 'Generales' }]`.
  - `NOTIFICATION_SEVERITIES = [{ id: 'info', label: 'Informativa' }, { id: 'warning', label: 'Atención' }, { id: 'critical', label: 'Crítica' }, { id: 'success', label: 'Positiva' }]`.
  - `NOTIFICATION_DATE_PRESETS = [{ id: 'today', label: 'Hoy' }, { id: 'yesterday', label: 'Ayer' }, { id: 'week', label: 'Esta semana' }, { id: 'last30', label: 'Últimos 30 días' }, { id: 'custom', label: 'Rango personalizado' }]`.
  - `resolveNotificationDateRange(preset, customFrom, customTo, nowIso)` → `{ from, to }` date-key strings (`YYYY-MM-DD`), same station-offset logic as `reportsMappers.js` (`case 'last30': return { from: addDaysToDateKey(today, -29), to: today }`).
  - `groupNotificationsByDate(notifications, nowIso)` → `[{ key: 'today'|'yesterday'|'week'|'older', label: 'HOY'|'AYER'|'ESTA SEMANA'|'ANTERIORES', items: Notification[] }]`, omitting empty groups, preserving each group's incoming order.
  - `formatRelativeTime(iso, nowIso)` → `'Hace 5 min'` / `'Hace 2 h'` / `'Ayer'` / `'DD MMM'` (falls back to a short date past 7 days), pure function of the two isos.
  - `computeNotificationCounts(notifications)` → `{ total, unread, critical, needsAttention }` (`needsAttention` = unread ∧ severity ∈ `{warning, critical}`).
  - `getNotificationFilterOptions(notifications)` → currently just re-exports `NOTIFICATION_CATEGORIES`/`NOTIFICATION_SEVERITIES` (kept as a function for symmetry with `reviewMappers.getFilterOptions`, in case category options become data-driven later — do not over-build this, a one-line body is correct).
  - `matchesNotificationSearch(notification, query)` → boolean, checks `flightNumber`, `airline`, `title`, `description`, `operationId`, `position` case-insensitively (mirrors `useReviewFilters.matchesFilters`'s `search` branch).

- [ ] Write tests: grouping puts a `createdAt` of "today" in the `today` bucket and one from 10 days ago in `older`; `resolveNotificationDateRange('last30', ...)` spans 30 days inclusive; `formatRelativeTime` for a 5-minute-old iso vs. the same `nowIso` returns `'Hace 5 min'`; `computeNotificationCounts` on a fixture of 4 notifications (2 unread, 1 critical-unread, 1 read) returns the right counts.
- [ ] Implement.
- [ ] Run `npm test -- notificationsMappers`, confirm pass, commit.

## Task 4: `useNotificationsData` + `useNotificationFilters`

**Files:**
- Create: `src/features/notifications/useNotificationsData.js`
- Create: `src/features/notifications/useNotificationsData.test.js`
- Create: `src/features/notifications/useNotificationFilters.js`
- Create: `src/features/notifications/useNotificationFilters.test.js`

**Interfaces:**
- `useNotificationsData(stationCode = 'PUJ', refreshToken = 0)` → `{ status, data, error, refresh, markAsRead(id), markAsUnread(id), markManyAsRead(ids), markManyAsUnread(ids), markAllAsRead() }` — same `status: 'loading'|'success'|'error'` shape as `useReviewData`, optimistic local patch after each service call (mirror `useReviewData`'s `patchOperations`).
- `useNotificationFilters(notifications, nowIso)` → `{ filters: { category, severity, status, datePreset, customRange: {from,to}, search }, setFilter(key, value), setDatePreset, setCustomDate(key, value), resetFilters, hasActiveFilters, filteredNotifications, counts }` where `filters.status` ∈ `''|'unread'|'read'` and `counts` is `computeNotificationCounts(notifications)` (unfiltered, for the header strip) — mirrors `useReviewFilters`'s split between tab-level counts and filtered rows.

- [ ] Write `useNotificationsData.test.js`: mocks `notificationsService`, asserts loading→success transition, asserts `markAsRead` flips the local record without a full refetch, asserts `refreshToken` change triggers a reload (copy `useReviewData.test.js`'s structure).
- [ ] Write `useNotificationFilters.test.js`: category/severity/status/search/date filters each narrow the list independently and combine with AND semantics; `resetFilters` clears everything; `hasActiveFilters` is false only when every filter is at its default.
- [ ] Implement both hooks.
- [ ] Run `npm test -- useNotification`, confirm pass, commit.

## Task 5: `components/icons.jsx`, `NotificationSeverityBadge`, `NotificationSkeleton`, `NotificationEmptyState`

**Files:**
- Create: `src/features/notifications/components/icons.jsx` (+ `.test.jsx`)
- Create: `src/features/notifications/components/NotificationSeverityBadge.jsx` (+ `.test.jsx`)
- Create: `src/features/notifications/components/NotificationSkeleton.jsx` (+ `.test.jsx`)
- Create: `src/features/notifications/components/NotificationEmptyState.jsx` (+ `.test.jsx`)

**Interfaces:**
- `icons.jsx` exports `PlugIcon`, `IdCardIcon`, `SettingsIcon`, `CheckCheckIcon`, `ArrowRightIcon` (copy the local `Icon` wrapper from `review/components/icons.jsx` verbatim).
- `NotificationSeverityBadge({ severity })` → `<StatusBadge domain="notification" status={severity} />` (mirrors `ReviewStatusBadge`).
- `NotificationSkeleton()` → `data-testid="notification-skeleton"`, N pulse rows (mirror `ReviewSkeleton`).
- `NotificationEmptyState({ variant, hasActiveFilters })` where `variant` ∈ `'general'|'filtered'|'all-read'`, copy text from spec §14 (B/C/E): "Sin notificaciones nuevas" / "No hay notificaciones en esta categoría." / "Todas las notificaciones están al día." — icon `BellIcon` from dashboard icons.

- [ ] Write the four `.test.jsx` files (render + assert testids/text, one icon smoke-test rendering all 5 exports).
- [ ] Implement the four files.
- [ ] Run `npm test -- notifications/components`, confirm pass, commit.

## Task 6: `NotificationsHeader` + `NotificationFilterBar`

**Files:**
- Create: `src/features/notifications/components/NotificationsHeader.jsx` (+ `.test.jsx`)
- Create: `src/features/notifications/components/NotificationFilterBar.jsx` (+ `.test.jsx`)

**Interfaces:**
- `NotificationsHeader({ counts, onMarkAllAsRead, onOpenSettings })` — `<h1>Notificaciones</h1>` (matches `ReviewHeader`'s `role: 'heading'` convention used by `AppShell.test.jsx`), subtitle "Historial y alertas operativas del sistema.", discreet KPI strip (Total/No leídas/Críticas/Requieren atención from `counts`), "Marcar todas como leídas" button (disabled when `counts.unread === 0`), settings icon button (`SettingsIcon`) calling `onOpenSettings`.
- `NotificationFilterBar({ filters, options, onFilterChange, onDatePreset, onCustomDate, onResetFilters, hasActiveFilters })` — category `<select>` + severity `<select>` + status `<select>` (`FilterSelect`-style, copy `ReviewFilters.jsx`'s local `FilterSelect`/`FilterInput` helpers), date preset pill group + custom `from`/`to` date inputs (copy `DateRangePicker.jsx`'s visual pattern inline — do not import it, its presets are reports-specific and its prop names don't match; a bespoke small block here is correct, not a duplication, since the two components differ in domain), search input with placeholder "Buscar por vuelo, referencia o descripción...", "Limpiar filtros" button disabled when `!hasActiveFilters`.

- [ ] Tests: header renders counts and disables "Marcar todas como leídas" at zero unread, clicking calls `onMarkAllAsRead`; filter bar renders all category/severity options, changing a select calls `onFilterChange` with the right key, "Limpiar filtros" respects `hasActiveFilters`.
- [ ] Implement.
- [ ] Run `npm test -- Notifications(Header|FilterBar)`, confirm pass, commit.

## Task 7: `NotificationCard` + `NotificationFeed`

**Files:**
- Create: `src/features/notifications/components/NotificationCard.jsx` (+ `.test.jsx`)
- Create: `src/features/notifications/components/NotificationFeed.jsx` (+ `.test.jsx`)

**Interfaces:**
- `NotificationCard({ notification, nowIso, selected, onToggleSelect, onOpen })` — category icon (map `category` → icon: operational→`AlertTriangleIcon`, review→`ShieldCheckIcon`, system→`PlugIcon`, personal→`IdCardIcon`, general→`BellIcon`), `NotificationSeverityBadge`, title (bold if unread), description (line-clamped), `formatRelativeTime` with the exact time as the `title` HTML attribute (spec §3 "hora exacta disponible" = tooltip, not two separate visible strings), unread dot + slightly different background when `!notification.read` (per spec §4, discreet — reuse `bg-accent-600/5` not a saturated color), flight/airline/position inline chips when present, checkbox (`aria-label="Seleccionar notificación"`) calling `onToggleSelect(notification.id)`, whole-card `onClick` → `onOpen(notification.id)` (checkbox click must `stopPropagation` so it doesn't also open the card).
- `NotificationFeed({ groups, nowIso, selectedIds, onToggleSelect, onOpen })` — renders `groupNotificationsByDate` output with a discreet uppercase separator per group (spec §5), centered column `max-w-[800px] mx-auto`, `data-testid="notification-feed"`.

- [ ] Tests: unread card has heavier font-weight class and the unread dot testid; clicking the card body calls `onOpen`; clicking the checkbox calls `onToggleSelect` and does **not** call `onOpen`; feed renders date-group separators in the right order and skips empty groups.
- [ ] Implement.
- [ ] Run `npm test -- Notification(Card|Feed)`, confirm pass, commit.

## Task 8: `NotificationBulkActionsBar` + `NotificationDetailDrawer` + `NotificationSettingsDrawer`

**Files:**
- Create: `src/features/notifications/components/NotificationBulkActionsBar.jsx` (+ `.test.jsx`)
- Create: `src/features/notifications/components/NotificationDetailDrawer.jsx` (+ `.test.jsx`)
- Create: `src/features/notifications/components/NotificationSettingsDrawer.jsx` (+ `.test.jsx`)

**Interfaces:**
- `NotificationBulkActionsBar({ count, onMarkRead, onMarkUnread, onClear })` — copy `ReviewSelectionBar.jsx`'s structure/classnames exactly, swap copy for "N seleccionadas" + "Marcar como leídas"/"Marcar como no leídas"/"Limpiar selección"; returns `null` when `count === 0`.
- `NotificationDetailDrawer({ notification, onClose, onMarkAsRead, onMarkAsUnread, onNavigate })` — copy `ReviewDetailDrawer.jsx`'s chrome (overlay + `role="dialog"` aside, Escape-to-close, header with close button) at `lg:w-[420px]` per spec §18 (not the 60% Review uses — spec asks for 400–500px on desktop). Body: category label, `NotificationSeverityBadge`, read/unread status text, full title, full description, exact date/time (`formatClockTime`), `source`, flight/airline/position/`operationId` when present, `metadata` as a simple key/value list. Footer: "Ver vuelo"/"Ver operación"/"Ver reporte" button (label keyed off `relatedModule`) calling `onNavigate(notification.relatedModule, notification.relatedRoute)` when `relatedModule` is set, else no footer button. Opening the drawer calls `onMarkAsRead(notification.id)` once if the notification was unread (side effect lives in the parent per Task 9, not inside this component — keep this component a pure view + the two explicit read/unread buttons).
- `NotificationSettingsDrawer({ open, preferences, onTogglePreference, onClose })` — same drawer chrome, body is one row per `NOTIFICATION_CATEGORIES` entry with a "Mostrar"/"Silenciar" two-state toggle (simple button pair, `aria-pressed`), no submit button (changes apply immediately via `onTogglePreference(categoryId, nextValue)`, matching spec §11 "no es necesario implementar persistencia real" — in-memory only through the service from Task 2).

- [ ] Tests: bulk bar renders nothing at `count===0`, wires the three buttons; detail drawer renders `null` when `notification` is `null`, closes on Escape and backdrop click, footer button label switches correctly across `flight-monitoring`/`approvals`/`reports`/`null`; settings drawer toggles a category and calls `onTogglePreference` with the flipped value.
- [ ] Implement.
- [ ] Run `npm test -- Notification(BulkActionsBar|DetailDrawer|SettingsDrawer)`, confirm pass, commit.

## Task 9: `NotificationsPage` — composition

**Files:**
- Create: `src/features/notifications/NotificationsPage.jsx`
- Create: `src/features/notifications/NotificationsPage.test.jsx`

**Interfaces:**
- Consumes every component/hook from Tasks 3–8.
- `NotificationsPage({ status, data, error, onRetry, onMarkAsRead, onMarkAsUnread, onMarkManyAsRead, onMarkManyAsUnread, onMarkAllAsRead, onNavigateToResource, forceState = 'default' })` — same `status`/`error`/`onRetry` error-panel pattern as `ReviewPage`/`FlightMonitoringPage`/`ReportsPage` (copy the `role="alert"` block verbatim, copy differs only in the message text: "No se pudo cargar las notificaciones."). `forceState === 'notificationsEmpty'` forces `data.notifications = []`; `forceState === 'notificationsError'` forces the error branch — same convention as `reviewEmpty`/`reviewError` in `ReviewPage`.
- Owns: `selectedNotificationId` (opens `NotificationDetailDrawer`, and triggers `onMarkAsRead` once on open if unread), `settingsOpen` boolean, `preferences` state seeded from `getNotificationPreferences()` via a tiny local `useEffect` (or lift into `useNotificationsData` if simpler — implementer's call, keep it out of the service test surface either way), selection via `useReviewSelection()` (imported cross-feature), toasts via `useReviewToasts()` + `ReviewToastStack` (imported cross-feature), `now` ticked every 30s like `ReviewPage`.
- Toast copy (spec §9/§10): "Notificación marcada como leída." (success) on individual mark-as-read, "Todas las notificaciones fueron marcadas como leídas." (success) on mark-all.
- `onNavigate(relatedModule, relatedRoute)` from the drawer calls the page's `onNavigateToResource(relatedModule, relatedRoute)` prop straight through (AppShell owns the actual module switch — Task 10).

- [ ] Tests (integration-style, mirror `ReviewPage.test.jsx`'s shape): loading shows `NotificationSkeleton`; empty (no notifications) shows the general empty state; a filter that matches nothing shows the filtered empty state; clicking a card opens the drawer and marks it read (toast appears, header "No leídas" count decrements); selecting 2 cards shows the bulk bar with "2 seleccionadas"; "Marcar todas como leídas" empties the unread count and shows its toast; clicking "Ver vuelo" in the drawer calls `onNavigateToResource('flight-monitoring', <flightId>)`.
- [ ] Implement.
- [ ] Run `npm test -- NotificationsPage`, confirm pass, commit.

## Task 10: Wire into `AppShell`, `Sidebar` badge, `Topbar` bell, `DevPreviewPanel`

**Files:**
- Modify: `src/features/shell/AppShell.jsx` (+ `.test.jsx`)
- Modify: `src/features/dashboard/components/Topbar.jsx` (+ `.test.jsx`)
- Modify: `src/features/dashboard/components/DevPreviewPanel.jsx`
- Modify: `src/features/flight-monitoring/FlightMonitoringPage.jsx` (+ `.test.jsx`) — add optional `focusFlightId` prop, seed `selectedFlightId` from it.
- Modify: `src/features/review/ReviewPage.jsx` (+ `.test.jsx`) — add optional `focusOperationId` prop, seed `selectedOperationId` from it.

**Interfaces:**
- `AppShell`: add `notificationsRetryToken` state + `useNotificationsData('PUJ', notificationsRetryToken)`; add `focusResource` state (`null | { flightId } | { operationId }`); `unreadNotificationsCount = notifications.data?.notifications.filter(n => !n.read).length ?? 0`; `Sidebar`'s `badgeCounts` gains `[MODULE_IDS.NOTIFICATIONS]: unreadNotificationsCount` alongside the existing `APPROVALS` entry; `Topbar`'s `notificationsCount` prop changes from `data?.alerts?.length ?? 0` to `unreadNotificationsCount`; `Topbar` gains `onOpenNotifications={() => handleSelectModule(MODULE_IDS.NOTIFICATIONS)}`; new branch `activeModule.id === MODULE_IDS.NOTIFICATIONS` renders `NotificationsPage` with all its props wired to the `notifications` hook result and a `handleNavigateFromNotification(moduleId, resourceId)` function that sets `activeModuleId`, sets `focusResource` (`{ flightId: resourceId }` for `flight-monitoring`, `{ operationId: resourceId }` for `approvals`, `null` for `reports`/anything else), and calls `sidebar.closeOverlay()`; `handleSelectModule` (existing, manual sidebar clicks) additionally resets `setFocusResource(null)`; the `FLIGHT_MONITORING` branch passes `focusFlightId={focusResource?.flightId}`, the `APPROVALS` branch passes `focusOperationId={focusResource?.operationId}`.
- `Topbar`: bell `<button>` gains `onClick={onOpenNotifications}` (only if the prop is provided — keep the prop optional so `Topbar.test.jsx`'s existing renders without it don't break); badge text becomes `notificationsCount > 99 ? '99+' : notificationsCount}` (spec §13).
- `DevPreviewPanel`: `STATE_BUTTONS` gains `{ state: 'notificationsEmpty', label: 'Notificaciones: sin datos' }` and `{ state: 'notificationsError', label: 'Notificaciones: error' }`.
- `FlightMonitoringPage`: `const [selectedFlightId, setSelectedFlightId] = useState(focusFlightId ?? null);` (was `useState(null)`).
- `ReviewPage`: `const [selectedOperationId, setSelectedOperationId] = useState(focusOperationId ?? null);` (was `useState(null)`).

- [ ] Extend `AppShell.test.jsx` (copy the existing `'switches to the Review module...'` test shape): switching to Notifications renders `NotificationsPage`'s heading; the sidebar badge shows the mock's unread count; clicking a notification's "Ver vuelo" navigates to Flight Monitoring **and** that flight is pre-selected (assert via whatever DOM the selected flight already exposes, e.g. the detail popover's flight number).
- [ ] Extend `Topbar.test.jsx`: clicking the bell calls `onOpenNotifications`; count `> 99` renders `'99+'`.
- [ ] Extend `FlightMonitoringPage.test.jsx` / `ReviewPage.test.jsx`: `focusFlightId`/`focusOperationId` prop pre-opens the right detail view.
- [ ] Implement all five files.
- [ ] Run `npm test`, `npm run build`, confirm both pass, commit.

---

## Self-review notes

- Spec coverage: header/KPIs (§1)→Task 6, filters incl. search (§2)→Task 6, feed/grouping (§3/§5)→Task 7, read/unread styling (§4)→Task 7, card actions incl. navigation (§6)→Task 7/9/10, detail drawer (§7)→Task 8, selection + bulk actions (§8)→Task 7/8, mark read/unread/all (§9/§10)→Task 9, settings drawer (§11)→Task 8, "prepared" realtime seam (§12)→Task 2/4 (`refresh()`), badge sync (§13)→Task 10, states (§14)→Task 5/9, pagination (§15) — **explicitly deferred**: the mock dataset is small (~12–16 records) and spec §15 itself says "si no existe [paginación], crear una solución reutilizable... preparar para API" — with this dataset size a client-side "cargar más" affordance would be decoration with nothing to paginate; flag this as a known gap rather than build unused plumbing, mocks (§16)→Task 2, API shape/services (§17)→Task 2, responsive (§18)→Task 8 drawer width note (desktop/tablet only, mobile "no es prioridad" per spec), components list (§19)→Tasks 5–9, microinteractions (§20)→covered by copying existing transition classnames throughout, routes/sidebar (§22)→Task 10 (module id already existed).
- No task references a type/function not defined in an earlier task; `focusFlightId`/`focusOperationId` prop names are consistent between the plan's Task 10 interface section and its file list.
