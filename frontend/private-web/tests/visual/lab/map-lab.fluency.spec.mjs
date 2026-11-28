import { openLab } from '../support/map.mjs';
import { expectGpuGates, gpuReport, gpuRun, measureFrames, recordPerf } from '../support/perf.mjs';
import { expect, production, test } from '../support/test.mjs';

// The fluency of the OCC maps in Chrome (CN-18: «fluidez NOC», aircraft «teletransportándose»). The lab's feed scenes
// read the traffic again every 10 s, 3 s late, on a running clock whose server offset moves at every read
// (lab/trafficScenes.js: LAB_FEED). PR M2 (2026-11-28): for `OCC_FLUENCY_SECONDS` (30 by default) the page counts what
// the screen shows (support/perf.mjs): the frames MapLibre draws, their p50 and p95 frame time and the share over
// 33.3 ms, its long tasks, and, at every drawn frame, where that frame drew three aircraft (the demo flight, a straight
// one and a turning one; on the airfield only the demo flight is in sight), so the interpolated positions on screen per
// second show, a jump shows as one step of many pixels and a pull-back as a step against the way it flies; only steps
// inside the map count. The numbers and the GPU are printed for the pull request. On the real GPU (OCC_VISUAL_GPU) the
// gates are the plan's: at least 30 frames a second, p95 within 33 ms, and the moving aircraft redrawn at 30 a second
// or more; with SwiftShader (the default run) they stay smoke checks.

const SECONDS = Number(process.env.OCC_FLUENCY_SECONDS ?? 30);
// `OCC_FLUENCY_CPU_THROTTLE=4` slows the page's CPU four times (Chrome DevTools), closer to a small server's CPU.
const THROTTLE = Number(process.env.OCC_FLUENCY_CPU_THROTTLE ?? 1);
const DEMO = 'f:p:5b000000-0000-4000-8000-000000009001';
const SCENES = Object.freeze({
  'perf-approach-feed': { demo: DEMO, straight: 'h:f0d001', turning: 'h:f0d003' },
  'perf-airfield-feed': { demo: DEMO },
});

test.describe('map lab fluency', () => {
  test.skip(production, 'The map lab exists in development only.');
  // The traffic moves every frame only without reduced motion (the suite asks for it by default).
  test.use({ reducedMotion: 'no-preference' });
  test.setTimeout(Math.max(180_000, SECONDS * 4_000 + 120_000));

  for (const [scene, ids] of Object.entries(SCENES)) {
    test(`${scene}: no long-task saturation and no jumps over ${SECONDS} s of a live feed`, async ({ page }, testInfo) => {
      const map = await openLab(page, `scene=${scene}`);
      await expect(map).toHaveAttribute('data-occ-basemap', 'ok');
      // The first read of the feed and the first blends.
      if (THROTTLE > 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      }
      await page.waitForTimeout(4_000);
      const gpu = await gpuReport(page, testInfo);
      const result = await measureFrames(page, SECONDS, ids);
      console.log(`[fluency] ${scene} cpu×${THROTTLE} ${JSON.stringify(result)}`);
      await testInfo.attach(`${scene}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
      recordPerf(scene, { ...result, cpuThrottle: THROTTLE }, gpu);
      if (process.env.OCC_FLUENCY_REPORT_ONLY === '1') return;
      expect(result.blockedMsPerMin, 'long tasks per minute').toBeLessThan(10_000);
      for (const [key, aircraft] of Object.entries(result.aircraft)) {
        expect(aircraft.steps, `${key} moves`).toBeGreaterThan(0);
        expect(aircraft.maxStepPx, `${key}: no jump`).toBeLessThan(6);
        expect(aircraft.backward, `${key}: no pull-back`).toBe(0);
      }
      if (gpuRun) {
        expectGpuGates(result, scene);
        const best = Math.max(...Object.values(result.aircraft).map(aircraft => aircraft.updatesPerS));
        expect(best, 'a moving aircraft redrawn on screen per second').toBeGreaterThanOrEqual(30);
      } else expect(result.renderFps, 'frames MapLibre draws per second (software WebGL)').toBeGreaterThan(5);
    });
  }
});
