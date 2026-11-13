import { NOON, VIEW_LABELS, clickStand, labIdle, mapReady, openLab, viewInUrl, zoomOf } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// What the map does in the lab, in Chrome: views, keys, selection, legend, fallback, camera moves, the StrictMode
// double mount of `next dev`, re-reads and a base map that fails. Against a production build only the 404 is checked.

const STATE_LABELS = Object.freeze({
  available: 'Libre', planned: 'Planificada', arriving: 'Llegando', occupied: 'Ocupada', releasing: 'Por liberar',
  disabled: 'Inhabilitada', unverified: 'Sin verificar',
});
const legendOf = (...states) => [...states.map(state => STATE_LABELS[state]), /^No oficial/];

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

  test('the legend lists only the states on screen', async ({ page }) => {
    await openLab(page, `scene=ramp-points&t=${NOON}`);
    const legend = page.getByRole('list', { name: 'Leyenda' });
    await expect(legend.getByRole('listitem')).toHaveText(legendOf(
      'available', 'planned', 'arriving', 'occupied', 'releasing', 'disabled', 'unverified',
    ));

    await page.evaluate(() => window.__occMapLab.flyToPreset('ramp', { terminal: 'FBO' }));
    await expect(legend.getByRole('listitem')).toHaveText(legendOf('available', 'unverified'));
    await page.evaluate(() => window.__occMapLab.flyToPreset('ramp', { terminal: 'A' }));
    await expect(legend.getByRole('listitem')).toHaveText(legendOf('available', 'planned', 'arriving', 'occupied', 'releasing'));
    await page.evaluate(() => window.__occMapLab.flyToPreset('ramp', { terminal: 'B' }));
    await expect(legend.getByRole('listitem')).toHaveText(legendOf('available', 'planned', 'occupied', 'disabled'));

    // The airfield view gathers the stands into clusters, which carry no state; region and approach draw no stand.
    await page.evaluate(() => window.__occMapLab.flyToPreset('airfield'));
    await expect(legend.getByRole('listitem')).toHaveText(['Grupo de posicionesAcerca el mapa para ver cada una']);
    await page.evaluate(() => window.__occMapLab.flyToPreset('region'));
    await expect(page.getByTestId('map-legend')).toHaveCount(0);
    await page.evaluate(() => window.__occMapLab.flyToPreset('ramp'));
    await expect(legend.getByRole('listitem')).toHaveCount(8);

    // It folds through its own button, which keeps its name.
    const toggle = page.getByRole('button', { name: 'Leyenda', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(legend).toBeHidden();
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
      'No se pudo cargar el mapa base. Se muestran las posiciones y los datos de ELEVANT.',
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
