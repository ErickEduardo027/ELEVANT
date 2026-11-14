import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The route of the chosen flight and follow mode of PR M6 in Chrome: the map lab's scenes (synthetic data, no provider,
// the clock frozen at the lab's noon), photographed at the laptop sizes of the presentation, 1440 × 900 and
// 1920 × 1080, for a person to review in test-results/visual. Beside the pictures it checks what must hold: the legend
// names the parts of the route on screen, a followed aircraft is framed inside the map, S and «Seguir» (one switch,
// pressed while the map follows) write `follow=1`, and a drag takes it away and says so at the bottom left, clear of the
// dock, the credit, the open legend and the data block. The suite runs with reduced motion, so follow mode jumps instead
// of gliding.

const SIZES = Object.freeze([[1440, 900], [1920, 1080]]);
// The demo pair of the fixtures (src/features/maps/testing/trafficFixtures.js) as the traffic draws it.
const DEMO_ARRIVAL = 'f:p:5b000000-0000-4000-8000-000000009001';
const DEMO_DEPARTURE = 'f:p:5b000000-0000-4000-8000-000000009002';

// Each route scene with its view, the dialog of its flight, the parts its legend names and the aircraft it chose.
const ROUTE_SCENES = Object.freeze([
  ['approach-demo-route', 'approach', 'Vuelo ZZ9001', ['Trayecto estimado', 'Ruta prevista', 'Puntos de la ruta'],
    DEMO_ARRIVAL],
  ['airfield-departure-route', 'airfield', 'Vuelo ZZ9002', ['Trayecto estimado', 'Ruta prevista'], DEMO_DEPARTURE],
]);
// Each follow scene with the aircraft it follows.
const FOLLOW_SCENES = Object.freeze([['approach-follow-final', DEMO_ARRIVAL], ['airfield-follow-taxi', DEMO_ARRIVAL]]);

const legendItems = page => page.getByRole('list', { name: 'Leyenda' }).getByRole('listitem');
const legendPanel = page => page.getByRole('list', { name: 'Leyenda' }).locator('..');
const labCanvas = page => page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas');
const urlKey = (page, key) => new URL(page.url()).searchParams.get(key);
const dockFollow = page => page.locator('.occ-map-dock').getByRole('button', { name: 'Seguir', exact: true });
const blockFollow = page => page.getByRole('dialog', { name: 'Vuelo ZZ9001' })
  .getByRole('button', { name: 'Seguir', exact: true });
const stoppedNotice = page => page.getByTestId('occ-map').getByRole('status').filter({ hasText: 'Dejaste de seguir' });

/** The pixel where the lab's map draws one of its aircraft, or null. */
const aircraftPixel = (page, id) => page.evaluate(aircraft => {
  const at = window.__occMapLab.aircraftAt(aircraft);
  return at ? window.__occMapLab.project(at) : null;
}, id);

/** Whether a pixel of the lab's map lies on its canvas, `margin` px clear of its edges. */
async function onCanvas(page, pixel, margin = 0) {
  const { width, height } = await labCanvas(page).boundingBox();
  return pixel !== null && pixel.x >= margin && pixel.x <= width - margin && pixel.y >= margin && pixel.y <= height - margin;
}

/** Whether two boxes of the page share any pixel. */
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Whether the lab's map shows one of its aircraft: drawn on its canvas `margin` px clear of the edges, and under
 * neither the data block nor the open legend.
 */
async function inSight(page, id, margin) {
  const pixel = await aircraftPixel(page, id);
  if (!(await onCanvas(page, pixel, margin))) return false;
  const canvas = await labCanvas(page).boundingBox();
  const mark = { x: canvas.x + pixel.x - 12, y: canvas.y + pixel.y - 12, width: 24, height: 24 };
  for (const panel of [page.getByRole('dialog'), legendPanel(page)]) {
    if (await panel.count() === 0) continue;
    const box = await panel.first().boundingBox();
    if (box !== null && overlap(mark, box)) return false;
  }
  return true;
}

