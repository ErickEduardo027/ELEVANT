import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Browser-only contract fixtures. This runner never sends requests to the API.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ELEVANT_QA_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.ELEVANT_QA_URL || 'http://127.0.0.1:3100';
const panoramaOnly = process.argv.includes('--panorama');
const flowsOnly = process.argv.includes('--flows');
const benchmarkOnly = process.argv.includes('--benchmark') || process.argv.includes('--baseline');
const benchmarkLabel = process.argv.includes('--baseline') ? 'before' : 'after';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'QA must use localhost');
const artifacts = process.env.ELEVANT_QA_ARTIFACT_DIR;
if (artifacts) await mkdir(artifacts, { recursive: true });
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const station = { id: uuid(1), code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' };
const operationId = uuid(2);
const now = new Date().toISOString();
const date = new Intl.DateTimeFormat('en-CA', { timeZone: station.ianaTimeZone }).format(new Date());
const permissions = ['dashboard.read', 'planning.read', 'flight_monitoring.read', 'positions_map.read',
  'review.read', 'reports.read', 'reports.export', 'notifications.read', 'chat.read', 'chat.create'].map(p => `operations.${p}`);
const session = { token: 'synthetic-browser-qa-token', accountId: uuid(3), email: 'occ@example.test',
  name: 'OCC QA', role: 'ADMIN_OCC', expiresAt: '2099-01-01T00:00:00Z',
  stationScopes: [{ stationId: station.id, stationCode: station.code }] };
const airport = code => ({ id: uuid(code === 'PUJ' ? 10 : 11), iataCode: code, icaoCode: code === 'PUJ' ? 'MDPC' : 'KMIA', name: code });
const turnaround = { id: operationId, operationCode: 'QA-101', operationDate: date, status: 'Confirmed',
  airline: { id: uuid(5), iataCode: 'QA', icaoCode: 'QAA', name: 'QA Airline' },
  stand: { id: uuid(6), code: 'A01', terminal: { id: uuid(7), code: 'A', name: 'Terminal A' } },
  arrival: { id: uuid(8), flightNumber: 'QA101', origin: airport('MIA'), destination: airport('PUJ'), scheduledAt: now },
  agents: [], equipment: [], services: [] };
const message = { id: uuid(12), operationId, senderAccountId: uuid(13), senderRole: 'agent', senderName: 'Agente QA', content: 'Puente listo', sentAt: now };
const notice = n => ({ id: uuid(n), operationId, operationCode: 'QA-101', stationCode: 'PUJ', kind: 'agent_message', sourceId: message.id, occurredAt: now, readAt: null });
let presenceState = 'active';
let notices = [notice(20)];
let grants = [...permissions];
let paginatedChat = false;
let holdFirstChatPost = false;
let releaseChatPost;
let onChatPostHeld;
const chatPosts = [];
const chatAcknowledgements = new Map();
const expectedApiFailures = [];
const expectedConsoleErrors = [];
const historicMessages = Array.from({ length: 201 }, (_, index) => ({ ...message,
  id: uuid(3000 + index), content: `Mensaje QA ${index}`,
  sentAt: new Date(Date.parse(now) - (201 - index) * 60_000).toISOString() }));
const unknown = new Set();
const failures = [];
const checks = [];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.ELEVANT_QA_BROWSER_PATH ? { executablePath: process.env.ELEVANT_QA_BROWSER_PATH } : {}) });
const context = await browser.newContext({ reducedMotion: 'reduce' });
process.once('SIGINT', async () => { await browser.close(); process.exit(130); });
const allPages = ['planning', 'review', 'reports', 'notifications', 'chat', 'users', 'expenses', 'flight-monitoring', 'positions-map', 'dashboard'];
const pages = process.env.ELEVANT_QA_MODULES ? allPages.filter(moduleId => process.env.ELEVANT_QA_MODULES.split(',').includes(moduleId)) : allPages;
const navigationTimeout = Number(process.env.ELEVANT_QA_COLD_TIMEOUT_MS || 120_000);
const tileRequests = [];
let currentRoute = '';
const errors = [];
const consoleErrors = new Set();
const failedLocalRequests = [];
const navigationMetrics = [];
const apiReads = [];

