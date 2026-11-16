import { createOccApi } from './fixtures/occApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Mapa de posiciones as a work map (PR U5, design E.2 template B): the toolbar, «Lista de posiciones» as a dense table at
// the left, the map with the stand band under it and the inspector of the chosen stand docked at the right, with the
// synthetic OCC session and the stubbed API of the maps (fixtures/occApi.mjs). Photographed for review at 1920 × 1080
// and 1440 × 900 (owner decision 11): a stand chosen through the URL, the band open, and the table open with a stand.

const PAGE = '/admin-occ/positions-map';
const inspector = page => page.getByTestId('position-detail-drawer');

async function openPositions(page, isolation, { viewport, query = '' }) {
  const api = createOccApi();
  await openOccScreen(page, isolation, { path: `${PAGE}${query}`, api, viewport });
  const map = page.getByTestId('occ-map');
  await mapReady(map);
  await expect(page.getByTestId('positions-map-skeleton')).toHaveCount(0);
  return { api, map };
}

const settled = map => expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });
// The map's dock (its views and tools) in one row: the width it needs never passes the width it has.
async function expectDockFits(map) {
  const dock = await map.locator('.occ-map-dock').evaluate(node => ({ needs: node.scrollWidth, has: node.clientWidth }));
  expect(dock.needs, 'the dock fits its row').toBeLessThanOrEqual(dock.has + 1);
}

// Two boxes on screen share no pixel.
const apart = (left, right) => left.x + left.width <= right.x || right.x + right.width <= left.x
  || left.y + left.height <= right.y || right.y + right.height <= left.y;

test.describe('Mapa de posiciones as a work map', () => {
  for (const viewport of SCREEN_VIEWPORTS) {
    const size = `${viewport.width}×${viewport.height}`;

    test(`a stand chosen through the URL at ${size}`, async ({ page, isolation }, testInfo) => {
      const { map } = await openPositions(page, isolation, { viewport, query: '?stand=A3' });
      await expect(inspector(page)).toBeVisible();
      await expect(inspector(page).getByText('A3').first()).toBeVisible();
      await expect(inspector(page).getByRole('button', { name: 'Cerrar detalle' })).toBeVisible();
      const [mapBox, inspectorBox] = await Promise.all([map.boundingBox(), inspector(page).boundingBox()]);
      expect(apart(mapBox, inspectorBox), 'the inspector beside the map, never over it').toBe(true);
      await settled(map);
      await expectDockFits(map);
      // The link's stand is brought to the centre of the map once it is ready (the screenshot shows it).
      await shoot(page, testInfo, `u5-posiciones-posicion-${viewport.width}`);
      await inspector(page).getByRole('button', { name: 'Cerrar detalle' }).click();
      await expect(inspector(page)).toHaveCount(0);
    });

    test(`the stand band open at ${size}`, async ({ page, isolation }, testInfo) => {
      const { map } = await openPositions(page, isolation, { viewport });
      const toggle = page.getByRole('button', { name: 'Banda de posiciones' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      const band = page.getByRole('group', { name: 'Posiciones en el tiempo' });
      await expect(band).toBeVisible();
      await page.getByRole('group', { name: 'Posiciones de la banda' }).getByRole('button', { name: 'Todas' }).click();
      await settled(map);
      await shoot(page, testInfo, `u5-posiciones-banda-${viewport.width}`);
    });

    test(`the stand table open with a stand chosen at ${size}`, async ({ page, isolation }, testInfo) => {
      const { map } = await openPositions(page, isolation, { viewport });
      const list = page.getByRole('button', { name: 'Lista de posiciones', exact: true });
      await list.click();
      await expect(list).toHaveAttribute('aria-pressed', 'true');
      const item = page.getByTestId('position-list-item').filter({ hasText: /^A3/ }).first();
      await item.click();
      await expect(inspector(page)).toBeVisible();
      await expect(item).toHaveAttribute('aria-selected', 'true');
      await settled(map);
      await expectDockFits(map);
      // Below 1536 px the list folds away while the inspector is open, so the map keeps its room.
      const column = page.locator('[data-occ-positions-list]');
      if (viewport.width < 1536) await expect(column).toBeHidden();
      else await expect(column).toBeVisible();
      await shoot(page, testInfo, `u5-posiciones-tabla-${viewport.width}`);
    });
  }
});
