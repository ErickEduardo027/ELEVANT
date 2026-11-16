import { isForbidden } from '../../../services/problemMessages';

/**
 * Why a Finance list could not be read: its Spanish message and whether a retry can help. Without
 * the permission (403) the view shows its unauthorized state, which «Reintentar» does not fix.
 * @param {unknown} error @param {string} text
 */
export const loadFailure = (error, text) => ({ text, forbidden: isForbidden(error) });

/**
 * The recoverable error of a Finance list (phase 1, 1-E): the message with «Reintentar», or only
 * the message when the user lacks the permission. A failure never shows the empty state.
 */
export default function LoadFailure({ failure, onRetry }) {
  if (!failure) return null;
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">
    <span>{failure.text}</span>
    {!failure.forbidden && <button type="button" onClick={onRetry}
      className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button>}
  </div>;
}
