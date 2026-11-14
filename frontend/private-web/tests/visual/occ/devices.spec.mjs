import { API_PATHS, createScreensApi } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Tablets (PR U6, step d) in Chrome: template D of the design («Registro») with a synthetic OCC session and a stubbed
// API (fixtures/screensApi.mjs), in the two windows of the presentation. Who holds each tablet, as a dense table with its
// status glyph and word, and the dialogs of its two commands; revoking is an alertdialog that starts on «Cancelar».
// Screenshots for review go to test-results/visual as tablets-{state}-{width}.png. The stub answers no command: no
// tablet is freed or revoked.

const PAGE = '/admin-occ/devices';
// The light key of the primary action (--occ-primary) and the red joint of a destructive one (--occ-danger).
const PRIMARY_KEY = 'rgb(232, 238, 241)';
const DANGER = 'rgb(245, 116, 109)';

async function openTablets(page, isolation, viewport, scenario = 'data', options = {}) {
  const api = createScreensApi(scenario, options);
  const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  // What fase2-preoperacion.spec.ts waits for: the heading «Tablets» and the end of the loading line.
  await expect(main.getByRole('heading', { name: 'Tablets', exact: true })).toBeVisible();
  await expect(main.getByText('Cargando las tablets…')).toHaveCount(0);
  return { api, main, list: main.getByRole('region', { name: 'Tablets de la estación', exact: true }) };
}

