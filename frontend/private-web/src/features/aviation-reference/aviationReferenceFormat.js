// Pure wording of the AeroDataBox reference answers (ADR-0028, note of 15 November 2026), shared by the cards, the pill
// and the tests. `t` is the translator of aviationReferenceMessages.

/** The states in which an answer may carry a value. */
const WITH_VALUE = new Set(['Available', 'DailyLimitReached', 'MonthlyLimitReached', 'Unavailable']);

/**
 * What a read's state says, or null when there is nothing to say (an available answer). A value kept under a cap or a
 * failure adds «Se muestra el último dato guardado.».
 */
export function statusWords(t, read, hasValue) {
  if (!read || read.status === 'idle') return null;
  if (read.status === 'loading') return t('status.loading');
  if (read.status === 'forbidden') return t('status.forbidden');
  if (read.status === 'error') return t('status.error');
  const status = read.data?.status;
  if (!status || status === 'Available') return null;
  const words = t(`status.${status}`);
  return hasValue && WITH_VALUE.has(status) ? `${words}. ${t('status.lastKept')}` : words;
}

/** «+12 min», «−4 min» or «sin demora»; null without a median. */
export function delayMinutes(t, minutes) {
  if (!Number.isInteger(minutes)) return null;
  if (minutes === 0) return t('delays.noDelay');
  return t('delays.minutes', { sign: minutes > 0 ? '+' : '−', minutes: Math.abs(minutes) });
}

/** «llegadas +12 min · salidas +8 min» from the delays facts; a batch without flights says «sin vuelos». */
export function delaysSummary(t, delays) {
  if (!delays) return null;
  const part = (batch, word) => {
    if (!batch || batch.total === 0) return `${t(`delays.${word}`)} ${t('delays.noFlights')}`;
    return `${t(`delays.${word}`)} ${delayMinutes(t, batch.medianDelayMinutes) ?? '—'}`;
  };
  return `${part(delays.arrivals, 'arrivals')} · ${part(delays.departures, 'departures')}`;
}

/** The worse of the two delay indexes (0 to 5), for the pill's emphasis; null without either. */
export function worstDelayIndex(delays) {
  const values = [delays?.arrivals?.delayIndex, delays?.departures?.delayIndex].filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

/** The tone of a delay index: `ok` below 1.5, `watch` below 3, `high` from 3 (the provider's scale of 0 to 5). */
export function delayTone(index) {
  if (!Number.isFinite(index)) return 'none';
  if (index < 1.5) return 'ok';
  return index < 3 ? 'watch' : 'high';
}

/** How many types of the sample the one-line summary names, and how many the sample line counts. */
const SUMMARY_TYPES = 3;
const SAMPLE_TYPES = 6;

/** How many aircraft the provider sent as a sample, when the answer brings their types; null otherwise. */
const sampleSize = fleet => (Array.isArray(fleet?.types) && fleet.types.length > 0 &&
  Number.isInteger(fleet.sampledAircraft) && fleet.sampledAircraft > 0 ? fleet.sampledAircraft : null);

/**
 * The name of a type of the fleet sample: its ICAO type code, the key the API groups the sample by, or its model when
 * the provider gave no code, so that no type is named twice (N32: the provider's model of a B39M can say «B38M»). The
 * API's group of the aircraft with neither («?») is «sin tipo».
 */
export function fleetTypeLabel(t, type) {
  const label = [type?.icaoType, type?.model].find(value => typeof value === 'string' && value.trim())?.trim();
  return label && label !== '?' ? label : t('fleet.noType');
}

/**
 * The fleet in one line: «Flota según AeroDataBox: 802 aviones; en una muestra de 25: B38M, B39M» (the first three
 * types of the sample, most frequent first, «…» when there are more). The types are said as the sample's, never as the
 * whole fleet's. Only the count without a sample; null without a count.
 */
export function fleetSummary(t, fleet) {
  if (!fleet || !Number.isInteger(fleet.totalAircraft) || fleet.totalAircraft <= 0) return null;
  const total = fleet.totalAircraft === 1 ? t('fleet.summaryOne') : t('fleet.summary', { count: fleet.totalAircraft });
  const size = sampleSize(fleet);
  if (size === null) return total;
  const names = fleet.types.map(type => fleetTypeLabel(t, type));
  const more = names.length > SUMMARY_TYPES ? '…' : '';
  return `${total}; ${t('fleet.inSample', { count: size })}: ${names.slice(0, SUMMARY_TYPES).join(', ')}${more}`;
}

/**
 * How many aircraft of the sample each type has: «Tipos en una muestra de 25: B38M (24) · B39M (1)» (the first six
 * types, « · …» when there are more), or null without a sample.
 */
export function fleetSampleLine(t, fleet) {
  const size = sampleSize(fleet);
  if (size === null) return null;
  const shown = fleet.types.slice(0, SAMPLE_TYPES).map(type => `${fleetTypeLabel(t, type)} (${type.count})`);
  const more = fleet.types.length > SAMPLE_TYPES ? ' · …' : '';
  return `${t('fleet.sample', { count: size })}: ${shown.join(' · ')}${more}`;
}

/** Whether the answer says the airline has no fleet the provider knows: a warning, never a block. */
export function hasNoFleet(fleet) {
  if (!fleet) return false;
  return fleet.status === 'NotFound' || (fleet.status === 'Available' && !(fleet.totalAircraft > 0));
}

/** The year of a date «2022-03-01» → «2022»; null otherwise. */
const yearOf = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(0, 4) : null);

/**
 * The rows of an aircraft card, `[{ id, label, value }]`, in the order they are shown; only what the provider gave.
 */
export function aircraftRows(t, aircraft, locale = 'es') {
  if (!aircraft) return [];
  const rows = [];
  const add = (id, value) => { if (value !== null && value !== undefined && value !== '') rows.push({ id, label: t(`aircraft.${id}`), value }); };
  add('model', aircraft.model ?? aircraft.typeName);
  add('type', [aircraft.icaoType, aircraft.iataType].filter(Boolean).join(' / ') || null);
  add('operator', aircraft.operator);
  if (Number.isFinite(aircraft.ageYears)) {
    add('age', t('aircraft.ageYears', { years: aircraft.ageYears.toLocaleString(locale, { maximumFractionDigits: 1 }) }));
  }
  add('firstFlight', yearOf(aircraft.firstFlight));
  add('seats', Number.isInteger(aircraft.seats) && aircraft.seats > 0 ? String(aircraft.seats) : null);
  if (Number.isInteger(aircraft.engines) && aircraft.engines > 0) {
    const kind = aircraft.engineType ? t(`aircraft.engineTypes.${aircraft.engineType}`) : null;
    add('engines', kind && !kind.startsWith('aircraft.') ? `${aircraft.engines} · ${kind}` : String(aircraft.engines));
  }
  add('serial', aircraft.serial);
  add('modeS', aircraft.modeS);
  return rows;
}
