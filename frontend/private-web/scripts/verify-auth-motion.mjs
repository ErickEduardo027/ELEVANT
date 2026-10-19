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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: null, ...options });
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
  await page.waitForFunction(selector => {
    const images = [...document.querySelectorAll(selector)];
    return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0);
  }, selector);
}

async function moving(page) {
  const selector = '.elv-marquee-track';
  assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).animationName), 'elv-marquee', 'The carousel must start automatically');
  assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).animationPlayState), 'running');
  const before = await page.locator(selector).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  await page.waitForFunction(({ selector, before }) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).m41 - before) > 2, { selector, before });
}

async function originalStrip(page) {
  const geometry = await page.locator('.elv-airline-set').evaluateAll(groups => groups.map(group => ({
    width: group.getBoundingClientRect().width,
    display: getComputedStyle(group).display,
    logos: [...group.querySelectorAll('img')].map(image => {
      const rect = image.getBoundingClientRect();
      return { center: rect.y + rect.height / 2, width: rect.width, height: rect.height, ratio: image.naturalWidth / image.naturalHeight };
    }),
  })));
  assert.equal(geometry.length, 2);
  assert(geometry.every(group => group.display === 'flex' && group.logos.length === 6), 'Keep two horizontal copies of the original six logos');
  for (const group of geometry) {
    assert(group.logos.every(image => image.width > 0 && image.height > 0 && Math.abs(image.width / image.height - image.ratio) < 0.02), 'Logo proportions must remain original');
    assert(Math.max(...group.logos.map(image => image.center)) - Math.min(...group.logos.map(image => image.center)) < 1, 'Logos must stay on one row');
  }
  const trackWidth = await page.locator('.elv-marquee-track').evaluate(el => el.getBoundingClientRect().width);
  assert(Math.abs(geometry[0].width - geometry[1].width) < 0.5 && Math.abs(trackWidth - 2 * geometry[0].width) < 0.5, 'The carousel loop must join without a jump');
}

async function loopBoundary(page) {
  const difference = await page.locator('.elv-marquee-track').evaluate(track => {
    const animation = track.getAnimations().find(value => value.animationName === 'elv-marquee');
    const time = animation.currentTime;
    const duration = animation.effect.getComputedTiming().duration;
    const groups = track.querySelectorAll('.elv-airline-set');
    const positions = group => [...group.querySelectorAll('img')].map(image => image.getBoundingClientRect().left);
    try {
      animation.pause();
      animation.currentTime = 0;
      const first = positions(groups[0]);
      animation.currentTime = duration - 0.001;
      const repeated = positions(groups[1]);
      return { duration, maximum: Math.max(...first.map((left, index) => Math.abs(left - repeated[index]))) };
    } finally {
      animation.currentTime = time;
      animation.play();
    }
  });
  assert.equal(difference.duration, 38000, 'Preserve the original carousel speed');
  assert(difference.maximum < 0.5, 'The final frame must meet the next iteration without a visible jump');
}

try {
  const context = await makeContext({ reducedMotion: 'reduce' });
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
  await originalStrip(page);
  await loopBoundary(page);
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

  for (const reducedMotion of [null, 'no-preference', 'reduce']) {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      const context = await makeContext({ viewport, reducedMotion });
      const page = await context.newPage();
      await page.goto(new URL('/login', origin).href, { waitUntil: 'domcontentloaded' });
      await page.locator('.elv-intro-screen:not([hidden])').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await loaded(page, '.elv-airline img');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Login overflows the viewport');
      await originalStrip(page);
      await moving(page);
      await page.getByRole('button', { name: 'Pausar carrusel de aerolíneas' }).click();
      assert.equal(await page.locator('.elv-marquee-track').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
      const still = await page.locator('.elv-marquee-track').evaluate(async el => {
        const start = getComputedStyle(el).transform;
        for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame);
        return start === getComputedStyle(el).transform;
      });
      assert(still, 'Voluntary pause must actually stop movement');
      await page.getByRole('button', { name: 'English' }).click();
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      assert(await page.locator('.elv-brand .elv-logo--dark').isVisible());
      assert.equal(await page.getByRole('button', { name: 'Resume airline carousel' }).getAttribute('aria-pressed'), 'true', 'Theme and language changes must preserve a voluntary pause');
      await page.getByRole('button', { name: 'Resume airline carousel' }).click();
      await originalStrip(page);
      await moving(page);
      console.log(`PASS: ${viewport.width}px, motion=${reducedMotion ?? 'system'}, both themes and languages, original horizontal logos and voluntary pause`);
      await context.close();
    }
  }
  assert.deepEqual(failures, [], 'Published auth images must load');
  assert.deepEqual(errors, [], 'Login must not throw hydration/runtime errors');
  console.log('AVIAM_AUTH_MOTION_CERTIFIED');
} finally {
  await browser.close();
}
