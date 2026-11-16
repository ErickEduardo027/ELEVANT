import { ElevantApiError } from "@elevant/api-client";

/**
 * Spanish explanation of the Problem Details codes of the airline's portal users (phase 2, block E, 2-N20). The
 * portal never shows the server title.
 */
export const PORTAL_USER_PROBLEMS: Readonly<Record<string, string>> = Object.freeze({
  representative_required: "Solo un representante de su aerolínea gestiona los usuarios del portal.",
  portal_user_protected: "Nadie cambia su propio acceso ni el de un representante desde el portal: pídaselo a AVIAM.",
  invalid_portal_user: "Revise el nombre y el apellido (de 2 a 100 caracteres) y el correo.",
  email_in_use: "Ese correo ya tiene una cuenta en ELEVANT. Use otro correo o pida ayuda a AVIAM.",
  invitations_unavailable: "Las invitaciones por correo no están disponibles en este momento. Intente más tarde o contacte a AVIAM.",
  role_missing: "El portal no admite cuentas nuevas en este momento. Contacte a AVIAM.",
  version_conflict: "El usuario cambió mientras revisaba la lista; se volvió a cargar. Revíselo e intente de nuevo.",
  idempotency_conflict: "Ese envío ya se usó con otros datos; se volvió a cargar la lista. Intente de nuevo.",
  idempotency_key_required: "No se pudo identificar el envío. Intente de nuevo.",
  expected_version_required: "Actualice la lista antes de cambiar este usuario.",
  not_found: "El usuario ya no pertenece a su aerolínea; se volvió a cargar la lista.",
  forbidden: "Su cuenta no puede gestionar los usuarios del portal.",
});

const STATUS_PROBLEMS: Readonly<Record<number, string>> = Object.freeze({
  400: PORTAL_USER_PROBLEMS.invalid_portal_user!,
  403: PORTAL_USER_PROBLEMS.forbidden!,
  404: PORTAL_USER_PROBLEMS.not_found!,
  409: PORTAL_USER_PROBLEMS.version_conflict!,
});

/** The outcome of a failed command: its message, and whether the list must be read again before a new intent. */
export function portalUserProblem(error: unknown): { text: string; reload: boolean } {
  if (error instanceof ElevantApiError && error.kind === "http" && error.status >= 400 && error.status < 500) {
    const text = error.code && Object.prototype.hasOwnProperty.call(PORTAL_USER_PROBLEMS, error.code)
      ? PORTAL_USER_PROBLEMS[error.code]! : STATUS_PROBLEMS[error.status] ?? PORTAL_USER_PROBLEMS.invalid_portal_user!;
    return { text, reload: error.status === 404 || error.status === 409 };
  }
  // The client refused the data before sending it.
  if (error instanceof TypeError && /invalid/i.test(error.message))
    return { text: PORTAL_USER_PROBLEMS.invalid_portal_user!, reload: false };
  // No answer, a malformed one or a server failure: the same key and body are sent again, so it never applies twice.
  return { text: "No se pudo confirmar el cambio. Intente de nuevo: no se aplicará dos veces.", reload: false };
}
