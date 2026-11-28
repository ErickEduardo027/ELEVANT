import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { AUTH_STORAGE_KEY, occSession } from './fixtures/occApi.mjs';
import { occColor } from '../../../src/features/occ-ui/occPalette.js';
import { expect, theme } from '../support/test.mjs';

// How the visual suite opens an OCC work screen (PR U6): a synthetic OCC session of PUJ, the stub API of the screen,
// and the tab already past the boot screen, as when the screen is opened from another module. Without that mark the
// boot screen (PR U4) would cover the page until 6 s after the access loaded.

/**
 * The computed CSS colour of an opaque OCC token in the theme the suite photographs (OCC_VISUAL_THEME), as
 * `toHaveCSS` reads it: `occRgb('--occ-danger')` is `rgb(245, 116, 109)` in the dark theme.
 */
export function occRgb(token) {
  const hex = occColor(token, theme);
  const [r, g, b] = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The two windows every work screen is reviewed in: the laptop of the presentation and the 1080p screen. */
export const SCREEN_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1920, height: 1080 }),
  Object.freeze({ width: 1440, height: 900 }),
]);

/**
 * Opens `path` with `api` (an object whose `handle` answers support/isolate.mjs) at `viewport`, and waits for the
 * frame's main region: the shell's `#main-content`, never the plain status screens that the session and access checks
 * draw before it. The boot screen stays away. Returns the main region.
 */
export async function openOccScreen(page, isolation, { path, api, viewport }) {
  if (viewport) await page.setViewportSize(viewport);
  isolation.setApi(api.handle);
  await page.addInitScript(([authKey, bootSeenKey, session]) => {
    window.localStorage.setItem(authKey, JSON.stringify(session));
    window.sessionStorage.setItem(bootSeenKey, String(session.accountId));
  }, [AUTH_STORAGE_KEY, OCC_BOOT_SEEN_KEY, occSession()]);
  const response = await page.goto(path);
  expect(response?.status(), `GET ${path}`).toBe(200);
  const main = page.locator('main#main-content');
  await expect(main).toBeVisible();
  await expect(page.getByTestId('occ-boot-screen'), 'the OCC boot screen').toHaveCount(0, { timeout: 1_000 });
  return main;
}

// Two boxes on screen share no pixel.
const apart = (one, other) => one.x + one.width <= other.x + 0.5 || other.x + other.width <= one.x + 0.5
  || one.y + one.height <= other.y + 0.5 || other.y + other.height <= one.y + 0.5;

/** The map's own control column (M1): MapLibre's zoom group at its top right corner and the rail under it. */
export const controlColumn = map => ({
  zoom: map.locator('.maplibregl-ctrl-top-right .maplibregl-ctrl-group').first(),
  rail: map.locator('.occ-map-dock'),
});

/**
 * The full-screen map with floating panels (M1, which replaces CN-32's docked template B), checked on screen: the map
 * fills the frame's main region; the control column sits at its true right edge (the zoom group and the rail 12 px from
 * it); every panel of `panels` (visible locators, open or folded to their pills) floats over the map at least 12 px from
 * its edges, never over the zoom group or the rail, and a panel at the right ends 12 px left of the rail. Returns the
 * boxes, for the spec's own checks.
 */
export async function expectFloatingLayout(page, map, panels) {
  const { zoom, rail } = controlColumn(map);
  const [mainBox, mapBox, zoomBox, railBox] = await Promise.all([page.locator('main#main-content').boundingBox(),
    map.boundingBox(), zoom.boundingBox(), rail.boundingBox()]);
  expect(Math.round(mapBox.x), 'the map starts at the left of main').toBe(Math.round(mainBox.x));
  expect(Math.round(mapBox.y), 'the map starts at the top of main').toBe(Math.round(mainBox.y));
  expect(Math.round(mapBox.width), 'the map as wide as main').toBe(Math.round(mainBox.width));
  expect(Math.round(mapBox.height), 'the map as tall as main').toBe(Math.round(mainBox.height));
  const mapRight = mapBox.x + mapBox.width;
  expect(Math.round(mapRight - (zoomBox.x + zoomBox.width)), 'the zoom group 12 px from the right edge').toBe(12);
  expect(Math.round(mapRight - (railBox.x + railBox.width)), 'the rail 12 px from the right edge').toBe(12);
  expect(Math.round(zoomBox.y - mapBox.y), 'the zoom group 12 px from the top edge').toBe(12);
  const boxes = {};
  for (const [name, locator] of Object.entries(panels)) {
    const box = await locator.boundingBox();
    expect(box, `${name} on screen`).not.toBeNull();
    boxes[name] = box;
    expect(box.x - mapBox.x, `${name} 12 px from the left edge`).toBeGreaterThanOrEqual(11.5);
    expect(box.y - mapBox.y, `${name} 12 px from the top edge`).toBeGreaterThanOrEqual(11.5);
    expect(mapBox.y + mapBox.height - (box.y + box.height), `${name} 12 px from the bottom edge`)
      .toBeGreaterThanOrEqual(11.5);
    expect(railBox.x - (box.x + box.width), `${name} 12 px left of the rail`).toBeGreaterThanOrEqual(11.5);
    expect(apart(box, zoomBox), `${name} clear of the zoom group`).toBe(true);
    expect(apart(box, railBox), `${name} clear of the rail`).toBe(true);
  }
  return { mapBox, railBox, zoomBox, boxes };
}
