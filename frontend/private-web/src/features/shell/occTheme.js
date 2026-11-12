// The OCC is dark only. This module holds what the server root layout and the
// client theme provider share, so it stays free of React: a module that
// creates a context cannot be imported from a Server Component.
export const OCC_PATH_PREFIX = '/admin-occ';

// True for the OCC root and every route below it. A route that only starts
// with the same letters (`/admin-occupancy`) belongs to another department.
export function isOccPath(pathname) {
  return typeof pathname === 'string'
    && (pathname === OCC_PATH_PREFIX || pathname.startsWith(`${OCC_PATH_PREFIX}/`));
}

// Source of the inline script that app/layout.jsx renders in <head> with the
// request nonce. The browser runs it while it parses the document, before the
// first paint and before React hydrates, so an OCC route never shows a light
// frame. It only reads the path: it touches no storage and sets nothing else.
// ThemeProvider applies the same rule after hydration and on client navigation.
export function occThemeBootScript() {
  return `(function(){try{var p=location.pathname;if(p==='${OCC_PATH_PREFIX}'||p.indexOf('${OCC_PATH_PREFIX}/')===0)document.documentElement.classList.add('dark')}catch(e){}})()`;
}