await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const p = url.pathname;
  const headers = { 'access-control-allow-origin': request.headers().origin || new URL(base).origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization,content-type,x-requested-with,x-signalr-user-agent',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' };
  const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
  if (p === '/api/1/currents.json') return json({ data: [{ station: 'MDPC', utc_valid: now,
    raw: `MDPC ${now.slice(8, 10)}${now.slice(11, 13)}${now.slice(14, 16)}Z 09008KT 9999 FEW020 29/23 Q1015 NOSIG` }] });
  if (p.includes('/hubs/')) {
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return json({ negotiateVersion: 1, connectionId: 'isolated-qa', connectionToken: 'isolated-qa', availableTransports: [] });
  }
  if (p.startsWith('/api/v1/')) {
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() === 'GET') apiReads.push({ module: currentRoute, path: p, offset: Number(url.searchParams.get('offset') || 0) });
    if (p.endsWith('/governance/me/access')) return json({ kind: 'Administrator', department: 'Operations', permissions: grants, stations: [station], canManageDepartmentUsers: true });
    if (p.endsWith('/changes')) return json({ changes: [], nextCursor: url.searchParams.get('after') || null, hasMore: false });
    if (p === '/api/v1/chat/presence') {
      if (request.method() === 'PUT') return route.fulfill({ status: 204, headers });
      return json({ asOf: now, operations: url.searchParams.getAll('operationIds').map(id => ({ operationId: id,
        participants: [{ accountId: message.senderAccountId, name: message.senderName, role: 'agent', state: presenceState, lastActivityAt: now }] })) });
    }
    if (p.includes('notifications') && request.method() === 'PUT') {
      const id = p.split('/').at(-2);
      const read = request.postDataJSON().read;
      const item = notices.find(n => n.id === id);
      assert.ok(item, 'Unknown read receipt');
      item.readAt = read ? now : null;
      return json(item);
    }
    if (p.endsWith('/notifications')) return json({ notifications: notices, hasMore: true });
    if (p.endsWith('/conversations')) {
      const conversation = { operationId, operationCode: 'QA-101', operationDate: date, stationCode: 'PUJ', airlineName: 'QA Airline', agentName: 'Agente QA', status: 'InProgress', lastMessage: message };
      const all = paginatedChat ? Array.from({ length: 101 }, (_, index) => {
        const id = index ? uuid(1000 + index) : operationId;
        return { ...conversation, operationId: id, operationCode: `QA-${101 + index}`,
          lastMessage: { ...message, operationId: id } };
      }) : [conversation];
      const offset = Number(url.searchParams.get('offset') || 0);
      return json({ conversations: all.slice(offset, offset + 100), hasMore: all.length > offset + 100 });
    }
    if (p.endsWith('/messages')) {
      const selectedId = p.split('/').at(-2);
      if (request.method() === 'POST') {
        const key = request.headers()['idempotency-key'];
        assert.ok(key, 'Chat must send a stable idempotency key');
        chatPosts.push({ operationId: selectedId, key });
        if (!chatAcknowledgements.has(key)) chatAcknowledgements.set(key, { ...message,
          id: uuid(10_000 + chatAcknowledgements.size), operationId: selectedId,
          senderAccountId: session.accountId, senderName: session.name, senderRole: 'occ',
          content: request.postDataJSON().content, sentAt: new Date().toISOString() });
        if (holdFirstChatPost) {
          holdFirstChatPost = false;
          await new Promise(resolve => { releaseChatPost = resolve; onChatPostHeld?.(); });
          expectedApiFailures.push({ path: p, status: 503 });
          return json({ title: 'Controlled QA retry', status: 503 }, 503);
        }
        return json(chatAcknowledgements.get(key));
      }
      const messages = [...(paginatedChat && selectedId === operationId ? historicMessages : [{ ...message, operationId: selectedId }]),
        ...[...chatAcknowledgements.values()].filter(item => item.operationId === selectedId)];
      const offset = Number(url.searchParams.get('offset') || 0);
      const newestFirst = [...messages].reverse();
      return json({ operationId: selectedId, messages: newestFirst.slice(offset, offset + 200).reverse(), hasMore: messages.length > offset + 200 });
    }
    if (p.includes('/traffic/aircraft')) return json({ source: 'OpenSky', providerTime: now, retrievedAt: now, stale: false, aircraft: [] });
    if (p.includes('/planning') && !p.includes('/options')) return json({ station, date: url.searchParams.get('date') || date, turnarounds: [turnaround] });
    if (p.endsWith('/positions')) return json({ stationId: station.id, stationCode: 'PUJ', operationDate: date, asOf: now, canAssign: true, unassigned: [], positions: [{ standId: uuid(6), code: 'A01', terminalCode: 'A', standType: 'Contact', status: 'planned', turnarounds: [{ turnaroundId: operationId, operationCode: 'QA-101', airlineName: 'QA Airline', status: 'Confirmed', arrivalFlightNumber: 'QA101', arrivalScheduledAt: now }] }] });
    if (p.includes('/review') && !p.includes('/submissions')) return json({ stationId: station.id, stationCode: 'PUJ', stationName: station.name, ianaTimeZone: station.ianaTimeZone, hasMore: false, operations: [] });
    if (p.endsWith('/reports')) return json({ maxRangeDays: 366, reports: [{ key: 'operations', title: 'Operaciones', description: 'Operaciones del periodo', columns: ['Operación'] }] });
    if (p.includes('/reports/operations')) return json({ key: 'operations', title: 'Operaciones', stationId: station.id, stationCode: 'PUJ', from: url.searchParams.get('from'), to: url.searchParams.get('to'), asOf: now, columns: ['Operación'], rows: [[{ value: 'QA-101', type: 'text' }]], page: Number(url.searchParams.get('page') || 1), limit: 25, hasMore: false });
    if (p.endsWith('/governance/catalog')) return json([]);
    if (p.includes('/governance/departments/') && p.endsWith('/summary')) return json({ administrators: 1, members: 0, rampAgents: 0, inactive: 0, pendingRequests: 0, pendingFirstLogin: 0, activeProfiles: 0 });
    if (p.includes('/governance/departments/') && p.endsWith('/options')) return json({ stations: [station], terminals: [], supervisors: [] });
    if (p.includes('/governance/departments/') && p.endsWith('/users')) return json({ users: [], total: 0, hasMore: false });
    if (p.endsWith('/access-profiles')) return json([]);
    if (p.endsWith('/access-requests')) return json({ requests: [], total: 0, hasMore: false });
    if (p.endsWith('/finance/expenses/options')) return json({ employeeId: uuid(30), canCreateOwnExpense: true, canReadOwnExpenses: true, canReviewDepartmentExpenses: true, currencies: ['DOP', 'USD'], suppliers: [], expenseCategories: [] });
    if (p.endsWith('/finance/expenses')) return json([]);
    unknown.add(p);
    return json({ title: 'Controlled QA response', status: 403 }, 403);
  }
  // External providers are isolated too. Maps are tested with deterministic basemaps.
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    console.log('Isolated external resource:', currentRoute, p);
    if (p === '/css2') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/openfreemap|maplibre|maptiler|openstreetmap|cartocdn|arcgisonline|earthdata|maps\.googleapis|maps\.gstatic/.test(url.hostname)) {
      tileRequests.push({ currentRoute, path: p });
    }
    if (/style.*json|\.json$|\/styles\/[^/]+$/.test(p)) return json({ version: 8, sources: {}, layers: [{ id: 'qa-background', type: 'background', paint: { 'background-color': '#e7edf4' } }] });
    return route.fulfill({ status: 204 });
  }
  return route.continue();
});

