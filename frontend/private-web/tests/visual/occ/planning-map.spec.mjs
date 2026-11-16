import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { AUTH_STORAGE_KEY, createOccApi, occSession } from './fixtures/occApi.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Planificación in its «Mapa» view (PR M6), with a synthetic OCC session and a stubbed API (fixtures/occApi.mjs): the
// one map engine of Mapa de posiciones, whose stands read the positions board with the map flights and the aircraft of
// the stub (the story of positions-map.spec.mjs: the demo flight that taxis to A3, ZZ111 holding short of B24, ZZ102
// standing on A6 with nobody having recorded its arrival), and the live, estimated and demo traffic over them. The view
// is photographed at 1440 × 900 and 1920 × 1080, then A6 chosen in the panel beside the map, which says what the map
// says. The screenshots go to test-results/visual/planning-map-*.png for a person to review.

const PAGE = '/admin-occ/planning';
const SIZES = Object.freeze([{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]);

async function openPlanningMap(page, isolation) {
  const api = createOccApi();
  isolation.setApi(api.handle);
  // A later OCC entry of the tab (occBootSession.js keeps the account id under OCC_BOOT_SEEN_KEY): the boot screen of
  // PR U4 stays away, so the screenshots show the map.
  await page.addInitScript(([authKey, bootSeenKey, session]) => {
    window.localStorage.setItem(authKey, JSON.stringify(session));
    window.sessionStorage.setItem(bootSeenKey, String(session.accountId));
  }, [AUTH_STORAGE_KEY, OCC_BOOT_SEEN_KEY, occSession()]);
  const response = await page.goto(PAGE);
  expect(response?.status(), `GET ${PAGE}`).toBe(200);
  await expect(page.getByTestId('occ-boot-screen'), 'the OCC boot screen').toHaveCount(0, { timeout: 1_000 });
  // The timeline opens first; its «Mapa» view shows the stands of the day.
  const views = page.getByRole('group', { name: 'Vistas de planificación' });
  await views.getByRole('button', { name: 'Mapa', exact: true }).click();
  await expect(views.getByRole('button', { name: 'Mapa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const map = page.getByTestId('occ-map');
  await mapReady(map);
  await expect.poll(() => api.reads, { message: 'the positions board was read' }).toBeGreaterThan(0);
  await expect.poll(() => api.mapReads.flights, { message: 'the map flights were read' }).toBeGreaterThan(0);
  await expect.poll(() => api.mapReads.airPicture, { message: 'the air picture was read' }).toBeGreaterThan(0);
  return { api, map };
}

// Resolves once the map has drawn the stands with nothing left to load, place or fade.
async function settled(page) {
  await expect(page.getByTestId('map-legend')).toBeVisible();
  await expect(page.getByTestId('occ-map')).toHaveAttribute('data-occ-settled', 'true');
}

// The map and the panel beside it in the middle of the window: below the filters and the figures of the day, the
// view starts out of sight at 1440 × 900.
async function bringIntoView(page) {
  await page.getByRole('region', { name: 'Mapa de planificación' }).evaluate(node => node.scrollIntoView({ block: 'center' }));
  await settled(page);
}

async function setLegend(map, open) {
  const toggle = map.getByRole('button', { name: 'Leyenda', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(open));
}

const legendItems = map => map.getByRole('list', { name: 'Leyenda' }).getByRole('listitem');

test.describe('Planificación in its «Mapa» view', () => {
  for (const size of SIZES) {
    test(`the stands fed by the flights and the traffic over them, ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { map } = await openPlanningMap(page, isolation);
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await settled(page);
      // The traffic first, then the stands as the map flights say them: A3 and B24 «Llegando» until their aircraft are
      // on them, the aircraft to scale on the stands and still to come, and the notice of A6.
      await expect(legendItems(map)).toContainText([
        'Vuelo de AVIAM que llega', 'Llegando', 'Ocupada', 'Aviso', 'Avión en la posición, a escala', /^Avión previsto, a escala/,
      ]);
      await bringIntoView(page);
      await shoot(page, testInfo, `planning-map-${size.width}`);

      // A6 chosen in the panel beside the map: the map brings it up close, past the three-line threshold, and the panel
      // says what the map says, with the notice of its arrival nobody recorded.
      await page.getByRole('button', { name: /^A6 · / }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('A6');
      const facts = page.getByRole('list', { name: 'Estado en el mapa' });
      await expect(facts.getByRole('listitem')).toContainText([
        'Ocupada', 'El avión ya está en la posición. Registra la llegada.', 'Hitos registrados: 0 de 25',
      ]);
      await settled(page);
      await expect(legendItems(map)).toContainText([/^Avance de la escala/]);
      // The legend folded, so the stands it explains show.
      await setLegend(map, false);
      await bringIntoView(page);
      await shoot(page, testInfo, `planning-map-stand-${size.width}`);
    });
  }
});
