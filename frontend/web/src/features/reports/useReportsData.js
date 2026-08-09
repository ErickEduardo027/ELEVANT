import { useCallback, useEffect, useState } from 'react';
import {
  getClosureReport,
  getGroundTimeReport,
  getOperationalSummary,
  getReconciliationReport,
} from '../../services/reportsService';
import { getReportFilterOptions } from './reportsMappers';

// Wrapped in thunks (rather than storing the imported functions directly) so each
// call re-reads the live module binding — required for tests to replace them via
// vi.spyOn, since a plain object literal would otherwise capture a frozen snapshot
// of the function taken at module-evaluation time.
const FETCHERS_BY_REPORT = {
  closure: (...args) => getClosureReport(...args),
  reconciliation: (...args) => getReconciliationReport(...args),
  groundTime: (...args) => getGroundTimeReport(...args),
  summary: (...args) => getOperationalSummary(...args),
};

export function useReportsData(stationCode = 'PUJ', activeReport = 'closure', filters = {}, refreshToken = 0) {
  // Callers (including inline usage without useMemo) may pass a new `filters` object
  // on every render even when its content is unchanged. Keying off the serialized
  // content instead of the object reference avoids retriggering a fetch — and the
  // render loop that follows from it — for an equivalent-but-new object.
  const filtersKey = JSON.stringify(filters);
  const queryKey = `${stationCode}|${activeReport}|${filtersKey}|${refreshToken}`;

  const [state, setState] = useState({ status: 'loading', data: null, error: null, key: null });

  // Reset synchronously *during render* the moment the query changes, instead of
  // waiting for an effect. Effects only run after a render commits — so on report/
  // filter changes, one render would otherwise pair the NEW activeReport (already
  // updated) with the PREVIOUS report's still-loaded `data` (different row shape),
  // which crashes when a table renders e.g. `flight` expecting a string but getting
  // the other report's `flight` object. This is React's documented pattern for
  // resetting state when an input changes — the mismatched render is discarded
  // before it ever commits. See https://react.dev/learn/you-might-not-need-an-effect
  if (state.key !== queryKey) {
    setState({ status: 'loading', data: null, error: null, key: queryKey });
  }

  const load = useCallback(() => {
    const fetchReport = FETCHERS_BY_REPORT[activeReport] ?? getClosureReport;
    return fetchReport(stationCode, filters)
      .then(data => setState(current => (current.key === queryKey ? { ...current, status: 'success', data, error: null } : current)))
      .catch(error => setState(current => (current.key === queryKey ? { ...current, status: 'error', data: null, error } : current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationCode, activeReport, filtersKey, queryKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { status: state.status, data: state.data, error: state.error, refresh: load };
}

export function useReportFilterOptions(stationCode = 'PUJ', refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', options: null });

  useEffect(() => {
    let cancelled = false;
    setState(current => ({ ...current, status: 'loading' }));

    getOperationalSummary(stationCode)
      .then(({ records }) => {
        if (!cancelled) setState({ status: 'success', options: getReportFilterOptions(records) });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', options: null });
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode, refreshToken]);

  return state;
}
