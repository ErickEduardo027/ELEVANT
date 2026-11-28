import fs from 'node:fs';
import { labIdle, openLab } from '../support/map.mjs';
import { gpuReport, measureFrames } from '../support/perf.mjs';
import { expect, production, test } from '../support/test.mjs';

// A CPU profile of «Seguir en 3D» on the running replay (airfield-3d-replay), for the hunt of what the main thread does
// per frame (PR M2, 2026-11-28). Opt-in: it runs only with OCC_PROFILE_OUT=<file.cpuprofile> (on the real GPU, with
// OCC_VISUAL_GPU), records Chrome's sampling profiler for OCC_PROFILE_SECONDS (15 by default) while following the
// arrival, writes the profile there (DevTools opens it) and prints the functions with the most self time.

const ARRIVAL = 'p:5c900000-0000-4000-8000-000000000893';
const out = process.env.OCC_PROFILE_OUT;

test.describe('CPU profile of follow mode in 3D', () => {
  test.skip(production || !out, 'opt-in: OCC_PROFILE_OUT=<file.cpuprofile>, development only');

  test('profiles the main thread while following in 3D', async ({ page }, testInfo) => {
    const seconds = Number(process.env.OCC_PROFILE_SECONDS ?? 15);
    test.setTimeout(seconds * 2_000 + 420_000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openLab(page, `scene=airfield-3d-replay&flightId=${ARRIVAL}`);
    await gpuReport(page, testInfo);
    await expect.poll(() => page.evaluate(id => {
      const lab = window.__occMapLab;
      const lngLat = lab.frameAt(id);
      const point = lngLat ? lab.project(lngLat) : null;
      const box = document.querySelector('[data-testid="occ-map"]').getBoundingClientRect();
      return point !== null && point.x >= 0 && point.y >= 0 && point.x <= box.width && point.y <= box.height;
    }, `f:${ARRIVAL}`), { timeout: 240_000, intervals: [1_000] }).toBe(true);
    await page.getByRole('button', { name: 'Seguir en 3D', exact: true }).first().click();
    await expect(page.getByTestId('follow-3d-panel')).toBeVisible();
    await labIdle(page);
    await page.waitForTimeout(2_000);
    // What MapLibre goes through each frame in close-up: the layers it draws, the tiles of each source they read.
    console.log(`[profile] render stats ${JSON.stringify(await page.evaluate(() => window.__occMapLab.renderStats()))}`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await cdp.send('Profiler.start');
    const frames = await measureFrames(page, seconds, { arrival: `f:${ARRIVAL}` });
    const { profile } = await cdp.send('Profiler.stop');
    console.log(`[profile] render stats after ${JSON.stringify(await page.evaluate(() => window.__occMapLab.renderStats()))}`);
    fs.writeFileSync(out, JSON.stringify(profile));
    console.log(`[profile] frames ${JSON.stringify(frames)}`);
    // Self time per function (name and place), and the time in each script file.
    const byId = new Map(profile.nodes.map(node => [node.id, node]));
    const dt = new Map();
    profile.samples.forEach((id, index) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0)));
    const self = new Map();
    const files = new Map();
    for (const [id, us] of dt) {
      const { callFrame } = byId.get(id);
      const file = callFrame.url.split('/').pop() || '(native)';
      const key = `${callFrame.functionName || '(anonymous)'} ${file}:${callFrame.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + us);
      files.set(file, (files.get(file) ?? 0) + us);
    }
    // Total time (self and callees) per function, each function counted once per sample.
    const parent = new Map();
    profile.nodes.forEach(node => (node.children ?? []).forEach(child => parent.set(child, node.id)));
    const total = new Map();
    for (const [id, us] of dt) {
      const seen = new Set();
      for (let at = id; at !== undefined; at = parent.get(at)) {
        const { callFrame } = byId.get(at);
        const key = `${callFrame.functionName || '(anonymous)'} ${callFrame.url.split('/').pop() || '(native)'}:${callFrame.lineNumber + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        total.set(key, (total.get(key) ?? 0) + us);
      }
    }
    const top = (map, count) => [...map].sort((a, b) => b[1] - a[1]).slice(0, count)
      .map(([key, us]) => `${(us / 1_000 / seconds).toFixed(1).padStart(7)} ms/s  ${key}`).join('\n');
    console.log(`[profile] self time\n${top(self, 60)}`);
    console.log(`[profile] total time\n${top(total, 80)}`);
    console.log(`[profile] by file\n${top(files, 30)}`);
  });
});
