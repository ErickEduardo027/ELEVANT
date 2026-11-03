import { useEffect, useState } from 'react';
import { getPlanningSnapshot } from '../../services/planningService';
import { mapOccPlanningSnapshot } from './planningMappers';
import { abortForEffectCleanup } from '../../lib/abort';

const INITIAL_STATE = { status: 'loading', data: null, error: null, refreshing: false };
const IDLE_STATE = { status: 'idle', data: null, error: null, refreshing: false };
const GENERIC_LOAD_ERROR = 'No fue posible cargar la planificación operativa.';
const UNAUTHORIZED_ERROR = 'La sesión expiró. Inicia sesión nuevamente.';
const FORBIDDEN_ERROR = 'Su cuenta no tiene permiso para consultar esta planificación.';

function isAbortError(error) {
  return error !== null && typeof error === 'object' && error.name === 'AbortError';
}

function safeViewError(message, error) {
  const safeError = new Error(message);
  safeError.name = 'PlanningViewError';
  safeError.status = typeof error?.status === 'number' ? error.status : null;
  safeError.code = typeof error?.code === 'string' ? error.code : 'request-failed';
  return safeError;
}

export function usePlanningData({ stationId, date, accountId, refreshToken = 0, enabled = true } = {}) {
  const [state, setState] = useState(() => (enabled ? INITIAL_STATE : IDLE_STATE));
  const scope = JSON.stringify([accountId ?? null, stationId ?? null, date ?? null]);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE_STATE);
      return undefined;
    }

    const controller = new AbortController();
    setState(previous => previous.scope === scope && previous.data
      ? { ...previous, refreshing: true, error: null }
      : { ...INITIAL_STATE, scope });

    const request = {
      ...(stationId === undefined ? {} : { stationId }),
      ...(date === undefined ? {} : { date }),
      signal: controller.signal,
    };

    getPlanningSnapshot(request)
      .then(snapshot => {
        if (controller.signal.aborted) return;
        const data = mapOccPlanningSnapshot(snapshot);
        setState({
          status: data.flights.length === 0 ? 'empty' : 'success',
          data,
          error: null,
          scope,
          refreshing: false,
        });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (error?.status === 401 || error?.code === 'unauthorized') {
          setState({
            status: 'unauthorized',
            data: null,
            error: safeViewError(UNAUTHORIZED_ERROR, error),
            scope,
            refreshing: false,
          });
          return;
        }
        if (error?.status === 403 || error?.code === 'forbidden') {
          setState({
            status: 'forbidden',
            data: null,
            error: safeViewError(FORBIDDEN_ERROR, error),
            scope,
            refreshing: false,
          });
          return;
        }
        setState({
          status: 'error',
          data: null,
          error: safeViewError(GENERIC_LOAD_ERROR, error),
          scope,
          refreshing: false,
        });
      });

    return () => abortForEffectCleanup(controller);
  }, [stationId, date, refreshToken, enabled, scope]);

  if (!enabled) return IDLE_STATE;
  return state.scope === scope ? state : INITIAL_STATE;
}
