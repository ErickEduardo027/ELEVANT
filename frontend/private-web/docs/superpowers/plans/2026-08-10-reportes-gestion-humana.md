# Reportes de Gestión Humana Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el `ModulePlaceholder` de `/human-resources/reports` por el módulo real de Reportes de Gestión Humana (Vencimientos, Altas/bajas, Personal por terminal y turno, Cobertura de habilitaciones), reutilizando la arquitectura de Reportes de Admin/OCC.

**Architecture:** Nuevo feature `src/features/human-resources/reports/` (página, hooks, mappers, componentes) alimentado por un nuevo `src/services/humanResourcesReportsService.js` que combina los servicios de dominio de GH ya existentes (Habilitaciones, Carnets, Usuarios, Horarios). La UI reutiliza sin cambios `DateRangePicker`, `ReportTable`, `ExpandableReportRow`, `ReportSkeleton`, `ReportEmptyState`, `BarChart` (de `src/features/reports/`), `EquipmentCoverageView` (de Habilitaciones) y los componentes compartidos (`KpiCard`, `Badge`, `ProgressRing`, `CategoryDonutChart`, `HorizontalBarList` de `src/components/`). Solo dos componentes de Admin/OCC se tocan, con un prop opcional retrocompatible cada uno.

**Tech Stack:** React 18 + Vite + Tailwind, sin TypeScript. `react-router-dom` para rutas. Vitest + Testing Library (solo donde ya hay tests).

**Spec:** `docs/superpowers/specs/2026-08-10-reportes-gestion-humana-design.md`

## Global Constraints

- No agregar colores nuevos: usar solo los tonos existentes (`success`/`warning`/`danger`/`info`/`active`/`neutral`) vía `Badge`/`ProgressRing`/`toneColors.js`.
- Cero emojis en código, copys o commits.
- No modificar `src/features/reports/` (Admin/OCC) salvo los dos props opcionales retrocompatibles descritos en las Tasks 1 y 2 — ningún otro archivo de Admin/OCC se toca.
- No modificar `Sidebar`, `HumanResourcesLayout.jsx` ni `navigation.js` — la entrada "Reportes" ya existe.
- **Convención de testing de este módulo**: `src/features/human-resources/` no tiene hoy ningún archivo `.test.*` (verificado: 0 tests en 90 archivos). Los archivos nuevos de este plan (`humanResourcesReportsService.js`, todo `src/features/human-resources/reports/`) **no llevan test nuevo** — se verifican con `npm run build` (el proyecto no tiene script `lint` ni `typecheck`; `build` es lo más cercano disponible y falla ante imports/sintaxis rotos) y con verificación manual en `npm run dev`. La única excepción son los dos archivos de Admin/OCC que sí tienen cobertura hoy (`ExportButton.test.jsx` existe; `ReportTabs.test.jsx` se crea porque generaliza un componente compartido) — ahí sí se agrega un test por cambio, sin tocar los tests existentes.
- Todas las fechas de mocks nuevos usan offset `-04:00` (PUJ/AST), igual que el resto del proyecto.
- No usar `Date.now()`/`new Date()` sin argumentos dentro de funciones puras testeadas por snapshot — no aplica aquí porque no hay tests nuevos con fechas fijas, pero mantener el mismo criterio (`now = new Date()` como parámetro por defecto) que ya usan `mapQualifications`/`mapPermits`.
- Idioma de toda la UI: español (es-DO), igual que el resto del proyecto.

---

### Task 1: Generalizar `ReportTabs` para aceptar un catálogo de tabs propio

**Files:**
- Modify: `src/features/reports/components/ReportTabs.jsx`
- Create: `src/features/reports/components/ReportTabs.test.jsx`

**Interfaces:**
- Consumes: nada nuevo (sigue usando `REPORT_TABS` de `../reportsMappers` como default).
- Produces: `ReportTabs({ tabs = REPORT_TABS, active, onChange })` — la Task 10 (GH `ReportFilterBar`/`ReportsPage`) importará este componente pasando su propio arreglo de tabs vía el nuevo prop `tabs`.

- [ ] **Step 1: Leer el componente actual**

Confirmar el contenido exacto de `src/features/reports/components/ReportTabs.jsx` antes de editar (ya se citó en el diseño, pero re-leer evita un diff basado en memoria).

- [ ] **Step 2: Escribir el test que ejercita el prop nuevo (aún no existe el prop)**

Crear `src/features/reports/components/ReportTabs.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportTabs from './ReportTabs';

describe('ReportTabs', () => {
  it('renders the default REPORT_TABS and marks the active one', () => {
    render(<ReportTabs active="closure" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Cierre operacional' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders a custom tabs prop instead of the default catalog', () => {
    const customTabs = [
      { id: 'a', label: 'Reporte A' },
      { id: 'b', label: 'Reporte B' },
    ];
    render(<ReportTabs tabs={customTabs} active="a" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Reporte A' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cierre operacional' })).not.toBeInTheDocument();
  });

  it('calls onChange with the clicked tab id', async () => {
    const customTabs = [
      { id: 'a', label: 'Reporte A' },
      { id: 'b', label: 'Reporte B' },
    ];
    const onChange = vi.fn();
    render(<ReportTabs tabs={customTabs} active="a" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Reporte B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
```

- [ ] **Step 3: Ejecutar el test y confirmar que el segundo caso falla**

Run: `npx vitest run src/features/reports/components/ReportTabs.test.jsx`
Expected: el primer test PASA (comportamiento actual), el segundo y tercero FALLAN porque `ReportTabs` ignora el prop `tabs` y siempre renderiza `REPORT_TABS`.

- [ ] **Step 4: Agregar el prop `tabs` con default retrocompatible**

En `src/features/reports/components/ReportTabs.jsx`, cambiar la firma y el `.map`:

```jsx
import { REPORT_TABS } from '../reportsMappers';

export default function ReportTabs({ tabs = REPORT_TABS, active, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Tipo de reporte"
      className="inline-flex flex-wrap gap-1 rounded-xl border border-black/10 bg-white/70 p-1 dark:border-white/10 dark:bg-surface-dark-card"
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
            active === tab.id
              ? 'bg-accent-600 text-white'
              : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

(Único cambio real: el parámetro `tabs = REPORT_TABS` y `tabs.map` en vez de `REPORT_TABS.map`.)

- [ ] **Step 5: Ejecutar el test y confirmar que los 3 casos pasan**

Run: `npx vitest run src/features/reports/components/ReportTabs.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 6: Confirmar que Admin/OCC sigue intacto**

Run: `npx vitest run src/features/reports`
Expected: PASS en todos los tests existentes de `src/features/reports/` (nada roto por el cambio).

- [ ] **Step 7: Commit**

```bash
git add src/features/reports/components/ReportTabs.jsx src/features/reports/components/ReportTabs.test.jsx
git commit -m "feat: generaliza ReportTabs para aceptar un catalogo de tabs propio"
```

---

### Task 2: Generalizar `ExportButton` para aceptar una función de exportación propia

**Files:**
- Modify: `src/features/reports/components/ExportButton.jsx`
- Modify: `src/features/reports/components/ExportButton.test.jsx`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `ExportButton({ reportId, exportFn = exportReport, onExported, onExportError, disabled })` — la Task 13 (GH `ReportsHeader`) le pasará `exportFn={exportReport}` importado de `humanResourcesReportsService`.

- [ ] **Step 1: Agregar el caso de test para `exportFn` (aún no existe el prop)**

