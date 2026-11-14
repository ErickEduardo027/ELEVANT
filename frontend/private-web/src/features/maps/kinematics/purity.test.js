import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The kinematics is a pure function of its inputs and of an explicit time (contracts 2.3: every screen shows the
// aircraft in the same place). Its sources never read a clock or randomness and never import JSON: the layout
// arrives as a parameter. traffic/routeFeatures.js joins the list when it exists. Paths are relative to this
// package, as airportLayout.test.js reads its inputs.
const maps = 'src/features/maps/';
const here = `${maps}kinematics/`;

function sources() {
  const kinematics = readdirSync(here)
    .filter(name => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map(name => ({ name: `kinematics/${name}`, path: `${here}${name}` }));
  const others = ['airport/runwayInUse.js', 'traffic/routeFeatures.js']
    .filter(name => existsSync(`${maps}${name}`))
    .map(name => ({ name, path: `${maps}${name}` }));
  return [...kinematics, ...others].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The code of a source without its comments, so a comment may name what the code must not do. */
const codeOf = text => text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');

const FORBIDDEN = Object.freeze([
  ['Date.now()', /\bDate\.now\s*\(/u],
  ['performance.now()', /\bperformance\.now\s*\(/u],
  ['new Date() without arguments', /\bnew\s+Date\s*\(\s*\)/u],
  ['Math.random()', /\bMath\.random\s*\(/u],
  ['a JSON import', /(?:from\s*|import\s*\(?\s*)['"][^'"]+\.json['"]/u],
]);

describe('kinematics purity', () => {
  it('kinematic sources read no clock, no randomness and no JSON', () => {
    const files = sources();
    expect(files.map(file => file.name)).toEqual(expect.arrayContaining([
      'airport/runwayInUse.js', 'kinematics/kinematicsFixtures.js', 'kinematics/pathBuilder.js', 'kinematics/taxiRoute.js',
      'kinematics/units.js',
    ]));
    const found = [];
    for (const file of files) {
      const code = codeOf(readFileSync(file.path, 'utf8'));
      for (const [label, pattern] of FORBIDDEN) if (pattern.test(code)) found.push(`${file.name}: ${label}`);
      // Node-safe imports: every relative import names its '.js' file, as the layout generator needs.
      for (const [, specifier] of code.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/gu)) {
        if (!specifier.endsWith('.js')) found.push(`${file.name}: import '${specifier}' without '.js'`);
      }
    }
    expect(found).toEqual([]);
    // The check itself catches each case.
    for (const [label, pattern] of FORBIDDEN) {
      const sample = { 'Date.now()': 'Date.now()', 'performance.now()': 'performance.now ()', 'new Date() without arguments': 'new Date( )', 'Math.random()': 'Math.random()', 'a JSON import': "import data from './layout.json';" }[label];
      expect(pattern.test(codeOf(sample)), label).toBe(true);
    }
    expect(FORBIDDEN[2][1].test('new Date(serverTimeMs)')).toBe(false);
    expect(FORBIDDEN[0][1].test(codeOf('// nothing here reads Date.now()'))).toBe(false);
  });
});
