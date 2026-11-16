import { NOON, labIdle, openLab, shoot, zoomOf } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The references of PR M8 in Chrome (design E6, contracts 2.3 and 2.4): the range rings, the region's airports with
// today's counterpart, the extended centrelines with the runway in use, the navaids and the night, photographed in the
// reference scenes of the lab (synthetic weather and traffic, no provider) at the laptop sizes of the presentation,
// 1440 × 900 and 1920 × 1080, for a person to review in test-results/visual. Beside the pictures it checks what must hold
// on every one: the legend lists each reference only while it is on screen, the layers menu shows and hides them, and
// the credit of OurAirports shows only while something drawn from its data is on screen (design A7).

const SIZES = Object.freeze([[1440, 900], [1920, 1080]]);
// 18:15 in Punta Cana: dusk, the edge of the civil twilight inside the Región view (lab/scenes.js).
const DUSK = '2026-11-13T22:15:00.000Z';
const RINGS = 'Anillos de distancia';
// The region's airports are listed by kind while their key is on (ui/MapLegend.jsx): Santo Domingo is international.
const AIRPORT = 'Aeropuerto internacional';
const COUNTERPART = 'Origen o destino de un vuelo de hoy';
const CENTRELINES = 'Eje de pista extendido (marca cada NM)';
const RUNWAY_BY_WIND = 'Pista 08 (estimada por el viento)';
const NIGHT = 'Noche (tras el crepúsculo civil)';
const VOR = 'Radioayuda VOR-DME';
const NDB = 'Radioayuda NDB';

const legend = page => page.getByRole('list', { name: 'Leyenda' });
const legendEntry = (page, text) => legend(page).getByRole('listitem').filter({ hasText: text });

