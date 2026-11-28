import { NOON, labIdle, openLab, shoot } from '../support/map.mjs';
import { GPU_GATES, gpuReport, gpuRun, measureFrames, recordPerf } from '../support/perf.mjs';
import { expect, production, test } from '../support/test.mjs';

// CN-29, CN-30 and CN-31 in Chrome, on the map lab's invented data (screenshots in test-results/visual for review):
// - the approach a live aircraft still flies (approach-live-offplan): AA465 north-west of Higüey, off its plan, chosen:
//   its dashed route leaves from where it is, on its track, and joins the final of 08 without a corner; the crowd at the
//   terminals keeps its tags apart at the airfield's zoom;
// - «Seguir en 3D» through a real visit replayed from its fixes (airfield-3d-replay): approach, touchdown (on the
//   runway), taxi-in, parked (on the stand's point, with its heading), push-back, taxi-out and take-off, each followed
//   in 3D with its panel; the orbit at four angles and the tower's view; Esc stops and flies the camera back;
// - the fluency of follow mode on the running replay (the frames MapLibre draws, their frame time and long tasks,
//   support/perf.mjs), printed for the pull request; on the real GPU (OCC_VISUAL_GPU) at least 30 frames a second.

const ARRIVAL = 'p:5c900000-0000-4000-8000-000000000893';
const DEPARTURE = 'p:5c900000-0000-4000-8000-000000000894';
const OFFPLAN = 'p:5c900000-0000-4000-8000-000000000465';
// The phases of lab/replayScenes.js (REPLAY_TIMES, REPLAY_PHASES), seconds after the lab's noon.
const TOUCHDOWN_S = 150;
const ON_BLOCK_S = 480;
const OFF_BLOCK_S = 660;
const PHASES = Object.freeze([
  ['approach', 60, ARRIVAL],
  ['touchdown', TOUCHDOWN_S + 3, ARRIVAL],
  ['taxi-in', TOUCHDOWN_S + 150, ARRIVAL],
  ['parked', ON_BLOCK_S + 60, ARRIVAL],
  ['pushback', OFF_BLOCK_S + 25, DEPARTURE],
  ['taxi-out', OFF_BLOCK_S + 160, DEPARTURE],
]);
const at = seconds => new Date(Date.parse(NOON) + seconds * 1_000).toISOString();
const THRESHOLD_08 = [-68.383102, 18.570299];
const THRESHOLD_26 = [-68.354797, 18.5781];
const A6 = [-68.363389, 18.563944];
const HIGUEY_NW = [-68.8, 18.7];

const metres = (a, b) => {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 6_371_008.8;
};
const bearing = (a, b) => {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
};
const turn = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
// Distance of a point from the segment between two runway thresholds (the runway's centreline), in metres.
function offCentreline(point, a, b) {
  const steps = 200;
  let best = Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const p = [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps];
    best = Math.min(best, metres(point, p));
  }
  return best;
}

const followButton = page => page.getByRole('button', { name: 'Seguir en 3D', exact: true });
const panel = page => page.getByTestId('follow-3d-panel');

// Starts «Seguir en 3D» from the data block and waits until the camera orbits the aircraft (under the suite's reduced
// motion the map's loop ticks once a second, and the camera jumps there) and the panel reads it.
async function startFollow(page) {
  await followButton(page).first().click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('[data-follow-phase]')).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.__occMapLab.getCamera()))?.zoom ?? 0).toBeGreaterThan(16);
  await labIdle(page);
}

// After a change of the orbit, the next tick of the loop and a settled map.
async function settle(page) {
  await page.waitForTimeout(1_200);
  await labIdle(page);
}

