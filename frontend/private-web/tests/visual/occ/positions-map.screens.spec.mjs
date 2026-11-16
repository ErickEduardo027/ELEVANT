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
      await shoot(page, testInfo, `u5-posiciones-tabla-${viewport.width}`);
    });
  }
});
