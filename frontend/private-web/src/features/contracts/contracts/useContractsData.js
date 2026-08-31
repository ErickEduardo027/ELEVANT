import { useCallback, useEffect, useMemo, useState } from 'react';
import { createContract, getContracts, updateContract } from '../../../services/contractsService';

export function useContractsData() {
  const [state, setState] = useState({ status: 'loading', data: [], error: null });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(() => {
    setState(current => ({ ...current, status: 'loading', error: null }));
    return getContracts()
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => setState({ status: 'error', data: [], error }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredContracts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('es');
    return state.data.filter(contract => {
      const matchesQuery =
        !normalizedQuery ||
        contract.id.toLocaleLowerCase('es').includes(normalizedQuery) ||
        contract.airline.toLocaleLowerCase('es').includes(normalizedQuery) ||
        contract.airlineCode.toLocaleLowerCase('es').includes(normalizedQuery);
      const matchesStatus = statusFilter === 'all' || contract.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, state.data, statusFilter]);

  async function addContract(values) {
    const created = await createContract(values);
    setState(current => ({ ...current, data: [created, ...current.data] }));
    return created;
  }

  async function editContract(contractId, values) {
    const updated = await updateContract(contractId, values);
    setState(current => ({
      ...current,
      data: current.data.map(contract => (contract.id === contractId ? updated : contract)),
    }));
    return updated;
  }

  return {
    ...state,
    contracts: filteredContracts,
    query,
    statusFilter,
    setQuery,
    setStatusFilter,
    retry: load,
    addContract,
    editContract,
  };
}
