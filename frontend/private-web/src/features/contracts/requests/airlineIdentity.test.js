import { expect, it } from 'vitest';
import { checkTaxRegistration, normalizedAirlineVerification } from '@elevant/api-client';
import { AIRLINE_IDENTITY_MESSAGES, airlineIdentityErrors, taxProblemMessage } from './airlineIdentity';

const valid = { legalName: 'Compañía Panameña de Aviación, S.A.', countryCode: 'pa', iataCode: '', icaoCode: 'cmp',
  verificationSourceUrl: ' https://www.copaair.com/ ' };

it('accepts the official identity, with or without IATA', () => {
  expect(airlineIdentityErrors(valid)).toEqual({});
  expect(airlineIdentityErrors({ ...valid, iataCode: 'cm' })).toEqual({});
  expect(airlineIdentityErrors({ ...valid, iataCode: 'Q7' })).toEqual({});
});

it('explains every field the api-client or the server would refuse, in form order', () => {
  const cases = [
    [{ legalName: '  ' }, 'legalName'], [{ legalName: 'x'.repeat(201) }, 'legalName'],
    [{ countryCode: 'D' }, 'countryCode'], [{ countryCode: 'D0' }, 'countryCode'], [{ countryCode: 'DOM' }, 'countryCode'],
    [{ iataCode: '12' }, 'iataCode'], [{ iataCode: 'C' }, 'iataCode'], [{ iataCode: 'ZZ' }, 'iataCode'],
    [{ icaoCode: 'CM' }, 'icaoCode'], [{ icaoCode: 'CM1' }, 'icaoCode'], [{ icaoCode: 'ZZZ' }, 'icaoCode'],
    [{ verificationSourceUrl: 'www.copaair.com' }, 'verificationSourceUrl'],
    [{ verificationSourceUrl: 'http://www.copaair.com' }, 'verificationSourceUrl'],
    [{ verificationSourceUrl: 'https://user:secret@copaair.com' }, 'verificationSourceUrl'],
    [{ verificationSourceUrl: `https://copaair.com/${'a'.repeat(500)}` }, 'verificationSourceUrl'],
  ];
  for (const [change, fieldName] of cases)
    expect(airlineIdentityErrors({ ...valid, ...change })).toEqual({ [fieldName]: AIRLINE_IDENTITY_MESSAGES[fieldName] });
  expect(Object.keys(airlineIdentityErrors({}))).toEqual(['legalName', 'countryCode', 'icaoCode', 'verificationSourceUrl']);
});

it('never lets through an identity the api-client refuses before sending it', () => {
  const candidates = [valid, { ...valid, iataCode: '12' }, { ...valid, countryCode: 'D' }, { ...valid, icaoCode: 'CM' },
    { ...valid, verificationSourceUrl: 'www.copaair.com' }, { ...valid, verificationSourceUrl: 'http://copaair.com' },
    { ...valid, legalName: '' }];
  for (const candidate of candidates) {
    const accepted = Object.keys(airlineIdentityErrors(candidate)).length === 0;
    if (accepted) expect(() => normalizedAirlineVerification({ expectedVersion: 'AAAAAAAAB9E=', ...candidate })).not.toThrow();
    else expect(() => normalizedAirlineVerification({ expectedVersion: 'AAAAAAAAB9E=', ...candidate })).toThrow(TypeError);
  }
});

it('asks Contratos for each field as tú (N36)', () => {
  expect(AIRLINE_IDENTITY_MESSAGES).toEqual({
    legalName: 'Escribe la razón social de la aerolínea (hasta 200 caracteres).',
    countryCode: 'Escribe el país con su código ISO de 2 letras, por ejemplo DO.',
    iataCode: 'El código IATA tiene 2 caracteres: dos letras, o una letra y un número. Déjalo vacío si la aerolínea no tiene.',
    icaoCode: 'Escribe el código ICAO de la aerolínea: 3 letras.',
    verificationSourceUrl: 'Escribe la dirección completa de la fuente oficial, que empiece por https://.',
  });
});

it('words as tú the tax identifier problems the api-client writes as usted for the airline portal (N36)', () => {
  expect(taxProblemMessage(checkTaxRegistration('1-31-23456-9', '').problem))
    .toBe('Elige el país que emitió el identificador fiscal.');
  expect(taxProblemMessage(checkTaxRegistration(' ', 'DO').problem)).toBe('Escribe el RNC de la aerolínea.');
  expect(taxProblemMessage(checkTaxRegistration('', 'PA').problem)).toBe('Escribe el identificador fiscal de la aerolínea.');
  // The problems without a form of address pass through as the api-client wrote them.
  expect(taxProblemMessage(checkTaxRegistration('1-31', 'DO').problem)).toBe('El RNC tiene 9 dígitos.');
  expect(taxProblemMessage(checkTaxRegistration('ab', 'PA').problem)).toBe('El identificador fiscal tiene de 3 a 32 caracteres.');
});
