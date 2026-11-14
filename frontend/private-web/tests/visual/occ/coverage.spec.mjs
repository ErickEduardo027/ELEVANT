import { API_PATHS, COVERAGE_REFUSAL, createScreensApi } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Cobertura de posiciones (PR U6, step c) in Chrome: template C of the design («Mesa de trabajo») with a synthetic OCC
// session and a stubbed API (fixtures/screensApi.mjs), in the two windows of the presentation. The toolbar holds the
// title and the date; «Terminal y vista» switches the terminal and the view; the board of the terminal and the
// coverages of the day sit at the left and the form at the right from 1280 px. Screenshots for review go to
// test-results/visual as cobertura-{state}-{width}.png. The stub refuses every new coverage: nothing is written.

const PAGE = '/admin-occ/position-coverage';
// The light key of the primary action (--occ-primary). A button changes its colours through a short transition, so a
// screenshot waits until the key shows this one.
const PRIMARY_KEY = 'rgb(232, 238, 241)';

// The row of a stand, found by the plate of its code (A1 is not A10 or A11).
const rowOf = (page, table, code) => table.getByRole('row')
  .filter({ has: page.locator('[data-occ-plate]', { hasText: new RegExp(`^${code}$`) }) });

async function openCoverage(page, isolation, viewport, scenario = 'data') {
  const api = createScreensApi(scenario);
  const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  await expect(main.getByText('Cargando la cobertura de posiciones…')).toHaveCount(0);
  return { api, main };
}

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Cobertura de posiciones at ${viewport.width}×${viewport.height}`, () => {
    test('board with the form', async ({ page, isolation }, testInfo) => {
      const { api, main } = await openCoverage(page, isolation, viewport);
      // What the cycle E2E and the guide press: «Terminal A» by its exact name inside «Terminal y vista».
      const nav = main.getByRole('navigation', { name: 'Terminal y vista' });
      await expect(nav.getByRole('button', { name: 'Terminal A', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(nav.getByRole('button', { name: 'Cobertura', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const board = main.getByRole('region', { name: 'Posiciones de la terminal' });
      const table = board.getByRole('table', { name: 'Posiciones de la terminal' });
      // A header row and the sixteen stands of terminal A.
      await expect(table.getByRole('row')).toHaveCount(17);
      await expect(rowOf(page, table, 'A11')).toContainText('Desactivada');
      await expect(rowOf(page, table, 'AN5')).toContainText('Estrecho');
      await expect(rowOf(page, table, 'A1')).toContainText('Agente de prueba Uno, Agente de prueba Seis');
      await expect(rowOf(page, table, 'A4')).toContainText('Sin agente');

      // The form docked at the right of the board, from the same top, from 1280 px.
      const form = main.getByRole('form', { name: 'Asignar posiciones' });
      const formBox = await main.getByRole('region', { name: 'Asignar posiciones' }).boundingBox();
      const boardBox = await board.boundingBox();
      expect(formBox.x).toBeGreaterThan(boardBox.x + boardBox.width);
      expect(Math.abs(formBox.y - boardBox.y)).toBeLessThan(1);
      const agents = form.getByRole('combobox', { name: 'Agente', exact: true });
      await agents.selectOption({ label: 'Agente de prueba Uno · 06:00–14:00' });
      await form.getByRole('button', { name: 'A4', exact: true }).click();
      await form.getByRole('button', { name: 'A7', exact: true }).click();
      await expect(form.getByRole('button', { name: 'A4', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(form.getByText('Posiciones (2/3)')).toBeVisible();
      await expect(form.getByRole('list', { name: 'Condiciones del agente' })).toContainText('Licencia de conducir');
      const submit = form.getByRole('button', { name: 'Asignar posiciones' });
      await expect(submit).toBeEnabled();
      await expect(submit).toHaveCSS('background-color', PRIMARY_KEY);
      await shoot(page, testInfo, `cobertura-tablero-${viewport.width}`);

      // Further down: the coverages of the day, one item per agent with its own «Liberar».
      const day = main.getByRole('region', { name: 'Coberturas del día' });
      await day.scrollIntoViewIfNeeded();
      const items = day.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Liberar' }) });
      await expect(items).toHaveCount(3);
      const uno = day.getByRole('listitem').filter({ hasText: 'Agente de prueba Uno' });
      await expect(uno).toContainText('VH-07');
      await expect(uno).toContainText('06:00–14:00');
      await expect(day.getByRole('listitem').filter({ hasText: 'Refuerzo' })).toContainText('12:00–17:00');
      await shoot(page, testInfo, `cobertura-coberturas-${viewport.width}`);

      // Terminal B: its bridge stands, and the rule the form states for it.
      await nav.getByRole('button', { name: 'Terminal B', exact: true }).click();
      await expect(rowOf(page, board.getByRole('table'), 'B20')).toContainText('Puente');
      await expect(form).toContainText('exige habilitación de puente');
      await expect(form.getByRole('button', { name: 'B20', exact: true })).toHaveAccessibleDescription('con puente');
      await main.evaluate(node => node.scrollTo(0, 0));
      await shoot(page, testInfo, `cobertura-terminal-b-${viewport.width}`);
      // Switching the terminal and choosing stands read nothing again.
      expect(api.readsOf(API_PATHS.coverage)).toBe(1);
    });

    test('configuration', async ({ page, isolation }, testInfo) => {
      const { main } = await openCoverage(page, isolation, viewport);
      const nav = main.getByRole('navigation', { name: 'Terminal y vista' });
      await nav.getByRole('button', { name: 'Configuración', exact: true }).click();
      const attributes = main.getByRole('region', { name: 'Atributos de las posiciones' });
      const table = attributes.getByRole('table', { name: 'Atributos de las posiciones' });
      await expect(table.getByRole('row')).toHaveCount(17);
      await expect(rowOf(page, table, 'A11').getByLabel('Activa')).not.toBeChecked();
      await expect(main.getByRole('region', { name: 'Reglas de la terminal' })).toContainText('Terminal A');
      const combined = main.getByRole('region', { name: 'Posiciones combinadas' });
      await expect(combined.getByRole('button', { name: 'Quitar' })).toHaveCount(2);
      await expect(attributes.getByRole('link', { name: 'Datos maestros' })).toHaveAttribute('href', '/admin-occ/master-data');
      // An edited row offers its «Guardar»; nothing is sent until it is pressed.
      await rowOf(page, table, 'AN2').getByLabel('Activa').uncheck();
      await expect(rowOf(page, table, 'AN2').getByRole('button', { name: 'Guardar' })).toBeVisible();
      await shoot(page, testInfo, `cobertura-configuracion-${viewport.width}`);
    });

    test('a refused assignment with its reasons', async ({ page, isolation }, testInfo) => {
      const { api, main } = await openCoverage(page, isolation, viewport);
      const form = main.getByRole('form', { name: 'Asignar posiciones' });
      await form.getByRole('combobox', { name: 'Agente', exact: true })
        .selectOption({ label: 'Agente de prueba Dos · 06:00–14:00 · menos de 3 meses' });
      const conditions = form.getByRole('list', { name: 'Condiciones del agente' });
      await expect(conditions.locator('[data-tone="attention"]')).toHaveText('Menos de 3 meses: va con mentor');
      await expect(form.getByRole('combobox', { name: 'Mentor', exact: true })).toBeVisible();
      for (const code of ['A7', 'A8', 'AN1']) await form.getByRole('button', { name: code, exact: true }).click();
      await expect(form.getByRole('textbox', { name: 'Vehículo asignado' })).toBeVisible();
      await form.getByRole('button', { name: 'Asignar posiciones' }).click();
      // The server refused it: the page says why with its own words, one line per broken rule, in amber.
      const reasons = form.getByRole('alert');
      await expect(reasons).toContainText('La cobertura no cumple las reglas de asignación.');
      await expect(reasons.getByRole('listitem')).toHaveCount(COVERAGE_REFUSAL.reasons.length);
      await expect(reasons).toContainText('El agente tiene menos de 3 meses: necesita un mentor experimentado.');
      await expect(main.getByText('Unprocessable Entity')).toHaveCount(0);
      await expect(form.getByRole('button', { name: 'Asignar posiciones' })).toHaveCSS('background-color', PRIMARY_KEY);
      // The reasons sit right above the form's button: both on screen.
      await form.getByRole('button', { name: 'Asignar posiciones' }).scrollIntoViewIfNeeded();
      await expect(reasons).toBeInViewport();
      await shoot(page, testInfo, `cobertura-rechazo-${viewport.width}`);
      expect(api.commands).toEqual([API_PATHS.coverage]);
      // The refusal settles the intent: nothing else was sent, and the board was not read again.
      const sent = isolation.requests.filter(entry => entry.kind === 'api' && entry.method === 'POST'
        && new URL(entry.url).pathname === API_PATHS.coverage);
      expect(sent).toHaveLength(1);
      expect(api.readsOf(API_PATHS.coverage)).toBe(1);
    });

    test('forbidden', async ({ page, isolation }, testInfo) => {
      const { main } = await openCoverage(page, isolation, viewport, 'forbidden');
      await expect(main.getByText('Tu acceso no permite ver la cobertura de posiciones de esta estación.')).toBeVisible();
      await expect(main.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
      await expect(main.getByRole('navigation', { name: 'Terminal y vista' })).toHaveCount(0);
      await expect(main.getByText('Forbidden')).toHaveCount(0);
      await shoot(page, testInfo, `cobertura-sin-permiso-${viewport.width}`);
    });
  });
}
