import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The motion of PR M6 in Chrome: the demo flight and the three sources of a position in the map lab (synthetic data,
// no provider, the clock frozen at the lab's noon), photographed at the laptop sizes of the presentation, 1440 × 900
// and 1920 × 1080, for a person to review in test-results/visual. Beside the pictures it checks what must hold on
// each: the chosen aircraft's data block says where its position comes from and what its plan says, and «Pausar
// movimiento» says its state in its name and, paused, in the chip above it.

const SIZES = Object.freeze([[1440, 900], [1920, 1080]]);
const ESTIMATED = 'Posición estimada: calculada con el horario, no con señal del avión.';
const DEMO = 'Vuelo ZZ9001';
// ZZ161, ZZ700 and ZZ500 of the fixtures (src/features/maps/testing/trafficFixtures.js), by their flight keys.
const KEYS = Object.freeze({
  arrival: 'p:5b000000-0000-4000-8000-000000000161',
  departed: 'l:5c000000-0000-4000-8000-000000000700',
  noFix: 'l:5c000000-0000-4000-8000-000000000500',
});

// Each scene with its view, the dialog of the aircraft it chooses and the words that block must say.
const SCENES = Object.freeze([
  ['approach-demo-final', 'approach', DEMO, [ESTIMATED, 'Vuelo demo', 'Posición A6 · Pista 08']],
  ['airfield-demo-taxiing', 'airfield', DEMO, [ESTIMATED, 'Posición A6 · Pista 08']],
  ['ramp-demo-awaiting-stand', 'ramp', DEMO, [ESTIMATED, 'Esperando posición · sin importar', 'Sin importar']],
  ['approach-traffic-live-estimated', 'approach', 'Vuelo ZZ700', ['Sin señal desde hace 20 s']],
  ['airfield-demo-cancelled', 'airfield', DEMO, ['Cancelado por el proveedor (demo)']],
  ['approach-demo-accelerated', 'approach', DEMO, [ESTIMATED, 'Demo acelerada ×']],
]);

const legendItems = page => page.getByRole('list', { name: 'Leyenda' }).getByRole('listitem');

test.describe('map lab motion', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of the demo flight in motion and the sources of a position at 1440 × 900 and 1920 × 1080', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      for (const [scene, view, dialog, words] of SCENES) {
        const map = await openLab(page, `scene=${scene}&t=${NOON}`);
        await expect(map).toHaveAttribute('data-occ-view', view);
        await expect(map).toHaveAttribute('data-occ-basemap', 'ok');
        const block = page.getByRole('dialog', { name: dialog });
        await expect(block).toBeVisible();
        for (const text of words) await expect(block, `${scene}: ${text}`).toContainText(text);
        // The pause control sits in the dock of every map that moves its traffic.
        await expect(page.getByRole('button', { name: 'Pausar movimiento' })).toHaveAttribute('aria-pressed', 'false');
        await labIdle(page);
        await shoot(page, testInfo, `${scene}-${width}`);
      }
    }
  });

  test('each block says where its position comes from: live, without a signal, estimated', async ({ page }, testInfo) => {
    const sourceOf = name => page.getByRole('dialog', { name }).locator('[data-source-line]');
    for (const [key, name, words] of [
      [KEYS.arrival, 'Vuelo ZZ161', 'En vivo · hace 4 s'],
      [KEYS.departed, 'Vuelo ZZ700', 'Sin señal desde hace 20 s'],
      [KEYS.noFix, 'Vuelo ZZ500', ESTIMATED],
    ]) {
      await openLab(page, `scene=approach-traffic-live-estimated&t=${NOON}&flightId=${encodeURIComponent(key)}`);
      await expect(sourceOf(name)).toHaveText(words);
    }
    await labIdle(page);
    await shoot(page, testInfo, 'approach-traffic-live-estimated-zz500-1440');
    // The two-minute demo names its compressed part with its factor; the legend explains the demo plate and the ring.
    await openLab(page, `scene=approach-demo-accelerated&t=${NOON}`);
    await expect(page.getByRole('dialog', { name: DEMO }).locator('[data-time-scale]')).toHaveText(/^Demo acelerada ×\d,\d$/u);
    await expect(legendItems(page)).toContainText(['Vuelo de AVIAM que llega', 'Demo', 'est.']);
  });

  test('«Pausar movimiento» says its state in its name and, paused, the time of the data', async ({ page }, testInfo) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await openLab(page, `scene=airfield-demo-taxiing&t=${NOON}`);
      const pause = page.getByRole('button', { name: 'Pausar movimiento' });
      await expect(pause).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('map-motion-control').getByRole('status')).toHaveCount(0);
      await pause.click();
      const resume = page.getByRole('button', { name: 'Reanudar movimiento' });
      await expect(resume).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('map-motion-control').getByRole('status'))
        .toHaveText('Movimiento en pausa · datos de las 11:00');
      await labIdle(page);
      await shoot(page, testInfo, `airfield-demo-paused-${width}`);
      await resume.click();
      await expect(page.getByRole('button', { name: 'Pausar movimiento' })).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('map-motion-control').getByRole('status')).toHaveCount(0);
    }
  });
});
