import { useCallback, useEffect, useState } from 'react';
import * as permitsService from '../../../services/humanResourcesPermitsService';
import { mapPermits, deriveAgentPermitSummaries, sortAgentPermitsByUrgency, derivePermitKpis } from './mappers';

const INITIAL_STATE = {
  status: 'loading',
  permits: [],
  agentSummaries: [],
  agents: [],
  error: null,
  lastUpdatedAt: null,
};

// Único punto de contacto entre la UI del módulo y la capa de servicios.
// PermitsPage y sus componentes nunca importan humanResourcesPermitsService
// directamente — todo pasa por aquí, así que sustituir los mocks por
// llamadas HTTP reales (dentro del servicio) no requiere tocar la UI.
// Mismo patrón status/data/error/refresh que useQualificationsData.
export function useAirportPermitsData() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    setState(current => ({ ...current, status: 'loading', error: null }));

    Promise.all([permitsService.getPermits(), permitsService.getAgents()])
      .then(([records, agents]) => {
        if (cancelled) return;
        const now = new Date();
        const permits = mapPermits(records, now);
        const identityById = new Map(agents.map(agentRecord => [agentRecord.agentId, agentRecord]));
        const agentSummaries = sortAgentPermitsByUrgency(deriveAgentPermitSummaries(permits, identityById));

        setState({
          status: 'success',
          permits,
          agentSummaries,
          agents,
          error: null,
          lastUpdatedAt: now,
        });
      })
      .catch(error => {
        if (!cancelled) setState(current => ({ ...current, status: 'error', error }));
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken(token => token + 1), []);

  const renewPermitRecord = useCallback(
    async (permitId, payload) => {
      const record = await permitsService.renewPermit(permitId, payload);
      refresh();
      return record;
    },
    [refresh]
  );

  const fetchPermitHistory = useCallback(permitId => permitsService.getPermitHistory(permitId), []);

  const kpis = derivePermitKpis(state.permits);

  return {
    ...state,
    kpis,
    refresh,
    renewPermitRecord,
    fetchPermitHistory,
  };
}
