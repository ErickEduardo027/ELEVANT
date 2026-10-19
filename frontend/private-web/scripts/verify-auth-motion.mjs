import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against the exact production container, not a dev server. No API/login
// credentials are needed. Requests outside this web origin are not allowed.
const origin = new URL(process.argv[2]);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use a local certification server');
assert(origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash);
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const errors = [];
const failures = [];

async function makeContext(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference', ...options });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin.origin) return route.continue();
    return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
  });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin.origin && /\/(brand|images)\//.test(url.pathname) && response.status() >= 400) failures.push(url.pathname);
    });
  });
  return context;
}

async function loaded(page, selector) {
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(image => image.complete && image.naturalWidth > 0), selector);
}

async function moving(page) {
  const selector = '.elv-marquee-track';
  const before = await page.locator(selector).evaluate(el => getComputedStyle(el).transform);
  await page.waitForFunction(({ selector, before }) => getComputedStyle(document.querySelector(selector)).transform !== before, { selector, before });
}

try {
  const context = await makeContext();
  // An old tab must not suppress the new release's welcome after a full reload.
  await context.addInitScript(() => {
    if (location.protocol === 'http:') sessionStorage.setItem('elevant-private-intro-seen', '1');
  });
  const delayed = new Set();
  await context.route('**/brand/elevant-mark-*.png', async route => {
    if (!delayed.has(route.request().url())) {
      delayed.add(route.request().url());
      await new Promise(resolve => setTimeout(resolve, 3200));
    }
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(new URL('/login', origin).href, { waitUntil: 'domcontentloaded' });
  const intro = page.locator('.elv-intro-screen:not([hidden])');
  await intro.waitFor({ state: 'visible', timeout: 15000 });
  assert(await intro.locator('img').evaluateAll(images => images.every(image => image.naturalWidth > 0)), 'Intro started before its logos loaded');
  assert.notEqual(await intro.evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.keyboard.press('Escape');
  await intro.waitFor({ state: 'detached' });
  await loaded(page, '.elv-airline img, .elv-photo img');
  await moving(page);
  const groupWidths = await page.locator('.elv-airline-set').evaluateAll(groups => groups.map(group => group.getBoundingClientRect().width));
  const trackWidth = await page.locator('.elv-marquee-track').evaluate(el => el.getBoundingClientRect().width);
  assert.equal(groupWidths.length, 2);
  assert(Math.abs(groupWidths[0] - groupWidths[1]) < 0.5 && Math.abs(trackWidth - 2 * groupWidths[0]) < 0.5, 'The carousel loop must join without a jump');
  await page.getByRole('button', { name: 'Pausar carrusel de aerolíneas' }).click();
  assert.equal(await page.locator('.elv-marquee-track').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  await page.getByRole('button', { name: 'Reanudar carrusel de aerolíneas' }).click();
  await moving(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await intro.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click();
  assert(await page.locator('.elv-brand .elv-logo--dark').isVisible());
  await moving(page);
  console.log('PASS: delayed logos, reload, dark theme, seamless movement and explicit pause');
  await context.close();

  const typingContext = await makeContext();
  await typingContext.route('**/brand/elevant-mark-*.png', async route => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await route.continue();
  });
  const typingPage = await typingContext.newPage();
  await typingPage.goto(new URL('/login', origin).href, { waitUntil: 'domcontentloaded' });
  await typingPage.getByLabel('Correo electrónico').fill('qa@example.test');
  await loaded(typingPage, '.elv-brand img');
  assert.equal(await typingPage.locator('.elv-intro-screen').count(), 0, 'An intro must not interrupt someone using the form');
  await typingContext.close();
  console.log('PASS: slow network never blocks or interrupts credential entry');

  for (const reduced of [false, true]) {
    const mobile = await makeContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await mobile.newPage();
    await page.goto(new URL('/login', origin).href, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Correo electrónico').fill('');
    await loaded(page, '.elv-airline img');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Login overflows a phone viewport');
    if (reduced) {
      assert.equal(await page.locator('.elv-intro-screen').count(), 0);
      assert.equal(await page.locator('.elv-marquee-track').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert(await page.locator('.elv-airline-set:not([aria-hidden]) img').evaluateAll(images => images.length === 6 && images.every(image => {
        const rect = image.getBoundingClientRect();
        const panel = image.closest('.elv-marquee').getBoundingClientRect();
        return rect.left >= panel.left && rect.right <= panel.right && rect.top >= panel.top && rect.bottom <= panel.bottom;
      })), 'Reduced motion must expose all six logos without clipping');
    } else await moving(page);
    await mobile.close();
    console.log(`PASS: phone viewport, ${reduced ? 'reduced' : 'normal'} motion`);
  }
  assert.deepEqual(failures, [], 'Published auth images must load');
  assert.deepEqual(errors, [], 'Login must not throw hydration/runtime errors');
  console.log('AVIAM_AUTH_MOTION_CERTIFIED');
} finally {
  await browser.close();
}
