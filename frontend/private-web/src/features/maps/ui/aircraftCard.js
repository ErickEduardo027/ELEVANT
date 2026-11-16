import { TAGS } from '../../occ-ui/statusVocabulary';
import { HOME_AIRPORT_IATA } from '../style/basemapLayers';

// The card of an aircraft under the pointer (owner request of 2026-11-15, as the ADS-B maps show one): its callsign
// large with its ADS-B address, then registration, type, airline, route (origin–destination), altitude, speed and where
// the position comes from (ADS-B, estimated, or the vocabulary's «Demo»). From what the map already draws (the traffic
// of useMapSituation and the screen's map flights): no read is added. Pure; ui/MapTooltip.jsx draws it.

const FEET_PER_METRE = 1 / 0.3048;
const KNOTS_PER_MS = 1.943844;

const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const finite = value => typeof value === 'number' && Number.isFinite(value);
// The ICAO designator an airline's callsign starts with («AAL1234» → AAL), for traffic the OCC has no flight of.
const OPERATOR = /^([A-Z]{3})\d/;

/** The flight row of `flightKey` among a screen's map flights (an array of rows with `flightKey`), or null. */
export function flightRowOf(flights, flightKey) {
  if (!flightKey || !Array.isArray(flights)) return null;
  return flights.find(row => row?.flightKey === flightKey) ?? null;
}

/** Where the position comes from: `demo` for a demo flight, `estimated` for an estimate, else `adsb`. */
export function aircraftSource(item) {
  if (item?.isDemo === true) return 'demo';
  return item?.quality === 'estimated' ? 'estimated' : 'adsb';
}

/**
 * The card's content for an aircraft the map draws (`item`, a RenderAircraft of traffic/situationModel.js, as the frame
 * draws it) and its flight row when it is an ELEVANT flight: `{ kind: 'aircraft', id, title, hex, source, facts }`, the
 * facts `[{ key, value }]` in the card's order (`value` null when unknown). `t` is the map's translator, `locale` its
 * number format.
 */
export function aircraftCard(item, flight = null, { t, language = 'es', locale = 'es-DO' } = {}) {
  if (!item) return null;
  const number = new Intl.NumberFormat(locale);
  const callsign = text(item.callsign) ?? text(flight?.callsign);
  const flightNumber = text(item.flightNumber) ?? text(flight?.flightNumber);
  const title = callsign ?? flightNumber ?? text(item.registration) ?? (text(item.hex)?.toUpperCase() ?? '—');
  const counterpart = text(item.counterpartIata) ?? text(flight?.counterpart?.iataCode) ?? text(flight?.counterpart?.icaoCode);
  const departure = (item.direction ?? flight?.direction) === 'Departure';
  let route = null;
  if (counterpart !== null) route = departure ? `${HOME_AIRPORT_IATA}–${counterpart}` : `${counterpart}–${HOME_AIRPORT_IATA}`;
  let altitude = null;
  if (item.onGround === true) altitude = t('aircraftCard.ground');
  else if (finite(item.altM)) altitude = `${number.format(Math.round((item.altM * FEET_PER_METRE) / 100) * 100)} ft`;
  const speed = finite(item.gsMs) && !(item.onGround === true && item.gsMs < 1)
    ? `${number.format(Math.round(item.gsMs * KNOTS_PER_MS))} kt` : null;
  const airline = text(flight?.airline?.name) ?? (callsign && item.kind !== 'aviam' ? OPERATOR.exec(callsign)?.[1] ?? null : null);
  const source = aircraftSource(item);
  const sourceWord = source === 'demo' ? TAGS.demo[language] ?? TAGS.demo.es : t(`aircraftCard.sources.${source}`);
  return {
    kind: 'aircraft',
    id: item.id,
    title,
    // The flight number when it is not the title, then the ADS-B address.
    subtitle: [flightNumber !== null && flightNumber !== title ? flightNumber : null, text(item.hex)?.toUpperCase() ?? null]
      .filter(Boolean).join(' · ') || null,
    source,
    facts: [
      { key: 'registration', value: text(item.registration) ?? text(flight?.aircraft?.registration) },
      { key: 'type', value: text(item.typeIcao) ?? text(flight?.aircraft?.typeIcaoCode) },
      { key: 'airline', value: airline },
      { key: 'route', value: route },
      { key: 'altitude', value: altitude },
      { key: 'speed', value: speed },
      { key: 'source', value: sourceWord },
    ],
  };
}
