import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { AUTH_STORAGE_KEY, occSession } from './fixtures/occApi.mjs';
import { expect } from '../support/test.mjs';

// How the visual suite opens an OCC work screen (PR U6): a synthetic OCC session of PUJ, the stub API of the screen,
// and the tab already past the boot screen, as when the screen is opened from another module. Without that mark the
// boot screen (PR U4) would cover the page until 6 s after the access loaded.

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