Añadir al final de `src/features/reports/components/ExportButton.test.jsx` (dentro del mismo `describe`, después del último `it`):

```jsx
  it('uses a custom exportFn instead of the default reportsService.exportReport', async () => {
    const customExportFn = vi.fn().mockResolvedValue({ reportId: 'expirations', format: 'pdf', fileName: 'expirations.pdf' });
    const onExported = vi.fn();
    render(<ExportButton reportId="expirations" exportFn={customExportFn} onExported={onExported} />);

    await userEvent.click(screen.getByRole('button', { name: /exportar/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /completado/i })).toBeInTheDocument(), { timeout: 2000 });
    expect(customExportFn).toHaveBeenCalledWith({ reportId: 'expirations', format: 'pdf' });
    expect(onExported).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'expirations.pdf' }));
  });
```

- [ ] **Step 2: Ejecutar el test y confirmar que el caso nuevo falla**

Run: `npx vitest run src/features/reports/components/ExportButton.test.jsx`
Expected: FAIL en el nuevo caso (`ExportButton` no acepta `exportFn`, sigue llamando al `exportReport` real importado — `customExportFn` nunca se invoca).

- [ ] **Step 3: Agregar el prop `exportFn` con default retrocompatible**

En `src/features/reports/components/ExportButton.jsx`:

```jsx
export default function ExportButton({ reportId, exportFn = exportReport, onExported, onExportError, disabled = false }) {
```

Y en `handleExport`, cambiar la línea `const result = await exportReport({ reportId, format });` por:

```jsx
      const result = await exportFn({ reportId, format });
```

El resto del archivo (imports, estados, JSX del menú) queda igual — el import `import { exportReport } from '../../../services/reportsService';` se mantiene porque sigue siendo el valor por defecto del prop.

- [ ] **Step 4: Ejecutar todos los tests de `ExportButton` y confirmar que pasan**

Run: `npx vitest run src/features/reports/components/ExportButton.test.jsx`
Expected: PASS (5/5 — los 4 casos existentes más el nuevo).

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/components/ExportButton.jsx src/features/reports/components/ExportButton.test.jsx
git commit -m "feat: generaliza ExportButton para aceptar una funcion exportFn propia"
```

---

### Task 3: Crear `humanResourcesReportsService.js` con el reporte de Vencimientos y la exportación

**Files:**
- Create: `src/services/humanResourcesReportsService.js`

**Interfaces:**
- Consumes: `getQualifications` de `src/services/humanResourcesQualificationsService.js` (resuelve `AgentQualification[]`, campos usados: `id, agentId, agentName, employeeNumber, terminals, equipmentId, equipmentName, expiresAt`); `getPermits` de `src/services/humanResourcesPermitsService.js` (resuelve `AirportPermitRecord[]`, campos: `id, agentId, agentName, employeeNumber, terminals, type ('carnet'|'licencia'), expiresAt`); `mapQualifications(records, now)` y `mapPermits(records, now)` — ambas ya devuelven items con `{ id, agentName, terminals, status, statusLabel, statusTone, daysRemaining, dueLabel, record }` (`mapQualifications` agrega `equipmentName`; `mapPermits` agrega `type`, `typeLabel`).
- Produces: `getExpirationReport(filters = {})` → `Promise<{ rows: ExpirationRow[] }>` donde `ExpirationRow = { id, agentName, documentLabel, kind: 'certification'|'permit', kindLabel, terminals: string[], dueDate, daysRemaining, dueLabel, status, statusLabel, statusTone, modulePath }`. `filters` soporta `{ documentKind, status, terminal }` (todos opcionales). También produce `exportReport({ reportId, format })` → `Promise<{ reportId, format, fileName, generatedAt }>`, usada por la Task 13.

- [ ] **Step 1: Crear el archivo con el scaffold, imports y `getExpirationReport`**

Crear `src/services/humanResourcesReportsService.js`:

```js
import { getQualifications, getEquipmentCatalog } from './humanResourcesQualificationsService';
import { getPermits } from './humanResourcesPermitsService';
import { getUsers, getUserHistory } from './humanResourcesUsersService';
import { getShifts } from './humanResourcesSchedulesService';
import { mapQualifications, deriveEquipmentCoverage } from '../features/human-resources/certifications/mappers';
import { mapPermits } from '../features/human-resources/permits/mappers';

// Adaptador stub del módulo "Reportes de Gestión Humana": hoy combina los
// stores en memoria de Habilitaciones, Carnets, Usuarios y Horarios (cada
// uno ya expuesto por su propio servicio); mañana, cada función se conecta
// a su endpoint real sin que useReportsData/los componentes cambien — mismo
// contrato que reportsService.js (Admin/OCC).
//
// CONTRATO PROVISIONAL (ver ClaudeSkillsGH/plan-reportGH/skill.md):
//   GET  /api/hr/reports/expirations              (provisional)
//   GET  /api/hr/reports/account-movements         (provisional)
//   GET  /api/hr/reports/staff-distribution        (provisional)
//   GET  /api/hr/reports/qualification-coverage    (provisional)
//   POST /api/hr/reports/export                    (provisional)
//
// Ningún reporte inventa datos nuevos: cada uno reutiliza el store/mapper ya
// existente de su dominio (no se duplica la regla de "próxima a vencer" de
// Habilitaciones/Carnets, ni el cálculo de cobertura de Habilitaciones).

const EXPIRATION_KIND_META = {
  certification: { label: 'Habilitación', modulePath: '/human-resources/certifications' },
  permit: { label: 'Carnet / Licencia', modulePath: '/human-resources/permits' },
};

function toExpirationRow(item, kind) {
  const meta = EXPIRATION_KIND_META[kind];
  return {
    id: `${kind}-${item.id}`,
    agentName: item.agentName,
    documentLabel: kind === 'certification' ? item.equipmentName : item.typeLabel,
    kind,
    kindLabel: meta.label,
    terminals: item.terminals,
    dueDate: item.record.expiresAt,
    daysRemaining: item.daysRemaining,
    dueLabel: item.dueLabel,
    status: item.status,
    statusLabel: item.statusLabel,
    statusTone: item.statusTone,
    modulePath: meta.modulePath,
  };
}

/**
 * Reporte 1 — Vencimientos: consolida Habilitaciones y Carnets/Licencias.
 * `filters.documentKind` ('certification'|'permit'), `filters.status`
 * ('current'|'expiringSoon'|'expired') y `filters.terminal` ('A'|'B') son
 * opcionales. Orden por defecto: por urgencia (días restantes ascendente).
 */
export async function getExpirationReport(filters = {}) {
  const now = new Date();
  const [qualifications, permits] = await Promise.all([getQualifications(), getPermits()]);

  const rows = [
    ...mapQualifications(qualifications, now).map(item => toExpirationRow(item, 'certification')),
    ...mapPermits(permits, now).map(item => toExpirationRow(item, 'permit')),
  ]
    .filter(row => !filters.documentKind || row.kind === filters.documentKind)
    .filter(row => !filters.status || row.status === filters.status)
    .filter(row => !filters.terminal || row.terminals.includes(filters.terminal))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  return { rows };
}

/**
 * Simula la generación de un reporte en el backend (mismo mock de latencia
 * que exportReport de Admin/OCC).
 */
