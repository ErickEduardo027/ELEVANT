import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { ARRIVAL_ON_FINAL_KEY, createConsoleApi, iemCurrents } from './fixtures/consoleApi.mjs';
import { createMonitoringApi } from './fixtures/monitoringApi.mjs';
import { AUTH_STORAGE_KEY, createOccApi, occSession } from './fixtures/occApi.mjs';
import { openOccScreen } from './occScreen.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// CN-32 «Monitoreo OCC más profesional»: the three OCC monitoring screens photographed at the laptop of the audit
// (1366 × 768, first), the presentation laptop (1440 × 900) and the 1080p screen, with the synthetic OCC session and the
// stubbed APIs of the other specs. Each shot is for review (no baseline is committed): Panorama on opening, with a flight
// chosen and with the map's legend open; Monitoreo de vuelos with a flight chosen; Mapa de posiciones with a stand chosen.

const SIZES = Object.freeze([
  Object.freeze({ width: 1366, height: 768 }),
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 1920, height: 1080 }),
]);
const IEM = 'https://mesonet.agron.iastate.edu/**';
const prefix = process.env.OCC_SHOT_PREFIX ?? 'cn32';

const settled = map => expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });

async function openConsole(page, isolation) {
  const api = createConsoleApi();
  isolation.setApi(api.handle);
  await page.route(IEM, route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'cache-control': 'no-store' },
    body: JSON.stringify(iemCurrents()),
  }));
  await page.addInitScript(([authKey, bootSeenKey, session]) => {
    window.localStorage.setItem(authKey, JSON.stringify(session));
    window.sessionStorage.setItem(bootSeenKey, String(session.accountId));
  }, [AUTH_STORAGE_KEY, OCC_BOOT_SEEN_KEY, occSession()]);
  const response = await page.goto('/admin-occ/dashboard');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-occ-console]')).toBeVisible();
  const map = page.getByTestId('occ-map');
  await expect(page.getByTestId('occ-console-provenance')).toContainText('Aviones: Red ADS-B de prueba');
  await mapReady(map);
  await settled(map);
  return { api, map };
}

test.describe('CN-32: the OCC monitoring screens', () => {
  for (const size of SIZES) {
    test(`Panorama at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { map } = await openConsole(page, isolation);
      await shoot(page, testInfo, `${prefix}-panorama-inicio-${size.width}`);

      const strip = page.getByRole('button', { name: /ZZ161/ }).first();
      await strip.click();
      await expect.poll(() => new URL(page.url()).searchParams.get('flightId')).toBe(ARRIVAL_ON_FINAL_KEY);
      await settled(map);
      await shoot(page, testInfo, `${prefix}-panorama-vuelo-${size.width}`);

      const legend = map.getByRole('button', { name: 'Leyenda', exact: true });
      if ((await legend.getAttribute('aria-expanded')) !== 'true') await legend.click();
      await settled(map);
      await shoot(page, testInfo, `${prefix}-panorama-leyenda-${size.width}`);
    });

    test(`Monitoreo de vuelos at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      const api = createMonitoringApi();
      await openOccScreen(page, isolation, { path: '/admin-occ/flight-monitoring', api, viewport: size });
      const board = page.getByRole('region', { name: 'Tablero de vuelos' });
      await expect(board).toBeVisible();
      const map = page.getByTestId('occ-map');
      await mapReady(map);
      await expect.poll(() => api.mapReads.flights).toBeGreaterThan(0);
      await settled(map);
      await shoot(page, testInfo, `${prefix}-monitoreo-inicio-${size.width}`);
      await board.getByTestId('flight-list-item').filter({ hasText: 'ZZ9001' }).first().click();
      await expect(page.getByRole('complementary', { name: /^Detalle del vuelo ZZ9001/ })).toBeVisible();
      await settled(map);
      await shoot(page, testInfo, `${prefix}-monitoreo-vuelo-${size.width}`);
    });

    test(`Mapa de posiciones at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      const api = createOccApi();
      await openOccScreen(page, isolation, { path: '/admin-occ/positions-map', api, viewport: size });
      const map = page.getByTestId('occ-map');
      await mapReady(map);
      await expect(page.getByTestId('positions-map-skeleton')).toHaveCount(0);
      await settled(map);
      await shoot(page, testInfo, `${prefix}-posiciones-inicio-${size.width}`);
      await page.goto('/admin-occ/positions-map?stand=A3');
      await mapReady(map);
      await expect(page.getByTestId('position-detail-drawer')).toBeVisible();
      await settled(map);
      await shoot(page, testInfo, `${prefix}-posiciones-posicion-${size.width}`);
    });
  }
});
