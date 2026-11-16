import { API_PATHS, createScreensApi } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Reportes (PR U6, step e) in Chrome: template D of the design («Registro») with a synthetic OCC session and a stubbed
// API (fixtures/screensApi.mjs), in the two windows of the presentation. The toolbar holds the report and its period
// with «Generar»; while the list of reports loads, a skeleton under it says so; the generated page is a panel with its
// export actions in the header, the dense table and the pages at its foot. Screenshots for review go to
// test-results/visual as reportes-{state}-{width}.png. No export is pressed: nothing is downloaded.

const PAGE = '/admin-occ/reports';
// The light key of the primary action (--occ-primary).
const PRIMARY_KEY = 'rgb(232, 238, 241)';
const TURNAROUND = `${API_PATHS.reports}/turnaround-times`;
const REPORT = 'Tiempos de turnaround';
const IDLE = 'Elige el reporte y el período, y pulsa «Generar».';

async function openReports(page, isolation, viewport, scenario = 'data') {
  const api = createScreensApi(scenario);
  const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  await expect(main.getByRole('heading', { level: 1, name: 'Reportes operativos' })).toBeVisible();
  // The list of reports loaded: before the first report the page says what to do.
  await expect(main.getByText(IDLE)).toBeVisible();
  return { api, main, filters: main.getByRole('toolbar', { name: 'Reporte y período' }) };
}

/** The stub API of a scenario, whose list of reports answers only once `release()` is called. */
function heldCatalogApi(scenario = 'data') {
  const api = createScreensApi(scenario);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  return {
    release,
    handle: async (request, url) => {
      if (url.pathname === API_PATHS.reports) await held;
      return api.handle(request, url);
    },
  };
}

async function generate(filters, title = REPORT) {
  await filters.getByRole('combobox', { name: 'Reporte' }).selectOption({ label: title });
  await filters.getByRole('button', { name: 'Generar' }).click();
}

