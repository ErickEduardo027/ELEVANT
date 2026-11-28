import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { ARRIVAL_ON_FINAL_KEY, DEMO_FLIGHT_KEYS, createConsoleApi, iemCurrents } from './fixtures/consoleApi.mjs';
import { AUTH_STORAGE_KEY, occSession } from './fixtures/occApi.mjs';
import { expectFloatingLayout } from './occScreen.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Panorama, the OCC console (PR U3, contratos 2.5): the full-bleed map with its floating panels, on the one map engine,
// with a synthetic OCC session and a stubbed API (fixtures/consoleApi.mjs: one coherent day at Punta Cana) and today's
// METAR of IEM answered by a route of this spec. Photographed for review at 1920 × 1080 and 1440 × 900, the laptop the
// console is presented on (owner decision 11), and the panels open and folded at the 1366 × 768 audit laptop too (M1):
// the panels open and folded, a flight and a stand selected, the fallback
// without a map engine, the pill of a demo flight already on its way when the console opens with the board's legend,
// an operation still open after its departure (N30), the pill of a new demo arrival, and a strip chosen beside a folded
// «Alertas». Each test opens the console as a later OCC entry of its tab, so the OCC boot screen (PR U4) never covers it.

const PAGE = '/admin-occ/dashboard';
const SIZES = Object.freeze([{ width: 1920, height: 1080 }, { width: 1440, height: 900 }]);
// The panels open and folded are checked at the 1366 × 768 laptop of the audit too (M1).
const LAYOUT_SIZES = Object.freeze([...SIZES, { width: 1366, height: 768 }]);
// Only IEM's JSON API: its radar tiles fall through to support/isolate.mjs, which answers them with synthetic echoes.
const IEM = 'https://mesonet.agron.iastate.edu/api/**';
const PANELS = Object.freeze(['Tablero', 'Alertas', 'Cifras de la jornada', 'Posiciones']);

const panel = (page, name) => page.getByRole('region', { name, exact: true });
const foldButton = (page, name) => panel(page, name).getByRole('button', { name, exact: true });

async function openConsole(page, isolation, query = '', { demo = false, openAfterDeparture = false } = {}) {
  const api = createConsoleApi({ demo, openAfterDeparture });
  isolation.setApi(api.handle);
  // Today's METAR, without leaving the machine: registered after the isolation, this route answers first.
  await page.route(IEM, route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'cache-control': 'no-store' },
    body: JSON.stringify(iemCurrents()),
  }));
  // The tab already showed the boot screen to this account, as when Panorama is opened from another module.
  await page.addInitScript(([authKey, bootSeenKey, session]) => {
    window.localStorage.setItem(authKey, JSON.stringify(session));
    window.sessionStorage.setItem(bootSeenKey, String(session.accountId));
  }, [AUTH_STORAGE_KEY, OCC_BOOT_SEEN_KEY, occSession()]);
  const response = await page.goto(`${PAGE}${query}`);
  expect(response?.status(), `GET ${PAGE}${query}`).toBe(200);
  const root = page.locator('[data-occ-console]');
  await expect(root).toBeVisible();
  return { api, root, map: page.getByTestId('occ-map') };
}

// The console with its data on screen and its map still: the board answered, the band and the map drew everything.
async function settled(page, map, { pause = false } = {}) {
  await expect(panel(page, 'Tablero').getByRole('tablist', { name: 'Vista del tablero' })).toBeVisible();
  await expect(page.getByTestId('occ-console-provenance')).toContainText('Aviones: Red ADS-B de prueba');
  await mapReady(map);
  // Without reduced motion the console moves its traffic on every frame (PR M6), so its map settles only once
  // «Pausar movimiento» holds the aircraft where they are; the reads go on meanwhile.
  if (pause) {
    const button = page.getByTestId('map-motion-control').getByRole('button');
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveAccessibleName('Reanudar movimiento');
  }
  await expect(map).toHaveAttribute('data-occ-settled', 'true');
}

