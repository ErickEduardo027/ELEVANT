import { readFileSync } from 'node:fs';
import { NOON, labIdle, openLab, shoot, zoomOf } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The stands of the ramp as polygons with their state (PR M4), in the lab scene `ramp-states` with the clock frozen at
// noon: Rampa, Terminal B and Aeródromo at the two screens of the plan (1440 × 900 and the presentation laptop's
// 1920 × 1080), plus a close view of terminal A with the three-line labels. The screenshots go to
// test-results/visual/ramp-states-*.png for a person to review; what the map draws is asserted through its legend.

const SIZES = Object.freeze([{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]);
const STATES = ['Libre', 'Planificada', 'Llegando', 'Ocupada', 'Por liberar', 'Inhabilitada', 'Sin verificar'];
// The airport layout the map draws, read in Node as the generator wrote it: the close view sits between A3 and A6.
const LAYOUT = JSON.parse(readFileSync(new URL('../../../src/features/maps/airport/data/mdpc.layout.json', import.meta.url), 'utf8'));
const centreOf = code => LAYOUT.stands.find(stand => stand.code === code).center;
const CLOSE_CENTRE = [(centreOf('A3')[0] + centreOf('A6')[0]) / 2, (centreOf('A3')[1] + centreOf('A6')[1]) / 2];

test.describe('ramp states in the map lab', () => {
  test.skip(production, 'The map lab exists in development only.');

  for (const size of SIZES) {
    test(`Rampa, Terminal B and Aeródromo at ${size.width}×${size.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(size);
      const map = await openLab(page, `scene=ramp-states&t=${NOON}`);
      const legend = page.getByRole('list', { name: 'Leyenda' });
      const settleOn = async (view, terminal) => {
        await page.evaluate(([name, code]) => window.__occMapLab.flyToPreset(name, { terminal: code }), [view, terminal ?? null]);
        await labIdle(page);
      };

      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await labIdle(page);
      // Every state is on the ramp, with both signals.
      await expect(legend.getByRole('listitem')).toContainText([...STATES, 'Atención', 'Urgente']);
      await shoot(page, testInfo, `ramp-states-ramp-${size.width}`);

      await settleOn('ramp', 'B');
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await expect(legend.getByRole('listitem')).toContainText(['Libre', 'Llegando', 'Por liberar', 'Atención']);
      await shoot(page, testInfo, `ramp-states-terminal-b-${size.width}`);

      await settleOn('airfield');
      await expect(map).toHaveAttribute('data-occ-view', 'airfield');
      await expect(legend.getByRole('listitem')).toContainText(STATES);
      await shoot(page, testInfo, `ramp-states-airfield-${size.width}`);

      // Up close on terminal A, past the three-line threshold (the ramp fit + 0.8): codes, flights, times and coverage.
      await settleOn('ramp');
      const rampFit = await zoomOf(map);
      await page.evaluate(([zoom, at]) => window.__occMapLab.jumpTo({ zoom, center: at }), [rampFit + 1.3, CLOSE_CENTRE]);
      await labIdle(page);
      await shoot(page, testInfo, `ramp-states-terminal-a-close-${size.width}`);
    });
  }
});
