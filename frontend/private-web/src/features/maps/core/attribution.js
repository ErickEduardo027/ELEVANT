import { OPENFREEMAP_ATTRIBUTION } from '../style/occStyle';

// The credit line of every OCC map (design A7, owner decision 6): the base map's data and tiles, always, then each
// source the API names while it is active, as «Datos de aeronaves: {name}» linked to its home page and licence.
// Text that comes from the API is escaped and only https links are emitted; MapLibre sanitizes the result again.
// The airfield of the own dataset brings its credit on its own GeoJSON source (AIRFIELD_ATTRIBUTION): MapLibre lists
// a source's credit only while one of its layers is drawn at the current zoom. The satellite images of PR M8 do the
// same on their raster sources (GIBS_ATTRIBUTION), the references drawn from OurAirports on theirs
// (OURAIRPORTS_ATTRIBUTION), and the aerodrome weather is a source with its own label.

const ATTRIBUTION_SELECTOR = 'details.maplibregl-ctrl-attrib';
const HTML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

/**
 * The fixed part: OpenStreetMap, OpenFreeMap and OpenMapTiles with their links. The style's vector source carries
 * the same text, so MapLibre, which drops a credit that another one contains, shows it once.
 */
export const FIXED_ATTRIBUTION = OPENFREEMAP_ATTRIBUTION;

/** Text made safe for HTML content and attribute values. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

const creditLink = (href, text) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;

/**
 * The credit of OurAirports (public domain, which asks for none: the map gives it all the same), linked to its home
 * page. From PR M8 the references drawn from its data carry it on their own source (style/referenceLayers.js:
 * OURAIRPORTS_SOURCE: the extended centrelines, the airports of the region and the navaids), so the map shows it only
 * while one of them is drawn. The airfield credit ends with the same text, so with both on screen MapLibre, which drops
 * a credit another one contains, shows it once.
 */
export const OURAIRPORTS_ATTRIBUTION = creditLink('https://ourairports.com/', 'OurAirports');

/**
 * The credit of the airfield drawn from mdpc.layout.json (PR M3): its pavement, taxiways and buildings come from an
 * OpenStreetMap extract, offered under the ODbL (© OpenStreetMap contributors, linked to their copyright page and to
 * the licence), and its runway ends from OurAirports (public domain). The airfield source carries it, so the map shows
 * it only while the airfield is drawn.
 */
export const AIRFIELD_ATTRIBUTION = [
  `${creditLink('https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors')} `
    + `(${creditLink('https://opendatacommons.org/licenses/odbl/', 'ODbL')})`,
  OURAIRPORTS_ATTRIBUTION,
].join(' · ');

/** The home of NASA's Global Imagery Browse Services: the documentation of the GIBS API. */
export const GIBS_URL = 'https://nasa-gibs.github.io/gibs-api-docs/';

/**
 * The credit of the satellite images (PR M8, traffic/weatherLayers.js): the GOES-East infrared and the IMERG rain come
 * from NASA GIBS. Both raster sources carry it, so MapLibre lists it, once, only while one of their layers is drawn.
 */
export const GIBS_ATTRIBUTION = creditLink(GIBS_URL, 'NASA GIBS');

/** The URL normalized when it is an absolute https URL, otherwise `null` (http, javascript:, data:, relative…). */
export function httpsUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const linkOrText = (href, text) => (href === null ? escapeHtml(text) : creditLink(href, text));
const plain = value => (typeof value === 'string' ? value.trim() : '');

function sourceCredit(source, label) {
  const name = plain(source?.name);
  if (name === '') return null;
  const credit = `${escapeHtml(label)}: ${linkOrText(httpsUrl(source.homeUrl), name)}`;
  const licenseName = plain(source.licenseName);
  return licenseName === '' ? credit : `${credit} (${linkOrText(httpsUrl(source.licenseUrl), licenseName)})`;
}

/**
 * The attribution HTML of a map: the fixed part, then one credit per active source (`{ name, homeUrl, licenseName,
 * licenseUrl }`, as the air picture sends it), each once. `aircraftDataLabel` is the word of the screen's language. A
 * source may bring its own `label` (PR M8: «Clima» for the aerodrome weather of NOAA); without one it is aircraft data.
 */
export function buildAttribution(activeSources = [], { aircraftDataLabel = 'Datos de aeronaves' } = {}) {
  const credits = (Array.isArray(activeSources) ? activeSources : [])
    .map(source => sourceCredit(source, plain(source?.label) || aircraftDataLabel))
    .filter(Boolean);
  return [FIXED_ATTRIBUTION, ...new Set(credits)].join(' · ');
}

/**
 * Closes the compact attribution inside `container`: MapLibre 6.16 adds it open, and opens it again when its text
 * first arrives. Returns whether there was one. The map engine keeps it closed until the person opens it; the frozen
 * maps keep their own helper (maps/collapseCompactAttribution.js) until PR U3 retires them.
 */
export function collapseCompactAttribution(container) {
  const details = container?.querySelector?.(ATTRIBUTION_SELECTOR);
  if (!details) return false;
  details.removeAttribute('open');
  details.classList.remove('maplibregl-compact-show');
  return true;
}
