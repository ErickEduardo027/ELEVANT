const { isValidSignerIdentification, normalizeSignerIdentification } = require('../src/utils/signer-identification');

test('the ID or passport is sent without spaces and in capitals', () => {
  expect(normalizeSignerIdentification(' pa 1234567 ')).toBe('PA1234567');
  expect(normalizeSignerIdentification('001-1234567-8')).toBe('001-1234567-8');
  expect(isValidSignerIdentification('pa 1234567')).toBe(true);
  expect(isValidSignerIdentification('passport 99')).toBe(true);
});

test('symbols or too short values are refused before signing', () => {
  expect(isValidSignerIdentification('x#12')).toBe(false);
  expect(isValidSignerIdentification('ab')).toBe(false);
});
