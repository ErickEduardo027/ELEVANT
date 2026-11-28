import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeLogoSvg, svgSize } from './lib/svg.mjs';

// The text logos of the liveries (plan M5), reproducibly: each airline's public-domain wordmark from Wikimedia Commons
// (tagged {{PD-textlogo}} or {{PD-shape}}, and {{Trademarked}}), checked against its file page's licence when read,
// sanitized (lib/svg.mjs) and written to public/models/liveries/logos/<IATA>.svg with logos.json (what each file is,
// where it came from, its tags and its SHA-256). The airline's symbols that carry copyright are never fetched: no
// American "AA" Flight Symbol, no United globe, no Frontier animal tails (their wordmarks only).
//
// Usage (from frontend/private-web): node scripts/models/fetch-livery-logos.mjs [--only AA,DL] [--out dir]
// Needs the network (commons.wikimedia.org and upload.wikimedia.org). The README beside the logos is written by hand.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../public/models/liveries/logos');
const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'elevant-asset-fetch/1.0 (livery logos; one request per file)';

/** The wordmark of each airline of aircraft/liveries.js that has one on Commons, by IATA code. */
export const LOGO_FILES = Object.freeze({
  AA: 'American_Airlines_wordmark_(2013).svg',
  AC: 'Air_Canada_2017.svg',
  AV: 'Avianca_2023_wordmark.svg',
  B6: 'JetBlue_Airways_Logo.svg',
  DL: 'Delta_logo.svg',
  F9: 'Frontier_Airlines_logo.svg',
  NK: 'Spirit_Airlines_logo_2014.svg',
  P5: 'Wingo_logo_2016.svg',
  UA: 'United_Airlines_wordmark.svg',
  UX: 'Air_Europa_Logo_(2015).svg',
  WG: 'Sunwings_logo_2015.svg',
  WS: 'WestJetLogo2018.svg',
});

const PD_TAG = /\{\{\s*(PD-textlogo|PD-shape)\b/i;
const TRADEMARK_TAG = /\{\{\s*(Trademarked|Trademark)\b/i;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// One polite read: a pause before it, and on 429 or 503 a longer wait (Retry-After when given), five tries at most.
async function politeFetch(url) {
  for (let attempt = 0; ; attempt += 1) {
    await pause(attempt === 0 ? 1_500 : 0);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if ((response.status !== 429 && response.status !== 503) || attempt >= 4) {
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response;
    }
    const after = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    await pause(Number.isFinite(after) ? after * 1_000 : 10_000 * (attempt + 1));
  }
}

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  return (await politeFetch(url)).json();
}

async function describe(file) {
  const title = `File:${file}`;
  const info = await api({ action: 'query', titles: title, prop: 'imageinfo|revisions', iiprop: 'url|sha1|timestamp|mime|extmetadata',
    rvprop: 'content', rvslots: 'main' });
  const page = info.query.pages[0];
  const image = page?.imageinfo?.[0];
  if (!image) throw new Error(`${title} is not on Commons.`);
  const wikitext = page.revisions?.[0]?.slots?.main?.content ?? '';
  const meta = image.extmetadata ?? {};
  const licence = meta.LicenseShortName?.value ?? '';
  const pd = PD_TAG.exec(wikitext)?.[1] ?? null;
  const trademark = TRADEMARK_TAG.test(wikitext);
  if (licence !== 'Public domain' || pd === null) throw new Error(`${title} is not tagged PD-textlogo or PD-shape (${licence}).`);
  if (image.mime !== 'image/svg+xml') throw new Error(`${title} is no SVG (${image.mime}).`);
  return { title, pageUrl: image.descriptionurl, fileUrl: image.url.split('?')[0], sha1: image.sha1,
    uploaded: image.timestamp, tag: pd, trademark, artist: (meta.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim() };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : Object.keys(LOGO_FILES);
  const out = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : OUT;
  await mkdir(out, { recursive: true });
  // With --only, the other airlines' entries are kept.
  const entries = await readFile(path.join(out, 'logos.json'), 'utf8').then(text => JSON.parse(text).logos, () => ({}));
  for (const iata of only) {
    const file = LOGO_FILES[iata];
    if (!file) throw new Error(`No Commons wordmark is listed for ${iata}.`);
    const described = await describe(file);
    const response = await politeFetch(described.fileUrl);
    const original = Buffer.from(await response.arrayBuffer());
    const sha1 = createHash('sha1').update(original).digest('hex');
    if (sha1 !== described.sha1) throw new Error(`${file} does not match its Commons SHA-1.`);
    const svg = sanitizeLogoSvg(original.toString('utf8'));
    await writeFile(path.join(out, `${iata}.svg`), svg, 'utf8');
    entries[iata] = { commonsFile: described.title, page: described.pageUrl, file: described.fileUrl, uploaded: described.uploaded,
      commonsSha1: sha1, tag: described.tag, trademarked: described.trademark, size: svgSize(svg),
      sha256: createHash('sha256').update(svg, 'utf8').digest('hex') };
    console.log(`${iata}: ${described.title} ${described.tag}${described.trademark ? ' +Trademarked' : ''} → ${iata}.svg ${svg.length} B`);
  }
  await writeFile(path.join(out, 'logos.json'), `${JSON.stringify({ source: 'Wikimedia Commons', logos: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
