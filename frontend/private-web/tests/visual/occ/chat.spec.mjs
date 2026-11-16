import { API_PATHS, CHAT_IDS, createScreensApi } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, occRgb, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// The operational chat (PR U6, step d) in Chrome: template C of the design («Mesa de trabajo») with a synthetic OCC
// session and a stubbed API (fixtures/screensApi.mjs), in the two windows of the presentation and on a narrow screen.
// The conversations and the open thread sit side by side from 1280 px, each scrolling on its own; below that the
// thread replaces the list. Presence is drawn by shape, with its legend on the list's head (design D28). Screenshots
// for review go to test-results/visual as chat-{state}-{width}.png. The stub answers no command: nothing is sent.

const PAGE = '/admin-occ/chat';
const NARROW = Object.freeze({ width: 1024, height: 768 });
// The tokens the selection and the primary key paint (src/styles/occ.css): cyan, its soft slab and the light key. A
// control changes its colours through a short transition, so a check waits until it shows them.
const ACCENT = occRgb('--occ-accent');
const ACCENT_SOFT = occRgb('--occ-accent-soft');
const PRIMARY_KEY = occRgb('--occ-primary');
const OPEN_CODE = 'PUJ-20261113-004';

async function openChat(page, isolation, viewport, { scenario = 'data', operationId } = {}) {
  const api = createScreensApi(scenario);
  const path = operationId ? `${PAGE}?operationId=${operationId}` : PAGE;
  const main = await openOccScreen(page, isolation, { path, api, viewport });
  await expect(main.getByRole('heading', { level: 1, name: 'Chat operativo' })).toBeVisible();
  return {
    api, main,
    list: main.getByRole('region', { name: 'Conversaciones', exact: true }),
    thread: main.getByRole('region', { name: 'Mensajes', exact: true }),
  };
}

