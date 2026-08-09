import { useCallback, useEffect, useState } from 'react';
import {
  approveReviewOperation,
  bulkApproveReviewOperations,
  bulkReturnReviewOperations,
  getReviewQueue,
  returnReviewOperation,
} from '../../services/reviewService';

export function useReviewData(stationCode = 'PUJ', refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = useCallback(() => {
    setState(current => ({ ...current, status: 'loading', error: null }));
    return getReviewQueue(stationCode)
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => setState({ status: 'error', data: null, error }));
  }, [stationCode]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  function patchOperations(updater) {
    setState(current =>
      current.data ? { ...current, data: { ...current.data, operations: updater(current.data.operations) } } : current
    );
  }

  const approveOperation = useCallback(async (id, meta) => {
    const updated = await approveReviewOperation(id, meta);
    patchOperations(operations => operations.map(operation => (operation.id === id ? updated : operation)));
    return updated;
  }, []);

  const returnOperation = useCallback(async (id, meta) => {
    const updated = await returnReviewOperation(id, meta);
    patchOperations(operations => operations.map(operation => (operation.id === id ? updated : operation)));
    return updated;
  }, []);

  const bulkApprove = useCallback(async (ids, meta) => {
    const updated = await bulkApproveReviewOperations(ids, meta);
    patchOperations(operations => operations.map(operation => updated.find(item => item.id === operation.id) ?? operation));
    return updated;
  }, []);

  const bulkReturn = useCallback(async (ids, meta) => {
    const updated = await bulkReturnReviewOperations(ids, meta);
    patchOperations(operations => operations.map(operation => updated.find(item => item.id === operation.id) ?? operation));
    return updated;
  }, []);

  return { ...state, refresh: load, approveOperation, returnOperation, bulkApprove, bulkReturn };
}
