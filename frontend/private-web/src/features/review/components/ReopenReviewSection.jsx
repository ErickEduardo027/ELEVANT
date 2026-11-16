import { useId, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { reopenOccReview } from '../../../services/occReviewService';
import OccButton from '../../occ-ui/OccButton';
import OccDialog from '../../occ-ui/OccDialog';
import { OccTextareaField } from '../../occ-ui/OccField';
import OccGlyph from '../../occ-ui/OccGlyph';
import { reviewMessages } from '../reviewMessages';

const REOPEN = 'operations.review.reopen';

/**
 * «Reabrir revisión» (3-H): an account with `operations.review.reopen` sends an approved hand-off back to Pending review
 * with a reason, while nothing was invoiced from it. The flight, its agents and its stand stay as the approval left them;
 * OCC corrects the new revision and approves it again. The reason is asked in a dialog drawn inside this section, so the
 * review's «Detalle de entrega» still holds its field and buttons. The intent's Idempotency-Key replays a reopening whose
 * answer was lost (the dialog stays open with the same reason); a refusal of the server (`already_invoiced`, a stale
 * version) closes it and is reported by `onRefused`, which re-reads.
 */
export default function ReopenReviewSection({ detail, disabled, onReopened, onRefused }) {
  const { t } = useTranslation(reviewMessages);
  const access = useOptionalDepartmentAccess();
  const keys = useRef(createCommandKeyHolder());
  const reasonRef = useRef(null);
  const formId = useId();
  const introId = useId();
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
      <section aria-label={t('reopen.title')} className="border-t border-occ-line pt-3">
        <p role="note" className="text-sm text-occ-text">{t('reopen.unsigned')}</p>
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
    // A flex column with gaps: a `space-y` margin would also push the dialog's fixed veil down from the top of the window.
    <section aria-label={t('reopen.title')} className="flex flex-col items-start gap-2 border-t border-occ-line pt-3">
      <p id={introId} className="text-sm text-occ-muted">{t('reopen.intro')}</p>
      <OccButton disabled={disabled} onClick={() => setOpen(true)}>{t('reopen.open')}</OccButton>
      {/* The dialog is described by the section's own sentence (what reopening does), so it is not written twice. */}
      <OccDialog open={open} onClose={close} title={t('reopen.title')} busy={busy} initialFocusRef={reasonRef}
        descriptionId={introId}
        footer={(
          <>
            <OccButton type="submit" form={formId} variant="primary" busy={busy} busyLabel={t('reopen.confirming')}
              disabled={disabled || !valid}>
              {t('reopen.confirm')}
            </OccButton>
            <OccButton data-occ-dialog-cancel="" disabled={busy} onClick={close}>{t('reopen.cancel')}</OccButton>
          </>
        )}>
        <form id={formId} onSubmit={event => void submit(event)} className="space-y-3">
          <OccTextareaField ref={reasonRef} label={t('reopen.reason')} value={reason}
            onChange={event => setReason(event.target.value)} required minLength={8} maxLength={2000} rows={3} />
          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-occ-text">
              <OccGlyph name="attention" className="mt-0.5" />
              <span className="min-w-0">{error}</span>
            </p>
          )}
        </form>
      </OccDialog>
    </section>
  );
}
