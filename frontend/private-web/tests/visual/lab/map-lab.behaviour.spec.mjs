import { readFileSync } from 'node:fs';
import { NOON, VIEW_LABELS, clickStand, labIdle, mapReady, openLab, viewInUrl, zoomOf } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// What the map does in the lab, in Chrome: views, keys, selection, legend, fallback, camera moves, the StrictMode
// double mount of `next dev`, re-reads, a base map that fails, and the airfield drawn from the MDPC dataset (its views,
// its credit and its tooltip). Against a production build only the 404 is checked.

const STATE_LABELS = Object.freeze({
  available: 'Libre', planned: 'Planificada', arriving: 'Llegando', occupied: 'Ocupada', releasing: 'Por liberar',
  disabled: 'Inhabilitada', unverified: 'Sin verificar',
});
const AIRFIELD_LABELS = Object.freeze({
  runway: 'Pista', taxiway: 'Calle de rodaje', holdBar: 'Punto de espera', apron: 'Plataforma', terminal: 'Terminal',
});
const legendOf = (...states) => [...states.map(state => STATE_LABELS[state]), /^No oficial/];
const airfieldOf = (...items) => items.map(item => AIRFIELD_LABELS[item]);

// The airport layout the map draws, read in Node as the generator wrote it.
const LAYOUT = JSON.parse(readFileSync(new URL('../../../src/features/maps/airport/data/mdpc.layout.json', import.meta.url), 'utf8'));
const ACTIVE_STANDS = LAYOUT.stands.filter(stand => !stand.retired);
const METRES_PER_DEGREE_LAT = 111_195;

const labCanvas = page => page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas');

/** The pixels of `[lng, lat]` points inside the lab's map, as MapLibre projects them. */
async function pixelsOf(page, points) {
  return page.evaluate(list => list.map(point => window.__occMapLab.project(point)), points);
}

/** The points whose pixel falls outside the canvas, with their pixel. */
async function outsideCanvas(page, points) {
  const { width, height } = await labCanvas(page).boundingBox();
  const pixels = await pixelsOf(page, points);
  return points.map((point, at) => ({ point, pixel: pixels[at] }))
    .filter(({ pixel }) => !(pixel && pixel.x >= 0 && pixel.x <= width && pixel.y >= 0 && pixel.y <= height));
}

/** Moves the mouse to, or clicks, the pixel of `[lng, lat]` on the lab's map. */
async function pointAt(page, lngLat, { click = false } = {}) {
  const [pixel] = await pixelsOf(page, [lngLat]);
  const box = await labCanvas(page).boundingBox();
  if (click) await page.mouse.click(box.x + pixel.x, box.y + pixel.y);
  else await page.mouse.move(box.x + pixel.x, box.y + pixel.y);
}

