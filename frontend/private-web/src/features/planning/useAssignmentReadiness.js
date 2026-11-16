import { useEffect, useState } from 'react';
import { getAssignmentReadiness } from '../../services/planningService';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';

const IDLE = { status: 'idle', marks: null };

/**
 * The planning board's marks on assigned agents who cannot do their operation (2-N25), read with the board for its
 * station and date. They annotate the board: a failure never hides the flights, it only says the marks are missing.
 */
export function useAssignmentReadiness({ stationId, date, refreshToken = 0, enabled = true } = {}) {
  const scope = `${stationId ?? ''}|${date ?? ''}`;
  const key = `${scope}|${refreshToken}`;
  const active = Boolean(enabled && stationId && date);
  const [state, setState] = useState({ key: null, scope: null, ...IDLE });

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    getAssignmentReadiness({ stationId, date, signal: controller.signal })
      .then(marks => {
        if (!controller.signal.aborted) setState({ key, scope, status: 'success', marks });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ key, scope, marks: null,
          status: error?.status === 401 ? 'unauthorized' : error?.status === 403 ? 'forbidden' : 'error' });
      });
    return () => abortForEffectCleanup(controller);
  }, [active, stationId, date, key, scope]);

  if (!active) return { ...IDLE, scope };
  if (state.key === key) return state;
  // A new read is on its way: the marks of the same board stay visible while it refreshes.
  return state.scope === scope && state.marks
    ? { ...state, status: 'refreshing' } : { key, scope, status: 'loading', marks: null };
}
