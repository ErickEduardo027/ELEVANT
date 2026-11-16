import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { AUTH_STORAGE_KEY, arrivalKeyOf, createOccApi, occSession } from './fixtures/occApi.mjs';
import { VIEW_LABELS, mapReady, shoot, viewInUrl, zoomOf } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// Mapa de posiciones on the one map engine, with a synthetic OCC session and a stubbed API (fixtures/occApi.mjs), in
// `next dev` and against a production build (OCC_VISUAL_TARGET=production). Lessons 4 and 7 of PR M1: the zoom
// buttons and the view presets really move the camera in both builds, and re-reading the positions keeps the same
// map instead of starting a new one. The page shows one legend, the map's, and the map draws the stands as polygons
// with the state of now (PR M4): Rampa, a terminal and Aeródromo are photographed at 1440 × 900 and 1920 × 1080. Each
// test opens it as a later OCC entry of its tab, so the OCC boot screen (PR U4, boot-screen.spec.mjs) never covers the
// map.
//
// Inside the OCC frame the stands read the map flights and the aircraft of the stub too (PR M6): the demo flight that
// taxis to A3, ZZ111 holding short of B24, ZZ102 standing on A6 with nobody having recorded its arrival, and another
// aircraft standing on B28. Rampa then shows the aircraft, the stands' aircraft to scale and the notice of A6; up close
// on terminal A, past the three-line threshold, the progress bars of the turnarounds; and a flight chosen through the
// URL (`flightId=`) shows its data block next to the page's map controls.