// M1: the map fills the screen and the console's panels float over it, 12 px from its edges, clear of its control column:
// «Tablero» over «Alertas» at the left, the figures along the top and the band along the bottom short of the column, and
// the status bar at the foot. Open or folded to their pills.
async function expectConsoleFloats(page, map) {
  const panels = Object.fromEntries(PANELS.map(name => [name, panel(page, name)]));
  panels.status = page.locator('[data-occ-console-status]');
  const { boxes } = await expectFloatingLayout(page, map, panels);
  expect(Math.round(boxes.Alertas.x), 'the alerts in the column of the board').toBe(Math.round(boxes.Tablero.x));
  expect(boxes.Alertas.y, 'the alerts under the board').toBeGreaterThanOrEqual(boxes.Tablero.y + boxes.Tablero.height - 1);
  expect(boxes.status.y, 'the status bar under the band')
    .toBeGreaterThanOrEqual(boxes.Posiciones.y + boxes.Posiciones.height - 1);
}

async function setOpen(page, name, open) {
  const button = foldButton(page, name);
  if ((await button.getAttribute('aria-expanded')) !== String(open)) await button.click();
  await expect(button).toHaveAttribute('aria-expanded', String(open));
}

test.describe('the OCC console on the map engine', () => {
  for (const size of LAYOUT_SIZES) {
    test(`panels open and folded at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { root, map } = await openConsole(page, isolation);
      await expect(root).toHaveAttribute('data-occ-console', 'map');
      await expect(map).toHaveAttribute('data-occ-view', 'ramp');
      await settled(page, map);
      // M1: below 1440 px only «Tablero» opens, the figures and the alerts open folded; the band always opens folded.
      const compact = size.width < 1440;
      await expect(panel(page, 'Cifras de la jornada')).toHaveAttribute('data-folded', compact ? 'true' : 'false');
      await expect(panel(page, 'Alertas')).toHaveAttribute('data-folded', compact ? 'true' : 'false');
      await expect(panel(page, 'Posiciones')).toHaveAttribute('data-folded', 'true');
      await expectConsoleFloats(page, map);
      await shoot(page, testInfo, `u3-consola-inicio-${size.width}`);

      for (const name of PANELS) await setOpen(page, name, false);
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      // Folded, the map's insets are the pills alone: nothing is taken from the left or the right.
      await expect.poll(() => map.evaluate(node => node.style.getPropertyValue('--occ-map-inset-left'))).toBe('0px');
      await expectConsoleFloats(page, map);
      await shoot(page, testInfo, `u3-consola-plegada-${size.width}`);

      for (const name of PANELS) await setOpen(page, name, true);
      await expect(panel(page, 'Posiciones').getByRole('group', { name: 'Posiciones en el tiempo' })).toBeVisible();
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await expect.poll(async () => Number.parseFloat(await map.evaluate(node =>
        node.style.getPropertyValue('--occ-map-inset-left')))).toBeGreaterThan(300);
      // The open band takes its height from the bottom of the map, and ends short of the control column, which keeps
      // its place at the right edge (M1): the band never runs under the rail.
      await expect.poll(async () => Number.parseFloat(await map.evaluate(node =>
        node.style.getPropertyValue('--occ-map-inset-bottom')))).toBeGreaterThan(100);
      await expectConsoleFloats(page, map);
      await shoot(page, testInfo, `u3-consola-abierta-${size.width}`);
    });
  }

  for (const size of SIZES) {
    test(`a flight and a stand selected at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      const { map } = await openConsole(page, isolation);
      await settled(page, map);
      // A strip of the board selects its flight and brings its aircraft, on final, into the area the panels leave.
      const strip = panel(page, 'Tablero').getByRole('button', { name: /ZZ161/ });
      await strip.click();
      await expect.poll(() => new URL(page.url()).searchParams.get('flightId')).toBe(ARRIVAL_ON_FINAL_KEY);
      await expect(strip).toHaveAttribute('aria-pressed', 'true');
      const inspector = panel(page, 'Inspector');
      await expect(inspector.getByRole('dialog', { name: 'Vuelo ZZ161' })).toBeVisible();
      await expect(inspector.getByRole('list', { name: 'Hitos de la escala' })).toBeVisible();
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      // The inspector floats too (M1): from 1536 px at the right of the map, 12 px left of the control column; below,
      // in the column of the board.
      await expectFloatingLayout(page, map, { Tablero: panel(page, 'Tablero'), Inspector: inspector });
      await shoot(page, testInfo, `u3-consola-vuelo-${size.width}`);

      // The stand of the band: a click on its bar selects it on the map, with its facts in the inspector.
      await setOpen(page, 'Posiciones', true);
      await panel(page, 'Posiciones').getByRole('button', { name: /ZZ300 a ZZ301/ }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('stand')).toBe('A2');
      await expect(inspector.getByTestId('stand-detail-facts')).toBeVisible();
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await shoot(page, testInfo, `u3-consola-posicion-${size.width}`);
    });

    test(`a demo flight already on its way when the console opens at ${size.width}×${size.height}`,
      async ({ page, isolation }, testInfo) => {
        await page.setViewportSize(size);
        // The superadministrator fired it before OCC opened the console: the first read of the flights announces it.
        const { map } = await openConsole(page, isolation, '', { demo: true });
        await settled(page, map);
        await expect(page.getByText('Llegada nueva: ZZ9001')).toBeVisible();
        // In the area the panels leave: it covers neither «Tablero», «Alertas» nor the map's zoom buttons, at either size.
        const pill = await page.getByRole('status').filter({ hasText: 'Llegada nueva: ZZ9001' }).boundingBox();
        const neighbours = [['Tablero', panel(page, 'Tablero')], ['Alertas', panel(page, 'Alertas')],
          ['the zoom buttons', map.locator('.maplibregl-ctrl-top-right')]];
        for (const [name, neighbour] of neighbours) {
          const box = await neighbour.boundingBox();
          const apart = pill.x + pill.width <= box.x || box.x + box.width <= pill.x
            || pill.y + pill.height <= box.y || box.y + box.height <= pill.y;
          expect(apart, `the pill covers ${name}`).toBe(true);
        }
        // The board's header says what the marks of its tab mean: the amber triangle of the flight without a stand and
        // the «Demo» plate.
        const legend = panel(page, 'Tablero').getByRole('list', { name: 'Leyenda del tablero' });
        await expect(legend).toContainText('Atención');
        await expect(legend).toContainText('Simulado para la demostración');
        await expect(map).toHaveAttribute('data-occ-settled', 'true');
        await shoot(page, testInfo, `u3-consola-llegada-al-abrir-${size.width}`);
      });

    // N30: ZZ800 left A4 80 minutes ago and its agent never handed the operation off (fixtures/consoleApi.mjs).
    test(`an operation still open an hour after its departure at ${size.width}×${size.height}`,
      async ({ page, isolation }, testInfo) => {
        await page.setViewportSize(size);
        const { map } = await openConsole(page, isolation, '', { openAfterDeparture: true });
        await settled(page, map);
        // «Pendientes de la jornada» lists it in amber, with no action of its own.
        const pending = panel(page, 'Alertas').getByRole('region', { name: 'Pendientes de la jornada' });
        const item = pending.locator('[data-pending="openAfterDeparture"]');
        await expect(item).toHaveText(/Atención: ZZ801 con la operación abierta, salió hace 1 h 2\d min/);
        await expect(item.locator('[data-occ-glyph="attention"]')).toBeVisible();
        await expect(item.getByRole('button', { name: /Elegir posición|Asignar agente|Revisar|Importar/ })).toHaveCount(0);
        // «En operación» keeps counting it, with ZZ300, and says so under its figure.
        await setOpen(page, 'Cifras de la jornada', true);
        const working = panel(page, 'Cifras de la jornada').locator('[data-occ-stat]').filter({ hasText: 'En operación' });
        await expect(working.locator('dd').first()).toHaveText('2');
        await expect(working.locator('[data-occ-stat-detail]')).toHaveText('Atención: 1 abierta tras la salida');
        await item.scrollIntoViewIfNeeded();
        await expect(map).toHaveAttribute('data-occ-settled', 'true');
        await shoot(page, testInfo, `n30-consola-abierta-tras-la-salida-${size.width}`);
      });

    test(`the fallback without a map engine at ${size.width}×${size.height}`, async ({ page, isolation }, testInfo) => {
      await page.setViewportSize(size);
      // A browser without WebGL: the canvas refuses every WebGL context.
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
          return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
        };
      });
      const { root } = await openConsole(page, isolation);
      await expect(root).toHaveAttribute('data-occ-console', 'grid');
      await expect(page.getByTestId('map-unavailable').getByRole('heading', { name: 'El mapa no está disponible' }))
        .toBeVisible();
      for (const name of PANELS) await expect(panel(page, name)).toHaveAttribute('data-layout', 'grid');
      await expect(panel(page, 'Tablero').getByRole('tablist', { name: 'Vista del tablero' })).toBeVisible();
      await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
      await shoot(page, testInfo, `u3-consola-sin-motor-${size.width}`);
    });
  }

  test.describe('without reduced motion', () => {
    test.use({ reducedMotion: 'no-preference', viewport: { width: 1920, height: 1080 } });

    test('a new demo arrival: «Llegada nueva» with «Ver y seguir», and «Recibido»', async ({ page, isolation }, testInfo) => {
      const { api, map } = await openConsole(page, isolation);
      await settled(page, map, { pause: true });
      // «Recibido» is the account's read receipt: the PUT, and the alert leaves the panel.
      const alerts = panel(page, 'Alertas');
      await alerts.getByRole('button', { name: 'Recibido' }).click();
      await expect.poll(() => api.acknowledged.length).toBe(1);

      // The superadministrator fires the demo flight; the tab hears occ_planning when it reconciles (its focus).
      api.triggerDemo();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const pill = page.getByText('Llegada nueva: ZZ9001');
      await expect(pill).toBeVisible({ timeout: 30_000 });
      const board = panel(page, 'Tablero');
      await expect(board).toContainText('ZZ9001');
      await expect(board).toContainText('Llegada sin posición asignada');
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await shoot(page, testInfo, 'u3-consola-llegada-nueva-1920');

      await page.getByRole('button', { name: 'Ver y seguir' }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('flightId')).toBe(DEMO_FLIGHT_KEYS.arrival);
      // follow=1 once the URL has the flight and its view: a view the page asks for ends follow mode (PR M6).
      await expect.poll(() => new URL(page.url()).searchParams.get('follow')).toBe('1');
      // Follow mode frames the aircraft with the airport (PR M6): the view is the one that holds both.
      await expect(map).toHaveAttribute('data-occ-view', /^(approach|airfield)$/);
      await expect(page.getByTestId('occ-console-provenance')).toContainText('Incluye un vuelo demo.');
      await expect(map).toHaveAttribute('data-occ-settled', 'true');
      await shoot(page, testInfo, 'u3-consola-ver-y-seguir-1920');
    });

    // With «Alertas» folded, the inspector that opens with the selection docks under the board at 1440 px (CN-32) and
    // takes its width from the map, and the new padding of the map would stop a camera move already under way: the
    // console flies only once it is measured. The legend lists only what the panels leave in sight, so it names the
    // aircraft once the camera has brought it there.
    test('a strip chosen beside a folded «Alertas» brings its aircraft beside the inspector at 1440×900',
      async ({ page, isolation }, testInfo) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const { map } = await openConsole(page, isolation);
        await settled(page, map, { pause: true });
        await setOpen(page, 'Alertas', false);
        await expect.poll(() => map.evaluate(node => node.style.getPropertyValue('--occ-map-inset-right'))).toBe('0px');
        await panel(page, 'Tablero').getByRole('button', { name: /ZZ161/ }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('flightId')).toBe(ARRIVAL_ON_FINAL_KEY);
        await expect(panel(page, 'Inspector').getByRole('dialog', { name: 'Vuelo ZZ161' })).toBeVisible();
        // Below 1536 px the inspector docks in the left column, under the board: the right edge stays free.
        const [inspectorBox, boardBox] = await Promise.all([panel(page, 'Inspector').boundingBox(),
          panel(page, 'Tablero').boundingBox()]);
        expect(Math.round(inspectorBox.x)).toBe(Math.round(boardBox.x));
        await expect.poll(() => map.evaluate(node => node.style.getPropertyValue('--occ-map-inset-right'))).toBe('0px');
        await expect.poll(async () => Number.parseFloat(await map.evaluate(node =>
          node.style.getPropertyValue('--occ-map-inset-left')))).toBeGreaterThan(300);
        await expect(map).toHaveAttribute('data-occ-settled', 'true');
        const legendButton = map.getByRole('button', { name: 'Leyenda', exact: true });
        if ((await legendButton.getAttribute('aria-expanded')) !== 'true') await legendButton.click();
        await expect(map.getByRole('list', { name: 'Leyenda', exact: true })).toContainText('Vuelo de AVIAM que llega');
        await expect(map).toHaveAttribute('data-occ-settled', 'true');
        await shoot(page, testInfo, 'u3-consola-alertas-plegada-1440');
      });
  });
});

