import { OCC_BOOT_EXIT_MS, OCC_BOOT_READY_TIMEOUT_MS } from '../../../src/features/admin-occ/boot/occBootMachine.js';
import { OCC_BOOT_SEEN_KEY } from '../../../src/features/admin-occ/boot/occBootSession.js';
import { ACCESS_PATH, answerLegacyConsoleOrigins, createBootApi } from './fixtures/bootApi.mjs';
import { AUTH_STORAGE_KEY, occSession } from './fixtures/occApi.mjs';
import { mapReady, shoot } from '../support/map.mjs';
import { expect, test } from '../support/test.mjs';

// The OCC boot screen (PR U4, contratos 2.6) in Chrome, with a synthetic OCC session and a stubbed API
// (fixtures/bootApi.mjs). Each test is a fresh login: a new browser context starts with an empty sessionStorage, so the
// tab has not seen the screen yet. The screen must cover Panorama from the session check, leave at most 6 s after the
// department access loaded (here Panorama reports ready first), and never take a click once it starts leaving; a
// reload of the same tab does not show it again. Screenshots for review go to test-results/visual: early in its
// animation, while it waits for Panorama, the console after it, and the reduced-motion variant.

const PAGE = '/admin-occ/dashboard';
const SCREEN = '[data-testid="occ-boot-screen"]';
// The isotype the screen shows (OCC_BOOT_ISOTYPE_SRC of OccBootScreen.jsx, the rail's mark).
const ISOTYPE_SRC = '/brand/elevant-mark-dark.png';
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }];
// The shortest pause before the department access answers. Without one the access can load before the client decides
// to show the screen, which then starts directly in waitingReady (a path the orchestrator allows); with it the
// recorded phases always start with waitingAccess.
const ACCESS_PAUSE_MS = 500;
// The scheduling slack allowed around the screen's 6 s timer, measured with the page's clock.
const SLACK_MS = 300;
// How late the screen may be unmounted after it starts leaving. Its 400 ms timer runs on the main thread, which is busy
// drawing the console's first data at that moment (under `next dev`, with the maps in software WebGL), so it may fire
// late; the clicks pass from the first frame of the exit all the same, which is what the tests hold it to.
const UNMOUNT_LATE_MS = 2_000;

// Runs in the page before the app, on every load of the tab: notes each phase the boot screen goes through with the
// page's clock, and, the moment it starts leaving, whether it still takes pointer events and what a click at the
// centre of the window would reach.
function recordBootScreen() {
  const record = { phases: [], pointerEventsWhenLeaving: null, centreWhenLeaving: null };
  window.__occBootRecord = record;
  let last = null;
  const note = () => {
    const screen = document.querySelector('[data-testid="occ-boot-screen"]');
    const phase = screen ? screen.getAttribute('data-occ-boot-phase') : last && 'gone';
    if (!phase || phase === last) return;
    last = phase;
    record.phases.push({ phase, at: performance.now() });
    if (phase !== 'leaving') return;
    record.pointerEventsWhenLeaving = getComputedStyle(screen).pointerEvents;
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    record.centreWhenLeaving = hit && screen.contains(hit) ? 'boot screen' : 'page';
  };
  new MutationObserver(note).observe(document, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['data-occ-boot-phase'],
  });
}

const bootRecord = page => page.evaluate(() => window.__occBootRecord);
const phaseAt = (record, phase) => record.phases.find(entry => entry.phase === phase)?.at;

/** Logs in as the OCC administrator of PUJ (a synthetic session) and opens Panorama. */
async function enterOcc(page, isolation, delays) {
  const api = createBootApi(delays);
  isolation.setApi(api.handle);
  await answerLegacyConsoleOrigins(page);
  await page.addInitScript(recordBootScreen);
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  }, [AUTH_STORAGE_KEY, occSession()]);
  const access = page.waitForResponse(response => new URL(response.url()).pathname === ACCESS_PATH);
  const response = await page.goto(PAGE);
  expect(response?.status(), `GET ${PAGE}`).toBe(200);
  return { api, access, html: await response.text() };
}

// The image preloads of a server-rendered page.
const imagePreloads = html => [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => tag)
  .filter(tag => tag.includes('rel="preload"') && tag.includes('as="image"'));

// Holds the boot screen's own CSS animations (the routes and the entry of the logo) `ms` after they started, so the
// screenshot shows the same frame on every machine; the progress line, a transition, keeps its real place.
// `releaseFrame` lets them run on.
async function holdFrame(page, ms) {
  await page.locator(SCREEN).evaluate((screen, at) => {
    for (const animation of screen.getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSAnimation)) continue;
      animation.pause();
      animation.currentTime = at;
    }
  }, ms);
}

async function releaseFrame(page) {
  await page.evaluate(selector => {
    for (const animation of document.querySelector(selector)?.getAnimations({ subtree: true }) ?? []) {
      if (animation.playState === 'paused') animation.play();
    }
  }, SCREEN);
}

