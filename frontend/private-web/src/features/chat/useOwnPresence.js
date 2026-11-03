import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { requestForAuthSession } from '../auth/requestForAuthSession';

const idle = scope => ({ scope, status: 'loading', own: null, saving: false, error: false });

/** The caller's own chosen status, as stored by the API; nothing is kept locally. */
export default function useOwnPresence() {
  const { session } = useAuth();
  const scope = (session?.accountId ?? '') + '|' + (session?.token ?? '');
  const [state, setState] = useState(() => idle(scope));
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  const read = useCallback(async signal => {
    try {
      const own = await requestForAuthSession(client => client.getOwnOperationalPresence({ signal }), { signal });
      if (!signal?.aborted && scopeRef.current === scope) setState(previous => ({ ...previous, scope, status: 'ready', own }));
    } catch (error) {
      if (signal?.aborted || scopeRef.current !== scope) return;
      const unsupported = error?.status === 403 || error?.status === 404;
      setState(previous => ({ ...previous, scope, status: unsupported ? 'unsupported' : previous.own ? previous.status : 'error' }));
    }
  }, [scope]);

  useEffect(() => {
    if (!session?.token) return undefined;
    const controller = new AbortController();
    queueMicrotask(() => { void read(controller.signal); });
    // The own connection state follows this session's heartbeat (every 30 s).
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read(controller.signal); }, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [read, session?.token]);

  const update = useCallback(async status => {
    setState(previous => ({ ...previous, saving: true, error: false }));
    try {
      const own = await requestForAuthSession(client => client.putOwnOperationalPresenceStatus(status));
      if (scopeRef.current === scope) setState(previous => ({ ...previous, status: 'ready', own, saving: false }));
      return true;
    } catch {
      if (scopeRef.current === scope) setState(previous => ({ ...previous, saving: false, error: true }));
      return false;
    }
  }, [scope]);

  const current = state.scope === scope ? state : idle(scope);
  return { ...current, update, retry: () => read() };
}
