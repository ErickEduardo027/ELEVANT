import { arrivalLegOf, createMonitoringApi, UNASSIGNED_VISIT } from './fixtures/monitoringApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Monitoreo de vuelos as a work map (PR U5, design E.2 template B): the board of flight strips at the left, the maps
// lane's map and the inspector of the chosen flight docked beside it, with a synthetic OCC session and a stubbed API
// (fixtures/monitoringApi.mjs: createOccApi's sky and map flights, and a planning snapshot built from them). Photographed
// for review at 1920 × 1080 and 1440 × 900, the laptop the OCC is presented on (owner decision 11): a flight chosen on the
// board, the empty day, and the map unavailable in a browser without WebGL; and once at 2560 × 1440, where the inspector
// takes its own column. Each test opens the screen as a later OCC entry of its tab, so the boot screen (PR U4) never
// covers it.

const PAGE = '/admin-occ/flight-monitoring';
const DAY_FLIGHTS = 26;

const board = page => page.getByRole('region', { name: 'Tablero de vuelos' });
const strips = page => board(page).getByTestId('flight-list-item');
const stripOf = (page, number) => strips(page).filter({ hasText: number });
const flightIdInUrl = page => new URL(page.url()).searchParams.get('flightId');
// The inspector, by its name: the frame's rail is a complementary landmark too.
const inspectors = page => page.getByRole('complementary', { name: /^Detalle del vuelo / });

// The maps lane's dock (its view selector and tools, maps/ui/MapDock.jsx) in one row: the width it needs and the width
// the map leaves it.
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
  // From 2200 px a third column leaves the map the room of its dock: there the inspector docks at the right of the map.
  test('the inspector takes its own column at the right on a wide screen (2560×1440)', async ({ page, isolation }, testInfo) => {
    const { map } = await openMonitoring(page, isolation, { viewport: { width: 2560, height: 1440 } });
    await mapReady(map);
    await stripOf(page, 'ZZ9001').click();
    const inspector = page.getByRole('complementary', { name: 'Detalle del vuelo ZZ9001' });
    await expect(inspector).toBeVisible();
    await expect(map).toHaveAttribute('data-occ-settled', 'true', { timeout: 60_000 });
    const [mapBox, inspectorBox] = await Promise.all([map.boundingBox(), inspector.boundingBox()]);
    expect(inspectorBox.x, 'the inspector at the right of the map').toBeGreaterThanOrEqual(mapBox.x + mapBox.width);
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
      const demo = stripOf(page, 'ZZ9001');
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

      // The inspector never covers the map, and the map keeps a working width at the laptop's size.
      const [mapBox, inspectorBox, boardBox] = await Promise.all([map.boundingBox(), inspector.boundingBox(),
        board(page).boundingBox()]);
      expect(apart(mapBox, inspectorBox), 'the inspector beside the map').toBe(true);
      expect(apart(mapBox, boardBox), 'the board beside the map').toBe(true);
      expect(mapBox.width).toBeGreaterThanOrEqual(700);
      // The inspector sits under the board, so the map keeps its width; at 1440 × 900 the dock takes its compact steps.
      expect(inspectorBox.y, 'the inspector under the board').toBeGreaterThanOrEqual(boardBox.y + boardBox.height);
      const dock = await dockRoom(map);
      testInfo.annotations.push({ type: 'dock', description: `needs ${dock.needs}px, has ${dock.has}px` });
      console.log(`dock at ${size}: needs ${dock.needs}px, has ${dock.has}px, map ${Math.round(mapBox.width)}px`);
      // On a narrow map the dock drops the keys and shortens two views (occ-map.css): it fits its row at both sizes.
      expect(dock.needs, 'the dock fits its row').toBeLessThanOrEqual(dock.has + 1);
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
