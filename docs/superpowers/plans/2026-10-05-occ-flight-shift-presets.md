# OCC Flight Shift Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OCC can copy any of Randy's six complete shift intervals into the existing per-flight shift form, edit the copied times, and submit the resulting interval through the existing authorized API.

**Architecture:** A small immutable client-side preset catalog supplies suggested local clock values; it is not a second schedule database. `OccShiftPanel` copies a selection into its existing editable time fields and still calls `programPlanningShift`. The server remains authoritative for station-local coverage, conflicts, authorization, and overnight dates.

**Tech Stack:** React 18, Vitest 4, Testing Library, Vite 6, existing `@elevant/api-client` and .NET API.

**Spec:** `docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md`, specifically “Gestión Humana, gobernanza y turnos”. This plan implements only the per-flight preset choice. Attendance drafts, drawn signatures, documents, GH reporting, and final cross-client acceptance require their own implementation plans and are not claimed here.

## Global Constraints

- “Todo usa la API versionada y una base lógica por entorno.”
- “La API impone rol, estación, terminal y organización; los clientes no autorizan por sí solos.”
- The six options are exactly `07:00–16:00`, `08:00–17:00`, `11:00–20:00`, `12:00–21:00`, `15:00–00:00`, and `23:00–08:00`.
- “Elegir una opción rellena inicio y fin editables; solo la asignación confirmada se persiste.”
- “Los cruces de medianoche conservan fecha y zona de la estación.”
- No new backend endpoint, EF migration, global template table, break policy, or automatic eligibility override is part of this slice.
- Preserve unrelated changes in `Development`; implement in the isolated feature worktree and do not touch the VPS.

## Review Focus

1. A `23:00–08:00` choice must send those clock values unchanged and visibly identify the end as next day; Task 2 pins this with a component test.
2. Editing a copied time must change the selection to “Personalizado” without reverting the typed value; Task 2 pins this with a component test.
3. Switching the drawer to a different turnaround must clear the old preset and restore that flight's station-local planned clocks; Task 2 pins this with a component test.
4. A candidate whose eligibility has another failure must remain absent even when presets are shown; Task 2 reruns the existing eligibility test.
5. A server `409` must keep the form visible and must not call `onProgrammed`; Task 2 reruns the existing conflict test.

---

### Task 1: Immutable per-flight preset catalog

**Files:**
- Create: `frontend/private-web/src/features/planning/components/occShiftPresets.js`
- Create: `frontend/private-web/src/features/planning/components/occShiftPresets.test.js`

**Interfaces:**
- Consumes: no prior task interface.
- Produces: `OCC_SHIFT_PRESETS: readonly { id: string, label: string, startsAtLocal: string, endsAtLocal: string }[]` and `getOccShiftPreset(id: string): preset | null` for Task 2.

- [ ] **Step 1: Write the failing catalog test**

```js
import { describe, expect, it } from 'vitest';
import { OCC_SHIFT_PRESETS, getOccShiftPreset } from './occShiftPresets';

describe('OCC per-flight shift presets', () => {
  it('contains exactly the six reviewed complete intervals', () => {
    expect(OCC_SHIFT_PRESETS.map(({ startsAtLocal, endsAtLocal }) =>
      `${startsAtLocal}–${endsAtLocal}`)).toEqual([
      '07:00–16:00', '08:00–17:00', '11:00–20:00',
      '12:00–21:00', '15:00–00:00', '23:00–08:00',
    ]);
    expect(OCC_SHIFT_PRESETS.every(item => Object.isFrozen(item))).toBe(true);
    expect(Object.isFrozen(OCC_SHIFT_PRESETS)).toBe(true);
  });

  it('resolves a reviewed choice and rejects an unknown one', () => {
    expect(getOccShiftPreset('night-2300')).toMatchObject({
      startsAtLocal: '23:00', endsAtLocal: '08:00',
    });
    expect(getOccShiftPreset('unknown')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run from `frontend/private-web`: `npm test -- src/features/planning/components/occShiftPresets.test.js`

Expected: FAIL because `occShiftPresets.js` does not exist.

- [ ] **Step 3: Create only the reviewed client-side catalog**

```js
export const OCC_SHIFT_PRESETS = Object.freeze([
  { id: 'morning-0700', label: '07:00–16:00', startsAtLocal: '07:00', endsAtLocal: '16:00' },
  { id: 'morning-0800', label: '08:00–17:00', startsAtLocal: '08:00', endsAtLocal: '17:00' },
  { id: 'day-1100', label: '11:00–20:00', startsAtLocal: '11:00', endsAtLocal: '20:00' },
  { id: 'day-1200', label: '12:00–21:00', startsAtLocal: '12:00', endsAtLocal: '21:00' },
  { id: 'evening-1500', label: '15:00–00:00', startsAtLocal: '15:00', endsAtLocal: '00:00' },
  { id: 'night-2300', label: '23:00–08:00', startsAtLocal: '23:00', endsAtLocal: '08:00' },
].map(item => Object.freeze(item)));

