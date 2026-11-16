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
