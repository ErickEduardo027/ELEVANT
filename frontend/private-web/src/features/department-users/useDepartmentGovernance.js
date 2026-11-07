import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import {
  getDepartmentOptions,
  getDepartmentSummary,
  getPermissionCatalog,
  listAccessProfiles,
  listAccessRequests,
  listDepartmentUsers,
} from '../../services/departmentGovernanceService';
import { governanceMessage } from '../../services/humanResourcesEmployeesService';

const RESOURCES = ['department_users', 'access_requests'];

/**
 * Everything a department's user administration needs, re-read on focus and
 * whenever the account-change feed announces users or requests changed.
 */
export function useDepartmentGovernance(department, filters) {
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [reference, setReference] = useState({ options: null, catalog: null });
  const version = useRef(0);
  const filterKey = JSON.stringify(filters ?? {});

  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const parsedFilters = JSON.parse(filterKey);
      const [summary, users, profiles, requests] = await Promise.all([
        getDepartmentSummary(department),
        listDepartmentUsers(department, parsedFilters),
        listAccessProfiles(department),
        listAccessRequests({ department, limit: 50 }),
      ]);
      if (current !== version.current) return;
      setState({ status: 'ready', error: '', summary, users, profiles, requests });
    } catch (error) {
      if (current !== version.current) return;
      setState(previous => ({ ...previous, status: previous.summary ? 'ready' : 'error', error: governanceMessage(error) }));
    }
  }, [department, filterKey]);

  // Stations, terminals and the permission catalog change rarely: read them once per department.
  useEffect(() => {
    let active = true;
    Promise.all([getDepartmentOptions(department), getPermissionCatalog()])
      .then(([options, catalog]) => {
        if (active) setReference({ options, catalog: catalog.find(item => item.department === department) ?? null });
      })
      .catch(() => { if (active) setReference({ options: { stations: [], terminals: [], supervisors: [] }, catalog: null }); });
    return () => { active = false; };
  }, [department]);

  useEffect(() => {
    void refresh();
    return () => { version.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => RESOURCES.includes(resource))) void refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      void observer.stop();
    };
  }, [refresh]);

  return { ...state, ...reference, refresh };
}

export function newRequestId() {
  return globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.floor(Math.random() * 16);
      return (char === 'x' ? random : (random % 4) + 8).toString(16);
    });
}

export const PASSWORD_PATTERN = '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{14,}';
export const PASSWORD_HINT = 'Al menos 14 caracteres con mayúscula, minúscula, número y símbolo.';

export const REQUEST_STATUS_TONES = {
  Pending: 'warning',
  Validated: 'success',
  Rejected: 'danger',
  Cancelled: 'neutral',
};
