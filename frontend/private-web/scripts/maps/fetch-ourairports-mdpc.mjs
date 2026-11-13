#!/usr/bin/env node
// MANUAL, NETWORK. Downloads the OurAirports tables (public domain) from their GitHub mirror once and writes
// scripts/maps/input/ourairports.mdpc.json with only the rows of Punta Cana and its region. Never run by tests, CI or
// `npm run build`: the committed file is the input of build-mdpc-layout.mjs.
// Usage (from frontend/private-web): node scripts/maps/fetch-ourairports-mdpc.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, selectMdpcRows } from './lib/ourAirports.mjs';

const MIRROR = 'https://davidmegginson.github.io/ourairports-data';
const TABLES = Object.freeze({
  airports: 'airports.csv',
  runways: 'runways.csv',
  frequencies: 'airport-frequencies.csv',
  navaids: 'navaids.csv',
});
const OUTPUT = fileURLToPath(new URL('./input/ourairports.mdpc.json', import.meta.url));
const USER_AGENT = 'airport-layout-extract/1.0 (one-off manual extract)';

const tables = {};
for (const [name, file] of Object.entries(TABLES)) {
  const response = await fetch(`${MIRROR}/${file}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  tables[name] = parseCsv(await response.text());
}

const rows = selectMdpcRows(tables);
const output = {
  meta: {
    source: 'OurAirports',
    url: MIRROR,
    license: 'public domain',
    fetchedAt: new Date().toISOString().slice(0, 19) + 'Z',
  },
  ...rows,
};
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${rows.runways.length} runways, ${rows.frequencies.length} frequencies, `
  + `${rows.navaids.length} navaids and ${rows.regionalAirports.length} regional airports.`);
