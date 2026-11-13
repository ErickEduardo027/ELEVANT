import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headers } from 'next/headers';
import { occThemeBootScript } from '../src/features/shell/occTheme';
import RootLayout, { metadata } from './layout';

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/font/google', () => ({
  Manrope: () => ({ variable: 'font-manrope' }),
  IBM_Plex_Mono: () => ({ variable: 'font-plex-mono' }),
}));
// The providers need a browser session; these tests are about the document around them.
vi.mock('./providers', () => ({ default: ({ children }) => children }));

const NONCE = 'cmVxdWVzdC1ub25jZQ==';

// Renders the server layout as the document a browser receives for one request.
async function renderDocument(requestHeaders) {
  headers.mockResolvedValue(new Headers(requestHeaders));
  const element = await RootLayout({ children: <p>Pantalla</p> });
  return { element, markup: `<!DOCTYPE html>${renderToStaticMarkup(element)}` };
}

// Opens that document at a URL and lets its inline scripts run, as a first load does.
function load(markup, path) {
  const { window } = new JSDOM(markup, { url: `https://aviam.elevant.test${path}`, runScripts: 'dangerously' });
  return window;
}

afterEach(() => vi.clearAllMocks());

describe('root layout', () => {
  it('puts the boot script in <head> with the nonce of the request', async () => {
    const { element, markup } = await renderDocument({ 'x-nonce': NONCE });
    const { document } = new JSDOM(markup).window;

    const scripts = [...document.querySelectorAll('script')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].parentElement).toBe(document.head);
    expect(scripts[0].getAttribute('nonce')).toBe(NONCE);
    expect(scripts[0].hasAttribute('src')).toBe(false);
    expect(scripts[0].textContent).toBe(occThemeBootScript());
    expect(document.body.textContent).toContain('Pantalla');

    // The server never renders the class itself: only the script adds it, so <html> must accept the difference.
    expect(element.type).toBe('html');
    expect(element.props.suppressHydrationWarning).toBe(true);
    expect(attributes(document.documentElement)).toEqual({ lang: 'es', class: 'font-manrope font-plex-mono' });
    expect(metadata.icons.icon).toBe('/brand/elevant-logo.png');
  });

  it('a first load is dark on an OCC route and unchanged on any other route', async () => {
    const { markup } = await renderDocument({ 'x-nonce': NONCE });

    for (const path of ['/admin-occ', '/admin-occ/dashboard', '/admin-occ/planning?stationId=1']) {
      const window = load(markup, path);
      expect(attributes(window.document.documentElement), path)
        .toEqual({ lang: 'es', class: 'font-manrope font-plex-mono dark' });
      window.close();
    }
    for (const path of ['/login', '/gestion-humana/dashboard', '/contratos', '/finanzas', '/superadmin', '/admin-occupancy']) {
      const window = load(markup, path);
      expect(attributes(window.document.documentElement), path)
        .toEqual({ lang: 'es', class: 'font-manrope font-plex-mono' });
      window.close();
    }
  });

  it('renders no nonce attribute when the request carries none, so the policy blocks the script', async () => {
    const { markup } = await renderDocument({});
    const script = new JSDOM(markup).window.document.querySelector('script');

    expect(script.hasAttribute('nonce')).toBe(false);
    expect(markup).not.toMatch(/nonce="(null|undefined)?"/);
  });
});

function attributes(element) {
  return Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]));
}
