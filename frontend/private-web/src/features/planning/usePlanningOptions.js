import { useEffect, useState } from 'react';
import { getPlanningOptions } from '../../services/planningService';

const IDLE_STATE = {
  status: 'idle',
  data: null,
  etag: null,
  error: null,
  reason: null,
  recoverable: false,
};
const GENERIC_LOAD_ERROR = 'No fue posible cargar las opciones de planificación.';
const UNAUTHORIZED_ERROR = 'La sesión expiró. Inicia sesión nuevamente.';
const FORBIDDEN_ERROR = 'Su cuenta no tiene permiso para consultar estas opciones.';
const OPTIONS_CONFLICT_ERROR =
  'No fue posible preparar una versión asignable de esta operación. Actualice la planificación y revise su estado.';

function isAbortError(error) {
  return error !== null && typeof error === 'object' && error.name === 'AbortError';
}

function safeViewError(message, error, code = 'request-failed') {
  const safeError = new Error(message);
  safeError.name = 'PlanningOptionsViewError';
  safeError.status = typeof error?.status === 'number' ? error.status : null;
  safeError.code = code;
  safeError.recoverable = code !== 'unauthorized' && code !== 'forbidden';
  return safeError;
}

export function usePlanningOptions({
  turnaroundId,
  refreshToken = 0,
  enabled = true,
} = {}) {
  const [state, setState] = useState(IDLE_STATE);

  useEffect(() => {
    if (!enabled || !turnaroundId) {
      setState(IDLE_STATE);
      return undefined;
    }

    const controller = new AbortController();
    setState({
      status: 'loading',
      data: null,
      etag: null,
      error: null,
      reason: null,
      recoverable: false,
    });

    getPlanningOptions(turnaroundId, { signal: controller.signal })
      .then(({ options, etag }) => {
        if (controller.signal.aborted) return;
        const isEmpty = options.services.length === 0 && options.agents.length === 0;
        setState({
          status: isEmpty ? 'empty' : 'success',
          data: options,
          etag,
          error: null,
          reason: null,
          recoverable: false,
        });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;

        if (error?.status === 401 || error?.code === 'unauthorized') {
          setState({
            status: 'unauthorized',
            data: null,
            etag: null,
            error: safeViewError(UNAUTHORIZED_ERROR, error, 'unauthorized'),
            reason: 'unauthorized',
            recoverable: false,
          });
          return;
        }

        if (error?.status === 403 || error?.code === 'forbidden') {
          setState({
            status: 'forbidden',
            data: null,
            etag: null,
            error: safeViewError(FORBIDDEN_ERROR, error, 'forbidden'),
            reason: 'forbidden',
            recoverable: false,
          });
          return;
        }

        if (error?.status === 409 || error?.code === 'options-conflict') {
          setState({
            status: 'error',
            data: null,
            etag: null,
            error: safeViewError(
              OPTIONS_CONFLICT_ERROR,
              error,
              'options-conflict'
            ),
            reason: 'options-conflict',
            recoverable: true,
          });
          return;
        }

        setState({
          status: 'error',
          data: null,
          etag: null,
          error: safeViewError(GENERIC_LOAD_ERROR, error),
          reason: 'request-failed',
          recoverable: true,
        });
      });

    return () => controller.abort();
  }, [turnaroundId, refreshToken, enabled]);

  return state;
}
