import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { AUTH_STORAGE_KEY, createOccApi, occSession, positionsBoard } from './fixtures/occApi.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// What a person does with the stands of Mapa de posiciones (PR M4, design D5), with a synthetic OCC session and a
// stubbed API (fixtures/occApi.mjs), in Chrome: the tooltip of a stand under the pointer; a selection in the URL that
// opens the drawer, which says what the map says; the marks of the stands the same agent covers; the combined pair; and
// «Ubicar en el mapa» with its confirmation, before and after «Guardar ubicación». The screenshots go to
// test-results/visual/positions-interactions-*.png for a person to review. Since PR M6 the stands also read the map
// flights and the aircraft of the stub (the traffic of positions-map.spec.mjs), so the drawer of a stand with a
// turnaround on it says its milestones as well.

const PAGE = '/admin-occ/positions-map';

async function openPositionsMap(page, isolation, query = '') {
  const api = createOccApi();
  isolation.setApi(api.handle);
  // A later OCC entry of the tab (occBootSession.js keeps the account id under OCC_BOOT_SEEN_KEY): the boot screen of
  // PR U4 stays away, so the pointer and the screenshots reach the map at once.
  await page.addInitScript(([authKey, bootSeenKey, session]) => {
    window.localStorage.setItem(authKey, JSON.stringify(session));
    window.sessionStorage.setItem(bootSeenKey, String(session.accountId));
  }, [AUTH_STORAGE_KEY, OCC_BOOT_SEEN_KEY, occSession()]);
  const response = await page.goto(`${PAGE}${query}`);
  expect(response?.status(), `GET ${PAGE}${query}`).toBe(200);
  const map = page.getByTestId('occ-map');
  await mapReady(map);
  await expect(page.getByTestId('occ-boot-screen'), 'the OCC boot screen').toHaveCount(0, { timeout: 1_000 });
  await expect.poll(() => api.reads, { message: 'the positions board was read' }).toBeGreaterThan(0);
  return { api, map };
}

