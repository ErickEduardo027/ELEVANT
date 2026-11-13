import { AUTH_STORAGE_KEY, createOccApi, occSession } from './fixtures/occApi.mjs';
import { VIEW_LABELS, mapReady, shoot, viewInUrl, zoomOf } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// Mapa de posiciones on the one map engine, with a synthetic OCC session and a stubbed API (fixtures/occApi.mjs), in
// `next dev` and against a production build (OCC_VISUAL_TARGET=production). Lessons 4 and 7 of PR M1: the zoom
// buttons and the view presets really move the camera in both builds, and re-reading the positions keeps the same
// map instead of starting a new one. The page shows one legend, the map's.

const PAGE = '/admin-occ/positions-map';
const target = production ? 'production' : 'development';

async function openPositionsMap(page, isolation) {
  const api = createOccApi();
  isolation.setApi(api.handle);
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  }, [AUTH_STORAGE_KEY, occSession()]);
  const response = await page.goto(PAGE);
  expect(response?.status(), `GET ${PAGE}`).toBe(200);
  const container = page.getByTestId('position-map-container');
  // What the cycle E2E waits for: the positions map container and its canvas.
  await expect(container.locator('.maplibregl-canvas')).toBeVisible();
  const map = page.getByTestId('occ-map');
  await mapReady(map);
  await expect.poll(() => api.reads, { message: 'the positions board was read' }).toBeGreaterThan(0);
  return { api, map, container };
}

test.describe('Mapa de posiciones on the map engine', () => {
  test.describe('without reduced motion', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('the zoom buttons and a view preset move the camera', async ({ page, isolation }, testInfo) => {
      const { map } = await openPositionsMap(page, isolation);
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await expect(map).toHaveAttribute('data-occ-basemap', 'ok');
      await shoot(page, testInfo, `positions-map-${target}`);

      const zoomIn = map.getByRole('button', { name: 'Acercar' });
      const zoomOut = map.getByRole('button', { name: 'Alejar' });
      const start = await zoomOf(map);
      await zoomIn.click();
      await expect.poll(() => zoomOf(map)).toBeGreaterThan(start + 0.9);
      await zoomOut.click();
      await expect.poll(() => zoomOf(map)).toBeLessThan(start + 0.1);

      const switcher = map.getByRole('group', { name: 'Vista del mapa' });
      const before = await zoomOf(map);
      await switcher.getByRole('button', { name: VIEW_LABELS.airfield, exact: true }).click();
      await expect(map).toHaveAttribute('data-occ-view', 'airfield');
      await expect.poll(() => viewInUrl(page)).toBe('airfield');
      await expect.poll(() => zoomOf(map)).toBeLessThan(before - 1);
      await switcher.getByRole('button', { name: VIEW_LABELS.ramp, exact: true }).click();
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await expect.poll(() => zoomOf(map)).toBeCloseTo(before, 1);
    });
  });

  test('a positions refresh keeps the same map: same canvas, one TileJSON request', async ({ page, isolation }) => {
    const { api, container } = await openPositionsMap(page, isolation);
    const canvas = await container.locator('canvas.maplibregl-canvas').elementHandle();
    expect(isolation.count('tilejson')).toBe(1);

    // The page re-reads the board when its window gets the focus back (as on its poll and on occ_planning).
    for (let read = 1; read <= 2; read += 1) {
      const reads = api.reads;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(() => api.reads).toBeGreaterThan(reads);
    }
    await expect(page.getByTestId('positions-map-skeleton')).toHaveCount(0);
    expect(await canvas.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
    await expect(page.locator('.occ-map-engine')).toHaveCount(1);
    expect(isolation.count('tilejson')).toBe(1);
  });

  test('the map\'s legend is the only one in the screen and lists the states on screen', async ({ page, isolation }) => {
    const { map } = await openPositionsMap(page, isolation);
    // One «Leyenda» in the screen, the map's: the page no longer adds its own squares in colours the map does not draw.
    // The status bar keeps the frame's own «Leyenda» (PR U2), reachable from every screen, outside the content.
    await expect(page.locator('#main-content').getByRole('button', { name: 'Leyenda', exact: true })).toHaveCount(1);
    await expect(page.getByRole('banner').getByRole('button', { name: 'Leyenda', exact: true })).toHaveCount(1);
    await expect(map.getByRole('button', { name: 'Leyenda', exact: true })).toBeVisible();
    // The stub board at its reference locations: every state it has, in the order of the vocabulary, and «No oficial»;
    // then the airfield the map draws from the MDPC dataset in the ramp view (PR M3).
    await expect(map.getByRole('list', { name: 'Leyenda' }).getByRole('listitem')).toHaveText([
      'Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar', /^No oficial/,
      'Pista', 'Calle de rodaje', 'Punto de espera', 'Plataforma', 'Terminal',
    ]);
    await expect(page.getByText('Configuración combinada')).toHaveCount(0);
  });
});