const page = await context.newPage();
if (process.env.ELEVANT_QA_COLD_TIMEOUT_MS) page.setDefaultNavigationTimeout(navigationTimeout);
page.on('pageerror', error => errors.push({ route: currentRoute, message: error.message }));
page.on('console', message => {
  if (message.type() !== 'error') return;
  if (message.text().includes('503') && message.location().url.includes('/messages')) {
    expectedConsoleErrors.push(message.text()); return;
  }
  consoleErrors.add(message.text().replace(/https?:\/\/\S+/g, '[isolated provider]'));
});
page.on('response', response => {
  const url = new URL(response.url());
  if (url.origin === new URL(base).origin && response.status() >= 400 &&
    !expectedApiFailures.some(item => item.path === url.pathname && item.status === response.status())) failedLocalRequests.push({ path: url.pathname, status: response.status() });
});
await page.addInitScript(({ session }) => {
  // Seed once per tab. Re-seeding on every document would conceal a broken
  // logout by restoring the credential during the redirect to /login.
  if (!sessionStorage.getItem('elevant-qa-session-seeded')) {
    localStorage.setItem('elevant-auth-session', JSON.stringify(session));
    sessionStorage.setItem('elevant-qa-session-seeded', 'true');
  }
}, { session });
await page.goto(base + '/healthz', { waitUntil: 'domcontentloaded' });
async function visit(moduleId, language, theme, width) {
  currentRoute = moduleId;
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(({ language, theme }) => { localStorage.setItem('elevant-language', language); localStorage.setItem('elevant-theme', theme); }, { language, theme });
  const started = Date.now();
  const initialReadCount = apiReads.length;
  await page.goto(`${base}/admin-occ/${moduleId}`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
  try { await page.locator('[data-shell-main]').waitFor({ timeout: process.env.ELEVANT_QA_COLD_TIMEOUT_MS ? navigationTimeout : 30_000 }); }
  catch (error) {
    console.error({ path: new URL(page.url()).pathname, body: (await page.locator('body').innerText()).slice(0, 1200), unknown: [...unknown] });
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'occ-qa-failure.png') });
    throw error;
  }
  if (moduleId !== 'dashboard') await page.locator(`[data-occ-workspace="${moduleId}"]`).waitFor();
  else await page.locator('.occ-dashboard').waitFor();
  await page.waitForFunction(() => !/Cargando permisos/.test(document.body.innerText));
  if (moduleId === 'chat' && !benchmarkOnly) {
    await page.getByRole('button', { name: /QA-101/ }).click();
    await page.locator('[data-chat-scroll] [data-message-id]').first().waitFor();
  }
  await page.waitForTimeout(200);
  navigationMetrics.push({ module: moduleId, language, theme, width, readyMs: Date.now() - started,
    apiReads: apiReads.length - initialReadCount,
    ...await page.evaluate(() => ({ scriptBytes: performance.getEntriesByType('resource')
      .filter(entry => entry.initiatorType === 'script').reduce((sum, entry) => sum + entry.encodedBodySize, 0) })) });
}

async function seedSession(remember = true, account = session, broadcast = false) {
  await page.evaluate(({ account, remember, broadcast }) => {
    localStorage.removeItem('elevant-auth-session');
    sessionStorage.removeItem('elevant-auth-session');
    (remember ? localStorage : sessionStorage).setItem('elevant-auth-session', JSON.stringify(account));
    if (broadcast) window.dispatchEvent(new StorageEvent('storage', { key: 'elevant-auth-session' }));
  }, { account, remember, broadcast });
}

