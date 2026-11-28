#!/usr/bin/env node
// MANUAL, NETWORK. Downloads the airports table of OurAirports (public domain) from their GitHub mirror once and writes
// src/features/maps/airport/data/world.airports.json: the large airports of the world and every Dominican airport
// (scripts/maps/lib/ourAirports.mjs: selectWorldAirports). Never run by tests, CI or `npm run build`: the committed
// JSON is what the maps read.
// Usage (from frontend/private-web):
//   node scripts/maps/fetch-ourairports-world.mjs                       download and write
//   node scripts/maps/fetch-ourairports-world.mjs --from <airports.csv> read a copy downloaded by hand instead
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, selectWorldAirports, worldAirportsJson } from './lib/ourAirports.mjs';

const MIRROR = 'https://davidmegginson.github.io/ourairports-data';
const OUTPUT = fileURLToPath(new URL('../../src/features/maps/airport/data/world.airports.json', import.meta.url));
const USER_AGENT = 'airport-layout-extract/1.0 (one-off manual extract)';

const fromAt = process.argv.indexOf('--from');
let csv;
if (fromAt >= 0) {
  csv = readFileSync(process.argv[fromAt + 1], 'utf8');
} else {
  const response = await fetch(`${MIRROR}/airports.csv`, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`airports.csv: ${response.status}`);
  csv = await response.text();
}
const rows = selectWorldAirports(parseCsv(csv));
const fetchedAt = new Date().toISOString().slice(0, 19) + 'Z';
writeFileSync(OUTPUT, worldAirportsJson(rows, { url: `${MIRROR}/airports.csv`, fetchedAt }), 'utf8');
console.log(`Wrote ${rows.length} airports.`);
