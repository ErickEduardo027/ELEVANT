import { API_PATHS, REVIEW_IDS, createScreensApi } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Revisión (PR U6, step b) in Chrome: template C of the design («Mesa de trabajo») with a synthetic OCC session and a
// stubbed API (fixtures/screensApi.mjs), in the two windows of the presentation. The queue sits at the left and the
// chosen hand-off is docked at the right, each scrolling on its own, with the decision bar at the bottom of the detail;
// the decision is confirmed in a dialog drawn inside the detail, whose veil still covers the whole window. Screenshots
// for review go to test-results/visual as revision-{state}-{width}.png. The stub answers no command: nothing is decided.

const PAGE = '/admin-occ/review';
const PENDING_CODE = 'PUJ-20261113-004';
// The light key of the primary action (--occ-primary). A button changes its colours through a short transition, so a
// screenshot waits until the key shows this one.
const PRIMARY_KEY = 'rgb(232, 238, 241)';

// What covers the point (x, y) of the window: the dialog's own layer, or the tag of the element drawn there.
const drawnAt = (page, x, y) => page.evaluate(([left, top]) => {
  const hit = document.elementFromPoint(left, top);
  return hit?.closest('[data-occ-dialog]') ? 'dialog' : hit?.tagName ?? null;
}, [x, y]);

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Revisión at ${viewport.width}×${viewport.height}`, () => {
    test('queue with the docked detail and the milestone strip', async ({ page, isolation }, testInfo) => {
      const api = createScreensApi('data');
      const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
      const queue = main.getByRole('region', { name: 'Entregas', exact: true });
      const table = queue.getByRole('table', { name: 'Entregas', exact: true });
      // A header row and the four hand-offs of the station.
      await expect(table.getByRole('row')).toHaveCount(5);
      await expect(main.getByRole('group', { name: 'Filtrar entregas' }).getByRole('button', { name: 'Todas 4' }))
        .toHaveAttribute('aria-pressed', 'true');
      // A hand-off sent after the local midnight of its operation date shows its day in front of the time.
      await expect(table.getByRole('row').filter({ hasText: 'PUJ-20261112-009' })).toContainText('13/11 00:05');
      // Nothing chosen yet: the docked side says what to do.
      await expect(main.getByText('Elige una entrega de la lista para ver su detalle.')).toBeVisible();
      await shoot(page, testInfo, `revision-cola-${viewport.width}`);

      // As the cycle E2E and the guide do: the first button of the hand-off's row.
      const row = table.getByRole('row').filter({ hasText: PENDING_CODE });
      await row.getByRole('button').first().click();
      const detail = main.getByRole('region', { name: 'Detalle de entrega' });
      const close = detail.getByRole('region', { name: 'Cierre de la operación' });
      await expect(close).toBeVisible();
      await expect(row).toHaveAttribute('aria-selected', 'true');
      // Docked: the detail sits at the right of the queue, from the same top, within the window, and the page itself
      // does not scroll; the decision bar is on screen without scrolling.
      const queueBox = await queue.boundingBox();
      const detailBox = await detail.boundingBox();
      expect(detailBox.x).toBeGreaterThan(queueBox.x + queueBox.width);
      expect(Math.abs(detailBox.y - queueBox.y)).toBeLessThan(1);
      expect(detailBox.y + detailBox.height).toBeLessThanOrEqual(viewport.height);
      expect(await main.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
      const approve = detail.getByRole('button', { name: 'Aprobar', exact: true });
      await expect(approve).toBeInViewport();
      await shoot(page, testInfo, `revision-detalle-${viewport.width}`);

      // The close's milestone strip, in the station's time: 14:34 UTC is 10:34 in Santo Domingo; 17 of the 25 wait.
      const strip = close.getByRole('list', { name: 'Hitos de la escala' });
      await strip.scrollIntoViewIfNeeded();
      await expect(strip.locator('[data-milestone="BLOCK_ON"]')).toContainText('10:34');
      await expect(strip.getByText('Pendiente', { exact: true })).toHaveCount(17);
      await expect(close.getByText('Paquete excedido por 4 min')).toBeVisible();
      // Scrolling the detail keeps its decision bar in place.
      await expect(approve).toBeInViewport();
      await shoot(page, testInfo, `revision-hitos-${viewport.width}`);

      // Further down: the AVIAM forms with who signed them, and the hand-offs of the operation.
      const forms = detail.getByRole('region', { name: 'Formularios AVIAM' });
      await forms.scrollIntoViewIfNeeded();
      await expect(forms.getByText('Firmar de nuevo')).toBeVisible();
      await expect(detail.getByRole('region', { name: 'Historial de entregas' })
        .getByRole('button', { name: /Revisión 1/ })).toBeVisible();
      await expect(approve).toBeInViewport();
      await shoot(page, testInfo, `revision-formularios-${viewport.width}`);
      // Choosing and reading the hand-off read the queue once.
      expect(api.readsOf(API_PATHS.reviewQueue)).toBe(1);
    });

    test('decision dialog open', async ({ page, isolation }, testInfo) => {
      const api = createScreensApi('data');
      const main = await openOccScreen(page, isolation, { path: `${PAGE}?operationId=${REVIEW_IDS.pending}`, api, viewport });
      const detail = main.getByRole('region', { name: 'Detalle de entrega' });
      await expect(detail.getByRole('region', { name: 'Cierre de la operación' })).toBeVisible();
      await detail.getByRole('button', { name: 'Aprobar', exact: true }).click();
      const dialog = detail.getByRole('dialog', { name: 'Confirmar decisión' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('¿Confirmas la aprobación de esta entrega?')).toBeVisible();
      const confirm = detail.getByRole('button', { name: 'Confirmar decisión' });
      await expect(confirm).toBeEnabled();
      await expect(confirm).toHaveCSS('background-color', PRIMARY_KEY);
      // Drawn inside the detail, the dialog is not held under the frame: its veil covers the status bar and the
      // queue's table header, which sit above the page.
      const header = await main.getByRole('region', { name: 'Entregas', exact: true }).getByRole('columnheader').first().boundingBox();
      expect(await drawnAt(page, Math.round(viewport.width / 2), 24)).toBe('dialog');
      expect(await drawnAt(page, Math.round(header.x + 4), Math.round(header.y + header.height / 2))).toBe('dialog');
      await shoot(page, testInfo, `revision-decision-${viewport.width}`);
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog).toHaveCount(0);

      await detail.getByRole('button', { name: 'Devolver con correcciones' }).click();
      const returning = detail.getByRole('dialog', { name: 'Confirmar decisión' });
      const correction = returning.getByRole('textbox', { name: /Correcciones necesarias/ });
      await expect(correction).toBeFocused();
      // Disabled until the correction has 8 characters; then the light key.
      const confirmReturn = returning.getByRole('button', { name: 'Confirmar decisión' });
      await expect(confirmReturn).toBeDisabled();
      await correction.fill('Falta la foto de la puerta de carga trasera.');
      await expect(confirmReturn).toBeEnabled();
      await expect(confirmReturn).toHaveCSS('background-color', PRIMARY_KEY);
      await shoot(page, testInfo, `revision-devolver-${viewport.width}`);
      await page.keyboard.press('Escape');
      await expect(returning).toHaveCount(0);
      // Nothing was decided: no command reached the OCC's API (the frame's own presence and hubs are not the review's).
      const commands = isolation.requests.filter(entry => entry.kind === 'api' && entry.method !== 'GET'
        && new URL(entry.url).pathname.startsWith('/api/v1/occ/'));
      expect(commands).toEqual([]);
    });

    test('empty queue', async ({ page, isolation }, testInfo) => {
      const main = await openOccScreen(page, isolation, { path: PAGE, api: createScreensApi('empty'), viewport });
      const queue = main.getByRole('region', { name: 'Entregas', exact: true });
      await expect(queue.getByText('No hay entregas para revisar en esta estación.')).toBeVisible();
      await expect(main.getByRole('group', { name: 'Filtrar entregas' }).getByRole('button', { name: 'Todas 0' }))
        .toBeVisible();
      // Nothing to choose: no placeholder for a detail.
      await expect(main.getByText('Elige una entrega de la lista para ver su detalle.')).toHaveCount(0);
      await shoot(page, testInfo, `revision-vacia-${viewport.width}`);
    });

    test('queue error', async ({ page, isolation }, testInfo) => {
      const api = createScreensApi('error');
      const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
      const queue = main.getByRole('region', { name: 'Entregas', exact: true });
      await expect(queue.getByRole('alert')).toHaveText('No se pudo cargar la cola de revisión.');
      // The server's title never reaches the screen, and no figure is drawn for a queue that did not load.
      await expect(main.getByText('Internal Server Error')).toHaveCount(0);
      await expect(main.getByText('Pendientes visibles')).toHaveCount(0);
      await shoot(page, testInfo, `revision-error-${viewport.width}`);
      await queue.getByRole('button', { name: 'Reintentar' }).click();
      await expect.poll(() => api.readsOf(API_PATHS.reviewQueue)).toBe(2);
      await expect(queue.getByRole('alert')).toHaveText('No se pudo cargar la cola de revisión.');
    });
  });
}
