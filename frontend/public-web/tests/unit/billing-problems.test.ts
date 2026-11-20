import { expect, it } from "vitest";
import { ElevantApiError, type ElevantApiErrorCode } from "@elevant/api-client";

import { cardPaymentProblem } from "@/lib/billing-problems";

const refused = (status: number, code?: ElevantApiErrorCode, reasons?: string[]) =>
  new ElevantApiError({ kind: "http", status, code, reasons });

// N19: the card payment addresses the airline as usted, like the rest of the portal.
it.each([
  ["card_payments_unavailable", refused(409, "card_payments_unavailable"),
    "El pago con tarjeta no está disponible en este momento. Para pagar, contacte a Finanzas de AVIAM."],
  ["card_payment_invalid", refused(400, "card_payment_invalid"), "Revise los datos de la tarjeta."],
  ["card_payment_conflict", refused(409, "card_payment_conflict"),
    "No se pudo procesar el pago. Actualizamos la factura: revísela e inténtelo de nuevo."],
  ["amount_mismatch", refused(409, "amount_mismatch"), "El saldo cambió. Actualizamos la factura: revise el monto."],
  ["concurrent_payment", refused(409, "concurrent_payment"),
    "Otro pago de esta factura está en curso. Actualizamos la factura: revísela antes de reintentar."],
  ["idempotency_conflict", refused(409, "idempotency_conflict"), "El intento cambió. Vuelva a enviar el pago."],
  ["idempotency_key_required", refused(400, "idempotency_key_required"),
    "No se pudo identificar el intento. Vuelva a enviar el pago."],
  ["a 403", refused(403), "Su cuenta no puede pagar las facturas de esta aerolínea."],
  ["cardholder_invalid", refused(400, "card_payment_invalid", ["cardholder_invalid"]), "Escriba el nombre del titular."],
  ["amount_invalid", refused(400, "card_payment_invalid", ["amount_invalid"]),
    "El monto no es válido. Actualizamos la factura: revise el saldo."],
  ["an unknown refusal", refused(422), "No se pudo procesar el pago. Revise los datos e inténtelo de nuevo."],
  ["a lost answer", new TypeError("Failed to fetch"), "No se pudo confirmar el pago. Reintente: no se cobrará dos veces."],
  ["a 503", refused(503), "No se pudo confirmar el pago. Reintente: no se cobrará dos veces."],
])("explains %s as usted (N19)", (_case, error, text) => {
  expect(cardPaymentProblem(error).text).toBe(text);
});
