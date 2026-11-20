// S1: the flight data the agent types once is read exactly as typed (src/utils/flight-data.ts). A value the tablet
// cannot read as a whole number is an error on its own field, never another number: «1.5» is not 15, «-5» is not 5 and
// an empty field is no value, not 0. The limits are ELEVANT's (RampExecutionPolicy.HasValidFlightData). What the
// Service Order lacks only warns (D-S1): 0 passengers is a value and a missing MTOW holds nothing.
const {
  FLIGHT_DATA_FIELDS,
  FLIGHT_DATA_LABELS,
  FLIGHT_DATA_PLACEHOLDERS,
  MTOW_MAX_KG,
  MTOW_MIN_KG,
  PASSENGERS_MAX,
  PASSENGERS_MIN,
  missingFlightData,
  missingFlightDataLine,
  orderFlightDataWarning,
  parseWholeNumber,
  validateFlightDataDraft,
} = require('../src/utils/flight-data');

const draft = (overrides = {}) => ({ passengersIn: '', passengersOut: '', mtowKg: '', aircraftRegistration: '', ...overrides });

describe('parseWholeNumber (S1)', () => {
  test('the limits are the ones ELEVANT validates', () => {
    expect([PASSENGERS_MIN, PASSENGERS_MAX, MTOW_MIN_KG, MTOW_MAX_KG]).toEqual([0, 999, 1000, 700000]);
  });

  test.each([
    ['0', 0],
    ['999', 999],
    ['1000', 1000],
    ['1 000', 1000],
    ['700000', 700000],
    ['700 000', 700000],
    ['1,000', 1000],
    ['351,500', 351500],
    [' 78000 ', 78000],
    ['78\u00A0000', 78000],
    ['\u00A078\u00A0000\u00A0', 78000],
    ['78\u202F000', 78000],
    ['1,000,000', 1000000],
    ['007', 7],
  ])('«%s» is %d', (text, value) => {
    expect(parseWholeNumber(text)).toEqual({ ok: true, value });
  });

  test.each(['', '   ', '\u00A0'])('an empty field («%s») is no value, never 0', text => {
    expect(parseWholeNumber(text)).toEqual({ ok: true, value: null });
  });

  test.each([
    ['1.500', 'a point: 1.5 or 1 500?'],
    ['78.5', 'decimals'],
    ['78,00', 'a decimal comma'],
    ['78,5', 'a decimal comma'],
    ['1,00,000', 'groups that are not of three'],
    ['1, 000', 'two separators in a row'],
    ['1 000,000', 'two kinds of separator'],
    ['0,500', 'a group after a zero'],
    [',500', 'a separator first'],
    ['500,', 'a separator last'],
    ['-0', 'a sign'],
    ['-5', 'a sign'],
    ['+5', 'a sign'],
    ['1e5', 'an exponent'],
    ['0x1F', 'another base'],
    ['abc', 'letters'],
    ['12a', 'letters'],
    ['Infinity', 'letters'],
    ['\u0667\u0668', 'Arabic-Indic digits'],
    ['\uFF17\uFF18', 'full-width digits'],
    ['\u096D\u096E', 'Devanagari digits'],
    ['9'.repeat(20), 'beyond a safe integer'],
  ])('«%s» is refused: %s', text => {
    expect(parseWholeNumber(text)).toEqual({ ok: false });
  });
});