// AeroDataBox through the API (ADR-0028 and ADR-0043, notes of 15 November 2026), on the stub's invented answers: the
// routes from Punta Cana in the Región view, the delays pill of the bottom bar with its detail, and the aircraft and the
// origin's delays of a chosen flight in the inspector.
test.describe('the AeroDataBox reference reads on the console', () => {
  test('routes in Región, the delays pill and the chosen flight\'s aircraft at 1440', async ({ page, isolation }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { api, map } = await openConsole(page, isolation, '?view=region');
    await settled(page, map);
    await expect(map).toHaveAttribute('data-occ-view', 'region');
    const pill = page.locator('[data-airport-delays-pill]');
    await expect(pill).toHaveText('Demoras PUJ: llegadas +12 min · salidas +8 min');
    await expect.poll(() => api.reads.airportRoutes ?? 0).toBe(1);
    await expect(map).toHaveAttribute('data-occ-settled', 'true');
    await shoot(page, testInfo, 'adb-rutas-region-1440');

    const legendButton = page.getByTestId('map-legend').getByRole('button', { name: 'Leyenda' });
    await legendButton.click();
    await expect(page.getByTestId('map-legend')).toContainText('Rutas desde Punta Cana');
    await shoot(page, testInfo, 'adb-rutas-leyenda-1440');
    await legendButton.click();
    await expect(legendButton).toHaveAttribute('aria-expanded', 'false');

    await pill.click();
    await expect(page.locator('[data-airport-delays-detail]')).toContainText('Demoras en PUJ');
    await shoot(page, testInfo, 'adb-demoras-detalle-1440');
    await page.keyboard.press('Escape');

    const strip = panel(page, 'Tablero').getByRole('button', { name: /ZZ161/ });
    await strip.click();
    const inspector = panel(page, 'Inspector');
    await expect(inspector.locator('[data-aircraft-facts="facts"]')).toContainText('Boeing 737-800');
    await expect(inspector.locator('[data-airport-delays-line]')).toContainText('Demoras en el origen');
    await inspector.locator('[data-aircraft-facts="facts"]').evaluate(node => node.scrollIntoView({ block: 'start' }));
    await expect(map).toHaveAttribute('data-occ-settled', 'true');
    await shoot(page, testInfo, 'adb-aeronave-inspector-1440');
  });
});
