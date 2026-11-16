import { describe, expect, it } from 'vitest';
import { readSource, sourceFilesUnder } from '../../../styles/occSourceScan';

// Design J: three travels in its own async chunk. In the sources, only the chunk's entry imports three, by name; only
// the loader reaches the chunk, through import(); the aircraft modules take three as a parameter. The build check
// (scripts/verify-map-chunks.mjs) confirms on the built chunks that no first load carries three's renderer.
const AIRCRAFT = 'src/features/maps/aircraft';
const CHUNK = `${AIRCRAFT}/aircraft3dChunk.js`;
const LOADER = `${AIRCRAFT}/loadAircraft3d.js`;
// The modules that take three as a parameter: the models and the layer.
const LAYER = `${AIRCRAFT}/aircraft3dLayer.js`;
const PARAMETER_MODULES = [`${AIRCRAFT}/aircraftGeometry.js`, LAYER];
const SCRIPT = /\.(?:js|jsx|mjs)$/;
const REGEX_CAN_FOLLOW = '(,=:[!&|?{};';

function endOfQuote(source, start) {
  let index = start + 1;
  while (index < source.length && source[index] !== source[start]) index += source[index] === '\\' ? 2 : 1;
  return Math.min(index + 1, source.length);
}

function endOfRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && source[index] !== '\n') {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    index += 1;
    if (inClass) inClass = char !== ']';
    else if (char === '[') inClass = true;
    else if (char === '/') break;
  }
  return index;
}

// The code of a source without its comments; strings and regular expressions are kept whole, so a URL is not taken
// for a comment and an import specifier survives.
function stripComments(source) {
  let code = '';
  let previous = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      code += ' ';
    } else if (char === '"' || char === "'" || char === '`' || (char === '/' && (previous === '' || REGEX_CAN_FOLLOW.includes(previous)))) {
      const end = char === '/' ? endOfRegex(source, index) : endOfQuote(source, index);
      code += source.slice(index, end);
      previous = char;
      index = end;
    } else {
      code += char;
      if (!/\s/.test(char)) previous = char;
      index += 1;
    }
  }
  return code;
}

// Every module a source names: `{ kind, clause, specifier }` for `import … from`, `export … from`, a bare import, an
// import() and a require().
function importsOf(source) {
  const code = stripComments(source);
  return [
    ...[...code.matchAll(/\b(?:import|export)\s+([^'"`;]*?)\s*\bfrom\s*(['"])([^'"]+)\2/g)]
      .map(([, clause, , specifier]) => ({ kind: 'static', clause: clause.trim(), specifier })),
    ...[...code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)].map(([, , specifier]) => ({ kind: 'static', clause: '', specifier })),
    ...[...code.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)]
      .map(([, , specifier]) => ({ kind: 'dynamic', clause: '', specifier })),
    ...[...code.matchAll(/\brequire\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)]
      .map(([, , specifier]) => ({ kind: 'require', clause: '', specifier })),
  ];
}

const isThree = specifier => specifier === 'three' || specifier.startsWith('three/');
const isMapLibre = specifier => specifier === 'maplibre-gl' || specifier.startsWith('maplibre-gl/');
const isChunk = specifier => /(?:^|\/)aircraft3dChunk(?:\.js)?$/.test(specifier);
const isLayer = specifier => /(?:^|\/)aircraft3dLayer(?:\.js)?$/.test(specifier);

// Every script the application ships: src and app, without tests.
const shippedScripts = () => ['src', 'app'].flatMap(root => sourceFilesUnder(root)).filter(file => SCRIPT.test(file));

describe('three stays in its own chunk (design J)', () => {
  it('only aircraft3dChunk.js imports three, with named imports, and only loadAircraft3d.js reaches the chunk, through import()', () => {
    const files = shippedScripts();
    expect(files).toEqual(expect.arrayContaining([CHUNK, LOADER, `${AIRCRAFT}/aircraftGeometry.js`, 'app/layout.jsx']));
    const imports = files.map(file => ({ file, imports: importsOf(readSource(file)) }));

    const importersOfThree = imports.filter(entry => entry.imports.some(item => isThree(item.specifier)));
    expect(importersOfThree.map(entry => entry.file)).toEqual([CHUNK]);
    // The chunk names what it takes from three and from one addon: no namespace, no default, no Draco, KTX2 or worker.
    const fromThree = importersOfThree[0].imports.filter(item => isThree(item.specifier));
    expect(fromThree.map(item => item.specifier)).toEqual(['three', 'three/addons/utils/BufferGeometryUtils.js']);
    for (const item of fromThree) {
      expect(item.kind).toBe('static');
      expect(item.clause).toMatch(/^\{[\s\w,]+\}$/);
    }

    const reachingTheChunk = imports.flatMap(entry => entry.imports.filter(item => isChunk(item.specifier))
      .map(item => ({ file: entry.file, kind: item.kind })));
    expect(reachingTheChunk).toEqual([{ file: LOADER, kind: 'dynamic' }]);

    // The layer names three's renderer (its default createRenderer): only the chunk may carry it.
    const reachingTheLayer = imports.filter(entry => entry.imports.some(item => isLayer(item.specifier)))
      .map(entry => entry.file);
    expect(reachingTheLayer).toEqual([CHUNK]);
  });

  it('aircraftGeometry.js and aircraft3dLayer.js take three as a parameter and import neither three nor maplibre-gl', () => {
    for (const file of PARAMETER_MODULES) {
      const source = readSource(file);
      expect(importsOf(source).filter(item => isThree(item.specifier) || isMapLibre(item.specifier)), file).toEqual([]);
      // Its exported builders receive three: as their first parameter or inside their options.
      const builders = [...stripComments(source).matchAll(/export function \w+\(([^)]*)\)/g)].map(([, parameters]) => parameters);
      expect(builders.some(parameters => /^\s*(?:three\b|\{[^}]*\bthree\b)/.test(parameters)), file).toBe(true);
    }
  });

  it('the scan reads imports and skips comments, and strings stay whole', () => {
    expect(importsOf([
      "import {\n  LatheGeometry,\n  Matrix4,\n} from 'three';",
      "export { buildAircraftGeometry } from './aircraftGeometry';",
      "import 'three/addons/side-effect.js';",
      "const chunk = () => import('./aircraft3dChunk');",
      "const legacy = require('three');",
    ].join('\n'))).toEqual([
      { kind: 'static', clause: '{\n  LatheGeometry,\n  Matrix4,\n}', specifier: 'three' },
      { kind: 'static', clause: '{ buildAircraftGeometry }', specifier: './aircraftGeometry' },
      { kind: 'static', clause: '', specifier: 'three/addons/side-effect.js' },
      { kind: 'dynamic', clause: '', specifier: './aircraft3dChunk' },
      { kind: 'require', clause: '', specifier: 'three' },
    ]);
    expect(importsOf("// import * as THREE from 'three';\n/* import('three') */\nconst url = 'https://example.test/a';")).toEqual([]);
    expect(importsOf("const pattern = /['\"]/g; // import('three')\nconst ok = 1;")).toEqual([]);
    expect(isChunk('./aircraft3dChunk') && isChunk('../aircraft/aircraft3dChunk.js') && !isChunk('./aircraft3dChunkHelpers')).toBe(true);
  });
});
