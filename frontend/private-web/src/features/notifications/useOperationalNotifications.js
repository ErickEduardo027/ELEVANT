import { useCallback, useEffect, useRef, useState } from 'react';
import { loadOperationalNotifications, setOperationalNotificationRead } from './operationalNotificationService';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty = scope => ({ scope, status: 'loading', items: [], hasMore: false });

/** One account-bound operational feed, shared by the OCC shell and history. */
export default function useOperationalNotifications({ accountId, enabled = true, onArrive } = {}) {
  const scope = enabled ? accountId ?? 'isolated' : 'disabled';
  const [state, setState] = useState(() => empty(scope));
  const actions = useRef(null);
  const onArriveRef = useRef(onArrive);
  useEffect(() => { onArriveRef.current = onArrive; }, [onArrive]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let request = 0;
    let writeRevision = 0;
    let pendingWrites = 0;
    let initialized = false;
    let loading = false;
    const seen = new Set();
    const writes = new Map();
    const load = async () => {
      if (loading) return;
      loading = true;
      const id = ++request;
      const atWrite = writeRevision;
      try {
        const data = await loadOperationalNotifications({ signal: controller.signal });
        if (controller.signal.aborted || id !== request || pendingWrites || atWrite !== writeRevision) return;
        const items = [...new Map((data.notifications ?? []).map(item => [item.id, item])).values()];
        const fresh = initialized ? items.filter(item => !item.readAt && !seen.has(item.id)) : [];
        items.forEach(item => seen.add(item.id));
        initialized = true;
        setState({ scope, status: 'success', items, hasMore: Boolean(data.hasMore) });
        if (fresh.length) onArriveRef.current?.(fresh);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error) || id !== request) return;
        setState(previous => error?.status === 403
          ? { ...empty(scope), status: 'forbidden' }
          : { ...(previous.scope === scope ? previous : empty(scope)), status: 'error' });
      } finally {
        loading = false;
      }
    };
    const markRead = (id, read = true) => {
      const existing = writes.get(id);
      if (existing) return existing.read === read ? existing.promise : existing.promise.then(() => markRead(id, read));
      pendingWrites += 1;
      writeRevision += 1;
      const promise = (async () => { try {
        const updated = await setOperationalNotificationRead(id, read, { signal: controller.signal });
        if (!controller.signal.aborted) setState(previous => previous.scope !== scope ? previous : {
          ...previous, items: previous.items.map(item => item.id === id ? updated : item),
        });
        return updated;
      } finally {
        pendingWrites -= 1;
        writeRevision += 1;
        writes.delete(id);
      }
      })();
      writes.set(id, { read, promise });
      return promise;
    };
    actions.current = { refresh: load, markRead };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000);
    const onFocus = () => { void load(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const observer = UUID.test(accountId ?? '') ? createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('notifications')) void load();
    }) : null;
    if (observer) void observer.start().catch(() => {});
    return () => {
      actions.current = null;
      abortForEffectCleanup(controller);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (observer) void observer.stop();
    };
  }, [accountId, enabled, scope]);

  const refresh = useCallback(() => actions.current?.refresh(), []);
  const markRead = useCallback((id, read = true) => actions.current?.markRead(id, read), []);
  const current = enabled && state.scope === scope ? state : empty(scope);
  return { ...current, count: current.items.filter(item => !item.readAt).length, refresh, markRead };
}