describe('validateFlightDataDraft (S1)', () => {
  test('valid values travel as numbers, the registration in capitals and an empty field as null', () => {
    expect(validateFlightDataDraft(draft({ passengersIn: '0', passengersOut: '999', mtowKg: '351,500',
      aircraftRegistration: ' hi1055 ' }))).toEqual({
      values: { passengersIn: 0, passengersOut: 999, mtowKg: 351500, aircraftRegistration: 'HI1055' }, errors: {} });
    expect(validateFlightDataDraft(draft())).toEqual({
      values: { passengersIn: null, passengersOut: null, mtowKg: null, aircraftRegistration: null }, errors: {} });
  });

  test('each wrong field has its own message, with its range; it never travels as another number', () => {
    const { values, errors } = validateFlightDataDraft(draft({ passengersIn: '142138', passengersOut: '1.5', mtowKg: '78',
      aircraftRegistration: 'HI 1055' }));
    expect(errors).toEqual({
      passengersIn: 'Debe ser de 0 a 999 pasajeros.',
      passengersOut: 'Escribe un número entero de 0 a 999, sin puntos ni decimales.',
      mtowKg: '¿Toneladas? El MTOW va en kg: 78 t son 78,000 kg.',
      aircraftRegistration: 'Usa de 2 a 10 letras, números o guiones, como HI1055.',
    });
    expect(values).toEqual({ passengersIn: null, passengersOut: null, mtowKg: null, aircraftRegistration: null });
  });

  test('the edges of the ranges', () => {
    expect(validateFlightDataDraft(draft({ passengersIn: '0', passengersOut: '999', mtowKg: '1 000' }))).toEqual({
      values: { passengersIn: 0, passengersOut: 999, mtowKg: 1000, aircraftRegistration: null }, errors: {} });
    expect(validateFlightDataDraft(draft({ mtowKg: '700000' })).values.mtowKg).toBe(700000);
    expect(validateFlightDataDraft(draft({ passengersIn: '1000', passengersOut: '1 000' })).errors).toEqual({
      passengersIn: 'Debe ser de 0 a 999 pasajeros.', passengersOut: 'Debe ser de 0 a 999 pasajeros.' });
  });

  test.each([
    ['1', '¿Toneladas? El MTOW va en kg: 1 t son 1,000 kg.'],
    ['999', '¿Toneladas? El MTOW va en kg: 999 t son 999,000 kg.'],
    ['0', 'Debe ser de 1,000 a 700,000 kg.'],
    ['700001', 'Debe ser de 1,000 a 700,000 kg.'],
    ['78.5', 'Escribe los kg con un número entero, sin puntos ni decimales.'],
    ['-78000', 'Escribe los kg con un número entero, sin puntos ni decimales.'],
  ])('an MTOW of «%s»: «%s»', (mtowKg, message) => {
    expect(validateFlightDataDraft(draft({ mtowKg })).errors).toEqual({ mtowKg: message });
  });

  test.each(['-5', '1.5', 'abc'])('«%s» passengers are refused', passengersIn => {
    expect(validateFlightDataDraft(draft({ passengersIn })).errors).toEqual({
      passengersIn: 'Escribe un número entero de 0 a 999, sin puntos ni decimales.' });
  });

  test('the fields, their labels and their placeholders with the range and the unit', () => {
    expect(FLIGHT_DATA_FIELDS).toEqual(['passengersIn', 'passengersOut', 'mtowKg', 'aircraftRegistration']);
    expect(FLIGHT_DATA_FIELDS.map(field => FLIGHT_DATA_LABELS[field])).toEqual([
      'Pasajeros que llegan', 'Pasajeros que salen', 'MTOW (kg)', 'Matrícula']);
    expect(FLIGHT_DATA_FIELDS.map(field => FLIGHT_DATA_PLACEHOLDERS[field])).toEqual([
      '0 a 999', '0 a 999', '1,000 a 700,000 kg', 'Como HI1055']);
  });
});

describe('missing flight data (S1, D-S1)', () => {
  test('lists the passengers and the MTOW still missing, in the forms’ order; 0 passengers is a value', () => {
    expect(missingFlightData({ passengersIn: 0, passengersOut: 0, mtowKg: 70000 })).toEqual([]);
    expect(missingFlightData({ passengersIn: null, passengersOut: 12, mtowKg: null })).toEqual(['passengersIn', 'mtowKg']);
    expect(missingFlightData({})).toEqual(['passengersIn', 'passengersOut', 'mtowKg']);
  });

  test('without a summary to read, it cannot tell: null', () => {
    expect(missingFlightData(undefined)).toBeNull();
    expect(missingFlightData(null)).toBeNull();
  });

  test('the card’s line names what is missing and agrees with it', () => {
    expect(missingFlightDataLine([])).toBeNull();
    expect(missingFlightDataLine(['mtowKg'])).toBe('Falta: MTOW.');
    expect(missingFlightDataLine(['passengersOut'])).toBe('Faltan: pasajeros que salen.');
    expect(missingFlightDataLine(['passengersIn', 'passengersOut', 'mtowKg']))
      .toBe('Faltan: pasajeros que llegan, pasajeros que salen y MTOW.');
  });

  const open = { signed: false, queued: false, editable: true };
  test.each([
    ['to write before signing', open, ['passengersIn', 'mtowKg'],
      'Faltan los pasajeros que llegan y el MTOW en la Orden. Escríbelos en «Datos del vuelo» antes de firmar.'],
    ['to write before signing, one value', open, ['mtowKg'],
      'Falta el MTOW en la Orden. Escríbelo en «Datos del vuelo» antes de firmar.'],
    ['signed: saving them asks for the signature again', { ...open, signed: true }, ['mtowKg'],
      'Falta el MTOW en la Orden. Si lo guardas ahora en «Datos del vuelo», hay que volver a firmarla.'],
    ['signed, at the hand-off', { ...open, signed: true, handoff: true }, ['passengersIn', 'passengersOut'],
      'Faltan los pasajeros que llegan y los pasajeros que salen en la Orden. Puedes entregar sin ellos; si los ' +
      'guardas ahora, hay que volver a firmarla.'],
    ['signed, at the hand-off, one value', { ...open, signed: true, handoff: true }, ['mtowKg'],
      'Falta el MTOW en la Orden. Puedes entregar sin él; si lo guardas ahora, hay que volver a firmarla.'],
    ['saved on the device, on its way', { ...open, queued: true }, ['mtowKg'],
      'Falta el MTOW en la Orden. Lo que guardaste en «Datos del vuelo» llega a la Orden cuando se envíe a ELEVANT.'],
    ['the execution closed', { ...open, signed: true, editable: false }, ['passengersIn', 'passengersOut', 'mtowKg'],
      'Faltan los pasajeros que llegan, los pasajeros que salen y el MTOW en la Orden.'],
  ])('the Service Order’s warning, %s', (_description, situation, missing, text) => {
    expect(orderFlightDataWarning(missing, situation)).toBe(text);
  });

  test('with nothing missing the Service Order has no warning', () => {
    expect(orderFlightDataWarning([], open)).toBeNull();
  });
});
