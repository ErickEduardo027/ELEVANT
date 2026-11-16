# Admin/OCC Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Administrador/OCC Dashboard for ELEVANT — the landing screen after login, showing a real-time overview of flights, services, agents, and pending approvals for AVIAM Ltd. at PUJ.

**Architecture:** A standalone React page (`DashboardPage`) under `src/features/dashboard/`, composed from small presentational components, fed by a `useDashboardData` hook that calls a service adapter (`src/services/dashboardService.js`) returning mocked data shaped like the future real API response. Tailwind CSS (with brand tokens) is added to the existing Vite preview scaffold. A second Vite HTML entry (`dashboard.html` / `src/dashboard-main.jsx`) renders the page standalone, independent of `LoginPage`'s entry, since no router exists yet.

**Tech Stack:** React 18, Vite 6, Tailwind CSS 3, Vitest + React Testing Library + jsdom for tests.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-01-admin-occ-dashboard-design.md` — follow it exactly for tokens, layout, and component boundaries.
- Zero emojis anywhere in UI text, tooltips, or code comments.
- Iconography: hand-made line/outline SVGs only (stroke ~1.6–1.8px), no icon font/library, no decorative consumer-app icons.
- Color tokens (exact hex, do not introduce any other color):
  - `ink-900` `#0B1F3F`, `accent-600` `#145DC4`, `signal-500` `#F2661E`
  - Light: bg `#F7F9FB`, card `#FFFFFF`, text primary `#0B1F3F`, text secondary `#6B7684`
  - Dark: bg `#0A1220`, card `rgba(11,31,63,0.55)`, text primary `#F4F6F9`, text secondary `#94A3B8`
  - Status: info `#145DC4`, active `#F2661E`, success `#1E9E6B`, warning `#D9A441`, danger `#C4453C`
- Typography: Inter for UI/body/headings (tabular-nums on numeric KPI values); IBM Plex Mono for flight numbers, airline codes, station/gate codes, and timestamps.
- Dark mode via Tailwind `class` strategy (toggling a `dark` class on `<html>`), both modes must reach the same polish level.
- All text in the UI is Spanish (matches the spec's Spanish copy).
- No router, no real API calls — mocked data only, matching the documented contract shape.
- Respect `frontend/web/README.md` folder conventions: `src/features`, `src/services`, `src/components` (shared cross-feature bits only if truly shared; this plan keeps everything feature-scoped under `src/features/dashboard/components/` since nothing here is reused elsewhere yet).

---

## Task 1: Tailwind, fonts, and test tooling setup

**Files:**
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/styles/tokens.css`
- Modify: `index.html`
- Modify: `package.json`
- Create: `vite.config.js` (modify existing to add test config)
- Create: `tests/setupTests.js`
- Test: `tests/setupTests.smoke.test.js`

**Interfaces:**
- Produces: Tailwind utility classes using tokens `bg-surface-light`, `bg-surface-dark`, `bg-surface-dark-card`, `text-ink-900`, `text-accent-600`, `text-signal-500`, `text-status-info|active|success|warning|danger`, `font-sans` (Inter), `font-mono` (IBM Plex Mono). These exact class-name tokens are relied on by every later task.
- Produces: `npm test` runs Vitest with jsdom + `@testing-library/jest-dom` matchers globally available.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install -D tailwindcss@^3.4.0 postcss autoprefixer vitest @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.4.0 @testing-library/user-event@^14.5.0 jsdom
```

- [ ] **Step 2: Create Tailwind config with brand tokens**

Create `tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './dashboard.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        'ink-900': '#0B1F3F',
        'accent-600': '#145DC4',
        'signal-500': '#F2661E',
        surface: {
          light: '#F7F9FB',
          'light-card': '#FFFFFF',
          dark: '#0A1220',
          'dark-card': 'rgba(11,31,63,0.55)',
        },
        text: {
          'primary-light': '#0B1F3F',
          'secondary-light': '#6B7684',
          'primary-dark': '#F4F6F9',
          'secondary-dark': '#94A3B8',
        },
        status: {
          info: '#145DC4',
          active: '#F2661E',
          success: '#1E9E6B',
          warning: '#D9A441',
          danger: '#C4453C',
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Create PostCSS config**

Create `postcss.config.js`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Create the global stylesheet with fonts and Tailwind layers**

Create `src/styles/tokens.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  font-feature-settings: 'tnum' 1;
}

body {
  @apply bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5: Add Vitest config to vite.config.js**

Modify `vite.config.js` to:
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev preview only — not the project's chosen framework (see README.md).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        dashboard: 'dashboard.html',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setupTests.js',
  },
});
```

- [ ] **Step 6: Create test setup file**

Create `tests/setupTests.js`:
```js
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 7: Write a smoke test to verify the test runner works**

Create `tests/setupTests.smoke.test.js`:
```js
import { describe, expect, it } from 'vitest';

describe('test tooling', () => {
  it('runs and has jest-dom matchers available', () => {
    document.body.innerHTML = '<p>hola</p>';
    expect(document.body).toHaveTextContent('hola');
  });
});
```

- [ ] **Step 8: Add the test script to package.json**

Modify `package.json` `scripts` to add:
```json
"test": "vitest run"
```

- [ ] **Step 9: Run the smoke test to verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 10: Commit**

```bash
git add tailwind.config.js postcss.config.js src/styles/tokens.css vite.config.js tests/setupTests.js tests/setupTests.smoke.test.js package.json package-lock.json
git commit -m "chore: add Tailwind, brand tokens, and Vitest tooling"
```

---

## Task 2: Status metadata and StatusBadge component

**Files:**
- Create: `src/features/dashboard/statusMeta.js`
- Create: `src/features/dashboard/components/StatusBadge.jsx`
- Test: `src/features/dashboard/statusMeta.test.js`
- Test: `src/features/dashboard/components/StatusBadge.test.jsx`

**Interfaces:**
- Produces: `STATUS_COLORS: { info, active, success, warning, danger }` (hex strings).
- Produces: `getStatusMeta(domain: 'flight' | 'service', status: string) => { label: string, color: keyof STATUS_COLORS }`.
- Produces: `<StatusBadge domain="flight"|"service" status={string} />` React component.

- [ ] **Step 1: Write the failing test for statusMeta**

Create `src/features/dashboard/statusMeta.test.js`:
```js
import { describe, expect, it } from 'vitest';
import { STATUS_COLORS, getStatusMeta } from './statusMeta';

describe('getStatusMeta', () => {
  it('maps known flight statuses to label and color', () => {
    expect(getStatusMeta('flight', 'scheduled')).toEqual({ label: 'Programado', color: 'info' });
    expect(getStatusMeta('flight', 'delayed')).toEqual({ label: 'Retrasado', color: 'warning' });
    expect(getStatusMeta('flight', 'cancelled')).toEqual({ label: 'Cancelado', color: 'danger' });
  });

  it('maps known service statuses to label and color', () => {
    expect(getStatusMeta('service', 'pendingReview')).toEqual({
      label: 'Pendiente de revisión',
      color: 'warning',
    });
  });

  it('falls back to the raw status string for unknown statuses', () => {
    expect(getStatusMeta('flight', 'mystery')).toEqual({ label: 'mystery', color: 'info' });
  });

  it('exposes all five status colors as hex strings', () => {
    expect(STATUS_COLORS).toEqual({
      info: '#145DC4',
      active: '#F2661E',
      success: '#1E9E6B',
      warning: '#D9A441',
      danger: '#C4453C',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- statusMeta`
Expected: FAIL — `statusMeta.js` does not exist.

- [ ] **Step 3: Implement statusMeta.js**

