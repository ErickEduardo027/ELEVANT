import { API_PATHS, createScreensApi } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, occRgb, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Contratos listos (PR U6, step e) in Chrome: template D of the design («Registro») with a synthetic OCC session and a
// stubbed API (fixtures/screensApi.mjs), in the two windows of the presentation. The toolbar holds the title, the count
// of the day and the operation date; the contracts of that date are a dense list, one row per contract with its
// services open under it (a disclosure folds them, the presentation guide pictures them open) and «Planificar vuelos»
// at its end. Screenshots for review go to test-results/visual as contratos-listos-{state}-{width}.png.

const PAGE = '/admin-occ/contracts';
// Plain text (--occ-text), a quiet joint (--occ-line) and the strong joint of a control (--occ-line-strong).
const TEXT = occRgb('--occ-text');
const LINE = occRgb('--occ-line');
const LINE_STRONG = occRgb('--occ-line-strong');

async function openContracts(page, isolation, viewport, scenario = 'data') {
  const api = createScreensApi(scenario);
  const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  await expect(main.getByRole('heading', { level: 1, name: 'Contratos listos para operar' })).toBeVisible();
  await expect(main.getByText('Cargando contratos…')).toHaveCount(0);
  return { api, main, list: main.getByRole('list', { name: 'Contratos listos para operar', exact: true }) };
}

// The row of a contract, found by its airline's exact name («Aerolínea de prueba» is not «… Dos»).
const rowOf = (page, list, airline) => list.getByRole('listitem').filter({ has: page.getByText(airline, { exact: true }) });
// The line of a row, without the services under it.
const lineOf = row => row.locator(':scope > div:not([data-occ-row-detail])');

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Contratos listos at ${viewport.width}×${viewport.height}`, () => {
    test('data with the services open', async ({ page, isolation }, testInfo) => {
      const { main, list } = await openContracts(page, isolation, viewport);
      // One item per contract; the services of each are a list inside it. What fase2-preoperacion.spec.ts and the guide
      // find, the list by its name and an item by its airline's text, is still one item per airline.
      await expect(list.locator(':scope > li')).toHaveCount(4);
      await expect(list.getByRole('listitem').filter({ hasText: 'Demo Airlines' })).toHaveCount(1);
      await expect(main.getByRole('status').filter({ hasText: '4 contratos listos' })).toBeVisible();
      const demo = rowOf(page, list, 'Demo Airlines');
      await expect(demo).toBeVisible();
      await expect(demo).toContainText('CTR-2026-0101 · Versión 3');
      await expect(demo).toContainText('Desde 1 ene 2026, sin fecha fin');
      await expect(demo.locator('[data-occ-plate]')).toHaveText('ZZ');
      const dated = rowOf(page, list, 'Aerolínea de prueba');
      await expect(dated).toContainText('1 mar 2026 a 31 dic 2026');
      await expect(dated).toContainText('Manual');
      await expect(dated).toContainText('1 vuelo planificado ese día');
      const quiet = rowOf(page, list, 'Aerolínea de prueba Dos');
      await expect(quiet).toContainText('Sin definir');
      await expect(quiet).toContainText('Sin vuelos planificados ese día');
      // A cargo airline without an IATA code has no plate.
      await expect(rowOf(page, list, 'Carga de prueba').locator('[data-occ-plate]')).toHaveCount(0);
      // In these windows every cell keeps one line: the line of a row of short names is one line of text tall.
      for (const airline of ['Demo Airlines', 'Aerolínea de prueba', 'Carga de prueba']) {
        expect((await lineOf(rowOf(page, list, airline)).boundingBox()).height, airline).toBeLessThan(44);
      }

      // «Planificar vuelos» keeps its text and its target, drawn as a secondary button.
      const plan = demo.getByRole('link', { name: 'Planificar vuelos' });
      await expect(plan).toHaveAttribute('href', '/admin-occ/planning');
      await expect(plan).toHaveCSS('border-top-color', LINE_STRONG);
      await expect(plan).toHaveCSS('color', TEXT);

      // Every row opens with its services on view, quiet tags that are never cyan, under a disclosure named by them.
      const toggle = demo.getByRole('button', { name: 'Servicios contratados (3)' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const services = demo.getByRole('list', { name: 'Servicios contratados' });
      await expect(services.getByRole('listitem')).toHaveText(['Turnaround completo', 'Remolque', 'Planta de energía']);
      await expect(services.getByRole('listitem').first()).toHaveCSS('color', TEXT);
      await expect(services.getByRole('listitem').first()).toHaveCSS('border-top-color', LINE);
      await expect(dated.getByRole('button', { name: 'Servicios contratados (2)' })).toHaveAttribute('aria-expanded', 'true');
      await expect(quiet.getByText('Sin servicios activos')).toBeVisible();
      await shoot(page, testInfo, `contratos-listos-datos-${viewport.width}`);

      // The disclosure folds one row and leaves the others open; it opens the row again.
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(demo.getByText('Turnaround completo')).toBeHidden();
      await expect(dated.getByRole('button', { name: 'Servicios contratados (2)' })).toHaveAttribute('aria-expanded', 'true');
      await shoot(page, testInfo, `contratos-listos-fila-plegada-${viewport.width}`);
      await toggle.click();
      await expect(services.getByRole('listitem').first()).toBeVisible();
    });

    test('empty', async ({ page, isolation }, testInfo) => {
      const { main } = await openContracts(page, isolation, viewport, 'empty');
      await expect(main.getByText('No hay contratos listos para esta fecha.')).toBeVisible();
      await expect(main.getByText('Un contrato aparece aquí cuando está activo, firmado por ambas partes y su versión cubre la fecha en PUJ.'))
        .toBeVisible();
      // No count is drawn for a day without contracts.
      await expect(main.getByRole('status').filter({ hasText: /listos?$/ })).toHaveCount(0);
      await shoot(page, testInfo, `contratos-listos-vacio-${viewport.width}`);
    });

    test('error', async ({ page, isolation }, testInfo) => {
      const { api, main } = await openContracts(page, isolation, viewport, 'error');
      await expect(main.getByRole('alert')).toHaveText('No se pudieron cargar los contratos listos. Intenta nuevamente.');
      // The server's title never reaches the screen.
      await expect(main.getByText('Internal Server Error')).toHaveCount(0);
      await shoot(page, testInfo, `contratos-listos-error-${viewport.width}`);
      const before = api.readsOf(API_PATHS.contracts);
      await main.getByRole('button', { name: 'Reintentar' }).click();
      await expect.poll(() => api.readsOf(API_PATHS.contracts)).toBeGreaterThan(before);
    });

    test('forbidden', async ({ page, isolation }, testInfo) => {
      const { main } = await openContracts(page, isolation, viewport, 'forbidden');
      await expect(main.getByRole('alert')).toHaveText('Tu acceso no incluye la planificación de esta estación.');
      // Pressing again would not change the access: no retry.
      await expect(main.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
      await shoot(page, testInfo, `contratos-listos-sin-permiso-${viewport.width}`);
    });
  });
}
