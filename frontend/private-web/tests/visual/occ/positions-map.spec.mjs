import { AUTH_STORAGE_KEY, createOccApi, occSession } from './fixtures/occApi.mjs';
import { VIEW_LABELS, mapReady, shoot, viewInUrl, zoomOf } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// Mapa de posiciones on the one map engine, with a synthetic OCC session and a stubbed API (fixtures/occApi.mjs), in
// `next dev` and against a production build (OCC_VISUAL_TARGET=production). Lessons 4 and 7 of PR M1: the zoom
// buttons and the view presets really move the camera in both builds, and re-reading the positions keeps the same
// map instead of starting a new one. The page shows one legend, the map's, and the map draws the stands as polygons
// with the state of now (PR M4): Rampa, a terminal and Aeródromo are photographed at 1440 × 900 and 1920 × 1080.

const PAGE = '/admin-occ/positions-map';
const target = production ? 'production' : 'development';
const SIZES = Object.freeze([{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]);

async function openPositionsMap(page, isolation, query = '') {
  const api = createOccApi();
  isolation.setApi(api.handle);
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  }, [AUTH_STORAGE_KEY, occSession()]);
  const response = await page.goto(`${PAGE}${query}`);
  expect(response?.status(), `GET ${PAGE}${query}`).toBe(200);
  const container = page.getByTestId('position-map-container');
  // What the cycle E2E waits for: the positions map container and its canvas.
  await expect(container.locator('.maplibregl-canvas')).toBeVisible();
  const map = page.getByTestId('occ-map');
  await mapReady(map);
  await expect.poll(() => api.reads, { message: 'the positions board was read' }).toBeGreaterThan(0);
  return { api, map, container };
}

// Resolves once the map of the page has drawn the positions with nothing left to load, place or fade: the legend
// says the stands are on screen, and OccMap marks its root settled after the idle frame that follows its last write.
async function settled(page) {
  await expect(page.getByTestId('positions-map-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('map-legend')).toBeVisible();
  await expect(page.getByTestId('occ-map')).toHaveAttribute('data-occ-settled', 'true');
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
    // The stub board read now: every state of the vocabulary in its order, the attention signal of the two stands with a
    // flight due and nobody covering them, the link of A10 to A9 and «No oficial»; then the airfield the map draws from
    // the MDPC dataset in the ramp view (PR M3).
    await expect(map.getByRole('list', { name: 'Leyenda' }).getByRole('listitem')).toHaveText([
      'Libre', 'Planificada', 'Llegando', 'Ocupada', 'Por liberar', 'Inhabilitada', 'Sin verificar', /^Atención/, /^Enlace con/,
      /^No oficial/, 'Pista', 'Calle de rodaje', 'Punto de espera', 'Plataforma', 'Terminal',
    ]);
    await expect(page.getByText('Configuración combinada')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`Mapa de posiciones at Rampa, one terminal and Aeródromo, ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { map } = await openPositionsMap(page, isolation);
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await settled(page);
      await shoot(page, testInfo, `positions-map-ramp-${size.width}`);

      // Terminal A through the URL, as a link to it opens it.
      await page.goto(`${PAGE}?view=ramp&terminal=A`);
      await mapReady(map);
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await settled(page);
      await expect(map.getByRole('list', { name: 'Leyenda' }).getByRole('listitem')).toContainText(['Llegando', 'Por liberar', 'Inhabilitada']);
      await shoot(page, testInfo, `positions-map-terminal-a-${size.width}`);

      await map.getByRole('group', { name: 'Vista del mapa' }).getByRole('button', { name: VIEW_LABELS.airfield, exact: true }).click();
      await expect(map).toHaveAttribute('data-occ-view', 'airfield');
      await settled(page);
      await shoot(page, testInfo, `positions-map-airfield-${size.width}`);
    });
  }
});
