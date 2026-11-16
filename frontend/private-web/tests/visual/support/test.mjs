import { expect, test as base } from 'playwright/test';
import { THEME_STORAGE_KEY } from '../../../src/features/shell/occTheme.js';
import { isolate } from './isolate.mjs';

/** Whether the suite runs against a production build (OCC_VISUAL_TARGET=production) rather than `next dev`. */
export const production = process.env.OCC_VISUAL_TARGET === 'production';

/**
 * The theme the suite photographs: dark (the OCC's default) or, with OCC_VISUAL_THEME=light, the light theme the
 * account chose (ADR-0044, note of 2026-11-15), stored before the page loads as the theme button stores it. The
 * screenshots of the light run end in `-light`.
 */
export const theme = process.env.OCC_VISUAL_THEME === 'light' ? 'light' : 'dark';

// Every test of the visual suite runs isolated (support/isolate.mjs), and fails when a request left for an origin the
// suite does not answer or a label needed a glyph range the fixtures lack. The second parameter of a fixture is not
// called `use`: the React hooks lint rule would read it as a hook.
export const test = base.extend({
  isolation: [async ({ page, baseURL }, provide) => {
    const isolation = await isolate(page, { origin: new URL(baseURL).origin });
    if (theme === 'light') {
      await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [THEME_STORAGE_KEY, theme]);
    }
    await provide(isolation);
    expect(isolation.unexpected, 'requests to an origin the suite does not answer').toEqual([]);
    expect(isolation.glyphMisses, 'glyph ranges the fixtures do not have').toEqual([]);
  }, { auto: true }],
});

export { expect };
