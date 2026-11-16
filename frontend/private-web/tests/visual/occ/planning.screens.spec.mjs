import { createMonitoringApi } from './fixtures/monitoringApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Planificación as a work table (PR U5, design E.2 template C): the toolbar with «Nuevo vuelo», «Importar vuelos» and
// «Actualizar», the figures of the day, and the four views («Línea de tiempo», «Posiciones», «Tabla», «Mapa»), with the
// synthetic OCC session and the day of fixtures/monitoringApi.mjs (a planning snapshot built from the map flights).
// Photographed at 1920 × 1080 and 1440 × 900: each view, the drawer of a turnaround and «Importar vuelos» (whose
// provider proposals the stub does not serve: the dialog shows its recoverable error, never a provider read).

const PAGE = '/admin-occ/planning';
const views = page => page.getByRole('group', { name: 'Vistas de planificación' });

async function openPlanning(page, isolation, viewport) {
  const api = createMonitoringApi();
  await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  await expect(page.getByRole('heading', { level: 1, name: 'Planificación Operativa' })).toBeVisible();
  await expect(page.getByTestId('flight-card').first()).toBeVisible();
  return api;
}

test.describe('Planificación as a work table', () => {
  for (const viewport of SCREEN_VIEWPORTS) {
    const size = `${viewport.width}×${viewport.height}`;

    test(`the four views at ${size}`, async ({ page, isolation }, testInfo) => {
      await openPlanning(page, isolation, viewport);
      await shoot(page, testInfo, `u5-planificacion-linea-${viewport.width}`);
      await views(page).getByRole('button', { name: 'Posiciones', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Posiciones del día' })).toBeVisible();
      await shoot(page, testInfo, `u5-planificacion-posiciones-${viewport.width}`);
      await views(page).getByRole('button', { name: 'Tabla', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Escalas del día' })).toBeVisible();
      await shoot(page, testInfo, `u5-planificacion-tabla-${viewport.width}`);
      await views(page).getByRole('button', { name: 'Mapa', exact: true }).click();
      const map = page.getByTestId('occ-map');
      await mapReady(map);
      await expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });
      await shoot(page, testInfo, `u5-planificacion-mapa-${viewport.width}`);
    });

    test(`the drawer of a turnaround and «Importar vuelos» at ${size}`, async ({ page, isolation }, testInfo) => {
      await openPlanning(page, isolation, viewport);
      await page.getByTestId('flight-card').first().click();
      const drawer = page.getByRole('dialog').first();
      await expect(drawer).toBeVisible();
      await page.waitForTimeout(500);
      await shoot(page, testInfo, `u5-planificacion-cajon-${viewport.width}`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Importar vuelos' }).click();
      const dialog = page.getByRole('dialog', { name: 'Importar vuelos del proveedor' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Cargando vuelos propuestos…')).toBeHidden();
      await shoot(page, testInfo, `u5-planificacion-importar-${viewport.width}`);
    });
  }
});
