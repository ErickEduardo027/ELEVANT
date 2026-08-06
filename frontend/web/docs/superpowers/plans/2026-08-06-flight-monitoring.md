# Monitoreo de Vuelos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Monitoreo de Vuelos" module for ELEVANT's Administrador/OCC role: a real-time operations map (MapLibre GL JS) with a synchronized flight list, toolbar with filters/search, aircraft detail popover, collapsible legend, and toast alerts — all driven by mocked data shaped like the future AeroAPI-aligned contract, with a simulated live-update feed standing in for the eventual WebSocket/SignalR connection.

**Architecture:** A standalone feature under `src/features/flight-monitoring/`, following the exact pattern already established by `src/features/dashboard/` and `src/features/planning/`: a `FlightMonitoringPage` composed from small presentational components, fed by `useFlightMonitoringData` over a `flightMonitoringService.js` mock adapter. Client-side filtering lives in `useFlightMonitoringFilters`; toast-alert derivation lives in `useFlightAlerts`; pure data-shaping helpers live in `flightMonitoringMappers.js`. The map is a single imperative MapLibre GL instance wrapped by `FlightMap`, diffing markers by flight id instead of re-mounting on every update. The page is wired into the existing `AppShell.jsx` module switcher (`MODULE_IDS.FLIGHT_MONITORING` already exists), replacing today's `ModulePlaceholder` for that module. No router, one new dependency (`maplibre-gl`).

**Tech Stack:** React 18, Vite 6, Tailwind CSS 3 (existing tokens only), Vitest + React Testing Library + jsdom (already configured), MapLibre GL JS (new dependency, mocked in tests).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-06-flight-monitoring-design.md` — follow it exactly for scope, layout, and component boundaries.
- Reuse existing components/utilities instead of duplicating: `StatusBadge` (`src/features/dashboard/components/StatusBadge.jsx`), `STATUS_COLORS`/`getStatusMeta`/`FLIGHT_STATUS_META` (`src/features/dashboard/statusMeta.js`), `formatClockTime` (`src/features/dashboard/mappers.js`), icons already defined in `src/features/dashboard/components/icons/index.jsx` (`AlertTriangleIcon`, `RefreshCwIcon`, `ChevronDownIcon`, `MapPinIcon`, `PlaneIcon`), and `RadarIcon` from `src/features/shell/components/icons.jsx`. Cross-feature imports of dashboard/shell utilities are an established pattern in this codebase — do not recreate them under `flight-monitoring/`.
- Only create new icons for what doesn't already exist: `SearchIcon`, `XIcon`, `CrosshairIcon`, `RotateCcwIcon`, under `src/features/flight-monitoring/components/icons.jsx`, same hand-made line style (stroke ~1.7, viewBox `0 0 24 24`, `aria-hidden="true"`) as every existing icon set in this repo.
- Color tokens (exact hex, do not introduce any other color): `ink-900` `#0B1F3F`, `accent-600` `#145DC4`, `signal-500` `#F2661E`; light bg `#F7F9FB` / card `#FFFFFF` / text primary `#0B1F3F` / text secondary `#6B7684`; dark bg `#0A1220` / card `rgba(11,31,63,0.55)` / text primary `#F4F6F9` / text secondary `#94A3B8`; status info `#145DC4`, active `#F2661E`, success `#1E9E6B`, warning `#D9A441`, danger `#C4453C`.
- Typography: Inter for UI/body/headings; IBM Plex Mono (`font-mono`) for flight numbers, timestamps, coordinates/altitude/speed/heading figures.
- Dark mode via existing Tailwind `class` strategy — every new component needs `dark:` variants matching existing conventions. MapLibre's own style (not Tailwind) handles the map's light/dark look, swapped imperatively in `FlightMap`.
- All UI text is Spanish. Zero emojis anywhere. No decorative iconography — only the hand-made line icons.
- No router, no real API/WebSocket calls — mocked data and a simulated update loop only, shaped like the contract documented in the spec.
- "Ver planificación" / "Ver mapa de posiciones" buttons in the popover are rendered **disabled** with `title="Próximamente"` — confirmed out of scope for this plan.
- Flight ids in this feature's mock contract are **numbers** (per the spec's AeroAPI-aligned example, e.g. `id: 15`), unlike Planning's string ids (`'flt-1'`) — do not mix the two conventions across tasks.
- Time-based logic that needs "now" (countdown, forced preview states) must take `now`/`nowIso` as an explicit parameter, never call `Date.now()`/`new Date()` internally in a way that breaks deterministic testing — the one exception is `FlightMonitoringPage`'s own `now` state, seeded once via `useState(() => new Date().toISOString())` and ticked by a `setInterval`, exactly like Planning's `PlanningPage` already does.
- `formatClockTime` renders in the *test runner's* local timezone (no explicit `timeZone` option) — never assert its exact output string in a new test; assert other fields, or match a loose `/\d{2}:\d{2}/` pattern if you must confirm a clock renders at all. This mirrors how the existing `FlightCard.test.jsx` avoids asserting exact clock text.
- `maplibre-gl` cannot run in jsdom (no WebGL). Every test that touches `FlightMap.jsx` must `vi.mock('maplibre-gl', ...)` with fake `Map`/`Marker`/`NavigationControl` classes — never attempt to render a real MapLibre instance in a test.

---

## Task 1: Extend `statusMeta.js` with the Monitoring flight statuses

**Files:**
- Modify: `src/features/dashboard/statusMeta.js`
- Modify: `src/features/dashboard/statusMeta.test.js`

**Interfaces:**
- Produces: `FLIGHT_STATUS_META` gains keys `leftGate`, `approaching`, `taxiingToGate`, `unknown` alongside its existing `scheduled`, `boarding`, `taxiing`, `enRoute`, `landed`, `arrived`, `delayed`, `diverted`, `cancelled`. `getStatusMeta('flight', <newKey>)` returns `{ label, color }` for each. No existing key's label/color changes.

- [ ] **Step 1: Write the failing test**

Add to `src/features/dashboard/statusMeta.test.js` (inside the existing `describe('getStatusMeta', ...)` block, after the last `it`):

```js
  it('maps the Flight Monitoring statuses to label and color', () => {
    expect(getStatusMeta('flight', 'leftGate')).toEqual({ label: 'Salió de puerta', color: 'active' });
    expect(getStatusMeta('flight', 'approaching')).toEqual({ label: 'Aproximando', color: 'active' });
    expect(getStatusMeta('flight', 'taxiingToGate')).toEqual({ label: 'Rodaje a puerta', color: 'active' });
    expect(getStatusMeta('flight', 'unknown')).toEqual({ label: 'Desconocido', color: 'info' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- statusMeta`
Expected: FAIL — `leftGate`/`approaching`/`taxiingToGate`/`unknown` are undefined, so `getStatusMeta` falls back to `{ label: status, color: 'info' }`.

- [ ] **Step 3: Add the new keys**

In `src/features/dashboard/statusMeta.js`, replace the `FLIGHT_STATUS_META` object with:

```js
export const FLIGHT_STATUS_META = {
  scheduled: { label: 'Programado', color: 'info' },
  boarding: { label: 'Abordando', color: 'active' },
  taxiing: { label: 'Rodaje', color: 'active' },
  leftGate: { label: 'Salió de puerta', color: 'active' },
  enRoute: { label: 'En ruta', color: 'active' },
  approaching: { label: 'Aproximando', color: 'active' },
  landed: { label: 'Aterrizado', color: 'success' },
  taxiingToGate: { label: 'Rodaje a puerta', color: 'active' },
  arrived: { label: 'En posición', color: 'success' },
  delayed: { label: 'Retrasado', color: 'warning' },
  diverted: { label: 'Desviado', color: 'danger' },
  cancelled: { label: 'Cancelado', color: 'danger' },
  unknown: { label: 'Desconocido', color: 'info' },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- statusMeta`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/statusMeta.js src/features/dashboard/statusMeta.test.js
git commit -m "feat: extend flight status metadata for Flight Monitoring module"
```

---

## Task 2: `flightMonitoringMappers.js`

**Files:**
- Create: `src/features/flight-monitoring/flightMonitoringMappers.js`
- Test: `src/features/flight-monitoring/flightMonitoringMappers.test.js`

**Interfaces:**
- Produces: `PUJ_COORDINATES: { latitude: 18.5674, longitude: -68.3634 }`, `isStationRelated(flight, stationCode?) => boolean`, `extractDateFromIso(iso: string) => string`, `FLIGHT_FILTER_CHIPS: Array<{ id: string, label: string }>`, `matchesChip(flight, chipId: string) => boolean`, `getFilterOptions(flights) => { dates, airlines, statuses, origins, destinations }` (each a deduplicated, sorted array of strings), `formatRemaining(etaIso: string, nowIso: string) => string`. Consumed by `useFlightMonitoringFilters` (Task 5), `FlightMap`/marker builders (Tasks 10, 11), `FlightToolbar`/`FlightFilterChips`/`FlightDetailPopover` (Tasks 8, 9, 13), `FlightMonitoringPage` (Task 18).

- [ ] **Step 1: Write the failing tests**

Create `src/features/flight-monitoring/flightMonitoringMappers.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  PUJ_COORDINATES,
  isStationRelated,
  extractDateFromIso,
  FLIGHT_FILTER_CHIPS,
  matchesChip,
  getFilterOptions,
  formatRemaining,
} from './flightMonitoringMappers';

function flight(overrides) {
  return {
    id: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    status: 'approaching',
    eta: '2026-08-06T14:20:00-04:00',
    ...overrides,
  };
}

describe('PUJ_COORDINATES', () => {
  it('is the fixed coordinate pair for Punta Cana International Airport', () => {
    expect(PUJ_COORDINATES).toEqual({ latitude: 18.5674, longitude: -68.3634 });
  });
});

describe('isStationRelated', () => {
  it('is true when the flight originates at the station', () => {
    expect(isStationRelated(flight({ origin: 'PUJ', destination: 'JFK' }))).toBe(true);
  });

  it('is true when the flight lands at the station', () => {
    expect(isStationRelated(flight({ origin: 'MIA', destination: 'PUJ' }))).toBe(true);
  });

  it('is false when neither origin nor destination is the station', () => {
    expect(isStationRelated(flight({ origin: 'MIA', destination: 'JFK' }))).toBe(false);
  });
});

describe('extractDateFromIso', () => {
  it('extracts the YYYY-MM-DD prefix regardless of timezone offset', () => {
    expect(extractDateFromIso('2026-08-06T23:59:00-04:00')).toBe('2026-08-06');
  });
});

describe('matchesChip', () => {
  it('matches everything for the "all" chip', () => {
    expect(matchesChip(flight({ status: 'cancelled' }), 'all')).toBe(true);
  });

  it('groups en-route-family statuses under the "enRoute" chip', () => {
    expect(matchesChip(flight({ status: 'approaching' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'taxiing' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'leftGate' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'taxiingToGate' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'delayed' }), 'enRoute')).toBe(false);
  });

  it('groups landed and arrived under the "landed" chip', () => {
    expect(matchesChip(flight({ status: 'landed' }), 'landed')).toBe(true);
    expect(matchesChip(flight({ status: 'arrived' }), 'landed')).toBe(true);
    expect(matchesChip(flight({ status: 'scheduled' }), 'landed')).toBe(false);
  });

  it('is a strict 1:1 match for chips without a group', () => {
    expect(matchesChip(flight({ status: 'delayed' }), 'delayed')).toBe(true);
    expect(matchesChip(flight({ status: 'scheduled' }), 'delayed')).toBe(false);
  });

  it('exposes exactly the seven chips from the brief, in order', () => {
    expect(FLIGHT_FILTER_CHIPS.map(chip => chip.id)).toEqual([
      'all',
      'scheduled',
      'enRoute',
      'delayed',
      'landed',
      'cancelled',
      'diverted',
    ]);
  });
});

describe('getFilterOptions', () => {
  it('returns deduplicated, sorted option lists per dimension', () => {
    const flights = [
      flight({ airline: 'Arajet', status: 'approaching', origin: 'MIA', destination: 'PUJ' }),
      flight({ airline: 'American', status: 'delayed', origin: 'PUJ', destination: 'MIA' }),
      flight({ airline: 'Arajet', status: 'approaching', origin: 'MIA', destination: 'PUJ' }),
    ];
    const options = getFilterOptions(flights);
    expect(options.airlines).toEqual(['American', 'Arajet']);
    expect(options.statuses).toEqual(['approaching', 'delayed']);
    expect(options.origins).toEqual(['MIA', 'PUJ']);
    expect(options.destinations).toEqual(['MIA', 'PUJ']);
  });
});