export async function exportReport({ reportId, format }) {
  await new Promise(resolve => setTimeout(resolve, 900));
  return {
    reportId,
    format,
    fileName: `${reportId}-${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : 'pdf'}`,
    generatedAt: new Date().toISOString(),
  };
}
```

Nota: `getEquipmentCatalog`, `getUsers`, `getUserHistory`, `getShifts`, `deriveEquipmentCoverage` se importan ya en este paso porque las Tasks 4-6 los usan y así el archivo no necesita reabrir el bloque de imports en cada task — pero si un editor/linter señala un import no usado antes de la Task 6, es esperado: se resuelve en las Tasks 4-6, que son inmediatamente siguientes dentro de este mismo plan.

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso (0 errores). Si el bundler reporta "unused import" como error (no debería con Vite/esbuild, que no falla por imports no usados, solo por imports irresolubles), confirmar que las rutas de import (`./humanResourcesQualificationsService`, `../features/human-resources/certifications/mappers`, etc.) resuelven correctamente.

- [ ] **Step 3: Commit**

```bash
git add src/services/humanResourcesReportsService.js
git commit -m "feat: agrega humanResourcesReportsService con el reporte de vencimientos"
```

---

### Task 4: Agregar el reporte de Altas y bajas al servicio

**Files:**
- Modify: `src/services/humanResourcesReportsService.js`

**Interfaces:**
- Consumes: `getUsers()` → `UserRecord[]` (campos usados: `identity.id, identity.firstName, identity.lastName, access.roleName`); `getUserHistory(userId)` → `AccountHistoryEvent[]` (campos: `id, action, actorName, occurredAt`).
- Produces: `getAccountMovementsReport(filters = {})` → `Promise<{ rows: AccountMovementRow[] }>` donde `AccountMovementRow = { id, userName, movement, movementKind: 'alta'|'baja', occurredAt, roleName, performedBy }`. `filters` soporta `{ dateFrom, dateTo }` (strings `YYYY-MM-DD`, opcionales — filtran por la porción de fecha de `occurredAt`). La Task 11 (`AccountMovementsReport.jsx`) consume `rows` directamente y agrupa por fecha con `buildMovementTrend` (Task 7).

- [ ] **Step 1: Agregar la función al archivo existente**

Añadir en `src/services/humanResourcesReportsService.js`, después de `getExpirationReport` (antes de `exportReport`):

```js
const ACCOUNT_MOVEMENT_EVENT_META = {
  account_activated: { label: 'Alta / Activación', kind: 'alta' },
  account_reactivated: { label: 'Alta / Activación', kind: 'alta' },
  account_disabled: { label: 'Baja / Desactivación', kind: 'baja' },
};

function inDateRange(isoString, dateFrom, dateTo) {
  const dateKey = isoString.slice(0, 10);
  if (dateFrom && dateKey < dateFrom) return false;
  if (dateTo && dateKey > dateTo) return false;
  return true;
}

/**
 * Reporte 2 — Altas y bajas: cruza usuarios con su historial de cuenta.
 * `filters.dateFrom`/`filters.dateTo` (YYYY-MM-DD) filtran por la fecha del
 * movimiento; ambos opcionales. Orden por defecto: más reciente primero.
 */
