import { describe, expect, it } from 'vitest';
import { findLegacyColourClasses } from '../../styles/occLegacyBridge';
import { readSource } from '../../styles/occSourceScan';
import { OCC_CLASSES } from './classes';
import { occButtonClass } from './OccButton';
import { occControlClass } from './OccField';

// The register routes that define class strings of their own (design E.2, last paragraph).
const ROUTES = Object.freeze([
  'src/features/position-coverage/CoverageRoute.jsx',
  'src/features/master-data/MasterDataRoute.jsx',
  'src/features/devices/DevicesRoute.jsx',
  'src/features/ready-contracts/ReadyContractsRoute.jsx',
  'src/features/reports/CanonicalReportsRoute.jsx',
]);
// Each local name and the class string that replaces it.
const EQUIVALENT = Object.freeze({
  card: 'card', cardClass: 'card', muted: 'muted', button: 'button', primary: 'primary', secondary: 'secondary',
  danger: 'danger', field: 'field', input: 'input', inputClass: 'input',
});
// The classes that place an element: the swap must keep them, or the page reflows.
const LAYOUT = /^(?:block|inline-block|inline-flex|flex|grid|w-full|mt-1|items-center|justify-center)$/;

/** The module-level class strings of a source, with the `${name}` of another one resolved. */
function localClassStrings(source) {
  const strings = {};
  for (const [, name, , value] of source.matchAll(/^const (\w+) = (['`])(.*)\2;$/gm)) {
    strings[name] = value.replace(/\$\{(\w+)\}/g, (_, other) => strings[other] ?? '');
  }
  return strings;
}

describe('OCC_CLASSES', () => {
  it('the class strings of the legacy routes have occ equivalents', () => {
    expect(Object.keys(OCC_CLASSES)).toEqual(['card', 'muted', 'button', 'primary', 'secondary', 'danger', 'field', 'input']);
    expect(Object.isFrozen(OCC_CLASSES)).toBe(true);
    for (const [key, value] of Object.entries(OCC_CLASSES)) {
      // Occ tokens only, flat, on the radius of its role.
      expect(findLegacyColourClasses(value), key).toEqual([]);
      expect(value, key).not.toMatch(/shadow|blur|uppercase|tracking|rounded-(?:lg|xl|2xl)|\/\d/);
    }
    // The buttons and the controls are the primitives' own looks; the card is a panel slab.
    expect(OCC_CLASSES.button).toBe(occButtonClass());
    expect(OCC_CLASSES.primary).toBe(occButtonClass({ variant: 'primary' }));
    expect(OCC_CLASSES.secondary).toBe(occButtonClass({ variant: 'secondary' }));
    expect(OCC_CLASSES.danger).toBe(occButtonClass({ variant: 'danger' }));
    expect(OCC_CLASSES.input.split(' ')).toEqual(['w-full', ...occControlClass({ kind: 'input' }).split(' ')]);
    expect(OCC_CLASSES.field.split(' ')).toEqual(['mt-1', 'block', 'w-full', ...occControlClass({ kind: 'textarea' }).split(' ')]);
    expect(OCC_CLASSES.card.split(' ')).toEqual(expect.arrayContaining(['rounded-md', 'border-occ-line', 'bg-occ-panel']));
    expect(OCC_CLASSES.muted).toBe('text-occ-muted');

    // Every local class string a route still defines has its equivalent, which keeps its layout classes. A route that
    // already imports OCC_CLASSES defines none, and has nothing left to compare.
    for (const file of ROUTES) {
      const strings = localClassStrings(readSource(file));
      for (const [name, legacy] of Object.entries(strings)) {
        if (!Object.hasOwn(EQUIVALENT, name)) continue;
        const occ = OCC_CLASSES[EQUIVALENT[name]].split(' ');
        const layout = legacy.split(/\s+/).filter(className => LAYOUT.test(className));
        expect(layout.filter(className => !occ.includes(className)), `${file}: ${name}`).toEqual([]);
      }
    }

    // The reader bites: it finds the strings and resolves one built on another.
    expect(localClassStrings("const button = 'inline-flex px-4';\nconst primary = `${button} text-white`;\n"))
      .toEqual({ button: 'inline-flex px-4', primary: 'inline-flex px-4 text-white' });
  });
});