describe('formatRemaining', () => {
  it('shows a future countdown in minutes', () => {
    expect(formatRemaining('2026-08-06T08:05:00-04:00', '2026-08-06T07:20:00-04:00')).toBe('En 45 min');
  });

  it('shows an elapsed countdown in minutes', () => {
    expect(formatRemaining('2026-08-06T08:05:00-04:00', '2026-08-06T08:50:00-04:00')).toBe('Hace 45 min');
  });

  it('shows "Ahora" when eta matches now', () => {
    expect(formatRemaining('2026-08-06T08:05:00-04:00', '2026-08-06T08:05:00-04:00')).toBe('Ahora');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- flightMonitoringMappers`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `flightMonitoringMappers.js`**

Create `src/features/flight-monitoring/flightMonitoringMappers.js`:

```js
export const PUJ_COORDINATES = { latitude: 18.5674, longitude: -68.3634 };

export function isStationRelated(flight, stationCode = 'PUJ') {
  return flight.origin === stationCode || flight.destination === stationCode;
}

export function extractDateFromIso(iso) {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export const FLIGHT_FILTER_CHIPS = [
  { id: 'all', label: 'Todos' },
  { id: 'scheduled', label: 'Programados' },
  { id: 'enRoute', label: 'En ruta' },
  { id: 'delayed', label: 'Retrasados' },
  { id: 'landed', label: 'Aterrizados' },
  { id: 'cancelled', label: 'Cancelados' },
  { id: 'diverted', label: 'Desviados' },
];

const CHIP_STATUS_GROUPS = {
  scheduled: ['scheduled'],
  enRoute: ['enRoute', 'approaching', 'taxiing', 'leftGate', 'taxiingToGate'],
  delayed: ['delayed'],
  landed: ['landed', 'arrived'],
  cancelled: ['cancelled'],
  diverted: ['diverted'],
};

export function matchesChip(flight, chipId) {
  if (chipId === 'all') return true;
  const statuses = CHIP_STATUS_GROUPS[chipId];
  return statuses ? statuses.includes(flight.status) : true;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function getFilterOptions(flights) {
  return {
    dates: uniqueSorted(flights.map(flight => extractDateFromIso(flight.eta))),
    airlines: uniqueSorted(flights.map(flight => flight.airline)),
    statuses: uniqueSorted(flights.map(flight => flight.status)),
    origins: uniqueSorted(flights.map(flight => flight.origin)),
    destinations: uniqueSorted(flights.map(flight => flight.destination)),
  };
}

export function formatRemaining(etaIso, nowIso) {
  const diffMinutes = Math.round((new Date(etaIso).getTime() - new Date(nowIso).getTime()) / 60000);
  if (diffMinutes === 0) return 'Ahora';
  if (diffMinutes > 0) return `En ${diffMinutes} min`;
  return `Hace ${Math.abs(diffMinutes)} min`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- flightMonitoringMappers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/flightMonitoringMappers.js src/features/flight-monitoring/flightMonitoringMappers.test.js
git commit -m "feat: add flightMonitoringMappers data-shaping helpers"
```

---

## Task 3: `flightMonitoringService.js` mock adapter

**Files:**
- Create: `src/services/flightMonitoringService.js`
- Test: `src/services/flightMonitoringService.test.js`

**Interfaces:**
- Produces: `getFlightMonitoringSnapshot(stationCode?: string) => Promise<{ station: { code, localAbbr }, flights: Flight[] }>` where each `Flight` has `{ id: number, flightNumber, airline, origin, destination, registration, aircraft, status, eta, etd, actualArrival, actualDeparture, stand, supervisor, agents: number, heading, speed, altitude, latitude, longitude, services: string[] }`, matching the design spec's AeroAPI-aligned contract; `subscribeToFlightUpdates(onUpdate: (update: { id, latitude, longitude, heading, speed, altitude }) => void) => () => void` (unsubscribe); `nudgePosition(flight: { latitude, longitude, heading }, headingJitterDegrees?: number) => { latitude, longitude, heading }` (exported for direct unit testing of the movement math). Consumed by `useFlightMonitoringData` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/services/flightMonitoringService.test.js`:

```js
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getFlightMonitoringSnapshot, subscribeToFlightUpdates, nudgePosition } from './flightMonitoringService';

describe('getFlightMonitoringSnapshot', () => {
  it('resolves with a station and a flights array shaped like the documented AeroAPI-aligned contract', async () => {
    const snapshot = await getFlightMonitoringSnapshot();
    expect(snapshot.station).toEqual({ code: 'PUJ', localAbbr: 'AST' });
    expect(snapshot.flights.length).toBe(17);
    for (const flight of snapshot.flights) {
      expect(flight).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          flightNumber: expect.any(String),
          airline: expect.any(String),
          origin: expect.any(String),
          destination: expect.any(String),
          registration: expect.any(String),
          aircraft: expect.any(String),
          status: expect.any(String),
          eta: expect.any(String),
          etd: expect.any(String),
          actualArrival: null,
          actualDeparture: null,
          agents: expect.any(Number),
          heading: expect.any(Number),
          speed: expect.any(Number),
          altitude: expect.any(Number),
          latitude: expect.any(Number),
          longitude: expect.any(Number),
          services: expect.any(Array),
        })
      );
    }
  });

  it('reflects the requested station code', async () => {
    const snapshot = await getFlightMonitoringSnapshot('MDT');
    expect(snapshot.station.code).toBe('MDT');
  });

  it('covers every supported flight status at least once', async () => {
    const snapshot = await getFlightMonitoringSnapshot();
    const statuses = new Set(snapshot.flights.map(flight => flight.status));
    [
      'scheduled', 'taxiing', 'leftGate', 'enRoute', 'delayed', 'approaching',
      'landed', 'taxiingToGate', 'arrived', 'cancelled', 'diverted', 'unknown',
    ].forEach(status => expect(statuses.has(status)).toBe(true));
  });

  it('includes at least one flight unrelated to the station, to exercise the "only PUJ" toggle', async () => {
    const snapshot = await getFlightMonitoringSnapshot();
    const unrelated = snapshot.flights.filter(flight => flight.origin !== 'PUJ' && flight.destination !== 'PUJ');
    expect(unrelated.length).toBeGreaterThan(0);
  });
});

describe('nudgePosition', () => {
  it('moves the flight along its heading by a fixed step and applies the heading jitter', () => {
    const result = nudgePosition({ latitude: 18, longitude: -68, heading: 0 }, 0);
    expect(result.latitude).toBeCloseTo(18.02, 5);
    expect(result.longitude).toBeCloseTo(-68, 5);
    expect(result.heading).toBe(0);
  });

  it('wraps the heading into [0, 360)', () => {
    const result = nudgePosition({ latitude: 18, longitude: -68, heading: 358 }, 5);
    expect(result.heading).toBe(3);
  });
});

describe('subscribeToFlightUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits a position update for every movement-eligible flight on each tick', () => {
    const onUpdate = vi.fn();
    subscribeToFlightUpdates(onUpdate);

    vi.advanceTimersByTime(4000);

    const updatedIds = onUpdate.mock.calls.map(([update]) => update.id).sort((a, b) => a - b);
    // Flights 1 (approaching), 4 (leftGate), 6 (taxiing), 10 & 17 (enRoute), 13 (taxiingToGate).
    expect(updatedIds).toEqual([1, 4, 6, 10, 13, 17]);
  });

  it('never emits updates for a cancelled or scheduled flight', () => {
    const onUpdate = vi.fn();
    subscribeToFlightUpdates(onUpdate);

    vi.advanceTimersByTime(4000);

    const updatedIds = onUpdate.mock.calls.map(([update]) => update.id);
    expect(updatedIds).not.toContain(9); // cancelled
    expect(updatedIds).not.toContain(3); // scheduled
  });

  it('stops emitting once unsubscribed', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeToFlightUpdates(onUpdate);
    unsubscribe();

    vi.advanceTimersByTime(8000);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- flightMonitoringService`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `flightMonitoringService.js`**

Create `src/services/flightMonitoringService.js`:

```js
function getOperationDate() {
  return new Date().toISOString().slice(0, 10);
}

const FLIGHT_TEMPLATES = [
  { id: 1, flightNumber: 'DM161', airline: 'Arajet', origin: 'MIA', destination: 'PUJ', registration: 'HI1024', aircraft: 'B737 MAX 8', status: 'approaching', etaHour: 14, etaMinute: 20, etdHour: 15, etdMinute: 5, stand: 'A5', supervisor: 'Juan Pérez', agents: 5, heading: 310, speed: 250, altitude: 8000, latitude: 18.7, longitude: -68.5, services: ['GPU', 'Baggage', 'Cleaning'] },
  { id: 2, flightNumber: 'AA904', airline: 'American', origin: 'PUJ', destination: 'MIA', registration: 'N904AA', aircraft: 'B737-800', status: 'delayed', etaHour: 8, etaMinute: 20, etdHour: 8, etdMinute: 50, stand: 'B21', supervisor: 'K. Objío', agents: 3, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 3, flightNumber: 'DL2210', airline: 'Delta', origin: 'MIA', destination: 'PUJ', registration: 'N2210DL', aircraft: 'A321neo', status: 'scheduled', etaHour: 9, etaMinute: 10, etdHour: 9, etdMinute: 45, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 25.79, longitude: -80.29, services: [] },
  { id: 4, flightNumber: 'B6289', airline: 'JetBlue', origin: 'PUJ', destination: 'JFK', registration: 'N289JB', aircraft: 'A320', status: 'leftGate', etaHour: 9, etaMinute: 40, etdHour: 9, etdMinute: 45, stand: 'A1', supervisor: 'M. Castillo', agents: 4, heading: 45, speed: 15, altitude: 0, latitude: 18.568, longitude: -68.362, services: ['Baggage'] },
  { id: 5, flightNumber: 'UA1470', airline: 'United', origin: 'PUJ', destination: 'EWR', registration: 'N1470UA', aircraft: 'A330', status: 'scheduled', etaHour: 10, etaMinute: 0, etdHour: 10, etdMinute: 5, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 6, flightNumber: 'AC1876', airline: 'Air Canada', origin: 'PUJ', destination: 'YYZ', registration: 'C-1876AC', aircraft: 'A320', status: 'taxiing', etaHour: 10, etaMinute: 20, etdHour: 10, etdMinute: 25, stand: 'A5', supervisor: 'J. Ramírez', agents: 2, heading: 270, speed: 12, altitude: 0, latitude: 18.567, longitude: -68.365, services: ['Fuel'] },
  { id: 7, flightNumber: 'CM345', airline: 'Copa', origin: 'PTY', destination: 'PUJ', registration: 'HP-345CM', aircraft: 'B737 MAX 8', status: 'arrived', etaHour: 10, etaMinute: 40, etdHour: 11, etdMinute: 15, stand: 'BN8', supervisor: 'K. Objío', agents: 5, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: ['Deplaning', 'Baggage'] },
  { id: 8, flightNumber: 'WG654', airline: 'Sunwing', origin: 'PUJ', destination: 'YYZ', registration: 'C-654WG', aircraft: 'A321neo', status: 'scheduled', etaHour: 11, etaMinute: 0, etdHour: 11, etdMinute: 5, stand: 'B32', supervisor: 'M. Castillo', agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 9, flightNumber: 'B6812', airline: 'JetBlue', origin: 'PUJ', destination: 'BOS', registration: 'N812JB', aircraft: 'A320', status: 'cancelled', etaHour: 11, etaMinute: 20, etdHour: 11, etdMinute: 25, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 10, flightNumber: 'AA123', airline: 'American', origin: 'PUJ', destination: 'MIA', registration: 'N123AA', aircraft: 'B737-800', status: 'enRoute', etaHour: 11, etaMinute: 40, etdHour: 11, etdMinute: 45, stand: null, supervisor: 'J. Ramírez', agents: 3, heading: 315, speed: 430, altitude: 32000, latitude: 21.5, longitude: -72.8, services: [] },
  { id: 11, flightNumber: 'DL879', airline: 'Delta', origin: 'ATL', destination: 'PUJ', registration: 'N879DL', aircraft: 'B787', status: 'delayed', etaHour: 12, etaMinute: 0, etdHour: 12, etdMinute: 35, stand: 'B21', supervisor: 'R. Peña', agents: 2, heading: 150, speed: 470, altitude: 35000, latitude: 24.1, longitude: -75.3, services: [] },
  { id: 12, flightNumber: 'TS234', airline: 'Air Transat', origin: 'PUJ', destination: 'YUL', registration: 'C-234TS', aircraft: 'A330', status: 'diverted', etaHour: 12, etaMinute: 20, etdHour: 12, etdMinute: 25, stand: null, supervisor: null, agents: 0, heading: 20, speed: 460, altitude: 34000, latitude: 20.1, longitude: -69.9, services: [] },
  { id: 13, flightNumber: 'DM220', airline: 'Arajet', origin: 'PUJ', destination: 'SDQ', registration: 'HI1220', aircraft: 'A320', status: 'taxiingToGate', etaHour: 12, etaMinute: 40, etdHour: 13, etdMinute: 15, stand: 'A5', supervisor: 'K. Objío', agents: 3, heading: 180, speed: 10, altitude: 0, latitude: 18.566, longitude: -68.361, services: ['Baggage'] },
  { id: 14, flightNumber: 'B6417', airline: 'JetBlue', origin: 'JFK', destination: 'PUJ', registration: 'N417JB', aircraft: 'B787', status: 'landed', etaHour: 13, etaMinute: 0, etdHour: 13, etdMinute: 45, stand: 'BN8', supervisor: 'J. Ramírez', agents: 4, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: ['Deplaning'] },
  { id: 15, flightNumber: 'UA987', airline: 'United', origin: 'SJU', destination: 'PUJ', registration: 'N987UA', aircraft: 'A321neo', status: 'unknown', etaHour: 13, etaMinute: 20, etdHour: 13, etdMinute: 55, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.4, longitude: -66.1, services: [] },
  { id: 16, flightNumber: 'AA455', airline: 'American', origin: 'MIA', destination: 'PUJ', registration: 'N455AA', aircraft: 'B737 MAX 8', status: 'scheduled', etaHour: 13, etaMinute: 40, etdHour: 14, etdMinute: 15, stand: 'A5', supervisor: 'M. Castillo', agents: 3, heading: 0, speed: 0, altitude: 0, latitude: 25.79, longitude: -80.29, services: [] },
  { id: 17, flightNumber: 'AA100', airline: 'American', origin: 'MIA', destination: 'JFK', registration: 'N100AA', aircraft: 'A321neo', status: 'enRoute', etaHour: 12, etaMinute: 0, etdHour: 12, etdMinute: 5, stand: null, supervisor: null, agents: 0, heading: 45, speed: 460, altitude: 33000, latitude: 27.5, longitude: -76.0, services: [] },
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildFlight(template, dateISO) {
  return {
    id: template.id,
    flightNumber: template.flightNumber,
    airline: template.airline,
    origin: template.origin,
    destination: template.destination,
    registration: template.registration,
    aircraft: template.aircraft,
    status: template.status,
    eta: `${dateISO}T${pad(template.etaHour)}:${pad(template.etaMinute)}:00-04:00`,
    etd: `${dateISO}T${pad(template.etdHour)}:${pad(template.etdMinute)}:00-04:00`,
    actualArrival: null,
    actualDeparture: null,
    stand: template.stand,
    supervisor: template.supervisor,
    agents: template.agents,
    heading: template.heading,
    speed: template.speed,
    altitude: template.altitude,
    latitude: template.latitude,
    longitude: template.longitude,
    services: template.services,
  };
}

export async function getFlightMonitoringSnapshot(stationCode = 'PUJ') {
  const dateISO = getOperationDate();
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    flights: FLIGHT_TEMPLATES.map(template => buildFlight(template, dateISO)),
  };
}

const ACTIVE_MOVEMENT_STATUSES = ['enRoute', 'approaching', 'taxiing', 'leftGate', 'taxiingToGate'];
const NUDGE_INTERVAL_MS = 4000;
const NUDGE_STEP_DEGREES = 0.02;

export function nudgePosition(flight, headingJitterDegrees = 0) {
  const headingRad = (flight.heading * Math.PI) / 180;
  return {
    latitude: flight.latitude + Math.cos(headingRad) * NUDGE_STEP_DEGREES,
    longitude: flight.longitude + Math.sin(headingRad) * NUDGE_STEP_DEGREES,
    heading: (flight.heading + headingJitterDegrees + 360) % 360,
  };
}

export function subscribeToFlightUpdates(onUpdate) {
  const dateISO = getOperationDate();
  const simulatedFlights = FLIGHT_TEMPLATES.map(template => buildFlight(template, dateISO));

  const intervalId = setInterval(() => {
    simulatedFlights
      .filter(flight => ACTIVE_MOVEMENT_STATUSES.includes(flight.status))
      .forEach(flight => {
        const jitter = Math.random() * 6 - 3;
        const nudged = nudgePosition(flight, jitter);
        flight.latitude = nudged.latitude;
        flight.longitude = nudged.longitude;
        flight.heading = nudged.heading;
        onUpdate({
          id: flight.id,
          latitude: flight.latitude,
          longitude: flight.longitude,
          heading: flight.heading,
          speed: flight.speed,
          altitude: flight.altitude,
        });
      });
  }, NUDGE_INTERVAL_MS);

  return () => clearInterval(intervalId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- flightMonitoringService`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/flightMonitoringService.js src/services/flightMonitoringService.test.js
git commit -m "feat: add flightMonitoringService mock adapter with simulated live updates"
```

---

## Task 4: `useFlightMonitoringData` hook

**Files:**
- Create: `src/features/flight-monitoring/useFlightMonitoringData.js`
- Test: `src/features/flight-monitoring/useFlightMonitoringData.test.js`

**Interfaces:**
- Consumes: `getFlightMonitoringSnapshot(stationCode)`, `subscribeToFlightUpdates(onUpdate)` from Task 3.
- Produces: `useFlightMonitoringData(stationCode?: string, refreshToken?: number) => { status: 'loading'|'success'|'error', data: Snapshot|null, error: Error|null, connection: 'syncing'|'connected'|'disconnected', lastUpdatedAt: string|null }`. Consumed by `AppShell` (Task 20), which passes these fields down to `FlightMonitoringPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/useFlightMonitoringData.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFlightMonitoringData } from './useFlightMonitoringData';
import * as flightMonitoringService from '../../services/flightMonitoringService';

describe('useFlightMonitoringData', () => {
  it('starts in loading/syncing state then resolves to success/connected', async () => {
    const snapshot = { station: { code: 'PUJ' }, flights: [{ id: 1, latitude: 18, longitude: -68 }] };
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});

    const { result } = renderHook(() => useFlightMonitoringData('PUJ'));
    expect(result.current.status).toBe('loading');
    expect(result.current.connection).toBe('syncing');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual(snapshot);
    expect(result.current.connection).toBe('connected');
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  it('moves to error/disconnected when the snapshot fetch rejects', async () => {
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useFlightMonitoringData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.connection).toBe('disconnected');
    expect(result.current.data).toBeNull();
  });

  it('merges an incoming update into the matching flight by id, leaving others untouched', async () => {
    const snapshot = {
      station: { code: 'PUJ' },
      flights: [
        { id: 1, latitude: 18, longitude: -68, heading: 90 },
        { id: 2, latitude: 20, longitude: -70, heading: 45 },
      ],
    };
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue(snapshot);
    let emitUpdate;
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockImplementation(onUpdate => {
      emitUpdate = onUpdate;
      return () => {};
    });

    const { result } = renderHook(() => useFlightMonitoringData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => emitUpdate({ id: 1, latitude: 18.02, longitude: -68, heading: 91 }));

    await waitFor(() => expect(result.current.data.flights[0].latitude).toBe(18.02));
    expect(result.current.data.flights[1]).toEqual(snapshot.flights[1]);
  });

  it('re-fetches when refreshToken changes', async () => {
    const spy = vi
      .spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot')
      .mockResolvedValue({ station: { code: 'PUJ' }, flights: [] });
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});

    const { rerender } = renderHook(({ token }) => useFlightMonitoringData('PUJ', token), {
      initialProps: { token: 0 },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useFlightMonitoringData`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `useFlightMonitoringData.js`**

Create `src/features/flight-monitoring/useFlightMonitoringData.js`:

```js
import { useEffect, useState } from 'react';
import { getFlightMonitoringSnapshot, subscribeToFlightUpdates } from '../../services/flightMonitoringService';

function mergeUpdate(flights, update) {
  return flights.map(flight => (flight.id === update.id ? { ...flight, ...update } : flight));
}

export function useFlightMonitoringData(stationCode = 'PUJ', refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [connection, setConnection] = useState('syncing');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    setConnection('syncing');

    getFlightMonitoringSnapshot(stationCode)
      .then(data => {
        if (cancelled) return;
        setState({ status: 'success', data, error: null });
        setConnection('connected');
        setLastUpdatedAt(new Date().toISOString());
      })
      .catch(error => {
        if (cancelled) return;
        setState({ status: 'error', data: null, error });
        setConnection('disconnected');
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode, refreshToken]);

  useEffect(() => {
    if (state.status !== 'success') return undefined;

    const unsubscribe = subscribeToFlightUpdates(update => {
      setState(current =>
        current.data
          ? { ...current, data: { ...current.data, flights: mergeUpdate(current.data.flights, update) } }
          : current
      );
      setLastUpdatedAt(new Date().toISOString());
    });

    return unsubscribe;
  }, [state.status]);

  return { status: state.status, data: state.data, error: state.error, connection, lastUpdatedAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useFlightMonitoringData`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/useFlightMonitoringData.js src/features/flight-monitoring/useFlightMonitoringData.test.js
git commit -m "feat: add useFlightMonitoringData hook with simulated live merge"
```

---

## Task 5: `useFlightAlerts` hook

**Files:**
- Create: `src/features/flight-monitoring/useFlightAlerts.js`
- Test: `src/features/flight-monitoring/useFlightAlerts.test.js`

**Interfaces:**
- Produces: `useFlightAlerts(flights: Flight[], connection?: 'connected'|'syncing'|'disconnected') => { toasts: Array<{ id: string, kind: 'delayed'|'cancelled'|'diverted'|'error', message: string, flightNumber?: string }>, dismissToast: (id: string) => void }`. Diffs `flights` against the previous render by `id`; a change in `status` to `delayed`/`cancelled`/`diverted`, a change in `eta`, or `stand` becoming `null` (having previously been set) enqueues one toast. Separately, a transition of `connection` *into* `'disconnected'` (not merely being disconnected on first render) enqueues one `kind: 'error'` toast — the spec's "Error FlyAware" alert case. Every toast auto-dismisses after 6s and the queue is capped at the 3 most recent. Consumed by `FlightMonitoringPage` (Task 19), which passes `toasts`/`dismissToast` to `FlightToastStack` (Task 16).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/useFlightAlerts.test.js`:

```js
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlightAlerts } from './useFlightAlerts';

function flight(overrides) {
  return { id: 1, flightNumber: 'DM161', status: 'scheduled', eta: '2026-08-06T08:00:00-04:00', stand: 'A5', ...overrides };
}

describe('useFlightAlerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues no toasts on the first render (nothing to diff against yet)', () => {
    const { result } = renderHook(() => useFlightAlerts([flight()]));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('enqueues a toast when a flight becomes delayed', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ status: 'scheduled' })] },
    });

    rerender({ flights: [flight({ status: 'delayed' })] });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toEqual(
      expect.objectContaining({ kind: 'delayed', flightNumber: 'DM161' })
    );
  });

  it('enqueues a toast when the eta changes', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ eta: '2026-08-06T08:00:00-04:00' })] },
    });

    rerender({ flights: [flight({ eta: '2026-08-06T08:30:00-04:00' })] });

    expect(result.current.toasts).toHaveLength(1);
  });

  it('enqueues a toast when the stand is lost', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ stand: 'A5' })] },
    });

    rerender({ flights: [flight({ stand: null })] });

    expect(result.current.toasts).toHaveLength(1);
  });

  it('caps visible toasts at 3, keeping the most recent', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: {
        flights: [
          flight({ id: 1, status: 'scheduled' }),
          flight({ id: 2, status: 'scheduled' }),
          flight({ id: 3, status: 'scheduled' }),
          flight({ id: 4, status: 'scheduled' }),
        ],
      },
    });

    rerender({
      flights: [
        flight({ id: 1, status: 'delayed' }),
        flight({ id: 2, status: 'cancelled' }),
        flight({ id: 3, status: 'diverted' }),
        flight({ id: 4, status: 'cancelled' }),
      ],
    });

    expect(result.current.toasts).toHaveLength(3);
  });

  it('auto-dismisses a toast after 6 seconds', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ status: 'scheduled' })] },
    });

    rerender({ flights: [flight({ status: 'delayed' })] });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('dismissToast removes a toast immediately', () => {
    const { result, rerender } = renderHook(({ flights }) => useFlightAlerts(flights), {
      initialProps: { flights: [flight({ status: 'scheduled' })] },
    });

    rerender({ flights: [flight({ status: 'delayed' })] });
    const id = result.current.toasts[0].id;

    act(() => result.current.dismissToast(id));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('enqueues one error toast when the connection transitions into disconnected', () => {
    const { result, rerender } = renderHook(({ connection }) => useFlightAlerts([flight()], connection), {
      initialProps: { connection: 'connected' },
    });
    expect(result.current.toasts).toHaveLength(0);

    rerender({ connection: 'disconnected' });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].kind).toBe('error');
  });

  it('does not enqueue an error toast when connection starts out disconnected on the very first render', () => {
    const { result } = renderHook(() => useFlightAlerts([flight()], 'disconnected'));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('does not re-enqueue while connection stays disconnected across renders', () => {
    const { result, rerender } = renderHook(({ connection }) => useFlightAlerts([flight()], connection), {
      initialProps: { connection: 'connected' },
    });

    rerender({ connection: 'disconnected' });
    expect(result.current.toasts).toHaveLength(1);

    rerender({ connection: 'disconnected' });
    expect(result.current.toasts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useFlightAlerts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `useFlightAlerts.js`**

Create `src/features/flight-monitoring/useFlightAlerts.js`:

```js
import { useEffect, useRef, useState } from 'react';

const MAX_VISIBLE_TOASTS = 3;
const TOAST_TTL_MS = 6000;
const ALERT_LABELS = { delayed: 'retrasado', cancelled: 'cancelado', diverted: 'desviado' };

function buildAlert(previous, next) {
  if (previous.status !== next.status && ALERT_LABELS[next.status]) {
    return { kind: next.status, message: `Vuelo ${next.flightNumber} ${ALERT_LABELS[next.status]}` };
  }
  if (previous.eta !== next.eta) {
    return { kind: 'delayed', message: `Vuelo ${next.flightNumber} cambió su ETA` };
  }
  if (previous.stand && !next.stand) {
    return { kind: 'diverted', message: `Vuelo ${next.flightNumber} sin stand asignado` };
  }
  return null;
}

export function useFlightAlerts(flights, connection) {
  const previousRef = useRef(new Map());
  const idCounterRef = useRef(0);
  const mountedRef = useRef(true);
  const previousConnectionRef = useRef(connection);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function enqueueToast(id, toast) {
    setToasts(current => [...current, { id, ...toast }].slice(-MAX_VISIBLE_TOASTS));
    setTimeout(() => {
      if (mountedRef.current) setToasts(current => current.filter(existing => existing.id !== id));
    }, TOAST_TTL_MS);
  }

  useEffect(() => {
    const previous = previousRef.current;
    const next = new Map();

    flights.forEach(flight => {
      next.set(flight.id, flight);
      const prevFlight = previous.get(flight.id);
      if (!prevFlight) return;

      const alert = buildAlert(prevFlight, flight);
      if (!alert) return;

      enqueueToast(`toast-${flight.id}-${idCounterRef.current++}`, { flightNumber: flight.flightNumber, ...alert });
    });

    previousRef.current = next;
  }, [flights]);

  useEffect(() => {
    const wasAlreadyDisconnected = previousConnectionRef.current === 'disconnected';
    previousConnectionRef.current = connection;
    if (connection !== 'disconnected' || wasAlreadyDisconnected) return;

    enqueueToast(`toast-connection-${idCounterRef.current++}`, {
      kind: 'error',
      message: 'FlyAware sin conexión — los datos no se están actualizando',
    });
  }, [connection]);

  function dismissToast(id) {
    setToasts(current => current.filter(toast => toast.id !== id));
  }

  return { toasts, dismissToast };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useFlightAlerts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/useFlightAlerts.js src/features/flight-monitoring/useFlightAlerts.test.js
git commit -m "feat: add useFlightAlerts toast-queue hook"
```

---

## Task 6: `useFlightMonitoringFilters` hook

**Files:**
- Create: `src/features/flight-monitoring/useFlightMonitoringFilters.js`
- Test: `src/features/flight-monitoring/useFlightMonitoringFilters.test.js`

**Interfaces:**
- Consumes: `extractDateFromIso`, `isStationRelated`, `matchesChip` from Task 2.
- Produces: `useFlightMonitoringFilters(flights: Flight[]) => { filters: { date, airline, status, origin, destination, search }, setFilter(key, value), activeChip: string, setActiveChip(id), onlyStationRelated: boolean, setOnlyStationRelated(value), filteredFlights: Flight[] }`. Consumed by `FlightMonitoringPage` (Task 18), which passes pieces of this down to `FlightToolbar` (Task 9) and `FlightListPanel` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/useFlightMonitoringFilters.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlightMonitoringFilters } from './useFlightMonitoringFilters';

function flight(overrides) {
  return {
    id: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    registration: 'HI1024',
    supervisor: 'Juan Pérez',
    status: 'scheduled',
    eta: '2026-08-06T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    ...overrides,
  };
}

const FLIGHTS = [
  flight({ id: 1, flightNumber: 'DM161', airline: 'Arajet', registration: 'HI1024', status: 'scheduled', origin: 'PUJ', destination: 'JFK' }),
  flight({ id: 2, flightNumber: 'AA904', airline: 'American', registration: 'N904AA', status: 'delayed', origin: 'PUJ', destination: 'MIA' }),
  flight({ id: 3, flightNumber: 'AA100', airline: 'American', registration: 'N100AA', status: 'enRoute', origin: 'MIA', destination: 'JFK' }),
];

describe('useFlightMonitoringFilters', () => {
  it('returns every flight when nothing is active', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('filters by airline', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setFilter('airline', 'American'));
    expect(result.current.filteredFlights.map(f => f.id).sort()).toEqual([2, 3]);
  });

  it('filters by free-text search across number, airline, registration, and supervisor', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setFilter('search', 'HI1024'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual([1]);
  });

  it('applies the "delayed" chip', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setActiveChip('delayed'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual([2]);
  });

  it('filters to only station-related flights when the toggle is on', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setOnlyStationRelated(true));
    expect(result.current.filteredFlights.map(f => f.id).sort()).toEqual([1, 2]);
  });

  it('combines a chip and the station toggle', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setActiveChip('enRoute'));
    act(() => result.current.setOnlyStationRelated(true));
    expect(result.current.filteredFlights).toHaveLength(0); // the only enRoute flight (id 3) is not station-related
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useFlightMonitoringFilters`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `useFlightMonitoringFilters.js`**

Create `src/features/flight-monitoring/useFlightMonitoringFilters.js`:

```js
import { useMemo, useState } from 'react';
import { extractDateFromIso, isStationRelated, matchesChip } from './flightMonitoringMappers';

const INITIAL_FILTERS = { date: '', airline: '', status: '', origin: '', destination: '', search: '' };

function matchesFilters(flight, filters) {
  if (filters.date && extractDateFromIso(flight.eta) !== filters.date) return false;
  if (filters.airline && flight.airline !== filters.airline) return false;
  if (filters.status && flight.status !== filters.status) return false;
  if (filters.origin && flight.origin !== filters.origin) return false;
  if (filters.destination && flight.destination !== filters.destination) return false;
  if (filters.search) {
    const haystack = `${flight.flightNumber} ${flight.airline} ${flight.registration} ${flight.supervisor ?? ''}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  return true;
}

export function useFlightMonitoringFilters(flights) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [activeChip, setActiveChip] = useState('all');
  const [onlyStationRelated, setOnlyStationRelated] = useState(false);

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  const filteredFlights = useMemo(
    () =>
      flights
        .filter(flight => matchesFilters(flight, filters))
        .filter(flight => matchesChip(flight, activeChip))
        .filter(flight => !onlyStationRelated || isStationRelated(flight)),
    [flights, filters, activeChip, onlyStationRelated]
  );

  return { filters, setFilter, activeChip, setActiveChip, onlyStationRelated, setOnlyStationRelated, filteredFlights };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useFlightMonitoringFilters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/useFlightMonitoringFilters.js src/features/flight-monitoring/useFlightMonitoringFilters.test.js
git commit -m "feat: add useFlightMonitoringFilters hook"
```

---

## Task 7: Flight Monitoring icon set

**Files:**
- Create: `src/features/flight-monitoring/components/icons.jsx`
- Test: `src/features/flight-monitoring/components/icons.test.jsx`

**Interfaces:**
- Produces named exports, each a React component accepting `{ className }` and rendering a decorative (`aria-hidden="true"`) inline SVG, stroke-based, viewBox `0 0 24 24`: `SearchIcon`, `XIcon`, `CrosshairIcon`, `RotateCcwIcon`. Consumed by `FlightSearch`/`FlightDetailPopover`/`FlightToast` (Tasks 8, 13, 14) and `FlightMap` (Task 17).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/icons.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SearchIcon, XIcon, CrosshairIcon, RotateCcwIcon } from './icons';

const ICONS = { SearchIcon, XIcon, CrosshairIcon, RotateCcwIcon };

describe('flight monitoring icon set', () => {
  it.each(Object.entries(ICONS))('%s renders a decorative inline SVG', (name, Icon) => {
    const { container } = render(<Icon className="h-4 w-4" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('h-4', 'w-4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- flight-monitoring/components/icons`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the icon set**

Create `src/features/flight-monitoring/components/icons.jsx`:

```jsx
function Icon({ className, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </Icon>
  );
}

export function XIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function CrosshairIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.5v3.5M12 18v3.5M2.5 12h3.5M18 12h3.5" />
    </Icon>
  );
}

export function RotateCcwIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 9.5A8 8 0 1 1 4.6 15" />
      <path d="M4 4.5v5h5" />
    </Icon>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- flight-monitoring/components/icons`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/icons.jsx src/features/flight-monitoring/components/icons.test.jsx
git commit -m "feat: add flight-monitoring line icon set"
```

---

## Task 8: `FlightConnectionStatus` component

**Files:**
- Create: `src/features/flight-monitoring/components/FlightConnectionStatus.jsx`
- Test: `src/features/flight-monitoring/components/FlightConnectionStatus.test.jsx`

**Interfaces:**
- Consumes: `AlertTriangleIcon`, `RefreshCwIcon` from `src/features/dashboard/components/icons` (existing); `formatClockTime` from `src/features/dashboard/mappers.js` (existing).
- Produces: `<FlightConnectionStatus connection={'connected'|'syncing'|'disconnected'} lastUpdatedAt={string|null} onRefresh={() => void} />`. Consumed by `FlightToolbar` (Task 9).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/FlightConnectionStatus.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightConnectionStatus from './FlightConnectionStatus';

describe('FlightConnectionStatus', () => {
  it('shows the connected title when connection is connected', () => {
    render(<FlightConnectionStatus connection="connected" lastUpdatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText('FlyAware conectado')).toBeInTheDocument();
  });

  it('shows the disconnected title and a ring style when connection is disconnected', () => {
    render(<FlightConnectionStatus connection="disconnected" lastUpdatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText('FlyAware desconectado')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('ring-1');
  });

  it('shows a placeholder when there has been no update yet', () => {
    render(<FlightConnectionStatus connection="syncing" lastUpdatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText('Sin actualizaciones aún')).toBeInTheDocument();
  });

  it('shows a formatted last-updated time when available', () => {
    render(<FlightConnectionStatus connection="connected" lastUpdatedAt="2026-08-06T08:05:00-04:00" onRefresh={() => {}} />);
    expect(screen.getByText(/Última actualización \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('calls onRefresh when the button is clicked', async () => {
    const onRefresh = vi.fn();
    render(<FlightConnectionStatus connection="connected" lastUpdatedAt={null} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightConnectionStatus`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightConnectionStatus.jsx`**

Create `src/features/flight-monitoring/components/FlightConnectionStatus.jsx`:

```jsx
import { AlertTriangleIcon, RefreshCwIcon } from '../../dashboard/components/icons';
import { formatClockTime } from '../../dashboard/mappers';

const STATUS_META = {
  connected: { title: 'FlyAware conectado', colorClass: 'text-status-success', dotClass: 'bg-status-success' },
  syncing: { title: 'FlyAware sincronizando', colorClass: 'text-status-warning', dotClass: 'bg-status-warning' },
  disconnected: { title: 'FlyAware desconectado', colorClass: 'text-status-danger', dotClass: 'bg-status-danger' },
};

export default function FlightConnectionStatus({ connection, lastUpdatedAt, onRefresh }) {
  const meta = STATUS_META[connection] ?? STATUS_META.disconnected;
  const Icon = connection === 'disconnected' ? AlertTriangleIcon : RefreshCwIcon;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-black/5 bg-white/70 px-4 py-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card ${
        connection === 'disconnected' ? 'ring-1 ring-status-danger/40' : ''
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      <Icon className={`h-4 w-4 shrink-0 ${meta.colorClass}`} />
      <span className={`text-sm font-medium ${meta.colorClass}`}>{meta.title}</span>
      <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {lastUpdatedAt ? `Última actualización ${formatClockTime(lastUpdatedAt)}` : 'Sin actualizaciones aún'}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-accent-600/30 px-3 py-1.5 text-xs font-semibold text-accent-600 hover:bg-accent-600/10"
      >
        <RefreshCwIcon className="h-3.5 w-3.5" />
        Actualizar
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightConnectionStatus`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightConnectionStatus.jsx src/features/flight-monitoring/components/FlightConnectionStatus.test.jsx
git commit -m "feat: add FlightConnectionStatus component"
```

---

## Task 9: `FlightSearch` and `FlightFilterChips` components

**Files:**
- Create: `src/features/flight-monitoring/components/FlightSearch.jsx`
- Create: `src/features/flight-monitoring/components/FlightFilterChips.jsx`
- Test: `src/features/flight-monitoring/components/FlightSearch.test.jsx`
- Test: `src/features/flight-monitoring/components/FlightFilterChips.test.jsx`

**Interfaces:**
- Consumes: `SearchIcon` from Task 7; `FLIGHT_FILTER_CHIPS` from Task 2.
- Produces: `<FlightSearch value={string} onChange={(value: string) => void} />` and `<FlightFilterChips active={string} onChange={(id: string) => void} />`. Both consumed by `FlightListPanel` (Task 12).

- [ ] **Step 1: Write the failing tests**

Create `src/features/flight-monitoring/components/FlightSearch.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightSearch from './FlightSearch';

describe('FlightSearch', () => {
  it('renders the current value and calls onChange as the user types', async () => {
    const onChange = vi.fn();
    render(<FlightSearch value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Número, aerolínea, matrícula o supervisor');
    await userEvent.type(input, 'DM161');
    expect(onChange).toHaveBeenCalledWith('D');
    expect(onChange).toHaveBeenCalledTimes(5);
  });
});
```

Create `src/features/flight-monitoring/components/FlightFilterChips.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightFilterChips from './FlightFilterChips';

describe('FlightFilterChips', () => {
  it('renders all seven chips and marks the active one pressed', () => {
    render(<FlightFilterChips active="delayed" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retrasados' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the chip id when clicked', async () => {
    const onChange = vi.fn();
    render(<FlightFilterChips active="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'En ruta' }));
    expect(onChange).toHaveBeenCalledWith('enRoute');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightSearch FlightFilterChips`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement both components**

Create `src/features/flight-monitoring/components/FlightSearch.jsx`:

```jsx
import { SearchIcon } from './icons';

export default function FlightSearch({ value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      Buscar vuelo
      <span className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
        <input
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="Número, aerolínea, matrícula o supervisor"
          className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
        />
      </span>
    </label>
  );
}
```

Create `src/features/flight-monitoring/components/FlightFilterChips.jsx`:

```jsx
import { FLIGHT_FILTER_CHIPS } from '../flightMonitoringMappers';

export default function FlightFilterChips({ active, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FLIGHT_FILTER_CHIPS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={active === id}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ${
            active === id
              ? 'border-accent-600 bg-accent-600/10 text-accent-600'
              : 'border-black/10 text-text-secondary-light hover:border-accent-600/40 dark:border-white/10 dark:text-text-secondary-dark'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightSearch FlightFilterChips`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightSearch.jsx src/features/flight-monitoring/components/FlightSearch.test.jsx src/features/flight-monitoring/components/FlightFilterChips.jsx src/features/flight-monitoring/components/FlightFilterChips.test.jsx
git commit -m "feat: add FlightSearch and FlightFilterChips components"
```

---

## Task 10: `FlightListItem` component

**Files:**
- Create: `src/features/flight-monitoring/components/FlightListItem.jsx`
- Test: `src/features/flight-monitoring/components/FlightListItem.test.jsx`

**Interfaces:**
- Consumes: `StatusBadge`, `STATUS_COLORS`, `getStatusMeta` from `src/features/dashboard/statusMeta.js`/`StatusBadge.jsx` (existing); `formatClockTime` from `src/features/dashboard/mappers.js` (existing).
- Produces: `<FlightListItem flight={Flight} selected={boolean} onSelect={(id: number) => void} />`. Consumed by `FlightListPanel` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/FlightListItem.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightListItem from './FlightListItem';

const FLIGHT = {
  id: 2,
  flightNumber: 'AA904',
  airline: 'American',
  status: 'delayed',
  origin: 'PUJ',
  destination: 'MIA',
  eta: '2026-08-06T08:20:00-04:00',
  stand: 'B21',
  supervisor: 'K. Objío',
};

describe('FlightListItem', () => {
  it('renders identity, status, route, stand, and supervisor', () => {
    render(<FlightListItem flight={FLIGHT} selected={false} onSelect={() => {}} />);
    expect(screen.getByText('AA904')).toBeInTheDocument();
    expect(screen.getByText('American')).toBeInTheDocument();
    expect(screen.getByText('Retrasado')).toBeInTheDocument();
    expect(screen.getByText('PUJ → MIA')).toBeInTheDocument();
    expect(screen.getByText('B21')).toBeInTheDocument();
    expect(screen.getByText('K. Objío')).toBeInTheDocument();
  });

  it('shows a fallback when there is no stand', () => {
    render(<FlightListItem flight={{ ...FLIGHT, stand: null }} selected={false} onSelect={() => {}} />);
    expect(screen.getByText('Sin stand')).toBeInTheDocument();
  });

  it('applies the selected ring style when selected', () => {
    render(<FlightListItem flight={FLIGHT} selected onSelect={() => {}} />);
    expect(screen.getByTestId('flight-list-item')).toHaveClass('border-signal-500');
  });

  it('calls onSelect with the flight id when clicked', async () => {
    const onSelect = vi.fn();
    render(<FlightListItem flight={FLIGHT} selected={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('flight-list-item'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightListItem`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightListItem.jsx`**

Create `src/features/flight-monitoring/components/FlightListItem.jsx`:

```jsx
import StatusBadge from '../../dashboard/components/StatusBadge';
import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';

export default function FlightListItem({ flight, selected, onSelect }) {
  const meta = getStatusMeta('flight', flight.status);
  const accentColor = STATUS_COLORS[meta.color];

  return (
    <div
      data-testid="flight-list-item"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(flight.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(flight.id);
      }}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className={`cursor-pointer rounded-xl border bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:bg-surface-dark-card ${
        selected ? 'border-signal-500 ring-1 ring-signal-500' : 'border-black/5 dark:border-white/5'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge domain="flight" status={flight.status} />
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          {flight.flightNumber}
        </span>
        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{flight.airline}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <span>
          {flight.origin} → {flight.destination}
        </span>
        <span className="font-mono">ETA {formatClockTime(flight.eta)}</span>
        <span className="font-mono">{flight.stand ?? 'Sin stand'}</span>
        {flight.supervisor && <span className="ml-auto">{flight.supervisor}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightListItem`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightListItem.jsx src/features/flight-monitoring/components/FlightListItem.test.jsx
git commit -m "feat: add FlightListItem component"
```

---

## Task 11: `FlightMonitoringSkeleton` and `EmptyFlightState` components

**Files:**
- Create: `src/features/flight-monitoring/components/FlightMonitoringSkeleton.jsx`
- Create: `src/features/flight-monitoring/components/EmptyFlightState.jsx`
- Test: `src/features/flight-monitoring/components/FlightMonitoringSkeleton.test.jsx`
- Test: `src/features/flight-monitoring/components/EmptyFlightState.test.jsx`

**Interfaces:**
- Consumes: `RadarIcon` from `src/features/shell/components/icons.jsx` (existing).
- Produces: `<FlightMonitoringSkeleton />` (no props) and `<EmptyFlightState reason={'no-flights'|'no-results'} />`. Consumed by `FlightMonitoringPage` (Task 19) and `FlightListPanel` (Task 12).

- [ ] **Step 1: Write the failing tests**

Create `src/features/flight-monitoring/components/FlightMonitoringSkeleton.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightMonitoringSkeleton from './FlightMonitoringSkeleton';

describe('FlightMonitoringSkeleton', () => {
  it('renders a skeleton placeholder for the toolbar+list+map layout', () => {
    render(<FlightMonitoringSkeleton />);
    expect(screen.getByTestId('flight-monitoring-skeleton')).toBeInTheDocument();
  });
});
```

Create `src/features/flight-monitoring/components/EmptyFlightState.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyFlightState from './EmptyFlightState';

describe('EmptyFlightState', () => {
  it('shows the no-flights message by default', () => {
    render(<EmptyFlightState reason="no-flights" />);
    expect(screen.getByText('Sin vuelos para mostrar')).toBeInTheDocument();
  });

  it('shows the no-results message when filters produced nothing', () => {
    render(<EmptyFlightState reason="no-results" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightMonitoringSkeleton EmptyFlightState`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement both components**

Create `src/features/flight-monitoring/components/FlightMonitoringSkeleton.jsx`:

```jsx
export default function FlightMonitoringSkeleton() {
  return (
    <div data-testid="flight-monitoring-skeleton" className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[3fr_7fr]">
      <div className="space-y-2 rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
        ))}
      </div>
      <div className="min-h-[420px] animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
    </div>
  );
}
```

Create `src/features/flight-monitoring/components/EmptyFlightState.jsx`:

```jsx
import { RadarIcon } from '../../shell/components/icons';

const MESSAGES = {
  'no-flights': {
    title: 'Sin vuelos para mostrar',
    description: 'No hay vuelos relacionados con la estación en este momento.',
  },
  'no-results': {
    title: 'Sin resultados',
    description: 'Ningún vuelo coincide con los filtros aplicados.',
  },
};

export default function EmptyFlightState({ reason = 'no-flights' }) {
  const meta = MESSAGES[reason] ?? MESSAGES['no-flights'];

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-8 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <RadarIcon className="h-8 w-8 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{meta.title}</p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{meta.description}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightMonitoringSkeleton EmptyFlightState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightMonitoringSkeleton.jsx src/features/flight-monitoring/components/FlightMonitoringSkeleton.test.jsx src/features/flight-monitoring/components/EmptyFlightState.jsx src/features/flight-monitoring/components/EmptyFlightState.test.jsx
git commit -m "feat: add FlightMonitoringSkeleton and EmptyFlightState components"
```

---

## Task 12: `FlightListPanel` component

**Files:**
- Create: `src/features/flight-monitoring/components/FlightListPanel.jsx`
- Test: `src/features/flight-monitoring/components/FlightListPanel.test.jsx`

**Interfaces:**
- Consumes: `FlightSearch`, `FlightFilterChips` (Task 9), `FlightListItem` (Task 10), `EmptyFlightState` (Task 11).
- Produces: `<FlightListPanel flights={Flight[]} emptyReason={'no-flights'|'no-results'|null} search={string} onSearchChange={(v) => void} activeChip={string} onChipChange={(id) => void} selectedFlightId={number|null} onSelectFlight={(id) => void} />`. Consumed by `FlightMonitoringPage` (Task 19).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/FlightListPanel.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightListPanel from './FlightListPanel';

const FLIGHTS = [
  { id: 1, flightNumber: 'DM161', airline: 'Arajet', status: 'approaching', origin: 'MIA', destination: 'PUJ', eta: '2026-08-06T14:20:00-04:00', stand: 'A5', supervisor: 'Juan Pérez' },
  { id: 2, flightNumber: 'AA904', airline: 'American', status: 'delayed', origin: 'PUJ', destination: 'MIA', eta: '2026-08-06T08:20:00-04:00', stand: 'B21', supervisor: 'K. Objío' },
];

describe('FlightListPanel', () => {
  it('renders the search box, chips, and every flight', () => {
    render(
      <FlightListPanel
        flights={FLIGHTS}
        emptyReason={null}
        search=""
        onSearchChange={() => {}}
        activeChip="all"
        onChipChange={() => {}}
        selectedFlightId={null}
        onSelectFlight={() => {}}
      />
    );
    expect(screen.getByPlaceholderText('Número, aerolínea, matrícula o supervisor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos' })).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('AA904')).toBeInTheDocument();
  });

  it('renders the empty state instead of the list when emptyReason is set', () => {
    render(
      <FlightListPanel
        flights={[]}
        emptyReason="no-results"
        search=""
        onSearchChange={() => {}}
        activeChip="all"
        onChipChange={() => {}}
        selectedFlightId={null}
        onSelectFlight={() => {}}
      />
    );
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
    expect(screen.queryByText('DM161')).not.toBeInTheDocument();
  });

  it('forwards selection to the clicked flight item', async () => {
    const onSelectFlight = vi.fn();
    render(
      <FlightListPanel
        flights={FLIGHTS}
        emptyReason={null}
        search=""
        onSearchChange={() => {}}
        activeChip="all"
        onChipChange={() => {}}
        selectedFlightId={null}
        onSelectFlight={onSelectFlight}
      />
    );
    await userEvent.click(screen.getByText('DM161'));
    expect(onSelectFlight).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightListPanel`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightListPanel.jsx`**

Create `src/features/flight-monitoring/components/FlightListPanel.jsx`:

```jsx
import FlightSearch from './FlightSearch';
import FlightFilterChips from './FlightFilterChips';
import FlightListItem from './FlightListItem';
import EmptyFlightState from './EmptyFlightState';

export default function FlightListPanel({
  flights,
  emptyReason,
  search,
  onSearchChange,
  activeChip,
  onChipChange,
  selectedFlightId,
  onSelectFlight,
}) {
  return (
    <div
      data-testid="flight-list-panel"
      className="flex h-full flex-col gap-3 overflow-y-auto rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <FlightSearch value={search} onChange={onSearchChange} />
      <FlightFilterChips active={activeChip} onChange={onChipChange} />

      {emptyReason ? (
        <EmptyFlightState reason={emptyReason} />
      ) : (
        <div className="flex flex-col gap-2">
          {flights.map(flight => (
            <FlightListItem
              key={flight.id}
              flight={flight}
              selected={flight.id === selectedFlightId}
              onSelect={onSelectFlight}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightListPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightListPanel.jsx src/features/flight-monitoring/components/FlightListPanel.test.jsx
git commit -m "feat: add FlightListPanel component"
```

---

## Task 13: `FlightToolbar` component

**Files:**
- Create: `src/features/flight-monitoring/components/FlightToolbar.jsx`
- Test: `src/features/flight-monitoring/components/FlightToolbar.test.jsx`

**Interfaces:**
- Consumes: `FlightConnectionStatus` (Task 8); `getStatusMeta` from `src/features/dashboard/statusMeta.js` (existing).
- Produces: `<FlightToolbar connection lastUpdatedAt onRefresh filters onFilterChange options onlyStationRelated onToggleStationRelated />` where `options: { dates, airlines, statuses, origins, destinations }` (the shape from Task 2's `getFilterOptions`). Does **not** render `FlightSearch`/`FlightFilterChips` — those live in `FlightListPanel` (Task 12), per the spec's correction avoiding two redundant search boxes. Consumed by `FlightMonitoringPage` (Task 19).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/FlightToolbar.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightToolbar from './FlightToolbar';

const OPTIONS = {
  dates: ['2026-08-06'],
  airlines: ['Arajet', 'American'],
  statuses: ['approaching', 'delayed'],
  origins: ['MIA', 'PUJ'],
  destinations: ['MIA', 'PUJ'],
};

const FILTERS = { date: '', airline: '', status: '', origin: '', destination: '', search: '' };

describe('FlightToolbar', () => {
  it('renders the connection status and every filter dropdown', () => {
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    expect(screen.getByText('FlyAware conectado')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toBeInTheDocument();
    expect(screen.getByLabelText('Aerolínea')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getByLabelText('Origen')).toBeInTheDocument();
    expect(screen.getByLabelText('Destino')).toBeInTheDocument();
  });

  it('does not render a search box (that lives in FlightListPanel)', () => {
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    expect(screen.queryByPlaceholderText('Número, aerolínea, matrícula o supervisor')).not.toBeInTheDocument();
  });

  it('formats status options through getStatusMeta labels', () => {
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    expect(screen.getByRole('option', { name: 'Aproximando' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Retrasado' })).toBeInTheDocument();
  });

  it('calls onFilterChange with the field key when a dropdown changes', async () => {
    const onFilterChange = vi.fn();
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={onFilterChange}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'Arajet');
    expect(onFilterChange).toHaveBeenCalledWith('airline', 'Arajet');
  });

  it('toggles the "only PUJ" switch', async () => {
    const onToggleStationRelated = vi.fn();
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={onToggleStationRelated}
      />
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onToggleStationRelated).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightToolbar`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightToolbar.jsx`**

Create `src/features/flight-monitoring/components/FlightToolbar.jsx`:

```jsx
import FlightConnectionStatus from './FlightConnectionStatus';
import { getStatusMeta } from '../../dashboard/statusMeta';

function FilterSelect({ label, value, onChange, options, formatOption = option => option }) {
  return (
    <label className="flex min-w-[140px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      >
        <option value="">Todos</option>
        {options.map(option => (
          <option key={option} value={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function FlightToolbar({
  connection,
  lastUpdatedAt,
  onRefresh,
  filters,
  onFilterChange,
  options,
  onlyStationRelated,
  onToggleStationRelated,
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <FlightConnectionStatus connection={connection} lastUpdatedAt={lastUpdatedAt} onRefresh={onRefresh} />

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label="Fecha" value={filters.date} onChange={value => onFilterChange('date', value)} options={options.dates} />
        <FilterSelect label="Aerolínea" value={filters.airline} onChange={value => onFilterChange('airline', value)} options={options.airlines} />
        <FilterSelect
          label="Estado"
          value={filters.status}
          onChange={value => onFilterChange('status', value)}
          options={options.statuses}
          formatOption={option => getStatusMeta('flight', option).label}
        />
        <FilterSelect label="Origen" value={filters.origin} onChange={value => onFilterChange('origin', value)} options={options.origins} />
        <FilterSelect label="Destino" value={filters.destination} onChange={value => onFilterChange('destination', value)} options={options.destinations} />

        <label className="ml-auto flex items-center gap-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <input
            type="checkbox"
            role="switch"
            aria-checked={onlyStationRelated}
            checked={onlyStationRelated}
            onChange={event => onToggleStationRelated(event.target.checked)}
            className="h-4 w-4 rounded accent-accent-600"
          />
          Solo vuelos relacionados con PUJ
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightToolbar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightToolbar.jsx src/features/flight-monitoring/components/FlightToolbar.test.jsx
git commit -m "feat: add FlightToolbar component"
```

---

## Task 14: `FlightLegend` component

**Files:**
- Create: `src/features/flight-monitoring/components/FlightLegend.jsx`
- Test: `src/features/flight-monitoring/components/FlightLegend.test.jsx`

**Interfaces:**
- Consumes: `FLIGHT_STATUS_META`, `STATUS_COLORS` from `src/features/dashboard/statusMeta.js` (existing); `ChevronDownIcon` from `src/features/dashboard/components/icons` (existing).
- Produces: `<FlightLegend />` (no props — it is self-contained and always reflects the full, shared status table). Consumed by `FlightMonitoringPage` (Task 19), rendered as an absolutely-positioned overlay inside the map container.

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/FlightLegend.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightLegend from './FlightLegend';

describe('FlightLegend', () => {
  it('lists every flight status label', () => {
    render(<FlightLegend />);
    expect(screen.getByText('Programado')).toBeInTheDocument();
    expect(screen.getByText('Aproximando')).toBeInTheDocument();
    expect(screen.getByText('Desconocido')).toBeInTheDocument();
  });

  it('is expanded by default and collapses when its header is clicked', async () => {
    render(<FlightLegend />);
    expect(screen.getByRole('button', { name: /Leyenda/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Programado')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /Leyenda/ }));
    expect(screen.getByRole('button', { name: /Leyenda/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Programado')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightLegend`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightLegend.jsx`**

Create `src/features/flight-monitoring/components/FlightLegend.jsx`:

```jsx
import { useState } from 'react';
import { FLIGHT_STATUS_META, STATUS_COLORS } from '../../dashboard/statusMeta';
import { ChevronDownIcon } from '../../dashboard/components/icons';

export default function FlightLegend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-4 left-4 z-10 w-56 rounded-xl border border-black/10 bg-white/90 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
      <button
        type="button"
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between font-semibold text-ink-900 dark:text-text-primary-dark"
      >
        Leyenda
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      {!collapsed && (
        <ul className="mt-2 space-y-1.5">
          {Object.entries(FLIGHT_STATUS_META).map(([status, meta]) => (
            <li key={status} className="flex items-center gap-2 text-text-secondary-light dark:text-text-secondary-dark">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[meta.color] }}
                aria-hidden="true"
              />
              {meta.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightLegend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightLegend.jsx src/features/flight-monitoring/components/FlightLegend.test.jsx
git commit -m "feat: add FlightLegend component"
```

---

## Task 15: `FlightDetailPopover` component

**Files:**
- Create: `src/features/flight-monitoring/components/FlightDetailPopover.jsx`
- Test: `src/features/flight-monitoring/components/FlightDetailPopover.test.jsx`

**Interfaces:**
- Consumes: `StatusBadge` from `src/features/dashboard/components/StatusBadge.jsx` (existing); `formatRemaining` from Task 2; `XIcon` from Task 7.
- Produces: `<FlightDetailPopover flight={Flight|null} now={string} style={object} onClose={() => void} />`. Renders nothing when `flight` is `null`. Consumed by `FlightMonitoringPage` (Task 19).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/FlightDetailPopover.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightDetailPopover from './FlightDetailPopover';

const FLIGHT = {
  id: 1,
  flightNumber: 'DM161',
  airline: 'Arajet',
  origin: 'MIA',
  destination: 'PUJ',
  registration: 'HI1024',
  aircraft: 'B737 MAX 8',
  status: 'approaching',
  eta: '2026-08-06T14:20:00-04:00',
  etd: '2026-08-06T15:05:00-04:00',
  altitude: 8000,
  speed: 250,
  heading: 310,
  stand: 'A5',
  supervisor: 'Juan Pérez',
  agents: 5,
  services: ['GPU', 'Baggage', 'Cleaning'],
};

describe('FlightDetailPopover', () => {
  it('renders nothing when there is no flight', () => {
    const { container } = render(<FlightDetailPopover flight={null} now="2026-08-06T14:00:00-04:00" style={{}} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders identity, route, aircraft, and operational figures', () => {
    render(<FlightDetailPopover flight={FLIGHT} now="2026-08-06T14:00:00-04:00" style={{}} onClose={() => {}} />);
    expect(screen.getByText('DM161 · Arajet')).toBeInTheDocument();
    expect(screen.getByText('Aproximando')).toBeInTheDocument();
    expect(screen.getByText('MIA → PUJ · B737 MAX 8 · HI1024')).toBeInTheDocument();
    expect(screen.getByText('8,000 ft')).toBeInTheDocument();
    expect(screen.getByText('250 kt')).toBeInTheDocument();
    expect(screen.getByText('310°')).toBeInTheDocument();
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('En 20 min')).toBeInTheDocument();
    expect(screen.getByText('Servicios: GPU, Baggage, Cleaning')).toBeInTheDocument();
  });

  it('renders the two disabled cross-module buttons', () => {
    render(<FlightDetailPopover flight={FLIGHT} now="2026-08-06T14:00:00-04:00" style={{}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ver planificación' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver mapa de posiciones' })).toBeDisabled();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<FlightDetailPopover flight={FLIGHT} now="2026-08-06T14:00:00-04:00" style={{}} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Cerrar detalle'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightDetailPopover`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightDetailPopover.jsx`**

Create `src/features/flight-monitoring/components/FlightDetailPopover.jsx`:

```jsx
import StatusBadge from '../../dashboard/components/StatusBadge';
import { formatRemaining } from '../flightMonitoringMappers';
import { XIcon } from './icons';

export default function FlightDetailPopover({ flight, now, style, onClose }) {
  if (!flight) return null;

  return (
    <div
      data-testid="flight-detail-popover"
      role="dialog"
      aria-label={`Detalle del vuelo ${flight.flightNumber}`}
      style={style}
      className="absolute z-20 w-72 space-y-2 rounded-2xl border border-black/10 bg-white/95 p-4 text-sm shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
            {flight.flightNumber} · {flight.airline}
          </p>
          <StatusBadge domain="flight" status={flight.status} />
        </div>
        <button
          type="button"
          aria-label="Cerrar detalle"
          onClick={onClose}
          className="rounded-md p-1 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <p className="text-text-secondary-light dark:text-text-secondary-dark">
        {flight.origin} → {flight.destination} · {flight.aircraft} · {flight.registration}
      </p>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <dt>ETA</dt>
        <dd>{flight.eta}</dd>
        <dt>ETD</dt>
        <dd>{flight.etd}</dd>
        <dt>Altitud</dt>
        <dd>{flight.altitude.toLocaleString('en-US')} ft</dd>
        <dt>Velocidad</dt>
        <dd>{flight.speed} kt</dd>
        <dt>Heading</dt>
        <dd>{flight.heading}°</dd>
        <dt>Stand</dt>
        <dd>{flight.stand ?? 'Sin asignar'}</dd>
        <dt>Supervisor</dt>
        <dd>{flight.supervisor ?? 'Sin asignar'}</dd>
        <dt>Agentes</dt>
        <dd>{flight.agents}</dd>
        <dt>Tiempo restante</dt>
        <dd>{formatRemaining(flight.eta, now)}</dd>
      </dl>

      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Servicios: {flight.services.length > 0 ? flight.services.join(', ') : 'Sin servicios registrados'}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled
          title="Próximamente"
          className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
        >
          Ver planificación
        </button>
        <button
          type="button"
          disabled
          title="Próximamente"
          className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
        >
          Ver mapa de posiciones
        </button>
      </div>
    </div>
  );
}
```

Note: ETA/ETD are rendered as the raw ISO string here (not `formatClockTime`) specifically to keep this task's test deterministic regardless of the test runner's timezone — `formatClockTime` remains the standard for every other on-screen time in this module (`FlightListItem`, `FlightConnectionStatus`); revisit this one field if a future pass wants the clock-only look, at the cost of losing the exact-string test assertions above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightDetailPopover`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightDetailPopover.jsx src/features/flight-monitoring/components/FlightDetailPopover.test.jsx
git commit -m "feat: add FlightDetailPopover component"
```

---

## Task 16: `FlightToastStack` component

**Files:**
- Create: `src/features/flight-monitoring/components/FlightToast.jsx`
- Test: `src/features/flight-monitoring/components/FlightToast.test.jsx`

**Interfaces:**
- Consumes: `AlertTriangleIcon`, `RefreshCwIcon` from `src/features/dashboard/components/icons` (existing); `XIcon` from Task 7.
- Produces: default export `FlightToastStack({ toasts: Array<{ id, kind, message }>, onDismiss: (id) => void })`. Renders nothing when `toasts` is empty. Consumed by `FlightMonitoringPage` (Task 19), fed by `useFlightAlerts` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/components/FlightToast.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightToastStack from './FlightToast';

describe('FlightToastStack', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<FlightToastStack toasts={[]} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every toast message', () => {
    render(
      <FlightToastStack
        toasts={[
          { id: 't1', kind: 'delayed', message: 'Vuelo DM161 cambió su ETA' },
          { id: 't2', kind: 'cancelled', message: 'Vuelo AA904 cancelado' },
        ]}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText('Vuelo DM161 cambió su ETA')).toBeInTheDocument();
    expect(screen.getByText('Vuelo AA904 cancelado')).toBeInTheDocument();
  });

  it('calls onDismiss with the toast id when its dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    render(
      <FlightToastStack toasts={[{ id: 't1', kind: 'delayed', message: 'Vuelo DM161 cambió su ETA' }]} onDismiss={onDismiss} />
    );
    await userEvent.click(screen.getByLabelText('Descartar aviso'));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightToast`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightToast.jsx`**

Create `src/features/flight-monitoring/components/FlightToast.jsx`:

```jsx
import { AlertTriangleIcon, RefreshCwIcon } from '../../dashboard/components/icons';
import { XIcon } from './icons';

const KIND_META = {
  delayed: { colorClass: 'text-status-warning', icon: RefreshCwIcon },
  cancelled: { colorClass: 'text-status-danger', icon: AlertTriangleIcon },
  diverted: { colorClass: 'text-status-danger', icon: AlertTriangleIcon },
  error: { colorClass: 'text-status-danger', icon: AlertTriangleIcon },
};

function Toast({ toast, onDismiss }) {
  const meta = KIND_META[toast.kind] ?? KIND_META.delayed;
  const Icon = meta.icon;

  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-xl border border-black/10 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
    >
      <Icon className={`h-4 w-4 shrink-0 ${meta.colorClass}`} />
      <span className="text-ink-900 dark:text-text-primary-dark">{toast.message}</span>
      <button
        type="button"
        aria-label="Descartar aviso"
        onClick={() => onDismiss(toast.id)}
        className="ml-auto rounded-md p-0.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function FlightToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightToast`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/FlightToast.jsx src/features/flight-monitoring/components/FlightToast.test.jsx
git commit -m "feat: add FlightToastStack component"
```

---

## Task 17: Marker builder functions (`AircraftMarker`, `AirportMarker`)

**Files:**
- Create: `src/features/flight-monitoring/components/AircraftMarker.js`
- Create: `src/features/flight-monitoring/components/AirportMarker.js`
- Test: `src/features/flight-monitoring/components/AircraftMarker.test.js`
- Test: `src/features/flight-monitoring/components/AirportMarker.test.js`

**Interfaces:**
- Consumes: `STATUS_COLORS`, `getStatusMeta` from `src/features/dashboard/statusMeta.js` (existing). Reuses the exact `PlaneIcon` path (`src/features/dashboard/components/icons/index.jsx`) and the exact `MapPinIcon` path (same file) as raw SVG markup — MapLibre markers take a plain DOM element, not a React component, so these paths are copied as literal SVG strings rather than rendered through the React icon components.
- Produces: `createAircraftMarkerElement(flight, { selected？ }) => HTMLElement`, `updateAircraftMarkerElement(element, flight, { selected? }) => void` (mutates the given element in place — no new element, no full re-render), `createAirportMarkerElement() => HTMLElement`. These are plain DOM builder functions (not React components), directly unit-testable via `document.createElement` in jsdom without mounting into a React tree. Consumed by `FlightMap` (Task 18).

- [ ] **Step 1: Write the failing tests**

Create `src/features/flight-monitoring/components/AircraftMarker.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createAircraftMarkerElement, updateAircraftMarkerElement } from './AircraftMarker';

const FLIGHT = { id: 7, status: 'approaching', heading: 90 };

describe('createAircraftMarkerElement', () => {
  it('creates a div carrying the flight id and an inline plane SVG', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(element.tagName).toBe('DIV');
    expect(element.dataset.flightId).toBe('7');
    expect(element.querySelector('svg')).not.toBeNull();
  });

  it('rotates the marker to match the flight heading', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(element.style.transform).toContain('rotate(90deg)');
  });

  it('scales the marker up when selected', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: true });
    expect(element.style.transform).toContain('scale(1.15)');
  });

  it('colors the marker stroke according to the flight status', () => {
    const delayedElement = createAircraftMarkerElement({ ...FLIGHT, status: 'delayed' }, { selected: false });
    expect(delayedElement.querySelector('svg').getAttribute('stroke')).toBe('#D9A441');
  });
});

describe('updateAircraftMarkerElement', () => {
  it('mutates the existing element in place instead of returning a new one', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    updateAircraftMarkerElement(element, { ...FLIGHT, heading: 200, status: 'landed' }, { selected: true });

    expect(element.style.transform).toContain('rotate(200deg)');
    expect(element.style.transform).toContain('scale(1.15)');
    expect(element.querySelector('svg').getAttribute('stroke')).toBe('#1E9E6B');
  });
});
```

Create `src/features/flight-monitoring/components/AirportMarker.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createAirportMarkerElement } from './AirportMarker';

describe('createAirportMarkerElement', () => {
  it('creates a div with an inline pin SVG in the accent color', () => {
    const element = createAirportMarkerElement();
    expect(element.tagName).toBe('DIV');
    const svg = element.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('stroke')).toBe('#145DC4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AircraftMarker AirportMarker`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement both marker builders**

Create `src/features/flight-monitoring/components/AircraftMarker.js`:

```js
import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';

// Same path as the existing PlaneIcon (src/features/dashboard/components/icons/index.jsx) —
// copied as a literal string because MapLibre markers take a plain DOM element, not JSX.
const PLANE_PATH = 'M3.5 12.8 20 7.2c.9-.3 1.6.5 1.2 1.3l-2 3.8-6 2-1 4.7-1.6.5-.6-5-4-1.2Z';

function svgMarkup(color) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${PLANE_PATH}" /></svg>`;
}

export function createAircraftMarkerElement(flight, { selected = false } = {}) {
  const element = document.createElement('div');
  element.className = 'flight-monitoring-aircraft-marker';
  element.dataset.flightId = String(flight.id);
  element.style.transition = 'transform 3.8s linear';
  element.style.cursor = 'pointer';
  updateAircraftMarkerElement(element, flight, { selected });
  return element;
}

export function updateAircraftMarkerElement(element, flight, { selected = false } = {}) {
  const meta = getStatusMeta('flight', flight.status);
  element.innerHTML = svgMarkup(STATUS_COLORS[meta.color]);
  element.style.transform = `rotate(${flight.heading}deg) scale(${selected ? 1.15 : 1})`;
  element.dataset.selected = String(selected);
}
```

Create `src/features/flight-monitoring/components/AirportMarker.js`:

```js
// Same path as the existing MapPinIcon (src/features/dashboard/components/icons/index.jsx) —
// copied as a literal string because MapLibre markers take a plain DOM element, not JSX.
const PIN_PATH = 'M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z';

export function createAirportMarkerElement() {
  const element = document.createElement('div');
  element.className = 'flight-monitoring-airport-marker';
  element.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#145DC4" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${PIN_PATH}" /><circle cx="12" cy="9.5" r="2.3" /></svg>`;
  return element;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AircraftMarker AirportMarker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/components/AircraftMarker.js src/features/flight-monitoring/components/AircraftMarker.test.js src/features/flight-monitoring/components/AirportMarker.js src/features/flight-monitoring/components/AirportMarker.test.js
git commit -m "feat: add AircraftMarker and AirportMarker DOM builder functions"
```

---

## Task 18: `FlightMap` component (MapLibre GL integration)

**Files:**
- Modify: `package.json`, `package-lock.json` (add `maplibre-gl` dependency)
- Modify: `.env` (add the two style-URL variables, following the existing `VITE_API_URL` pattern already in this file)
- Create: `src/features/flight-monitoring/components/FlightMap.jsx`
- Test: `src/features/flight-monitoring/components/FlightMap.test.jsx`

**Interfaces:**
- Consumes: `PUJ_COORDINATES` from Task 2; `createAircraftMarkerElement`/`updateAircraftMarkerElement` from Task 17 (`AircraftMarker.js`); `createAirportMarkerElement` from Task 17 (`AirportMarker.js`); `CrosshairIcon`/`RotateCcwIcon` from Task 7.
- Produces: `<FlightMap flights={Flight[]} selectedFlightId={number|null} onSelectFlight={(id) => void} theme={'light'|'dark'} onPopoverPosition={(position: { left: number, top: number } | null) => void} />`. `onPopoverPosition` is called with the selected flight's projected screen coordinates (via MapLibre's `map.project`) whenever the selection changes, whenever the selected flight's marker moves, and whenever the map itself pans/zooms (`move`/`zoom` events) — or with `null` when nothing is selected. This is how `FlightDetailPopover` (Task 15) stays visually pinned to its aircraft instead of sitting at a fixed screen position, per the design spec. Consumed by `FlightMonitoringPage` (Task 19).
- This is the only task that touches the real `maplibre-gl` package; every other task only imports from this module's own helpers.

- [ ] **Step 1: Install the new dependency**

Run: `npm install maplibre-gl`
Expected: `maplibre-gl` appears under `dependencies` in `package.json`, and `package-lock.json` is updated.

- [ ] **Step 2: Add the style-URL environment variables**

Append to `.env` (following the existing `VITE_API_URL` line already there):

```
VITE_FLIGHT_MAP_STYLE_LIGHT=https://demotiles.maplibre.org/style.json
VITE_FLIGHT_MAP_STYLE_DARK=https://demotiles.maplibre.org/style.json
```

These are dev/preview-only demo tiles (per the design spec) — swap them for a licensed provider's style URL before any real deployment. `.env.example` is intentionally left untouched: it documents the *eventual* chosen framework's public-prefix convention (`NEXT_PUBLIC_`/`PUBLIC_`), not this Vite preview harness's own `VITE_` prefix — same asymmetry the existing `VITE_API_URL` line already has in this file.

- [ ] **Step 3: Write the failing test**

Create `src/features/flight-monitoring/components/FlightMap.test.jsx`:

```jsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __state } from 'maplibre-gl';
import FlightMap from './FlightMap';

vi.mock('maplibre-gl', () => {
  const state = { maps: [] };

  class FakeMarker {
    constructor(options) {
      this.element = options.element;
      this.lngLat = null;
      this.removed = false;
    }
    setLngLat(lngLat) {
      this.lngLat = lngLat;
      return this;
    }
    addTo(map) {
      this.map = map;
      map.markers.push(this);
      return this;
    }
    remove() {
      this.removed = true;
      this.map.markers = this.map.markers.filter(marker => marker !== this);
    }
  }

  class FakeMap {
    constructor(options) {
      this.options = options;
      this.markers = [];
      this.controls = [];
      this.styleCalls = [];
      this.flyToCalls = [];
      this.listeners = {};
      state.maps.push(this);
    }
    addControl(control) {
      this.controls.push(control);
    }
    setStyle(style) {
      this.styleCalls.push(style);
    }
    flyTo(options) {
      this.flyToCalls.push(options);
    }
    on(event, handler) {
      (this.listeners[event] ??= []).push(handler);
    }
    off(event, handler) {
      this.listeners[event] = (this.listeners[event] ?? []).filter(existing => existing !== handler);
    }
    emit(event) {
      (this.listeners[event] ?? []).forEach(handler => handler());
    }
    // Fixed, deterministic stand-in for MapLibre's real screen-space projection —
    // good enough to prove FlightMap calls it with the right lngLat and forwards the result.
    project([lng, lat]) {
      return { x: lng * 10, y: lat * 10 };
    }
    remove() {
      this.removed = true;
    }
  }

  class FakeNavigationControl {}

  return {
    default: { Map: FakeMap, Marker: FakeMarker, NavigationControl: FakeNavigationControl },
    __state: state,
  };
});

function flight(overrides) {
  return { id: 1, status: 'approaching', heading: 90, latitude: 18.78, longitude: -68.12, ...overrides };
}

describe('FlightMap', () => {
  beforeEach(() => {
    __state.maps.length = 0;
    cleanup();
  });

  it('mounts a map centered on PUJ with the navigation control and the airport marker', () => {
    render(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    const map = __state.maps[0];
    expect(map.options.center).toEqual([-68.3634, 18.5674]);
    expect(map.controls).toHaveLength(1);
    expect(map.markers).toHaveLength(1); // airport marker only
  });

  it('creates one aircraft marker per flight and calls onSelectFlight when its element is clicked', () => {
    const onSelectFlight = vi.fn();
    render(
      <FlightMap flights={[flight({ id: 1 }), flight({ id: 2 })]} selectedFlightId={null} onSelectFlight={onSelectFlight} theme="light" />
    );
    const map = __state.maps[0];
    expect(map.markers).toHaveLength(3); // airport + 2 aircraft

    const aircraftMarker = map.markers.find(marker => marker.element.dataset.flightId === '1');
    // The marker element is created imperatively and handed to MapLibre — it never joins the
    // RTL render tree, so it must be dispatched to directly rather than via screen/userEvent.
    aircraftMarker.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelectFlight).toHaveBeenCalledWith(1);
  });

  it('moves an existing marker instead of recreating it when the flight position changes', () => {
    const { rerender } = render(
      <FlightMap flights={[flight({ id: 1, latitude: 18.78, longitude: -68.12 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    const map = __state.maps[0];
    expect(map.markers).toHaveLength(2);

    rerender(
      <FlightMap flights={[flight({ id: 1, latitude: 18.8, longitude: -68.1 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    expect(map.markers).toHaveLength(2); // no new marker created
    const aircraftMarker = map.markers.find(marker => marker.element.dataset.flightId === '1');
    expect(aircraftMarker.lngLat).toEqual([-68.1, 18.8]);
  });

  it('removes a marker when its flight disappears from the flights array', () => {
    const { rerender } = render(
      <FlightMap flights={[flight({ id: 1 }), flight({ id: 2 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    const map = __state.maps[0];
    expect(map.markers).toHaveLength(3);

    rerender(<FlightMap flights={[flight({ id: 1 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    expect(map.markers).toHaveLength(2);
    expect(map.markers.some(marker => marker.element.dataset.flightId === '2')).toBe(false);
  });

  it('calls map.setStyle exactly once when the theme prop changes', () => {
    const { rerender } = render(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    const map = __state.maps[0];
    expect(map.styleCalls).toHaveLength(0);

    rerender(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="dark" />);
    expect(map.styleCalls).toHaveLength(1);
  });

  it('flies to PUJ when "Centrar PUJ" is clicked and to the initial view when "Restablecer vista" is clicked', async () => {
    const { getByLabelText } = render(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    const map = __state.maps[0];

    await userEvent.click(getByLabelText('Centrar PUJ'));
    expect(map.flyToCalls.at(-1).center).toEqual([-68.3634, 18.5674]);
    expect(map.flyToCalls.at(-1).zoom).toBe(9);

    await userEvent.click(getByLabelText('Restablecer vista'));
    expect(map.flyToCalls.at(-1).center).toEqual([-68.3634, 18.5674]);
    expect(map.flyToCalls.at(-1).zoom).toBe(6);
  });

  it('reports the projected screen position of the selected flight via onPopoverPosition', () => {
    const onPopoverPosition = vi.fn();
    render(
      <FlightMap
        flights={[flight({ id: 1, latitude: 18.78, longitude: -68.12 })]}
        selectedFlightId={1}
        onSelectFlight={() => {}}
        theme="light"
        onPopoverPosition={onPopoverPosition}
      />
    );
    // FakeMap.project([lng, lat]) => { x: lng * 10, y: lat * 10 } (see mock above).
    expect(onPopoverPosition).toHaveBeenCalledWith({ left: -681.2, top: 187.8 });
  });

  it('reports null when nothing is selected', () => {
    const onPopoverPosition = vi.fn();
    render(
      <FlightMap flights={[flight({ id: 1 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" onPopoverPosition={onPopoverPosition} />
    );
    expect(onPopoverPosition).toHaveBeenCalledWith(null);
  });

  it('recomputes the popover position when the map fires a move or zoom event', () => {
    const onPopoverPosition = vi.fn();
    render(
      <FlightMap
        flights={[flight({ id: 1, latitude: 18.78, longitude: -68.12 })]}
        selectedFlightId={1}
        onSelectFlight={() => {}}
        theme="light"
        onPopoverPosition={onPopoverPosition}
      />
    );
    const map = __state.maps[0];
    onPopoverPosition.mockClear();

    map.emit('move');
    expect(onPopoverPosition).toHaveBeenCalledWith({ left: -681.2, top: 187.8 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- FlightMap`
Expected: FAIL — `FlightMap.jsx` does not exist yet.

- [ ] **Step 5: Implement `FlightMap.jsx`**

Create `src/features/flight-monitoring/components/FlightMap.jsx`:

```jsx
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../flightMonitoringMappers';
import { createAircraftMarkerElement, updateAircraftMarkerElement } from './AircraftMarker';
import { createAirportMarkerElement } from './AirportMarker';
import { CrosshairIcon, RotateCcwIcon } from './icons';

const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const STYLE_URLS = {
  light: import.meta.env.VITE_FLIGHT_MAP_STYLE_LIGHT || DEMO_STYLE_URL,
  dark: import.meta.env.VITE_FLIGHT_MAP_STYLE_DARK || DEMO_STYLE_URL,
};
const INITIAL_ZOOM = 6;
const CENTER_ZOOM = 9;

export default function FlightMap({ flights, selectedFlightId, onSelectFlight, theme, onPopoverPosition }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const onSelectFlightRef = useRef(onSelectFlight);
  onSelectFlightRef.current = onSelectFlight;
  const isInitialThemeRef = useRef(true);

  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  const selectedFlightIdRef = useRef(selectedFlightId);
  selectedFlightIdRef.current = selectedFlightId;
  const onPopoverPositionRef = useRef(onPopoverPosition);
  onPopoverPositionRef.current = onPopoverPosition;
  const recomputePopoverPositionRef = useRef(() => {});

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URLS[theme] ?? STYLE_URLS.light,
      center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
      zoom: INITIAL_ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const airportMarker = new maplibregl.Marker({ element: createAirportMarkerElement() })
      .setLngLat([PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude])
      .addTo(map);

    // Re-projects the selected flight's lngLat to screen coordinates so FlightDetailPopover
    // (a plain React overlay, not MapLibre's own limited-styling popup) can stay pinned to its
    // aircraft through pans and zooms — reads current flights/selection via refs so this
    // listener never needs to be torn down and re-registered as those props change.
    function recomputePopoverPosition() {
      const selectedFlight = flightsRef.current.find(flight => flight.id === selectedFlightIdRef.current);
      if (!selectedFlight) {
        onPopoverPositionRef.current?.(null);
        return;
      }
      const point = map.project([selectedFlight.longitude, selectedFlight.latitude]);
      onPopoverPositionRef.current?.({ left: point.x, top: point.y });
    }
    map.on('move', recomputePopoverPosition);
    map.on('zoom', recomputePopoverPosition);

    mapRef.current = map;
    recomputePopoverPositionRef.current = recomputePopoverPosition;

    return () => {
      map.off('move', recomputePopoverPosition);
      map.off('zoom', recomputePopoverPosition);
      airportMarker.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount once; theme changes are handled by the effect below.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Skip the run that fires right after mount (same commit as the effect above) — the
    // constructor already applied this exact style; only react to genuine theme *changes*.
    if (isInitialThemeRef.current) {
      isInitialThemeRef.current = false;
      return;
    }
    map.setStyle(STYLE_URLS[theme] ?? STYLE_URLS.light);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seenIds = new Set();

    flights.forEach(flight => {
      seenIds.add(flight.id);
      const selected = flight.id === selectedFlightId;
      const existing = markers.get(flight.id);

      if (existing) {
        updateAircraftMarkerElement(existing.element, flight, { selected });
        existing.marker.setLngLat([flight.longitude, flight.latitude]);
      } else {
        const element = createAircraftMarkerElement(flight, { selected });
        element.addEventListener('click', () => onSelectFlightRef.current(flight.id));
        const marker = new maplibregl.Marker({ element }).setLngLat([flight.longitude, flight.latitude]).addTo(map);
        markers.set(flight.id, { marker, element });
      }
    });

    Array.from(markers.keys()).forEach(id => {
      if (!seenIds.has(id)) {
        markers.get(id).marker.remove();
        markers.delete(id);
      }
    });
  }, [flights, selectedFlightId]);

  useEffect(() => {
    const map = mapRef.current;
    const selectedFlight = flights.find(flight => flight.id === selectedFlightId);
    if (!map || !selectedFlight) return;
    map.flyTo({ center: [selectedFlight.longitude, selectedFlight.latitude] });
  }, [selectedFlightId, flights]);

  useEffect(() => {
    if (!mapRef.current) return;
    recomputePopoverPositionRef.current();
  }, [flights, selectedFlightId]);

  function handleResetView() {
    mapRef.current?.flyTo({ center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude], zoom: INITIAL_ZOOM });
  }

  function handleCenterPuj() {
    mapRef.current?.flyTo({ center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude], zoom: CENTER_ZOOM });
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="flight-map-container" className="h-full w-full" />
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleResetView}
          title="Restablecer vista"
          aria-label="Restablecer vista"
          className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <RotateCcwIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
        <button
          type="button"
          onClick={handleCenterPuj}
          title="Centrar PUJ"
          aria-label="Centrar PUJ"
          className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <CrosshairIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
      </div>
    </div>
  );
}
```

Note: `onSelectFlight` is captured through a ref (`onSelectFlightRef`) so a newly-created marker's click listener always calls the *latest* callback, even though the listener itself is only attached once at marker-creation time — this avoids stale closures without needing to tear down and recreate markers just because a parent re-render passed a structurally-new (but behaviorally identical) function.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- FlightMap`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env src/features/flight-monitoring/components/FlightMap.jsx src/features/flight-monitoring/components/FlightMap.test.jsx
git commit -m "feat: add FlightMap with imperative MapLibre GL integration"
```

---

## Task 19: `FlightMonitoringPage` composition

**Files:**
- Create: `src/features/flight-monitoring/FlightMonitoringPage.jsx`
- Test: `src/features/flight-monitoring/FlightMonitoringPage.test.jsx`

**Interfaces:**
- Consumes: `FlightToolbar` (Task 13), `FlightListPanel` (Task 12), `FlightMap` (Task 18), `FlightLegend` (Task 14), `FlightDetailPopover` (Task 15), `FlightToastStack` (Task 16), `FlightMonitoringSkeleton` (Task 11), `useFlightMonitoringFilters` (Task 6), `useFlightAlerts` (Task 5), `getFilterOptions` (Task 2).
- Produces: `<FlightMonitoringPage status data error connection lastUpdatedAt onRetry forceState theme />`. Owns `selectedFlightId`, `popoverPosition` (fed by `FlightMap`'s `onPopoverPosition` callback and passed straight through as `FlightDetailPopover`'s `style`), and the `now` ticker (seeded once, ticked every 30s — same pattern as `PlanningPage`). Consumed by `AppShell` (Task 21).
- This task does **not** touch the real `maplibre-gl` package — its test stubs out `FlightMap` entirely (already covered by Task 18) so it can focus on composition and state wiring.

- [ ] **Step 1: Write the failing test**

Create `src/features/flight-monitoring/FlightMonitoringPage.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightMonitoringPage from './FlightMonitoringPage';

vi.mock('./components/FlightMap', () => ({
  default: function FlightMapStub(props) {
    return <div data-testid="flight-map-stub" data-selected={String(props.selectedFlightId)} />;
  },
}));

function flight(overrides) {
  return {
    id: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    registration: 'HI1024',
    aircraft: 'B737 MAX 8',
    status: 'approaching',
    eta: '2026-08-06T14:20:00-04:00',
    etd: '2026-08-06T15:05:00-04:00',
    stand: 'A5',
    supervisor: 'Juan Pérez',
    agents: 5,
    heading: 310,
    speed: 250,
    altitude: 8000,
    latitude: 18.7,
    longitude: -68.5,
    services: ['GPU'],
    ...overrides,
  };
}

const DATA = {
  station: { code: 'PUJ' },
  flights: [flight({ id: 1 }), flight({ id: 2, flightNumber: 'AA904', status: 'delayed' })],
};

describe('FlightMonitoringPage', () => {
  it('shows the skeleton while loading', () => {
    render(
      <FlightMonitoringPage status="loading" data={null} error={null} connection="syncing" lastUpdatedAt={null} onRetry={() => {}} />
    );
    expect(screen.getByTestId('flight-monitoring-skeleton')).toBeInTheDocument();
  });

  it('shows the error panel and retries on click', async () => {
    const onRetry = vi.fn();
    render(
      <FlightMonitoringPage
        status="error"
        data={null}
        error={new Error('boom')}
        connection="disconnected"
        lastUpdatedAt={null}
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el monitoreo de vuelos de la estación.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the toolbar, list, and map once data loads', () => {
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt="2026-08-06T14:00:00-04:00" onRetry={() => {}} />
    );
    expect(screen.getByText('FlyAware conectado')).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('AA904')).toBeInTheDocument();
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
  });

  it('shows the empty state instead of the list when the snapshot has no flights, while the map still renders', () => {
    render(
      <FlightMonitoringPage
        status="success"
        data={{ station: { code: 'PUJ' }, flights: [] }}
        error={null}
        connection="connected"
        lastUpdatedAt={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Sin vuelos para mostrar')).toBeInTheDocument();
    expect(screen.getByTestId('flight-map-stub')).toBeInTheDocument();
  });

  it('selects a flight when its list item is clicked, opening the detail popover and passing the id to the map', async () => {
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );
    await userEvent.click(screen.getByText('DM161'));
    expect(screen.getByRole('dialog', { name: /DM161/ })).toBeInTheDocument();
    expect(screen.getByTestId('flight-map-stub')).toHaveAttribute('data-selected', '1');
  });

  it('honors the monitoringEmpty forceState override from the dev preview panel', () => {
    render(
      <FlightMonitoringPage
        status="success"
        data={DATA}
        error={null}
        connection="connected"
        lastUpdatedAt={null}
        onRetry={() => {}}
        forceState="monitoringEmpty"
      />
    );
    expect(screen.getByText('Sin vuelos para mostrar')).toBeInTheDocument();
  });

  it('shows disconnected when forceState is monitoringDisconnected, overriding the real connection prop', () => {
    render(
      <FlightMonitoringPage
        status="success"
        data={DATA}
        error={null}
        connection="connected"
        lastUpdatedAt={null}
        onRetry={() => {}}
        forceState="monitoringDisconnected"
      />
    );
    expect(screen.getByText('FlyAware desconectado')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightMonitoringPage`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightMonitoringPage.jsx`**

Create `src/features/flight-monitoring/FlightMonitoringPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import FlightToolbar from './components/FlightToolbar';
import FlightListPanel from './components/FlightListPanel';
import FlightMap from './components/FlightMap';
import FlightLegend from './components/FlightLegend';
import FlightDetailPopover from './components/FlightDetailPopover';
import FlightToastStack from './components/FlightToast';
import FlightMonitoringSkeleton from './components/FlightMonitoringSkeleton';
import { useFlightMonitoringFilters } from './useFlightMonitoringFilters';
import { useFlightAlerts } from './useFlightAlerts';
import { getFilterOptions } from './flightMonitoringMappers';

export default function FlightMonitoringPage({
  status,
  data,
  error,
  connection,
  lastUpdatedAt,
  onRetry,
  forceState = 'default',
  theme = 'light',
}) {
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'monitoringError';

  const flights = forceState === 'monitoringEmpty' ? [] : data?.flights ?? [];
  const displayConnection = forceState === 'monitoringDisconnected' ? 'disconnected' : connection;

  const {
    filters,
    setFilter,
    activeChip,
    setActiveChip,
    onlyStationRelated,
    setOnlyStationRelated,
    filteredFlights,
  } = useFlightMonitoringFilters(flights);
  const { toasts, dismissToast } = useFlightAlerts(flights, displayConnection);

  const options = getFilterOptions(flights);
  const selectedFlight = flights.find(flight => flight.id === selectedFlightId) ?? null;
  const emptyReason = flights.length === 0 ? 'no-flights' : filteredFlights.length === 0 ? 'no-results' : null;

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">
          No se pudo cargar el monitoreo de vuelos de la estación.
        </p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-[1440px] flex-col gap-4">
      <FlightToolbar
        connection={displayConnection}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={onRetry}
        filters={filters}
        onFilterChange={setFilter}
        options={options}
        onlyStationRelated={onlyStationRelated}
        onToggleStationRelated={setOnlyStationRelated}
      />

      {isLoading ? (
        <FlightMonitoringSkeleton />
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[3fr_7fr]">
          <FlightListPanel
            flights={filteredFlights}
            emptyReason={emptyReason}
            search={filters.search}
            onSearchChange={value => setFilter('search', value)}
            activeChip={activeChip}
            onChipChange={setActiveChip}
            selectedFlightId={selectedFlightId}
            onSelectFlight={setSelectedFlightId}
          />

          <div className="relative min-h-[420px]">
            <FlightMap
              flights={filteredFlights}
              selectedFlightId={selectedFlightId}
              onSelectFlight={setSelectedFlightId}
              theme={theme}
              onPopoverPosition={setPopoverPosition}
            />
            <FlightLegend />
            <FlightDetailPopover
              flight={selectedFlight}
              now={now}
              style={popoverPosition ?? {}}
              onClose={() => setSelectedFlightId(null)}
            />
          </div>
        </div>
      )}

      <FlightToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightMonitoringPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/flight-monitoring/FlightMonitoringPage.jsx src/features/flight-monitoring/FlightMonitoringPage.test.jsx
git commit -m "feat: add FlightMonitoringPage composition"
```

---

## Task 20: Extend `DevPreviewPanel` with Flight Monitoring forced states

**Files:**
- Modify: `src/features/dashboard/components/DevPreviewPanel.jsx`
- Modify: `src/features/dashboard/components/DevPreviewPanel.test.jsx`

**Interfaces:**
- Produces: `STATE_BUTTONS` gains three entries — `{ state: 'monitoringEmpty', label: 'Monitoreo: sin vuelos' }`, `{ state: 'monitoringError', label: 'Monitoreo: error' }`, `{ state: 'monitoringDisconnected', label: 'Monitoreo: FlyAware desconectado' }` — alongside the existing Dashboard/Planning entries. No existing entry changes. `forceState` values match exactly what `FlightMonitoringPage` (Task 19) already checks for (`monitoringEmpty`, `monitoringError`, `monitoringDisconnected`).

- [ ] **Step 1: Write the failing test**

Add to `src/features/dashboard/components/DevPreviewPanel.test.jsx` (after the existing `it('exposes the Planning-module forced states', ...)` block):

```jsx
  it('exposes the Flight Monitoring forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel theme="light" forceState="default" onToggleTheme={() => {}} onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /monitoreo: sin vuelos/i }));
    expect(onSetForceState).toHaveBeenCalledWith('monitoringEmpty');

    await userEvent.click(screen.getByRole('button', { name: /monitoreo: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('monitoringError');

    await userEvent.click(screen.getByRole('button', { name: /monitoreo: flyaware desconectado/i }));
    expect(onSetForceState).toHaveBeenCalledWith('monitoringDisconnected');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DevPreviewPanel`
Expected: FAIL — no button matches "monitoreo: sin vuelos" (etc.), since the entries don't exist yet.

- [ ] **Step 3: Add the new entries**

In `src/features/dashboard/components/DevPreviewPanel.jsx`, replace the `STATE_BUTTONS` array with:

```js
const STATE_BUTTONS = [
  { state: 'default', label: 'Normal' },
  { state: 'loading', label: 'Carga' },
  { state: 'flyAwareError', label: 'FlyAware caído' },
  { state: 'emptyApprovals', label: 'Sin aprobaciones' },
  { state: 'planningEmpty', label: 'Planificación: sin vuelos' },
  { state: 'planningNoResults', label: 'Planificación: sin resultados' },
  { state: 'planningError', label: 'Planificación: error' },
  { state: 'monitoringEmpty', label: 'Monitoreo: sin vuelos' },
  { state: 'monitoringError', label: 'Monitoreo: error' },
  { state: 'monitoringDisconnected', label: 'Monitoreo: FlyAware desconectado' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- DevPreviewPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/DevPreviewPanel.jsx src/features/dashboard/components/DevPreviewPanel.test.jsx
git commit -m "feat: add Flight Monitoring forced-state buttons to the dev preview panel"
```

---

## Task 21: Wire `FlightMonitoringPage` into `AppShell`'s module switcher

**Files:**
- Modify: `src/features/shell/AppShell.jsx`
- Modify: `src/features/shell/AppShell.test.jsx`

**Interfaces:**
- Consumes: `useFlightMonitoringData` (Task 4), `FlightMonitoringPage` (Task 19).
- Produces: `AppShell` renders `<FlightMonitoringPage />` when `activeModule.id === MODULE_IDS.FLIGHT_MONITORING`, in the same `if/else` chain that already handles `DashboardPage`/`PlanningPage`/`ModulePlaceholder`. No other module's branch changes.
- This test must **not** exercise the real `maplibre-gl` package (jsdom has no WebGL) — it mocks `FlightMap` (the one part of the tree that touches MapLibre) the same way Task 19's own test does, rather than mocking `maplibre-gl` a second time here.

- [ ] **Step 1: Write the failing test**

The existing file already has an analogous test for Planning (`'switches to the Planning module and renders the real planning screen'`), which mocks `dashboardService.getDashboardSnapshot`, then `planningService.getPlanningSnapshot`, then clicks `within(nav).getByText('Planificación operativa')` and asserts on `PlanningPage`'s heading. Follow that exact same shape for Flight Monitoring. Add these two imports to the top of `src/features/shell/AppShell.test.jsx`, alongside the existing `dashboardService`/`planningService` imports:

```js
import * as flightMonitoringService from '../../services/flightMonitoringService';
```

Add this mock right below the file's imports (it must be hoisted the same way Vitest hoists any `vi.mock` call — place it before the `describe` block):

```js
vi.mock('../flight-monitoring/components/FlightMap', () => ({
  default: function FlightMapStub() {
    return <div data-testid="flight-map-stub" />;
  },
}));
```

Add the test itself inside the existing `describe('AppShell', ...)` block, after the Planning test:

```jsx
  it('switches to the Flight Monitoring module and renders the real monitoring screen', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    vi.spyOn(flightMonitoringService, 'getFlightMonitoringSnapshot').mockResolvedValue({
      station: { code: 'PUJ' },
      flights: [],
    });
    vi.spyOn(flightMonitoringService, 'subscribeToFlightUpdates').mockReturnValue(() => {});
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Monitoreo de vuelos'));

    expect(await screen.findByText('FlyAware conectado')).toBeInTheDocument();
    expect(within(nav).getByText('Monitoreo de vuelos').closest('button')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AppShell`
Expected: FAIL — clicking the sidebar item still renders `ModulePlaceholder`, not `FlightMonitoringPage`.

- [ ] **Step 3: Wire the module into `AppShell.jsx`**

In `src/features/shell/AppShell.jsx`, add the two new imports alongside the existing Planning ones:

```js
import FlightMonitoringPage from '../flight-monitoring/FlightMonitoringPage';
import { useFlightMonitoringData } from '../flight-monitoring/useFlightMonitoringData';
```

Add a retry-token state and the hook call alongside the existing `planningRetryToken`/`usePlanningData` pair:

```js
  const [monitoringRetryToken, setMonitoringRetryToken] = useState(0);
  const monitoring = useFlightMonitoringData('PUJ', monitoringRetryToken);
```

Extend the render branch (the existing `activeModule.id === MODULE_IDS.PLANNING ? (...) : (` chain) with a new branch immediately after the Planning one:

```jsx
          ) : activeModule.id === MODULE_IDS.FLIGHT_MONITORING ? (
            <FlightMonitoringPage
              status={monitoring.status}
              data={monitoring.data}
              error={monitoring.error}
              connection={monitoring.connection}
              lastUpdatedAt={monitoring.lastUpdatedAt}
              onRetry={() => setMonitoringRetryToken(token => token + 1)}
              forceState={forceState}
              theme={theme}
            />
          ) : (
```

(This replaces the previous line `) : (` that immediately preceded the `ModulePlaceholder` fallback — the fallback itself is untouched, it just now sits one branch further down.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AppShell`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — every test across Dashboard, Planning, and Flight Monitoring passes together.

- [ ] **Step 6: Commit**

```bash
git add src/features/shell/AppShell.jsx src/features/shell/AppShell.test.jsx
git commit -m "feat: wire FlightMonitoringPage into AppShell's module switcher"
```

---

## Task 22: Tablet Drawer for the flight list

**Files:**
- Create: `src/features/flight-monitoring/useIsTabletBreakpoint.js`
- Create: `src/features/flight-monitoring/useIsTabletBreakpoint.test.js`
- Create: `src/features/flight-monitoring/components/FlightListDrawer.jsx`
- Create: `src/features/flight-monitoring/components/FlightListDrawer.test.jsx`
- Modify: `src/features/flight-monitoring/FlightMonitoringPage.jsx`
- Modify: `src/features/flight-monitoring/FlightMonitoringPage.test.jsx`

**Interfaces:**
- Produces: `useIsTabletBreakpoint() => boolean` (mirrors the same `(max-width: 1024px)` breakpoint already used by `src/features/shell/useResponsiveSidebar.js`'s `TABLET_QUERY`, duplicated locally rather than shared cross-feature, matching this codebase's existing convention of not importing one feature's internals into another). `<FlightListDrawer open={boolean} onClose={() => void}>{children}</FlightListDrawer>` — an overlay+backdrop wrapper, visually modeled on `PlanningDrawer.jsx`'s existing glass treatment, but sliding in from the left (the list panel's natural side) rather than the right.
- `FlightMonitoringPage` (Task 19) is modified to: render the desktop 30/70 split when `!isTablet` (unchanged from Task 19); render `FlightMap`/`FlightLegend`/`FlightDetailPopover` full-width plus a "Ver vuelos" toggle button when `isTablet`, opening `FlightListPanel` inside `FlightListDrawer`; auto-close the drawer if the viewport grows back past the tablet breakpoint while it's open. A `MonitoringMapArea` helper (private to this file, not exported) factors out the `FlightMap`+`FlightLegend`+`FlightDetailPopover` trio so it isn't duplicated between the two layout branches.

- [ ] **Step 1: Write the failing test for the breakpoint hook**

Create `src/features/flight-monitoring/useIsTabletBreakpoint.test.js`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsTabletBreakpoint } from './useIsTabletBreakpoint';

function mockMatchMedia(matchingQueries) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: matchingQueries.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('useIsTabletBreakpoint', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('is false when the tablet media query does not match', () => {
    mockMatchMedia([]);
    const { result } = renderHook(() => useIsTabletBreakpoint());
    expect(result.current).toBe(false);
  });

  it('is true when the tablet media query matches', () => {
    mockMatchMedia(['(max-width: 1024px)']);
    const { result } = renderHook(() => useIsTabletBreakpoint());
    expect(result.current).toBe(true);
  });

  it('defaults to false when matchMedia is unavailable', () => {
    window.matchMedia = undefined;
    const { result } = renderHook(() => useIsTabletBreakpoint());
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useIsTabletBreakpoint`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `useIsTabletBreakpoint.js`**

Create `src/features/flight-monitoring/useIsTabletBreakpoint.js`:

```js
import { useEffect, useState } from 'react';

// Matches TABLET_QUERY in src/features/shell/useResponsiveSidebar.js — same
// breakpoint the Sidebar itself switches to its tablet/overlay behavior at.
const TABLET_QUERY = '(max-width: 1024px)';

function matchesTablet() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(TABLET_QUERY).matches);
}

export function useIsTabletBreakpoint() {
  const [isTablet, setIsTablet] = useState(matchesTablet);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(TABLET_QUERY);
    const onChange = event => setIsTablet(event.matches);
    mql.addEventListener('change', onChange);
    setIsTablet(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isTablet;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useIsTabletBreakpoint`
Expected: PASS.

- [ ] **Step 5: Commit the hook**

```bash
git add src/features/flight-monitoring/useIsTabletBreakpoint.js src/features/flight-monitoring/useIsTabletBreakpoint.test.js
git commit -m "feat: add useIsTabletBreakpoint hook"
```

- [ ] **Step 6: Write the failing test for the drawer component**

Create `src/features/flight-monitoring/components/FlightListDrawer.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightListDrawer from './FlightListDrawer';

describe('FlightListDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <FlightListDrawer open={false} onClose={() => {}}>
        <p>contenido</p>
      </FlightListDrawer>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders its children and a backdrop when open', () => {
    render(
      <FlightListDrawer open onClose={() => {}}>
        <p>contenido</p>
      </FlightListDrawer>
    );
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.getByTestId('flight-list-drawer-backdrop')).toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(
      <FlightListDrawer open onClose={onClose}>
        <p>contenido</p>
      </FlightListDrawer>
    );
    await userEvent.click(screen.getByTestId('flight-list-drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- FlightListDrawer`
Expected: FAIL — module does not exist.

- [ ] **Step 8: Implement `FlightListDrawer.jsx`**

Create `src/features/flight-monitoring/components/FlightListDrawer.jsx`:

```jsx
export default function FlightListDrawer({ open, onClose, children }) {
  if (!open) return null;

  return (
    <>
      <div
        data-testid="flight-list-drawer-backdrop"
        className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
      />
      <aside
        data-testid="flight-list-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Lista de vuelos"
        className="fixed inset-y-0 left-0 z-50 w-full max-w-sm overflow-y-auto border-r border-black/5 bg-white/95 p-3 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card"
      >
        {children}
      </aside>
    </>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- FlightListDrawer`
Expected: PASS.

- [ ] **Step 10: Commit the drawer**

```bash
git add src/features/flight-monitoring/components/FlightListDrawer.jsx src/features/flight-monitoring/components/FlightListDrawer.test.jsx
git commit -m "feat: add FlightListDrawer overlay component"
```

- [ ] **Step 11: Write the failing tests for the tablet layout in `FlightMonitoringPage`**

Add to `src/features/flight-monitoring/FlightMonitoringPage.test.jsx`, as a new `describe` block after the existing one (it needs its own `mockMatchMedia` helper, same shape as the one in `useResponsiveSidebar.test.js`):

```jsx
function mockMatchMedia(matchingQueries) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: matchingQueries.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('FlightMonitoringPage — tablet layout', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders the full inline split with no toggle on desktop', () => {
    mockMatchMedia([]);
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );
    expect(screen.getByTestId('flight-list-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver vuelos' })).not.toBeInTheDocument();
  });

  it('hides the inline list panel and shows a "Ver vuelos" toggle on tablet', () => {
    mockMatchMedia(['(max-width: 1024px)']);
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );
    expect(screen.queryByTestId('flight-list-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver vuelos' })).toBeInTheDocument();
  });

  it('opens the list drawer when the toggle is clicked, and closes it via the backdrop', async () => {
    mockMatchMedia(['(max-width: 1024px)']);
    render(
      <FlightMonitoringPage status="success" data={DATA} error={null} connection="connected" lastUpdatedAt={null} onRetry={() => {}} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ver vuelos' }));
    expect(screen.getByTestId('flight-list-drawer')).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('flight-list-drawer-backdrop'));
    expect(screen.queryByTestId('flight-list-drawer')).not.toBeInTheDocument();
  });
});
```

You will also need to import `afterEach` from `vitest` at the top of this test file if it isn't already imported.

- [ ] **Step 12: Run test to verify it fails**

Run: `npm test -- FlightMonitoringPage`
Expected: FAIL — `FlightMonitoringPage` always renders the desktop split today; there is no "Ver vuelos" button and no drawer.

- [ ] **Step 13: Wire the tablet layout into `FlightMonitoringPage.jsx`**

Replace the full contents of `src/features/flight-monitoring/FlightMonitoringPage.jsx` with:

```jsx
import { useEffect, useState } from 'react';
import FlightToolbar from './components/FlightToolbar';
import FlightListPanel from './components/FlightListPanel';
import FlightListDrawer from './components/FlightListDrawer';
import FlightMap from './components/FlightMap';
import FlightLegend from './components/FlightLegend';
import FlightDetailPopover from './components/FlightDetailPopover';
import FlightToastStack from './components/FlightToast';
import FlightMonitoringSkeleton from './components/FlightMonitoringSkeleton';
import { useFlightMonitoringFilters } from './useFlightMonitoringFilters';
import { useFlightAlerts } from './useFlightAlerts';
import { useIsTabletBreakpoint } from './useIsTabletBreakpoint';
import { getFilterOptions } from './flightMonitoringMappers';

function MonitoringMapArea({
  flights,
  selectedFlightId,
  onSelectFlight,
  theme,
  onPopoverPosition,
  popoverPosition,
  selectedFlight,
  now,
  onClosePopover,
}) {
  return (
    <div className="relative min-h-[420px] flex-1">
      <FlightMap
        flights={flights}
        selectedFlightId={selectedFlightId}
        onSelectFlight={onSelectFlight}
        theme={theme}
        onPopoverPosition={onPopoverPosition}
      />
      <FlightLegend />
      <FlightDetailPopover flight={selectedFlight} now={now} style={popoverPosition ?? {}} onClose={onClosePopover} />
    </div>
  );
}

export default function FlightMonitoringPage({
  status,
  data,
  error,
  connection,
  lastUpdatedAt,
  onRetry,
  forceState = 'default',
  theme = 'light',
}) {
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [listDrawerOpen, setListDrawerOpen] = useState(false);
  const isTablet = useIsTabletBreakpoint();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isTablet) setListDrawerOpen(false);
  }, [isTablet]);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'monitoringError';

  const flights = forceState === 'monitoringEmpty' ? [] : data?.flights ?? [];
  const displayConnection = forceState === 'monitoringDisconnected' ? 'disconnected' : connection;

  const {
    filters,
    setFilter,
    activeChip,
    setActiveChip,
    onlyStationRelated,
    setOnlyStationRelated,
    filteredFlights,
  } = useFlightMonitoringFilters(flights);
  const { toasts, dismissToast } = useFlightAlerts(flights, displayConnection);

  const options = getFilterOptions(flights);
  const selectedFlight = flights.find(flight => flight.id === selectedFlightId) ?? null;
  const emptyReason = flights.length === 0 ? 'no-flights' : filteredFlights.length === 0 ? 'no-results' : null;

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">
          No se pudo cargar el monitoreo de vuelos de la estación.
        </p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const listPanel = (
    <FlightListPanel
      flights={filteredFlights}
      emptyReason={emptyReason}
      search={filters.search}
      onSearchChange={value => setFilter('search', value)}
      activeChip={activeChip}
      onChipChange={setActiveChip}
      selectedFlightId={selectedFlightId}
      onSelectFlight={setSelectedFlightId}
    />
  );

  const mapArea = (
    <MonitoringMapArea
      flights={filteredFlights}
      selectedFlightId={selectedFlightId}
      onSelectFlight={setSelectedFlightId}
      theme={theme}
      onPopoverPosition={setPopoverPosition}
      popoverPosition={popoverPosition}
      selectedFlight={selectedFlight}
      now={now}
      onClosePopover={() => setSelectedFlightId(null)}
    />
  );

  return (
    <div className="mx-auto flex h-full max-w-[1440px] flex-col gap-4">
      <FlightToolbar
        connection={displayConnection}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={onRetry}
        filters={filters}
        onFilterChange={setFilter}
        options={options}
        onlyStationRelated={onlyStationRelated}
        onToggleStationRelated={setOnlyStationRelated}
      />

      {isLoading ? (
        <FlightMonitoringSkeleton />
      ) : isTablet ? (
        <div className="relative flex flex-1 flex-col">
          {mapArea}
          <button
            type="button"
            onClick={() => setListDrawerOpen(true)}
            className="absolute left-3 top-3 z-10 rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink-900 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
          >
            Ver vuelos
          </button>
          <FlightListDrawer open={listDrawerOpen} onClose={() => setListDrawerOpen(false)}>
            {listPanel}
          </FlightListDrawer>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[3fr_7fr]">
          {listPanel}
          {mapArea}
        </div>
      )}

      <FlightToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `npm test -- FlightMonitoringPage`
Expected: PASS — including every test from Task 19 (they don't mock `matchMedia`, so `useIsTabletBreakpoint` defaults to `false` and the desktop split still renders exactly as before).

- [ ] **Step 15: Run the full test suite**

Run: `npm test`
Expected: PASS — every test across Dashboard, Planning, and Flight Monitoring passes together.

- [ ] **Step 16: Commit**

```bash
git add src/features/flight-monitoring/FlightMonitoringPage.jsx src/features/flight-monitoring/FlightMonitoringPage.test.jsx
git commit -m "feat: add tablet Drawer layout for the flight list panel"
```

---