export async function getAccountMovementsReport(filters = {}) {
  const users = await getUsers();
  const historiesByUser = await Promise.all(users.map(user => getUserHistory(user.identity.id)));

  const rows = users
    .flatMap((user, index) =>
      historiesByUser[index]
        .filter(event => ACCOUNT_MOVEMENT_EVENT_META[event.action])
        .filter(event => inDateRange(event.occurredAt, filters.dateFrom, filters.dateTo))
        .map(event => ({
          id: event.id,
          userName: `${user.identity.firstName} ${user.identity.lastName}`,
          movement: ACCOUNT_MOVEMENT_EVENT_META[event.action].label,
          movementKind: ACCOUNT_MOVEMENT_EVENT_META[event.action].kind,
          occurredAt: event.occurredAt,
          roleName: user.access.roleName,
          performedBy: event.actorName,
        }))
    )
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  return { rows };
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/services/humanResourcesReportsService.js
git commit -m "feat: agrega el reporte de altas y bajas a humanResourcesReportsService"
```

---

### Task 5: Agregar el reporte de Personal por terminal y turno al servicio

**Files:**
- Modify: `src/services/humanResourcesReportsService.js`

**Interfaces:**
- Consumes: `getShifts()` de `humanResourcesSchedulesService.js` → `ShiftAssignment[]` (campos usados: `id, agentName, date, terminal ('A'|'B'), block ('morning'|'afternoon'|'night')`).
- Produces: `getStaffDistributionReport(filters = {})` → `Promise<{ rows: StaffDistributionRow[] }>` donde `StaffDistributionRow = { id, agentName, terminal, block, date }`. `filters` soporta `{ terminal, shiftBlock }` (opcionales). La Task 12 (`StaffDistributionReport.jsx`) construye los gráficos a partir de `rows` con `buildStaffTerminalSegments`/`buildStaffShiftItems` (Task 7).

- [ ] **Step 1: Agregar la función al archivo existente**

Añadir en `src/services/humanResourcesReportsService.js`, después de `getAccountMovementsReport`:

```js
/**
 * Reporte 3 — Personal por terminal y turno: una fila por turno asignado
 * (no por agente único) — así "cuántos turnos se cubrieron en Terminal B de
 * madrugada" es una métrica bien definida, sin inventar una regla de
 * deduplicación no pedida por el brief.
 */
export async function getStaffDistributionReport(filters = {}) {
  const shifts = await getShifts();

  const rows = shifts
    .filter(shift => !filters.terminal || shift.terminal === filters.terminal)
    .filter(shift => !filters.shiftBlock || shift.block === filters.shiftBlock)
    .map(shift => ({
      id: shift.id,
      agentName: shift.agentName,
      terminal: shift.terminal,
      block: shift.block,
      date: shift.date,
    }));

  return { rows };
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/services/humanResourcesReportsService.js
git commit -m "feat: agrega el reporte de personal por terminal y turno a humanResourcesReportsService"
```

---

### Task 6: Agregar el reporte de Cobertura de habilitaciones al servicio

**Files:**
- Modify: `src/services/humanResourcesReportsService.js`

**Interfaces:**
- Consumes: `getQualifications()`, `getEquipmentCatalog()` (ya importados en Task 3); `mapQualifications(records, now)` y `deriveEquipmentCoverage(items, catalog)` (ya importados en Task 3, de `certifications/mappers.js`) — `deriveEquipmentCoverage` devuelve `{ equipmentId, equipmentName, terminals, totalAgents, activeCount, expiringSoonCount, expiredCount, coveragePercent, limitedCoverage, qualifications }[]`.
- Produces: `getQualificationCoverageReport(filters = {})` → `Promise<{ coverage: EquipmentCoverage[] }>`. `filters` soporta `{ terminal, cutoffDate }` (`cutoffDate` es un string `YYYY-MM-DD`; si se omite o es cadena vacía, se usa "hoy"). La Task 12 (`QualificationCoverageReport.jsx`) pasa `coverage` directamente a `EquipmentCoverageView`.

- [ ] **Step 1: Agregar la función al archivo existente**

Añadir en `src/services/humanResourcesReportsService.js`, después de `getStaffDistributionReport`:

```js
/**
 * Reporte 4 — Cobertura de habilitaciones: reutiliza el mismo cálculo de
 * `deriveEquipmentCoverage` que ya usa el módulo de Habilitaciones (vista
 * "Por tipo de equipo"), pero recalculado contra `filters.cutoffDate` en vez
 * de "hoy" cuando el usuario la cambia — sin duplicar el umbral de vigencia
 * (30 días) ni la fórmula de `coveragePercent`.
 */
export async function getQualificationCoverageReport(filters = {}) {
  const cutoffDate = filters.cutoffDate ? new Date(filters.cutoffDate) : new Date();
  const [qualifications, catalog] = await Promise.all([getQualifications(), getEquipmentCatalog()]);

  const items = mapQualifications(qualifications, cutoffDate);
  const coverage = deriveEquipmentCoverage(items, catalog).filter(
    entry => !filters.terminal || entry.terminals.includes(filters.terminal)
  );

  return { coverage };
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso. Todas las funciones del servicio (Tasks 3-6) ya están completas en este punto.

- [ ] **Step 3: Commit**

```bash
git add src/services/humanResourcesReportsService.js
git commit -m "feat: agrega el reporte de cobertura de habilitaciones a humanResourcesReportsService"
```

---

### Task 7: Crear `reportsMappers.js` de Gestión Humana

**Files:**
- Create: `src/features/human-resources/reports/reportsMappers.js`

**Interfaces:**
- Consumes: `TONE_HEX` de `src/components/toneColors.js`.
- Produces (usado por las Tasks 8-13):
  - `REPORT_TABS` — arreglo `{ id, label }[]` con los 4 reportes, en el orden del brief.
  - `DATE_PRESETS` — arreglo `{ id, label }[]`.
  - `resolveDateRange(preset, customFrom, customTo)` → `{ from, to }` (date keys `YYYY-MM-DD`).
  - `formatDateKey(dateKey)`, `formatPeriodLabel(from, to)`, `formatEventDateTime(isoString)`.
  - `DOCUMENT_KIND_OPTIONS`, `EXPIRATION_STATUS_OPTIONS`, `TERMINAL_OPTIONS`, `SHIFT_BLOCK_OPTIONS` — arreglos `{ value, label }[]` para los `<select>` de `ReportFilterBar` (Task 10).
  - `buildStaffTerminalSegments(rows)` → segmentos `{ key, label, color, value }[]` para `CategoryDonutChart` (Task 12).
  - `buildStaffShiftItems(rows)` → items `{ key, label, value }[]` para `HorizontalBarList` (Task 12).
  - `buildMovementTrend(rows, kind)` → puntos `{ label, value }[]` para `BarChart` (Task 11).

- [ ] **Step 1: Crear el archivo**

Crear `src/features/human-resources/reports/reportsMappers.js`:

```js
import { TONE_HEX } from '../../../components/toneColors';

export const REPORT_TABS = [
  { id: 'expirations', label: 'Vencimientos' },
  { id: 'accountMovements', label: 'Altas y bajas' },
  { id: 'staffDistribution', label: 'Personal por terminal y turno' },
  { id: 'qualificationCoverage', label: 'Cobertura de habilitaciones' },
];

export const DATE_PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Rango personalizado' },
];

// PUJ / Atlantic Standard Time — mismo criterio que reportsMappers.js de
// Admin/OCC y que el resto de mocks del proyecto.
const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function stationDateKey(date) {
  return new Date(date.getTime() - STATION_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return utcDate.toISOString().slice(0, 10);
}

function startOfWeekDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const isoWeekday = utcDate.getUTCDay() === 0 ? 7 : utcDate.getUTCDay();
  return addDaysToDateKey(dateKey, -(isoWeekday - 1));
}

function startOfMonthDateKey(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

export function resolveDateRange(preset, customFrom, customTo) {
  const today = stationDateKey(new Date());
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: startOfWeekDateKey(today), to: today };
    case 'month':
      return { from: startOfMonthDateKey(today), to: today };
    case 'custom':
    default:
      return { from: customFrom || today, to: customTo || today };
  }
}

const SHORT_MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export function formatDateKey(dateKey) {
  if (!dateKey) return '';
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${SHORT_MONTHS[month - 1]} ${year}`;
}

export function formatDateKeyShort(dateKey) {
  if (!dateKey) return '';
  const [, month, day] = dateKey.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${SHORT_MONTHS[month - 1]}`;
}

export function formatPeriodLabel(from, to) {
  if (!from || !to) return '';
  return from === to ? formatDateKey(from) : `${formatDateKey(from)} — ${formatDateKey(to)}`;
}

export function formatEventDateTime(isoString) {
  return new Date(isoString).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const DOCUMENT_KIND_OPTIONS = [
  { value: 'certification', label: 'Habilitación' },
  { value: 'permit', label: 'Carnet / Licencia' },
];

export const EXPIRATION_STATUS_OPTIONS = [
  { value: 'current', label: 'Vigente' },
  { value: 'expiringSoon', label: 'Próxima a vencer' },
  { value: 'expired', label: 'Vencida' },
];

export const TERMINAL_OPTIONS = [
  { value: 'A', label: 'Terminal A' },
  { value: 'B', label: 'Terminal B' },
];

export const SHIFT_BLOCK_OPTIONS = [
  { value: 'morning', label: 'Mañana' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'night', label: 'Madrugada' },
];

// Incluye FBO aunque los turnos mock (Horarios) todavía no lo modelan — el
// brief pide explícitamente "Terminal A, Terminal B y FBO" como categorías
// del gráfico; queda en 0 hasta que exista un turno con ese terminal, igual
// que el segmento "unassigned" de StaffDistributionChart en el Dashboard.
const STAFF_TERMINAL_SEGMENTS_META = [
  { key: 'A', label: 'Terminal A', color: TONE_HEX.info },
  { key: 'B', label: 'Terminal B', color: TONE_HEX.active },
  { key: 'FBO', label: 'FBO / Aviación local', color: TONE_HEX.success },
];

export function buildStaffTerminalSegments(rows) {
  return STAFF_TERMINAL_SEGMENTS_META.map(meta => ({
    ...meta,
    value: rows.filter(row => row.terminal === meta.key).length,
  }));
}

export function buildStaffShiftItems(rows) {
  return SHIFT_BLOCK_OPTIONS.map(option => ({
    key: option.value,
    label: option.label,
    value: rows.filter(row => row.block === option.value).length,
  }));
}

export function buildMovementTrend(rows, kind) {
  const counts = new Map();
  for (const row of rows) {
    if (row.movementKind !== kind) continue;
    const dateKey = row.occurredAt.slice(0, 10);
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ label: formatDateKeyShort(date), value: count }));
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/features/human-resources/reports/reportsMappers.js
git commit -m "feat: agrega reportsMappers de Gestion Humana"
```

---

### Task 8: Crear `useReportFilters.js` de Gestión Humana

**Files:**
- Create: `src/features/human-resources/reports/useReportFilters.js`

**Interfaces:**
- Consumes: `REPORT_TABS`, `resolveDateRange` de `./reportsMappers` (Task 7).
- Produces: `useReportFilters()` → `{ activeReport, setActiveReport, datePreset, setDatePreset, customRange, setCustomDate, facets, setFacet, resetFilters, dateRange, resolvedFilters, hasActiveFilters }`. `facets` tiene las claves `{ documentKind, status, terminal, shiftBlock, cutoffDate }` (todas string, `''` = sin filtrar). `resolvedFilters` es el objeto que la Task 9 (`useReportsData`) pasa a cada función del servicio: `{ dateFrom, dateTo, documentKind, status, terminal, shiftBlock, cutoffDate }`.

- [ ] **Step 1: Crear el archivo**

Crear `src/features/human-resources/reports/useReportFilters.js`:

```js
import { useMemo, useState } from 'react';
import { REPORT_TABS, resolveDateRange } from './reportsMappers';

const INITIAL_FACETS = { documentKind: '', status: '', terminal: '', shiftBlock: '', cutoffDate: '' };

export function useReportFilters() {
  const [activeReport, setActiveReport] = useState(REPORT_TABS[0].id);
  const [datePreset, setDatePreset] = useState('today');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [facets, setFacets] = useState(INITIAL_FACETS);

  function setFacet(key, value) {
    setFacets(current => ({ ...current, [key]: value }));
  }

  function setCustomDate(key, value) {
    setDatePreset('custom');
    setCustomRange(current => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setDatePreset('today');
    setCustomRange({ from: '', to: '' });
    setFacets(INITIAL_FACETS);
  }

  const dateRange = useMemo(
    () => resolveDateRange(datePreset, customRange.from, customRange.to),
    [datePreset, customRange]
  );

  const resolvedFilters = useMemo(
    () => ({
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      documentKind: facets.documentKind,
      status: facets.status,
      terminal: facets.terminal,
      shiftBlock: facets.shiftBlock,
      cutoffDate: facets.cutoffDate,
    }),
    [dateRange, facets]
  );

  const hasActiveFilters = useMemo(
    () => datePreset !== 'today' || Object.values(facets).some(value => value !== ''),
    [datePreset, facets]
  );

  return {
    activeReport,
    setActiveReport,
    datePreset,
    setDatePreset,
    customRange,
    setCustomDate,
    facets,
    setFacet,
    resetFilters,
    dateRange,
    resolvedFilters,
    hasActiveFilters,
  };
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/features/human-resources/reports/useReportFilters.js
git commit -m "feat: agrega useReportFilters de Gestion Humana"
```

---

### Task 9: Crear `useReportsData.js` de Gestión Humana

**Files:**
- Create: `src/features/human-resources/reports/useReportsData.js`

**Interfaces:**
- Consumes: `getExpirationReport`, `getAccountMovementsReport`, `getStaffDistributionReport`, `getQualificationCoverageReport` de `../../../services/humanResourcesReportsService` (Tasks 3-6).
- Produces: `useReportsData(activeReport, filters, refreshToken)` → `{ status: 'loading'|'success'|'error', data, error, refresh }`. `data` es la respuesta cruda de la función del servicio correspondiente (`{ rows }` o `{ coverage }`). Consumido por la Task 14 (`ReportsPage.jsx`).

- [ ] **Step 1: Crear el archivo**

Crear `src/features/human-resources/reports/useReportsData.js`:

```js
import { useCallback, useEffect, useState } from 'react';
import {
  getExpirationReport,
  getAccountMovementsReport,
  getStaffDistributionReport,
  getQualificationCoverageReport,
} from '../../../services/humanResourcesReportsService';

// Envueltos en thunks (no como referencias directas) por la misma razón que
// FETCHERS_BY_REPORT en useReportsData.js de Admin/OCC: cada llamada relee
// el binding vivo del módulo, necesario para poder reemplazar la función
// con vi.spyOn si en el futuro se agregan tests a este hook.
const FETCHERS_BY_REPORT = {
  expirations: (...args) => getExpirationReport(...args),
  accountMovements: (...args) => getAccountMovementsReport(...args),
  staffDistribution: (...args) => getStaffDistributionReport(...args),
  qualificationCoverage: (...args) => getQualificationCoverageReport(...args),
};

export function useReportsData(activeReport = 'expirations', filters = {}, refreshToken = 0) {
  const filtersKey = JSON.stringify(filters);
  const queryKey = `${activeReport}|${filtersKey}|${refreshToken}`;

  const [state, setState] = useState({ status: 'loading', data: null, error: null, key: null });

  // Reset síncrono durante el render (no en un efecto) cuando cambia la
  // query — mismo patrón que useReportsData.js de Admin/OCC, necesario para
  // no mezclar los datos del reporte anterior con las columnas del nuevo
  // tab mientras el fetch está en curso.
  if (state.key !== queryKey) {
    setState({ status: 'loading', data: null, error: null, key: queryKey });
  }

  const load = useCallback(() => {
    const fetchReport = FETCHERS_BY_REPORT[activeReport] ?? getExpirationReport;
    return fetchReport(filters)
      .then(data => setState(current => (current.key === queryKey ? { ...current, status: 'success', data, error: null } : current)))
      .catch(error => setState(current => (current.key === queryKey ? { ...current, status: 'error', data: null, error } : current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport, filtersKey, queryKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { status: state.status, data: state.data, error: state.error, refresh: load };
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/features/human-resources/reports/useReportsData.js
git commit -m "feat: agrega useReportsData de Gestion Humana"
```

---

### Task 10: Crear `ReportFilterBar.jsx` de Gestión Humana

**Files:**
- Create: `src/features/human-resources/reports/components/ReportFilterBar.jsx`

**Interfaces:**
- Consumes: `DateRangePicker` de `../../../reports/components/DateRangePicker` (Admin/OCC, reutilizado tal cual); `DATE_PRESETS, DOCUMENT_KIND_OPTIONS, EXPIRATION_STATUS_OPTIONS, TERMINAL_OPTIONS, SHIFT_BLOCK_OPTIONS` de `../reportsMappers` (Task 7).
- Produces: `ReportFilterBar({ activeReport, datePreset, customRange, onSelectPreset, onCustomDateChange, facets, onFacetChange, hasActiveFilters, onResetFilters })` — consumido por la Task 14 (`ReportsPage.jsx`), recibe las props devueltas por `useReportFilters` (Task 8) casi 1:1.

- [ ] **Step 1: Crear el archivo**

Crear `src/features/human-resources/reports/components/ReportFilterBar.jsx`:

```jsx
import DateRangePicker from '../../../reports/components/DateRangePicker';
import {
  DATE_PRESETS,
  DOCUMENT_KIND_OPTIONS,
  EXPIRATION_STATUS_OPTIONS,
  TERMINAL_OPTIONS,
  SHIFT_BLOCK_OPTIONS,
} from '../reportsMappers';

// Réplica local del FilterSelect inline de ReportFilterBar (Admin/OCC) —
// mismo look, facets propios de Gestión Humana. Se duplica a propósito
// (misma convención que FormField.jsx repetido en cada módulo de GH) en vez
// de generalizar el ReportFilterBar de Admin/OCC, que está acoplado a sus
// propios facets (aerolínea/agente/posición).
function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
      >
        <option value="">Todos</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ReportFilterBar({
  activeReport,
  datePreset,
  customRange,
  onSelectPreset,
  onCustomDateChange,
  facets,
  onFacetChange,
  hasActiveFilters,
  onResetFilters,
}) {
  const showDateRange = activeReport === 'accountMovements';
  const showDocumentKind = activeReport === 'expirations';
  const showStatus = activeReport === 'expirations';
  const showTerminal = activeReport === 'expirations' || activeReport === 'staffDistribution' || activeReport === 'qualificationCoverage';
  const showShiftBlock = activeReport === 'staffDistribution';
  const showCutoffDate = activeReport === 'qualificationCoverage';

  const activeChips = [];
  if (showDateRange && datePreset !== 'today') {
    const preset = DATE_PRESETS.find(item => item.id === datePreset);
    activeChips.push(preset?.label ?? 'Rango personalizado');
  }
  if (showDocumentKind && facets.documentKind) {
    activeChips.push(`Tipo: ${DOCUMENT_KIND_OPTIONS.find(option => option.value === facets.documentKind)?.label}`);
  }
  if (showStatus && facets.status) {
    activeChips.push(`Severidad: ${EXPIRATION_STATUS_OPTIONS.find(option => option.value === facets.status)?.label}`);
  }
  if (showTerminal && facets.terminal) {
    activeChips.push(`Terminal: ${TERMINAL_OPTIONS.find(option => option.value === facets.terminal)?.label}`);
  }
  if (showShiftBlock && facets.shiftBlock) {
    activeChips.push(`Turno: ${SHIFT_BLOCK_OPTIONS.find(option => option.value === facets.shiftBlock)?.label}`);
  }
  if (showCutoffDate && facets.cutoffDate) {
    activeChips.push(`Corte: ${facets.cutoffDate}`);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {showDateRange && (
          <DateRangePicker
            datePreset={datePreset}
            onSelectPreset={onSelectPreset}
            customRange={customRange}
            onCustomDateChange={onCustomDateChange}
          />
        )}
        {showCutoffDate && (
          <label className="flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Fecha de corte
            <input
              type="date"
              value={facets.cutoffDate}
              onChange={event => onFacetChange('cutoffDate', event.target.value)}
              className="rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
            />
          </label>
        )}
        <button
          type="button"
          onClick={onResetFilters}
          disabled={!hasActiveFilters}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
            hasActiveFilters
              ? 'border border-black/10 text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5'
              : 'cursor-not-allowed border border-black/10 text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60'
          }`}
        >
          Limpiar filtros
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {showDocumentKind && (
          <FilterSelect label="Tipo" value={facets.documentKind} onChange={value => onFacetChange('documentKind', value)} options={DOCUMENT_KIND_OPTIONS} />
        )}
        {showStatus && (
          <FilterSelect label="Severidad" value={facets.status} onChange={value => onFacetChange('status', value)} options={EXPIRATION_STATUS_OPTIONS} />
        )}
        {showTerminal && (
          <FilterSelect label="Terminal" value={facets.terminal} onChange={value => onFacetChange('terminal', value)} options={TERMINAL_OPTIONS} />
        )}
        {showShiftBlock && (
          <FilterSelect label="Turno" value={facets.shiftBlock} onChange={value => onFacetChange('shiftBlock', value)} options={SHIFT_BLOCK_OPTIONS} />
        )}
      </div>

      {activeChips.length > 0 && (
        <div data-testid="active-filter-chips" aria-label="Filtros activos" className="flex flex-wrap gap-1.5">
          {activeChips.map(chip => (
            <span key={chip} className="rounded-full bg-accent-600/10 px-2.5 py-1 text-xs font-medium text-accent-600">
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/features/human-resources/reports/components/ReportFilterBar.jsx
git commit -m "feat: agrega ReportFilterBar de Gestion Humana"
```

---

### Task 11: Crear `ExpirationReportTable.jsx` y `AccountMovementsReport.jsx`

**Files:**
- Create: `src/features/human-resources/reports/components/ExpirationReportTable.jsx`
- Create: `src/features/human-resources/reports/components/AccountMovementsReport.jsx`

**Interfaces:**
- Consumes: `ReportTable` de `../../../reports/components/ReportTable` (Admin/OCC, tal cual); `BarChart` de `../../../reports/components/BarChart` (Admin/OCC, tal cual); `Badge` de `../../../../components/Badge`; `formatDateKey`, `formatEventDateTime`, `buildMovementTrend` de `../reportsMappers` (Task 7).
- Produces: `ExpirationReportTable({ rows })` y `AccountMovementsReport({ rows })` — ambos consumidos por la Task 14 (`ReportsPage.jsx`), reciben directamente `data.rows` de `useReportsData` (Task 9).

- [ ] **Step 1: Crear `ExpirationReportTable.jsx`**

Crear `src/features/human-resources/reports/components/ExpirationReportTable.jsx`:

```jsx
import { useNavigate } from 'react-router-dom';
import ReportTable from '../../../reports/components/ReportTable';
import Badge from '../../../../components/Badge';
import { formatDateKey } from '../reportsMappers';

function buildColumns(navigate) {
  return [
    { key: 'agentName', label: 'Agente', render: row => row.agentName, sortValue: row => row.agentName },
    { key: 'documentLabel', label: 'Documento / Habilitación', render: row => row.documentLabel, sortValue: row => row.documentLabel },
    { key: 'terminals', label: 'Terminal', render: row => row.terminals.join(' / '), sortValue: row => row.terminals.join(' / ') },
    { key: 'dueDate', label: 'Vencimiento', render: row => formatDateKey(row.dueDate.slice(0, 10)), sortValue: row => row.dueDate },
    { key: 'daysRemaining', label: 'Días restantes', render: row => row.dueLabel, sortValue: row => row.daysRemaining },
    { key: 'status', label: 'Estado', render: row => <Badge tone={row.statusTone} label={row.statusLabel} /> },
    {
      key: 'actions',
      label: '',
      render: row => (
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            navigate(row.modulePath);
          }}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Ver
        </button>
      ),
    },
  ];
}

// Tabla del Reporte 1 (Vencimientos). El click en "Ver" navega al módulo de
// origen (Habilitaciones o Carnets/Permisos) — el brief pide que el reporte
// enlace al detalle correspondiente, no que reconstruya un panel de detalle
// propio.
export default function ExpirationReportTable({ rows }) {
  const navigate = useNavigate();

  return (
    <ReportTable
      columns={buildColumns(navigate)}
      rows={rows}
      getSearchableText={row => `${row.agentName} ${row.documentLabel}`}
      searchPlaceholder="Buscar agente o documento…"
      isCriticalRow={row => row.status === 'expired'}
      emptyMessage="No hay vencimientos para los filtros seleccionados."
    />
  );
}
```

- [ ] **Step 2: Crear `AccountMovementsReport.jsx`**

Crear `src/features/human-resources/reports/components/AccountMovementsReport.jsx`:

```jsx
import ReportTable from '../../../reports/components/ReportTable';
import BarChart from '../../../reports/components/BarChart';
import { buildMovementTrend, formatEventDateTime } from '../reportsMappers';

const COLUMNS = [
  { key: 'userName', label: 'Usuario', render: row => row.userName, sortValue: row => row.userName },
  { key: 'movement', label: 'Movimiento', render: row => row.movement, sortValue: row => row.movement },
  { key: 'occurredAt', label: 'Fecha', render: row => formatEventDateTime(row.occurredAt), sortValue: row => row.occurredAt },
  { key: 'roleName', label: 'Rol', render: row => row.roleName, sortValue: row => row.roleName },
  { key: 'performedBy', label: 'Realizado por', render: row => row.performedBy, sortValue: row => row.performedBy },
];

// Reporte 2 (Altas y bajas). Decisión de diseño: dos BarChart (uno por
// movimiento) en vez de un gráfico de dos series nuevo — no existe hoy un
// componente de líneas/dos-series en el proyecto y BarChart ya es 100%
// reutilizable tal cual.
export default function AccountMovementsReport({ rows }) {
  const altasByPeriod = buildMovementTrend(rows, 'alta');
  const bajasByPeriod = buildMovementTrend(rows, 'baja');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BarChart title="Altas por período" data={altasByPeriod} orientation="vertical" />
        <BarChart title="Bajas por período" data={bajasByPeriod} orientation="vertical" />
      </div>
      <ReportTable
        columns={COLUMNS}
        rows={rows}
        getSearchableText={row => `${row.userName} ${row.roleName}`}
        searchPlaceholder="Buscar usuario o rol…"
        emptyMessage="No hay movimientos de cuentas para el rango seleccionado."
      />
    </div>
  );
}
```

- [ ] **Step 3: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/features/human-resources/reports/components/ExpirationReportTable.jsx src/features/human-resources/reports/components/AccountMovementsReport.jsx
git commit -m "feat: agrega las vistas de Vencimientos y Altas/bajas de Reportes GH"
```

---

### Task 12: Crear `StaffDistributionReport.jsx` y `QualificationCoverageReport.jsx`

**Files:**
- Create: `src/features/human-resources/reports/components/StaffDistributionReport.jsx`
- Create: `src/features/human-resources/reports/components/QualificationCoverageReport.jsx`

**Interfaces:**
- Consumes: `CategoryDonutChart`, `HorizontalBarList` de `../../../../components/*`; `ReportTable` de `../../../reports/components/ReportTable`; `buildStaffTerminalSegments`, `buildStaffShiftItems`, `TERMINAL_OPTIONS`, `SHIFT_BLOCK_OPTIONS` de `../reportsMappers` (Task 7); `EquipmentCoverageView` de `../../certifications/components/EquipmentCoverageView` (Habilitaciones, tal cual).
- Produces: `StaffDistributionReport({ rows })` y `QualificationCoverageReport({ coverage, loading })` — consumidos por la Task 14 (`ReportsPage.jsx`).

- [ ] **Step 1: Crear `StaffDistributionReport.jsx`**

Crear `src/features/human-resources/reports/components/StaffDistributionReport.jsx`:

```jsx
import CategoryDonutChart from '../../../../components/CategoryDonutChart';
import HorizontalBarList from '../../../../components/HorizontalBarList';
import ReportTable from '../../../reports/components/ReportTable';
import { buildStaffTerminalSegments, buildStaffShiftItems, TERMINAL_OPTIONS, SHIFT_BLOCK_OPTIONS } from '../reportsMappers';

const COLUMNS = [
  { key: 'agentName', label: 'Agente', render: row => row.agentName, sortValue: row => row.agentName },
  {
    key: 'terminal',
    label: 'Terminal',
    render: row => TERMINAL_OPTIONS.find(option => option.value === row.terminal)?.label ?? row.terminal,
    sortValue: row => row.terminal,
  },
  {
    key: 'block',
    label: 'Turno',
    render: row => SHIFT_BLOCK_OPTIONS.find(option => option.value === row.block)?.label ?? row.block,
    sortValue: row => row.block,
  },
];

// Reporte 3 (Personal por terminal y turno): mismo patrón visual que
// StaffDistributionChart del Dashboard de GH (dona por terminal + barras
// por turno), alimentado por las filas ya filtradas del servicio.
export default function StaffDistributionReport({ rows }) {
  const terminalSegments = buildStaffTerminalSegments(rows);
  const shiftItems = buildStaffShiftItems(rows);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
          <CategoryDonutChart title="Por terminal" segments={terminalSegments} />
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Por turno
          </h3>
          <HorizontalBarList items={shiftItems} />
        </div>
      </div>
      <ReportTable
        columns={COLUMNS}
        rows={rows}
        getSearchableText={row => row.agentName}
        searchPlaceholder="Buscar agente…"
        emptyMessage="No hay turnos asignados para los filtros seleccionados."
      />
    </div>
  );
}
```

- [ ] **Step 2: Crear `QualificationCoverageReport.jsx`**

Crear `src/features/human-resources/reports/components/QualificationCoverageReport.jsx`:

```jsx
import { useNavigate } from 'react-router-dom';
import EquipmentCoverageView from '../../certifications/components/EquipmentCoverageView';

// Reporte 4 (Cobertura de habilitaciones): reutiliza EquipmentCoverageView
// tal cual (ya trae ProgressRing, badge de "cobertura limitada" y sus
// propios estados de loading/empty) — el click en una tarjeta navega al
// módulo de Habilitaciones en vez de abrir un modal de detalle propio.
export default function QualificationCoverageReport({ coverage, loading }) {
  const navigate = useNavigate();

  return (
    <EquipmentCoverageView
      coverage={coverage}
      loading={loading}
      onSelectEquipment={() => navigate('/human-resources/certifications')}
    />
  );
}
```

- [ ] **Step 3: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/features/human-resources/reports/components/StaffDistributionReport.jsx src/features/human-resources/reports/components/QualificationCoverageReport.jsx
git commit -m "feat: agrega las vistas de Personal por terminal/turno y Cobertura de Reportes GH"
```

---

### Task 13: Crear `ReportsHeader.jsx` de Gestión Humana

**Files:**
- Create: `src/features/human-resources/reports/components/ReportsHeader.jsx`

**Interfaces:**
- Consumes: `ExportButton` de `../../../reports/components/ExportButton` (Admin/OCC, generalizado en Task 2); `exportReport` de `../../../../services/humanResourcesReportsService` (Task 3).
- Produces: `ReportsHeader({ periodLabel, activeReport, onExported, onExportError })` — consumido por la Task 14 (`ReportsPage.jsx`).

- [ ] **Step 1: Crear el archivo**

Crear `src/features/human-resources/reports/components/ReportsHeader.jsx`:

```jsx
import ExportButton from '../../../reports/components/ExportButton';
import { exportReport } from '../../../../services/humanResourcesReportsService';

export default function ReportsHeader({ periodLabel, activeReport, onExported, onExportError }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Gestión Humana / Reportes</p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Reportes</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Vencimientos, altas y bajas, personal por terminal y turno, y cobertura de habilitaciones.
          </p>
          {periodLabel && (
            <p className="mt-1 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{periodLabel}</p>
          )}
        </div>
        <ExportButton reportId={activeReport} exportFn={exportReport} onExported={onExported} onExportError={onExportError} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/features/human-resources/reports/components/ReportsHeader.jsx
git commit -m "feat: agrega ReportsHeader de Gestion Humana"
```

---

### Task 14: Crear `ReportsPage.jsx` y `ReportsRoute.jsx`

**Files:**
- Create: `src/features/human-resources/reports/ReportsPage.jsx`
- Create: `src/features/human-resources/reports/ReportsRoute.jsx`

**Interfaces:**
- Consumes: `ReportTabs`, `ReportSkeleton`, `ReportEmptyState` de `../../reports/components/*` (Admin/OCC, tal cual); `useToast` de `../../../hooks/useToast`; `Toast` de `../../../components/Toast`; `useReportFilters` (Task 8), `useReportsData` (Task 9), `REPORT_TABS`/`formatPeriodLabel` de `./reportsMappers` (Task 7); `ReportsHeader` (Task 13), `ReportFilterBar` (Task 10), `ExpirationReportTable`/`AccountMovementsReport` (Task 11), `StaffDistributionReport`/`QualificationCoverageReport` (Task 12).
- Produces: `ReportsPage()` (componente default export) y `ReportsRoute()` — este último es lo que la Task 15 registra en `router.jsx`.

- [ ] **Step 1: Crear `ReportsPage.jsx`**

Crear `src/features/human-resources/reports/ReportsPage.jsx`:

```jsx
import { useState } from 'react';
import ReportTabs from '../../reports/components/ReportTabs';
import ReportSkeleton from '../../reports/components/ReportSkeleton';
import ReportEmptyState from '../../reports/components/ReportEmptyState';
import ReportsHeader from './components/ReportsHeader';
import ReportFilterBar from './components/ReportFilterBar';
import ExpirationReportTable from './components/ExpirationReportTable';
import AccountMovementsReport from './components/AccountMovementsReport';
import StaffDistributionReport from './components/StaffDistributionReport';
import QualificationCoverageReport from './components/QualificationCoverageReport';
import { useReportFilters } from './useReportFilters';
import { useReportsData } from './useReportsData';
import { REPORT_TABS, formatPeriodLabel } from './reportsMappers';
import { useToast } from '../../../hooks/useToast';
import Toast from '../../../components/Toast';

export default function ReportsPage() {
  const [refreshToken, setRefreshToken] = useState(0);
  const filters = useReportFilters();
  const { toasts, showToast, dismissToast } = useToast();
  const { status, data, error } = useReportsData(filters.activeReport, filters.resolvedFilters, refreshToken);

  const isLoading = status === 'loading';
  const isError = status === 'error';

  function handleExported(result) {
    showToast(`Reporte generado correctamente (${result.format.toUpperCase()}).`, 'success');
  }

  function handleExportError() {
    showToast('No se pudo generar el reporte. Intente nuevamente.', 'danger');
  }

  function handleRetry() {
    setRefreshToken(token => token + 1);
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No se pudo cargar el reporte solicitado.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const coverage = data?.coverage ?? [];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <ReportsHeader
        periodLabel={filters.activeReport === 'accountMovements' ? formatPeriodLabel(filters.dateRange.from, filters.dateRange.to) : ''}
        activeReport={filters.activeReport}
        onExported={handleExported}
        onExportError={handleExportError}
      />

      <ReportTabs tabs={REPORT_TABS} active={filters.activeReport} onChange={filters.setActiveReport} />

      <ReportFilterBar
        activeReport={filters.activeReport}
        datePreset={filters.datePreset}
        customRange={filters.customRange}
        onSelectPreset={filters.setDatePreset}
        onCustomDateChange={filters.setCustomDate}
        facets={filters.facets}
        onFacetChange={filters.setFacet}
        hasActiveFilters={filters.hasActiveFilters}
        onResetFilters={filters.resetFilters}
      />

      {filters.activeReport === 'qualificationCoverage' ? (
        <QualificationCoverageReport coverage={coverage} loading={isLoading} />
      ) : isLoading ? (
        <ReportSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <ReportEmptyState />
      ) : filters.activeReport === 'expirations' ? (
        <ExpirationReportTable rows={rows} />
      ) : filters.activeReport === 'accountMovements' ? (
        <AccountMovementsReport rows={rows} />
      ) : (
        <StaffDistributionReport rows={rows} />
      )}

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
```

- [ ] **Step 2: Crear `ReportsRoute.jsx`**

Crear `src/features/human-resources/reports/ReportsRoute.jsx`:

```jsx
import ReportsPage from './ReportsPage';

// A diferencia de Admin/OCC, Gestión Humana no tiene hoy un context de
// preview/forceState en el router — ReportsRoute solo renderiza la página.
export default function ReportsRoute() {
  return <ReportsPage />;
}
```

- [ ] **Step 3: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/features/human-resources/reports/ReportsPage.jsx src/features/human-resources/reports/ReportsRoute.jsx
git commit -m "feat: agrega ReportsPage y ReportsRoute de Gestion Humana"
```

---

### Task 15: Registrar la ruta en `router.jsx`

**Files:**
- Modify: `src/app/router.jsx`

**Interfaces:**
- Consumes: `ReportsRoute` de `../features/human-resources/reports/ReportsRoute` (Task 14); `HUMAN_RESOURCES_MODULE_IDS.REPORTS` (ya existe en `navigation.js`).
- Produces: la ruta `/human-resources/reports` deja de renderizar `ModulePlaceholder` y renderiza `ReportsRoute`.

- [ ] **Step 1: Agregar el import**

En `src/app/router.jsx`, después de la línea `import SchedulesPage from '../features/human-resources/schedules/SchedulesPage';` (línea 10), agregar:

```js
import HumanResourcesReportsRoute from '../features/human-resources/reports/ReportsRoute';
```

- [ ] **Step 2: Agregar la rama en `humanResourcesChildren`**

En el ternario de `humanResourcesChildren` (dentro de `src/app/router.jsx`), cambiar:

```js
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.SCHEDULES ? (
      <SchedulesPage />
    ) : (
      <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />
    ),
```

por:

```js
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.SCHEDULES ? (
      <SchedulesPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.REPORTS ? (
      <HumanResourcesReportsRoute />
    ) : (
      <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />
    ),
```

- [ ] **Step 3: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/app/router.jsx
git commit -m "feat: enruta /human-resources/reports al modulo real de Reportes"
```

---

### Task 16: Verificación final

**Files:** ninguno nuevo — solo verificación.

**Interfaces:** N/A.

- [ ] **Step 1: Ejecutar el build completo**

Run: `npm run build`
Expected: 0 errores.

- [ ] **Step 2: Ejecutar toda la suite de tests**

Run: `npm run test`
Expected: todos los tests existentes de Admin/OCC siguen en verde, incluidos los de `ReportTabs.test.jsx`/`ExportButton.test.jsx` modificados en las Tasks 1-2.

- [ ] **Step 3: Levantar el servidor de desarrollo y verificar manualmente en el navegador**

Run: `npm run dev`

En el navegador, con la app abierta:
1. Navegar a `/human-resources/reports` — debe cargar el header, las 4 tabs y el filtro bar (ya no `ModulePlaceholder`).
2. Tab **Vencimientos**: tabla con datos, filtros de Tipo/Severidad/Terminal funcionando, orden por urgencia, filas vencidas resaltadas, botón "Ver" navega a `/human-resources/certifications` o `/human-resources/permits` según el documento.
3. Tab **Altas y bajas**: cambiar el rango de fechas (`DateRangePicker`) y confirmar que la tabla y los dos `BarChart` (Altas/Bajas) se actualizan.
4. Tab **Personal por terminal y turno**: dona por terminal, barras por turno y tabla de detalle responden a los filtros de Terminal/Turno.
5. Tab **Cobertura de habilitaciones**: tarjetas de `EquipmentCoverageView` con `ProgressRing`, cambiar Terminal y Fecha de corte y confirmar que el porcentaje de cobertura se recalcula.
6. Exportar (PDF y Excel) desde cualquier tab: botón pasa por Generando… → Completado, aparece el toast de éxito.
7. Alternar tema claro/oscuro (`SunIcon`/`MoonIcon` del shell) y confirmar que todo el módulo se ve correctamente en ambos modos.
8. Navegar de vuelta a `/admin-occ/reports` y confirmar que el módulo de Reportes de Admin/OCC sigue funcionando exactamente igual que antes (tabs, filtros, exportación, los 4 reportes).
9. Navegar por el resto de Gestión Humana (`/human-resources/dashboard`, `/users`, `/certifications`, `/permits`, `/schedules`) y confirmar que nada se rompió.

Expected: los 9 puntos funcionan sin errores en consola del navegador.

- [ ] **Step 4: Reportar el resultado**

No requiere commit (task de verificación pura). Si algún punto del Step 3 falla, volver a la task correspondiente, corregir, y repetir este Task 16 completo antes de dar el módulo por terminado.
