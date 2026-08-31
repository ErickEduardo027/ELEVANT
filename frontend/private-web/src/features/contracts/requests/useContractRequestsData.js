import { useCallback, useEffect, useMemo, useState } from 'react';
import { getContractRequests, markRequestInReview, resolveContractRequest } from '../../../services/contractRequestsService';

export function useContractRequestsData() {
  const [state, setState] = useState({ status: 'loading', data: [], error: null });
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(() => {
    setState(current => ({ ...current, status: 'loading', error: null }));
    return getContractRequests()
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => setState({ status: 'error', data: [], error }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRequests = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return state.data.filter(request => {
      const matchesQuery = !normalized || request.id.toLocaleLowerCase('es').includes(normalized) || request.airline.toLocaleLowerCase('es').includes(normalized) || request.contactEmail.toLocaleLowerCase('es').includes(normalized);
      return matchesQuery && (typeFilter === 'all' || request.type === typeFilter) && (statusFilter === 'all' || request.status === statusFilter);
    });
  }, [query, state.data, statusFilter, typeFilter]);

  function replaceRequest(updated) {
    setState(current => ({ ...current, data: current.data.map(request => request.id === updated.id ? updated : request) }));
  }

  async function beginReview(requestId) {
    const updated = await markRequestInReview(requestId);
    replaceRequest(updated);
    return updated;
  }

  async function resolveRequest(requestId, decision) {
    const updated = await resolveContractRequest(requestId, decision);
    replaceRequest(updated);
    return updated;
  }

  return { ...state, requests: filteredRequests, query, typeFilter, statusFilter, setQuery, setTypeFilter, setStatusFilter, retry: load, beginReview, resolveRequest };
}