// The rail's own button: a click that lands folds the rail at once. Nothing covers it, so Playwright's actionability
// checks pass within a second.
async function clickTheRail(page) {
  await page.getByRole('button', { name: 'Contraer barra lateral' }).click({ timeout: 1_000 });
  await expect(page.getByRole('button', { name: 'Expandir barra lateral' }))
    .toHaveAttribute('aria-expanded', 'false', { timeout: 1_000 });
}

const panorama = page => page.getByRole('region', { name: 'Resumen operacional' });

/**
 * Waits for the screen to go after the department access answered at `accessAt` (Date.now() of this process) and checks
 * how it went, in the page's clock: through every phase, leaving at most 6 s after the access loaded, taking no pointer
 * event from the first frame of its exit, and unmounted soon after. Returns how long it waited for the first screen.
 */
async function expectLeftAfterAccess(page, accessAt) {
  await expect(page.locator(SCREEN)).toHaveCount(0, {
    timeout: OCC_BOOT_READY_TIMEOUT_MS + OCC_BOOT_EXIT_MS + UNMOUNT_LATE_MS + 1_000,
  });
  expect(Date.now() - accessAt).toBeLessThan(OCC_BOOT_READY_TIMEOUT_MS + SLACK_MS + OCC_BOOT_EXIT_MS + UNMOUNT_LATE_MS);
  const record = await bootRecord(page);
  expect(record.phases.map(entry => entry.phase)).toEqual(['waitingAccess', 'waitingReady', 'leaving', 'gone']);
  const waited = phaseAt(record, 'leaving') - phaseAt(record, 'waitingReady');
  expect(waited).toBeLessThan(OCC_BOOT_READY_TIMEOUT_MS + SLACK_MS);
  expect(record.pointerEventsWhenLeaving).toBe('none');
  // A click at the centre of the window, the moment the exit starts, reaches the page.
  expect(record.centreWhenLeaving).toBe('page');
  expect(phaseAt(record, 'gone') - phaseAt(record, 'leaving')).toBeLessThan(OCC_BOOT_EXIT_MS + UNMOUNT_LATE_MS);
  return waited;
}

