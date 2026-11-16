// The OCC has a light and a dark theme, dark by default (ADR-0044, 2026-11-15). This module holds what the server
// root layout and the client theme provider share, so it stays free of React: a module that creates a context cannot
// be imported from a Server Component.
export const OCC_PATH_PREFIX = '/admin-occ';

// The map lab of the OCC (development only) takes the OCC's theme too, so its maps look as the OCC's do.
export const OCC_LAB_PATH = '/map-lab';

// Where the account's own theme lives in the browser: the same key for every department.
export const THEME_STORAGE_KEY = 'elevant-theme';

// The theme of the OCC when the account has not chosen one.
export const OCC_DEFAULT_THEME = 'dark';

const underPath = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// True for the OCC root and every route below it, and for the OCC's map lab. A
// route that only starts with the same letters (`/admin-occupancy`) belongs to
// another department.
export function isOccPath(pathname) {
  return typeof pathname === 'string'
    && (underPath(pathname, OCC_PATH_PREFIX) || underPath(pathname, OCC_LAB_PATH));
}

// Source of the inline script that app/layout.jsx renders in <head> with the
// request nonce. The browser runs it while it parses the document, before the
// first paint and before React hydrates, so an OCC route shows the stored theme
// (dark when none is stored) from its first frame. It reads the path and the
// stored theme only; a browser that refuses storage gets the dark default. Every
// other path is left untouched. ThemeProvider applies the same rule after
// hydration and on client navigation.
export function occThemeBootScript() {
  return `(function(){try{var p=location.pathname,m=function(x){return p===x||p.indexOf(x+'/')===0};if(!m('${OCC_PATH_PREFIX}')&&!m('${OCC_LAB_PATH}'))return;var s=null;try{s=window.localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}document.documentElement.classList.toggle('dark',s!=='light')}catch(e){}})()`;
}
