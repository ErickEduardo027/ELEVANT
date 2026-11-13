import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// A screenshot of every scene of the lab, at 1440 × 900 with the clock frozen, written to
// test-results/visual/<scene>.png for a person to review. The base map is the invented world of
// support/syntheticTiles.mjs, so its colours show without a tile server. No image baseline is committed (they differ
// per machine and GPU) and nothing is compared here: the behaviour spec asserts what the map does.

// The scenes of M2; later PRs add theirs to the lab, and the index adds them here without a change.
const M2_SCENES = Object.freeze([
  'ramp-points', 'ramp-selected', 'airfield', 'approach', 'region', 'unavailable-fallback', 'basemap-degraded',
]);
// What the base map of each drawn scene must have reached before its picture is taken.
const BASEMAP_STATE = Object.freeze({ 'basemap-degraded': 'degraded' });

test.describe('map lab scenes', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of every scene written to test-results', async ({ page }, testInfo) => {
    await page.goto('/map-lab');
    const links = page.getByRole('list', { name: 'Escenas' }).getByRole('link');
    await expect(links.first()).toBeVisible();
    await shoot(page, testInfo, 'index');
    const scenes = await links.evaluateAll(nodes => nodes.map(node => new URL(node.href).searchParams.get('scene')));
    expect(scenes).toEqual(expect.arrayContaining(M2_SCENES));

    for (const scene of scenes) {
      const drawn = scene !== 'unavailable-fallback';
      const map = await openLab(page, `scene=${scene}&t=${NOON}`, { drawn });
      if (drawn) {
        await expect(map).toHaveAttribute('data-occ-basemap', BASEMAP_STATE[scene] ?? 'ok');
        await labIdle(page);
      } else {
        await expect(page.getByTestId('map-unavailable')).toBeVisible();
      }
      await shoot(page, testInfo, scene);
    }

    // The densest terminal up close, and the ramp without the base map, as ?basemap=none draws it.
    await openLab(page, `scene=ramp-points&view=ramp&terminal=B&t=${NOON}`);
    await labIdle(page);
    await shoot(page, testInfo, 'ramp-points-terminal-b');
    const bare = await openLab(page, `scene=ramp-points&basemap=none&t=${NOON}`);
    await expect(bare).toHaveAttribute('data-occ-basemap', 'off');
    await labIdle(page);
    await shoot(page, testInfo, 'ramp-points-basemap-none');

    // The presentation laptop's screen (owner decision 11): the ramp refits to the wider map.
    await page.setViewportSize({ width: 1920, height: 1080 });
    const wide = await openLab(page, `scene=ramp-points&t=${NOON}`);
    await expect(wide).toHaveAttribute('data-occ-view', 'ramp');
    await labIdle(page);
    await shoot(page, testInfo, 'ramp-points-1920');
  });
});