async function openSignOut(language = 'es') {
  const name = language === 'es' ? 'Cerrar sesión' : 'Sign out';
  const exits = page.getByRole('button', { name, exact: true })
    .or(page.getByRole('menuitem', { name, exact: true }));
  let exit = exits.filter({ visible: true }).first();
  if (!await exit.count()) {
    await page.locator('header button[aria-haspopup="menu"]:visible').last().click();
    exit = exits.filter({ visible: true }).first();
  }
  const returnFocus = await exit.evaluateHandle(el => el.closest('[role="menu"]')?.parentElement
    ?.querySelector('button[aria-haspopup="menu"]') ?? el);
  await exit.click();
  const dialog = page.getByRole('alertdialog', { name: language === 'es' ? 'Confirmar cierre de sesión' : 'Confirm sign out' });
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('lang'), language);
  assert.ok(await dialog.innerText().then(text => text.includes(language === 'es'
    ? '¿Estás seguro de que deseas cerrar sesión?' : 'Are you sure you want to sign out?')));
  await page.waitForFunction(label => [...document.querySelectorAll('[role="alertdialog"] button')]
    .some(button => button.textContent.trim() === label && button === document.activeElement), language === 'es' ? 'Cancelar' : 'Cancel');
  return { dialog, returnFocus };
}
async function assertTextContrast(locator, pseudo = null) {
  const unreadable = await locator.evaluateAll((elements, pseudo) => {
    const colors = new Map();
    const pixel = document.createElement('canvas'); pixel.width = 1; pixel.height = 1;
    const painter = pixel.getContext('2d', { willReadFrequently: true });
    const rgba = value => {
      if (colors.has(value)) return colors.get(value);
      // Resolve the browser's computed colors, including Tailwind's OKLCH and
      // color-mix(), in sRGB instead of interpreting their numbers as RGB.
      painter.clearRect(0, 0, 1, 1); painter.fillStyle = value; painter.fillRect(0, 0, 1, 1);
      const channels = [...painter.getImageData(0, 0, 1, 1).data];
      const result = [...channels.slice(0, 3), channels[3] / 255]; colors.set(value, result);
      return result;
    };
    const blend = (front, back) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return alpha ? [...front.slice(0, 3).map((v, i) => (v * front[3] + back[i] * back[3] * (1 - front[3])) / alpha), alpha] : [0, 0, 0, 0];
    };
    const luminance = rgb => rgb.slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const text = el => pseudo ? el.getAttribute('placeholder') ?? '' : el.textContent.trim();
    return elements.filter(el => text(el) && (!pseudo || !el.value) && el.getClientRects().length && !el.closest(':disabled, [aria-disabled="true"], [aria-hidden="true"]')).flatMap(el => {
      let backgrounds = [[0, 0, 0, 0]];
      for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
        const surface = getComputedStyle(ancestor);
        const solid = rgba(surface.backgroundColor);
        const stops = surface.backgroundImage.match(/rgba?\([^)]+\)/g)?.map(rgba) ?? [];
        const coats = stops.length ? stops.map(stop => blend(stop, solid)) : [solid];
        backgrounds = backgrounds.flatMap(front => coats.map(back => blend(front, back)));
        if (backgrounds.every(background => background[3] >= .999)) break;
      }
      backgrounds = backgrounds.map(background => blend(background, [255, 255, 255, 1]));
      const css = getComputedStyle(el, pseudo);
      const color = rgba(css.color); color[3] *= Number(css.opacity);
      const ratio = Math.min(...backgrounds.map(background => {
        const foreground = blend(color, background);
        const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return (light + .05) / (dark + .05);
      }));
      return ratio >= 4.5 ? [] : [{ text: text(el).slice(0, 60), ratio }];
    });
  }, pseudo);
  assert.deepEqual(unreadable, [], 'Visible action/status text must meet 4.5:1 contrast');
}
async function check(name, run) {
  if (panoramaOnly && !name.startsWith('Panorama')) return;
  if (process.env.ELEVANT_QA_CHECK_PATTERN && !new RegExp(process.env.ELEVANT_QA_CHECK_PATTERN).test(name)) return;
  console.log(name);
  try { await run(); checks.push(name); }
  catch (error) { failures.push({ name, error: error.message }); console.error(name, error.message); }
}
try {
  if (benchmarkOnly) {
    for (const moduleId of pages) await check(`benchmark/${moduleId}`, async () => {
      await visit(moduleId, 'es', 'light', 1440);
      if (moduleId === 'dashboard') await page.waitForFunction(() => document.querySelectorAll('.maplibregl-map').length === 3);
      navigationMetrics.at(-1).geometry = await page.locator('[data-shell-main], [data-shell-root] > aside, [data-occ-horizontal], .occ-dashboard, .occ-console-stage, .occ-stage-primary, .occ-stage-aux, .occ-stage-weather, .occ-stage-region').evaluateAll(nodes => nodes.map(el => {
        const r = el.getBoundingClientRect(); const css = getComputedStyle(el);
        return { selector: el.className, x: r.x, y: r.y, width: r.width, height: r.height, display: css.display, columns: css.gridTemplateColumns, rows: css.gridTemplateRows, gap: css.gap };
      }));
      if (artifacts) await page.screenshot({ path: path.join(artifacts, `${moduleId}-${benchmarkLabel}.png`), fullPage: true });
    });
  } else {
  for (const language of flowsOnly ? [] : ['es', 'en']) for (const theme of ['light', 'dark']) for (const width of [375, 768, 1024, 1440]) {
    console.log(`Checking ${language}/${theme}/${width}`);
    for (const moduleId of pages) {
      if (failures.length >= 5) throw new Error('Stopping after five failures; inspect the first failing screens.');
      await check(`${moduleId}/${language}/${theme}/${width}`, async () => {
        await visit(moduleId, language, theme, width);
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.locator('[data-occ-horizontal]').count(), 1);
        assert.equal(await page.locator('[data-shell-root] > aside').count(), 0);
        assert.equal(await page.locator('[data-occ-horizontal]').evaluate(el => el.getBoundingClientRect().height), 56);
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Document overflows horizontally');
        assert.equal(await page.locator('aside a[href="/admin-occ/flight-monitoring"], aside a[href="/admin-occ/positions-map"]').count(), 0);
        if (moduleId !== 'dashboard') {
          assert.equal(await page.locator('[data-shell-main]').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Module overflows its main container');
          await assertTextContrast(page.locator('[data-occ-workspace] :is(.text-accent-600, .text-signal-500, .text-status-warning, .text-status-danger, .text-status-success, .text-text-secondary-light, .text-text-secondary-dark)'));
          await assertTextContrast(page.locator('[data-occ-workspace] :is(input[placeholder], textarea[placeholder])'), '::placeholder');
          const title = page.locator('[data-occ-workspace] h1').first();
          assert.equal(await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize)), width < 768 ? 22 : 24, 'Module title size differs from the refined system');
          const undersized = await page.locator('[data-occ-workspace] button:visible, header button:visible, aside[data-occ-nav] button:visible').evaluateAll(buttons => buttons
            .filter(button => !button.disabled && button.getClientRects().length)
            .filter(button => button.getBoundingClientRect().height < (button.closest('[data-occ-horizontal]') || innerWidth < 768 || matchMedia('(pointer: coarse)').matches ? 43.5 : 35.5))
            .map(button => ({ text: button.getAttribute('aria-label') || button.textContent.trim(), height: button.getBoundingClientRect().height })));
          assert.deepEqual(undersized, [], 'Header/touch controls require 44px; fine-pointer desktop controls require 36px');
        }
        await assertTextContrast(page.locator('[class*="OccWorkspace_rail"] :is(p, a span, button span)'));
        await assertTextContrast(page.locator('header :is(p, time, button, span)'));
        if (moduleId === 'users') {
          const active = page.locator('[role="tab"][aria-selected="true"]');
          await active.waitFor(); await assertTextContrast(active);
        }
        if (['positions-map', 'flight-monitoring'].includes(moduleId)) {
          assert.equal(await page.locator('canvas, .maplibregl-map, .gm-style').count(), 0, 'Operational view mounted a map');
          assert.equal(tileRequests.filter(r => r.currentRoute === moduleId).length, 0, 'Operational view requested provider content');
        }
        if (artifacts && language === 'es' && ((width === 1440 && theme === 'dark') || (width === 375 && theme === 'light'))) {
          await page.screenshot({ path: path.join(artifacts, `${moduleId}-${theme}-${width}.png`) });
        }
      });
    }
  }
  await check('horizontal navigation, compact controls and keyboard menus', async () => {
    await visit('planning', 'es', 'light', 1440);
    const header = page.locator('[data-occ-horizontal]');
    const rect = await header.boundingBox();
    assert.equal(rect.height, 56); assert.equal(rect.width, 1328); assert.equal(rect.y, 12);
    assert.equal(await page.locator('[data-shell-root] > aside').count(), 0);
    const logo = () => header.locator('img:visible');
    assert.ok((await logo().getAttribute('src')).includes('elevant-mark-light'));
    assert.equal(await logo().evaluate(el => el.getBoundingClientRect().width), 44);
    const language = header.getByRole('button', { name: 'EN', exact: true });
    assert.equal(await language.locator('span').evaluate(el => el.getBoundingClientRect().height), 28);
    await language.click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.match(await page.getByRole('heading', { level: 1 }).innerText(), /Planning/i);
    await header.getByRole('button', { name: /dark/i }).click();
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), true);
    assert.ok((await logo().getAttribute('src')).includes('elevant-mark-dark'));
    const profile = header.getByRole('button', { name: /^Account:/ });
    await profile.click(); await page.keyboard.press('Escape');
    assert.equal(await profile.evaluate(el => el === document.activeElement), true);
    for (const [group, items] of [['Operations', 4], ['Communication', 2], ['Administration', 1]]) {
      const trigger = header.getByRole('button', { name: group, exact: true });
      await trigger.focus(); await page.keyboard.press('ArrowDown');
      assert.equal(await page.getByRole('menu', { name: group, exact: true }).getByRole('menuitem').count(), items);
      await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    }
    await page.setViewportSize({ width: 375, height: 900 });
    await page.waitForFunction(() => document.querySelector('[data-occ-horizontal]')?.dataset.compact === 'true');
    const mobile = header.getByRole('button', { name: 'Open navigation', exact: true });
    await mobile.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('menu', { name: 'Main navigation' }).getByRole('menuitem').count(), 8);
    await page.keyboard.press('Escape');
    assert.equal(await mobile.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await header.getByRole('button', { name: 'ES', exact: true }).isVisible(), true);
    assert.equal(await header.getByRole('button', { name: /light/i }).isVisible(), true);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForFunction(() => document.querySelector('[data-occ-horizontal]')?.dataset.compact === 'false');
    await header.getByRole('button', { name: 'Operations', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reports', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/admin-occ/reports');
  });
  await check('chat presence states and controlled autosizing composer', async () => {
    await visit('chat', 'es', 'light', 1440);
    const input = page.getByLabel('Mensaje', { exact: true });
    assert.equal(await input.evaluate(el => el.getBoundingClientRect().height), 44);
    const panels = await page.locator('[data-occ-chat-layout] > section').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().width));
    assert.ok(panels[0] >= 240 && panels[0] <= 320); assert.ok(panels[1] > panels[0] * 2);
    for (const state of ['active', 'away', 'offline', 'unknown']) {
      presenceState = state;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      const person = page.locator('[data-presence-state="' + state + '"]').first();
      await person.waitFor();
      const color = await person.locator('[class*="dot"]').evaluate(el => getComputedStyle(el).backgroundColor);
      if (state === 'offline') assert.equal(color, 'rgb(180, 35, 24)');
      if (state === 'active') assert.equal(color, 'rgb(22, 130, 77)');
      if (state === 'away') assert.equal(color, 'rgb(157, 103, 0)');
      if (state === 'unknown') assert.notEqual(color, 'rgb(180, 35, 24)');
    }
    presenceState = 'active';
    const long = Array.from({ length: 12 }, (_, i) => 'QA autosize line ' + i).join('\n');
    await input.fill(long);
    assert.equal(await input.evaluate(el => el.getBoundingClientRect().height), 144);
    assert.equal(await input.evaluate(el => getComputedStyle(el).overflowY), 'auto');
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('occ-chat-draft')?.value === '');
    assert.equal(await input.evaluate(el => el.getBoundingClientRect().height), 44);
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await input.isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'chat-selected-mobile.png') });
  });
  await check('flight selection and keyboard dismissal', async () => {
    await visit('flight-monitoring', 'es', 'light', 375);
    const flight = page.getByTestId('flight-list-item').first();
    await flight.waitFor(); await flight.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Detalle del vuelo' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: 'Detalle del vuelo' }).count(), 0);
  });
  await check('position search retains authorized arrival actions', async () => {
    await visit('positions-map', 'es', 'light', 375);
    const search = page.getByPlaceholder('Buscar posición, vuelo o matrícula...');
    await search.fill('A1'); await search.press('Enter');
    const drawer = page.getByTestId('position-detail-drawer');
    await drawer.waitFor();
    await drawer.getByRole('button', { name: 'Registrar llegada', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await drawer.count(), 0);
    const position = page.getByTestId('position-list-item').first();
    await position.focus(); await page.keyboard.press('Enter');
    await drawer.waitFor(); await page.keyboard.press('Escape');
  });
  await check('report generation preserves the real result flow', async () => {
    await visit('reports', 'es', 'light', 1024);
    await page.getByRole('button', { name: 'Generar', exact: true }).click();
    await page.getByRole('table').waitFor();
    assert.ok(await page.getByRole('table').innerText().then(text => text.includes('QA-101')));
  });
  await check('bell keyboard and synchronized read receipt', async () => {
    await visit('notifications', 'en', 'dark', 1440);
    const bell = page.getByRole('button', { name: /^Notifications,/ });
    await bell.waitFor(); await bell.focus(); await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', { name: 'Notifications' });
    await popover.waitFor();
    await popover.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await page.getByRole('button', { name: /^Notifications, 0/ }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await popover.count(), 0);
    assert.equal(await bell.evaluate(el => el === document.activeElement), true);
  });
  await check('opening a pending notice confirms reading and preserves history', async () => {
    notices = [...notices, notice(22)];
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const bell = page.getByRole('button', { name: /^Notifications, 1/ });
    await bell.click();
    const popover = page.getByRole('dialog', { name: 'Notifications' });
    await popover.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/admin-occ/chat' && url.searchParams.get('operationId') === operationId);
    await page.getByRole('button', { name: /^Notifications, 0/ }).waitFor();
    await page.locator('[data-presence-state="active"]').first().waitFor();
    await visit('notifications', 'en', 'dark', 1440);
    assert.equal(await page.getByRole('button', { name: 'Mark as unread', exact: true }).count(), 2);
  });
  await check('permission-scoped contextual links and retained routes', async () => {
    await visit('planning', 'en', 'light', 1440);
    assert.equal(await page.locator('main a[href="/admin-occ/flight-monitoring"]').count(), 1);
    assert.equal(await page.locator('main a[href="/admin-occ/positions-map"]').count(), 1);
    try {
    grants = permissions.filter(p => !p.includes('flight_monitoring') && !p.includes('positions_map'));
    await visit('planning', 'en', 'light', 1440);
    assert.equal(await page.locator('main a[href="/admin-occ/flight-monitoring"], main a[href="/admin-occ/positions-map"]').count(), 0);
    for (const pathname of ['/admin-occ/positions-map', '/admin-occ/flight-monitoring']) {
      await page.goto(base + pathname, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(url => url.pathname !== pathname);
      assert.notEqual(new URL(page.url()).pathname, pathname, 'Hidden routes must retain their permission guard');
    }
    } finally { grants = [...permissions]; }
  });
  await check('OCC entry keeps Dashboard and offers authorized modules when denied', async () => {
    await seedSession();
    grants = permissions.filter(permission => permission !== 'operations.dashboard.read');
    try {
      await page.goto(base + '/admin-occ', { waitUntil: 'domcontentloaded' });
      const notice = page.locator('[data-occ-access-notice]');
      await notice.waitFor();
      assert.equal(new URL(page.url()).pathname, '/admin-occ/dashboard');
      assert.equal(await notice.locator('a[href="/admin-occ/planning"]').count(), 1);
      assert.equal(await notice.locator('a[href="/admin-occ/dashboard"]').count(), 0);
      assert.equal(await page.locator('.occ-dashboard, .maplibregl-map').count(), 0);
      await page.waitForTimeout(300);
      assert.equal(new URL(page.url()).pathname, '/admin-occ/dashboard', 'Home redirected to an unrelated module');
    } finally { grants = [...permissions]; }
    await page.goto(base + '/admin-occ', { waitUntil: 'domcontentloaded' });
    await page.locator('.occ-dashboard').waitFor();
    assert.equal(new URL(page.url()).pathname, '/admin-occ/dashboard');
  });
  await check('planning table, calendar and filters use the same turnarounds', async () => {
    await visit('planning', 'es', 'light', 1440);
    await page.getByRole('button', { name: 'Tabla', exact: true }).click();
    const table = page.getByRole('table', { name: 'Tabla de planificación' });
    await table.waitFor();
    await table.locator('[data-planning-row]').first().waitFor();
    assert.deepEqual(await table.locator('[data-planning-row]').evaluateAll(rows => rows.map(row => row.dataset.planningRow)), [operationId]);
    assert.equal(await table.getByRole('button', { name: 'Abrir detalle de QA-101' }).count(), 1);
    await table.getByRole('button', { name: 'Abrir detalle de QA-101' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
    assert.equal(await table.locator(`[data-planning-row="${operationId}"]`).getAttribute('data-selected'), 'true');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await page.getByRole('button', { name: 'Calendario', exact: true }).click();
    const calendar = page.getByRole('region', { name: 'Calendario operativo' });
    await calendar.waitFor();
    assert.deepEqual(await calendar.locator('[data-planning-event]').evaluateAll(events => [...new Set(events.map(event => event.dataset.planningEvent))]), [operationId]);
    await calendar.getByRole('button', { name: 'Abrir detalle de QA-101' }).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
    assert.equal(await calendar.locator('[data-planning-event]').first().getAttribute('data-selected'), 'true');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const day = await page.locator('input[type="date"]').first().inputValue();
    await calendar.getByRole('button', { name: 'Día anterior', exact: true }).click();
    await page.waitForFunction(day => document.querySelector('input[type="date"]')?.value !== day, day);
    await calendar.getByText('Fuera del día seleccionado', { exact: true }).waitFor();
    await calendar.getByRole('button', { name: 'Día siguiente', exact: true }).click();
    await page.waitForFunction(day => document.querySelector('input[type="date"]')?.value === day, day);
    const search = page.locator('[data-occ-workspace="planning"] input[placeholder]').first();
    await search.fill('NO-SUCH-TURNAROUND');
    await calendar.getByText('No hay escalas para estos filtros.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tabla', exact: true }).click();
    assert.equal(await page.locator('[data-planning-row]').count(), 0);
    await search.fill('QA101');
    await page.locator('[data-planning-row]').first().waitFor();
    assert.equal(await page.locator('[data-planning-row]').count(), 1);
  });
  await check('client navigation preserves the OCC shell', async () => {
    await visit('planning', 'en', 'light', 1440);
    const main = await page.locator('[data-shell-main]').elementHandle();
    currentRoute = 'reports';
    const started = Date.now();
    await page.locator('[data-occ-horizontal]').getByRole('button', { name: 'Operación', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reportes', exact: true }).click();
    await page.locator('[data-occ-workspace="reports"]').waitFor();
    assert.equal(await main.evaluate(el => el.isConnected), true, 'Navigation remounted the shared layout');
    navigationMetrics.push({ module: 'reports', navigation: 'client', readyMs: Date.now() - started });
  });
  await check('chat loads bounded pages and preserves its history anchor during updates', async () => {
    paginatedChat = true;
    try {
      await visit('chat', 'es', 'light', 1440);
      await page.getByRole('button', { name: 'Cargar más operaciones', exact: true }).click();
      await page.getByRole('button', { name: /QA-201/ }).waitFor();
      assert.ok(apiReads.some(item => item.path.endsWith('/conversations') && item.offset === 100));
      await page.getByRole('button', { name: /QA-101/ }).click();
      const history = page.locator('[data-chat-scroll]');
      await history.locator('[data-message-id]').first().waitFor();
      assert.equal(await history.locator('[data-message-id]').count(), 200);
      await history.evaluate(el => { el.scrollTop = 0; });
      await page.waitForTimeout(50);
      const anchor = await history.evaluate(el => {
        const box = el.getBoundingClientRect();
        const message = [...el.querySelectorAll('[data-message-id]')].find(item => item.getBoundingClientRect().bottom > box.top + 1);
        return { id: message.dataset.messageId, top: message.getBoundingClientRect().top - box.top };
      });
      await page.getByRole('button', { name: 'Cargar mensajes anteriores', exact: true }).click();
      await history.locator(`[data-message-id="${uuid(3000)}"]`).waitFor();
      assert.equal(await history.locator('[data-message-id]').count(), 201);
      assert.ok(apiReads.some(item => item.path.endsWith('/messages') && item.offset === 200));
      let top = await history.locator(`[data-message-id="${anchor.id}"]`).evaluate(el => el.getBoundingClientRect().top - el.closest('[data-chat-scroll]').getBoundingClientRect().top);
      assert.ok(Math.abs(top - anchor.top) <= 2, 'Loading older messages moved the reading anchor');
      const existing = await history.locator(`[data-message-id="${anchor.id}"]`).elementHandle();
      historicMessages.push({ ...message, id: uuid(8000), content: 'Actualización QA sin recarga', sentAt: new Date().toISOString() });
      await history.getByText('Actualización QA sin recarga', { exact: true }).waitFor({ timeout: 30_000 });
      assert.equal(await existing.evaluate(el => el.isConnected), true, 'Polling remounted existing messages');
      top = await existing.evaluate(el => el.getBoundingClientRect().top - el.closest('[data-chat-scroll]').getBoundingClientRect().top);
      assert.ok(Math.abs(top - anchor.top) <= 2, 'Incoming messages interrupted an earlier reading position');
    } finally { paginatedChat = false; }
  });
  await check('chat preserves per-operation drafts and retries an uncertain send with one key', async () => {
    paginatedChat = true;
    holdFirstChatPost = true;
    chatPosts.length = 0;
    chatAcknowledgements.clear();
    try {
      await visit('chat', 'es', 'light', 1440);
      await page.getByRole('button', { name: /QA-101/ }).click();
      const draft = page.getByLabel('Mensaje', { exact: true });
      await draft.fill('Consulta QA de plataforma');
      let heldTimeout;
      const held = new Promise((resolve, reject) => {
        heldTimeout = setTimeout(() => reject(new Error('Chat did not send the pending command')), 10_000);
        onChatPostHeld = () => { clearTimeout(heldTimeout); resolve(); };
      });
      await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
      await held;
      await page.getByRole('button', { name: /QA-102/ }).click();
      await draft.fill('Borrador de otra operación');
      await page.getByRole('button', { name: /QA-101/ }).click();
      assert.equal(await draft.inputValue(), 'Consulta QA de plataforma');
      assert.equal(await draft.isDisabled(), true);
      releaseChatPost();
      await page.getByRole('button', { name: 'Reintentar envío', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reintentar envío', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
      assert.equal(chatPosts.length, 2);
      assert.equal(chatPosts[0].key, chatPosts[1].key, 'Retry generated a second command identity');
      assert.equal(chatPosts[0].operationId, operationId);
      const canonical = [...chatAcknowledgements.values()][0];
      assert.equal(await page.locator(`[data-message-id="${canonical.id}"]`).count(), 1);
      await page.getByRole('button', { name: /QA-102/ }).click();
      assert.equal(await draft.inputValue(), 'Borrador de otra operación');
    } finally {
      releaseChatPost?.(); releaseChatPost = undefined; onChatPostHeld = undefined;
      holdFirstChatPost = false; paginatedChat = false;
    }
  });
  for (const language of ['es', 'en']) for (const theme of ['light', 'dark']) for (const width of [375, 1440]) {
    await check(`logout cancellation/${language}/${theme}/${width}`, async () => {
      await seedSession(width === 1440);
      await visit('planning', language, theme, width);
      const search = page.locator('[data-occ-workspace="planning"] input[placeholder]').first();
      await search.fill('QA101');
      const before = await page.evaluate(() => {
        const main = document.querySelector('[data-shell-main]');
        main.scrollTop = 60;
        return { url: location.href, scroll: main.scrollTop, language: document.documentElement.lang,
          local: localStorage.getItem('elevant-auth-session'), temporary: sessionStorage.getItem('elevant-auth-session') };
      });
      const { dialog, returnFocus } = await openSignOut(language);
      await assertTextContrast(dialog.locator('button, p'));
      if (artifacts) await page.screenshot({ path: path.join(artifacts, `logout-${language}-${theme}-${width}.png`) });
      await dialog.getByRole('button', { name: language === 'es' ? 'Cancelar' : 'Cancel', exact: true }).click();
      await page.waitForFunction(el => el.isConnected && el === document.activeElement, returnFocus);
      assert.equal(await search.inputValue(), 'QA101');
      assert.deepEqual(await page.evaluate(() => ({ url: location.href,
        scroll: document.querySelector('[data-shell-main]').scrollTop, language: document.documentElement.lang,
        local: localStorage.getItem('elevant-auth-session'), temporary: sessionStorage.getItem('elevant-auth-session') })), before);
      await openSignOut(language);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
      assert.equal(await search.inputValue(), 'QA101');
      await openSignOut(language);
      await page.mouse.click(1, 1);
      await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
      assert.equal(new URL(page.url()).pathname, '/admin-occ/planning');
    });
  }
  for (const remember of [true, false]) {
    await check(`logout confirmation clears ${remember ? 'local' : 'session'} storage once`, async () => {
      await seedSession(remember);
      await visit('planning', 'es', 'light', remember ? 1440 : 375);
      await page.evaluate(() => {
        const original = Storage.prototype.removeItem;
        sessionStorage.setItem('elevant-qa-auth-removals', '0');
        Storage.prototype.removeItem = function (key) {
          if (key === 'elevant-auth-session') sessionStorage.setItem('elevant-qa-auth-removals', String(Number(sessionStorage.getItem('elevant-qa-auth-removals')) + 1));
          return original.call(this, key);
        };
      });
      const { dialog } = await openSignOut();
      await dialog.getByRole('button', { name: 'Cerrar sesión', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.waitForURL(url => url.pathname === '/login');
      assert.deepEqual(await page.evaluate(() => [localStorage.getItem('elevant-auth-session'), sessionStorage.getItem('elevant-auth-session')]), [null, null]);
      assert.equal(await page.evaluate(() => Number(sessionStorage.getItem('elevant-qa-auth-removals'))), 1, 'Rapid confirmation duplicated cleanup');
      await page.goto(base + '/admin-occ/planning', { waitUntil: 'domcontentloaded' });
      await page.waitForURL(url => url.pathname === '/login');
      assert.equal(await page.locator('[data-shell-main]').count(), 0);
    });
  }
  await check('failed manual cleanup reports an error and retries the real local logout', async () => {
    await seedSession();
    await visit('planning', 'en', 'dark', 1440);
    const { dialog } = await openSignOut('en');
    await page.evaluate(() => {
      window.__qaOriginalRemove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key === 'elevant-auth-session') throw new DOMException('Isolated QA storage failure', 'SecurityError');
        return window.__qaOriginalRemove.call(this, key);
      };
    });
    try {
      await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /could not be completed/);
      assert.equal(new URL(page.url()).pathname, '/admin-occ/planning');
      assert.ok(await page.evaluate(() => localStorage.getItem('elevant-auth-session')));
    } finally {
      await page.evaluate(() => { Storage.prototype.removeItem = window.__qaOriginalRemove; delete window.__qaOriginalRemove; });
    }
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/login');
    assert.equal(await page.evaluate(() => localStorage.getItem('elevant-auth-session')), null);
  });
  await check('account changes dismiss stale logout confirmation', async () => {
    await seedSession();
    await visit('planning', 'es', 'light', 1440);
    await openSignOut();
    const changed = { ...session, accountId: uuid(88), token: 'different-isolated-qa-token' };
    await seedSession(true, changed, true);
    await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('elevant-auth-session')).accountId), changed.accountId);
    assert.equal(new URL(page.url()).pathname, '/admin-occ/planning');
  });
  await check('automatic expiration closes confirmation without a manual decision', async () => {
    await seedSession();
    await visit('planning', 'es', 'light', 1440);
    await openSignOut();
    await seedSession(true, { ...session, expiresAt: new Date(Date.now() + 1500).toISOString() }, true);
    await page.waitForURL(url => url.pathname === '/login');
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('elevant-auth-session'), sessionStorage.getItem('elevant-auth-session')]), [null, null]);
  });
  await check('Panorama protected layout and expansion', async () => {
    notices = [notice(20)];
    await seedSession();
    await visit('dashboard', 'es', 'dark', 1440);
    assert.equal(await page.locator('[data-occ-workspace]').count(), 0);
    const height = await page.locator('[data-shell-main]').evaluate(el => el.getBoundingClientRect().top);
    assert.equal(height, 80, 'Floating header space changed');
    await page.waitForFunction(() => document.querySelectorAll('.maplibregl-map').length === 3);
    const maps = await page.locator('.maplibregl-map').elementHandles();
    assert.equal(await page.locator('[data-shell-root] > aside').count(), 0);
    assert.equal(await page.locator('[data-shell-main]').evaluate(el => el.getBoundingClientRect().left), 0);
    const stage = page.locator('.occ-console-stage');
    const primary = await page.locator('.occ-stage-primary').boundingBox();
    const weather = await page.locator('.occ-stage-weather').boundingBox();
    const regional = await page.locator('.occ-stage-region').boundingBox();
    assert.equal(primary.y, weather.y); assert.ok(primary.x < weather.x); assert.ok(weather.y < regional.y);
    if (process.env.ELEVANT_QA_REFERENCE_DIR) {
      const reference = JSON.parse(await readFile(path.join(process.env.ELEVANT_QA_REFERENCE_DIR, 'occ-browser-benchmark-before.json'), 'utf8'));
      const geometry = reference.navigationMetrics.find(item => item.module === 'dashboard').geometry;
      const beforePrimary = geometry.find(item => item.selector.includes('occ-stage-primary'));
      const beforeStage = geometry.find(item => item.selector.includes('occ-console-stage'));
      assert.equal(primary.height, beforePrimary.height, 'Protected map stage height changed');
      assert.ok((await stage.boundingBox()).width > beforeStage.width, 'Panorama did not reclaim the sidebar width');
    }
    const zoom = page.locator('.maplibregl-ctrl-zoom-in:not([disabled]):visible').first();
    await zoom.waitFor();
    const cameraControl = await zoom.elementHandle();
    for (let step = 0; step < 32 && !await cameraControl.isDisabled(); step += 1) {
      await cameraControl.click(); await page.waitForTimeout(350);
    }
    assert.equal(await cameraControl.isDisabled(), true, 'The camera zoom control did not reach its limit');
    const { dialog: exitDialog } = await openSignOut();
    await exitDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
    for (const map of maps) assert.equal(await map.evaluate(el => el.isConnected), true, 'Cancelling logout remounted a protected map');
    assert.equal(await cameraControl.isDisabled(), true, 'Cancelling logout reset the protected camera');
    assert.equal(await page.locator('[data-shell-main]').evaluate(el => el.getBoundingClientRect().top), 80);
    const bell = page.getByRole('button', { name: /^Notificaciones,/ });
    const previousCount = Number((await bell.getAttribute('aria-label')).match(/\d+/)[0]);
    await bell.click();
    await page.getByRole('dialog', { name: 'Notificaciones' }).getByRole('button', { name: /^Marcar como/ }).first().click();
    await page.getByRole('button', { name: new RegExp(`^Notificaciones, ${previousCount ? 0 : 1} sin leer`) }).waitFor();
    await page.keyboard.press('Escape');
    for (const map of maps) assert.equal(await map.evaluate(el => el.isConnected), true, 'A shell notification update remounted a protected map');
    assert.equal(await cameraControl.isDisabled(), true, 'A notification update reset the camera');
    const expand = page.locator('.occ-dashboard button[aria-haspopup="dialog"]').first();
    await expand.click();
    await page.getByRole('dialog').waitFor();
    const stand = page.getByRole('dialog').locator('aside button[aria-pressed]').first();
    await stand.click();
    assert.equal(await stand.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await visit('dashboard', 'es', 'dark', 1440);
    await page.waitForFunction(() => document.querySelectorAll('.maplibregl-map').length === 3);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'panorama-protected-dark-1440.png') });
  });
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(failedLocalRequests.length, 0, JSON.stringify(failedLocalRequests));
  assert.equal(consoleErrors.size, 0, JSON.stringify([...consoleErrors]));
} finally {
  await context.close(); await browser.close();
  const result = { passed: checks.length, failures, unexpectedApiPaths: [...unknown], pageErrors: errors, failedLocalRequests, consoleErrors: [...consoleErrors], expectedApiFailures, expectedConsoleErrors, navigationMetrics, apiReads };
  if (artifacts) await writeFile(path.join(artifacts, benchmarkOnly ? `occ-browser-benchmark-${benchmarkLabel}.json` : 'occ-browser-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, navigationMetrics: `${navigationMetrics.length} samples`, apiReads: `${apiReads.length} requests` }, null, 2));
}
if (failures.length || errors.length || unknown.size || failedLocalRequests.length) process.exitCode = 1;