// The row of a tablet, found by its name.
const rowOf = (list, name) => list.getByRole('row').filter({ hasText: name });
// The tablet commands sent: the stub refuses them, and a spec never sends one.
const sent = isolation => isolation.requests.filter(entry => entry.kind === 'api' && entry.method !== 'GET'
  && new URL(entry.url).pathname.startsWith(API_PATHS.devices));

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Tablets at ${viewport.width}×${viewport.height}`, () => {
    test('who holds each tablet', async ({ page, isolation }, testInfo) => {
      const { list } = await openTablets(page, isolation, viewport);
      const table = list.getByRole('table', { name: 'Tablets de la estación' });
      await expect(table.getByRole('row')).toHaveCount(6);
      await expect(table.getByRole('columnheader')).toHaveText(['Tablet', 'Agente', 'Última conexión', 'Estado', '']);
      // Each status with its glyph and word: an agent in the middle of an operation asks for attention, the rest are calm.
      const status = name => rowOf(list, name).locator('[data-occ-status]');
      await expect(status('Tablet T-01')).toHaveAttribute('data-tone', 'attention');
      await expect(status('Tablet T-01')).toHaveText('Operación en curso');
      await expect(rowOf(list, 'Tablet T-01')).toContainText('Otro agente no puede tomarla hasta que este cierre sesión o la liberes.');
      await expect(status('Tablet T-02')).toHaveText('En uso');
      await expect(status('Tablet T-03')).toHaveText('Libre');
      await expect(status('Tablet T-05')).toHaveText('Revocada');
      // A tablet without a name takes its platform's; one with no agent says so.
      await expect(rowOf(list, 'Tablet iOS')).toContainText('Sin agente');
      // Who holds it and since when, in the station's time: 10:05 UTC is 06:05 in Santo Domingo.
      await expect(rowOf(list, 'Tablet T-01')).toContainText('En manos de');
      await expect(rowOf(list, 'Tablet T-01')).toContainText('Agente de prueba Uno · VIS-RA-001');
      await expect(rowOf(list, 'Tablet T-01')).toContainText('desde 13/11 06:05');
      await expect(rowOf(list, 'Tablet T-03')).toContainText('Último agente');
      // What can be done to each: «Liberar» while an agent holds it, «Revocar» until it is revoked.
      await expect(rowOf(list, 'Tablet T-02').getByRole('button')).toHaveText(['Liberar', 'Revocar']);
      await expect(rowOf(list, 'Tablet T-03').getByRole('button')).toHaveText(['Revocar']);
      await expect(rowOf(list, 'Tablet T-05').getByRole('button')).toHaveCount(0);
      await expect(rowOf(list, 'Tablet T-02').getByRole('button', { name: 'Revocar' })).toHaveCSS('border-top-color', DANGER);
      await shoot(page, testInfo, `tablets-registro-${viewport.width}`);
      expect(sent(isolation)).toEqual([]);
    });

    test('revoke dialog', async ({ page, isolation }, testInfo) => {
      const { list } = await openTablets(page, isolation, viewport);
      const revoke = rowOf(list, 'Tablet T-02').getByRole('button', { name: 'Revocar' });
      await revoke.click();
      const dialog = page.getByRole('alertdialog', { name: 'Revocar Tablet T-02' });
      // A hasty Enter changes nothing: the dialog starts on «Cancelar».
      await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
      await expect(dialog).toContainText('se cierran todas las sesiones de Agente de prueba Dos. No se puede deshacer.');
      const submit = dialog.getByRole('button', { name: 'Revocar tablet' });
      await expect(submit).toBeDisabled();
      await dialog.getByLabel('Motivo', { exact: true }).fill('Tablet extraviada en la rampa');
      await expect(submit).toBeEnabled();
      await expect(submit).toHaveCSS('border-top-color', DANGER);
      // The veil covers the page, and the dialog stays within the window.
      const box = await dialog.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await shoot(page, testInfo, `tablets-revocar-${viewport.width}`);
      // Esc closes it, the focus goes back to the row's «Revocar» and nothing was sent.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(revoke).toBeFocused();

      // Freeing one asks without alarm, from its reason, with the light key.
      await rowOf(list, 'Tablet T-01').getByRole('button', { name: 'Liberar' }).click();
      const release = page.getByRole('dialog', { name: 'Liberar Tablet T-01' });
      await expect(release.getByLabel('Motivo (opcional)', { exact: true })).toBeFocused();
      await expect(release.getByRole('button', { name: 'Liberar tablet' })).toHaveCSS('background-color', PRIMARY_KEY);
      await shoot(page, testInfo, `tablets-liberar-${viewport.width}`);
      await release.getByRole('button', { name: 'Cancelar' }).click();
      await expect(release).toHaveCount(0);
      expect(sent(isolation)).toEqual([]);
    });

    test('read-only', async ({ page, isolation }, testInfo) => {
      const { list } = await openTablets(page, isolation, viewport, 'data', { readOnly: true });
      await expect(list.getByRole('status')).toHaveText('Tu acceso permite consultar las tablets, no liberarlas ni revocarlas.');
      await expect(list.getByRole('button')).toHaveCount(0);
      await shoot(page, testInfo, `tablets-solo-lectura-${viewport.width}`);
    });

    test('empty', async ({ page, isolation }, testInfo) => {
      const { list } = await openTablets(page, isolation, viewport, 'empty');
      await expect(list.getByText('Sin tablets registradas')).toBeVisible();
      await expect(list.getByText('Una tablet aparece aquí cuando un agente de la estación inicia sesión en ella.')).toBeVisible();
      await shoot(page, testInfo, `tablets-vacio-${viewport.width}`);
    });

    test('error', async ({ page, isolation }, testInfo) => {
      const { api, main } = await openTablets(page, isolation, viewport, 'error');
      await expect(main.getByRole('alert')).toHaveText('No fue posible completar la acción. Revisa la conexión e intenta de nuevo.');
      await expect(page.getByText('Internal Server Error')).toHaveCount(0);
      await shoot(page, testInfo, `tablets-error-${viewport.width}`);
      const before = api.readsOf(API_PATHS.devices);
      await main.getByRole('button', { name: 'Reintentar' }).click();
      await expect.poll(() => api.readsOf(API_PATHS.devices)).toBeGreaterThan(before);
    });
  });
}