test.describe('map lab route and follow mode', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of the chosen flight\'s route at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      for (const [scene, view, dialog, parts, aircraft] of ROUTE_SCENES) {
        const map = await openLab(page, `scene=${scene}&t=${NOON}`);
        await expect(map).toHaveAttribute('data-occ-view', view);
        await expect(map).toHaveAttribute('data-occ-basemap', 'ok');
        await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
        await labIdle(page);
        await expect(legendItems(page)).toContainText(parts);
        // The chosen aircraft in sight, where the route splits.
        expect(await inSight(page, aircraft, 40), scene).toBe(true);
        await shoot(page, testInfo, `${scene}-${width}`);
      }
      // The departure's way on to New York, by the great circle, from the region view.
      await page.evaluate(() => window.__occMapLab.flyToPreset('region'));
      await expect(page.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'region');
      await labIdle(page);
      await expect(legendItems(page)).toContainText(['Ruta prevista']);
      await shoot(page, testInfo, `airfield-departure-route-region-${width}`);
    }
  });

  test('screenshots of follow mode on final and on the taxiway at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      for (const [scene, aircraft] of FOLLOW_SCENES) {
        await openLab(page, `scene=${scene}&t=${NOON}`);
        await expect.poll(() => urlKey(page, 'follow')).toBe('1');
        await expect(dockFollow(page)).toHaveAttribute('aria-pressed', 'true');
        await labIdle(page);
        // Framed: the aircraft in sight, well clear of the map's edges.
        await expect.poll(() => inSight(page, aircraft, 80)).toBe(true);
        await shoot(page, testInfo, `${scene}-${width}`);
      }
    }
  });

  test('S and «Seguir» write follow=1, a drag takes it away and says so at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await openLab(page, `scene=approach-demo-final&t=${NOON}`);
      await labIdle(page);
      await expect(dockFollow(page)).toHaveAttribute('aria-pressed', 'false');
      // S on the map follows: the URL says so, both switches are pressed and the aircraft is framed.
      await labCanvas(page).focus();
      await page.keyboard.press('s');
      await expect.poll(() => urlKey(page, 'follow')).toBe('1');
      await expect(dockFollow(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(blockFollow(page)).toHaveAttribute('aria-pressed', 'true');
      await labIdle(page);
      await expect.poll(() => inSight(page, DEMO_ARRIVAL, 80)).toBe(true);
      await shoot(page, testInfo, `approach-demo-final-following-${width}`);

      // A person drags the map: follow mode ends at once, in the URL too, and says how to come back. The drag stays
      // over the map, clear of the data block (top left) and the open legend (above the dock): MapLibre ends a pan only
      // on a release over its canvas, else on the next move of the mouse.
      const box = await labCanvas(page).boundingBox();
      const [x, y] = [box.x + box.width * 0.45, box.y + box.height * 0.22];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 140, y + 50, { steps: 10 });
      await page.mouse.up();
      await page.mouse.move(x + 150, y + 55);
      await expect.poll(() => urlKey(page, 'follow')).toBeNull();
      const notice = stoppedNotice(page);
      await expect(notice).toHaveText('Dejaste de seguir a ZZ9001. Pulsa Seguir para volver.');
      await expect(dockFollow(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(blockFollow(page)).toHaveAttribute('aria-pressed', 'false');
      // At the bottom left, over the credit: the dock's row, the credit, the open legend and the data block stay whole.
      await expect(legendPanel(page)).toBeVisible();
      const noticeBox = await notice.boundingBox();
      for (const [name, other] of [['dock', page.locator('.occ-map-dock')], ['credit', page.locator('[data-map-credit]')],
        ['legend', legendPanel(page)], ['data block', page.getByRole('dialog', { name: 'Vuelo ZZ9001' })]]) {
        expect(overlap(noticeBox, await other.boundingBox()), `${name} at ${width}`).toBe(false);
      }
      await labIdle(page);
      await shoot(page, testInfo, `approach-demo-final-follow-stopped-${width}`);
    }

    // The dock's «Seguir» follows again (the notice goes) and stops; with nothing chosen it waits, disabled.
    await dockFollow(page).click();
    await expect.poll(() => urlKey(page, 'follow')).toBe('1');
    await expect(stoppedNotice(page)).toHaveCount(0);
    await dockFollow(page).click();
    await expect.poll(() => urlKey(page, 'follow')).toBeNull();
    await openLab(page, `scene=approach-traffic-demo&t=${NOON}`);
    await expect(dockFollow(page)).toBeDisabled();
  });
});