test.describe('map lab references', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of the references by day, at dusk and on the approach at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });

      // The region by day: the rings, the airports with Santo Domingo emphasised, and the mixed traffic over them.
      const region = await openLab(page, `scene=region-references&t=${NOON}`);
      await expect(region).toHaveAttribute('data-occ-view', 'region');
      await expect(region).toHaveAttribute('data-occ-basemap', 'ok');
      await labIdle(page);
      await expect(legendEntry(page, RINGS)).toHaveCount(1);
      await expect(legendEntry(page, AIRPORT)).toHaveCount(1);
      await expect(legendEntry(page, COUNTERPART)).toHaveCount(1);
      // At 11:00 the night is far from the region; the traffic is listed first.
      await expect(legendEntry(page, NIGHT)).toHaveCount(0);
      await expect(legend(page).getByRole('listitem').first()).toHaveText('Vuelo de AVIAM que llega');
      await shoot(page, testInfo, `region-references-${width}`);

      // The region at dusk: the night has reached Puerto Rico, and the legend explains it.
      const dusk = await openLab(page, `scene=region-references-night&t=${DUSK}`);
      await expect(dusk).toHaveAttribute('data-occ-view', 'region');
      await labIdle(page);
      await expect(legendEntry(page, NIGHT)).toHaveCount(1);
      await expect(legendEntry(page, RINGS)).toHaveCount(1);
      await shoot(page, testInfo, `region-references-night-${width}`);

      // The approach: the rings, the centrelines with 08 in use from the METAR's wind, the navaids, the demo on final.
      const approach = await openLab(page, `scene=approach-references&t=${NOON}`);
      await expect(approach).toHaveAttribute('data-occ-view', 'approach');
      await labIdle(page);
      await expect(legendEntry(page, RINGS)).toHaveCount(1);
      await expect(legendEntry(page, CENTRELINES)).toHaveCount(1);
      await expect(legendEntry(page, RUNWAY_BY_WIND)).toHaveCount(1);
      await shoot(page, testInfo, `approach-references-${width}`);
      // Both navaids stand on the airport, by the mark of PUJ: their symbols are always drawn there, and two steps closer,
      // still in Aproximación, PNA has room for its ident and frequency.
      await expect(legendEntry(page, VOR)).toHaveCount(1);
      await expect(legendEntry(page, NDB)).toHaveCount(1);
      const approachZoom = await zoomOf(approach);
      await page.evaluate(zoom => window.__occMapLab.jumpTo({ zoom }), approachZoom + 2);
      await expect(approach).toHaveAttribute('data-occ-view', 'approach');
      await labIdle(page);
      await expect(legendEntry(page, VOR)).toHaveCount(1);
      await shoot(page, testInfo, `approach-references-navaids-${width}`);
      // In Aeródromo the stands are polygons: no navaid sits over them (PCA lies by terminal A), and the rings, the
      // centrelines and the airports belong to the wider views.
      await page.evaluate(() => window.__occMapLab.flyToPreset('airfield'));
      await expect(approach).toHaveAttribute('data-occ-view', 'airfield');
      await labIdle(page);
      for (const text of [VOR, NDB, RINGS, CENTRELINES, AIRPORT]) await expect(legendEntry(page, text), text).toHaveCount(0);
      await shoot(page, testInfo, `airfield-references-${width}`);
    }
  });

  test('the legend lists each reference only while it is on screen, and the layers menu shows and hides them', async ({ page }, testInfo) => {
    await openLab(page, `scene=approach-references&t=${NOON}`);
    await labIdle(page);
    // The layers menu has the Referencias group of design E7 after Tráfico, with the defaults of Aproximación.
    await page.getByRole('button', { name: 'Capas' }).click();
    const references = page.getByRole('group', { name: 'Referencias' });
    await expect(references).toBeVisible();
    await expect(references.getByRole('checkbox')).toHaveCount(5);
    for (const name of ['Anillos de distancia', 'Ejes de pista', 'Aeropuertos de la región', 'Radioayudas', 'Día y noche']) {
      await expect(references.getByRole('checkbox', { name }), name).toBeChecked();
    }
    await labIdle(page);
    await shoot(page, testInfo, 'approach-references-layers-menu-1440');
    // Without the centrelines the runway in use and its ticks leave the map and the legend.
    await references.getByRole('checkbox', { name: 'Ejes de pista' }).uncheck();
    await labIdle(page);
    await expect(legendEntry(page, CENTRELINES)).toHaveCount(0);
    await expect(legendEntry(page, RUNWAY_BY_WIND)).toHaveCount(0);
    await references.getByRole('checkbox', { name: 'Ejes de pista' }).check();
    await labIdle(page);
    await expect(legendEntry(page, RUNWAY_BY_WIND)).toHaveCount(1);
    // The choice is the difference from the view's default, kept in the browser; back to the default, nothing is kept.
    expect(await page.evaluate(() => window.localStorage.getItem('elevant-occ-map-layers:v1'))).toBeNull();
    await page.getByRole('button', { name: 'Capas' }).click();

    // The ramp shows none of them: the legend explains the stands and the airfield alone.
    await page.evaluate(() => window.__occMapLab.flyToPreset('ramp'));
    await labIdle(page);
    for (const text of [RINGS, CENTRELINES, RUNWAY_BY_WIND, AIRPORT, NIGHT]) {
      await expect(legendEntry(page, text), text).toHaveCount(0);
    }
    // The region by night shows its shade; by day, at the same place, there is none.
    await openLab(page, `scene=region-references-night&t=${DUSK}`);
    await labIdle(page);
    await expect(legendEntry(page, NIGHT)).toHaveCount(1);
    await openLab(page, `scene=region-references-night&t=${NOON}`);
    await labIdle(page);
    await expect(legendEntry(page, NIGHT)).toHaveCount(0);
  });

  test('credits OurAirports while its airports, navaids or centrelines are drawn, and only then', async ({ page }, testInfo) => {
    // The compact credits stay folded; their text is in the page all the same.
    const credits = page.locator('.maplibregl-ctrl-attrib-inner');
    const ourAirports = credits.locator('a', { hasText: 'OurAirports' });
    const references = page.getByRole('group', { name: 'Referencias' });
    const toggle = async (names, on) => {
      for (const name of names) await references.getByRole('checkbox', { name }).setChecked(on);
      await labIdle(page);
    };

    // Región draws the airports of the region and not the airfield: OurAirports is credited alone, once, with its link.
    // Opened, the credits are photographed at both laptop sizes for review.
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await openLab(page, `scene=region-references&t=${NOON}`);
      await labIdle(page);
      await expect(legendEntry(page, AIRPORT)).toHaveCount(1);
      await expect(ourAirports).toHaveCount(1);
      await expect(ourAirports).toHaveAttribute('href', 'https://ourairports.com/');
      await expect(credits).not.toContainText('(ODbL)');
      await page.getByTestId('map-lab-map').locator('summary.maplibregl-ctrl-attrib-button').click();
      await expect(credits).toBeVisible();
      await labIdle(page);
      await shoot(page, testInfo, `region-references-credits-${width}`);
    }
    // Without the airports and the navaids nothing of OurAirports is on screen (Región draws no navaid and no
    // centreline): its credit goes, the base map's stays. Back with the airports.
    await page.getByRole('button', { name: 'Capas' }).click();
    await toggle(['Aeropuertos de la región', 'Radioayudas'], false);
    await expect(legendEntry(page, AIRPORT)).toHaveCount(0);
    await expect(ourAirports).toHaveCount(0);
    await expect(credits).toContainText('© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles');
    await toggle(['Aeropuertos de la región'], true);
    await expect(ourAirports).toHaveCount(1);

    // Aproximación draws the centrelines too, from the runway ends of OurAirports: the credit stays while any of the
    // three is drawn, and goes with the last.
    await openLab(page, `scene=approach-references&t=${NOON}`);
    await labIdle(page);
    await expect(ourAirports).toHaveCount(1);
    await page.getByRole('button', { name: 'Capas' }).click();
    await toggle(['Aeropuertos de la región', 'Radioayudas'], false);
    await expect(legendEntry(page, CENTRELINES)).toHaveCount(1);
    await expect(ourAirports).toHaveCount(1);
    await toggle(['Ejes de pista'], false);
    await expect(ourAirports).toHaveCount(0);
    await toggle(['Aeropuertos de la región', 'Radioayudas', 'Ejes de pista'], true);
    await expect(ourAirports).toHaveCount(1);
  });
});