test.describe('map lab', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('the view buttons set view= and keys 1 to 4 change the view', async ({ page }) => {
    const map = await openLab(page, `scene=ramp-points&t=${NOON}`);
    const switcher = page.getByRole('group', { name: 'Vista del mapa' });
    await expect(map).toHaveAttribute('data-occ-view', 'ramp');
    expect(viewInUrl(page)).toBeNull();

    for (const view of ['region', 'approach', 'airfield', 'ramp']) {
      const button = switcher.getByRole('button', { name: VIEW_LABELS[view], exact: true });
      await button.click();
      await expect.poll(() => viewInUrl(page)).toBe(view);
      await expect(map).toHaveAttribute('data-occ-view', view);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }

    await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').focus();
    for (const [key, view] of [['1', 'region'], ['2', 'approach'], ['3', 'airfield'], ['4', 'ramp']]) {
      await page.keyboard.press(key);
      await expect.poll(() => viewInUrl(page)).toBe(view);
      await expect(map).toHaveAttribute('data-occ-view', view);
    }
    // Only the map's keys changed: the scene and the frozen clock stay in the URL.
    const query = new URL(page.url()).searchParams;
    expect([query.get('scene'), query.get('t')]).toEqual(['ramp-points', NOON]);
  });

  test('a stand click sets stand= and Esc clears it', async ({ page }) => {
    await openLab(page, `scene=ramp-points&view=ramp&terminal=A&t=${NOON}`);
    await labIdle(page);
    const canvas = page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas');
    const drawn = await canvas.elementHandle();

    await clickStand(page, 'A5');
    await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('A5');
    await clickStand(page, 'AN2');
    await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('AN2');

    await canvas.focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => new URL(page.url()).searchParams.has('stand')).toBe(false);
    // Selecting writes the URL without re-creating the map.
    expect(await drawn.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.evaluate(() => window.__occMapLab.liveMaps())).toBe(1);
    expect(new URL(page.url()).searchParams.get('terminal')).toBe('A');
  });

  test('the legend lists only the states and the airfield items on screen', async ({ page }) => {
    await openLab(page, `scene=ramp-points&t=${NOON}`);
    // What the map draws is read back once it settles: the legend is asserted after that.
    const settleOn = async (view, terminal) => {
      await page.evaluate(([name, code]) => window.__occMapLab.flyToPreset(name, { terminal: code }), [view, terminal ?? null]);
      await labIdle(page);
    };
    const legend = page.getByRole('list', { name: 'Leyenda' });
    const ALL_AIRFIELD = airfieldOf('runway', 'taxiway', 'holdBar', 'apron', 'terminal');
    await labIdle(page);
    await expect(legend.getByRole('listitem')).toHaveText([
      ...legendOf('available', 'planned', 'arriving', 'occupied', 'releasing', 'disabled', 'unverified'), ...ALL_AIRFIELD,
    ]);

    await settleOn('ramp', 'FBO');
    await expect(legend.getByRole('listitem')).toHaveText([
      ...legendOf('available', 'unverified'), ...airfieldOf('taxiway', 'holdBar', 'apron'),
    ]);
    await settleOn('ramp', 'A');
    await expect(legend.getByRole('listitem')).toHaveText([
      ...legendOf('available', 'planned', 'arriving', 'occupied', 'releasing'), ...ALL_AIRFIELD,
    ]);
    await settleOn('ramp', 'B');
    await expect(legend.getByRole('listitem')).toHaveText([
      ...legendOf('available', 'planned', 'occupied', 'disabled'), ...airfieldOf('taxiway', 'apron', 'terminal'),
    ]);

    // The airfield view gathers the stands into clusters, which carry no state, over the whole airfield; region and
    // approach draw neither stands nor the airfield of the dataset.
    await settleOn('airfield');
    await expect(legend.getByRole('listitem')).toHaveText(['Grupo de posicionesAcerca el mapa para ver cada una', ...ALL_AIRFIELD]);
    await settleOn('region');
    await expect(page.getByTestId('map-legend')).toHaveCount(0);
    await settleOn('approach');
    await expect(page.getByTestId('map-legend')).toHaveCount(0);
    await settleOn('ramp');
    await expect(legend.getByRole('listitem')).toHaveCount(13);

    // It folds through its own button, which keeps its name.
    const toggle = page.getByRole('button', { name: 'Leyenda', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(legend).toBeHidden();
  });

  test('the airfield view frames the whole airport (every runway end inside the canvas)', async ({ page }) => {
    const map = await openLab(page, `scene=airfield&t=${NOON}`);
    await expect(map).toHaveAttribute('data-occ-view', 'airfield');
    await labIdle(page);
    const ends = LAYOUT.runways.flatMap(runway => runway.ends.map(end => end.threshold));
    const [west, south, east, north] = LAYOUT.meta.bbox;
    const corners = [[west, south], [east, south], [east, north], [west, north]];
    expect(await outsideCanvas(page, [...ends, ...corners])).toEqual([]);
    // Framed, not lost in the map: the runway ends span more than half its width.
    const xs = (await pixelsOf(page, ends)).map(pixel => pixel.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((await labCanvas(page).boundingBox()).width / 2);
  });

  test('the ramp view frames every active stand polygon', async ({ page }) => {
    const map = await openLab(page, `scene=ramp-points&t=${NOON}`);
    await expect(map).toHaveAttribute('data-occ-view', 'ramp');
    await labIdle(page);
    expect(ACTIVE_STANDS).toHaveLength(41);
    expect(await outsideCanvas(page, ACTIVE_STANDS.flatMap(stand => stand.polygon))).toEqual([]);
    // Each terminal view frames the polygons of its own stands.
    for (const terminal of ['A', 'B', 'FBO']) {
      await page.evaluate(code => window.__occMapLab.flyToPreset('ramp', { terminal: code }), terminal);
      await labIdle(page);
      const own = ACTIVE_STANDS.filter(stand => stand.terminal === terminal).flatMap(stand => stand.polygon);
      expect(await outsideCanvas(page, own), terminal).toEqual([]);
    }
  });

  test('the airfield credit (OpenStreetMap ODbL, OurAirports) appears with the airfield and not in the region view', async ({ page }) => {
    await openLab(page, `scene=airfield&t=${NOON}`);
    await labIdle(page);
    // The compact credits stay folded; their text is in the page all the same.
    const credits = page.locator('.maplibregl-ctrl-attrib-inner');
    await expect(credits).toContainText('© OpenStreetMap contributors (ODbL) · OurAirports');
    await expect(credits.locator('a', { hasText: 'ODbL' })).toHaveAttribute('href', 'https://opendatacommons.org/licenses/odbl/');
    await expect(credits.locator('a', { hasText: 'OurAirports' })).toHaveAttribute('href', 'https://ourairports.com/');
    // The region view draws nothing of the dataset: its credit goes, the base map's stays.
    await page.evaluate(() => window.__occMapLab.flyToPreset('region'));
    await labIdle(page);
    await expect(credits).not.toContainText('OurAirports');
    await expect(credits).toContainText('© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles');
    // And it comes back with the airfield.
    await page.evaluate(() => window.__occMapLab.flyToPreset('airfield'));
    await labIdle(page);
    await expect(credits).toContainText('OurAirports');
  });

  test('a runway or a taxiway under the pointer shows its tooltip; a click holds it and a click elsewhere or another view closes it', async ({ page }) => {
    await openLab(page, `scene=airfield&t=${NOON}`);
    await labIdle(page);
    const [start, end] = LAYOUT.runways.find(runway => runway.id === '08/26').ends.map(item => item.threshold);
    const runwayMiddle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    // 400 m north of that runway nothing of the airfield is drawn.
    const grass = [runwayMiddle[0], runwayMiddle[1] + 400 / METRES_PER_DEGREE_LAT];
    // Half way along the long straight of taxiway A, between the two runways.
    const lineA = LAYOUT.taxiways.find(taxiway => taxiway.ref === 'A').line;
    const straight = lineA.findIndex((point, at) => at > 0 && lineA[at - 1][1] - point[1] > 0.003);
    const taxiwayA = [(lineA[straight - 1][0] + lineA[straight][0]) / 2, (lineA[straight - 1][1] + lineA[straight][1]) / 2];
    const card = page.getByRole('tooltip');

    await pointAt(page, runwayMiddle);
    await expect(card).toHaveText('Pista 08/26 · 3100 m × 45 m');
    await expect(card).toHaveAttribute('data-pinned', 'false');
    await expect(labCanvas(page)).toHaveCSS('cursor', 'pointer');
    await pointAt(page, taxiwayA);
    await expect(card).toHaveText('Calle de rodaje A');
    await pointAt(page, grass);
    await expect(card).toHaveCount(0);

    // A click holds it while the pointer goes elsewhere; a click on nothing closes it.
    await pointAt(page, runwayMiddle, { click: true });
    await expect(card).toHaveAttribute('data-pinned', 'true');
    await pointAt(page, grass);
    await expect(card).toHaveText('Pista 08/26 · 3100 m × 45 m');
    await pointAt(page, grass, { click: true });
    await expect(card).toHaveCount(0);
    // Another view closes a held card too, and nothing was selected along the way.
    await pointAt(page, taxiwayA, { click: true });
    await expect(card).toHaveText('Calle de rodaje A');
    await labCanvas(page).focus();
    await page.keyboard.press('4');
    await expect.poll(() => viewInUrl(page)).toBe('ramp');
    await expect(card).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('stand')).toBe(false);
  });

  test('the fallback list appears without WebGL', async ({ page }) => {
    // A browser without WebGL: the canvas refuses every WebGL context.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
        return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
      };
    });
    await openLab(page, 'scene=ramp-points', { drawn: false });
    const fallback = page.getByTestId('map-unavailable');
    await expect(fallback.getByRole('heading', { name: 'El mapa no está disponible' })).toBeVisible();
    const list = fallback.getByRole('group', { name: 'Lista del mapa' });
    await expect(list.getByRole('button')).toHaveCount(41);
    await list.getByRole('button', { name: 'A5', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('A5');
    await expect(list.getByRole('button', { name: 'A5', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Without a map there is no view selector to press.
    await expect(page.getByRole('group', { name: 'Vista del mapa' })).toHaveCount(0);
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  });

  test('the lab scene without WebGL shows the same fallback and gives WebGL back when it closes', async ({ page }) => {
    await openLab(page, 'scene=unavailable-fallback', { drawn: false });
    await expect(page.getByTestId('map-unavailable').getByRole('group', { name: 'Lista del mapa' }).getByRole('button'))
      .toHaveCount(41);
    await page.getByRole('link', { name: 'Escenas' }).click();
    await expect(page.getByRole('list', { name: 'Escenas' })).toBeVisible();
    expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null)).toBe(true);
  });

  test('a WebGL context that comes back without WebGL2 leaves the fallback for good', async ({ page, isolation }) => {
    const map = await openLab(page, `scene=ramp-points&t=${NOON}`);
    await labIdle(page);
    expect(isolation.count('tilejson')).toBe(1);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // The browser takes the WebGL context away, then gives it back but refuses the WebGL2 context MapLibre asks for
    // again. MapLibre 6.16 has rebuilt its style by then, and fires `error` with a GPUInitializationError instead of
    // webglcontextrestored.
    await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').evaluate(node => new Promise(resolve => {
      const lose = node.getContext('webgl2').getExtension('WEBGL_lose_context');
      node.addEventListener('webglcontextlost', () => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
          return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
        };
        // Once MapLibre has handled the loss, which allows the restore.
        setTimeout(() => {
          lose.restoreContext();
          resolve();
        });
      }, { once: true });
      lose.loseContext();
    }));
    await expect(map).toHaveAttribute('data-occ-engine', 'unavailable');
    await expect(page.getByTestId('map-unavailable').getByRole('group', { name: 'Lista del mapa' }).getByRole('button'))
      .toHaveCount(41);
    await expect(page.getByRole('group', { name: 'Vista del mapa' })).toHaveCount(0);
    // The engine removed the map at once, as MapLibre's constructor cleans up after the same error: no canvas or
    // control is left under the fallback, and no live map.
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
    await expect(page.locator('.maplibregl-ctrl')).toHaveCount(0);
    expect(await page.evaluate(() => window.__occMapLab.liveMaps())).toBe(0);
    // Half a second of frames later the style MapLibre had rebuilt has not loaded (it would ask for the TileJSON again),
    // no frame was drawn with the painter MapLibre lost (each one threw a TypeError) and the fallback is still there.
    await page.evaluate(() => new Promise(resolve => {
      const step = left => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
      step(30);
    }));
    await expect(map).toHaveAttribute('data-occ-engine', 'unavailable');
    expect(isolation.count('tilejson')).toBe(1);
    expect(errors).toEqual([]);

    // Leaving the screen has nothing left to remove.
    await page.getByRole('link', { name: 'Escenas' }).click();
    await expect(page.getByRole('list', { name: 'Escenas' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test.describe('without reduced motion', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('the zoom buttons and the view presets really move the camera', async ({ page }) => {
      const map = await openLab(page, 'scene=ramp-points');
      const start = await zoomOf(map);
      await page.getByRole('button', { name: 'Acercar' }).click();
      await expect.poll(() => zoomOf(map)).toBeGreaterThan(start + 0.9);
      await page.getByRole('button', { name: 'Alejar' }).click();
      await expect.poll(() => zoomOf(map)).toBeLessThan(start + 0.1);

      const switcher = page.getByRole('group', { name: 'Vista del mapa' });
      const zooms = {};
      for (const view of ['region', 'approach', 'airfield', 'ramp']) {
        const before = await zoomOf(map);
        await switcher.getByRole('button', { name: VIEW_LABELS[view], exact: true }).click();
        await expect(map).toHaveAttribute('data-occ-view', view);
        await expect.poll(() => zoomOf(map)).not.toBeCloseTo(before, 1);
        zooms[view] = await zoomOf(map);
      }
      expect(zooms.region).toBeLessThan(zooms.approach);
      expect(zooms.approach).toBeLessThan(zooms.airfield);
      expect(zooms.airfield).toBeLessThan(zooms.ramp);
    });
  });

  test('a StrictMode double mount leaves one live map and the page reaches networkidle', async ({ page }) => {
    const response = await page.goto('/map-lab?scene=ramp-points', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    const map = page.getByTestId('occ-map');
    await mapReady(map);
    expect(await page.evaluate(() => window.__occMapLab.liveMaps())).toBe(1);
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
    await expect(page.locator('.occ-map-engine')).toHaveCount(1);
  });

  test('re-reading the stands keeps the same canvas and requests the TileJSON once', async ({ page, isolation }) => {
    await openLab(page, `scene=ramp-points&t=${NOON}`);
    await labIdle(page);
    const canvas = await page.locator('canvas.maplibregl-canvas').elementHandle();
    expect(isolation.count('tilejson')).toBe(1);

    await page.getByRole('button', { name: 'Releer posiciones' }).click();
    await page.evaluate(() => window.__occMapLab.refresh());
    await page.getByRole('button', { name: 'Releer posiciones' }).click();
    await labIdle(page);

    expect(await canvas.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
    expect(await page.evaluate(() => window.__occMapLab.liveMaps())).toBe(1);
    expect(isolation.count('tilejson')).toBe(1);
  });

  test('a failing base map shows the degraded chip and keeps the stands', async ({ page, isolation }) => {
    isolation.setTiles('fail');
    const map = await openLab(page, `scene=ramp-points&view=ramp&terminal=A&t=${NOON}`);
    await expect(map).toHaveAttribute('data-occ-basemap', 'degraded');
    await expect(page.locator('.occ-map-chip')).toHaveText(
      'No se pudo cargar el mapa base. Los datos de ELEVANT siguen en el mapa.',
    );
    expect(isolation.count('tile')).toBeGreaterThan(0);
    // The stands are still drawn and still answer a click.
    await labIdle(page);
    await clickStand(page, 'A5');
    await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('A5');
  });

  test('the degraded scene of the lab fails before any base-map request leaves the browser', async ({ page, isolation }) => {
    const map = await openLab(page, `scene=basemap-degraded&t=${NOON}`);
    await expect(map).toHaveAttribute('data-occ-basemap', 'degraded');
    await expect(page.locator('.occ-map-chip')).toBeVisible();
    await labIdle(page);
    expect(isolation.requests.filter(entry => entry.kind !== 'glyph')).toEqual([]);
    await clickStand(page, 'A5');
    await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('A5');
  });

  test('no request leaves for an unexpected origin', async ({ page, isolation }) => {
    await page.goto('/map-lab');
    const links = page.getByRole('list', { name: 'Escenas' }).getByRole('link');
    await expect(links.first()).toBeVisible();
    const scenes = (await links.evaluateAll(nodes => nodes.map(node => new URL(node.href).searchParams.get('scene'))));
    expect(scenes).toEqual(expect.arrayContaining([
      'ramp-points', 'ramp-selected', 'airfield', 'approach', 'region', 'unavailable-fallback', 'basemap-degraded',
    ]));
    for (const scene of scenes) {
      const drawn = scene !== 'unavailable-fallback';
      await openLab(page, `scene=${scene}&t=${NOON}`, { drawn });
      if (drawn) await labIdle(page);
    }
    await openLab(page, `scene=airfield&basemap=none&t=${NOON}`);
    await labIdle(page);
    // Glyphs came from the fixtures; nothing else left the page (the fixture checks `unexpected` after the test).
    expect(isolation.count('glyph')).toBeGreaterThan(0);
    expect(isolation.requests.filter(entry => entry.kind === 'api')).toEqual([]);
    expect(isolation.unexpected).toEqual([]);
  });
});

test.describe('map lab in a production build', () => {
  test.skip(!production, 'Only against a production build (OCC_VISUAL_TARGET=production).');

  test('/map-lab answers the 404 page and draws no lab', async ({ page }) => {
    const response = await page.goto('/map-lab?scene=ramp-points');
    await expect(page.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeVisible();
    // app/layout.jsx streams every page inside a Suspense boundary, so Next sends this not-found page with the 200 it
    // had already committed and marks it noindex (node_modules/next/dist/docs/01-app/02-guides/streaming.md, «Status
    // codes»); a 404 would mean the layout stopped streaming first.
    expect([200, 404]).toContain(response?.status());
    await expect(page.locator('meta[name="robots"][content="noindex"]')).not.toHaveCount(0);
    await expect(page.locator('[data-occ-map-lab]')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => 'occMapLab' in window || '__occMapLab' in window)).toBe(false);
  });
});
