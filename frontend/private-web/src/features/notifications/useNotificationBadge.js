import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../../services/notificationsService';
import {
  loadOperationalNotifications,
  setOperationalNotificationRead,
} from '../../services/operationalCommunicationService';

export const NOTIFICATIONS_REFRESH_EVENT = 'elevant-notifications-refresh';

export function requestNotificationsRefresh() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH_EVENT));
}

const asBadgeItem = item => ({ ...item, read: item.readAt != null });

export default function useNotificationBadge({ fallback = 0, intervalMs = 15_000, enabled = true, source = 'legacy' } = {}) {
  const [count, setCount] = useState(fallback);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle');
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    try {
      const snapshot = source === 'operational'
        ? await loadOperationalNotifications()
        : await getNotifications();
      if (!mounted.current) return;
      const nextItems = source === 'operational'
        ? (snapshot.notifications ?? []).map(asBadgeItem)
        : snapshot.notifications ?? [];
      setItems(nextItems);
      setCount(nextItems.filter(item => !item.read).length);
      setStatus('success');
    } catch {
      if (mounted.current) setStatus('error');
    }
  }, [enabled, source]);

  useEffect(() => {
    if (!enabled) return undefined;

    mounted.current = true;
    void refresh();
    const timer = window.setInterval(refresh, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onFocus = () => void refresh();
    const onRequestedRefresh = () => void refresh();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onRequestedRefresh);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onRequestedRefresh);
    };
  }, [enabled, intervalMs, refresh]);

  const markAsRead = useCallback(async id => {
    const updated = source === 'operational'
      ? asBadgeItem(await setOperationalNotificationRead(id, true))
      : await markNotificationAsRead(id);
    setItems(current => current.map(item => item.id === id ? updated : item));
    setCount(current => Math.max(0, current - 1));
    return updated;
  }, [source]);

  const markAllAsRead = useCallback(async () => {
    const updated = source === 'operational'
      ? await Promise.all(items.map(item => item.read ? item : setOperationalNotificationRead(item.id, true).then(asBadgeItem)))
      : await markAllNotificationsAsRead();
    setItems(updated);
    setCount(0);
    return updated;
  }, [items, source]);

  return { count, items, status, refresh, markAsRead, markAllAsRead };
}