const PAGE = '/admin-occ/positions-map';
const target = production ? 'production' : 'development';
const SIZES = Object.freeze([{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]);
// The airfield items of the MDPC dataset the ramp view draws (PR M3), after a rule across the legend.
const AIRFIELD = Object.freeze(['Pista', 'Calle de rodaje', 'Punto de espera', 'Plataforma', 'Terminal']);
// The legend's entries for the stands and the airfield: the traffic's (PR M5) come first and are listed apart.
const standEntries = map => map.getByRole('list', { name: 'Leyenda' })
  .locator('li:not([data-legend-traffic]):not([role="presentation"])');
const trafficEntries = map => map.getByRole('list', { name: 'Leyenda' }).locator('li[data-legend-traffic]');
const SEARCH = 'Buscar posición, vuelo o matrícula...';

async function openPositionsMap(page, isolation, query = '') {
  const api = createOccApi();
  isolation.setApi(api.handle);
  // The tab already showed the boot screen to this account (occBootSession.js keeps the account id under
  // OCC_BOOT_SEEN_KEY), as when Mapa de posiciones is opened from another module. Without the mark the screen would
  // cover the map until its engine reports ready (markReady('map'), contract 2.6) and then fade out.
  await page.addInitScript(([authKey, bootSeenKey, session]) => {
    window.localStorage.setItem(authKey, JSON.stringify(session));
    window.sessionStorage.setItem(bootSeenKey, String(session.accountId));
  }, [AUTH_STORAGE_KEY, OCC_BOOT_SEEN_KEY, occSession()]);
  const response = await page.goto(`${PAGE}${query}`);
  expect(response?.status(), `GET ${PAGE}${query}`).toBe(200);
  const container = page.getByTestId('position-map-container');
  // What the cycle E2E waits for: the positions map container and its canvas.
  await expect(container.locator('.maplibregl-canvas')).toBeVisible();
  const map = page.getByTestId('occ-map');
  await mapReady(map);
  // With that mark the screen stays away: the screenshots show the map and the first click reaches it at once.
  await expect(page.getByTestId('occ-boot-screen'), 'the OCC boot screen').toHaveCount(0, { timeout: 1_000 });
  await expect.poll(() => api.reads, { message: 'the positions board was read' }).toBeGreaterThan(0);
  // Inside the OCC frame the map reads the sky and the ELEVANT flights of the station as well (PR M6).
  await expect.poll(() => api.mapReads.flights, { message: 'the map flights were read' }).toBeGreaterThan(0);
  await expect.poll(() => api.mapReads.airPicture, { message: 'the air picture was read' }).toBeGreaterThan(0);
  return { api, map, container };
}

// Resolves once the map of the page has drawn the positions with nothing left to load, place or fade: the legend
// says the stands are on screen, and OccMap marks its root settled after the idle frame that follows its last write.
async function settled(page) {
  await expect(page.getByTestId('positions-map-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('map-legend')).toBeVisible();
  await expect(page.getByTestId('occ-map')).toHaveAttribute('data-occ-settled', 'true');
}

// The page's search puts `code` in the middle of the map, a step past the ramp view (past the three-line threshold);
// its drawer closes (the stand stays selected) and the search is cleared, since it filters the stands while it holds
// text.
async function centreOn(page, code) {
  const field = page.getByPlaceholder(SEARCH);
  await field.fill(code);
  await field.press('Enter');
  const drawer = page.getByTestId('position-detail-drawer');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await field.fill('');
  await settled(page);
}

async function setLegend(page, open) {
  const toggle = page.getByTestId('occ-map').getByRole('button', { name: 'Leyenda', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(open));
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
    // The stub board read now with the map flights (PR M6): every state of the vocabulary in its order, the attention
    // signal of the two stands with a flight due and nobody covering them and the notice of A6, whose aircraft stands on
    // it with nobody having recorded its arrival; the aircraft to scale on their stands and those still to come, the link
    // of A10 to A9 and «No oficial»; then the airfield the map draws from the MDPC dataset in the ramp view (PR M3). The
    // progress bars start past the three-line threshold, closer than the ramp view.
    await expect(standEntries(map)).toHaveText([
      'Libre', 'Planificada', 'Llegando', 'Ocupada', 'Por liberar', 'Inhabilitada', 'Sin verificar', /^Atención/, /^Aviso/,
      'Avión en la posición, a escala', /^Avión previsto, a escala/, /^Enlace con/, /^No oficial/, ...AIRFIELD,
    ]);
    // Before them, the traffic on the ramp: ZZ111 on its way to B24 and the aircraft standing on B28. ZZ102 is A6's: the
    // stand draws it to scale instead of its symbol (one owner per aircraft).
    await expect(trafficEntries(map)).toContainText(['Vuelo de AVIAM que llega', 'Otro tráfico en tierra']);
    await expect(page.getByText('Configuración combinada')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`Mapa de posiciones at Rampa, one terminal and Aeródromo, ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { map } = await openPositionsMap(page, isolation);
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await settled(page);
      // The aircraft on the ramp, the stands' aircraft to scale and the notice of A6 (PR M6).
      await expect(standEntries(map)).toContainText(['Aviso', 'Avión en la posición, a escala', /^Avión previsto, a escala/]);
      await expect(trafficEntries(map)).toContainText(['Vuelo de AVIAM que llega']);
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

      // Up close on terminal A, around A5 (PR M6): the aircraft to scale on A2, A6 and A7 and those still to come on A3
      // and A4, the progress bars of the turnarounds on their stands and the notice of A6. The legend folded, so the
      // stands it explains show.
      await centreOn(page, 'A5');
      await expect(standEntries(map)).toContainText(['Aviso', 'Avión en la posición, a escala', /^Avance de la escala/]);
      await setLegend(page, false);
      await settled(page);
      await shoot(page, testInfo, `positions-map-ramp-close-${size.width}`);

      // ZZ111 chosen through the URL (`flightId=`): its data block docks at the top left, right of the page's map
      // controls, and says it is live where it holds short of B24, its stand, which is marked. The legend folded.
      await page.goto(`${PAGE}?flightId=${encodeURIComponent(arrivalKeyOf(11))}`);
      await mapReady(map);
      const block = page.getByRole('dialog', { name: 'Vuelo ZZ111' });
      await expect(block).toBeVisible();
      await expect(block).toContainText('En vivo');
      await setLegend(page, false);
      await settled(page);
      await shoot(page, testInfo, `positions-map-flight-${size.width}`);
    });
  }

  // A stand clicked (owner request of 2026-11-15): its drawer says its state with the reason and the next change, and
  // its characteristics (code letter, nose, size, centre, taxiway, limits, where its location comes from).
  for (const code of ['A6', 'A10', 'A5']) {
    test(`the drawer of ${code}: its state, why and what comes next, and its characteristics`, async ({ page, isolation }, testInfo) => {
      await openPositionsMap(page, isolation, `?stand=${code}`);
      const drawer = page.getByTestId('position-detail-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-fact="reason"]')).toBeVisible();
      await expect(drawer.getByRole('region', { name: 'Características' })).toBeVisible();
      await settled(page);
      await shoot(page, testInfo, `posicion-${code.toLowerCase()}-drawer`);
    });
  }
});
