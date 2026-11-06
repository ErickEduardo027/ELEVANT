/**
 * Billing units are stored by their code in the whole commercial cycle (phase 1, 1-E). These helpers
 * show a unit in Spanish and map a legacy name («operación») to its code, using the units Finance
 * maintains («Unidades de cobro») when the screen has them.
 */

/** Spanish nouns of the units every environment starts with, for screens without the unit list. */
const KNOWN_UNIT_NAMES = Object.freeze({
  operation: 'operación', aircraft: 'aeronave', passenger: 'pasajero', ton: 'tonelada', hour: 'hora',
  minute: 'minuto', unit: 'unidad', service: 'servicio', day: 'día',
});

/** Lower case without accents: «Operación» and «operacion» name the same unit. */
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

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
