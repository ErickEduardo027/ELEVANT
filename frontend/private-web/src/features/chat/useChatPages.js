import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../../lib/abort';

export function mergeChatPage(current, incoming, { older = false, messages = false } = {}) {
  if (messages) {
    const updates = new Map(incoming.map(item => [item.id, item]));
    const result = current.map(item => updates.get(item.id) ?? item);
    const ids = new Set(result.map(item => item.id));
    let previousId;
    for (let index = 0; index < incoming.length; index += 1) {
      const item = incoming[index];
      if (!ids.has(item.id)) {
        const previous = previousId === undefined ? -1 : result.findIndex(row => row.id === previousId);
        const next = incoming.slice(index + 1).find(row => ids.has(row.id));
        const low = previous + 1;
        const high = next ? result.findIndex(row => row.id === next.id) : result.length;
        let insertion = previous >= 0 ? low : next ? high : older ? 0 : result.length;
        const sentAt = Date.parse(item.sentAt);
        if (Number.isFinite(sentAt)) {
          // Timestamps position previously unseen records. Existing IDs retain
          // their server order, including ties; UUIDs never determine order.
          const later = result.findIndex((row, position) => position >= low && position < high && Date.parse(row.sentAt) > sentAt);
          if (later >= 0) insertion = later;
          else if (high > low && result.slice(low, high).every(row => Number.isFinite(Date.parse(row.sentAt)))) insertion = high;
        }
        result.splice(insertion, 0, item);
        ids.add(item.id);
      }
      previousId = item.id;
    }
    return result;
  }
  const key = item => item.operationId;
  const incomingIds = new Set(incoming.map(key));
  const old = current.filter(item => !incomingIds.has(key(item)));
  const combined = older ? [...current, ...incoming] : [...incoming, ...old];
  const seen = new Set();
  return combined.filter(item => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; });
}

export function useChatPages(scope, loader, { messages = false, interval = 20_000 } = {}) {
  const [state, setState] = useState({ scope, status: scope ? 'loading' : 'idle', items: [], hasMore: false, busy: false });
  const snapshot = useRef(state);
  const request = useRef(null);
  const activeScope = useRef(null);
  const load = useCallback(async (older = false) => {
    if (!scope || activeScope.current !== scope || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const previous = snapshot.current.scope === scope ? snapshot.current : { scope, items: [] };
    const offset = older ? previous.items.length : 0;
    setState(value => ({ ...(value.scope === scope ? value : { scope, items: [], hasMore: false }), status: previous.items.length ? 'success' : 'loading', busy: true, error: false }));
    try {
      const data = await loader(scope, { signal: controller.signal, ...(offset ? { offset } : {}) });
      if (controller.signal.aborted) return;
      const page = messages ? data.messages : data.conversations;
      setState(value => {
        const base = value.scope === scope ? value.items : [];
        const items = mergeChatPage(base, page, { older, messages });
        const noProgress = older ? items.length === base.length : Boolean(value.noProgress && items.length === base.length);
        const hasMore = older || !base.length || base.length <= page.length ? data.hasMore : value.hasMore;
        const next = { scope, status: 'success', items, hasMore: noProgress ? false : hasMore, busy: false, error: false, noProgress };
        snapshot.current = next;
        return next;
      });
      return true;
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setState(value => [401, 403, 404].includes(error?.status)
        ? { scope, status: 'error', items: [], hasMore: false, busy: false, error: true }
        : { ...value, status: value.items.length ? 'success' : 'error', busy: false, error: true });
      return false;
    } finally { if (request.current === controller) request.current = null; }
  }, [scope, loader, messages]);
  useEffect(() => {
    activeScope.current = scope;
    snapshot.current = { scope, items: [] };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, interval);
    return () => { activeScope.current = null; request.current?.abort(); request.current = null; window.clearInterval(timer); };
  }, [scope, load, interval]);
  const append = useCallback(item => setState(value => {
    if (value.scope !== item.operationId) return value;
    const next = { ...value, items: mergeChatPage(value.items, [item], { messages: true }) };
    snapshot.current = next;
    return next;
  }), []);
  return { ...(state.scope === scope ? state : { status: scope ? 'loading' : 'idle', items: [], hasMore: false, busy: false }), refresh: load, loadMore: () => load(true), append };
}
