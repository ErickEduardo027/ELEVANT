import { createOccApi } from './fixtures/occApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Mapa de posiciones as a work map (PR U5, design E.2 template B): the toolbar, «Lista de posiciones» as a dense table at
// the left, the map with the stand band under it and the inspector of the chosen stand docked at the right, with the
// synthetic OCC session and the stubbed API of the maps (fixtures/occApi.mjs). Photographed for review at 1920 × 1080
// and 1440 × 900 (owner decision 11): a stand chosen through the URL, the band open, and the table open with a stand;
// and (N29) A11 chosen beside A10, in 2D and in 3D.

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

// The page's map tools (2D/3D, «Centrar PUJ» and full screen) are one opaque block (N29): one box holds the three, with
// a background of its own that lets nothing of the map through, between the tools or behind them.
async function expectOneToolBlock(page) {
  const view = page.getByRole('button', { name: /^Cambiar a vista [23]D$/ });
  const tools = await view.locator('xpath=..').evaluate(block => ({
    background: getComputedStyle(block).backgroundColor,
    names: [...block.children].map(child => child.getAttribute('aria-label')),
  }));
  expect(tools.names).toEqual([expect.stringMatching(/^Cambiar a vista [23]D$/), 'Centrar PUJ', 'Pantalla completa']);
  expect(tools.background, 'an opaque background, never one with an alpha').toMatch(/^rgb\(/);
}

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

    // N29 (19 de noviembre de 2026): A11 chosen beside A10, in 2D and in 3D. The chosen stand's cyan label takes only its
    // own room, so A10 keeps its label, and the page's map tools are one opaque block. The screenshots are for review:
    // no image baseline is committed.
    test(`A11 chosen beside A10, in 2D and 3D, at ${size}`, async ({ page, isolation }, testInfo) => {
      const { map } = await openPositions(page, isolation, { viewport, query: '?stand=A11' });
      await expect(inspector(page).getByText('A11').first()).toBeVisible();
      await settled(map);
      await shoot(page, testInfo, `n29-posiciones-a11-2d-${viewport.width}`);
      await expectOneToolBlock(page);

      await page.getByRole('button', { name: 'Cambiar a vista 3D' }).click();
      await expect(page.getByRole('button', { name: 'Cambiar a vista 2D' })).toHaveAttribute('aria-pressed', 'true');
      // The compass of the map's own controls leans with the camera (visualizePitch): the tilt of 3D has been applied.
      await expect(map.locator('.maplibregl-ctrl-compass .maplibregl-ctrl-icon'))
        .toHaveAttribute('style', /rotateX\([3-9]\d(?:\.\d+)?deg\)/);
      await settled(map);
      await shoot(page, testInfo, `n29-posiciones-a11-3d-${viewport.width}`);
      await expectOneToolBlock(page);
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
