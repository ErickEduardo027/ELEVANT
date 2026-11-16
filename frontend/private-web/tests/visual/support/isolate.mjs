import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { syntheticTile } from './syntheticTiles.mjs';

// The network of the visual suite: the page talks to its own origin and nothing else. Every request to another origin
// is answered here or aborted and reported, so no test ever reaches a live provider:
// - OpenFreeMap: the TileJSON of the planet is a synthetic fixture; the glyph range 0-255 of the three Noto Sans
//   stacks comes from tests/visual/fixtures/glyphs (every other range answers an empty 404); the vector tiles are the
//   invented world of support/syntheticTiles.mjs (`tiles: 'synthetic'`, the default), empty (204, `'empty'`) or fail
//   at the network level (`'fail'`);
// - the ELEVANT API (https://api.elevant.test): the `api` handler answers, and everything it leaves answers a
//   Problem Details 404; its WebSockets are closed;
// - the Google Fonts stylesheet that the login screen's CSS imports (src/features/auth/LoginPage.css, loaded with
//   every protected route) answers an empty stylesheet, so no font is fetched from Google;
// - anything else is aborted and listed in `unexpected`, which every spec expects to end empty.
// The suite's Chrome also resolves no host but localhost (playwright.occ.config.mjs), so nothing these routes miss
// can reach the network.

export const OPENFREEMAP_ORIGIN = 'https://tiles.openfreemap.org';
export const API_ORIGIN = 'https://api.elevant.test';
export const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2';
export const TILEJSON_URL = `${OPENFREEMAP_ORIGIN}/planet`;
export const GLYPH_STACKS = Object.freeze(['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']);
export const GLYPH_RANGE = '0-255';
export const TILE_MODES = Object.freeze(['synthetic', 'empty', 'fail']);

const fixtures = new Map();
// A fixture file, read once on first use.
function fixture(name) {
  if (!fixtures.has(name)) fixtures.set(name, readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))));
  return fixtures.get(name);
}
const glyphFile = stack => (GLYPH_STACKS.includes(stack) ? fixture(`glyphs/${stack}/${GLYPH_RANGE}.pbf`) : null);

const NOT_FOUND = Object.freeze({
  type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
  title: 'Not Found',
  status: 404,
  code: 'not_found',
});

function corsHeaders(request, pageOrigin) {
  return {
    'access-control-allow-origin': request.headers().origin ?? pageOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-expose-headers': 'ETag',
    'cache-control': 'no-store',
  };
}

/** `{ stack, range }` of an OpenFreeMap glyph URL, or `null`. */
export function glyphRequest(url) {
  const match = /^\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/.exec(url.pathname);
  if (!match) return null;
  try {
    return { stack: decodeURIComponent(match[1]), range: match[2] };
  } catch {
    return null;
  }
}

/** `{ z, x, y }` of a vector tile URL of the planet (`/planet/<build>/<z>/<x>/<y>.pbf`), or `null`. */
export function tileRequest(url) {
  const match = /^\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
  return match ? { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
}

function assertTileMode(mode) {
  if (!TILE_MODES.includes(mode)) throw new RangeError(`Unknown tiles mode: ${mode}`);
  return mode;
}

/**
 * Routes the page's foreign requests. `origin` is the page's own origin (the suite's baseURL); `tiles` is one of
 * TILE_MODES; `api(request, url)` may return `{ status, json, headers }` for an API request (or nothing for the
 * 404). Returns the log of what happened: `unexpected` (requests and WebSockets to any other origin), `requests`
 * (every answered request with its `kind`: tilejson, glyph, tile, api or stylesheet), `glyphMisses`, `count(kind)`,
 * and `setTiles(mode)` / `setApi(handler)` to change the answers for the next requests.
 */
export async function isolate(page, { origin, tiles = 'synthetic', api = null } = {}) {
  if (!origin) throw new TypeError('isolate needs the origin of the page');
  const pageHost = new URL(origin).host;
  const state = { tiles: assertTileMode(tiles), api };
  const log = {
    unexpected: [],
    requests: [],
    glyphMisses: [],
    count: kind => log.requests.filter(entry => entry.kind === kind).length,
    setTiles(mode) {
      state.tiles = assertTileMode(mode);
    },
    setApi(handler) {
      state.api = handler;
    },
  };
  const answered = (kind, request) => log.requests.push({ kind, method: request.method(), url: request.url() });

  async function openFreeMap(route, request, url) {
    const headers = corsHeaders(request, origin);
    if (url.href === TILEJSON_URL) {
      answered('tilejson', request);
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: await fixture('tilejson.json') });
    }
    const glyph = glyphRequest(url);
    if (glyph) {
      answered('glyph', request);
      const body = glyph.range === GLYPH_RANGE ? glyphFile(glyph.stack) : null;
      if (!body) {
        log.glyphMisses.push(`${glyph.stack} ${glyph.range}`);
        return route.fulfill({ status: 404, headers, body: '' });
      }
      return route.fulfill({ status: 200, headers, contentType: 'application/x-protobuf', body: await body });
    }
    const tile = tileRequest(url);
    if (tile) {
      answered('tile', request);
      if (state.tiles === 'fail') return route.abort('failed');
      const body = state.tiles === 'synthetic' ? syntheticTile(tile.z, tile.x, tile.y) : null;
      if (body === null) return route.fulfill({ status: 204, headers, body: '' });
      return route.fulfill({ status: 200, headers, contentType: 'application/x-protobuf', body });
    }
    return null;
  }

  async function elevantApi(route, request, url) {
    answered('api', request);
    const headers = corsHeaders(request, origin);
    const answer = (await state.api?.(request, url)) ?? { status: 404, json: NOT_FOUND };
    return route.fulfill({
      status: answer.status ?? 200,
      headers: { ...headers, ...answer.headers },
      contentType: answer.status >= 400 ? 'application/problem+json' : 'application/json',
      body: answer.json === undefined ? '' : JSON.stringify(answer.json),
    });
  }

  await page.route(url => url.origin !== origin, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === OPENFREEMAP_ORIGIN) {
      const handled = await openFreeMap(route, request, url);
      if (handled !== null) return handled;
    } else if (url.origin === API_ORIGIN) {
      return elevantApi(route, request, url);
    } else if (`${url.origin}${url.pathname}` === GOOGLE_FONTS_CSS) {
      answered('stylesheet', request);
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    log.unexpected.push(`${request.method()} ${request.url()}`);
    return route.abort('blockedbyclient');
  });

  // The page's own WebSockets (the dev server's hot reload) pass; the API's are closed; any other is reported.
  await page.routeWebSocket(url => url.host !== pageHost, ws => {
    const url = new URL(ws.url());
    if (url.host !== new URL(API_ORIGIN).host) log.unexpected.push(`WS ${ws.url()}`);
    ws.close({ code: 1000, reason: 'The visual suite has no live server.' });
  });

  return log;
}
