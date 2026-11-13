import { describe, expect, it } from 'vitest';
import { BREAKPOINTS } from '../../../../config/breakpoints';
import { COARSE_TARGET, STATUS_BAR_LAYOUT, STATUS_CONTROL, STATUS_TONE, statusBarAt } from './statusBarLayout';

const ORDER = ['menu', 'station', 'stationCity', 'module', 'live', 'sources', 'alerts', 'localClock', 'utcClock',
  'language', 'legend', 'account'];

// The Tailwind screen that starts at a width (`sm` for 640).
const screenAt = px => Object.entries(BREAKPOINTS).find(([, value]) => value === px)?.[0];

describe('status bar layout', () => {
  it('lists the elements in the order of the bar', () => {
    expect(Object.keys(STATUS_BAR_LAYOUT)).toEqual(ORDER);
    expect(Object.isFrozen(STATUS_BAR_LAYOUT)).toBe(true);
    expect(Object.isFrozen(STATUS_BAR_LAYOUT.live)).toBe(true);
  });

  it('keeps menu, station, live glyph, alerts, local clock and account below 640 px', () => {
    for (const width of [320, 390, 639]) {
      // The live link and the alerts show their glyph (the alerts, also their count) and keep their words for screen
      // readers, so the bar fits a 320 px phone.
      expect(statusBarAt(width), `${width} px`).toEqual({
        bar: { menu: 'full', station: 'full', live: 'reduced', alerts: 'reduced', localClock: 'full', account: 'full' },
        menu: ['language', 'legend'],
      });
    }
  });

  it('moves legend and language into the account menu below 1024 px', () => {
    const tablet = {
      bar: { station: 'full', module: 'full', live: 'full', sources: 'reduced', alerts: 'full', localClock: 'full',
        account: 'full' },
      menu: ['language', 'legend'],
    };
    expect(statusBarAt(640)).toEqual(tablet);
    expect(statusBarAt(1023)).toEqual(tablet);
    // From 1024 px they are back in the bar, with the UTC clock.
    const desktop = {
      bar: { station: 'full', module: 'full', live: 'full', sources: 'reduced', alerts: 'full', localClock: 'full',
        utcClock: 'full', language: 'full', legend: 'full', account: 'full' },
      menu: [],
    };
    expect(statusBarAt(1024)).toEqual(desktop);
    expect(statusBarAt(1279)).toEqual(desktop);
  });

  it('gives the sources their word from 1280 px, where the expanded rail leaves room for it', () => {
    expect(statusBarAt(1279).bar.sources).toBe('reduced');
    expect(statusBarAt(1280).bar.sources).toBe('full');
    expect(STATUS_BAR_LAYOUT.sources.label).toBe('sr-only xl:not-sr-only');
  });

  it('adds Punta Cana next to the station plate from 1280 px', () => {
    expect(statusBarAt(1279).bar).not.toHaveProperty('stationCity');
    expect(statusBarAt(1280).bar).toHaveProperty('stationCity', 'full');
    // On a wide screen everything but the menu button shows in full, in the bar's order.
    const wide = statusBarAt(1920);
    expect(Object.keys(wide.bar)).toEqual(ORDER.filter(element => element !== 'menu'));
    expect(Object.values(wide.bar).every(form => form === 'full')).toBe(true);
    expect(wide.menu).toEqual([]);
  });

  it('writes in its classes the widths it states', () => {
    for (const [element, rule] of Object.entries(STATUS_BAR_LAYOUT)) {
      if (rule.from > 0) {
        expect(rule.bar, element).toMatch(new RegExp(`^hidden ${screenAt(rule.from)}:(?:flex|block|inline)$`));
      } else if (rule.until !== null) {
        expect(rule.bar, element).toBe(`${screenAt(rule.until)}:hidden`);
      } else {
        expect(rule.bar, element).toBe('');
      }
      // A reduced element keeps its word for screen readers: hidden on screen, never removed.
      expect(rule.label, element).toBe(rule.fullFrom === null ? '' : `sr-only ${screenAt(rule.fullFrom)}:not-sr-only`);
      expect(rule.menu, element).toBe(rule.menuBelow === null ? '' : `${screenAt(rule.menuBelow)}:hidden`);
    }
  });

  it('tints a control only for attention and urgent', () => {
    expect(STATUS_TONE).toEqual({ attention: 'bg-occ-warn-soft', urgent: 'bg-occ-danger-soft' });
  });

  it('makes every control at least 44 by 44 px on a touch screen', () => {
    for (const classes of [STATUS_CONTROL, COARSE_TARGET]) {
      expect(classes.split(/\s+/)).toEqual(expect.arrayContaining([
        '[@media(pointer:coarse)]:h-11', '[@media(pointer:coarse)]:min-w-11',
      ]));
    }
    // 36 px high with a mouse, never a hue at rest, and words that never wrap inside the 48 px bar.
    expect(STATUS_CONTROL.split(/\s+/)).toEqual(expect.arrayContaining(['h-9', 'shrink-0', 'whitespace-nowrap']));
    expect(STATUS_CONTROL).not.toMatch(/bg-occ-/);
  });
});
