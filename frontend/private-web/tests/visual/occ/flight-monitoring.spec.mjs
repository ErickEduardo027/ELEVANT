import { arrivalLegOf, createMonitoringApi, UNASSIGNED_VISIT } from './fixtures/monitoringApi.mjs';
import { SCREEN_VIEWPORTS, expectFloatingLayout, openOccScreen } from './occScreen.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Monitoreo de vuelos as a full-screen map with floating panels (PR U5, design E.2; M1, which replaces CN-32's docked
// template B): the maps lane's map fills the screen with its control column at its true right edge, the board of flight
// strips floats at its left and the inspector of the chosen flight at its right, left of the column (below 1536 px the
// board folds to its pill while the inspector is open), with a synthetic OCC session and a stubbed API
// (fixtures/monitoringApi.mjs: createOccApi's sky and map flights, and a planning snapshot built from them). Photographed
// for review at 1920 × 1080 and 1440 × 900, the laptop the OCC is presented on (owner decision 11): a flight chosen on the
// board, the empty day, and the map unavailable in a browser without WebGL; and once at 2560 × 1440, where the inspector
// and the board stay open side by side. Each test opens the screen as a later OCC entry of its tab, so the boot screen
// (PR U4) never covers it.

const PAGE = '/admin-occ/flight-monitoring';
const DAY_FLIGHTS = 26;

const board = page => page.getByRole('region', { name: 'Tablero de vuelos' });
const strips = page => board(page).getByTestId('flight-list-item');
const stripOf = (page, number) => strips(page).filter({ hasText: number });
const flightIdInUrl = page => new URL(page.url()).searchParams.get('flightId');
// The inspector, by its name: the frame's rail is a complementary landmark too.
const inspectors = page => page.getByRole('complementary', { name: /^Detalle del vuelo / });

// The maps lane's control rail (its view selector and tools, maps/ui/MapDock.jsx): the width it needs and the width it has.
const dockRoom = map => map.locator('.occ-map-dock').evaluate(node => ({ needs: node.scrollWidth, has: node.clientWidth }));

async function openMonitoring(page, isolation, { viewport, empty = false }) {
  const api = createMonitoringApi({ empty });
  await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  await expect(board(page)).toBeVisible();
  await expect.poll(() => api.planningReads, { message: 'the planning snapshot was read' }).toBeGreaterThan(0);
  return { api, map: page.getByTestId('occ-map') };
}

// Two boxes on screen share no pixel.
const apart = (left, right) => left.x + left.width <= right.x || right.x + right.width <= left.x
  || left.y + left.height <= right.y || right.y + right.height <= left.y;

// What each cell of a strip draws ends before the next cell starts: its tags never run into the other airport. A cell's
// own box is its grid column; what overflows it is read from the cell's content.
async function expectStripCellsApart(strip) {
  const cells = await strip.evaluate(node => Object.fromEntries([...node.children].map(cell => {
    const box = cell.getBoundingClientRect();
    const drawn = [...cell.querySelectorAll('*')].map(item => item.getBoundingClientRect()).filter(item => item.width > 0);
    return [cell.dataset.part, { left: box.left, right: Math.max(box.left, ...drawn.map(item => item.right)) }];
  })));
  for (const [left, right] of [['time', 'flight'], ['flight', 'tags'], ['tags', 'counterpart'], ['counterpart', 'stand']]) {
    expect(cells[left].right, `${left} before ${right}`).toBeLessThanOrEqual(cells[right].left + 0.5);
  }
  expect(await strip.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'the strip fits its board').toBe(true);
}

