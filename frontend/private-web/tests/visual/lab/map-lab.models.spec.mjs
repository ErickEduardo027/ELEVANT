import { readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { NOON, labIdle, openLab } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// M5 (2026-11-28): the visual review of the third-party 3D models (public/models/aircraft) in Chrome's real WebGL
// (SwiftShader where there is no GPU). The lab's gallery scene (lab/aircraftShowcaseScene.js: GALLERY_AIRCRAFT) has each
// type three times with three liveries; each one is chosen in turn, so it draws its L2 model while the other two, 160 m
// away, draw their L1 model, and it is seen up close from the side, three quarters ahead and high up behind, as the
// liveries spec frames the showcase. Each picture is cut round the aircraft, and one contact sheet per type puts its
// nine pictures together (the rows its liveries, the columns its views) for a person to review: in
// test-results/visual/models, or in the folder OCC_MODELS_SHOTS names. One test per type: --grep B738 reruns one.

const manifest = JSON.parse(readFileSync(path.resolve('public/models/aircraft/manifest.json'), 'utf8'));
// The gallery's aircraft, as lab/aircraftShowcaseScene.js lays them out: three per type, in the order of GALLERY_TYPES.
const GALLERY_TYPES = Object.freeze([
  'A319', 'A320', 'A20N', 'A321', 'A21N', 'A332', 'A333', 'A339', 'B737', 'B738', 'B739', 'B38M', 'B39M', 'B752',
  'B772', 'B77W', 'B788', 'B789', 'E190', 'E195', 'CRJ9', 'AT76',
]);
const TRACK = 73.8;
// The views: from the right side, three quarters ahead on the left, and high up behind on the right.
const VIEWS = Object.freeze([
  ['side', track => track - 90, 65, 19.4],
  ['three-quarter', track => track + 135, 60, 19.2],
  ['high', track => track + 30, 35, 18.8],
]);
// The cut round the aircraft (at the centre of the map), and its size on the contact sheet, in CSS pixels. The pictures
// are taken at twice the pixel density, so the lettering and the logos can be read (QA of 2026-11-28).
const CUT = Object.freeze({ width: 600, height: 360 });
const TILE = Object.freeze({ width: 600, height: 360 });
const SCALE = 2;

const shotsDir = testInfo => process.env.OCC_MODELS_SHOTS ?? path.join(testInfo.project.outputDir, 'models');
const hexOf = (index, row) => `f0d1${(index * 3 + row).toString(16).padStart(2, '0')}`;
const state3d = page => page.evaluate(() => window.__occMapLab.aircraft3d());

async function foldLegend(page) {
  const legend = page.getByRole('button', { name: 'Leyenda' });
  if (await legend.count() > 0 && await legend.getAttribute('aria-expanded') === 'true') await legend.click();
}

// Lays out the nine pictures of a type on one sheet: the rows its liveries, the columns its views.
async function contactSheet(page, files, title, target) {
  const sources = await Promise.all(files.map(async file => `data:image/png;base64,${(await readFile(file)).toString('base64')}`));
  await page.setViewportSize({ width: TILE.width * VIEWS.length, height: TILE.height * 3 + 28 });
  await page.setContent(`<!doctype html><body style="margin:0;background:#111;color:#ddd;font:14px sans-serif">
    <div style="height:28px;line-height:28px;padding-left:8px">${title}</div>
    <div style="display:grid;grid-template-columns:repeat(${VIEWS.length},${TILE.width}px)">
    ${sources.map(src => `<img src="${src}" style="width:${TILE.width}px;height:${TILE.height}px;display:block">`).join('')}
    </div></body>`);
  await page.screenshot({ path: target, fullPage: true });
}

test.describe('map lab 3D models of every type (M5)', () => {
  test.skip(production, 'The map lab exists in development only.');
  test.use({ deviceScaleFactor: SCALE });

  test('the gallery names every type of the models manifest', () => {
    expect([...GALLERY_TYPES].sort()).toEqual(Object.keys(manifest.types).sort());
  });

  for (const [index, type] of GALLERY_TYPES.entries()) {
    test(`${type}: three liveries from the side, three quarters and high up`, async ({ page }, testInfo) => {
      test.setTimeout(420_000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 900 });
      const dir = shotsDir(testInfo);
      await mkdir(dir, { recursive: true });
      // The longer the aircraft, the further back the camera stays (zoom levels below the view's).
      const length = manifest.types[type]?.dimensionsM?.length ?? 38;
      const back = Math.max(0, Math.log2(length / 40));
      const map = await openLab(page, `scene=airfield-3d-models&t=${NOON}`);
      await expect(map).toHaveAttribute('data-occ-3d', 'ready');
      await foldLegend(page);
      const canvas = await page.getByTestId('map-lab-map').locator('canvas.maplibregl-canvas').boundingBox();
      const files = [];
      for (const row of [0, 1, 2]) {
        const hex = hexOf(index, row);
        const registration = `ZZ-G${hex.slice(4).toUpperCase()}`;
        await page.evaluate(id => window.__occMapLab.selectAircraft(id), hex);
        const at = await page.evaluate(id => window.__occMapLab.aircraftAt(id), `h:${hex}`);
        expect(at, `where ${hex} is`).not.toBeNull();
        for (const [view, bearingOf, pitch, zoom] of VIEWS) {
          await page.evaluate(camera => window.__occMapLab.jumpTo(camera),
            { center: at, zoom: zoom - back, pitch, bearing: bearingOf(TRACK) });
          await expect.poll(async () => {
            const detail = (await state3d(page))?.stats?.detail ?? null;
            return detail?.level === 'l2' && detail.key.startsWith(`${type}|`) && detail.key.endsWith(`|${registration}`);
          }, `${type} ${hex} draws its L2 model`).toBe(true);
          const state = await state3d(page);
          expect(state.stats).toMatchObject({ failed: false, lost: false });
          await labIdle(page);
          const file = path.join(dir, `${type}-${row + 1}-${view}.png`);
          await page.screenshot({
            path: file, style: 'nextjs-portal { display: none !important; }',
            clip: { x: canvas.x + (canvas.width - CUT.width) / 2, y: canvas.y + (canvas.height - CUT.height) / 2,
              width: CUT.width, height: CUT.height },
          });
          files.push(file);
        }
      }
      expect(errors).toEqual([]);
      await contactSheet(page, files, `${type} — ${manifest.types[type]?.name ?? ''} (filas: libreas 1-3; columnas: lado, tres cuartos, alto)`,
        path.join(dir, `sheet-${type}.png`));
    });
  }
});
