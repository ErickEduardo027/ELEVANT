/**
 * The notices about records this tablet keeps and ELEVANT has not confirmed yet (3-N12). Nothing unsent is erased when
 * a session ends: it stays bound to the account that recorded it and only that account sends it after signing in.
 */
const records = (count: number) => `${count} ${count === 1 ? 'registro' : 'registros'}`;

/** On the access screen: everything the tablet keeps, whoever recorded it; null when nothing waits. */
export function loginPendingEvidenceNotice(count: number, notice?: string): string | null {
  if (count <= 0) return null;
  if (notice === 'session_expired') {
    return `Inicia sesión de nuevo para enviar ${records(count)} ${count === 1 ? 'guardado' : 'guardados'} en esta tablet.`;
  }
  return `Esta tablet guarda ${records(count)} sin enviar. Inicia sesión con la cuenta que ${count === 1
    ? 'lo registró para enviarlo' : 'los registró para enviarlos'}; si esa cuenta ya no tiene acceso, avisa a OCC.`;
}

/** Before signing out: what of this account stays on the tablet until it signs in again; null when nothing waits. */
export function signOutPendingEvidenceNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? 'Tienes 1 registro sin enviar en esta tablet. Se conserva al cerrar sesión y se envía cuando vuelvas a entrar con tu cuenta.'
    : `Tienes ${count} registros sin enviar en esta tablet. Se conservan al cerrar sesión y se envían cuando vuelvas a entrar con tu cuenta.`;
}

/** In «Sincronización»: records of other accounts, which this one can neither see nor discard; null when none. */
export function otherAccountsPendingEvidenceNote(count: number): string | null {
  if (count <= 0) return null;
  return `Esta tablet guarda además ${records(count)} sin enviar de otra cuenta. Solo esa cuenta ${count === 1
    ? 'puede enviarlo' : 'puede enviarlos'} al iniciar sesión; si ya no tiene acceso, avisa a OCC.`;
}
