import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import postcss from 'postcss';
import { createElement } from 'react';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';
import { OCC_ROW_TONES } from '../features/occ-ui/OccDataTable';
import { OCC_PALETTES, OCC_THEMES } from '../features/occ-ui/occPalette';
import FlightCard from '../features/planning/components/FlightCard';
import { createPlanningFlight } from '../features/planning/testing/planningFixtures';
import { bridgeSelector, findLegacyColourClasses, generateOccLegacyBridgeCss } from './occLegacyBridge';
import {
  MIGRATED_FILES, MIGRATED_FOLDERS, OCC_BRIDGE_DEFAULTS, OCC_BRIDGE_SCOPE, OCC_BRIDGE_UNMAPPED, OCC_LEGACY_BRIDGE,
} from './occLegacyBridgeMap';
import { globalStylesheets, occMountedFiles, readSource, sourceFilesUnder } from './occSourceScan';

const BRIDGE_CSS = 'src/styles/occ-legacy-bridge.css';
// The OCC boot screen (U4): it renders outside ShellFrame and paints only with the tokens of the scope it carries.
const BOOT_FOLDER = 'src/features/admin-occ/boot';
// The OCC screens U6 rebuilt with occ-ui, one per step, and then those of U5: they draw as occ-ui does (contratos 2.4).
// Each also enters MIGRATED_FOLDERS, which forbids its legacy colour classes; a route rebuilt inside a folder other
// departments share enters MIGRATED_FILES instead.
const REBUILT_SCREEN_FOLDERS = Object.freeze([
  'src/features/review', 'src/features/position-coverage', 'src/features/chat', 'src/features/master-data',
  'src/features/devices', 'src/features/ready-contracts', 'src/features/reports', 'src/features/flight-monitoring',
  'src/features/positions-map',
]);
const SCRIPT_FILE = /\.(?:js|jsx|mjs)$/;
const UPDATE_COMMAND = 'UPDATE_OCC_BRIDGE=1 npx vitest run --configLoader runner --config vitest.config.mjs '
  + 'src/styles/occStyleGuard.test.js';

// The files mounted under /admin-occ that draw a status stripe with an inline colour, and how to render each. Monitoreo
// de vuelos and Mapa de posiciones draw none since U5: their strips and their stand table are occ-ui's (OccFlightStrip,
// OccDataTable), which name the status in words.
const STRIPE_PAINTERS = {
  'src/features/planning/components/FlightCard.jsx': () => createElement(FlightCard, {
    flight: createPlanningFlight(), now: '2026-08-19T11:45:00-04:00', onSelect() {},
  }),
};

// Global stylesheets copy the classes of an @apply into their own selectors, out of the bridge's reach. Each of their
// rules that applies a legacy colour either never paints inside the OCC frame or has a rule in occ.css that repaints
// it there, inside the same at-rules.
const GLOBAL_LEGACY_RULES = {
  'src/styles/tokens.css': {
    body: { outside: 'the OCC frame covers the page with its own canvas and text (rootClassName of AdminOccLayout)' },
    '.table-stack tbody > tr': { repaintedBy: "[data-department='occ'] table.table-stack tbody > tr" },
    '.table-stack tbody > tr > td::before': {
      repaintedBy: "[data-department='occ'] table.table-stack tbody > tr > td::before",
    },
  },
};

// The chat's stylesheets (CSS Modules, which the bridge cannot reach): U6 rebuilt them on the OCC tokens, so they paint
// no colour of their own. The properties that carry a colour, and what such a value may hold besides a custom property:
// the keywords of a token-less paint and the system colours of forced-colours mode.
const CHAT_FOLDER = 'src/features/chat';
const COLOUR_PROPERTY = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|inline|block))?-color|outline-color|fill|stroke|scrollbar-color|caret-color|accent-color|--[\w-]*surface)$/;
const COLOUR_KEYWORDS = new Set(['transparent', 'currentColor', 'currentcolor', 'none', 'inherit', 'Canvas', 'CanvasText',
  'Field', 'FieldText']);
// The radius of each role (contratos 2.4): plates 2 px, controls 4 px, panels and bubbles 6 px, overlays 8 px.
const RADIUS_TOKENS = new Set(['var(--occ-radius-plate)', 'var(--occ-radius-control)', 'var(--occ-radius-panel)',
  'var(--occ-radius-overlay)']);

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// A script without its comments: block and JSX comments, then line comments (a `//` after a colon is a URL).
const stripScriptComments = source => stripComments(source).replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

