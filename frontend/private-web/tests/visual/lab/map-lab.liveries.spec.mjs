import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The detailed 3D aircraft with their liveries (CN-30) in Chrome's real WebGL (SwiftShader where there is no GPU): the
// lab's showcase scene (lab/aircraftShowcaseScene.js: synthetic live aircraft with the callsigns of six airlines, the
// clock frozen), each aircraft chosen and seen up close from the side, from three quarters ahead and from high up, as
// «Seguir en 3D» will frame it, for a person to review in test-results/visual. Beside the pictures it checks that the
// detailed model is the one drawn (its textures painted) and measures the frames per second while the camera turns
// round it every frame, as the follow camera does.

// Each aircraft: its address, the name of its pictures, its track and how far the camera stays back (zoom levels below
// the view's): the one on final flies 150 m up, so the camera, aimed at the ground under it, frames it from further.
const SHOWCASE = Object.freeze([
  ['f0d001', 'copa-b738', 73.8, 0],
  ['f0d002', 'american-a321', 73.8, 0],
  ['f0d003', 'united-b789', 73.8, 0.3],
  ['f0d004', 'jetblue-a320', 73.8, 0],
  ['f0d005', 'arajet-b38m', 253.8, 0],
  ['f0d006', 'generic-at76', 290, -0.2],
  ['f0d007', 'avianca-a320-final', 70, 2.2],
]);
// The views: from the right side, three quarters ahead on the left, and high up behind on the right.
// The map tilts 65° at most and zooms to 19.5 (core/mapEngine.js).
const VIEWS = Object.freeze([
  ['side', track => track - 90, 65, 19.4],
  ['three-quarter', track => track + 135, 60, 19.2],
  ['high', track => track + 30, 35, 18.8],
]);

const state3d = page => page.evaluate(() => window.__occMapLab.aircraft3d());

async function foldLegend(page) {
  const legend = page.getByRole('button', { name: 'Leyenda' });
  if (await legend.count() > 0 && await legend.getAttribute('aria-expanded') === 'true') await legend.click();
}

async function closeTo(page, id, { bearing, pitch, zoom }) {
  const at = await page.evaluate(aircraft => window.__occMapLab.aircraftAt(aircraft), id);
  expect(at, `where ${id} is`).not.toBeNull();
  await page.evaluate(camera => window.__occMapLab.jumpTo(camera), { center: at, zoom, pitch, bearing });
}

test.describe('map lab detailed 3D aircraft and liveries', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('screenshots of each livery from the side, three quarters and high up', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [hex, name, track, back] of SHOWCASE) {
      const map = await openLab(page, `scene=airfield-3d-showcase&t=${NOON}&hex=${hex}`);
      await expect(map).toHaveAttribute('data-occ-3d', 'ready');
      await foldLegend(page);
      for (const [view, bearingOf, pitch, zoom] of VIEWS) {
        await closeTo(page, `h:${hex}`, { bearing: bearingOf(track), pitch, zoom: zoom - back });
        await expect.poll(async () => (await state3d(page))?.stats?.detail?.key ?? null).not.toBeNull();
        const state = await state3d(page);
        expect(state.stats).toMatchObject({ failed: false, lost: false });
        expect(state.stats.detail.textured, `${name} painted`).toBe(true);
        await labIdle(page);
        await shoot(page, testInfo, `liveries-${name}-${view}`);
      }
    }
    expect(errors).toEqual([]);
  });

  test('frames per second with the detailed model while the camera turns round it', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const seconds = Number(process.env.OCC_FLUENCY_SECONDS ?? 10);
    // The same orbit without a chosen aircraft (no detailed model), then with the Copa 737 chosen.
    await openLab(page, `scene=airfield-3d-showcase&t=${NOON}`);
    await foldLegend(page);
    await closeTo(page, 'h:f0d001', { bearing: 0, pitch: 60, zoom: 19 });
    const baseline = await page.evaluate(orbit, seconds);
    await openLab(page, `scene=airfield-3d-showcase&t=${NOON}&hex=f0d001`);
    await foldLegend(page);
    await closeTo(page, 'h:f0d001', { bearing: 0, pitch: 60, zoom: 19 });
    await expect.poll(async () => (await state3d(page))?.stats?.detail?.key ?? null).not.toBeNull();
    const result = await page.evaluate(orbit, seconds);
    testInfo.annotations.push({ type: 'fps-baseline', description: JSON.stringify(baseline) });
    console.log(`orbit without the detailed model: ${JSON.stringify(baseline)}`);
    testInfo.annotations.push({ type: 'fps', description: JSON.stringify(result) });
    console.log(`detailed model orbit: ${JSON.stringify(result)}`);
    expect(result.stats.detail).toBeTruthy();
    expect(result.fps).toBeGreaterThan(0.6 * baseline.fps);
    await labIdle(page);
    await shoot(page, testInfo, 'liveries-orbit-end');
  });
});

// Turns the camera round its centre every frame for `duration` seconds: frames per second, the 95th percentile of the
// time between frames, the long tasks per minute and the 3D's stats at the end.
async function orbit(duration) {
  const lab = window.__occMapLab;
  const start = lab.getCamera();
  const frames = [];
  let longTasks = 0;
  const observer = typeof PerformanceObserver === 'function' ? new PerformanceObserver(list => {
    for (const entry of list.getEntries()) longTasks += entry.duration;
  }) : null;
  try {
    observer?.observe({ type: 'longtask', buffered: false });
  } catch {
    // No long-task timing in this browser.
  }
  const began = performance.now();
  await new Promise(resolve => {
    const step = now => {
      frames.push(now);
      const t = (now - began) / 1000;
      lab.jumpTo({ center: start.center, zoom: start.zoom, pitch: start.pitch, bearing: (t * 24) % 360 });
      if (now - began < duration * 1000) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  observer?.disconnect();
  const gaps = frames.slice(1).map((at, index) => at - frames[index]).sort((a, b) => a - b);
  return {
    fps: (frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000),
    p95FrameMs: gaps[Math.floor(gaps.length * 0.95)] ?? null,
    longTaskMsPerMinute: (longTasks / duration) * 60,
    stats: lab.aircraft3d()?.stats ?? null,
  };
}
