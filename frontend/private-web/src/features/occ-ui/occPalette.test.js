import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../../tailwind.config.js';
import { OCC_PALETTE, occColor } from './occPalette';

const OCC_SCOPE = "[data-department='occ']";

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The innermost rules of a stylesheet, including the ones inside media queries.
function parseRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim().replace(/\s+/g, ' '),
    declarations: body.split(';').map(text => text.trim()).filter(Boolean).map(text => {
      const colon = text.indexOf(':');
      return [text.slice(0, colon).trim(), text.slice(colon + 1).trim()];
    }),
  }));
}

const customProperties = rule => rule.declarations.filter(([property]) => property.startsWith('--occ-'));
const isColour = value => /^#[0-9a-f]{6}$/.test(value) || /^rgb\([\d\s./]+\)$/.test(value);
const aliasTarget = value => /^var\((--occ-[a-z0-9-]+)\)$/.exec(value)?.[1] ?? null;

const occCss = stripComments(readFileSync('src/styles/occ.css', 'utf8'));
const rules = parseRules(occCss);
const scopeRules = rules.filter(rule => rule.selector === OCC_SCOPE);
const tokens = new Map(scopeRules.flatMap(customProperties));
const colourTokens = new Map([...tokens].filter(([, value]) => isColour(value)));
const aliases = new Map([...tokens]
  .filter(([, value]) => aliasTarget(value) !== null)
  .map(([name, value]) => [name, aliasTarget(value)]));

// WCAG 2 contrast ratio between two opaque colours, each given as [red, green, blue].
function channels(colour) {
  const hex = /^#([0-9a-f]{6})$/.exec(colour)[1];
  return [0, 2, 4].map(start => Number.parseInt(hex.slice(start, start + 2), 16));
}

