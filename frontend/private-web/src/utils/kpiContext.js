/**
 * Context for an indicator (no «números fríos»): how many of what, and the share of a whole. The figures come from
 * the same read, so a part and its whole always agree on screen.
 */
const NUMBER = new Intl.NumberFormat('es-DO');
const PERCENT = new Intl.NumberFormat('es-DO', { maximumFractionDigits: 1 });

/** «1 factura», «2 facturas», «0 facturas». */
export const countOf = (count, one, many) => `${NUMBER.format(count)} ${count === 1 ? one : many}`;

/** «33.3 %» of `whole`, or null when there is no whole to compare with. */
export function percentOf(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return `${PERCENT.format(Math.round((part / whole) * 1000) / 10)} %`;
}

/** «de 10 solicitudes · 30 %»: what a count is part of, the noun agreeing with the whole. */
export function partOf(part, whole, one, many) {
  const share = percentOf(part, whole);
  return `de ${countOf(whole, one, many)}${share ? ` · ${share}` : ''}`;
}
