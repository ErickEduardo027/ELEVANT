import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ADMIN_OCC_BASE_PATH, ADMIN_OCC_NAVIGATION } from '../admin-occ/navigation';
import { OCC_PATH_PREFIX, isOccPath, occThemeBootScript } from './occTheme';

const ORIGIN = 'https://aviam.elevant.test';

// [route, is it an OCC route]. The route may carry a query and a hash: only the path counts.
const ROUTES = [
  ['/admin-occ', true],
  ['/admin-occ/', true],
  ['/admin-occ/dashboard', true],
  ['/admin-occ/planning', true],
  ['/admin-occ/review/operations/42', true],
  ['/admin-occ/no-such-screen', true],
  ['/admin-occ/flight-monitoring?stationId=1&flightId=2#map', true],
  // The OCC's map lab takes the OCC's theme.
  ['/map-lab', true],
  ['/map-lab?scene=region-traffic-mixed', true],
  ['/map-labs', false],
  ['/', false],
  ['/login', false],
  ['/login?next=/admin-occ/dashboard', false],
  ['/select-role', false],
  ['/gestion-humana/dashboard', false],
  ['/contratos', false],
  ['/finanzas', false],
  ['/superadmin', false],
  ['/admin', false],
  ['/admin-occupancy', false],
  ['/admin-occ-legacy/dashboard', false],
  ['/Admin-Occ/dashboard', false],
  ['/portal/admin-occ/dashboard', false],
];

const attributesOf = element => Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]));

// Parses a document the way the browser does: each script runs when the parser reaches it.
// The second script records what the page looks like when <head> ends.
function parseDocument(route, { beforeParse } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const { window } = new JSDOM(
    '<!DOCTYPE html><html lang="es" class="font-a font-b"><head>'
      + `<script nonce="request-nonce">${occThemeBootScript()}</script>`
      + '<script>window.atEndOfHead = { className: document.documentElement.className, bodyParsed: document.body !== null };</script>'
      + '</head><body><main role="status">Comprobando sesión…</main></body></html>',
    { url: `${ORIGIN}${route}`, runScripts: 'dangerously', virtualConsole, beforeParse },
  );
  return { window, html: window.document.documentElement, errors };
}

function sourceFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('OCC routes', () => {
  it('isOccPath accepts /admin-occ and its sub-routes, and the map lab, only', () => {
    for (const [route, occ] of ROUTES) {
      expect(isOccPath(new URL(route, ORIGIN).pathname), route).toBe(occ);
    }
    // usePathname can answer null, and nothing but a string is a path.
    for (const value of [null, undefined, '', 0, true, {}, ['/admin-occ']]) {
      expect(isOccPath(value), String(value)).toBe(false);
    }
  });

  it('uses the same prefix as the OCC navigation', () => {
    expect(OCC_PATH_PREFIX).toBe(ADMIN_OCC_BASE_PATH);
    expect(ADMIN_OCC_NAVIGATION.length).toBeGreaterThan(0);
    for (const { path } of ADMIN_OCC_NAVIGATION) expect(isOccPath(path), path).toBe(true);
    // Every OCC screen is a folder of app/admin-occ, so its URL starts with the prefix.
    expect(readdirSync(`app${OCC_PATH_PREFIX}`)).toContain('layout.jsx');
  });
});

describe('OCC boot script', () => {
  it('the boot script adds the dark class on OCC paths when nothing is stored and leaves every other path untouched', () => {
    for (const [route, occ] of ROUTES) {
      const { window, html, errors } = parseDocument(route);
      const className = occ ? 'font-a font-b dark' : 'font-a font-b';

      expect(isOccPath(window.location.pathname), route).toBe(occ);
      expect(errors, route).toEqual([]);
      // Only the class changes, and only on OCC paths: no other attribute, no inline style.
      expect(attributesOf(html), route).toEqual({ lang: 'es', class: className });
      // The class is already there when <head> ends, before <body> exists: nothing was painted light.
      expect(window.atEndOfHead, route).toEqual({ className, bodyParsed: false });
      window.close();
    }
  });

  it('the boot script applies the stored theme on OCC paths before <body> exists', () => {
    for (const [stored, dark] of [['light', false], ['dark', true], ['sepia', true]]) {
      for (const [route, occ] of ROUTES) {
        const { window, html, errors } = parseDocument(route, {
          beforeParse(page) { page.localStorage.setItem('elevant-theme', stored); },
        });
        const className = occ && dark ? 'font-a font-b dark' : 'font-a font-b';

        expect(errors, `${route} ${stored}`).toEqual([]);
        expect(attributesOf(html), `${route} ${stored}`).toEqual({ lang: 'es', class: className });
        expect(window.atEndOfHead, `${route} ${stored}`).toEqual({ className, bodyParsed: false });
        window.close();
      }
    }
  });

  it('the boot script falls back to dark when storage is blocked and cannot close its script tag', () => {
    const script = occThemeBootScript();
    // One line of printable ASCII without `<`: nothing in it can end the element or open an HTML comment.
    expect(script).toMatch(/^[ -~]+$/);
    expect(script).not.toContain('<');
    expect(script).not.toMatch(/sessionStorage|cookie|indexeddb/i);

    const { window, html, errors } = parseDocument('/admin-occ/dashboard', {
      beforeParse(page) {
        Object.defineProperty(page, 'localStorage', {
          configurable: true,
          get() { throw new Error('localStorage is blocked'); },
        });
      },
    });

    expect(errors).toEqual([]);
    expect(html.classList.contains('dark')).toBe(true);
    window.close();
  });

  it('the root layout renders the boot script with the request nonce and suppresses the html hydration warning', () => {
    const layout = readFileSync('app/layout.jsx', 'utf8');

    expect(layout).toMatch(/import \{ headers \} from 'next\/headers'/);
    expect(layout).toMatch(/\(await headers\(\)\)\.get\('x-nonce'\)/);
    expect(layout).toMatch(/<html\b[^>]*\ssuppressHydrationWarning[\s>]/);
    expect(layout).toMatch(/<script\b[^>]*\snonce=\{nonce\}/);
    expect(layout).toMatch(/__html:\s*occThemeBootScript\(\)/);
    // The script sits in <head>, ahead of <body>, so it runs before anything is painted.
    expect(layout).toMatch(/<head>\s*<script\b[\s\S]*?\/>\s*<\/head>\s*<body>/);
    // It stays under the nonce policy: no second inline script and no relaxed policy.
    expect(layout.match(/<script\b/g)).toHaveLength(1);
    expect(layout).not.toMatch(/unsafe-inline/);
    // The delivery check reads the same file for the brand icon.
    expect(layout).toMatch(/elevant-logo\.png/);
  });
});

describe('OCC maps', () => {
  it('no OCC screen wires a map to a fixed theme', () => {
    // The screens the visual lane owns, plus Planning. Their maps follow the shell theme (light or dark).
    const planningMap = join('src', 'features', 'planning', 'components', 'PlanningMap.jsx');
    const files = ['admin-occ', 'dashboard', 'flight-monitoring', 'planning', 'positions-map']
      .flatMap(name => sourceFiles(join('src', 'features', name)));
    expect(files).toContain(planningMap);

    // A theme written as a literal in JSX: `theme="light"`, `theme={'light'}`.
    const literalTheme = /(?<![\w-])theme=(?:\{\s*)?(['"`])([^'"`]*)\1/g;
    const literals = files.flatMap(file => [...readFileSync(file, 'utf8').matchAll(literalTheme)]
      .map(match => `${file}: ${match[2]}`));
    expect(literals).toEqual([]);
  });
});
