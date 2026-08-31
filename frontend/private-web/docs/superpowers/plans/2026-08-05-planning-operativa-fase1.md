# Planificación Operativa (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Fase 1 of the "Planificación Operativa" module for ELEVANT's Administrador/OCC role: the operational screen where the OCC reviews the day's flights on a Timeline, filters/searches them, sees KPIs and pre-baked conflict flags, and opens a read-only detail Drawer per flight — all with mocked data shaped like the future real API response.

**Architecture:** A standalone feature under `src/features/planning/`, following the exact pattern already established by `src/features/dashboard/`: a `PlanningPage` composed from small presentational components, fed by `usePlanningData` over a `planningService.js` mock adapter. Client-side filtering lives in a `usePlanningFilters` hook; pure data-shaping helpers live in `planningMappers.js`. The page is wired into the existing `AppShell.jsx` module switcher (`MODULE_IDS.PLANNING` already exists), replacing today's `ModulePlaceholder` for that module. No router, no new dependencies.

**Tech Stack:** React 18, Vite 6, Tailwind CSS 3 (existing tokens only), Vitest + React Testing Library + jsdom (already configured).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-05-planning-operational-design.md` — follow it exactly for scope, layout, and component boundaries. Fase 2 (functional Drawer actions) is explicitly out of scope for this plan.
- Reuse existing components/utilities instead of duplicating: `KpiCard`, `StatusBadge`, `getStatusMeta`/`STATUS_COLORS` (`src/features/dashboard/statusMeta.js`), `formatClockTime` (`src/features/dashboard/mappers.js`), `ModulePlaceholder` (`src/features/shell/components/ModulePlaceholder.jsx`), and icons already defined in `src/features/dashboard/components/icons/index.jsx` (`PlaneIcon`, `ChecklistIcon`, `MapPinIcon`, `AlertTriangleIcon`, `UsersIcon`, `RefreshCwIcon`). Cross-feature imports of these are an established pattern in this codebase (e.g. `Sidebar.jsx` already imports `ChevronDownIcon` from the dashboard icon module) — do not recreate them under `planning/`.
- Only create new icons for what doesn't already exist: `PlusIcon`, `UploadIcon`, `DownloadIcon`, `SearchIcon`, `PencilIcon`, `EyeIcon`, `ClipboardIcon`, `XIcon`, under `src/features/planning/components/icons.jsx`, same hand-made line style (stroke ~1.7, viewBox `0 0 24 24`, `aria-hidden="true"`) as the existing set.
- Color tokens (exact hex, do not introduce any other color) — same as the Dashboard's:
  - `ink-900` `#0B1F3F`, `accent-600` `#145DC4`, `signal-500` `#F2661E`
  - Light: bg `#F7F9FB`, card `#FFFFFF`, text primary `#0B1F3F`, text secondary `#6B7684`
  - Dark: bg `#0A1220`, card `rgba(11,31,63,0.55)`, text primary `#F4F6F9`, text secondary `#94A3B8`
  - Status: info `#145DC4`, active `#F2661E`, success `#1E9E6B`, warning `#D9A441`, danger `#C4453C`
- Typography: Inter for UI/body/headings; IBM Plex Mono for flight numbers, airline codes, positions, timestamps (`font-mono` utility, already configured).
- Dark mode via existing Tailwind `class` strategy — both modes must reach the same polish level, every new component needs `dark:` variants matching the existing ones' conventions.
- All UI text is Spanish. Zero emojis anywhere.
- No router, no real API calls — mocked data only, shaped like the documented contract in the spec.
- Conflicts are pre-baked mock flags (`flight.conflict: null | { reason: string }`) — do not implement client-side overlap-detection logic in this phase.
- Drawer action buttons (`Editar planificación`, `Asignar recursos`, `Crear Work Order`) and header actions (`Nuevo vuelo`, `Importar vuelos`, `Exportar`) are rendered **disabled** with `title="Próximamente"` in this phase. Only the header's `Actualizar` action is live.
- Time-based logic that needs "now" (countdown, forced preview states) must take `now`/`nowIso` as an explicit parameter, never call `Date.now()`/`new Date()` internally in a way that breaks deterministic testing — the one exception is `PlanningPage`'s own `now` state, which is seeded once via `useState(() => new Date().toISOString())` and ticked by a `setInterval`, exactly like a live clock would work, and is passed down as a prop everywhere else.

---

## Task 1: Extend `statusMeta.js` with the Planning flight statuses

**Files:**
- Modify: `src/features/dashboard/statusMeta.js`
- Modify: `src/features/dashboard/statusMeta.test.js`

**Interfaces:**
- Produces: `FLIGHT_STATUS_META` gains keys `boarding`, `taxiing`, `arrived` alongside its existing `scheduled`, `enRoute`, `landed`, `delayed`, `diverted`, `cancelled`. `getStatusMeta('flight', <newKey>)` returns `{ label, color }` for each. No existing key's label/color changes.

- [ ] **Step 1: Write the failing test for the new statuses**

Add to `src/features/dashboard/statusMeta.test.js` (inside the existing `describe('getStatusMeta', ...)` block, after the first `it`):

```js
  it('maps the Planning-module flight statuses to label and color', () => {
    expect(getStatusMeta('flight', 'boarding')).toEqual({ label: 'Abordando', color: 'active' });
    expect(getStatusMeta('flight', 'taxiing')).toEqual({ label: 'Rodaje', color: 'active' });
    expect(getStatusMeta('flight', 'arrived')).toEqual({ label: 'En posición', color: 'success' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- statusMeta`
Expected: FAIL — `boarding`/`taxiing`/`arrived` are undefined, so `getStatusMeta` falls back to `{ label: status, color: 'info' }`.

- [ ] **Step 3: Add the new keys**

In `src/features/dashboard/statusMeta.js`, replace the `FLIGHT_STATUS_META` object with:

```js
export const FLIGHT_STATUS_META = {
  scheduled: { label: 'Programado', color: 'info' },
  boarding: { label: 'Abordando', color: 'active' },
  taxiing: { label: 'Rodaje', color: 'active' },
  enRoute: { label: 'En ruta', color: 'active' },
  landed: { label: 'Aterrizado', color: 'success' },
  arrived: { label: 'En posición', color: 'success' },
  delayed: { label: 'Retrasado', color: 'warning' },
  diverted: { label: 'Desviado', color: 'danger' },
  cancelled: { label: 'Cancelado', color: 'danger' },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- statusMeta`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/statusMeta.js src/features/dashboard/statusMeta.test.js
git commit -m "feat: extend flight status metadata for Planning module"
```

---

## Task 2: `planningService.js` mock adapter

**Files:**
- Create: `src/services/planningService.js`
- Test: `src/services/planningService.test.js`

**Interfaces:**
- Produces: `getPlanningSnapshot(stationCode?: string, dateISO?: string) => Promise<{ station: { code, localAbbr }, date: string, flights: Flight[] }>` where each `Flight` has `{ id, flightNumber, airlineIata, airlineName, status, scheduledTime, estimatedTime, origin, destination, aircraftType, position, station, supervisor, agents, teams, services, conflict, observations, history }`, matching the design spec's contract. This is the only function later tasks import from this module.

- [ ] **Step 1: Write the failing test**

Create `src/services/planningService.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { getPlanningSnapshot } from './planningService';

