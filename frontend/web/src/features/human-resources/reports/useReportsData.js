import { useCallback, useEffect, useState } from 'react';
import {
  exportReport as exportHumanResourcesReport,
  getAccountMovementsReport,
  getExpirationReport,
  getQualificationCoverageReport,
  getStaffDistributionReport,
} from '../../../services/humanResourcesReportsService';

const FETCHERS = {
  expirations: filters => getExpirationReport(filters),
  accountMovements: filters => getAccountMovementsReport(filters),
  staffDistribution: filters => getStaffDistributionReport(filters),
  qualificationCoverage: filters => getQualificationCoverageReport(filters),
};

export function useHumanResourcesReportsData(activeReport, filters = {}, refreshToken = 0) {
  const filtersKey = JSON.stringify(filters);
  const queryKey = `${activeReport}|${filtersKey}|${refreshToken}`;

  const [state, setState] = useState({ status: 'loading', data: null, error: null, key: null });

  if (state.key !== queryKey) {
    setState({ status: 'loading', data: null, error: null, key: queryKey });
  }

  const load = useCallback(() => {
    const fetchReport = FETCHERS[activeReport] ?? FETCHERS.expirations;
    return fetchReport(filters)
      .then(data => setState(current => (current.key === queryKey ? { ...current, status: 'success', data, error: null } : current)))
      .catch(error => setState(current => (current.key === queryKey ? { ...current, status: 'error', data: null, error } : current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport, filtersKey, queryKey]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    refresh: load,
    exportReport: exportHumanResourcesReport,
  };
}
