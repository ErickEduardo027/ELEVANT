import { describe, expect, it } from 'vitest';
import { OCC_STATUS_TONE_KEYS } from '../occ-ui/statusVocabulary';
import { SUBMISSION_STATUS_LABELS } from '../operations/operationLabels';
import { REVIEW_STATUS_TONES, reviewStatusTone } from './reviewStatusTone';

describe('reviewStatusTone', () => {
  it('maps every submission status to one tone and an unknown one to muted', () => {
    // The four states the API sends, as the shared labels list them.
    expect(Object.keys(REVIEW_STATUS_TONES).sort()).toEqual(Object.keys(SUBMISSION_STATUS_LABELS).sort());
    expect(Object.isFrozen(REVIEW_STATUS_TONES)).toBe(true);
    expect(reviewStatusTone('PendingReview')).toBe('neutral');
    expect(reviewStatusTone('InReview')).toBe('active');
    expect(reviewStatusTone('Approved')).toBe('done');
    expect(reviewStatusTone('Returned')).toBe('attention');
    for (const tone of Object.values(REVIEW_STATUS_TONES)) expect(OCC_STATUS_TONE_KEYS).toContain(tone);
    // A state this screen does not know, or none at all, never borrows a signal.
    for (const unknown of ['Archived', '', null, undefined, 42, 'toString', 'constructor']) {
      expect(reviewStatusTone(unknown), String(unknown)).toBe('muted');
    }
  });

  it('marks a reopened revision as attention until it is decided again', () => {
    expect(reviewStatusTone('PendingReview', { reopened: true })).toBe('attention');
    expect(reviewStatusTone('InReview', { reopened: true })).toBe('attention');
    expect(reviewStatusTone('Approved', { reopened: true })).toBe('done');
    expect(reviewStatusTone('Returned', { reopened: true })).toBe('attention');
    expect(reviewStatusTone('Archived', { reopened: true })).toBe('muted');
    expect(reviewStatusTone('PendingReview', { reopened: false })).toBe('neutral');
  });
});
