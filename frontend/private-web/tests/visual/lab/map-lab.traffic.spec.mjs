import { NOON, labIdle, mapReady, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The traffic of PR M5 in Chrome: the traffic scenes of the lab (synthetic air pictures, no provider) photographed at
// the laptop sizes of the presentation, 1440 × 900 and 1920 × 1080, in the Región, Aproximación and Rampa views, for a
// person to review in test-results/visual. Beside the pictures it checks what must hold on every one: the credit of
// the aircraft data is on screen as a link, the attribution names it, and the legend lists the traffic. Step c adds
// the chosen aircraft (its data block, its cyan and its route) and the layers menu.

const SCENES = Object.freeze([
  ['region-traffic-mixed', 'region'],
  ['approach-traffic-demo', 'approach'],
  ['ramp-traffic-ground', 'ramp'],
  ['approach-traffic-estimated-stale', 'approach'],
]);
const SIZES = Object.freeze([[1440, 900], [1920, 1080]]);
const CREDIT = 'Red ADS-B de prueba';

const legendItems = page => page.getByRole('list', { name: 'Leyenda' }).getByRole('listitem');
const labCanvas = page => page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas');
const urlKey = (page, key) => new URL(page.url()).searchParams.get(key);
// ZZ700, the departure of the region scene, drawn as its flight (lab/trafficScenes.js, testing/trafficFixtures.js).
const ZZ700 = 'f:l:5c000000-0000-4000-8000-000000000700';

/** Clicks the aircraft of the lab's scene (`f:<flightKey>` or `h:<hex>`) where the map draws it. */
async function clickAircraft(page, id) {
  const point = await page.evaluate(aircraft => {
    const at = window.__occMapLab.aircraftAt(aircraft);
    return at ? window.__occMapLab.project(at) : null;
  }, id);
  expect(point, `the pixel of ${id}`).not.toBeNull();
  const box = await labCanvas(page).boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

test.describe('map lab traffic', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of the traffic scenes at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      for (const [scene, view] of SCENES) {
        const map = await openLab(page, `scene=${scene}&t=${NOON}`);
        await expect(map).toHaveAttribute('data-occ-view', view);
        await expect(map).toHaveAttribute('data-occ-basemap', 'ok');
        await labIdle(page);
        // The credit of the aircraft data stays in sight while traffic is on screen, as a link.
        await expect(page.getByTestId('map-source-status').getByRole('link', { name: CREDIT })).toBeVisible();
        await expect(legendItems(page).first()).toBeVisible();
        await shoot(page, testInfo, `${scene}-${width}`);
      }
    }
  });

  test('each view explains its own traffic and the attribution credits the source', async ({ page }, testInfo) => {
    await openLab(page, `scene=region-traffic-mixed&t=${NOON}`);
    await labIdle(page);
    await expect(legendItems(page)).toContainText(['Vuelo de AVIAM que llega', 'Vuelo de AVIAM que sale', 'Otro tráfico',
      'Sin actualizar', 'Estela']);
    // The attribution, folded by default, names the source once opened.
    await page.getByTestId('map-lab-map').locator('summary.maplibregl-ctrl-attrib-button').click();
    await expect(page.getByTestId('map-lab-map').locator('.maplibregl-ctrl-attrib-inner')).toContainText(`Datos de aeronaves: ${CREDIT}`);

    // Other traffic shows its tag while the pointer is on it.
    const point = await page.evaluate(() => {
      const at = window.__occMapLab.aircraftAt('h:f0b005');
      return at ? window.__occMapLab.project(at) : null;
    });
    expect(point, 'the pixel of ZZZ190').not.toBeNull();
    const box = await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').boundingBox();
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await expect(page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas')).toHaveCSS('cursor', 'pointer');
    await labIdle(page);
    await shoot(page, testInfo, 'region-traffic-hover-1440');

    // The ramp lists the aircraft on the ground and the demo approach its plate, ring and estimated path.
    await openLab(page, `scene=ramp-traffic-ground&t=${NOON}`);
    await labIdle(page);
    await expect(legendItems(page)).toContainText(['Vuelo de AVIAM que llega', 'Vuelo de AVIAM que sale',
      'Otro tráfico en tierra']);
    await openLab(page, `scene=approach-traffic-demo&t=${NOON}`);
    await labIdle(page);
    await expect(legendItems(page)).toContainText(['Vuelo de AVIAM que llega', 'Demo', 'est.', 'Estela', 'Estela estimada']);
    await openLab(page, `scene=approach-traffic-estimated-stale&t=${NOON}`);
    await labIdle(page);
    await expect(page.getByTestId('map-source-status').getByRole('status'))
      .toHaveText('Tráfico con retraso: último dato hace 4 min.');
  });

  test('screenshots of the data block, the selection and the layers menu at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      // ZZ161 chosen: its data block docked at the top left, the aircraft in cyan with its ring, and its route.
      const map = await openLab(page, `scene=region-traffic-selected&t=${NOON}`);
      await expect(map).toHaveAttribute('data-occ-basemap', 'ok');
      const block = page.getByRole('dialog', { name: 'Vuelo ZZ161' });
      await expect(block).toBeVisible();
      await expect(block).toContainText('Llega 11:10 · en 10 min');
      await expect(block).toContainText('En vivo · hace 4 s');
      await expect(block.getByRole('link', { name: 'Ver escala' })).toBeVisible();
      await labIdle(page);
      await shoot(page, testInfo, `region-traffic-selected-${width}`);
      // The same flight from the approach view, where its route reads: what it flew and the straight line to A5.
      await page.evaluate(() => window.__occMapLab.flyToPreset('approach'));
      await expect(map).toHaveAttribute('data-occ-view', 'approach');
      await labIdle(page);
      await expect(legendItems(page)).toContainText(['Recorrido del vuelo elegido', 'Hasta su próximo punto, en línea recta']);
      await shoot(page, testInfo, `approach-traffic-selected-route-${width}`);

      // Another airline's aircraft chosen by its address: «Otro tráfico», what it flew, no next point and no link.
      await openLab(page, `scene=approach-traffic-hex-selected&t=${NOON}`);
      const other = page.getByRole('dialog', { name: 'Vuelo ZZZ880' });
      await expect(other).toContainText('Otro tráfico');
      await expect(other.getByRole('link')).toHaveCount(0);
      await labIdle(page);
      await shoot(page, testInfo, `approach-traffic-hex-selected-${width}`);

      // The layers menu open over the region's traffic.
      await openLab(page, `scene=region-layers-menu&t=${NOON}`);
      await expect(page.getByRole('group', { name: 'Tráfico' })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: 'Vuelos de AVIAM' })).toBeDisabled();
      await labIdle(page);
      await shoot(page, testInfo, `region-layers-menu-${width}`);
    }
  });

  test('a click chooses an aircraft, L opens the layers menu, one Esc closes only it and its choices survive a reload', async ({ page }, testInfo) => {
    await openLab(page, `scene=region-traffic-mixed&t=${NOON}`);
    await labIdle(page);
    // A click on other traffic writes its address and opens its block; a click on the AVIAM arrival writes its key.
    await clickAircraft(page, 'h:f0b005');
    await expect.poll(() => urlKey(page, 'hex')).toBe('f0b005');
    await expect(page.getByRole('dialog', { name: 'Vuelo ZZZ190' })).toContainText('Otro tráfico');
    await clickAircraft(page, ZZ700);
    await expect.poll(() => urlKey(page, 'flightId')).toMatch(/^l:/);
    expect(urlKey(page, 'hex')).toBeNull();
    const departure = page.getByRole('dialog', { name: 'Vuelo ZZ700' });
    await expect(departure).toContainText('Salió');
    await labIdle(page);
    await shoot(page, testInfo, 'region-traffic-departure-selected-1440');

    // L opens the menu from the map; the first Esc closes it and keeps the flight; the second lets the flight go.
    await labCanvas(page).focus();
    await page.keyboard.press('l');
    const group = page.getByRole('group', { name: 'Tráfico' });
    await expect(group).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(group).toBeHidden();
    await expect(departure).toBeVisible();
    expect(urlKey(page, 'flightId')).not.toBeNull();
    await page.keyboard.press('Escape');
    await expect(departure).toBeHidden();
    await expect.poll(() => urlKey(page, 'flightId')).toBeNull();

    // The labels of all the traffic, turned on with the menu, stay on after a reload.
    await page.getByRole('button', { name: 'Capas' }).click();
    await page.getByRole('checkbox', { name: 'Etiquetas de todo el tráfico' }).check();
    await labIdle(page);
    await shoot(page, testInfo, 'region-traffic-all-labels-1440');
    await page.reload();
    await mapReady(page.getByTestId('occ-map'));
    await page.getByRole('button', { name: 'Capas' }).click();
    await expect(page.getByRole('checkbox', { name: 'Etiquetas de todo el tráfico' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Vuelos de AVIAM' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Etiquetas de todo el tráfico' }).uncheck();
    expect(await page.evaluate(() => window.localStorage.getItem('elevant-occ-map-layers:v1'))).toBeNull();
  });
});
