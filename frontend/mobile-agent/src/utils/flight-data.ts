/**
 * The flight data the agent types once (ADR-0031) and every AVIAM form prints: the passengers in and out, the MTOW
 * and the registration, read as ELEVANT validates them (`RampExecutionPolicy.HasValidFlightData`). A value the tablet
 * cannot read exactly is an error on its own field, never another number (S1): «1.5» is not 15, «-5» is not 5 and an
 * empty field is no value, not 0. What the Service Order still lacks only warns (D-S1): 0 passengers is a value, a
 * missing MTOW holds neither the signature nor the hand-off, and the server has no rule for it.
 */
export const PASSENGERS_MIN = 0;
export const PASSENGERS_MAX = 999;
export const MTOW_MIN_KG = 1_000;
export const MTOW_MAX_KG = 700_000;
const REGISTRATION = /^[A-Z0-9-]{2,10}$/;

/** The numbers of the flight data that the forms print; the registration is text. */
export type FlightDatum = 'passengersIn' | 'passengersOut' | 'mtowKg';
export type FlightDataField = FlightDatum | 'aircraftRegistration';

/** The card's fields in screen order: the first one with an error takes the focus. */
export const FLIGHT_DATA_FIELDS: readonly FlightDataField[] = [
  'passengersIn', 'passengersOut', 'mtowKg', 'aircraftRegistration',
];
const FLIGHT_DATA: readonly FlightDatum[] = ['passengersIn', 'passengersOut', 'mtowKg'];

export const FLIGHT_DATA_LABELS: Readonly<Record<FlightDataField, string>> = {
  passengersIn: 'Pasajeros que llegan',
  passengersOut: 'Pasajeros que salen',
  mtowKg: 'MTOW (kg)',
  aircraftRegistration: 'Matrícula',
};

const kg = (value: number) => value.toLocaleString('es-DO');

/** What an empty field shows: the range and the unit, or an example of a registration. */
export const FLIGHT_DATA_PLACEHOLDERS: Readonly<Record<FlightDataField, string>> = {
  passengersIn: `${PASSENGERS_MIN} a ${PASSENGERS_MAX}`,
  passengersOut: `${PASSENGERS_MIN} a ${PASSENGERS_MAX}`,
  mtowKg: `${kg(MTOW_MIN_KG)} a ${kg(MTOW_MAX_KG)} kg`,
  aircraftRegistration: 'Como HI1055',
};

/** What the agent typed in each field, as it is on screen. */
export type FlightDataDraft = Readonly<Record<FlightDataField, string>>;
/** The flight data as it travels to ELEVANT: null is no value. */
export type FlightDataValues = Readonly<{
  passengersIn: number | null;
  passengersOut: number | null;
  mtowKg: number | null;
  aircraftRegistration: string | null;
}>;
export type FlightDataErrors = Readonly<Partial<Record<FlightDataField, string>>>;

/** A whole number as typed: `value` is null for an empty field; anything else that is not one is `ok: false`. */
export type WholeNumberReading = Readonly<{ ok: true; value: number | null }> | Readonly<{ ok: false }>;

const PLAIN = /^[0-9]+$/;
/**
 * Thousands with one separator throughout, a comma, a space or a no-break space, in groups of three: «351,500»,
 * «1 000». Never a point, which reads as a decimal in one place and as thousands in another.
 */
const GROUPED = /^[1-9][0-9]{0,2}([, \u00A0\u202F])[0-9]{3}(?:\1[0-9]{3})*$/;

/**
 * Reads a whole number exactly as typed: ASCII digits only, no sign, decimals or exponent, and thousands only as
 * `GROUPED` writes them. It is never NaN, and it never turns what it cannot read into another number.
 */
export function parseWholeNumber(text: string): WholeNumberReading {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (!PLAIN.test(trimmed) && !GROUPED.test(trimmed)) return { ok: false };
  const value = Number(trimmed.replace(/[^0-9]/g, ''));
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
}

const PASSENGERS_NOT_WHOLE = `Escribe un número entero de ${PASSENGERS_MIN} a ${PASSENGERS_MAX}, sin puntos ni decimales.`;
const PASSENGERS_OUT_OF_RANGE = `Debe ser de ${PASSENGERS_MIN} a ${PASSENGERS_MAX} pasajeros.`;
const MTOW_NOT_WHOLE = 'Escribe los kg con un número entero, sin puntos ni decimales.';
const MTOW_OUT_OF_RANGE = `Debe ser de ${kg(MTOW_MIN_KG)} a ${kg(MTOW_MAX_KG)} kg.`;
const REGISTRATION_INVALID = 'Usa de 2 a 10 letras, números o guiones, como HI1055.';
/** An MTOW from 1 to 999 is almost surely in tonnes: the message says what it would be in kg. */
const inTonnes = (value: number) => `¿Toneladas? El MTOW va en kg: ${value} t son ${kg(value * 1_000)} kg.`;

/**
 * Validates what the agent typed, field by field: `values` is what travels (null for a field that is empty or wrong)
 * and `errors` has one message per wrong field, with its range. Nothing is saved while `errors` has one.
 */
