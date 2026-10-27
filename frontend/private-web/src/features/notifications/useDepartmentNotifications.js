import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { loadDepartmentNotifications, setDepartmentNotificationRead } from '../../services/operationalCommunicationService';

/**
 * Department alerts with live arrival: the account change feed announces `notifications`
 * and the list is re-read. Unread alerts that were not in the previous read are handed to
 * `onArrive` (never on the first read, so opening the app does not replay old alerts).
 */
export default function useDepartmentNotifications({ enabled = true, onArrive, intervalMs = 60_000 } = {}) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState(enabled ? 'loading' : 'idle');
  const seen = useRef(null);
  const arrive = useRef(onArrive);
  useEffect(() => { arrive.current = onArrive; }, [onArrive]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const snapshot = await loadDepartmentNotifications();
      const next = snapshot.notifications ?? [];
      const fresh = seen.current ? next.filter(item => !item.readAt && !seen.current.has(item.id)) : [];
      seen.current = new Set(next.map(item => item.id));
      setItems(next);
      setUnreadCount(snapshot.unreadCount ?? next.filter(item => !item.readAt).length);
      setStatus('success');
      if (fresh.length) arrive.current?.(fresh);
    } catch (error) {
      setStatus(error?.status === 403 ? 'unauthorized' : 'error');
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const run = () => { if (active) void refresh(); };
    run();
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('notifications')) run();
    });
    void observer.start();
    const timer = window.setInterval(run, intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
      void observer.stop();
    };
  }, [enabled, intervalMs, refresh]);

  const markRead = useCallback(async (id, read = true) => {
    const updated = await setDepartmentNotificationRead(id, read);
    setItems(current => current.map(item => item.id === id ? updated : item));
    setUnreadCount(current => Math.max(0, current + (read ? -1 : 1)));
    return updated;
  }, []);

  const markAllRead = useCallback(async () => {
    const pending = items.filter(item => !item.readAt);
    const updated = await Promise.all(pending.map(item => setDepartmentNotificationRead(item.id, true)));
    const byId = new Map(updated.map(item => [item.id, item]));
    setItems(current => current.map(item => byId.get(item.id) ?? item));
    setUnreadCount(0);
  }, [items]);

  return { items, unreadCount, status, refresh, markRead, markAllRead };
}