test.describe('route, follow mode in 3D and real positions (CN-29, CN-30, CN-31)', () => {
  test.skip(production, 'the map lab is development-only');

  test('the approach of a live aircraft off its plan is smooth onto the final of 08', async ({ page }, testInfo) => {
    await openLab(page, `scene=approach-live-offplan&t=${NOON}`);
    await labIdle(page);
    const route = await page.evaluate(() => window.__occMapLab.route());
    const remaining = route.features.find(feature => feature.properties.part === 'remaining');
    expect(remaining, 'the route still to fly').toBeTruthy();
    const coords = remaining.geometry.coordinates;
    // The route of the scene's situation starts where its fix has AA465 (the frames carry it on from there).
    expect(metres(coords[0], HIGUEY_NW)).toBeLessThan(5);
    // In the air (until the threshold of 08): no corner, and the last leg on the runway's heading.
    const atThreshold = coords.findIndex(point => metres(point, THRESHOLD_08) < 1);
    expect(atThreshold, 'the route passes over the threshold of 08').toBeGreaterThan(2);
    let worst = 0;
    for (let i = 1; i < atThreshold; i += 1) {
      if (metres(coords[i - 1], coords[i]) < 1 || metres(coords[i], coords[i + 1]) < 1) continue;
      worst = Math.max(worst, turn(bearing(coords[i - 1], coords[i]), bearing(coords[i], coords[i + 1])));
    }
    expect(worst, 'the largest turn between two legs in the air').toBeLessThan(3);
    expect(turn(bearing(coords[atThreshold - 1], coords[atThreshold]), 73.8)).toBeLessThan(1.5);
    console.log(`CN-29 approach of AA465: ${atThreshold} points in the air, largest turn ${worst.toFixed(2)}°`);
    await shoot(page, testInfo, 'cn29-approach-offplan');
    // The crowd at the terminals at the airfield's zoom: their tags keep apart.
    await page.evaluate(() => window.__occMapLab.flyToPreset('airfield'));
    await labIdle(page);
    await shoot(page, testInfo, 'cn29-airfield-tags');
  });

  for (const [phase, seconds, flight] of PHASES) {
    test(`follows the replayed visit in 3D: ${phase}`, async ({ page }, testInfo) => {
      await openLab(page, `scene=airfield-3d-replay&t=${at(seconds)}&flightId=${flight}`);
      await labIdle(page);
      await startFollow(page);
      const sample = await page.evaluate(id => window.__occMapLab.sampleAt(id), `f:${flight}`);
      expect(sample, 'the followed aircraft').not.toBeNull();
      const here = [sample.lon, sample.lat];
      if (phase === 'touchdown') {
        expect(sample.onGround, 'on the runway at the touchdown').toBe(true);
        expect(offCentreline(here, THRESHOLD_08, THRESHOLD_26), 'off the centreline of 08/26').toBeLessThan(25);
      }
      if (phase === 'parked') {
        expect(sample.parkedStand).toBe('A6');
        expect(metres(here, A6), 'from the parking point of A6').toBeLessThan(1);
        expect(sample.quality).toBe('live');
      }
      if (phase === 'approach') expect(sample.onGround).toBe(false);
      await shoot(page, testInfo, `cn30-follow3d-${phase}`);
      if (phase === 'parked') {
        // The orbit at four angles, then the tower's view and the side view.
        for (const angle of [90, 180, 270]) {
          for (let step = 0; step < 6; step += 1) {
            await panel(page).getByRole('button', { name: 'Girar a la derecha' }).press('Enter');
          }
          await settle(page);
          await shoot(page, testInfo, `cn30-orbit-${angle}`);
        }
        await panel(page).getByRole('radio', { name: 'Desde la torre' }).click();
        await settle(page);
        await shoot(page, testInfo, 'cn30-view-tower');
        await panel(page).getByRole('radio', { name: 'Lateral' }).click();
        await settle(page);
        await shoot(page, testInfo, 'cn30-view-side');
        // Esc stops following and flies the camera back.
        const before = await page.evaluate(() => window.__occMapLab.getCamera());
        await page.getByTestId('occ-map').press('Escape');
        await expect(panel(page)).toHaveCount(0);
        await settle(page);
        const after = await page.evaluate(() => window.__occMapLab.getCamera());
        expect(after.pitch).toBeLessThan(before.pitch);
      }
    });
  }

  test('follows the take-off in 3D', async ({ page }, testInfo) => {
    await openLab(page, `scene=airfield-3d-replay&t=${NOON}`);
    const phases = await page.evaluate(() => window.__occMapLab.replayPhases());
    for (const name of ['takeoff', 'climb']) {
      await openLab(page, `scene=airfield-3d-replay&t=${new Date(phases[name]).toISOString()}&flightId=${DEPARTURE}`);
      await labIdle(page);
      await startFollow(page);
      const sample = await page.evaluate(id => window.__occMapLab.sampleAt(id), `f:${DEPARTURE}`);
      // On the take-off roll it is still on the runway; climbing out it has left it.
      if (name === 'takeoff') {
        expect(sample.onGround).toBe(true);
        expect(offCentreline([sample.lon, sample.lat], THRESHOLD_08, THRESHOLD_26)).toBeLessThan(25);
      } else expect(sample.onGround).toBe(false);
      await shoot(page, testInfo, `cn30-follow3d-${name}`);
    }
  });

  test('keeps the frame budget while following in 3D', async ({ page }, testInfo) => {
    const seconds = Number(process.env.OCC_FLUENCY_SECONDS ?? 20);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openLab(page, `scene=airfield-3d-replay&flightId=${ARRIVAL}`);
    const gpu = await gpuReport(page, testInfo);
    // The same running replay first without following (the airfield in 3D), then followed in 3D (PR M2: the frames
    // MapLibre draws, support/perf.mjs, and where each drew the followed aircraft).
    const ids = { arrival: `f:${ARRIVAL}` };
    const before = await measureFrames(page, seconds, ids);
    console.log(`CN-30 replay without follow: ${JSON.stringify(before)}`);
    recordPerf('airfield-3d-replay', before, gpu);
    await startFollow(page);
    const result = await measureFrames(page, seconds, ids);
    console.log(`CN-30 follow 3D fluency: ${JSON.stringify(result)}`);
    recordPerf('airfield-3d-replay-follow3d', result, gpu);
    await testInfo.attach('follow3d-fluency.json', { body: JSON.stringify({ before, result }, null, 2),
      contentType: 'application/json' });
    if (process.env.OCC_FLUENCY_REPORT_ONLY === '1') return;
    // What follow mode must not add is blocked time; software WebGL (SwiftShader) bounds the frames per second, the
    // real GPU (OCC_VISUAL_GPU) holds the plan's floor of 30 drawn frames a second.
    expect(result.blockedMsPerMin / 1_000).toBeLessThan(10);
    if (gpuRun) {
      expect(before.renderFps, 'the replay in 3D: frames MapLibre draws per second').toBeGreaterThanOrEqual(GPU_GATES.minFps);
      expect(result.renderFps, 'followed in 3D: frames MapLibre draws per second').toBeGreaterThanOrEqual(GPU_GATES.minFps);
    } else expect(result.renderFps).toBeGreaterThan(5);
  });
});
