import path from 'node:path';
import { expect } from 'playwright/test';

// Helpers for an OCC map on screen. OccMap writes its state on its root (data-testid="occ-map"): data-occ-engine
// (starting · ready · unavailable), data-occ-basemap (off · loading · ok · degraded), data-occ-view (the view the
// camera really shows) and data-occ-zoom (after every move). The lab adds window.__occMapLab.

/** The frozen clock of the screenshots. */
export const NOON = '2026-11-13T15:00:00.000Z';

export const VIEW_LABELS = Object.freeze({
  region: 'Región', approach: 'Aproximación', airfield: 'Aeródromo', ramp: 'Rampa',
});

/** The view the URL of the page names. */
export const viewInUrl = page => new URL(page.url()).searchParams.get('view');

/** The zoom the map reported after its last move. */
export async function zoomOf(map) {
  return Number(await map.getAttribute('data-occ-zoom'));
}

/** Waits until the map at `map` (the occ-map root) can draw and has framed its first view. */
export async function mapReady(map) {
  await expect(map).toHaveAttribute('data-occ-engine', 'ready');
  await expect(map).toHaveAttribute('data-occ-zoom', /^\d+(\.\d+)?$/);
}

/** Opens a scene of the map lab and waits for the map, or for its fallback when `drawn` is false. */
export async function openLab(page, query, { drawn = true } = {}) {
  const response = await page.goto(`/map-lab?${query}`);
  expect(response?.status(), `GET /map-lab?${query}`).toBe(200);
  await expect(page.locator('[data-occ-map-lab="v1"]')).toBeVisible();
  const map = page.getByTestId('occ-map');
  if (!drawn) {
    await expect(map).toHaveAttribute('data-occ-engine', 'unavailable');
    return map;
  }
  await mapReady(map);
  await expect.poll(() => page.evaluate(() => window.__occMapLab?.liveMaps() ?? 0)).toBe(1);
  return map;
}

/** Resolves once the lab's map has drawn a frame with nothing left to load or move. */
export async function labIdle(page) {
  expect(await page.evaluate(() => window.__occMapLab.whenIdle())).toBe(true);
}

/** Clicks a stand of the lab's scene where the map draws it. */
export async function clickStand(page, code) {
  const point = await page.evaluate(stand => window.__occMapLab.project(stand), code);
  expect(point, `the pixel of ${code}`).not.toBeNull();
  const box = await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

/** The path of a screenshot for review: test-results/visual/<name>.png. */
export const screenshotPath = (testInfo, name) => path.join(testInfo.project.outputDir, `${name}.png`);

// The indicator `next dev` puts in a corner of every page is not part of the screen under review.
const WITHOUT_DEV_INDICATOR = 'nextjs-portal { display: none !important; }';

/** Writes a screenshot of the page for review to test-results/visual/<name>.png. */
export async function shoot(page, testInfo, name) {
  await page.screenshot({ path: screenshotPath(testInfo, name), style: WITHOUT_DEV_INDICATOR });
}
