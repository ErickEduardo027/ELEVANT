/**
 * Spanish labels of the email outbox (ADR-0022, 1-N22): what each email is for, its delivery state and why it was
 * not sent. The API sends codes only, never the mail server's text, and no screen claims that a queued email was
 * sent (1-N08).
 */

export const EMAIL_PURPOSES = Object.freeze({
  Activation: 'Activación de cuenta',
  LoginCode: 'Código de acceso',
  PasswordReset: 'Recuperación de contraseña',
  Test: 'Prueba',
  ContractActivated: 'Contrato activo',
  InvoiceIssued: 'Factura emitida',
  PaymentReceived: 'Pago recibido',
  CommercialDecision: 'Decisión de solicitud',
  // Phase 2, block B: what the airline is told about its contracts and permits.
  ContractReadyToSign: 'Contrato listo para firmar',
  PermitRejected: 'Permiso rechazado',
  PermitRevoked: 'Verificación de permiso revocada',
  PermitExpiring: 'Permiso por vencer',
  ContractExpiring: 'Contrato por vencer',
  ContractSuspended: 'Contrato suspendido',
  // Phase 2, block E: the representatives learn who joined, left or changed role in their portal (2-N20).
  PortalUserChanged: 'Cambio de usuarios del portal',
});

export const EMAIL_STATUSES = Object.freeze({
  Pending: { label: 'En cola', tone: 'warning' },
  Sent: { label: 'Enviado', tone: 'success' },
  Failed: { label: 'Falló', tone: 'danger' },
  Discarded: { label: 'Descartado', tone: 'neutral' },
});

export const EMAIL_REASONS = Object.freeze({
  expired: 'Venció antes de enviarse: el enlace o el código ya no servía.',
  superseded: 'Lo reemplazó un envío más reciente.',
  invitation_closed: 'La invitación se cerró con una contraseña temporal.',
  smtp_rejected: 'El servidor de correo rechazó el mensaje o el destinatario.',
  smtp_authentication: 'El servidor de correo rechazó las credenciales de la cuenta no-reply.',
  smtp_unavailable: 'No se pudo conectar con el servidor de correo.',
  attachment_unavailable: 'El documento adjunto ya no está disponible.',
  send_failed: 'El envío falló por un motivo no identificado.',
});

export const EMAIL_REFERENCE_KINDS = Object.freeze({
  contract: 'Contrato',
  invoice: 'Factura',
  payment: 'Pago de la factura',
  account: 'Cuenta de',
  request: 'Solicitud',
});

/** What to do when an email of this purpose did not go out. */
export const EMAIL_RECOVERY = Object.freeze({
  Activation: 'Para un enlace nuevo use «Reenviar invitación» en Clientes, o asigne una contraseña temporal.',
  LoginCode: 'El usuario puede pedir un código nuevo al iniciar sesión.',
  PasswordReset: 'El usuario puede pedir otro enlace con «¿Olvidaste tu contraseña?».',
  ContractActivated: 'El contrato firmado sigue disponible en el portal; entréguelo por otro canal si hace falta.',
  InvoiceIssued: 'Descargue el PDF de la factura y entréguelo por otro canal.',
  PaymentReceived: 'El recibo sigue disponible en el portal de la aerolínea.',
  CommercialDecision: 'Comunique la decisión al solicitante por otro canal.',
  ContractReadyToSign: 'El contrato sigue disponible para firmar en el portal; avise a la aerolínea por otro canal.',
  PermitRejected: 'La aerolínea ve el motivo del rechazo en su portal; avísele por otro canal si hace falta.',
  PermitRevoked: 'La aerolínea ve la revocación y su motivo en su portal; avísele por otro canal si hace falta.',
  PermitExpiring: 'El vencimiento se ve en el portal de la aerolínea; recuérdeselo por otro canal.',
  ContractExpiring: 'El vencimiento se ve en el portal de la aerolínea; recuérdeselo por otro canal.',
  ContractSuspended: 'El estado del contrato se ve en el portal de la aerolínea; avísele por otro canal.',
  PortalUserChanged: 'Los representantes ven sus usuarios y roles en el portal; avíseles del cambio por otro canal si hace falta.',
});

/**
 * Discards that need nothing (1-N09, 1-N12): a newer email replaced this one, or a temporary password closed the
 * invitation. Resending would only replace the link the user may already have.
 */
export const EMAIL_NO_ACTION = Object.freeze({
  superseded: 'No requiere acción: hay un envío más reciente.',
  invitation_closed: 'No requiere acción: la cuenta ya tiene una contraseña temporal.',
});

export const purposeLabel = purpose => EMAIL_PURPOSES[purpose] ?? 'Correo del sistema';
export const statusLabel = status => EMAIL_STATUSES[status] ?? { label: 'Desconocido', tone: 'neutral' };
export const reasonLabel = reason => (reason ? EMAIL_REASONS[reason] ?? EMAIL_REASONS.send_failed : null);

/**
 * What the outbox says under an email that did not go out: how to recover it (it failed, or its link or code
 * expired in the queue) or that nothing is needed. Null while the email is queued or once it was sent.
 *
 * @param {{ status?: string, reason?: string | null, purpose?: string }} item
 * @returns {{ text: string, needsAction: boolean } | null}
 */
export function recoveryHint(item) {
  if (item?.status !== 'Failed' && item?.status !== 'Discarded') return null;
  if (item.status === 'Discarded' && typeof item.reason === 'string' && Object.hasOwn(EMAIL_NO_ACTION, item.reason))
    return { text: EMAIL_NO_ACTION[item.reason], needsAction: false };
  const text = EMAIL_RECOVERY[item.purpose];
  return text ? { text, needsAction: true } : null;
}

/** «Contrato DEV-CONTRACT-0001 · Demo Airlines», «Cuenta de Ana Rivera · Demo Airlines»… */
export function referenceLabel(reference) {
  if (!reference) return null;
  const kind = EMAIL_REFERENCE_KINDS[reference.kind];
  if (!kind) return null;
  return [`${kind} ${reference.label}`.trim(), reference.context].filter(Boolean).join(' · ');
}