test.describe('Monitoreo de vuelos as a work map', () => {
  // From 1536 px the inspector floats at the right of the map, left of its control column, with the board open.
  test('the inspector floats left of the control column on a wide screen (2560×1440)', async ({ page, isolation }, testInfo) => {
    const { map } = await openMonitoring(page, isolation, { viewport: { width: 2560, height: 1440 } });
    await mapReady(map);
    await stripOf(page, 'ZZ9001').click();
    const inspector = page.getByRole('complementary', { name: 'Detalle del vuelo ZZ9001' });
    await expect(inspector).toBeVisible();
    await expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });
    const { boxes } = await expectFloatingLayout(page, map, { board: board(page), inspector });
    expect(apart(boxes.board, boxes.inspector), 'the board and the inspector apart').toBe(true);
    await expect(board(page)).toHaveAttribute('data-folded', 'false');
    const dock = await dockRoom(map);
    expect(dock.needs, 'the dock fits its row').toBeLessThanOrEqual(dock.has + 1);
    await shoot(page, testInfo, 'u5-monitoreo-vuelo-2560');
  });

  for (const viewport of SCREEN_VIEWPORTS) {
    const size = `${viewport.width}×${viewport.height}`;

    test(`a flight chosen on the board at ${size}`, async ({ page, isolation }, testInfo) => {
      const { api, map } = await openMonitoring(page, isolation, { viewport });
      await expect(strips(page)).toHaveCount(DAY_FLIGHTS);
      await mapReady(map);
      await expect.poll(() => api.mapReads.flights, { message: 'the map read its flights' }).toBeGreaterThan(0);
      // The board's legend names the marks on screen: the amber arrival without a stand and the «Demo» plate.
      const legend = board(page).getByRole('list', { name: 'Leyenda del tablero' });
      await expect(legend).toContainText('Atención');
      await expect(legend).toContainText('Simulado para la demostración');
      await expect(stripOf(page, UNASSIGNED_VISIT.arrival)).toContainText('Llegada sin posición asignada');

      // The demo flight, chosen on the board: the URL names its leg, the strip is pressed, the inspector opens beside
      // the map and the map shows the same flight.
      // By its test id and not through the board's region: below 1536 px the board folds to its pill while the inspector
      // is open (M1), and its strips are hidden.
      const demo = page.locator('[data-testid="flight-list-item"]').filter({ hasText: 'ZZ9001' });
      await expectStripCellsApart(demo);
      await demo.click();
      await expect.poll(() => flightIdInUrl(page)).toBe(arrivalLegOf(9001));
      await expect(demo).toHaveAttribute('aria-pressed', 'true');
      const inspector = inspectors(page).filter({ hasText: 'ZZ9001' });
      await expect(inspectors(page)).toHaveCount(1);
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText('Demo');
      await expect(inspector.getByRole('link', { name: 'Ver planificación' })).toBeVisible();
      await expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });

      // The map fills the screen and the panels float over it (M1): the inspector at its right, left of the control
      // column, never under it; the board at its left, folded to its pill below 1536 px while the inspector is open, and
      // open beside it from there, the two apart.
      const { mapBox, boxes } = await expectFloatingLayout(page, map, { board: board(page), inspector });
      expect(apart(boxes.board, boxes.inspector), 'the board and the inspector apart').toBe(true);
      await expect(board(page)).toHaveAttribute('data-folded', viewport.width < 1536 ? 'true' : 'false');
      // The live data of the aircraft is in the inspector (its slot): the flight has one card.
      await expect(inspector.getByTestId('flight-data-block')).toBeVisible();
      await expect(page.getByTestId('flight-data-block')).toHaveCount(1);
      const dock = await dockRoom(map);
      testInfo.annotations.push({ type: 'dock', description: `needs ${dock.needs}px, has ${dock.has}px` });
      console.log(`rail at ${size}: needs ${dock.needs}px, has ${dock.has}px, map ${Math.round(mapBox.width)}px`);
      expect(dock.needs, 'the rail fits its column').toBeLessThanOrEqual(dock.has + 1);
      await shoot(page, testInfo, `u5-monitoreo-vuelo-${viewport.width}`);
    });

    test(`the empty day at ${size}`, async ({ page, isolation }, testInfo) => {
      const { map } = await openMonitoring(page, isolation, { viewport, empty: true });
      await expect(board(page).getByText('Sin vuelos para mostrar')).toBeVisible();
      await expect(board(page).getByText('No hay vuelos relacionados con la estación en este momento.')).toBeVisible();
      await expect(strips(page)).toHaveCount(0);
      await mapReady(map);
      await expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });
      await expect(inspectors(page)).toHaveCount(0);
      await expectFloatingLayout(page, map, { board: board(page) });
      await shoot(page, testInfo, `u5-monitoreo-dia-vacio-${viewport.width}`);
    });

    test(`the map unavailable at ${size}`, async ({ page, isolation }, testInfo) => {
      // A browser without WebGL: the canvas refuses every WebGL context.
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
          return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
        };
      });
      const { map } = await openMonitoring(page, isolation, { viewport });
      await expect(map).toHaveAttribute('data-occ-engine', 'unavailable');
      await expect(page.getByTestId('map-unavailable')
        .getByRole('heading', { name: 'El mapa no está disponible en este navegador' })).toBeVisible();
      await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
      // The board keeps working, and so does the inspector of the flight chosen on it.
      await expect(strips(page)).toHaveCount(DAY_FLIGHTS);
      await stripOf(page, UNASSIGNED_VISIT.arrival).click();
      await expect.poll(() => flightIdInUrl(page)).toBe(arrivalLegOf(UNASSIGNED_VISIT.index));
      const inspector = page.getByRole('complementary', { name: `Detalle del vuelo ${UNASSIGNED_VISIT.arrival}` });
      await expect(inspectors(page)).toHaveCount(1);
      await expect(inspector).toContainText('Sin posición');
      await expect(inspector).toContainText('Sin asignar');
      await shoot(page, testInfo, `u5-monitoreo-sin-mapa-${viewport.width}`);
    });
  }
});
