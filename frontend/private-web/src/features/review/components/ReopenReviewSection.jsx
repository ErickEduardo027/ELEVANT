import { useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { reopenOccReview } from '../../../services/occReviewService';
import { reviewMessages } from '../reviewMessages';

const REOPEN = 'operations.review.reopen';

/**
 * «Reabrir revisión» (3-H): an account with `operations.review.reopen` sends an approved hand-off back to Pending review
 * with a reason, while nothing was invoiced from it. The flight, its agents and its stand stay as the approval left them;
 * OCC corrects the new revision and approves it again. The intent's Idempotency-Key replays a reopening whose answer was
 * lost; a refusal of the server (`already_invoiced`, a stale version) is reported by `onRefused`, which re-reads.
 */
export default function ReopenReviewSection({ detail, disabled, onReopened, onRefused }) {
  const { t } = useTranslation(reviewMessages);
  const access = useOptionalDepartmentAccess();
  const keys = useRef(createCommandKeyHolder());
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (detail.status !== 'Approved' || !access?.can(REOPEN)) return null;
  const trimmed = reason.trim();
  const valid = trimmed.length >= 8 && trimmed.length <= 2000;
  // 3-N02: the reopened revision is approved again only on a signed order, so an unsigned approval is not reopened.
  const signedOrder = !detail.serviceOrderState || detail.serviceOrderState === 'Signed' ||
    detail.serviceOrderState === 'Corrected';
  if (!signedOrder) {
    return (
      <section aria-label={t('reopen.title')} className="border-t border-black/10 pt-4 dark:border-white/10">
        <p role="note" className="text-sm">{t('reopen.unsigned')}</p>
      </section>
    );
  }

  function close() {
    setOpen(false);
    setReason('');
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !valid) return;
    const command = { submissionId: detail.submissionId, reason: trimmed };
    setBusy(true);
    setError('');
    try {
      const result = await keys.current.run('reopen',
        { operationId: detail.operationId, ...command, version: detail.reviewVersion },
        key => reopenOccReview(detail.operationId, command, detail.reviewVersion, key));
      close();
      onReopened(t('reopen.done', { number: result.revisionNumber }));
    } catch (failure) {
      if (failure?.status === 409 || failure?.status === 412) {
        close();
        onRefused(failure.message);
      } else {
        setError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t('reopen.title')} className="space-y-3 border-t border-black/10 pt-4 dark:border-white/10">
      <p className="text-sm">{t('reopen.intro')}</p>
      {!open ? (
        <button type="button" disabled={disabled} onClick={() => setOpen(true)}
          className="min-h-11 rounded-lg border border-status-warning px-4 py-2 font-semibold disabled:opacity-50">
          {t('reopen.open')}
        </button>
      ) : (
        <form onSubmit={event => void submit(event)} className="space-y-3 rounded-xl border border-status-warning/40 p-4">
          <label className="block text-sm">{t('reopen.reason')}
            <textarea value={reason} onChange={event => setReason(event.target.value)} required minLength={8} maxLength={2000}
              rows={3} className="mt-1 block w-full rounded-lg border border-black/20 bg-white p-3 text-ink-900" />
          </label>
          {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={disabled || busy || !valid}
              className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? t('reopen.confirming') : t('reopen.confirm')}
            </button>
            <button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-lg border px-4 py-2">
              {t('reopen.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
