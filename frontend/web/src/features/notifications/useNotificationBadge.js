import { useCallback, useEffect, useRef, useState } from 'react';
import { getNotifications } from '../../services/notificationsService';

export const NOTIFICATIONS_REFRESH_EVENT = 'elevant-notifications-refresh';

export function requestNotificationsRefresh() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH_EVENT));
}

export default function useNotificationBadge({ fallback = 0, intervalMs = 15_000 } = {}) {
  const [count, setCount] = useState(fallback);
  const [status, setStatus] = useState('idle');
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const snapshot = await getNotifications();
      if (!mounted.current) return;
      setCount((snapshot.notifications ?? []).filter(item => !item.read).length);
      setStatus('success');
    } catch {
      if (mounted.current) setStatus('error');
    }
  }, []);

  useEffect(() => {
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
  }, [intervalMs, refresh]);

  return { count, status, refresh };
}
