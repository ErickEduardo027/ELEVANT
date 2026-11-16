// Character sets without look-alikes (0/O, 1/l/I) so a password read aloud or copied by hand survives.
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!#$%*+-=?@_';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Uniform index in [0, size) from the platform CSPRNG, rejecting values that would bias the modulo. */
function randomIndex(size, random) {
  const limit = Math.floor(0x1_0000_0000 / size) * size;
  const buffer = new Uint32Array(1);
  for (;;) {
    random(buffer);
    if (buffer[0] < limit) return buffer[0] % size;
  }
}

/**
 * Temporary password that satisfies the account policy (14+ characters with lower case, upper case,
 * digit and symbol). It is shown once to the person creating the account and never stored here.
 */
export function generateTemporaryPassword(length = 16, random = values => globalThis.crypto.getRandomValues(values)) {
  if (length < 14) throw new RangeError('Temporary passwords need at least 14 characters.');
  const pick = set => set[randomIndex(set.length, random)];
  const characters = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (characters.length < length) characters.push(pick(ALL));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1, random);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join('');
}