// The exports asked of the stub: a spec never presses one.
const exportsOf = isolation => isolation.requests.filter(entry => entry.kind === 'api'
  && new URL(entry.url).pathname.endsWith('/export'));

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Reportes at ${viewport.width}×${viewport.height}`, () => {
    test('first load of the list of reports', async ({ page, isolation }, testInfo) => {
      const api = heldCatalogApi();
      const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
      await expect(main.getByRole('heading', { level: 1, name: 'Reportes operativos' })).toBeVisible();
      // Under the toolbar a skeleton of two lines says the list is on its way; nothing invites to choose yet, and the
      // list and «Generar» cannot be used.
      const loading = main.getByRole('status').filter({ hasText: 'Cargando reportes…' });
      await expect(loading).toBeVisible();
      await expect(main.getByText(IDLE)).toHaveCount(0);
      const filters = main.getByRole('toolbar', { name: 'Reporte y período' });
      await expect(filters.getByRole('combobox', { name: 'Reporte' })).toBeDisabled();
      await expect(filters.getByRole('button', { name: 'Generar' })).toBeDisabled();
      await shoot(page, testInfo, `reportes-cargando-${viewport.width}`);
      api.release();
      await expect(main.getByText(IDLE)).toBeVisible();
      await expect(loading).toHaveCount(0);
      await expect(filters.getByRole('combobox', { name: 'Reporte' })).toBeEnabled();
    });

    test('a generated report', async ({ page, isolation }, testInfo) => {
      const { main, filters } = await openReports(page, isolation, viewport);
      await expect(filters.getByRole('button', { name: 'Generar' })).toHaveCSS('background-color', PRIMARY_KEY);
      await shoot(page, testInfo, `reportes-inicio-${viewport.width}`);

      // The chosen report's description sits under the toolbar.
      await filters.getByRole('combobox', { name: 'Reporte' }).selectOption({ label: REPORT });
      await expect(main.getByText('Duración planificada frente a la real de las operaciones terminadas, con su desviación en minutos.'))
        .toBeVisible();
      await filters.getByRole('button', { name: 'Generar' }).click();
      const panel = main.getByRole('region', { name: REPORT, exact: true });
      const table = panel.getByRole('table', { name: REPORT });
      // A header row and the 25 rows of the first page, under the server's headers and nothing else.
      await expect(table.getByRole('row')).toHaveCount(26);
      await expect(table.getByRole('columnheader')).toHaveText(['Fecha', 'Operación', 'Aerolínea', 'Minutos planificados',
        'Minutos reales', 'Desviación (min)']);
      // Numbers sit on the right, their «—» placeholders too; text on the left.
      await expect(table.getByRole('columnheader', { name: 'Minutos reales' })).toHaveCSS('text-align', 'right');
      await expect(table.getByRole('columnheader', { name: 'Operación' })).toHaveCSS('text-align', 'left');
      await expect(table.getByRole('cell', { name: '—' }).first()).toHaveCSS('text-align', 'right');
      // The header says which page and when it was generated, in the station's time (15:45 UTC is 11:45), and holds
      // the three exports.
      await expect(panel.getByText('Página 1, 25 filas')).toBeVisible();
      await expect(panel.getByText('Generado 13/11/2026, 11:45')).toBeVisible();
      await expect(panel.getByRole('button', { name: /^Exportar / })).toHaveText(['Exportar Excel', 'Exportar PDF', 'Exportar CSV']);
      const pages = panel.getByRole('navigation', { name: 'Páginas del reporte' });
      await expect(pages.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      // The rows scroll inside the panel: its pages stay in the window, and the headers stay on top of the rows.
      await expect(pages).toBeInViewport({ ratio: 1 });
      await shoot(page, testInfo, `reportes-generado-${viewport.width}`);
      await table.locator('xpath=..').evaluate(rows => rows.scrollTo(0, rows.scrollHeight));
      await expect(table.getByRole('row').last()).toBeInViewport();
      await expect(table.getByRole('columnheader', { name: 'Fecha' })).toBeInViewport();
      await shoot(page, testInfo, `reportes-generado-final-${viewport.width}`);

      // The second page: seven rows, and no next one.
      await pages.getByRole('button', { name: 'Siguiente' }).click();
      await expect(table.getByRole('row')).toHaveCount(8);
      await expect(panel.getByText('Página 2, 7 filas')).toBeVisible();
      await expect(pages.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
      await expect(pages.getByRole('button', { name: 'Anterior' })).toBeEnabled();
      await shoot(page, testInfo, `reportes-pagina-2-${viewport.width}`);
      expect(exportsOf(isolation)).toEqual([]);
    });

    test('empty period', async ({ page, isolation }, testInfo) => {
      const { main, filters } = await openReports(page, isolation, viewport, 'empty');
      await generate(filters);
      const panel = main.getByRole('region', { name: REPORT, exact: true });
      await expect(panel.getByText('No hay datos para este reporte en el período seleccionado.')).toBeVisible();
      // The header keeps only when it was generated: the body already says there are no rows.
      await expect(panel.getByText('Generado 13/11/2026, 11:45')).toBeVisible();
      await expect(panel.getByText(/^Página/)).toHaveCount(0);
      // Nothing to export, and a single page has no pages to turn.
      for (const name of ['Exportar Excel', 'Exportar PDF', 'Exportar CSV']) {
        await expect(panel.getByRole('button', { name })).toBeDisabled();
      }
      await expect(panel.getByRole('navigation', { name: 'Páginas del reporte' })).toHaveCount(0);
      await shoot(page, testInfo, `reportes-periodo-vacio-${viewport.width}`);
      expect(exportsOf(isolation)).toEqual([]);
    });

    test('error', async ({ page, isolation }, testInfo) => {
      const { api, main, filters } = await openReports(page, isolation, viewport, 'error');
      await generate(filters);
      // The panel keeps the report's name and says what failed in the service's words, never the server's title.
      const panel = main.getByRole('region', { name: REPORT, exact: true });
      await expect(panel.getByRole('alert')).toHaveText('No se pudo generar el reporte. Intenta nuevamente.');
      await expect(main.getByText('Internal Server Error')).toHaveCount(0);
      await expect(panel.getByRole('button', { name: /^Exportar/ })).toHaveCount(0);
      await shoot(page, testInfo, `reportes-error-${viewport.width}`);
      const before = api.readsOf(TURNAROUND);
      await panel.getByRole('button', { name: 'Reintentar' }).click();
      await expect.poll(() => api.readsOf(TURNAROUND)).toBeGreaterThan(before);
      await expect(panel.getByRole('alert')).toHaveText('No se pudo generar el reporte. Intenta nuevamente.');
    });
  });
}