Create `src/features/dashboard/statusMeta.js`:
```js
export const STATUS_COLORS = {
  info: '#145DC4',
  active: '#F2661E',
  success: '#1E9E6B',
  warning: '#D9A441',
  danger: '#C4453C',
};

export const FLIGHT_STATUS_META = {
  scheduled: { label: 'Programado', color: 'info' },
  enRoute: { label: 'En ruta', color: 'active' },
  landed: { label: 'Aterrizado', color: 'success' },
  delayed: { label: 'Retrasado', color: 'warning' },
  diverted: { label: 'Desviado', color: 'danger' },
  cancelled: { label: 'Cancelado', color: 'danger' },
};

export const SERVICE_STATUS_META = {
  pending: { label: 'Pendiente', color: 'warning' },
  assigned: { label: 'Asignado', color: 'info' },
  inProgress: { label: 'En ejecución', color: 'active' },
  pendingReview: { label: 'Pendiente de revisión', color: 'warning' },
};

export function getStatusMeta(domain, status) {
  const table = domain === 'flight' ? FLIGHT_STATUS_META : SERVICE_STATUS_META;
  return table[status] ?? { label: status, color: 'info' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- statusMeta`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for StatusBadge**

Create `src/features/dashboard/components/StatusBadge.test.jsx`:
```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the Spanish label for a known status', () => {
    render(<StatusBadge domain="flight" status="delayed" />);
    expect(screen.getByText('Retrasado')).toBeInTheDocument();
  });

  it('colors the indicator dot using the status color hex', () => {
    render(<StatusBadge domain="flight" status="cancelled" />);
    const dot = screen.getByTestId('status-dot');
    expect(dot).toHaveStyle({ backgroundColor: '#C4453C' });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- StatusBadge`
Expected: FAIL — `StatusBadge.jsx` does not exist.

- [ ] **Step 7: Implement StatusBadge.jsx**

Create `src/features/dashboard/components/StatusBadge.jsx`:
```jsx
import { STATUS_COLORS, getStatusMeta } from '../statusMeta';

export default function StatusBadge({ domain, status }) {
  const meta = getStatusMeta(domain, status);
  const dotColor = STATUS_COLORS[meta.color];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-900 dark:text-text-primary-dark">
      <span
        data-testid="status-dot"
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      {meta.label}
    </span>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- StatusBadge`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/features/dashboard/statusMeta.js src/features/dashboard/statusMeta.test.js src/features/dashboard/components/StatusBadge.jsx src/features/dashboard/components/StatusBadge.test.jsx
git commit -m "feat: add status metadata mapping and StatusBadge component"
```

---

## Task 3: dashboardService mock adapter

**Files:**
- Create: `src/services/dashboardService.js`
- Test: `src/services/dashboardService.test.js`

**Interfaces:**
- Produces: `getDashboardSnapshot(stationCode?: string) => Promise<DashboardSnapshot>` where `DashboardSnapshot` has the exact shape documented in the design spec (`station`, `kpis`, `flyAware`, `flightStatusDistribution`, `pendingApprovals`, `alerts`, `positionsPreviewUrl`). This is the only function later tasks import from this module.

- [ ] **Step 1: Write the failing test**

Create `src/services/dashboardService.test.js`:
```js
import { describe, expect, it } from 'vitest';
import { getDashboardSnapshot } from './dashboardService';

describe('getDashboardSnapshot', () => {
  it('resolves with all top-level fields of the documented contract', async () => {
    const snapshot = await getDashboardSnapshot();
    expect(snapshot).toEqual(
      expect.objectContaining({
        station: expect.objectContaining({ code: expect.any(String) }),
        kpis: expect.objectContaining({
          flightsToday: expect.any(Number),
          servicesPending: expect.any(Number),
          servicesExecuted: expect.any(Number),
          agentsActive: expect.any(Number),
          approvalsPending: expect.any(Number),
        }),
        flyAware: expect.objectContaining({
          status: expect.stringMatching(/^(online|degraded|error)$/),
          lastSyncMinutesAgo: expect.any(Number),
        }),
        flightStatusDistribution: expect.any(Array),
        pendingApprovals: expect.any(Array),
        alerts: expect.any(Array),
        positionsPreviewUrl: expect.any(String),
      })
    );
  });

  it('reflects the requested station code', async () => {
    const snapshot = await getDashboardSnapshot('MDT');
    expect(snapshot.station.code).toBe('MDT');
  });

  it('defaults to PUJ when no station code is passed', async () => {
    const snapshot = await getDashboardSnapshot();
    expect(snapshot.station.code).toBe('PUJ');
  });

  it('includes all six flight status buckets', async () => {
    const snapshot = await getDashboardSnapshot();
    const statuses = snapshot.flightStatusDistribution.map(entry => entry.status);
    expect(statuses.sort()).toEqual(
      ['cancelled', 'delayed', 'diverted', 'enRoute', 'landed', 'scheduled'].sort()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dashboardService`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement dashboardService.js**

Create `src/services/dashboardService.js`:
```js
const BASE_SNAPSHOT = {
  kpis: {
    flightsToday: 42,
    servicesPending: 18,
    servicesExecuted: 96,
    agentsActive: 27,
    approvalsPending: 4,
  },
  flyAware: {
    status: 'online',
    lastSyncMinutesAgo: 2,
  },
  flightStatusDistribution: [
    { status: 'scheduled', count: 14 },
    { status: 'enRoute', count: 9 },
    { status: 'landed', count: 11 },
    { status: 'delayed', count: 5 },
    { status: 'diverted', count: 1 },
    { status: 'cancelled', count: 2 },
  ],
  pendingApprovals: [
    {
      id: 'appr-1',
      flightNumber: 'DM161',
      airlineIata: 'DM',
      station: 'PUJ',
      agent: 'J. Ramírez',
      requestedAt: '2026-08-01T13:50:00-04:00',
      status: 'pendingReview',
    },
    {
      id: 'appr-2',
      flightNumber: 'AA904',
      airlineIata: 'AA',
      station: 'PUJ',
      agent: 'M. Castillo',
      requestedAt: '2026-08-01T13:35:00-04:00',
      status: 'pendingReview',
    },
    {
      id: 'appr-3',
      flightNumber: 'DL2210',
      airlineIata: 'DL',
      station: 'PUJ',
      agent: 'R. Peña',
      requestedAt: '2026-08-01T13:10:00-04:00',
      status: 'pendingReview',
    },
    {
      id: 'appr-4',
      flightNumber: 'UA1470',
      airlineIata: 'UA',
      station: 'PUJ',
      agent: 'K. Objío',
      requestedAt: '2026-08-01T12:55:00-04:00',
      status: 'pendingReview',
    },
  ],
  alerts: [
    {
      id: 'alert-1',
      severity: 'warning',
      message: 'Vuelo DM161 no llegó a la posición asignada según hora estimada',
      occurredAt: '2026-08-01T14:20:00-04:00',
    },
    {
      id: 'alert-2',
      severity: 'info',
      message: 'Posición 10 inhabilitada automáticamente por configuración 9-Alfa',
      occurredAt: '2026-08-01T13:58:00-04:00',
    },
    {
      id: 'alert-3',
      severity: 'critical',
      message: 'Vuelo AA904 marcado como desviado por FlyAware',
      occurredAt: '2026-08-01T13:40:00-04:00',
    },
    {
      id: 'alert-4',
      severity: 'warning',
      message: 'Agente K. Objío excede el tiempo estimado de servicio en DL2210',
      occurredAt: '2026-08-01T13:22:00-04:00',
    },
  ],
  positionsPreviewUrl: '/positions-map-preview.png',
};

export async function getDashboardSnapshot(stationCode = 'PUJ') {
  return {
    ...BASE_SNAPSHOT,
    station: {
      code: stationCode,
      localAbbr: 'AST',
      localTime: '2026-08-01T14:32:00-04:00',
      utcTime: '2026-08-01T18:32:00Z',
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dashboardService`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboardService.js src/services/dashboardService.test.js
git commit -m "feat: add dashboardService mock adapter"
```

---

## Task 4: useCountUp hook

**Files:**
- Create: `src/features/dashboard/useCountUp.js`
- Test: `src/features/dashboard/useCountUp.test.js`

**Interfaces:**
- Produces: `useCountUp(target: number, options?: { duration?: number, steps?: number }) => number`. Used by `KpiCard` (Task 7) to render the count-up animation.

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/useCountUp.test.js`:
```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from './useCountUp';

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts up to the target value over the given duration', () => {
    const { result } = renderHook(() => useCountUp(90, { duration: 300, steps: 3 }));
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(90);
  });

  it('jumps immediately to the target when prefers-reduced-motion is set', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: true });

    const { result } = renderHook(() => useCountUp(50));
    expect(result.current).toBe(50);

    window.matchMedia = originalMatchMedia;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useCountUp`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement useCountUp.js**

Create `src/features/dashboard/useCountUp.js`:
```js
import { useEffect, useState } from 'react';

export function useCountUp(target, { duration = 900, steps = 30 } = {}) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || typeof target !== 'number') {
      setValue(target ?? 0);
      return undefined;
    }

    let step = 0;
    const stepMs = duration / steps;
    const id = setInterval(() => {
      step += 1;
      const progress = Math.min(step / steps, 1);
      setValue(Math.round(target * progress));
      if (progress >= 1) clearInterval(id);
    }, stepMs);

    return () => clearInterval(id);
  }, [target, duration, steps]);

  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useCountUp`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/useCountUp.js src/features/dashboard/useCountUp.test.js
git commit -m "feat: add useCountUp hook with reduced-motion support"
```

---

## Task 5: useDashboardData hook

**Files:**
- Create: `src/features/dashboard/useDashboardData.js`
- Test: `src/features/dashboard/useDashboardData.test.js`

**Interfaces:**
- Consumes: `getDashboardSnapshot(stationCode)` from `src/services/dashboardService.js` (Task 3).
- Produces: `useDashboardData(stationCode?: string) => { status: 'loading'|'success'|'error', data: DashboardSnapshot|null, error: Error|null }`. Consumed by `DashboardPage` (Task 16).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/useDashboardData.test.js`:
```js
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import * as dashboardService from '../../services/dashboardService';

describe('useDashboardData', () => {
  it('starts in loading state then resolves to success with the snapshot', async () => {
    const fakeSnapshot = { station: { code: 'PUJ' } };
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(fakeSnapshot);

    const { result } = renderHook(() => useDashboardData('PUJ'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual(fakeSnapshot);
    expect(result.current.error).toBeNull();
  });

  it('moves to error state when the service rejects', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useDashboardData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useDashboardData`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement useDashboardData.js**

Create `src/features/dashboard/useDashboardData.js`:
```js
import { useEffect, useState } from 'react';
import { getDashboardSnapshot } from '../../services/dashboardService';

export function useDashboardData(stationCode = 'PUJ') {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });

    getDashboardSnapshot(stationCode)
      .then(data => {
        if (!cancelled) setState({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!cancelled) setState({ status: 'error', data: null, error });
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode]);

  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useDashboardData`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/useDashboardData.js src/features/dashboard/useDashboardData.test.js
git commit -m "feat: add useDashboardData hook"
```

---

## Task 6: Line icon set

**Files:**
- Create: `src/features/dashboard/components/icons/index.jsx`
- Test: `src/features/dashboard/components/icons/icons.test.jsx`

**Interfaces:**
- Produces named exports, each a React component accepting `{ className }` and rendering a decorative (`aria-hidden="true"`) inline SVG, stroke-based, viewBox `0 0 24 24`: `BellIcon`, `SunIcon`, `MoonIcon`, `ChevronDownIcon`, `PlaneIcon`, `ShieldCheckIcon`, `MapPinIcon`, `AlertTriangleIcon`, `RefreshCwIcon`, `ChecklistIcon`. Consumed by Topbar, FlyAwareStatusPanel, PositionsMapPreview, ApprovalPreviewList empty state, AlertsFeed (Tasks 8–14).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/components/icons/icons.test.jsx`:
```jsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  BellIcon,
  SunIcon,
  MoonIcon,
  ChevronDownIcon,
  PlaneIcon,
  ShieldCheckIcon,
  MapPinIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  ChecklistIcon,
} from './index';

const ICONS = {
  BellIcon,
  SunIcon,
  MoonIcon,
  ChevronDownIcon,
  PlaneIcon,
  ShieldCheckIcon,
  MapPinIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  ChecklistIcon,
};

describe('icon set', () => {
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

Run: `npm test -- icons.test`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the icon set**

Create `src/features/dashboard/components/icons/index.jsx`:
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

export function BellIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 9.5a6 6 0 0 1 12 0v4.2l1.6 2.6H4.4L6 13.7V9.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function SunIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.5-6.5-1.4 1.4M6.9 17.1l-1.4 1.4m0-13 1.4 1.4m10.2 10.2 1.4 1.4" />
    </Icon>
  );
}

export function MoonIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </Icon>
  );
}

export function ChevronDownIcon(props) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function PlaneIcon(props) {
  return (
    <Icon {...props}>
      <path d="M3.5 12.8 20 7.2c.9-.3 1.6.5 1.2 1.3l-2 3.8-6 2-1 4.7-1.6.5-.6-5-4-1.2Z" />
    </Icon>
  );
}

export function ShieldCheckIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3.2 5 6v5.4c0 4.3 2.9 8 7 9.4 4.1-1.4 7-5.1 7-9.4V6l-7-2.8Z" />
      <path d="m9.2 12.1 2 2 3.6-3.9" />
    </Icon>
  );
}

export function MapPinIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </Icon>
  );
}