describe('getPlanningSnapshot', () => {
  it('resolves with station, date, and a flights array shaped like the documented contract', async () => {
    const snapshot = await getPlanningSnapshot();
    expect(snapshot).toEqual(
      expect.objectContaining({
        station: expect.objectContaining({ code: 'PUJ' }),
        date: expect.any(String),
        flights: expect.any(Array),
      })
    );
    expect(snapshot.flights.length).toBe(20);
    for (const flight of snapshot.flights) {
      expect(flight).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          flightNumber: expect.any(String),
          airlineIata: expect.any(String),
          airlineName: expect.any(String),
          status: expect.any(String),
          scheduledTime: expect.any(String),
          estimatedTime: expect.any(String),
          origin: expect.any(String),
          destination: expect.any(String),
          aircraftType: expect.any(String),
          station: 'PUJ',
          agents: expect.any(Array),
          teams: expect.any(Array),
          services: expect.any(Array),
          observations: expect.any(String),
          history: expect.any(Array),
        })
      );
    }
  });

  it('reflects the requested station code on every flight', async () => {
    const snapshot = await getPlanningSnapshot('MDT');
    expect(snapshot.station.code).toBe('MDT');
    expect(snapshot.flights.every(flight => flight.station === 'MDT')).toBe(true);
  });

  it('defaults the operation date when none is requested', async () => {
    const snapshot = await getPlanningSnapshot();
    expect(snapshot.date).toBe('2026-08-05');
  });

  it('includes two flights sharing position B21 with linked conflict reasons', async () => {
    const snapshot = await getPlanningSnapshot();
    const conflicted = snapshot.flights.filter(flight => flight.conflict !== null);
    expect(conflicted).toHaveLength(2);
    expect(conflicted.map(flight => flight.position)).toEqual(['B21', 'B21']);
    expect(conflicted[0].conflict.reason).toContain('DL2210');
    expect(conflicted[1].conflict.reason).toContain('AA904');
  });

  it('includes at least one flight pending assignment (no position or no agents)', async () => {
    const snapshot = await getPlanningSnapshot();
    const pending = snapshot.flights.filter(flight => !flight.position || flight.agents.length === 0);
    expect(pending.length).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- planningService`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `planningService.js`**

Create `src/services/planningService.js`:

```js
const OPERATION_DATE = '2026-08-05';

const FLIGHT_TEMPLATES = [
  { id: 'flt-1', flightNumber: 'DM161', airlineIata: 'DM', airlineName: 'ARAJET', status: 'scheduled', hour: 8, minute: 5, origin: 'PUJ', destination: 'JFK', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['M. Castillo', 'R. Peña'], teams: ['Rampa 2'], services: ['Combustible', 'Catering'], conflictReason: null, observations: '', history: [{ at: `${OPERATION_DATE}T07:00:00-04:00`, note: 'Planificación creada' }] },
  { id: 'flt-2', flightNumber: 'AA904', airlineIata: 'AA', airlineName: 'AMERICAN', status: 'delayed', hour: 8, minute: 20, delayMinutes: 30, origin: 'PUJ', destination: 'MIA', aircraftType: 'B737-800', position: 'B21', supervisor: 'K. Objío', agents: [], teams: [], services: [], conflictReason: 'Posición B21 con doble asignación (ver DL2210)', observations: 'Pendiente de asignación de agentes.', history: [] },
  { id: 'flt-3', flightNumber: 'DL2210', airlineIata: 'DL', airlineName: 'DELTA', status: 'scheduled', hour: 8, minute: 20, origin: 'MIA', destination: 'PUJ', aircraftType: 'A321neo', position: 'B21', supervisor: 'R. Peña', agents: ['J. Fermín'], teams: ['Rampa 1'], services: ['Equipaje'], conflictReason: 'Posición B21 con doble asignación (ver AA904)', observations: '', history: [] },
  { id: 'flt-4', flightNumber: 'B6289', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'boarding', hour: 9, minute: 10, origin: 'PUJ', destination: 'JFK', aircraftType: 'B787', position: 'A1', supervisor: 'M. Castillo', agents: ['K. Objío', 'R. Peña'], teams: ['Rampa 3'], services: ['Equipaje', 'Limpieza'], conflictReason: null, observations: '', history: [{ at: `${OPERATION_DATE}T08:40:00-04:00`, note: 'Abordaje iniciado' }] },
  { id: 'flt-5', flightNumber: 'UA1470', airlineIata: 'UA', airlineName: 'UNITED', status: 'scheduled', hour: 9, minute: 40, origin: 'PUJ', destination: 'EWR', aircraftType: 'A330', position: null, supervisor: null, agents: [], teams: [], services: [], conflictReason: null, observations: 'Pendiente de asignación de posición y agentes.', history: [] },
  { id: 'flt-6', flightNumber: 'AC1876', airlineIata: 'AC', airlineName: 'AIRCANADA', status: 'taxiing', hour: 10, minute: 0, origin: 'PUJ', destination: 'YYZ', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['M. Castillo'], teams: ['Rampa 2'], services: ['Combustible'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-7', flightNumber: 'CM345', airlineIata: 'CM', airlineName: 'COPA', status: 'arrived', hour: 10, minute: 15, origin: 'PTY', destination: 'PUJ', aircraftType: 'B737 MAX', position: 'BN8', supervisor: 'K. Objío', agents: ['R. Peña', 'J. Fermín'], teams: ['Rampa 2'], services: ['Desembarque'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-8', flightNumber: 'WG654', airlineIata: 'WG', airlineName: 'SUNWING', status: 'scheduled', hour: 10, minute: 45, origin: 'PUJ', destination: 'YYZ', aircraftType: 'A321neo', position: 'B32', supervisor: 'M. Castillo', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-9', flightNumber: 'B6812', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'cancelled', hour: 11, minute: 0, origin: 'PUJ', destination: 'BOS', aircraftType: 'A320', position: null, supervisor: null, agents: [], teams: [], services: [], conflictReason: null, observations: 'Cancelado por mantenimiento de aeronave.', history: [{ at: `${OPERATION_DATE}T09:30:00-04:00`, note: 'Vuelo cancelado por la aerolínea' }] },
  { id: 'flt-10', flightNumber: 'AA123', airlineIata: 'AA', airlineName: 'AMERICAN', status: 'scheduled', hour: 11, minute: 20, origin: 'PUJ', destination: 'MIA', aircraftType: 'B737-800', position: 'A5', supervisor: 'J. Ramírez', agents: ['K. Objío'], teams: ['Rampa 1'], services: ['Combustible'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-11', flightNumber: 'DL879', airlineIata: 'DL', airlineName: 'DELTA', status: 'delayed', hour: 11, minute: 35, delayMinutes: 50, origin: 'ATL', destination: 'PUJ', aircraftType: 'B787', position: 'B21', supervisor: 'R. Peña', agents: [], teams: [], services: [], conflictReason: null, observations: 'Retraso por congestión en origen.', history: [] },
  { id: 'flt-12', flightNumber: 'TS234', airlineIata: 'TS', airlineName: 'AIRTRANSAT', status: 'scheduled', hour: 12, minute: 0, origin: 'PUJ', destination: 'YUL', aircraftType: 'A330', position: 'A1', supervisor: 'M. Castillo', agents: ['R. Peña'], teams: ['Rampa 3'], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-13', flightNumber: 'DM220', airlineIata: 'DM', airlineName: 'ARAJET', status: 'boarding', hour: 12, minute: 15, origin: 'PUJ', destination: 'SDQ', aircraftType: 'A320', position: 'A5', supervisor: 'K. Objío', agents: ['R. Peña'], teams: ['Rampa 2'], services: ['Catering'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-14', flightNumber: 'B6417', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'scheduled', hour: 12, minute: 40, origin: 'PUJ', destination: 'JFK', aircraftType: 'B787', position: 'BN8', supervisor: 'J. Ramírez', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-15', flightNumber: 'UA987', airlineIata: 'UA', airlineName: 'UNITED', status: 'enRoute', hour: 13, minute: 0, origin: 'PUJ', destination: 'IAH', aircraftType: 'A321neo', position: null, supervisor: null, agents: [], teams: [], services: [], conflictReason: null, observations: 'Pendiente de asignación de posición.', history: [] },
  { id: 'flt-16', flightNumber: 'AA455', airlineIata: 'AA', airlineName: 'AMERICAN', status: 'taxiing', hour: 13, minute: 20, origin: 'MIA', destination: 'PUJ', aircraftType: 'B737 MAX', position: 'A5', supervisor: 'M. Castillo', agents: ['K. Objío', 'J. Fermín'], teams: ['Rampa 1'], services: ['Desembarque'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-17', flightNumber: 'CM110', airlineIata: 'CM', airlineName: 'COPA', status: 'scheduled', hour: 13, minute: 45, origin: 'PUJ', destination: 'PTY', aircraftType: 'A320', position: 'B32', supervisor: 'R. Peña', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-18', flightNumber: 'DL500', airlineIata: 'DL', airlineName: 'DELTA', status: 'landed', hour: 14, minute: 0, origin: 'JFK', destination: 'PUJ', aircraftType: 'B787', position: 'B21', supervisor: 'J. Ramírez', agents: ['M. Castillo'], teams: ['Rampa 2'], services: ['Desembarque', 'Equipaje'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-19', flightNumber: 'WG100', airlineIata: 'WG', airlineName: 'SUNWING', status: 'delayed', hour: 14, minute: 20, delayMinutes: 25, origin: 'PUJ', destination: 'YYZ', aircraftType: 'A330', position: 'A1', supervisor: 'K. Objío', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-20', flightNumber: 'B6900', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'scheduled', hour: 14, minute: 45, origin: 'PUJ', destination: 'JFK', aircraftType: 'A321neo', position: 'BN8', supervisor: 'M. Castillo', agents: ['R. Peña', 'J. Fermín'], teams: ['Rampa 3'], services: ['Limpieza'], conflictReason: null, observations: '', history: [] },
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function addMinutesIso(iso, minutes) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function buildFlight(template, stationCode) {
  const scheduledTime = `${OPERATION_DATE}T${pad(template.hour)}:${pad(template.minute)}:00-04:00`;
  const estimatedTime = template.delayMinutes ? addMinutesIso(scheduledTime, template.delayMinutes) : scheduledTime;

  return {
    id: template.id,
    flightNumber: template.flightNumber,
    airlineIata: template.airlineIata,
    airlineName: template.airlineName,
    status: template.status,
    scheduledTime,
    estimatedTime,
    origin: template.origin,
    destination: template.destination,
    aircraftType: template.aircraftType,
    position: template.position,
    station: stationCode,
    supervisor: template.supervisor,
    agents: template.agents,
    teams: template.teams,
    services: template.services,
    conflict: template.conflictReason ? { reason: template.conflictReason } : null,
    observations: template.observations,
    history: template.history ?? [],
  };
}

export async function getPlanningSnapshot(stationCode = 'PUJ', dateISO = OPERATION_DATE) {
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    date: dateISO,
    flights: FLIGHT_TEMPLATES.map(template => buildFlight(template, stationCode)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- planningService`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/planningService.js src/services/planningService.test.js
git commit -m "feat: add planningService mock adapter with 20-flight daily snapshot"
```

---

## Task 3: `usePlanningData` hook

**Files:**
- Create: `src/features/planning/usePlanningData.js`
- Test: `src/features/planning/usePlanningData.test.js`

**Interfaces:**
- Consumes: `getPlanningSnapshot(stationCode, dateISO)` from Task 2.
- Produces: `usePlanningData(stationCode?: string, dateISO?: string, refreshToken?: number) => { status: 'loading'|'success'|'error', data: PlanningSnapshot|null, error: Error|null }`. Consumed by `AppShell` (Task 20).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/usePlanningData.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePlanningData } from './usePlanningData';
import * as planningService from '../../services/planningService';

describe('usePlanningData', () => {
  it('starts in loading state then resolves to success with the snapshot', async () => {
    const fakeSnapshot = { station: { code: 'PUJ' }, date: '2026-08-05', flights: [] };
    vi.spyOn(planningService, 'getPlanningSnapshot').mockResolvedValue(fakeSnapshot);

    const { result } = renderHook(() => usePlanningData('PUJ'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual(fakeSnapshot);
    expect(result.current.error).toBeNull();
  });

  it('moves to error state when the service rejects', async () => {
    vi.spyOn(planningService, 'getPlanningSnapshot').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => usePlanningData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('re-fetches when refreshToken changes', async () => {
    const spy = vi.spyOn(planningService, 'getPlanningSnapshot').mockResolvedValue({ flights: [] });
    const { rerender } = renderHook(({ token }) => usePlanningData('PUJ', undefined, token), {
      initialProps: { token: 0 },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- usePlanningData`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `usePlanningData.js`**

Create `src/features/planning/usePlanningData.js`:

```js
import { useEffect, useState } from 'react';
import { getPlanningSnapshot } from '../../services/planningService';

export function usePlanningData(stationCode = 'PUJ', dateISO, refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });

    getPlanningSnapshot(stationCode, dateISO)
      .then(data => {
        if (!cancelled) setState({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!cancelled) setState({ status: 'error', data: null, error });
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode, dateISO, refreshToken]);

  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- usePlanningData`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/usePlanningData.js src/features/planning/usePlanningData.test.js
git commit -m "feat: add usePlanningData hook"
```

---

## Task 4: Planning icon set

**Files:**
- Create: `src/features/planning/components/icons.jsx`
- Test: `src/features/planning/components/icons.test.jsx`

**Interfaces:**
- Produces named exports, each a React component accepting `{ className }` and rendering a decorative (`aria-hidden="true"`) inline SVG, stroke-based, viewBox `0 0 24 24`: `PlusIcon`, `UploadIcon`, `DownloadIcon`, `SearchIcon`, `PencilIcon`, `EyeIcon`, `ClipboardIcon`, `XIcon`. Consumed by `PlanningHeader`, `PlanningFilters`, `FlightCard`, `PlanningDrawer` (Tasks 9, 14, 16, 17).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/icons.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PlusIcon, UploadIcon, DownloadIcon, SearchIcon, PencilIcon, EyeIcon, ClipboardIcon, XIcon } from './icons';

const ICONS = { PlusIcon, UploadIcon, DownloadIcon, SearchIcon, PencilIcon, EyeIcon, ClipboardIcon, XIcon };

describe('planning icon set', () => {
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

Run: `npm test -- planning/components/icons`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the icon set**

Create `src/features/planning/components/icons.jsx`:

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

export function PlusIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function UploadIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 16V4m0 0-4 4m4-4 4 4" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Icon>
  );
}

export function DownloadIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 4v12m0 0-4-4m4 4 4-4" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Icon>
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

export function PencilIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 20h4.2L19.8 8.4a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8V20Z" />
      <path d="m14.5 5.5 4 4" />
    </Icon>
  );
}

export function EyeIcon(props) {
  return (
    <Icon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </Icon>
  );
}

export function ClipboardIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
      <path d="M6 6h12v14H6Z" />
      <path d="M9 11h6M9 15h6" />
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- planning/components/icons`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/icons.jsx src/features/planning/components/icons.test.jsx
git commit -m "feat: add planning-specific line icon set"
```

---

## Task 5: `planningMappers.js`

**Files:**
- Create: `src/features/planning/planningMappers.js`
- Test: `src/features/planning/planningMappers.test.js`

**Interfaces:**
- Produces: `isPendingAssignment(flight) => boolean`, `computeKpis(flights) => { flightsToday, pendingAssignment, positionsOccupied, conflicts }`, `extractDateFromIso(iso: string) => string`, `groupFlightsByHour(flights) => Array<{ hourLabel: string, flights: Flight[] }>`, `formatCountdown(scheduledIso: string, nowIso: string) => string`, `getFilterOptions(flights) => { dates, airports, airlines, statuses, aircraftTypes, positions, supervisors, agents }` (each a deduplicated, sorted array of strings). Consumed by `usePlanningFilters` (Task 6), `FlightCard`/`FlightTimeline` (Tasks 9–10), `PlanningKPIs`/`PlanningFilters`/`PlanningPage` (Tasks 13, 14, 18).

- [ ] **Step 1: Write the failing tests**

Create `src/features/planning/planningMappers.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  isPendingAssignment,
  computeKpis,
  extractDateFromIso,
  groupFlightsByHour,
  formatCountdown,
  getFilterOptions,
} from './planningMappers';

function flight(overrides) {
  return {
    id: 'flt-x',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    estimatedTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    station: 'PUJ',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    teams: [],
    services: [],
    conflict: null,
    observations: '',
    history: [],
    ...overrides,
  };
}

describe('isPendingAssignment', () => {
  it('is true when there is no position', () => {
    expect(isPendingAssignment(flight({ position: null }))).toBe(true);
  });

  it('is true when there are no agents', () => {
    expect(isPendingAssignment(flight({ agents: [] }))).toBe(true);
  });

  it('is false when both position and agents are present', () => {
    expect(isPendingAssignment(flight({ position: 'A5', agents: ['M. Castillo'] }))).toBe(false);
  });
});

describe('computeKpis', () => {
  it('counts flights, pending assignment, distinct occupied positions, and conflicts', () => {
    const flights = [
      flight({ id: 'a', position: 'A5', agents: ['M. Castillo'], conflict: null }),
      flight({ id: 'b', position: 'A5', agents: [], conflict: { reason: 'x' } }),
      flight({ id: 'c', position: null, agents: [], conflict: null }),
      flight({ id: 'd', position: 'B21', agents: ['R. Peña'], conflict: { reason: 'y' } }),
    ];
    expect(computeKpis(flights)).toEqual({
      flightsToday: 4,
      pendingAssignment: 2,
      positionsOccupied: 2,
      conflicts: 2,
    });
  });
});

describe('extractDateFromIso', () => {
  it('extracts the YYYY-MM-DD prefix regardless of timezone offset', () => {
    expect(extractDateFromIso('2026-08-05T23:59:00-04:00')).toBe('2026-08-05');
  });
});

describe('groupFlightsByHour', () => {
  it('sorts by scheduled time and groups consecutive flights sharing an hour', () => {
    const flights = [
      flight({ id: 'b', scheduledTime: '2026-08-05T09:10:00-04:00' }),
      flight({ id: 'a', scheduledTime: '2026-08-05T08:05:00-04:00' }),
      flight({ id: 'c', scheduledTime: '2026-08-05T08:45:00-04:00' }),
    ];
    const groups = groupFlightsByHour(flights);
    expect(groups.map(group => group.hourLabel)).toEqual(['08:00', '09:00']);
    expect(groups[0].flights.map(f => f.id)).toEqual(['a', 'c']);
    expect(groups[1].flights.map(f => f.id)).toEqual(['b']);
  });
});

describe('formatCountdown', () => {
  it('shows a future countdown in minutes', () => {
    expect(formatCountdown('2026-08-05T08:05:00-04:00', '2026-08-05T07:20:00-04:00')).toBe('En 45 min');
  });

  it('shows an elapsed countdown in minutes', () => {
    expect(formatCountdown('2026-08-05T08:05:00-04:00', '2026-08-05T08:50:00-04:00')).toBe('Hace 45 min');
  });

  it('shows "Ahora" when scheduled time matches now', () => {
    expect(formatCountdown('2026-08-05T08:05:00-04:00', '2026-08-05T08:05:00-04:00')).toBe('Ahora');
  });
});

describe('getFilterOptions', () => {
  it('returns deduplicated, sorted option lists per dimension, excluding null/empty values', () => {
    const flights = [
      flight({ airlineIata: 'DM', status: 'scheduled', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['M. Castillo'] }),
      flight({ airlineIata: 'AA', status: 'delayed', aircraftType: 'B787', position: null, supervisor: null, agents: [] }),
      flight({ airlineIata: 'DM', status: 'scheduled', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['R. Peña'] }),
    ];
    const options = getFilterOptions(flights);
    expect(options.airlines).toEqual(['AA', 'DM']);
    expect(options.statuses).toEqual(['delayed', 'scheduled']);
    expect(options.aircraftTypes).toEqual(['A320', 'B787']);
    expect(options.positions).toEqual(['A5']);
    expect(options.supervisors).toEqual(['J. Ramírez']);
    expect(options.agents).toEqual(['M. Castillo', 'R. Peña']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- planningMappers`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `planningMappers.js`**

Create `src/features/planning/planningMappers.js`:

```js
export function isPendingAssignment(flight) {
  return !flight.position || flight.agents.length === 0;
}

export function computeKpis(flights) {
  const occupiedPositions = new Set(flights.filter(flight => flight.position).map(flight => flight.position));
  return {
    flightsToday: flights.length,
    pendingAssignment: flights.filter(isPendingAssignment).length,
    positionsOccupied: occupiedPositions.size,
    conflicts: flights.filter(flight => flight.conflict !== null).length,
  };
}

export function extractDateFromIso(iso) {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function hourLabel(iso) {
  const match = iso.match(/T(\d{2}):/);
  return match ? `${match[1]}:00` : '';
}

export function groupFlightsByHour(flights) {
  const sorted = [...flights].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  const groups = [];

  for (const flight of sorted) {
    const label = hourLabel(flight.scheduledTime);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.hourLabel === label) {
      currentGroup.flights.push(flight);
    } else {
      groups.push({ hourLabel: label, flights: [flight] });
    }
  }

  return groups;
}

export function formatCountdown(scheduledIso, nowIso) {
  const diffMinutes = Math.round((new Date(scheduledIso).getTime() - new Date(nowIso).getTime()) / 60000);
  if (diffMinutes === 0) return 'Ahora';
  if (diffMinutes > 0) return `En ${diffMinutes} min`;
  return `Hace ${Math.abs(diffMinutes)} min`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function getFilterOptions(flights) {
  return {
    dates: uniqueSorted(flights.map(flight => extractDateFromIso(flight.scheduledTime))),
    airports: uniqueSorted(flights.map(flight => flight.station)),
    airlines: uniqueSorted(flights.map(flight => flight.airlineIata)),
    statuses: uniqueSorted(flights.map(flight => flight.status)),
    aircraftTypes: uniqueSorted(flights.map(flight => flight.aircraftType)),
    positions: uniqueSorted(flights.map(flight => flight.position)),
    supervisors: uniqueSorted(flights.map(flight => flight.supervisor)),
    agents: uniqueSorted(flights.flatMap(flight => flight.agents)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- planningMappers`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/planningMappers.js src/features/planning/planningMappers.test.js
git commit -m "feat: add planningMappers data-shaping helpers"
```

---

## Task 6: `usePlanningFilters` hook

**Files:**
- Create: `src/features/planning/usePlanningFilters.js`
- Test: `src/features/planning/usePlanningFilters.test.js`

**Interfaces:**
- Consumes: `extractDateFromIso`, `isPendingAssignment` from Task 5.
- Produces: `usePlanningFilters(flights: Flight[]) => { filters: { date, airportCode, airlineIata, status, aircraftType, position, supervisor, agent, search }, setFilter(key, value), quickFilter: 'none'|'today'|'tomorrow'|'delayed'|'unassigned'|'pending', setQuickFilter(name), resetFilters(), filteredFlights: Flight[] }`. Consumed by `PlanningPage` (Task 18), which passes `filters`/`setFilter`/`quickFilter`/`setQuickFilter` down to `PlanningFilters` (Task 14).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/usePlanningFilters.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlanningFilters } from './usePlanningFilters';

function flight(overrides) {
  return {
    id: 'flt-x',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    station: 'PUJ',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    ...overrides,
  };
}

const FLIGHTS = [
  flight({ id: 'a', flightNumber: 'DM161', airlineIata: 'DM', status: 'scheduled', position: 'A5', agents: ['M. Castillo'] }),
  flight({ id: 'b', flightNumber: 'AA904', airlineIata: 'AA', status: 'delayed', position: 'B21', agents: [] }),
  flight({ id: 'c', flightNumber: 'B6289', airlineIata: 'B6', status: 'boarding', position: null, agents: [] }),
];

describe('usePlanningFilters', () => {
  it('returns every flight when no filter is active', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('filters by airline', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('airlineIata', 'AA'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual(['b']);
  });

  it('filters by free-text search across flight number and route', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('search', 'jfk'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual(['a']);
  });

  it('applies the "delayed" quick filter and toggles it off on a second call', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setQuickFilter('delayed'));
    expect(result.current.quickFilter).toBe('delayed');
    expect(result.current.filteredFlights.map(f => f.id)).toEqual(['b']);

    act(() => result.current.setQuickFilter('delayed'));
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('applies the "unassigned" quick filter to flights with no position or no agents', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setQuickFilter('unassigned'));
    expect(result.current.filteredFlights.map(f => f.id).sort()).toEqual(['b', 'c']);
  });

  it('resets all filters and the quick filter', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('airlineIata', 'AA'));
    act(() => result.current.setQuickFilter('delayed'));
    act(() => result.current.resetFilters());
    expect(result.current.filters.airlineIata).toBe('');
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- usePlanningFilters`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `usePlanningFilters.js`**

Create `src/features/planning/usePlanningFilters.js`:

```js
import { useMemo, useState } from 'react';
import { extractDateFromIso, isPendingAssignment } from './planningMappers';

const INITIAL_FILTERS = {
  date: '',
  airportCode: '',
  airlineIata: '',
  status: '',
  aircraftType: '',
  position: '',
  supervisor: '',
  agent: '',
  search: '',
};

function matchesFilters(flight, filters) {
  if (filters.date && extractDateFromIso(flight.scheduledTime) !== filters.date) return false;
  if (filters.airportCode && flight.station !== filters.airportCode) return false;
  if (filters.airlineIata && flight.airlineIata !== filters.airlineIata) return false;
  if (filters.status && flight.status !== filters.status) return false;
  if (filters.aircraftType && flight.aircraftType !== filters.aircraftType) return false;
  if (filters.position && flight.position !== filters.position) return false;
  if (filters.supervisor && flight.supervisor !== filters.supervisor) return false;
  if (filters.agent && !flight.agents.includes(filters.agent)) return false;
  if (filters.search) {
    const haystack = `${flight.flightNumber} ${flight.airlineName} ${flight.origin} ${flight.destination}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  return true;
}

function matchesQuickFilter(flight, quickFilter) {
  switch (quickFilter) {
    case 'tomorrow':
      return false;
    case 'delayed':
      return flight.status === 'delayed';
    case 'unassigned':
      return isPendingAssignment(flight);
    case 'pending':
      return flight.status === 'scheduled';
    default:
      return true;
  }
}

export function usePlanningFilters(flights) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [quickFilter, setQuickFilterState] = useState('none');

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  function setQuickFilter(name) {
    setQuickFilterState(current => (current === name ? 'none' : name));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setQuickFilterState('none');
  }

  const filteredFlights = useMemo(
    () => flights.filter(flight => matchesFilters(flight, filters) && matchesQuickFilter(flight, quickFilter)),
    [flights, filters, quickFilter]
  );

  return { filters, setFilter, quickFilter, setQuickFilter, resetFilters, filteredFlights };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- usePlanningFilters`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/usePlanningFilters.js src/features/planning/usePlanningFilters.test.js
git commit -m "feat: add usePlanningFilters hook with quick-filter presets"
```

---

## Task 7: `ConflictIndicator` component

**Files:**
- Create: `src/features/planning/components/ConflictIndicator.jsx`
- Test: `src/features/planning/components/ConflictIndicator.test.jsx`

**Interfaces:**
- Consumes: `AlertTriangleIcon` from `src/features/dashboard/components/icons` (existing).
- Produces: `<ConflictIndicator conflict={{ reason: string } | null} />`. Renders nothing when `conflict` is `null`. Consumed by `FlightCard` (Task 9).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/ConflictIndicator.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConflictIndicator from './ConflictIndicator';

describe('ConflictIndicator', () => {
  it('renders nothing when there is no conflict', () => {
    const { container } = render(<ConflictIndicator conflict={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the conflict label and exposes the reason via the title attribute', () => {
    render(<ConflictIndicator conflict={{ reason: 'Posición B21 con doble asignación' }} />);
    const indicator = screen.getByText('Conflicto');
    expect(indicator).toHaveAttribute('title', 'Posición B21 con doble asignación');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ConflictIndicator`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ConflictIndicator.jsx`**

Create `src/features/planning/components/ConflictIndicator.jsx`:

```jsx
import { AlertTriangleIcon } from '../../dashboard/components/icons';

export default function ConflictIndicator({ conflict }) {
  if (!conflict) return null;

  return (
    <span
      title={conflict.reason}
      className="inline-flex items-center gap-1 rounded-full bg-status-danger/10 px-2 py-0.5 text-xs font-medium text-status-danger"
    >
      <AlertTriangleIcon className="h-3.5 w-3.5" />
      Conflicto
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ConflictIndicator`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/ConflictIndicator.jsx src/features/planning/components/ConflictIndicator.test.jsx
git commit -m "feat: add ConflictIndicator component"
```

---

## Task 8: `AssignmentSummary` component

**Files:**
- Create: `src/features/planning/components/AssignmentSummary.jsx`
- Test: `src/features/planning/components/AssignmentSummary.test.jsx`

**Interfaces:**
- Consumes: `MapPinIcon`, `UsersIcon` from `src/features/dashboard/components/icons` (existing).
- Produces: `<AssignmentSummary position={string|null} supervisor={string|null} agents={string[]} teams={string[]} />`. Consumed by `FlightCard` (Task 9) and `PlanningDrawer` reuses the same field names but renders them via its own sections (Task 17 does not import this component — it lists agents/teams directly — see Task 17).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/AssignmentSummary.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssignmentSummary from './AssignmentSummary';

describe('AssignmentSummary', () => {
  it('renders position, supervisor, agent count, and team count when all are present', () => {
    render(
      <AssignmentSummary position="A5" supervisor="J. Ramírez" agents={['M. Castillo', 'R. Peña']} teams={['Rampa 2']} />
    );
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('J. Ramírez')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1 equipo')).toBeInTheDocument();
  });

  it('pluralizes the team count', () => {
    render(<AssignmentSummary position="A5" supervisor="J. Ramírez" agents={[]} teams={['Rampa 1', 'Rampa 2']} />);
    expect(screen.getByText('2 equipos')).toBeInTheDocument();
  });

  it('shows a fallback message when nothing is assigned', () => {
    render(<AssignmentSummary position={null} supervisor={null} agents={[]} teams={[]} />);
    expect(screen.getByText('Sin asignar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AssignmentSummary`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `AssignmentSummary.jsx`**

Create `src/features/planning/components/AssignmentSummary.jsx`:

```jsx
import { MapPinIcon, UsersIcon } from '../../dashboard/components/icons';

export default function AssignmentSummary({ position, supervisor, agents = [], teams = [] }) {
  const hasAssignment = Boolean(position) || Boolean(supervisor) || agents.length > 0 || teams.length > 0;

  if (!hasAssignment) {
    return (
      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Sin asignar</span>
    );
  }

  return (
    <span className="flex items-center gap-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {position && (
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="h-3.5 w-3.5" />
          {position}
        </span>
      )}
      {supervisor && <span>{supervisor}</span>}
      {agents.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <UsersIcon className="h-3.5 w-3.5" />
          {agents.length}
        </span>
      )}
      {teams.length > 0 && (
        <span>
          {teams.length} equipo{teams.length > 1 ? 's' : ''}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AssignmentSummary`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/AssignmentSummary.jsx src/features/planning/components/AssignmentSummary.test.jsx
git commit -m "feat: add AssignmentSummary component"
```

---

## Task 9: `FlightCard` component

**Files:**
- Create: `src/features/planning/components/FlightCard.jsx`
- Test: `src/features/planning/components/FlightCard.test.jsx`

**Interfaces:**
- Consumes: `StatusBadge`, `STATUS_COLORS`, `getStatusMeta` from `src/features/dashboard/statusMeta.js` and `src/features/dashboard/components/StatusBadge.jsx` (existing); `formatClockTime` from `src/features/dashboard/mappers.js` (existing); `UsersIcon` from `src/features/dashboard/components/icons` (existing); `PencilIcon`, `EyeIcon`, `ClipboardIcon` from Task 4; `formatCountdown` from Task 5; `ConflictIndicator` (Task 7); `AssignmentSummary` (Task 8).
- Produces: `<FlightCard flight={Flight} now={string} onSelect={(id: string) => void} />`. Every quick-action button and the card body itself call `onSelect(flight.id)` — Fase 1 has no distinct per-action behavior; that lands in Fase 2. Consumed by `FlightTimeline` (Task 10).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/FlightCard.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightCard from './FlightCard';

const FLIGHT = {
  id: 'flt-2',
  flightNumber: 'AA904',
  airlineIata: 'AA',
  airlineName: 'AMERICAN',
  status: 'delayed',
  scheduledTime: '2026-08-05T08:20:00-04:00',
  estimatedTime: '2026-08-05T08:50:00-04:00',
  origin: 'PUJ',
  destination: 'MIA',
  aircraftType: 'B737-800',
  position: 'B21',
  supervisor: 'K. Objío',
  agents: [],
  teams: [],
  conflict: { reason: 'Posición B21 con doble asignación' },
};

describe('FlightCard', () => {
  it('renders flight identity, status, route, aircraft, position, and countdown', () => {
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={() => {}} />);
    expect(screen.getByText('AA904 · AMERICAN')).toBeInTheDocument();
    expect(screen.getByText('Retrasado')).toBeInTheDocument();
    expect(screen.getByText('PUJ → MIA')).toBeInTheDocument();
    expect(screen.getByText('B737-800')).toBeInTheDocument();
    expect(screen.getByText('B21')).toBeInTheDocument();
    expect(screen.getByText('En 45 min')).toBeInTheDocument();
  });

  it('renders the conflict indicator when the flight has a conflict', () => {
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={() => {}} />);
    expect(screen.getByText('Conflicto')).toBeInTheDocument();
  });

  it('calls onSelect with the flight id when the card body is clicked', async () => {
    const onSelect = vi.fn();
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('flight-card'));
    expect(onSelect).toHaveBeenCalledWith('flt-2');
  });

  it('calls onSelect exactly once when a quick action button is clicked', async () => {
    const onSelect = vi.fn();
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('flt-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightCard`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightCard.jsx`**

Create `src/features/planning/components/FlightCard.jsx`:

```jsx
import StatusBadge from '../../dashboard/components/StatusBadge';
import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';
import { UsersIcon } from '../../dashboard/components/icons';
import { PencilIcon, EyeIcon, ClipboardIcon } from './icons';
import { formatCountdown } from '../planningMappers';
import ConflictIndicator from './ConflictIndicator';
import AssignmentSummary from './AssignmentSummary';

const QUICK_ACTIONS = [
  { id: 'edit', label: 'Editar', icon: PencilIcon },
  { id: 'assign', label: 'Asignar', icon: UsersIcon },
  { id: 'detail', label: 'Ver detalle', icon: EyeIcon },
  { id: 'workOrder', label: 'Crear Work Order', icon: ClipboardIcon },
];

export default function FlightCard({ flight, now, onSelect }) {
  const meta = getStatusMeta('flight', flight.status);
  const accentColor = STATUS_COLORS[meta.color];

  return (
    <div
      data-testid="flight-card"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(flight.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(flight.id);
      }}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className="cursor-pointer rounded-xl border border-black/5 bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge domain="flight" status={flight.status} />
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {formatClockTime(flight.scheduledTime)}
        </span>
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          {flight.flightNumber} · {flight.airlineName}
        </span>
        <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
          {flight.origin} → {flight.destination}
        </span>
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {flight.aircraftType}
        </span>
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {flight.position ?? 'Sin posición'}
        </span>
        <span className="ml-auto font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {formatCountdown(flight.scheduledTime, now)}
        </span>
        <div className="flex items-center gap-1">
          {QUICK_ACTIONS.map(({ id, label, icon: ActionIcon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              onClick={event => {
                event.stopPropagation();
                onSelect(flight.id);
              }}
              className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 hover:text-accent-600 dark:text-text-secondary-dark dark:hover:bg-white/5"
            >
              <ActionIcon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 hidden items-center justify-between gap-3 lg:flex">
        <AssignmentSummary
          position={flight.position}
          supervisor={flight.supervisor}
          agents={flight.agents}
          teams={flight.teams}
        />
        <ConflictIndicator conflict={flight.conflict} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightCard`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/FlightCard.jsx src/features/planning/components/FlightCard.test.jsx
git commit -m "feat: add FlightCard component"
```

---

## Task 10: `FlightTimeline` component

**Files:**
- Create: `src/features/planning/components/FlightTimeline.jsx`
- Test: `src/features/planning/components/FlightTimeline.test.jsx`

**Interfaces:**
- Consumes: `groupFlightsByHour` from Task 5; `FlightCard` from Task 9.
- Produces: `<FlightTimeline flights={Flight[]} now={string} onSelectFlight={(id: string) => void} />`. Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/FlightTimeline.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightTimeline from './FlightTimeline';

function flight(overrides) {
  return {
    id: 'flt-x',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    teams: [],
    conflict: null,
    ...overrides,
  };
}

const FLIGHTS = [
  flight({ id: 'a', flightNumber: 'DM161', scheduledTime: '2026-08-05T08:05:00-04:00' }),
  flight({ id: 'b', flightNumber: 'AA904', scheduledTime: '2026-08-05T08:45:00-04:00' }),
  flight({ id: 'c', flightNumber: 'B6289', scheduledTime: '2026-08-05T09:10:00-04:00' }),
];

describe('FlightTimeline', () => {
  it('groups flights under hour dividers in chronological order', () => {
    render(<FlightTimeline flights={FLIGHTS} now="2026-08-05T07:00:00-04:00" onSelectFlight={() => {}} />);
    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getAllByTestId('flight-card')).toHaveLength(3);
  });

  it('calls onSelectFlight with the clicked flight id', async () => {
    const onSelectFlight = vi.fn();
    render(<FlightTimeline flights={FLIGHTS} now="2026-08-05T07:00:00-04:00" onSelectFlight={onSelectFlight} />);
    await userEvent.click(screen.getByText('DM161 · ARAJET'));
    expect(onSelectFlight).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightTimeline`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FlightTimeline.jsx`**

Create `src/features/planning/components/FlightTimeline.jsx`:

```jsx
import FlightCard from './FlightCard';
import { groupFlightsByHour } from '../planningMappers';

export default function FlightTimeline({ flights, now, onSelectFlight }) {
  const groups = groupFlightsByHour(flights);

  return (
    <div data-testid="flight-timeline" className="space-y-4">
      {groups.map(group => (
        <div key={group.hourLabel} className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            <span>{group.hourLabel}</span>
            <span className="h-px flex-1 bg-black/5 dark:bg-white/5" />
          </div>
          <div className="space-y-2">
            {group.flights.map(flight => (
              <FlightCard key={flight.id} flight={flight} now={now} onSelect={onSelectFlight} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightTimeline`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/FlightTimeline.jsx src/features/planning/components/FlightTimeline.test.jsx
git commit -m "feat: add FlightTimeline component"
```

---

## Task 11: `PlanningSkeleton` component

**Files:**
- Create: `src/features/planning/components/PlanningSkeleton.jsx`
- Test: `src/features/planning/components/PlanningSkeleton.test.jsx`

**Interfaces:**
- Produces: `<PlanningSkeleton />` — no props. Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/PlanningSkeleton.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningSkeleton from './PlanningSkeleton';

describe('PlanningSkeleton', () => {
  it('renders six shimmering placeholder rows', () => {
    render(<PlanningSkeleton />);
    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('planning-skeleton-row')).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PlanningSkeleton`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `PlanningSkeleton.jsx`**

Create `src/features/planning/components/PlanningSkeleton.jsx`:

```jsx
export default function PlanningSkeleton() {
  return (
    <div data-testid="planning-skeleton" className="space-y-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          data-testid="planning-skeleton-row"
          className="h-16 animate-pulse rounded-xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card"
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PlanningSkeleton`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/PlanningSkeleton.jsx src/features/planning/components/PlanningSkeleton.test.jsx
git commit -m "feat: add PlanningSkeleton component"
```

---

## Task 12: `EmptyPlanningState` component

**Files:**
- Create: `src/features/planning/components/EmptyPlanningState.jsx`
- Test: `src/features/planning/components/EmptyPlanningState.test.jsx`

**Interfaces:**
- Consumes: `ChecklistIcon` from `src/features/dashboard/components/icons` (existing).
- Produces: `<EmptyPlanningState reason={'no-flights'|'no-results'} />`. Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/EmptyPlanningState.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyPlanningState from './EmptyPlanningState';

describe('EmptyPlanningState', () => {
  it('shows the no-flights copy for that reason', () => {
    render(<EmptyPlanningState reason="no-flights" />);
    expect(screen.getByText('Sin vuelos programados')).toBeInTheDocument();
  });

  it('shows the no-results copy for that reason', () => {
    render(<EmptyPlanningState reason="no-results" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- EmptyPlanningState`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `EmptyPlanningState.jsx`**

Create `src/features/planning/components/EmptyPlanningState.jsx`:

```jsx
import { ChecklistIcon } from '../../dashboard/components/icons';

const COPY = {
  'no-flights': {
    title: 'Sin vuelos programados',
    description: 'No hay vuelos registrados para la fecha y estación seleccionadas.',
  },
  'no-results': {
    title: 'Sin resultados',
    description: 'Ningún vuelo coincide con los filtros aplicados. Ajuste los filtros para ver más resultados.',
  },
};

export default function EmptyPlanningState({ reason }) {
  const copy = COPY[reason] ?? COPY['no-results'];

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 px-6 py-16 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <ChecklistIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{copy.title}</p>
      <p className="max-w-md text-xs text-text-secondary-light dark:text-text-secondary-dark">{copy.description}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- EmptyPlanningState`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/EmptyPlanningState.jsx src/features/planning/components/EmptyPlanningState.test.jsx
git commit -m "feat: add EmptyPlanningState component"
```

---

## Task 13: `PlanningKPIs` component

**Files:**
- Create: `src/features/planning/components/PlanningKPIs.jsx`
- Test: `src/features/planning/components/PlanningKPIs.test.jsx`

**Interfaces:**
- Consumes: `KpiCard` from `src/features/dashboard/components/KpiCard.jsx`; `PlaneIcon`, `ChecklistIcon`, `MapPinIcon`, `AlertTriangleIcon` from `src/features/dashboard/components/icons` (all existing).
- Produces: `<PlanningKPIs kpis={{ flightsToday, pendingAssignment, positionsOccupied, conflicts }} loading?={boolean} />`. Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/PlanningKPIs.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningKPIs from './PlanningKPIs';
import * as countUpModule from '../../dashboard/useCountUp';

const KPIS = { flightsToday: 20, pendingAssignment: 9, positionsOccupied: 5, conflicts: 2 };

describe('PlanningKPIs', () => {
  it('renders all four KPI labels with their values', () => {
    vi.spyOn(countUpModule, 'useCountUp').mockImplementation(value => value);
    render(<PlanningKPIs kpis={KPIS} />);
    expect(screen.getByText('Vuelos del día')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Pendientes de asignación')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Posiciones ocupadas')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Conflictos detectados')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders skeletons for every card when loading', () => {
    render(<PlanningKPIs kpis={KPIS} loading />);
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PlanningKPIs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `PlanningKPIs.jsx`**

Create `src/features/planning/components/PlanningKPIs.jsx`:

```jsx
import KpiCard from '../../dashboard/components/KpiCard';
import { PlaneIcon, ChecklistIcon, MapPinIcon, AlertTriangleIcon } from '../../dashboard/components/icons';

export default function PlanningKPIs({ kpis, loading = false }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Vuelos del día" value={kpis.flightsToday} icon={PlaneIcon} loading={loading} />
      <KpiCard
        label="Pendientes de asignación"
        value={kpis.pendingAssignment}
        icon={ChecklistIcon}
        loading={loading}
        tone={kpis.pendingAssignment > 0 ? 'signal' : 'default'}
      />
      <KpiCard label="Posiciones ocupadas" value={kpis.positionsOccupied} icon={MapPinIcon} loading={loading} />
      <KpiCard
        label="Conflictos detectados"
        value={kpis.conflicts}
        icon={AlertTriangleIcon}
        loading={loading}
        tone={kpis.conflicts > 0 ? 'signal' : 'default'}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PlanningKPIs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/PlanningKPIs.jsx src/features/planning/components/PlanningKPIs.test.jsx
git commit -m "feat: add PlanningKPIs component"
```

---

## Task 14: `PlanningFilters` component

**Files:**
- Create: `src/features/planning/components/PlanningFilters.jsx`
- Test: `src/features/planning/components/PlanningFilters.test.jsx`

**Interfaces:**
- Consumes: `SearchIcon` from Task 4.
- Produces: `<PlanningFilters filters={FiltersState} onFilterChange={(key, value) => void} quickFilter={string} onQuickFilter={(name) => void} options={FilterOptions} />` (shapes exactly matching `usePlanningFilters`'s `filters`/`quickFilter` and `planningMappers.getFilterOptions`'s return value). Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/PlanningFilters.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningFilters from './PlanningFilters';

const FILTERS = {
  date: '',
  airportCode: '',
  airlineIata: '',
  status: '',
  aircraftType: '',
  position: '',
  supervisor: '',
  agent: '',
  search: '',
};

const OPTIONS = {
  dates: ['2026-08-05'],
  airports: ['PUJ'],
  airlines: ['AA', 'DM'],
  statuses: ['delayed', 'scheduled'],
  aircraftTypes: ['A320', 'B787'],
  positions: ['A5', 'B21'],
  supervisors: ['J. Ramírez'],
  agents: ['M. Castillo'],
};

describe('PlanningFilters', () => {
  it('calls onFilterChange with the new value when the airline select changes', async () => {
    const onFilterChange = vi.fn();
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={onFilterChange} quickFilter="none" onQuickFilter={() => {}} options={OPTIONS} />
    );
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'AA');
    expect(onFilterChange).toHaveBeenCalledWith('airlineIata', 'AA');
  });

  it('calls onFilterChange with the search text as the user types', async () => {
    const onFilterChange = vi.fn();
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={onFilterChange} quickFilter="none" onQuickFilter={() => {}} options={OPTIONS} />
    );
    await userEvent.type(screen.getByLabelText('Búsqueda'), 'DM');
    expect(onFilterChange).toHaveBeenCalledWith('search', 'D');
    expect(onFilterChange).toHaveBeenCalledWith('search', 'M');
  });

  it('renders the five quick-filter chips and calls onQuickFilter when clicked', async () => {
    const onQuickFilter = vi.fn();
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={() => {}} quickFilter="none" onQuickFilter={onQuickFilter} options={OPTIONS} />
    );
    for (const label of ['Hoy', 'Mañana', 'Retrasados', 'Sin asignación', 'Pendientes']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Retrasados' }));
    expect(onQuickFilter).toHaveBeenCalledWith('delayed');
  });

  it('marks the active quick filter with aria-pressed', () => {
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={() => {}} quickFilter="delayed" onQuickFilter={() => {}} options={OPTIONS} />
    );
    expect(screen.getByRole('button', { name: 'Retrasados' })).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PlanningFilters`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `PlanningFilters.jsx`**

Create `src/features/planning/components/PlanningFilters.jsx`:

```jsx
import { SearchIcon } from './icons';

const STATUS_LABELS = {
  scheduled: 'Programado',
  boarding: 'Abordando',
  taxiing: 'Rodaje',
  enRoute: 'En ruta',
  landed: 'Aterrizado',
  arrived: 'En posición',
  delayed: 'Retrasado',
  diverted: 'Desviado',
  cancelled: 'Cancelado',
};

const QUICK_FILTERS = [
  { id: 'today', label: 'Hoy' },
  { id: 'tomorrow', label: 'Mañana' },
  { id: 'delayed', label: 'Retrasados' },
  { id: 'unassigned', label: 'Sin asignación' },
  { id: 'pending', label: 'Pendientes' },
];

function FilterSelect({ label, value, onChange, options }) {
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
            {STATUS_LABELS[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PlanningFilters({ filters, onFilterChange, quickFilter, onQuickFilter, options }) {
  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          Búsqueda
          <span className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
            <input
              type="text"
              value={filters.search}
              onChange={event => onFilterChange('search', event.target.value)}
              placeholder="Vuelo, aerolínea o ruta"
              className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
            />
          </span>
        </label>
        <FilterSelect label="Fecha" value={filters.date} onChange={value => onFilterChange('date', value)} options={options.dates} />
        <FilterSelect label="Aeropuerto" value={filters.airportCode} onChange={value => onFilterChange('airportCode', value)} options={options.airports} />
        <FilterSelect label="Aerolínea" value={filters.airlineIata} onChange={value => onFilterChange('airlineIata', value)} options={options.airlines} />
        <FilterSelect label="Estado" value={filters.status} onChange={value => onFilterChange('status', value)} options={options.statuses} />
        <FilterSelect label="Aeronave" value={filters.aircraftType} onChange={value => onFilterChange('aircraftType', value)} options={options.aircraftTypes} />
        <FilterSelect label="Posición" value={filters.position} onChange={value => onFilterChange('position', value)} options={options.positions} />
        <FilterSelect label="Supervisor" value={filters.supervisor} onChange={value => onFilterChange('supervisor', value)} options={options.supervisors} />
        <FilterSelect label="Agente" value={filters.agent} onChange={value => onFilterChange('agent', value)} options={options.agents} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onQuickFilter(id)}
            aria-pressed={quickFilter === id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ${
              quickFilter === id
                ? 'border-accent-600 bg-accent-600/10 text-accent-600'
                : 'border-black/10 text-text-secondary-light hover:border-accent-600/40 dark:border-white/10 dark:text-text-secondary-dark'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PlanningFilters`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/PlanningFilters.jsx src/features/planning/components/PlanningFilters.test.jsx
git commit -m "feat: add PlanningFilters component"
```

---

## Task 15: `ViewSwitcher` component

**Files:**
- Create: `src/features/planning/components/ViewSwitcher.jsx`
- Test: `src/features/planning/components/ViewSwitcher.test.jsx`

**Interfaces:**
- Produces: `<ViewSwitcher active={'timeline'|'table'|'calendar'} onChange={(id) => void} />`. Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/ViewSwitcher.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewSwitcher from './ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders the three view tabs', () => {
    render(<ViewSwitcher active="timeline" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tabla' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Calendario' })).toBeInTheDocument();
  });

  it('marks the active view as selected', () => {
    render(<ViewSwitcher active="table" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Tabla' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked view id', async () => {
    const onChange = vi.fn();
    render(<ViewSwitcher active="timeline" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Calendario' }));
    expect(onChange).toHaveBeenCalledWith('calendar');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ViewSwitcher`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ViewSwitcher.jsx`**

Create `src/features/planning/components/ViewSwitcher.jsx`:

```jsx
const VIEWS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'table', label: 'Tabla' },
  { id: 'calendar', label: 'Calendario' },
];

export default function ViewSwitcher({ active, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Vistas de planificación"
      className="inline-flex rounded-xl border border-black/10 bg-white/70 p-1 dark:border-white/10 dark:bg-surface-dark-card"
    >
      {VIEWS.map(view => (
        <button
          key={view.id}
          type="button"
          role="tab"
          aria-selected={active === view.id}
          onClick={() => onChange(view.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
            active === view.id
              ? 'bg-accent-600 text-white'
              : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
          }`}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ViewSwitcher`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/ViewSwitcher.jsx src/features/planning/components/ViewSwitcher.test.jsx
git commit -m "feat: add ViewSwitcher component"
```

---

## Task 16: `PlanningHeader` component

**Files:**
- Create: `src/features/planning/components/PlanningHeader.jsx`
- Test: `src/features/planning/components/PlanningHeader.test.jsx`

**Interfaces:**
- Consumes: `PlusIcon`, `UploadIcon`, `DownloadIcon` from Task 4; `RefreshCwIcon` from `src/features/dashboard/components/icons` (existing).
- Produces: `<PlanningHeader onRefresh={() => void} />`. Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/PlanningHeader.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningHeader from './PlanningHeader';

describe('PlanningHeader', () => {
  it('renders the breadcrumb, title, and description', () => {
    render(<PlanningHeader onRefresh={() => {}} />);
    expect(screen.getByText('Dashboard / Planificación Operativa')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(
      screen.getByText('Gestione la planificación operacional de vuelos, recursos y posiciones.')
    ).toBeInTheDocument();
  });

  it('calls onRefresh when Actualizar is clicked', async () => {
    const onRefresh = vi.fn();
    render(<PlanningHeader onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables the placeholder actions with a "Próximamente" tooltip', () => {
    render(<PlanningHeader onRefresh={() => {}} />);
    for (const label of ['Nuevo vuelo', 'Importar vuelos', 'Exportar']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Próximamente');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PlanningHeader`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `PlanningHeader.jsx`**

Create `src/features/planning/components/PlanningHeader.jsx`:

```jsx
import { PlusIcon, UploadIcon, DownloadIcon } from './icons';
import { RefreshCwIcon } from '../../dashboard/components/icons';

function ActionButton({ icon: ActionIcon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Próximamente' : label}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
        disabled
          ? 'cursor-not-allowed border-black/10 text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60'
          : 'border-accent-600/30 text-accent-600 hover:bg-accent-600/10'
      }`}
    >
      <ActionIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export default function PlanningHeader({ onRefresh }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Dashboard / Planificación Operativa
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Planificación Operativa</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Gestione la planificación operacional de vuelos, recursos y posiciones.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={PlusIcon} label="Nuevo vuelo" disabled />
          <ActionButton icon={UploadIcon} label="Importar vuelos" disabled />
          <ActionButton icon={RefreshCwIcon} label="Actualizar" onClick={onRefresh} />
          <ActionButton icon={DownloadIcon} label="Exportar" disabled />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PlanningHeader`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/PlanningHeader.jsx src/features/planning/components/PlanningHeader.test.jsx
git commit -m "feat: add PlanningHeader component"
```

---

## Task 17: `PlanningDrawer` component

**Files:**
- Create: `src/features/planning/components/PlanningDrawer.jsx`
- Test: `src/features/planning/components/PlanningDrawer.test.jsx`

**Interfaces:**
- Consumes: `XIcon` from Task 4; `StatusBadge` from `src/features/dashboard/components/StatusBadge.jsx`; `formatClockTime` from `src/features/dashboard/mappers.js` (all existing).
- Produces: `<PlanningDrawer flight={Flight|null} onClose={() => void} />`. Renders nothing when `flight` is `null`. Consumed by `PlanningPage` (Task 18).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/components/PlanningDrawer.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningDrawer from './PlanningDrawer';

const FLIGHT = {
  id: 'flt-1',
  flightNumber: 'DM161',
  airlineName: 'ARAJET',
  status: 'scheduled',
  scheduledTime: '2026-08-05T08:05:00-04:00',
  estimatedTime: '2026-08-05T08:05:00-04:00',
  origin: 'PUJ',
  destination: 'JFK',
  aircraftType: 'A320',
  position: 'A5',
  supervisor: 'J. Ramírez',
  agents: ['M. Castillo', 'R. Peña'],
  teams: ['Rampa 2'],
  services: ['Combustible'],
  observations: 'Sin novedades.',
  history: [{ at: '2026-08-05T07:00:00-04:00', note: 'Planificación creada' }],
};

describe('PlanningDrawer', () => {
  it('renders nothing when there is no selected flight', () => {
    const { container } = render(<PlanningDrawer flight={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every detail section for the selected flight', () => {
    render(<PlanningDrawer flight={FLIGHT} onClose={() => {}} />);
    expect(screen.getByText('DM161 · ARAJET')).toBeInTheDocument();
    expect(screen.getByText('PUJ → JFK')).toBeInTheDocument();
    expect(screen.getByText('A320')).toBeInTheDocument();
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('M. Castillo, R. Peña')).toBeInTheDocument();
    expect(screen.getByText('Rampa 2')).toBeInTheDocument();
    expect(screen.getByText('Combustible')).toBeInTheDocument();
    expect(screen.getByText('Sin novedades.')).toBeInTheDocument();
    expect(screen.getByText('Planificación creada')).toBeInTheDocument();
  });

  it('shows a fallback message in the history section when there are no events', () => {
    render(<PlanningDrawer flight={{ ...FLIGHT, history: [] }} onClose={() => {}} />);
    expect(screen.getByText('Sin eventos registrados')).toBeInTheDocument();
  });

  it('disables the three action buttons with a "Próximamente" tooltip', () => {
    render(<PlanningDrawer flight={FLIGHT} onClose={() => {}} />);
    for (const label of ['Editar planificación', 'Asignar recursos', 'Crear Work Order']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Próximamente');
    }
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<PlanningDrawer flight={FLIGHT} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PlanningDrawer`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `PlanningDrawer.jsx`**

Create `src/features/planning/components/PlanningDrawer.jsx`:

```jsx
import { XIcon } from './icons';
import StatusBadge from '../../dashboard/components/StatusBadge';
import { formatClockTime } from '../../dashboard/mappers';

function Section({ title, children }) {
  return (
    <div className="space-y-1 border-b border-black/5 pb-3 dark:border-white/5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
        {title}
      </h3>
      <div className="text-sm text-ink-900 dark:text-text-primary-dark">{children}</div>
    </div>
  );
}

function ListOrEmpty({ items, emptyLabel }) {
  if (!items || items.length === 0) {
    return <span className="text-text-secondary-light dark:text-text-secondary-dark">{emptyLabel}</span>;
  }
  return <span>{items.join(', ')}</span>;
}

const DISABLED_ACTIONS = ['Editar planificación', 'Asignar recursos', 'Crear Work Order'];

export default function PlanningDrawer({ flight, onClose }) {
  if (!flight) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
      />
      <aside
        data-testid="planning-drawer"
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-black/5 bg-white/95 p-5 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
              {flight.flightNumber} · {flight.airlineName}
            </p>
            <StatusBadge domain="flight" status={flight.status} />
          </div>
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Section title="Información general">
            <p>
              {flight.origin} → {flight.destination}
            </p>
            <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Programado: {formatClockTime(flight.scheduledTime)} · Estimado: {formatClockTime(flight.estimatedTime)}
            </p>
          </Section>

          <Section title="Aeronave">{flight.aircraftType}</Section>

          <Section title="Tripulación">
            <ListOrEmpty items={flight.supervisor ? [flight.supervisor] : []} emptyLabel="Sin supervisor asignado" />
          </Section>

          <Section title="Posición asignada">
            {flight.position ?? (
              <span className="text-text-secondary-light dark:text-text-secondary-dark">Sin posición asignada</span>
            )}
          </Section>

          <Section title="Agentes">
            <ListOrEmpty items={flight.agents} emptyLabel="Sin agentes asignados" />
          </Section>

          <Section title="Equipos">
            <ListOrEmpty items={flight.teams} emptyLabel="Sin equipos asignados" />
          </Section>

          <Section title="Servicios">
            <ListOrEmpty items={flight.services} emptyLabel="Sin servicios registrados" />
          </Section>

          <Section title="Observaciones">
            {flight.observations || (
              <span className="text-text-secondary-light dark:text-text-secondary-dark">Sin observaciones</span>
            )}
          </Section>

          <Section title="Historial">
            {flight.history.length === 0 ? (
              <span className="text-text-secondary-light dark:text-text-secondary-dark">Sin eventos registrados</span>
            ) : (
              <ul className="space-y-1">
                {flight.history.map(entry => (
                  <li key={entry.at} className="text-xs">
                    <span className="font-mono text-text-secondary-light dark:text-text-secondary-dark">
                      {formatClockTime(entry.at)}
                    </span>{' '}
                    {entry.note}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {DISABLED_ACTIONS.map(label => (
            <button
              key={label}
              type="button"
              disabled
              title="Próximamente"
              className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
            >
              {label}
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PlanningDrawer`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/components/PlanningDrawer.jsx src/features/planning/components/PlanningDrawer.test.jsx
git commit -m "feat: add PlanningDrawer component"
```

---

## Task 18: `PlanningPage` composition

**Files:**
- Create: `src/features/planning/PlanningPage.jsx`
- Test: `src/features/planning/PlanningPage.test.jsx`

**Interfaces:**
- Consumes: `PlanningHeader` (Task 16), `PlanningFilters` (Task 14), `PlanningKPIs` (Task 13), `ViewSwitcher` (Task 15), `FlightTimeline` (Task 10), `PlanningDrawer` (Task 17), `PlanningSkeleton` (Task 11), `EmptyPlanningState` (Task 12), `usePlanningFilters` (Task 6), `computeKpis`/`getFilterOptions` (Task 5), `ModulePlaceholder` from `src/features/shell/components/ModulePlaceholder.jsx` and `CalendarIcon` from `src/features/shell/components/icons.jsx` (both existing).
- Produces: `<PlanningPage status={'loading'|'success'|'error'} data={PlanningSnapshot|null} error={Error|null} onRetry={() => void} forceState?={'default'|'loading'|'planningEmpty'|'planningNoResults'|'planningError'} />`. Consumed by `AppShell` (Task 20).

- [ ] **Step 1: Write the failing test**

Create `src/features/planning/PlanningPage.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningPage from './PlanningPage';

const FLIGHTS = [
  {
    id: 'flt-1',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    estimatedTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    station: 'PUJ',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    teams: ['Rampa 2'],
    services: ['Combustible'],
    conflict: null,
    observations: '',
    history: [],
  },
  {
    id: 'flt-2',
    flightNumber: 'AA904',
    airlineIata: 'AA',
    airlineName: 'AMERICAN',
    status: 'delayed',
    scheduledTime: '2026-08-05T09:20:00-04:00',
    estimatedTime: '2026-08-05T09:50:00-04:00',
    origin: 'MIA',
    destination: 'PUJ',
    aircraftType: 'B737-800',
    position: 'B21',
    station: 'PUJ',
    supervisor: 'K. Objío',
    agents: [],
    teams: [],
    services: [],
    conflict: { reason: 'Posición B21 con doble asignación' },
    observations: '',
    history: [],
  },
];

const SNAPSHOT = { station: { code: 'PUJ' }, date: '2026-08-05', flights: FLIGHTS };

describe('PlanningPage', () => {
  it('renders the header, KPIs, and timeline once data is provided', () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(screen.getByText('Vuelos del día')).toBeInTheDocument();
    expect(screen.getByText('DM161 · ARAJET')).toBeInTheDocument();
  });

  it('renders the skeleton when status is loading', () => {
    render(<PlanningPage status="loading" data={null} error={null} onRetry={() => {}} />);
    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
  });

  it('renders the skeleton when forceState is loading even if data already succeeded', () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="loading" />);
    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
  });

  it('shows a recoverable error state with a retry action when status is error', async () => {
    const onRetry = vi.fn();
    render(<PlanningPage status="error" data={null} error={new Error('network down')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the no-flights empty state when forceState is planningEmpty, ignoring a real error', () => {
    render(
      <PlanningPage
        status="error"
        data={null}
        error={new Error('network down')}
        onRetry={() => {}}
        forceState="planningEmpty"
      />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Sin vuelos programados')).toBeInTheDocument();
  });

  it('shows the no-results empty state when forceState is planningNoResults even though flights exist', () => {
    render(
      <PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} forceState="planningNoResults" />
    );
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('opens the drawer with flight detail when a flight card is clicked, and closes it', async () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} />);
    await userEvent.click(screen.getByText('DM161 · ARAJET'));
    expect(screen.getByTestId('planning-drawer')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(screen.queryByTestId('planning-drawer')).not.toBeInTheDocument();
  });

  it('switches to the table placeholder view when selected in the ViewSwitcher', async () => {
    render(<PlanningPage status="success" data={SNAPSHOT} error={null} onRetry={() => {}} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Tabla' }));
    expect(screen.getByText('Vista de tabla')).toBeInTheDocument();
    expect(screen.queryByTestId('flight-timeline')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PlanningPage`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `PlanningPage.jsx`**

Create `src/features/planning/PlanningPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import PlanningHeader from './components/PlanningHeader';
import PlanningFilters from './components/PlanningFilters';
import PlanningKPIs from './components/PlanningKPIs';
import ViewSwitcher from './components/ViewSwitcher';
import FlightTimeline from './components/FlightTimeline';
import PlanningDrawer from './components/PlanningDrawer';
import PlanningSkeleton from './components/PlanningSkeleton';
import EmptyPlanningState from './components/EmptyPlanningState';
import ModulePlaceholder from '../shell/components/ModulePlaceholder';
import { CalendarIcon } from '../shell/components/icons';
import { usePlanningFilters } from './usePlanningFilters';
import { computeKpis, getFilterOptions } from './planningMappers';

export default function PlanningPage({ status, data, error, onRetry, forceState = 'default' }) {
  const [activeView, setActiveView] = useState('timeline');
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'planningError';

  const flights = forceState === 'planningEmpty' ? [] : data?.flights ?? [];
  const { filters, setFilter, quickFilter, setQuickFilter, filteredFlights } = usePlanningFilters(flights);
  const displayedFlights = forceState === 'planningNoResults' ? [] : filteredFlights;

  const kpis = computeKpis(flights);
  const options = getFilterOptions(flights);
  const selectedFlight = flights.find(flight => flight.id === selectedFlightId) ?? null;

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">
          No se pudo cargar la planificación operativa de la estación.
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
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PlanningHeader onRefresh={onRetry} />

      <PlanningFilters
        filters={filters}
        onFilterChange={setFilter}
        quickFilter={quickFilter}
        onQuickFilter={setQuickFilter}
        options={options}
      />

      <PlanningKPIs kpis={kpis} loading={isLoading} />

      <ViewSwitcher active={activeView} onChange={setActiveView} />

      {isLoading ? (
        <PlanningSkeleton />
      ) : activeView !== 'timeline' ? (
        <ModulePlaceholder
          icon={CalendarIcon}
          label={activeView === 'table' ? 'Vista de tabla' : 'Vista de calendario'}
          description="Esta vista estará disponible en una próxima iteración del módulo."
        />
      ) : displayedFlights.length === 0 ? (
        <EmptyPlanningState reason={flights.length === 0 ? 'no-flights' : 'no-results'} />
      ) : (
        <FlightTimeline flights={displayedFlights} now={now} onSelectFlight={setSelectedFlightId} />
      )}

      <PlanningDrawer flight={selectedFlight} onClose={() => setSelectedFlightId(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PlanningPage`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/planning/PlanningPage.jsx src/features/planning/PlanningPage.test.jsx
git commit -m "feat: add PlanningPage composition"
```

---

## Task 19: Extend `DevPreviewPanel` with Planning forced states

**Files:**
- Modify: `src/features/dashboard/components/DevPreviewPanel.jsx`
- Modify: `src/features/dashboard/components/DevPreviewPanel.test.jsx`

**Interfaces:**
- Produces: three additional `forceState` values reachable from the existing dev-only panel: `'planningEmpty'`, `'planningNoResults'`, `'planningError'`. No change to `usePreviewControls.js` — `forceState` was already a generic string. `AppShell` (Task 20) passes the same shared `forceState` value to both `DashboardPage` and `PlanningPage`.

- [ ] **Step 1: Write the failing test**

Add to `src/features/dashboard/components/DevPreviewPanel.test.jsx`, inside the existing `describe('DevPreviewPanel', ...)` block:

```js
  it('exposes the Planning-module forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel theme="light" forceState="default" onToggleTheme={() => {}} onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /planificación: sin vuelos/i }));
    expect(onSetForceState).toHaveBeenCalledWith('planningEmpty');

    await userEvent.click(screen.getByRole('button', { name: /planificación: sin resultados/i }));
    expect(onSetForceState).toHaveBeenCalledWith('planningNoResults');

    await userEvent.click(screen.getByRole('button', { name: /planificación: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('planningError');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DevPreviewPanel`
Expected: FAIL — no buttons match those names yet.

- [ ] **Step 3: Add the new state buttons**

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
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- DevPreviewPanel`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/DevPreviewPanel.jsx src/features/dashboard/components/DevPreviewPanel.test.jsx
git commit -m "feat: add Planning forced-state buttons to the dev preview panel"
```

---

## Task 20: Wire `PlanningPage` into `AppShell`

**Files:**
- Modify: `src/features/shell/AppShell.jsx`
- Modify: `src/features/shell/AppShell.test.jsx`

**Interfaces:**
- Consumes: `usePlanningData` (Task 3), `PlanningPage` (Task 18).
- Produces: `AppShell` renders `<PlanningPage />` (fed by its own `usePlanningData` call and its own retry token) when `activeModule.id === MODULE_IDS.PLANNING`, replacing the `ModulePlaceholder` branch for that module only. Every other unbuilt module still falls through to `ModulePlaceholder`.

- [ ] **Step 1: Write the failing test**

Add to `src/features/shell/AppShell.test.jsx`, inside the existing `describe('AppShell', ...)` block:

```jsx
  it('switches to the Planning module and renders the real planning screen', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    vi.spyOn(planningService, 'getPlanningSnapshot').mockResolvedValue({
      station: { code: 'PUJ' },
      date: '2026-08-05',
      flights: [],
    });
    render(<AppShell />);
    await waitFor(() => expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument());

    const nav = screen.getByRole('navigation');
    await userEvent.click(within(nav).getByText('Planificación operativa'));

    expect(await screen.findByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(within(nav).getByText('Planificación operativa').closest('button')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
```

This test needs `import * as planningService from '../../services/planningService';` alongside the existing `dashboardService` import at the top of the file — add it there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AppShell`
Expected: FAIL — clicking "Planificación operativa" still shows the "En construcción" `ModulePlaceholder`, not the heading "Planificación Operativa".

- [ ] **Step 3: Wire `PlanningPage` into `AppShell.jsx`**

In `src/features/shell/AppShell.jsx`, add the imports:

```js
import PlanningPage from '../planning/PlanningPage';
import { usePlanningData } from '../planning/usePlanningData';
```

Add a second retry-token state and hook call alongside the existing Dashboard ones:

```js
const [planningRetryToken, setPlanningRetryToken] = useState(0);
const planning = usePlanningData('PUJ', undefined, planningRetryToken);
```

Replace the `main` content's ternary:

```jsx
        <main key={activeModule.id} className="flex-1 overflow-y-auto p-6 [animation:elevant-fade-in_180ms_ease-out]">
          {activeModule.id === MODULE_IDS.DASHBOARD ? (
            <DashboardPage
              status={status}
              data={data}
              error={error}
              onRetry={() => setRetryToken(token => token + 1)}
              forceState={forceState}
            />
          ) : activeModule.id === MODULE_IDS.PLANNING ? (
            <PlanningPage
              status={planning.status}
              data={planning.data}
              error={planning.error}
              onRetry={() => setPlanningRetryToken(token => token + 1)}
              forceState={forceState}
            />
          ) : (
            <ModulePlaceholder
              icon={activeModule.icon}
              label={activeModule.label}
              description={activeModule.description}
            />
          )}
        </main>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AppShell`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — every test across the project, including the pre-existing Dashboard, Sidebar, and shell tests, still passes.

- [ ] **Step 6: Commit**

```bash
git add src/features/shell/AppShell.jsx src/features/shell/AppShell.test.jsx
git commit -m "feat: wire PlanningPage into AppShell's module switcher"
```
