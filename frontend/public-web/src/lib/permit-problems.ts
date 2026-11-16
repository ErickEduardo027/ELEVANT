import { ElevantApiError } from "@elevant/api-client";

/**
 * Spanish explanation of the Problem Details codes of a permit submission (phase 2, block B). Before this map
 * every 400 read as a date problem (2-N30); each code now says what to fix. The portal never shows the server title.
 */
export const PERMIT_PROBLEMS: Readonly<Record<string, string>> = Object.freeze({
  permit_dates_invalid: "La fecha de emisión no puede ser futura y el vencimiento debe ser posterior a la emisión.",
  permit_expired: "El permiso ya está vencido: envíe uno vigente.",
  invalid_permit: "Revise el tipo de documento, el número (hasta 60 caracteres) y el emisor (hasta 120 caracteres).",
  document_invalid: "No se pudo enlazar el documento adjunto: vuelva a adjuntarlo.",
  // 2-N37: an upload older than the media link window may already be cleaned up.
  document_expired: "El documento adjunto se subió hace demasiado tiempo: vuelva a adjuntarlo y envíe el permiso.",
  idempotency_conflict: "Ese envío ya se usó con otros datos. Actualice la página e intente de nuevo.",
  idempotency_key_required: "No se pudo identificar el envío. Intente de nuevo.",
  // 2-N20: the permits that let the contract operate are sent by the airline's representatives and signers.
  signer_required: "Solo los representantes y los firmantes de su aerolínea envían permisos. Pida a su representante que lo marque como firmante en «Perfil».",
});

/** The outcome of a failed submission: the message, and whether the same intent may be retried as it is. */
export function permitProblem(error: unknown): { text: string; retry: boolean } {
  if (error instanceof TypeError) return { retry: false, text: error.message.includes("document")
    ? "El documento debe ser PDF, JPG o PNG de hasta 8 MB." : "Revise los datos: el vencimiento debe ser posterior a la emisión." };
  if (error instanceof ElevantApiError && error.status >= 400 && error.status < 500) {
    if (error.code && Object.prototype.hasOwnProperty.call(PERMIT_PROBLEMS, error.code))
      return { retry: false, text: PERMIT_PROBLEMS[error.code]! };
    if (error.status === 403) return { retry: false, text: "Su cuenta no puede enviar permisos de esta aerolínea." };
    return { retry: false, text: "Revise los datos del permiso e intente de nuevo." };
  }
  // No answer or a server failure: the same key and body are sent again, so it is never duplicated.
  return { retry: true, text: "No se pudo confirmar el envío. Intente de nuevo: el permiso no se enviará dos veces." };
}
