import { expect, it } from 'vitest';
import { normalizedAirlineVerification } from '@elevant/api-client';
import { AIRLINE_IDENTITY_MESSAGES, airlineIdentityErrors } from './airlineIdentity';

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
