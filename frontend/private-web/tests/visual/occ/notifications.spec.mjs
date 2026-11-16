import { API_PATHS, createScreensApi, operationalNotices } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Notificaciones (PR U6, step c) in Chrome: the notice history of the account, template C of the design, with a
// synthetic OCC session and a stubbed API whose notices follow the scenario (fixtures/screensApi.mjs, `notices: true`:
// the page and the frame read the same list), in the two windows of the presentation. Each notice has its priority
// glyph and word; an unread alert keeps the slab and the bar of its signal. Screenshots for review go to
// test-results/visual as notificaciones-{state}-{width}.png. Nothing is marked read.

const PAGE = '/admin-occ/notifications';
const { notifications } = operationalNotices();

async function openNotices(page, isolation, viewport, scenario = 'data') {
  const api = createScreensApi(scenario, { notices: true });
  const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  await expect(main.getByRole('heading', { level: 1, name: 'Notificaciones operativas' })).toBeVisible();
  const history = main.getByRole('region', { name: 'Historial de avisos' });
  return { api, main, history };
}

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Notificaciones at ${viewport.width}×${viewport.height}`, () => {
    test('the three priorities', async ({ page, isolation }, testInfo) => {
      const { api, history } = await openNotices(page, isolation, viewport);
      const list = history.getByRole('list', { name: 'Avisos' });
      await expect(list.getByRole('listitem')).toHaveCount(notifications.length);
      await expect(history.getByRole('status')).toHaveText('4 sin leer de 8 visibles');
      // The legend of the board's header, and one glyph with its word on every notice.
      const legend = history.getByRole('list', { name: 'Prioridad' });
      await expect(legend.getByRole('listitem')).toHaveText(['Urgente', 'Atención', 'Aviso']);
      await expect(list.getByRole('img', { name: 'Urgente' })).toHaveCount(2);
      await expect(list.getByRole('img', { name: 'Atención' })).toHaveCount(3);
      await expect(list.getByRole('img', { name: 'Aviso' })).toHaveCount(3);
      // Only the unread alerts are lit: the incident, the cancelled flight and the contract out of force.
      await expect(list.locator('[data-occ-tone="urgent"]')).toHaveCount(1);
      await expect(list.locator('[data-occ-tone="attention"]')).toHaveCount(2);
      const incident = list.getByRole('listitem').filter({ hasText: 'PUJ-20261113-004' }).first();
      await expect(incident).toContainText('Incidencia reportada en rampa');
      await expect(incident).toContainText('Sin leer');
      await expect(incident.getByRole('link', { name: 'Abrir' })).toBeVisible();
      await expect(incident.getByRole('button', { name: 'Marcar leída' })).toBeVisible();
      // 15:20 UTC is 11:20 in Santo Domingo.
      await expect(incident.locator('time')).toHaveText('13/11 11:20');
      await expect(history.getByRole('group', { name: 'Filtrar avisos' }).getByRole('button', { name: 'Todo 8' }))
        .toHaveAttribute('aria-pressed', 'true');
      await shoot(page, testInfo, `notificaciones-prioridades-${viewport.width}`);
      // The frame counts the same unread alerts in its status bar.
      await expect(page.getByRole('button', { name: '3 alertas' })).toBeVisible();
      // No receipt was written.
      const commands = isolation.requests.filter(entry => entry.kind === 'api' && entry.method !== 'GET'
        && new URL(entry.url).pathname.startsWith(API_PATHS.notices));
      expect(commands).toEqual([]);
      expect(api.readsOf(API_PATHS.notices)).toBeGreaterThanOrEqual(1);
    });

    test('filter «Alertas»', async ({ page, isolation }, testInfo) => {
      const { history } = await openNotices(page, isolation, viewport);
      const filters = history.getByRole('group', { name: 'Filtrar avisos' });
      const list = history.getByRole('list', { name: 'Avisos' });
      await expect(list.getByRole('listitem')).toHaveCount(notifications.length);
      await filters.getByRole('button', { name: 'Alertas 5' }).click();
      await expect(filters.getByRole('button', { name: 'Alertas 5' })).toHaveAttribute('aria-pressed', 'true');
      await expect(list.getByRole('listitem')).toHaveCount(5);
      await expect(list.getByRole('img', { name: 'Aviso' })).toHaveCount(0);
      await shoot(page, testInfo, `notificaciones-alertas-${viewport.width}`);
      await filters.getByRole('button', { name: 'Sin leer 4' }).click();
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await shoot(page, testInfo, `notificaciones-sin-leer-${viewport.width}`);
    });

    test('empty', async ({ page, isolation }, testInfo) => {
      const { history } = await openNotices(page, isolation, viewport, 'empty');
      await expect(history.getByText('Aún no hay notificaciones para tu cuenta. Los nuevos eventos aparecerán aquí.'))
        .toBeVisible();
      await expect(history.getByRole('status')).toHaveText('0 sin leer de 0 visibles');
      await expect(history.getByRole('group', { name: 'Filtrar avisos' }).getByRole('button', { name: 'Todo 0' }))
        .toBeVisible();
      await shoot(page, testInfo, `notificaciones-vacia-${viewport.width}`);
    });

    test('error', async ({ page, isolation }, testInfo) => {
      const { api, history } = await openNotices(page, isolation, viewport, 'error');
      await expect(history.getByRole('alert')).toHaveText('No fue posible cargar las notificaciones.');
      // The server's title never reaches the screen, and there is nothing to filter.
      await expect(page.getByText('Internal Server Error')).toHaveCount(0);
      await expect(history.getByRole('group', { name: 'Filtrar avisos' })).toHaveCount(0);
      await shoot(page, testInfo, `notificaciones-error-${viewport.width}`);
      const before = api.readsOf(API_PATHS.notices);
      await history.getByRole('button', { name: 'Reintentar' }).click();
      await expect.poll(() => api.readsOf(API_PATHS.notices)).toBeGreaterThan(before);
      await expect(history.getByRole('alert')).toHaveText('No fue posible cargar las notificaciones.');
    });
  });
}
