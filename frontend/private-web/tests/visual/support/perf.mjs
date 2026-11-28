import fs from 'node:fs';
import { expect } from 'playwright/test';

// The perf measurements of the map lab (PR M2, 2026-11-28), shared by the fluency and follow-3D specs. They count what
// the screen really shows: the frames MapLibre draws (its `render` event, through window.__occMapLab.onRender), never
// the browser's animation callbacks, and, at each of those frames, where that frame drew the aircraft under watch (the
// animated layer's interpolated position, __occMapLab.frameAt), never where the last write left them. Every run records
// the GPU WebGL reports, Chrome's version, the viewport and the pixel ratio; a GPU run (OCC_VISUAL_GPU, see
// playwright.occ.config.mjs) that still draws with SwiftShader fails. With OCC_PERF_OUT=<file.json> each result is added
// to that file under its name, for the pull request.

/** Whether this run draws on the real GPU (OCC_VISUAL_GPU=1 or high). */
export const gpuRun = process.env.OCC_VISUAL_GPU === '1' || process.env.OCC_VISUAL_GPU === 'high';

/** The gates of a GPU run (the plan's goal: at least 30 frames a second, p95 of the frame time within 33 ms). */
export const GPU_GATES = Object.freeze({ minFps: 30, maxP95Ms: 33.4 });

/**
 * The GPU, Chrome and screen of the page: `{ renderer, vendor, chrome, viewport, dpr, gpuRun }`, attached to the test;
 * a GPU run fails when the map draws with SwiftShader (or reports no GPU).
 */
export async function gpuReport(page, testInfo) {
  const fromPage = await page.evaluate(() => {
    let info = window.__occMapLab?.renderer?.() ?? null;
    if (info === null) {
      const gl = document.createElement('canvas').getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      info = gl ? {
        renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      } : { renderer: null, vendor: null };
    }
    return { ...info, dpr: window.devicePixelRatio };
  });
  const report = {
    renderer: fromPage.renderer ?? null,
    vendor: fromPage.vendor ?? null,
    chrome: page.context().browser()?.version() ?? null,
    viewport: page.viewportSize(),
    dpr: fromPage.dpr,
    gpuRun,
  };
  console.log(`[gpu] ${JSON.stringify(report)}`);
  await testInfo.attach('gpu.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  if (gpuRun) {
    expect(report.renderer, 'the GPU WebGL reports').toBeTruthy();
    expect(report.renderer, 'a GPU run never draws with SwiftShader').not.toMatch(/swiftshader/i);
  }
  return report;
}

/**
 * For `seconds`, the frames MapLibre draws and where each drew the aircraft of `ids` (`{ key: id }`):
 * `{ seconds, renderFps, rafFps, p50Ms, p95Ms, overBudgetShare, maxFrameGapMs, longTasks, blockedMsPerMin, tbtMsPerMin,
 * aircraft: { key: { updatesPerS, steps, maxStepPx, p99StepPx, medianStepPx, backward } } }`. An update is a drawn frame
 * that moved the aircraft on screen; a step its distance in pixels; a pull-back a step against the way it flew. Only
 * positions inside the map count.
 */
export function measureFrames(page, seconds, ids = {}) {
  return page.evaluate(({ ms, ids }) => new Promise(resolve => {
    const lab = window.__occMapLab;
    const box = document.querySelector('[data-testid="occ-map"]').getBoundingClientRect();
    const inside = point => point.x >= 0 && point.y >= 0 && point.x <= box.width && point.y <= box.height;
    const longTasks = [];
    const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
    observer.observe({ type: 'longtask', buffered: false });
    const tracks = Object.fromEntries(Object.keys(ids).map(key => [key, { last: null, dir: null, steps: [], backward: 0 }]));
    const renders = [];
    let rafFrames = 0;
    let done = false;
    const start = performance.now();
    const stopRender = lab.onRender(at => {
      if (done) return;
      renders.push(at);
      for (const [key, id] of Object.entries(ids)) {
        const lngLat = lab.frameAt(id);
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
    });
    const frame = now => {
      rafFrames += 1;
      if (now - start < ms) {
        requestAnimationFrame(frame);
        return;
      }
      done = true;
      stopRender();
      observer.disconnect();
      const elapsedS = (now - start) / 1_000;
      const sum = values => values.reduce((total, value) => total + value, 0);
      const quantile = (values, q) => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
      };
      const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
      const gaps = renders.slice(1).map((at, index) => at - renders[index]);
      resolve({
        seconds: round(elapsedS),
        renderFps: round(renders.length / elapsedS),
        rafFps: round(rafFrames / elapsedS),
        p50Ms: round(quantile(gaps, 0.5)),
        p95Ms: round(quantile(gaps, 0.95)),
        overBudgetShare: gaps.length === 0 ? 0 : round(gaps.filter(gap => gap > 1_000 / 30).length / gaps.length, 3),
        maxFrameGapMs: Math.round(Math.max(0, ...gaps)),
        longTasks: longTasks.length,
        blockedMsPerMin: Math.round((sum(longTasks) / elapsedS) * 60),
        tbtMsPerMin: Math.round((sum(longTasks.map(value => Math.max(0, value - 50))) / elapsedS) * 60),
        aircraft: Object.fromEntries(Object.entries(tracks).map(([key, track]) => [key, {
          updatesPerS: round(track.steps.length / elapsedS),
          steps: track.steps.length,
          maxStepPx: round(Math.max(0, ...track.steps), 2),
          p99StepPx: round(quantile(track.steps, 0.99), 2),
          medianStepPx: round(quantile(track.steps, 0.5), 2),
          backward: track.backward,
        }])),
      });
    };
    requestAnimationFrame(frame);
  }), { ms: seconds * 1_000, ids });
}

/** The gates of a GPU run on a measurement: at least 30 drawn frames a second and a p95 frame time within 33 ms. */
export function expectGpuGates(result, label) {
  expect(result.renderFps, `${label}: frames MapLibre draws per second`).toBeGreaterThanOrEqual(GPU_GATES.minFps);
  expect(result.p95Ms, `${label}: p95 of the frame time (ms)`).toBeLessThanOrEqual(GPU_GATES.maxP95Ms);
}

/** Adds `result` (with the run's GPU report) to OCC_PERF_OUT under `name`, when set. */
export function recordPerf(name, result, gpu) {
  const out = process.env.OCC_PERF_OUT;
  if (!out) return;
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    all = {};
  }
  all[name] = { ...result, gpu, measuredAt: new Date().toISOString() };
  fs.writeFileSync(out, `${JSON.stringify(all, null, 2)}\n`);
}