// Resolves once the map has drawn the positions with nothing left to load, place or fade.
async function settled(page) {
  await expect(page.getByTestId('positions-map-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('occ-map')).toHaveAttribute('data-occ-settled', 'true');
}

const legend = page => page.getByRole('list', { name: 'Leyenda' });
const drawer = page => page.getByTestId('position-detail-drawer');
const stand = page => new URL(page.url()).searchParams.get('stand');
const canvas = page => page.getByTestId('position-map-container').locator('canvas.maplibregl-canvas');

// The page's search puts `code` in the middle of the map, a step past the ramp view, and opens its drawer.
async function search(page, code) {
  const field = page.getByPlaceholder('Buscar posición, vuelo o matrícula...');
  await field.fill(code);
  await field.press('Enter');
  await expect(drawer(page)).toBeVisible();
}

// Puts `code` in the middle of the map, closes its drawer (the stand stays selected) and clears the search, which
// filters the stands while it holds text.
async function centreOn(page, code) {
  await search(page, code);
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);
  await page.getByPlaceholder('Buscar posición, vuelo o matrícula...').fill('');
  await settled(page);
}

// The pixel of the middle of the area in sight, plus `dx` and `dy`: since M1 the panels float over the map and the
// camera centres what it brings in the area they leave (the map's insets, --occ-map-inset-*), not in the canvas.
async function mapPoint(page, dx = 0, dy = 0) {
  const box = await canvas(page).boundingBox();
  const inset = await page.getByTestId('occ-map').evaluate(node => Object.fromEntries(['top', 'right', 'bottom', 'left']
    .map(side => [side, Number.parseFloat(node.style.getPropertyValue(`--occ-map-inset-${side}`)) || 0])));
  return { x: box.x + inset.left + (box.width - inset.left - inset.right) / 2 + dx,
    y: box.y + inset.top + (box.height - inset.top - inset.bottom) / 2 + dy };
}

async function foldLegend(page) {
  const toggle = page.getByTestId('occ-map').getByRole('button', { name: 'Leyenda', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

async function unfoldLegend(page) {
  const toggle = page.getByTestId('occ-map').getByRole('button', { name: 'Leyenda', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test.describe('Mapa de posiciones: what a person does with the stands', () => {
  test('a stand under the pointer shows its tooltip; a click opens its drawer; the stands of its agent are marked', async ({ page, isolation }, testInfo) => {
    // A link to A2 on terminal A: the drawer opens on it, and says what the map says, with the milestones its progress
    // bar draws (PR M6: nine of the flight report's 25 recorded).
    const { map } = await openPositionsMap(page, isolation, '?view=ramp&terminal=A&stand=A2');
    await settled(page);
    const facts = drawer(page).getByRole('list', { name: 'Estado en el mapa' });
    await expect(facts.getByRole('listitem')).toHaveText([
      'Ocupada', /^Ocupada por ZZ101 desde las /, /^Próximo cambio /, 'Cubre Agente de prueba', 'Hitos registrados: 9 de 25',
    ]);
    // Its terminal and where its location comes from are characteristics since #190.
    const characteristics = drawer(page).getByRole('region', { name: 'Características' });
    await expect(characteristics.locator('[data-fact="kind"] dd')).toHaveText(/^Terminal A/);
    await expect(characteristics.locator('[data-fact="location"] dd')).toHaveText(/^No oficial/);
    await shoot(page, testInfo, 'positions-interactions-drawer');

    // One Esc closes only the drawer: A2 stays selected, and the stands its agent covers are ringed and explained.
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    expect(stand(page)).toBe('A2');
    await settled(page);
    // A link to a stand opens with the legend folded (U5: the stand is brought to the centre, under where it opens).
    await unfoldLegend(page);
    await expect(legend(page).getByRole('listitem')).toContainText(['Mismo agente que la posición elegida']);
    await shoot(page, testInfo, 'positions-interactions-coverage-legend');
    await foldLegend(page);
    await settled(page);
    await shoot(page, testInfo, 'positions-interactions-coverage');
    await unfoldLegend(page);
    // A second Esc on the map clears the selection, and the legend no longer explains the ring.
    await canvas(page).focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => stand(page)).toBeNull();
    await expect(legend(page).getByRole('listitem')).not.toContainText(['Mismo agente que la posición elegida']);

    // B24: a flight within 15 minutes and nobody covering it. Under the pointer: its code, state, flight and the
    // reason of its signal with its shape.
    await centreOn(page, 'B24');
    await foldLegend(page);
    const centre = await mapPoint(page);
    await page.mouse.move(centre.x, centre.y);
    const card = page.getByRole('tooltip');
    await expect(card).toHaveAttribute('data-kind', 'stand');
    await expect(card).toContainText('B24 · Llegando');
    await expect(card).toContainText('ZZ111');
    await expect(card).toContainText('Sin agente que la cubra');
    await expect(card.getByRole('img', { name: 'Atención' })).toBeVisible();
    await expect(canvas(page)).toHaveCSS('cursor', 'pointer');
    await shoot(page, testInfo, 'positions-interactions-hover');

    // A click on it opens its drawer with the same facts; the tooltip goes.
    await page.mouse.click(centre.x, centre.y);
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    expect(stand(page)).toBe('B24');
    await expect(drawer(page).getByRole('list', { name: 'Estado en el mapa' })).toContainText('Sin agente que la cubra');
    await expect(map).toHaveAttribute('data-occ-engine', 'ready');
  });

  test('N26: a stand whose coverage ended asks for an agent and its drawer says, dimmed, until when it was covered', async ({ page, isolation }, testInfo) => {
    // BN8: an aircraft on it, and the coverage of the stub's agent ended two hours ago (fixtures/occApi.mjs), though the
    // names of the day still list them. The positions map reads the board with its coverage windows.
    await openPositionsMap(page, isolation, '?stand=BN8');
    await settled(page);
    const facts = drawer(page).getByRole('list', { name: 'Estado en el mapa' });
    await expect(facts.locator('[data-fact="coverage"]')).toHaveCount(0);
    const ended = facts.locator('[data-fact="coverage-ended"]');
    await expect(ended).toHaveText(/^La cobertura de Agente de prueba terminó a las \d\d:\d\d$/);
    await expect(ended).toHaveClass(/text-occ-muted/);
    await expect(facts).toContainText('Sin agente que la cubra');
    // The turnaround's agent and the flight's: nobody now.
    await expect(drawer(page).locator('[data-fact="agent"] dd')).toHaveText('Sin agente');
    await shoot(page, testInfo, 'positions-interactions-coverage-ended');
    // A2 keeps the agent who covers it now.
    await page.goto(`${PAGE}?stand=A2`);
    await settled(page);
    await expect(drawer(page).getByRole('list', { name: 'Estado en el mapa' })).toContainText('Cubre Agente de prueba');
  });

  test('the combined pair: the cancelled stand with its hatch, its link to the stand that cancels it and «Inhabilitada: anulada por A9 ocupada»', async ({ page, isolation }, testInfo) => {
    await openPositionsMap(page, isolation, '?stand=A10');
    await settled(page);
    await expect(drawer(page).getByRole('list', { name: 'Estado en el mapa' }).getByRole('listitem'))
      .toHaveText(['Inhabilitada', 'Inhabilitada: anulada por A9 ocupada']);
    await expect(drawer(page).getByTestId('combined-position-banner')).toBeVisible();

    // Up close on A10, selected: its casing, the hatch and the dashed link to A9; the legend explains the link.
    await page.keyboard.press('Escape');
    await centreOn(page, 'A10');
    await unfoldLegend(page);
    await expect(legend(page).getByRole('listitem')).toContainText(['Inhabilitada', 'Enlace con la posición que la anula']);
    // The legend folded, so the pair it explains shows.
    await foldLegend(page);
    await settled(page);
    await shoot(page, testInfo, 'positions-interactions-combined');
  });

  test('«Ubicar en el mapa»: the box follows the pointer, a click sets the pending location and only «Guardar ubicación» saves it', async ({ page, isolation }, testInfo) => {
    const { api } = await openPositionsMap(page, isolation);
    await settled(page);
    const b27 = positionsBoard({ date: '2026-11-13' }).positions.find(item => item.code === 'B27');

    // B27's drawer, «Ubicar en el mapa»: the notice takes the focus and nothing is saved yet.
    await search(page, 'B27');
    await drawer(page).getByRole('button', { name: 'Ubicar en el mapa' }).click();
    await expect(drawer(page)).toHaveCount(0);
    const notice = page.getByRole('group', { name: 'Ubicar B27 en el mapa' });
    await expect(notice.getByRole('status')).toHaveText('Haz clic en el centro de la posición B27.');
    await expect(notice.getByRole('button', { name: 'Guardar ubicación' })).toBeDisabled();
    await page.getByPlaceholder('Buscar posición, vuelo o matrícula...').fill('');
    await foldLegend(page);
    await settled(page);

    // The box of B27 at true size follows the pointer, here 30 px east of its centre.
    const target = await mapPoint(page, 30, 24);
    await page.mouse.move(target.x, target.y);
    await expect(canvas(page)).toHaveCSS('cursor', 'crosshair');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await settled(page);
    await shoot(page, testInfo, 'positions-interactions-placing-ghost');

    // A click sets the pending location; nothing is sent until «Guardar ubicación».
    await page.mouse.click(target.x, target.y);
    await expect(notice.getByRole('button', { name: 'Guardar ubicación' })).toBeEnabled();
    expect(api.locates).toEqual([]);
    // The pointer off the map: only the pending box is left, which the legend explains.
    await notice.hover();
    await unfoldLegend(page);
    await expect(legend(page).getByRole('listitem')).toContainText(['Ubicación sin guardar']);
    await foldLegend(page);
    await settled(page);
    await shoot(page, testInfo, 'positions-interactions-placing-pending');

    // «Guardar ubicación»: the same command as always, then the board read again and the stand moved where it was put.
    const reads = api.reads;
    await notice.getByRole('button', { name: 'Guardar ubicación' }).click();
    await expect(page.getByText('B27 quedó ubicada en el mapa.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Ubicar B27 en el mapa' })).toHaveCount(0);
    expect(api.locates).toHaveLength(1);
    expect(api.locates[0]).toMatchObject({ standId: b27.standId, operationDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(Number.isFinite(api.locates[0].latitude) && Number.isFinite(api.locates[0].longitude)).toBe(true);
    await expect.poll(() => api.reads).toBeGreaterThan(reads);
    await settled(page);
    await shoot(page, testInfo, 'positions-interactions-placing-saved');

    // Its drawer now says OCC placed it.
    await search(page, 'B27');
    await expect(drawer(page).getByRole('region', { name: 'Características' }).locator('[data-fact="location"] dd'))
      .toHaveText(/^Ubicada por OCC/);
  });
});
