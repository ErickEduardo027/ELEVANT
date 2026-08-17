import { useCallback, useEffect, useMemo, useState } from 'react';
import { createContractService, getContractServices, updateContractService } from '../../../services/contractServicesService';
import { getContracts } from '../../../services/contractsService';

export function useContractServicesData() {
  const [state, setState] = useState({ status: 'loading', data: [], contracts: [], error: null });
  const [query, setQuery] = useState('');
  const [contractFilter, setContractFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(() => {
    setState(current => ({ ...current, status: 'loading', error: null }));
    return Promise.all([getContractServices(), getContracts()])
      .then(([data, contracts]) => setState({ status: 'success', data, contracts, error: null }))
      .catch(error => setState({ status: 'error', data: [], contracts: [], error }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const contracts = state.contracts;

  const filteredServices = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return state.data.filter(service => {
      const matchesQuery = !normalized || service.name.toLocaleLowerCase('es').includes(normalized) || service.airline.toLocaleLowerCase('es').includes(normalized) || service.id.toLocaleLowerCase('es').includes(normalized);
      const matchesContract = contractFilter === 'all' || service.contractId === contractFilter;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? service.active : !service.active);
      return matchesQuery && matchesContract && matchesStatus;
    });
  }, [contractFilter, query, state.data, statusFilter]);

  async function addService(values) {
    const created = await createContractService(values);
    setState(current => ({ ...current, data: [created, ...current.data] }));
    return created;
  }

  async function editService(serviceId, values) {
    const updated = await updateContractService(serviceId, values);
    setState(current => ({ ...current, data: current.data.map(service => service.id === serviceId ? updated : service) }));
    return updated;
  }

  return { ...state, services: filteredServices, contracts, query, contractFilter, statusFilter, setQuery, setContractFilter, setStatusFilter, retry: load, addService, editService };
}
