import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The weather of PR M8 in Chrome (design E6, contracts 2.3, 2.4 and 2.5): the GOES-East clouds and the IMERG rain of
// NASA GIBS on the one canvas, pinned to the time of their image, and the wind at the airfield, live, stale and missing,
// photographed in the weather scenes of the lab (synthetic weather, a simulated GIBS whose tiles the suite answers with
// an invented picture, no provider) at the laptop sizes of the presentation, 1440 × 900 and 1920 × 1080, for a person
// to review in test-results/visual. Beside the pictures it checks what must hold on every one: the legend lists the
// weather only while it is on screen, each credit shows only with what it credits, and the wind's tooltip says it.

const SIZES = Object.freeze([[1440, 900], [1920, 1080]]);
const CLOUDS = 'Nubes por satélite (GOES-East, infrarrojo)';
const RAIN = 'Lluvia estimada (IMERG)';
const WIND = 'Viento en pista';
const GOES_TIME = '2026-11-13T14:50:00Z';
const IMERG_TIME = '2026-11-13T14:30:00Z';

const legend = page => page.getByRole('list', { name: 'Leyenda' });
const legendEntry = (page, text) => legend(page).getByRole('listitem').filter({ hasText: text });
// The map's credits: MapLibre keeps them in its attribution control, folded or open.
const credits = page => page.locator('.maplibregl-ctrl-attrib-inner');
const tooltip = page => page.getByRole('tooltip');

// Puts the pointer on the wind the lab draws by the airfield (window.__occMapLab.windAt).
async function hoverWind(page) {
  const point = await page.evaluate(() => window.__occMapLab.project(window.__occMapLab.windAt()));
  expect(point, 'the pixel of the wind').not.toBeNull();
  const box = await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').boundingBox();
  await page.mouse.move(box.x + point.x, box.y + point.y);
}

test.describe('map lab weather', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of the satellite images and of the wind, live and stale, at 1440 × 900 and 1920 × 1080', async ({ page, isolation }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });

      // The region with the clouds and the rain on, under the references and the mixed traffic.
      const region = await openLab(page, `scene=region-satellite&t=${NOON}`);
      await expect(region).toHaveAttribute('data-occ-view', 'region');
      await labIdle(page);
      await expect(legendEntry(page, CLOUDS)).toHaveText(`${CLOUDS}Imagen de las 10:50`);
      await expect(legendEntry(page, RAIN)).toHaveText(`${RAIN}Imagen de las 10:30`);
      await expect(credits(page)).toContainText('NASA GIBS');
      // The images came after the map's first frame: wait for their tiles too.
      await labIdle(page);
      // Every tile asked of GIBS is pinned to the time of its image; the isolation answers no other.
      const tiles = isolation.requests.filter(entry => entry.kind === 'satellite').map(entry => entry.url);
      expect(tiles.length).toBeGreaterThan(0);
      for (const url of tiles) expect(url).toMatch(new RegExp(`/default/(${GOES_TIME}|${IMERG_TIME})/`));
      expect(tiles.some(url => url.includes('GOES-East'))).toBe(true);
      expect(tiles.some(url => url.includes('IMERG'))).toBe(true);
      await shoot(page, testInfo, `region-satellite-${width}`);

      // In Aeródromo the images belong to the wider views: they leave the map, the legend and the credits.
      await page.evaluate(() => window.__occMapLab.flyToPreset('airfield'));
      await expect(region).toHaveAttribute('data-occ-view', 'airfield');
      await labIdle(page);
      await expect(legendEntry(page, CLOUDS)).toHaveCount(0);
      await expect(legendEntry(page, RAIN)).toHaveCount(0);
      await expect(credits(page)).not.toContainText('NASA GIBS');

      // The wind of a live METAR by the airfield: its arrow and «100° 13 kt R08», «No oficial» in the legend and the
      // credit of NOAA while it is on screen.
      const live = await openLab(page, `scene=airfield-wind-live&t=${NOON}`);
      await expect(live).toHaveAttribute('data-occ-view', 'airfield');
      await labIdle(page);
      await expect(legendEntry(page, WIND)).toHaveText(`${WIND}No oficial`);
      await expect(credits(page)).toContainText('Clima: NOAA Aviation Weather Center');
      await expect(credits(page)).not.toContainText('NASA GIBS');
      await shoot(page, testInfo, `airfield-wind-live-${width}`);
      // Its tooltip: the wind with «No oficial», the time of its METAR and the wind on every runway end.
      await hoverWind(page);
      await expect(tooltip(page)).toHaveAttribute('data-kind', 'wind');
      await expect(tooltip(page)).toContainText('Viento 100° 13 kt · No oficial');
      await expect(tooltip(page)).toContainText('METAR de las 10:50');
      await expect(tooltip(page)).toContainText('R08: 12 kt de frente · 6 kt de la derecha');
      await expect(tooltip(page)).toContainText('R27: 13 kt de cola · 3 kt de la izquierda');
      await shoot(page, testInfo, `airfield-wind-tooltip-${width}`);

      // A stale METAR: the wind dimmed, «Sin actualizar» in the legend and the time of its METAR in the tooltip.
      await openLab(page, `scene=airfield-wind-stale&t=${NOON}`);
      await labIdle(page);
      await expect(legendEntry(page, WIND)).toHaveText(`${WIND}Sin actualizar`);
      await shoot(page, testInfo, `airfield-wind-stale-${width}`);
      await hoverWind(page);
      await expect(tooltip(page)).toContainText('Sin actualizar desde las 08:00');
    }
  });

  test('without a METAR there is no wind, and the layers menu says why', async ({ page }, testInfo) => {
    await openLab(page, `scene=airfield-wind-unavailable&t=${NOON}`);
    await labIdle(page);
    await expect(legendEntry(page, WIND)).toHaveCount(0);
    await expect(credits(page)).not.toContainText('NOAA');
    // Nothing answers the pointer where the wind would be.
    await hoverWind(page);
    await expect(tooltip(page)).toHaveCount(0);
    // The menu's Meteorología group, after Referencias: the wind on by default in Aeródromo, and why it shows nothing.
    await page.getByRole('button', { name: 'Capas' }).click();
    const meteorology = page.getByRole('group', { name: 'Meteorología' });
    await expect(meteorology.getByRole('checkbox')).toHaveCount(3);
    await expect(meteorology.getByRole('checkbox', { name: 'Viento en pista' })).toBeChecked();
    await expect(meteorology.getByRole('checkbox', { name: 'Viento en pista' }))
      .toHaveAccessibleDescription('No hay clima del aeródromo en este momento.');
    await expect(meteorology.getByRole('checkbox', { name: 'Nubes por satélite' })).not.toBeChecked();
    // The clouds turned on outside Región and Aproximación say where they show; nothing is read from GIBS here.
    await meteorology.getByRole('checkbox', { name: 'Nubes por satélite' }).check();
    await expect(meteorology.getByRole('checkbox', { name: 'Nubes por satélite' }))
      .toHaveAccessibleDescription('Se ve en Región y Aproximación');
    await labIdle(page);
    await shoot(page, testInfo, 'airfield-wind-unavailable-layers-menu-1440');
  });
});