// The messages sent: the stub refuses every command, and a spec never sends one.
const sentMessages = isolation => isolation.requests.filter(entry => entry.kind === 'api' && entry.method === 'POST'
  && new URL(entry.url).pathname.startsWith(API_PATHS.conversations));

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Chat at ${viewport.width}×${viewport.height}`, () => {
    test('conversations with the open thread', async ({ page, isolation }, testInfo) => {
      const { main, list, thread } = await openChat(page, isolation, viewport, { operationId: CHAT_IDS.open });
      const conversations = list.getByRole('button', { name: /PUJ-20261113-/ });
      await expect(conversations).toHaveCount(4);
      // The open conversation is the selection: the soft cyan slab with a cyan joint. The unread count sits on a
      // neutral plate, with its spoken count.
      const open = list.getByRole('button', { name: new RegExp(OPEN_CODE) });
      await expect(open).toHaveAttribute('aria-current', 'true');
      await expect(open).toHaveCSS('background-color', ACCENT_SOFT);
      await expect(open).toHaveCSS('border-top-color', ACCENT);
      await expect(list.getByLabel('3 mensajes sin leer', { exact: true })).toHaveText('3');
      // The legend of the presence shapes on the list's head, and every shape in the list or the thread.
      const legend = list.getByRole('list', { name: 'Presencia' });
      await expect(legend.getByRole('listitem')).toHaveText(['Disponible', 'Ocupado o no molestar',
        'Ausente o vuelvo enseguida', 'Desconectado', 'Sin información']);
      for (const shape of ['filled', 'half', 'hollow', 'dashed']) {
        await expect(list.locator(`[data-presence][data-shape="${shape}"]`).first()).toBeVisible();
      }
      await expect(thread.locator('[data-shape="filled-bar"]').first()).toBeVisible();

      // The thread: its operation on a plate, its participants, the agent's messages at the start and one's own at the
      // end, with their receipts.
      await expect(thread.locator('[data-occ-plate]')).toHaveText(OPEN_CODE);
      await expect(thread.getByRole('link', { name: 'Ver operación' }))
        .toHaveAttribute('href', `/admin-occ/review?operationId=${CHAT_IDS.open}`);
      await expect(thread.getByText('Agente de prueba Uno', { exact: true }).first()).toBeVisible();
      const log = thread.getByRole('log', { name: 'Mensajes' });
      await expect(log.locator('article')).toHaveCount(7);
      await expect(log.locator('[data-receipt]')).toHaveText(['✓✓ Visto', '✓✓ Visto', '✓ Enviado']);
      // 14:30 UTC is 10:30 in Santo Domingo.
      await expect(log.locator('article').first().locator('time')).toHaveText('13/11 10:30');
      const logBox = await log.boundingBox();
      const ownBox = await log.locator('article[data-own="true"]').last().boundingBox();
      const otherBox = await log.locator('article[data-own="false"]').first().boundingBox();
      expect(ownBox.x + ownBox.width).toBeGreaterThan(logBox.x + logBox.width - 24);
      expect(otherBox.x).toBeLessThan(logBox.x + 24);

      // From 1280 px the list and the thread sit side by side, from the same top, and the page itself does not scroll.
      const listBox = await list.boundingBox();
      const threadBox = await thread.boundingBox();
      expect(threadBox.x).toBeGreaterThan(listBox.x + listBox.width);
      expect(Math.abs(threadBox.y - listBox.y)).toBeLessThan(1);
      expect(threadBox.y + threadBox.height).toBeLessThanOrEqual(viewport.height);
      expect(await main.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);

      // The composer at the foot of the thread, with the light key once there is something to send.
      const composer = thread.getByLabel('Mensaje', { exact: true });
      const send = thread.getByRole('button', { name: 'Enviar mensaje' });
      await expect(composer).toBeInViewport();
      await expect(send).toBeDisabled();
      await composer.fill('Confirmo la salida a las 11:40.');
      await expect(send).toBeEnabled();
      await expect(send).toHaveCSS('background-color', PRIMARY_KEY);
      await shoot(page, testInfo, `chat-hilo-${viewport.width}`);

      // The own status, in the toolbar: automatic until a status is chosen.
      const status = main.getByRole('toolbar', { name: 'Chat operativo' }).getByRole('button', { name: 'Mi estado: Disponible' });
      await expect(status).toBeEnabled();
      await status.click();
      const menu = page.getByRole('dialog', { name: 'Mi estado' });
      await expect(menu.getByRole('radio')).toHaveText(['Disponible', 'Ocupado', 'No molestar', 'Vuelvo enseguida', 'Ausente',
        'Mostrar como desconectado']);
      await shoot(page, testInfo, `chat-estado-propio-${viewport.width}`);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      expect(sentMessages(isolation)).toEqual([]);
    });

    test('empty', async ({ page, isolation }, testInfo) => {
      const { list, thread } = await openChat(page, isolation, viewport, { scenario: 'empty' });
      await expect(list.getByText('No tienes operaciones con conversación disponible en esta estación.')).toBeVisible();
      await expect(list.getByRole('list', { name: 'Presencia' })).toBeVisible();
      await expect(thread.getByText('Selecciona una operación para ver sus mensajes.')).toBeVisible();
      await shoot(page, testInfo, `chat-vacio-${viewport.width}`);
    });

    test('error', async ({ page, isolation }, testInfo) => {
      const { api, list } = await openChat(page, isolation, viewport, { scenario: 'error' });
      await expect(list.getByRole('alert')).toHaveText('No fue posible cargar las conversaciones.');
      // The server's title never reaches the screen.
      await expect(page.getByText('Internal Server Error')).toHaveCount(0);
      await shoot(page, testInfo, `chat-error-${viewport.width}`);
      const before = api.readsOf(API_PATHS.conversations);
      await list.getByRole('button', { name: 'Reintentar' }).click();
      await expect.poll(() => api.readsOf(API_PATHS.conversations)).toBeGreaterThan(before);
      await expect(list.getByRole('alert')).toHaveText('No fue posible cargar las conversaciones.');
    });
  });
}

test.describe(`Chat at ${NARROW.width}×${NARROW.height}`, () => {
  test('the thread on a narrow width replaces the list, and «Volver» brings it back', async ({ page, isolation }, testInfo) => {
    const { main, list, thread } = await openChat(page, isolation, NARROW);
    // Nothing open: the list alone, with its legend.
    await expect(list).toBeVisible();
    await expect(thread).toBeHidden();
    await shoot(page, testInfo, `chat-lista-${NARROW.width}`);

    await list.getByRole('button', { name: new RegExp(OPEN_CODE) }).click();
    await expect(page).toHaveURL(new RegExp(`operationId=${CHAT_IDS.open}`));
    await expect(thread).toBeVisible();
    await expect(list).toBeHidden();
    const back = main.getByRole('button', { name: 'Volver a las conversaciones' });
    await expect(back).toBeVisible();
    await expect(thread.getByLabel('Mensaje', { exact: true })).toBeInViewport();
    await shoot(page, testInfo, `chat-hilo-estrecho-${NARROW.width}`);

    await back.click();
    await expect(list).toBeVisible();
    await expect(thread).toBeHidden();
    expect(sentMessages(isolation)).toEqual([]);
  });
});
