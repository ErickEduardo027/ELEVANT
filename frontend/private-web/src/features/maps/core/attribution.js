import { OPENFREEMAP_ATTRIBUTION } from '../style/occStyle';

// The credit line of every OCC map (design A7, owner decision 6): the base map's data and tiles, always, then each
// source the API names while it is active, as «Datos de aeronaves: {name}» linked to its home page and licence.
// Text that comes from the API is escaped and only https links are emitted; MapLibre sanitizes the result again.

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

const link = (href, text) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
const linkOrText = (href, text) => (href === null ? escapeHtml(text) : link(href, text));
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
 * licenseUrl }`, as the air picture sends it), each once. `aircraftDataLabel` is the word of the screen's language.
 */
export function buildAttribution(activeSources = [], { aircraftDataLabel = 'Datos de aeronaves' } = {}) {
  const credits = (Array.isArray(activeSources) ? activeSources : [])
    .map(source => sourceCredit(source, aircraftDataLabel))
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
