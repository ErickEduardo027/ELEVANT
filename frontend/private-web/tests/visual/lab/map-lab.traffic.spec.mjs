import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The traffic of PR M5 in Chrome: the four traffic scenes of the lab (synthetic air pictures, no provider) photographed
// at the laptop sizes of the presentation, 1440 × 900 and 1920 × 1080, in the Región, Aproximación and Rampa views,
// for a person to review in test-results/visual. Beside the pictures it checks what must hold on every one: the
// credit of the aircraft data is on screen as a link, the attribution names it, and the legend lists the traffic.

const SCENES = Object.freeze([
  ['region-traffic-mixed', 'region'],
  ['approach-traffic-demo', 'approach'],
  ['ramp-traffic-ground', 'ramp'],
  ['approach-traffic-estimated-stale', 'approach'],
]);
const SIZES = Object.freeze([[1440, 900], [1920, 1080]]);
const CREDIT = 'Red ADS-B de prueba';

const legendItems = page => page.getByRole('list', { name: 'Leyenda' }).getByRole('listitem');

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
});