export function AlertTriangleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 4 2.5 20h19L12 4Z" />
      <path d="M12 10.5v4.2" />
      <circle cx="12" cy="17.3" r="0.15" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function RefreshCwIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 8a8 8 0 0 0-14.6-4.3M4 16a8 8 0 0 0 14.6 4.3" />
      <path d="M20 3.5V8h-4.5M4 20.5V16h4.5" />
    </Icon>
  );
}

export function ChecklistIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9 6h10M9 12h10M9 18h10" />
      <path d="m4 6 1 1 1.6-1.6M4 12l1 1 1.6-1.6M4 18l1 1 1.6-1.6" />
    </Icon>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- icons.test`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/icons/index.jsx src/features/dashboard/components/icons/icons.test.jsx
git commit -m "feat: add hand-made line icon set for the dashboard"
```

---

## Task 7: KpiCard and ProgressRing

**Files:**
- Create: `src/features/dashboard/components/ProgressRing.jsx`
- Create: `src/features/dashboard/components/KpiCard.jsx`
- Test: `src/features/dashboard/components/ProgressRing.test.jsx`
- Test: `src/features/dashboard/components/KpiCard.test.jsx`

**Interfaces:**
- Produces: `<ProgressRing pending={number} executed={number} size?={number} />` — renders a percentage-complete ring.
- Produces: `<KpiCard label={string} value={number} icon={Component} tone?={'default'|'signal'} loading?={boolean} visual?={ReactNode} />`. When `visual` is passed it renders instead of the numeric count-up. `loading` renders a shimmer skeleton in place of content. Consumed by `DashboardPage` (Task 16).
- Consumes: `useCountUp` from Task 4, icon components from Task 6.

- [ ] **Step 1: Write the failing test for ProgressRing**

Create `src/features/dashboard/components/ProgressRing.test.jsx`:
```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressRing from './ProgressRing';

describe('ProgressRing', () => {
  it('renders the executed-vs-total percentage rounded to the nearest whole number', () => {
    render(<ProgressRing pending={18} executed={96} />);
    // 96 / (18 + 96) = 84.2% -> rounds to 84%
    expect(screen.getByText('84%')).toBeInTheDocument();
  });

  it('renders 0% when there is no activity yet', () => {
    render(<ProgressRing pending={0} executed={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ProgressRing`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement ProgressRing.jsx**

Create `src/features/dashboard/components/ProgressRing.jsx`:
```jsx
export default function ProgressRing({ pending, executed, size = 72, strokeWidth = 8 }) {
  const total = pending + executed;
  const percent = total === 0 ? 0 : Math.round((executed / total) * 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-black/10 dark:stroke-white/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="fill-none stroke-accent-600 transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="absolute font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
        {percent}%
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ProgressRing`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for KpiCard**