export function getOccShiftPreset(id) {
  return OCC_SHIFT_PRESETS.find(item => item.id === id) ?? null;
}
```

- [ ] **Step 4: Run the focused test and observe GREEN**

Run: `npm test -- src/features/planning/components/occShiftPresets.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the catalog and its test**

```text
git add frontend/private-web/src/features/planning/components/occShiftPresets.js frontend/private-web/src/features/planning/components/occShiftPresets.test.js
git commit -m "feat(occ): define reviewed per-flight shift presets"
```

### Task 2: Editable OCC form, regression tests, and truthful documentation

**Files:**
- Modify: `frontend/private-web/src/features/planning/components/OccShiftPanel.jsx`
- Modify: `frontend/private-web/src/features/planning/components/OccShiftPanel.test.jsx`
- Modify: `frontend/private-web/README.md`
- Modify: `Vault/05-aplicaciones/private-web-aviam.md`
- Possibly regenerate: `Vault/_generated/repository-inventory.json` only if `npm run vault:generate` produces a reviewed diff.

**Interfaces:**
- Consumes: `OCC_SHIFT_PRESETS` and `getOccShiftPreset(id)` from Task 1; existing `programPlanningShift(turnaroundId, { agentId, startsAtLocal, endsAtLocal }, { signal })`.
- Produces: an accessible `Horario precargado` select that copies values into editable `type=time` controls; the existing API request shape is unchanged.

- [ ] **Step 1: Add component tests before changing the form**

Extend `OccShiftPanel.test.jsx` with this shared fixture and the following tests:

```jsx
const shiftOnlyOptions = { ...OPTIONS_STATE_SUCCESS, data: {
  ...OPTIONS_STATE_SUCCESS.data,
  agents: [{ id: 'agent-1', displayName: 'Riley Ramp', employeeNumber: 'DEV-RA-001',
    eligible: false, eligibilityReasons: ['shift_not_compatible'] }],
} };

it('copies an overnight choice, marks next day, and sends the local clocks unchanged', async () => {
  render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
  await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
  await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'night-2300');
  expect(screen.getByLabelText('Inicio del turno local')).toHaveValue('23:00');
  expect(screen.getByLabelText('Fin del turno local')).toHaveValue('08:00');
  expect(screen.getByText(/fin al día siguiente/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Programar turno' }));
  await waitFor(() => expect(programPlanningShift).toHaveBeenCalledWith(flight.turnaroundId,
    { agentId: 'agent-1', startsAtLocal: '23:00:00', endsAtLocal: '08:00:00' },
    expect.objectContaining({ signal: expect.any(AbortSignal) })));
});

it('keeps manual edits instead of reverting to a previously chosen preset', async () => {
  render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
  await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'morning-0700');
  await userEvent.clear(screen.getByLabelText('Fin del turno local'));
  await userEvent.type(screen.getByLabelText('Fin del turno local'), '16:30');
  expect(screen.getByLabelText('Horario precargado')).toHaveValue('');
  expect(screen.getByLabelText('Fin del turno local')).toHaveValue('16:30');
});

it('drops the old preset when a different flight replaces the drawer content', async () => {
  const { rerender } = render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
  await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'evening-1500');
  const nextFlight = createPlanningFlight({
    turnaroundId: '91000000-0000-0000-0000-000000000099',
    assignedAgents: [], agents: [], hasAssignmentGap: true,
    operation: { ...flight.operation, plannedStartAt: '2026-08-19T18:00:00-04:00',
      plannedEndAt: '2026-08-19T19:00:00-04:00' },
  });
  rerender(<OccShiftPanel flight={nextFlight} optionsState={shiftOnlyOptions} />);
  expect(screen.getByLabelText('Horario precargado')).toHaveValue('');
  expect(screen.getByLabelText('Inicio del turno local')).toHaveValue('18:00');
  expect(screen.getByLabelText('Fin del turno local')).toHaveValue('19:00');
});
```

Keep and rerun the existing otherwise-qualified-only and `409` tests without weakening their assertions.

- [ ] **Step 2: Run the component test and observe RED**

Run from `frontend/private-web`: `npm test -- src/features/planning/components/OccShiftPanel.test.jsx`

Expected: FAIL because the `Horario precargado` control is absent.

- [ ] **Step 3: Add preset copying without changing the API contract**

