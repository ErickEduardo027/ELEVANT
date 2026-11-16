/**
 * Official identity of the request's airline as Contratos types it (1-N16, 1-N17): the rules the
 * api-client applies before sending it (`normalizedAirlineVerification`) and the designators the
 * server refuses (`AirlineCodes`), each with the Spanish message of its field. The screen checks it
 * before sending, so a refused identity is explained and never looks like a connection failure.
 */
export const AIRLINE_IDENTITY_FIELDS = Object.freeze(['legalName', 'countryCode', 'iataCode', 'icaoCode',
  'verificationSourceUrl']);

export const AIRLINE_IDENTITY_MESSAGES = Object.freeze({
  legalName: 'Escriba la razón social de la aerolínea (hasta 200 caracteres).',
  countryCode: 'Escriba el país con su código ISO de 2 letras, por ejemplo DO.',
  iataCode: 'El código IATA tiene 2 caracteres: dos letras, o una letra y un número. Déjelo vacío si la aerolínea no tiene.',
  icaoCode: 'Escriba el código ICAO de la aerolínea: 3 letras.',
  verificationSourceUrl: 'Escriba la dirección completa de la fuente oficial, que empiece por https://.',
});

// Placeholder designators the server refuses.
const RESERVED_IATA = new Set(['YY', 'ZZ', 'XX', 'QQ']);
const RESERVED_ICAO = new Set(['YYY', 'ZZZ', 'XXX', 'ZXX']);

const text = value => (typeof value === 'string' ? value.trim() : '');
const code = value => text(value).toUpperCase();

function isHttpsSource(value) {
  if (!value || value.length > 512) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

const RULES = {
  legalName: value => text(value).length >= 1 && text(value).length <= 200,
  countryCode: value => /^[A-Z]{2}$/.test(code(value)),
  iataCode: value => {
    const iata = code(value);
    return !iata || (/^[A-Z0-9]{2}$/.test(iata) && !/^\d{2}$/.test(iata) && !RESERVED_IATA.has(iata));
  },
  icaoCode: value => /^[A-Z]{3}$/.test(code(value)) && !RESERVED_ICAO.has(code(value)),
  verificationSourceUrl: value => isHttpsSource(text(value)),
};

/**
 * @param {Record<string, unknown>} identity The form values, keyed like the command.
 * @returns {Partial<Record<string, string>>} The message of every invalid field, in form order.
 */
export function airlineIdentityErrors(identity) {
  return Object.fromEntries(AIRLINE_IDENTITY_FIELDS
    .filter(field => !RULES[field](identity?.[field]))
    .map(field => [field, AIRLINE_IDENTITY_MESSAGES[field]]));
}
