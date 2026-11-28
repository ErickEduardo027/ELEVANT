import { NOON, labIdle, openLab } from '../support/map.mjs';
import { gpuReport, gpuRun, recordPerf } from '../support/perf.mjs';
import { expect, production, test } from '../support/test.mjs';

// HOTFIX-3D (2026-11-28, after review): the cold entry into «Seguir en 3D», each test in a browser of its own whose GPU
// process links every program anew (no program cache, no shader cache on disk), so no earlier test of the run has
// already compiled them. The parked Copa B738 (CM893, its glTF models) is chosen on airfield-3d-replay at a frozen
// instant, and «Seguir en 3D» is pressed in the data block:
// - from the 2D map (`pitch=2d`, the path of Panorama): no 3D layer before the click, so the click itself adds it, and
//   its onAdd, its warm-up and the first draw of the detailed aircraft all fall after the click;
// - from the 3D view (the scene's own): the layer already draws the traffic, and its warm-up ran before the click.
// Every long task the page reports (PerformanceObserver 'longtask', observing from the document's start) is recorded;
// for OCC_COLD_ENTRY_SECONDS (15) from the click, none may block the page for more than OCC_COLD_ENTRY_MAX_TASK_MS
// (100, the lane's objective) on the real GPU (OCC_VISUAL_GPU). SwiftShader compiles in software: there the numbers are
// printed only. The tasks before the click (the page's load under `next dev`) are printed, never gated.

const ARRIVAL = 'p:5c900000-0000-4000-8000-000000000893';
const ON_BLOCK_S = 480;
const at = seconds => new Date(Date.parse(NOON) + seconds * 1_000).toISOString();
// Chrome's GPU process keeps the programs it linked, in memory and on disk: a cold entry needs neither.
const COLD_GPU_ARGS = Object.freeze(['--disable-gpu-program-cache', '--disable-gpu-shader-disk-cache']);
const ENTRIES = Object.freeze([
  ['from the 2D map, where the click adds the 3D layer (Panorama)', '2d'],
  ['from the 3D view, where the layer already draws', null],
]);

// The second parameter of a fixture is not called `use`: the React hooks lint rule would read it as a hook.
const coldTest = test.extend({
  // A browser of its own for each test (the project's launch options and the cold GPU flags) and its one context.
  context: async ({ playwright, browserName, launchOptions, channel, headless, baseURL, viewport, deviceScaleFactor, locale,
    timezoneId, reducedMotion, actionTimeout, navigationTimeout }, provide) => {
    const browser = await playwright[browserName].launch({ ...launchOptions, channel, headless,
      args: [...(launchOptions.args ?? []), ...COLD_GPU_ARGS] });
    const context = await browser.newContext({ baseURL, viewport, deviceScaleFactor, locale, timezoneId, reducedMotion });
    if (actionTimeout) context.setDefaultTimeout(actionTimeout);
    if (navigationTimeout) context.setDefaultNavigationTimeout(navigationTimeout);
    await provide(context);
    await context.close();
    await browser.close();
  },
});

const followButton = page => page.getByRole('button', { name: 'Seguir en 3D', exact: true });
const stats = page => page.evaluate(() => window.__occMapLab.aircraft3d()?.stats ?? null);

coldTest.describe('the cold entry into follow mode in 3D (HOTFIX-3D)', () => {
  coldTest.skip(production, 'the map lab is development-only');

  for (const [entry, pitch] of ENTRIES) {
    coldTest(`enters follow mode in 3D cold without blocking the page: ${entry}`, async ({ page }, testInfo) => {
      const seconds = Number(process.env.OCC_COLD_ENTRY_SECONDS ?? 15);
      const maxTaskMs = Number(process.env.OCC_COLD_ENTRY_MAX_TASK_MS ?? 100);
      coldTest.setTimeout(seconds * 1_000 + 300_000);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      // Every long task from the document's start on.
      await page.addInitScript(() => {
        const entries = [];
        new PerformanceObserver(list => list.getEntries()
          .forEach(item => entries.push({ at: item.startTime, ms: Math.round(item.duration) })))
          .observe({ type: 'longtask', buffered: true });
        window.__coldEntry = { entries, click: null };
      });
      const query = `scene=airfield-3d-replay&t=${at(ON_BLOCK_S + 30)}&flightId=${ARRIVAL}${pitch ? `&pitch=${pitch}` : ''}`;
      await openLab(page, query);
      const gpu = await gpuReport(page, testInfo);
      await labIdle(page);
      if (pitch === '2d') {
        // No 3D layer on the 2D map at a frozen instant: the click adds it.
        await expect(page.getByTestId('occ-map')).toHaveAttribute('data-occ-3d', 'off');
        expect(await stats(page), 'no 3D layer before the click').toBeNull();
      } else {
        await expect.poll(async () => (await stats(page))?.instances ?? 0, { message: 'the 3D aircraft drawn' })
          .toBeGreaterThan(0);
      }
      const before = await stats(page);
      await page.evaluate(() => {
        window.__coldEntry.click = performance.now();
      });
      await followButton(page).first().click();
      await expect(page.getByTestId('follow-3d-panel')).toBeVisible();
      await expect.poll(async () => (await stats(page))?.detail?.key ?? null, { message: 'the detailed aircraft drawn' })
        .not.toBeNull();
      const shownMs = await page.evaluate(() => Math.round(performance.now() - window.__coldEntry.click));
      await page.waitForFunction(ms => performance.now() - window.__coldEntry.click >= ms, seconds * 1_000,
        { timeout: seconds * 1_000 + 60_000, polling: 500 });
      const after = await stats(page);
      const { tasks, loading } = await page.evaluate(() => {
        const { entries, click } = window.__coldEntry;
        const fromClick = entries.filter(item => item.at + item.ms >= click);
        return {
          tasks: fromClick.map(item => ({ at: Math.round(item.at - click), ms: item.ms })),
          loading: entries.filter(item => item.at + item.ms < click).map(item => item.ms),
        };
      });
      const durations = tasks.map(task => task.ms);
      const result = {
        entry: pitch === '2d' ? '2d' : '3d',
        seconds,
        maxTaskGateMs: maxTaskMs,
        detailShownMs: shownMs,
        detail: after?.detail ?? null,
        longTasks: tasks.length,
        maxLongTaskMs: Math.max(0, ...durations),
        blockedMs: durations.reduce((total, ms) => total + ms, 0),
        over100Ms: durations.filter(ms => ms > 100).length,
        programsBefore: before?.programs ?? null,
        programsAfter: after?.programs ?? null,
        tasks,
        beforeClick: { longTasks: loading.length, maxLongTaskMs: Math.max(0, ...loading) },
      };
      console.log(`HOTFIX-3D cold entry into follow 3D (${result.entry}): ${JSON.stringify(result)}`);
      recordPerf(`follow3d-cold-entry-${result.entry}`, result, gpu);
      await testInfo.attach(`follow3d-cold-entry-${result.entry}.json`, { body: JSON.stringify(result, null, 2),
        contentType: 'application/json' });
      expect(after).toMatchObject({ failed: false, lost: false });
      if (process.env.OCC_FLUENCY_REPORT_ONLY === '1' || !gpuRun) return;
      expect(result.maxLongTaskMs, 'the longest task from the entry into «Seguir en 3D» (ms)')
        .toBeLessThanOrEqual(maxTaskMs);
    });
  }
});
