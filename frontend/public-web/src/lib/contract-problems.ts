import { ElevantApiError } from "@elevant/api-client";

/**
 * Spanish explanation of the Problem Details codes the airline may meet on its contract documents
 * (phase 2, block A): the signature, the content that changed while it read it and a contract that is
 * terminated or ends before the version starts. The portal never shows the server title.
 */
export const CONTRACT_PROBLEMS: Readonly<Record<string, string>> = Object.freeze({
  validity_pending: "Contratos aún está fijando la vigencia; podrá firmar cuando la confirme.",
  content_changed: "El contrato cambió mientras lo revisaba; se volvió a cargar. Revíselo antes de firmar.",
  already_signed: "Su aerolínea ya firmó esta versión; se volvió a cargar.",
  not_approved: "Esta versión ya no está disponible para firmar; se volvió a cargar.",
  contract_terminated: "El contrato está terminado: esta versión ya no se firma.",
  termination_scheduled: "El contrato termina antes de que empiece esta versión: ya no se firma.",
  signature_invalid: "Escriba su nombre completo y cargo y confirme que acepta el contrato.",
  signature_image_invalid: "Dibuje su firma de nuevo: la imagen no es válida.",
  idempotency_conflict: "Esa firma ya se envió con otros datos. Actualice la página e intente de nuevo.",
});

const STATUS_PROBLEMS: Readonly<Record<number, string>> = Object.freeze({
  403: "Su cuenta no puede firmar este contrato.",
  404: "Esta versión ya no tiene documento disponible.",
  409: "El contrato cambió o ya fue firmado; se volvió a cargar. Revíselo antes de firmar.",
});

/** Message for a failed contract call: the code first, then the status, then `fallback`. */
export function contractProblem(error: unknown,
  fallback = "No fue posible completar la operación. Intente de nuevo."): string {
  if (!(error instanceof ElevantApiError)) return fallback;
  if (error.code && Object.prototype.hasOwnProperty.call(CONTRACT_PROBLEMS, error.code)) return CONTRACT_PROBLEMS[error.code]!;
  return STATUS_PROBLEMS[error.status] ?? fallback;
}
