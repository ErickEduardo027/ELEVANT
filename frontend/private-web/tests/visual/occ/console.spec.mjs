import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { ARRIVAL_ON_FINAL_KEY, DEMO_FLIGHT_KEYS, createConsoleApi, iemCurrents } from './fixtures/consoleApi.mjs';
import { AUTH_STORAGE_KEY, occSession } from './fixtures/occApi.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Panorama, the OCC console (PR U3, contratos 2.5): the full-bleed map with its floating panels, on the one map engine,
// with a synthetic OCC session and a stubbed API (fixtures/consoleApi.mjs: one coherent day at Punta Cana) and today's
// METAR of IEM answered by a route of this spec. Photographed for review at 1920 × 1080 and 1440 × 900, the laptop the
// console is presented on (owner decision 11): the panels open and folded, a flight and a stand selected, the fallback
// without a map engine, and the pill of a new demo arrival. Each test opens the console as a later OCC entry of its tab,
// so the OCC boot screen (PR U4) never covers it.

const PAGE = '/admin-occ/dashboard';
const SIZES = Object.freeze([{ width: 1920, height: 1080 }, { width: 1440, height: 900 }]);
const IEM = 'https://mesonet.agron.iastate.edu/**';
const PANELS = Object.freeze(['Tablero', 'Alertas', 'Cifras de la jornada', 'Posiciones']);

const panel = (page, name) => page.getByRole('region', { name, exact: true });
const foldButton = (page, name) => panel(page, name).getByRole('button', { name, exact: true });

async function openConsole(page, isolation, query = '') {
  const api = createConsoleApi();
  isolation.setApi(api.handle);
  // Today's METAR, without leaving the machine: registered after the isolation, this route answers first.
  await page.route(IEM, route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'cache-control': 'no-store' },
    body: JSON.stringify(iemCurrents()),
  }));
  // The tab already showed the boot screen to this account, as when Panorama is opened from another module.
  await page.addInitScript(([authKey, bootSeenKey, session]) => {
    window.localStorage.setItem(authKey, JSON.stringify(session));
    window.sessionStorage.setItem(bootSeenKey, String(session.accountId));
  }, [AUTH_STORAGE_KEY, OCC_BOOT_SEEN_KEY, occSession()]);
  const response = await page.goto(`${PAGE}${query}`);
  expect(response?.status(), `GET ${PAGE}${query}`).toBe(200);
  const root = page.locator('[data-occ-console]');
  await expect(root).toBeVisible();
  return { api, root, map: page.getByTestId('occ-map') };
}

// The console with its data on screen and its map still: the board answered, the band and the map drew everything.
async function settled(page, map) {
  await expect(panel(page, 'Tablero').getByRole('tablist', { name: 'Vista del tablero' })).toBeVisible();
  await expect(page.getByTestId('occ-console-provenance')).toContainText('Aviones: Red ADS-B de prueba');
  await mapReady(map);
  await expect(map).toHaveAttribute('data-occ-settled', 'true');
}

async function setOpen(page, name, open) {
  const button = foldButton(page, name);
  if ((await button.getAttribute('aria-expanded')) !== String(open)) await button.click();
  await expect(button).toHaveAttribute('aria-expanded', String(open));
}

