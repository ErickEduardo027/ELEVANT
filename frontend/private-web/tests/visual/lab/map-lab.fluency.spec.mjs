import { openLab } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// The fluency of the OCC maps in Chrome (CN-18: «fluidez NOC», aircraft «teletransportándose»). The lab's feed scenes
// read the traffic again every 10 s, 3 s late, on a running clock whose server offset moves at every read
// (lab/trafficScenes.js: LAB_FEED). For `OCC_FLUENCY_SECONDS` (30 by default) the page counts its long tasks and its
// frames and, every frame, projects where the map's last write drew three aircraft (the demo flight, a straight one and
// a turning one; on the airfield only the demo flight is in sight), so a jump shows as one step of many pixels and a
// pull-back as a step against the way it flies; only steps inside the map count. The numbers are printed for the pull
// request; the checks hold the targets of CN-18 with a margin for slower machines (software WebGL, `next dev`).

const SECONDS = Number(process.env.OCC_FLUENCY_SECONDS ?? 30);
// `OCC_FLUENCY_CPU_THROTTLE=4` slows the page's CPU four times (Chrome DevTools), closer to a small server's CPU.
const THROTTLE = Number(process.env.OCC_FLUENCY_CPU_THROTTLE ?? 1);
const DEMO = 'f:p:5b000000-0000-4000-8000-000000009001';
const SCENES = Object.freeze({
  'perf-approach-feed': { demo: DEMO, straight: 'h:f0d001', turning: 'h:f0d003' },
  'perf-airfield-feed': { demo: DEMO },
});

async function measure(page, seconds, ids) {
  return page.evaluate(({ ms, ids }) => new Promise(resolve => {
    const lab = window.__occMapLab;
    const box = document.querySelector('[data-testid="occ-map"]').getBoundingClientRect();
    const inside = point => point.x >= 0 && point.y >= 0 && point.x <= box.width && point.y <= box.height;
    const longTasks = [];
    const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
    observer.observe({ type: 'longtask', buffered: false });
    const tracks = Object.fromEntries(Object.keys(ids).map(key => [key, { last: null, dir: null, steps: [], backward: 0 }]));
    let frames = 0;
    let maxGapMs = 0;
    let lastFrame = null;
    const start = performance.now();
    const frame = now => {
      frames += 1;
      if (lastFrame !== null) maxGapMs = Math.max(maxGapMs, now - lastFrame);
      lastFrame = now;
      for (const [key, id] of Object.entries(ids)) {
        const lngLat = lab.drawnAt(id);
        const projected = lngLat ? lab.project(lngLat) : null;
        const point = projected && inside(projected) ? projected : null;
        const track = tracks[key];
        if (point === null) {
          track.last = null;
          continue;
        }
        if (track.last !== null) {
          const dx = point.x - track.last.x;
          const dy = point.y - track.last.y;
          const step = Math.hypot(dx, dy);
          if (step > 0.01) {
            track.steps.push(step);
            if (track.dir !== null && (dx * track.dir.x + dy * track.dir.y) / step < -0.5 && step > 0.5) track.backward += 1;
            track.dir = { x: dx / step, y: dy / step };
          }
        }
        track.last = point;
      }
      if (now - start < ms) requestAnimationFrame(frame);
      else {
        observer.disconnect();
        const elapsedS = (now - start) / 1_000;
        const sum = values => values.reduce((total, value) => total + value, 0);
        const quantile = (values, q) => {
          if (values.length === 0) return 0;
          const sorted = [...values].sort((a, b) => a - b);
          return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
        };
        resolve({
          seconds: Math.round(elapsedS * 10) / 10,
          fps: Math.round((frames / elapsedS) * 10) / 10,
          maxFrameGapMs: Math.round(maxGapMs),
          longTasks: longTasks.length,
          blockedMsPerMin: Math.round((sum(longTasks) / elapsedS) * 60),
          tbtMsPerMin: Math.round((sum(longTasks.map(value => Math.max(0, value - 50))) / elapsedS) * 60),
          aircraft: Object.fromEntries(Object.entries(tracks).map(([key, track]) => [key, {
            steps: track.steps.length,
            maxStepPx: Math.round(Math.max(0, ...track.steps) * 100) / 100,
            p99StepPx: Math.round(quantile(track.steps, 0.99) * 100) / 100,
            medianStepPx: Math.round(quantile(track.steps, 0.5) * 100) / 100,
            backward: track.backward,
          }])),
        });
      }
    };
    requestAnimationFrame(frame);
  }), { ms: seconds * 1_000, ids });
}

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
      const result = await measure(page, SECONDS, ids);
      console.log(`[fluency] ${scene} cpu×${THROTTLE} ${JSON.stringify(result)}`);
      await testInfo.attach(`${scene}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
      if (process.env.OCC_FLUENCY_REPORT_ONLY === '1') return;
      expect(result.blockedMsPerMin, 'long tasks per minute').toBeLessThan(10_000);
      expect(result.fps, 'frames per second').toBeGreaterThanOrEqual(30);
      for (const [key, aircraft] of Object.entries(result.aircraft)) {
        expect(aircraft.steps, `${key} moves`).toBeGreaterThan(0);
        expect(aircraft.maxStepPx, `${key}: no jump`).toBeLessThan(6);
        expect(aircraft.backward, `${key}: no pull-back`).toBe(0);
      }
    });
  }
});
