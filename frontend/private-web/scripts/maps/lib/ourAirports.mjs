import { METRES_PER_NM, haversineM } from '../../../src/features/maps/airport/geo.js';

// The OurAirports rows for Punta Cana (PR M3): MDPC's runway ends and frequencies, the navaids PNA (VOR-DME 112.7)
// and PCA (NDB 425), and the large and medium airports within 300 NM. Pure; the download lives only in
// scripts/maps/fetch-ourairports-mdpc.mjs, run by hand once. OurAirports data is in the public domain.

export const MDPC_ICAO = 'MDPC';
export const REGION_RADIUS_NM = 300;
export const MDPC_NAVAIDS = Object.freeze([
  Object.freeze({ ident: 'PNA', type: 'VOR-DME', frequencyKhz: 112700 }),
  Object.freeze({ ident: 'PCA', type: 'NDB', frequencyKhz: 425 }),
]);
const FEET_TO_M = 0.3048;

/** Parses RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF) into objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...body] = rows.filter(cells => !(cells.length === 1 && cells[0] === ''));
  return body.map(cells => Object.fromEntries(header.map((name, at) => [name, cells[at] ?? ''])));
}

const number = value => (value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value));
const text = value => (value === '' || value == null ? null : String(value));
const metres = feet => (number(feet) === null ? null : Math.round(number(feet) * FEET_TO_M * 10) / 10);

function runwayEnd(row, prefix) {
  return {
    ident: text(row[`${prefix}_ident`]),
    lat: number(row[`${prefix}_latitude_deg`]),
    lon: number(row[`${prefix}_longitude_deg`]),
    elevationFt: number(row[`${prefix}_elevation_ft`]),
    headingTrue: number(row[`${prefix}_heading_degT`]),
    displacedThresholdM: metres(row[`${prefix}_displaced_threshold_ft`]) ?? 0,
  };
}

function airportSummary(row) {
  return {
    ident: row.ident,
    type: row.type,
    name: row.name,
    icao: text(row.icao_code) ?? text(row.gps_code) ?? row.ident,
    iata: text(row.iata_code),
    municipality: text(row.municipality),
    country: text(row.iso_country),
    lat: number(row.latitude_deg),
    lon: number(row.longitude_deg),
    elevationFt: number(row.elevation_ft),
  };
}

/**
 * Selects the rows the layout needs from the four OurAirports tables (already parsed): `{ airport, runways,
 * frequencies, navaids, regionalAirports }`, every list in a stable order.
 */
export function selectMdpcRows({ airports = [], runways = [], frequencies = [], navaids = [] }) {
  const airportRow = airports.find(row => row.ident === MDPC_ICAO);
  if (!airportRow) throw new Error('OurAirports has no MDPC row.');
  const airport = airportSummary(airportRow);
  const arp = [airport.lon, airport.lat];

  const mdpcRunways = runways
    .filter(row => row.airport_ident === MDPC_ICAO && row.closed !== '1')
    .map(row => ({
      leIdent: text(row.le_ident),
      heIdent: text(row.he_ident),
      lengthM: metres(row.length_ft),
      widthM: metres(row.width_ft),
      surface: text(row.surface),
      le: runwayEnd(row, 'le'),
      he: runwayEnd(row, 'he'),
    }))
    .sort((a, b) => String(a.leIdent).localeCompare(String(b.leIdent)));

  const mdpcFrequencies = frequencies
    .filter(row => row.airport_ident === MDPC_ICAO)
    .map(row => ({ type: row.type, description: text(row.description), frequencyMhz: number(row.frequency_mhz) }))
    .sort((a, b) => a.type.localeCompare(b.type) || (a.frequencyMhz ?? 0) - (b.frequencyMhz ?? 0));

  const mdpcNavaids = MDPC_NAVAIDS.map(wanted => {
    const candidates = navaids
      .filter(row => row.ident === wanted.ident && row.type === wanted.type
        && number(row.frequency_khz) === wanted.frequencyKhz)
      .map(row => ({
        ident: row.ident,
        name: row.name,
        type: row.type,
        frequencyKhz: number(row.frequency_khz),
        lat: number(row.latitude_deg),
        lon: number(row.longitude_deg),
        elevationFt: number(row.elevation_ft),
        country: text(row.iso_country),
      }))
      .filter(row => row.lat !== null && row.lon !== null)
      .sort((a, b) => haversineM(arp, [a.lon, a.lat]) - haversineM(arp, [b.lon, b.lat]));
    return candidates[0] ?? null;
  }).filter(Boolean);

  const regionalAirports = airports
    .filter(row => row.type === 'large_airport' || row.type === 'medium_airport')
    .map(airportSummary)
    .filter(row => row.lat !== null && row.lon !== null)
    .map(row => ({ ...row, distanceNm: Math.round((haversineM(arp, [row.lon, row.lat]) / METRES_PER_NM) * 10) / 10 }))
    .filter(row => row.distanceNm <= REGION_RADIUS_NM)
    .sort((a, b) => a.distanceNm - b.distanceNm || a.ident.localeCompare(b.ident));

  return { airport, runways: mdpcRunways, frequencies: mdpcFrequencies, navaids: mdpcNavaids, regionalAirports };
}