test.describe('the OCC boot screen', () => {
  for (const viewport of VIEWPORTS) {
    test.describe(`at ${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport, reducedMotion: 'no-preference' });

      test('shows on a fresh login, leaves within 6 s of the access and never blocks a click', async ({
        page, isolation,
      }, testInfo) => {
        // The access takes 1.5 s; Panorama's first data 3 s more (two reads of 1.5 s, one after the other).
        const { api, access, html } = await enterOcc(page, isolation, { accessDelayMs: 1_500, consoleDelayMs: 1_500 });
        const screen = page.locator(SCREEN);
        await expect(screen).toBeVisible();
        await expect(screen).toHaveAttribute('data-occ-boot-phase', 'waitingAccess');
        // The server render does not show it, but its <head> already asks for the isotype: the logo is there when the
        // screen shows, even on the first visit.
        expect(imagePreloads(html).some(tag => tag.includes(`href="${ISOTYPE_SRC}"`)), 'the isotype preload').toBe(true);
        expect(html).not.toContain('data-testid="occ-boot-screen"');
        const isotype = screen.locator('[data-occ-boot-part="isotype"]');
        await expect(isotype).toHaveAttribute('src', ISOTYPE_SRC);
        await expect(isotype).toHaveJSProperty('complete', true);
        expect(await isotype.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
        // It covers the session and access checks, whose plain status screens keep rendering underneath.
        await expect(page.getByRole('status').filter({ hasText: /^(Comprobando sesión|Cargando permisos)…$/ }))
          .toHaveCount(1);
        // With motion, every route is traced by an animation of its own and the lock-up enters with one.
        expect(await screen.evaluate(element => ['route', 'isotype', 'wordmark'].map(part => [
          ...element.querySelectorAll(`[data-occ-boot-part="${part}"]`),
        ].map(node => node.getAnimations().filter(animation => animation instanceof CSSAnimation).length)))).toEqual([
          [1, 1, 1, 1, 1, 1, 1, 1], [1], [1],
        ]);
        await holdFrame(page, 300);
        await shoot(page, testInfo, `u4-arranque-temprano-${viewport.width}`);
        await releaseFrame(page);

        await access;
        const accessAt = Date.now();
        await expect(screen).toHaveAttribute('data-occ-boot-phase', 'waitingReady');
        await expect(screen).toHaveAttribute('data-occ-boot-progress', 'screen');
        await holdFrame(page, 2_800);
        await shoot(page, testInfo, `u4-arranque-progreso-${viewport.width}`);
        await releaseFrame(page);

        // Panorama reports its first data and the screen leaves, well before the 6 s it may wait.
        const waited = await expectLeftAfterAccess(page, accessAt);
        expect(waited).toBeLessThan(OCC_BOOT_READY_TIMEOUT_MS - 1_000);

        // The console under it is the real one, with Panorama's data and its ramp map.
        await expect(panorama(page)).toBeVisible();
        expect(api.consoleReads).toBeGreaterThanOrEqual(3);
        await mapReady(page.getByTestId('occ-map').first());
        await shoot(page, testInfo, `u4-arranque-despues-${viewport.width}`);
        await clickTheRail(page);
        expect(await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
          ?.closest('[data-testid="occ-boot-screen"]') ?? null)).toBeNull();
      });
    });
  }

  test.describe('without reduced motion', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('leaves 6 s after the access when no screen reports ready, and lets the clicks through', async ({
      page, isolation,
    }) => {
      // Panorama's first data take 10 s: the screen does not wait for them.
      const { access } = await enterOcc(page, isolation, { accessDelayMs: ACCESS_PAUSE_MS, consoleDelayMs: 5_000 });
      const screen = page.locator(SCREEN);
      await access;
      const waited = await expectLeftAfterAccess(page, Date.now());
      // It left on its timer.
      expect(waited).toBeGreaterThanOrEqual(OCC_BOOT_READY_TIMEOUT_MS - SLACK_MS);

      // Panorama is still loading, and the page already takes clicks.
      await expect(page.getByRole('status').filter({ hasText: 'Cargando panorama operativo…' })).toBeVisible();
      await clickTheRail(page);
      // Its data arrive later, with no screen over them.
      await expect(panorama(page)).toBeVisible({ timeout: 15_000 });
      await expect(screen).toHaveCount(0);
    });

    test('a second entry in the same tab does not show it', async ({ page, isolation }) => {
      await enterOcc(page, isolation, { accessDelayMs: ACCESS_PAUSE_MS, consoleDelayMs: 500 });
      await expect(panorama(page)).toBeVisible();
      await expect(page.locator(SCREEN)).toHaveCount(0, { timeout: OCC_BOOT_READY_TIMEOUT_MS + OCC_BOOT_EXIT_MS });
      const first = await bootRecord(page);
      expect(first.phases.map(entry => entry.phase)).toEqual(['waitingAccess', 'waitingReady', 'leaving', 'gone']);
      // This tab saw it for this account.
      expect(await page.evaluate(key => window.sessionStorage.getItem(key), OCC_BOOT_SEEN_KEY))
        .toBe(occSession().accountId);

      // The same tab and the same login: a reload opens Panorama directly.
      await page.reload();
      await expect(panorama(page)).toBeVisible();
      await expect(page.locator(SCREEN)).toHaveCount(0);
      expect((await bootRecord(page)).phases).toEqual([]);
    });
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('with reduced motion the background and the logo stay still and only the progress line moves', async ({
      page, isolation,
    }, testInfo) => {
      const { access } = await enterOcc(page, isolation, { accessDelayMs: 1_500, consoleDelayMs: 1_500 });
      const screen = page.locator(SCREEN);
      await expect(screen).toBeVisible();
      // No animation runs inside it: the routes are drawn whole and still, the logo is in place.
      const still = await screen.evaluate(element => ({
        animations: element.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSAnimation)
          .map(animation => animation.animationName),
        routes: [...element.querySelectorAll('[data-occ-boot-part="route"]')].map(route => {
          const style = getComputedStyle(route);
          return { animation: style.animationName, offset: Number.parseFloat(style.strokeDashoffset), opacity: style.opacity };
        }),
        logo: ['isotype', 'wordmark'].map(name => getComputedStyle(element.querySelector(`[data-occ-boot-part="${name}"]`))
          .animationName),
      }));
      expect(still.animations).toEqual([]);
      expect(still.routes.length).toBeGreaterThanOrEqual(7);
      expect(still.routes.every(route => route.animation === 'none' && route.offset === 0 && route.opacity === '1'))
        .toBe(true);
      expect(still.logo).toEqual(['none', 'none']);

      // The progress line keeps its transitions, above occ.css's reduced-motion rule, and moves while it waits.
      await access;
      await expect(screen).toHaveAttribute('data-occ-boot-progress', 'screen');
      const bar = screen.locator('[data-occ-boot-part="bar"]');
      expect(await bar.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('6s');
      const reach = () => bar.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
      const before = await reach();
      await expect.poll(reach, { message: 'the progress line moves on' }).toBeGreaterThan(before + 0.02);
      await shoot(page, testInfo, 'u4-arranque-reducido-1440');

      await expect(screen).toHaveCount(0, { timeout: OCC_BOOT_READY_TIMEOUT_MS + OCC_BOOT_EXIT_MS + 2_000 });
      await expect(panorama(page)).toBeVisible();
    });
  });
});
