import { createOccApi } from './fixtures/occApi.mjs';
import { openOccScreen } from './occScreen.mjs';
import { VIEW_LABELS, mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Mapa de posiciones fixed on PUJ (lane M9, 27 de noviembre de 2026): the screen opens in 3D on «Aeródromo» centred on
// the ARP, offers only Aeródromo and Rampa, and draws the airport in 3D: the terminals extruded to their estimated
// heights with their labels («15 m est.»), the jet bridges of B20–B26, the taxiway pavement with its estimated width and
// the parked aircraft with their livery. Photographed for review at 1366 × 768 and 1920 × 1080, in the dark run and in
// the light one (OCC_VISUAL_THEME=light): the whole airfield, terminal B at Rampa and its fingers up close. No image
// baseline is committed.

const PAGE = '/admin-occ/positions-map';
const VIEWPORTS = Object.freeze([{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]);
const legendItems = map => map.getByRole('list', { name: 'Leyenda' }).getByRole('listitem');
const settled = map => expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });

async function openPositions(page, isolation, { viewport, query = '' }) {
  await openOccScreen(page, isolation, { path: `${PAGE}${query}`, api: createOccApi(), viewport });
  const map = page.getByTestId('occ-map');
  await mapReady(map);
  await expect(page.getByTestId('positions-map-skeleton')).toHaveCount(0);
  return map;
}

async function setLegend(map, open) {
  const toggle = map.getByRole('button', { name: 'Leyenda', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(open));
}

test.describe('Mapa de posiciones: the airport of PUJ in 3D', () => {
  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}×${viewport.height}`;

    test(`opens in 3D on Aeródromo with the estimated structures at ${size}`, async ({ page, isolation }, testInfo) => {
      const map = await openPositions(page, isolation, { viewport });
      await expect(map).toHaveAttribute('data-occ-view', 'airfield');
      await expect(page.getByRole('button', { name: 'Cambiar a vista 2D' })).toHaveAttribute('aria-pressed', 'true');
      const views = map.getByRole('group', { name: 'Vista del mapa' });
      await expect(views.getByRole('button', { name: VIEW_LABELS.airfield, exact: true })).toBeVisible();
      await expect(views.getByRole('button', { name: VIEW_LABELS.ramp, exact: true })).toBeVisible();
      await expect(views.getByRole('button', { name: VIEW_LABELS.region, exact: true })).toHaveCount(0);
      await expect(views.getByRole('button', { name: VIEW_LABELS.approach, exact: true })).toHaveCount(0);
      await settled(map);
      await setLegend(map, true);
      await expect(legendItems(map)).toContainText(['Terminal (altura est.)']);
      await shoot(page, testInfo, `m9-aeropuerto-3d-${viewport.width}`);
      await setLegend(map, false);
      await settled(map);
      await shoot(page, testInfo, `m9-aeropuerto-3d-sin-leyenda-${viewport.width}`);
    });

    test(`terminal B, its fingers and the parked aircraft at Rampa in 3D at ${size}`, async ({ page, isolation }, testInfo) => {
      const map = await openPositions(page, isolation, { viewport, query: '?view=ramp&terminal=B' });
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await setLegend(map, true);
      await expect(legendItems(map)).toContainText(['Finger (pasarela, est.)']);
      await setLegend(map, false);
      await settled(map);
      await shoot(page, testInfo, `m9-terminal-b-3d-${viewport.width}`);
      // Up close on the fingers: the page's search brings B23 to the middle of the map, a step past the ramp view; its
      // drawer closes and the search is cleared.
      const field = page.getByPlaceholder('Buscar posición, vuelo o matrícula...');
      await field.fill('B23');
      await field.press('Enter');
      const drawer = page.getByTestId('position-detail-drawer');
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await field.fill('');
      await settled(map);
      await shoot(page, testInfo, `m9-terminal-b-cerca-3d-${viewport.width}`);
    });
  }
});
