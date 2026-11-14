// The tone of a hand-off's state for OccStatusPill (design B.4, «cabina oscura»): pure.
// - PendingReview waits for OCC like a planned state (neutral); InReview is being worked (active); Approved is done;
//   Returned went back to the ramp to be corrected (attention); any state this screen does not know is muted.
// - A reopened revision asks for attention while it waits for its new decision (3-H): OCC corrects it here.

/** The tone of each submission state the API sends (occReviewStatuses of the shared client). */
export const REVIEW_STATUS_TONES = Object.freeze({
  PendingReview: 'neutral',
  InReview: 'active',
  Approved: 'done',
  Returned: 'attention',
});

const OPEN = new Set(['PendingReview', 'InReview']);

/**
 * The OccStatusPill tone of a submission `status`. `reopened` marks a revision OCC reopened from an approval: while it
 * is still open (pending or in review) it reads as attention; once decided it takes the tone of its decision.
 */
export function reviewStatusTone(status, { reopened = false } = {}) {
  const tone = typeof status === 'string' && Object.hasOwn(REVIEW_STATUS_TONES, status)
    ? REVIEW_STATUS_TONES[status] : 'muted';
  return reopened && OPEN.has(status) ? 'attention' : tone;
}
