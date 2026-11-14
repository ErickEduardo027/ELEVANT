import { API_PATHS, createScreensApi } from './fixtures/screensApi.mjs';
import { SCREEN_VIEWPORTS, openOccScreen } from './occScreen.mjs';
import { shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// Datos maestros (PR U6, step d) in Chrome: template D of the design («Registro») with a synthetic OCC session and a
// stubbed API (fixtures/screensApi.mjs), in the two windows of the presentation. One panel per register, each with its
// dense table of edit rows and, under it, the form that adds one; every stand links to the positions map. Screenshots
// for review go to test-results/visual as datos-maestros-{state}-{width}.png. The stub answers no command: nothing is
// created or changed.

const PAGE = '/admin-occ/master-data';
// The light key of the primary action (--occ-primary); a control changes its colours through a short transition.
const PRIMARY_KEY = 'rgb(232, 238, 241)';

async function openMasterData(page, isolation, viewport, scenario = 'data', options = {}) {
  const api = createScreensApi(scenario, options);
  const main = await openOccScreen(page, isolation, { path: PAGE, api, viewport });
  await expect(main.getByRole('heading', { level: 1, name: 'Datos maestros' })).toBeVisible();
  await expect(main.getByText('Cargando los datos maestros…')).toHaveCount(0);
  return {
    api, main,
    terminals: main.getByRole('region', { name: 'Terminales', exact: true }),
    stands: main.getByRole('region', { name: 'Posiciones', exact: true }),
    types: main.getByRole('region', { name: 'Tipos de avión', exact: true }),
  };
}

// The row of a record, found by the accessible name of one of its controls.
const rowOf = (page, region, label) => region.getByRole('row').filter({ has: page.getByLabel(label, { exact: true }) });
// The layout commands sent (terminals, stands and aircraft types): the stub refuses them, and a spec never sends one.
const LAYOUT_COMMANDS = Object.freeze(['/api/v1/occ/terminals', '/api/v1/occ/stands', '/api/v1/occ/aircraft-types']);
const commands = isolation => isolation.requests.filter(entry => entry.kind === 'api' && entry.method !== 'GET'
  && LAYOUT_COMMANDS.some(path => new URL(entry.url).pathname.startsWith(path)));

for (const viewport of SCREEN_VIEWPORTS) {
  test.describe(`Datos maestros at ${viewport.width}×${viewport.height}`, () => {
    test('the registers with their edit rows', async ({ page, isolation }, testInfo) => {
      const { main, terminals, stands, types } = await openMasterData(page, isolation, viewport);
      // Terminals: a header row and four; A has history, so its code is fixed; C is out of use, dimmed, with its pill.
      await expect(terminals.getByRole('table', { name: 'Terminales' }).getByRole('row')).toHaveCount(5);
      await expect(terminals.getByLabel('Código de la terminal A', { exact: true })).toBeDisabled();
      await expect(terminals.getByText('Con historial: el código no cambia.')).toBeVisible();
      const closed = rowOf(page, terminals, 'Nombre de la terminal C');
      await expect(closed.locator('[data-occ-status]')).toHaveText('Inactiva');
      await expect(closed.locator('.opacity-70').first()).toHaveCSS('opacity', '0.7');
      await expect(terminals.getByRole('form', { name: 'Nueva terminal' })).toBeVisible();
      await expect(terminals.getByRole('button', { name: 'Crear terminal' })).toBeDisabled();
      await shoot(page, testInfo, `datos-maestros-terminales-${viewport.width}`);

      // Stands: ten rows, each with its link to the positions map (contratos 2.1); A11 is out of use.
      await stands.scrollIntoViewIfNeeded();
      const table = stands.getByRole('table', { name: 'Posiciones' });
      await expect(table.getByRole('row')).toHaveCount(11);
      await expect(stands.getByRole('link', { name: /^Ver .+ en el mapa$/ })).toHaveCount(10);
      await expect(stands.getByRole('link', { name: 'Ver A1 en el mapa' })).toHaveAttribute('href', '/admin-occ/positions-map?stand=A1');
      await expect(rowOf(page, stands, 'Código de la posición A11').locator('[data-occ-status]')).toHaveText('Inactiva');
      await expect(stands.getByRole('combobox', { name: 'Tamaño máximo de la posición BN6' })).toHaveValue('Narrowbody');
      await expect(rowOf(page, stands, 'Código de la posición B20').getByLabel('Puente', { exact: true })).toBeChecked();
      // An edited row offers its «Guardar»; nothing is sent until it is pressed.
      const an1 = rowOf(page, stands, 'Código de la posición AN1');
      await an1.getByLabel('Activa', { exact: true }).uncheck();
      await expect(an1.getByRole('button', { name: 'Guardar' })).toBeVisible();
      await shoot(page, testInfo, `datos-maestros-posiciones-${viewport.width}`);

      // Aircraft types: five rows, B752 out of use; the form adds one with the light key once it is complete.
      await types.scrollIntoViewIfNeeded();
      await expect(types.getByRole('table', { name: 'Tipos de avión' }).getByRole('row')).toHaveCount(6);
      await expect(rowOf(page, types, 'Modelo de B752').locator('[data-occ-status]')).toHaveText('Inactivo');
      const form = types.getByRole('form', { name: 'Nuevo tipo de avión' });
      await form.getByLabel('OACI', { exact: true }).fill('a21n');
      await form.getByLabel('Fabricante', { exact: true }).fill('Airbus');
      await form.getByLabel('Modelo', { exact: true }).fill('A321neo');
      await form.getByRole('combobox', { name: /^Tamaño/ }).selectOption('Narrowbody');
      await expect(form.getByLabel('OACI', { exact: true })).toHaveValue('A21N');
      const create = form.getByRole('button', { name: 'Crear tipo de avión' });
      await expect(create).toBeEnabled();
      await expect(create).toHaveCSS('background-color', PRIMARY_KEY);
      await main.evaluate(node => node.scrollTo(0, node.scrollHeight));
      await shoot(page, testInfo, `datos-maestros-tipos-${viewport.width}`);
      expect(commands(isolation)).toEqual([]);
    });

    test('read-only', async ({ page, isolation }, testInfo) => {
      const { main, terminals, stands } = await openMasterData(page, isolation, viewport, 'data', { readOnly: true });
      await expect(main.getByRole('status').filter({ hasText: 'Tu acceso permite consultar los datos maestros, no modificarlos.' }))
        .toBeVisible();
      await expect(main.getByRole('form')).toHaveCount(0);
      await expect(terminals.getByLabel('Nombre de la terminal FBO', { exact: true })).toBeDisabled();
      await expect(rowOf(page, stands, 'Código de la posición AN1').getByLabel('Activa', { exact: true })).toBeDisabled();
      // Reading the map stays open to a read-only account.
      await expect(stands.getByRole('link', { name: 'Ver B21 en el mapa' })).toBeVisible();
      await shoot(page, testInfo, `datos-maestros-solo-lectura-${viewport.width}`);
    });

    test('empty', async ({ page, isolation }, testInfo) => {
      const { terminals, stands, types } = await openMasterData(page, isolation, viewport, 'empty');
      await expect(terminals.getByText('La estación aún no tiene terminales. Crea la primera para registrar sus posiciones.'))
        .toBeVisible();
      await expect(terminals.getByRole('form', { name: 'Nueva terminal' })).toBeVisible();
      await expect(stands.getByText('La estación aún no tiene posiciones.')).toBeVisible();
      await expect(stands.getByText('Crea o reactiva una terminal para registrar sus posiciones.')).toBeVisible();
      await expect(types.getByText('Aún no hay tipos de avión.')).toBeVisible();
      await shoot(page, testInfo, `datos-maestros-vacio-${viewport.width}`);
    });

    test('forbidden', async ({ page, isolation }, testInfo) => {
      const { api, main } = await openMasterData(page, isolation, viewport, 'forbidden');
      await expect(main.getByRole('alert')).toHaveText('Tu acceso no permite ver los datos maestros de esta estación.');
      await expect(main.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
      await expect(main.getByText('Forbidden')).toHaveCount(0);
      await shoot(page, testInfo, `datos-maestros-sin-permiso-${viewport.width}`);
      expect(api.readsOf(API_PATHS.masterData)).toBe(1);
    });
  });
}
