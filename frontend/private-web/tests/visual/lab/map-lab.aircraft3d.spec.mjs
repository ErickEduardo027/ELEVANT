import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The 3D aircraft of PR M7 in Chrome's real WebGL (SwiftShader where there is no GPU): the lab's 3D scenes (synthetic
// data, no provider, the clock frozen), photographed at the laptop sizes of the presentation, 1440 × 900 and
// 1920 × 1080, for a person to review in test-results/visual. Beside the pictures it checks what must hold: the layer
// draws (its stats count instances and nothing failed), the dock offers 2D/3D with its key, the pause of the governor
// says so and «Volver a 3D» brings the models back, a lost WebGL context comes back with its models, and a browser
// without WebGL keeps the list of the fallback.

const SIZES = Object.freeze([[1440, 900], [1920, 1080]]);
// The demo arrival of approach-demo-final touches down two minutes after the lab's noon: 113 s later it is on short
// final, a few hundred metres before the threshold of 08 and some thirty metres up.
const SHORT_FINAL = new Date(Date.parse(NOON) + 113_000).toISOString();
const NIGHT = '2026-11-14T02:00:00.000Z';
const SCENES = Object.freeze([
  ['ramp-3d-parked', NOON, 'ramp'],
  ['ramp-3d-selected', NOON, 'ramp'],
  ['airfield-3d-final', SHORT_FINAL, 'airfield'],
  ['ramp-3d-night', NIGHT, 'ramp'],
]);

const aircraft3d = page => page.evaluate(() => {
  const state = window.__occMapLab.aircraft3d();
  return state ? { status: state.status, notice: state.notice, level: state.level, stats: state.stats } : null;
});

// The lab opens its legend; the pictures of the models fold it, as the console does.
async function foldLegend(page) {
  const legend = page.getByRole('button', { name: 'Leyenda' });
  if (await legend.getAttribute('aria-expanded') === 'true') await legend.click();
}

async function drawn3d(page, map) {
  await expect(map).toHaveAttribute('data-occ-3d', 'ready');
  await expect.poll(async () => (await aircraft3d(page))?.stats?.instances ?? 0).toBeGreaterThan(0);
  const state = await aircraft3d(page);
  expect(state.stats).toMatchObject({ failed: false, lost: false });
  return state;
}

test.describe('map lab 3D aircraft', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of the 3D scenes at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      for (const [scene, at, view] of SCENES) {
        const map = await openLab(page, `scene=${scene}&t=${at}`);
        await expect(map).toHaveAttribute('data-occ-view', view);
        const state = await drawn3d(page, map);
        // Within the budget of design G4.
        expect(state.stats.triangles).toBeLessThan(250_000);
        expect(state.stats.drawCalls).toBeLessThan(40);
        await foldLegend(page);
        await labIdle(page);
        await shoot(page, testInfo, `${scene}-${width}`);
      }
    }
    expect(errors).toEqual([]);
  });

  test('the dock and D switch 2D and 3D; the chosen aircraft keeps its data block', async ({ page }, testInfo) => {
    const map = await openLab(page, `scene=ramp-3d-selected&t=${NOON}`);
    await drawn3d(page, map);
    await expect(page.getByRole('dialog', { name: 'Vuelo ZZ9001' })).toBeVisible();
    const toggle = page.getByTestId('map-3d-toggle');
    await expect(toggle.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await page.evaluate(() => window.__occMapLab.getCamera())).pitch).toBeCloseTo(55, 0);
    await toggle.getByRole('button', { name: '2D' }).click();
    await expect(map).toHaveAttribute('data-occ-3d', 'off');
    await expect.poll(async () => (await page.evaluate(() => window.__occMapLab.getCamera())).pitch).toBeCloseTo(0, 0);
    await labIdle(page);
    await shoot(page, testInfo, 'ramp-3d-switched-2d-1440');
    await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').focus();
    await page.keyboard.press('d');
    await drawn3d(page, map);
  });

  test('the governor\'s pause says so and «Volver a 3D» brings the models back', async ({ page }, testInfo) => {
    const map = await openLab(page, `scene=ramp-3d-parked&t=${NOON}`);
    await drawn3d(page, map);
    await page.evaluate(() => window.__occMapLab.aircraft3d().pause());
    await expect(map).toHaveAttribute('data-occ-3d', 'paused');
    const notice = page.getByRole('status').filter({ hasText: 'Pausamos la vista 3D para que el mapa siga fluido.' });
    await expect(notice).toBeVisible();
    await labIdle(page);
    await shoot(page, testInfo, 'ramp-3d-paused-1440');
    await notice.getByRole('button', { name: 'Volver a 3D' }).click();
    await drawn3d(page, map);
  });

  test('a lost WebGL context comes back with its 3D aircraft', async ({ page }, testInfo) => {
    const map = await openLab(page, `scene=ramp-3d-parked&t=${NOON}`);
    await drawn3d(page, map);
    await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').evaluate(node => new Promise(resolve => {
      const lose = node.getContext('webgl2').getExtension('WEBGL_lose_context');
      node.addEventListener('webglcontextlost', () => {
        setTimeout(() => {
          lose.restoreContext();
          resolve();
        }, 50);
      }, { once: true });
      lose.loseContext();
    }));
    await expect(map).toHaveAttribute('data-occ-engine', 'ready');
    await drawn3d(page, map);
    await labIdle(page);
    await shoot(page, testInfo, 'ramp-3d-context-restored-1440');
  });

  test('a browser without WebGL keeps the list of the fallback', async ({ page }, testInfo) => {
    await openLab(page, 'scene=unavailable-fallback', { drawn: false });
    await expect(page.getByTestId('map-unavailable')).toBeVisible();
    await expect(page.getByTestId('map-3d-toggle')).toHaveCount(0);
    await shoot(page, testInfo, 'unavailable-fallback-3d-1440');
  });
});
