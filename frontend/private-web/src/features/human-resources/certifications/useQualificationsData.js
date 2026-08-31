import { useCallback, useEffect, useState } from 'react';
import * as qualificationsService from '../../../services/humanResourcesQualificationsService';
import { mapQualifications, deriveAgentSummaries, sortAgentSummariesByDefault, deriveQualificationKpis, deriveEquipmentCoverage } from './mappers';

const INITIAL_STATE = {
  status: 'loading',
  qualifications: [],
  agentSummaries: [],
  equipmentCoverage: [],
  agents: [],
  equipmentCatalog: [],
  error: null,
  lastUpdatedAt: null,
};

// Único punto de contacto entre la UI del módulo y la capa de servicios.
// CertificationsPage y sus componentes nunca importan
// humanResourcesQualificationsService directamente — todo pasa por aquí,
// así que sustituir los mocks por llamadas HTTP reales (dentro del
// servicio) no requiere tocar la UI. Mismo patrón status/data/error/refresh
// que useUsersData/useHumanResourcesDashboardData.
export function useQualificationsData() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    setState(current => ({ ...current, status: 'loading', error: null }));

    Promise.all([
      qualificationsService.getQualifications(),
      qualificationsService.getEquipmentCatalog(),
      qualificationsService.getAgents(),
    ])
      .then(([records, equipmentCatalog, agents]) => {
        if (cancelled) return;
        const now = new Date();
        const qualifications = mapQualifications(records, now);
        const agentSummaries = sortAgentSummariesByDefault(deriveAgentSummaries(qualifications));
        const equipmentCoverage = deriveEquipmentCoverage(qualifications, equipmentCatalog);

        setState({
          status: 'success',
          qualifications,
          agentSummaries,
          equipmentCoverage,
          agents,
          equipmentCatalog,
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

  const createQualificationRecord = useCallback(
    async payload => {
      const record = await qualificationsService.createQualification(payload);
      refresh();
      return record;
    },
    [refresh]
  );

  const renewQualificationRecord = useCallback(
    async (qualificationId, payload) => {
      const record = await qualificationsService.renewQualification(qualificationId, payload);
      refresh();
      return record;
    },
    [refresh]
  );

  const fetchQualificationHistory = useCallback(
    qualificationId => qualificationsService.getQualificationHistory(qualificationId),
    []
  );

  const kpis = deriveQualificationKpis(state.qualifications);

  return {
    ...state,
    kpis,
    refresh,
    createQualificationRecord,
    renewQualificationRecord,
    fetchQualificationHistory,
  };
}