test.describe('the OCC console on the map engine', () => {
  for (const size of SIZES) {
    test(`panels open and folded at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { root, map } = await openConsole(page, isolation);
      await expect(root).toHaveAttribute('data-occ-console', 'map');
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await settled(page, map);
      // Below 1600 px the figures open folded; the band always does.
      await expect(panel(page, 'Cifras de la jornada')).toHaveAttribute('data-folded', size.width < 1600 ? 'true' : 'false');
      await expect(panel(page, 'Posiciones')).toHaveAttribute('data-folded', 'true');
      await shoot(page, testInfo, `u3-consola-inicio-${size.width}`);

      for (const name of PANELS) await setOpen(page, name, false);
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      // Folded, the map's insets are the pills alone: nothing is taken from the left or the right.
      await expect.poll(() => map.evaluate(node => node.style.getPropertyValue('--occ-map-inset-left'))).toBe('0px');
      await shoot(page, testInfo, `u3-consola-plegada-${size.width}`);

      for (const name of PANELS) await setOpen(page, name, true);
      await expect(panel(page, 'Posiciones').getByRole('group', { name: 'Posiciones en el tiempo' })).toBeVisible();
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await expect.poll(async () => Number.parseFloat(await map.evaluate(node =>
        node.style.getPropertyValue('--occ-map-inset-left')))).toBeGreaterThan(300);
      await shoot(page, testInfo, `u3-consola-abierta-${size.width}`);
    });

    test(`a flight and a stand selected at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { map } = await openConsole(page, isolation);
      await settled(page, map);
      // A strip of the board selects its flight and brings its aircraft, on final, into the area the panels leave.
      const strip = panel(page, 'Tablero').getByRole('button', { name: /ZZ161/ });
      await strip.click();
      await expect.poll(() => new URL(page.url()).searchParams.get('flightId')).toBe(ARRIVAL_ON_FINAL_KEY);
      await expect(strip).toHaveAttribute('aria-pressed', 'true');
      const inspector = panel(page, 'Inspector');
      await expect(inspector.getByRole('dialog', { name: 'Vuelo ZZ161' })).toBeVisible();
      await expect(inspector.getByRole('list', { name: 'Hitos de la escala' })).toBeVisible();
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await shoot(page, testInfo, `u3-consola-vuelo-${size.width}`);

      // The stand of the band: a click on its bar selects it on the map, with its facts in the inspector.
      await setOpen(page, 'Posiciones', true);
      await panel(page, 'Posiciones').getByRole('button', { name: /ZZ300 a ZZ301/ }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('A2');
      await expect(inspector.getByTestId('stand-detail-facts')).toBeVisible();
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await shoot(page, testInfo, `u3-consola-posicion-${size.width}`);
    });

    test(`the fallback without a map engine at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      // A browser without WebGL: the canvas refuses every WebGL context.
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
          return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
        };
      });
      const { root } = await openConsole(page, isolation);
      await expect(root).toHaveAttribute('data-occ-console', 'grid');
      await expect(page.getByTestId('map-unavailable').getByRole('heading', { name: 'El mapa no está disponible' }))
        .toBeVisible();
      for (const name of PANELS) await expect(panel(page, name)).toHaveAttribute('data-layout', 'grid');
      await expect(panel(page, 'Tablero').getByRole('tablist', { name: 'Vista del tablero' })).toBeVisible();
      await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
      await shoot(page, testInfo, `u3-consola-sin-motor-${size.width}`);
    });
  }

  test.describe('without reduced motion', () => {
    test.use({ reducedMotion: 'no-preference', viewport: { width: 1920, height: 1080 } });

    test('a new demo arrival: «Llegada nueva» with «Ver y seguir», and «Recibido»', async ({ page, isolation }, testInfo) => {
      const { api, map } = await openConsole(page, isolation);
      await settled(page, map);
      // «Recibido» is the account's read receipt: the PUT, and the alert leaves the panel.
      const alerts = panel(page, 'Alertas');
      await alerts.getByRole('button', { name: 'Recibido' }).click();
      await expect.poll(() => api.acknowledged.length).toBe(1);

      // The superadministrator fires the demo flight; the tab hears occ_planning when it reconciles (its focus).
      api.triggerDemo();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const pill = page.getByText('Llegada nueva: ZZ9001');
      await expect(pill).toBeVisible({ timeout: 30_000 });
      const board = panel(page, 'Tablero');
      await expect(board).toContainText('ZZ9001');
      await expect(board).toContainText('Llegada sin posición asignada');
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await shoot(page, testInfo, 'u3-consola-llegada-nueva-1920');

      await page.getByRole('button', { name: 'Ver y seguir' }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('flightId')).toBe(DEMO_FLIGHT_KEYS.arrival);
      expect(new URL(page.url()).searchParams.get('follow')).toBe('1');
      await expect(map).toHaveAttribute('data-occ-view', 'approach');
      await expect(page.getByTestId('occ-console-provenance')).toContainText('Incluye un vuelo demo.');
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await shoot(page, testInfo, 'u3-consola-ver-y-seguir-1920');
    });
  });
});