Create `src/features/dashboard/components/KpiCard.test.jsx`:
```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import KpiCard from './KpiCard';
import { PlaneIcon } from './icons';
import * as countUpModule from '../useCountUp';

describe('KpiCard', () => {
  it('renders the label and the count-up value', () => {
    vi.spyOn(countUpModule, 'useCountUp').mockReturnValue(42);
    render(<KpiCard label="Vuelos programados hoy" value={42} icon={PlaneIcon} />);
    expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders a custom visual instead of the numeric value when provided', () => {
    render(
      <KpiCard
        label="Servicios"
        value={0}
        icon={PlaneIcon}
        visual={<div data-testid="custom-visual" />}
      />
    );
    expect(screen.getByTestId('custom-visual')).toBeInTheDocument();
  });

  it('renders a skeleton instead of content when loading', () => {
    render(<KpiCard label="Vuelos programados hoy" value={42} icon={PlaneIcon} loading />);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Vuelos programados hoy')).not.toBeInTheDocument();
  });

  it('applies the signal color to the value when tone is signal', () => {
    vi.spyOn(countUpModule, 'useCountUp').mockReturnValue(4);
    render(<KpiCard label="Aprobaciones pendientes" value={4} icon={PlaneIcon} tone="signal" />);
    expect(screen.getByText('4')).toHaveClass('text-signal-500');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- KpiCard`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement KpiCard.jsx**

Create `src/features/dashboard/components/KpiCard.jsx`:
```jsx
import { useCountUp } from '../useCountUp';

export default function KpiCard({ label, value, icon: IconComponent, tone = 'default', loading = false, visual }) {
  const animatedValue = useCountUp(typeof value === 'number' ? value : 0);

  if (loading) {
    return (
      <div
        data-testid="kpi-skeleton"
        className="h-28 animate-pulse rounded-2xl border border-black/5 bg-white/60 dark:bg-surface-dark-card"
      />
    );
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">
          {label}
        </span>
        <IconComponent className="h-4 w-4 text-accent-600" />
      </div>
      <div className="mt-3">
        {visual ?? (
          <span
            className={`font-sans text-3xl font-semibold tabular-nums ${
              tone === 'signal' ? 'text-signal-500' : 'text-ink-900 dark:text-text-primary-dark'
            }`}
          >
            {animatedValue}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- KpiCard`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add src/features/dashboard/components/ProgressRing.jsx src/features/dashboard/components/ProgressRing.test.jsx src/features/dashboard/components/KpiCard.jsx src/features/dashboard/components/KpiCard.test.jsx
git commit -m "feat: add ProgressRing and KpiCard components"
```

---

## Task 8: FlyAwareStatusPanel

**Files:**
- Create: `src/features/dashboard/components/FlyAwareStatusPanel.jsx`
- Test: `src/features/dashboard/components/FlyAwareStatusPanel.test.jsx`

**Interfaces:**
- Produces: `<FlyAwareStatusPanel status={'online'|'degraded'|'error'} lastSyncMinutesAgo={number} />`. Consumed by `DashboardPage` (Task 16).
- Consumes: `RefreshCwIcon`, `AlertTriangleIcon` from Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/components/FlyAwareStatusPanel.test.jsx`:
```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlyAwareStatusPanel from './FlyAwareStatusPanel';

describe('FlyAwareStatusPanel', () => {
  it('shows the online message with minutes since last sync', () => {
    render(<FlyAwareStatusPanel status="online" lastSyncMinutesAgo={2} />);
    expect(screen.getByText(/en línea/i)).toBeInTheDocument();
    expect(screen.getByText(/hace 2 min/i)).toBeInTheDocument();
  });

  it('shows a degraded message', () => {
    render(<FlyAwareStatusPanel status="degraded" lastSyncMinutesAgo={9} />);
    expect(screen.getByText(/con demoras/i)).toBeInTheDocument();
  });

  it('shows a disconnected error message', () => {
    render(<FlyAwareStatusPanel status="error" lastSyncMinutesAgo={40} />);
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
    expect(screen.getByText(/hace 40 min/i)).toBeInTheDocument();
  });

  it('announces status changes politely for screen readers', () => {
    render(<FlyAwareStatusPanel status="error" lastSyncMinutesAgo={40} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlyAwareStatusPanel`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement FlyAwareStatusPanel.jsx**

Create `src/features/dashboard/components/FlyAwareStatusPanel.jsx`:
```jsx
import { AlertTriangleIcon, RefreshCwIcon } from './icons';

const STATUS_META = {
  online: {
    title: 'FlyAware en línea',
    colorClass: 'text-status-success',
    dotClass: 'bg-status-success',
  },
  degraded: {
    title: 'FlyAware con demoras',
    colorClass: 'text-status-warning',
    dotClass: 'bg-status-warning',
  },
  error: {
    title: 'FlyAware sin conexión',
    colorClass: 'text-status-danger',
    dotClass: 'bg-status-danger',
  },
};

export default function FlyAwareStatusPanel({ status, lastSyncMinutesAgo }) {
  const meta = STATUS_META[status];
  const Icon = status === 'error' ? AlertTriangleIcon : RefreshCwIcon;

  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-xl border border-black/5 bg-white/70 px-4 py-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card ${
        status === 'error' ? 'ring-1 ring-status-danger/40' : ''
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      <Icon className={`h-4 w-4 shrink-0 ${meta.colorClass}`} />
      <span className={`text-sm font-medium ${meta.colorClass}`}>{meta.title}</span>
      <span className="ml-auto text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Última sincronización hace {lastSyncMinutesAgo} min
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlyAwareStatusPanel`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/FlyAwareStatusPanel.jsx src/features/dashboard/components/FlyAwareStatusPanel.test.jsx
git commit -m "feat: add FlyAwareStatusPanel component"
```

---

## Task 9: FlightStripCard (signature component)

**Files:**
- Create: `src/features/dashboard/components/FlightStripCard.jsx`
- Test: `src/features/dashboard/components/FlightStripCard.test.jsx`

**Interfaces:**
- Produces: `<FlightStripCard accentColor={string} primary={string} secondary?={string} meta?={string} badge?={ReactNode} />`. Consumed by `ApprovalPreviewList` (Task 11) and `AlertsFeed` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/components/FlightStripCard.test.jsx`:
```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightStripCard from './FlightStripCard';

describe('FlightStripCard', () => {
  it('renders primary, secondary, and meta text', () => {
    render(
      <FlightStripCard
        accentColor="#D9A441"
        primary="DM161 · DM"
        secondary="PUJ · J. Ramírez"
        meta="13:50"
      />
    );
    expect(screen.getByText('DM161 · DM')).toBeInTheDocument();
    expect(screen.getByText('PUJ · J. Ramírez')).toBeInTheDocument();
    expect(screen.getByText('13:50')).toBeInTheDocument();
  });

  it('applies the accent color to the left border', () => {
    render(<FlightStripCard accentColor="#C4453C" primary="Alerta" />);
    expect(screen.getByTestId('flight-strip')).toHaveStyle({ borderLeftColor: '#C4453C' });
  });

  it('renders an optional badge node', () => {
    render(
      <FlightStripCard accentColor="#145DC4" primary="DM161" badge={<span>Pendiente</span>} />
    );
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightStripCard`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement FlightStripCard.jsx**

Create `src/features/dashboard/components/FlightStripCard.jsx`:
```jsx
export default function FlightStripCard({ accentColor, primary, secondary, meta, badge }) {
  return (
    <div
      data-testid="flight-strip"
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className="flex items-center gap-3 rounded-lg border border-black/5 bg-white/70 px-3 py-2.5 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          {primary}
        </div>
        {secondary && (
          <div className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {secondary}
          </div>
        )}
      </div>
      {badge}
      {meta && (
        <div className="shrink-0 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {meta}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightStripCard`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/FlightStripCard.jsx src/features/dashboard/components/FlightStripCard.test.jsx
