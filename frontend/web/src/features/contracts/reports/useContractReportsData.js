import { useEffect, useMemo, useState } from 'react';
import { getContractReportsSnapshot, recordContractReportExport } from '../../../services/contractReportsService';

export function useContractReportsData() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [airlineFilter, setAirlineFilter] = useState('all');
  const [lastExport, setLastExport] = useState(null);

  function load() {
    setState({ status: 'loading', data: null, error: null });
    return getContractReportsSnapshot()
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => setState({ status: 'error', data: null, error }));
  }

  useEffect(() => { load(); }, []);

  const rows = useMemo(
    () => state.data?.rows?.filter(row => airlineFilter === 'all' || row.airline === airlineFilter) ?? [],
    [airlineFilter, state.data],
  );

  const totals = useMemo(
    () => rows.reduce((sum, row) => ({
      activeContracts: sum.activeContracts + row.activeContracts,
      expiringContracts: sum.expiringContracts + row.expiringContracts,
      services: sum.services + row.services,
      estimatedValue: sum.estimatedValue + row.estimatedValue,
    }), { activeContracts: 0, expiringContracts: 0, services: 0, estimatedValue: 0 }),
    [rows],
  );

  async function registerExport(format) {
    const record = await recordContractReportExport({ format, airline: airlineFilter, user: 'Usuario de Contratos' });
    setLastExport(record);
    return record;
  }

  return { ...state, rows, totals, airlineFilter, setAirlineFilter, lastExport, retry: load, registerExport };
}