In `OccShiftPanel.jsx`, import the catalog and lookup, add `const [presetId, setPresetId] = useState('');`, and call `setPresetId('');` in the existing `flight.turnaroundId` reset effect. Immediately before the two time inputs, render this control:

```jsx
<label className="block text-xs font-medium">Horario precargado
  <select value={presetId} onChange={event => {
    const preset = getOccShiftPreset(event.target.value);
    setPresetId(preset?.id ?? '');
    if (preset) {
      setStartsAtLocal(preset.startsAtLocal);
      setEndsAtLocal(preset.endsAtLocal);
    }
  }} className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-surface-dark-card">
    <option value="">Personalizado</option>
    {OCC_SHIFT_PRESETS.map(preset =>
      <option key={preset.id} value={preset.id}>{preset.label}</option>)}
  </select>
</label>
```

Replace the two time inputs' handlers with `onChange={event => { setStartsAtLocal(event.target.value); setPresetId(''); }}` and `onChange={event => { setEndsAtLocal(event.target.value); setPresetId(''); }}` respectively. Below the inputs, render `{startsAtLocal > endsAtLocal && <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Fin al día siguiente, hora local de la estación.</p>}`. Keep the existing candidate filtering, submit guard, server error rendering, and `onProgrammed` refresh unchanged.

- [ ] **Step 4: Run the focused tests and observe GREEN**

Run: `npm test -- src/features/planning/components/occShiftPresets.test.js src/features/planning/components/OccShiftPanel.test.jsx`

Expected: PASS, the two catalog tests, three new component tests, and all existing component tests.

- [ ] **Step 5: Update the user-facing README with scope limits**

In `frontend/private-web/README.md`'s OCC planning description, add: “El formulario OCC de cobertura de rampa ofrece seis horarios precargados por vuelo y permite editar inicio y fin antes de confirmar. No guarda plantillas globales: la API valida la cobertura local, la elegibilidad y los conflictos. Fuera de las escalas manuales todavía no existe un editor general del calendario OCC.”

- [ ] **Step 6: Run area and repository checks**

Run from `frontend/private-web`: `npm test`

Expected: PASS, zero failed test files. Run from repository root: `npm run vault:check`, `npm run check`, and `git diff --check`.

Expected: Vault validation, secret scan, and whitespace check all pass. Build from `frontend/private-web` with this non-secret PowerShell command:

```powershell
$env:VITE_ELEVANT_API_URL='https://api.elevant.test'; $env:VITE_PROTOTYPE_API_URL='https://api.elevant.test'; $env:VITE_HR_DEMO_MODE='dashboard-read-only'; npm run build
```

Expected: exit 0. Do not commit `dist/`, `.env.local`, or other generated output.

- [ ] **Step 7: Commit the tested UI and README**

```text
git add frontend/private-web/src/features/planning/components/OccShiftPanel.jsx frontend/private-web/src/features/planning/components/OccShiftPanel.test.jsx frontend/private-web/README.md
git commit -m "feat(occ): offer editable per-flight shift presets"
```

- [ ] **Step 8: Verify sources, then update the relevant Vault note**

Read every path in `Vault/05-aplicaciones/private-web-aviam.md`'s frontmatter `sources` list at the Task 2 code commit. Add these two paths to that list:

```yaml
  - frontend/private-web/src/features/planning/components/OccShiftPanel.jsx
  - frontend/private-web/src/features/planning/components/occShiftPresets.js
```

In its OCC planning subsection, add: “En esta rama, el panel de cobertura de una escala manual ofrece seis intervalos locales precargados y permite editar ambas horas antes de confirmar. Solo el turno confirmado llega a la API; no hay plantillas globales. La API conserva la validación de estación, elegibilidad, cobertura nocturna y conflictos. El editor general del calendario OCC sigue pendiente. Fuentes: [panel](../../frontend/private-web/src/features/planning/components/OccShiftPanel.jsx) y [opciones](../../frontend/private-web/src/features/planning/components/occShiftPresets.js).” Set `last_verified` to the actual verification date and `verified_commit` to the complete Task 2 code commit hash obtained from `git rev-parse HEAD` only after checking all listed sources. Do not claim VPS promotion from local tests.

Run from repository root: `npm run vault:generate`, `npm run vault:check`, `npm run check`, and `git diff --check`.

Expected: generator exits 0, Vault validates, secret scan and whitespace check pass. Inspect any generated inventory diff before staging it.

- [ ] **Step 9: Commit the Vault note and any reviewed generated inventory**

```text
git add Vault/05-aplicaciones/private-web-aviam.md
git commit -m "docs(vault): record OCC per-flight shift choices"
```

If `npm run vault:generate` legitimately changed an inventory file, include that exact generated file in this commit after inspecting its diff. The branch remains local until reviewed; the VPS is not changed by this plan.
