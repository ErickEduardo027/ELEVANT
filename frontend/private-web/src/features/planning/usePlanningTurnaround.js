import { useCallback, useEffect, useRef, useState } from 'react';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { changeTurnaroundStatus, getTurnaround, rescheduleTurnaround } from '../../services/planningService';

const OUTCOMES = Object.freeze({ cancel: 'Cancelled', divert: 'Diverted' });

const loadStatus = error => error?.status === 401 ? 'unauthorized'
  : error?.status === 403 ? 'forbidden'
    : error?.status === 404 ? 'not-found'
      : 'error';

/** The server says the flight moved: the screen re-reads it before a new attempt. */
const isStale = error => error?.status === 409 || error?.status === 412 || error?.status === 428;

/**
 * One turnaround as «Editar vuelo», «Cancelar vuelo» and «Marcar desviado» change it (3-A). It reads the detail with
 * its strong ETag and the changes its state allows, sends each change with the intent's Idempotency-Key and that ETag,
 * and re-reads the flight when the server answers that it moved (409, 412 or 428), so the next attempt starts from the
 * current version. An uncertain result (no answer, a 5xx) keeps the key and the command for the retry.
 */
export function usePlanningTurnaround(turnaroundId) {
  // The answer of the last read, tagged with the read it answers: while a newer read runs, the flight is loading
  // and keeps the version it had.
  const [read, setRead] = useState({ request: null, status: 'loading', detail: null, etag: null, error: null });
  const [submitting, setSubmitting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const keys = useRef(createCommandKeyHolder());
  const mounted = useRef(true);
  const etagRef = useRef(null);
  const request = turnaroundId ? `${turnaroundId}#${reloadToken}` : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!turnaroundId) return undefined;
    const controller = new AbortController();
    const answering = `${turnaroundId}#${reloadToken}`;
    getTurnaround(turnaroundId, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        etagRef.current = value.etag;
        setRead({ request: answering, status: 'success', detail: value.turnaround, etag: value.etag, error: null });
      })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        etagRef.current = null;
        setRead({ request: answering, status: loadStatus(error), detail: null, etag: null, error });
      });
    return () => controller.abort();
  }, [turnaroundId, reloadToken]);

  const reload = useCallback(() => setReloadToken(value => value + 1), []);

  /**
   * Sends one change: `reschedule` with the «Editar vuelo» body, `cancel` or `divert` with `{ reason }`. Resolves with
   * `{ ok: true, detail }` or `{ ok: false, error, refreshed }`; `refreshed` means the flight was read again.
   */
  const submit = useCallback(async (action, body) => {
    if (!turnaroundId || !etagRef.current) return { ok: false, error: null, refreshed: false };
    const command = action === 'reschedule' ? body : { outcome: OUTCOMES[action], reason: body?.reason };
    if (!command?.outcome && action !== 'reschedule') return { ok: false, error: null, refreshed: false };
    setSubmitting(true);
    try {
      const result = await keys.current.run(action, command, (idempotencyKey, ifMatch) => action === 'reschedule'
        ? rescheduleTurnaround(turnaroundId, command, { ifMatch, idempotencyKey })
        : changeTurnaroundStatus(turnaroundId, command, { ifMatch, idempotencyKey }),
      // The ETag is taken at the first attempt of the intent: a retry sends the same headers with the same body.
      () => etagRef.current);
      if (mounted.current) {
        etagRef.current = result.etag;
        setRead(current => ({ ...current, status: 'success', detail: result.turnaround, etag: result.etag, error: null }));
      }
      return { ok: true, detail: result.turnaround };
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, error, refreshed: false };
      const refreshed = isStale(error);
      if (refreshed && mounted.current) reload();
      return { ok: false, error, refreshed };
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [turnaroundId, reload]);

  const loading = read.request !== request;
  return {
    status: loading ? 'loading' : read.status,
    detail: read.detail,
    etag: read.etag,
    error: loading ? null : read.error,
    submitting,
    allowedActions: read.detail?.allowedActions ?? [],
    reload,
    submit,
  };
}
