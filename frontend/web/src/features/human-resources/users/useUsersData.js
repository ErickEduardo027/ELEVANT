import { useCallback, useEffect, useState } from 'react';
import * as usersService from '../../../services/humanResourcesUsersService';
import { mapUsersToListItems, deriveUserKpis } from './mappers';

const INITIAL_STATE = { status: 'loading', items: [], roles: [], airlines: [], error: null, lastUpdatedAt: null };

// Único punto de contacto entre la UI del módulo y la capa de servicios.
// UsersPage y sus componentes nunca importan humanResourcesUsersService
// directamente — todo pasa por aquí, así que sustituir los mocks por
// llamadas HTTP reales (dentro del servicio) no requiere tocar la UI.
// Mismo patrón status/data/error/refresh que useHumanResourcesDashboardData.
export function useUsersData() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    setState(current => ({ ...current, status: 'loading', error: null }));

    Promise.all([usersService.getUsers(), usersService.getRoles(), usersService.getAirlines()])
      .then(([users, roles, airlines]) => {
        if (cancelled) return;
        const airlinesById = Object.fromEntries(airlines.map(airline => [airline.id, airline]));
        const items = mapUsersToListItems(users, airlinesById);
        setState({ status: 'success', items, roles, airlines, error: null, lastUpdatedAt: new Date() });
      })
      .catch(error => {
        if (!cancelled) setState(current => ({ ...current, status: 'error', error }));
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken(token => token + 1), []);

  const createUserRecord = useCallback(
    async payload => {
      const record = await usersService.createUser(payload);
      refresh();
      return record;
    },
    [refresh]
  );

  const updateUserRecord = useCallback(
    async (userId, payload) => {
      const record = await usersService.updateUser(userId, payload);
      refresh();
      return record;
    },
    [refresh]
  );

  const activateAccount = useCallback(
    async userId => {
      const record = await usersService.activateAccount(userId);
      refresh();
      return record;
    },
    [refresh]
  );

  const deactivateAccount = useCallback(
    async (userId, payload) => {
      const record = await usersService.deactivateAccount(userId, payload);
      refresh();
      return record;
    },
    [refresh]
  );

  const resendInvitation = useCallback(
    async userId => {
      const record = await usersService.resendInvitation(userId);
      refresh();
      return record;
    },
    [refresh]
  );

  const resetAccess = useCallback(
    async userId => {
      const record = await usersService.resetAccess(userId);
      refresh();
      return record;
    },
    [refresh]
  );

  const bulkActivateAccounts = useCallback(
    async userIds => {
      const records = await usersService.bulkActivateAccounts(userIds);
      refresh();
      return records;
    },
    [refresh]
  );

  const bulkDeactivateAccounts = useCallback(
    async (userIds, payload) => {
      const records = await usersService.bulkDeactivateAccounts(userIds, payload);
      refresh();
      return records;
    },
    [refresh]
  );

  const fetchUserHistory = useCallback(userId => usersService.getUserHistory(userId), []);

  const kpis = deriveUserKpis(state.items);

  return {
    ...state,
    kpis,
    refresh,
    createUserRecord,
    updateUserRecord,
    activateAccount,
    deactivateAccount,
    resendInvitation,
    resetAccess,
    bulkActivateAccounts,
    bulkDeactivateAccounts,
    fetchUserHistory,
  };
}
