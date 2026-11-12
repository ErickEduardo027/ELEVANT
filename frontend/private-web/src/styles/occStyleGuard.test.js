import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';
import { OCC_PALETTE } from '../features/occ-ui/occPalette';
import { bridgeSelector, findLegacyColourClasses, generateOccLegacyBridgeCss } from './occLegacyBridge';
import {
  MIGRATED_FOLDERS, OCC_BRIDGE_DEFAULTS, OCC_BRIDGE_SCOPE, OCC_BRIDGE_UNMAPPED, OCC_LEGACY_BRIDGE,
} from './occLegacyBridgeMap';
import { occMountedFiles, readSource, sourceFilesUnder } from './occSourceScan';

const BRIDGE_CSS = 'src/styles/occ-legacy-bridge.css';
const SCRIPT_FILE = /\.(?:js|jsx|mjs)$/;
const UPDATE_COMMAND = 'UPDATE_OCC_BRIDGE=1 npx vitest run --configLoader runner --config vitest.config.mjs '
  + 'src/styles/occStyleGuard.test.js';

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

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
function contrast(foreground, background) {
  const [lighter, darker] = [luminance(OCC_PALETTE[foreground]), luminance(OCC_PALETTE[background])].sort((a, b) => b - a);
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

// The legacy colour classes of the script files under some folders, as `file: class`.
const legacyClassesIn = files => files.filter(file => SCRIPT_FILE.test(file))
  .flatMap(file => findLegacyColourClasses(readSource(file)).map(className => `${file}: ${className}`));

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
    // Nothing that could escape the scope or reach another origin; media queries are the only at-rule.
    expect(stripComments(css)).not.toMatch(/!important|url\(/);
    for (const atRule of stripComments(css).match(/@[a-z-]+/g) ?? []) expect(atRule).toBe('@media');
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
    expect(layout).toMatch(/frameProps=\{OCC_FRAME\}/);
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
      // Dynamic imports of the map screens, the shared pages Usuarios and Mis gastos, and the chat stylesheets.
      'src/features/flight-monitoring/FlightMonitoringRoute.jsx',
      'src/features/positions-map/PositionsMapRoute.jsx',
      'src/features/department-users/DepartmentUsersPage.jsx',
      'src/features/finance/payables/DepartmentExpensesPage.jsx',
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

  it('occ-ui uses no backdrop-filter, no gradient and no opacity modifier on an occ colour', () => {
    const files = sourceFilesUnder('src/features/occ-ui');
    expect(files.length).toBeGreaterThan(0);
    // findLegacyColourClasses also reports an occ colour with an opacity modifier (`bg-occ-panel/90`).
    expect(legacyClassesIn(files)).toEqual([]);
    for (const file of files) {
      const source = readSource(file);
      expect(source, file).not.toMatch(/backdrop-filter|backdropFilter|backdrop-blur/);
      expect(source, file).not.toMatch(/gradient/i);
    }
  });

  it('palette pairs keep their contrast', () => {
    const onSurfaces = {
      '--occ-text': 10, '--occ-muted': 7, '--occ-faint': 4.5,
      '--occ-accent': 7, '--occ-warn': 7, '--occ-danger': 4.5, '--occ-line-strong': 3,
    };
    for (const [foreground, floor] of Object.entries(onSurfaces)) {
      for (const surface of ['--occ-canvas', '--occ-panel', '--occ-panel-raised']) {
        expect(contrast(foreground, surface), `${foreground} on ${surface}`).toBeGreaterThanOrEqual(floor);
      }
    }
    const pairs = [
      ['--occ-on-primary', '--occ-primary', 7], ['--occ-on-primary', '--occ-primary-hover', 7],
      ['--occ-on-warn', '--occ-warn-fill', 4.5], ['--occ-on-danger', '--occ-danger-fill', 4.5],
      ['--occ-nav-text', '--occ-nav', 7], ['--occ-nav-muted', '--occ-nav', 4.5],
      ['--occ-text', '--occ-accent-soft', 7], ['--occ-text', '--occ-warn-soft', 7], ['--occ-text', '--occ-danger-soft', 7],
      ['--occ-accent', '--occ-accent-soft', 4.5], ['--occ-warn', '--occ-warn-soft', 4.5],
    ];
    for (const [foreground, background, floor] of pairs) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(floor);
    }

    // Red text on the red tint is the one pair below 4.5:1, so the bridge turns it into plain text there.
    expect(contrast('--occ-danger', '--occ-danger-soft')).toBeLessThan(4.5);
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
    // The --occ-ui-* aliases the chat reads live on the OCC scope, so every chat element inherits them.
    const aliases = readVariables(stylesheets.map(file => readSource(file)).join('\n')).filter(name => name.startsWith('--occ-'));
    expect(aliases.filter(alias => !occScopeTokens.has(alias))).toEqual([]);
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
});
