import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetReviewStoreForTests,
  approveReviewOperation,
  bulkApproveReviewOperations,
  bulkReturnReviewOperations,
  getReviewOperation,
  getReviewQueue,
  returnReviewOperation,
  startReview,
} from './reviewService';

afterEach(() => {
  __resetReviewStoreForTests();
});

describe('getReviewQueue', () => {
  it('resolves with station, date, and an operations array shaped like the documented contract', async () => {
    const snapshot = await getReviewQueue();
    expect(snapshot).toEqual(
      expect.objectContaining({
        station: expect.objectContaining({ code: 'PUJ' }),
        date: expect.any(String),
        operations: expect.any(Array),
      })
    );
    expect(snapshot.operations.length).toBeGreaterThanOrEqual(15);
    for (const operation of snapshot.operations) {
      expect(operation).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          status: expect.stringMatching(/^(PENDING_REVIEW|IN_REVIEW|APPROVED|RETURNED|RESUBMITTED)$/),
          flight: expect.objectContaining({ number: expect.any(String), airline: expect.any(String) }),
          planned: expect.any(Object),
          actual: expect.any(Object),
          history: expect.any(Array),
        })
      );
    }
  });

  it('covers every documented status at least once', async () => {
    const { operations } = await getReviewQueue();
    const statuses = new Set(operations.map(operation => operation.status));
    expect(statuses).toEqual(new Set(['PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'RETURNED', 'RESUBMITTED']));
  });

  it('includes at least one operation with a critical planning-vs-execution discrepancy (REV-1003)', async () => {
    const { operations } = await getReviewQueue();
    const operation = operations.find(item => item.id === 'REV-1003');
    expect(operation.planned.agents).not.toBe(operation.actual.agents);
  });
});

describe('getReviewOperation', () => {
  it('resolves a single operation by id', async () => {
    const operation = await getReviewOperation('REV-1001');
    expect(operation.id).toBe('REV-1001');
  });

  it('rejects when the id does not exist', async () => {
    await expect(getReviewOperation('REV-9999')).rejects.toThrow();
  });
});

describe('startReview', () => {
  it('moves a pending operation into IN_REVIEW and appends a history entry', async () => {
    const updated = await startReview('REV-1001', { user: 'Administrador OCC' });
    expect(updated.status).toBe('IN_REVIEW');
    expect(updated.history.at(-1)).toEqual(
      expect.objectContaining({ action: 'Revisión iniciada', fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW' })
    );
  });
});

describe('approveReviewOperation', () => {
  it('marks the operation as APPROVED, stamps approvedAt, and records history', async () => {
    const updated = await approveReviewOperation('REV-1001', { user: 'Administrador OCC' });
    expect(updated.status).toBe('APPROVED');
    expect(updated.approvedAt).not.toBeNull();
    expect(updated.history.at(-1)).toEqual(expect.objectContaining({ action: 'Operación aprobada', toStatus: 'APPROVED' }));
  });
});

describe('returnReviewOperation', () => {
  it('rejects when no reason is provided', async () => {
    await expect(returnReviewOperation('REV-1001', { user: 'Administrador OCC', reason: '' })).rejects.toThrow(
      /motivo/i
    );
  });

  it('marks the operation as RETURNED with the given reason', async () => {
    const updated = await returnReviewOperation('REV-1001', {
      user: 'Administrador OCC',
      reason: 'Falta evidencia de firma.',
    });
    expect(updated.status).toBe('RETURNED');
    expect(updated.returnReason).toBe('Falta evidencia de firma.');
    expect(updated.history.at(-1).comment).toBe('Falta evidencia de firma.');
  });
});

describe('bulk actions', () => {
  it('approves every id in the batch', async () => {
    const updated = await bulkApproveReviewOperations(['REV-1001', 'REV-1002'], { user: 'Administrador OCC' });
    expect(updated).toHaveLength(2);
    expect(updated.every(operation => operation.status === 'APPROVED')).toBe(true);
  });

  it('returns every id in the batch with the same reason', async () => {
    const updated = await bulkReturnReviewOperations(['REV-1001', 'REV-1002'], {
      user: 'Administrador OCC',
      reason: 'Revisar checklist incompleto.',
    });
    expect(updated).toHaveLength(2);
    expect(updated.every(operation => operation.status === 'RETURNED')).toBe(true);
  });
});