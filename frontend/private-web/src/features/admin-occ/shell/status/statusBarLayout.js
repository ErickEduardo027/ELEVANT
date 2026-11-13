import { BREAKPOINTS } from '../../../../config/breakpoints';

// Where each element of the OCC status bar shows (design C.3, without the theme button, wall mode and search), in one
// pure map: the bar's components take their classes from here, and statusBarLayout.test.js checks that the classes
// say what the widths say. jsdom applies no CSS, so the rules are tested on this map and not on the rendered bar.
//
// Two rules are narrower than C.3, because the bar has to fit beside the rail (248 px expanded from 1024 px, 72 px
// from 640 px, none below): the sources keep their word only from 1280 px, since between 1024 and 1279 px the
// expanded rail leaves too little room for it and the module name; and below 640 px the alerts show their glyph and
// count, so that the bar fits a 320 px phone.
//
// Widths are in px, from src/config/breakpoints.js (the same numbers as Tailwind's screens):
// - `from`: the narrowest width at which the element shows in the bar (0: always);
// - `until`: it shows only below this width;
// - `fullFrom`: below this width it shows reduced, as its glyph alone (its word stays for screen readers);
// - `menuBelow`: below this width it moves into the account menu.
// `bar` is the element's class in the bar, `label` the class of its word, `menu` its class inside the account menu.
// They are literal strings so that Tailwind finds and generates them.

const rule = fields => Object.freeze({ from: 0, until: null, fullFrom: null, menuBelow: null, bar: '', label: '',
  menu: '', ...fields });

export const STATUS_BAR_LAYOUT = Object.freeze({
  menu: rule({ until: BREAKPOINTS.sm, bar: 'sm:hidden' }),
  station: rule({}),
  stationCity: rule({ from: BREAKPOINTS.xl, bar: 'hidden xl:inline' }),
  module: rule({ from: BREAKPOINTS.sm, bar: 'hidden sm:block' }),
  live: rule({ fullFrom: BREAKPOINTS.sm, label: 'sr-only sm:not-sr-only' }),
  sources: rule({ from: BREAKPOINTS.sm, fullFrom: BREAKPOINTS.xl, bar: 'hidden sm:flex', label: 'sr-only xl:not-sr-only' }),
  alerts: rule({ fullFrom: BREAKPOINTS.sm, label: 'sr-only sm:not-sr-only' }),
  localClock: rule({}),
  utcClock: rule({ from: BREAKPOINTS.lg, bar: 'hidden lg:flex' }),
  language: rule({ from: BREAKPOINTS.lg, menuBelow: BREAKPOINTS.lg, bar: 'hidden lg:flex', menu: 'lg:hidden' }),
  legend: rule({ from: BREAKPOINTS.lg, menuBelow: BREAKPOINTS.lg, bar: 'hidden lg:flex', menu: 'lg:hidden' }),
  account: rule({}),
});

/**
 * What the bar shows at `width` px: `bar` maps each element it shows to `full` or `reduced` (its glyph alone), in the
 * bar's order; `menu` lists the elements that moved into the account menu.
 */
export function statusBarAt(width) {
  const bar = {};
  const menu = [];
  for (const [element, { from, until, fullFrom, menuBelow }] of Object.entries(STATUS_BAR_LAYOUT)) {
    if (menuBelow !== null && width < menuBelow) menu.push(element);
    else if (width >= from && (until === null || width < until)) {
      bar[element] = fullFrom !== null && width < fullFrom ? 'reduced' : 'full';
    }
  }
  return { bar, menu };
}

/**
 * The look every control of the bar shares: 36 px high, and at least 44 by 44 px on a touch screen (design H.2), a
 * 4 px radius, no hue at rest. Its words never wrap: when the bar runs short, the module name gives way first.
 */
export const STATUS_CONTROL = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded '
  + 'px-2 text-sm font-medium text-occ-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11';

/** The same 44 px minimum for the bar's smaller controls on a touch screen. */
export const COARSE_TARGET = '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11';

/** A control at rest lights only under the pointer. */
export const STATUS_CONTROL_REST = 'hover:bg-occ-panel-raised';

/** Only a state that asks for attention or is urgent gets a container (design B.4), and keeps it under the pointer. */
export const STATUS_TONE = Object.freeze({ attention: 'bg-occ-warn-soft', urgent: 'bg-occ-danger-soft' });
