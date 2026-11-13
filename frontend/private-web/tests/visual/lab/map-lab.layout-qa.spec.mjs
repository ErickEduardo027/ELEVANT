import { readFileSync } from 'node:fs';
import { buildTaxiGraph, shortestPath } from '../../../src/features/maps/airport/taxiGraph.js';
import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The review scene of the MDPC airport layout (src/features/maps/lab/LayoutQaScene.jsx) in Chrome, at 1440 × 900 with
// the clock frozen: one screenshot of the whole airfield, one per terminal and one per flagged stand, written to
// test-results/visual/layout-qa-*.png for the person who reviews the dataset (no baseline is committed and nothing is
// compared), and the route probe clicked on the map. The base map is the invented world of support/syntheticTiles.mjs.

// The airport layout the scene draws, read in Node as the generator wrote it.
const LAYOUT = JSON.parse(readFileSync(new URL('../../../src/features/maps/airport/data/mdpc.layout.json', import.meta.url), 'utf8'));

const standList = page => page.getByRole('list', { name: 'Posiciones del plano' });
// A row of the list by its stand code: its name starts with the code (A1 is not A10).
const standRow = (page, code) => standList(page).getByRole('button', { name: new RegExp(`^${code}(?!\\d)`, 'u') });

/** Clicks the graph node `nodeId` where the scene draws it. */
async function clickNode(page, nodeId) {
  const point = await page.evaluate(id => window.__occMapLab.project(id), nodeId);
  expect(point, `the pixel of ${nodeId}`).not.toBeNull();
  const box = await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

test.describe('map lab: review of the MDPC layout', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of the airfield, terminals A, B and FBO and every flagged stand written to test-results', async ({ page }, testInfo) => {
    const map = await openLab(page, `scene=layout-qa&t=${NOON}`);
    await expect(map).toHaveAttribute('data-occ-basemap', 'ok');
    await expect(map).toHaveAttribute('data-occ-view', 'airfield');
    await expect(standList(page).getByRole('button')).toHaveCount(LAYOUT.stands.length);
    await labIdle(page);
    await shoot(page, testInfo, 'layout-qa-airfield');

    for (const terminal of ['A', 'B', 'FBO']) {
      await page.evaluate(code => window.__occMapLab.flyToPreset('ramp', { terminal: code }), terminal);
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await labIdle(page);
      await shoot(page, testInfo, `layout-qa-terminal-${terminal.toLowerCase()}`);
    }

    // Each flagged stand framed with its lead-in, its gate and its OSM centroid, in the cyan casing of the review.
    const flagged = await page.evaluate(() => window.__occMapLab.qaFlagged());
    const listed = LAYOUT.stands.filter(stand => stand.qa.flags.some(flag => !['narrowed', 'headingAssumed'].includes(flag)));
    expect([...flagged].sort()).toEqual(listed.map(stand => stand.code).sort());
    for (const code of flagged) {
      expect(await page.evaluate(stand => window.__occMapLab.flyToStandBox(stand), code), code).toBe(true);
      await expect(standRow(page, code)).toHaveAttribute('aria-current', 'true');
      await labIdle(page);
      await shoot(page, testInfo, `layout-qa-stand-${code}`);
    }
  });

  test('the route probe draws the shortest taxi route between two clicked nodes with its length', async ({ page }, testInfo) => {
    await openLab(page, `scene=layout-qa&view=ramp&terminal=A&t=${NOON}`);
    await labIdle(page);
    const apron = LAYOUT.apronHolds.find(hold => hold.id === 'ah-a');
    const expected = shortestPath(buildTaxiGraph(LAYOUT.taxiGraph), 'st-A5', apron.node, { avoidKinds: ['runway'] });
    expect(expected).not.toBeNull();

    await clickNode(page, 'st-A5');
    await expect(page.getByText('Origen: posición A5. Haz clic en el nodo de destino.')).toBeVisible();
    await clickNode(page, apron.node);
    await expect(page.getByText(`Ruta: ${Math.round(expected.lengthM)} m`)).toBeVisible();
    await expect(page.getByText('Desde posición A5 hasta espera de plataforma A', { exact: false })).toBeVisible();
    await labIdle(page);
    await shoot(page, testInfo, 'layout-qa-route');

    // «Borrar ruta» empties the probe; the map stays the same one.
    await page.getByRole('button', { name: 'Borrar ruta' }).click();
    await expect(page.getByText('Haz clic en dos nodos del grafo para medir la ruta por las calles de rodaje.')).toBeVisible();
    expect(await page.evaluate(() => window.__occMapLab.liveMaps())).toBe(1);
  });
});
