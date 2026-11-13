#!/usr/bin/env node
// Builds the Punta Cana airport layout from the committed inputs (PR M3): scripts/maps/input/mdpc.osm.json,
// ourairports.mdpc.json, stand-overrides.json and the stand points of src/features/dashboard/positionsData.js. Writes
// src/features/maps/airport/data/mdpc.layout.json and region.context.json. No network, no clock: running it twice
// gives the same bytes. Not part of `npm run build`.
// Usage (from frontend/private-web):
//   node scripts/maps/build-mdpc-layout.mjs            write the two outputs
//   node scripts/maps/build-mdpc-layout.mjs --report   also print the per-stand QA table (Markdown)
//   node scripts/maps/build-mdpc-layout.mjs --check    write nothing; fail if the committed outputs differ
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RAMP_POSITIONS } from '../../src/features/dashboard/positionsData.js';
import { buildLayout, formatReport, stringifyLayout } from './lib/buildLayout.mjs';

const at = path => fileURLToPath(new URL(path, import.meta.url));
const readJson = path => JSON.parse(readFileSync(at(path), 'utf8'));

export const OUTPUTS = Object.freeze({
  layout: at('../../src/features/maps/airport/data/mdpc.layout.json'),
  region: at('../../src/features/maps/airport/data/region.context.json'),
});

const { layout, region, report } = buildLayout({
  osm: readJson('./input/mdpc.osm.json'),
  ourAirports: readJson('./input/ourairports.mdpc.json'),
  standPoints: RAMP_POSITIONS,
  overrides: readJson('./input/stand-overrides.json'),
});
const files = [[OUTPUTS.layout, stringifyLayout(layout)], [OUTPUTS.region, stringifyLayout(region)]];

if (process.argv.includes('--check')) {
  const stale = files.filter(([path, text]) => {
    try { return readFileSync(path, 'utf8') !== text; } catch { return true; }
  });
  if (stale.length > 0) {
    console.error(`Out of date: ${stale.map(([path]) => path).join(', ')}. Run node scripts/maps/build-mdpc-layout.mjs.`);
    process.exit(1);
  }
  console.log('The committed layout matches its inputs.');
} else {
  for (const [path, text] of files) writeFileSync(path, text, 'utf8');
  console.log(`Wrote ${layout.stands.length} stands, ${layout.taxiGraph.nodes.length} graph nodes and `
    + `${layout.taxiGraph.edges.length} edges; ${region.airports.length} regional airports.`);
}
if (process.argv.includes('--report')) process.stdout.write(formatReport(report));
