import { useCallback, useMemo, useState, useEffect } from 'react';
import * as schedulesService from '../../../services/humanResourcesSchedulesService';
import { indexShiftsByAgentAndDate, indexApprovedRestrictions, validateShiftAssignment } from './mappers';

const INITIAL_STATE = {
  status: 'loading',
  agents: [],
  positions: [],
  shiftBlocks: [],
  coverageRequirements: [],
  qualifications: [],
  shifts: [],
  availabilityRequests: [],
  error: null,
};

// Único punto de contacto entre la UI del módulo y la capa de servicios.
// SchedulesPage y sus componentes nunca importan humanResourcesSchedulesService
// directamente — todo pasa por aquí, así que sustituir los mocks por
// llamadas HTTP reales (dentro del servicio) no requiere tocar la UI.
// Mismo patrón status/data/error/refresh que useAirportPermitsData.
export function useSchedulesData() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    setState(current => ({ ...current, status: 'loading', error: null }));

    Promise.all([
      schedulesService.getAgents(),
      schedulesService.getPositions(),
      schedulesService.getShiftBlocks(),
      schedulesService.getCoverageRequirements(),
      schedulesService.getQualificationSummaries(),
      schedulesService.getShifts(),
      schedulesService.getAvailabilityRequests(),
    ])
      .then(([agents, positions, shiftBlocks, coverageRequirements, qualifications, shifts, availabilityRequests]) => {
        if (cancelled) return;
        setState({
          status: 'success',
          agents,
          positions,
          shiftBlocks,
          coverageRequirements,
          qualifications,
          shifts,
          availabilityRequests,
          error: null,
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

  const shiftsByAgentDate = useMemo(() => indexShiftsByAgentAndDate(state.shifts), [state.shifts]);
  const approvedRestrictionsByAgentDate = useMemo(
    () => indexApprovedRestrictions(state.availabilityRequests),
    [state.availabilityRequests]
  );
  const positionsById = useMemo(() => new Map(state.positions.map(position => [position.id, position])), [state.positions]);

  const validateAssignment = useCallback(
    input =>
      validateShiftAssignment(input, {
        shiftsByAgentDate,
        approvedRestrictionsByAgentDate,
        qualifications: state.qualifications,
        positions: state.positions,
        now: new Date(),
      }),
    [shiftsByAgentDate, approvedRestrictionsByAgentDate, state.qualifications, state.positions]
  );

  const saveShiftAssignment = useCallback(
    async payload => {
      const record = await schedulesService.saveShift(payload);
      refresh();
      return record;
    },
    [refresh]
  );

  const removeShift = useCallback(
    async shiftId => {
      await schedulesService.deleteShift(shiftId);
      refresh();
    },
    [refresh]
  );

  const resolveRequest = useCallback(
    async (requestId, status) => {
      const record = await schedulesService.resolveAvailabilityRequest(requestId, status);
      refresh();
      return record;
    },
    [refresh]
  );

  return {
    ...state,
    shiftsByAgentDate,
    approvedRestrictionsByAgentDate,
    positionsById,
    refresh,
    validateAssignment,
    saveShiftAssignment,
    removeShift,
    resolveRequest,
  };
}
