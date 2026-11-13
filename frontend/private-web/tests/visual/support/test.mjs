import { expect, test as base } from 'playwright/test';
import { isolate } from './isolate.mjs';

/** Whether the suite runs against a production build (OCC_VISUAL_TARGET=production) rather than `next dev`. */
export const production = process.env.OCC_VISUAL_TARGET === 'production';

// Every test of the visual suite runs isolated (support/isolate.mjs), and fails when a request left for an origin the
// suite does not answer or a label needed a glyph range the fixtures lack. The second parameter of a fixture is not
// called `use`: the React hooks lint rule would read it as a hook.
export const test = base.extend({
  isolation: [async ({ page, baseURL }, provide) => {
    const isolation = await isolate(page, { origin: new URL(baseURL).origin });
    await provide(isolation);
    expect(isolation.unexpected, 'requests to an origin the suite does not answer').toEqual([]);
    expect(isolation.glyphMisses, 'glyph ranges the fixtures do not have').toEqual([]);
  }, { auto: true }],
});

export { expect };
