import { ElevantApiError } from "@elevant/api-client";

/**
 * Spanish explanation of the Problem Details codes of the card payment and the billing documents of the portal (phase 4,
 * block C). The code names the cause; an older server that only sends `reasons` is read by its first reason. The portal
 * never shows the server title.
 */
export const BILLING_PROBLEMS: Readonly<Record<string, string>> = Object.freeze({
  // 4-N05: this environment has no card gateway.
  card_payments_unavailable: "El pago con tarjeta no está disponible en este momento. Para pagar, contacta a Finanzas de AVIAM.",
  card_payment_invalid: "Revisa los datos de la tarjeta.",
  card_payment_conflict: "No se pudo procesar el pago. Actualizamos la factura: revísala e inténtalo de nuevo.",
  // 4-N24: an invoice credited in full was never paid; «sin saldo» covers both.
  invoice_paid: "Esta factura no tiene saldo pendiente.",
  amount_mismatch: "El saldo cambió. Actualizamos la factura: revisa el monto.",
  concurrent_payment: "Otro pago de esta factura está en curso. Actualizamos la factura: revísala antes de reintentar.",
  idempotency_conflict: "El intento cambió. Vuelve a enviar el pago.",
  idempotency_key_required: "No se pudo identificar el intento. Vuelve a enviar el pago.",
  not_found: "La factura ya no está disponible para esta cuenta.",
  forbidden: "Tu cuenta no puede pagar las facturas de esta aerolínea.",
});

/** The rule a card broke before reaching the gateway, named in `reasons` of a `card_payment_invalid`. */
export const CARD_REASONS: Readonly<Record<string, string>> = Object.freeze({
  cardholder_invalid: "Escribe el nombre del titular.",
  card_number_invalid: "El número de tarjeta no es válido.",
  card_expired: "La fecha de vencimiento ya pasó.",
  security_code_invalid: "El código de seguridad no es válido.",
  amount_invalid: "El monto no es válido. Actualizamos la factura: revisa el saldo.",
});

/** The codes after which the invoice is read again: its balance, its state or the gateway changed. */
const REFRESH = new Set(["amount_mismatch", "invoice_paid", "concurrent_payment", "card_payment_conflict",
  "card_payments_unavailable", "not_found"]);

const own = (map: Readonly<Record<string, string>>, key: string | undefined): key is string =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key);

/**
 * The outcome of a failed card payment: the message, the code it was read from and whether the invoice must be read
 * again. A 4xx is an answer of the server: the next attempt is a new intent. Anything else is uncertain and is retried
 * with the same key, so the card is never charged twice.
 */
export function cardPaymentProblem(error: unknown): { text: string; code: string | null; refresh: boolean; uncertain: boolean } {
  if (!(error instanceof ElevantApiError) || error.kind !== "http" || error.status < 400 || error.status >= 500)
    return { text: "No se pudo confirmar el pago. Reintenta: no se cobrará dos veces.", code: null, refresh: false,
      uncertain: true };
  const reason = error.reasons[0];
  const code = error.code ?? reason;
  // A broken card rule is named by its reason, under card_payment_invalid or, from an older server, with no code at all.
  if ((error.code === undefined || error.code === "card_payment_invalid") && own(CARD_REASONS, reason))
    return { text: CARD_REASONS[reason], code: error.code ?? reason, refresh: reason === "amount_invalid", uncertain: false };
  if (own(BILLING_PROBLEMS, code)) return { text: BILLING_PROBLEMS[code], code, refresh: REFRESH.has(code), uncertain: false };
  if (error.status === 403) return { text: BILLING_PROBLEMS.forbidden!, code: "forbidden", refresh: false, uncertain: false };
  return { text: "No se pudo procesar el pago. Revisa los datos e inténtalo de nuevo.", code: code ?? null,
    refresh: error.status === 409, uncertain: false };
}
