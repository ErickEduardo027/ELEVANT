/**
 * Billing units are stored by their code in the whole commercial cycle (phase 1, 1-E). These helpers
 * show a unit in Spanish, write a quantity with its unit and map a legacy name («operación») to its
 * code, using the units Finance maintains («Unidades de cobro») when the screen has them.
 */

/**
 * The singular and plural nouns of the units every environment starts with, in Spanish and English. The
 * Spanish ones are the words decided for the tablet too (D-S5: hora/horas, operación/operaciones), so OCC
 * and the agent read a quantity the same way.
 */
const UNIT_WORDS = Object.freeze({
  operation: Object.freeze({ es: ['operación', 'operaciones'], en: ['operation', 'operations'] }),
  aircraft: Object.freeze({ es: ['aeronave', 'aeronaves'], en: ['aircraft', 'aircraft'] }),
  passenger: Object.freeze({ es: ['pasajero', 'pasajeros'], en: ['passenger', 'passengers'] }),
  ton: Object.freeze({ es: ['tonelada', 'toneladas'], en: ['ton', 'tons'] }),
  hour: Object.freeze({ es: ['hora', 'horas'], en: ['hour', 'hours'] }),
  minute: Object.freeze({ es: ['minuto', 'minutos'], en: ['minute', 'minutes'] }),
  unit: Object.freeze({ es: ['unidad', 'unidades'], en: ['unit', 'units'] }),
  service: Object.freeze({ es: ['servicio', 'servicios'], en: ['service', 'services'] }),
  day: Object.freeze({ es: ['día', 'días'], en: ['day', 'days'] }),
});

/** Spanish nouns of the units every environment starts with, for screens without the unit list. */
const KNOWN_UNIT_NAMES = Object.freeze(Object.fromEntries(Object.entries(UNIT_WORDS)
  .map(([code, words]) => [code, words.es[0]])));

/** Lower case without accents: «Operación» and «operacion» name the same unit. */
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** The known unit a code or its Spanish name names, in any casing and with or without accents; otherwise null. */
function knownUnit(text) {
  if (Object.hasOwn(UNIT_WORDS, text)) return text;
  const folded = fold(text);
  return Object.keys(UNIT_WORDS).find(code => code === folded || fold(UNIT_WORDS[code].es[0]) === folded) ?? null;
}

const active = units => (units ?? []).filter(unit => unit && unit.isActive !== false);

/**
 * Code of the active unit that a code or a name (any casing, with or without accents) names.
 * @param {string | null | undefined} value
 * @param {Array<{ code: string, name: string, isActive?: boolean }>} [units]
 * @returns {string | null}
 */
export function billingUnitCode(value, units = []) {
  const text = fold(value);
  if (!text) return null;
  const options = active(units);
  return options.find(unit => fold(unit.code) === text)?.code
    ?? options.find(unit => fold(unit.name) === text)?.code ?? null;
}

/**
 * The unit to propose for a service: its default unit when it names an active unit, otherwise the first
 * active unit, so a new rate never starts with a unit the save rejects.
 */
export function proposedBillingUnit(defaultUnit, units = []) {
  return billingUnitCode(defaultUnit, units) ?? active(units)[0]?.code ?? '';
}

/**
 * Spanish lower-case noun of a unit code or a legacy name («operación», «hora»…), for «por …» texts.
 * An unknown text is shown as it is.
 */
export function billingUnitLabel(value, units = []) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const list = units ?? [];
  const unit = list.find(item => item.code === text) ?? list.find(item => fold(item.name) === fold(text));
  if (unit) return String(unit.name).trim().toLocaleLowerCase('es');
  return KNOWN_UNIT_NAMES[text] ?? text;
}

/**
 * A quantity with its unit, in the nouns of UNIT_WORDS: «1 hora», «2 horas», «0.5 horas», «0 operaciones», and in
 * English «2 operations». The number keeps up to the four decimals of a quantity, in the format of `locale` (es-DO
 * writes «0.5»), and the noun is singular only for a number that reads 1. An English `locale` picks the English
 * nouns, any other the Spanish ones. A unit that is not one of the units every environment starts with is never
 * inflected: «2 × código». Without a unit it is the number alone, and without a finite quantity, an empty text.
 * @param {number} quantity
 * @param {string | null | undefined} code a unit code or a legacy name («operación»)
 * @param {string} [locale]
 * @returns {string}
 */
export function billingUnitQuantity(quantity, code, locale = 'es-DO') {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return '';
  const tag = typeof locale === 'string' && locale.trim() ? locale.trim() : 'es-DO';
  const rounded = Math.round(quantity * 10_000) / 10_000;
  const number = new Intl.NumberFormat(tag, { maximumFractionDigits: 4 }).format(rounded);
  const text = String(code ?? '').trim();
  if (!text) return number;
  const unit = knownUnit(text);
  if (unit === null) return `${number} × ${text}`;
  const [one, other] = UNIT_WORDS[unit][/^en(?:-|$)/i.test(tag) ? 'en' : 'es'];
  return `${number} ${rounded === 1 ? one : other}`;
}
