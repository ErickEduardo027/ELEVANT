import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { requestForAuthSession } from '../auth/requestForAuthSession';

export default function useOperationPresence(operationIds) {
  const { session } = useAuth();
  const ids = [...new Set(operationIds.filter(Boolean))].sort();
  const signature = ids.join(',');
  const scope = (session?.accountId ?? '') + '|' + (session?.token ?? '');
  const [state, setState] = useState({ scope: '', records: {} });
  useEffect(() => {
    if (!session?.token || !signature) return undefined;
    let alive = true;
    let busy = false;
    let unsupported = false;
    let active;
    const read = async () => {
      if (busy || unsupported || document.visibilityState !== 'visible') return;
      busy = true;
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const operations = [];
        const requested = signature.split(',');
        for (let index = 0; index < requested.length; index += 100) {
          if (!alive || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const result = await requestForAuthSession(client => client.getOperationalPresence(requested.slice(index, index + 100), { signal: controller.signal }), { signal: controller.signal });
          operations.push(...result.operations);
        }
        if (alive && !controller.signal.aborted) setState({ scope, records: Object.fromEntries(operations.map(item => [item.operationId, item.participants])) });
      } catch (error) {
        if (error?.status === 403 || error?.status === 404) unsupported = true;
        if (alive) setState(previous => ({ scope, records: previous.scope !== scope ? {} : Object.fromEntries(
          Object.entries(previous.records).map(([id, people]) => [id, people.map(person => ({ ...person, state: 'unknown', availability: null, message: null }))])) }));
      } finally { window.clearTimeout(timeout); busy = false; }
    };
    const offline = () => {
      active?.abort();
      if (alive) setState(previous => ({ scope, records: previous.scope !== scope ? {} : Object.fromEntries(
        Object.entries(previous.records).map(([id, people]) => [id, people.map(person => ({ ...person, state: 'unknown', availability: null, message: null }))])) }));
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 15_000);
    window.addEventListener('online', read);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', read);
    return () => {
      alive = false; active?.abort(); window.clearInterval(timer);
      window.removeEventListener('online', read); window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', read);
    };
  }, [scope, signature, session?.token]);
  return state.scope === scope ? state.records : {};
}

