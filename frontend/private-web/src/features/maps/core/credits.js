import { LOGO_BASE_URL, LIVERIES } from '../aircraft/liveries';
import { MODELS_BASE_URL } from '../aircraft/gltfModels';
import { GIBS_URL, httpsUrl } from './attribution';

// What the «Créditos y licencias» dialog of an OCC map lists (PR M5, ui/MapCreditsDialog.jsx), opened from the map's
// attribution: the 3D models of the aircraft (public/models/aircraft/manifest.json: each type's base model, authors,
// repository and commit, licence and changes; each folder serves its LICENSE, NOTICE.md and SOURCE.md), the text logos
// on the fins (public/models/liveries/logos/logos.json, from Wikimedia Commons), and the data and tiles the map
// already credits on its attribution line. Both files are static, under the application's own origin: they are read
// when the dialog first opens, once, and again only after a failure. Pure, apart from loadCredits.

/** The two files the dialog reads. */
export const CREDITS_FILES = Object.freeze({
  models: `${MODELS_BASE_URL}manifest.json`,
  logos: `${LOGO_BASE_URL}logos.json`,
});

/** The notices a model's folder serves, in the order the dialog links them. */
export const MODEL_NOTICES = Object.freeze(['LICENSE', 'NOTICE.md', 'SOURCE.md']);

const SAFE_CODE = /^[A-Z0-9]{2,4}$/;
const text = value => (typeof value === 'string' ? value.trim() : '');
const list = value => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

/** The full name of each airline with a text logo (public/models/liveries/logos/README.md), by IATA code. */
export const LOGO_AIRLINES = Object.freeze({
  AA: 'American Airlines', AC: 'Air Canada', AV: 'Avianca', B6: 'JetBlue', DL: 'Delta Air Lines',
  F9: 'Frontier Airlines', NK: 'Spirit Airlines', P5: 'Wingo', UA: 'United Airlines', UX: 'Air Europa',
  WG: 'Sunwing Airlines', WS: 'WestJet',
});

// The airline of an IATA code: its full name, else as the liveries letter it.
const LIVERY_NAMES = new Map(Object.values(LIVERIES).filter(entry => entry.iata).map(entry => [entry.iata, entry.name]));
const airlineOf = iata => (Object.hasOwn(LOGO_AIRLINES, iata) ? LOGO_AIRLINES[iata] : LIVERY_NAMES.get(iata) ?? iata);

/**
 * The models of the manifest, by ICAO code: `{ icao, name, baseName, proxy, licence, authors, repository,
 * repositoryUrl, commit, sourceUrl, upstream, upstreamUrl, note, changeDate, changes, notices: [{ file, href }] }`.
 * Links are kept only when they are https; a code that is not an ICAO code is left out, so no path is built from it.
 */
export function modelCredits(manifest) {
  const types = manifest?.types;
  if (types === null || typeof types !== 'object') return [];
  const changeDate = text(manifest.changeDate);
  return Object.keys(types).sort().filter(icao => SAFE_CODE.test(icao)).map(icao => {
    const type = types[icao] ?? {};
    const credit = type.credit ?? {};
    const notices = list(type.files?.notices).filter(file => MODEL_NOTICES.includes(file));
    return Object.freeze({
      icao,
      name: text(type.name) || icao,
      baseName: text(credit.baseName) || text(type.name) || icao,
      proxy: type.proxy === true,
      licence: text(type.licence),
      authors: text(credit.authors),
      repository: text(credit.repository),
      repositoryUrl: httpsUrl(credit.repositoryUrl),
      commit: text(credit.commit),
      sourceUrl: httpsUrl(credit.sourceUrl),
      upstream: text(credit.upstream),
      upstreamUrl: httpsUrl(credit.upstreamUrl),
      note: text(credit.note),
      changeDate,
      changes: Object.freeze(list(type.changes)),
      notices: Object.freeze(notices.map(file => Object.freeze({ file, href: `${MODELS_BASE_URL}${icao}/${file}` }))),
    });
  });
}

/**
 * The logos of logos.json, by IATA code: `{ iata, airline, page, tag, trademarked }`, `page` the Commons page (https
 * only). The airline's name is the liveries' (the code when it has none).
 */
export function logoCredits(logos) {
  const entries = logos?.logos;
  if (entries === null || typeof entries !== 'object') return [];
  return Object.keys(entries).sort().filter(iata => SAFE_CODE.test(iata)).map(iata => {
    const logo = entries[iata] ?? {};
    return Object.freeze({
      iata,
      airline: airlineOf(iata),
      page: httpsUrl(logo.page),
      tag: text(logo.tag),
      trademarked: logo.trademarked === true,
    });
  });
}

/**
 * The data and tiles the map credits (core/attribution.js and the sources that carry their own credit), as
 * `{ key, links: [{ text, href }] }`: the dialog words each one by its key. The aircraft data are not here: their
 * source comes from the API while traffic is on screen (the dialog adds it from the map's context).
 */
export const DATA_CREDITS = Object.freeze([
  { key: 'basemap', links: [
    { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    { text: 'ODbL', href: 'https://opendatacommons.org/licenses/odbl/' },
    { text: 'OpenFreeMap', href: 'https://openfreemap.org' },
    { text: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  ] },
  { key: 'airfield', links: [
    { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    { text: 'ODbL', href: 'https://opendatacommons.org/licenses/odbl/' },
    { text: 'OurAirports', href: 'https://ourairports.com/' },
  ] },
  { key: 'references', links: [{ text: 'OurAirports', href: 'https://ourairports.com/' }] },
  { key: 'satellite', links: [{ text: 'NASA GIBS', href: GIBS_URL }] },
  { key: 'weather', links: [{ text: 'NOAA Aviation Weather Center', href: 'https://aviationweather.gov' }] },
  { key: 'font', links: [
    { text: 'Manrope', href: 'https://fonts.google.com/specimen/Manrope' },
    { text: 'SIL Open Font License 1.1', href: 'https://openfontlicense.org/' },
  ] },
].map(entry => Object.freeze({ ...entry, links: Object.freeze(entry.links.map(link => Object.freeze(link))) })));

const NO_CREDITS = Object.freeze({ models: Object.freeze([]), logos: Object.freeze([]) });
let pending = null;

async function readJson(fetchImpl, url) {
  const response = await fetchImpl(url, { credentials: 'same-origin' });
  if (!response?.ok) throw new Error(`${url}: ${response?.status ?? 'no response'}`);
  return response.json();
}

/**
 * Reads both files once and resolves `{ models, logos }` (modelCredits, logoCredits). The same promise serves every
 * dialog; after a failure it is dropped, so the next call (the dialog's «Reintentar») reads again.
 */
export function loadCredits(fetchImpl = globalThis.fetch) {
  if (pending !== null) return pending;
  if (typeof fetchImpl !== 'function') return Promise.resolve(NO_CREDITS);
  pending = Promise.all([readJson(fetchImpl, CREDITS_FILES.models), readJson(fetchImpl, CREDITS_FILES.logos)])
    .then(([manifest, logos]) => Object.freeze({
      models: Object.freeze(modelCredits(manifest)), logos: Object.freeze(logoCredits(logos)),
    }))
    .catch(error => {
      pending = null;
      throw error;
    });
  return pending;
}

/** Forgets the files read (tests). */
export function resetCreditsForTests() {
  pending = null;
}