function luminance(rgb) {
  const [red, green, blue] = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

const tokenContrast = (foreground, background) =>
  contrast(channels(OCC_PALETTE[foreground]), channels(OCC_PALETTE[background]));

describe('OCC palette', () => {
  it('holds every colour token of occ.css with the same value', () => {
    expect(colourTokens.size).toBeGreaterThan(0);
    for (const [name, value] of colourTokens) expect(OCC_PALETTE[name], name).toBe(value);
  });

  it('has no key that occ.css does not define', () => {
    expect(Object.keys(OCC_PALETTE).filter(name => !colourTokens.has(name))).toEqual([]);
    expect(Object.isFrozen(OCC_PALETTE)).toBe(true);
  });

  it('matches the sixteen values of the contracts page', () => {
    const contract = {
      '--occ-nav': '#0F161A', '--occ-line': '#394348',
      '--occ-canvas': '#161E22', '--occ-line-strong': '#768289',
      '--occ-panel': '#20282D', '--occ-muted': '#BCC8CE',
      '--occ-panel-raised': '#2A3439', '--occ-faint': '#95A2A9',
      '--occ-text': '#E8EEF1', '--occ-accent': '#6FD4F5',
      '--occ-warn': '#FDC14F', '--occ-danger': '#F5746D',
      '--occ-warn-soft': '#434032', '--occ-danger-soft': '#423437',
      '--occ-accent-soft': '#2D444D', '--occ-panel-float': 'rgb(32 40 45 / 0.94)',
    };
    expect(Object.keys(contract)).toHaveLength(16);
    for (const [name, value] of Object.entries(contract)) expect(OCC_PALETTE[name], name).toBe(value.toLowerCase());
  });

  it('occColor resolves short and full names and rejects unknown tokens', () => {
    expect(occColor('accent')).toBe('#6fd4f5');
    expect(occColor('--occ-accent')).toBe('#6fd4f5');
    expect(occColor('panel-raised')).toBe(OCC_PALETTE['--occ-panel-raised']);
    // An alias and a radius are not colours of the palette, and `signal` no longer exists.
    for (const unknown of ['signal', 'ok', '--occ-panel-muted', 'radius-panel', 'toString', '', undefined, null]) {
      expect(() => occColor(unknown), String(unknown)).toThrow(RangeError);
    }
  });

  it('keeps text, signals and control boundaries readable on every surface', () => {
    // Floors: 10:1 primary text, 7:1 secondary text, 4.5:1 any other text (WCAG AA), 3:1 control boundaries.
    const surfaces = ['--occ-panel', '--occ-panel-raised', '--occ-canvas', '--occ-field'];
    const onSurfaces = {
      '--occ-text': 10, '--occ-muted': 7, '--occ-faint': 4.5,
      '--occ-accent': 4.5, '--occ-warn': 4.5, '--occ-danger': 4.5, '--occ-line-strong': 3,
    };
    for (const [foreground, floor] of Object.entries(onSurfaces)) {
      for (const surface of surfaces) {
        expect(tokenContrast(foreground, surface), `${foreground} on ${surface}`).toBeGreaterThanOrEqual(floor);
      }
    }

    const onRail = { '--occ-nav-text': 7, '--occ-nav-muted': 4.5, '--occ-nav-accent': 4.5 };
    for (const [foreground, floor] of Object.entries(onRail)) {
      for (const surface of ['--occ-nav', '--occ-nav-hover', '--occ-nav-active']) {
        expect(tokenContrast(foreground, surface), `${foreground} on ${surface}`).toBeGreaterThanOrEqual(floor);
      }
    }

    // Ink on the light key, on the cyan fill and on the two alarm fills; text on the three tinted rows.
    const pairs = [
      ['--occ-on-primary', '--occ-primary', 4.5],
      ['--occ-on-primary', '--occ-primary-hover', 4.5],
      ['--occ-on-accent', '--occ-accent', 4.5],
      ['--occ-on-warn', '--occ-warn-fill', 4.5],
      ['--occ-on-danger', '--occ-danger-fill', 4.5],
      ['--occ-text', '--occ-accent-soft', 7],
      ['--occ-text', '--occ-warn-soft', 7],
      ['--occ-text', '--occ-danger-soft', 7],
    ];
    for (const [foreground, background, floor] of pairs) {
      expect(tokenContrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('keeps the floating panel near-opaque, so its text stays readable over any map', () => {
    const float = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(OCC_PALETTE['--occ-panel-float']);
    const [red, green, blue, alpha] = float.slice(1).map(Number);
    expect([red, green, blue]).toEqual(channels(OCC_PALETTE['--occ-panel']));
    expect(alpha).toBeGreaterThanOrEqual(0.9);

    // The worst case for light text: the panel floats over a white backdrop.
    const overWhite = [red, green, blue].map(channel => channel * alpha + 255 * (1 - alpha));
    const floors = { '--occ-text': 7, '--occ-muted': 4.5, '--occ-accent': 4.5, '--occ-warn': 4.5, '--occ-danger': 4.5 };
    for (const [foreground, floor] of Object.entries(floors)) {
      expect(contrast(channels(OCC_PALETTE[foreground]), overWhite), foreground).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe('occ.css tokens', () => {
  it('occ.css defines its tokens once on the OCC scope, without the dark class', () => {
    expect(scopeRules).toHaveLength(1);
    expect(new Map(scopeRules[0].declarations).get('color-scheme')).toBe('dark');
    expect(occCss).not.toMatch(/\.dark\b/);

    // No token is declared twice in the file, so no other rule (or theme) redefines one.
    const declared = rules.flatMap(customProperties).map(([name]) => name);
    expect(declared.filter((name, index) => declared.indexOf(name) !== index)).toEqual([]);
  });

  it('every alias in occ.css resolves to a defined token (ok, panel-muted and the six chat aliases)', () => {
    expect(Object.fromEntries(aliases)).toEqual({
      '--occ-ok': '--occ-text',
      '--occ-panel-muted': '--occ-panel-raised',
      '--occ-ui-soft': '--occ-panel-raised',
      '--occ-ui-line': '--occ-line',
      '--occ-ui-glass': '--occ-field',
      '--occ-ui-text': '--occ-text',
      '--occ-ui-solid': '--occ-panel',
      '--occ-ui-muted': '--occ-muted',
    });
    for (const [name, target] of aliases) expect(colourTokens.has(target), `${name} -> ${target}`).toBe(true);
  });

  it('defines every --occ variable that occ.css and the chat stylesheets read', () => {
    // The chat is why the `--occ-ui-*` aliases exist: when it has no stylesheet left, they go away with this check.
    const chat = 'src/features/chat';
    const chatStylesheets = readdirSync(chat).filter(name => name.endsWith('.css')).map(name => join(chat, name));
    expect(chatStylesheets.length).toBeGreaterThan(0);

    const missing = ['src/styles/occ.css', ...chatStylesheets].flatMap(file => {
      const css = stripComments(readFileSync(file, 'utf8'));
      const local = new Set(parseRules(css).flatMap(customProperties).map(([name]) => name));
      const read = new Set([...css.matchAll(/var\(\s*(--occ-[a-z0-9-]+)/g)].map(match => match[1]));
      return [...read].filter(name => !tokens.has(name) && !local.has(name)).map(name => `${file}: ${name}`);
    });
    expect(missing).toEqual([]);
  });

  it('every occ colour of tailwind.config.js reads a defined token, the five new keys exist and signal is gone', () => {
    const occColours = tailwindConfig.theme.extend.colors.occ;
    for (const [key, value] of Object.entries(occColours)) {
      expect(value, key).toBe(`var(--occ-${key})`);
      expect(tokens.has(`--occ-${key}`), key).toBe(true);
    }
    for (const key of ['panel-raised', 'panel-float', 'faint', 'warn-soft', 'danger-soft']) {
      expect(occColours).toHaveProperty([key]);
    }
    expect(occColours).not.toHaveProperty('signal');
    expect(tokens.has('--occ-signal')).toBe(false);
  });

  it('applies Manrope with weight 500 to the whole OCC scope', () => {
    const scope = new Map(scopeRules[0].declarations);
    expect(scope.get('font-family')).toMatch(/^var\(--font-manrope\),/);
    expect(scope.get('font-weight')).toBe('500');

    // The family used to be set on the dashboard only: no other rule may replace it, or go below weight 500.
    const others = rules.filter(rule => rule !== scopeRules[0]).flatMap(rule => rule.declarations);
    expect(others.filter(([property]) => property === 'font-family' || property === 'font')).toEqual([]);
    expect(others.filter(([property, value]) => property === 'font-weight' && !(Number(value) >= 500))).toEqual([]);

    // next/font publishes the family under that variable name on <html>.
    expect(readFileSync('app/layout.jsx', 'utf8')).toMatch(/variable:\s*['"]--font-manrope['"]/);
  });

  it('draws flat: occ.css has no gradient, blur or shadow', () => {
    expect(occCss).not.toMatch(/gradient\(/);
    expect(occCss).not.toMatch(/backdrop-filter/);
    const shadows = rules.flatMap(rule => rule.declarations).filter(([property]) => property === 'box-shadow');
    expect(shadows.filter(([, value]) => value !== 'none')).toEqual([]);
  });
});