git commit -m "feat: add FlightStripCard signature component"
```

---

## Task 10: Strip mappers and ApprovalPreviewList

**Files:**
- Create: `src/features/dashboard/mappers.js`
- Create: `src/features/dashboard/components/ApprovalPreviewList.jsx`
- Test: `src/features/dashboard/mappers.test.js`
- Test: `src/features/dashboard/components/ApprovalPreviewList.test.jsx`

**Interfaces:**
- Produces: `formatClockTime(isoString: string) => string`, `mapApprovalToStrip(approval) => { key, accentColor, primary, secondary, meta, status }`, `mapAlertToStrip(alert) => { key, accentColor, primary, secondary: null, meta }`.
- Produces: `<ApprovalPreviewList approvals={Array} onViewAll={() => void} loading?={boolean} />`. Consumed by `DashboardPage` (Task 16).
- Consumes: `FlightStripCard` (Task 9), `StatusBadge` (Task 2), `ChecklistIcon` (Task 6), `STATUS_COLORS`/`getStatusMeta` (Task 2).

- [ ] **Step 1: Write the failing test for mappers**

Create `src/features/dashboard/mappers.test.js`:
```js
import { describe, expect, it } from 'vitest';
import { formatClockTime, mapApprovalToStrip, mapAlertToStrip } from './mappers';

describe('formatClockTime', () => {
  it('formats an ISO string as HH:MM', () => {
    expect(formatClockTime('2026-08-01T13:50:00-04:00')).toMatch(/^\d{1,2}:\d{2}/);
  });
});

describe('mapApprovalToStrip', () => {
  it('maps an approval into flight-strip fields', () => {
    const approval = {
      id: 'appr-1',
      flightNumber: 'DM161',
      airlineIata: 'DM',
      station: 'PUJ',
      agent: 'J. Ramírez',
      requestedAt: '2026-08-01T13:50:00-04:00',
      status: 'pendingReview',
    };
    const strip = mapApprovalToStrip(approval);
    expect(strip.key).toBe('appr-1');
    expect(strip.accentColor).toBe('#D9A441');
    expect(strip.primary).toBe('DM161 · DM');
    expect(strip.secondary).toBe('PUJ · J. Ramírez');
    expect(strip.status).toBe('pendingReview');
  });
});

