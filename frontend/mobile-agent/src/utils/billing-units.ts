/**
 * Billing units (S5, D-S5). ELEVANT stores a service's unit by the code of `ref.billing_units` («hour», «operation»),
 * and an older contract may still carry the unit's Spanish name («Operación», «Hora»): the snapshots are never
 * rewritten. The tablet shows the unit in Spanish, as Finance names it, and never the code.
 */

/** The units every environment starts with (Development seed), singular and plural spelled out. */
const UNIT_NAMES: Readonly<Record<string, readonly [singular: string, plural: string]>> = {
  operation: ['operación', 'operaciones'],
  aircraft: ['aeronave', 'aeronaves'],
  passenger: ['pasajero', 'pasajeros'],
  ton: ['tonelada', 'toneladas'],
  hour: ['hora', 'horas'],
  minute: ['minuto', 'minutos'],
  unit: ['unidad', 'unidades'],
  service: ['servicio', 'servicios'],
  day: ['día', 'días'],
};

/**
 * Units that count things take whole numbers only. Only on the tablet: the server keeps accepting four decimals.
 * «Unidad» is not here because Finance admits two decimals for it, and time and weight are measured, not counted.
 */
const COUNT_UNITS = new Set(['operation', 'service', 'aircraft', 'passenger']);

/** Decimals ELEVANT keeps for an executed quantity (`decimal(18, 4)`), whatever its unit. */
export const MAX_QUANTITY_DECIMALS = 4;

/** Lower case without accents or surrounding spaces: «Operación» and «operacion» name the same unit. */
function fold(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

const has = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);

/** The legacy Spanish name of each unit, folded, to its code. */
const NAME_CODES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(UNIT_NAMES).map(([code, [singular]]) => [fold(singular), code]),
);

/**
 * Code of the unit a code (any casing) or a legacy name (with or without accents) names, as private-web's
 * `billingUnitCode` reads it; null for an unknown unit. Own keys only: «constructor» is not a unit.
 */
function unitCode(value: string | null | undefined) {
  const key = fold(value ?? '');
  if (has(UNIT_NAMES, key)) return key;
  return has(NAME_CODES, key) ? NAME_CODES[key] : null;
}

/**
 * The unit in Spanish, singular only for exactly one: «1 hora», «0 horas», «1.5 horas». Without a quantity it names
 * the unit in general, in the plural: «Cantidad ejecutada (horas)». An unknown unit is shown as it is.
 */
export function billingUnitName(unit: string | null | undefined, quantity?: number) {
  const code = unitCode(unit);
  if (code === null) return (unit ?? '').trim();
  const [singular, plural] = UNIT_NAMES[code];
  return quantity === 1 ? singular : plural;
}

/** Decimals the tablet admits for a quantity in the unit: none in a count unit, four in the others and unknown ones. */
export function billingUnitDecimals(unit: string | null | undefined) {
  const code = unitCode(unit);
  return code !== null && COUNT_UNITS.has(code) ? 0 : MAX_QUANTITY_DECIMALS;
}

/** Billing units as the agent says them on the ramp: the Service Order's abbreviations, as its PDF prints them. */
export function billingUnitAbbreviation(unit: string) {
  const key = unit.toLowerCase();
  if (['perhour', 'hour', 'hours'].includes(key)) return 'h';
  if (['perservice', 'service', 'peroperation', 'operation', 'turnaround'].includes(key)) return 'serv.';
  if (['unit', 'perunit', 'each'].includes(key)) return 'unid.';
  return unit;
}