export function validateFlightDataDraft(
  draft: FlightDataDraft,
): Readonly<{ values: FlightDataValues; errors: FlightDataErrors }> {
  const errors: Partial<Record<FlightDataField, string>> = {};
  const passengers = (field: 'passengersIn' | 'passengersOut') => {
    const reading = parseWholeNumber(draft[field]);
    if (!reading.ok) {
      errors[field] = PASSENGERS_NOT_WHOLE;
      return null;
    }
    if (reading.value !== null && (reading.value < PASSENGERS_MIN || reading.value > PASSENGERS_MAX)) {
      errors[field] = PASSENGERS_OUT_OF_RANGE;
      return null;
    }
    return reading.value;
  };
  const passengersIn = passengers('passengersIn');
  const passengersOut = passengers('passengersOut');

  let mtowKg: number | null = null;
  const mtow = parseWholeNumber(draft.mtowKg);
  if (!mtow.ok) errors.mtowKg = MTOW_NOT_WHOLE;
  else if (mtow.value !== null && mtow.value >= 1 && mtow.value < MTOW_MIN_KG) errors.mtowKg = inTonnes(mtow.value);
  else if (mtow.value !== null && (mtow.value < MTOW_MIN_KG || mtow.value > MTOW_MAX_KG)) errors.mtowKg = MTOW_OUT_OF_RANGE;
  else mtowKg = mtow.value;

  const registration = draft.aircraftRegistration.trim().toUpperCase();
  const registrationValid = registration === '' || REGISTRATION.test(registration);
  if (!registrationValid) errors.aircraftRegistration = REGISTRATION_INVALID;

  const aircraftRegistration = registration !== '' && registrationValid ? registration : null;
  return { values: { passengersIn, passengersOut, mtowKg, aircraftRegistration }, errors };
}

/** The numbers of the flight data as a form or the card has them; a missing key is no value. */
export type FlightDataNumbers = Readonly<Partial<Record<FlightDatum, number | null>>>;

/**
 * The flight data a form still lacks, in the forms' order (S1): the passengers in, the passengers out and the MTOW.
 * 0 passengers is a value. Null when there is nothing to read, such as a form without its summary: the tablet cannot
 * tell, so nobody is warned about it.
 */
export function missingFlightData(values: FlightDataNumbers | null | undefined): FlightDatum[] | null {
  if (!values) return null;
  return FLIGHT_DATA.filter(datum => values[datum] == null);
}

/** How a sentence names each value; `plural` makes the verb agree: «Faltan los pasajeros…», «Falta el MTOW». */
const WORDS: Readonly<Record<FlightDatum, Readonly<{ bare: string; named: string; plural: boolean }>>> = {
  passengersIn: { bare: 'pasajeros que llegan', named: 'los pasajeros que llegan', plural: true },
  passengersOut: { bare: 'pasajeros que salen', named: 'los pasajeros que salen', plural: true },
  mtowKg: { bare: 'MTOW', named: 'el MTOW', plural: false },
};

/** «a», «a y b», «a, b y c». */
function joined(items: readonly string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

const readsPlural = (missing: readonly FlightDatum[]) => missing.length > 1 || missing.some(datum => WORDS[datum].plural);

/** Beside the card's button after a save it refused (S1): «No se guardó: revisa Pasajeros que llegan y MTOW (kg).» */
export function refusedFlightDataSummary(fields: readonly FlightDataField[]) {
  return fields.length === 0 ? null : `No se guardó: revisa ${joined(fields.map(field => FLIGHT_DATA_LABELS[field]))}.`;
}

/** The card's line (S1): «Faltan: pasajeros que llegan y MTOW.»; null when nothing is missing. */
export function missingFlightDataLine(missing: readonly FlightDatum[]) {
  if (missing.length === 0) return null;
  return `${readsPlural(missing) ? 'Faltan' : 'Falta'}: ${joined(missing.map(datum => WORDS[datum].bare))}.`;
}

/** Where the Service Order that lacks flight data stands, for its warning. */
export type OrderFlightDataSituation = Readonly<{
  /** The Order has a signature on its current content: saving the data changes it, so it is signed again. */
  signed: boolean;
  /** Flight data saved on the device is still on its way to ELEVANT, where the Order takes it from. */
  queued: boolean;
  /** The data can still be typed on the tablet: the operation is in progress. */
  editable: boolean;
  /** The close of the execution says it: the hand-off does not wait for the data. */
  handoff?: boolean;
}>;

/**
 * The warning of a Service Order that lacks flight data (S1, D-S1), on its row, at the top of its signature sheet and
 * in the close of the execution. It warns and never holds: the Order is signed and handed off without the data when
 * that is what the flight has. Null when nothing is missing.
 */
export function orderFlightDataWarning(missing: readonly FlightDatum[], situation: OrderFlightDataSituation) {
  if (missing.length === 0) return null;
  const plural = readsPlural(missing);
  const lead = `${plural ? 'Faltan' : 'Falta'} ${joined(missing.map(datum => WORDS[datum].named))} en la Orden.`;
  if (!situation.editable) return lead;
  if (situation.queued) {
    return `${lead} Lo que guardaste en «Datos del vuelo» llega a la Orden cuando se envíe a ELEVANT.`;
  }
  if (!situation.signed) {
    return `${lead} ${plural ? 'Escríbelos' : 'Escríbelo'} en «Datos del vuelo» antes de firmar.`;
  }
  const them = plural ? 'los' : 'lo';
  return situation.handoff
    ? `${lead} Puedes entregar sin ${plural ? 'ellos' : 'él'}; si ${them} guardas ahora, hay que volver a firmarla.`
    : `${lead} Si ${them} guardas ahora en «Datos del vuelo», hay que volver a firmarla.`;
}
