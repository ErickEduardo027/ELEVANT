#!/usr/bin/env node
// MANUAL, NETWORK. Fetches the OpenStreetMap aeroway features within 4 km of Punta Cana's ARP from the Overpass API
// once and writes scripts/maps/input/mdpc.osm.json (© OpenStreetMap contributors, ODbL 1.0). Never run by tests, CI or
// `npm run build`: the committed extract is the input of build-mdpc-layout.mjs.
// Usage (from frontend/private-web): node scripts/maps/fetch-mdpc-osm.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { overpassQuery, trimOverpassResponse } from './lib/overpass.mjs';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OUTPUT = fileURLToPath(new URL('./input/mdpc.osm.json', import.meta.url));
const USER_AGENT = 'airport-layout-extract/1.0 (one-off manual extract)';
const MAX_ATTEMPTS = 2;

async function fetchOnce() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: overpassQuery() }).toString(),
    });
    if (response.status === 429 || response.status === 504) {
      // Respect the server's rate rules: wait as long as it asks (at most two minutes), then try once more.
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) : 60;
      if (attempt === MAX_ATTEMPTS) throw new Error(`Overpass answered ${response.status}; try again later.`);
      console.warn(`Overpass answered ${response.status}; waiting ${waitSeconds} s.`);
      await new Promise(resolve => { setTimeout(resolve, waitSeconds * 1000); });
      continue;
    }
    if (!response.ok) throw new Error(`Overpass answered ${response.status}.`);
    return response.json();
  }
  throw new Error('Overpass did not answer.');
}

const trimmed = trimOverpassResponse(await fetchOnce());
writeFileSync(OUTPUT, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
const ways = trimmed.elements.filter(element => element.type === 'way').length;
const nodes = trimmed.elements.length - ways;
console.log(`Wrote ${ways} ways and ${nodes} nodes (OSM base ${trimmed.osm3s.timestamp_osm_base}).`);
