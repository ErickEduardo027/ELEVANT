/**
 * The contracts and operations of the portal carry billing unit codes (phase 1, 1-E). The portal shows
 * them in Spanish; a unit it does not know, or a legacy name, is shown as it is.
 */
const UNIT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  operation: "operación",
  aircraft: "aeronave",
  passenger: "pasajero",
  ton: "tonelada",
  hour: "hora",
  minute: "minuto",
  unit: "unidad",
  service: "servicio",
  day: "día",
});

/** Spanish lower-case noun of a billing unit, for «Precio por …» texts. */
export function billingUnitLabel(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return Object.prototype.hasOwnProperty.call(UNIT_NAMES, text) ? UNIT_NAMES[text]! : text;
}