// What occ-ui never draws (contratos 2.4): a shadow, an upper-case or tracked label, text under 12 px, or a colour of
// its own. occPalette.js is where the literal colours of the OCC live for JavaScript, so it may hold colours.
const OCC_UI_STYLE_RULES = Object.freeze([
  { what: 'shadow', pattern: /(?<!\w)(?:[\w-]+:)*(?:drop-|box-|text-)?shadow(?:-[\w[\]/.#-]+)?(?![\w-])|boxShadow|textShadow/g },
  { what: 'upper case', pattern: /(?<!\w)(?:[\w-]+:)*uppercase(?![\w-])|text-transform|textTransform/g },
  { what: 'tracking', pattern: /(?<!\w)(?:[\w-]+:)*tracking-[\w[\].-]+|letter-spacing|letterSpacing/g },
  {
    what: 'text under 12 px',
    pattern: /(?<!\w)(?:[\w-]+:)*text-\[(\d*\.?\d+)(px|rem|em)\]|fontSize:\s*['"]?(\d*\.?\d+)(px|rem|em)?/g,
    bites: match => {
      const unit = match[2] ?? match[4] ?? 'px';
      return Number(match[1] ?? match[3]) * (unit === 'px' ? 1 : 16) < 12;
    },
  },
  { what: 'colour', colour: true, pattern: /(?<![&\w])#[\da-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color-mix)\(/g },
]);

// The style findings of a script's code, as `what: text`, in the order of the rules.
function occUiStyleFindings(code, { colours = true } = {}) {
  return OCC_UI_STYLE_RULES.filter(rule => colours || !rule.colour).flatMap(rule => [...code.matchAll(rule.pattern)]
    .filter(match => rule.bites?.(match) ?? true)
    .map(match => `${rule.what}: ${match[0]}`));
}

// The innermost rules of a stylesheet, media queries included: their selectors and declarations.
function parseRules(css) {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, prelude, body]) => ({
    selectors: prelude.split(',').map(selector => selector.trim().replace(/\s+/g, ' ')),
    declarations: body.split(';').map(text => text.trim()).filter(Boolean).map(text => {
      const colon = text.indexOf(':');
      return [text.slice(0, colon).trim(), text.slice(colon + 1).trim()];
    }),
  }));
}

const readVariables = text => [...new Set([...text.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]))];
const declaredVariables = css => new Set(parseRules(css).flatMap(rule => rule.declarations)
  .map(([property]) => property).filter(property => property.startsWith('--')));

// The tokens every element of the OCC frame inherits: the custom properties of the [data-department='occ'] rule.
const occCss = readSource('src/styles/occ.css');
const occScopeTokens = new Set(parseRules(occCss)
  .filter(rule => rule.selectors.length === 1 && rule.selectors[0] === "[data-department='occ']")
  .flatMap(rule => rule.declarations).map(([property]) => property).filter(property => property.startsWith('--occ-')));
// next/font publishes these on <html>.
const fontVariables = new Set([...readSource('app/layout.jsx').matchAll(/variable:\s*['"](--[\w-]+)['"]/g)].map(match => match[1]));

const mappedClasses = new Map(OCC_LEGACY_BRIDGE.flatMap(entry => entry.classes.map(className => [className, entry.id])));

// WCAG 2 contrast ratio between two opaque palette colours.
function luminance(hex) {
  const [red, green, blue] = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
function contrast(foreground, background, theme = 'dark') {
  const palette = OCC_PALETTES[theme];
  const [lighter, darker] = [luminance(palette[foreground]), luminance(palette[background])].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// Specificity [ids, classes, types] of the selector shapes Tailwind and the bridge write. Escaped characters belong to
// a name; :where() weighs nothing; :is() and :not() weigh their heaviest argument.
function specificity(selector) {
  const total = [0, 0, 0];
  const add = weight => weight.forEach((value, index) => { total[index] += value; });
  let text = selector.replace(/\\[0-9a-f]{1,6} ?|\\./gi, 'x');
  text = text.replace(/:(where|is|not)\(([^()]*)\)/g, (match, name, list) => {
    if (name !== 'where') add(list.split(',').map(specificity).sort(compareSpecificity).at(-1));
    return '';
  });
  const pseudoElements = text.match(/::[\w-]+/g) ?? [];
  text = text.replace(/::[\w-]+/g, '');
  add([
    (text.match(/#[\w-]+/g) ?? []).length,
    (text.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length,
    (text.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length + pseudoElements.length,
  ]);
  return total;
}
function compareSpecificity(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

// The Tailwind CSS of the classes the bridge repaints, generated with the project's own configuration.
let tailwindUtilities;
function generateTailwindUtilities() {
  tailwindUtilities ??= postcss([tailwindcss({
    ...tailwindConfig,
    content: [{ raw: [...mappedClasses.keys(), 'ring-2', 'focus-visible:ring-2'].join(' '), extension: 'html' }],
    corePlugins: { preflight: false },
  })]).process('@tailwind utilities;', { from: undefined }).then(result => result.root);
  return tailwindUtilities;
}

// A Tailwind colour utility on an OCC colour (`bg-occ-panel`, `divide-occ-line`): the utility alone, without the variant
// before it or the opacity modifier after it, which the bridge and the occ-ui guard handle. A name put together at run
// time (`'bg-occ-' + tone`) is not matched: Tailwind cannot read it either. The prefixes are regular expression parts.
const COLOUR_UTILITIES = [
  'bg', 'text', 'border', 'border-[xysetrbl]', 'divide', 'outline', 'ring', 'ring-offset', 'fill', 'stroke',
  'from', 'via', 'to', 'placeholder', 'caret', 'accent', 'decoration', 'shadow',
];
const OCC_COLOUR_CLASS = new RegExp(`(?<![\\w-])(?:${COLOUR_UTILITIES.join('|')})-occ-[a-z0-9]+(?:-[a-z0-9]+)*(?![\\w-])`, 'g');

// The plain utilities (no variant, no modifier) for which Tailwind, with the project's configuration, writes no rule.
async function utilitiesWithoutCss(classes) {
  const root = await postcss([tailwindcss({
    ...tailwindConfig,
    content: [{ raw: classes.join(' '), extension: 'html' }],
    corePlugins: { preflight: false },
  })]).process('@tailwind utilities;', { from: undefined }).then(result => result.root);
  const generated = new Set();
  root.walkRules(rule => rule.selectors.forEach(selector => generated.add(/^\.([\w-]+)/.exec(selector)?.[1])));
  return classes.filter(className => !generated.has(className));
}

// The legacy colour classes of the script files under some folders, as `file: class`.
const legacyClassesIn = files => files.filter(file => SCRIPT_FILE.test(file))
  .flatMap(file => findLegacyColourClasses(readSource(file)).map(className => `${file}: ${className}`));

// The rules of a stylesheet that @apply a legacy colour class: the rule, its selector and those classes.
function legacyApplyRules(css) {
  const found = [];
  postcss.parse(css).walkAtRules('apply', apply => {
    const classes = findLegacyColourClasses(apply.params);
    if (classes.length === 0) return;
    found.push({ rule: apply.parent, selector: apply.parent.selector.replace(/\s+/g, ' '), classes });
  });
  return found;
}

// The at-rules around a rule, outermost first. Tailwind's @layer compiles away, so it does not count.
function atRulesAround(node) {
  const atRules = [];
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name !== 'layer') atRules.unshift(`@${parent.name} ${parent.params}`);
  }
  return atRules;
}

// A global stylesheet as Tailwind compiles it; its own text is the content, so its component rules are kept.
function compileStylesheet(file) {
  const css = readSource(file);
  return postcss([tailwindcss({
    ...tailwindConfig,
    content: [{ raw: css, extension: 'html' }],
    corePlugins: { preflight: false },
  })]).process(css, { from: undefined }).then(result => result.root);
}

const declarationsOf = className => OCC_LEGACY_BRIDGE.find(entry => entry.classes.includes(className))?.declarations;

describe('OCC legacy bridge', () => {
  it('keeps the committed bridge in sync with its manifest', () => {
    const expected = generateOccLegacyBridgeCss();
    if (process.env.UPDATE_OCC_BRIDGE === '1') writeFileSync(BRIDGE_CSS, expected);
    const committed = readSource(BRIDGE_CSS).replace(/\r\n/g, '\n');
    expect(committed, `${BRIDGE_CSS} is out of date: run ${UPDATE_COMMAND}`).toBe(expected);
  });

  it('every rule of the bridge is scoped to the OCC shell attribute', () => {
    const css = readSource(BRIDGE_CSS);
    const rules = parseRules(css);
    expect(rules.length).toBeGreaterThan(OCC_LEGACY_BRIDGE.length);
    for (const selector of rules.flatMap(rule => rule.selectors)) {
      expect(
        selector.startsWith(`${OCC_BRIDGE_SCOPE} `) || selector.startsWith(`:where(${OCC_BRIDGE_SCOPE}) `),
        selector,
      ).toBe(true);
    }
    // Nothing that could reach another origin; media queries are the only at-rule.
    expect(stripComments(css)).not.toMatch(/url\(/);
    for (const atRule of stripComments(css).match(/@[a-z-]+/g) ?? []) expect(atRule).toBe('@media');

    // !important only where an inline style has to be beaten: the whole rule of an important entry, which names plain
    // selectors and no class, so it never outweighs a class rule of the bridge.
    const important = OCC_LEGACY_BRIDGE.filter(entry => entry.important);
    expect(important.map(entry => entry.id)).toEqual(['status-stripe']);
    for (const entry of important) {
      expect([entry.classes, entry.inside ?? [], entry.pairs ?? []], entry.id).toEqual([[], [], []]);
    }
    const importantSelectors = new Set(important.flatMap(entry => entry.selectors.map(selector => `${OCC_BRIDGE_SCOPE} ${selector}`)));
    for (const rule of rules) {
      const flagged = rule.declarations.filter(([, value]) => /!important$/.test(value)).length;
      const expected = rule.selectors.every(selector => importantSelectors.has(selector)) ? rule.declarations.length : 0;
      expect(flagged, rule.selectors.join(', ')).toBe(expected);
    }
    expect(stripComments(css).match(/!important/g))
      .toHaveLength(important.flatMap(entry => Object.keys(entry.declarations)).length);
  });

  it('every bridge selector selects its class inside the OCC shell and nothing outside it', () => {
    document.body.innerHTML = '<div data-department="occ" data-occ-bridge=""><section></section></div>'
      + '<div data-department="occ"><section></section></div>';
    const [inside, switchedOff] = document.querySelectorAll('section');
    for (const className of mappedClasses.keys()) {
      const { selector } = bridgeSelector(className);
      // At rest: the state a pseudo-class asks for cannot be produced in jsdom, the attribute one can.
      const atRest = `${OCC_BRIDGE_SCOPE} ${selector.replace(/(?<!\\):(?:hover|focus-visible|focus|read-only|disabled)$/, '')}`;
      const element = document.createElement('div');
      element.className = className;
      element.setAttribute('aria-current', 'true');
      element.innerHTML = '<p></p><p></p>';
      const target = className.split(':').at(-1).startsWith('divide-') ? element.lastElementChild : element;

      inside.replaceChildren(element);
      expect(target.matches(atRest), `${className} inside the shell`).toBe(true);
      switchedOff.replaceChildren(element);
      expect(target.matches(atRest), `${className} without data-occ-bridge`).toBe(false);
    }
    const plain = document.createElement('span');
    inside.replaceChildren(plain);
    expect(plain.matches(`:where(${OCC_BRIDGE_SCOPE}) *`)).toBe(true);
    switchedOff.replaceChildren(plain);
    expect(plain.matches(`:where(${OCC_BRIDGE_SCOPE}) *`)).toBe(false);

    // The plain selectors: an invalid text field, not an invalid checkbox.
    const invalid = OCC_LEGACY_BRIDGE.find(entry => entry.id === 'invalid-field').selectors
      .map(selector => `${OCC_BRIDGE_SCOPE} ${selector}`).join(', ');
    inside.innerHTML = '<input aria-invalid="true"><input type="checkbox" aria-invalid="true"><input>';
    expect([...inside.children].map(field => field.matches(invalid))).toEqual([true, false, false]);
    switchedOff.innerHTML = '<input aria-invalid="true">';
    expect(switchedOff.firstElementChild.matches(invalid)).toBe(false);
    document.body.replaceChildren();
  });

  it('turns the inline status stripe of the OCC cards and rows into a joint', () => {
    const stripe = OCC_LEGACY_BRIDGE.find(entry => entry.id === 'status-stripe');
    expect(stripe).toMatchObject({ declarations: { 'border-left-color': 'var(--occ-line)' }, classes: [], important: true });
    const selector = stripe.selectors.map(item => `${OCC_BRIDGE_SCOPE} ${item}`).join(', ');

    // Every file mounted under /admin-occ that draws a stripe inline is rendered below.
    const painters = occMountedFiles().filter(file => SCRIPT_FILE.test(file) && /\bborderLeftColor\b/.test(readSource(file)));
    expect(painters).toEqual(Object.keys(STRIPE_PAINTERS).sort());

    // Its element, the one with the inline colour, is selected inside the shell and not once the bridge is off.
    document.body.innerHTML = '<div data-department="occ" data-occ-bridge=""><section></section></div>'
      + '<div data-department="occ"><section></section></div>';
    const [inside, switchedOff] = document.querySelectorAll('section');
    for (const [file, element] of Object.entries(STRIPE_PAINTERS)) {
      const container = document.createElement('div');
      inside.replaceChildren(container);
      const view = render(element(), { container });
      const painted = [...container.querySelectorAll('[style]')].filter(node => node.style.borderLeftColor !== '');
      expect(painted, file).toHaveLength(1);
      expect(painted[0].matches(selector), file).toBe(true);
      switchedOff.replaceChildren(container);
      expect(painted[0].matches(selector), `${file} without data-occ-bridge`).toBe(false);
      view.unmount();
    }
    document.body.replaceChildren();
  });

  it('keeps the red border of an invalid field above every border class it repaints', () => {
    // The rule of app/globals.css that the bridge would otherwise cover, since both weigh three attributes or classes.
    const globalRule = parseRules(readSource('app/globals.css'))
      .find(rule => rule.declarations.some(([property]) => property === 'border-color'));
    expect(globalRule.selectors).toEqual(['[aria-invalid="true"]:not([type="checkbox"]):not([type="radio"])']);

    const invalidAt = OCC_LEGACY_BRIDGE.findIndex(entry => entry.id === 'invalid-field');
    const invalid = OCC_LEGACY_BRIDGE[invalidAt];
    expect(invalid.selectors).toEqual(globalRule.selectors);
    expect(invalid.declarations).toEqual({ 'border-color': 'var(--occ-danger)' });
    const weight = specificity(`${OCC_BRIDGE_SCOPE} ${invalid.selectors[0]}`);
    // Each border class weighs less, or as much (the divide rules) and comes earlier in the stylesheet.
    const borderRules = OCC_LEGACY_BRIDGE.flatMap((entry, index) => (
      index !== invalidAt && Object.hasOwn(entry.declarations, 'border-color')
        ? entry.classes.map(className => ({ className, index })) : []));
    expect(borderRules.length).toBeGreaterThan(40);
    for (const { className, index } of borderRules) {
      const order = compareSpecificity(weight, specificity(`${OCC_BRIDGE_SCOPE} ${bridgeSelector(className).selector}`));
      expect(order > 0 || (order === 0 && index < invalidAt), className).toBe(true);
    }
  });

  it('outranks the Tailwind utility of every class it repaints', async () => {
    const utilities = await generateTailwindUtilities();
    const escape = className => className.replace(/[^A-Za-z0-9_-]/g, character => `\\${character}`);
    let compared = 0;
    for (const className of mappedClasses.keys()) {
      const token = `.${escape(className)}`;
      const tailwindSelectors = [];
      utilities.walkRules(rule => {
        tailwindSelectors.push(...rule.selectors.filter(selector => selector.startsWith(token)
          && !/[A-Za-z0-9_-]/.test(selector.charAt(token.length))));
      });
      // Tailwind writes nothing for a colour its configuration lacks (accent-700, ink-600) or for an opacity on a var().
      if (tailwindSelectors.length === 0) continue;
      compared += 1;
      const tailwind = tailwindSelectors.map(specificity).sort(compareSpecificity).at(-1);
      const bridge = specificity(`${OCC_BRIDGE_SCOPE} ${bridgeSelector(className).selector}`);
      expect(compareSpecificity(bridge, tailwind), `${className}: bridge ${bridge} against Tailwind ${tailwind}`)
        .toBeGreaterThan(0);
    }
    expect(compared).toBeGreaterThan(mappedClasses.size - 10);
    // The reason the order of the stylesheets never matters: Tailwind's dark variant weighs two classes.
    expect(specificity('.dark\\:bg-white:is(.dark *)')).toEqual([0, 2, 0]);
    expect(specificity(`${OCC_BRIDGE_SCOPE} .dark\\:bg-white`)).toEqual([0, 3, 0]);
  });

  it('the OCC shell sets data-occ-bridge', () => {
    const layout = readSource('src/features/admin-occ/AdminOccLayout.jsx');
    const frame = /const OCC_FRAME = \{([\s\S]*?)\n\};/.exec(layout)?.[1] ?? '';
    expect(frame).toMatch(/department: 'occ'/);
    expect(frame).toMatch(/rootAttributes: \{ 'data-occ-bridge': '' \}/);
    // Every frame it hands to AppShell carries it: the console's (PR U3) is OCC_FRAME with its main filled.
    expect(layout).toMatch(/const OCC_CONSOLE_FRAME = \{ \.\.\.OCC_FRAME, mainVariant: 'fill' \};/);
    expect(layout).toMatch(/frameProps=\{pathname === OCC_CONSOLE_PATH \? OCC_CONSOLE_FRAME : OCC_FRAME\}/);
    // AppShell hands the frame props to ShellFrame, which spreads rootAttributes on its root (ShellFrame.test.jsx).
    expect(readSource('src/features/shell/AppShell.jsx')).toMatch(/<ShellFrame\s+\{\.\.\.frameProps\}/);
    expect(readSource('src/features/shell/ShellFrame.jsx')).toMatch(/\{\.\.\.rootAttributes\}/);
  });

  it('the root layout imports the bridge after the OCC tokens', () => {
    const stylesheets = [...readSource('app/layout.jsx').matchAll(/^import '([^']+\.css)';$/gm)].map(match => match[1]);
    expect(stylesheets.slice(-2)).toEqual(['../src/styles/occ.css', '../src/styles/occ-legacy-bridge.css']);
  });

  it('follows the OCC routes into every screen they mount and stops at the role switch', () => {
    const files = occMountedFiles();
    expect(files).toEqual(expect.arrayContaining([
      'app/admin-occ/layout.jsx',
      'src/features/admin-occ/AdminOccLayout.jsx',
      // Dynamic imports of the map screens, the shared page Usuarios, and the chat stylesheets.
      'src/features/flight-monitoring/FlightMonitoringRoute.jsx',
      'src/features/positions-map/PositionsMapRoute.jsx',
      'src/features/department-users/DepartmentUsersPage.jsx',
      'src/features/chat/ChatWorkspace.module.css',
      'src/app/RoleLayout.jsx',
    ]));
    // RoleLayout imports every department's shell, but under /admin-occ it mounts only AdminOccLayout.
    for (const shell of [
      'src/features/contracts/shell/ContractsShell.jsx', 'src/features/finance/shell/FinanceShell.jsx',
      'src/features/governance/GovernanceShell.jsx', 'src/features/human-resources/HumanResourcesLayout.jsx',
    ]) expect(files).not.toContain(shell);
    expect(files.filter(file => /\.test\.|\\|^[A-Za-z]:/.test(file))).toEqual([]);
  });

  it('the bridge maps every legacy colour class used in files mounted under /admin-occ', () => {
    const files = occMountedFiles();
    const unmapped = legacyClassesIn(files)
      .filter(found => {
        const className = found.slice(found.indexOf(': ') + 2);
        return !mappedClasses.has(className) && !Object.hasOwn(OCC_BRIDGE_UNMAPPED, className);
      });
    expect(unmapped, 'add these classes to src/styles/occLegacyBridgeMap.js').toEqual([]);
    expect(legacyClassesIn(files).length).toBeGreaterThan(100);
  });

  it('also reads the legacy colours that the global stylesheets copy through @apply', () => {
    const stylesheets = globalStylesheets();
    expect(stylesheets).toEqual(expect.arrayContaining([
      'src/styles/tokens.css', 'app/globals.css', 'src/styles/occ.css', 'src/styles/occ-legacy-bridge.css',
    ]));
    expect(stylesheets.filter(file => !/^(?:app|src)\//.test(file))).toEqual([]);
    // The stylesheets mounted under /admin-occ too: an @apply there would escape the bridge the same way.
    const files = [...new Set([...stylesheets, ...occMountedFiles().filter(file => file.endsWith('.css'))])];
    const found = files.flatMap(file => legacyApplyRules(readSource(file)).map(({ selector }) => `${file}: ${selector}`));
    const listed = Object.entries(GLOBAL_LEGACY_RULES)
      .flatMap(([file, rules]) => Object.keys(rules).map(selector => `${file}: ${selector}`));
    expect(found.sort(), 'list these rules in GLOBAL_LEGACY_RULES, with their repair in occ.css or a reason')
      .toEqual(listed.sort());
    for (const [selector, { outside, repaintedBy }] of Object.values(GLOBAL_LEGACY_RULES).flatMap(Object.entries)) {
      const valid = outside === undefined ? typeof repaintedBy === 'string' : outside.trim() !== '' && repaintedBy === undefined;
      expect(valid, selector).toBe(true);
    }
    // `body` never shows inside the frame: the OCC shell fills the viewport with its own canvas and text.
    expect(readSource('src/features/admin-occ/AdminOccLayout.jsx')).toMatch(/rootClassName: 'bg-occ-canvas text-occ-text'/);
    expect(readSource('src/features/shell/ShellFrame.jsx')).toMatch(/className=\{`flex h-dvh overflow-hidden \$\{rootClassName\}`\}/);
  });

  it('occ.css repaints the stacked table cards with tokens, above the rules Tailwind writes for them', async () => {
    const PAINT = new Set(['background-color', 'border-color', 'border-radius', 'color', '--tw-shadow', '--tw-shadow-colored']);
    const occRoot = postcss.parse(occCss);
    const repairs = [];
    for (const [file, rules] of Object.entries(GLOBAL_LEGACY_RULES)) {
      const source = legacyApplyRules(readSource(file));
      const compiled = await compileStylesheet(file);
      for (const [selector, { repaintedBy }] of Object.entries(rules)) {
        if (repaintedBy === undefined) continue;
        repairs.push(repaintedBy);
        let repair;
        occRoot.walkRules(rule => { if (rule.selector.replace(/\s+/g, ' ') === repaintedBy) repair = rule; });
        expect(repair, repaintedBy).toBeDefined();
        // In the same container query as the rule it repaints.
        const original = source.find(item => item.selector === selector).rule;
        expect(atRulesAround(repair), repaintedBy).toEqual(atRulesAround(original));
        expect(atRulesAround(repair)).toEqual(['@container (max-width: 39.98rem)']);

        // Heavier than every rule Tailwind writes from it, the dark variant included.
        const generated = [];
        compiled.walkRules(rule => {
          const plain = rule.selectors.map(item => item.replace(':is(.dark *)', '').replace(/\s+/g, ' '));
          if (plain.includes(selector)) generated.push(rule);
        });
        expect(generated.length, selector).toBeGreaterThanOrEqual(2);
        const heaviest = generated.flatMap(rule => rule.selectors).map(specificity).sort(compareSpecificity).at(-1);
        expect(compareSpecificity(specificity(repaintedBy), heaviest), `${repaintedBy} against ${heaviest}`).toBeGreaterThan(0);

        // It sets each colour, shadow and radius those rules set, with tokens of the OCC scope only.
        const declared = new Map(repair.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
        const painted = new Set(generated.flatMap(rule => rule.nodes)
          .filter(node => node.type === 'decl' && PAINT.has(node.prop)).map(node => node.prop));
        expect(painted.size, selector).toBeGreaterThan(0);
        expect([...painted].filter(property => !declared.has(property)), repaintedBy).toEqual([]);
        for (const value of declared.values()) {
          expect(readVariables(value).filter(name => !occScopeTokens.has(name)), value).toEqual([]);
        }
      }
    }
    expect(repairs).toHaveLength(2);

    // Each repair selects the row, or the cell of its ::before label, of a stacked table inside the OCC frame only.
    document.body.innerHTML = ['<div data-department="occ">', '<div>']
      .map(open => `${open}<table class="table-stack"><tbody><tr><td data-label="Vuelo">ZZ102</td></tr></tbody></table></div>`)
      .join('');
    const [insideOcc, outsideOcc] = document.querySelectorAll('table');
    for (const repair of repairs) {
      const label = repair.endsWith('::before');
      const atRest = repair.replace(/::before$/, '');
      expect(insideOcc.querySelector(label ? 'td' : 'tr').matches(atRest), repair).toBe(true);
      expect(outsideOcc.querySelector(label ? 'td' : 'tr').matches(atRest), `${repair} outside the OCC`).toBe(false);
    }
    document.body.replaceChildren();
  });

  it('the stacked table labels inside the OCC are 12 px sentence case without tracking', async () => {
    const LABEL = '.table-stack tbody > tr > td::before';
    const REPAIR = "[data-department='occ'] table.table-stack tbody > tr > td::before";
    const TYPE = ['font-size', 'line-height', 'font-weight', 'text-transform', 'letter-spacing'];
    // What tokens.css gives the label of a stacked cell, its dark variant included.
    const compiled = await compileStylesheet('src/styles/tokens.css');
    const global = new Map();
    compiled.walkRules(rule => {
      const plain = rule.selectors.map(item => item.replace(':is(.dark *)', '').replace(/\s+/g, ' '));
      if (plain.includes(LABEL)) rule.walkDecls(declaration => {
        if (TYPE.includes(declaration.prop)) global.set(declaration.prop, declaration.value);
      });
    });
    // The guard bites: outside the OCC the label is 11 px, upper case and tracked.
    expect(Object.fromEntries(global)).toMatchObject({ 'font-size': '11px', 'text-transform': 'uppercase' });
    expect(global.get('letter-spacing')).not.toBe('normal');

    // Inside the OCC, in the same container query and with more weight, every one of them is set again.
    let repair;
    postcss.parse(occCss).walkRules(rule => { if (rule.selector.replace(/\s+/g, ' ') === REPAIR) repair = rule; });
    expect(repair, REPAIR).toBeDefined();
    expect(atRulesAround(repair)).toEqual(['@container (max-width: 39.98rem)']);
    const declared = new Map(repair.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
    expect([...global.keys()].filter(property => !declared.has(property))).toEqual([]);
    expect(Object.fromEntries(TYPE.map(property => [property, declared.get(property)]))).toEqual({
      'font-size': '0.75rem', 'line-height': '1rem', 'font-weight': '500', 'text-transform': 'none',
      'letter-spacing': 'normal',
    });
    let heaviest = [0, 0, 0];
    compiled.walkRules(rule => {
      const plain = rule.selectors.map(item => item.replace(':is(.dark *)', '').replace(/\s+/g, ' '));
      if (plain.includes(LABEL)) {
        for (const weight of rule.selectors.map(specificity)) {
          if (compareSpecificity(weight, heaviest) > 0) heaviest = weight;
        }
      }
    });
    expect(compareSpecificity(specificity(REPAIR), heaviest)).toBeGreaterThan(0);
  });

  it('the stacked cards of OccDataTable keep their height, their alignment, their folded details and the signal of a lit row', async () => {
    const CARD = '.table-stack tbody > tr';
    const OCC_CARD = "[data-department='occ'] table.table-stack tbody > tr";
    const rules = new Map();
    postcss.parse(occCss).walkRules(rule => rules.set(rule.selector.replace(/\s+/g, ' '), rule));
    const declarationsAt = selector => Object.fromEntries((rules.get(selector)?.nodes ?? [])
      .filter(node => node.type === 'decl').map(node => [node.prop, node.value]));

    // tokens.css makes the card a block, with a weight that outweighs `[hidden]`: the rules below answer it.
    const compiled = await compileStylesheet('src/styles/tokens.css');
    let heaviest = [0, 0, 0];
    let display;
    compiled.walkRules(rule => {
      const plain = rule.selectors.map(item => item.replace(':is(.dark *)', '').replace(/\s+/g, ' '));
      if (!plain.includes(CARD)) return;
      rule.walkDecls('display', declaration => { display = declaration.value; });
      for (const weight of rule.selectors.map(specificity)) {
        if (compareSpecificity(weight, heaviest) > 0) heaviest = weight;
      }
    });
    expect(display).toBe('block');
    expect(compareSpecificity(heaviest, specificity('[hidden]'))).toBeGreaterThan(0);

    // A card grows with its content, whatever the row's own height, and starts every label and value at the left,
    // also in a column the table sets on the right.
    expect(declarationsAt(OCC_CARD).height).toBe('auto');
    const cell = `${OCC_CARD} > td`;
    expect(declarationsAt(cell)).toEqual({ 'text-align': 'start' });
    expect(atRulesAround(rules.get(cell))).toEqual(['@container (max-width: 39.98rem)']);
    expect(compareSpecificity(specificity(cell), specificity('.text-right'))).toBeGreaterThan(0);
    const folded = `${OCC_CARD}[hidden]`;
    expect(declarationsAt(folded)).toEqual({ display: 'none' });
    const lit = Object.fromEntries(OCC_ROW_TONES.map(tone => [tone, `${OCC_CARD}[data-occ-tone='${tone}']`]));
    expect(Object.fromEntries(Object.entries(lit).map(([tone, selector]) => [tone, declarationsAt(selector)]))).toEqual({
      attention: { 'border-left-width': '3px', 'border-left-color': 'var(--occ-warn)', 'background-color': 'var(--occ-warn-soft)' },
      urgent: { 'border-left-width': '3px', 'border-left-color': 'var(--occ-danger)', 'background-color': 'var(--occ-danger-soft)' },
    });
    for (const selector of [folded, ...Object.values(lit)]) {
      expect(atRulesAround(rules.get(selector)), selector).toEqual(['@container (max-width: 39.98rem)']);
      // Heavier than the card of tokens.css and than the OCC's own card slab, which they refine.
      expect(compareSpecificity(specificity(selector), heaviest), selector).toBeGreaterThan(0);
      expect(compareSpecificity(specificity(selector), specificity(OCC_CARD)), selector).toBeGreaterThan(0);
    }

    // They select the folded detail and the lit rows of a stacked table inside the OCC frame only.
    document.body.innerHTML = ['<div data-department="occ">', '<div>'].map(open => `${open}<table class="table-stack"><tbody>`
      + '<tr data-occ-tone="attention"><td>AA904</td></tr><tr data-occ-tone="urgent"><td>DL611</td></tr>'
      + '<tr hidden><td>Servicios</td></tr></tbody></table></div>').join('');
    const [inside, outside] = document.querySelectorAll('table');
    for (const table of [inside, outside]) {
      const [attention, urgent, detail] = table.querySelectorAll('tr');
      const expected = table === inside;
      expect(attention.matches(lit.attention), 'attention').toBe(expected);
      expect(urgent.matches(lit.urgent), 'urgent').toBe(expected);
      expect(detail.matches(folded), 'folded').toBe(expected);
      expect(attention.matches(lit.urgent)).toBe(false);
    }
    document.body.replaceChildren();
  });

  it('the chosen row of OccDataTable stays chosen in a stacked card, over a lit one, together with its detail', () => {
    const OCC_CARD = "[data-department='occ'] table.table-stack tbody > tr";
    const CHOSEN = `${OCC_CARD}[aria-selected='true']`;
    const CHOSEN_DETAIL = `${CHOSEN} + tr[data-occ-row-detail]`;
    const UNLIT = ':not([data-occ-tone])';
    const order = [];
    const bySelector = new Map();
    postcss.parse(occCss).walkRules(rule => {
      order.push(rule);
      for (const selector of rule.selectors) bySelector.set(selector.replace(/\s+/g, ' '), rule);
    });
    const declarationsOf = rule => Object.fromEntries((rule?.nodes ?? [])
      .filter(node => node.type === 'decl').map(node => [node.prop, node.value]));

    // In a card the cells lose their borders, and the card's own slab outweighs `bg-occ-accent-soft`: the card of the
    // chosen row, and the card of its detail, take the cyan slab and a cyan joint at the top, the right and the bottom.
    const slab = bySelector.get(CHOSEN);
    expect(slab, CHOSEN).toBeDefined();
    expect(bySelector.get(CHOSEN_DETAIL), CHOSEN_DETAIL).toBe(slab);
    expect(declarationsOf(slab)).toEqual({
      'border-top-color': 'var(--occ-accent)', 'border-right-color': 'var(--occ-accent)',
      'border-bottom-color': 'var(--occ-accent)', 'background-color': 'var(--occ-accent-soft)',
    });
    // The left joint too, unless the row is lit: then it keeps the 3 px bar of its signal, as in the table.
    const left = bySelector.get(`${CHOSEN}${UNLIT}`);
    expect(left, `${CHOSEN}${UNLIT}`).toBeDefined();
    expect(bySelector.get(`${CHOSEN_DETAIL}${UNLIT}`)).toBe(left);
    expect(declarationsOf(left)).toEqual({ 'border-left-color': 'var(--occ-accent)' });
    for (const rule of [slab, left]) expect(atRulesAround(rule)).toEqual(['@container (max-width: 39.98rem)']);

    // Heavier than the card. As heavy as a lit row and written after every one, so the cyan slab wins over the slab of
    // a signal as it does in the table; the detail's selector is heavier than a lit row's outright.
    expect(compareSpecificity(specificity(CHOSEN), specificity(OCC_CARD))).toBeGreaterThan(0);
    for (const tone of OCC_ROW_TONES) {
      const lit = `${OCC_CARD}[data-occ-tone='${tone}']`;
      expect(bySelector.get(lit), lit).toBeDefined();
      expect(compareSpecificity(specificity(CHOSEN), specificity(lit)), lit).toBe(0);
      expect(order.indexOf(slab), lit).toBeGreaterThan(order.indexOf(bySelector.get(lit)));
      expect(compareSpecificity(specificity(CHOSEN_DETAIL), specificity(lit)), lit).toBeGreaterThan(0);
    }
    expect(compareSpecificity(specificity(`${CHOSEN}${UNLIT}`), specificity(CHOSEN))).toBeGreaterThan(0);
    expect(compareSpecificity(specificity(`${CHOSEN_DETAIL}${UNLIT}`), specificity(CHOSEN_DETAIL))).toBeGreaterThan(0);

    // They select the chosen row and the detail under it, never another row or its detail, and inside the OCC only.
    document.body.innerHTML = ['<div data-department="occ">', '<div>'].map(open => `${open}<table class="table-stack"><tbody>`
      + '<tr aria-selected="false"><td>AA904</td></tr><tr data-occ-row-detail hidden><td>Servicios</td></tr>'
      + '<tr aria-selected="true"><td>DL611</td></tr><tr data-occ-row-detail><td>Servicios</td></tr>'
      + '<tr aria-selected="true" data-occ-tone="attention"><td>UA120</td></tr>'
      + '<tr data-occ-row-detail data-occ-tone="attention"><td>Servicios</td></tr></tbody></table></div>').join('');
    const [inside, outside] = document.querySelectorAll('table');
    const slabSelectors = [CHOSEN, CHOSEN_DETAIL].join(', ');
    const leftSelectors = [`${CHOSEN}${UNLIT}`, `${CHOSEN_DETAIL}${UNLIT}`].join(', ');
    const cards = table => [...table.querySelectorAll('tr')];
    expect(cards(inside).map(row => row.matches(slabSelectors))).toEqual([false, false, true, true, true, true]);
    expect(cards(inside).map(row => row.matches(leftSelectors))).toEqual([false, false, true, true, false, false]);
    expect(cards(outside).some(row => row.matches(slabSelectors) || row.matches(leftSelectors))).toBe(false);
    document.body.replaceChildren();
  });

  it('a focused row of OccDataTable draws its ring inside, and a field error reads in the red of the OCC', () => {
    const rules = parseRules(occCss);
    const at = selector => rules.find(rule => rule.selectors.includes(selector));
    const FOCUS = "[data-department='occ'] :focus-visible";
    const ROW_FOCUS = "[data-department='occ'] [data-occ-row]:focus-visible";
    expect(Object.fromEntries(at(ROW_FOCUS).declarations)).toEqual({ 'outline-offset': '-2px' });
    expect(compareSpecificity(specificity(ROW_FOCUS), specificity(FOCUS))).toBeGreaterThan(0);
    // The colour and width of the ring stay the OCC's.
    expect(Object.fromEntries(at(FOCUS).declarations)).toMatchObject({ outline: '2px solid var(--occ-accent)' });

    // The system's validation message is pink in the dark theme of app/globals.css; in the OCC it is the red token.
    const globalRule = parseRules(readSource('app/globals.css'))
      .find(rule => rule.selectors.includes('.dark .form-validation-message'));
    expect(globalRule.declarations.some(([property]) => property === 'color')).toBe(true);
    const MESSAGE = "[data-department='occ'] .form-validation-message";
    expect(Object.fromEntries(at(MESSAGE).declarations)).toEqual({ color: 'var(--occ-danger)' });
    // As heavy, and loaded later, so it wins.
    expect(compareSpecificity(specificity(MESSAGE), specificity('.dark .form-validation-message'))).toBe(0);
    const stylesheets = globalStylesheets();
    expect(stylesheets.indexOf('src/styles/occ.css')).toBeGreaterThan(stylesheets.indexOf('app/globals.css'));
    // The red on the surfaces a message sits on keeps 4.5:1.
    for (const surface of ['--occ-canvas', '--occ-panel', '--occ-panel-raised']) {
      expect(contrast('--occ-danger', surface), surface).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the manifest maps no class twice and only to tokens that occ.css defines', () => {
    // The guard reads the token block of occ.css; an empty parse would let everything below pass.
    expect(occScopeTokens.size).toBeGreaterThan(30);
    expect(occScopeTokens.has('--occ-text')).toBe(true);

    const classes = OCC_LEGACY_BRIDGE.flatMap(entry => entry.classes);
    expect(classes.filter((className, index) => classes.indexOf(className) !== index)).toEqual([]);
    expect(new Set(OCC_LEGACY_BRIDGE.map(entry => entry.id)).size).toBe(OCC_LEGACY_BRIDGE.length);

    // A class used inside a fill or in a pair has its own mapping too.
    const referenced = OCC_LEGACY_BRIDGE.flatMap(entry => [...(entry.inside ?? []), ...(entry.pairs ?? []).flat()]);
    expect(referenced.filter(className => !mappedClasses.has(className))).toEqual([]);

    const declarations = [OCC_BRIDGE_DEFAULTS, ...OCC_LEGACY_BRIDGE.map(entry => entry.declarations)]
      .flatMap(Object.entries);
    const read = readVariables(declarations.map(([, value]) => value).join(' '));
    expect(read.filter(name => !occScopeTokens.has(name) && !fontVariables.has(name))).toEqual([]);
    // Custom properties the bridge sets are Tailwind's own: it never defines a token.
    expect(declarations.filter(([property]) => property.startsWith('--') && !property.startsWith('--tw-'))).toEqual([]);

    for (const [className, reason] of Object.entries(OCC_BRIDGE_UNMAPPED)) {
      expect(mappedClasses.has(className), `${className} is mapped and unmapped`).toBe(false);
      expect(typeof reason === 'string' && reason.trim().length > 0, `${className} needs a reason`).toBe(true);
    }
  });

  it('paints normal states without a hue: amber and red stay with warning and danger, cyan with the selection', () => {
    const SIGNAL = /var\(--occ-(?:warn|danger|accent)(?:-[a-z]+)?\)/;
    // The legacy names of normal states, and the brand orange of eyebrows, numbering, counters and dots.
    const NORMAL = /(?:^|[:-])(?:status-(?:info|active|success|neutral)|signal-500)(?:\/|$)/;
    // The orange also outlined the selected flight or stand row: that stays cyan, the colour of the selection.
    const SELECTION = ['border-signal-500', 'ring-signal-500'];
    const classes = OCC_LEGACY_BRIDGE.flatMap(entry => entry.classes);
    const normal = classes.filter(className => NORMAL.test(className) && !SELECTION.includes(className));
    expect(normal.length).toBeGreaterThan(10);
    const tinted = normal.filter(className => SIGNAL.test(Object.values(declarationsOf(className)).join(' ')));
    expect(tinted, 'a normal state carries no amber, red or cyan').toEqual([]);
    for (const className of SELECTION) expect(Object.values(declarationsOf(className)), className).toEqual(['var(--occ-accent)']);
    for (const [name, token] of [['warning', '--occ-warn'], ['danger', '--occ-danger']]) {
      const signal = classes.filter(className => new RegExp(`(?:^|[:-])status-${name}(?:/|$)`).test(className));
      expect(signal.length, name).toBeGreaterThan(3);
      for (const className of signal) expect(Object.values(declarationsOf(className)).join(' '), className).toContain(token);
    }

    // The status dots: StatusBadge's «active» tone (Abordando, Rodaje, En ejecución…) and the console's «En operación»
    // dot are the text colour, as «success»; «info» (Programado, Asignado…) and «neutral» are secondary.
    expect(declarationsOf('bg-status-active')).toEqual({ 'background-color': 'var(--occ-text)', color: 'var(--occ-on-primary)' });
    expect(declarationsOf('bg-signal-500')).toEqual(declarationsOf('bg-status-active'));
    expect(declarationsOf('bg-status-success')).toEqual({ 'background-color': 'var(--occ-text)' });
    expect(declarationsOf('bg-status-info')).toEqual({ 'background-color': 'var(--occ-muted)' });
    expect(declarationsOf('bg-status-neutral')).toEqual({ 'background-color': 'var(--occ-muted)' });
    expect(declarationsOf('bg-status-warning')).toEqual({ 'background-color': 'var(--occ-warn-fill)', color: 'var(--occ-on-warn)' });
    expect(declarationsOf('bg-status-danger')).toEqual({ 'background-color': 'var(--occ-danger-fill)', color: 'var(--occ-on-danger)' });
    // Eyebrows, numbering and notes are secondary text; the tag of a custom permission level sits on the raised slab.
    expect(declarationsOf('text-signal-500')).toEqual({ color: 'var(--occ-muted)' });
    expect(declarationsOf('bg-signal-500/15')).toEqual({ 'background-color': 'var(--occ-panel-raised)' });
    // A counter on the light fill keeps its ink, also when its digits say `text-white` or `text-ink-900` (both entries
    // come earlier in the stylesheet and weigh the same).
    const at = id => OCC_LEGACY_BRIDGE.findIndex(entry => entry.id === id);
    expect(at('fill-neutral')).toBeGreaterThan(at('text'));
    expect(OCC_LEGACY_BRIDGE[at('fill-neutral')].inside).toEqual(['text-white']);
  });

  it('the legacy class scanner finds plain, dark, state, arbitrary-opacity and default-palette classes', () => {
    const source = `
      <div className="bg-white text-ink-900 dark:bg-surface-dark-card dark:text-text-primary-dark bg-white" />
      <a className={\`rounded-lg \${active ? 'bg-accent-600 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}\`} />
      <i className="focus-visible:outline-accent-600 aria-[current=true]:bg-accent-600/10 sm:border-black/10" />
      <p className="bg-black/[.03] dark:bg-white/[0.025] border-slate-300 text-rose-700 bg-slate-950/90" />
      <b className="bg-occ-panel/90 text-occ-text bg-occ-panel border-occ-line-strong accent-accent-600" />
      <s className="text-xs bg-transparent text-current whitespace-nowrap bg-[#7C8A9E] text-[11px] border-2 shadow-lg" />
      document.querySelector('.text-status-warning'); const tone = 'text-status-danger/90';
    `;
    expect(findLegacyColourClasses(source)).toEqual([
      'bg-white', 'text-ink-900', 'dark:bg-surface-dark-card', 'dark:text-text-primary-dark',
      'bg-accent-600', 'text-white', 'hover:bg-black/5', 'dark:hover:bg-white/5',
      'focus-visible:outline-accent-600', 'aria-[current=true]:bg-accent-600/10', 'sm:border-black/10',
      'bg-black/[.03]', 'dark:bg-white/[0.025]', 'border-slate-300', 'text-rose-700', 'bg-slate-950/90',
      'bg-occ-panel/90', 'accent-accent-600', 'text-status-danger/90',
    ]);
    expect(findLegacyColourClasses('<div className="bg-occ-panel text-occ-muted divide-occ-line" />')).toEqual([]);
  });

  it('bridgeSelector escapes classes and turns variants into pseudo-classes, and rejects an unknown variant', () => {
    expect(bridgeSelector('bg-white')).toEqual({ selector: '.bg-white', media: null });
    expect(bridgeSelector('bg-black/[.03]').selector).toBe('.bg-black\\/\\[\\.03\\]');
    expect(bridgeSelector('w-[50%]').selector).toBe('.w-\\[50\\%\\]');
    expect(bridgeSelector('dark:bg-surface-dark-card').selector).toBe('.dark\\:bg-surface-dark-card');
    expect(bridgeSelector('dark:hover:bg-white/5').selector).toBe('.dark\\:hover\\:bg-white\\/5:hover');
    expect(bridgeSelector('focus:ring-accent-600/20').selector).toBe('.focus\\:ring-accent-600\\/20:focus');
    expect(bridgeSelector('focus-visible:outline-accent-600').selector).toBe('.focus-visible\\:outline-accent-600:focus-visible');
    expect(bridgeSelector('read-only:bg-black/5').selector).toBe('.read-only\\:bg-black\\/5:read-only');
    expect(bridgeSelector('disabled:bg-white').selector).toBe('.disabled\\:bg-white:disabled');
    expect(bridgeSelector('aria-[current=true]:bg-accent-600/10').selector)
      .toBe('.aria-\\[current\\=true\\]\\:bg-accent-600\\/10[aria-current="true"]');
    expect(bridgeSelector('divide-black/5').selector).toBe('.divide-black\\/5 > :not([hidden]) ~ :not([hidden])');
    expect(bridgeSelector('sm:rounded-2xl')).toEqual({ selector: '.sm\\:rounded-2xl', media: '(min-width: 640px)' });
    expect(bridgeSelector('2xl:rounded-lg')).toEqual({ selector: '.\\32 xl\\:rounded-lg', media: '(min-width: 1536px)' });
    expect(bridgeSelector('3xl:rounded-lg').media).toBe('(min-width: 1920px)');

    // Each escaped selector selects an element that carries the literal class.
    for (const className of ['bg-black/[.03]', 'w-[50%]', '2xl:rounded-lg', 'aria-[current=true]:bg-accent-600/10']) {
      const element = document.createElement('span');
      element.className = className;
      element.setAttribute('aria-current', 'true');
      expect(element.matches(bridgeSelector(className).selector), className).toBe(true);
    }

    expect(() => bridgeSelector('group-hover:text-white')).toThrow(/variant "group-hover"/);
    expect(() => bridgeSelector('print:bg-white')).toThrow(/variant "print"/);
    expect(() => bridgeSelector('sm:md:bg-white')).toThrow(/one screen variant/);
    for (const invalid of ['', 'bg-white text-ink-900', 'dark:', undefined]) expect(() => bridgeSelector(invalid)).toThrow(TypeError);
  });

  it('the generator rejects a malformed manifest', () => {
    const entry = { id: 'text', declarations: { color: 'var(--occ-text)' }, classes: ['text-ink-900'] };
    expect(() => generateOccLegacyBridgeCss([entry, { ...entry, classes: ['text-white'] }])).toThrow(/used twice/);
    expect(() => generateOccLegacyBridgeCss([{ ...entry, id: 'Text' }])).toThrow(/kebab-case/);
    expect(() => generateOccLegacyBridgeCss([{ ...entry, declarations: { colour: 'red' } }])).toThrow(/unknown property/);
    expect(() => generateOccLegacyBridgeCss([{ ...entry, declarations: { color: 'red; display: none' } }])).toThrow(/invalid value/);
    expect(() => generateOccLegacyBridgeCss([{ ...entry, classes: [] }])).toThrow(/no class/);
    expect(() => generateOccLegacyBridgeCss([{ ...entry, declarations: { 'background-color': 'var(--occ-panel)' }, inside: ['text-white'] }]))
      .toThrow(/no color/);
    expect(() => generateOccLegacyBridgeCss([{ ...entry, pairs: [['sm:bg-white', 'text-ink-900']] }])).toThrow(/screen variant/);
    for (const selector of ['input, select', 'input { color: red }', '> input', '']) {
      expect(() => generateOccLegacyBridgeCss([{ ...entry, selectors: [selector] }]), selector).toThrow(/invalid selector/);
    }

    // !important is the generator's to write, and only for an entry of plain selectors and no class.
    expect(() => generateOccLegacyBridgeCss([{ ...entry, declarations: { color: 'red !important' } }])).toThrow(/invalid value/);
    const stripe = {
      id: 'stripe', declarations: { 'border-left-color': 'var(--occ-line)' }, classes: [],
      selectors: ['[data-testid="card"]'], important: true,
    };
    expect(generateOccLegacyBridgeCss([stripe]))
      .toContain(`${OCC_BRIDGE_SCOPE} [data-testid="card"] {\n  border-left-color: var(--occ-line) !important;\n}`);
    expect(stripComments(generateOccLegacyBridgeCss([{ ...stripe, important: false }]))).not.toMatch(/!important/);
    for (const invalid of [
      { ...entry, important: true }, { ...stripe, classes: ['text-ink-900'] }, { ...stripe, inside: ['text-white'] },
      { ...stripe, pairs: [['bg-white', 'text-ink-900']] }, { ...stripe, important: 'yes' },
    ]) {
      expect(() => generateOccLegacyBridgeCss([invalid]), JSON.stringify(invalid)).toThrow(/important only/);
    }
  });

  it('shadows are flattened through --tw-shadow so focus rings survive', async () => {
    const rules = parseRules(readSource(BRIDGE_CSS));
    // No rule of the bridge touches box-shadow or the ring shadows themselves.
    const properties = rules.flatMap(rule => rule.declarations).map(([property]) => property);
    expect(properties.filter(property => /box-shadow|--tw-ring-(?:offset-)?shadow/.test(property))).toEqual([]);

    const flat = OCC_LEGACY_BRIDGE.find(entry => entry.id === 'flat-shadow');
    expect(flat.declarations).toEqual({ '--tw-shadow': '0 0 #0000', '--tw-shadow-colored': '0 0 #0000' });
    const flattened = rules.find(rule => rule.selectors.includes(`${OCC_BRIDGE_SCOPE} .shadow-md`));
    expect(Object.fromEntries(flattened.declarations)).toEqual(flat.declarations);

    // Every shadow and blur class under /admin-occ is flattened.
    const flatClasses = new Set(['flat-shadow', 'flat-backdrop']
      .flatMap(id => OCC_LEGACY_BRIDGE.find(entry => entry.id === id).classes));
    const used = new Set(occMountedFiles().filter(file => SCRIPT_FILE.test(file)).flatMap(file =>
      [...readSource(file).matchAll(/(?<![\w:/-])((?:[a-z0-9-]+:)*(?:shadow(?:-(?:sm|md|lg|xl|2xl|inner))?|backdrop-blur(?:-\w+)?))(?![\w/[-])/g)]
        .map(match => match[1])));
    expect([...used].filter(className => !flatClasses.has(className))).toEqual([]);

    // Tailwind draws a shadow and a ring in one box-shadow, from separate variables: clearing --tw-shadow keeps the ring.
    const utilities = await generateTailwindUtilities();
    const boxShadow = selector => {
      let value = null;
      utilities.walkRules(rule => {
        if (rule.selectors.includes(selector)) rule.walkDecls('box-shadow', declaration => { value = declaration.value; });
      });
      return value;
    };
    for (const selector of ['.shadow-md', '.ring-2', '.focus-visible\\:ring-2:focus-visible']) {
      expect(boxShadow(selector), selector).toMatch(/var\(--tw-ring-shadow[,)]/);
      expect(boxShadow(selector), selector).toMatch(/var\(--tw-shadow[,)]/);
    }
  });

  it('migrated folders use no legacy colour class', () => {
    expect(Object.isFrozen(MIGRATED_FOLDERS)).toBe(true);
    for (const folder of MIGRATED_FOLDERS) {
      expect(existsSync(folder), `${folder} does not exist`).toBe(true);
      expect(legacyClassesIn(sourceFilesUnder(folder)), folder).toEqual([]);
    }
    // The guard bites: a folder that still uses legacy classes would fail it.
    expect(legacyClassesIn(sourceFilesUnder('src/features/admin-occ')).length).toBeGreaterThan(0);
  });

  it('migrated files of a folder still on the bridge use no legacy colour class', () => {
    expect(Object.isFrozen(MIGRATED_FILES)).toBe(true);
    expect(MIGRATED_FILES).toEqual(['src/features/notifications/CanonicalNotificationsRoute.jsx']);
    for (const file of MIGRATED_FILES) {
      expect(existsSync(file), `${file} does not exist`).toBe(true);
      // A file of a migrated folder is that folder's; this list is for the folders that stay on the bridge.
      expect(MIGRATED_FOLDERS.some(folder => file.startsWith(`${folder}/`)), file).toBe(false);
      expect(occMountedFiles(), file).toContain(file);
      expect(legacyClassesIn([file]), file).toEqual([]);
    }
    // Its folder stays on the bridge: the components other departments draw still use legacy classes.
    expect(legacyClassesIn(sourceFilesUnder('src/features/notifications')).length).toBeGreaterThan(0);
  });

  it('occ-ui and the boot screen use no backdrop-filter, no gradient and no opacity modifier on an occ colour', () => {
    for (const folder of ['src/features/occ-ui', BOOT_FOLDER]) {
      const files = sourceFilesUnder(folder);
      expect(files.length, folder).toBeGreaterThan(0);
      // findLegacyColourClasses also reports an occ colour with an opacity modifier (`bg-occ-panel/90`).
      expect(legacyClassesIn(files)).toEqual([]);
      for (const file of files) {
        const source = readSource(file);
        expect(source, file).not.toMatch(/backdrop-filter|backdropFilter|backdrop-blur/);
        expect(source, file).not.toMatch(/gradient/i);
      }
    }
    // The boot screen's stylesheet is among the files read.
    expect(sourceFilesUnder(BOOT_FOLDER).filter(file => file.endsWith('.css')).length).toBeGreaterThan(0);
  });

  it('occ-ui uses no shadow, uppercase, tracking, text under 12 px or literal colour outside occPalette.js', () => {
    const files = sourceFilesUnder('src/features/occ-ui').filter(file => SCRIPT_FILE.test(file));
    // The console's primitives are among the files read.
    expect(files).toEqual(expect.arrayContaining(['src/features/occ-ui/OccFloatingPanel.jsx',
      'src/features/occ-ui/OccTimeline.jsx', 'src/features/occ-ui/occPalette.js']));
    const found = files.flatMap(file => occUiStyleFindings(stripScriptComments(readSource(file)),
      { colours: file !== 'src/features/occ-ui/occPalette.js' }).map(finding => `${file}: ${finding}`));
    expect(found).toEqual([]);

    // Comments are not read: they may say what the code never does («without a shadow»).
    expect(occUiStyleFindings(stripScriptComments(
      "// without a shadow, never uppercase\n/* tracking-wide on #fff */ const ok = 'text-xs'; {/* text-[10px] */}",
    ))).toEqual([]);
    // The guard bites, on classes and on inline styles alike.
    const sample = [
      'shadow hover:shadow-md drop-shadow-sm', "style={{ boxShadow: 'none' }}", 'uppercase textTransform',
      'tracking-wide letterSpacing', 'text-[11px] text-[10.5px] text-[0.7rem] fontSize: 10',
      "'#fff' 'rgb(0 0 0)' 'hsl(0 0% 0%)'",
    ].join(' ');
    expect(occUiStyleFindings(sample)).toEqual([
      'shadow: shadow', 'shadow: hover:shadow-md', 'shadow: drop-shadow-sm', 'shadow: boxShadow',
      'upper case: uppercase', 'upper case: textTransform',
      'tracking: tracking-wide', 'tracking: letterSpacing',
      'text under 12 px: text-[11px]', 'text under 12 px: text-[10.5px]', 'text under 12 px: text-[0.7rem]',
      'text under 12 px: fontSize: 10',
      'colour: #fff', 'colour: rgb(', 'colour: hsl(',
    ]);
    // What occ-ui does use passes: 12 px and up, tokens, its own pattern ids, and words that only contain the letters.
    expect(occUiStyleFindings("text-xs text-sm text-[12px] text-[0.75rem] fontSize: 12 rounded-sm bg-occ-panel-float "
      + "'url(#occ-demo-stripes-1)' value.toUpperCase() node.shadowRoot")).toEqual([]);
    // occPalette.js may hold colours; nothing else may.
    expect(occUiStyleFindings("'#0f161a'", { colours: false })).toEqual([]);
    expect(occUiStyleFindings("'#0f161a'")).toEqual(['colour: #0f161a']);
  });

  it('rebuilt OCC screens draw no shadow, upper case, tracking, text under 12 px or literal colour', () => {
    const rebuiltFiles = [];
    for (const folder of REBUILT_SCREEN_FOLDERS) {
      expect(MIGRATED_FOLDERS, folder).toContain(folder);
      const files = sourceFilesUnder(folder).filter(file => SCRIPT_FILE.test(file));
      expect(files.length, folder).toBeGreaterThan(0);
      rebuiltFiles.push(...files);
    }
    for (const file of [...rebuiltFiles, ...MIGRATED_FILES]) {
      expect(occUiStyleFindings(stripScriptComments(readSource(file))), file).toEqual([]);
      const source = readSource(file);
      expect(source, file).not.toMatch(/backdrop-filter|backdropFilter|backdrop-blur/);
      expect(source, file).not.toMatch(/gradient/i);
    }
    // Cobertura's route and its message file are among the files read.
    expect(sourceFilesUnder('src/features/position-coverage')).toEqual(expect.arrayContaining([
      'src/features/position-coverage/CoverageRoute.jsx', 'src/features/position-coverage/coverageMessages.js',
    ]));
    // The review's route and the sections it restyled are among the files read.
    expect(sourceFilesUnder('src/features/review')).toEqual(expect.arrayContaining([
      'src/features/review/CanonicalReviewRoute.jsx', 'src/features/review/components/OperationCloseSection.jsx',
      'src/features/review/components/OperationDocumentsSection.jsx',
      'src/features/review/components/ReopenReviewSection.jsx',
    ]));
    // So are the chat with its presence, Datos maestros, Tablets, Contratos listos and Reportes, with their message
    // files.
    expect(rebuiltFiles).toEqual(expect.arrayContaining([
      'src/features/chat/CanonicalChatRoute.jsx', 'src/features/chat/PresencePeople.jsx',
      'src/features/chat/PresenceStatusPicker.jsx', 'src/features/chat/presenceStatus.js',
      'src/features/master-data/MasterDataRoute.jsx', 'src/features/master-data/masterDataMessages.js',
      'src/features/devices/DevicesRoute.jsx', 'src/features/devices/devicesMessages.js',
      'src/features/ready-contracts/ReadyContractsRoute.jsx', 'src/features/ready-contracts/readyContractsMessages.js',
      'src/features/reports/CanonicalReportsRoute.jsx', 'src/features/reports/reportsMessages.js',
    ]));
    // Reportes keeps no export button of its own: its actions are OccButtons in the panel's header.
    expect(existsSync('src/features/reports/components')).toBe(false);
    // Monitoreo de vuelos (U5): its page, board, inspector and message file, and the maps lane's adapter it hosts.
    expect(rebuiltFiles).toEqual(expect.arrayContaining([
      'src/features/flight-monitoring/FlightMonitoringPage.jsx', 'src/features/flight-monitoring/components/FlightBoard.jsx',
      'src/features/flight-monitoring/components/FlightInspector.jsx',
      'src/features/flight-monitoring/flightMonitoringMessages.js', 'src/features/flight-monitoring/components/FlightMap.jsx',
    ]));
  });

  it('the boot screen styles use only occ tokens defined on the OCC scope', () => {
    const stylesheets = sourceFilesUnder(BOOT_FOLDER).filter(file => file.endsWith('.css'));
    expect(stylesheets).toEqual(['src/features/admin-occ/boot/OccBootScreen.module.css']);
    for (const file of stylesheets) {
      const css = stripComments(readSource(file));
      // Its root carries data-department="occ", so every token it reads is one the OCC scope defines.
      const read = readVariables(css);
      expect(read.length, file).toBeGreaterThan(3);
      expect(read.filter(name => !occScopeTokens.has(name)), file).toEqual([]);
      // No colour of its own, no shadow, no gradient and no blur: the dark slab and its tokens.
      expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css, file).not.toMatch(/\brgba?\(|\bhsla?\(|\boklch\(|\bcolor-mix\(/i);
      expect(css, file).not.toMatch(/box-shadow|drop-shadow|text-shadow|gradient|backdrop/i);
    }
    // The guard bites: a hex colour or a token the OCC scope does not define would fail it.
    expect('.bar { color: #fff; }').toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(readVariables('fill: var(--occ-not-a-token)').filter(name => !occScopeTokens.has(name))).toEqual([
      '--occ-not-a-token',
    ]);
  });

  it.each(OCC_THEMES)('palette pairs keep their contrast (%s)', theme => {
    const onSurfaces = {
      '--occ-text': 10, '--occ-muted': 7, '--occ-faint': 4.5,
      '--occ-accent': 7, '--occ-warn': 7, '--occ-danger': 4.5, '--occ-line-strong': 3,
    };
    for (const [foreground, floor] of Object.entries(onSurfaces)) {
      for (const surface of ['--occ-canvas', '--occ-panel', '--occ-panel-raised']) {
        expect(contrast(foreground, surface, theme), `${foreground} on ${surface}`).toBeGreaterThanOrEqual(floor);
      }
    }
    const pairs = [
      ['--occ-on-primary', '--occ-primary', 7], ['--occ-on-primary', '--occ-primary-hover', 7],
      // The digits of a counter on the light fill of a normal state (fill-neutral).
      ['--occ-on-primary', '--occ-text', 7],
      ['--occ-on-warn', '--occ-warn-fill', 4.5], ['--occ-on-danger', '--occ-danger-fill', 4.5],
      ['--occ-nav-text', '--occ-nav', 7], ['--occ-nav-muted', '--occ-nav', 4.5],
      ['--occ-text', '--occ-accent-soft', 7], ['--occ-text', '--occ-warn-soft', 7], ['--occ-text', '--occ-danger-soft', 7],
      ['--occ-accent', '--occ-accent-soft', 4.5], ['--occ-warn', '--occ-warn-soft', 4.5],
    ];
    for (const [foreground, background, floor] of pairs) {
      expect(contrast(foreground, background, theme), `${foreground} on ${background}`).toBeGreaterThanOrEqual(floor);
    }

    // Red text on the red tint is the one dark pair below 4.5:1, so the bridge turns it into plain text there (in both
    // themes: the bridge has one set of rules).
    if (theme === 'dark') expect(contrast('--occ-danger', '--occ-danger-soft')).toBeLessThan(4.5);
    const pair = OCC_LEGACY_BRIDGE.find(entry => entry.id === 'danger-tint-text');
    expect(pair.declarations).toEqual({ color: 'var(--occ-text)' });
    const tints = OCC_LEGACY_BRIDGE.find(entry => entry.id === 'tint-danger').classes;
    for (const tint of tints) {
      expect(pair.pairs.some(([outer, inner]) => outer === tint && inner === 'text-status-danger'), tint).toBe(true);
    }
  });

  it('the chat styles only use variables that occ.css or the same file defines', () => {
    const chat = 'src/features/chat';
    const stylesheets = readdirSync(chat).filter(name => name.endsWith('.module.css')).map(name => `${chat}/${name}`);
    expect(stylesheets.length).toBeGreaterThan(0);
    const occDefined = declaredVariables(occCss);
    const missing = stylesheets.flatMap(file => {
      const css = readSource(file);
      const local = declaredVariables(css);
      return readVariables(stripComments(css)).filter(name => !occDefined.has(name) && !local.has(name))
        .map(name => `${file}: ${name}`);
    });
    expect(missing).toEqual([]);
    // The tokens the chat reads live on the OCC scope, so every chat element inherits them.
    const tokens = readVariables(stylesheets.map(file => readSource(file)).join('\n')).filter(name => name.startsWith('--occ-'));
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens.filter(token => !occScopeTokens.has(token))).toEqual([]);
  });

  it('no chat stylesheet paints a fixed colour or a shadow, and the selection uses occ tokens', () => {
    const FIXED_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color-mix)\(/i;
    const pixels = value => {
      const [, amount, unit] = /^([\d.]+)(px|rem)$/.exec(value) ?? [];
      return unit === 'rem' ? Number(amount) * 16 : Number(amount);
    };
    const colourParts = value => value.replace(/var\(|\)|,/g, ' ').split(/\s+/).filter(Boolean);
    // What a stylesheet breaks, as `selector → declaration`.
    const findings = css => parseRules(stripComments(css)).flatMap(rule => rule.declarations.flatMap(([property, value]) => {
      const broken = [];
      if (FIXED_COLOUR.test(value)) broken.push('a fixed colour');
      if (/shadow/.test(property) || /shadow|gradient|blur\(/.test(value) || property.startsWith('backdrop')) {
        broken.push('a shadow, gradient or blur');
      }
      if (/var\(\s*--occ-ui-/.test(value)) broken.push('an --occ-ui-* alias');
      if (COLOUR_PROPERTY.test(property)
        && colourParts(value).some(part => !part.startsWith('--') && !COLOUR_KEYWORDS.has(part))) broken.push('a named colour');
      if (property === 'font-size' && !(pixels(value) >= 12)) broken.push('text under 12 px');
      if (/^border(?:-[a-z]+)*-radius$/.test(property) && !RADIUS_TOKENS.has(value)) broken.push('a radius off its role');
      if (rule.selectors.some(selector => /:focus/.test(selector))) broken.push('a focus ring of its own');
      return broken.map(what => `${rule.selectors.join(', ')} → ${property}: ${value} (${what})`);
    }));

    const stylesheets = sourceFilesUnder(CHAT_FOLDER).filter(file => file.endsWith('.module.css'));
    expect(stylesheets).toEqual(['src/features/chat/ChatWorkspace.module.css', 'src/features/chat/PresencePeople.module.css']);
    for (const file of stylesheets) {
      expect(findings(readSource(file)), file).toEqual([]);
      // Every radius of the chat is a role's token, and the bubbles and the composer have theirs.
      expect(parseRules(stripComments(readSource(file))).some(rule => rule.declarations
        .some(([property]) => property === 'border-radius')), file).toBe(true);
    }
    const workspace = parseRules(stripComments(readSource(`${CHAT_FOLDER}/ChatWorkspace.module.css`)));
    const radiusOf = selector => workspace.find(rule => rule.selectors.includes(selector))?.declarations
      .find(([property]) => property === 'border-radius')?.[1];
    expect([radiusOf('.message'), radiusOf('.composerInput')]).toEqual(['var(--occ-radius-panel)', 'var(--occ-radius-control)']);

    // The selection is cyan in occ tokens, on the conversation itself: the soft slab, a cyan joint and a cyan code.
    // occ.css no longer repairs the chat's legacy blue.
    const route = readSource(`${CHAT_FOLDER}/CanonicalChatRoute.jsx`);
    expect(route).toMatch(/aria-current=\{open \? 'true' : undefined\}/);
    expect(/const CONVERSATION_OPEN = '([^']+)'/.exec(route)?.[1].split(' ')).toEqual(expect.arrayContaining([
      'border-occ-accent', 'bg-occ-accent-soft',
    ]));
    expect(route).toMatch(/open \? 'text-occ-accent' : 'text-occ-text'/);
    expect(occCss).not.toMatch(/data-occ-chat-layout/);
    expect(route).not.toMatch(/data-occ-chat-layout|#145dc4/i);

    // The guard bites: the chat's old rules break it.
    expect(findings(`.workspace [aria-current='true'] { border: 1px solid #145dc4; }
      .dot { box-shadow: 0 0 0 2px var(--occ-ui-solid); font-size: 10px; border-radius: 50%; }
      .dot[data-presence='available'] { background: green; }
      .composerInput:focus-visible { outline: 2px solid var(--occ-accent); }`)).toEqual([
      ".workspace [aria-current='true'] → border: 1px solid #145dc4 (a fixed colour)",
      '.dot → box-shadow: 0 0 0 2px var(--occ-ui-solid) (a shadow, gradient or blur)',
      '.dot → box-shadow: 0 0 0 2px var(--occ-ui-solid) (an --occ-ui-* alias)',
      '.dot → font-size: 10px (text under 12 px)',
      '.dot → border-radius: 50% (a radius off its role)',
      ".dot[data-presence='available'] → background: green (a named colour)",
      '.composerInput:focus-visible → outline: 2px solid var(--occ-accent) (a focus ring of its own)',
    ]);
  });

  it('occ.css, the bridge and the Tailwind occ colours reference only defined variables', () => {
    const occDefined = declaredVariables(occCss);
    const isDefined = name => occDefined.has(name) || fontVariables.has(name);
    expect(fontVariables).toEqual(new Set(['--font-manrope', '--font-plex-mono']));

    expect(readVariables(stripComments(occCss)).filter(name => !isDefined(name))).toEqual([]);
    expect(readVariables(stripComments(readSource(BRIDGE_CSS))).filter(name => !occScopeTokens.has(name) && !fontVariables.has(name)))
      .toEqual([]);

    const { colors, fontFamily } = tailwindConfig.theme.extend;
    const tailwindReads = readVariables(JSON.stringify({ occ: colors.occ, fontFamily }));
    expect(tailwindReads.length).toBeGreaterThan(Object.keys(colors.occ).length - 1);
    expect(tailwindReads.filter(name => !isDefined(name))).toEqual([]);
    // Tailwind reads the OCC colours from the scope, where every OCC element inherits them.
    expect(readVariables(JSON.stringify(colors.occ)).filter(name => !occScopeTokens.has(name))).toEqual([]);
  });

  it('every occ colour class in app/ and src/ generates CSS, so its colour has a key in colors.occ', async () => {
    // The matcher keeps the utility and drops its variant and its opacity modifier; plain names and variables are not
    // colour classes.
    const sample = "hover:bg-occ-primary text-occ-text/80 divide-occ-line-strong occ-console-stage data-occ-bridge "
      + "var(--occ-panel) rounded-occ-panel 'bg-occ-' + tone";
    expect([...sample.matchAll(OCC_COLOUR_CLASS)].map(([className]) => className))
      .toEqual(['bg-occ-primary', 'text-occ-text', 'divide-occ-line-strong']);
    // Tailwind writes nothing for a colour that colors.occ lacks, and nothing else would fail.
    expect(await utilitiesWithoutCss(['bg-occ-not-a-colour', 'bg-occ-panel', 'divide-occ-line']))
      .toEqual(['bg-occ-not-a-colour']);

    const used = ['app', 'src'].flatMap(folder => sourceFilesUnder(folder)).filter(file => SCRIPT_FILE.test(file))
      .flatMap(file => [...readSource(file).matchAll(OCC_COLOUR_CLASS)].map(([className]) => ({ file, className })));
    expect(used.length).toBeGreaterThan(100);
    const withoutCss = new Set(await utilitiesWithoutCss([...new Set(used.map(({ className }) => className))]));
    expect(used.filter(({ className }) => withoutCss.has(className)).map(({ file, className }) => `${file}: ${className}`),
      'add the colour to colors.occ in tailwind.config.js').toEqual([]);
  });
});