describe('mapAlertToStrip', () => {
  it('maps a critical alert to the danger color', () => {
    const alert = {
      id: 'alert-3',
      severity: 'critical',
      message: 'Vuelo AA904 marcado como desviado por FlyAware',
      occurredAt: '2026-08-01T13:40:00-04:00',
    };
    const strip = mapAlertToStrip(alert);
    expect(strip.key).toBe('alert-3');
    expect(strip.accentColor).toBe('#C4453C');
    expect(strip.primary).toBe(alert.message);
    expect(strip.secondary).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mappers`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement mappers.js**

Create `src/features/dashboard/mappers.js`:
```js
import { STATUS_COLORS, getStatusMeta } from './statusMeta';

export function formatClockTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

export function mapApprovalToStrip(approval) {
  const meta = getStatusMeta('service', approval.status);
  return {
    key: approval.id,
    accentColor: STATUS_COLORS[meta.color],
    primary: `${approval.flightNumber} · ${approval.airlineIata}`,
    secondary: `${approval.station} · ${approval.agent}`,
    meta: formatClockTime(approval.requestedAt),
    status: approval.status,
  };
}

const ALERT_SEVERITY_COLOR = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

export function mapAlertToStrip(alert) {
  const colorKey = ALERT_SEVERITY_COLOR[alert.severity] ?? 'info';
  return {
    key: alert.id,
    accentColor: STATUS_COLORS[colorKey],
    primary: alert.message,
    secondary: null,
    meta: formatClockTime(alert.occurredAt),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- mappers`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for ApprovalPreviewList**

Create `src/features/dashboard/components/ApprovalPreviewList.test.jsx`:
```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalPreviewList from './ApprovalPreviewList';

const APPROVALS = Array.from({ length: 7 }, (_, i) => ({
  id: `appr-${i}`,
  flightNumber: `DM1${i}`,
  airlineIata: 'DM',
  station: 'PUJ',
  agent: 'J. Ramírez',
  requestedAt: '2026-08-01T13:50:00-04:00',
  status: 'pendingReview',
}));

describe('ApprovalPreviewList', () => {
  it('renders at most 5 approvals even if more are passed', () => {
    render(<ApprovalPreviewList approvals={APPROVALS} onViewAll={() => {}} />);
    expect(screen.getAllByTestId('flight-strip')).toHaveLength(5);
  });

  it('calls onViewAll when the "Ver todas" button is clicked', async () => {
    const onViewAll = vi.fn();
    render(<ApprovalPreviewList approvals={APPROVALS} onViewAll={onViewAll} />);
    await userEvent.click(screen.getByRole('button', { name: /ver todas/i }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('renders an elegant empty state when there are no approvals', () => {
    render(<ApprovalPreviewList approvals={[]} onViewAll={() => {}} />);
    expect(screen.getByText(/no hay operaciones pendientes de revisión/i)).toBeInTheDocument();
    expect(screen.queryByTestId('flight-strip')).not.toBeInTheDocument();
  });

  it('renders a skeleton list when loading', () => {
    render(<ApprovalPreviewList approvals={[]} onViewAll={() => {}} loading />);
    expect(within(screen.getByTestId('approvals-skeleton')).getAllByTestId('strip-skeleton-row')).toHaveLength(5);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- ApprovalPreviewList`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement ApprovalPreviewList.jsx**

Create `src/features/dashboard/components/ApprovalPreviewList.jsx`:
```jsx
import FlightStripCard from './FlightStripCard';
import StatusBadge from './StatusBadge';
import { ChecklistIcon } from './icons';
import { mapApprovalToStrip } from '../mappers';

function SkeletonRows() {
  return (
    <div data-testid="approvals-skeleton" className="space-y-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          data-testid="strip-skeleton-row"
          className="h-12 animate-pulse rounded-lg bg-black/5 dark:bg-white/5"
        />
      ))}
    </div>
  );
}

export default function ApprovalPreviewList({ approvals, onViewAll, loading = false }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          Aprobaciones pendientes
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Ver todas
        </button>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : approvals.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ChecklistIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
          <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
            No hay operaciones pendientes de revisión
          </p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Las nuevas solicitudes aparecerán aquí en cuanto se registren.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {approvals.slice(0, 5).map(approval => {
            const strip = mapApprovalToStrip(approval);
            return (
              <FlightStripCard
                key={strip.key}
                accentColor={strip.accentColor}
                primary={strip.primary}
                secondary={strip.secondary}
                meta={strip.meta}
                badge={<StatusBadge domain="service" status={strip.status} />}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- ApprovalPreviewList`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add src/features/dashboard/mappers.js src/features/dashboard/mappers.test.js src/features/dashboard/components/ApprovalPreviewList.jsx src/features/dashboard/components/ApprovalPreviewList.test.jsx
git commit -m "feat: add strip mappers and ApprovalPreviewList"
```

---

## Task 11: AlertsFeed

**Files:**
- Create: `src/features/dashboard/components/AlertsFeed.jsx`
- Test: `src/features/dashboard/components/AlertsFeed.test.jsx`

**Interfaces:**
- Produces: `<AlertsFeed alerts={Array} loading?={boolean} />`. Consumed by `DashboardPage` (Task 16).
- Consumes: `FlightStripCard` (Task 9), `mapAlertToStrip` (Task 10).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/components/AlertsFeed.test.jsx`:
```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AlertsFeed from './AlertsFeed';

const ALERTS = Array.from({ length: 8 }, (_, i) => ({
  id: `alert-${i}`,
  severity: 'warning',
  message: `Alerta número ${i}`,
  occurredAt: '2026-08-01T13:50:00-04:00',
}));

describe('AlertsFeed', () => {
  it('renders at most 6 alerts even if more are passed', () => {
    render(<AlertsFeed alerts={ALERTS} />);
    expect(screen.getAllByTestId('flight-strip')).toHaveLength(6);
  });

  it('renders a scrollable container', () => {
    render(<AlertsFeed alerts={ALERTS} />);
    expect(screen.getByTestId('alerts-scroll')).toHaveClass('overflow-y-auto');
  });

  it('renders the alert message text', () => {
    render(<AlertsFeed alerts={[ALERTS[0]]} />);
    expect(screen.getByText('Alerta número 0')).toBeInTheDocument();
  });

  it('renders a skeleton list when loading', () => {
    render(<AlertsFeed alerts={[]} loading />);
    expect(screen.getByTestId('alerts-skeleton')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AlertsFeed`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement AlertsFeed.jsx**

Create `src/features/dashboard/components/AlertsFeed.jsx`:
```jsx
import FlightStripCard from './FlightStripCard';
import { mapAlertToStrip } from '../mappers';

export default function AlertsFeed({ alerts, loading = false }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
        Alertas y notificaciones
      </h2>

      {loading ? (
        <div data-testid="alerts-skeleton" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
          ))}
        </div>
      ) : (
        <div data-testid="alerts-scroll" className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {alerts.slice(0, 6).map(alert => {
            const strip = mapAlertToStrip(alert);
            return (
              <FlightStripCard
                key={strip.key}
                accentColor={strip.accentColor}
                primary={strip.primary}
                meta={strip.meta}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AlertsFeed`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/AlertsFeed.jsx src/features/dashboard/components/AlertsFeed.test.jsx
git commit -m "feat: add AlertsFeed component"
```

---

## Task 12: FlightStatusChart

**Files:**
- Create: `src/features/dashboard/components/FlightStatusChart.jsx`
- Test: `src/features/dashboard/components/FlightStatusChart.test.jsx`

**Interfaces:**
- Produces: `<FlightStatusChart distribution={Array<{status, count}>} />`. Consumed by `DashboardPage` (Task 16).
- Consumes: `FLIGHT_STATUS_META`, `STATUS_COLORS` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/components/FlightStatusChart.test.jsx`:
```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightStatusChart from './FlightStatusChart';

const DISTRIBUTION = [
  { status: 'scheduled', count: 14 },
  { status: 'enRoute', count: 9 },
  { status: 'landed', count: 11 },
  { status: 'delayed', count: 5 },
  { status: 'diverted', count: 1 },
  { status: 'cancelled', count: 2 },
];

describe('FlightStatusChart', () => {
  it('renders one legend row per status with its label and count', () => {
    render(<FlightStatusChart distribution={DISTRIBUTION} />);
    expect(screen.getByText('Programado')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders one donut segment per distribution entry', () => {
    render(<FlightStatusChart distribution={DISTRIBUTION} />);
    expect(screen.getAllByTestId('donut-segment')).toHaveLength(DISTRIBUTION.length);
  });

  it('renders the total flight count in the center of the donut', () => {
    render(<FlightStatusChart distribution={DISTRIBUTION} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FlightStatusChart`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement FlightStatusChart.jsx**

Create `src/features/dashboard/components/FlightStatusChart.jsx`:
```jsx
import { STATUS_COLORS, getStatusMeta } from '../statusMeta';

const SIZE = 160;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function FlightStatusChart({ distribution }) {
  const total = distribution.reduce((sum, entry) => sum + entry.count, 0);
  let cumulative = 0;

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-4 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
        Distribución de vuelos por estado
      </h2>
      <div className="flex flex-wrap items-center gap-6">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} className="-rotate-90">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              className="fill-none stroke-black/5 dark:stroke-white/5"
            />
            {distribution.map(entry => {
              const meta = getStatusMeta('flight', entry.status);
              const fraction = total === 0 ? 0 : entry.count / total;
              const dash = fraction * CIRCUMFERENCE;
              const dashArray = `${dash} ${CIRCUMFERENCE - dash}`;
              const dashOffset = -cumulative;
              cumulative += dash;
              return (
                <circle
                  key={entry.status}
                  data-testid="donut-segment"
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  strokeWidth={STROKE}
                  strokeDasharray={dashArray}
                  strokeDashoffset={dashOffset}
                  className="fill-none"
                  stroke={STATUS_COLORS[meta.color]}
                />
              );
            })}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-semibold text-ink-900 dark:text-text-primary-dark">
            {total}
          </span>
        </div>

        <ul className="min-w-40 flex-1 space-y-1.5">
          {distribution.map(entry => {
            const meta = getStatusMeta('flight', entry.status);
            return (
              <li key={entry.status} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-ink-900 dark:text-text-primary-dark">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[meta.color] }}
                    aria-hidden="true"
                  />
                  {meta.label}
                </span>
                <span className="font-mono text-text-secondary-light dark:text-text-secondary-dark">
                  {entry.count}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- FlightStatusChart`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/FlightStatusChart.jsx src/features/dashboard/components/FlightStatusChart.test.jsx
git commit -m "feat: add FlightStatusChart donut component"
```

---

## Task 13: PositionsMapPreview

**Files:**
- Create: `src/features/dashboard/components/PositionsMapPreview.jsx`
- Test: `src/features/dashboard/components/PositionsMapPreview.test.jsx`

**Interfaces:**
- Produces: `<PositionsMapPreview previewUrl={string} onOpenMap={() => void} />`. Consumed by `DashboardPage` (Task 16).
- Consumes: `MapPinIcon` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/components/PositionsMapPreview.test.jsx`:
```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PositionsMapPreview from './PositionsMapPreview';

describe('PositionsMapPreview', () => {
  it('renders the preview image with the given url', () => {
    render(<PositionsMapPreview previewUrl="/positions-map-preview.png" onOpenMap={() => {}} />);
    expect(screen.getByRole('img', { name: /mapa de posiciones/i })).toHaveAttribute(
      'src',
      '/positions-map-preview.png'
    );
  });

  it('calls onOpenMap when the button is clicked', async () => {
    const onOpenMap = vi.fn();
    render(<PositionsMapPreview previewUrl="/x.png" onOpenMap={onOpenMap} />);
    await userEvent.click(screen.getByRole('button', { name: /ver mapa completo/i }));
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PositionsMapPreview`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement PositionsMapPreview.jsx**

Create `src/features/dashboard/components/PositionsMapPreview.jsx`:
```jsx
import { MapPinIcon } from './icons';

export default function PositionsMapPreview({ previewUrl, onOpenMap }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          <MapPinIcon className="h-4 w-4 text-accent-600" />
          Mapa de posiciones
        </h2>
        <button
          type="button"
          onClick={onOpenMap}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Ver mapa completo
        </button>
      </div>
      <img
        src={previewUrl}
        alt="Mapa de posiciones de la estación"
        className="h-32 w-full rounded-lg object-cover"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PositionsMapPreview`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/PositionsMapPreview.jsx src/features/dashboard/components/PositionsMapPreview.test.jsx
git commit -m "feat: add PositionsMapPreview component"
```

---

## Task 14: Topbar

**Files:**
- Create: `src/features/dashboard/components/Topbar.jsx`
- Test: `src/features/dashboard/components/Topbar.test.jsx`

**Interfaces:**
- Produces: `<Topbar station={{code, localAbbr, localTime, utcTime}} notificationsCount={number} theme={'light'|'dark'} onToggleTheme={() => void} user={{name, role}} />`. Consumed by `DashboardPage` (Task 16).
- Consumes: `formatClockTime` (Task 10), `BellIcon`, `SunIcon`, `MoonIcon`, `ChevronDownIcon` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/components/Topbar.test.jsx`:
```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Topbar from './Topbar';

const STATION = {
  code: 'PUJ',
  localAbbr: 'AST',
  localTime: '2026-08-01T14:32:00-04:00',
  utcTime: '2026-08-01T18:32:00Z',
};

const USER = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

describe('Topbar', () => {
  it('renders the station code and both clocks with their labels', () => {
    render(
      <Topbar station={STATION} notificationsCount={3} theme="light" onToggleTheme={() => {}} user={USER} />
    );
    expect(screen.getByText('PUJ')).toBeInTheDocument();
    expect(screen.getByText(/AST/)).toBeInTheDocument();
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it('shows the notifications badge count only when greater than zero', () => {
    const { rerender } = render(
      <Topbar station={STATION} notificationsCount={3} theme="light" onToggleTheme={() => {}} user={USER} />
    );
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3');

    rerender(
      <Topbar station={STATION} notificationsCount={0} theme="light" onToggleTheme={() => {}} user={USER} />
    );
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  });

  it('calls onToggleTheme when the theme button is clicked', async () => {
    const onToggleTheme = vi.fn();
    render(
      <Topbar station={STATION} notificationsCount={0} theme="light" onToggleTheme={onToggleTheme} user={USER} />
    );
    await userEvent.click(screen.getByRole('button', { name: /cambiar a modo oscuro/i }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('opens the user menu on avatar click and shows profile and logout options', async () => {
    render(
      <Topbar station={STATION} notificationsCount={0} theme="light" onToggleTheme={() => {}} user={USER} />
    );
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /laisha ramírez/i }));
    expect(screen.getByText('Perfil')).toBeInTheDocument();
    expect(screen.getByText('Cerrar sesión')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Topbar`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement Topbar.jsx**

Create `src/features/dashboard/components/Topbar.jsx`:
```jsx
import { useState } from 'react';
import { formatClockTime } from '../mappers';
import { BellIcon, ChevronDownIcon, MoonIcon, SunIcon } from './icons';

export default function Topbar({ station, notificationsCount, theme, onToggleTheme, user }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex items-center gap-4 border-b border-black/5 bg-white/70 px-6 py-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <button
        type="button"
        className="flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark"
      >
        {station.code}
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center gap-3 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <span>{station.localAbbr} {formatClockTime(station.localTime)}</span>
        <span aria-hidden="true">·</span>
        <span>UTC {formatClockTime(station.utcTime)}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button type="button" aria-label="Notificaciones" className="relative rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/5">
          <BellIcon className="h-4.5 w-4.5 text-ink-900 dark:text-text-primary-dark" />
          {notificationsCount > 0 && (
            <span
              data-testid="notifications-badge"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-500 px-1 text-[10px] font-semibold text-white"
            >
              {notificationsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
          className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/5"
        >
          {theme === 'light' ? (
            <MoonIcon className="h-4.5 w-4.5 text-ink-900" />
          ) : (
            <SunIcon className="h-4.5 w-4.5 text-text-primary-dark" />
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
              {user.name.split(' ').map(part => part[0]).slice(0, 2).join('')}
            </span>
            <span className="text-xs font-medium text-ink-900 dark:text-text-primary-dark">
              {user.name}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-2 w-44 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
              <div className="px-3 py-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {user.role}
              </div>
              <button type="button" className="block w-full px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5">
                Perfil
              </button>
              <button type="button" className="block w-full px-3 py-1.5 text-left text-sm text-status-danger hover:bg-black/5 dark:hover:bg-white/5">
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Topbar`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/Topbar.jsx src/features/dashboard/components/Topbar.test.jsx
git commit -m "feat: add Topbar component"
```

---

## Task 15: usePreviewControls and DevPreviewPanel

**Files:**
- Create: `src/features/dashboard/usePreviewControls.js`
- Create: `src/features/dashboard/components/DevPreviewPanel.jsx`
- Test: `src/features/dashboard/usePreviewControls.test.js`
- Test: `src/features/dashboard/components/DevPreviewPanel.test.jsx`

**Interfaces:**
- Produces: `usePreviewControls() => { theme: 'light'|'dark', toggleTheme: () => void, forceState: 'default'|'loading'|'flyAwareError'|'emptyApprovals', setForceState: (s) => void }`.
- Produces: `<DevPreviewPanel theme forceState onToggleTheme onSetForceState />`. Both consumed only by `DashboardPage` (Task 16), never shipped to a production build.

- [ ] **Step 1: Write the failing test for usePreviewControls**

Create `src/features/dashboard/usePreviewControls.test.js`:
```js
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePreviewControls } from './usePreviewControls';

describe('usePreviewControls', () => {
  it('starts in light theme and default force state', () => {
    const { result } = renderHook(() => usePreviewControls());
    expect(result.current.theme).toBe('light');
    expect(result.current.forceState).toBe('default');
  });

  it('toggles the theme between light and dark', () => {
    const { result } = renderHook(() => usePreviewControls());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('light');
  });

  it('sets the forced preview state', () => {
    const { result } = renderHook(() => usePreviewControls());
    act(() => result.current.setForceState('flyAwareError'));
    expect(result.current.forceState).toBe('flyAwareError');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- usePreviewControls`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement usePreviewControls.js**

Create `src/features/dashboard/usePreviewControls.js`:
```js
import { useCallback, useState } from 'react';

export function usePreviewControls() {
  const [theme, setTheme] = useState('light');
  const [forceState, setForceState] = useState('default');

  const toggleTheme = useCallback(() => {
    setTheme(current => (current === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggleTheme, forceState, setForceState };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- usePreviewControls`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for DevPreviewPanel**

Create `src/features/dashboard/components/DevPreviewPanel.test.jsx`:
```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DevPreviewPanel from './DevPreviewPanel';

describe('DevPreviewPanel', () => {
  it('is labeled clearly as a development-only tool', () => {
    render(
      <DevPreviewPanel theme="light" forceState="default" onToggleTheme={() => {}} onSetForceState={() => {}} />
    );
    expect(screen.getByText(/vista previa.*solo desarrollo/i)).toBeInTheDocument();
  });

  it('calls onToggleTheme when the theme button is clicked', async () => {
    const onToggleTheme = vi.fn();
    render(
      <DevPreviewPanel theme="light" forceState="default" onToggleTheme={onToggleTheme} onSetForceState={() => {}} />
    );
    await userEvent.click(screen.getByRole('button', { name: /tema/i }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('calls onSetForceState with the matching state per button', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel theme="light" forceState="default" onToggleTheme={() => {}} onSetForceState={onSetForceState} />
    );
    await userEvent.click(screen.getByRole('button', { name: /carga/i }));
    expect(onSetForceState).toHaveBeenCalledWith('loading');

    await userEvent.click(screen.getByRole('button', { name: /flyaware caído/i }));
    expect(onSetForceState).toHaveBeenCalledWith('flyAwareError');

    await userEvent.click(screen.getByRole('button', { name: /sin aprobaciones/i }));
    expect(onSetForceState).toHaveBeenCalledWith('emptyApprovals');

    await userEvent.click(screen.getByRole('button', { name: /^normal$/i }));
    expect(onSetForceState).toHaveBeenCalledWith('default');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- DevPreviewPanel`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement DevPreviewPanel.jsx**

Create `src/features/dashboard/components/DevPreviewPanel.jsx`:
```jsx
const STATE_BUTTONS = [
  { state: 'default', label: 'Normal' },
  { state: 'loading', label: 'Carga' },
  { state: 'flyAwareError', label: 'FlyAware caído' },
  { state: 'emptyApprovals', label: 'Sin aprobaciones' },
];

export default function DevPreviewPanel({ theme, forceState, onToggleTheme, onSetForceState }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 w-64 rounded-xl border border-black/10 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
      <p className="mb-2 font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
        Vista previa (solo desarrollo)
      </p>
      <button
        type="button"
        onClick={onToggleTheme}
        className="mb-2 w-full rounded-md border border-black/10 px-2 py-1 text-left dark:border-white/10"
      >
        Tema: {theme === 'light' ? 'claro' : 'oscuro'}
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        {STATE_BUTTONS.map(({ state, label }) => (
          <button
            key={state}
            type="button"
            onClick={() => onSetForceState(state)}
            className={`rounded-md border px-2 py-1 text-left ${
              forceState === state
                ? 'border-accent-600 text-accent-600'
                : 'border-black/10 text-ink-900 dark:border-white/10 dark:text-text-primary-dark'
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

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- DevPreviewPanel`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/features/dashboard/usePreviewControls.js src/features/dashboard/usePreviewControls.test.js src/features/dashboard/components/DevPreviewPanel.jsx src/features/dashboard/components/DevPreviewPanel.test.jsx
git commit -m "feat: add dev-only preview controls for the 5 dashboard states"
```

---

## Task 16: DashboardPage composition and standalone entry

**Files:**
- Create: `src/features/dashboard/DashboardPage.jsx`
- Create: `src/dashboard-main.jsx`
- Create: `dashboard.html`
- Test: `src/features/dashboard/DashboardPage.test.jsx`

**Interfaces:**
- Consumes every component and hook from Tasks 2–15.
- Produces the fully composed `<DashboardPage />`, rendered standalone by `dashboard-main.jsx` via `dashboard.html` (parallel to `index.html` / `main.jsx` / `LoginPage`).

- [ ] **Step 1: Write the failing test**

Create `src/features/dashboard/DashboardPage.test.jsx`:
```jsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './DashboardPage';
import * as dashboardService from '../../services/dashboardService';

const SNAPSHOT = {
  station: { code: 'PUJ', localAbbr: 'AST', localTime: '2026-08-01T14:32:00-04:00', utcTime: '2026-08-01T18:32:00Z' },
  kpis: { flightsToday: 42, servicesPending: 18, servicesExecuted: 96, agentsActive: 27, approvalsPending: 4 },
  flyAware: { status: 'online', lastSyncMinutesAgo: 2 },
  flightStatusDistribution: [
    { status: 'scheduled', count: 14 },
    { status: 'enRoute', count: 9 },
    { status: 'landed', count: 11 },
    { status: 'delayed', count: 5 },
    { status: 'diverted', count: 1 },
    { status: 'cancelled', count: 2 },
  ],
  pendingApprovals: [
    { id: 'a1', flightNumber: 'DM161', airlineIata: 'DM', station: 'PUJ', agent: 'J. Ramírez', requestedAt: '2026-08-01T13:50:00-04:00', status: 'pendingReview' },
  ],
  alerts: [
    { id: 'al1', severity: 'warning', message: 'Vuelo DM161 no llegó a la posición asignada según hora estimada', occurredAt: '2026-08-01T14:20:00-04:00' },
  ],
  positionsPreviewUrl: '/positions-map-preview.png',
};

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('DashboardPage', () => {
  it('renders the topbar station code and KPI labels once data loads', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('PUJ')).toBeInTheDocument());
    expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument();
    expect(screen.getByText('Agentes en operaciones activas')).toBeInTheDocument();
  });

  it('forces the loading skeleton state via the dev preview panel', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('PUJ')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /carga/i }));
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThan(0);
  });

  it('forces the FlyAware disconnected state via the dev preview panel', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('PUJ')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /flyaware caído/i }));
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
  });

  it('forces the empty approvals state via the dev preview panel', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('PUJ')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /sin aprobaciones/i }));
    expect(screen.getByText(/no hay operaciones pendientes de revisión/i)).toBeInTheDocument();
  });

  it('toggles the dark class on the document root via the theme control', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(SNAPSHOT);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('PUJ')).toBeInTheDocument());

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /cambiar a modo oscuro/i }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DashboardPage`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement DashboardPage.jsx**

Create `src/features/dashboard/DashboardPage.jsx`:
```jsx
import { useEffect } from 'react';
import { useDashboardData } from './useDashboardData';
import { usePreviewControls } from './usePreviewControls';
import Topbar from './components/Topbar';
import KpiCard from './components/KpiCard';
import ProgressRing from './components/ProgressRing';
import FlyAwareStatusPanel from './components/FlyAwareStatusPanel';
import FlightStatusChart from './components/FlightStatusChart';
import ApprovalPreviewList from './components/ApprovalPreviewList';
import AlertsFeed from './components/AlertsFeed';
import PositionsMapPreview from './components/PositionsMapPreview';
import DevPreviewPanel from './components/DevPreviewPanel';
import { PlaneIcon } from './components/icons';

const CURRENT_USER = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

export default function DashboardPage() {
  const { status, data } = useDashboardData('PUJ');
  const { theme, toggleTheme, forceState, setForceState } = usePreviewControls();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const isLoading = status === 'loading' || forceState === 'loading';
  const approvals =
    forceState === 'emptyApprovals' ? [] : data?.pendingApprovals ?? [];
  const flyAware =
    forceState === 'flyAwareError'
      ? { status: 'error', lastSyncMinutesAgo: data?.flyAware?.lastSyncMinutesAgo ?? 0 }
      : data?.flyAware ?? { status: 'online', lastSyncMinutesAgo: 0 };

  return (
    <div className="min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Topbar
        station={data?.station ?? { code: 'PUJ', localAbbr: 'AST', localTime: new Date().toISOString(), utcTime: new Date().toISOString() }}
        notificationsCount={data?.alerts?.length ?? 0}
        theme={theme}
        onToggleTheme={toggleTheme}
        user={CURRENT_USER}
      />

      <main className="mx-auto max-w-[1440px] space-y-4 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Vuelos programados hoy" value={data?.kpis?.flightsToday ?? 0} icon={PlaneIcon} loading={isLoading} />
          <KpiCard
            label="Servicios pendientes vs. ejecutados"
            value={0}
            icon={PlaneIcon}
            loading={isLoading}
            visual={<ProgressRing pending={data?.kpis?.servicesPending ?? 0} executed={data?.kpis?.servicesExecuted ?? 0} />}
          />
          <KpiCard label="Agentes en operaciones activas" value={data?.kpis?.agentsActive ?? 0} icon={PlaneIcon} loading={isLoading} />
          <KpiCard
            label="Aprobaciones pendientes"
            value={data?.kpis?.approvalsPending ?? 0}
            icon={PlaneIcon}
            tone="signal"
            loading={isLoading}
          />
        </div>

        <FlyAwareStatusPanel status={flyAware.status} lastSyncMinutesAgo={flyAware.lastSyncMinutesAgo} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
          <div className="space-y-4">
            <FlightStatusChart distribution={data?.flightStatusDistribution ?? []} />
            <PositionsMapPreview
              previewUrl={data?.positionsPreviewUrl ?? '/positions-map-preview.png'}
              onOpenMap={() => {}}
            />
          </div>
          <div className="space-y-4">
            <ApprovalPreviewList approvals={approvals} onViewAll={() => {}} loading={isLoading} />
            <AlertsFeed alerts={data?.alerts ?? []} loading={isLoading} />
          </div>
        </div>
      </main>

      <DevPreviewPanel
        theme={theme}
        forceState={forceState}
        onToggleTheme={toggleTheme}
        onSetForceState={setForceState}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- DashboardPage`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the standalone HTML entry**

Create `dashboard.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ELEVANT — Dashboard OCC (preview local)</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/dashboard-main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create the standalone entry script**

Create `src/dashboard-main.jsx`:
```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DashboardPage from './features/dashboard/DashboardPage.jsx';
import './styles/tokens.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DashboardPage />
  </StrictMode>,
);
```

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file from Tasks 1–16 passes.

- [ ] **Step 8: Run the dev server and manually verify all 5 states**

Run: `npm run dev`, open `http://localhost:5173/dashboard.html`. Using the floating dev preview panel, verify:
- default (light) state shows all KPIs, chart, approvals, alerts populated
- theme toggle switches to a fully polished dark mode
- "Carga" shows skeleton shimmer on KPIs and approvals
- "FlyAware caído" shows the red disconnected panel
- "Sin aprobaciones" shows the empty state message with no flight-strip rows

- [ ] **Step 9: Commit**

```bash
git add src/features/dashboard/DashboardPage.jsx src/features/dashboard/DashboardPage.test.jsx src/dashboard-main.jsx dashboard.html
git commit -m "feat: compose DashboardPage and add standalone preview entry"
```

---

## Plan Self-Review Notes

- **Spec coverage:** Topbar (station/clocks/notifications/theme/avatar) → Task 14; KPI row → Tasks 4, 7, 16; FlyAware panel → Task 8; distribution chart → Task 12; approvals preview → Tasks 10, 16; alerts feed → Task 11; map quick access → Task 13; microinteractions (count-up, hover, theme transition, skeleton) → Tasks 4, 7, 10, 11; all 8 flight / 4 service states → Task 2 (`statusMeta.js`); 5 deliverable states → Task 15 (dev panel) + Task 16 (wiring); responsive grid → Task 16; brand tokens/typography/glass/icons → Task 1, Task 6.
- **Type consistency check:** `getStatusMeta(domain, status)` (Task 2) is used identically in `mappers.js` (Task 10) and `FlightStatusChart.jsx` (Task 12). `FlightStripCard` props (`accentColor`, `primary`, `secondary`, `meta`, `badge`) match between Task 9's implementation and Tasks 10–11's usage. `useDashboardData` return shape (`status`, `data`, `error`) matches its usage in `DashboardPage` (Task 16).
- **No placeholders:** every step has literal file contents; no "TBD" or "similar to Task N" shortcuts.
