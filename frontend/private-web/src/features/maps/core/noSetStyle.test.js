import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSource, sourceFilesUnder } from '../../../styles/occSourceScan';

// Contracts 2.4: the OCC maps have one dark palette and never swap the style after start. This scan reads the whole
// map stack: everything under src/features/maps (engine, style, ui, lab and what later PRs add), the map-lab route
// and the PositionMap and FlightMap adapters.
const MAP_ROOTS = ['src/features/maps', 'app/map-lab'];
const ADAPTERS = [
  'src/features/positions-map/components/PositionMap.jsx',
  'src/features/flight-monitoring/components/FlightMap.jsx',
];

// Old maps that keep their own lifecycle and still swap the basemap style on a theme change: RegionalTrafficMap and
// GoesCloudMap stay frozen until PR U3 retires the old dashboard. The test fails once one of them is gone, so this
// list never outlives its files.
const OLD_MAPS = [
  'src/features/maps/RegionalTrafficMap.jsx',
  'src/features/maps/GoesCloudMap.jsx',
];

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
  while (index < source.length && /[a-z]/i.test(source[index])) index += 1;
  return index;
}

// The code of a source file without its comments. Strings and regular expressions are kept whole, so a URL or a
// sentence that mentions setStyle is never mistaken for code.
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

const callsSetStyle = source => /\.\s*setStyle\s*\(|\[\s*['"`]setStyle['"`]\s*\]/.test(stripComments(source));
const constructsMapLibreMap = source => /\bnew\s+(?:\w+\.Map|MapLibreMap|MaplibreMap)\s*\(/.test(stripComments(source));

function mapStackFiles() {
  return [
    ...MAP_ROOTS.filter(root => existsSync(root)).flatMap(root => sourceFilesUnder(root)).filter(file => SCRIPT.test(file)),
    ...ADAPTERS,
  ];
}

describe('one style for the whole map lifetime', () => {
  it('no module of the engine, style, ui, lab or the two adapters calls setStyle (the frozen RegionalTrafficMap and GoesCloudMap are excluded)', () => {
    const files = mapStackFiles();
    for (const file of ['core/mapEngine.js', 'core/workerUrl.js', 'style/occStyle.js', 'style/basemapLayers.js', 'style/mapImages.js',
      'stands/standLayers.js', 'traffic/flightLayers.js', 'style/referenceLayers.js']) {
      expect(files).toContain(`src/features/maps/${file}`);
    }
    for (const file of [...OLD_MAPS, ...ADAPTERS]) {
      expect(existsSync(file), `${file} is gone: remove it from this test's lists`).toBe(true);
    }

    const scanned = files.filter(file => !OLD_MAPS.includes(file));
    expect(scanned).toEqual(expect.arrayContaining(ADAPTERS));
    expect(scanned.filter(file => callsSetStyle(readSource(file)))).toEqual([]);
    // The frozen maps still do, so the scan would see a call where there is one.
    for (const file of OLD_MAPS) expect(callsSetStyle(readSource(file)), file).toBe(true);
  });

  it('only the engine constructs a MapLibre map in the new map stack, the two adapters included', () => {
    const newStack = mapStackFiles().filter(file => !OLD_MAPS.includes(file));
    expect(newStack.filter(file => constructsMapLibreMap(readSource(file)))).toEqual(['src/features/maps/core/mapEngine.js']);
  });

  it('the scan reads calls and skips comments, strings and regular expressions', () => {
    expect(callsSetStyle('map.setStyle(url);')).toBe(true);
    expect(callsSetStyle("map['setStyle'](url);")).toBe(true);
    expect(callsSetStyle('map\n  .setStyle (url);')).toBe(true);
    expect(callsSetStyle("const url = 'https://tiles.openfreemap.org/planet'; map.setStyle(url);")).toBe(true);
    expect(callsSetStyle('// never map.setStyle(url)\n/* nor map.setStyle(url) */\nconst style = buildOccStyle();')).toBe(false);
    expect(callsSetStyle("const quote = /['\"]/g; // map.setStyle(url)\nconst ok = 1;")).toBe(false);
    expect(callsSetStyle('const half = width / 2; map.setStyle(url);')).toBe(true);
    expect(constructsMapLibreMap('map = new maplibre.Map({ container });')).toBe(true);
    expect(constructsMapLibreMap('const drawn = new Map(); // new maplibre.Map()')).toBe(false);
  });
});
